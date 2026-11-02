# ForgeAI --- Existing Codebase Audit (Task 01 Deliverable)

> **Date of Audit:** November 2, 2026  
> **Status:** Completed  
> **Test Baseline:** 113/113 passing across 10 test suites (`vitest run`)  
> **Typecheck Baseline:** Clean (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`)  
> **Build Targets Verified:** macOS (`.dmg`, `.zip`), Windows (`.exe` Universal/x64/arm64)

---

## 1. Executive Summary & Monorepo Architecture

ForgeAI is structured as an npm/Yarn monorepo with 1 Electron desktop application and 3 shared internal packages:

```
sopu-agent-ai/
├── apps/
│   └── desktop/               # Electron application (Main, Preload, Renderer)
│       ├── src/main/          # Node.js backend services, IPC routing, SQLite DB, agent runtime
│       ├── src/preload/       # Context isolation bridge with typed IPC wrappers
│       └── src/renderer/      # React 18 frontend, Monaco Editor, Zustand store, Tailwind CSS
├── packages/
│   ├── ai/                    # LLM provider adapters (Ollama, OpenAI-compatible, HTTP streaming)
│   ├── core/                  # AST parsing, code chunking, vector embeddings, retrieval, diff engine
│   └── shared/                # Zod schemas, TypeScript types, recipes, defaults, utilities
├── scripts/                   # Build scripts, training data exporters, model helpers
└── docs/                      # Architecture notes, roadmap, and design documentation
```

### Monorepo Scripts & Build Configuration
* **Package Manager:** Yarn 1.22.22 with workspaces (`packages/*`, `apps/*`).
* **Bundler:** `electron-vite` (`vite` 6.x) for main, preload, and renderer processes.
* **Testing:** Vitest 5.x with in-memory SQLite (`node:sqlite`).
* **Typechecking:** TypeScript 5.8 with split configs: `tsconfig.node.json` (Main + Preload) and `tsconfig.web.json` (Renderer).

---

## 2. Component-by-Component Audit

### 2.1 Electron Process Boundaries & IPC Layer
* **Main Process Boot:** [`apps/desktop/src/main/index.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/index.ts)
  - Security settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (sandbox is false due to `node-pty` terminal requirements).
  - Web preferences strictly enforce partition isolation and disallow unhandled popups.
* **Preload Bridge:** [`apps/desktop/src/preload/index.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/preload/index.ts)
  - Exposes `window.forge` containing namespaces: `workspace`, `git`, `index`, `search`, `chat`, `agent`, `providers`, `settings`, `specs`, `checkpoints`, `terminal`, `browser`, `system`.
* **IPC Routing & Validation:** [`apps/desktop/src/main/ipc.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/ipc.ts)
  - Origin verification via `assertTrusted(event)` verifies `file://` or dev URL.
  - Payloads validated with Zod schemas (`agentRunSchema`, `settingsPatchSchema`, `providerConfigSchema`, `streamChatSchema`, `searchOptionsSchema`) and primitive validators (`str`, `num`, `bool`, `stringList`).
  - Active workspace validation via `requireProject(ctx, projectId)` prevents cross-workspace path traversal.

### 2.2 Permissions Broker & Security Model
* **Source:** [`apps/desktop/src/main/permissions.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/permissions.ts)
* **Mechanisms:**
  - `require(input)` checks policy (`auto`, `manual`, `session`).
  - `input.dangerous === true` always requires explicit user confirmation regardless of session settings.
  - In-memory 5-minute timeout with automatic denial on unresponsiveness.
  - Audit logging to SQLite table `permission_audit`.
  - Session grant reset on project switch or manual clearance.

### 2.3 AI Provider Abstraction & Model Execution
* **Packages:**
  - [`packages/ai/src/ollama.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/ai/src/ollama.ts): Ollama streaming HTTP adapter, tool calling, model pulling, recipe compilation via `createModel`.
  - [`packages/ai/src/openai.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/ai/src/openai.ts): Generic OpenAI-compatible client for LM Studio, vLLM, llama.cpp.
  - [`packages/ai/src/http.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/ai/src/http.ts): Safe fetch wrapper configured with undici `setGlobalDispatcher` (`headersTimeout: 0`, `bodyTimeout: 0`) to prevent cold-load timeouts on Windows/macOS.
* **Provider Management:** [`apps/desktop/src/main/services/providers.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/services/providers.ts)
  - Seeds presets for Ollama, LM Studio, llama.cpp, vLLM, OpenAI, and Custom endpoint.
  - API keys encrypted with Electron `safeStorage` (OS keychain / DPAPI).
  - Automatic `recommendRoles` heuristic to map models to roles.

### 2.4 Agent Runtime, Specialist Roles & Tool Registry
* **Runtime:** [`apps/desktop/src/main/agent/runtime.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/agent/runtime.ts)
  - Tool execution loop with up to 20 steps (configurable per role).
  - Supports streaming thought/reasoning tags (`<thought>`, `<thinking>`).
  - Automatic JSON tool-call envelope parser with fallback for text-embedded JSON (`parseToolEnvelope`).
  - Self-healing retries for syntax/format errors.
* **Tools:** [`apps/desktop/src/main/agent/tools.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/agent/tools.ts)
  - Workspace tools: `read_file`, `write_file`, `patch_file`, `list_directory`, `get_project_overview`, `search_code`, `search_symbols`.
  - Verification tools: `run_terminal_command`, `git_diff`, `git_commit`, `seo_audit`.
  - Spec-driven tools: `spec_plan`, `spec_task_status`.
* **Agent Definitions:** [`apps/desktop/src/main/agent/prompts.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/agent/prompts.ts)
  - Currently defined roles: `coding`, `planner`, `debugging`, `testing`, `review`, `docs`, `seo`.

### 2.5 Codebase Indexing, Vector Store & Retrieval
* **Services:**
  - [`apps/desktop/src/main/services/indexer.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/services/indexer.ts): Parallel scanning (concurrency 4), mtime/size/SHA-1 change detection, incremental indexing.
  - [`packages/core/src/parser.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/core/src/parser.ts): Regex & AST symbol extractor for TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, C++, C#.
  - [`packages/core/src/chunker.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/core/src/chunker.ts): Syntax-aware sliding window chunker preserving symbol headers.
  - [`packages/core/src/vector.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/core/src/vector.ts): Float32Array cosine similarity with in-memory caching.
  - [`packages/core/src/retrieval.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/core/src/retrieval.ts): Reciprocal Rank Fusion (RRF) combining vector similarity (45%), keyword matching (35%), and path overlap (20%).

### 2.6 Persistence & SQLite Database
* **Source:** [`apps/desktop/src/main/db.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/db.ts)
* **Implementation:** Node.js 22 built-in `DatabaseSync` (`node:sqlite`) with `WAL` journal mode and `user_version = 1`.
* **Tables:** `projects`, `settings`, `providers`, `conversations`, `messages`, `files`, `chunks`, `embeddings`, `symbols`, `checkpoints`, `permission_audit`, `usage`, `spec_state`.

### 2.7 Workspace & IDE Integration
* **File Operations:** [`apps/desktop/src/main/services/workspace.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/services/workspace.ts)
  - Path confinement via `isWithinRoot` with Windows UNC prefix stripping (`\\?\`).
  - Real-time watcher using `chokidar` plus immediate file-event broadcast on mutations.
* **Checkpoints:** [`apps/desktop/src/main/services/checkpoints.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/services/checkpoints.ts)
  - Pre-mutation backup and rollback capabilities stored in `.sopuforge/checkpoints`.
* **Terminal:** [`apps/desktop/src/main/services/terminal.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/services/terminal.ts)
  - Powered by native `node-pty` with cross-platform shell defaults.

---

## 3. Verified Working Features

1. **Local-First Model Serving:** Ollama integration, model pulling, running-model detection, and recipe-based custom model compilation (`sopu-coder`, `sopu-coder-fast`).
2. **Context Window Safety & Timeout Immunity:** Global undici dispatcher eliminates premature HTTP header aborts during slow local LLM inference.
3. **Hybrid Code Retrieval:** Combines vector similarity, symbol indexing, and BM25-style keyword search with RRF scoring.
4. **Interactive Monaco Editor:** Syntax highlighting, cursor tracking, diff previewing, and tab switching.
5. **Integrated Terminal:** Persistent pseudo-terminal sessions using `node-pty` with ANSI rendering via `xterm.js`.
6. **Git Status & Branch Switching:** Native simple-git wrapper providing branch listings, diffs, staged/unstaged views.
7. **Cross-Platform Packaging:** Successfully produces signed macOS DMGs and Windows NSIS installers.

---

## 4. Incomplete, Missing, or Divergent Features

| Area | Status | Evidence / Source Path | Roadmap Target |
| :--- | :--- | :--- | :--- |
| **Model Roles** | Incomplete | [`packages/shared/src/types.ts:154`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/packages/shared/src/types.ts#L154): Only 6 roles (`chat`, `plan`, `coding`, `review`, `fast`, `embedding`). | Missing 5 roles: `frontend`, `animation`, `backend`, `seo`, `testing`. |
| **Specialist Agents** | Missing 3 Agents | [`apps/desktop/src/main/agent/prompts.ts:17`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/agent/prompts.ts#L17): Has `coding`, `planner`, `debugging`, `testing`, `review`, `docs`, `seo`. | Missing dedicated `frontend`, `animation`, `backend` agents with role prompts & contracts. |
| **Model Router** | Heuristic only | [`apps/desktop/src/main/services/providers.ts:207`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/services/providers.ts#L207): Simple setting lookup with fallback. | Needs dedicated `ModelRouter` service with capability matching, context budgeting, and fallback logs. |
| **Project Memory** | Incomplete | No dedicated project memory table in SQLite; relies on `AGENTS.md` and conversation history. | Needs `docs/PROJECT_MEMORY.md`, SQLite schema for decisions/conventions, and UI management. |
| **Multi-Agent Orchestrator** | Single-agent loop | [`apps/desktop/src/main/agent/runtime.ts:88`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/agent/runtime.ts#L88): Executes a single agent run; no inter-agent handoff pipeline. | Needs structured workflow: `Planner → Specialist → Testing → Review → Report`. |
| **File Tree Refresh Animation** | Incomplete | [`apps/desktop/src/renderer/src/components/sidebar/Explorer.tsx:501`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/renderer/src/components/sidebar/Explorer.tsx#L501): No loading state or animated spin on click. | Visual feedback and multi-directory concurrent re-fetch on refresh button. |
| **Linter Warnings** | 6 issues | ESLint reported 5 unused variables/immutability errors and 1 hook dependency warning. | Clean up lint errors across `workspace.ts`, `ModelsModal.tsx`, `AgentRunCard.tsx`, `retrieval.ts`. |

---

## 5. Security, Performance & Maintainability Findings

### Security Findings
* **[High] Shell Environment Sanitization:** [`apps/desktop/src/main/services/terminal.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/services/terminal.ts) passes `process.env` directly to child processes. Secrets in ambient environment could leak into terminal logs.
* **[Medium] Permission Bypass Guard:** [`apps/desktop/src/main/permissions.ts`](file:///Users/saif-dc/Saif%20/sopu-agent-ai/apps/desktop/src/main/permissions.ts) allows session approvals for write actions, but dangerous commands (`rm -rf`, `git reset --hard`) are correctly enforced as always requiring approval.
* **[Low] Path Confinement:** Windows UNC prefix bug previously caused path validation escapes; resolved with `stripPrefix` in `workspace.ts`.

### Performance Findings
* **[High] Simultaneous Model Memory:** If multiple providers or roles load different 7B/14B models on unified memory systems (e.g., 16GB M1 Mac), system OOM can occur. Need resource constraints in ModelRouter.
* **[Medium] In-Memory Vector Store:** For projects with >10,000 chunks, in-memory array search could become a CPU bottleneck; requires chunk pagination.

### Maintainability Findings
* **[Medium] Dual Role Types:** `AgentKind` and `ModelRole` are closely related but separate enums with manual mapping dictionaries (`ROLE_FOR_AGENT`). Synchronizing them across shared packages prevents drift.

---

## 6. Test Coverage Analysis

* **Current Status:** 113 unit and integration tests passing.
* **Coverage Strengths:**
  - Code chunker (`chunker.test.ts` - 13 tests)
  - AST symbol parsing (`parser.test.ts` - 13 tests)
  - Vector cosine similarity (`vector.test.ts` - 15 tests)
  - Hybrid retrieval ranking (`retrieval.test.ts` - 18 tests)
  - Diff generation & patching (`diff.test.ts` - 9 tests)
  - Agent envelope parsing (`envelope.test.ts` - 12 tests)
  - Agent recovery loops (`agent-recovery.test.ts` - 10 tests)
  - SEO audit heuristics (`seo.test.ts` - 2 tests)
* **Coverage Gaps:**
  - Multi-agent task handoff contracts (Task 05)
  - ModelRouter capability filtering & fallback rules (Task 04)
  - Project memory persistence & retrieval (Task 06)
  - Electron IPC roundtrip tests in headless mode (Task 10)

---

## 7. Prioritized Implementation Recommendations

1. **Immediate (Task 02):** Expand `ModelRole` to cover all 10 roles (`frontend`, `animation`, `backend`, `seo`, `testing`, etc.), improve provider model discovery, and fix the 6 ESLint errors.
2. **Short-Term (Task 03 - 04):** Enhance incremental indexing, add `.gitignore` hot-reloading on workspace refresh, and implement the intelligent `ModelRouter`.
3. **Mid-Term (Task 05 - 07):** Build the multi-agent orchestrator with explicit handoff contracts between Planner, Frontend, Animation, Backend, and Review agents, and add persistent project memory.
4. **Final (Task 08 - 10):** Benchmark memory under 16GB limits, conduct security hardening, and generate formal release checklists.
