# ForgeAI — gap analysis, speed plan and professional readiness

Date: 2026-11-02 · Build under review: 0.1.0 (Electron 45.2.1, React 19, Monaco 0.57, Ollama-first)

This document answers three questions asked during the last review pass: what is
missing compared to the IDEs people use for real work, how to make results come
faster, and what was actually changed in this pass.

## 1. What ForgeAI does well today

The core loop is real and works end to end on this machine. A workspace opens, the
project is indexed (files, symbols, embeddings), chat streams from a local model, and
the coding agent can read, search, write, edit, run commands, run tests, install
dependencies, snapshot checkpoints and commit. Specs give the agent a task list; the
diff review and permission broker keep writes honest. Seven agent roles ship today
(coding, planner, debugging, testing, review, docs and SEO), plus quick edit on a
selection: explain, refactor, tests, docs.

Editor surfaces are complete enough for daily work: tabs, split editor, quick open,
command palette, global search, source-control panel with staged/working diffs,
integrated PTY terminal, problems panel, checkpoints and history.

## 2. What changed in this pass

**Right-click, everywhere it should be.** The Explorer context menu now carries the
actions people expect: Open, Open in Browser (with every detected browser listed),
Attach to AI chat, Copy relative path, Copy absolute path, Reveal in File Manager,
Rename, Delete — and for folders: New file here, New folder here, Open in Integrated
Terminal. Right-clicking the empty area under the tree gives project-level actions
(New file, New folder, Open Terminal at root, Refresh, Filter, Collapse All). The menu
is measured against the viewport before it paints, so it no longer runs off the bottom
or right edge, it closes on Escape, on outside click, and when the tree scrolls.

The editor right-click menu was the bigger gap: Monaco's standalone build contributes only
navigation, the clipboard and a couple of edits, which is why the menu looked nearly empty.
ForgeAI now contributes Find…, Replace…, Select All, Toggle Line Comment, Copy Absolute
and Relative Path, Reveal in File Manager, Explain Selection, Inline AI Edit, Generate
Tests, Generate Documentation, Attach File to AI Chat, and — for markup files — Open in
Browser plus one entry per installed browser. Entries that Monaco already provides (Format
Document, Rename Symbol) were deliberately not duplicated. `fixedOverflowWidgets` stays on
so the menu is not clipped by the editor's scroll container.

**Integrated terminal.** Live verification caught a defect that had been invisible in the
logs: `node-pty`'s `spawn-helper` ships without the executable bit after installation, so
`pty.spawn()` failed with `posix_spawnp failed` and every session silently fell back to
pipe mode — no echo, no prompt, and every Enter printed `zsh: command not found: ^M`.
`scripts/fix-native-bins.mjs` now restores the bit, runs as `postinstall` and as a step in
every `dist:*` script, and the pipe fallback says so on the output stream instead of
writing a comment into a shell that cannot echo it.

**HTML preview.** A new main-process service detects installed browsers (Chrome, Chrome
Canary, Chromium, Edge, Firefox, Brave, Arc, Vivaldi, Opera, Safari) in their macOS,
Windows and Linux locations and exposes them over IPC. `workspace:browsers` lists what is
actually installed; `workspace:openInBrowser` launches a workspace file by real path, so
relative CSS/JS/image references work. Choosing an explicit browser uses `open -a
<bundle>` on macOS and the resolved binary elsewhere; "System default browser" keeps
using the OS handler. Entries are reachable from the Explorer menu, the editor menu, the
File menu and the command palette ("Open in Browser"), and the default is configurable in
Settings → Browser & Preview.

**Settings parity.** Settings gained the sections people look for and previously could
not find: Editor (code font size, ligatures, word wrap, minimap, line numbers, whitespace
rendering, tab size, insert spaces, detect indentation, auto save + delay, format on save,
smooth scrolling, bracket-pair colorization, sticky scroll, auto-close brackets,
suggestions while typing, multi-cursor modifier), Browser & Preview (default browser plus
a live list of detected browsers), and Terminal (font size, cursor blink). Agent settings
now include the read-only batching switch. Every one of these is wired: the values reach
`createEditorOptions`, auto save and format on save are executed by the store's `saveTab`,
and the terminal reads its own font and cursor settings instead of borrowing the editor's.

