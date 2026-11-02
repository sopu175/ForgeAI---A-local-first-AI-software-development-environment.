import { ProviderError } from './types';

// Configure global undici dispatcher in Node.js runtime to eliminate "Headers Timeout Error"
// when local models take time to cold-load weights or compute large context prefill.
if (typeof process !== 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undici = require('undici');
    if (undici?.setGlobalDispatcher && undici?.Agent) {
      undici.setGlobalDispatcher(
        new undici.Agent({
          headersTimeout: 0, // Disable header timeout waiting for local model generation
          bodyTimeout: 0, // Disable body timeout for streaming responses
          connectTimeout: 60_000,
        }),
      );
    }
  } catch {
    // In web worker or browser environments, global fetch is native
  }
}

export async function assertOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 800).trim();
  } catch {
    detail = '';
  }
  // Surface the provider's explanation instead of only "HTTP 400"; otherwise
  // invalid options and missing models are impossible to diagnose in the UI.
  const snippet = detail.replace(/\s+/g, ' ').slice(0, 300);
  throw new ProviderError(
    `${label} failed with HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
    response.status,
    detail,
  );
}

export async function* iterateLines(response: Response, activity?: { touch: () => void }): AsyncGenerator<string> {
  if (!response.body) throw new ProviderError('Response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      activity?.touch();
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.length > 0) yield line;
        index = buffer.indexOf('\n');
      }
    }
    const rest = buffer.trim();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

export function parseSseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  return data;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * Normalizes loopback URLs for the host operating system.
 * On Windows, local daemons (Ollama, LM Studio, etc.) bind exclusively to IPv4 127.0.0.1,
 * whereas Node.js undici resolves 'localhost' to IPv6 ::1 first.
 * When ::1 is not listening, Windows TCP rejects the connection with ECONNREFUSED ("fetch failed").
 * Converting 'localhost' to '127.0.0.1' on Windows guarantees reliable IPv4 loopback.
 */
export function normalizeLoopbackUrl(url: string): string {
  if (typeof process !== 'undefined' && process.platform === 'win32') {
    if (url.includes('://localhost:')) {
      return url.replace('://localhost:', '://127.0.0.1:');
    }
    if (url.includes('://localhost/')) {
      return url.replace('://localhost/', '://127.0.0.1/');
    }
  }
  return url;
}

/**
 * Resilient fetch wrapper that handles Windows IPv4/IPv6 localhost mismatches
 * and enriches opaque "fetch failed" errors with the underlying connection cause.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const primaryUrl = normalizeLoopbackUrl(url);
  try {
    return await fetch(primaryUrl, init);
  } catch (error) {
    const isNetworkError =
      error instanceof TypeError ||
      (error instanceof Error &&
        (error.message.includes('fetch failed') ||
          error.message.includes('failed to fetch') ||
          error.name === 'ConnectTimeoutError'));

    if (isNetworkError) {
      // Loopback fallback: if primary was 127.0.0.1, try localhost; if localhost, try 127.0.0.1
      let fallbackUrl: string | null = null;
      if (primaryUrl.includes('://localhost:')) {
        fallbackUrl = primaryUrl.replace('://localhost:', '://127.0.0.1:');
      } else if (primaryUrl.includes('://127.0.0.1:')) {
        fallbackUrl = primaryUrl.replace('://127.0.0.1:', '://localhost:');
      }

      if (fallbackUrl && fallbackUrl !== primaryUrl) {
        try {
          return await fetch(fallbackUrl, init);
        } catch {
          // Fall through to detailed error
        }
      }
    }

    // Enhance generic "fetch failed" with the underlying cause if available
    if (error instanceof Error && error.message.includes('fetch failed')) {
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof Error) {
        if (cause.message.includes('Headers Timeout Error')) {
          throw new Error(
            'Local model took too long to return initial headers. The model may still be loading into RAM/VRAM or computing prompt prefill.',
            { cause },
          );
        }
        throw new Error(`fetch failed (${cause.message})`, { cause });
      }
      if (cause && typeof cause === 'object' && 'code' in cause) {
        throw new Error(`fetch failed (${(cause as { code: string }).code})`, { cause });
      }
    }
    throw error;
  }
}

export function headersWithAuth(apiKey?: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', ...extra };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

export function withTimeout(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  timer.unref?.();
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', () => controller.abort(external.reason), { once: true });
  }
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  return controller.signal;
}

export interface ActivityController {
  signal: AbortSignal;
  touch: () => void;
  done: () => void;
}

/**
 * Creates an AbortSignal that stays alive indefinitely as long as streaming activity
 * occurs. Initial timeout accommodates slow model loading/cold-swapping; subsequent
 * tokens/chunks refresh the idle timeout so long generation turns never timeout prematurely.
 */
export function createActivityController(
  initialTimeoutMs = 600_000,
  idleTimeoutMs = 180_000,
  external?: AbortSignal,
): ActivityController {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const resetTimer = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(new Error('Model response timed out (no data received)'));
    }, ms);
    timer.unref?.();
  };

  resetTimer(initialTimeoutMs);

  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener('abort', () => controller.abort(external.reason), { once: true });
    }
  }

  controller.signal.addEventListener(
    'abort',
    () => {
      if (timer) clearTimeout(timer);
    },
    { once: true },
  );

  return {
    signal: controller.signal,
    touch: () => resetTimer(idleTimeoutMs),
    done: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

export function jsonErrorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function makeToolCallId(prefix = 'call'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function parseArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { raw };
    }
  }
  return {};
}
