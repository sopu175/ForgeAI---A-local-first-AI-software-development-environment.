# ForgeAI Project Memory & Developer Feedback Architecture

## 1. Overview & Purpose

ForgeAI provides persistent, project-isolated memory to capture durable developer decisions, conventions, recurring issues, and explicit feedback without confusing memory with conversation logs or global model fine-tuning.

Local models do not learn through weight adjustments during ordinary inferencing. Instead, persistent project memory acts as a grounded knowledge store that injects verified human decisions and codebase standards into prompt context during agent runs and chat sessions.

---

## 2. Memory Schema & Storage

Project memory is persisted in the local SQLite database (`apps/desktop/src/main/db.ts`) with dedicated indexing on `project_id` and `kind`:

```sql
CREATE TABLE IF NOT EXISTS project_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_memory ON project_memory(project_id, kind);
```

### Memory Kinds
- **`convention`**: Coding standards, formatting guidelines, architectural style rules (e.g., "Use Tailwind utility classes and avoid inline CSS").
- **`decision`**: Confirmed technical decisions (e.g., "Store local data in SQLite; avoid external API dependencies").
- **`issue`**: Recurring project issues and verified resolutions (e.g., "Windows fetch timeout solved by headersTimeout configuration").
- **`feedback`**: Developer corrections and direct preferences from previous agent runs.

---

## 3. Strict Isolation Guarantees

1. **Workspace Boundary**: Every memory query is strictly scoped to `projectId`. Memories from one repository or workspace are never leaked or retrieved into another workspace.
2. **Deterministic Retrieval**: In `apps/desktop/src/main/agent/runtime.ts`, active project memories are formatted and injected under `## Project memory & conventions (persistent user knowledge)` in the system prompt.
3. **Auditability & Provenance**: Each entry records `source` (e.g., `'user'`, `'planner'`), `createdAt`, and `updatedAt` timestamps.

---

## 4. UI Controls

The **Context Panel** (`ContextPanel.tsx`) contains the dedicated **Project Memory** section:
- **Inspect**: View all stored memories categorized by kind. Expand any entry to view full content, source provenance, and timestamp.
- **Add**: Create new conventions or decisions with a title, kind dropdown, and content textarea.
- **Delete**: Remove outdated or superseded memories with a single click.
- **Real-Time Synchronisation**: Changes immediately take effect for subsequent agent interactions.

---

## 5. Automated Verification

- `tests/memory.test.ts` validates:
  - Memory persistence and conflict upserts
  - Workspace isolation across disparate project IDs
  - Kind-based filtering and chronological ordering
  - Correct formatting into the agent's system prompt
- Full test pass across all 13 suites (128 tests passing).
