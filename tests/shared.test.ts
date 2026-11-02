import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_PROVIDER_ID,
  PROVIDER_PRESETS,
  RECOMMENDED_DOWNLOADS,
  basename,
  clamp,
  estimateTokens,
  formatBytes,
  guessCapabilities,
  languageFromPath,
  normalizeOllamaKeepAlive,
  normalizeRelative,
  shortModelName,
  truncateEnd,
  truncateMiddle,
} from '@forgeai/shared';

describe('local model defaults', () => {
  it('pins the documented Ollama endpoint and model', () => {
    expect(DEFAULT_PROVIDER_ID).toBe('ollama');
    expect(DEFAULT_OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(DEFAULT_OLLAMA_MODEL).toBe('qwen3.5:4b');
  });

  it('exposes a matching provider preset', () => {
    const ollama = PROVIDER_PRESETS.find((preset) => preset.kind === 'ollama');
    expect(ollama).toBeDefined();
    expect(ollama?.baseUrl).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it('recommends the default model first so first-run downloads it', () => {
    expect(RECOMMENDED_DOWNLOADS[0]?.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(RECOMMENDED_DOWNLOADS[0]?.roles).toContain('coding');
  });

  it('sends keep_alive as a number because Ollama rejects the string "-1"', () => {
    expect(normalizeOllamaKeepAlive('-1')).toBe(-1);
    expect(normalizeOllamaKeepAlive('-1')).not.toBe('-1');
    expect(normalizeOllamaKeepAlive('600')).toBe(600);
    expect(normalizeOllamaKeepAlive('5m')).toBe('5m');
    expect(normalizeOllamaKeepAlive(undefined)).toBe(-1);
    expect(normalizeOllamaKeepAlive('')).toBe(-1);
  });
});

describe('path and language helpers', () => {
  it('handles POSIX and Windows separators', () => {
    expect(basename('C:\\work\\src\\main.ts')).toBe('main.ts');
    expect(basename('/work/src/main.ts')).toBe('main.ts');
    expect(normalizeRelative('.\\src\\app.tsx')).toBe('src/app.tsx');
  });

  it('maps extensions and special file names', () => {
    expect(languageFromPath('/repo/src/App.tsx')).toBe('typescript');
    expect(languageFromPath('/repo/Dockerfile')).toBe('dockerfile');
    expect(languageFromPath('/repo/.gitignore')).toBe('plaintext');
    expect(languageFromPath('/repo/unknown.weird')).toBe('plaintext');
  });
});

describe('text helpers', () => {
  it('estimates tokens without returning zero', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('a'.repeat(34))).toBe(10);
  });

  it('truncates in the middle and at the end', () => {
    const text = 'x'.repeat(1_000);
    const middle = truncateMiddle(text, 200);
    expect(middle.length).toBeLessThan(text.length);
    expect(middle).toContain('chars omitted');
    expect(truncateEnd(text, 50)).toContain('truncated 950 chars');
    expect(truncateEnd('short', 50)).toBe('short');
  });

  it('formats byte sizes for the UI', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2.6 * 1024 ** 3)).toBe('2.6 GB');
  });

  it('clamps values into range', () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
});

describe('model helpers', () => {
  it('shortens tagged model ids', () => {
    expect(shortModelName('qwen3.5:4b')).toBe('qwen3.5');
    expect(shortModelName('llama3.2')).toBe('llama3.2');
  });

  it('guesses tool support and embedding models', () => {
    expect(guessCapabilities('qwen2.5-coder:7b').tools).toBe(true);
    expect(guessCapabilities('nomic-embed-text').embedding).toBe(true);
    expect(guessCapabilities('nomic-embed-text').completion).toBe(false);
    expect(guessCapabilities('qwen3:8b').thinking).toBe(true);
  });

  it('recommends all 10 specialist roles based on installed models', async () => {
    const { recommendRoles } = await import('@forgeai/shared');
    const mockModels = [
      {
        id: 'sopu-coder',
        name: 'Sopu Coder',
        providerId: 'ollama',
        installed: true,
        capabilities: { chat: true, streaming: true, tools: true, embedding: false, thinking: false, completion: true },
      },
      {
        id: 'sopu-coder-fast',
        name: 'Sopu Coder Fast',
        providerId: 'ollama',
        installed: true,
        capabilities: { chat: true, streaming: true, tools: true, embedding: false, thinking: false, completion: true },
      },
      {
        id: 'nomic-embed-text',
        name: 'Nomic Embed Text',
        providerId: 'ollama',
        installed: true,
        capabilities: { chat: false, streaming: false, tools: false, embedding: true, thinking: false, completion: false },
      },
    ];

    const roles = recommendRoles(mockModels);
    expect(roles.coding?.model).toBe('sopu-coder');
    expect(roles.chat?.model).toBe('sopu-coder');
    expect(roles.plan?.model).toBe('sopu-coder');
    expect(roles.frontend?.model).toBe('sopu-coder');
    expect(roles.animation?.model).toBe('sopu-coder');
    expect(roles.backend?.model).toBe('sopu-coder');
    expect(roles.seo?.model).toBe('sopu-coder');
    expect(roles.testing?.model).toBe('sopu-coder');
    expect(roles.review?.model).toBe('sopu-coder');
    expect(roles.fast?.model).toBe('sopu-coder-fast');
    expect(roles.embedding?.model).toBe('nomic-embed-text');
  });
});
