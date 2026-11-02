import { BrowserWindow, app, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron';
import {
  agentRunSchema,
  commitSchema,
  permissionResponseSchema,
  providerConfigSchema,
  searchOptionsSchema,
  settingsPatchSchema,
  streamChatSchema,
  type AgentRunRequest,
  type ChatMessage,
  type CompletionResponse,
  type PermissionResponse,
  type SpecPhase,
  type SpecTask,
} from '@forgeai/shared';
import { Database } from './db';
import { detectBrowsers, openInBrowser } from './services/browser';
import { openWorkspace, type AppContext } from './context';

function assertTrusted(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const trusted = url.startsWith('file://') || (devUrl ? url.startsWith(devUrl) : false);
  if (!trusted) throw new Error('Blocked IPC call from an untrusted origin');
}

function handle<Args extends unknown[], Result>(
  channel: string,
  handler: (...args: Args) => Result | Promise<Result>,
): void {
  registeredChannels.add(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event);
    return handler(...(args as Args));
  });
}

const registeredChannels = new Set<string>();

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}

function num(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${name} must be a list of paths`);
  }
  return value as string[];
}

function requireProject(ctx: AppContext, projectId: unknown): string {
  const id = str(projectId, 'projectId');
  if (!ctx.workspace.isOpen()) throw new Error('No workspace is open');
  if (ctx.workspace.projectId !== id) throw new Error('This request refers to a project that is not currently open');
  return id;
}

function cleanCompletion(text: string): string {
  let value = text.trim();
  const fence = /^```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)\n```$/.exec(value);
  if (fence?.[1]) value = fence[1];
  if (value.startsWith('<cursor>')) value = value.slice('<cursor>'.length);
  return value.replace(/\s+$/, '');
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

async function collectChat(
  ctx: AppContext,
  request: {
    providerId: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    contextLength?: number;
    projectId?: string;
    timeoutMs?: number;
  },
): Promise<{ text: string; reasoning: string; model: string }> {
  const provider = ctx.providers.build(request.providerId);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('The model did not answer in time')),
    request.timeoutMs ?? 180_000,
  );
  timer.unref?.();
  let text = '';
  let reasoning = '';
  const started = Date.now();
  try {
    for await (const delta of provider.chat(
      {
        providerId: request.providerId,
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        contextLength: request.contextLength,
      },
      controller.signal,
    )) {
      if (delta.type === 'text') text += delta.text;
      else if (delta.type === 'reasoning') reasoning += delta.text;
      else if (delta.type === 'error') throw new Error(delta.message);
      else if (delta.type === 'usage') {
        ctx.db.recordUsage({
          projectId: request.projectId,
          model: request.model,
          promptTokens: delta.promptTokens,
          outputTokens: delta.outputTokens,
          durationMs: Date.now() - started,
        });
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { text, reasoning, model: request.model };
}

export function registerIpc(ctx: AppContext): () => void {
  const streams = new Map<string, AbortController>();

  // ── App ──────────────────────────────────────────────────────────────────
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    isDev: !app.isPackaged,
  }));

  ipcMain.handle('app:openExternal', async (event, url: unknown) => {
    assertTrusted(event);
    const target = str(url, 'url');
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http and https links can be opened');
    }
    await shell.openExternal(parsed.toString());
  });
  registeredChannels.add('app:openExternal');

  ipcMain.handle('app:window', (event, action: unknown) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    const name = str(action, 'action');
    if (name === 'minimize') window.minimize();
    else if (name === 'maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (name === 'close') window.close();
  });
  registeredChannels.add('app:window');

  // ── Workspace ────────────────────────────────────────────────────────────
  handle('workspace:openDialog', async () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return openWorkspace(ctx, result.filePaths[0]!);
  });

  handle('workspace:open', async (root: unknown) => openWorkspace(ctx, str(root, 'root')));

  handle('workspace:recent', () => ctx.workspace.recent());
  handle('workspace:current', () => ctx.workspace.currentSummary());

  handle('workspace:close', async () => {
    await ctx.workspace.close();
    ctx.permissions.denyAll();
    ctx.permissions.resetSession();
    ctx.db.setSetting('workspace:last', '');
  });

  handle('workspace:tree', () => ctx.workspace.tree());
  handle('workspace:list', (dir: unknown) => ctx.workspace.list(typeof dir === 'string' ? dir : ''));
  handle('workspace:readFile', (relative: unknown) => ctx.workspace.readFile(str(relative, 'path')));
  handle('workspace:writeFile', (relative: unknown, content: unknown) =>
    ctx.workspace.writeFile(str(relative, 'path'), str(content, 'content')),
  );
  handle('workspace:createFile', (relative: unknown, content: unknown) =>
    ctx.workspace.createFile(str(relative, 'path'), typeof content === 'string' ? content : ''),
  );
  handle('workspace:createDirectory', (relative: unknown) => ctx.workspace.createDirectory(str(relative, 'path')));
  handle('workspace:rename', async (oldPath: unknown, newPath: unknown) => {
    await ctx.workspace.rename(str(oldPath, 'oldPath'), str(newPath, 'newPath'));
  });
  handle('workspace:remove', async (paths: unknown) => {
    const targets = stringList(paths, 'paths');
    if (!ctx.workspace.isOpen()) throw new Error('No workspace is open');
    const response = await ctx.permissions.require({
      kind: 'delete',
      title: `Delete ${targets.length} ${targets.length === 1 ? 'item' : 'items'}`,
      detail: targets.slice(0, 30).join('\n') + (targets.length > 30 ? `\n… ${targets.length - 30} more` : ''),
      paths: targets,
      toolName: 'workspace.delete',
    });
    if (response.decision === 'denied') throw new Error('Deletion was not approved');
    await ctx.workspace.remove(targets, true);
  });
  handle('workspace:reveal', (relative: unknown) => ctx.workspace.reveal(str(relative, 'path')));
  handle('workspace:browsers', () => detectBrowsers());
  handle('workspace:openInBrowser', async (relative: unknown, browserId: unknown) => {
    const relativePath = str(relative, 'path');
    const absolute = await ctx.workspace.resolveSafe(relativePath, false);
    const requested =
      typeof browserId === 'string' && browserId.length > 0 ? browserId : ctx.settings.get().preview.defaultBrowser;
    const browser = await openInBrowser(absolute, requested);
    return { browser, path: relativePath };
  });
  handle('workspace:rules', () => ctx.workspace.loadRules());
  handle('workspace:stack', () => ctx.workspace.getStack());
  handle('workspace:projectIdFor', async (root: unknown) => {
    const value = str(root, 'path');
    const { promises: fs } = await import('node:fs');
    const real = await fs.realpath(value).catch(() => value);
    return Database.projectIdFor(real);
  });

  // ── Settings ─────────────────────────────────────────────────────────────
  handle('settings:get', () => ctx.settings.get());
  handle('settings:update', (patch: unknown) => {
    const next = ctx.settings.update(settingsPatchSchema.parse(patch));
    nativeTheme.themeSource = next.theme;
    return next;
  });
  handle('settings:recommendRoles', () => ctx.providers.recommendedRoles());

  // ── Local runtime (Ollama bootstrap) ─────────────────────────────────────
  handle('runtime:status', () => ctx.runtime.snapshot());
  handle('runtime:ensure', () => ctx.runtime.ensure());
  handle('runtime:cancel', () => ctx.runtime.cancel());

  // ── Providers & models ───────────────────────────────────────────────────
  handle('providers:list', () => ctx.providers.list());
  handle('providers:upsert', (config: unknown) => ctx.providers.upsert(providerConfigSchema.parse(config)));
  handle('providers:remove', (id: unknown) => ctx.providers.remove(str(id, 'id')));
  handle('providers:setApiKey', (id: unknown, key: unknown) => ctx.providers.setApiKey(str(id, 'id'), str(key, 'key')));
  handle('providers:clearApiKey', (id: unknown) => ctx.providers.clearApiKey(str(id, 'id')));
  handle('providers:health', (id: unknown) => ctx.providers.health(str(id, 'id')));
  handle('providers:models', (refresh: unknown) => ctx.providers.models(bool(refresh ?? false, 'refresh')));
  handle('providers:pull', (providerId: unknown, model: unknown) => {
    const provider = str(providerId, 'providerId');
    const name = str(model, 'model');
    // Pulls stream progress through `ai:pull`, so the IPC call returns immediately.
    void ctx.providers.pull(provider, name).catch(() => undefined);
  });
  handle('providers:cancelPull', () => ctx.providers.cancelPull());
  handle('providers:removeModel', (providerId: unknown, model: unknown) =>
    ctx.providers.removeModel(str(providerId, 'providerId'), str(model, 'model')),
  );
  handle('providers:keepOnly', (providerId: unknown, keep: unknown) => {
    if (!Array.isArray(keep) || keep.some((entry) => typeof entry !== 'string')) {
      throw new Error('keep must be an array of model names');
    }
    return ctx.providers.keepOnly(str(providerId, 'providerId'), keep as string[]);
  });
  handle('providers:running', () => ctx.providers.running());

  // ── Conversations ────────────────────────────────────────────────────────
  handle('chat:list', (projectId: unknown) =>
    ctx.db.listConversations(typeof projectId === 'string' ? projectId : undefined),
  );
  handle('chat:create', (input: unknown) => {
    const value = (input ?? {}) as { projectId?: string; title?: string; mode?: string; model?: string };
    return ctx.db.createConversation({
      projectId: value.projectId,
      title: value.title?.trim() || 'New chat',
      mode: value.mode ?? 'chat',
      model: value.model,
    });
  });
  handle('chat:rename', (id: unknown, title: unknown) =>
    ctx.db.renameConversation(str(id, 'id'), str(title, 'title').slice(0, 200)),
  );
  handle('chat:remove', (id: unknown) => ctx.db.deleteConversation(str(id, 'id')));
  handle('chat:messages', (conversationId: unknown) => ctx.db.listMessages(str(conversationId, 'conversationId')));
  handle('chat:addMessage', (input: unknown) => {
    const value = (input ?? {}) as Parameters<Database['addMessage']>[0];
    if (!value.conversationId) throw new Error('conversationId is required');
    return ctx.db.addMessage(value);
  });
  handle('chat:clear', (conversationId: unknown) => ctx.db.clearMessages(str(conversationId, 'conversationId')));

  // ── Chat streaming ───────────────────────────────────────────────────────
  handle('ai:stream', (rawArgs: unknown) => {
    const args = streamChatSchema.parse(rawArgs);
    if (streams.has(args.requestId)) throw new Error('A generation with this request id is already running');
    const controller = new AbortController();
    streams.set(args.requestId, controller);
    const projectId = ctx.workspace.isOpen() ? ctx.workspace.projectId : undefined;
    const started = Date.now();
    void (async () => {
      try {
        const provider = ctx.providers.build(args.providerId);
        for await (const delta of provider.chat(
          {
            providerId: args.providerId,
            model: args.model,
            messages: args.messages,
            temperature: args.temperature,
            maxTokens: args.maxTokens,
            contextLength: args.contextLength,
            thinking: args.thinking,
          },
          controller.signal,
        )) {
          if (delta.type === 'usage') {
            ctx.db.recordUsage({
              projectId,
              model: args.model,
              promptTokens: delta.promptTokens,
              outputTokens: delta.outputTokens,
              durationMs: Date.now() - started,
            });
          }
          ctx.broadcast('ai:stream', { requestId: args.requestId, delta });
          if (delta.type === 'done' || delta.type === 'error') break;
        }
        if (controller.signal.aborted) {
          ctx.broadcast('ai:stream', { requestId: args.requestId, delta: { type: 'done', stopReason: 'cancelled' } });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          ctx.broadcast('ai:stream', { requestId: args.requestId, delta: { type: 'done', stopReason: 'cancelled' } });
        } else {
          ctx.broadcast('ai:stream', {
            requestId: args.requestId,
            delta: { type: 'error', message: resolveAbort(error, controller) },
          });
        }
      } finally {
        streams.delete(args.requestId);
      }
    })();
  });

  handle('ai:cancel', (requestId: unknown) => {
    streams.get(str(requestId, 'requestId'))?.abort(new Error('Generation cancelled'));
  });

  handle('ai:complete', async (raw: unknown): Promise<CompletionResponse> => {
    const args = (raw ?? {}) as {
      filePath?: string;
      language?: string;
      prefix?: string;
      suffix?: string;
      providerId?: string;
      model?: string;
    };
    const settings = ctx.settings.get();
    if (!settings.completion.enabled) throw new Error('Inline completion is disabled in settings');
    // Prefer fast completion model (e.g. sopu-coder-fast / 4b) for instant autocomplete; fall back to chat
    const binding =
      args.providerId && args.model
        ? { providerId: args.providerId, model: args.model }
        : await ctx.providers.resolveRole('fast').catch(() => ctx.providers.resolveChat());
    const providerConfig = ctx.providers.list().find((item) => item.id === binding.providerId);
    const response = await collectChat(ctx, {
      providerId: binding.providerId,
      model: binding.model,
      temperature: 0.1,
      maxTokens: settings.completion.maxTokens,
      contextLength: providerConfig?.config.contextLength ?? 8192,
      timeoutMs: 60_000,
      messages: [
        {
          role: 'system',
          content:
            'You are ForgeAI inline completion. Continue the code exactly at the <CURSOR> marker. ' +
            'Output only the characters to insert, with no explanation, no markdown fences and no repetition of existing code. ' +
            'Prefer short, syntactically valid continuations. Return nothing if no continuation is obvious.',
        },
        {
          role: 'user',
          content: `File: ${args.filePath ?? 'untitled'} (${args.language ?? 'text'})\n\n${args.prefix ?? ''}<CURSOR>${args.suffix ?? ''}`,
        },
      ],
    });
    return { text: cleanCompletion(response.text), model: response.model };
  });

  handle('ai:quickEdit', async (raw: unknown) => {
    const args = (raw ?? {}) as {
      action?: string;
      code?: string;
      language?: string;
      path?: string;
      providerId?: string;
      model?: string;
    };
    const action = str(args.action, 'action');
    if (!['explain', 'refactor', 'tests', 'docs'].includes(action)) throw new Error('Unknown quick edit action');
    if (!args.code?.trim()) throw new Error('Select some code first');
    const binding = await ctx.providers.resolveChat({ providerId: args.providerId, model: args.model });
    const providerConfig = ctx.providers.list().find((item) => item.id === binding.providerId);
    const instructions: Record<string, string> = {
      explain:
        'Explain what this code does. Cover purpose, data flow, important edge cases and any risks. Use concise markdown. Do not rewrite the code.',
      refactor:
        'Refactor this code for clarity, correctness and consistency with its surroundings. Keep behavior identical. Return the complete replacement code in one fenced code block, preceded by at most three bullet points describing the changes.',
      tests:
        'Write thorough automated tests for this code using the project framework when it can be inferred. Cover happy paths, edge cases and failures. Return the complete test file in one fenced code block.',
      docs: 'Write documentation for this code: a short summary, parameters, return values, errors and an example. Use markdown. Do not change the code.',
    };
    const response = await collectChat(ctx, {
      providerId: binding.providerId,
      model: binding.model,
      temperature: 0.2,
      maxTokens: 3000,
      contextLength: providerConfig?.config.contextLength ?? 8192,
      projectId: ctx.workspace.isOpen() ? ctx.workspace.projectId : undefined,
      messages: [
        { role: 'system', content: instructions[action]! },
        {
          role: 'user',
          content: `File: ${args.path ?? 'untitled'} (${args.language ?? 'text'})\n\n\`\`\`${args.language ?? ''}\n${args.code}\n\`\`\``,
        },
      ],
    });
    const text = stripCodeFence(response.text);
    if (!text) throw new Error('The model returned an empty answer');
    return text;
  });

  handle('ai:usage', () => ctx.db.usageStats());

  // ── Agents ───────────────────────────────────────────────────────────────
  handle('agent:start', (raw: unknown) => {
    const request = agentRunSchema.parse(raw) as AgentRunRequest;
    if (!ctx.workspace.isOpen() || ctx.workspace.projectId !== request.projectId) {
      throw new Error('Open this project before starting an agent run');
    }
    const handleRun = ctx.agent.start(request);
    void handleRun.completion.then(async ({ report, error }) => {
      if (!request.feature) return;
      try {
        const reportLine = `**Run ${handleRun.runId}** (${request.agent}) — ${report.summary}${
          report.filesChanged.length ? `\n\nFiles: ${report.filesChanged.join(', ')}` : ''
        }`;
        await ctx.specs.appendImplementationReport(request.feature, reportLine);
        if (error && request.specTaskId) {
          await ctx.specs.updateTask(
            request.projectId,
            request.feature,
            request.specTaskId,
            'failed',
            `Agent error: ${error}`,
          );
        }
      } catch {
        // Reporting is best-effort and must not crash the main process.
      }
    });
    return { runId: handleRun.runId };
  });

  handle('agent:cancel', (runId: unknown) => ctx.agent.cancel(str(runId, 'runId')));
  handle('agent:respond', (raw: unknown) => {
    const response = permissionResponseSchema.parse(raw) as PermissionResponse;
    ctx.permissions.respond(response);
  });
  handle('agent:pending', () => ctx.permissions.pendingRequests());

  // ── Specs ────────────────────────────────────────────────────────────────
  handle('specs:list', (projectId: unknown) => {
    requireProject(ctx, projectId);
    return ctx.specs.list();
  });
  handle('specs:get', (projectId: unknown, feature: unknown) => {
    requireProject(ctx, projectId);
    return ctx.specs.get(str(feature, 'feature'));
  });
  handle('specs:create', (projectId: unknown, feature: unknown, description: unknown) => {
    requireProject(ctx, projectId);
    return ctx.specs.create(str(feature, 'feature'), str(description, 'description'));
  });
  handle('specs:generate', (projectId: unknown, feature: unknown, phase: unknown) => {
    requireProject(ctx, projectId);
    return ctx.specs.generate(str(feature, 'feature'), str(phase, 'phase') as SpecPhase);
  });
  handle('specs:update', (projectId: unknown, feature: unknown, part: unknown, content: unknown) => {
    requireProject(ctx, projectId);
    return ctx.specs.updatePart(
      str(feature, 'feature'),
      str(part, 'part') as 'requirements' | 'design' | 'tasks',
      str(content, 'content'),
    );
  });
  handle('specs:approve', (projectId: unknown, feature: unknown, phase: unknown) => {
    requireProject(ctx, projectId);
    return ctx.specs.approve(str(feature, 'feature'), str(phase, 'phase') as SpecPhase);
  });
  handle('specs:updateTask', async (projectId: unknown, feature: unknown, taskId: unknown, patch: unknown) => {
    requireProject(ctx, projectId);
    const name = str(feature, 'feature');
    await ctx.specs.updateTask(
      str(projectId, 'projectId'),
      name,
      str(taskId, 'taskId'),
      (patch ?? {}) as Partial<SpecTask>,
    );
    return ctx.specs.get(name);
  });
  handle('specs:remove', (projectId: unknown, feature: unknown) => {
    requireProject(ctx, projectId);
    return ctx.specs.remove(str(feature, 'feature'));
  });

  // ── Index ────────────────────────────────────────────────────────────────
  handle('index:status', (projectId: unknown) => ctx.indexer.status(requireProject(ctx, projectId)));
  handle('index:start', (projectId: unknown) => ctx.indexer.start(requireProject(ctx, projectId)));
  handle('index:cancel', (projectId: unknown) => ctx.indexer.cancel(requireProject(ctx, projectId)));
  handle('index:search', (projectId: unknown, query: unknown, limit: unknown) =>
    ctx.indexer.search(requireProject(ctx, projectId), str(query, 'query'), typeof limit === 'number' ? limit : 12),
  );
  handle('index:symbols', (projectId: unknown, query: unknown) =>
    ctx.indexer.symbols(requireProject(ctx, projectId), typeof query === 'string' && query ? query : undefined),
  );
  handle('index:rebuild', (projectId: unknown) => ctx.indexer.start(requireProject(ctx, projectId), true));

  // ── Search ───────────────────────────────────────────────────────────────
  handle('search:text', (projectId: unknown, options: unknown) => {
    requireProject(ctx, projectId);
    return ctx.search.text(searchOptionsSchema.parse(options));
  });
  handle('search:files', (projectId: unknown, query: unknown, limit: unknown) => {
    requireProject(ctx, projectId);
    return ctx.search.files(str(query, 'query'), typeof limit === 'number' ? Math.min(Math.max(1, limit), 500) : 100);
  });

  // ── Git ──────────────────────────────────────────────────────────────────
  handle('git:status', (projectId: unknown) => {
    requireProject(ctx, projectId);
    return ctx.git.status();
  });
  handle('git:diff', (projectId: unknown, relativePath: unknown, staged: unknown) => {
    requireProject(ctx, projectId);
    return ctx.git.diff(typeof relativePath === 'string' ? relativePath : undefined, staged === true);
  });
  handle('git:branches', (projectId: unknown) => {
    requireProject(ctx, projectId);
    return ctx.git.branches();
  });
  handle('git:checkout', async (projectId: unknown, branch: unknown) => {
    requireProject(ctx, projectId);
    await ctx.git.checkout(str(branch, 'branch'));
    ctx.broadcast('git:changed', { projectId: str(projectId, 'projectId') });
  });
  handle('git:createBranch', async (projectId: unknown, name: unknown) => {
    requireProject(ctx, projectId);
    await ctx.git.createBranch(str(name, 'name'));
    ctx.broadcast('git:changed', { projectId: str(projectId, 'projectId') });
  });
  handle('git:stage', async (projectId: unknown, paths: unknown) => {
    requireProject(ctx, projectId);
    await ctx.git.stage(stringList(paths, 'paths'));
    ctx.broadcast('git:changed', { projectId: str(projectId, 'projectId') });
  });
  handle('git:unstage', async (projectId: unknown, paths: unknown) => {
    requireProject(ctx, projectId);
    await ctx.git.unstage(stringList(paths, 'paths'));
    ctx.broadcast('git:changed', { projectId: str(projectId, 'projectId') });
  });
  handle('git:commit', async (projectId: unknown, message: unknown, paths: unknown) => {
    const id = requireProject(ctx, projectId);
    const text = commitSchema.parse(message);
    const targets = paths === undefined ? undefined : stringList(paths, 'paths');
    const response = await ctx.permissions.require({
      kind: 'commit',
      title: 'Commit changes',
      detail: `${text}${targets && targets.length ? `\n\nFiles: ${targets.join(', ')}` : ''}`,
      paths: targets,
      toolName: 'git.commit',
    });
    if (response.decision === 'denied') throw new Error('Commit was not approved');
    const hash = await ctx.git.commit(text, targets);
    ctx.broadcast('git:changed', { projectId: id });
    return hash;
  });
  handle('git:log', (projectId: unknown, limit: unknown) => {
    requireProject(ctx, projectId);
    return ctx.git.log(typeof limit === 'number' ? limit : 30);
  });
  handle('git:discard', async (projectId: unknown, paths: unknown) => {
    const id = requireProject(ctx, projectId);
    const targets = stringList(paths, 'paths');
    if (targets.length === 0) return;
    const response = await ctx.permissions.require({
      kind: 'delete',
      title: `Discard changes in ${targets.length} ${targets.length === 1 ? 'file' : 'files'}`,
      detail: `${targets.slice(0, 30).join('\n')}\n\nThis permanently discards uncommitted edits.`,
      paths: targets,
      toolName: 'git.discard',
    });
    if (response.decision === 'denied') throw new Error('Discard was not approved');
    await ctx.git.discard(targets);
    ctx.broadcast('git:changed', { projectId: id });
  });
  handle('git:generateMessage', async (projectId: unknown) => {
    requireProject(ctx, projectId);
    const patch = await ctx.git.workingTreePatch();
    if (!patch.trim()) throw new Error('There are no changes to describe');
    let binding: { providerId: string; model: string };
    try {
      binding = await ctx.providers.resolveRole('fast');
    } catch {
      binding = await ctx.providers.resolveRole('chat');
    }
    const config = ctx.providers.list().find((item) => item.id === binding.providerId);
    const response = await collectChat(ctx, {
      providerId: binding.providerId,
      model: binding.model,
      temperature: 0.1,
      maxTokens: 120,
      contextLength: config?.config.contextLength ?? 8192,
      timeoutMs: 60_000,
      messages: [
        {
          role: 'system',
          content:
            'You write git commit messages. Return exactly one conventional-commit subject line (type(scope): summary) under 72 characters. No body, no quotes, no code fences.',
        },
        { role: 'user', content: `Diff:\n${patch.slice(0, 12_000)}` },
      ],
    });
    const line =
      response.text
        .split('\n')
        .map((entry) =>
          entry
            .trim()
            .replace(/^[-*]\s*/, '')
            .replace(/^`|`$/g, ''),
        )
        .find((entry) => entry.length > 0) ?? '';
    if (!line) throw new Error('The model returned no commit message');
    return line.slice(0, 100);
  });

  // ── Terminal ─────────────────────────────────────────────────────────────
  handle('terminal:create', (options: unknown) => {
    if (!ctx.workspace.isOpen()) throw new Error('Open a folder before starting a terminal');
    return ctx.terminal.create((options ?? {}) as { cwd?: string; cols?: number; rows?: number });
  });
  handle('terminal:write', (id: unknown, data: unknown) => {
    ctx.terminal.write(str(id, 'id'), str(data, 'data'));
  });
  handle('terminal:resize', (id: unknown, cols: unknown, rows: unknown) => {
    ctx.terminal.resize(str(id, 'id'), Math.round(num(cols, 'cols')), Math.round(num(rows, 'rows')));
  });
  handle('terminal:dispose', (id: unknown) => ctx.terminal.dispose(str(id, 'id')));
  handle('terminal:list', () => ctx.terminal.list());

  // ── Checkpoints ──────────────────────────────────────────────────────────
  handle('checkpoints:list', (projectId: unknown) => ctx.checkpoints.list(requireProject(ctx, projectId)));
  handle('checkpoints:create', (projectId: unknown, label: unknown) => {
    const id = requireProject(ctx, projectId);
    return ctx.checkpoints.create(id, str(label, 'label').slice(0, 160) || 'Manual checkpoint');
  });
  handle('checkpoints:restore', async (projectId: unknown, checkpointId: unknown) => {
    const id = requireProject(ctx, projectId);
    const row = ctx.db.getCheckpointRow(str(checkpointId, 'checkpointId'));
    if (!row || row.projectId !== id) throw new Error('Checkpoint not found');
    const response = await ctx.permissions.require({
      kind: 'restore',
      title: `Restore checkpoint “${row.label}”`,
      detail: `This rewrites ${row.files.length} file${row.files.length === 1 ? '' : 's'} to their saved state. A rollback checkpoint is created first.`,
      paths: row.files,
      toolName: 'checkpoint.restore',
    });
    if (response.decision === 'denied') throw new Error('Restore was not approved');
    await ctx.checkpoints.restore(id, row.id);
    ctx.broadcast('git:changed', { projectId: id });
  });
  handle('checkpoints:diff', (projectId: unknown, checkpointId: unknown) => {
    requireProject(ctx, projectId);
    return ctx.checkpoints.diff(str(projectId, 'projectId'), str(checkpointId, 'checkpointId'));
  });

  return () => {
    for (const controller of streams.values()) controller.abort(new Error('Application is shutting down'));
    streams.clear();
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
    registeredChannels.clear();
  };
}

function resolveAbort(error: unknown, controller: AbortController): string {
  if (controller.signal.aborted) {
    const reason = controller.signal.reason;
    if (reason instanceof Error && reason.message) return reason.message;
    return 'Generation cancelled';
  }
  return error instanceof Error ? error.message : String(error);
}
