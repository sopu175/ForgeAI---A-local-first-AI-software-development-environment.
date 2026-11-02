import type {
  ChatDelta,
  ChatMessage,
  ChatRequest,
  EmbedRequest,
  EmbedResponse,
  ModelInfo,
  ProviderKind,
  PullProgress,
  RunningModel,
  ToolSchema,
} from '@forgeai/shared';

export interface ProviderConfigInput {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  temperature?: number;
  contextLength?: number;
  keepAlive?: string;
  timeoutMs?: number;
}

export interface AIProvider {
  readonly kind: ProviderKind;
  readonly id: string;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta>;
  embed(request: EmbedRequest, signal: AbortSignal): Promise<EmbedResponse>;
  health(): Promise<{ ok: boolean; latencyMs: number; version?: string; error?: string; modelCount?: number }>;
  pull?(model: string, signal: AbortSignal): AsyncIterable<PullProgress>;
  createModel?(options: {
    model: string;
    from: string;
    system?: string;
    parameters?: Record<string, unknown>;
  }): Promise<void>;
  deleteModel?(model: string): Promise<void>;
  running?(): Promise<RunningModel[]>;
}

export type OpenAICompatibleOptions = ProviderConfigInput;

export type OllamaOptions = ProviderConfigInput;

export class ProviderError extends Error {
  readonly status?: number;
  readonly detail?: string;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.detail = detail;
  }
}

export function toToolSchema(tool: ToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.content.length > 0 || (m.toolCalls && m.toolCalls.length > 0));
}
