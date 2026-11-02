# ForgeAI — System Architecture

> A local-first AI software development environment.
> Product name: **ForgeAI** · package: `@forgeai/*` · repo: `sopu-agent-ai`

ForgeAI is an Electron desktop IDE optimized for **locally hosted models** (Ollama first). It runs
entirely offline for core functionality and never requires a cloud API key. Cloud providers are
strictly opt-in.

---

## 1. Design principles

1. **Local-first, offline-capable.** Every core workflow (editing, search, Git, terminal, indexing,
   chat, agent, specs) works with no internet. Model calls go to `localhost` by default.
2. **Least privilege.** The renderer is sandboxed with `contextIsolation` and no Node access. All
   privileged operations are typed IPC commands validated in the main process. The model never gets
   raw Node execution; it can only call a curated, schema-validated tool registry.
3. **Human in the loop.** Any write outside an approved checkpoints scope, deletes, shell commands,
   dependency installs, commits and network calls require explicit approval. Every mutation is
   previewable as a diff and reversible.
4. **Bounded context.** Projects are indexed and retrieved, never dumped into the prompt. The prompt
   assembler enforces a token budget and always includes project rules.
5. **Modular core.** Providers, tools, parsers, retrieval, specs and Git are behind interfaces so they
   can be tested headlessly and swapped without touching the UI.

---

