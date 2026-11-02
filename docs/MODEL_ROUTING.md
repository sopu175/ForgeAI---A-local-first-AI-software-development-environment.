# ForgeAI --- Intelligent Model Router (Task 04 Deliverable)

> **Document Version:** 1.0.0  
> **Target Release:** ForgeAI 0.1.0+  
> **Status:** Implemented & Verified

---

## 1. Architectural Overview

The `ModelRouter` is ForgeAI's central decision engine for assigning models to requests and agents. Instead of letting agents make ad-hoc assumptions about which model to invoke, all tasks pass through `ModelRouter.route(request)`:

```
┌────────────────────────────────────────────────────────┐
│                   Route Request                        │
│   (Task Type, Required Capabilities, User Override)    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
               ┌────────────────────────┐
          Yes  │ User Override Provided?│
     ┌─────────┤   & Model Compatible?  │
     │         └────────────┬───────────┘
     │                      │ No
     │                      ▼
     │         ┌────────────────────────┐
     │    Yes  │ Primary Configured Role│
     ├─────────┤   Available & Valid?   │
     │         └────────────┬───────────┘
     │                      │ No
     │                      ▼
     │         ┌────────────────────────┐
     │    Yes  │  Fallback Role Chain   │
     ├─────────┤   Matches Capabilities?│
     │         └────────────┬───────────┘
     │                      │ No
     │                      ▼
     │         ┌────────────────────────┐
     │    Yes  │ Any Installed Provider │
     ├─────────┤   Model Compatible?    │
     │         └────────────┬───────────┘
     │                      │ No
     │                      ▼
     │         ┌────────────────────────┐
     │         │ Throw Diagnostic Error │
     │         └────────────────────────┘
     ▼
┌────────────────────────────────────────────────────────┐
│                    Route Decision                      │
│   (Binding: providerId + model, Reason, Fallback Flag) │
└────────────────────────────────────────────────────────┘
```

---

## 2. Supported Routing Tasks & Fallback Matrix

| Routing Task | Primary Configured Role | Fallback Chain | Required Default Capabilities |
| :--- | :--- | :--- | :--- |
| `chat` | `chat` | `coding` → `fast` | `chat: true` |
| `plan` | `plan` | `coding` → `review` → `chat` | `chat: true`, `thinking: optional` |
| `coding` | `coding` | `frontend` → `backend` → `chat` | `chat: true`, `tools: true` |
| `frontend` | `frontend` | `coding` → `chat` | `chat: true`, `tools: true` |
| `animation` | `animation` | `frontend` → `coding` → `chat` | `chat: true`, `tools: true` |
| `backend` | `backend` | `coding` → `chat` | `chat: true`, `tools: true` |
| `seo` | `seo` | `coding` → `chat` | `chat: true`, `tools: true` |
| `testing` | `testing` | `coding` → `chat` | `chat: true`, `tools: true` |
| `review` | `review` | `plan` → `coding` → `chat` | `chat: true` |
| `docs` | `chat` | `coding` | `chat: true` |
| `fast` | `fast` | `coding` → `chat` | `completion: true` |
| `embedding` | `embedding` | *None (strict)* | `embedding: true` |

---

## 3. Capability Verification & Safety Guarantees

1. **Tool-Calling Verification:** When an agent invokes tools (file editing, terminal execution, diff inspection), `ModelRouter` validates that the candidate model has `capabilities.tools: true`. Models lacking tool support (e.g. basic completion models) are disqualified from coding or agent roles.
2. **Embeddings Isolation:** Vector retrieval strictly enforces `capabilities.embedding: true`. Generation models are never mistakenly routed to vector embedding tasks.
3. **User Override Preservation:** When a user explicitly selects an active model in the chatbox header or modal, `ModelRouter` honors that override as long as it satisfies the minimum required capabilities for the task.
4. **Deterministic Reasoning:** Every `RouteDecision` includes an inspectable `reason` string explaining why that specific model was picked (e.g., `"Configured primary role for frontend"`, `"Fallback to configured coding role for animation"`, or `"User explicit override"`).

---

## 4. Diagnostics & Error Handling

If no installed model satisfies the required capabilities (for example, if all installed models lack tool-calling support, or if no embedding model is pulled), `ModelRouter` throws an explicit, actionable error:

```
No available model found with tool-calling capability for coding.
Check Models in Settings to download or enable a compatible model.
```

This prevents silent failures, unexpected runtime crashes, or garbled non-functional outputs.
