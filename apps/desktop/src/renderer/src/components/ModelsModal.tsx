import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Info,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_OLLAMA_MODEL,
  RECOMMENDED_DOWNLOADS,
  type ModelInfo,
  type ModelRole,
  type ProviderConfig,
  type ProviderHealth,
  type ProviderKind,
  type PullProgress,
  type RunningModel,
} from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { bytes, errorMessage, shortModelName } from '../lib/format';
import { Modal, ModalHeader, ProgressBar, SectionLabel, Spinner, StatusDot, Toggle, cn } from './ui';

type Tab = 'models' | 'providers' | 'roles';

const ROLE_LABELS: Record<ModelRole, string> = {
  chat: 'Chat',
  plan: 'Planning',
  coding: 'Coding agent',
  review: 'Review',
  fast: 'Fast / completions',
  embedding: 'Embeddings',
};

const ROLE_HINTS: Record<ModelRole, string> = {
  chat: 'Conversational answers and explanations.',
  plan: 'Requirements and design generation.',
  coding: 'Autonomous coding agent and tool calling.',
  review: 'Diff review, debugging and critique.',
  fast: 'Inline completion and quick edits.',
  embedding: 'Project indexing and semantic search.',
};

const KIND_LABELS: Record<ProviderKind, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  llamacpp: 'llama.cpp',
  vllm: 'vLLM',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  custom: 'Custom',
};

function capabilityChips(model: ModelInfo): string[] {
  const chips: string[] = [];
  if (model.capabilities.tools) chips.push('tools');
  if (model.capabilities.thinking) chips.push('thinking');
  if (model.capabilities.vision) chips.push('vision');
  if (model.capabilities.embedding) chips.push('embedding');
  if (model.capabilities.completion) chips.push('completion');
  return chips;
}

function bindingKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

