import type { AppSettings, ModelInfo, ModelRole, ProviderConfig } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  uiFontSize: 13,
  codeFontSize: 13,
  editorMinimap: true,
  wordWrap: true,
  editor: {
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: true,
    autoSave: 'off',
    autoSaveDelayMs: 1000,
    formatOnSave: true,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    fontLigatures: true,
    smoothScrolling: true,
    bracketPairColorization: true,
    stickyScroll: true,
    multiCursorModifier: 'alt',
    autoClosingBrackets: true,
    suggestOnTyping: true,
  },
  preview: {
    // 'default' opens with the OS default browser; otherwise a browser id.
    defaultBrowser: 'default',
  },
  terminal: {
    fontSize: 12,
    cursorBlink: true,
  },
  approval: {
    writes: 'once',
    commands: 'once',
    deletes: 'always',
    installs: 'once',
    network: 'once',
    commits: 'once',
  },
  indexing: {
    enabled: true,
    maxFileSizeKb: 512,
    ignoreGlobs: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/vendor/**',
      '**/target/**',
      '**/.venv/**',
    ],
    batchSize: 24,
    embedOnIndex: true,
  },
  completion: {
    enabled: true,
    debounceMs: 250,
    maxTokens: 200,
  },
  modelRoles: {},
  agent: {
    maxSteps: 20,
    temperature: 0.2,
    autoCheckpoint: true,
    parallelReadOnly: true,
  },
  telemetry: false,
};

export const DEFAULT_PROVIDER_ID = 'ollama';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen3.5:4b';
/** Ollama's sentinel for "never unload the model while the server runs". */
export const DEFAULT_OLLAMA_KEEP_ALIVE = '-1';
/** Context window that matches the tuned runtime and keeps prefill fast on 4B. */
export const DEFAULT_OLLAMA_CONTEXT = 8192;

/**
 * The Ollama HTTP API accepts a number of seconds or a duration string ("5m").
 * The bare string "-1" is invalid there even though it works as a server env
 * value, so normalize it (and other unit-less numbers) before sending a request.
 */
export function normalizeOllamaKeepAlive(value?: string | number | null): string | number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : -1;
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return -1;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export const PROVIDER_PRESETS: Omit<ProviderConfig, 'id' | 'hasApiKey'>[] = [
  {
    kind: 'ollama',
    name: 'Ollama',
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    enabled: true,
    config: {
      temperature: 0.15,
      contextLength: DEFAULT_OLLAMA_CONTEXT,
      keepAlive: DEFAULT_OLLAMA_KEEP_ALIVE,
    },
  },
  {
    kind: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    enabled: false,
    config: { temperature: 0.2, contextLength: 8192 },
  },
  {
    kind: 'llamacpp',
    name: 'llama.cpp server',
    baseUrl: 'http://127.0.0.1:8080/v1',
    enabled: false,
    config: { temperature: 0.2, contextLength: 8192 },
  },
  {
    kind: 'vllm',
    name: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    enabled: false,
    config: { temperature: 0.2, contextLength: 8192 },
  },
  {
    kind: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    enabled: false,
    config: { temperature: 0.2, contextLength: 8192 },
  },
  {
    kind: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    enabled: false,
    config: { temperature: 0.2, contextLength: 8192 },
  },
];

export interface RecommendedDownload {
  model: string;
  label: string;
  size: string;
  roles: ModelRole[];
  note: string;
}

/**
 * Models earlier ForgeAI builds advertised as presets. The runtime may remove
 * these on upgrade so a single resident model keeps the GPU/CPU cache warm.
 * User-installed models outside this list are never touched automatically.
 */
export const LEGACY_OLLAMA_MODELS = [
  'qwen2.5-coder:1.5b',
  'qwen3:8b',
  'deepseek-r1:8b',
  'deepseek-coder',
  'deepseek-coder:6.7b',
] as const;

export const RECOMMENDED_DOWNLOADS: RecommendedDownload[] = [
  {
    model: DEFAULT_OLLAMA_MODEL,
    label: 'Qwen3.5 4B',
    size: '~3.3 GB',
    roles: ['chat', 'coding', 'plan', 'fast', 'review'],
    note: 'Fast, lightweight resident baseline model.',
  },
  {
    model: 'qwen2.5-coder:14b',
    label: 'Qwen2.5 Coder 14B',
    size: '~9.0 GB',
    roles: ['coding', 'chat', 'fast'],
    note: 'Codex-grade code generation, accurate file refactoring, and strict tool adherence.',
  },
  {
    model: 'deepseek-r1:14b',
    label: 'DeepSeek R1 14B',
    size: '~9.0 GB',
    roles: ['plan', 'review'],
    note: 'Antigravity/o1-grade chain-of-thought planning, architectural reasoning, and diff review.',
  },
  {
    model: 'nomic-embed-text',
    label: 'Nomic Embed Text',
    size: '~274 MB',
    roles: ['embedding'],
    note: 'Vector embeddings for semantic codebase search and hybrid RAG.',
  },
];

export function recommendRoles(models: ModelInfo[]): Partial<Record<ModelRole, { providerId: string; model: string }>> {
  const installed = models.filter((m) => m.installed);
  const completion = installed.filter((m) => !m.capabilities.embedding);

  const result: Partial<Record<ModelRole, { providerId: string; model: string }>> = {};

  // Best coder model (Codex style)
  const coderModel =
    completion.find((m) => m.id.includes('qwen2.5-coder:14b')) ??
    completion.find((m) => m.id.includes('qwen2.5-coder:7b')) ??
    completion.find((m) => /coder/i.test(m.id)) ??
    completion.find((m) => m.id === DEFAULT_OLLAMA_MODEL) ??
    completion[0];

  // Best reasoning/thinking model (Antigravity/o1 style)
  const reasoningModel =
    completion.find((m) => m.id.includes('deepseek-r1:14b')) ??
    completion.find((m) => /r1/i.test(m.id)) ??
    coderModel;

  if (coderModel) {
    result.coding = { providerId: coderModel.providerId, model: coderModel.id };
    result.fast = { providerId: coderModel.providerId, model: coderModel.id };
    result.chat = { providerId: coderModel.providerId, model: coderModel.id };
  }

  if (reasoningModel) {
    result.plan = { providerId: reasoningModel.providerId, model: reasoningModel.id };
    result.review = { providerId: reasoningModel.providerId, model: reasoningModel.id };
  } else if (coderModel) {
    result.plan = { providerId: coderModel.providerId, model: coderModel.id };
    result.review = { providerId: coderModel.providerId, model: coderModel.id };
  }

  const embedding =
    installed.find((m) => m.capabilities.embedding && /nomic/i.test(m.id)) ??
    installed.find((m) => m.capabilities.embedding);
  if (embedding) {
    result.embedding = { providerId: embedding.providerId, model: embedding.id };
  }

  return result;
}
