import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../apps/desktop/src/main/agent/tools';
import {
  SOPU_CODER_RECIPE,
  SOPU_CODER_FAST_RECIPE,
  SOPU_FRONTEND_RECIPE,
  SOPU_ANIMATION_RECIPE,
  SOPU_BACKEND_RECIPE,
  SOPU_DEBUGGER_RECIPE,
  SOPU_RECIPES,
} from '@forgeai/shared';

describe('Tools & Model Training Services', () => {
  describe('Agent Tool Registry', () => {
    it('registers inspect_url tool for agent execution', () => {
      const names = toolRegistry.names('coding');
      expect(names).toContain('inspect_url');
    });

    it('rejects cloud metadata SSRF attempts', async () => {
      const mockContext = {
        runId: 'test-run',
        projectId: 'test-proj',
        agent: 'coding' as const,
        workspace: {} as any,
        search: {} as any,
        git: {} as any,
        indexer: {} as any,
        permissions: {} as any,
        db: {} as any,
        checkpoint: null,
        checkpoints: {} as any,
        signal: new AbortController().signal,
        emit: () => {},
        changedFiles: new Map(),
        commandsRun: [],
      };

      const result = await toolRegistry.execute(
        'inspect_url',
        { url: 'http://169.254.169.254/latest/meta-data/' },
        mockContext,
      );

      expect(result.ok).toBe(false);
      expect(result.observation).toContain('prohibited for security');
    });

    it('rejects invalid arguments for inspect_url', async () => {
      const mockContext = {
        runId: 'test-run',
        projectId: 'test-proj',
        agent: 'coding' as const,
        workspace: {} as any,
        search: {} as any,
        git: {} as any,
        indexer: {} as any,
        permissions: {} as any,
        db: {} as any,
        checkpoint: null,
        checkpoints: {} as any,
        signal: new AbortController().signal,
        emit: () => {},
        changedFiles: new Map(),
        commandsRun: [],
      };

      const result = await toolRegistry.execute('inspect_url', { url: '' }, mockContext);
      expect(result.ok).toBe(false);
      expect(result.observation).toContain('Invalid arguments');
    });
  });

  describe('Sopu AI Model Recipes', () => {
    it('defines sopu-coder recipe with deterministic parameters and full-stack system prompt', () => {
      expect(SOPU_CODER_RECIPE.model).toBe('sopu-coder');
      expect(SOPU_CODER_RECIPE.from).toBe('qwen2.5-coder:7b');
      expect(SOPU_CODER_RECIPE.parameters.temperature).toBe(0.2);
      expect(SOPU_CODER_RECIPE.parameters.num_ctx).toBe(8192);
      expect(SOPU_CODER_RECIPE.system).toContain('Sopu Coder');
      expect(SOPU_CODER_RECIPE.system).toContain('React');
      expect(SOPU_CODER_RECIPE.system).toContain('PHP');
      expect(SOPU_CODER_RECIPE.system).toContain('Python');
    });

    it('defines sopu-coder-fast recipe for inline completions and commits', () => {
      expect(SOPU_CODER_FAST_RECIPE.model).toBe('sopu-coder-fast');
      expect(SOPU_CODER_FAST_RECIPE.from).toBe('qwen3.5:4b');
      expect(SOPU_CODER_FAST_RECIPE.parameters.num_ctx).toBe(4096);
      expect(SOPU_CODER_FAST_RECIPE.system).toContain('Sopu Fast');
    });

    it('defines specialized developer recipes for frontend, animation, backend, and debugging', () => {
      expect(SOPU_FRONTEND_RECIPE.model).toBe('sopu-frontend');
      expect(SOPU_FRONTEND_RECIPE.system).toContain('Next.js App Router');
      expect(SOPU_FRONTEND_RECIPE.system).toContain('Tailwind CSS');

      expect(SOPU_ANIMATION_RECIPE.model).toBe('sopu-animation');
      expect(SOPU_ANIMATION_RECIPE.system).toContain('GSAP');
      expect(SOPU_ANIMATION_RECIPE.system).toContain('ScrollTrigger');
      expect(SOPU_ANIMATION_RECIPE.system).toContain('ctx.revert()');

      expect(SOPU_BACKEND_RECIPE.model).toBe('sopu-backend');
      expect(SOPU_BACKEND_RECIPE.system).toContain('Next.js Route Handlers');
      expect(SOPU_BACKEND_RECIPE.system).toContain('Zod');

      expect(SOPU_DEBUGGER_RECIPE.model).toBe('sopu-debugger');
      expect(SOPU_DEBUGGER_RECIPE.system).toContain('Sopu Debugger');
      expect(SOPU_DEBUGGER_RECIPE.parameters.temperature).toBe(0.1);

      // Verify all recipes are registered in SOPU_RECIPES map
      expect(Object.keys(SOPU_RECIPES)).toEqual([
        'sopu-coder',
        'sopu-coder-fast',
        'sopu-frontend',
        'sopu-animation',
        'sopu-backend',
        'sopu-debugger',
      ]);
    });
  });
});

