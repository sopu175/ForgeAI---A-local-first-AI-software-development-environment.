import { create } from 'zustand';
import {
  type AgentEvent,
  type AppInfo,
  type AgentKind,
  type AgentReport,
  type AgentRunRequest,
  type AppSettings,
  type ChatDelta,
  type ChatMessage,
  type Conversation,
  type FileChange,
  type FileNode,
  type GitDiffFile,
  type GitStatus,
  type IndexStatus,
  type ModelInfo,
  type PermissionRequest,
  type ProviderConfig,
  type ProjectStack,
  type ProjectSummary,
  type RoleBinding,
  type RuleFile,
  type RuntimeStatus,
} from '@forgeai/shared';
import { errorMessage } from '../lib/format';
import { applyEditToActive, getActiveEditor } from '../lib/editorRegistry';

export type ActivityView = 'explorer' | 'search' | 'scm' | 'specs' | 'agents' | 'extensions' | 'history';
export type AiTab = 'chat' | 'agent' | 'diffs' | 'context';
/** The unified composer can send a normal message or start an agent run. */
export type ComposerMode = 'chat' | 'agent';
export type BottomTab = 'terminal' | 'problems' | 'output' | 'debug' | 'git';

export interface EditorTab {
  id: string;
  kind: 'file' | 'spec' | 'git';
  title: string;
  path?: string;
  language?: string;
  content?: string;
  saved?: string;
  mtime?: number;
  feature?: string;
  patch?: string;
  staged?: boolean;
  additions?: number;
  deletions?: number;
  truncated?: boolean;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface OutputLine {
  id: number;
  time: number;
  level: 'info' | 'warn' | 'error' | 'success';
  source: string;
  text: string;
}

export interface ProblemItem {
  path: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

export interface QuickEditState {
  action: 'explain' | 'refactor' | 'tests' | 'docs';
  code: string;
  language: string;
  path: string;
  replaceSelection: boolean;
  loading: boolean;
  result?: string;
  error?: string;
}

export interface AgentRunState {
  runId: string;
  agent: AgentKind;
  task: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  events: AgentEvent[];
  changes: FileChange[];
  steps: { step: number; maxSteps: number };
  startedAt: number;
  /** Message index the run was launched from, so the run stays inline in the chat. */
  anchor: number;
  model?: string;
  report?: AgentReport;
  error?: string;
}

/**
 * Streaming providers emit one text delta per token. Appending each delta as
 * its own event rendered a wall of one-word bubbles, so consecutive text and
 * reasoning deltas are merged into the block they belong to.
 */
function appendAgentEvent(events: AgentEvent[], event: AgentEvent): AgentEvent[] {
  const last = events[events.length - 1];
  if (event.type === 'assistant' && last?.type === 'assistant') {
    const merged: AgentEvent = { type: 'assistant', text: last.text + event.text };
    return [...events.slice(0, -1), merged].slice(-500);
  }
  if (event.type === 'reasoning' && last?.type === 'reasoning') {
    const merged: AgentEvent = { type: 'reasoning', text: last.text + event.text };
    return [...events.slice(0, -1), merged].slice(-500);
  }
  return [...events, event].slice(-500);
}

/** Move the visible run into history so a conversation switch does not lose it. */
function archiveAgentRun(state: AppState): Pick<AppState, 'agentRun' | 'agentHistory'> {
  const run = state.agentRun;
  if (!run) return { agentRun: null, agentHistory: state.agentHistory };
  return {
    agentRun: null,
    agentHistory: [run, ...state.agentHistory.filter((entry) => entry.runId !== run.runId)].slice(0, 8),
  };
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => void | Promise<void>;
}

interface ChatUsage {
  promptTokens: number;
  outputTokens: number;
}

export interface AppState {
  ready: boolean;
  info: AppInfo | null;
  project: ProjectSummary | null;
  settings: AppSettings | null;
  providers: ProviderConfig[];
  models: ModelInfo[];
  runtime: RuntimeStatus | null;
  selectedModel: RoleBinding | null;
  stack: ProjectStack | null;
  rules: RuleFile[];
  files: FileNode[];
  expanded: string[];
  tabs: EditorTab[];
  activeTabId: string | null;
  splitOpen: boolean;
  splitTabId: string | null;
  reveal: { path: string; line: number; nonce: number } | null;
  activity: ActivityView;
  sidebarOpen: boolean;
  aiOpen: boolean;
  aiTab: AiTab;
  composerMode: ComposerMode;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  agentMode: AgentKind;
  permissions: PermissionRequest[];
  toasts: Toast[];
  confirm: ConfirmState | null;
  paletteOpen: boolean;
  quickOpenOpen: boolean;
  settingsOpen: boolean;
  settingsSection?: string;
  modelsOpen: boolean;
  quickEdit: QuickEditState | null;
  prompt: {
    title: string;
    message?: string;
    placeholder?: string;
    initial?: string;
    submitLabel?: string;
    onSubmit: (value: string) => void | Promise<void>;
  } | null;
  newSpecSignal: number;
  agentRun: AgentRunState | null;
  agentHistory: AgentRunState[];
  /** Runs shown inline in the current conversation, newest last. */
  inlineRuns: AgentRunState[];
  outputs: OutputLine[];
  problems: ProblemItem[];
  cursor: { line: number; column: number };
  indexing: IndexStatus | null;
  git: GitStatus | null;
  conversations: Conversation[];
  conversationId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  requestId: string | null;
  chatError: string | null;
  chatUsage: ChatUsage | null;
  contextFiles: string[];
  specVersion: number;
  searchFocus: number;

