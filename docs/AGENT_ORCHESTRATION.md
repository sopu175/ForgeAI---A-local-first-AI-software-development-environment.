# ForgeAI --- Multi-Agent Orchestration & Specialist Agent Team (Task 05 Deliverable)

> **Document Version:** 1.0.0  
> **Target Release:** ForgeAI 0.1.0+  
> **Status:** Implemented & Verified

---

## 1. Architectural Overview

ForgeAI transitions from a single monolithic agent loop into a coordinated **Specialist Agent Team**. Rather than using one prompt to solve planning, backend APIs, GSAP animations, SEO, testing, and security reviews, ForgeAI routes tasks to specialized agents governed by the `MultiAgentOrchestrator`:

```
┌────────────────────────────────────────────────────────┐
│                      User Request                      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                     Planner Agent                      │
│     (Inspect Context, Break Down Tasks, Dependencies)  │
└───────────────────────────┬────────────────────────────┘
                            │ Structured Execution Plan
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Specialist Agents                    │
│  ┌─────────────────┐ ┌─────────────────┐ ┌───────────┐ │
│  │ Backend Agent   │ │ Frontend Agent  │ │ Animation │ │
│  │ (APIs, Schemas) │ │ (React, Next.js)│ │ (GSAP,3D) │ │
│  └─────────────────┘ └─────────────────┘ └───────────┘ │
└───────────────────────────┬────────────────────────────┘
                            │ Code Changes & Diffs
                            ▼
┌────────────────────────────────────────────────────────┐
│                     Testing Agent                      │
│     (Run & Author Unit, Integration, Regression Tests) │
└───────────────────────────┬────────────────────────────┘
                            │ Test Verification Report
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Code Review Agent                    │
│    (Inspect Diffs, Correctness, Security, A11y, Perf)  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                  Documentation & Report                │
│       (Updated Notes, Changes Summary, Final Verdict)  │
└────────────────────────────────────────────────────────┘
```

---

## 2. The Specialist Agent Team

### 1. Planner Agent (`planner`)
* **Scope:** Analyzes user goals, investigates repository context, and generates an ordered execution plan.
* **Permissions:** Read-only (`read_file`, `list_directory`, `get_project_overview`, `search_code`, `search_symbols`).
* **Contract:** Emits structured task lists, file change estimates, and risk flags. Strictly forbidden from modifying files.

### 2. Frontend Agent (`frontend`)
* **Scope:** React, Next.js (App Router / Pages), Vue, Svelte, Tailwind CSS, component layouts, and accessibility (WCAG 2.1 AA).
* **Permissions:** Full file editing, project overview, code search.
* **Contract:** Follows project design system; ensures responsive layouts, semantic tags, and type-safe props.

### 3. Animation Agent (`animation`)
* **Scope:** Motion engineering including GSAP, ScrollTrigger, Three.js, Framer Motion, and CSS transitions.
* **Permissions:** File editing, browser preview.
* **Contract:** Requires lifecycle cleanup (`ctx.revert()`, killing ticker loops on unmount), GPU transforms (`translate3d`), and `prefers-reduced-motion` compliance.

### 4. Backend Agent (`backend`)
* **Scope:** Server-side logic, API endpoints (REST / GraphQL / Next.js route handlers), database migrations (SQL / SQLite / Postgres), auth, and input validation.
* **Permissions:** File editing, schema queries.
* **Contract:** Sanitizes all inputs, adheres to defense-in-depth security, and provides deterministic error structures.

### 5. SEO Agent (`seo`)
* **Scope:** Technical search readiness, metadata, canonical URLs, sitemaps, robots directives, Open Graph, and JSON-LD structured data.
* **Permissions:** `seo_audit`, file inspection, metadata editing.
* **Contract:** Uses idiomatic framework metadata exports; strictly avoids keyword stuffing or fake pages.

### 6. Testing Agent (`testing`)
* **Scope:** Authors and executes focused tests (Vitest, Jest, Playwright, Pytest, PHPUnit).
* **Permissions:** Test file editing, `run_terminal_command` (restricted to test runners).
* **Contract:** Tests must fail before the change and pass after; reports exact pass/fail counts.

### 7. Code Review Agent (`review`)
* **Scope:** Principal engineer review: correctness, security vulnerabilities, performance regressions, accessibility, and missing tests.
* **Permissions:** Strictly read-only (`git_diff`, `read_file`, `search_code`).
* **Contract:** Emits line-anchored findings (`path:line`), classified by severity (`Critical`, `High`, `Medium`, `Low`), followed by a final verdict (`APPROVE` or `CHANGES_REQUESTED`).

### 8. Documentation Agent (`docs`)
* **Scope:** Setup guides, README updates, architectural decisions, and API reference documentation.
* **Permissions:** Markdown/documentation file editing.
* **Contract:** Grounded exclusively in verified working code.

---

## 3. Orchestration & State Machine

The orchestration pipeline coordinates specialist handoffs:

1. **Phase 1: Decomposition**  
   The user request is assessed by `planWorkflow(goal)`. If full-stack work is detected, `backend` is sequenced prior to `frontend`.
2. **Phase 2: Serialization & Concurrency**  
   Tasks touching the same files or shared packages are strictly serialized. Independent read-only analysis steps may be queried concurrently.
3. **Phase 3: Verification Gate**  
   Before any multi-step task can be marked `completed`, it must pass through the `testing` agent and receive approval from the `review` agent.
4. **Phase 4: Structured Reporting**  
   The final response summarizes:
   - What was implemented
   - Files created, modified, or deleted
   - Test execution results (passed, failed, skipped)
   - Code review verdict and any open manual items.

---

## 4. Security & Safety Controls

* **PermissionBroker Enforcement:** The orchestrator cannot bypass `PermissionBroker`. File modifications, installs, shell commands, and git commits require human-in-the-loop approvals according to settings policies (`once`, `always`).
* **Tool Sandboxing:** All file paths must pass `isWithinRoot` validation to guarantee agents cannot read or modify files outside the workspace root.

