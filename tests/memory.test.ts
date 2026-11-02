import { describe, expect, it } from 'vitest';
import { Database } from '../apps/desktop/src/main/db';
import { buildSystemPrompt } from '../apps/desktop/src/main/agent/prompts';
import type { ProjectMemory } from '@forgeai/shared';

describe('Project Memory Service', () => {
  it('stores, updates, lists, and isolates project memory across projects', () => {
    const db = new Database(':memory:');

    const mem1: ProjectMemory = {
      id: 'mem-1',
      projectId: 'proj-a',
      kind: 'convention',
      title: 'Styling Convention',
      content: 'Always use Tailwind CSS utility classes.',
      source: 'user',
      createdAt: 1000,
      updatedAt: 1000,
    };

    const mem2: ProjectMemory = {
      id: 'mem-2',
      projectId: 'proj-a',
      kind: 'decision',
      title: 'Database Architecture',
      content: 'Use SQLite for local-first storage.',
      source: 'planner',
      createdAt: 1005,
      updatedAt: 1005,
    };

    const memOther: ProjectMemory = {
      id: 'mem-3',
      projectId: 'proj-b',
      kind: 'convention',
      title: 'Other Project Rule',
      content: 'Use CSS Modules.',
      createdAt: 1010,
      updatedAt: 1010,
    };

    // Insert memories
    db.upsertProjectMemory(mem1);
    db.upsertProjectMemory(mem2);
    db.upsertProjectMemory(memOther);

    // List all for proj-a
    const projAMemories = db.listProjectMemory('proj-a');
    expect(projAMemories).toHaveLength(2);
    expect(projAMemories.map((m) => m.id)).toEqual(['mem-2', 'mem-1']);

    // List filtered by kind
    const conventions = db.listProjectMemory('proj-a', 'convention');
    expect(conventions).toHaveLength(1);
    expect(conventions[0].title).toBe('Styling Convention');

    // Verify workspace isolation
    const projBMemories = db.listProjectMemory('proj-b');
    expect(projBMemories).toHaveLength(1);
    expect(projBMemories[0].title).toBe('Other Project Rule');

    // Update memory (on conflict upsert)
    db.upsertProjectMemory({
      ...mem1,
      content: 'Always use Tailwind CSS with prefix tw-.',
      updatedAt: 2000,
    });
    const updated = db.listProjectMemory('proj-a', 'convention');
    expect(updated[0].content).toBe('Always use Tailwind CSS with prefix tw-.');

    // Delete memory
    db.deleteProjectMemory('mem-1');
    expect(db.listProjectMemory('proj-a')).toHaveLength(1);
    expect(db.listProjectMemory('proj-a')[0].id).toBe('mem-2');

    db.close();
  });

  it('injects persistent memory into the agent system prompt', () => {
    const memoryContext = '[CONVENTION] Code Style: Strictly TypeScript strict mode.\n[DECISION] Auth: Use session tokens.';
    const prompt = buildSystemPrompt({
      agent: 'coding',
      workspaceName: 'test-app',
      root: '/test',
      stack: {
        languages: ['typescript'],
        frameworks: ['react'],
        packageManagers: ['npm'],
        testRunners: ['vitest'],
        hasGit: true,
        entryPoints: [],
      },
      rules: [],
      treeSummary: 'src/index.ts',
      retrieval: 'no chunks',
      activeFiles: [],
      memory: memoryContext,
      toolNames: ['read_file', 'edit_file'],
      maxSteps: 10,
    });

    expect(prompt).toContain('## Project memory & conventions (persistent user knowledge)');
    expect(prompt).toContain('[CONVENTION] Code Style: Strictly TypeScript strict mode.');
    expect(prompt).toContain('[DECISION] Auth: Use session tokens.');
  });
});
