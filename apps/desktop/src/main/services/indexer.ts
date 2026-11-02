import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  chunkCode,
  defaultParser,
  embeddingText,
  blobToVector,
  normalizeVector,
  rankByKeywords,
  rankByVector,
  fileOverlapBoost,
  scanProject,
  vectorToBlob,
  type VectorCandidate,
} from '@forgeai/core';
import {
  isBinaryName,
  languageFromPath,
  looksBinary,
  type IndexStatus,
  type RetrievalResult,
  type SymbolInfo,
  type WorkspaceChangeEvent,
} from '@forgeai/shared';
import type { Database } from '../db';
import type { SettingsService } from './settings';
import type { ProvidersService } from './providers';
import type { Broadcast, WorkspaceService } from './workspace';

interface RunState {
  status: IndexStatus;
  controller: AbortController;
  timer?: NodeJS.Timeout;
}

const ZERO_STATUS = (projectId: string): IndexStatus => ({
  projectId,
  state: 'idle',
  filesIndexed: 0,
  filesTotal: 0,
  filesSkipped: 0,
  chunks: 0,
  embedded: 0,
  symbols: 0,
});

interface VectorCacheEntry {
  chunkId: number;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  vector: Float32Array;
}

interface VectorCache {
  model: string;
  entries: VectorCacheEntry[];
  builtAt: number;
}

export class IndexerService {
  private runs = new Map<string, RunState>();
  private incrementalTimers = new Map<string, NodeJS.Timeout>();
  private pendingPaths = new Map<string, Set<string>>();
  /** Per-project in-memory vector cache. Rebuilt once after indexing finishes; invalidated on incremental updates. */
  private vectorCaches = new Map<string, VectorCache>();

  constructor(
    private readonly db: Database,
    private readonly workspace: WorkspaceService,
    private readonly providers: ProvidersService,
    private readonly settings: SettingsService,
    private readonly broadcast: Broadcast,
  ) {
    workspace.onFileEvents((events) => this.onFileEvents(events));
  }

  status(projectId: string): IndexStatus {
    const run = this.runs.get(projectId);
    if (run && (run.status.state === 'scanning' || run.status.state === 'embedding')) return run.status;
    const counts = this.db.countIndex(projectId);
    const project = this.db.getProject(projectId);
    return {
      projectId,
      state: project?.indexStatus === 'ready' ? 'ready' : project?.indexStatus === 'error' ? 'error' : 'idle',
      filesIndexed: counts.files,
      filesTotal: counts.files,
      filesSkipped: 0,
      chunks: counts.chunks,
      embedded: counts.embedded,
      symbols: counts.symbols,
      message: run?.status.message,
    };
  }

  private emit(status: IndexStatus): void {
    this.broadcast('index:progress', status);
  }

  async start(projectId: string, rebuild = false): Promise<IndexStatus> {
    if (this.workspace.projectId !== projectId) throw new Error('Open this project before indexing it');
    const existing = this.runs.get(projectId);
    if (existing && (existing.status.state === 'scanning' || existing.status.state === 'embedding')) {
      return existing.status;
    }
    if (rebuild) this.db.clearIndex(projectId);

    const controller = new AbortController();
    const status: IndexStatus = {
      ...ZERO_STATUS(projectId),
      state: 'scanning',
      startedAt: Date.now(),
    };
    this.runs.set(projectId, { status, controller });
    this.db.updateIndexStatus(projectId, 'scanning');
    this.emit(status);
    void this.run(projectId, status, controller.signal);
    return status;
  }

  cancel(projectId: string): void {
    const run = this.runs.get(projectId);
    if (!run) return;
    run.controller.abort(new Error('Indexing cancelled'));
    run.status.state = 'idle';
    run.status.message = 'Indexing cancelled';
    this.emit(run.status);
    this.db.updateIndexStatus(projectId, 'idle');
  }

