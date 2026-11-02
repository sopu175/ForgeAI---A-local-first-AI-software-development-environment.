# ForgeAI --- Model & Provider Management (Task 02 Deliverable)

> **Document Version:** 1.0.0  
> **Target Release:** ForgeAI 0.1.0+  
> **Status:** Implemented & Verified

---

## 1. Architectural Overview

ForgeAI separates model execution, provider connections, and agent orchestration into distinct, provider-independent layers:

```
┌────────────────────────────────────────────────────────┐
│                   Agent Runtime / UI                   │
│      (Chat, Planner, Frontend, Animation, Backend,     │
│       SEO, Testing, Review, Fast, Embedding)           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│              ProvidersService & ModelRouter            │
│    (Role Resolution, Capability Matching, Fallbacks)  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                 AIProvider Abstraction                 │
│         (@forgeai/ai: OllamaProvider, OpenAIClient)    │
└──────────────┬──────────────────────────┬──────────────┘
               ▼                          ▼
     ┌──────────────────┐       ┌──────────────────┐
     │  Local Ollama    │       │ OpenAI / LMStudio│
     │  127.0.0.1:11434 │       │ vLLM / llama.cpp │
     └──────────────────┘       └──────────────────┘
```

The model management system ensures:
1. **Local-First Independence:** All primary capabilities work without internet access using local Ollama models.
2. **Pluggable Providers:** Standardized provider interface (`AIProvider`) supports Ollama, LM Studio, vLLM, llama.cpp, OpenAI, and custom OpenAI-compatible endpoints.
3. **Granular Specialization:** 10 discrete model roles allow fine-tuning assignments per agent without hardcoding model weights.

---

## 2. Supported Providers

| Provider | Default Base URL | Connection Protocol | Tool Calling | Embeddings | Model Pull / Create |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Ollama** *(Primary)* | `http://127.0.0.1:11434` (Windows) / `http://localhost:11434` (macOS/Linux) | Native Ollama REST API (`/api/chat`, `/api/tags`, `/api/pull`, `/api/create`) | Supported via structured tools & envelope fallback | Supported (`/api/embeddings`) | Native pull & Modelfile creation |
| **LM Studio** | `http://127.0.0.1:1234/v1` | OpenAI v1 Chat Completions | Supported via OpenAI tools | Provider dependent | External (via LM Studio app) |
| **llama.cpp server** | `http://127.0.0.1:8080/v1` | OpenAI v1 Chat Completions | Supported via OpenAI tools | Supported | Managed via llama-server CLI |
| **vLLM** | `http://127.0.0.1:8000/v1` | OpenAI v1 Chat Completions | Supported | Supported | Managed via vLLM CLI |
| **OpenAI / Custom** | User configured | OpenAI v1 Chat Completions | Supported | Supported | API-based |

---

## 3. The 10 Configurable Model Roles

ForgeAI defines 10 specialized roles. Multiple roles may be bound to a single versatile model (e.g., `sopu-coder`), or distributed across specialized models on high-memory systems:

| Role Identifier | Role Label | Description | Recommended Default |
| :--- | :--- | :--- | :--- |
| `chat` | **General Chat** | Conversational answers, explanations, architecture questions. | `sopu-coder` / `qwen3.5:4b` |
| `plan` | **Planning & Specs** | Requirements drafting, design documents, ordered task breakdowns. | `deepseek-r1:14b` / `sopu-coder` |
| `coding` | **General Coding** | Autonomous multi-file edits, refactoring, and tool calling. | `sopu-coder` (`qwen2.5-coder:7b`) |
| `frontend` | **Frontend Engineering** | React, Next.js, UI component development, Tailwind styling, a11y. | `sopu-coder` |
| `animation` | **Motion & Animation** | GSAP, ScrollTrigger, Three.js, Framer Motion, interactive canvas. | `sopu-coder` |
| `backend` | **Backend & APIs** | Server-side logic, API endpoints, auth, and database schemas. | `sopu-coder` |
| `seo` | **Technical SEO** | Crawlability, metadata, Open Graph, structured data, canonicals. | `sopu-coder` |
| `testing` | **Testing & QA** | Test suite generation, test execution, deterministic assertions. | `sopu-coder` |
| `review` | **Code Review** | Diffs inspection, security checks, edge case analysis, critique. | `deepseek-r1:14b` / `sopu-coder` |
| `fast` | **Fast Completions** | Low-latency inline suggestions, commit messages, quick helpers. | `sopu-coder-fast` (`qwen3.5:4b`) |
| `embedding` | **Codebase Embeddings** | Vector generation for semantic retrieval and hybrid search. | `nomic-embed-text` |

---

## 4. Automatic Role Recommendation Engine

When ForgeAI boots or new models are installed, `recommendRoles(models)` analyzes model capabilities, parameters, and metadata:

```typescript
export function recommendRoles(models: ModelInfo[]): Partial<Record<ModelRole, RoleBinding>>
```

* **Codex Heuristic:** Prioritizes `sopu-coder`, then `qwen2.5-coder:7b`, then `qwen2.5-coder:14b`. Assigns `coding`, `chat`, `frontend`, `animation`, `backend`, `seo`, and `testing`.
* **Reasoning Heuristic:** Prioritizes `deepseek-r1` variants for `plan` and `review`.
* **Latency Heuristic:** Prioritizes lightweight models (`sopu-coder-fast`, `qwen3.5:4b`) for `fast`.
* **Vector Heuristic:** Automatically detects models with `capabilities.embedding` for `embedding`.

---

## 5. Model Compilation & Recipes

ForgeAI packages pre-tuned Modelfiles for local optimization:

### `sopu-coder`
* **Base:** `qwen2.5-coder:7b`
* **Context:** `num_ctx 8192` (8K context window)
* **Prediction Window:** `num_predict 4096`
* **Sampling:** `temperature 0.2`, `top_p 0.9`, `repeat_penalty 1.05`
* **System Prompt:** Full-stack software engineering instructions covering TypeScript, React, Next.js, Node.js, PHP/Laravel, and Python.

### `sopu-coder-fast`
* **Base:** `qwen3.5:4b`
* **Context:** `num_ctx 4096`
* **Sampling:** `temperature 0.1` for low-latency completions.

---

## 6. Resilience, Timeouts & Error Recovery

1. **Headers Timeout Protection:** Node.js `undici` global dispatcher sets `headersTimeout: 0` and `bodyTimeout: 0`. Local models requiring up to 60s for CPU cold-load do not trigger client aborts.
2. **Explicit IPv4 Binding on Windows:** Windows DNS latency on `localhost` dual-stack is bypassed by forcing `127.0.0.1:11434`.
3. **Auto-Healing Settings:** If a bound model is deleted from disk, `resolveRole` gracefully falls back to the next capable model without throwing runtime exceptions.
4. **Offline Operation:** Model catalog listings and existing local models function 100% offline. Network is only requested when explicitly pulling new weights.