**Agent truthfulness and speed.** The runtime keeps a tool-confirmed ledger of writes and
commands; when a draft report claims nothing changed but the tools wrote files, the report
is replaced with the factual summary. DOM references are verified after a run (a `js` that
looks for `#session-counter` against markup that only has `id="session-count"` is reported
as a warning instead of silently shipping). Independent read-only tool calls in the same
turn now run concurrently, which is the single biggest wall-clock win in this pass.

## 3. What is missing for professional work

Ordered roughly by how much it blocks real projects.

**Language intelligence beyond the built-in four.** Monaco ships TypeScript, JavaScript,
JSON, CSS and HTML intelligence. Python, Go, Rust, PHP, Java and C# get syntax
highlighting only — no completions, no hover, no real diagnostics, no rename across a
project. A language-client layer (LSP servers launched per workspace, one socket to the
renderer) is the highest-value professional feature on the list.

**Refactors and references.** Rename-symbol works inside one file through the language
service; there is no find-all-references or cross-file rename. For a team, that is the
difference between a toy and a tool.

**Debugger and run configurations.** The Run & Debug tab exists, but no DAP adapters are
bundled, so there are no breakpoints, call stacks or watch expressions. A `launch.json`
equivalent with npm-script detection would cover most web projects without full DAP.

**Live preview.** "Open in Browser" is a file launch, not a dev server. Professionals
expect an embedded preview with hot reload, a device-size selector, console forwarding
into the Problems panel, and element inspection. That is the natural next step on top of
what shipped here.

**Extensions.** There is an Extensions activity view, but no extension host, no API
surface and no marketplace. Without it, every integration (linters, formatters, themes,
keymap packs) has to be built in-tree.

**MCP / tool interoperability.** The agent's tool registry is closed and internal. An MCP
client would let outside servers (databases, design tools, CI, issue trackers) feed the
same broker that guards writes today.

**Agent tool gaps.** The 21 registered tools cover read, search, semantic search, symbols,
overview, write, edit, delete, run command, run tests, install, git status/diff/commit/log,
checkpoint, fetch_url, update_task and seo_audit. Missing for professional use: a web
search tool (only a known URL can be fetched, so the agent cannot look anything up), a
task/todo list outside the spec flow, a tool that edits several files in one atomic
approval, image input for design-to-code work, and any way to read test coverage or a
failing-test report back as structured data rather than scraped stdout.

**Git depth.** `services/git.ts` and the IPC surface cover status, diff, stage/unstage,
commit, log, discard, branch list, checkout and create-branch — all strictly local. There
is no remote support at all: no push, pull, fetch or clone in the service, the IPC channel
list or the agent's tools, so neither the user nor the agent can sync a repository or open
a PR. Also missing: rebase and amend, stash, conflict resolution UI, file history and
blame, and credential handling through the keychain. For a tool aimed at working
engineers, remote Git is the first thing they will look for and not find.

**Formatting from the project's own tools.** Format on save uses Monaco's formatters. A
real repo wants its Prettier/ESLint/Biome/ruff configuration respected, including rules
from the repo's config files rather than the editor defaults.

**Workspace ergonomics.** Single folder per window today. Professionals want multi-root
workspaces, per-folder settings, workspace files, and profile switching.

**Distribution and operations.** No code signing or notarization, no auto-updater, no
crash reporting (deliberately: telemetry is off). For a team rollout those three are
mandatory; the local-first stance is compatible with an opt-in, self-hosted crash
ingest.

**Editor details still open:** a Markdown preview pane, breadcrumbs, indent guides from
language config, trim trailing whitespace on save, file encoding and EOL pickers, tab
groups with names, and a second find/replace that can rewrite across files.

## 4. How to get results faster

Measured on the development machine (M1 Pro, 16 GB, `qwen3.5:4b` Q4_K_M resident, Ollama
`keep_alive: -1`), not guessed:

