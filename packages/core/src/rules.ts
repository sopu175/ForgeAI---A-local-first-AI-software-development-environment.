import type { RuleFile } from '@forgeai/shared';

export const PROJECT_RULE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  '.kiro/steering.md',
  '.kiro/steering/product.md',
  '.kiro/steering/tech.md',
  '.kiro/steering/structure.md',
  'FORGEAI.md',
  '.sopuforge/rules.md',
];

export const PROJECT_RULE_DIRS = ['.cursor/rules', '.sopuforge/rules', '.kiro/rules'];

export interface RuleBudget {
  maxChars: number;
}

const PRIORITY = ['AGENTS.md', 'FORGEAI.md', 'CLAUDE.md', '.cursorrules'];

export function composeRules(rules: RuleFile[], budget: RuleBudget = { maxChars: 24_000 }): string {
  if (rules.length === 0) return '';
  const sorted = [...rules].sort((a, b) => {
    const aPriority = PRIORITY.includes(a.path) ? 0 : a.scope === 'project' ? 1 : 2;
    const bPriority = PRIORITY.includes(b.path) ? 0 : b.scope === 'project' ? 1 : 2;
    return aPriority - bPriority || a.path.localeCompare(b.path);
  });
  const sections: string[] = [];
  let used = 0;
  for (const rule of sorted) {
    if (!rule.content.trim()) continue;
    const header = `#### ${rule.scope === 'global' ? 'Global rule' : 'Project rule'}: ${rule.path}`;
    const content = rule.content.trim();
    const slice = content.slice(0, Math.max(0, budget.maxChars - used - header.length));
    if (slice.length < 40) break;
    sections.push(`${header}\n${slice}`);
    used += header.length + slice.length;
    if (used >= budget.maxChars) break;
  }
  return sections.join('\n\n');
}

export function defaultGlobalRulesTemplate(): string {
  return `# Global ForgeAI rules

- Prefer small, focused changes that match the existing architecture.
- Never delete files or rewrite unrelated code without being asked.
- Read before you write. Search the codebase before inventing new abstractions.
- Run the project's formatter, type checker and tests after changes when available.
- Explain risky or destructive operations before proposing them.
- Keep comments purposeful; do not narrate obvious code.
`;
}
