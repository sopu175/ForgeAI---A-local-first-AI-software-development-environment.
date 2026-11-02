import type { ProjectStack, RuleFile, SpecPhase } from '@forgeai/shared';
import { composeRules } from '@forgeai/core';

export interface SpecPromptInput {
  feature: string;
  title: string;
  description: string;
  phase: SpecPhase;
  stack: ProjectStack;
  rules: RuleFile[];
  context: string;
  tree: string;
  requirements?: string;
  design?: string;
}

function common(input: SpecPromptInput): string {
  const rules = composeRules(input.rules, { maxChars: 8000 });
  return `Feature slug: ${input.feature}
Feature title: ${input.title}
User description:
${input.description}

Project stack: ${input.stack.languages.join(', ')} | ${input.stack.frameworks.join(', ')} | tests: ${input.stack.testRunners.join(', ')}
Project rules:
${rules || '(none)'}

Project structure:
${input.tree}

Relevant existing code:
${input.context || '(index not available)'}
`;
}

export function buildRequirementsPrompt(input: SpecPromptInput): string {
  return `Create the REQUIREMENTS document for this feature. This is phase 1 of a spec-driven workflow.

${common(input)}

Write Markdown with exactly these sections:
# {Feature title}
## Overview
2-4 sentences on the problem and outcome.
## User Stories
Numbered US-1, US-2…, each "As a …, I want …, so that …".
## Functional Requirements
Numbered REQ-1, REQ-2…, each precise and testable. Include edge cases and error behavior.
## Non-Functional Requirements
Performance, security, accessibility, compatibility as applicable.
## Acceptance Criteria
A checkbox list (AC-1, AC-2…) that a reviewer can verify. Every REQ must be covered.
## Open Questions
Only genuine ambiguities; if none, write "None."

Ground requirements in the existing codebase where relevant. Do not propose implementation details here. Do not wrap the whole document in a code fence.`;
}

export function buildDesignPrompt(input: SpecPromptInput): string {
  return `Create the DESIGN document for this feature. This is phase 2 of a spec-driven workflow.

${common(input)}

Approved requirements:
${input.requirements?.slice(0, 20_000) ?? '(not available)'}

Write Markdown with exactly these sections:
# Design: {Feature title}
## Summary
The chosen approach in 3-5 sentences.
## Architecture
Components, data flow, and how they integrate with existing code. Reference real paths.
## Data Model
Types, schemas, migrations, persistence. State "No persistent data" if not applicable.
## Interfaces
Functions, IPC channels, HTTP endpoints, props, events — with signatures.
## Implementation Plan
Ordered steps mapped to concrete files.
## Dependencies
Existing modules to reuse, new packages (justified), and external requirements.
## Risks & Trade-offs
At least 3 concrete risks with mitigations.
## Testing Strategy
Unit, integration, manual checks; name the test runner from the stack.
## Migration & Rollout
Only if relevant; otherwise "Not applicable."

Do not write code files. Do not wrap the whole document in a code fence.`;
}

export function buildTasksPrompt(input: SpecPromptInput): string {
  return `Create the IMPLEMENTATION TASKS document. This is phase 3 of a spec-driven workflow.

${common(input)}

Approved requirements:
${input.requirements?.slice(0, 14_000) ?? '(not available)'}

Approved design:
${input.design?.slice(0, 18_000) ?? '(not available)'}

Produce 4-14 small, sequential, independently verifiable tasks. Each task should be completable in one focused agent run. Use this EXACT format, one heading per task, with no other headings:

### T1 — Short imperative title
- depends-on: none
- files: src/path/one.ts, src/path/two.ts
- acceptance: observable check one; observable check two

Short implementation notes may follow as plain text. Number tasks T1, T2, … in dependency order. Use 'none' when there are no dependencies. Only reference files that exist or that the design explicitly creates. Do not wrap the document in a code fence.`;
}
