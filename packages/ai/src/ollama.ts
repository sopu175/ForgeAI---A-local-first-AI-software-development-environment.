import {
  DEFAULT_OLLAMA_KEEP_ALIVE,
  enrichModel,
  normalizeOllamaKeepAlive,
  type ChatDelta,
  type ChatRequest,
  type EmbedRequest,
  type EmbedResponse,
  type ModelInfo,
  type PullProgress,
  type RunningModel,
} from '@forgeai/shared';
import { makeToolCallId, parseArguments } from './http';
import { iterateLines, assertOk, withTimeout, createActivityController, headersWithAuth, joinUrl } from './http';
import { ProviderError, type AIProvider, type OllamaOptions } from './types';
import { toToolSchema } from './types';

interface OllamaTagModel {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaChatChunk {
  model?: string;
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: unknown };
    }>;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaProvider implements AIProvider {
  readonly kind = 'ollama' as const;
  readonly id: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(private readonly options: OllamaOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl;
    this.headers = headersWithAuth(options.apiKey, options.headers);
    this.timeoutMs = options.timeoutMs ?? 600_000;
  }

  private url(path: string): string {
    return joinUrl(this.baseUrl, path);
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; version?: string; error?: string; modelCount?: number }> {
    const started = Date.now();
    try {
      const response = await fetch(this.url('/api/version'), {
        headers: this.headers,
        signal: withTimeout(3000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const version = ((await response.json()) as { version?: string }).version;
      const tags = await fetch(this.url('/api/tags'), { headers: this.headers, signal: withTimeout(3000) });
      const data = tags.ok ? ((await tags.json()) as { models?: unknown[] }) : undefined;
      return { ok: true, latencyMs: Date.now() - started, version, modelCount: data?.models?.length };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await fetch(this.url('/api/tags'), {
      headers: this.headers,
      signal: withTimeout(15_000, signal),
    });
    await assertOk(response, 'Ollama model discovery');
    const data = (await response.json()) as { models?: OllamaTagModel[] };
    return (data.models ?? []).map((model) => {
      const id = model.name || model.model || 'unknown';
      return enrichModel({
        providerId: this.id,
        providerKind: 'ollama',
        id,
        name: id,
        sizeBytes: model.size,
        family: model.details?.family,
        parameterSize: model.details?.parameter_size,
        quantization: model.details?.quantization_level,
        modifiedAt: model.modified_at,
        digest: model.digest,
        installed: true,
      });
    });
  }

  async running(): Promise<RunningModel[]> {
    const response = await fetch(this.url('/api/ps'), {
      headers: this.headers,
      signal: withTimeout(5000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      models?: Array<{ name?: string; size?: number; size_vram?: number; expires_at?: string }>;
    };
    return (data.models ?? []).map((m) => ({
      providerId: this.id,
      name: m.name ?? 'unknown',
      sizeBytes: m.size,
      sizeVramBytes: m.size_vram,
      expiresAt: m.expires_at,
    }));
  }

  async *pull(model: string, signal: AbortSignal): AsyncIterable<PullProgress> {
    const response = await fetch(this.url('/api/pull'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ model, stream: true }),
      signal,
    });
    await assertOk(response, 'Ollama pull');
    for await (const line of iterateLines(response)) {
      let parsed: { status?: string; digest?: string; total?: number; completed?: number; error?: string };
      try {
        parsed = JSON.parse(line) as typeof parsed;
      } catch {
        continue;
      }
      const total = parsed.total ?? 0;
      const completed = parsed.completed ?? 0;
      const percent = total > 0 ? Math.min(100, (completed / total) * 100) : undefined;
      const status = parsed.status ?? 'pulling';
      yield {
        providerId: this.id,
        model,
        status: parsed.error ? `error: ${parsed.error}` : status,
        completed,
        total,
        percent,
        done: status === 'success',
        error: parsed.error,
      };
      if (parsed.error) throw new ProviderError(parsed.error);
    }
  }

  async createModel(options: {
    model: string;
    from: string;
    system?: string;
    parameters?: Record<string, unknown>;
  }): Promise<void> {
    const response = await fetch(this.url('/api/create'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: options.model,
        from: options.from,
        system: options.system,
        parameters: options.parameters,
        stream: false,
      }),
      signal: withTimeout(60_000),
    });
    await assertOk(response, `Ollama create model ${options.model}`);
  }

  async deleteModel(model: string): Promise<void> {
    const response = await fetch(this.url('/api/delete'), {
      method: 'DELETE',
      headers: this.headers,
      body: JSON.stringify({ model }),
      signal: withTimeout(15_000),
    });
    await assertOk(response, 'Ollama delete model');
  }

  private toOllamaMessages(messages: ChatRequest['messages']): unknown[] {
    return messages.map((message) => {
      const base: Record<string, unknown> = { role: message.role, content: message.content };
      if (message.images && message.images.length > 0) base.images = message.images;
      if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
        base.tool_calls = message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments },
        }));
        base.content = message.content ?? '';
      }
      return base;
    });
  }

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.toOllamaMessages(request.messages),
      stream: true,
      // Keep a single model hot for the entire ForgeAI session. Numeric -1 is
      // the API sentinel for "never unload"; the string "-1" is rejected by
      // Ollama with HTTP 400 ("missing unit in duration").
      keep_alive: normalizeOllamaKeepAlive(this.options.keepAlive ?? DEFAULT_OLLAMA_KEEP_ALIVE),
      options: {
        temperature: request.temperature ?? this.options.temperature ?? 0.15,
        // Deterministic-enough sampling that stays fast and avoids rambling.
        top_p: 0.9,
        repeat_penalty: 1.05,
        num_ctx: request.contextLength ?? this.options.contextLength ?? 8192,
        // Larger batches improve prefill throughput on Metal/CUDA.
        num_batch: 512,
        // Bounded output prevents a single turn from stalling the UI.
        num_predict: request.maxTokens ?? 2048,
      },
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toToolSchema);
    }
    // Thinking tokens can double time-to-answer. Opt in only when requested.
    body.think = request.thinking ?? false;
    if (request.format) body.format = request.format;

    const activity = createActivityController(this.timeoutMs, 180_000, signal);
    try {
      const response = await fetch(this.url('/api/chat'), {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: activity.signal,
      });
      await assertOk(response, 'Ollama chat');

      const emittedCalls = new Set<string>();
      let promptTokens = 0;
      let outputTokens = 0;
      let tokensPerSecond: number | undefined;

      for await (const line of iterateLines(response, activity)) {
      let chunk: OllamaChatChunk;
      try {
        chunk = JSON.parse(line) as OllamaChatChunk;
      } catch {
        continue;
      }
      const message = chunk.message;
      if (message?.thinking) yield { type: 'reasoning', text: message.thinking };
      if (message?.content) yield { type: 'text', text: message.content };
      if (message?.tool_calls) {
        for (const call of message.tool_calls) {
          const name = call.function?.name;
          if (!name) continue;
          const args = parseArguments(call.function?.arguments);
          const key = `${name}:${JSON.stringify(args)}`;
          if (emittedCalls.has(key)) continue;
          emittedCalls.add(key);
          yield {
            type: 'tool_call',
            call: { id: call.id || makeToolCallId(), name, arguments: args },
          };
        }
      }
      if (chunk.prompt_eval_count) promptTokens = chunk.prompt_eval_count;
      if (chunk.eval_count) outputTokens = chunk.eval_count;
      if (chunk.eval_count && chunk.eval_duration) {
        tokensPerSecond = chunk.eval_count / (chunk.eval_duration / 1e9);
      }
      if (chunk.done) {
        if (promptTokens || outputTokens) {
          yield { type: 'usage', promptTokens, outputTokens, tokensPerSecond };
        }
        yield { type: 'done', stopReason: chunk.done_reason };
        return;
      }
    }
    if (promptTokens || outputTokens) yield { type: 'usage', promptTokens, outputTokens, tokensPerSecond };
    yield { type: 'done' };
  } finally {
    activity.done();
  }
}

  async embed(request: EmbedRequest, signal: AbortSignal): Promise<EmbedResponse> {
    const response = await fetch(this.url('/api/embed'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: request.model,
        input: request.inputs,
        truncate: true,
        options: { num_ctx: this.options.contextLength ?? 8192 },
      }),
      signal: withTimeout(this.timeoutMs, signal),
    });
    if (response.status === 404) return this.embedLegacy(request, signal);
    await assertOk(response, 'Ollama embed');
    const data = (await response.json()) as { embeddings?: number[][]; model?: string };
    if (!data.embeddings || data.embeddings.length !== request.inputs.length) {
      throw new ProviderError('Ollama returned an unexpected embeddings payload');
    }
    return {
      vectors: data.embeddings,
      model: data.model ?? request.model,
      dim: data.embeddings[0]?.length ?? 0,
    };
  }

  private async embedLegacy(request: EmbedRequest, signal: AbortSignal): Promise<EmbedResponse> {
    const vectors: number[][] = [];
    for (const input of request.inputs) {
      const response = await fetch(this.url('/api/embeddings'), {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ model: request.model, prompt: input }),
        signal: withTimeout(this.timeoutMs, signal),
      });
      await assertOk(response, 'Ollama embeddings');
      const data = (await response.json()) as { embedding?: number[] };
      if (!data.embedding) throw new ProviderError('Ollama returned no embedding');
      vectors.push(data.embedding);
    }
    return { vectors, model: request.model, dim: vectors[0]?.length ?? 0 };
  }
}
