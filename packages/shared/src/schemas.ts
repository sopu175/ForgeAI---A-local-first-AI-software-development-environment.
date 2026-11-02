import { z } from 'zod';

export const providerKindSchema = z.enum(['ollama', 'lmstudio', 'llamacpp', 'vllm', 'openai', 'openrouter', 'custom']);

export const providerConfigSchema = z.object({
  id: z.string().min(1).max(64),
  kind: providerKindSchema,
  name: z.string().min(1).max(80),
  baseUrl: z
    .string()
    .url()
    .refine((v) => v.startsWith('http://') || v.startsWith('https://'), 'http(s) only'),
  enabled: z.boolean(),
  hasApiKey: z.boolean().optional(),
  config: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      contextLength: z.number().int().min(256).max(2_000_000).optional(),
      keepAlive: z.string().max(32).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      timeoutMs: z.number().int().min(500).max(600_000).optional(),
    })
    .default({}),
});

export const chatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  reasoning: z.string().optional(),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
  toolCallId: z.string().optional(),
  images: z.array(z.string()).max(4).optional(),
});

export const streamChatSchema = z.object({
  requestId: z.string().min(1).max(80),
  providerId: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1).max(400),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(131_072).optional(),
  contextLength: z.number().int().min(256).max(2_000_000).optional(),
  thinking: z.boolean().optional(),
});

export const relativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.includes('\0'), 'invalid path')
  .refine((p) => !p.split(/[\\/]/).includes('..'), 'path traversal is not allowed');

export const searchOptionsSchema = z.object({
  query: z.string().min(1).max(500),
  caseSensitive: z.boolean().optional(),
  regex: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  include: z.string().max(200).optional(),
  exclude: z.string().max(200).optional(),
  maxResults: z.number().int().min(1).max(2000).optional(),
});

export const permissionResponseSchema = z.object({
  id: z.string(),
  decision: z.enum(['approved', 'denied', 'session']),
  acceptedHunks: z.array(z.number().int().min(0)).optional(),
});

export const agentRunSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().optional(),
  task: z.string().min(1).max(60_000),
  agent: z.enum(['coding', 'planner', 'debugging', 'testing', 'review', 'docs', 'seo']),
  providerId: z.string().optional(),
  model: z.string().optional(),
  maxSteps: z.number().int().min(1).max(60).optional(),
  contextFiles: z.array(z.string()).max(100).optional(),
  specTaskId: z.string().optional(),
  feature: z.string().optional(),
});

export const settingsPatchSchema = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    uiFontSize: z.number().min(10).max(20).optional(),
    codeFontSize: z.number().min(9).max(28).optional(),
    editorMinimap: z.boolean().optional(),
    wordWrap: z.boolean().optional(),
    editor: z
      .object({
        tabSize: z.number().int().min(1).max(8).optional(),
        insertSpaces: z.boolean().optional(),
        detectIndentation: z.boolean().optional(),
        autoSave: z.enum(['off', 'afterDelay']).optional(),
        autoSaveDelayMs: z.number().int().min(250).max(10_000).optional(),
        formatOnSave: z.boolean().optional(),
        lineNumbers: z.enum(['on', 'off', 'relative']).optional(),
        renderWhitespace: z.enum(['none', 'selection', 'all']).optional(),
        fontLigatures: z.boolean().optional(),
        smoothScrolling: z.boolean().optional(),
        bracketPairColorization: z.boolean().optional(),
        stickyScroll: z.boolean().optional(),
        multiCursorModifier: z.enum(['alt', 'ctrlCmd']).optional(),
        autoClosingBrackets: z.boolean().optional(),
        suggestOnTyping: z.boolean().optional(),
      })
      .optional(),
    preview: z.object({ defaultBrowser: z.string().min(1).max(60).optional() }).optional(),
    terminal: z
      .object({
        fontSize: z.number().int().min(9).max(28).optional(),
        cursorBlink: z.boolean().optional(),
      })
      .optional(),
    approval: z
      .object({
        writes: z.enum(['once', 'session', 'auto']).optional(),
        commands: z.enum(['once', 'session', 'auto']).optional(),
        deletes: z.enum(['always', 'session']).optional(),
        installs: z.enum(['once', 'session', 'auto']).optional(),
        network: z.enum(['once', 'session', 'auto']).optional(),
        commits: z.enum(['once', 'session', 'auto']).optional(),
      })
      .optional(),
    indexing: z
      .object({
        enabled: z.boolean().optional(),
        maxFileSizeKb: z.number().min(16).max(8192).optional(),
        ignoreGlobs: z.array(z.string()).max(100).optional(),
        batchSize: z.number().min(1).max(256).optional(),
        embedOnIndex: z.boolean().optional(),
      })
      .optional(),
    completion: z
      .object({
        enabled: z.boolean().optional(),
        debounceMs: z.number().min(100).max(3000).optional(),
        maxTokens: z.number().min(16).max(1024).optional(),
      })
      .optional(),
    modelRoles: z.record(z.string(), z.object({ providerId: z.string(), model: z.string() })).optional(),
    agent: z
      .object({
        maxSteps: z.number().int().min(1).max(60).optional(),
        temperature: z.number().min(0).max(2).optional(),
        autoCheckpoint: z.boolean().optional(),
        parallelReadOnly: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export const commitSchema = z.string().min(1).max(5000);