| measurement                                   | value                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| prefill (uncached prompt processing)          | ~260–270 tokens/s                                                             |
| generation                                    | ~27–36 tokens/s                                                               |
| re-sending an identical prefix                | prefill 23.2 s → 0.09 s (KV cache hit)                                        |
| editing one token in the middle of the prefix | full 22.2 s re-prefill                                                        |
| 153 real agent calls (`usage` table)          | avg 4,156 prompt tokens, max 7,291, avg 70 output tokens, avg 18.4 s per call |

The last row is the important one. A step costs about 16 s of prefill and 2.5 s of
generation: **the agent pays to re-read its own context, not to think.** "Generation
dominates" was the assumption this section used to make; the numbers say otherwise, and it
changes what is worth fixing.

**One: stop invalidating the KV cache.** `num_ctx` is 8192 and the average step already
sits at 4,156 tokens with a max of 7,291, so `trimHistory` fires constantly — and it fires
by _rewriting older tool messages in place_ (8000 → 4000 → 2000 → 1000 characters). Any
change to an earlier token invalidates everything after it, so each step re-prefills the
whole conversation. The fix is to make the history append-only: cap each observation once,
at the moment it is inserted, instead of shrinking old ones later; when the budget is still
blown, drop whole oldest assistant/tool pairs rather than editing them. The stable prefix —
system prompt, tool schemas, task, first observations — then stays cached and a step costs
roughly the new tail. This is the single largest speed-up available without changing the
model, and it needs no new dependencies.

**Two: raise the ceiling that forces the trimming.** 7,291 prompt tokens against 8192 means
the runtime is trimming while the model is mid-thought, which also produces the empty-turn
recovery path. 16384 measured identical cache behaviour and costs about 1 GB more RAM for
this model; it is a provider-config change, not a code change.

**Three: fewer steps, same quality.** The step budget is a wall-clock multiplier. Splitting
"add auth, dashboards and tests" into three spec tasks finishes sooner than one 20-step run
that stalls. Concurrent read-only tools (shipped in this pass, batched at four, writes stay
sequential) and `read_multiple_files` (six files per call) already remove whole rounds of
prefill, because fewer model turns is the same thing as fewer cached-prefix misses.

**Four: model choice.** `qwen3.5:4b` is comfortable on memory and handles scoped edits and
small builds; multi-file features are where it burns steps. Because prefill dominates, a
bigger local model costs proportionally more per step — a 7–8B coder roughly triples it.
The better trade is a stronger model for the Coding role only (hosted, or local if the
machine allows) with chat, planner and fast tasks staying on the resident 4B. `think: false`
is set for agent turns; enabling reasoning for the planner and review roles buys quality
where step count is low.

**Five: inline completion needs its own budget.** Completion is off by default and the
reason is arithmetic: 5000 characters of prefix plus 2500 of suffix is ~2,000 tokens, which
is ~8 s of prefill at 260 t/s — and the prefix changes on every keystroke, so nothing can
ever be cached. Shrinking the window to ~1200/600 characters and only firing when the
cursor pauses at a real insertion point makes it usable; otherwise it should stay off.

**Indexing.** Re-indexing is already incremental (mtime + SHA-1 per file, keyword retrieval
by default, embeddings only when an embedding model is assigned), so the first step of a
run starts with evidence instead of spending steps on discovery.

## 5. Suggested order for the next build

Zero, because it is hours of work and the largest measured win: make agent history
append-only so the cached prefix survives (cap observations at insert time, drop whole old
pairs instead of rewriting them) and raise `num_ctx` for the coding role. One: remote Git —
push, pull, fetch, credential handling in the keychain — because the app is currently
local-only and that blocks real projects immediately. Two: an embedded preview with hot
reload and console forwarding, since the browser launch and browser settings now exist and
this is the visible payoff for web work. Three: LSP-backed intelligence for Python, Go,
Rust and PHP. Four: MCP support wired through the existing permission broker. Five:
cross-file rename and references. Six: signing, notarization and an auto-updater so the app
can be handed to other people.
