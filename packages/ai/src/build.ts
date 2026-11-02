import type { ProviderConfig } from '@forgeai/shared';
import type { AIProvider, ProviderConfigInput } from './types';
import { OllamaProvider } from './ollama';
import { OpenAICompatibleProvider } from './openai';

export function buildProvider(config: ProviderConfig, apiKey?: string): AIProvider {
  const input: ProviderConfigInput = {
    id: config.id,
    kind: config.kind,
    baseUrl: config.baseUrl,
    apiKey,
    headers: config.config.headers,
    temperature: config.config.temperature,
    contextLength: config.config.contextLength,
    keepAlive: config.config.keepAlive,
    timeoutMs: config.config.timeoutMs,
  };
  if (config.kind === 'ollama') return new OllamaProvider(input);
  return new OpenAICompatibleProvider(input);
}
