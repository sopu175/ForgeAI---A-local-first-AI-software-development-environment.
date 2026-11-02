# ForgeAI Known Limitations & Operational Boundaries

## 1. Local AI & Model Hardware Realities

1. **Hardware Dependent Inference**:
   - Inferencing speed and context length are bound to the host computer's RAM, VRAM, and GPU architecture.
   - On 8 GB to 16 GB machines, models larger than 7B (such as 14B or 32B models) may trigger swap memory or fail to load. ForgeAI recommends 4B to 7B quantized models (`qwen3.5:4b`, `sopu-coder:7b`) for responsive local execution.
2. **Local Fine-Tuning vs RAG / Memory**:
   - ForgeAI persistent memory stores conventions and architectural decisions in SQLite for prompt retrieval; it does not perform real-time backpropagation or weight fine-tuning on local LLM checkpoints during coding sessions.
   - Model parameter fine-tuning is an offline batch procedure using LoRA scripts (`scripts/train-lora.py`) requiring dedicated GPU infrastructure.

---

## 2. Tool Calling & Model Compatibility

1. **Small Model Tool Reliability**:
   - Small quantized local models (< 3B parameters) may occasionally fail to format valid tool-call JSON envelopes or hallucinate nonexistent arguments.
   - ForgeAI mitigates this with deterministic schema validation and single-turn JSON recovery, but models with native tool support (`model.capabilities.tools`) are recommended for autonomous coding workflows.
2. **Context Window Ceilings**:
   - While Ollama supports large context lengths, local RAM limits effective context to 8,192 or 16,384 tokens. ForgeAI packs a maximum of 8 retrieved chunks per prompt to prevent context degradation and latency spikes.

---

## 3. Platform & Filesystem Nuances

1. **Windows Pathing**:
   - Windows filesystems use backslashes (`\`) and case-insensitive paths. All internal services normalize paths to POSIX slashes (`/`), but native shell commands executed in `cmd.exe` or `powershell.exe` reflect Windows path conventions.
   - Cold starts for large local models on Windows can trigger socket timeouts; ForgeAI configures undici `headersTimeout: 60000` to mitigate this.
2. **Symlinks & Virtual Filesystems**:
   - Symlinks pointing outside the project root are rejected by `resolveSafe` to prevent directory traversal and arbitrary file reads.
   - Special filesystems (such as network shares or read-only mounts) may restrict SQLite database sync locks.

---

## 4. Visual & Animation Verification

1. **Headless Limitations**:
   - The Animation Agent produces robust code for GSAP, ScrollTrigger, Framer Motion, and CSS transitions with accessibility fallbacks (`prefers-reduced-motion`).
   - However, agents cannot visually "inspect" pixels on screen without an active browser preview or visual test suite. Claims of visual correctness must be verified by the developer via the integrated preview.

---

## 5. Security & Human Approval

1. **No Autonomous Destructive Execution**:
   - ForgeAI will never automatically execute destructive shell commands (`rm -rf`, format commands, hard git resets) without explicit approval through the `PermissionBroker`.
   - Human developer oversight remains the ultimate security gate.