  private async run(projectId: string, status: IndexStatus, signal: AbortSignal): Promise<void> {
    try {
      const root = this.workspace.root;
      const config = this.settings.get().indexing;
      const scanned = await scanProject(root, {
        maxFileSizeKb: config.maxFileSizeKb,
        extraIgnore: config.ignoreGlobs,
        signal,
      });
      status.filesTotal = scanned.length;
      this.emit(status);

      const existing = new Map(this.db.listIndexFiles(projectId).map((file) => [file.path, file]));
      const seen = new Set<string>();
      let completed = 0;
      const total = scanned.length;

      const concurrency = 4;
      let cursor = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (cursor < scanned.length) {
          if (signal.aborted) return;
          const entry = scanned[cursor++];
          if (!entry) return;
          seen.add(entry.path);
          const known = existing.get(entry.path);
          if (known && Math.abs(known.mtime - entry.mtimeMs) < 1 && known.size === entry.size) {
            status.filesSkipped += 1;
            completed += 1;
            continue;
          }
          const absolute = path.join(root, entry.path);
          let buffer: Buffer;
          try {
            buffer = await fs.readFile(absolute);
          } catch {
            completed += 1;
            continue;
          }
          if (looksBinary(buffer)) {
            completed += 1;
            continue;
          }
          const content = buffer.toString('utf8');
          const hash = crypto.createHash('sha1').update(buffer).digest('hex');
          if (known?.hash === hash) {
            status.filesSkipped += 1;
            completed += 1;
            continue;
          }
          try {
            this.indexFileContent(projectId, entry.path, content, {
              size: entry.size,
              mtime: entry.mtimeMs,
              hash,
            });
            status.filesIndexed += 1;
          } catch (error) {
            status.message = `Failed to index ${entry.path}: ${error instanceof Error ? error.message : String(error)}`;
          }
          completed += 1;
          if (completed % 5 === 0 || completed === total) {
            this.emit({ ...status, filesTotal: total });
          }
        }
      });
      await Promise.all(workers);

      if (signal.aborted) {
        status.state = 'idle';
        status.message = 'Indexing cancelled';
        this.runs.delete(projectId);
        this.emit(status);
        return;
      }

      const missing = [...existing.keys()].filter((relative) => !seen.has(relative));
      if (missing.length > 0) this.db.deleteMissingFiles(projectId, missing);

      status.filesIndexed = this.db.countIndex(projectId).files;
      status.state = 'embedding';
      this.emit(status);
      await this.embedPending(projectId, status, signal);