  init(): Promise<void>;
  applyProject(project: ProjectSummary | null): Promise<void>;
  openFolder(): Promise<void>;
  openWorkspace(root: string): Promise<void>;
  closeWorkspace(): Promise<void>;
  refreshTree(): Promise<void>;
  refreshStack(): Promise<void>;
  refreshModels(showErrors?: boolean): Promise<void>;
  refreshRuntime(): Promise<void>;
  ensureRuntime(): Promise<RuntimeStatus | null>;
  cancelRuntime(): Promise<void>;
  handleRuntimeProgress(status: RuntimeStatus): void;
  refreshIndex(): Promise<void>;
  startIndex(rebuild?: boolean): Promise<void>;
  cancelIndex(): Promise<void>;
  refreshGit(): Promise<void>;
  setSelectedModel(binding: RoleBinding | null): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;

  openFile(path: string, line?: number): Promise<void>;
  openSpecTab(feature: string, title: string): void;
  openGitDiff(file: GitDiffFile): void;
  setActiveTab(id: string): void;
  setTabContent(id: string, content: string): void;
  saveTab(id?: string): Promise<void>;
  saveAll(): Promise<void>;
  closeTab(id: string): Promise<void>;
  closeOtherTabs(id: string): Promise<void>;
  toggleSplit(): void;
  closeSplit(): void;
  setSplitTab(id: string): void;

  setActivity(view: ActivityView): void;
  toggleSidebar(): void;
  toggleAI(): void;
  openAI(tab?: AiTab): void;
  setAiTab(tab: AiTab): void;
  setComposerMode(mode: ComposerMode): void;
  toggleBottom(): void;
  showBottom(tab: BottomTab): void;
  setAgentMode(agent: AgentKind): void;
  setPaletteOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
  setSettingsOpen(open: boolean, section?: string): void;
  setModelsOpen(open: boolean): void;
  setReveal(path: string, line: number): void;
  setCursor(line: number, column: number): void;
  bumpSearchFocus(): void;

  toast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
  askConfirm(state: ConfirmState): void;
  closeConfirm(): void;

