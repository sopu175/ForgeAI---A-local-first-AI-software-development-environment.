# ForgeAI IDE Experience & Developer Workflows

## 1. Overview & Architecture

ForgeAI bridges the gap between chat assistants and IDE developer ergonomics. Rather than locking AI interactions inside a disconnected chat drawer, ForgeAI exposes AI capabilities directly into the editor context, problems panel, terminal, and file tree.

---

## 2. Editor & Selection Workflows (QuickEdit)

When working inside the Monaco editor, developers can highlight code and invoke context-aware AI operations without leaving the file buffer:

### Available Selection Actions:

- **`Explain selection`**: Explains logic, data flow, edge cases, and performance hazards without rewriting code.
- **`Refactor selection`** (`Cmd/Ctrl+K`): Refactors the selected code for clarity and maintainability while preserving functional equivalence.
- **`Generate tests`**: Produces isolated test suites matching the project's detected testing framework (Vitest, Jest, etc.).
- **`Write documentation`**: Generates inline JSDoc/TSDoc and Markdown documentation with parameters, return signatures, and usage examples.
- **`Animate selection (GSAP / Motion)`**: Introduces smooth transitions and UI animations (GSAP, Framer Motion, CSS) with accessibility guards (`prefers-reduced-motion`) and lifecycle cleanup.

### Diff & Approval Controls:

- Refactoring and animation proposals can be reviewed in place.
- "Apply replacement" executes targeted range replacements inside the Monaco model.
- All file edits trigger an automatic checkpoint when `autoCheckpoint` is enabled.

---

## 3. Diagnostic-Driven AI ("Ask AI to Fix")

Compiler and linter diagnostics reported by TypeScript, JavaScript, HTML, CSS, and JSON in the Monaco editor are surfaced in the **Problems Panel** (`BottomPanel.tsx`).

Each diagnostic row includes a dedicated **Sparkles** action:

1. Automatically pins the problem's file into the AI prompt context (`addContextFile`).
2. Opens the Assistant Chat drawer.
3. Issues a targeted prompt: `Please explain and fix this diagnostic error in <file> line <line>: "<message>"`.
4. The agent inspects the code, references relevant AST symbols, and proposes a verified fix.

---

## 4. Multi-Agent Orchestration & Status Tracking

The IDE tracks the specialist agent execution lifecycle in real time:

- **Live Agent Run Card** (`AgentRunCard.tsx`): Displays the active agent role (Planner, Frontend, Animation, Backend, Review, etc.), current step counter (e.g., Step 3 of 20), tool execution logs, and elapsed time.
- **Interactive Diff Review** (`DiffsPanel.tsx`): Multi-file diff viewer with hunk-level approval. Developers can accept individual hunks or reject changes.
- **Cancellation & Safety**: Agent runs can be aborted cleanly at any turn (`cancelAgent`), releasing terminal locks and cancelling outstanding tool executions.

---

## 5. Recoverable Checkpoints

Before an agent performs file modifications, `CheckpointService` creates an atomic snapshot of workspace state:

- Checkpoints capture file revisions prior to agent mutations.
- If an agent generates invalid code or breaks tests, developers can roll back the workspace to the exact state before the run began (`checkpoints:restore`).

---

## 6. Verification & Test Status

- 128 tests passing across all suites (`tests/`, `packages/core/`, `packages/ai/`).
- Full TypeScript typecheck and ESLint clean.
