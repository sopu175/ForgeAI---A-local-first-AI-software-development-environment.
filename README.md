# ForgeAI (Sopu AI)

**A local-first AI software development environment.** ForgeAI is a full-featured desktop IDE built on Electron, React, Monaco, and Ollama. It runs entirely on your local machine: no cloud account required, no mandatory API keys, and zero private code leaves your computer. Cloud providers (Claude, OpenAI, Groq, DeepSeek) are fully supported as optional drop-ins.

![ForgeAI running with no project open](docs/screenshot.png)

---

## Key Capabilities at a Glance

- **Autonomous Specialist Agent Team:** Specialized, permission-gated agents for **Planning**, **Frontend**, **Animation**, **Backend**, **SEO**, **Testing**, **Code Review**, and **Docs**.
- **10 Configurable Model Roles:** Assign dedicated local or cloud models to General Chat, Planning, Frontend Coding, Animation, Backend Coding, SEO, Testing, Code Review, Fast Completion, and Embeddings.
- **Persistent Project Memory & Feedback:** Grounded SQLite memory store for project conventions, architectural decisions, and developer corrections that persist across sessions without model fine-tuning confusion.
- **Intelligent Model Router:** Dynamic capability verification (`tools`, `embedding`, `thinking`), user overrides, and deterministic fallback chains.
- **Sopu AI Custom Models:** Pre-configured `sopu-coder` (7B) for deep multi-file agentic engineering and `sopu-coder-fast` (4B) for instant inline completions.
- **Full-Stack Engineering:** Deep specialized support for TypeScript, React, Next.js, Node.js, PHP (Laravel, Yii2, WordPress), and Python.
- **Project Intelligence & RAG:** Incremental AST symbol extraction, semantic chunking, hybrid ranking, and strict secret/credential exclusion (`.env*`, `.pem`, `.key`, `id_rsa*`, `.aws/`, `.ssh/`).
- **Monaco IDE & Developer Ergonomics:** Multi-tab editing, split views, unified hunk-level diff approvals, QuickEdit selection dialogs (`⌘K`), and 1-click "Ask AI to fix" on compiler/linter problems.
- **Animation-First Developer Tools:** Context actions and dedicated specialist agent for GSAP, ScrollTrigger, Framer Motion, and CSS transitions with reduced-motion accessibility safeguards.
- **Zero-Setup Local AI Engine:** Automatically detects, installs, starts, and maintains Ollama with Metal GPU acceleration and optimized keep-alive settings.
- **Cross-Platform Hardening:** Windows IPv4 loopback normalizer (fixing `fetch failed`), case-insensitive path comparisons, subprocess environment sanitization, and cloud metadata SSRF protection.

---

## Table of Contents

