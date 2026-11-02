# ForgeAI Security Audit & Boundary Hardening

## 1. Executive Summary

This security audit reviews and strengthens the defensive boundaries of the ForgeAI desktop application, agent execution engine, IPC channels, and filesystem access layers.

ForgeAI operates as a **local-first AI development environment**. Because AI models can generate shell commands and propose filesystem modifications, the architecture strictly enforces defense-in-depth:
- No automatic execution of destructive commands
- Workspace path containment and symlink escape checks
- Subprocess environment variable sanitization
- Exclusion of credentials from vector embeddings and RAG context
- Cloud metadata and link-local SSRF protection

---

## 2. Electron Architecture & Process Isolation

The desktop renderer is strictly sandboxed in `apps/desktop/src/main/window.ts`:
- **`contextIsolation: true`**: The renderer execution context is completely isolated from the Node.js main process.
- **`nodeIntegration: false`**: Direct Node.js access is prohibited inside the renderer.
- **`sandbox: true`**: Chromium's OS-level sandbox enforces process restrictions.
- **Navigation & External Links**:
  - `will-navigate` blocks unvetted in-app navigations.
  - `setWindowOpenHandler` denies all popup windows and safely delegates valid `https://` / `http://` links to the host system default browser.
  - `will-attach-webview` is intercepted and denied.
- **Content Security Policy (CSP)**:
  - Production builds enforce `default-src 'self'`, `frame-src 'none'`, `object-src 'none'`, and `form-action 'none'`.
- **System Permissions**:
  - Permission check handlers automatically reject all unneeded device permissions (camera, microphone, geolocation, notifications).

---

## 3. Filesystem Path Confinement & Traversal Protection

In `apps/desktop/src/main/services/workspace.ts`:
- **`resolveSafe(relative: string)`**:
  - Rejects traversal attempts (`..` segments).
  - Validates that normalized paths reside strictly within `this.root`.
  - Normalizes case-insensitivity on Windows (`win32`).
  - Resolves symlinks via `fs.realpath` to prevent symlink directory escapes outside the workspace.
  - Explicitly protects `.git` internals from automated agent edits.

---

## 4. Subprocess Execution & Environment Sanitization

In `apps/desktop/src/main/agent/tools.ts`:
- **Subprocess Environment Scrubbing (`sanitizeSubprocessEnv`)**:
  - Developer machines frequently store sensitive tokens in ambient shell environments (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `DATABASE_URL`, `*_PASSWORD`, `*_SECRET`).
  - The agent execution layer scrubs these variables prior to spawning any command or test runner.
  - Essential operating system keys (`PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR`, `SYSTEMROOT`, `WINDIR`) are preserved.
- **Interactive Approval (`PermissionBroker`)**:
  - Shell commands (`run_command`), test execution (`run_tests`), and dependency installations (`install_dependencies`) require explicit user consent.
  - Destructive commands (`rm -rf`, `git reset --hard`, `mkfs`) trigger high-visibility warning dialogues.

---

## 5. Network Egress & SSRF Protection

In `fetchUrlTool` (`apps/desktop/src/main/agent/tools.ts`):
- Egress requests require network permission approval.
- **Cloud Metadata & SSRF Defense**:
  - Access to link-local and cloud metadata endpoints (`169.254.169.254`, `169.254.*`, `metadata.google.internal`, `instance-data`) is strictly prohibited.
- Content fetched from documentation sites is sanitized by stripping `<script>` and `<style>` blocks before ingestion into LLM context.

---

## 6. Secret Exclusion in RAG Indexing

In `packages/core/src/scanner.ts` and `apps/desktop/src/main/services/indexer.ts`:
- Scanner ignores sensitive credential paths (`.env*`, `.pem`, `.key`, `.p12`, `id_rsa*`, `.aws/**`, `.ssh/**`).
- Secrets and private keys are never chunked, never converted to vector embeddings, and never sent to local or remote LLM models.

---

## 7. Automated Security Regression Testing

Security boundaries are verified via `tests/security.test.ts`:
- Subprocess environment sanitization strips API keys and credentials while preserving safe system variables.
- Secret path exclusion verifies that credentials and certificates are ignored during indexing.
- 134/134 test cases passing across the entire codebase.

---

## 8. Documented Residual Risks

1. **User-Approved Shell Execution**: If a user approves a destructive command (e.g. `rm -rf .`), the shell will execute it. The PermissionBroker provides human verification but cannot replace developer discretion.
2. **Local Port Invocations**: Local developer servers (e.g. `http://localhost:3000`) run under local development assumptions. Egress to non-metadata URLs is permitted with explicit user approval.
3. **Indirect Prompt Injection**: If a repository contains adversarial text designed to manipulate LLM tool generation, the PermissionBroker and read-only role restrictions provide the primary boundary against unauthorized execution.
