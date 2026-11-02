# ForgeAI Release Checklist & Verification Protocol

## 1. Release Readiness Gate

Before tagging and publishing a production release of ForgeAI, all items in this checklist must be verified and signed off.

---

## 2. Pre-Build Code Quality & Type Integrity

- [x] **TypeScript Strict Checks**: `npm run typecheck` (`tsc -p tsconfig.node.json && tsc -p tsconfig.web.json`) passes with 0 errors.
- [x] **ESLint Linting**: `npm run lint` passes with 0 errors and 0 warnings.
- [x] **Code Formatting**: `npm run format:check` confirms all files conform to Prettier configuration.
- [x] **No Uncommitted Diffs**: Git working tree is clean on the target release branch (`main`).

---

## 3. Automated Test Suite Validation

- [x] **Unit & Integration Tests**: `npm test` passes 100% of test suites:
  - `tests/core.test.ts` (Diff engine, vectors, hunks)
  - `tests/shared.test.ts` (Model roles, keep-alive normalization, text truncation)
  - `tests/seo.test.ts` (Technical SEO auditing and report verification)
  - `tests/agent-recovery.test.ts` (Empty-response recovery, JSON envelope fallback)
  - `tests/memory.test.ts` (Persistent project memory, CRUD, project isolation)
  - `tests/security.test.ts` (Subprocess environment sanitization, secret exclusion)
  - `tests/benchmark.test.ts` (AST parsing, vector dot products, context token packing)
  - `packages/core/src/parser.test.ts` (AST heuristic symbol extraction)
  - `packages/core/src/chunker.test.ts` (Code chunking and token packing)
  - `packages/core/src/router.test.ts` (Intelligent Model Router decisions & fallbacks)
  - `packages/core/src/orchestrator.test.ts` (Multi-agent team workflow, review gates)
  - `packages/core/src/diff.test.ts` (Diff patching and hunk selection)
  - `packages/core/src/vector.test.ts` (Vector normalization, cosine similarity, Top-K)
  - `packages/core/src/retrieval.test.ts` (Hybrid ranking and relevance scoring)
  - `packages/ai/src/envelope.test.ts` (Tool calling envelope protocol)
- [x] **Pass Rate**: 134/134 passing tests across 15 test suites.

---

## 4. Packaging & Platform Builds

### macOS Build (`dist:mac`):

- Run `npm run dist:mac`
- Output DMG/ZIP verified in `release/`
- Native binaries verified (`node-pty`, `node:sqlite`)
- App bundle launches and renders Monaco editor, terminal, and file explorer.

### Windows Build (`dist:win`):

- Run `npm run dist:win` (or cross-compilation pipeline)
- Output NSIS installer / portable executable verified in `release/`
- Undici `headersTimeout: 60000` verified for local Ollama cold-starts.
- Long path and backslash normalization verified across Windows paths.

---

## 5. Security & Permission Sign-Off

- [x] `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` verified in `window.ts`.
- [x] External URLs open in system browser (`setWindowOpenHandler` blocks in-app popups).
- [x] Subprocess environment scrubbing strips sensitive credentials before running agent tools.
- [x] Cloud metadata (`169.254.169.254`) and internal metadata endpoints blocked in `fetch_url`.
- [x] Project scanner ignores secrets (`.env*`, `.pem`, `.key`, `id_rsa*`, `.aws/`, `.ssh/`).
- [x] Destructive commands require explicit user approval via `PermissionBroker`.

---

## 6. Documentation Accuracy Audit

- [x] `README.md`: Accurately documents specialist agent roles, model routing, project memory, and setup instructions without exaggerations.
- [x] `docs/MODEL_MANAGEMENT.md`: Confirms 10 specialist model roles and provider adapters.
- [x] `docs/PROJECT_INTELLIGENCE.md`: Details AST symbol extraction, hybrid ranking, and secret exclusion.
- [x] `docs/MODEL_ROUTING.md`: Details deterministic fallback chains and capability checks.
- [x] `docs/AGENT_ORCHESTRATION.md`: Details multi-agent handoff contracts and verification gates.
- [x] `docs/PROJECT_MEMORY.md`: Details SQLite-backed persistent memory and UI controls.
- [x] `docs/IDE_WORKFLOWS.md`: Details Monaco selection quick edits, animations, and problem fixes.
- [x] `docs/LOCAL_PERFORMANCE.md`: Documents measured benchmarks and keep-alive optimization.
- [x] `docs/SECURITY_AUDIT.md`: Documents Electron process boundaries and residual risks.
- [x] `docs/KNOWN_LIMITATIONS.md`: Honestly details what is supported vs unsupported.
