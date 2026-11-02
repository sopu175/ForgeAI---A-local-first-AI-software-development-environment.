import type {
  AgentEvent,
  AgentReport,
  AgentRunRequest,
  AppInfo,
  AppSettings,
  BrowserOption,
  ChatDelta,
  ChatMessage,
  ChatToolCall,
  Checkpoint,
  CompletionRequest,
  CompletionResponse,
  Conversation,
  DirEntry,
  FileChange,
  FileContent,
  FileNode,
  GitDiffFile,
  GitLogEntry,
  GitStatus,
  IndexStatus,
  ModelInfo,
  ModelRole,
  PermissionRequest,
  PermissionResponse,
  ProjectStack,
  ProjectSummary,
  ProviderConfig,
  ProviderHealth,
  PullProgress,
  QuickEditRequest,
  RetrievalResult,
  RuleFile,
  RunningModel,
  RuntimeStatus,
  SearchOptions,
  SpecDocument,
  SpecPhase,
  SpecTask,
  StoredMessage,
  SymbolInfo,
  TextSearchResult,
  UsageStats,
} from './types';

export interface WorkspaceChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
}

export interface AiStreamEvent {
  requestId: string;
  delta: ChatDelta;
}

export interface ForgeEvents {
  'workspace:changed': WorkspaceChangeEvent;
  'workspace:opened': ProjectSummary;
  'index:progress': IndexStatus;
  'terminal:data': { id: string; data: string };
  'terminal:exit': { id: string; exitCode: number };
  'ai:stream': AiStreamEvent;
  'ai:pull': PullProgress;
  'permission:request': PermissionRequest;
  'permission:resolved': { id: string; decision: PermissionResponse['decision'] };
  'agent:event': { runId: string; event: AgentEvent };
  'spec:changed': { projectId: string; feature: string };
  'git:changed': { projectId: string };
  'app:command': { command: string };
  'app:open-workspace': { root: string };
  'app:toast': { kind: 'info' | 'error' | 'success'; message: string };
  'runtime:progress': RuntimeStatus;
}

export type ForgeEventName = keyof ForgeEvents;

export interface StreamChatArgs {
  requestId: string;
  providerId: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  contextLength?: number;
  thinking?: boolean;
}

