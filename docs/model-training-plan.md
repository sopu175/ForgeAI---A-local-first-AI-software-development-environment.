# Training the ForgeAI local model (Qwen3.5-4B)

This is the working plan for adapting the model ForgeAI already ships (`qwen3.5:4b`) so it follows ForgeAI's agent rules, tool schemas and coding style more reliably. It separates what is realistic on this Mac from what genuinely requires a datacenter GPU.

## Verified starting point

| Item               | Value                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Machine            | MacBook Pro 18,3, Apple M1 Pro, 8 CPU / 14 GPU cores                                      |
| Memory             | 16 GB unified                                                                             |
| Free disk          | about 442 GB                                                                              |
| Model              | `qwen3.5:4b`, 4.2B parameters, Q4_K_M, 262k context, Apache 2.0                           |
| Base weights       | `Qwen/Qwen3.5-4B` (GGUF metadata points at `Qwen/Qwen3.5-4B-Base`)                        |
| Capabilities       | completion, vision, tools, thinking (separate 333M CLIP projector)                        |
| Runtime            | Ollama 0.30+, `RENDERER qwen3.5`, `PARSER qwen3.5`, `TEMPLATE {{ .Prompt }}`              |
| App integration    | `packages/shared/src/defaults.ts` -> `DEFAULT_OLLAMA_MODEL = 'qwen3.5:4b'`                |
| Existing chat data | about 5 conversations / 11 messages in `~/Library/Application Support/ForgeAI/forgeai.db` |
| Tooling present    | `python3.12`, `uv`, `ollama`; `cmake` is not installed                                    |

The existing database is enough to build the pipeline, not enough to train a useful model. The plan below therefore treats dataset construction as the main work.

## 1. Decide what "train" means

There are three different projects behind that word. Pick deliberately.

| Option                    | What changes                                  | Hardware                                               | Recommendation                            |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| Prompt + retrieval tuning | System prompts, tools, RAG, few-shot examples | none                                                   | Do first; cheapest quality win            |
| LoRA / QLoRA              | Small adapter weights (tens of MB)            | 16 GB Mac is possible for text; 1x A100 is comfortable | Recommended first real training run       |
| Full-parameter SFT        | All 4.2B weights                              | 1x A100/H100 80 GB; 16 GB is not enough                | Optional second stage for maximum quality |

A full fine-tune needs roughly: 8.4 GB fp16 weights + 8.4 GB gradients + 33.6 GB Adam states + several GB activations, so 55-70 GB before fragmentation. With 8-bit optimizers and checkpointing you can shrink that, but it still does not fit in 16 GB unified memory alongside macOS. LoRA on a 4-bit base is the only local route.

The rest of this document is the LoRA/QLoRA route, followed by the optional full-SFT cloud route.

## 2. Phase 0 - freeze a baseline

Before changing weights, record what "better" means.

1. Create a 40-task evaluation set covering coding, debugging, testing, review, docs and SEO. Each task needs a repository fixture, a pass/fail check and a maximum step count.
2. Run every task against the current `qwen3.5:4b` with temperature 0.2 and the same max steps. Save: pass/fail, steps used, wall time, prompt/output tokens, tool-call JSON validity, and whether the final diff applied cleanly.
3. Save 100 general prompts (non-coding explanations, summaries, short writing) to detect catastrophic forgetting.
4. Record latency on this Mac: time to first token, tokens/second, peak memory.

Keep the baseline report. Every later adapter is compared against it, not against intuition.

## 3. Phase 1 - build the dataset

### Sources, in order of value

1. Agent trajectories: user task, tool calls, tool results, final report, and whether the user accepted the result. These are the most valuable examples because they teach ForgeAI's exact loop.
2. Accepted diffs and their review comments. Pair the request, the diff and the reviewer's correction.
3. Kiro-style specs: requirements -> design -> tasks, with the final implementation.
4. Conversations from `forgeai.db`, but only clean, completed turns.
5. Repository-grounded Q&A generated from indexed chunks, with file paths and line ranges as citations.
6. A small general-purpose replay set (5-10% of the total) so the model does not forget how to answer ordinary questions.

Agent runs are currently streamed to the UI but not persisted as training rows. Add a persistence step before collecting trajectories: either a new `agent_runs` table (run id, task, agent kind, model, events JSON, changed files, report, accepted flag, timestamps) or append completed runs to `messages` with a dedicated role. Without this, the best data is lost when the window closes.

### Current schema to export

Relevant tables in `apps/desktop/src/main/db.ts`:

- `conversations(id, project_id, title, mode, model, created_at, updated_at)`
- `messages(id, conversation_id, role, content, reasoning, tool_calls, tool_call_id, model, tokens_in, tokens_out, duration_ms, created_at)`
- `checkpoints`, `permission_audit`, `usage`, `spec_state` for provenance and outcome labels.

Read-only export sketch:

```python
import json
import pathlib
import sqlite3

db = pathlib.Path.home() / "Library/Application Support/ForgeAI/forgeai.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute(
    """
    SELECT c.id, c.title, m.role, m.content, m.reasoning, m.tool_calls, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    ORDER BY c.id, m.created_at
    """
).fetchall()

conversations = {}
for cid, title, role, content, reasoning, tool_calls, created_at in rows:
    conversations.setdefault(cid, {"title": title, "messages": []})
    if not content or not content.strip():
        continue
    conversations[cid]["messages"].append({"role": role, "content": content})

out = pathlib.Path("data/raw/conversations.jsonl")
out.parent.mkdir(parents=True, exist_ok=True)
with out.open("w", encoding="utf-8") as handle:
    for record in conversations.values():
        if len(record["messages"]) >= 2:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
```

Do not export `.env` files, credentials, tokens or absolute home paths. Filter them before writing any dataset, and keep the raw export outside the repository.

### Record format

Chat-only SFT record:

```json
{
  "messages": [
    { "role": "system", "content": "You are ForgeAI..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Agent/tool record, serialized with the exact Qwen3.5 chat template that Ollama uses:

```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    {
      "role": "assistant",
      "content": "",
      "tool_calls": [{ "name": "read_file", "arguments": { "path": "src/app.ts" } }]
    },
    { "role": "tool", "content": "..." },
    { "role": "assistant", "content": "Final answer..." }
  ]
}
```

The safest approach is to render each conversation to plain text with the base model's `apply_chat_template` (including tools), then store `{"prompt": "...", "completion": "..."}` records with prompt masking. That guarantees training sees the same special tokens that `RENDERER qwen3.5` produces at inference. If your `mlx-lm` version accepts `messages` records directly, use that, but still spot-check the rendered tokens.

### Size and quality rules

- Minimum useful LoRA set: 500-1,000 high-quality examples; 2,000-5,000 is a better target. Full SFT: 10,000-50,000.
- Prefer accepted outcomes and corrected turns. Drop empty responses, truncated runs, failed tool loops and duplicate conversations.
- Deduplicate by normalized content hash, not exact string.
- Hold out 10% as `valid.jsonl`, stratified by agent kind. Never evaluate on training prompts.
- Review 10% of synthetic data by hand. One wrong tool call teaches the wrong pattern.
- Keep 5-10% general replay data and 5-10% "refuse or ask" examples for permission-sensitive actions.

Synthetic generation: use a stronger teacher model (30B+ class or a cloud API) to write question/answer pairs from chunks and spec documents, then verify the answer against the actual file. Generate tool-use traces by replaying real tool calls, not by asking a model to invent file contents.

## 4. Phase 2 - local QLoRA on the M1 Pro

### Gate: confirm the architecture is supported

`qwen35` is a hybrid architecture, and brand-new architectures often reach llama.cpp/Ollama before they reach every training stack. Before spending time on data, verify:

```bash
uv venv --python 3.12 .venv-train
source .venv-train/bin/activate
uv pip install -U mlx-lm
python -m mlx_lm.convert --help
python -m mlx_lm.convert --hf-path Qwen/Qwen3.5-4B --mlx-path models/qwen3.5-4b-4bit -q --q-bits 4
```

If conversion or LoRA fails with an unknown architecture, stop and use the cloud path in Phase 3. Do not try to train a Q4_K_M Ollama blob directly: adapters need the unquantized or MLX-quantized base, and GGUF quantization is not a training format.

Also install `cmake` when you reach packaging:

```bash
brew install cmake
```

### Training configuration

Start conservatively. A 16 GB machine will swap if sequence length, batch size and adapter depth are all pushed at once.

```yaml
# configs/qwen35-forge-lora.yaml
model: 'models/qwen3.5-4b-4bit'
train: true
data: 'data/sft'
fine_tune_type: 'lora'
optimizer: 'adamw'
batch_size: 1
iters: 1200
val_batches: 10
learning_rate: 1.0e-5
steps_per_report: 10
steps_per_eval: 100
save_every: 100
adapter_path: 'adapters/qwen35-forge-v1'
max_seq_length: 2048
mask_prompt: true
grad_checkpoint: true
num_layers: 12
lora_parameters:
  rank: 8
  scale: 20.0
  dropout: 0.05