  loadConversations(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  newChat(): void;
  deleteConversation(id: string): Promise<void>;
  sendChat(text: string): Promise<void>;
  cancelChat(): Promise<void>;
  handleChatDelta(requestId: string, delta: ChatDelta): void;
  addContextFile(path: string): void;
  removeContextFile(path: string): void;
  clearContext(): void;

  startAgent(request: AgentRunRequest): Promise<void>;
  cancelAgent(): Promise<void>;
  handleAgentEvent(runId: string, event: AgentEvent): void;
  dismissAgentRun(): void;
  respondPermission(id: string, decision: 'approved' | 'denied' | 'session', acceptedHunks?: number[]): Promise<void>;
  addPermission(request: PermissionRequest): void;
  removePermission(id: string): void;
  askPrompt(prompt: NonNullable<AppState['prompt']>): void;
  closePrompt(): void;
  requestNewSpec(): void;

  openQuickEdit(
    action: QuickEditState['action'],
    code: string,
    language: string,
    path: string,
    replaceSelection: boolean,
  ): void;
  runQuickEdit(): Promise<void>;
  closeQuickEdit(): void;
  applyQuickEditResult(): void;

  appendOutput(level: OutputLine['level'], text: string, source?: string): void;
  clearOutput(): void;
  setProblems(path: string, problems: ProblemItem[]): void;
  handleWorkspaceChange(path?: string): void;
  handleIndexProgress(status: IndexStatus): void;
  handleSpecChanged(): void;
}

const REVEAL_NONCE = { value: 0 };
const TOAST_SEQ = { value: 0 };
const OUTPUT_SEQ = { value: 0 };
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const changedWorkspacePaths = new Set<string>();

export const useAppStore = create<AppState>()((set, get) => ({
  ready: false,
  info: null,
  project: null,
  settings: null,
  providers: [],
  models: [],
  runtime: null,
  selectedModel: null,
  stack: null,
  rules: [],
  files: [],
  expanded: [],
  tabs: [],
  activeTabId: null,
  splitOpen: false,
  splitTabId: null,
  reveal: null,
  activity: 'explorer',
  sidebarOpen: true,
  aiOpen: typeof window !== 'undefined' ? window.innerWidth > 1240 : true,
  aiTab: 'chat',
  composerMode: 'chat',
  bottomOpen: false,
  bottomTab: 'terminal',
  agentMode: 'coding',
  permissions: [],
  toasts: [],
  confirm: null,
  paletteOpen: false,
  quickOpenOpen: false,
  settingsOpen: false,
  modelsOpen: false,
  quickEdit: null,
  prompt: null,
  newSpecSignal: 0,
  agentRun: null,
  agentHistory: [],
  inlineRuns: [],
  outputs: [],
  problems: [],
  cursor: { line: 1, column: 1 },
  indexing: null,
  git: null,
  conversations: [],
  conversationId: null,
  messages: [],
  streaming: false,
  requestId: null,
  chatError: null,
  chatUsage: null,
  contextFiles: [],
  specVersion: 0,
  searchFocus: 0,

  async init() {
    if (get().ready) return;
    try {
      const [settings, project, providers, info] = await Promise.all([
        window.forge.settings.get(),
        window.forge.workspace.current(),
        window.forge.providers.list(),
        window.forge.app.info(),
      ]);
      set({ settings, providers, info, ready: true });
      // Hydrate workspace data after first paint. Opening a folder performs
      // file-tree, git and index reads that should not block the shell.
      void (project ? get().applyProject(project) : get().loadConversations()).catch((error) =>
        get().toast('error', errorMessage(error)),
      );
      void get().refreshModels();
      void get().refreshRuntime();
    } catch (error) {
      set({ ready: true });
      get().toast('error', errorMessage(error));
    }
  },

  async applyProject(project) {
    set({
      project,
      tabs: [],
      activeTabId: null,
      splitOpen: false,
      splitTabId: null,
      files: [],
      expanded: [],
      agentRun: null,
      inlineRuns: [],
      contextFiles: [],
      rules: [],
      stack: null,
      git: null,
      indexing: null,
      problems: [],
      conversationId: null,
      messages: [],
      chatError: null,
      activity: 'explorer',
    });
    if (!project) return;
    await Promise.all([get().refreshTree(), get().refreshStack(), get().refreshIndex(), get().refreshGit()]);
    void get().loadConversations();
    void window.forge.workspace
      .rules()
      .then((rules) => set({ rules }))
      .catch(() => undefined);
  },

  async openFolder() {
    try {
      const summary = await window.forge.workspace.openDialog();
      if (!summary) return;
      await get().applyProject(summary);
      get().toast('success', `Opened ${summary.name}`);
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  async openWorkspace(root) {
    try {
      const summary = await window.forge.workspace.open(root);
      await get().applyProject(summary);
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  async closeWorkspace() {
    try {
      await window.forge.workspace.close();
      await get().applyProject(null);
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  async refreshTree() {
    if (!get().project) return;
    try {
      set({ files: await window.forge.workspace.tree() });
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  async refreshStack() {
    if (!get().project) return;
    try {
      set({ stack: await window.forge.workspace.stack() });
    } catch {
      // Stack detection is best-effort.
    }
  },

  async refreshModels(showErrors = false) {
    try {
      const models = await window.forge.providers.models(true);
      const recommended = await window.forge.settings.recommendRoles();
      const current = get().selectedModel;
      const settings = get().settings;

      const currentExists =
        current && models.some((model) => model.id === current.model && model.providerId === current.providerId);
      const chatExists =
        settings?.modelRoles.chat &&
        models.some((model) => model.id === settings.modelRoles.chat?.model && model.providerId === settings.modelRoles.chat?.providerId);

      const candidate = currentExists
        ? current
        : chatExists
          ? settings!.modelRoles.chat!
          : (recommended.chat ?? recommended.coding ?? null);

      const validFallback =
        candidate && models.some((m) => m.id === candidate.model && m.providerId === candidate.providerId)
          ? candidate
          : (models.find((m) => !m.capabilities.embedding)
              ? { providerId: models.find((m) => !m.capabilities.embedding)!.providerId, model: models.find((m) => !m.capabilities.embedding)!.id }
              : null);

      set({ models, selectedModel: validFallback, providers: await window.forge.providers.list() });

      if (validFallback && (!currentExists || !chatExists)) {
        await get().setSelectedModel(validFallback).catch(() => undefined);
      }
    } catch (error) {
      if (showErrors) get().toast('error', errorMessage(error));
      set({ providers: await window.forge.providers.list().catch(() => get().providers) });
    }
  },

  async refreshRuntime() {
    try {
      set({ runtime: await window.forge.runtime.status() });
    } catch {
      // Runtime status is advisory; chat surfaces the real connection error.
    }
  },

  ensureRuntime() {
    return window.forge.runtime
      .ensure()
      .then((status) => {
        get().handleRuntimeProgress(status);
        return status;
      })
      .catch((error) => {
        get().toast('error', errorMessage(error));
        return null;
      });
  },

  async cancelRuntime() {
    await window.forge.runtime.cancel().catch(() => undefined);
  },

  handleRuntimeProgress(status) {
    const wasReady = get().runtime?.stage === 'ready';
    set({ runtime: status });
    if (status.stage === 'ready' && !wasReady) {
      void window.forge.settings
        .get()
        .then((settings) => set({ settings }))
        .catch(() => undefined);
      void get().refreshModels();
    }
  },

  async refreshIndex() {
    const project = get().project;
    if (!project) return;
    try {
      set({ indexing: await window.forge.index.status(project.id) });
    } catch {
      // Status is advisory.
    }
  },

  async startIndex(rebuild = false) {
    const project = get().project;
    if (!project) return;
    try {
      const status = rebuild
        ? await window.forge.index.rebuild(project.id)
        : await window.forge.index.start(project.id);
      set({ indexing: status });
      get().showBottom('output');
      get().appendOutput('info', rebuild ? 'Rebuilding project index…' : 'Indexing project…', 'indexer');
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  async cancelIndex() {
    const project = get().project;
    if (!project) return;
    await window.forge.index.cancel(project.id).catch(() => undefined);
  },

  async refreshGit() {
    const project = get().project;
    if (!project) {
      set({ git: null });
      return;
    }
    try {
      set({ git: await window.forge.git.status(project.id) });
    } catch {
      set({ git: null });
    }
  },

  async setSelectedModel(binding) {
    set({ selectedModel: binding });
    const settings = get().settings;
    if (settings && binding) {
      await get()
        .updateSettings({
          modelRoles: {
            ...settings.modelRoles,
            chat: binding,
            coding: binding,
            plan: binding,
            review: binding,
          },
        })
        .catch(() => undefined);
    }
  },

  async updateSettings(patch) {
    const current = get().settings;
    if (!current) return;
    const optimistic: AppSettings = {
      ...current,
      ...patch,
      approval: { ...current.approval, ...(patch.approval ?? {}) },
      indexing: { ...current.indexing, ...(patch.indexing ?? {}) },
      completion: { ...current.completion, ...(patch.completion ?? {}) },
      agent: { ...current.agent, ...(patch.agent ?? {}) },
      modelRoles: { ...current.modelRoles, ...(patch.modelRoles ?? {}) },
    };
    set({ settings: optimistic });
    try {
      const saved = await window.forge.settings.update(patch);
      set({ settings: saved });
    } catch (error) {
      set({ settings: current });
      get().toast('error', errorMessage(error));
    }
  },

  async openFile(path, line) {
    const existing = get().tabs.find((tab) => tab.kind === 'file' && tab.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      if (line) get().setReveal(path, line);
      return;
    }
    try {
      const file = await window.forge.workspace.readFile(path);
      const id = `file:${file.path}`;
      const tab: EditorTab = {
        id,
        kind: 'file',
        title: file.path.split('/').pop() ?? file.path,
        path: file.path,
        language: file.language,
        content: file.content,
        saved: file.content,
        mtime: file.mtime,
        truncated: file.truncated,
      };
      set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }));
      if (line) get().setReveal(path, line);
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  openSpecTab(feature, title) {
    const id = `spec:${feature}`;
    const existing = get().tabs.find((tab) => tab.id === id);
    if (existing) {
      set({ activeTabId: id });
      return;
    }
    set((state) => ({
      tabs: [...state.tabs, { id, kind: 'spec', title: `Spec · ${title}`, feature }],
      activeTabId: id,
    }));
  },

  openGitDiff(file) {
    const id = `git:${file.staged ? 'staged' : 'working'}:${file.path}`;
    const existing = get().tabs.find((tab) => tab.id === id);
    if (existing) {
      set({ activeTabId: id });
      return;
    }
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          id,
          kind: 'git',
          title: `${file.path.split('/').pop() ?? file.path} (${file.staged ? 'staged' : 'working'})`,
          path: file.path,
          patch: file.patch,
          staged: file.staged,
          additions: file.additions,
          deletions: file.deletions,
        },
      ],
      activeTabId: id,
    }));
  },

  setActiveTab(id) {
    set({ activeTabId: id });
  },

  setTabContent(id, content) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, content } : tab)),
    }));
  },