## 2. Process architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Renderer (Chromium, sandboxed)                                              │
│ React 19 · Vite · Tailwind 4 · Zustand · React Query · Monaco · xterm.js    │
│   UI shell ─ Editor ─ Chat ─ Agents ─ Specs ─ Models ─ Settings             │
│   window.forgeai  (typed, promise-based preload bridge)                     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ IPC (invoke/handle + validated events)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ Preload (isolated world)                                                    │
│   contextBridge.exposeInMainWorld('forgeai', api)                           │
│   No nodeIntegration. No remote. Explicit allow-listed channels only.       │
└───────────────────────────────┬─────────────────────────────────────────────┘
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ Main process (Node 22+/24, Electron)                                        │
│                                                                             │
│  IPC router ── zod validation ── permission broker                          │
│     ├── WorkspaceService   (fs, watch, file ops, guard)                     │
│     ├── Database            (SQLite, node:sqlite, WAL)                      │
│     ├── SearchService       (ripgrep + JS fallback, .gitignore aware)       │
│     ├── IndexService        (scan → chunk → symbols → embed → vector store) │
│     ├── GitService          (git CLI porcelain parsing)                     │
│     ├── TerminalService     (node-pty, fallback pipes; per-workspace)       │
│     ├── RulesService        (AGENTS.md, .cursorrules, CLAUDE.md, …)         │
│     ├── SpecService         (.kiro/specs/{feature}/*.md)                    │
│     ├── CheckpointService   (file snapshots + restore)                      │
│     ├── ProviderRegistry    (Ollama, LM Studio, llama.cpp, vLLM, OpenAI…)   │
│     ├── ChatService         (streaming, cancellation, token stats)          │
│     └── AgentRuntime        (planner→tool loop→review, specialized agents)  │
└─────────────────────────────────────────────────────────────────────────────┘
        │ localhost HTTP                         │ child processes
        ▼                                        ▼
  Ollama / LM Studio /                      rg, git, node-pty shell,
  llama.cpp / vLLM / cloud                 language tools, test runners
```

The renderer is a **pure view layer**. All state that must survive restarts lives in SQLite or the
filesystem; UI stores are caches.

---

## 3. Monorepo layout

```
sopu-agent-ai/
├── apps/
│   └── desktop/
│       ├── electron.vite.config.ts       # main/preload/renderer build pipeline
│       ├── electron-builder.yml          # macOS dmg/zip + Windows nsis/portable
│       ├── src/main/                     # Electron main process (Node)
│       │   ├── index.ts                  # app lifecycle, window, protocol
│       │   ├── ipc.ts                    # channel router + validation
│       │   ├── permissions.ts            # approval broker
│       │   ├── services/                 # workspace, db, search, index, git, …
│       │   ├── providers/                # provider adapters + registry
│       │   ├── agent/                    # agent runtime, tools, prompts
│       │   └── specs/                    # spec pipeline
│       ├── src/preload/index.ts          # typed bridge
│       └── src/renderer/
│           ├── src/components/           # shell, editor, chat, panels, dialogs
│           ├── src/stores/               # Zustand slices
│           ├── src/lib/                  # api client, utils, themes
│           └── src/styles/               # Tailwind + design tokens
├── packages/
│   ├── shared/                           # types, IPC contract, zod schemas, token budget
│   ├── ai/                               # provider clients, streaming, tool-call parsing
│   └── core/                             # indexer, retrieval, symbols, specs, rules, diff
├── docs/ARCHITECTURE.md
├── eslint.config.js · .prettierrc · tsconfig.base.json
└── package.json (Yarn workspaces)
```

Workspace packages are **source-only** and consumed through Vite aliases (`@forgeai/shared`, etc.).
This keeps the main bundle tree-shaken, gives instant HMR, and avoids a build-order step. Native
modules (`node-pty`) are externalized.

---

## 4. Data model (SQLite)

File: `<userData>/forgeai.db`, WAL mode, schema versioned with `PRAGMA user_version`.

```sql
-- Project registry and preferences
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,          -- stable hash of root path
  name          TEXT NOT NULL,
  root          TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  index_status  TEXT NOT NULL DEFAULT 'idle', -- idle|scanning|embedding|ready|error
  index_error   TEXT,
  stack         TEXT                       -- detected stack JSON
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                      -- JSON
);

CREATE TABLE providers (
  id         TEXT PRIMARY KEY,             -- 'ollama', 'lmstudio', custom uuid
  kind       TEXT NOT NULL,                -- ProviderKind
  name       TEXT NOT NULL,
  base_url   TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  api_key_ref TEXT,                        -- never stored in plaintext here
  config     TEXT NOT NULL DEFAULT '{}'    -- JSON: headers, timeouts, models
);

-- Conversations
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  title       TEXT NOT NULL,
  mode        TEXT NOT NULL,               -- chat|plan|agent|spec|review
  model       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,           -- system|user|assistant|tool
  content         TEXT NOT NULL,
  reasoning       TEXT,
  tool_calls      TEXT,                    -- JSON
  tool_call_id    TEXT,
  model           TEXT,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  duration_ms     INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Code index
CREATE TABLE files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,
  path         TEXT NOT NULL,              -- POSIX relative path
  language     TEXT,
  size         INTEGER NOT NULL,
  mtime        INTEGER NOT NULL,
  hash         TEXT NOT NULL,
  content      TEXT,                       -- capped (<= 256 KB) for retrieval
  indexed_at   INTEGER NOT NULL,
  UNIQUE(project_id, path)
);
CREATE INDEX idx_files_project ON files(project_id);

CREATE TABLE chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  symbols     TEXT NOT NULL DEFAULT '[]'    -- JSON symbol names in chunk
);
CREATE INDEX idx_chunks_project ON chunks(project_id);

CREATE TABLE embeddings (
  chunk_id   INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vector     BLOB NOT NULL                 -- Float32Array little-endian
);

CREATE TABLE symbols (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,                -- function|class|method|interface|…
  line       INTEGER NOT NULL,
  container  TEXT
);
CREATE INDEX idx_symbols_project_name ON symbols(project_id, name);

-- Safety and history
CREATE TABLE checkpoints (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- agent|manual|spec|rollback
  created_at  INTEGER NOT NULL,
  files       TEXT NOT NULL                -- JSON [{path, existed, blob?}]
);

CREATE TABLE permission_audit (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  tool        TEXT NOT NULL,
  request     TEXT NOT NULL,               -- JSON
  decision    TEXT NOT NULL,               -- approved|denied|expired
  created_at  INTEGER NOT NULL
);

CREATE TABLE usage (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,
  model         TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE model_prefs (
  role  TEXT PRIMARY KEY,                  -- chat|plan|coding|review|fast|embedding
  model TEXT NOT NULL,
  provider_id TEXT NOT NULL
);
```

Vector search: cosine similarity over `Float32Array` blobs loaded per project and cached in memory
(dimension-normalized on write). The abstraction `VectorStore` allows swapping in an ANN index
(e.g. sqlite-vec) without changing retrieval code.

---

## 5. AI provider architecture

```ts
interface AIProvider {
  readonly kind: ProviderKind;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta>;
  embed(request: EmbedRequest, signal: AbortSignal): Promise<EmbedResponse>;
  health(): Promise<ProviderHealth>;
  pull?(model: string, signal: AbortSignal): AsyncIterable<PullProgress>;
  deleteModel?(model: string): Promise<void>;
  running?(): Promise<RunningModel[]>;
}
```

Adapters:

| Kind                   | Transport                                                                    | Notes                                                    |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ollama`               | `POST /api/chat` (NDJSON), `/api/tags`, `/api/pull`, `/api/embed`, `/api/ps` | tools, thinking (`think`), context `num_ctx`, keep_alive |
| `lmstudio`             | OpenAI-compatible `/v1`                                                      | model listing, streaming SSE                             |
| `llamacpp`             | OpenAI-compatible `/v1`                                                      | user-supplied port                                       |
| `vllm`                 | OpenAI-compatible `/v1`                                                      | tool calling depends on model                            |
| `openai`, `openrouter` | OpenAI-compatible `/v1`                                                      | opt-in, key stored in OS keychain                        |
| `custom`               | OpenAI-compatible `/v1`                                                      | base URL + headers                                       |

Capabilities are **derived, not assumed**: tool support is inferred from the server response (Ollama
model `capabilities` when available) and a curated family list, with a runtime fallback that parses
JSON tool envelopes when native tool calling fails. Streaming uses `fetch` + `ReadableStream` with
`AbortController`; deltas are forwarded to the renderer over a single `ai:stream` event channel keyed
by request id (throttled to animation frames upstream).

Model roles (chat, plan, coding, review, fast completion, embeddings) are stored in `model_prefs` and
used by the agent/spec/completion services. Embeddings default to `nomic-embed-text` if installed.

---

## 6. Agent tool architecture

The agent is a bounded **observe → think → act** loop in the main process.

```
AgentRuntime.run(task)
  ├─ ContextBuilder   (rules + tree + retrieval + conversation budget)
  ├─ Model.chat(tools) ──► tool_calls[]
  ├─ ToolRegistry.execute(call)
  │    ├─ zod-validate args
  │    ├─ PermissionBroker.require()  ──► renderer dialog ──► approve/deny
  │    ├─ run tool (pure services)
  │    └─ truncate observation to budget
  ├─ append observation, repeat (maxSteps, abortable)
  └─ FinalReport (summary, files changed, commands, diff)
```

Tools (each with strict input schema, approval level and dry-run preview):

`read_file`, `list_files`, `search_code`, `get_project_overview`, `read_symbol`, `write_file`,
`replace_in_file`, `apply_patch`, `delete_file`, `run_command`, `run_tests`, `git_status`, `git_diff`,
`git_commit`, `install_dependencies`, `create_checkpoint`, `rollback_checkpoint`, `update_task`,
`fetch_url`.

Approval policy levels: `always` (chat can read), `once` (write/command: per call), `session`
(remember for the workspace session), `never`.

Agents are prompt + tool-subset + model-role presets: **Planner**, **Coding**, **Debugging**,
**Testing**, **Review**, **Docs**. They share `ProjectContext` and the tool registry.

Safety invariants: path resolution is confined to the workspace root (realpath + prefix check, no
symlink escapes); binary/large files are refused; secrets patterns are never indexed; `.env` is
readable only on explicit user request, not by the agent; shell commands run with a sanitized env and
are shown verbatim before approval.

---

## 7. Spec-driven development (Kiro-style)

```
.kiro/specs/<feature>/
  requirements.md   # user stories, numbered acceptance criteria, open questions
  design.md         # architecture, data flow, interfaces, risks, dependencies
  tasks.md          # checkbox tasks with deps, file hints, acceptance checks
  spec.json         # machine state: phase, approvals, task statuses
```

Pipeline: `requirements → (user edit/approve) → design → (approve) → tasks → per-task approval →
implementation`. Each generation runs through the provider with the previous artifacts plus retrieved
codebase context. Task execution delegates to the agent with a checkpoint first; on success the
checkbox and `spec.json` are updated; failures produce an implementation report and never silently
retry destructive actions.

---

## 8. Indexing & retrieval

```
scan (fast-glob + ignore) → filter (size/binary/gitignore) → hash & skip unchanged
  → parse symbols (regex/TS-aware extractor behind Parser interface)
  → chunk (line windows with overlap, symbol boundaries)
  → embed (batched, abortable, resumable) → store Float32Array
```

Retrieval blends: vector similarity (when embeddings exist), symbol matches, ripgrep hits, and
recently-edited files. Results are deduped and packed into the context budget with head/tail
truncation. Incremental: unchanged hashes skip parse+embed; deleted files cascade.

Background job state is persisted (`index_status`, progress events) so the UI survives reloads.

---

## 9. Security model

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- No `shell.openExternal` for arbitrary model-provided URLs without approval (http/https only).
- IPC: every handler validates input with zod; errors are normalized (no stack traces with paths to
  the renderer unless dev).
- Filesystem: all paths resolved inside the active workspace, with explicit exceptions for the global
  rules store and app data. `.git` internals are read-only.
- Command execution: explicit approval, command preview, cwd restricted to workspace, denylist for
  catastrophic patterns (`rm -rf /`, disk formatting, keychain access) that always require a second
  confirmation.
- API keys use Electron `safeStorage` (OS keychain) and are never returned to the renderer.
- Permission decisions are audited.

---

## 10. Roadmap

| Phase | Scope                                         | Acceptance criteria                                             | Status                                  |
| ----- | --------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| 0     | Architecture, monorepo, toolchain, docs       | `yarn install && yarn typecheck && yarn test` green             | done                                    |
| 1     | Electron shell, IPC, DB, workspace FS         | App launches, opens folder, persists projects                   | done                                    |
| 2     | UI shell + Monaco + tabs + command palette    | Edit/save real files, dirty state, shortcuts                    | done                                    |
| 3     | Ollama + streaming chat + model manager       | Auto-detect models, stream tokens, pull with progress, tokens/s | done                                    |
| 4     | Safe file tools + diff approval + checkpoints | Agent edits are previewed, hunk-accepted, revertible            | done                                    |
| 5     | Agent runtime + specialized agents            | Multi-step tool loop with approvals and final report            | done                                    |
| 6     | Spec-driven workflow                          | 4 phases authored to `.kiro/specs`, task execution              | done                                    |
| 7     | Indexing + retrieval                          | Incremental index, symbol search, vector retrieval              | done                                    |
| 8     | Git + terminal + diagnostics                  | Status/diff/branch/commit, PTY terminal, problems panel         | done                                    |
| 9     | Polish: completion, rules, themes, onboarding | Inline completion, project rules applied, light/dark            | done                                    |
| 10    | Packaging                                     | macOS dmg/zip (arm64+x64), Windows nsis/portable configs        | build configured; macOS installer built |

---

## 11. Known boundaries

- **Tree-sitter** is integrated through a `CodeParser` interface with an optional runtime adapter;
  the shipped default is a fast heuristic extractor (no native ABI to rebuild). Grammars can be added
  without touching callers.
- **LSP** support is scoped to a client bridge + diagnostics/formatting via workspace tools in this
  release; full language-server marketplace installs are out of scope.
- **Debugging** uses launch configurations and process attach through the terminal runner rather than
  a DAP client in v1.
- Windows installers are produced on Windows CI (electron-builder cannot cross-compile NSIS from
  macOS without Wine).
