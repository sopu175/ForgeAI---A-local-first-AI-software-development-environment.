import type { ModelCapabilities, ModelInfo } from './types';

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  phtml: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  env: 'ini',
  conf: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  xml: 'xml',
  svg: 'xml',
  dockerfile: 'dockerfile',
  tf: 'hcl',
  hcl: 'hcl',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  scala: 'scala',
  zig: 'zig',
  makefile: 'makefile',
  cmake: 'cmake',
  txt: 'plaintext',
};

const LANGUAGE_BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmakelists: 'cmake',
  gemfile: 'ruby',
  rakefile: 'ruby',
  procfile: 'plaintext',
  '.env': 'ini',
  '.gitignore': 'plaintext',
  '.npmrc': 'ini',
  '.prettierrc': 'json',
};

export function languageFromPath(path: string): string {
  const name = basename(path).toLowerCase();
  const byName = LANGUAGE_BY_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 'plaintext';
  return LANGUAGE_BY_EXT[name.slice(dot + 1)] ?? 'plaintext';
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '.';
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export function normalizeRelative(path: string): string {
  return toPosix(path).replace(/^\.\//, '').replace(/^\/+/, '');
}

export function isBinaryName(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.ico',
    '.icns',
    '.pdf',
    '.zip',
    '.gz',
    '.tar',
    '.7z',
    '.exe',
    '.dll',
    '.dylib',
    '.so',
    '.wasm',
    '.mp3',
    '.mp4',
    '.mov',
    '.wav',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.class',
    '.jar',
    '.lockb',
    '.db',
    '.sqlite',
    '.sqlite3',
  ].includes(ext);
}

export function looksBinary(buffer: Uint8Array): boolean {
  const sample = buffer.subarray(0, 4096);
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) return true;
  }
  return false;
}

export function estimateTokens(text: string): number {
  // Conservative estimate for code + prose: ~3.4 chars/token.
  return Math.max(1, Math.ceil(text.length / 3.4));
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2) - 40;
  return `${text.slice(0, half)}\n\n… [${text.length - maxChars} chars omitted] …\n\n${text.slice(-half)}`;
}

export function truncateEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} chars]`;
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function guessCapabilities(modelId: string, family?: string): ModelCapabilities {
  const id = `${modelId} ${family ?? ''}`.toLowerCase();
  const embedding = /embed|bge-|gte-|e5-|minilm/.test(id);
  const vision = /vision|llava|bakllava|moondream|minicpm-v|qwen2\.5-vl|qwen3-vl|gemma3|llama3\.2-vision/.test(id);
  const thinking = /deepseek-r1|qwq|qwen3|magistral|reason|thinking|phi4-reasoning/.test(id);
  const tools =
    !embedding &&
    /qwen|coder|llama3\.[1-3]|llama4|mistral|mixtral|deepseek|devstral|codestral|granite|command-r|phi4|gemma3|glm/.test(
      id,
    );
  return {
    tools,
    vision,
    thinking,
    embedding,
    completion: !embedding,
  };
}

export function enrichModel(
  model: Omit<ModelInfo, 'capabilities'> & { capabilities?: Partial<ModelCapabilities> },
): ModelInfo {
  const guessed = guessCapabilities(model.id, model.family);
  return {
    ...model,
    capabilities: {
      tools: model.capabilities?.tools ?? guessed.tools,
      vision: model.capabilities?.vision ?? guessed.vision,
      thinking: model.capabilities?.thinking ?? guessed.thinking,
      embedding: model.capabilities?.embedding ?? guessed.embedding,
      completion: model.capabilities?.completion ?? guessed.completion,
    },
  };
}

export function shortModelName(id: string): string {
  const base = id.includes(':') ? id.split(':')[0]! : id;
  return base || id;
}
