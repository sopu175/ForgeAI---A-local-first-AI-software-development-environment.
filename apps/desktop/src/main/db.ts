import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ChatToolCall,
  Checkpoint,
  Conversation,
  GitLogEntry,
  IndexState,
  ProjectStack,
  ProjectSummary,
  ProviderConfig,
  ProviderKind,
  SpecMeta,
  StoredMessage,
  UsageStats,
  ChatRole,
  ProjectMemory,
} from '@forgeai/shared';

interface ProjectRow {
  id: string;
  name: string;
  root: string;
  created_at: number;
  last_opened_at: number;
  index_status: string;
  index_error: string | null;
  stack: string | null;
}

interface ProviderRow {
  id: string;
  kind: string;
  name: string;
  base_url: string;
  enabled: number;
  api_key_ref: string | null;
  config: string;
}

interface ConversationRow {
  id: string;
  project_id: string | null;
  title: string;
  mode: string;
  model: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  reasoning: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  created_at: number;
}

interface FileRow {
  id: number;
  project_id: string;
  path: string;
  language: string | null;
  size: number;
  mtime: number;
  hash: string;
  content: string | null;
  indexed_at: number;
}

interface ChunkRow {
  id: number;
  file_id: number;
  project_id: string;
  path: string;
  start_line: number;
  end_line: number;
  content: string;
  symbols: string;
}

interface EmbeddingRow {
  chunk_id: number;
  model: string;
  dim: number;
  vector: Uint8Array;
}

interface SymbolRow {
  id: number;
  project_id: string;
  path: string;
  name: string;
  kind: string;
  line: number;
  container: string | null;
}

interface CheckpointRow {
  id: string;
  project_id: string;
  label: string;
  kind: string;
  created_at: number;
  files: string;
  dir: string | null;
}

