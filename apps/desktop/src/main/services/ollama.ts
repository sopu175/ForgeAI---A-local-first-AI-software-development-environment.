import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promises as fs, closeSync, openSync, type Dirent } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CONTEXT,
  DEFAULT_OLLAMA_KEEP_ALIVE,
  DEFAULT_OLLAMA_MODEL,
  SOPU_CODER_RECIPE,
  SOPU_CODER_FAST_RECIPE,
  LEGACY_OLLAMA_MODELS,
  normalizeOllamaKeepAlive,
  type ProviderConfig,
  type RuntimeStatus,
} from '@forgeai/shared';
import { safeFetch, normalizeLoopbackUrl } from '@forgeai/ai';
import type { Broadcast } from './workspace';
import type { ProvidersService } from './providers';
import type { SettingsService } from './settings';

const execFileAsync = promisify(execFile);
const START_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 1_500;

interface RuntimeOptions {
  auto?: boolean;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function archiveForPlatform(): { url: string; file: string; kind: 'tgz' | 'zip' } {
  const arm = process.arch === 'arm64';
  if (process.platform === 'darwin') {
    return {
      url: 'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz',
      file: 'ollama-darwin.tgz',
      kind: 'tgz',
    };
  }
  if (process.platform === 'win32') {
    const asset = arm ? 'ollama-windows-arm64.zip' : 'ollama-windows-amd64.zip';
    return {
      url: `https://github.com/ollama/ollama/releases/latest/download/${asset}`,
      file: asset,
      kind: 'zip',
    };
  }
  const asset = arm ? 'ollama-linux-arm64.tgz' : 'ollama-linux-amd64.tgz';
  return {
    url: `https://github.com/ollama/ollama/releases/latest/download/${asset}`,
    file: asset,
    kind: 'tgz',
  };
}

function binaryName(): string {
  return process.platform === 'win32' ? 'ollama.exe' : 'ollama';
}

async function exists(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findBinary(root: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === binaryName()) return full;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
    const found = await findBinary(path.join(root, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Keeps the local Ollama runtime ready: locates or downloads Ollama, starts the
 * server, and pulls the default ForgeAI model (`qwen3.5:4b`).
 *
 * All work is visible through `runtime:progress`; `FORGEAI_OLLAMA_AUTO=0`
 * disables the first-launch bootstrap and `FORGEAI_OLLAMA_MODEL` overrides the
 * model name.
 */
export class OllamaRuntime {
  private task: Promise<RuntimeStatus> | null = null;
  private controller: AbortController | null = null;
  private server: ChildProcess | null = null;
  private serverManaged = false;
  private binary: string | null = null;
  private logStream: number | null = null;
  private lastBroadcast = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  private state: RuntimeStatus = {
    providerId: 'ollama',
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    model: DEFAULT_OLLAMA_MODEL,
    stage: 'idle',
    installed: false,
    running: false,
    modelInstalled: false,
    auto: false,
    updatedAt: Date.now(),
  };

  constructor(
    private readonly userDataDir: string,
    private readonly providers: ProvidersService,
    private readonly settings: SettingsService,
    private readonly broadcast: Broadcast,
  ) {}

  status(): RuntimeStatus {
    const config = this.config();
    return {
      ...this.state,
      baseUrl: config.baseUrl,
      model: this.modelName(),
    };
  }

  /** Whether the local runtime needs any work. Cheap enough for first paint. */
  async snapshot(): Promise<RuntimeStatus> {
    const config = this.config();
    const health = await this.health(config.baseUrl).catch(() => null);
    this.state = {
      ...this.state,
      baseUrl: config.baseUrl,
      model: this.modelName(),
      running: Boolean(health),
      installed: this.state.installed || Boolean(this.binary) || Boolean(await this.locateBinary()),
      version: health?.version ?? this.state.version,
      updatedAt: Date.now(),
    };
    return this.status();
  }

  async ensure(options: RuntimeOptions = {}): Promise<RuntimeStatus> {
    if (this.task) return this.task;
    const controller = new AbortController();
    this.controller = controller;
    this.task = this.run(controller.signal, options).finally(() => {
      this.task = null;
      this.controller = null;
    });
    return this.task;
  }

  autoSetup(): void {
    if (process.env['FORGEAI_OLLAMA_AUTO'] === '0') return;
    void this.ensure({ auto: true }).catch((error) => {
      console.warn('[forgeai] Ollama auto-setup failed:', error instanceof Error ? error.message : error);
    });
  }

  cancel(): void {
    this.controller?.abort(new Error('Cancelled by user'));
    this.controller = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.cancel();
    if (this.serverManaged && this.server) {
      try {
        this.server.kill();
      } catch {
        // The server may already have exited.
      }
    }
    this.server = null;
    this.serverManaged = false;
    if (this.logStream !== null) {
      try {
        closeSync(this.logStream);
      } catch {
        // ignore
      }
      this.logStream = null;
    }
  }

  // ── pipeline ─────────────────────────────────────────────────────────────

  private async run(signal: AbortSignal, options: RuntimeOptions): Promise<RuntimeStatus> {
    const auto = Boolean(options.auto);
    try {
      const config = this.config();
      this.update({
        stage: 'checking',
        auto,
        baseUrl: config.baseUrl,
        model: this.modelName(),
        error: undefined,
        detail: 'Looking for a local Ollama server…',
      });

      let health = await this.health(config.baseUrl).catch(() => null);
      if (health) {
        this.state = { ...this.state, installed: true, running: true, version: health.version };
        this.broadcastState();
      } else {
        let binary = this.binary ?? (await this.locateBinary());
        if (!binary) {
          binary = await this.install(signal);
        }
        this.binary = binary;
        this.update({
          stage: 'starting',
          installed: true,
          running: false,
          detail: 'Starting the Ollama server…',
        });
        await this.startServer(binary, config, signal);
        health = await this.waitForHealth(config.baseUrl, signal);
        this.state = { ...this.state, running: true, version: health?.version };
        this.broadcastState();
      }

      // A fresh system install may need a moment before the tags endpoint is up.
      let tags = await this.tags(config.baseUrl, signal).catch(() => []);

      // Automatically build/install Sopu AI custom models if missing
      await this.ensureSopuModels(config.baseUrl, signal).catch((err) => {
        console.warn('[forgeai] Failed to auto-build Sopu AI models:', err);
      });
      tags = await this.tags(config.baseUrl, signal).catch(() => []);

      let modelInstalled = this.hasModel(tags, this.modelName());
      if (!modelInstalled) {
        await this.pullModel(config.baseUrl, this.modelName(), signal);
        const after = await this.tags(config.baseUrl, signal).catch(() => []);
        modelInstalled = this.hasModel(after, this.modelName());
      }

      this.applyDefaultRoles();

      this.update({
        stage: 'ready',
        running: true,
        installed: true,
        modelInstalled,
        percent: 100,
        detail: modelInstalled
          ? `${this.modelName()} is ready (${config.baseUrl})`
          : `Ollama is running, but ${this.modelName()} is not installed yet.`,
        error: undefined,
      });
      // Make the newly pulled model visible to the rest of the app immediately.
      void this.providers.models(true).catch(() => undefined);
      if (modelInstalled) {
        // Load the weights now so the first chat/agent request does not pay the load cost.
        void this.warmModel(config.baseUrl);
        if (auto) void this.pruneLegacyModels(config.baseUrl, signal);
      }
      // Keep Ollama alive for the whole app session, even if the child dies.
      this.startWatchdog();
      return this.status();
    } catch (error) {
      const aborted = signal.aborted || (error instanceof Error && /abort|cancell?ed/i.test(error.message));
      const message = error instanceof Error ? error.message : String(error);
      if (aborted) {
        this.update({ stage: 'cancelled', auto, detail: 'Local model setup was cancelled.', error: undefined });
      } else {
        this.update({
          stage: 'error',
          auto,
          detail: 'Local model setup failed. You can retry from the model manager.',
          error: message,
        });
        this.broadcast('app:toast', { kind: 'error', message: `Ollama setup failed: ${message}` });
      }
      return this.status();
    }
  }

  private async install(signal: AbortSignal): Promise<string> {
    const archive = archiveForPlatform();
    const runtimeRoot = path.join(this.userDataDir, 'runtime');
    const installDir = path.join(runtimeRoot, 'ollama');
    const downloadPath = path.join(runtimeRoot, archive.file);

    await fs.mkdir(runtimeRoot, { recursive: true });
    this.update({
      stage: 'installing',
      installed: false,
      percent: 0,
      detail: 'Ollama was not found. Downloading the official runtime…',
    });

    await this.download(archive.url, downloadPath, signal);

    this.update({ stage: 'installing', detail: 'Extracting Ollama…', percent: 96 });
    await fs.rm(installDir, { recursive: true, force: true });
    await fs.mkdir(installDir, { recursive: true });
    if (archive.kind === 'zip') {
      try {
        await execFileAsync('tar', ['-xf', downloadPath, '-C', installDir], { timeout: 180_000 });
      } catch (error) {
        throw new Error(`Could not extract the Ollama archive: ${(error as Error).message}`);
      }
    } else {
      try {
        await execFileAsync('tar', ['-xzf', downloadPath, '-C', installDir], { timeout: 180_000 });
      } catch (error) {
        throw new Error(`Could not extract the Ollama archive: ${(error as Error).message}`);
      }
    }

    const binary = await findBinary(installDir);
    if (!binary) throw new Error('The downloaded Ollama archive did not contain the ollama executable.');
    try {
      await fs.chmod(binary, 0o755);
    } catch {
      // Windows does not use POSIX permissions.
    }
    await fs.rm(downloadPath, { force: true });
    this.broadcast('app:toast', { kind: 'success', message: 'Ollama runtime installed for ForgeAI.' });
    return binary;
  }

  private async download(url: string, destination: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'ForgeAI/0.1 (+https://github.com/forgeai)' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status} ${response.statusText}) from ${url}`);
    }
    const totalHeader = Number(response.headers.get('content-length'));
    const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
    const handle = await fs.open(destination, 'w');
    const reader = response.body.getReader();
    let completed = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        await handle.write(value);
        completed += value.byteLength;
        const percent = total ? Math.min(95, (completed / total) * 95) : undefined;
        this.update(
          {
            stage: 'installing',
            completedBytes: completed,
            totalBytes: total,
            percent,
            detail: total
              ? `Downloading Ollama… ${Math.round((completed / total) * 100)}%`
              : `Downloading Ollama… ${(completed / 1_048_576).toFixed(0)} MB`,
          },
          250,
        );
      }
    } finally {
      await handle.close();
    }
  }

  private async startServer(binary: string, config: ProviderConfig, signal: AbortSignal | null): Promise<void> {
    if (this.server && !this.server.killed) return;
    const url = new URL(config.baseUrl);
    const hostname = process.platform === 'win32' && url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
    const host = `${hostname}:${url.port || '11434'}`;
    const logDir = path.join(this.userDataDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, 'ollama.log');
    const fd = openSync(logPath, 'a');
    this.logStream = fd;

    const child = spawn(binary, ['serve'], {
      cwd: path.dirname(binary),
      env: {
        ...process.env,
        OLLAMA_HOST: host,
        // The user asked for Ollama to stay up while ForgeAI is open. `-1`
        // disables Ollama's idle unload, so weights stay in RAM/VRAM.
        OLLAMA_KEEP_ALIVE: DEFAULT_OLLAMA_KEEP_ALIVE,
        // One model, one parallel request: no cache thrashing on 8 GB machines.
        OLLAMA_NUM_PARALLEL: '1',
        OLLAMA_MAX_LOADED_MODELS: '1',
        // Faster prefill/decode on Metal and CUDA.
        OLLAMA_FLASH_ATTENTION: '1',
        // Quantized 8-bit KV cache cuts context RAM in half on Apple Silicon.
        OLLAMA_KV_CACHE_TYPE: 'q8_0',
        OLLAMA_CONTEXT_LENGTH: '8192',
      },
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
    this.server = child;
    this.serverManaged = true;
    child.once('error', (error) => {
      this.update({ stage: 'error', error: `Could not start Ollama: ${error.message}` });
    });
    child.once('exit', (code) => {
      if (this.server === child) {
        this.server = null;
        this.serverManaged = false;
        if (this.state.running) {
          this.state.running = false;
          this.broadcastState();
        }
      }
      if (code && code !== 0) {
        console.warn(`[forgeai] Ollama exited with code ${code}; see ${logPath}`);
      }
    });
    signal?.addEventListener(
      'abort',
      () => {
        if (this.server === child) {
          try {
            child.kill();
          } catch {
            // ignore
          }
        }
      },
      { once: true },
    );
  }

  private async waitForHealth(baseUrl: string, signal: AbortSignal): Promise<{ version?: string } | null> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('Cancelled');
      const health = await this.health(baseUrl).catch(() => null);
      if (health) return health;
      await delay(600, signal);
    }
    throw new Error(
      'Ollama did not become ready in time. Check the log in ForgeAI data/logs/ollama.log or start it manually.',
    );
  }

  private async health(baseUrl: string): Promise<{ version?: string } | null> {
    const url = normalizeLoopbackUrl(baseUrl);
    const response = await safeFetch(`${url}/api/version`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    }).catch(() => null);
    if (!response || !response.ok) return null;
    const payload = (await response.json().catch(() => ({}))) as { version?: string };
    return { version: payload.version };
  }

  private async tags(baseUrl: string, signal: AbortSignal): Promise<string[]> {
    const url = normalizeLoopbackUrl(baseUrl);
    const response = await safeFetch(`${url}/api/tags`, { signal });
    if (!response.ok) throw new Error(`Ollama returned ${response.status} for /api/tags`);
    const payload = (await response.json()) as { models?: { name?: string; model?: string }[] };
    return (payload.models ?? []).map((entry) => entry.name ?? entry.model ?? '').filter(Boolean);
  }

  private hasModel(tags: string[], model: string): boolean {
    const wanted = model.trim();
    const bare = wanted.replace(/:latest$/, '');
    return tags.some((tag) => {
      const name = tag.replace(/:latest$/, '');
      return name === bare;
    });
  }

  private async pullModel(baseUrl: string, model: string, signal: AbortSignal): Promise<void> {
    const url = normalizeLoopbackUrl(baseUrl);
    this.update({
      stage: 'pulling',
      modelInstalled: false,
      percent: 0,
      completedBytes: undefined,
      totalBytes: undefined,
      detail: `Downloading ${model}…`,
    });
    const response = await safeFetch(`${url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`Could not download ${model}: ${response.status} ${text.slice(0, 300)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        this.consumePullLine(line, model);
      }
    }
    if (buffer.trim()) this.consumePullLine(buffer, model);
    this.state = { ...this.state, modelInstalled: true };
    this.broadcastState();
  }

  /** Automatically build and verify custom Sopu AI models from modelfile recipes */
  private async ensureSopuModels(baseUrl: string, signal: AbortSignal): Promise<void> {
    const tags = await this.tags(baseUrl, signal).catch(() => []);

    // 1. Build sopu-coder if missing
    if (!this.hasModel(tags, SOPU_CODER_RECIPE.model)) {
      if (!this.hasModel(tags, SOPU_CODER_RECIPE.from)) {
        await this.pullModel(baseUrl, SOPU_CODER_RECIPE.from, signal);
      }
      await this.createCustomModel(baseUrl, SOPU_CODER_RECIPE);
    }

    // 2. Build sopu-coder-fast if missing
    if (!this.hasModel(tags, SOPU_CODER_FAST_RECIPE.model)) {
      if (!this.hasModel(tags, SOPU_CODER_FAST_RECIPE.from)) {
        await this.pullModel(baseUrl, SOPU_CODER_FAST_RECIPE.from, signal);
      }
      await this.createCustomModel(baseUrl, SOPU_CODER_FAST_RECIPE);
    }
  }

  private async createCustomModel(
    baseUrl: string,
    recipe: { model: string; from: string; system: string; parameters: Record<string, unknown> },
  ): Promise<void> {
    const url = normalizeLoopbackUrl(baseUrl);
    this.update({
      stage: 'starting',
      detail: `Creating custom Sopu AI model ${recipe.model} from ${recipe.from}…`,
    });
    const response = await safeFetch(`${url}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: recipe.model,
        from: recipe.from,
        system: recipe.system,
        parameters: recipe.parameters,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Failed to create model ${recipe.model}: ${response.status} ${err}`);
    }
  }

  private consumePullLine(line: string, model: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let payload: { status?: string; completed?: number; total?: number; error?: string };
    try {
      payload = JSON.parse(trimmed) as typeof payload;
    } catch {
      return;
    }
    if (payload.error) throw new Error(payload.error);
    const percent =
      payload.total && payload.completed ? Math.min(99, (payload.completed / payload.total) * 99) : undefined;
    this.update(
      {
        stage: 'pulling',
        detail: `${model}: ${payload.status ?? 'downloading'}`,
        completedBytes: payload.completed,
        totalBytes: payload.total,
        percent,
      },
      300,
    );
  }

  /**
   * Assign default roles for unconfigured slots while preserving user selections
   * and high-performance models (such as qwen2.5-coder, deepseek-r1, or nomic-embed-text).
   */
  private applyDefaultRoles(): void {
    const roles = { ...this.settings.get().modelRoles };
    let changed = false;

    const primary = 'sopu-coder';
    const fast = 'sopu-coder-fast';

    for (const role of ['chat', 'coding', 'plan', 'review'] as const) {
      const current = roles[role];
      if (!current?.model || current.model.includes('14b')) {
        roles[role] = { providerId: 'ollama', model: primary };
        changed = true;
      }
    }
    if (!roles.fast?.model) {
      roles.fast = { providerId: 'ollama', model: fast };
      changed = true;
    }

    if (roles.embedding?.providerId === 'ollama' && (roles.embedding.model === primary || roles.embedding.model === DEFAULT_OLLAMA_MODEL)) {
      delete roles.embedding;
      changed = true;
    }
    if (changed) this.settings.update({ modelRoles: roles });
  }

  /** Preload weights and the KV cache so the first token is fast. */
  private async warmModel(baseUrl: string): Promise<void> {
    try {
      const url = normalizeLoopbackUrl(baseUrl);
      await safeFetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName(),
          prompt: '',
          stream: false,
          keep_alive: normalizeOllamaKeepAlive(DEFAULT_OLLAMA_KEEP_ALIVE),
          options: {
            num_ctx: DEFAULT_OLLAMA_CONTEXT,
            num_predict: 1,
            temperature: 0,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      // The model will load on the first real request instead.
    }
  }

  /**
   * Delete chat models earlier ForgeAI builds advertised. Embedding models and
   * anything installed by the user are left alone; the Models view offers an
   * explicit "keep only" action for a full cleanup.
   */
  private async pruneLegacyModels(baseUrl: string, signal: AbortSignal): Promise<void> {
    const url = normalizeLoopbackUrl(baseUrl);
    const tags = await this.tags(url, signal).catch(() => []);
    const keep = this.modelName().replace(/:latest$/, '');
    const legacy = new Set<string>(LEGACY_OLLAMA_MODELS);
    const targets = tags.filter((tag) => {
      const bare = tag.replace(/:latest$/, '');
      return bare !== keep && legacy.has(bare) && !/embed/i.test(bare);
    });
    let removed = 0;
    for (const name of targets) {
      if (signal.aborted) return;
      try {
        const response = await safeFetch(`${url}/api/delete`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, model: name }),
          signal,
        });
        if (response.ok) removed += 1;
      } catch {
        return;
      }
    }
    if (removed > 0) {
      this.providers.invalidate();
      void this.providers.models(true).catch(() => undefined);
      this.broadcast('app:toast', {
        kind: 'info',
        message: `Removed ${removed} older ForgeAI model${removed === 1 ? '' : 's'}; ${this.modelName()} stays resident.`,
      });
    }
  }

  /** Restart the managed server if it exits while ForgeAI is still open. */
  private startWatchdog(): void {
    if (this.watchdog || this.disposed) return;
    this.watchdog = setInterval(() => void this.checkServer(), 15_000);
    this.watchdog.unref?.();
  }

  private async checkServer(): Promise<void> {
    if (this.disposed || this.task) return;
    const config = this.config();
    const health = await this.health(config.baseUrl).catch(() => null);
    if (health) {
      if (!this.state.running || this.state.version !== health.version) {
        this.update({ running: true, version: health.version });
      }
      return;
    }
    // Never fight a server the user started outside ForgeAI.
    if (!this.serverManaged && !this.binary) {
      if (this.state.running) this.update({ running: false });
      return;
    }
    const binary = this.binary ?? (await this.locateBinary());
    if (!binary) return;
    this.binary = binary;
    this.update({ stage: 'starting', running: false, detail: 'Restarting the local AI server…' });
    try {
      await this.startServer(binary, config, null);
      const ready = await this.waitForHealth(config.baseUrl, new AbortController().signal);
      this.update({
        stage: 'ready',
        running: true,
        installed: true,
        version: ready?.version,
        detail: `${this.modelName()} is ready (${config.baseUrl})`,
        error: undefined,
      });
      void this.warmModel(config.baseUrl);
    } catch (error) {
      this.update({
        stage: 'error',
        running: false,
        error: error instanceof Error ? error.message : String(error),
        detail: 'Ollama stopped and could not be restarted.',
      });
    }
  }

  private config(): ProviderConfig {
    const provider = this.providers.list().find((entry) => entry.id === 'ollama' || entry.kind === 'ollama');
    return (
      provider ?? {
        id: 'ollama',
        kind: 'ollama',
        name: 'Ollama',
        baseUrl: DEFAULT_OLLAMA_BASE_URL,
        enabled: true,
        config: { keepAlive: DEFAULT_OLLAMA_KEEP_ALIVE, contextLength: DEFAULT_OLLAMA_CONTEXT },
      }
    );
  }

  private modelName(): string {
    return process.env['FORGEAI_OLLAMA_MODEL']?.trim() || SOPU_CODER_RECIPE.model;
  }

  private async locateBinary(): Promise<string | null> {
    const candidates: string[] = [];
    const envBinary = process.env['OLLAMA_BIN'];
    if (envBinary) candidates.push(envBinary);
    const managed = path.join(this.userDataDir, 'runtime', 'ollama');
    if (await exists(managed)) {
      const found = await findBinary(managed);
      if (found) candidates.push(found);
    }
    candidates.push(
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      '/usr/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
      path.join(os.homedir(), 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'),
      path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(process.env['ProgramFiles'] ?? '', 'Ollama', 'ollama.exe'),
    );
    for (const candidate of candidates) {
      if (candidate && (await exists(candidate))) return candidate;
    }
    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execFileAsync(command, ['ollama'], { timeout: 4_000 });
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (first && (await exists(first))) return first;
    } catch {
      // Not on PATH.
    }
    return null;
  }

  private update(patch: Partial<RuntimeStatus>, throttleMs = 0): void {
    this.state = { ...this.state, ...patch, model: this.modelName(), updatedAt: Date.now() };
    const now = Date.now();
    if (throttleMs > 0 && now - this.lastBroadcast < throttleMs) return;
    this.broadcastState();
  }

  private broadcastState(): void {
    this.lastBroadcast = Date.now();
    this.broadcast('runtime:progress', this.status());
  }
}
