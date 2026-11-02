# ForgeAI

**A local-first AI software development environment.** ForgeAI is a desktop IDE built on Electron,
React, Monaco and Ollama. It runs entirely on your machine: no cloud account, no API key, and no
code leaves your computer. Cloud providers are optional.

![ForgeAI running with no project open](docs/screenshot.png)

- Streaming chat, inline completion, quick edit, explain, refactor, tests and docs
- Autonomous coding agent with a permission-gated tool registry, plus planner, debugging, testing,
  review, docs and **SEO** agents
- Kiro-style spec workflow: requirements → design → tasks, with explicit approvals
- Codebase indexing, embeddings and retrieval-grounded answers
- Monaco editor with tabs, split view, diffs and hunk-level accept/revert
- Built-in terminal, Git panel, search, problems, output and run/debug helpers
- **Zero-setup local AI:** ForgeAI finds, installs, starts and prepares Ollama for you
- **One resident model:** `qwen3.5:4b` stays loaded for the whole session — no cold starts between
  messages
- VS Code Dark+/Light+ colours, blue status bar and familiar tab/editor conventions

Architecture details live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 1. Requirements

| Requirement | Version / notes                                                              |
| ----------- | ---------------------------------------------------------------------------- |
| Node.js     | **22 or newer** (24 LTS recommended). `node:sqlite` is required.             |
| Yarn        | **1.22.x** (classic). The repo uses Yarn 1 workspaces.                       |
| OS          | macOS 12+ (Apple Silicon or Intel) or Windows 10/11 (x64 or arm64)           |
| Disk        | ~3 GB free: dependencies, Electron, the Ollama runtime and the default model |
| RAM         | 8 GB minimum; 16 GB recommended for a 4B model plus an IDE                   |
| Network     | Needed only for the first install and for downloading the local model        |

