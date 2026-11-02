/* Core domain types shared by the main process, preload bridge and renderer. */

export type ProviderKind = 'ollama' | 'lmstudio' | 'llamacpp' | 'vllm' | 'openai' | 'openrouter' | 'custom';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  enabled: boolean;
  /** Whether a key is stored in the OS keychain. The key itself is never sent to the renderer. */
  hasApiKey?: boolean;
  config: {
    temperature?: number;
    contextLength?: number;
    keepAlive?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  };
}

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  thinking: boolean;
  embedding: boolean;
  completion: boolean;
}

export interface ModelInfo {
  providerId: string;
  providerKind: ProviderKind;
  id: string;
  name: string;
  sizeBytes?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  contextLength?: number;
  modifiedAt?: string;
  digest?: string;
  capabilities: ModelCapabilities;
  installed: boolean;
}

export interface ProviderHealth {
  providerId: string;
  ok: boolean;
  latencyMs?: number;
  version?: string;
  error?: string;
  modelCount?: number;
}

export interface RunningModel {
  providerId: string;
  name: string;
  sizeBytes?: number;
  sizeVramBytes?: number;
  expiresAt?: string;
}

/** Local model runtime bootstrap (Ollama) state shared with the renderer. */
export type RuntimeStage =
  'idle' | 'checking' | 'starting' | 'installing' | 'pulling' | 'ready' | 'error' | 'cancelled';

export interface RuntimeStatus {
  providerId: string;
  baseUrl: string;
  model: string;
  stage: RuntimeStage;
  /** True when an ollama binary was found (system install or managed download). */
  installed: boolean;
  running: boolean;
  modelInstalled: boolean;
  /** True while the automatic first-launch bootstrap owns the process. */
  auto: boolean;
  detail?: string;
  percent?: number;
  completedBytes?: number;
  totalBytes?: number;
  version?: string;
  error?: string;
  updatedAt: number;
}

export interface PullProgress {
  providerId: string;
  model: string;
  status: string;
  completed?: number;
  total?: number;
  percent?: number;
  done: boolean;
  error?: string;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  id?: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  images?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  providerId: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  contextLength?: number;
  thinking?: boolean;
  format?: 'json';
}

export type ChatDelta =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; call: ChatToolCall }
  | { type: 'usage'; promptTokens: number; outputTokens: number; tokensPerSecond?: number }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; message: string };

export interface EmbedRequest {
  providerId: string;
  model: string;
  inputs: string[];
}

export interface EmbedResponse {
  vectors: number[][];
  model: string;
  dim: number;
}

export type ModelRole =
  | 'chat'
  | 'plan'
  | 'coding'
  | 'frontend'
  | 'animation'
  | 'backend'
  | 'seo'
  | 'testing'
  | 'review'
  | 'fast'
  | 'embedding';

export interface RoleBinding {
  providerId: string;
  model: string;
}

export type MemoryKind = 'decision' | 'convention' | 'issue' | 'feedback';

export interface ProjectMemory {
  id: string;
  projectId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrowserOption {
  id: string;
  name: string;
  available: boolean;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  uiFontSize: number;
  codeFontSize: number;
  editorMinimap: boolean;
  wordWrap: boolean;
  /** Classic editor behaviour knobs, mirrored from VS Code's defaults. */
  editor: {
    tabSize: number;
    insertSpaces: boolean;
    detectIndentation: boolean;
    autoSave: 'off' | 'afterDelay';
    autoSaveDelayMs: number;
    formatOnSave: boolean;
    lineNumbers: 'on' | 'off' | 'relative';
    renderWhitespace: 'none' | 'selection' | 'all';
    fontLigatures: boolean;
    smoothScrolling: boolean;
    bracketPairColorization: boolean;
    stickyScroll: boolean;
    multiCursorModifier: 'alt' | 'ctrlCmd';
    autoClosingBrackets: boolean;
    suggestOnTyping: boolean;
  };
  /** Preview/open-with behaviour for web files. */
  preview: {
    /** Browser id from the installed-browser list, or 'default'. */
    defaultBrowser: string;
  };
  terminal: {
    fontSize: number;
    cursorBlink: boolean;
  };
  approval: {
    writes: 'once' | 'session' | 'auto';
    commands: 'once' | 'session' | 'auto';
    deletes: 'always' | 'session';
    installs: 'once' | 'session' | 'auto';
    network: 'once' | 'session' | 'auto';
    commits: 'once' | 'session' | 'auto';
  };
  indexing: {
    enabled: boolean;
    maxFileSizeKb: number;
    ignoreGlobs: string[];
    batchSize: number;
    embedOnIndex: boolean;
  };
  completion: {
    enabled: boolean;
    debounceMs: number;
    maxTokens: number;
  };
  modelRoles: Partial<Record<ModelRole, RoleBinding>>;
  agent: {
    maxSteps: number;
    temperature: number;
    autoCheckpoint: boolean;
    /** Run independent read-only tool calls concurrently to cut wall time. */
    parallelReadOnly: boolean;
  };
  telemetry: false;
}

export interface ProjectSummary {
  id: string;
  name: string;
  root: string;
  createdAt: number;
  lastOpenedAt: number;
  indexStatus: IndexState;
  stack: string[];
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
  size: number;
  mtime: number;
  truncated?: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface SearchOptions {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  include?: string;
  exclude?: string;
  maxResults?: number;
}

export interface TextSearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchLength: number;
}

export interface FileSearchResult {
  path: string;
  score: number;
}

export type IndexState = 'idle' | 'scanning' | 'embedding' | 'ready' | 'error';

export interface IndexStatus {
  projectId: string;
  state: IndexState;
  filesIndexed: number;
  filesTotal: number;
  filesSkipped: number;
  chunks: number;
  embedded: number;
  symbols: number;
  startedAt?: number;
  finishedAt?: number;
  message?: string;
  error?: string;
}

export interface RetrievalResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  content: string;
  reason: 'vector' | 'symbol' | 'text' | 'recent';
}

export interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
  path: string;
  container?: string;
}

export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'ignored';

export interface GitFileStatus {
  path: string;
  index: string;
  worktree: string;
  state: GitFileState;
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  detached: boolean;
  clean: boolean;
  files: GitFileStatus[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitDiffFile {
  path: string;
  patch: string;
  staged: boolean;
  additions: number;
  deletions: number;
}

export type DiffLineType = 'context' | 'add' | 'delete';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  index: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileChange {
  path: string;
  changeType: 'create' | 'update' | 'delete';
  before: string;
  after: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  truncated?: boolean;
}

export type PermissionKind = 'write' | 'delete' | 'command' | 'install' | 'commit' | 'network' | 'restore';

export interface PermissionRequest {
  id: string;
  kind: PermissionKind;
  title: string;
  detail: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  diff?: FileChange[];
  dangerous?: boolean;
  runId?: string;
  toolName?: string;
  createdAt: number;
}

export type PermissionDecision = 'approved' | 'denied' | 'session';

export interface PermissionResponse {
  id: string;
  decision: PermissionDecision;
  /** For write approvals: only these hunk indices are wanted. Undefined means all. */
  acceptedHunks?: number[];
}

export type AgentKind =
  'coding' | 'planner' | 'frontend' | 'animation' | 'backend' | 'debugging' | 'testing' | 'review' | 'docs' | 'seo';

export interface AgentRunRequest {
  projectId: string;
  conversationId?: string;
  task: string;
  agent: AgentKind;
  providerId?: string;
  model?: string;
  maxSteps?: number;
  contextFiles?: string[];
  specTaskId?: string;
  feature?: string;
}

export interface AgentStepInfo {
  step: number;
  maxSteps: number;
}

export interface AgentReport {
  runId: string;
  summary: string;
  filesChanged: string[];
  commandsRun: string[];
  steps: number;
  durationMs: number;
  promptTokens: number;
  outputTokens: number;
  cancelled: boolean;
}

export type AgentEvent =
  | { type: 'started'; runId: string; agent: AgentKind; model: string }
  | { type: 'thinking'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'step'; info: AgentStepInfo }
  | { type: 'tool_call'; call: ChatToolCall }
  | { type: 'tool_result'; callId: string; name: string; ok: boolean; preview: string }
  | { type: 'file_change'; change: FileChange }
  | { type: 'usage'; promptTokens: number; outputTokens: number }
  | { type: 'done'; report: AgentReport }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export interface Conversation {
  id: string;
  projectId?: string;
  title: string;
  mode: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
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
  createdAt: number;
}

export type SpecPhase = 'requirements' | 'design' | 'tasks' | 'implementation' | 'done';

export interface SpecTask {
  id: string;
  title: string;
  details: string;
  files: string[];
  acceptance: string[];
  dependsOn: string[];
  approved: boolean;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'blocked';
  order: number;
}

export interface SpecMeta {
  feature: string;
  title: string;
  description: string;
  phase: SpecPhase;
  approvals: {
    requirements: boolean;
    design: boolean;
    tasks: boolean;
  };
  tasks: SpecTask[];
  createdAt: number;
  updatedAt: number;
}

export interface SpecDocument {
  meta: SpecMeta;
  requirements: string;
  design: string;
  tasks: string;
}

export interface Checkpoint {
  id: string;
  projectId: string;
  label: string;
  kind: 'agent' | 'manual' | 'spec' | 'rollback';
  createdAt: number;
  fileCount: number;
  files: string[];
}

export interface RuleFile {
  path: string;
  scope: 'project' | 'global';
  name: string;
  content: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  userData: string;
  isDev: boolean;
}

export interface ProjectStack {
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  testRunners: string[];
  hasGit: boolean;
  entryPoints: string[];
}

export interface CompletionRequest {
  filePath: string;
  language: string;
  prefix: string;
  suffix: string;
  providerId?: string;
  model?: string;
}

export interface CompletionResponse {
  text: string;
  model: string;
}

export interface QuickEditRequest {
  action: 'explain' | 'refactor' | 'tests' | 'docs' | 'animation';
  code: string;
  language: string;
  path: string;
  providerId?: string;
  model?: string;
}

export interface UsageStats {
  totalPromptTokens: number;
  totalOutputTokens: number;
  runs: number;
  avgTokensPerSecond: number;
}
