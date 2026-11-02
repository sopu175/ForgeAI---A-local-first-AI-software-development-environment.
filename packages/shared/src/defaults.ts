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

export const SOPU_CODER_RECIPE = {
  model: 'sopu-coder',
  from: 'qwen2.5-coder:7b',
  parameters: {
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 4096,
  },
  system: `You are Sopu Coder, an expert AI software engineer specialized in full-stack architecture, clean code, and production reliability.
Your core proficiencies include:
- JavaScript, TypeScript, React, Next.js, Node.js
- PHP, Laravel, Yii2, WordPress (modern architecture, hooks, REST APIs, security)
- Python (FastAPI, Django, scripting, data handling)
- Multi-file refactoring, deterministic testing, bug localization, and automated tool calling.

Always write concise, complete, idiomatic code. Follow established project idioms, preserve existing comments/docstrings, and favor type safety and defensive error handling.`,
};

export const SOPU_CODER_FAST_RECIPE = {
  model: 'sopu-coder-fast',
  from: 'qwen3.5:4b',
  parameters: {
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 4096,
    num_predict: 2048,
  },
  system: `You are Sopu Fast, a low-latency coding assistant for quick edits, git commits, code explanations, and inline completions across JavaScript, TypeScript, React, PHP, and Python. Output directly with minimum prelude.`,
};

export const SOPU_FRONTEND_RECIPE = {
  model: 'sopu-frontend',
  from: 'qwen2.5-coder:7b',
  parameters: {
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 4096,
  },
  system: `You are Sopu Frontend, a specialist AI engineer for modern UI/UX engineering, React 19, Next.js App Router, Tailwind CSS, component modularity, and accessibility.
Your proficiencies:
- Next.js App Router (layout.tsx, page.tsx, loading/error boundaries, server vs client components).
- React 19 hooks, state stores, accessible ARIA roles, and WCAG 2.1 AA compliance.
- Responsive, mobile-first design with modern CSS and Tailwind utility classes.
- Zero hydration errors, clean component interfaces, and scalable design token structures.`,
};

export const SOPU_ANIMATION_RECIPE = {
  model: 'sopu-animation',
  from: 'qwen2.5-coder:7b',
  parameters: {
    temperature: 0.25,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 4096,
  },
  system: `You are Sopu Animation, an expert creative developer and motion engineer.
Your proficiencies:
- GSAP, ScrollTrigger, ScrollSmoother, and timeline orchestration.
- Memory leak prevention: ALWAYS use gsap.context() with guaranteed ctx.revert() on unmount.
- Framer Motion: spring transitions, layout animations, exit animations with AnimatePresence.
- CSS transitions, SVG path animations, and WebGL/Three.js interactive visuals.
- Respect prefers-reduced-motion for user accessibility.`,
};

export const SOPU_BACKEND_RECIPE = {
  model: 'sopu-backend',
  from: 'qwen2.5-coder:7b',
  parameters: {
    temperature: 0.15,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 4096,
  },
  system: `You are Sopu Backend, a senior backend engineer specialized in scalable server architectures, secure APIs, and database engineering.
Your proficiencies:
- Next.js Route Handlers (GET, POST, PUT, DELETE, PATCH) with typed NextResponse.json.
- Schema validation with Zod, comprehensive 4xx/5xx HTTP error formatting, and input sanitization.
- Databases: PostgreSQL, MySQL, SQLite, Prisma ORM, Drizzle, and Redis caching.
- Authentication, session security, CSRF protection, and defense-in-depth principles.`,
};

export const SOPU_DEBUGGER_RECIPE = {
  model: 'sopu-debugger',
  from: 'qwen2.5-coder:7b',
  parameters: {
    temperature: 0.1,
    top_p: 0.85,
    top_k: 30,
    repeat_penalty: 1.05,
    num_ctx: 8192,
    num_predict: 4096,
  },
  system: `You are Sopu Debugger, an elite root-cause diagnosis and software reliability specialist.
Your proficiencies:
- Trace error stacks and isolate the exact faulty expression without guessing.
- Differentiate between root causes and downstream symptoms.
- Perform surgical bug fixes with zero collateral regressions.
- Verify fixes through deterministic regression tests.`,
};