  async saveTab(id) {
    const tabId = id ?? get().activeTabId;
    if (!tabId) return;
    const tab = get().tabs.find((entry) => entry.id === tabId);
    if (!tab || tab.kind !== 'file' || !tab.path || tab.content === tab.saved) return;
    const content = await applyFormatOnSave(tab);
    try {
      const result = await window.forge.workspace.writeFile(tab.path, content);
      set((state) => ({
        tabs: state.tabs.map((entry) =>
          entry.id === tabId ? { ...entry, saved: entry.content, mtime: result.mtime } : entry,
        ),
      }));
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  async saveAll() {
    const dirty = get().tabs.filter((tab) => tab.kind === 'file' && tab.content !== tab.saved && Boolean(tab.path));
    for (const tab of dirty) await get().saveTab(tab.id);
  },

  async closeTab(id) {
    const tab = get().tabs.find((entry) => entry.id === id);
    if (!tab) return;
    if (tab.kind === 'file' && tab.content !== tab.saved) {
      get().askConfirm({
        title: `Close ${tab.title}?`,
        message: 'This file has unsaved changes. Closing the editor discards them.',
        confirmLabel: 'Discard and close',
        danger: true,
        action: () => {
          set((state) => ({ tabs: state.tabs.filter((entry) => entry.id !== id) }));
          finalizeClose(id, set);
        },
      });
      return;
    }
    set((state) => ({ tabs: state.tabs.filter((entry) => entry.id !== id) }));
    finalizeClose(id, set);
  },

  async closeOtherTabs(id) {
    set((state) => ({
      tabs: state.tabs.filter((tab) => tab.id === id || (tab.kind === 'file' && tab.content !== tab.saved)),
    }));
    set({ activeTabId: id });
  },

  toggleSplit() {
    const state = get();
    if (state.splitOpen) {
      set({ splitOpen: false, splitTabId: null });
      return;
    }
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!active) return;
    // Prefer a different open tab so the split is immediately useful; fall
    // back to duplicating the active file (the VS Code behaviour).
    const other = state.tabs.find((tab) => tab.id !== active.id);
    set({ splitOpen: true, splitTabId: other?.id ?? active.id });
  },

  closeSplit() {
    set({ splitOpen: false, splitTabId: null });
  },

  setSplitTab(id) {
    set({ splitTabId: id });
  },

  setActivity(view) {
    set({ activity: view, sidebarOpen: true });
  },

  toggleSidebar() {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  toggleAI() {
    set((state) => ({ aiOpen: !state.aiOpen }));
  },

  openAI(tab) {
    const next = tab ?? get().aiTab;
    // Chat and agent share one panel and one composer now; the tab argument only
    // decides which mode the composer starts in.
    if (next === 'agent') set({ aiOpen: true, aiTab: 'chat', composerMode: 'agent' });
    else if (next === 'chat') set({ aiOpen: true, aiTab: 'chat', composerMode: 'chat' });
    else set({ aiOpen: true, aiTab: next });
  },

  setAiTab(tab) {
    if (tab === 'agent') set({ aiTab: 'chat', composerMode: 'agent', aiOpen: true });
    else if (tab === 'chat') set({ aiTab: 'chat', composerMode: 'chat', aiOpen: true });
    else set({ aiTab: tab, aiOpen: true });
  },

  setComposerMode(mode) {
    set({ composerMode: mode, aiOpen: true, aiTab: 'chat' });
  },

  toggleBottom() {
    set((state) => ({ bottomOpen: !state.bottomOpen }));
  },

  showBottom(tab) {
    set({ bottomOpen: true, bottomTab: tab });
  },

  setAgentMode(agent) {
    set({ agentMode: agent });
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open, quickOpenOpen: false });
  },

