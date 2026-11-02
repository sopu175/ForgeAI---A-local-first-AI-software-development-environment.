import { describe, expect, it } from 'vitest';
import type { AgentKind } from '@forgeai/shared';
import { toolRegistry } from '../apps/desktop/src/main/agent/tools';
import { buildSystemPrompt } from '../apps/desktop/src/main/agent/prompts';
import { agentKindLabel } from '../apps/desktop/src/main/agent/runtime';

const ALL_AGENTS: AgentKind[] = [
  'coding',
  'planner',
  'frontend',
  'animation',
  'backend',
  'debugging',
  'testing',
  'review',
  'docs',
  'seo',
];

describe('All 10 Autonomous Agents Verification Suite', () => {
  it('verifies all 10 agents have defined system prompts and roles', () => {
    for (const agent of ALL_AGENTS) {
      const prompt = buildSystemPrompt({
        agent,
        rules: [],
        stack: {
          languages: ['TypeScript', 'JavaScript'],
          frameworks: ['React', 'Next.js'],
          packageManagers: ['npm'],
          testRunners: ['vitest'],
          hasGit: true,
          entryPoints: ['src/index.ts'],
        },
        activeFiles: [{ path: 'src/app.tsx', content: 'export const App = () => <div>Hello</div>;' }],
        files: ['package.json', 'src/app.tsx'],
        toolNames: ['read_file', 'edit_file', 'inspect_url'],
        maxSteps: 20,
      });

      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain('You are ForgeAI');
    }
  });

  it('verifies all 10 agents have friendly display labels', () => {
    for (const agent of ALL_AGENTS) {
      const label = agentKindLabel(agent);
      expect(label).toBeDefined();
      expect(label).toContain('Agent');
    }

    expect(agentKindLabel('coding')).toBe('Coding Agent');
    expect(agentKindLabel('planner')).toBe('Planner Agent');
    expect(agentKindLabel('frontend')).toBe('Frontend Agent');
    expect(agentKindLabel('animation')).toBe('Animation Agent');
    expect(agentKindLabel('backend')).toBe('Backend Agent');
    expect(agentKindLabel('debugging')).toBe('Debugging Agent');
    expect(agentKindLabel('testing')).toBe('Testing Agent');
    expect(agentKindLabel('review')).toBe('Review Agent');
    expect(agentKindLabel('docs')).toBe('Docs Agent');
    expect(agentKindLabel('seo')).toBe('SEO Agent');
  });

  it('enforces read-only tool access for Planner and Review agents', () => {
    const plannerTools = toolRegistry.forAgent('planner');
    expect(plannerTools.length).toBeGreaterThan(0);
    expect(plannerTools.every((t) => t.readOnly)).toBe(true);
    expect(toolRegistry.names('planner')).not.toContain('write_file');
    expect(toolRegistry.names('planner')).not.toContain('delete_file');
    expect(toolRegistry.names('planner')).not.toContain('run_command');

    const reviewTools = toolRegistry.forAgent('review');
    expect(reviewTools.length).toBeGreaterThan(0);
    expect(reviewTools.every((t) => t.readOnly)).toBe(true);
    expect(toolRegistry.names('review')).not.toContain('edit_file');
  });

  it('provisions execution and modification tools for Coding, Frontend, Animation, Backend, Debugging, Testing, and Docs', () => {
    const activeAgents: AgentKind[] = [
      'coding',
      'frontend',
      'animation',
      'backend',
      'debugging',
      'testing',
      'docs',
      'seo',
    ];

    for (const agent of activeAgents) {
      const toolNames = toolRegistry.names(agent);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('inspect_url');
    }
  });

  it('provisions specialized seo_audit tool strictly for SEO agent', () => {
    expect(toolRegistry.names('seo')).toContain('seo_audit');
    expect(toolRegistry.names('coding')).not.toContain('seo_audit');
    expect(toolRegistry.names('planner')).not.toContain('seo_audit');
    expect(toolRegistry.names('review')).not.toContain('seo_audit');
  });
});
