import { safeStorage } from 'electron';
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_KEEP_ALIVE,
  SOPU_CODER_RECIPE,
  SOPU_CODER_FAST_RECIPE,
  PROVIDER_PRESETS,
  enrichModel,
  recommendRoles,
  type ModelInfo,
  type ModelRole,
  type ProviderConfig,
  type ProviderHealth,
  type ProviderKind,
  type PullProgress,
  type RoleBinding,
  type RunningModel,
} from '@forgeai/shared';
import { buildProvider, type AIProvider } from '@forgeai/ai';
import { ModelRouter, type RouteDecision, type RouteRequest } from '@forgeai/core';
import type { Database } from '../db';
import type { SettingsService } from './settings';
import type { Broadcast } from './workspace';

interface ModelCache {
  models: ModelInfo[];
  fetchedAt: number;
}

export class ProvidersService {
  private keys = new Map<string, string>();
  private cache: ModelCache = { models: [], fetchedAt: 0 };
  private pullController: AbortController | null = null;
  private pulling: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly broadcast: Broadcast,
  ) {
    this.seed();
    this.loadKeys();
  }

  private seed(): void {
    this.db.seedProviders(
      PROVIDER_PRESETS.map((preset) => ({
        ...preset,
        id: preset.kind,
      })),
    );
    // Migrate installs created before ForgeAI standardised on localhost.
    const ollama = this.db.listProviderRows().find((provider) => provider.kind === 'ollama');
    if (ollama) {
      // Never overwrite 127.0.0.1 on Windows because Ollama binds strictly to IPv4 127.0.0.1.
      const staleUrl = process.platform !== 'win32' && /^http:\/\/(0\.0\.0\.0):11434\/?$/.test(ollama.baseUrl);
      // Older builds unloaded the model after 10 minutes. The whole point of a
      // single local model is to keep it resident, so repair that setting.
      const staleKeepAlive = !ollama.config.keepAlive || ollama.config.keepAlive === '10m';
      if (staleUrl || staleKeepAlive) {
        this.db.upsertProvider({
          ...ollama,
          baseUrl: staleUrl ? DEFAULT_OLLAMA_BASE_URL : ollama.baseUrl,
          config: { ...ollama.config, keepAlive: DEFAULT_OLLAMA_KEEP_ALIVE },
        });
      }
    }
    if (!this.db.listProviderRows().some((provider) => provider.kind === 'custom')) {
      // Custom endpoint slot, disabled until the user configures it.
      this.db.upsertProvider({
        id: 'custom',
        kind: 'custom',
        name: 'Custom endpoint',
        baseUrl: 'http://127.0.0.1:8081/v1',
        enabled: false,
        config: { temperature: 0.2, contextLength: 8192 },
      });
    }
  }

  private loadKeys(): void {
    for (const row of this.db.listProviderRows()) {
      if (!row.apiKeyRef) continue;
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(row.apiKeyRef, 'base64'));
        this.keys.set(row.id, decrypted);
      } catch {
        // Key belongs to another OS user or keychain was reset; ignore.
      }
    }
  }

  list(): ProviderConfig[] {
    return this.db.listProviderRows().map(({ apiKeyRef: _ignored, ...provider }) => ({
      ...provider,
      hasApiKey: this.keys.has(provider.id),
    }));
  }

  private row(id: string): (ProviderConfig & { apiKeyRef?: string }) | undefined {
    return this.db.listProviderRows().find((provider) => provider.id === id);
  }

  getApiKey(id: string): string | undefined {
    return this.keys.get(id);
  }

  upsert(provider: ProviderConfig): ProviderConfig {
    this.db.upsertProvider(provider);
    this.invalidate();
    return { ...provider, hasApiKey: this.keys.has(provider.id) };
  }

  remove(id: string): void {
    this.db.deleteProvider(id);
    this.keys.delete(id);
    this.invalidate();
  }

  setApiKey(id: string, key: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS keychain encryption is unavailable; cannot store an API key securely');
    }
    const encrypted = safeStorage.encryptString(key).toString('base64');
    this.db.setProviderKey(id, encrypted);
    this.keys.set(id, key);
    this.invalidate();
  }

  clearApiKey(id: string): void {
    this.db.setProviderKey(id, null);
    this.keys.delete(id);
    this.invalidate();
  }

  build(id: string): AIProvider {
    const config = this.list().find((provider) => provider.id === id);
    if (!config) throw new Error(`Provider "${id}" is not configured`);
    if (!config.enabled) throw new Error(`Provider "${config.name}" is disabled`);
    return buildProvider(config, this.keys.get(id));
  }

  async health(id: string): Promise<ProviderHealth> {
    try {
      const provider = this.build(id);
      const health = await provider.health();
      return { providerId: id, ...health };
    } catch (error) {
      return {
        providerId: id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async models(refresh = false): Promise<ModelInfo[]> {
    const now = Date.now();
    if (!refresh && this.cache.models.length > 0 && now - this.cache.fetchedAt < 15_000) {
      return this.cache.models;
    }
    const enabled = this.list().filter((provider) => provider.enabled);
    const results = await Promise.allSettled(
      enabled.map(async (config) => {
        const provider = this.build(config.id);
        const models = await provider.listModels();
        return models.map((model) =>
          enrichModel({
            ...model,
            providerId: config.id,
            providerKind: config.kind,
          }),
        );
      }),
    );
    const models = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    // Local models first; stable by provider and name.
    models.sort((a, b) => {
      const localA =
        a.providerKind === 'ollama' ||
        a.providerKind === 'lmstudio' ||
        a.providerKind === 'llamacpp' ||
        a.providerKind === 'vllm';
      const localB =
        b.providerKind === 'ollama' ||
        b.providerKind === 'lmstudio' ||
        b.providerKind === 'llamacpp' ||
        b.providerKind === 'vllm';
      if (localA !== localB) return localA ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    this.cache = { models, fetchedAt: now };
    return models;
  }

  invalidate(): void {
    this.cache.fetchedAt = 0;
  }

  installedIds(): Set<string> {
    return new Set(this.cache.models.map((model) => model.id));
  }

  findModel(id: string): ModelInfo | undefined {
    return this.cache.models.find((model) => model.id === id);
  }

  async route(request: RouteRequest): Promise<RouteDecision> {
    const models = await this.models(false);
    const router = new ModelRouter(
      () => models,
      () => this.settings.get().modelRoles,
    );
    return router.route(request);
  }

  async resolveRole(role: ModelRole): Promise<RoleBinding> {
    const bound = this.settings.role(role);
    const models = await this.models(false);
    if (bound) {
      const provider = this.list().find((item) => item.id === bound.providerId);
      const modelExists = models.some((m) => m.providerId === bound.providerId && m.id === bound.model);
      if (provider?.enabled && modelExists) return bound;
    }
    const recommended = recommendRoles(models);
    const pick = recommended[role] ?? recommended.coding ?? recommended.chat;
    if (pick) {
      // Auto-heal settings so deleted or non-existent models are replaced with valid models
      try {
        await this.settings.update({ modelRoles: { ...this.settings.get().modelRoles, [role]: pick } });
      } catch {
        // ignore
      }
      return pick;
    }
    const fallback = models.find((model) =>
      role === 'embedding' ? model.capabilities.embedding : !model.capabilities.embedding,
    );
    if (!fallback) {
      throw new Error(
        role === 'embedding'
          ? 'No embedding model installed. Vector search is optional; keyword retrieval stays available. Pull an embedding model in Models to enable it.'
          : 'No local model found. Start Ollama and pull a model, then select it in the model picker.',
      );
    }
    const autoFallback = { providerId: fallback.providerId, model: fallback.id };
    try {
      await this.settings.update({ modelRoles: { ...this.settings.get().modelRoles, [role]: autoFallback } });
    } catch {
      // ignore
    }
    return autoFallback;
  }

  async resolveChat(preferred?: { providerId?: string; model?: string }): Promise<RoleBinding> {
    if (preferred?.providerId && preferred.model) {
      return { providerId: preferred.providerId, model: preferred.model };
    }
    return this.resolveRole('chat');
  }

  async pull(providerId: string, model: string): Promise<void> {
    if (this.pulling) throw new Error(`Already pulling ${this.pulling}`);
    const provider = this.build(providerId);
    if (!provider.pull) throw new Error('This provider does not support model downloads');
    const controller = new AbortController();
    this.pullController = controller;
    this.pulling = model;
    try {
      let pullTarget = model;
      if (model === 'sopu-coder') pullTarget = SOPU_CODER_RECIPE.from;
      else if (model === 'sopu-coder-fast') pullTarget = SOPU_CODER_FAST_RECIPE.from;

      for await (const progress of provider.pull(pullTarget, controller.signal)) {
        this.broadcast('ai:pull', { ...progress, model });
      }

      // Automatically compile Sopu AI custom model after pulling base weights or custom model
      if (providerId === 'ollama' && provider.createModel) {
        if (pullTarget === SOPU_CODER_RECIPE.from || model === 'sopu-coder') {
          this.broadcast('ai:pull', {
            providerId,
            model: 'sopu-coder',
            status: 'Creating customized sopu-coder from Modelfile recipe…',
            percent: 99,
            done: false,
          });
          await provider.createModel(SOPU_CODER_RECIPE).catch(() => undefined);
          this.settings.update({
            modelRoles: {
              ...this.settings.get().modelRoles,
              chat: { providerId: 'ollama', model: 'sopu-coder' },
              coding: { providerId: 'ollama', model: 'sopu-coder' },
              plan: { providerId: 'ollama', model: 'sopu-coder' },
              frontend: { providerId: 'ollama', model: 'sopu-coder' },
              animation: { providerId: 'ollama', model: 'sopu-coder' },
              backend: { providerId: 'ollama', model: 'sopu-coder' },
              seo: { providerId: 'ollama', model: 'sopu-coder' },
              testing: { providerId: 'ollama', model: 'sopu-coder' },
              review: { providerId: 'ollama', model: 'sopu-coder' },
            },
          });
        }
        if (pullTarget === SOPU_CODER_FAST_RECIPE.from || model === 'sopu-coder-fast') {
          this.broadcast('ai:pull', {
            providerId,
            model: 'sopu-coder-fast',
            status: 'Creating customized sopu-coder-fast from Modelfile recipe…',
            percent: 99,
            done: false,
          });
          await provider.createModel(SOPU_CODER_FAST_RECIPE).catch(() => undefined);
          this.settings.update({
            modelRoles: {
              ...this.settings.get().modelRoles,
              fast: { providerId: 'ollama', model: 'sopu-coder-fast' },
            },
          });
        }
      }

      this.broadcast('ai:pull', {
        providerId,
        model,
        status: 'success',
        percent: 100,
        done: true,
      } satisfies PullProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.broadcast('ai:pull', {
        providerId,
        model,
        status: `error: ${message}`,
        done: true,
        error: message,
      } satisfies PullProgress);
      throw error;
    } finally {
      this.pullController = null;
      this.pulling = null;
      this.invalidate();
    }
  }

  cancelPull(): void {
    this.pullController?.abort(new Error('Download cancelled'));
  }

  async removeModel(providerId: string, model: string): Promise<void> {
    const provider = this.build(providerId);
    if (!provider.deleteModel) throw new Error('This provider does not support removing models');
    await provider.deleteModel(model);
    this.invalidate();
  }

  /**
   * Delete every model on a provider except `keep`. Used by the single-model
   * workflow so the runtime never has to swap weights. Role bindings that point
   * at deleted models are cleared afterwards.
   */
  async keepOnly(providerId: string, keep: string[]): Promise<string[]> {
    const wanted = new Set(keep.map((name) => name.replace(/:latest$/, '')));
    const models = await this.models(true);
    const provider = this.build(providerId);
    if (!provider.deleteModel) throw new Error('This provider does not support removing models');
    const targets = models
      .filter((model) => model.providerId === providerId)
      .filter((model) => !wanted.has(model.id.replace(/:latest$/, '')))
      .filter((model) => !model.capabilities.embedding);
    const removed: string[] = [];
    for (const model of targets) {
      try {
        await provider.deleteModel(model.id);
        removed.push(model.id);
      } catch {
        // Keep deleting the rest; a single failure should not abort the cleanup.
      }
    }
    this.invalidate();
    if (removed.length > 0) {
      const roles = { ...this.settings.get().modelRoles };
      let changed = false;
      for (const [role, binding] of Object.entries(roles) as [ModelRole, RoleBinding | undefined][]) {
        if (!binding) continue;
        if (binding.providerId === providerId && removed.includes(binding.model)) {
          delete roles[role];
          changed = true;
        }
      }
      if (changed) this.settings.update({ modelRoles: roles });
    }
    return removed;
  }

  async running(): Promise<RunningModel[]> {
    const enabled = this.list().filter((provider) => provider.enabled);
    const results = await Promise.allSettled(
      enabled
        .filter((provider) => provider.kind === 'ollama')
        .map((provider) => this.build(provider.id).running?.() ?? []),
    );
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }

  async embed(inputs: string[], signal: AbortSignal): Promise<{ vectors: number[][]; model: string }> {
    const binding = await this.resolveRole('embedding');
    const provider = this.build(binding.providerId);
    const response = await provider.embed({ providerId: binding.providerId, model: binding.model, inputs }, signal);
    return { vectors: response.vectors, model: response.model };
  }

  kindEnabled(kind: ProviderKind): boolean {
    return this.list().some((provider) => provider.kind === kind && provider.enabled);
  }

  async recommendedRoles(): Promise<Partial<Record<ModelRole, RoleBinding>>> {
    return recommendRoles(await this.models(false));
  }
}