      const counts = this.db.countIndex(projectId);
      status.state = 'ready';
      status.chunks = counts.chunks;
      status.embedded = counts.embedded;
      status.symbols = counts.symbols;
      status.filesIndexed = counts.files;
      status.finishedAt = Date.now();
      this.db.updateIndexStatus(projectId, 'ready');
      // Rebuild the in-memory vector cache now that all embeddings are settled.
      await this.buildVectorCache(projectId);
      this.emit(status);
    } catch (error) {
      if (signal.aborted) {
        status.state = 'idle';
        status.message = 'Indexing cancelled';
      } else {
        status.state = 'error';
        status.error = error instanceof Error ? error.message : String(error);
        status.message = status.error;
        this.db.updateIndexStatus(projectId, 'error', status.error);
      }
      this.emit(status);
    } finally {
      this.runs.delete(projectId);
    }
  }

  indexFileContent(
    projectId: string,
    relativePath: string,
    content: string,
    meta: { size: number; mtime: number; hash: string },
  ): void {
    const language = languageFromPath(relativePath);
    const symbols = defaultParser.extractSymbols(relativePath, content);
    const chunks = chunkCode(relativePath, content, symbols);
    this.db.transaction(() => {
      const fileId = this.db.upsertIndexedFile({
        projectId,
        path: relativePath,
        language,
        size: meta.size,
        mtime: meta.mtime,
        hash: meta.hash,
        content,
      });
      for (const chunk of chunks) {
        this.db.insertChunk({
          fileId,
          projectId,
          path: relativePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          symbols: chunk.symbols,
        });
      }
      this.db.replaceSymbols(projectId, relativePath, symbols);
    });
  }

  private async embedPending(projectId: string, status: IndexStatus, signal: AbortSignal): Promise<void> {
    const config = this.settings.get().indexing;
    if (!config.embedOnIndex) {
      status.message = 'Embeddings disabled in settings — keyword retrieval only';
      return;
    }
    let binding: { providerId: string; model: string };
    try {
      binding = await this.providers.resolveRole('embedding');
    } catch (error) {
      status.message = `No embedding model — keyword retrieval only (${error instanceof Error ? error.message : String(error)})`;
      return;
    }
    const pending = this.db.listChunksWithoutEmbedding(projectId);
    if (pending.length === 0) return;
    status.filesTotal = Math.max(status.filesTotal, pending.length);
    let embedded = 0;
    let failures = 0;
    const batchSize = Math.max(1, config.batchSize);
    for (let index = 0; index < pending.length; index += batchSize) {
      if (signal.aborted) return;
      const batch = pending.slice(index, index + batchSize);
      try {
        const response = await this.providers.embed(
          batch.map((chunk) =>
            embeddingText({
              path: chunk.path,
              startLine: chunk.start_line,
              endLine: chunk.end_line,
              content: chunk.content,
              symbols: [],
            }),
          ),
          signal,
        );
        for (let offset = 0; offset < batch.length; offset += 1) {
          const chunk = batch[offset];
          const vector = response.vectors[offset];
          if (!chunk || !vector) continue;
          const normalized = normalizeVector(vector);
          this.db.insertEmbedding(chunk.id, binding.model, vectorToBlob(normalized), normalized.length);
          embedded += 1;
        }
      } catch (error) {
        failures += 1;
        if (signal.aborted) return;
        status.message = `Embedding batch failed: ${error instanceof Error ? error.message : String(error)}`;
        // Brief backoff so a busy local model or rate limit recovers rather than failing the entire file set
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      status.embedded = embedded;
      status.chunks = this.db.countIndex(projectId).chunks;
      this.emit(status);
    }
    if (failures > 0) status.message = `${failures} embedding batches failed; keyword retrieval remains available`;
  }

  async search(projectId: string, query: string, limit = 12, activeFiles?: string[]): Promise<RetrievalResult[]> {
    const chunks = this.db.listChunks(projectId);
    if (chunks.length === 0) return [];
    const textCandidates = chunks.map((chunk) => ({
      chunkId: chunk.id,
      path: chunk.path,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      content: chunk.content,
    }));
    const keywordResults = rankByKeywords(query, textCandidates, Math.max(limit, 8));
    try {
      const binding = await this.providers.resolveRole('embedding');
      const response = await this.providers.embed([query], new AbortController().signal);
      const queryVector = normalizeVector(response.vectors[0] ?? []);

      // Use the in-memory cache when available; fall back to DB otherwise.
      let vectorCandidates: VectorCandidate[] = [];
      const cache = this.vectorCaches.get(projectId);
      if (cache && cache.model === binding.model) {
        vectorCandidates = cache.entries.filter((entry) => entry.vector.length === queryVector.length);
      } else {
        const embeddings = this.db.listEmbeddings(projectId).filter((row) => row.model === binding.model);
        const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
        for (const row of embeddings) {
          const chunk = chunkMap.get(row.chunk_id);
          if (!chunk) continue;
          const vector = blobToVector(row.vector);
          if (vector.length !== queryVector.length) continue;
          vectorCandidates.push({
            chunkId: chunk.id,
            path: chunk.path,
            startLine: chunk.start_line,
            endLine: chunk.end_line,
            content: chunk.content,
            vector,
          });
        }
      }

      const vectorResults = rankByVector(queryVector, vectorCandidates, limit);
      const merged = new Map<string, RetrievalResult>();
      for (const result of [...vectorResults, ...keywordResults]) {
        const key = `${result.path}:${result.startLine}:${result.endLine}`;
        const existing = merged.get(key);
        if (!existing || existing.score < result.score) merged.set(key, result);
      }
      let mergedResults = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
      // Boost results from files the user currently has open — they're most likely relevant.
      if (activeFiles && activeFiles.length > 0) {
        mergedResults = fileOverlapBoost(mergedResults, activeFiles);
      }
      return mergedResults;
    } catch {
      return keywordResults;
    }
  }
  /** Build (or rebuild) the in-memory vector cache for a project from the DB. */
  private async buildVectorCache(projectId: string): Promise<void> {
    try {
      const binding = await this.providers.resolveRole('embedding');
      const chunks = this.db.listChunks(projectId);
      const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
      const embeddings = this.db.listEmbeddings(projectId).filter((row) => row.model === binding.model);
      const entries: VectorCacheEntry[] = [];
      for (const row of embeddings) {
        const chunk = chunkMap.get(row.chunk_id);
        if (!chunk) continue;
        const vector = blobToVector(row.vector);
        entries.push({
          chunkId: chunk.id,
          path: chunk.path,
          startLine: chunk.start_line,
          endLine: chunk.end_line,
          content: chunk.content,
          vector,
        });
      }
      this.vectorCaches.set(projectId, { model: binding.model, entries, builtAt: Date.now() });
    } catch {
      // No embedding model configured — cache stays empty; keyword search still works.
    }
  }

  symbols(projectId: string, query?: string): SymbolInfo[] {
    const rows = query ? this.db.searchSymbols(projectId, query, 100) : this.db.searchSymbols(projectId, '', 200);
    return rows.map((row) => ({
      name: row.name,
      kind: row.kind,
      line: row.line,
      path: row.path,
      container: row.container ?? undefined,
    }));
  }

  private onFileEvents(events: WorkspaceChangeEvent[]): void {
    if (!this.workspace.isOpen()) return;
    const config = this.settings.get().indexing;
    if (!config.enabled) return;
    const projectId = this.workspace.projectId;
    // If a full index run is already active, it will pick up these changes itself.
    const activeRun = this.runs.get(projectId);
    if (activeRun && (activeRun.status.state === 'scanning' || activeRun.status.state === 'embedding')) return;
    const pending = this.pendingPaths.get(projectId) ?? new Set<string>();
    for (const event of events) {
      if (event.type === 'addDir' || event.type === 'unlinkDir') continue;
      if (isBinaryName(event.path)) continue;
      pending.add(event.path);
    }
    this.pendingPaths.set(projectId, pending);
    const existingTimer = this.incrementalTimers.get(projectId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.incrementalTimers.delete(projectId);
      const paths = [...(this.pendingPaths.get(projectId) ?? [])];
      this.pendingPaths.delete(projectId);
      void this.updatePaths(projectId, paths);
    }, 1500);
    timer.unref?.();
    this.incrementalTimers.set(projectId, timer);
  }

  private async updatePaths(projectId: string, paths: string[]): Promise<void> {
    if (this.workspace.projectId !== projectId) return;
    const root = this.workspace.root;
    for (const relative of paths.slice(0, 100)) {
      const absolute = path.join(root, relative);
      try {
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) continue;
        if (stat.size > this.settings.get().indexing.maxFileSizeKb * 1024) continue;
        const buffer = await fs.readFile(absolute);
        if (looksBinary(buffer)) continue;
        const content = buffer.toString('utf8');
        const hash = crypto.createHash('sha1').update(buffer).digest('hex');
        const known = this.db.listIndexFiles(projectId).find((file) => file.path === relative);
        if (known?.hash === hash) continue;
        this.indexFileContent(projectId, relative, content, { size: stat.size, mtime: stat.mtimeMs, hash });
      } catch {
        this.db.deleteIndexedFile(projectId, relative);
      }
    }
    if (this.settings.get().indexing.embedOnIndex && this.providers.list().some((provider) => provider.enabled)) {
      const status = this.status(projectId);
      status.state = 'embedding';
      this.emit(status);
      try {
        await this.embedPending(projectId, status, new AbortController().signal);
      } catch {
        // incremental embedding failures must not break editing
      }
      // Rebuild the vector cache so the next search picks up the new embeddings.
      await this.buildVectorCache(projectId);
      const counts = this.db.countIndex(projectId);
      const ready: IndexStatus = {
        ...status,
        state: 'ready',
        chunks: counts.chunks,
        embedded: counts.embedded,
        symbols: counts.symbols,
        filesIndexed: counts.files,
        filesTotal: counts.files,
      };
      this.emit(ready);
    }
  }
}