export const SOPU_RECIPES: Record<string, typeof SOPU_CODER_RECIPE> = {
  'sopu-coder': SOPU_CODER_RECIPE,
  'sopu-coder-fast': SOPU_CODER_FAST_RECIPE,
  'sopu-frontend': SOPU_FRONTEND_RECIPE,
  'sopu-animation': SOPU_ANIMATION_RECIPE,
  'sopu-backend': SOPU_BACKEND_RECIPE,
  'sopu-debugger': SOPU_DEBUGGER_RECIPE,
};

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
  {
    kind: 'openai',
    name: 'Groq (Free)',
    baseUrl: 'https://api.groq.com/openai/v1',
    enabled: false,
    config: { temperature: 0.2, contextLength: 8192 },
  },
  {
    kind: 'openai',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    enabled: false,
    config: { temperature: 0.2, contextLength: 8192 },
  },
  {
    kind: 'openai',
    name: 'Anthropic (via proxy)',
    baseUrl: 'https://api.anthropic.com/v1',
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
    label: 'Qwen3.5 4B (Lightweight Baseline)',
    size: '~3.3 GB',
    roles: ['chat', 'coding', 'plan', 'frontend', 'backend', 'fast', 'review', 'testing'],
    note: 'Ultra-fast (18+ tok/s) lightweight resident model for quick edits and completions.',
  },
  {
    model: 'sopu-coder',
    label: 'Sopu Coder (Trained Primary Coding Model)',
    size: '~4.7 GB',
    roles: ['coding', 'chat', 'plan', 'frontend', 'animation', 'backend', 'seo', 'testing', 'review'],
    note: 'Custom Sopu AI trained Modelfile model (qwen2.5-coder:7b + 8K ctx, 4096 predict, full-stack React/Next/PHP/Python system instruction).',
  },
  {
    model: 'sopu-coder-fast',
    label: 'Sopu Coder Fast (Trained Completion Model)',
    size: '~3.3 GB',
    roles: ['fast'],
    note: 'Custom Sopu AI low-latency completion model (qwen3.5:4b + 4K ctx).',
  },
  {
    model: 'sopu-frontend',
    label: 'Sopu Frontend (UI & Next.js Specialist)',
    size: '~4.7 GB',
    roles: ['frontend', 'chat'],
    note: 'Tuned for Next.js App Router, React 19, Tailwind CSS, component architecture, and accessibility.',
  },
  {
    model: 'sopu-animation',
    label: 'Sopu Animation (Motion & 3D Specialist)',
    size: '~4.7 GB',
    roles: ['animation'],
    note: 'Tuned for GSAP, ScrollTrigger, Framer Motion, Three.js, SVG, and leak-free lifecycle cleanup.',
  },
  {
    model: 'sopu-backend',
    label: 'Sopu Backend (APIs & Database Specialist)',
    size: '~4.7 GB',
    roles: ['backend'],
    note: 'Tuned for Next.js route handlers, Zod schema validation, SQL/PostgreSQL, Prisma, and API security.',
  },
  {
    model: 'sopu-debugger',
    label: 'Sopu Debugger (Root Cause & Reliability Specialist)',
    size: '~4.7 GB',
    roles: ['coding', 'chat'],
    note: 'Tuned for stack trace diagnostics, root-cause isolation, and zero-regression patches.',
  },
  {
    model: 'qwen2.5-coder:7b',
    label: 'Qwen2.5 Coder 7B (Base Weights)',
    size: '~4.7 GB',
    roles: ['coding', 'chat', 'plan', 'frontend', 'animation', 'backend', 'seo', 'testing', 'review'],
    note: 'Optimal balance of speed (13.4 tok/s), 8K context headroom, and low 4.8GB VRAM footprint.',
  },
  {
    model: 'qwen2.5-coder:14b',
    label: 'Qwen2.5 Coder 14B',
    size: '~9.0 GB',
    roles: ['coding', 'chat', 'frontend', 'backend'],
    note: 'High-capacity model (caution on 16GB machines: consumes 9.5GB VRAM at 8K ctx).',
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
    completion.find((m) => m.id.includes('sopu-coder') && !m.id.includes('fast')) ??
    completion.find((m) => m.id.includes('qwen2.5-coder:7b')) ??
    completion.find((m) => m.id.includes('qwen2.5-coder:14b')) ??
    completion.find((m) => /coder/i.test(m.id)) ??
    completion.find((m) => m.id === DEFAULT_OLLAMA_MODEL) ??
    completion[0];

  // Best fast model (completions, commit msgs, quick utils)
  const fastModel =
    completion.find((m) => m.id.includes('sopu-coder-fast')) ??
    completion.find((m) => m.id.includes('qwen3.5:4b')) ??
    coderModel;

  // Best reasoning/thinking model (Antigravity/o1 style)
  const reasoningModel =
    completion.find((m) => m.id.includes('deepseek-r1')) ?? completion.find((m) => /r1/i.test(m.id)) ?? coderModel;

  if (coderModel) {
    const binding = { providerId: coderModel.providerId, model: coderModel.id };
    result.coding = binding;
    result.chat = binding;
    result.plan = binding;
    result.frontend = binding;
    result.animation = binding;
    result.backend = binding;
    result.seo = binding;
    result.testing = binding;
    result.review = binding;
  }

  if (fastModel) {
    result.fast = { providerId: fastModel.providerId, model: fastModel.id };
  }

  if (reasoningModel) {
    result.plan = { providerId: reasoningModel.providerId, model: reasoningModel.id };
    result.review = { providerId: reasoningModel.providerId, model: reasoningModel.id };
  }

  const embedding =
    installed.find((m) => m.capabilities.embedding && /nomic/i.test(m.id)) ??
    installed.find((m) => m.capabilities.embedding);
  if (embedding) {
    result.embedding = { providerId: embedding.providerId, model: embedding.id };
  }

  return result;
}