  setQuickOpenOpen(open) {
    set({ quickOpenOpen: open, paletteOpen: false });
  },

  setSettingsOpen(open, section) {
    set({ settingsOpen: open, ...(section ? { settingsSection: section } : {}) });
  },

  setModelsOpen(open) {
    set({ modelsOpen: open });
  },

  setReveal(path, line) {
    REVEAL_NONCE.value += 1;
    set({ reveal: { path, line, nonce: REVEAL_NONCE.value } });
  },

  setCursor(line, column) {
    set({ cursor: { line, column } });
  },

  bumpSearchFocus() {
    set({ searchFocus: get().searchFocus + 1, activity: 'search', sidebarOpen: true });
  },

  toast(kind, message) {
    TOAST_SEQ.value += 1;
    const id = TOAST_SEQ.value;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4200);
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  askConfirm(state) {
    set({ confirm: state });
  },

  closeConfirm() {
    set({ confirm: null });
  },

  async loadConversations() {
    try {
      const projectId = get().project?.id;
      const conversations = await window.forge.chat.list(projectId);
      set({ conversations });
      const current = get().conversationId;
      if (current && !conversations.some((conversation) => conversation.id === current)) {
        set({ conversationId: null, messages: [] });
      }
    } catch {
      // Conversations are optional for the shell.
    }
  },

  async selectConversation(id) {
    if (get().agentRun?.status === 'running') {
      get().toast('info', 'Stop the agent run before switching conversations.');
      return;
    }
    try {
      const messages = await window.forge.chat.messages(id);
      set((state) => ({
        conversationId: id,
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          reasoning: message.reasoning,
          toolCalls: message.toolCalls,
          toolCallId: message.toolCallId,
        })),
        chatError: null,
        aiTab: 'chat',
        aiOpen: true,
        inlineRuns: [],
        ...archiveAgentRun(state),
      }));
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  newChat() {
    if (get().streaming) {
      get().toast('info', 'Stop the current answer before starting a new chat.');
      return;
    }
    if (get().agentRun?.status === 'running') {
      get().toast('info', 'Stop the agent run before starting a new chat.');
      return;
    }
    set((state) => ({
      conversationId: null,
      messages: [],
      chatError: null,
      aiTab: 'chat',
      aiOpen: true,
      inlineRuns: [],
      ...archiveAgentRun(state),
    }));
  },