You do **not** need to install Ollama yourself. ForgeAI manages it automatically (see
[Local AI bootstrap](#4-local-ai-bootstrap)).

Check your tools:

```bash
node -v     # must print v22.x or newer
yarn -v     # must print 1.22.x
```

If Yarn is missing:

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
```

---

## 2. Install dependencies

From the repository root:

```bash
yarn install
```

This installs all workspaces (`apps/*`, `packages/*`). No build step is needed for the workspace
packages — they are consumed from source through Vite aliases.

---

## 3. Run the app

### Development (hot reload)

```bash
yarn dev
```

This starts electron-vite with HMR for the renderer and automatic restarts for the main process.
The first window may take a few seconds while Electron starts.

### Production build, then preview locally

```bash
yarn build
yarn start
```

`yarn build` compiles the main process, preload and renderer into `apps/desktop/out/`.
`yarn start` runs that build in Electron (it does not create an installer).

### Verify the UI without opening a project

```bash
yarn smoke
```

Builds the app, launches it headlessly, waits for the renderer, captures
`apps/desktop/smoke.png` and exits with code 0. Useful in CI with a virtual display.

---

## 4. Local AI bootstrap

ForgeAI ships with a fixed local default:

| Setting    | Default                                                              |
| ---------- | -------------------------------------------------------------------- |
| Provider   | Ollama                                                               |
| Endpoint   | `http://localhost:11434`                                             |
| Model      | `qwen3.5:4b` (~3.3 GB)                                               |
| Roles      | `chat`, `coding`, `plan`, `fast`, `review` all use `qwen3.5:4b`      |
| Embeddings | optional — retrieval falls back to keyword search when not installed |
| Keep-alive | `-1` (never unload while ForgeAI is running)                         |

On launch (about 300 ms after the window opens, off the critical path) ForgeAI runs this pipeline in
the background:

1. **Check** `GET /api/version` on the configured endpoint.
2. If the server is not running, **locate** an Ollama binary:
   - `OLLAMA_BIN`, if set;
   - the managed runtime in the ForgeAI data directory;
   - common macOS/Windows install locations;
   - `which ollama` / `where ollama`.
3. If no binary exists, **download the official Ollama runtime** from GitHub Releases for the current
   OS and CPU, extract it into the ForgeAI data directory, and mark it executable. No admin prompt
   or system-wide installer is used.
4. **Start** `ollama serve` with `OLLAMA_HOST` derived from the endpoint, `OLLAMA_KEEP_ALIVE=-1`,
   `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1` and `OLLAMA_FLASH_ATTENTION=1`, logging to
   `logs/ollama.log`.
5. Wait for the health endpoint, then **pull** `qwen3.5:4b` if it is not already installed,
   streaming progress into the UI.
6. **Warm the model** with an empty `/api/generate` request so the first real message does not pay
   the load cost, then assign the model to every chat/coding/plan/fast/review role.
7. **Prune old models** that earlier versions pulled (for example `qwen2.5-coder:*`, `qwen3:8b`,
   `deepseek-r1:8b`). Embedding models are left alone. You can also remove everything except the
   default from **Models → Keep only qwen3.5:4b**.
8. Start a **watchdog** that checks every 15 s and restarts the managed server if it stops. An Ollama
   server you started yourself is never touched.

Progress appears in the slim banner above the editor and in **Models** (top-bar model menu →
manage models). You can cancel a download or retry from there. The app remains usable while the
runtime prepares — chat input tells you when the local model is not ready yet.

Closing the ForgeAI window quits the app on every OS and stops the `ollama serve` it started, so no
background server is left behind. A server you started yourself is left running.

### Speed, not fine-tuning

ForgeAI does **not** fine-tune or retrain `qwen3.5:4b` — there is no training data or GPU job in the
app. “Faster” comes from inference-side tuning, which is what actually helps a local IDE:

- the model stays resident (`keep_alive=-1`) so there is no reload penalty between prompts;
- a warm-up request runs at startup;
- `num_ctx` is capped at 8192, `num_batch` 512 and generation defaults to 2048 tokens;
- temperature 0.15, `top_p` 0.9, `repeat_penalty` 1.05 and thinking disabled for chat/agent calls;
- prompt budgets are smaller (rules, attachments, retrieval and history are trimmed);
- Monaco and the terminal are loaded lazily, and start-up work is deferred off the first paint.

If you want to fully customise generation, change the Ollama provider settings in **Models →
Providers**; the same values are sent on every request.

### Overrides

All are optional environment variables:

| Variable                           | Meaning                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `FORGEAI_OLLAMA_AUTO=0`            | Disable the automatic bootstrap at launch.                 |
| `FORGEAI_OLLAMA_MODEL=llama3.2:3b` | Use a different default model. It is pulled automatically. |
| `OLLAMA_BIN=/path/to/ollama`       | Force a specific Ollama executable.                        |

Examples:

```bash
# Start manually, then connect from the app
ollama serve

# Launch ForgeAI without touching the runtime
FORGEAI_OLLAMA_AUTO=0 yarn dev

# Use your own binary and model
OLLAMA_BIN=/opt/homebrew/bin/ollama FORGEAI_OLLAMA_MODEL=qwen2.5-coder:7b yarn dev
```

The endpoint is not hard-coded into requests: change it per provider in **Models → Providers**.
ForgeAI migrates the stock `127.0.0.1:11434` address to `http://localhost:11434` and upgrades an old
`10m` keep-alive to `-1`.

### Using the agents

Open the **Agents** activity (or the AI panel → Agent) and pick a role:

| Agent     | What it is for                                                     |
| --------- | ------------------------------------------------------------------ |
| Coding    | Implements features and fixes, with hunk-level diff approval       |
| Planner   | Explores the codebase and returns an ordered plan, no edits        |
| Debugging | Reproduces failures, reads logs and applies the smallest safe fix  |
| Testing   | Writes and runs tests, fills coverage gaps                         |
| Review    | Read-only audit for correctness, security and performance          |
| Docs      | README sections, API references and code documentation             |
| SEO       | Crawlability, metadata, structured data, Core Web Vitals and links |

Each role has example task chips — click one to fill the prompt, then press **Start** (or `⌘⇧↵` to
start the coding agent from anywhere). The SEO agent begins with a read-only `seo_audit` tool that
scans up to 24 pages plus six config files for titles, descriptions, canonicals, Open Graph,
Twitter cards, JSON-LD, viewport, `robots.txt` and sitemap coverage, then proposes framework-native
fixes. Commands, installs, commits and writes always pause for explicit permission, and a checkpoint
is created before the first write.

### Offline / manual setup

If automatic download is blocked by a proxy or firewall:

```bash
# 1. Install Ollama yourself, or place the archive/binary where ForgeAI can see it.
# 2. Start the server.
ollama serve

# 3. Pull the default model once.
ollama pull qwen3.5:4b

# 4. Launch ForgeAI; it detects the running server and skips installation.
yarn dev
```

Ollama's own documentation: <https://ollama.com/download>.

### Where data lives

The app forces its user-data directory to `<appData>/ForgeAI`:

| Platform | Path                                     |
| -------- | ---------------------------------------- |
| macOS    | `~/Library/Application Support/ForgeAI/` |
| Windows  | `%APPDATA%\ForgeAI\`                     |

Contents include:

- `forgeai.db` — SQLite database (projects, chats, settings, index metadata)
- `logs/ollama.log` — stdout/stderr from the managed Ollama server
- `runtime/ollama/` — managed Ollama binary (when ForgeAI installed it)

Conversations, checkpoints and indexed chunks stay in this directory. Delete the folder to reset all
ForgeAI state; models are kept in Ollama's own store (`~/.ollama`).

---

## 5. Build installers

Installer builds use [electron-builder](https://www.electron.build/). Configuration lives in
[`apps/desktop/electron-builder.yml`](apps/desktop/electron-builder.yml).

Every `dist:*` command runs [`scripts/clean.mjs`](scripts/clean.mjs) first. It deletes
`apps/desktop/out/`, `apps/desktop/dist/` and the Vite cache, so a build can never contain files
from a previous version. Use it on its own any time:

```bash
yarn clean
```

### macOS (build on macOS)

```bash
yarn dist:mac
```

Output in `apps/desktop/dist/`:

- `ForgeAI-<version>-arm64.dmg` and `ForgeAI-<version>-x64.dmg`
- `ForgeAI-<version>-arm64.zip` and `ForgeAI-<version>-x64.zip` (useful for auto-update tooling)

After packaging, ForgeAI removes the unpacked `dist/mac*/ForgeAI.app` copies. macOS indexes any
`.app` under your home folder, so leaving them would put duplicate ForgeAI icons in Launchpad next
to the installed app.

For a quick **unsigned** local build:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false yarn dist:mac
```

Unsigned apps show a Gatekeeper warning on other machines. To distribute publicly, sign with a
Developer ID certificate and notarize; set `CSC_LINK` / `CSC_KEY_PASSWORD` or use a keychain identity,
then add notarization credentials. Never commit certificates or passwords.

**Installing an update:** quit ForgeAI, open the new DMG and drag **ForgeAI** onto **Applications**,
replacing the existing copy. The app identifier (`dev.forgeai.desktop`) stays the same, so macOS
treats it as the same app and your settings, chats and index remain in
`~/Library/Application Support/ForgeAI/`. If macOS keeps an old copy under a different name, drag
that stale copy to the Trash once.

### Windows (build on Windows)

```bash
yarn dist:win
```

Output in `apps/desktop\dist\`:

- `ForgeAI-<version>-x64.exe` and `ForgeAI-<version>-arm64.exe` NSIS installers
- `ForgeAI-<version>-x64-portable.exe`

Building Windows targets from macOS/Linux requires Wine and is not the supported path; run the
command on a Windows machine (or a Windows CI runner) for reliable artifacts.

**Installing an update:** run the new installer. The NSIS package uses the same `appId` and
`uninstallDisplayName`, so it upgrades the existing installation in place and replaces the old
files; you do not need to uninstall first. `deleteAppDataOnUninstall: false` means
`%APPDATA%\ForgeAI` (settings, chats, index) is preserved across upgrades and even after an
uninstall.

### Sharing the built files

After building, hand the artefacts to users directly:

- macOS: share the `.dmg` (Apple Silicon users need `-arm64`, Intel users need `-x64`).
- Windows: share the `.exe` installer; the `-portable.exe` needs no installation.

Unsigned builds are fine for personal or internal use. For public distribution, sign and notarize
on macOS, and code-sign the Windows installer so SmartScreen trusts it. Never ship your `.env` file,
certificates or signing passwords with a build.

### Build only the JavaScript bundle

```bash
yarn build          # out/main, out/preload, out/renderer
```

The renderer is static; the main and preload bundles stay CommonJS/ESM as emitted by electron-vite.
Workspace packages are bundled into the main process, and `node-pty` is unpacked from the asar
archive so its N-API prebuild loads at runtime.

---

## 6. Quality checks

```bash
yarn typecheck      # strict TypeScript for main/preload and renderer
yarn test           # Vitest (run once)
yarn test:watch     # Vitest in watch mode
yarn lint           # ESLint
yarn format:check   # Prettier verification
yarn format         # Prettier write
yarn smoke          # build + headless launch + screenshot
```

Run `yarn typecheck && yarn build && yarn smoke` before opening a pull request or cutting a release.

---

## 7. Project layout

```
sopu-agent-ai/
├── apps/
│   └── desktop/
│       ├── src/main/            Electron main process
│       │   ├── index.ts         lifecycle, window, smoke mode, runtime auto-start
│       │   ├── ipc.ts           typed, validated IPC router
│       │   ├── services/        workspace, db, search, index, git, terminal, providers, Ollama runtime
│       │   ├── agent/           agent loop, tools, prompts
│       │   └── specs/           requirements/design/tasks pipeline
│       ├── src/preload/         contextBridge API
│       ├── src/renderer/        React UI (Monaco, chat, panels, dialogs)
│       ├── build/               app icon and packaging assets
│       ├── electron-builder.yml packaging targets
│       └── scripts/smoke.mjs    headless smoke test
├── packages/
│   ├── shared/                  types, IPC contract, zod schemas, defaults
│   ├── ai/                      provider clients, streaming, tool-call parsing
│   └── core/                    indexing, retrieval, specs, rules, diffs
├── docs/                        architecture and screenshot
├── scripts/clean.mjs            removes previous build output before packaging
├── tests/                       Vitest suites for shared helpers and the diff engine
├── package.json                 Yarn workspaces and root scripts
└── vitest.config.mts, eslint.config.mjs, .prettierrc.json, apps/desktop/electron.vite.config.ts
```

### Useful scripts

| Command          | What it does                             |
| ---------------- | ---------------------------------------- |
| `yarn dev`       | Run from source with HMR                 |
| `yarn build`     | Build main, preload and renderer         |
| `yarn clean`     | Delete `out/`, `dist/` and Vite caches   |
| `yarn start`     | Preview the production build             |
| `yarn typecheck` | Strict TypeScript check                  |
| `yarn test`      | Run Vitest                               |
| `yarn smoke`     | Headless UI smoke test                   |
| `yarn dist:mac`  | Clean build + macOS DMG/ZIP (arm64, x64) |
| `yarn dist:win`  | Clean build + Windows NSIS/portable      |

---

## 8. Troubleshooting

**Port 11434 is already in use.** Another Ollama instance or an app is bound to it. ForgeAI reuses a
healthy Ollama at that address; otherwise stop the other process or point the Ollama provider at a
different port in **Models → Providers**.

**The runtime downloaded but the server will not start.** Read
`<data>/logs/ollama.log`. Common causes are a quarantined binary on macOS
(`xattr -dr com.apple.quarantine <data>/runtime/ollama`) or a blocked executable path on Windows.

**Model download stalls or fails.** Check network/proxy access to `github.com` (runtime archive) and
`registry.ollama.ai` (model layers). Then open **Models**, press retry, or fall back to the
[manual setup](#offline--manual-setup).

**“Set up local model” keeps appearing.** The provider endpoint may not match the running server.
Open **Models → Providers**, test the Ollama endpoint, and ensure it is enabled.

**The first answer is fast but later answers stall.** Something else unloaded the model (another
Ollama client, a manual `ollama stop`, or memory pressure). ForgeAI sends `keep_alive: -1` on every
request and its watchdog restarts a managed server, but it will not fight a server you started
yourself. Check with `ollama ps`; the model should stay listed while ForgeAI is open.

**Old models are still on disk.** ForgeAI removes the known legacy models automatically after
startup. For a full cleanup open **Models** and press **Keep only qwen3.5:4b**; this deletes every
other model on that Ollama endpoint, including embedding models, so retrieval will use keyword
search until you install an embedding model again.

**The window is blank in development.** Confirm Node is 22+, delete `apps/desktop/out/`, and run
`yarn dev` again. In headless environments use `yarn smoke` or a virtual display.

**A packaged build cannot load `node-pty`.** Keep `asarUnpack: node_modules/node-pty/**` in the
electron-builder config; native prebuilds must stay outside the asar archive.

**Windows installer build fails on macOS.** Build on Windows. NSIS/portable targets need the Windows
toolchain (or Wine, which is best-effort only).

---

## 9. Security model

The renderer is sandboxed with `contextIsolation` and no Node access. Every privileged action goes
through a typed IPC channel validated with Zod in the main process. File access is confined to the
open workspace, secret paths are blocked, deletes and shell commands require approval, and model
output can only reach the curated tool registry. API keys, when added for an optional cloud
provider, are stored with Electron `safeStorage` in the OS keychain — never in plain text and never
in the repository.

ForgeAI does not read or write `.env` files. Keep credentials out of the workspace and out of git.