export interface WorkspaceApi {
  openDialog(): Promise<ProjectSummary | null>;
  open(root: string): Promise<ProjectSummary>;
  recent(): Promise<ProjectSummary[]>;
  current(): Promise<ProjectSummary | null>;
  close(): Promise<void>;
  tree(): Promise<FileNode[]>;
  list(dir: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<FileContent>;
  writeFile(path: string, content: string): Promise<{ mtime: number }>;
  createFile(path: string, content?: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(paths: string[], approved?: boolean): Promise<void>;
  reveal(path: string): Promise<void>;
  /** Installed browsers offered by "Open in Browser". */
  browsers(): Promise<BrowserOption[]>;
  /** Opens a workspace file in a browser; omit the id to use the configured default. */
  openInBrowser(path: string, browserId?: string): Promise<{ browser: string; path: string }>;
  rules(): Promise<RuleFile[]>;
  stack(): Promise<ProjectStack>;
  projectIdFor(path: string): Promise<string>;
}

export interface SettingsApi {
  get(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<AppSettings>;
  recommendRoles(): Promise<Partial<Record<ModelRole, { providerId: string; model: string }>>>;
}

export interface ProvidersApi {
  list(): Promise<ProviderConfig[]>;
  upsert(config: ProviderConfig): Promise<ProviderConfig>;
  remove(id: string): Promise<void>;
  setApiKey(id: string, key: string): Promise<void>;
  clearApiKey(id: string): Promise<void>;
  health(id: string): Promise<ProviderHealth>;
  models(refresh?: boolean): Promise<ModelInfo[]>;
  pull(providerId: string, model: string): Promise<void>;
  cancelPull(): Promise<void>;
  removeModel(providerId: string, model: string): Promise<void>;
  /** Delete every model on a provider except the given names. Returns removed model ids. */
  keepOnly(providerId: string, keep: string[]): Promise<string[]>;
  running(): Promise<RunningModel[]>;
}

export interface RuntimeApi {
  /** Current local Ollama/model bootstrap state. */
  status(): Promise<RuntimeStatus>;
  /** Ensure the server is running and the default model is installed. Idempotent. */
  ensure(): Promise<RuntimeStatus>;
  /** Cancel an in-flight runtime download or model pull. */
  cancel(): Promise<void>;
}

export interface ChatApi {
  list(projectId?: string): Promise<Conversation[]>;
  create(input: { projectId?: string; title?: string; mode?: string; model?: string }): Promise<Conversation>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  messages(conversationId: string): Promise<StoredMessage[]>;
  addMessage(input: {
    conversationId: string;
    role: ChatMessage['role'];
    content: string;
    reasoning?: string;
    toolCalls?: ChatToolCall[];
    toolCallId?: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    durationMs?: number;
  }): Promise<StoredMessage>;
  clear(conversationId: string): Promise<void>;
}

export interface AiApi {
  stream(args: StreamChatArgs): Promise<void>;
  cancel(requestId: string): Promise<void>;
  complete(args: CompletionRequest): Promise<CompletionResponse>;
  quickEdit(args: QuickEditRequest): Promise<string>;
  usage(): Promise<UsageStats>;
}

export interface AgentApi {
  start(request: AgentRunRequest): Promise<{ runId: string }>;
  cancel(runId: string): Promise<void>;
  respond(response: PermissionResponse): Promise<void>;
  pending(): Promise<PermissionRequest[]>;
}

export interface SpecsApi {
  list(projectId: string): Promise<SpecDocument[]>;
  get(projectId: string, feature: string): Promise<SpecDocument>;
  create(projectId: string, feature: string, description: string): Promise<SpecDocument>;
  generate(projectId: string, feature: string, phase: SpecPhase): Promise<SpecDocument>;
  update(
    projectId: string,
    feature: string,
    part: 'requirements' | 'design' | 'tasks',
    content: string,
  ): Promise<SpecDocument>;
  approve(projectId: string, feature: string, phase: SpecPhase): Promise<SpecDocument>;
  updateTask(projectId: string, feature: string, taskId: string, patch: Partial<SpecTask>): Promise<SpecDocument>;
  remove(projectId: string, feature: string): Promise<void>;
}

export interface IndexApi {
  status(projectId: string): Promise<IndexStatus>;
  start(projectId: string): Promise<IndexStatus>;
  cancel(projectId: string): Promise<void>;
  search(projectId: string, query: string, limit?: number): Promise<RetrievalResult[]>;
  symbols(projectId: string, query?: string): Promise<SymbolInfo[]>;
  rebuild(projectId: string): Promise<IndexStatus>;
}

export interface SearchApi {
  text(projectId: string, options: SearchOptions): Promise<TextSearchResult[]>;
  files(projectId: string, query: string, limit?: number): Promise<string[]>;
}

export interface GitApi {
  status(projectId: string): Promise<GitStatus | null>;
  diff(projectId: string, path?: string, staged?: boolean): Promise<GitDiffFile[]>;
  branches(projectId: string): Promise<{ current: string; all: string[] }>;
  checkout(projectId: string, branch: string): Promise<void>;
  createBranch(projectId: string, name: string): Promise<void>;
  stage(projectId: string, paths: string[]): Promise<void>;
  unstage(projectId: string, paths: string[]): Promise<void>;
  commit(projectId: string, message: string, paths?: string[]): Promise<string>;
  log(projectId: string, limit?: number): Promise<GitLogEntry[]>;
  discard(projectId: string, paths: string[]): Promise<void>;
  generateMessage(projectId: string): Promise<string>;
}

export interface TerminalApi {
  create(options?: { cwd?: string; cols?: number; rows?: number }): Promise<{ id: string; shell: string }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  dispose(id: string): Promise<void>;
  list(): Promise<{ id: string; cwd: string; title: string }[]>;
}

export interface CheckpointsApi {
  list(projectId: string): Promise<Checkpoint[]>;
  create(projectId: string, label: string): Promise<Checkpoint>;
  restore(projectId: string, checkpointId: string): Promise<void>;
  diff(projectId: string, checkpointId: string): Promise<FileChange[]>;
}

export interface AppApi {
  info(): Promise<AppInfo>;
  openExternal(url: string): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  getFilePath(file: File): string;
}

export interface ForgeApi {
  app: AppApi;
  workspace: WorkspaceApi;
  settings: SettingsApi;
  providers: ProvidersApi;
  runtime: RuntimeApi;
  chat: ChatApi;
  ai: AiApi;
  agent: AgentApi;
  specs: SpecsApi;
  index: IndexApi;
  search: SearchApi;
  git: GitApi;
  terminal: TerminalApi;
  checkpoints: CheckpointsApi;
  events: {
    on<K extends ForgeEventName>(event: K, callback: (payload: ForgeEvents[K]) => void): () => void;
  };
}

export interface AgentRunSnapshot {
  runId: string;
  report?: AgentReport;
}