export interface IndexFileRecord {
  id: number;
  path: string;
  hash: string;
  mtime: number;
  size: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  index_status TEXT NOT NULL DEFAULT 'idle',
  index_error TEXT,
  stack TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  api_key_ref TEXT,
  config TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  reasoning TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  hash TEXT NOT NULL,
  content TEXT,
  indexed_at INTEGER NOT NULL,
  UNIQUE(project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  symbols TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  container TEXT
);
CREATE INDEX IF NOT EXISTS idx_symbols_project_name ON symbols(project_id, name);
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  files TEXT NOT NULL,
  dir TEXT
);
CREATE TABLE IF NOT EXISTS permission_audit (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  tool TEXT NOT NULL,
  request TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spec_state (
  project_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  meta TEXT NOT NULL,
  PRIMARY KEY (project_id, feature)
);
CREATE TABLE IF NOT EXISTS project_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_memory ON project_memory(project_id, kind);
PRAGMA user_version = 1;
`;

export class Database {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private all<T>(sql: string, ...params: Array<string | number | Uint8Array | null>): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  private one<T>(sql: string, ...params: Array<string | number | Uint8Array | null>): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private run(
    sql: string,
    ...params: Array<string | number | Uint8Array | null>
  ): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  static projectIdFor(root: string): string {
    return crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16);
  }

  // ── Projects ───────────────────────────────────────────────────────────────
  upsertProject(root: string, name: string, stack?: ProjectStack): ProjectSummary {
    const id = Database.projectIdFor(root);
    const now = Date.now();
    this.run(
      `INSERT INTO projects (id, name, root, created_at, last_opened_at, index_status, stack)
       VALUES (?, ?, ?, ?, ?, 'idle', ?)
       ON CONFLICT(root) DO UPDATE SET last_opened_at = excluded.last_opened_at, name = excluded.name,
         stack = COALESCE(excluded.stack, projects.stack)`,
      id,
      name,
      root,
      now,
      now,
      stack ? JSON.stringify(stack) : null,
    );
    const project = this.getProject(id);
    if (!project) throw new Error('Project could not be registered');
    return project;
  }

  getProject(id: string): ProjectSummary | undefined {
    const row = this.one<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    return row ? this.mapProject(row) : undefined;
  }

  getProjectByRoot(root: string): ProjectSummary | undefined {
    const row = this.one<ProjectRow>('SELECT * FROM projects WHERE root = ?', root);
    return row ? this.mapProject(row) : undefined;
  }

  listProjects(): ProjectSummary[] {
    return this.all<ProjectRow>('SELECT * FROM projects ORDER BY last_opened_at DESC LIMIT 30').map((row) =>
      this.mapProject(row),
    );
  }

  touchProject(id: string): void {
    this.run('UPDATE projects SET last_opened_at = ? WHERE id = ?', Date.now(), id);
  }

  updateProjectStack(id: string, stack: ProjectStack): void {
    this.run('UPDATE projects SET stack = ? WHERE id = ?', JSON.stringify(stack), id);
  }

  updateIndexStatus(id: string, state: IndexState, error?: string): void {
    this.run('UPDATE projects SET index_status = ?, index_error = ? WHERE id = ?', state, error ?? null, id);
  }

  private mapProject(row: ProjectRow): ProjectSummary {
    let stack: string[] = [];
    if (row.stack) {
      try {
        const parsed = JSON.parse(row.stack) as ProjectStack;
        stack = [...(parsed.frameworks ?? []), ...(parsed.languages ?? [])];
      } catch {
        stack = [];
      }
    }
    return {
      id: row.id,
      name: row.name,
      root: row.root,
      createdAt: row.created_at,
      lastOpenedAt: row.last_opened_at,
      indexStatus: row.index_status as IndexState,
      stack,
    };
  }

  // ── Settings / providers ───────────────────────────────────────────────────
  getSetting(key: string): string | undefined {
    return this.one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
  }

  setSetting(key: string, value: string): void {
    this.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  seedProviders(defaults: Array<Omit<ProviderConfig, 'hasApiKey'>>): void {
    for (const provider of defaults) {
      this.run(
        `INSERT OR IGNORE INTO providers (id, kind, name, base_url, enabled, config)
         VALUES (?, ?, ?, ?, ?, ?)`,
        provider.id,
        provider.kind,
        provider.name,
        provider.baseUrl,
        provider.enabled ? 1 : 0,
        JSON.stringify(provider.config),
      );
    }
  }

  listProviderRows(): Array<ProviderConfig & { apiKeyRef?: string }> {
    return this.all<ProviderRow>('SELECT * FROM providers ORDER BY rowid ASC').map((row) => ({
      id: row.id,
      kind: row.kind as ProviderKind,
      name: row.name,
      baseUrl: row.base_url,
      enabled: row.enabled === 1,
      hasApiKey: Boolean(row.api_key_ref),
      apiKeyRef: row.api_key_ref ?? undefined,
      config: safeJson(row.config, {}),
    }));
  }

  upsertProvider(provider: ProviderConfig): void {
    this.run(
      `INSERT INTO providers (id, kind, name, base_url, enabled, config)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
         base_url = excluded.base_url, enabled = excluded.enabled, config = excluded.config`,
      provider.id,
      provider.kind,
      provider.name,
      provider.baseUrl,
      provider.enabled ? 1 : 0,
      JSON.stringify(provider.config),
    );
  }

  deleteProvider(id: string): void {
    this.run('DELETE FROM providers WHERE id = ?', id);
  }

  setProviderKey(id: string, encrypted: string | null): void {
    this.run('UPDATE providers SET api_key_ref = ? WHERE id = ?', encrypted, id);
  }

  // ── Conversations ──────────────────────────────────────────────────────────
  createConversation(input: { projectId?: string; title: string; mode: string; model?: string }): Conversation {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.run(
      'INSERT INTO conversations (id, project_id, title, mode, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      input.projectId ?? null,
      input.title,
      input.mode,
      input.model ?? null,
      now,
      now,
    );
    return {
      id,
      projectId: input.projectId,
      title: input.title,
      mode: input.mode,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };
  }

  listConversations(projectId?: string): Conversation[] {
    const rows = projectId
      ? this.all<ConversationRow>(
          'SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 100',
          projectId,
        )
      : this.all<ConversationRow>('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100');
    return rows.map(mapConversation);
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.one<ConversationRow>('SELECT * FROM conversations WHERE id = ?', id);
    return row ? mapConversation(row) : undefined;
  }

  renameConversation(id: string, title: string): void {
    this.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', title, Date.now(), id);
  }

  deleteConversation(id: string): void {
    this.run('DELETE FROM conversations WHERE id = ?', id);
  }

  touchConversation(id: string, model?: string): void {
    if (model) this.run('UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?', Date.now(), model, id);
    else this.run('UPDATE conversations SET updated_at = ? WHERE id = ?', Date.now(), id);
  }

  addMessage(input: {
    conversationId: string;
    role: ChatRole;
    content: string;
    reasoning?: string;
    toolCalls?: ChatToolCall[];
    toolCallId?: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    durationMs?: number;
  }): StoredMessage {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.run(
      `INSERT INTO messages (id, conversation_id, role, content, reasoning, tool_calls, tool_call_id, model, tokens_in, tokens_out, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.conversationId,
      input.role,
      input.content,
      input.reasoning ?? null,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.toolCallId ?? null,
      input.model ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      input.durationMs ?? null,
      now,
    );
    this.touchConversation(input.conversationId, input.model);
    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      reasoning: input.reasoning,
      toolCalls: input.toolCalls,
      toolCallId: input.toolCallId,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      durationMs: input.durationMs,
      createdAt: now,
    };
  }

  listMessages(conversationId: string): StoredMessage[] {
    return this.all<MessageRow>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC',
      conversationId,
    ).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as ChatRole,
      content: row.content,
      reasoning: row.reasoning ?? undefined,
      toolCalls: row.tool_calls ? (safeJson(row.tool_calls, []) as ChatToolCall[]) : undefined,
      toolCallId: row.tool_call_id ?? undefined,
      model: row.model ?? undefined,
      tokensIn: row.tokens_in ?? undefined,
      tokensOut: row.tokens_out ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      createdAt: row.created_at,
    }));
  }

  clearMessages(conversationId: string): void {
    this.run('DELETE FROM messages WHERE conversation_id = ?', conversationId);
    this.touchConversation(conversationId);
  }

  // ── Index ──────────────────────────────────────────────────────────────────
  listIndexFiles(projectId: string): IndexFileRecord[] {
    return this.all<FileRow>('SELECT id, path, hash, mtime, size FROM files WHERE project_id = ?', projectId).map(
      (row) => ({
        id: row.id,
        path: row.path,
        hash: row.hash,
        mtime: row.mtime,
        size: row.size,
      }),
    );
  }

  upsertIndexedFile(input: {
    projectId: string;
    path: string;
    language: string;
    size: number;
    mtime: number;
    hash: string;
    content: string;
  }): number {
    const existing = this.one<{ id: number }>(
      'SELECT id FROM files WHERE project_id = ? AND path = ?',
      input.projectId,
      input.path,
    );
    if (existing) {
      this.run(
        'UPDATE files SET language = ?, size = ?, mtime = ?, hash = ?, content = ?, indexed_at = ? WHERE id = ?',
        input.language,
        input.size,
        input.mtime,
        input.hash,
        input.content.slice(0, 256_000),
        Date.now(),
        existing.id,
      );
      this.run('DELETE FROM chunks WHERE file_id = ?', existing.id);
      return existing.id;
    }
    const result = this.run(
      `INSERT INTO files (project_id, path, language, size, mtime, hash, content, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.projectId,
      input.path,
      input.language,
      input.size,
      input.mtime,
      input.hash,
      input.content.slice(0, 256_000),
      Date.now(),
    );
    return result.lastInsertRowid;
  }

  insertChunk(input: {
    fileId: number;
    projectId: string;
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    symbols: string[];
  }): number {
    const result = this.run(
      `INSERT INTO chunks (file_id, project_id, path, start_line, end_line, content, symbols)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.fileId,
      input.projectId,
      input.path,
      input.startLine,
      input.endLine,
      input.content,
      JSON.stringify(input.symbols),
    );
    return result.lastInsertRowid;
  }

  insertEmbedding(chunkId: number, model: string, vector: Uint8Array, dim: number): void {
    this.run(
      `INSERT INTO embeddings (chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector`,
      chunkId,
      model,
      dim,
      vector,
    );
  }

  deleteIndexedFile(projectId: string, relativePath: string): void {
    this.run('DELETE FROM files WHERE project_id = ? AND path = ?', projectId, relativePath);
    this.run('DELETE FROM symbols WHERE project_id = ? AND path = ?', projectId, relativePath);
  }

  deleteMissingFiles(projectId: string, paths: string[]): number {
    let removed = 0;
    for (const relative of paths) {
      const result = this.run('DELETE FROM files WHERE project_id = ? AND path = ?', projectId, relative);
      removed += result.changes;
    }
    return removed;
  }

  listChunks(projectId: string): ChunkRow[] {
    return this.all<ChunkRow>('SELECT * FROM chunks WHERE project_id = ?', projectId);
  }

  listEmbeddings(projectId: string): EmbeddingRow[] {
    return this.all<EmbeddingRow>(
      `SELECT e.chunk_id, e.model, e.dim, e.vector FROM embeddings e
       JOIN chunks c ON c.id = e.chunk_id WHERE c.project_id = ?`,
      projectId,
    );
  }

  listChunksWithoutEmbedding(projectId: string, limit = 10_000): ChunkRow[] {
    return this.all<ChunkRow>(
      `SELECT c.* FROM chunks c LEFT JOIN embeddings e ON e.chunk_id = c.id
       WHERE c.project_id = ? AND e.chunk_id IS NULL LIMIT ?`,
      projectId,
      limit,
    );
  }

  countIndex(projectId: string): { files: number; chunks: number; embedded: number; symbols: number } {
    const files =
      this.one<{ count: number }>('SELECT COUNT(*) as count FROM files WHERE project_id = ?', projectId)?.count ?? 0;
    const chunks =
      this.one<{ count: number }>('SELECT COUNT(*) as count FROM chunks WHERE project_id = ?', projectId)?.count ?? 0;
    const embedded =
      this.one<{ count: number }>(
        'SELECT COUNT(*) as count FROM embeddings e JOIN chunks c ON c.id = e.chunk_id WHERE c.project_id = ?',
        projectId,
      )?.count ?? 0;
    const symbols =
      this.one<{ count: number }>('SELECT COUNT(*) as count FROM symbols WHERE project_id = ?', projectId)?.count ?? 0;
    return { files, chunks, embedded, symbols };
  }

  replaceSymbols(
    projectId: string,
    relativePath: string,
    symbols: Array<{ name: string; kind: string; line: number; container?: string }>,
  ): void {
    this.run('DELETE FROM symbols WHERE project_id = ? AND path = ?', projectId, relativePath);
    for (const symbol of symbols) {
      this.run(
        'INSERT INTO symbols (project_id, path, name, kind, line, container) VALUES (?, ?, ?, ?, ?, ?)',
        projectId,
        relativePath,
        symbol.name,
        symbol.kind,
        symbol.line,
        symbol.container ?? null,
      );
    }
  }

  searchSymbols(projectId: string, query: string, limit = 50): SymbolRow[] {
    const like = `%${query.replace(/[%_]/g, '')}%`;
    return this.all<SymbolRow>(
      `SELECT * FROM symbols WHERE project_id = ? AND (name LIKE ? OR path LIKE ?) ORDER BY name LIMIT ?`,
      projectId,
      like,
      like,
      limit,
    );
  }

  clearIndex(projectId: string): void {
    this.run('DELETE FROM files WHERE project_id = ?', projectId);
    this.run('DELETE FROM symbols WHERE project_id = ?', projectId);
  }

  indexedPaths(projectId: string): string[] {
    return this.all<{ path: string }>('SELECT path FROM files WHERE project_id = ?', projectId).map((row) => row.path);
  }

  // ── Checkpoints ────────────────────────────────────────────────────────────
  createCheckpoint(input: {
    id: string;
    projectId: string;
    label: string;
    kind: string;
    files: string[];
    dir: string | null;
  }): Checkpoint {
    const now = Date.now();
    this.run(
      'INSERT INTO checkpoints (id, project_id, label, kind, created_at, files, dir) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.id,
      input.projectId,
      input.label,
      input.kind,
      now,
      JSON.stringify(input.files),
      input.dir,
    );
    return {
      id: input.id,
      projectId: input.projectId,
      label: input.label,
      kind: input.kind as Checkpoint['kind'],
      createdAt: now,
      fileCount: input.files.length,
      files: input.files,
    };
  }

  listCheckpoints(projectId: string): Checkpoint[] {
    return this.all<CheckpointRow>(
      'SELECT * FROM checkpoints WHERE project_id = ? ORDER BY created_at DESC LIMIT 100',
      projectId,
    ).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      label: row.label,
      kind: row.kind as Checkpoint['kind'],
      createdAt: row.created_at,
      fileCount: (safeJson(row.files, []) as string[]).length,
      files: safeJson(row.files, []) as string[],
    }));
  }

  getCheckpointRow(
    id: string,
  ): { id: string; projectId: string; label: string; kind: string; files: string[]; dir: string | null } | undefined {
    const row = this.one<CheckpointRow>('SELECT * FROM checkpoints WHERE id = ?', id);
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      label: row.label,
      kind: row.kind,
      files: safeJson(row.files, []) as string[],
      dir: row.dir,
    };
  }

  updateCheckpointFiles(id: string, files: string[], dir: string | null): void {
    this.run('UPDATE checkpoints SET files = ?, dir = ? WHERE id = ?', JSON.stringify(files), dir, id);
  }

  deleteCheckpoint(id: string): void {
    this.run('DELETE FROM checkpoints WHERE id = ?', id);
  }

  // ── Audit / usage ──────────────────────────────────────────────────────────
  auditPermission(input: { projectId?: string; tool: string; request: unknown; decision: string }): void {
    this.run(
      'INSERT INTO permission_audit (id, project_id, tool, request, decision, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(),
      input.projectId ?? null,
      input.tool,
      JSON.stringify(input.request).slice(0, 8000),
      input.decision,
      Date.now(),
    );
  }

  recordUsage(input: {
    projectId?: string;
    model: string;
    promptTokens: number;
    outputTokens: number;
    durationMs: number;
  }): void {
    this.run(
      'INSERT INTO usage (id, project_id, model, prompt_tokens, output_tokens, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(),
      input.projectId ?? null,
      input.model,
      input.promptTokens,
      input.outputTokens,
      input.durationMs,
      Date.now(),
    );
  }

  usageStats(): UsageStats {
    const row = this.one<{ p: number | null; o: number | null; c: number | null }>(
      'SELECT SUM(prompt_tokens) as p, SUM(output_tokens) as o, COUNT(*) as c FROM usage',
    );
    const totalPromptTokens = row?.p ?? 0;
    const totalOutputTokens = row?.o ?? 0;
    const runs = row?.c ?? 0;
    return {
      totalPromptTokens,
      totalOutputTokens,
      runs,
      avgTokensPerSecond: 0,
    };
  }

  // ── Specs ──────────────────────────────────────────────────────────────────
  saveSpecMeta(projectId: string, meta: SpecMeta): void {
    this.run(
      `INSERT INTO spec_state (project_id, feature, meta) VALUES (?, ?, ?)
       ON CONFLICT(project_id, feature) DO UPDATE SET meta = excluded.meta`,
      projectId,
      meta.feature,
      JSON.stringify(meta),
    );
  }

  getSpecMeta(projectId: string, feature: string): SpecMeta | undefined {
    const row = this.one<{ meta: string }>(
      'SELECT meta FROM spec_state WHERE project_id = ? AND feature = ?',
      projectId,
      feature,
    );
    return row ? ((safeJson(row.meta, null) as SpecMeta | null) ?? undefined) : undefined;
  }

  deleteSpecMeta(projectId: string, feature: string): void {
    this.run('DELETE FROM spec_state WHERE project_id = ? AND feature = ?', projectId, feature);
  }

  listProjectMemory(projectId: string, kind?: string): ProjectMemory[] {
    const query = kind
      ? 'SELECT * FROM project_memory WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC'
      : 'SELECT * FROM project_memory WHERE project_id = ? ORDER BY updated_at DESC';
    const stmt = this.db.prepare(query);
    const rows = (kind ? stmt.all(projectId, kind) : stmt.all(projectId)) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      kind: r.kind,
      title: r.title,
      content: r.content,
      source: r.source ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  upsertProjectMemory(memory: ProjectMemory): void {
    const stmt = this.db.prepare(`
      INSERT INTO project_memory (id, project_id, kind, title, content, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        content = excluded.content,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      memory.id,
      memory.projectId,
      memory.kind,
      memory.title,
      memory.content,
      memory.source ?? null,
      memory.createdAt,
      memory.updatedAt,
    );
  }

  deleteProjectMemory(id: string): void {
    const stmt = this.db.prepare('DELETE FROM project_memory WHERE id = ?');
    stmt.run(id);
  }

  recentGitLog(): GitLogEntry[] {
    return [];
  }
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    title: row.title,
    mode: row.mode,
    model: row.model ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
