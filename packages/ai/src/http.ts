import { ProviderError } from './types';

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