export function ModelsModal() {
  const open = useAppStore((state) => state.modelsOpen);
  const setOpen = useAppStore((state) => state.setModelsOpen);
  const models = useAppStore((state) => state.models);
  const providers = useAppStore((state) => state.providers);
  const settings = useAppStore((state) => state.settings);
  const runtime = useAppStore((state) => state.runtime);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const refreshModels = useAppStore((state) => state.refreshModels);
  const refreshRuntime = useAppStore((state) => state.refreshRuntime);
  const ensureRuntime = useAppStore((state) => state.ensureRuntime);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const toast = useAppStore((state) => state.toast);
  const askConfirm = useAppStore((state) => state.askConfirm);

  const [tab, setTab] = useState<Tab>('models');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<Record<string, ProviderHealth | 'checking'>>({});
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [pullModel, setPullModel] = useState('sopu-coder');
  const [pulling, setPulling] = useState<PullProgress | null>(null);
  const [recommended, setRecommended] = useState<Partial<Record<ModelRole, { providerId: string; model: string }>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  const load = async (showErrors = true) => {
    setLoading(true);
    try {
      await refreshModels(showErrors);
      setRunning(await window.forge.providers.running().catch(() => []));
      setRecommended(await window.forge.settings.recommendRoles().catch(() => ({})));
      await refreshRuntime();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    const off = window.forge.events.on('ai:pull', (progress) => {
      setPulling(progress.done ? null : progress);
      if (progress.done) {
        if (progress.error) toast('error', `Download failed: ${progress.error}`);
        else toast('success', `${progress.model} is installed`);
        void load(false);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const installed = useMemo(() => models.filter((model) => model.installed), [models]);
  const ollama = providers.find((provider) => provider.kind === 'ollama');
  const selectedKey = selectedModel ? bindingKey(selectedModel.providerId, selectedModel.model) : '';

  if (!open) return null;

  const checkHealth = async (provider: ProviderConfig) => {
    setHealth((current) => ({ ...current, [provider.id]: 'checking' }));
    try {
      const result = await window.forge.providers.health(provider.id);
      setHealth((current) => ({ ...current, [provider.id]: result }));
    } catch (error) {
      setHealth((current) => ({
        ...current,
        [provider.id]: { providerId: provider.id, ok: false, error: errorMessage(error) },
      }));
    }
  };

  const startPull = async (providerId: string, model: string) => {
    if (!model.trim()) return;
    setPulling({ providerId, model, status: 'starting', done: false });
    try {
      await window.forge.providers.pull(providerId, model.trim());
    } catch (error) {
      setPulling(null);
      toast('error', errorMessage(error));
    }
  };

  const cancelPull = async () => {
    await window.forge.providers.cancelPull().catch(() => undefined);
    setPulling(null);
  };

  const beginEdit = (provider: ProviderConfig) => {
    setEditing(provider.id);
    setDraft({ ...provider, config: { ...provider.config } });
  };

  const assignRole = async (role: ModelRole, key: string) => {
    if (!settings) return;
    if (!key) {
      const roles = { ...settings.modelRoles };
      delete roles[role];
      await updateSettings({ modelRoles: roles });
      return;
    }
    const [providerId, ...rest] = key.split('::');
    const model = rest.join('::');
    if (!providerId || !model) return;
    await updateSettings({ modelRoles: { ...settings.modelRoles, [role]: { providerId, model } } });
  };

  const removeModel = (model: ModelInfo) => {
    askConfirm({
      title: `Remove ${shortModelName(model.id)}?`,
      message: 'The model files will be deleted from disk. You can download it again later.',
      confirmLabel: 'Remove model',
      danger: true,
      action: async () => {
        try {
          await window.forge.providers.removeModel(model.providerId, model.id);
          toast('success', `${shortModelName(model.id)} removed`);
          await load(false);
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });
  };

  const completeSetup = async () => {
    const status = await ensureRuntime();
    if (status?.stage === 'ready') await load(false);
  };

  const keepOnlyDefault = () => {
    if (!ollama) return;
    const keepList = ['sopu-coder', 'sopu-coder-fast', DEFAULT_OLLAMA_MODEL];
    const others = installed.filter(
      (model) =>
        model.providerId === ollama.id &&
        !keepList.some((k) => model.id.replace(/:latest$/, '') === k.replace(/:latest$/, '')) &&
        !model.capabilities.embedding,
    );
    if (others.length === 0) return;
    askConfirm({
      title: `Clean up older Ollama models?`,
      message: `This removes ${others.length} inactive chat model${others.length === 1 ? '' : 's'} to free disk space. Sopu AI models (sopu-coder, sopu-coder-fast) and embeddings are preserved.`,
      confirmLabel: 'Clean up models',
      danger: true,
      action: async () => {
        try {
          const removed = await window.forge.providers.keepOnly(ollama.id, ['sopu-coder', 'sopu-coder-fast']);
          if (settings) {
            const recommended = await window.forge.settings.recommendRoles().catch(() => ({}));
            await updateSettings({ modelRoles: { ...settings.modelRoles, ...recommended } });
          }
          await load(false);
          toast('success', `Removed ${removed.length} model${removed.length === 1 ? '' : 's'}`);
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });
  };

  return (
    <Modal onClose={() => setOpen(false)} width={920} className="max-h-[86vh] overflow-hidden">
      <ModalHeader
        title="Models & providers"
        subtitle="One resident local model (qwen3.5:4b) stays loaded while ForgeAI is open. Cloud or extra endpoints are optional."
        icon={<Cpu size={18} />}
        onClose={() => setOpen(false)}
      >
        <button type="button" className="btn btn-ghost h-7" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner className="!h-3 !w-3" /> : <RefreshCw size={12} />} Refresh
        </button>
      </ModalHeader>

      <div className="flex items-center gap-1 border-b border-line-soft px-5">
        {(['models', 'providers', 'roles'] as Tab[]).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={cn(
              'focus-ring relative px-3 py-2.5 text-[12px] capitalize',
              tab === entry ? 'text-fg-strong' : 'text-muted hover:text-fg',
            )}
          >
            {entry === 'models' ? `Models${installed.length ? ` (${installed.length})` : ''}` : entry}
            {tab === entry ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded bg-accent" /> : null}
          </button>
        ))}
      </div>

      <div className="max-h-[calc(86vh-120px)] overflow-y-auto px-5 pb-5 pt-3">
        {tab === 'models' ? (
          <div className="space-y-4">
            <div className="card flex flex-wrap items-center gap-3 p-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <StatusDot
                  tone={runtime?.stage === 'ready' ? 'success' : runtime?.stage === 'error' ? 'danger' : 'warning'}
                />
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-fg-strong">
                    Local runtime · Ollama {runtime?.version ? `v${runtime.version}` : ''}
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {runtime?.detail ?? 'Checking the local Ollama server…'}
                  </div>
                </div>
              </div>
              {runtime?.stage === 'ready' ? (
                <>
                  <span className="chip chip-success">
                    <CheckCircle2 size={11} /> ready
                  </span>
                  <span className="chip" title="Ollama stays running and the model stays loaded while ForgeAI is open">
                    <Cpu size={10} /> resident
                  </span>
                </>
              ) : (
                <button type="button" className="btn btn-primary h-7" onClick={() => void completeSetup()}>
                  <Download size={12} />{' '}
                  {runtime?.stage === 'error' || runtime?.stage === 'cancelled' ? 'Retry setup' : 'Set up local model'}
                </button>
              )}
            </div>

            <div>
              <SectionLabel
                right={
                  <span className="flex items-center gap-2 text-[10px] normal-case text-faint">
                    {installed.length > 1 && ollama ? (
                      <button
                        type="button"
                        className="btn btn-ghost h-5 px-1.5 text-[10px]"
                        onClick={keepOnlyDefault}
                        title="Delete inactive Ollama models except Sopu AI trained models"
                      >
                        <Trash2 size={10} /> Clean up inactive models
                      </button>
                    ) : null}
                    Installed
                  </span>
                }
              >
                Available models
              </SectionLabel>
              {installed.length === 0 ? (
                <div className="card p-4 text-[12px] text-muted">
                  No models installed yet. First-launch setup automatically compiles{' '}
                  <span className="mono text-fg">sopu-coder</span>, or you can pull one below.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {installed.map((model) => {
                    const key = bindingKey(model.providerId, model.id);
                    const isSopu = model.id.includes('sopu-coder');
                    return (
                      <div key={key} className="card p-3">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-fg-strong">
                              <span>{shortModelName(model.id)}</span>
                              {isSopu ? (
                                <span className="chip chip-success text-[9.5px]">Sopu AI Custom</span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-[10.5px] text-faint">
                              {providers.find((provider) => provider.id === model.providerId)?.name ?? model.providerId}
                              {model.parameterSize ? ` · ${model.parameterSize}` : ''}
                              {model.quantization ? ` · ${model.quantization}` : ''}
                            </div>
                          </div>
                          {selectedKey === key ? <span className="chip chip-accent">chat</span> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {model.sizeBytes ? (
                            <span className="chip">
                              <HardDrive size={10} /> {bytes(model.sizeBytes)}
                            </span>
                          ) : null}
                          {model.contextLength ? (
                            <span className="chip">{Math.round(model.contextLength / 1024)}k ctx</span>
                          ) : null}
                          {capabilityChips(model).map((chip) => (
                            <span key={chip} className="chip">
                              {chip}
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            className={cn('btn h-6 px-2 text-[11px]', selectedKey === key ? 'btn-primary' : '')}
                            onClick={() => void setSelectedModel({ providerId: model.providerId, model: model.id })}
                            disabled={selectedKey === key}
                          >
                            <Sparkles size={11} /> {selectedKey === key ? 'Selected' : 'Use for chat'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost ml-auto h-6 px-2 text-[11px] text-danger"
                            onClick={() => removeModel(model)}
                            title="Delete model files"
                          >
                            <Trash2 size={11} /> Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <SectionLabel>Download a model</SectionLabel>
              <div className="card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Server size={13} className="text-muted" />
                  <span className="text-[11.5px] text-muted">Ollama</span>
                  <input
                    value={pullModel}
                    onChange={(event) => setPullModel(event.target.value)}
                    placeholder="qwen3.5:4b"
                    className="mono h-7 min-w-[220px] flex-1 text-[11.5px]"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && ollama) void startPull(ollama.id, pullModel);
                    }}
                  />
                  {pulling ? (
                    <button type="button" className="btn btn-danger h-7" onClick={() => void cancelPull()}>
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary h-7"
                      disabled={!ollama || !pullModel.trim()}
                      onClick={() => ollama && void startPull(ollama.id, pullModel)}
                    >
                      <Download size={12} /> Pull
                    </button>
                  )}
                </div>
                {pulling ? (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-[10.5px] text-muted">
                      <span className="truncate">{pulling.status}</span>
                      <span>{pulling.percent !== undefined ? `${pulling.percent.toFixed(0)}%` : ''}</span>
                    </div>
                    <ProgressBar value={pulling.percent ?? 8} />
                  </div>
                ) : null}
                <div className="mt-3 rounded-md border border-line-soft bg-panel p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11.5px] font-medium text-fg">sopu-coder (Primary Trained Coder)</span>
                    <span className="chip chip-success">Custom Recipe</span>
                    <span className="chip">~4.7 GB</span>
                    {installed.some(
                      (model) => model.id.replace(/:latest$/, '') === 'sopu-coder',
                    ) ? (
                      <span className="chip chip-success">installed & active</span>
                    ) : (
                      <button
                        type="button"
                        className="btn ml-auto h-6 px-2 text-[10.5px]"
                        disabled={Boolean(pulling) || !ollama}
                        onClick={() => ollama && void startPull(ollama.id, 'sopu-coder')}
                      >
                        <Download size={10} /> Install sopu-coder
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                    Sopu Coder is customized specifically for this IDE from Qwen2.5-Coder 7B with an 8K context window,
                    temperature 0.2, and multi-language system prompt (TypeScript, React, PHP, Python). Automatically
                    compiled via Ollama.
                  </p>
                </div>
              </div>
            </div>

            {running.length > 0 ? (
              <div>
                <SectionLabel>Loaded in memory</SectionLabel>
                <div className="card divide-y divide-line-soft">
                  {running.map((model) => (
                    <div
                      key={`${model.providerId}:${model.name}`}
                      className="flex items-center gap-2 px-3 py-2 text-[11.5px]"
                    >
                      <StatusDot tone="success" />
                      <span className="mono">{shortModelName(model.name)}</span>
                      <span className="ml-auto text-faint">
                        {model.sizeVramBytes
                          ? `${bytes(model.sizeVramBytes)} VRAM`
                          : model.sizeBytes
                            ? bytes(model.sizeBytes)
                            : ''}
                        {model.expiresAt ? ` · until ${new Date(model.expiresAt).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'providers' ? (
          <div className="space-y-3">
            <div className="rounded-md border border-line-soft bg-panel-2 p-3 text-[11px] leading-relaxed text-muted">
              <p className="font-medium text-fg flex items-center gap-1.5 mb-1">
                <Sparkles size={13} className="text-accent" /> Free Cloud Models &amp; Claude Access
              </p>
              <ul className="list-disc pl-4 space-y-1 text-faint text-[10.5px]">
                <li><strong className="text-fg">OpenRouter (Free tier &amp; Claude)</strong>: Connect to access Claude 3.5 Sonnet, Claude 3.5 Haiku, and free <code className="text-fg font-mono">:free</code> models (DeepSeek R1/V3, Llama 3.3 70B, Qwen 2.5 72B). Get an API key at <span className="text-accent underline">openrouter.ai</span>.</li>
                <li><strong className="text-fg">Groq Cloud (100% Free)</strong>: Blazing fast (500+ tok/s) Llama 3.3 70B and Qwen 2.5 Coder. Free API key at <span className="text-accent underline">console.groq.com</span>.</li>
                <li><strong className="text-fg">Google Gemini (Free 15 RPM)</strong>: Gemini 2.0 Flash with 1M context. Free API key at <span className="text-accent underline">aistudio.google.com</span>.</li>
                <li><strong className="text-fg">Ollama Local</strong>: Completely free, offline, and private on your Mac.</li>
              </ul>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-[11.5px] text-muted">
                API keys are encrypted in your macOS Keychain and never leave your machine.
              </p>
              <button type="button" className="btn h-7" onClick={() => setAdding(true)} disabled={adding}>
                <Plus size={12} /> Add endpoint
              </button>
            </div>

            {adding ? (
              <ProviderForm
                draft={{
                  id: `custom-${Date.now().toString(36)}`,
                  kind: 'custom',
                  name: 'New endpoint',
                  baseUrl: 'http://127.0.0.1:11434',
                  enabled: true,
                  config: { temperature: 0.2, contextLength: 8192 },
                }}
                onCancel={() => setAdding(false)}
                onSave={async (provider) => {
                  try {
                    await window.forge.providers.upsert(provider);
                    setAdding(false);
                    await refreshModels(true);
                    toast('success', `${provider.name} added`);
                  } catch (error) {
                    toast('error', errorMessage(error));
                  }
                }}
              />
            ) : null}

            {providers.map((provider) => {
              const status = health[provider.id];
              const isEditing = editing === provider.id && draft;
              const detail =
                status === 'checking'
                  ? 'Checking…'
                  : status
                    ? status.ok
                      ? `${status.modelCount ?? 0} models${status.version ? ` · v${status.version}` : ''}${status.latencyMs ? ` · ${status.latencyMs} ms` : ''}`
                      : (status.error ?? 'Unreachable')
                    : provider.baseUrl;
              return (
                <div key={provider.id} className="card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot
                      tone={
                        status === 'checking'
                          ? 'warning'
                          : status
                            ? status.ok
                              ? 'success'
                              : 'danger'
                            : provider.enabled
                              ? 'muted'
                              : 'muted'
                      }
                    />
                    <span className="text-[12.5px] font-medium text-fg-strong">{provider.name}</span>
                    <span className="chip">{KIND_LABELS[provider.kind]}</span>
                    {provider.kind === 'ollama' ? <span className="chip chip-accent">managed</span> : null}
                    {!provider.enabled ? <span className="chip">disabled</span> : null}
                    <span className="ml-auto flex items-center gap-1">
                      <Toggle
                        checked={provider.enabled}
                        label={`Enable ${provider.name}`}
                        onChange={(value) => {
                          void window.forge.providers
                            .upsert({ ...provider, enabled: value })
                            .then(() => refreshModels(false))
                            .catch((error) => toast('error', errorMessage(error)));
                        }}
                      />
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px]">
                    <span className="mono text-muted">{provider.baseUrl}</span>
                    <span
                      className={cn(
                        'truncate',
                        status && status !== 'checking' && !status.ok ? 'text-danger' : 'text-faint',
                      )}
                    >
                      {detail}
                    </span>
                  </div>

                  {isEditing && draft ? (
                    <ProviderForm
                      draft={draft}
                      onChange={setDraft}
                      onCancel={() => {
                        setEditing(null);
                        setDraft(null);
                      }}
                      onSave={async (next) => {
                        try {
                          await window.forge.providers.upsert(next);
                          setEditing(null);
                          setDraft(null);
                          await refreshModels(true);
                          toast('success', `${next.name} saved`);
                        } catch (error) {
                          toast('error', errorMessage(error));
                        }
                      }}
                    />
                  ) : (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn h-6 px-2 text-[11px]"
                        onClick={() => void checkHealth(provider)}
                        disabled={status === 'checking'}
                      >
                        {status === 'checking' ? <Spinner className="!h-3 !w-3" /> : <RefreshCw size={11} />} Test
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost h-6 px-2 text-[11px]"
                        onClick={() => beginEdit(provider)}
                      >
                        <Settings2 size={11} /> Configure
                      </button>
                      {provider.kind !== 'ollama' ? (
                        <button
                          type="button"
                          className="btn btn-ghost h-6 px-2 text-[11px] text-danger"
                          onClick={() =>
                            askConfirm({
                              title: `Remove ${provider.name}?`,
                              message: 'Stored API keys for this provider are deleted as well.',
                              confirmLabel: 'Remove provider',
                              danger: true,
                              action: async () => {
                                await window.forge.providers.remove(provider.id);
                                await refreshModels(false);
                              },
                            })
                          }
                        >
                          <Trash2 size={11} /> Remove
                        </button>
                      ) : null}
                      {provider.kind !== 'ollama' ? (
                        <div className="ml-auto flex items-center gap-1.5">
                          <KeyRound size={11} className={provider.hasApiKey ? 'text-success' : 'text-faint'} />
                          <input
                            type="password"
                            value={keyDraft[provider.id] ?? ''}
                            onChange={(event) =>
                              setKeyDraft((current) => ({ ...current, [provider.id]: event.target.value }))
                            }
                            placeholder={provider.hasApiKey ? 'Key stored — replace…' : 'API key'}
                            className="h-6 w-40 text-[10.5px]"
                          />
                          <button
                            type="button"
                            className="btn h-6 px-2 text-[10.5px]"
                            disabled={!keyDraft[provider.id]?.trim()}
                            onClick={() => {
                              const key = keyDraft[provider.id]?.trim();
                              if (!key) return;
                              void window.forge.providers
                                .setApiKey(provider.id, key)
                                .then(() => {
                                  setKeyDraft((current) => ({ ...current, [provider.id]: '' }));
                                  toast('success', 'API key stored in the OS keychain');
                                  return refreshModels(false);
                                })
                                .catch((error) => toast('error', errorMessage(error)));
                            }}
                          >
                            Save
                          </button>
                          {provider.hasApiKey ? (
                            <button
                              type="button"
                              className="btn btn-ghost h-6 px-1.5 text-[10.5px]"
                              title="Clear stored key"
                              onClick={() =>
                                askConfirm({
                                  title: 'Clear the stored API key?',
                                  message: 'The key is removed from the OS keychain.',
                                  confirmLabel: 'Clear key',
                                  danger: true,
                                  action: async () => {
                                    await window.forge.providers.clearApiKey(provider.id);
                                    await refreshModels(false);
                                  },
                                })
                              }
                            >
                              <XCircle size={11} />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === 'roles' ? (
          <div className="space-y-3">
            <div className="card flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-fg-strong">Model roles</div>
                <p className="mt-0.5 text-[11px] text-muted">
                  Route each ForgeAI capability to a model. Unassigned roles fall back to the best installed model.
                </p>
              </div>
              <button
                type="button"
                className="btn h-7"
                onClick={async () => {
                  if (!settings) return;
                  await updateSettings({ modelRoles: { ...settings.modelRoles, ...recommended } });
                  toast('success', 'Roles assigned from installed models');
                }}
                disabled={installed.length === 0}
              >
                <Sparkles size={12} /> Auto-assign
              </button>
            </div>

            {(Object.keys(ROLE_LABELS) as ModelRole[]).map((role) => {
              const binding = settings?.modelRoles[role];
              const options = models.filter((model) =>
                role === 'embedding'
                  ? model.capabilities.embedding && model.installed
                  : model.installed && !model.capabilities.embedding,
              );
              return (
                <div key={role} className="card flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-fg">{ROLE_LABELS[role]}</div>
                    <div className="text-[10.5px] text-muted">{ROLE_HINTS[role]}</div>
                  </div>
                  <select
                    value={binding ? bindingKey(binding.providerId, binding.model) : ''}
                    onChange={(event) => void assignRole(role, event.target.value)}
                    className="h-7 max-w-[300px] text-[11px]"
                  >
                    <option value="">Automatic</option>
                    {options.map((model) => (
                      <option
                        key={bindingKey(model.providerId, model.id)}
                        value={bindingKey(model.providerId, model.id)}
                      >
                        {shortModelName(model.id)} ·{' '}
                        {providers.find((provider) => provider.id === model.providerId)?.name ?? model.providerId}
                      </option>
                    ))}
                    {binding &&
                    !models.some((model) => model.providerId === binding.providerId && model.id === binding.model) ? (
                      <option value={bindingKey(binding.providerId, binding.model)}>
                        {shortModelName(binding.model)} (missing)
                      </option>
                    ) : null}
                  </select>
                </div>
              );
            })}

            <div className="flex items-start gap-2 rounded-md border border-line-soft bg-panel p-3 text-[11px] text-muted">
              <Info size={13} className="mt-0.5 shrink-0 text-cyan" />
              <span>
                Recommended: <span className="mono text-fg">sopu-coder</span> for coding, chat, planning, and review, and <span className="mono text-fg">sopu-coder-fast</span> for completions. Embeddings are optional — pull an embedding model only if you want
                vector search; otherwise retrieval uses fast keyword ranking. Role choices are saved locally.
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

const PROVIDER_PRESETS = [
  {
    label: 'OpenRouter (Claude, DeepSeek, Free)',
    name: 'OpenRouter',
    kind: 'openrouter' as ProviderKind,
    baseUrl: 'https://openrouter.ai/api/v1',
    contextLength: 16384,
  },
  {
    label: 'Groq (Free 500+ tok/s)',
    name: 'Groq',
    kind: 'openai' as ProviderKind,
    baseUrl: 'https://api.groq.com/openai/v1',
    contextLength: 8192,
  },
  {
    label: 'Gemini (Free 15 RPM)',
    name: 'Gemini',
    kind: 'openai' as ProviderKind,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    contextLength: 32768,
  },
  {
    label: 'DeepSeek Direct',
    name: 'DeepSeek',
    kind: 'openai' as ProviderKind,
    baseUrl: 'https://api.deepseek.com/v1',
    contextLength: 16384,
  },
  {
    label: 'OpenAI (GPT-4o)',
    name: 'OpenAI',
    kind: 'openai' as ProviderKind,
    baseUrl: 'https://api.openai.com/v1',
    contextLength: 16384,
  },
  {
    label: 'LM Studio (Local)',
    name: 'LM Studio',
    kind: 'lmstudio' as ProviderKind,
    baseUrl: 'http://localhost:1234/v1',
    contextLength: 8192,
  },
];

function ProviderForm({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ProviderConfig;
  onChange?: (provider: ProviderConfig) => void;
  onCancel: () => void;
  onSave: (provider: ProviderConfig) => void | Promise<void>;
}) {
  const [value, setValue] = useState<ProviderConfig>(draft);
  const update = (patch: Partial<ProviderConfig>) => {
    const next = { ...value, ...patch };
    setValue(next);
    onChange?.(next);
  };
  return (
    <div className="mt-3 space-y-2 rounded-md border border-line-soft bg-panel p-3">
      <div>
        <p className="text-[10px] font-medium text-faint uppercase tracking-wider mb-1">Quick Presets</p>
        <div className="flex flex-wrap gap-1">
          {PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                update({
                  name: preset.name,
                  kind: preset.kind,
                  baseUrl: preset.baseUrl,
                  config: { ...value.config, contextLength: preset.contextLength },
                });
              }}
              className="btn !h-6 !px-2 !text-[9.5px] text-muted hover:text-fg hover:border-accent"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[10.5px] text-muted">
          Name
          <input
            value={value.name}
            onChange={(event) => update({ name: event.target.value })}
            className="h-7 w-full text-[11.5px]"
          />
        </label>
        <label className="space-y-1 text-[10.5px] text-muted">
          Kind
          <select
            value={value.kind}
            onChange={(event) => update({ kind: event.target.value as ProviderKind })}
            className="h-7 w-full text-[11.5px]"
          >
            {(Object.keys(KIND_LABELS) as ProviderKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-[10.5px] text-muted">
        Base URL
        <input
          value={value.baseUrl}
          onChange={(event) => update({ baseUrl: event.target.value.trim() })}
          className="mono h-7 w-full text-[11.5px]"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[10.5px] text-muted">
          Context length
          <input
            type="number"
            min={256}
            max={2_000_000}
            value={value.config.contextLength ?? 8192}
            onChange={(event) =>
              update({ config: { ...value.config, contextLength: Number(event.target.value) || 8192 } })
            }
            className="h-7 w-full text-[11.5px]"
          />
        </label>
        <label className="space-y-1 text-[10.5px] text-muted">
          Keep alive
          <input
            value={value.config.keepAlive ?? ''}
            onChange={(event) => update({ config: { ...value.config, keepAlive: event.target.value } })}
            placeholder="-1"
            title="-1 keeps the model loaded for the whole ForgeAI session"
            className="h-7 w-full text-[11.5px]"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost h-7" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary h-7"
          onClick={() => void onSave(value)}
          disabled={!value.name || !value.baseUrl}
        >
          Save provider
        </button>
      </div>
    </div>
  );
}
