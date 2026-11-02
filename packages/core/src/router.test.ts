import { describe, expect, it } from 'vitest';
import { ModelRouter } from './router';
import type { ModelInfo, ModelRole, RoleBinding } from '@forgeai/shared';

const MOCK_MODELS: ModelInfo[] = [
  {
    id: 'sopu-coder',
    name: 'Sopu Coder',
    providerId: 'ollama',
    providerKind: 'ollama',
    installed: true,
    capabilities: { tools: true, embedding: false, thinking: false, completion: true, vision: false },
  },
  {
    id: 'sopu-coder-fast',
    name: 'Sopu Coder Fast',
    providerId: 'ollama',
    providerKind: 'ollama',
    installed: true,
    capabilities: { tools: false, embedding: false, thinking: false, completion: true, vision: false },
  },
  {
    id: 'deepseek-r1:14b',
    name: 'DeepSeek R1 14B',
    providerId: 'ollama',
    providerKind: 'ollama',
    installed: true,
    capabilities: { tools: true, embedding: false, thinking: true, completion: true, vision: false },
  },
  {
    id: 'nomic-embed-text',
    name: 'Nomic Embed Text',
    providerId: 'ollama',
    providerKind: 'ollama',
    installed: true,
    capabilities: { tools: false, embedding: true, thinking: false, completion: false, vision: false },
  },
];

describe('ModelRouter', () => {
  it('routes to configured primary role when available', () => {
    const roles: Partial<Record<ModelRole, RoleBinding>> = {
      frontend: { providerId: 'ollama', model: 'sopu-coder' },
      plan: { providerId: 'ollama', model: 'deepseek-r1:14b' },
    };
    const router = new ModelRouter(() => MOCK_MODELS, () => roles);

    const decision = router.route({ task: 'frontend' });
    expect(decision.binding.model).toBe('sopu-coder');
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.reason).toContain('Configured primary role');
  });

  it('respects user overrides when capability is satisfied', () => {
    const roles: Partial<Record<ModelRole, RoleBinding>> = {
      coding: { providerId: 'ollama', model: 'sopu-coder' },
    };
    const router = new ModelRouter(() => MOCK_MODELS, () => roles);

    const decision = router.route({
      task: 'coding',
      userOverride: { providerId: 'ollama', model: 'deepseek-r1:14b' },
    });
    expect(decision.binding.model).toBe('deepseek-r1:14b');
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.reason).toContain('User explicit override');
  });

  it('falls back through fallback chain when primary role is not configured', () => {
    const roles: Partial<Record<ModelRole, RoleBinding>> = {
      coding: { providerId: 'ollama', model: 'sopu-coder' },
    };
    const router = new ModelRouter(() => MOCK_MODELS, () => roles);

    const decision = router.route({ task: 'animation' });
    expect(decision.binding.model).toBe('sopu-coder');
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.reason).toContain('Fallback to configured coding role');
  });

  it('enforces required capabilities and avoids models lacking tools', () => {
    const roles: Partial<Record<ModelRole, RoleBinding>> = {
      coding: { providerId: 'ollama', model: 'sopu-coder-fast' }, // lacking tools
    };
    const router = new ModelRouter(() => MOCK_MODELS, () => roles);

    const decision = router.route({
      task: 'coding',
      requiredCapabilities: { tools: true },
    });
    // Should skip sopu-coder-fast because it lacks tools, and find sopu-coder
    expect(decision.binding.model).toBe('sopu-coder');
    expect(decision.fallbackUsed).toBe(true);
  });

  it('routes embeddings only to embedding-capable models', () => {
    const roles: Partial<Record<ModelRole, RoleBinding>> = {
      embedding: { providerId: 'ollama', model: 'nomic-embed-text' },
    };
    const router = new ModelRouter(() => MOCK_MODELS, () => roles);

    const decision = router.route({ task: 'embedding' });
    expect(decision.binding.model).toBe('nomic-embed-text');
    expect(decision.model.capabilities.embedding).toBe(true);
  });

  it('throws a helpful diagnostic error when no compatible model exists', () => {
    const router = new ModelRouter(() => [], () => ({}));
    expect(() => router.route({ task: 'coding' })).toThrowError(/No available model found/);
  });
});