```

```bash
python -m mlx_lm.lora -c configs/qwen35-forge-lora.yaml
```

Operating rules for 16 GB:

- Begin at `max_seq_length: 1024`, `num_layers: 8`, rank 8. Raise one value at a time.
- Keep `batch_size: 1`. Gradient accumulation is not worth the memory risk locally.
- Watch memory in Activity Monitor; leave at least 2-3 GB for macOS. If the machine swaps, stop and shorten sequences.
- Expect roughly 1-3 iterations/second at 1-2k context on this GPU. A 1,200-iteration run is typically 15-45 minutes; a full 3-epoch run over 2,000 examples is several hours.
- Keep checkpoints. LoRA training can look fine on loss and still regress behavior.

Smoke-test the adapter before evaluating the full suite:

```bash
python -m mlx_lm.generate \
  --model models/qwen3.5-4b-4bit \
  --adapter-path adapters/qwen35-forge-v1 \
  --prompt "List the files you would read to understand this repository." \
  --max-tokens 300
```

## 5. Phase 3 - cloud full SFT (optional, for maximum quality)

Use this when local QLoRA is blocked by architecture support or when you want the strongest result. Rent one A100 80 GB or H100 80 GB for a few hours.

Recommended stack: Hugging Face Transformers + TRL `SFTTrainer` with PEFT for LoRA, or Axolotl/LLaMA-Factory with DeepSpeed ZeRO-3 for full SFT. Use bf16, FlashAttention if available, gradient checkpointing and sequence packing.

Sketch of a full-SFT configuration (validate field names against the trainer version you install):

```yaml
base_model: Qwen/Qwen3.5-4B
bf16: true
micro_batch_size: 1
gradient_accumulation_steps: 16
num_epochs: 2
learning_rate: 1.0e-5
sequence_len: 4096
deepspeed: zero3.json
warmup_ratio: 0.03
```

```json
{
  "zero_optimization": { "stage": 3, "offload_optimizer": { "device": "none" } },
  "bf16": { "enabled": true },
  "gradient_clipping": 1.0,
  "train_micro_batch_size_per_gpu": 1
}
```

Rules:

- 80 GB fits 4B full SFT with ZeRO-3 and checkpointing; 40 GB is tight, 24 GB is not viable for full SFT.
- 2 epochs is usually enough; more overfits a small dataset.
- Mix general replay data into every batch.
- Save the merged fp16/bf16 model, not just the adapter, before converting to GGUF.
- Cost: roughly $1.5-3/hour for an H100 80 GB and $1-2/hour for an A100 80 GB. A 4-10 hour run is about $6-30 plus storage. Spot instances reduce this but can be interrupted.

Do not rent a GPU until the dataset and evaluation harness exist. The expensive part is data quality, not compute.

## 6. Phase 4 - evaluation gates

Run these before and after training with identical prompts and settings. An adapter ships only if every gate passes.

| Gate                    | Target                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| Tool-call JSON validity | at least 99.5% of calls parse and match the schema                |
| Task pass rate          | at least +10 percentage points over baseline on the 40-task set   |
| Diff applicability      | no regression; accepted diffs apply cleanly                       |
| General regression      | at most 2 points lower on the 100-prompt suite                    |
| Safety                  | no increase in unapproved shell/file actions                      |
| Latency                 | no worse than baseline by more than 15% on this Mac               |
| Vision/thinking         | existing capabilities still work if the model keeps its projector |

Also inspect 20 outputs manually. Loss is not a quality metric for agent behavior.

## 7. Phase 5 - package into Ollama and ForgeAI

### Preferred: keep the base model and apply a LoRA adapter

This preserves the vision projector, template and parser from `qwen3.5:4b`.

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DGGML_METAL=ON
cmake --build build -j
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Check the flags exposed by your llama.cpp revision first.
python convert_lora_to_gguf.py ../adapters/qwen35-forge-v1 \
  --outfile ../models/forge-qwen35-lora.gguf --outtype f16
```

`Modelfile.forge`:

```dockerfile
FROM qwen3.5:4b
ADAPTER ./models/forge-qwen35-lora.gguf
PARAMETER temperature 0.2
PARAMETER top_p 0.9
PARAMETER num_ctx 8192
```

```bash
ollama create forgeai-qwen3.5-4b-lora -f Modelfile.forge
ollama run forgeai-qwen3.5-4b-lora "Read src/main.ts and summarize it."
```

Test tool calls through the API, not just chat: send a request with the ForgeAI tool schemas and confirm the response contains valid `tool_calls`.