1. [Architecture & Roadmap Documentation](#architecture--roadmap-documentation)
2. [System Requirements](#1-system-requirements)
3. [Installation & Quick Start](#2-installation--quick-start)
4. [Step-by-Step App Usage Procedure (A to Z)](#3-step-by-step-app-usage-procedure-a-to-z)
   - [Step 1: Workspace Initialization](#step-1-workspace-initialization)
   - [Step 2: Model Configuration & Role Binding](#step-2-model-configuration--role-binding)
   - [Step 3: Managing Persistent Project Memory](#step-3-managing-persistent-project-memory)
   - [Step 4: Autonomous Specialist Agent Team Execution](#step-4-autonomous-specialist-agent-team-execution)
   - [Step 5: Reviewing & Approving Code Diffs](#step-5-reviewing--approving-code-diffs)
   - [Step 6: In-Editor QuickEdit & Animation Enhancement](#step-6-in-editor-quickedit--animation-enhancement)
   - [Step 7: Diagnostic-Driven Problem Solving](#step-7-diagnostic-driven-problem-solving)
   - [Step 8: Integrated Terminal & Git Operations](#step-8-integrated-terminal--git-operations)
5. [Local AI Bootstrap & Lifecycle](#4-local-ai-bootstrap--lifecycle)
6. [Hardware Optimization & Inference Benchmarks](#5-hardware-optimization--inference-benchmarks)
7. [Custom Model Management & Continuous Fine-Tuning](#6-custom-model-management--continuous-fine-tuning)
8. [Cross-Platform Engineering (macOS & Windows)](#7-cross-platform-engineering-macos--windows)
9. [Packaging & Installer Distribution](#8-packaging--installer-distribution)
10. [Keyboard Shortcuts Reference](#9-keyboard-shortcuts-reference)
11. [Quality Checks & Automated Verification](#10-quality-checks--automated-verification)
12. [Security Model & Boundary Audit](#11-security-model--boundary-audit)
13. [Troubleshooting & FAQ](#12-troubleshooting--faq)

---

## Architecture & Roadmap Documentation

ForgeAI's 10-phase production roadmap is comprehensively documented across dedicated architectural deliverables:

| Document                                                         | Subject & Contents                                                                |
| :--------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **[CODEBASE_AUDIT.md](docs/CODEBASE_AUDIT.md)**                  | Baseline architecture audit, Explorer refresh fix, and ESLint stabilization.      |
| **[MODEL_MANAGEMENT.md](docs/MODEL_MANAGEMENT.md)**              | 10 specialist model roles, capability detection, and provider adapters.           |
| **[PROJECT_INTELLIGENCE.md](docs/PROJECT_INTELLIGENCE.md)**      | AST symbol extraction, incremental watcher, hybrid ranking, and secret exclusion. |
| **[MODEL_ROUTING.md](docs/MODEL_ROUTING.md)**                    | Task-to-role matching, tool capability validation, and deterministic fallbacks.   |
| **[AGENT_ORCHESTRATION.md](docs/AGENT_ORCHESTRATION.md)**        | Specialist agent team, multi-agent handoff contracts, and verification gates.     |
| **[PROJECT_MEMORY.md](docs/PROJECT_MEMORY.md)**                  | SQLite persistent memory schema, workspace isolation, and ContextPanel UI.        |
| **[IDE_WORKFLOWS.md](docs/IDE_WORKFLOWS.md)**                    | Monaco QuickEdit actions, animation tools, and problem repair workflows.          |
| **[LOCAL_PERFORMANCE.md](docs/LOCAL_PERFORMANCE.md)**            | Measured performance benchmarks, keep-alive tuning, and memory bounds.            |
| **[SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)**                  | Subprocess environment scrubbing, SSRF protection, and path confinement.          |
| **[RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)**            | Production release verification protocol and test gate status.                    |
| **[KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)**            | Hardware boundaries, small model caveats, and platform considerations.            |
| **[ROADMAP.md](docs/FORGEAI_10_TASK_IMPLEMENTATION_ROADMAP.md)** | Original 10-phase master implementation roadmap.                                  |

---

## 1. System Requirements

| Requirement          | Specification / Recommended                                                                |
| :------------------- | :----------------------------------------------------------------------------------------- |
| **Node.js**          | **22 or newer** (Node 24 LTS recommended). Requires native `node:sqlite`.                  |
| **Package Manager**  | **Yarn 1.22.x** (classic workspaces).                                                      |
| **Operating System** | **macOS 12+** (Apple Silicon M1/M2/M3/M4 or Intel) or **Windows 10/11** (x64 / arm64).     |
| **Memory (RAM)**     | 8 GB minimum; **16 GB unified RAM recommended** for 7B/4B local models + IDE.              |
| **Disk Space**       | ~3 GB free for dependencies, Electron runtime, and base local weights.                     |
| **Internet Access**  | Required only for the initial package install and model download. 100% offline thereafter. |

Verify your environment before setup:

```bash
node -v   # Must report v22.x or v24.x
yarn -v   # Must report 1.22.x
```

If Yarn is missing:

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
```

---

## 2. Installation & Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/sopu175/ForgeAI---A-local-first-AI-software-development-environment..git
cd ForgeAI---A-local-first-AI-software-development-environment.
```

### 2. Install workspace dependencies

```bash
yarn install
```

This installs all packages and workspaces (`apps/desktop`, `packages/shared`, `packages/ai`, `packages/core`). Workspace packages are consumed directly from source with zero build prerequisites.

### 3. Launch in development mode

```bash
yarn dev
```

`yarn dev` starts Vite with Hot Module Replacement (HMR) for the renderer and automatic reload for the Electron main process.

### 4. Build and preview locally

```bash
yarn build
yarn start
```

---

## 3. Step-by-Step App Usage Procedure (A to Z)

### Step 1: Workspace Initialization

1. Click **Open Folder** on the welcome screen or press `⌘O` (`Ctrl+O` on Windows).
2. Select your repository root.
3. ForgeAI automatically inspects your project stack (languages, frameworks, test runners, git status) and triggers an incremental background index.
4. Open the **Context Panel** (`Context` tab) to inspect detected rules (`AGENTS.md`, `.cursorrules`, etc.) and code chunks.

### Step 2: Model Configuration & Role Binding

1. Click the model pill in the top header or navigate to **Models** (`⌘K ⌘S` → Models).
2. Choose your active primary model:
   - `sopu-coder (Local)` (7B): High-accuracy autonomous coding and refactoring.
   - `sopu-coder-fast (Local)` (4B): Ultra-low-latency completions and quick questions.
   - Or configure optional cloud providers (OpenAI, Claude, Groq, DeepSeek).
3. Under **Model Roles**, inspect or customize which model powers each specialist task (Planning, Frontend, Animation, Backend, SEO, Testing, Review, Fast, Embedding).

### Step 3: Managing Persistent Project Memory

1. In the **Context** tab, scroll to **Project Memory**.
2. Click **+** to save an architectural decision or convention:
   - **Convention:** e.g., _"Always use Tailwind utility classes; do not write custom CSS modules."_
   - **Decision:** e.g., _"Authentication uses signed JWT tokens in HTTP-only cookies."_
3. Persistent memories are saved to SQLite and automatically injected into the agent's system prompt during future turns.
4. Outdated memories can be edited or deleted with 1 click.

### Step 4: Autonomous Specialist Agent Team Execution

1. Open the **Assistant** panel and select **Agent** mode (or press `⌘⇧↵`).
2. Select your specialist agent role:
   - **Planner:** Generates a structured execution roadmap without modifying code.
   - **Frontend:** Builds React/Next.js interfaces, responsive layouts, and UI components.
   - **Animation:** Implements GSAP, ScrollTrigger, Framer Motion, and CSS transitions.
   - **Backend:** Authors API routes, database queries, and server-side validation.
   - **SEO:** Audits metadata, JSON-LD schema, canonicals, and Core Web Vitals.
   - **Testing:** Writes and runs unit and integration tests.
   - **Review:** Performs a read-only audit for security, bugs, and performance.
   - **Docs:** Generates accurate README and technical documentation.
3. Type your instructions and click **Start**. The live **Agent Run Card** displays real-time tool execution, step progress, and elapsed time.

### Step 5: Reviewing & Approving Code Diffs

1. When the agent edits or creates files, changes appear in the **Diffs Panel**.
2. Inspect colorized unified diffs with exact line additions (`+`) and deletions (`-`).
3. Accept or reject changes hunk-by-hunk, or click **Accept All** / **Reject All**.
4. Checkpoints are automatically created before agent mutations, allowing 1-click workspace rollback if needed.

### Step 6: In-Editor QuickEdit & Animation Enhancement

1. In the Monaco editor, select any function or block of code.
2. Press `⌘K` (`Ctrl+K` on Windows) or right-click to open the AI menu:
   - **Explain Selection:** Explains logic, data flow, and edge cases.
   - **Refactor Selection:** Cleans up and modernizes code while preserving equivalence.
   - **Generate Tests:** Produces isolated unit tests matching your framework.
   - **Write Documentation:** Adds typed JSDoc/TSDoc and usage examples.
   - **Animate Selection (GSAP / Motion):** Implements smooth animations with accessibility guards.
3. Review the live replacement and click **Apply replacement** or **Insert at cursor**.

### Step 7: Diagnostic-Driven Problem Solving

1. Open the **Problems** tab in the bottom panel (`⌘⇧M` / `Ctrl+Shift+M`).
2. Notice TypeScript, JavaScript, CSS, or JSON compiler diagnostics.
3. Click the **Sparkles** button on any error row.
4. ForgeAI automatically attaches the source file, opens the Assistant, and prompts the agent to explain and resolve the issue.

### Step 8: Integrated Terminal & Git Operations

1. Toggle the terminal with `` ⌃` `` or `⌘J` (`Ctrl+J` on Windows).
2. Run standard commands (`npm install`, `git status`, `composer update`).
3. The File Explorer and Monaco tabs detect filesystem changes immediately.
4. Git operations update `.git/HEAD` and refresh the **Source Control** sidebar in real time.

---

## 4. Local AI Bootstrap & Lifecycle

ForgeAI manages the local Ollama runtime automatically without requiring external terminal scripts:

1. **Endpoint Probing:** Checks `http://localhost:11434/api/version`.
2. **Binary Discovery:** Locates Ollama from `OLLAMA_BIN`, `%APPDATA%\ForgeAI\runtime`, `~/Library/Application Support/ForgeAI/runtime`, or system `$PATH`.
3. **Auto-Download:** If missing, downloads the official signed Ollama binary directly from GitHub Releases into the isolated app data directory.
4. **Daemon Startup:** Spawns `ollama serve` with Metal GPU acceleration, Flash Attention, and single-model residency (`OLLAMA_MAX_LOADED_MODELS=1`).
5. **Base Weights & Recipe Compilation:** Pulls base weights and compiles `sopu-coder` and `sopu-coder-fast` automatically.
6. **Model Warm-Up:** Sends an empty warm-up ping so your first interactive turn responds immediately.
7. **Clean Exit:** Quitting ForgeAI shuts down the managed Ollama daemon cleanly, preventing orphaned background processes.

---

## 5. Hardware Optimization & Inference Benchmarks

ForgeAI is engineered to operate efficiently on memory-constrained systems (e.g. 16 GB Apple Silicon MacBooks and modern Windows laptops):

### Measured Performance Baselines (`tests/benchmark.test.ts`)

| Benchmark Phase                   | Target Metric                               | Measured Result                             | Status |
| :-------------------------------- | :------------------------------------------ | :------------------------------------------ | :----- |
| **AST Parsing & Chunking**        | Parsing 500-line TypeScript files           | **1,357.8 docs/sec** (36.82 ms for 50 docs) | PASSED |
| **Vector Dot-Products (dim=768)** | Cosine similarity ranking across 5k vectors | **520,438 vector ops/sec** (9.61 ms)        | PASSED |
| **Context Packing Latency**       | Packing top 8 retrieval chunks              | **0.106 ms**                                | PASSED |
| **Token Budget Compliance**       | Packed tokens vs token budget               | **2,734 tokens** (Limit: 3,000)             | PASSED |
| **Process Memory Footprint**      | Testing & runtime baseline                  | **RSS: 105.66 MB**, **Heap: 16.70 MB**      | PASSED |

### Critical Local Engine Optimizations

- **Keep-Alive Sentinel:** Passes numeric `-1` to prevent Ollama from unloading models from VRAM.
- **Context Capping:** Defaults to `8192` context length (`num_ctx`) to prevent out-of-memory kernel panics.
- **Batch Processing:** Uses `512` token batches to maximize Apple Silicon Metal and NVIDIA CUDA tensor core throughput.
- **Zero-Timeout Activity Controller:** Streaming connections reset their timeout timer on every emitted chunk, allowing large generations to complete without connection drops.

---

## 6. Custom Model Management & Continuous Fine-Tuning

ForgeAI uses tracked Modelfile recipes in [`modelfiles/`](modelfiles/) so that model definitions remain lightweight and Git-versionable:

- `modelfiles/Modelfile.sopu-coder`: 7B coding specialist based on `qwen2.5-coder:7b`.
- `modelfiles/Modelfile.sopu-coder-fast`: 4B completion specialist based on `qwen3.5:4b`.

### One-Click Team Model Setup Script

Collaborators can build all models with a single command:

```bash
chmod +x scripts/setup-models.sh
./scripts/setup-models.sh
```

### Continuous Fine-Tuning Pipeline

1. **Interaction Harvesting:** Successful turns and accepted diffs are logged locally in `forgeai.db`.
2. **Dataset Export:**
   ```bash
   yarn export-data
   ```
   Filters clean conversations and outputs `training/train.jsonl` (90%) and `training/eval.jsonl` (10%).
3. **Parameter-Efficient QLoRA Fine-Tuning:**
   ```bash
   yarn train:lora
   ```
   Trains a compact LoRA adapter ($\Delta W$) on Apple Silicon (via MLX) or NVIDIA GPUs.
4. **Model Distribution:**
   Tag and push your updated model to Ollama Hub:
   ```bash
   ollama cp sopu-coder your-team/sopu-coder
   ollama push your-team/sopu-coder
   ```
   Teammates configure `FORGEAI_OLLAMA_MODEL=your-team/sopu-coder` to pull the latest trained model instantly.

---

## 7. Cross-Platform Engineering (macOS & Windows)

ForgeAI provides first-class support for macOS and Windows:

1. **IPv4 Loopback Normalization:** Automatically resolves `localhost` to `127.0.0.1` on Windows, eliminating Node/Undici `fetch failed` and `ECONNREFUSED ::1` errors.
2. **Windows Headers Timeout Fix:** Sets undici `headersTimeout: 60000` to prevent socket timeouts during slow cold-starts.
3. **Case-Insensitive Path Normalization:** Standardizes drive letters and slashes across `resolveSafe` and `isWithinRoot`, preventing false symlink escape errors on Windows.
4. **Shell Execution:** Supports macOS `zsh` and Windows `cmd.exe` / `powershell.exe` with proper `/d /s /c` argument escaping.

---

## 8. Packaging & Installer Distribution

ForgeAI packages clean, signed, and notarized binaries using `electron-builder`:

### macOS (`apps/desktop/dist/`)

```bash
yarn dist:mac
```

Produces:

- `ForgeAI-<version>-arm64.dmg` (Apple Silicon M1/M2/M3/M4)
- `ForgeAI-<version>-x64.dmg` (Intel Macs)
- Corresponding `.zip` archives for auto-updates.

### Windows (`apps/desktop/dist/`)

```bash
yarn dist:win
```

Produces:

- `ForgeAI-<version>-x64.exe` (NSIS setup installer)
- `ForgeAI-<version>-x64-portable.exe` (Zero-install standalone binary)

---

## 9. Keyboard Shortcuts Reference

| Action                         | macOS           | Windows / Linux            |
| :----------------------------- | :-------------- | :------------------------- |
| **Command Palette**            | `⌘⇧P`           | `Ctrl+Shift+P`             |
| **Quick Open File**            | `⌘P` / `⌘O`     | `Ctrl+P` / `Ctrl+O`        |
| **Inline AI Edit (QuickEdit)** | `⌘K`            | `Ctrl+K`                   |
| **Start Coding Agent**         | `⌘⇧↵`           | `Ctrl+Shift+Enter`         |
| **Toggle AI Assistant Panel**  | `⌘⌥B`           | `Ctrl+Alt+B`               |
| **Toggle File Explorer**       | `⌘⇧E`           | `Ctrl+Shift+E`             |
| **Global Text Search**         | `⌘⇧F`           | `Ctrl+Shift+F`             |
| **Toggle Source Control**      | `⌘⇧G`           | `Ctrl+Shift+G`             |
| **Toggle Built-in Terminal**   | `` ⌃` `` / `⌘J` | `` Ctrl+` `` / `Ctrl+J`    |
| **Toggle Problems Panel**      | `⌘⇧M`           | `Ctrl+Shift+M`             |
| **Save Active File**           | `⌘S`            | `Ctrl+S`                   |
| **Close Editor Tab**           | `⌘W`            | `Ctrl+W`                   |
| **Find in Active File**        | `⌘F`            | `Ctrl+F`                   |
| **Replace in Active File**     | `⌘⌥F`           | `Ctrl+H`                   |
| **Format Document**            | `⌥⇧F`           | `Shift+Alt+F`              |
| **Toggle Line Comment**        | `⌘/`            | `Ctrl+/`                   |
| **Settings & Keybindings**     | `⌘,` / `⌘K ⌘S`  | `Ctrl+,` / `Ctrl+K Ctrl+S` |

---

## 10. Quality Checks & Automated Verification

ForgeAI enforces zero-compromise code quality across all workspaces:

```bash
yarn typecheck      # Strict TypeScript checking (tsconfig.node.json & tsconfig.web.json)
yarn lint           # ESLint 9 across all packages and components
yarn format:check   # Prettier style verification
yarn format         # Prettier auto-formatter
yarn test           # Full Vitest suite (134/134 passing tests across 15 suites)
yarn smoke          # Headless Electron smoke test with automated screenshot capture
yarn build          # Production bundle compilation
```

**Current Verification Status:**

- **Automated Tests:** **134 / 134 passing** across 15 test suites.
- **Typecheck:** Clean (0 errors).
- **ESLint:** Clean (0 warnings, 0 errors).
- **Format:** 100% compliant with Prettier.

---

## 11. Security Model & Boundary Audit

ForgeAI is designed with defense-in-depth:

1. **Process Isolation:** The renderer runs with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
2. **Subprocess Environment Sanitization (`sanitizeSubprocessEnv`):** Automatically scrubs ambient API keys, tokens, and credentials (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.) before launching shell commands.
3. **SSRF & Metadata Defense:** The `fetch_url` tool blocks access to cloud metadata services (`169.254.169.254`, `metadata.google.internal`) and link-local ranges.
4. **Filesystem Confinement (`resolveSafe`):** Traversal (`..`) and symlink escapes outside the workspace root are rejected. Git internals (`.git/`) are protected against automated modification.
5. **Interactive Permissions (`PermissionBroker`):** File writes, deletions, terminal commands, and dependencies require explicit developer approval.
6. **Secret Exclusion:** Credential files (`.env*`, `.pem`, `.key`, `id_rsa*`, `.aws/`, `.ssh/`) are completely excluded from indexing and RAG embeddings.

---

## 12. Troubleshooting & FAQ

**Q: Windows: Assistant chat displays `fetch failed (Headers Timeout Error)`.**  
**A:** This happens if Ollama takes longer than standard socket thresholds to cold-load a model into VRAM. ForgeAI configures undici `headersTimeout: 60000` to prevent early timeouts. Ensure Ollama is running and responsive via `ollama list`.

**Q: Windows: Chat displays `ECONNREFUSED ::1:11434`.**  
**A:** Node resolved `localhost` to IPv6 `::1` while Ollama listens on IPv4 `127.0.0.1`. ForgeAI normalizes this automatically. If using an external server, set your endpoint to `http://127.0.0.1:11434` in **Models → Providers**.

**Q: How do I recover if an agent breaks my code?**  
**A:** ForgeAI creates a checkpoint before file modifications. Open the checkpoints panel or restore the workspace to revert all files to the exact state before the run began.

**Q: Can I use cloud models alongside local models?**  
**A:** Yes. Open **Models → Providers**, add your API key for Anthropic, OpenAI, Groq, or DeepSeek, and assign cloud models to specific roles (e.g. Claude for Planning and local Sopu-Coder for Coding).

**Q: Where is app data stored?**  
**A:** On macOS: `~/Library/Application Support/ForgeAI/`. On Windows: `%APPDATA%\ForgeAI\`. All chats, checkpoints, and SQLite data remain strictly in this directory.

---

## License

MIT License. Copyright © 2026 Sopu AI / ForgeAI Contributors.