  async deleteConversation(id) {
    try {
      await window.forge.chat.remove(id);
      if (get().conversationId === id) {
        set({ conversationId: null, messages: [], chatError: null });
      }
      await get().loadConversations();
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  async sendChat(text) {
    const message = text.trim();
    if (!message || get().streaming) return;
    let model = get().selectedModel;
    if (!model || !get().models.some((m) => m.id === model?.model && m.providerId === model?.providerId)) {
      await get().refreshModels();
      model = get().selectedModel;
    }
    if (!model) {
      get().toast('error', 'No local model is available. Start Ollama and pull a model in Models & Providers.');
      get().setModelsOpen(true);
      return;
    }
    const settings = get().settings;
    if (!settings) return;

    try {
      let conversationId = get().conversationId;
      if (!conversationId) {
        const conversation = await window.forge.chat.create({
          projectId: get().project?.id,
          title: message.slice(0, 60).replace(/\s+/g, ' '),
          mode: 'chat',
          model: model.model,
        });
        conversationId = conversation.id;
        set({ conversationId });
        void get().loadConversations();
      }
      const stored = await window.forge.chat.addMessage({
        conversationId,
        role: 'user',
        content: message,
      });
      const baseMessages: ChatMessage[] = [...get().messages, { id: stored.id, role: 'user', content: message }];
      const systemParts: string[] = [
        'You are ForgeAI, a precise pair-programmer inside a local-first desktop IDE.',
        'Prefer concrete, runnable answers. When you show code, use fenced blocks with a language tag.',
        'Never claim to have changed files unless the user asks an agent to do it.',
      ];
      const project = get().project;
      if (project) {
        const stack = get().stack;
        systemParts.push(
          `Workspace: ${project.name} at ${project.root}.` +
            (stack
              ? ` Languages: ${stack.languages.join(', ') || 'unknown'}. Frameworks: ${stack.frameworks.join(', ') || 'none'}.`
              : ''),
        );
      }
      const rules = get().rules;
      if (rules.length > 0) {
        systemParts.push(
          `Project rules (must be followed):\n${rules
            .map((rule) => `### ${rule.path}\n${rule.content.slice(0, 2500)}`)
            .join('\n\n')
            .slice(0, 5000)}`,
        );
      }
      const attachments: string[] = [];
      // Keep the prompt inside the 8k context of the local model: four files
      // and a small retrieval window. Truncated context is faster to prefill.
      for (const path of get().contextFiles.slice(0, 4)) {
        try {
          const file = await window.forge.workspace.readFile(path);
          attachments.push(`### ${path}\n\`\`\`${file.language}\n${file.content.slice(0, 4000)}\n\`\`\``);
        } catch {
          // Ignore files that disappeared.
        }
      }
      if (attachments.length > 0) systemParts.push(`Attached files:\n${attachments.join('\n\n').slice(0, 8000)}`);
      if (project) {
        const retrieved = await window.forge.index.search(project.id, message, 4).catch(() => []);
        if (retrieved.length > 0) {
          systemParts.push(
            `Potentially relevant code (do not assume it is complete):\n${retrieved
              .map(
                (result) =>
                  `### ${result.path}:${result.startLine}-${result.endLine}\n\`\`\`\n${result.content.slice(0, 1200)}\n\`\`\``,
              )
              .join('\n\n')
              .slice(0, 4000)}`,
          );
        }
      }
      const history = baseMessages.filter((entry) => entry.role === 'user' || entry.role === 'assistant');
      const trimmed: ChatMessage[] = [];
      let budget = 6000;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const entry = history[index];
        if (!entry || !entry.content.trim()) continue;
        const cost = entry.content.length;
        if (cost > budget && trimmed.length > 0) break;
        trimmed.unshift({ role: entry.role, content: entry.content });
        budget -= cost;
      }
      const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const placeholder: ChatMessage = { role: 'assistant', content: '' };
      set({
        messages: [...baseMessages, placeholder],
        streaming: true,
        requestId,
        chatError: null,
        chatUsage: null,
        aiOpen: true,
        aiTab: 'chat',
      });
      const modelInfo = get().models.find(
        (entry) => entry.id === model?.model && entry.providerId === model?.providerId,
      );
      await window.forge.ai.stream({
        requestId,
        providerId: model.providerId,
        model: model.model,
        messages: [{ role: 'system', content: systemParts.join('\n\n') }, ...trimmed],
        temperature: 0.2,
        maxTokens: 1500,
        contextLength: modelInfo?.contextLength ?? 8192,
      });
    } catch (error) {
      set({ streaming: false, requestId: null, chatError: errorMessage(error) });
      get().toast('error', errorMessage(error));
    }
  },

  async cancelChat() {
    const requestId = get().requestId;
    if (!requestId) return;
    await window.forge.ai.cancel(requestId).catch(() => undefined);
  },

  handleChatDelta(requestId, delta) {
    if (get().requestId !== requestId) return;
    if (delta.type === 'text' || delta.type === 'reasoning') {
      set((state) => {
        const messages = [...state.messages];
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant') {
          messages[messages.length - 1] =
            delta.type === 'text'
              ? { ...last, content: last.content + delta.text }
              : { ...last, reasoning: `${last.reasoning ?? ''}${delta.text}` };
        }
        return { messages };
      });
      return;
    }
    if (delta.type === 'usage') {
      set({ chatUsage: { promptTokens: delta.promptTokens, outputTokens: delta.outputTokens } });
      return;
    }
    if (delta.type === 'error') {
      set({ chatError: delta.message });
      void finalizeChat(get, set, delta.message);
      return;
    }
    if (delta.type === 'done') {
      void finalizeChat(get, set);
    }
  },

  addContextFile(path) {
    set((state) => ({
      contextFiles: state.contextFiles.includes(path) ? state.contextFiles : [...state.contextFiles, path],
      aiOpen: true,
    }));
  },

  removeContextFile(path) {
    set((state) => ({ contextFiles: state.contextFiles.filter((entry) => entry !== path) }));
  },

  clearContext() {
    set({ contextFiles: [] });
  },

  async startAgent(request) {
    if (get().agentRun?.status === 'running') {
      get().toast('info', 'An agent is already running. Stop it before starting another.');
      return;
    }
    const previous = get().agentRun;
    const run: AgentRunState = {
      runId: 'pending',
      agent: request.agent,
      task: request.task,
      status: 'running',
      events: [],
      changes: [],
      steps: { step: 0, maxSteps: request.maxSteps ?? get().settings?.agent.maxSteps ?? 20 },
      startedAt: Date.now(),
      anchor: get().messages.length,
    };
    set((state) => ({
      agentRun: run,
      agentHistory: previous
        ? [previous, ...state.agentHistory.filter((entry) => entry.runId !== previous.runId)].slice(0, 8)
        : state.agentHistory,
      inlineRuns: previous
        ? [...state.inlineRuns.filter((entry) => entry.runId !== previous.runId), previous]
        : state.inlineRuns,
      aiOpen: true,
      // The run is rendered inline in the unified conversation, not in its own tab.
      aiTab: 'chat',
      composerMode: 'agent',
      agentMode: request.agent,
    }));
    const activeModel = get().selectedModel;
    try {
      const { runId } = await window.forge.agent.start({
        ...request,
        providerId: request.providerId ?? activeModel?.providerId,
        model: request.model ?? activeModel?.model,
        conversationId: request.conversationId ?? get().conversationId ?? undefined,
      });
      set((state) => ({
        agentRun: state.agentRun && state.agentRun.runId === 'pending' ? { ...state.agentRun, runId } : state.agentRun,
      }));
    } catch (error) {
      set((state) => ({
        agentRun: state.agentRun ? { ...state.agentRun, status: 'error', error: errorMessage(error) } : null,
      }));
      get().toast('error', errorMessage(error));
    }
  },

  async cancelAgent() {
    const run = get().agentRun;
    if (!run || run.runId === 'pending') return;
    await window.forge.agent.cancel(run.runId).catch(() => undefined);
  },

  handleAgentEvent(runId, event) {
    const run = get().agentRun;
    if (!run || run.status !== 'running') return;
    if (run.runId !== 'pending' && run.runId !== runId) return;
    set((state) => {
      const current = state.agentRun;
      if (!current || current.status !== 'running') return {};
      if (current.runId !== 'pending' && current.runId !== runId) return {};
      const next: AgentRunState = {
        ...current,
        runId: runId,
        events: appendAgentEvent(current.events, event),
      };
      if (event.type === 'started') next.model = event.model;
      if (event.type === 'step') next.steps = event.info;
      if (event.type === 'file_change') {
        const existing = next.changes.findIndex((change) => change.path === event.change.path);
        if (existing >= 0)
          next.changes = next.changes.map((change, index) => (index === existing ? event.change : change));
        else next.changes = [...next.changes, event.change];
      }
      if (event.type === 'done') {
        next.status = 'done';
        next.report = event.report;
      }
      if (event.type === 'error') {
        next.status = 'error';
        next.error = event.message;
      }
      if (event.type === 'cancelled') next.status = 'cancelled';
      return { agentRun: next };
    });
    if (event.type === 'done') {
      get().toast(
        event.report.cancelled ? 'info' : 'success',
        event.report.cancelled ? 'Agent run cancelled.' : 'Agent finished.',
      );
      void get().refreshTree();
      void get().refreshGit();
    }
    if (event.type === 'error') get().toast('error', event.message);
    if (event.type === 'file_change') {
      void get().refreshTree();
    }
  },

  dismissAgentRun() {
    set((state) => archiveAgentRun(state));
  },

  addPermission(request) {
    set((state) => ({
      permissions: state.permissions.some((entry) => entry.id === request.id)
        ? state.permissions
        : [...state.permissions, request],
    }));
  },

  removePermission(id) {
    set((state) => ({ permissions: state.permissions.filter((entry) => entry.id !== id) }));
  },

  askPrompt(prompt) {
    set({ prompt });
  },

  closePrompt() {
    set({ prompt: null });
  },

  requestNewSpec() {
    set({ activity: 'specs', sidebarOpen: true, newSpecSignal: get().newSpecSignal + 1 });
  },

  async respondPermission(id, decision, acceptedHunks) {
    set((state) => ({ permissions: state.permissions.filter((entry) => entry.id !== id) }));
    try {
      await window.forge.agent.respond({ id, decision, acceptedHunks });
    } catch (error) {
      get().toast('error', errorMessage(error));
    }
  },

  openQuickEdit(action, code, language, path, replaceSelection) {
    set({
      quickEdit: {
        action,
        code,
        language,
        path,
        replaceSelection,
        loading: false,
      },
    });
  },

  async runQuickEdit() {
    const state = get().quickEdit;
    if (!state) return;
    set({ quickEdit: { ...state, loading: true, error: undefined, result: undefined } });
    try {
      const model = get().selectedModel;
      const result = await window.forge.ai.quickEdit({
        action: state.action,
        code: state.code,
        language: state.language,
        path: state.path,
        providerId: model?.providerId,
        model: model?.model,
      });
      set({ quickEdit: { ...state, loading: false, result } });
    } catch (error) {
      set({ quickEdit: { ...state, loading: false, error: errorMessage(error) } });
    }
  },

  closeQuickEdit() {
    set({ quickEdit: null });
  },

  applyQuickEditResult() {
    const state = get().quickEdit;
    if (!state?.result) return;
    const applied = applyEditToActive(state.result, state.action !== 'docs' && state.replaceSelection);
    if (applied) {
      get().toast('success', 'AI edit applied to the editor. Review it, then save.');
      set({ quickEdit: null });
    } else {
      get().toast('error', 'Open a file in the editor before applying this edit.');
    }
  },

  appendOutput(level, text, source = 'forgeai') {
    OUTPUT_SEQ.value += 1;
    set((state) => ({
      outputs: [...state.outputs.slice(-800), { id: OUTPUT_SEQ.value, time: Date.now(), level, source, text }],
    }));
  },

  clearOutput() {
    set({ outputs: [] });
  },

  setProblems(path, problems) {
    set((state) => ({
      problems: [...state.problems.filter((entry) => entry.path !== path), ...problems],
    }));
  },

  handleWorkspaceChange(path?: string) {
    if (!get().project) return;
    if (path) changedWorkspacePaths.add(path);
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const paths = new Set(changedWorkspacePaths);
      changedWorkspacePaths.clear();

      // Always refresh the file tree so installs (yarn, npm, pip) and external
      // editor changes appear immediately — mirroring VS Code behaviour.
      void get().refreshTree();
      // Always refresh Git status so the SCM badge updates in real time.
      void get().refreshGit();

      const state = get();
      for (const tab of state.tabs) {
        if (tab.kind !== 'file' || !tab.path) continue;
        // If paths is empty (general refresh, e.g. from terminal) or the open tab's file was modified
        if (paths.size === 0 || paths.has(tab.path)) {
          if (tab.content === tab.saved) {
            void window.forge.workspace.readFile(tab.path).then((file) => {
              set((current) => ({
                tabs: current.tabs.map((entry) =>
                  entry.id === tab.id && entry.content === entry.saved
                    ? { ...entry, content: file.content, saved: file.content, mtime: file.mtime }
                    : entry,
                ),
              }));
            }).catch(() => undefined);
          }
        }
      }
    }, 120);  // 120ms — responsive without flooding on large installs
  },

  handleIndexProgress(status) {
    set({ indexing: status });
    if (status.state === 'ready') {
      get().appendOutput(
        'success',
        `Index ready — ${status.filesIndexed} files, ${status.chunks} chunks, ${status.embedded} embedded.`,
        'indexer',
      );
    } else if (status.state === 'error') {
      get().appendOutput('error', status.error ?? 'Indexing failed', 'indexer');
      get().toast('error', status.error ?? 'Indexing failed');
    }
  },

  handleSpecChanged() {
    set({ specVersion: get().specVersion + 1 });
  },
}));

/**
 * Runs the editor formatter before writing, when "format on save" is enabled and
 * the tab being saved is the one on screen. Formatting is best-effort: a file the
 * language service cannot format is still saved.
 */
async function applyFormatOnSave(tab: EditorTab): Promise<string> {
  const state = useAppStore.getState();
  const fallback = tab.content ?? '';
  if (!state.settings?.editor.formatOnSave) return fallback;
  const editor = getActiveEditor();
  const model = editor?.getModel();
  if (!editor || !model) return fallback;
  const editorPath = model.uri.path.replace(/^\//, '');
  if (!tab.path || (!editorPath.endsWith(tab.path) && !tab.path.endsWith(editorPath))) return fallback;
  try {
    await editor.getAction('editor.action.formatDocument')?.run();
    // Monaco pushes the formatted text through onDidChangeModelContent synchronously,
    // but external formatters can settle a frame later.
    await new Promise((resolve) => setTimeout(resolve, 60));
    return useAppStore.getState().tabs.find((entry) => entry.id === tab.id)?.content ?? model.getValue();
  } catch {
    return fallback;
  }
}

function finalizeClose(
  id: string,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
): void {
  set((state) => {
    if (state.activeTabId !== id) return {};
    const remaining = state.tabs.filter((tab) => tab.id !== id);
    const next = remaining[remaining.length - 1]?.id ?? null;
    return { activeTabId: next, splitTabId: state.splitTabId === id ? null : state.splitTabId };
  });
}

async function finalizeChat(
  get: () => AppState,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  error?: string,
): Promise<void> {
  const state = get();
  const requestId = state.requestId;
  if (!requestId && !state.streaming) return;
  const last = state.messages[state.messages.length - 1];
  const content = last?.role === 'assistant' ? last.content : '';
  const reasoning = last?.role === 'assistant' ? last.reasoning : undefined;
  const usage = state.chatUsage;
  set({ streaming: false, requestId: null, chatError: error ?? state.chatError });
  if (state.conversationId && (content.trim() || reasoning?.trim())) {
    try {
      await window.forge.chat.addMessage({
        conversationId: state.conversationId,
        role: 'assistant',
        content,
        reasoning,
        model: state.selectedModel?.model,
        tokensIn: usage?.promptTokens,
        tokensOut: usage?.outputTokens,
      });
      void get().loadConversations();
    } catch {
      // The transcript is best-effort; the answer remains visible in the UI.
    }
  }
}