### Alternative: merge, convert and quantize

```bash
# Fuse the adapter into the MLX model, de-quantized for conversion.
python -m mlx_lm.fuse \
  --model models/qwen3.5-4b-4bit \
  --adapter-path adapters/qwen35-forge-v1 \
  --save-path models/qwen35-forge-f16 --de-quantize

# Convert Hugging Face -> GGUF -> Q4_K_M.
python llama.cpp/convert_hf_to_gguf.py models/qwen35-forge-f16 \
  --outfile models/qwen35-forge-f16.gguf --outtype f16
llama.cpp/build/bin/llama-quantize \
  models/qwen35-forge-f16.gguf models/qwen35-forge-q4_k_m.gguf Q4_K_M
```

A merged text GGUF does not include the vision projector. If vision must remain, either keep the adapter route or also convert/preserve the `mmproj` file and include it as a second `FROM` in the Modelfile.

### Wire it into the app

- Keep `qwen3.5:4b` installed as the fallback.
- Add the tuned model as `forgeai-qwen3.5-4b-lora` and test it through the model picker first.
- To make it the default, change `DEFAULT_OLLAMA_MODEL` in `packages/shared/src/defaults.ts` and update the "one resident model" copy in `ModelsModal.tsx`. The Ollama service already keeps one completion model resident; it will keep the new one resident instead.
- If the tuned model is distributed to other machines, either ship the adapter/GGUF and create the Ollama model on first run, or keep the base default and expose the tuned model as an option. A locally created model is not present on a fresh install.
- Preserve the base fallback and the ability to switch back without rebuilding the app.

## 8. Rollback and operations

- Tag every dataset, config, adapter and GGUF file with the same version (for example `v1`).
- Keep the previous adapter and the base model until the new one passes the full gate.
- Record the model digest shown by `ollama show` in the release notes.
- Keep the evaluation report next to the adapter. A model without its eval report is not shippable.
- Retain only opt-in data. Delete raw exports after the adapter is evaluated if they contain user code.

## 9. Timeline and budget

| Stage                                      | Time                   | Cost                |
| ------------------------------------------ | ---------------------- | ------------------- |
| Baseline harness + 40 tasks                | 2-3 days               | $0                  |
| Export, clean and synthesize 1-2k examples | 3-5 days               | $0-20 (teacher API) |
| Local QLoRA smoke run + iteration          | 2-4 days               | $0                  |
| Evaluation and fixes                       | 2-3 days               | $0                  |
| Optional cloud full SFT                    | 1 day + 4-10 GPU hours | $6-30               |
| Packaging, Ollama integration, release     | 1-2 days               | $0                  |

A realistic first adapter is about two weeks of part-time work. The cloud full SFT is a deliberate second step, not a prerequisite.

## 10. Risks and mitigations

| Risk                                            | Mitigation                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 16 GB is not enough for full fine-tuning        | Use QLoRA locally; reserve full SFT for 80 GB cloud GPUs                                                                 |
| `qwen35` unsupported by MLX training            | Fail fast at conversion; train with HF/PEFT in the cloud and convert with llama.cpp, which already runs the architecture |
| Training data contains secrets or customer code | Opt-in only; redact paths, tokens and env files; keep exports out of git; delete after training                          |
| Tool-call format drifts from Ollama's renderer  | Render training text with the exact Qwen3.5 template; validate calls through `/api/chat` with ForgeAI tool schemas       |
| Catastrophic forgetting                         | Low learning rate, 1-2 epochs, 5-10% general replay, early stopping                                                      |
| Vision or thinking regression                   | Keep the projector; train text-only adapters; include vision/thinking checks in the gate                                 |
| Adapter does not load in Ollama                 | Test `ADAPTER` early; fall back to merged GGUF + Q4_K_M                                                                  |
| Overfitting a tiny dataset                      | Require 500+ clean examples; hold out 10%; review synthetic data                                                         |

## 11. What to do next in this repository

1. Add `agent_runs` persistence and an "accepted" flag so trajectories become training data.
2. Add a `training/` directory with `export.py`, `build_dataset.py`, `configs/` and the evaluation harness. Keep it outside the app bundle.
3. Implement the 40-task evaluation set before collecting thousands of examples.
4. Run the MLX conversion gate on this Mac. If it passes, start with 500 curated examples and a 300-iteration smoke run.
5. Only after the adapter beats the baseline, decide whether to change `DEFAULT_OLLAMA_MODEL` or expose the tuned model as an additional choice.

ForgeAI should keep the base model selectable at all times. A tuned model is an upgrade path, never a one-way door.
