import {
  enrichModel,
  type ChatDelta,
  type ChatRequest,
  type EmbedRequest,
  type EmbedResponse,
  type ModelInfo,
} from '@forgeai/shared';
import {
  assertOk,
  headersWithAuth,
  iterateLines,
  joinUrl,
  makeToolCallId,
  parseArguments,
  parseSseData,
  withTimeout,
} from './http';
import type { AIProvider, OpenAICompatibleOptions } from './types';
import { toToolSchema } from './types';

interface OpenAiToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChunk {
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: OpenAiToolCallDelta[];
    };
    message?: {
      content?: string | null;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: OpenAiToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly kind: OpenAICompatibleOptions['kind'];
  readonly id: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.baseUrl = options.baseUrl;
    this.headers = headersWithAuth(options.apiKey, options.headers);
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  private url(path: string): string {
    return joinUrl(this.baseUrl, path);
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; version?: string; error?: string; modelCount?: number }> {
    const started = Date.now();
    try {
      const response = await fetch(this.url('/models'), {
        headers: this.headers,
        signal: withTimeout(4000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { data?: unknown[]; models?: unknown[] };
      return {
        ok: true,
        latencyMs: Date.now() - started,
        modelCount: (data.data ?? data.models ?? []).length,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await fetch(this.url('/models'), {
      headers: this.headers,
      signal: withTimeout(15_000, signal),
    });
    await assertOk(response, `${this.kind} model discovery`);
    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        created?: number;
        owned_by?: string;
        context_length?: number;
        meta?: { n_ctx?: number };
      }>;
      models?: Array<{ id: string; name?: string; context_length?: number }>;
    };
    const entries = data.data ?? data.models ?? [];
    return entries.map((entry) => {
      const id = entry.id;
      const contextLength = entry.context_length ?? (entry as { meta?: { n_ctx?: number } }).meta?.n_ctx;
      return enrichModel({
        providerId: this.id,
        providerKind: this.kind,
        id,
        name: (entry as { name?: string }).name ?? id,
        contextLength,
        installed: true,
        capabilities: undefined,
      });
    });
  }

  private mapMessages(request: ChatRequest): unknown[] {
    return request.messages.map((message) => {
      if (message.role === 'tool') {
        return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        };
      }
      if (message.images?.length && message.role === 'user') {
        return {
          role: 'user',
          content: [
            { type: 'text', text: message.content },
            ...message.images.map((image) => ({
              type: 'image_url',
              image_url: { url: image.startsWith('data:') ? image : `data:image/png;base64,${image}` },
            })),
          ],
        };
      }
      return { role: message.role, content: message.content };
    });
  }

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.mapMessages(request),
      stream: true,
      stream_options: { include_usage: true },
      temperature: request.temperature ?? this.options.temperature ?? 0.2,
    };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.tools?.length) body.tools = request.tools.map(toToolSchema);
    if (request.format === 'json') body.response_format = { type: 'json_object' };

    const response = await fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: withTimeout(this.timeoutMs, signal),
    });
    await assertOk(response, `${this.kind} chat`);

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') && contentType.includes('application/json')) {
      yield* this.handleJsonResponse(response, signal);
      return;
    }

    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
    let promptTokens = 0;
    let outputTokens = 0;
    let finishReason: string | undefined;
    let emittedDone = false;

    const flushCalls = (): ChatDelta[] => {
      const deltas: ChatDelta[] = [];
      const sorted = [...pendingCalls.entries()].sort((a, b) => a[0] - b[0]);
      for (const [, call] of sorted) {
        if (!call.name) continue;
        deltas.push({
          type: 'tool_call',
          call: { id: call.id || makeToolCallId(), name: call.name, arguments: parseArguments(call.args) },
        });
      }
      pendingCalls.clear();
      return deltas;
    };

    for await (const line of iterateLines(response)) {
      const data = parseSseData(line);
      if (!data) continue;
      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(data) as OpenAiChunk;
      } catch {
        continue;
      }
      if (chunk.error?.message) {
        yield { type: 'error', message: chunk.error.message };
        return;
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta ?? choice.message;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (reasoning) yield { type: 'reasoning', text: reasoning };
        if (delta?.content) yield { type: 'text', text: delta.content };
        if (delta?.tool_calls) {
          for (const [fallbackIndex, toolCall] of delta.tool_calls.entries()) {
            const index = toolCall.index ?? fallbackIndex;
            const existing = pendingCalls.get(index) ?? { id: '', name: '', args: '' };
            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function?.name) existing.name += toolCall.function.name;
            if (toolCall.function?.arguments) existing.args += toolCall.function.arguments;
            pendingCalls.set(index, existing);
          }
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
          for (const deltaOut of flushCalls()) yield deltaOut;
        }
      }
      if (finishReason) {
        // Usage arrives in a final chunk after finish_reason on most servers.
      }
    }
    for (const deltaOut of flushCalls()) yield deltaOut;
    if (promptTokens || outputTokens) {
      yield { type: 'usage', promptTokens, outputTokens };
    }
    emittedDone = true;
    if (emittedDone) yield { type: 'done', stopReason: finishReason };
  }

  private async *handleJsonResponse(response: Response, signal: AbortSignal): AsyncIterable<ChatDelta> {
    const data = (await response.json()) as OpenAiChunk;
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (message?.reasoning_content) yield { type: 'reasoning', text: message.reasoning_content };
    if (message?.content) yield { type: 'text', text: message.content };
    if (message?.tool_calls) {
      for (const call of message.tool_calls) {
        const name = call.function?.name;
        if (!name) continue;
        yield {
          type: 'tool_call',
          call: { id: call.id || makeToolCallId(), name, arguments: parseArguments(call.function?.arguments) },
        };
      }
    }
    if (data.usage) {
      yield {
        type: 'usage',
        promptTokens: data.usage.prompt_tokens ?? 0,
        outputTokens: data.usage.completion_tokens ?? 0,
      };
    }
    yield { type: 'done', stopReason: choice?.finish_reason ?? undefined };
    void signal;
  }

  async embed(request: EmbedRequest, signal: AbortSignal): Promise<EmbedResponse> {
    const response = await fetch(this.url('/embeddings'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ model: request.model, input: request.inputs }),
      signal: withTimeout(this.timeoutMs, signal),
    });
    await assertOk(response, `${this.kind} embeddings`);
    const data = (await response.json()) as { data?: Array<{ embedding?: number[] }>; model?: string };
    const vectors = (data.data ?? []).map((item) => item.embedding ?? []);
    if (vectors.length !== request.inputs.length) {
      throw new Error('Embedding response length mismatch');
    }
    return { vectors, model: data.model ?? request.model, dim: vectors[0]?.length ?? 0 };
  }
}
