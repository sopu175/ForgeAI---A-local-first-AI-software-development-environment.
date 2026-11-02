import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  GitBranch,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  TestTube,
  X,
  Zap,
} from 'lucide-react';
import type { AgentKind, ChatMessage } from '@forgeai/shared';
import { useAppStore, type AgentRunState } from '../../state/app';
import { cn, Spinner } from '../ui';
import { Markdown } from '../Markdown';
import { AgentRunCard } from './AgentRunCard';
import { errorMessage, shortModelName } from '../../lib/format';
import { getActiveEditor } from '../../lib/editorRegistry';

const AGENT_OPTIONS: Array<{ kind: AgentKind; label: string }> = [
  { kind: 'coding', label: 'Coding' },
  { kind: 'planner', label: 'Planner' },
  { kind: 'debugging', label: 'Debugging' },
  { kind: 'testing', label: 'Testing' },
  { kind: 'review', label: 'Review' },
  { kind: 'docs', label: 'Docs' },
  { kind: 'seo', label: 'SEO' },
];

const AGENT_TEMPLATES: Partial<Record<AgentKind, string[]>> = {
  coding: [
    'Add the feature described below and verify it with tests',
    'Fix the failing build without changing behaviour',
    'Refactor this module for readability and performance',
    'Implement the TODO comments in the selected file',
  ],
  planner: [
    'Plan this feature and list impacted files',
    'Break this refactor into safe, ordered steps',
    'Write a technical spec for the next sprint',
  ],
  debugging: [
    'Reproduce this bug and fix the root cause',
    'Find why the build or test suite fails',
    'Trace the data flow and identify where values are wrong',
  ],
  testing: [
    'Add focused tests for the selected module',
    'Make this test deterministic and fast',
    'Generate edge-case tests for every exported function',
  ],
  review: [
    'Review my uncommitted changes',
    'Look for correctness and security risks in this module',
    'Check for performance bottlenecks and unnecessary re-renders',
  ],
  docs: [
    'Document this module for new contributors',
    'Update the README for the current setup',
    'Generate API documentation from TypeScript types',
  ],
  seo: [
    'Audit this site and fix the highest-impact SEO issues',
    'Add per-route titles, descriptions, canonical and Open Graph tags',
    'Create robots.txt and a sitemap for every public route',
  ],
};

/**
 * The single AI surface: one conversation, one composer. Chat messages and
 * agent runs share the same timeline; the composer's mode switch decides which
 * one the next message starts.
 */
export function AssistantPanel() {
  const messages = useAppStore((state) => state.messages);
  const streaming = useAppStore((state) => state.streaming);
  const chatError = useAppStore((state) => state.chatError);
  const chatUsage = useAppStore((state) => state.chatUsage);
  const sendChat = useAppStore((state) => state.sendChat);
  const cancelChat = useAppStore((state) => state.cancelChat);
  const conversations = useAppStore((state) => state.conversations);
  const conversationId = useAppStore((state) => state.conversationId);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const newChat = useAppStore((state) => state.newChat);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const models = useAppStore((state) => state.models);
  const project = useAppStore((state) => state.project);
  const contextFiles = useAppStore((state) => state.contextFiles);
  const removeContextFile = useAppStore((state) => state.removeContextFile);
  const addContextFile = useAppStore((state) => state.addContextFile);
  const askPrompt = useAppStore((state) => state.askPrompt);
  const toast = useAppStore((state) => state.toast);
  const openFile = useAppStore((state) => state.openFile);
  const composerMode = useAppStore((state) => state.composerMode);
  const setComposerMode = useAppStore((state) => state.setComposerMode);
  const agentMode = useAppStore((state) => state.agentMode);
  const setAgentMode = useAppStore((state) => state.setAgentMode);
  const agentRun = useAppStore((state) => state.agentRun);
  const inlineRuns = useAppStore((state) => state.inlineRuns);
  const startAgent = useAppStore((state) => state.startAgent);
  const cancelAgent = useAppStore((state) => state.cancelAgent);
  const dismissAgentRun = useAppStore((state) => state.dismissAgentRun);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);
  const settings = useAppStore((state) => state.settings);

  const [input, setInput] = useState('');
  const [maxSteps, setMaxSteps] = useState(settings?.agent.maxSteps ?? 20);
  const [showReasoning, setShowReasoning] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runningAgent = agentRun?.status === 'running';
  const busy = streaming || runningAgent;
  const isAgent = composerMode === 'agent';
  const agentOption = AGENT_OPTIONS.find((option) => option.kind === agentMode);

  const lastContentLength = messages[messages.length - 1]?.content.length ?? 0;
  const runEventCount = agentRun?.events.length ?? 0;
  const runs = [...inlineRuns.filter((run) => run.runId !== agentRun?.runId), ...(agentRun ? [agentRun] : [])].sort(
    (left, right) => left.startedAt - right.startedAt,
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance < 320 || streaming || runningAgent) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages.length, lastContentLength, streaming, runEventCount, runningAgent, runs.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(180, textarea.scrollHeight)}px`;
  }, [input]);

  const [pendingTask, setPendingTask] = useState<string | null>(null);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    if (isAgent) {
      if (!project) {
        toast('info', 'Open a project folder before starting an agent.');
        return;
      }
      // Show a quick plan-or-execute confirmation before running — mirrors the
      // behaviour the user asked for ("agent suggestion — ask in reply").
      setInput('');
      setPendingTask(text);
      return;
    }
    setInput('');
    void sendChat(text);
  };

  const launchAgent = (task: string, agent: AgentKind = agentMode, planFirst = false) => {
    setPendingTask(null);
    void startAgent({
      projectId: project!.id,
      task,
      agent: planFirst ? 'planner' : agent,
      maxSteps,
      contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
    });
  };

  const attachFile = () => {
    if (!project) {
      toast('info', 'Open a project before attaching files.');
      return;
    }
    askPrompt({
      title: 'Attach file to the conversation',
      message: 'Enter a path relative to the workspace root. Attached files are added to the prompt.',
      placeholder: 'src/services/checkout.ts',
      submitLabel: 'Attach',
      onSubmit: async (value) => {
        const path = value.trim().replace(/^\/+/, '');
        if (!path) return;
        try {
          await window.forge.workspace.readFile(path);
          addContextFile(path);
          toast('success', `Attached ${path}`);
        } catch (caught) {
          toast('error', errorMessage(caught));
        }
      },
    });
  };

  const attachActive = () => {
    const editor = getActiveEditor();
    const model = editor?.getModel();
    const path = model?.uri.path.replace(/^\//, '');
    if (!path) {
      toast('info', 'No file is open in the editor.');
      return;
    }
    addContextFile(path);
    toast('success', `Attached ${path.split('/').pop()}`);
  };

  const chatSuggestions = useMemo(() => {
    if (!project) {
      return [
        'Explain how this codebase is structured and where to start',
        'What tech stack is used here? Summarize dependencies.',
        'Write a professional README for this project',
      ];
    }
    return [
      'Summarize the architecture and list the main entry points',
      'Where is error handling inconsistent? Point to exact files.',
      'Explain the data flow from the API layer to the UI',
      'What tests are missing? Suggest a test plan.',
    ];
  }, [project]);

  const empty = messages.length === 0 && runs.length === 0;

  const renderRun = (run: AgentRunState) => (
    <AgentRunCard
      key={`run-${run.runId}`}
      run={run}
      onStop={() => void cancelAgent()}
      onDismiss={dismissAgentRun}
      onOpenFile={(path) => void openFile(path)}
    />
  );

  const timeline: React.ReactNode[] = [];
  messages.forEach((message, index) => {
    runs.filter((run) => run.anchor === index).forEach((run) => timeline.push(renderRun(run)));
    timeline.push(
      <MessageBubble
        key={message.id ?? `msg-${index}`}
        message={message}
        streaming={streaming && index === messages.length - 1}
        reasoningOpen={showReasoning[index] ?? false}
        onToggleReasoning={() => setShowReasoning((current) => ({ ...current, [index]: !(current[index] ?? false) }))}
        onOpenFile={(path) => void openFile(path)}
      />,
    );
  });
  runs.filter((run) => run.anchor >= messages.length).forEach((run) => timeline.push(renderRun(run)));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line-soft px-2 py-1.5">
        <div className="relative flex min-w-0 flex-1 items-center">
          <select
            value={conversationId ?? ''}
            onChange={(event) => {
              if (event.target.value) void selectConversation(event.target.value);
            }}
            className="h-7 w-full cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent pl-2 pr-6 py-0 text-[11px] text-muted hover:border-line-soft hover:bg-panel-2/60 focus:border-accent focus:outline-hidden leading-tight"
            title="Conversation history"
          >
            <option value="" className="bg-bg text-fg">
              New conversation
            </option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id} className="bg-bg text-fg">
                {conversation.title || 'Untitled chat'}
              </option>
            ))}
          </select>
          <ChevronDown size={11} className="pointer-events-none absolute right-1.5 text-faint" />
        </div>
        <button
          type="button"
          onClick={newChat}
          className="focus-ring shrink-0 rounded p-1 text-faint hover:bg-panel-3 hover:text-fg cursor-pointer"
          title="New conversation (⌘⌥N)"
        >
          <MessageSquarePlus size={13} />
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative flex items-center">
            <select
              value={selectedModel ? `${selectedModel.providerId}::${selectedModel.model}` : ''}
              onChange={(event) => {
                const val = event.target.value;
                if (!val) void setSelectedModel(null);
                else {
                  const [pid, ...rest] = val.split('::');
                  if (pid && rest.length > 0) {
                    void setSelectedModel({ providerId: pid, model: rest.join('::') });
                  }
                }
              }}
              className="h-7 min-w-[110px] max-w-[155px] cursor-pointer appearance-none truncate rounded-md border border-line-soft bg-panel-2 pl-2 pr-6 py-0 text-[11px] font-medium text-fg hover:border-line focus:border-accent focus:outline-hidden leading-tight"
              title="Active Model (controls Chat, Coding Agent & Planning)"
            >
              {models.length === 0 ? (
                <option value="" className="bg-bg text-fg">
                  No models
                </option>
              ) : null}
              {models.map((m) => (
                <option key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`} className="bg-bg text-fg">
                  {shortModelName(m.id)} ({m.providerId === 'ollama' ? 'Local' : 'Cloud'})
                </option>
              ))}
            </select>
            <ChevronDown size={11} className="pointer-events-none absolute right-1.5 text-faint" />
          </div>
          <button
            type="button"
            onClick={() => setModelsOpen(true)}
            className="chip !h-7 !px-2 !text-[10px] hover:border-accent hover:text-accent cursor-pointer"
            title="Manage Models & Providers"
          >
            Manage
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {empty ? (
          <WelcomeScreen
            isAgent={isAgent}
            agentMode={agentMode}
            project={project}
            selectedModel={selectedModel}
            chatSuggestions={chatSuggestions}
            agentTemplates={AGENT_TEMPLATES}
            onOpenModels={() => setModelsOpen(true)}
            onSendChat={(text) => void sendChat(text)}
            onSetInput={setInput}
          />
        ) : (
          <div className="flex flex-col gap-3">{timeline}</div>
        )}

        {chatError ? (
          <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-2.5 py-2 text-[11px] leading-relaxed text-danger">
            {chatError}
          </div>
        ) : null}

        {/* Agent task confirmation card — shown after the user submits in agent mode */}
        {pendingTask ? (
          <AgentConfirmCard
            task={pendingTask}
            agentMode={agentMode}
            onPlanFirst={() => launchAgent(pendingTask, agentMode, true)}
            onExecute={() => launchAgent(pendingTask, agentMode, false)}
            onCancel={() => {
              setPendingTask(null);
              setInput(pendingTask);
            }}
          />
        ) : null}

        <div ref={bottomRef} className="h-1" />
      </div>

      <div className="border-t border-line-soft bg-panel px-2 pb-2 pt-1.5">
        {contextFiles.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {contextFiles.map((path) => (
              <span key={path} className="chip chip-accent max-w-full !h-[19px] !text-[9.5px]" title={path}>
                <Paperclip size={9} />
                <span className="max-w-[150px] truncate">{path.split('/').pop()}</span>
                <button
                  type="button"
                  onClick={() => removeContextFile(path)}
                  className="ml-0.5 rounded-sm text-accent/70 hover:text-fg"
                  aria-label={`Remove ${path}`}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="rounded-lg border border-line bg-bg-elevated focus-within:border-accent">
          <div className="flex items-center gap-1 px-1.5 pt-1.5">
            <div className="flex rounded-md bg-panel-2 p-0.5" role="tablist" aria-label="Message mode">
              <button
                type="button"
                role="tab"
                aria-selected={!isAgent}
                disabled={busy}
                onClick={() => setComposerMode('chat')}
                className={cn(
                  'focus-ring flex h-6 items-center gap-1 rounded px-2 text-[10.5px] transition-colors disabled:opacity-50',
                  !isAgent ? 'bg-accent text-white' : 'text-muted hover:text-fg',
                )}
                title="Ask the model a question"
              >
                <MessageSquare size={10} /> Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isAgent}
                disabled={busy}
                onClick={() => setComposerMode('agent')}
                className={cn(
                  'focus-ring flex h-6 items-center gap-1 rounded px-2 text-[10.5px] transition-colors disabled:opacity-50',
                  isAgent ? 'bg-accent text-white' : 'text-muted hover:text-fg',
                )}
                title="Give an agent a task it can execute"
              >
                <Bot size={10} /> Agent
              </button>
            </div>

            {isAgent ? (
              <>
                <div
                  className={cn(
                    'relative h-6 w-[104px] shrink-0 rounded-md border border-line bg-panel-2 focus-within:border-accent',
                    busy && 'opacity-50',
                  )}
                >
                  <div className="pointer-events-none flex h-full items-center justify-between gap-1 pl-2 pr-1.5">
                    <span className="truncate text-[10.5px] font-medium text-fg">
                      {AGENT_OPTIONS.find((option) => option.kind === agentMode)?.label ?? agentMode}
                    </span>
                    <ChevronDown size={10} className="shrink-0 text-faint" />
                  </div>
                  <select
                    value={agentMode}
                    onChange={(event) => setAgentMode(event.target.value as AgentKind)}
                    className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
                    title="Agent role"
                    aria-label="Agent role"
                    disabled={busy}
                  >
                    {AGENT_OPTIONS.map((option) => (
                      <option key={option.kind} value={option.kind}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label
                  className="ml-auto flex shrink-0 items-center gap-1 text-[9px] text-faint"
                  title="Maximum agent steps"
                >
                  steps
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={maxSteps}
                    disabled={busy}
                    onChange={(event) => setMaxSteps(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
                    className="h-6 w-10 rounded border border-line bg-panel-2 px-1 text-center font-mono text-[10px] text-fg"
                  />
                </label>
              </>
            ) : (
              <span className="ml-auto text-[9px] text-faint">
                {streaming && chatUsage ? `${chatUsage.promptTokens} → ${chatUsage.outputTokens} tok` : 'Enter to send'}
              </span>
            )}
          </div>

          {isAgent && !project ? (
            <p className="mx-1.5 mt-1 rounded bg-warning-soft px-1.5 py-1 text-[9.5px] text-warning">
              Open a project folder to let the agent edit files.
            </p>
          ) : null}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              isAgent
                ? runningAgent
                  ? 'Agent is working…'
                  : `Describe a ${agentOption?.label.toLowerCase() ?? 'coding'} task — the agent will execute it`
                : streaming
                  ? 'Generating answer…'
                  : 'Ask, plan, or describe a change…'
            }
            className="max-h-[180px] w-full resize-none border-0 bg-transparent px-2.5 pb-1 pt-2 text-[12px] leading-relaxed focus:shadow-none"
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <button
              type="button"
              onClick={attachActive}
              className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
              title="Attach the active file"
            >
              <Paperclip size={13} />
            </button>
            <button
              type="button"
              onClick={attachFile}
              className="focus-ring rounded px-1.5 py-0.5 text-[9.5px] text-faint hover:bg-panel-3 hover:text-fg"
              title="Attach a file by path"
            >
              Attach…
            </button>
            <span className="ml-auto text-[9px] text-faint">Shift+Enter for a new line</span>
            {busy ? (
              <button
                type="button"
                onClick={() => void (runningAgent ? cancelAgent() : cancelChat())}
                className="focus-ring flex h-6 items-center gap-1 rounded-md border border-line bg-panel-2 px-1.5 text-[10px] text-muted hover:text-fg"
                title={runningAgent ? 'Stop the agent' : 'Stop generating'}
              >
                <Square size={8} fill="currentColor" /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim() || (isAgent && !project)}
                className="focus-ring flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)] disabled:opacity-35"
                title={isAgent ? 'Start the agent' : 'Send message'}
              >
                <ArrowUp size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function isToolCallJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('{') &&
    (trimmed.includes('"name"') ||
      trimmed.includes('"arguments"') ||
      trimmed.includes('"calls"') ||
      trimmed.includes('"tool_calls"'))
  ) {
    return true;
  }
  if (
    trimmed.startsWith('```json') &&
    (trimmed.includes('"name"') || trimmed.includes('"arguments"') || trimmed.includes('"calls"'))
  ) {
    return true;
  }
  return false;
}

function MessageBubble({
  message,
  streaming,
  reasoningOpen,
  onToggleReasoning,
  onOpenFile,
}: {
  message: ChatMessage;
  streaming: boolean;
  reasoningOpen: boolean;
  onToggleReasoning: () => void;
  onOpenFile: (path: string) => void;
}) {
  if (message.role === 'system') return null;

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] whitespace-pre-wrap rounded-xl rounded-br-sm border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-accent-soft px-3 py-2 text-[12px] leading-relaxed text-fg">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'tool') {
    return (
      <div className="rounded-md border border-line-soft bg-panel-2 px-2 py-1 font-mono text-[10px] text-faint">
        tool result · {message.toolCallId ?? 'call'}
      </div>
    );
  }

  const referenced = message.content.match(/`((?:[\w.-]+\/)+[\w.-]+\.[a-z]+)`/g) ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      {message.reasoning ? (
        <div className="rounded-md border border-line-soft bg-panel-2">
          <button
            type="button"
            onClick={onToggleReasoning}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] text-faint hover:text-muted"
          >
            {reasoningOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <Brain size={10} />
            Thought process
            <span className="ml-auto text-[9px]">{message.reasoning.length} chars</span>
          </button>
          {reasoningOpen ? (
            <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap border-t border-line-soft px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted">
              {message.reasoning}
            </pre>
          ) : null}
        </div>
      ) : null}

      {message.content.trim() && !isToolCallJson(message.content) ? (
        <div className="rounded-xl rounded-bl-sm border border-line-soft bg-panel-2 px-3 py-2">
          <Markdown>{message.content}</Markdown>
        </div>
      ) : streaming ? (
        <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-faint">
          <Spinner className="!h-3 !w-3" /> Thinking…
        </div>
      ) : null}

      {message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {message.toolCalls.map((call) => (
            <span key={call.id} className="chip !text-[9.5px]">
              {call.name}
            </span>
          ))}
        </div>
      ) : null}

      {referenced.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {referenced.slice(0, 8).map((token) => {
            const path = token.slice(1, -1);
            return (
              <button
                key={path}
                type="button"
                onClick={() => onOpenFile(path)}
                className="chip !h-[17px] font-mono !text-[9px] hover:text-fg"
                title={`Open ${path}`}
              >
                {path}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome / empty-state screen
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = [
  {
    icon: <Search size={14} />,
    label: 'Explore codebase',
    tip: 'Summarize the architecture and main entry points',
    mode: 'chat' as const,
  },
  {
    icon: <Code2 size={14} />,
    label: 'Add a feature',
    tip: 'Add the feature described below and verify it with tests',
    mode: 'agent' as const,
  },
  {
    icon: <ShieldCheck size={14} />,
    label: 'Fix failing tests',
    tip: 'Find why the build or test suite fails and fix the root cause',
    mode: 'agent' as const,
  },
  {
    icon: <GitBranch size={14} />,
    label: 'Review changes',
    tip: 'Review my uncommitted changes for correctness and security risks',
    mode: 'agent' as const,
  },
  {
    icon: <FileText size={14} />,
    label: 'Generate docs',
    tip: 'Document this module for new contributors',
    mode: 'agent' as const,
  },
  {
    icon: <Zap size={14} />,
    label: 'Optimize code',
    tip: 'Check for performance bottlenecks and unnecessary re-renders',
    mode: 'agent' as const,
  },
  {
    icon: <TestTube size={14} />,
    label: 'Write tests',
    tip: 'Add focused tests for every exported function',
    mode: 'agent' as const,
  },
  {
    icon: <Sparkles size={14} />,
    label: 'Plan feature',
    tip: 'Break this feature into safe, ordered implementation steps',
    mode: 'agent' as const,
  },
];

function WelcomeScreen({
  isAgent,
  agentMode,
  project,
  selectedModel,
  chatSuggestions,
  agentTemplates,
  onOpenModels,
  onSendChat,
  onSetInput,
}: {
  isAgent: boolean;
  agentMode: AgentKind;
  project: { name?: string } | null;
  selectedModel: { model: string; providerId: string } | null;
  chatSuggestions: string[];
  agentTemplates: Partial<Record<AgentKind, string[]>>;
  onOpenModels: () => void;
  onSendChat: (text: string) => void;
  onSetInput: (text: string) => void;
}) {
  const modelLabel = selectedModel?.model
    ? (selectedModel.model.split(':')[0]?.split('/')?.pop() ?? selectedModel.model)
    : null;

  return (
    <div className="flex flex-col items-center gap-4 px-3 pb-4 pt-6">
      {/* Hero */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Bot size={26} />
        </div>
        <h2 className="text-[14px] font-semibold tracking-tight text-fg">
          {isAgent ? 'ForgeAI Agent' : 'ForgeAI Chat'}
        </h2>
        <p className="max-w-[300px] text-[10.5px] leading-relaxed text-faint">
          {isAgent
            ? project
              ? 'Give the agent a goal — it plans, reads code, proposes diffs and verifies the result.'
              : 'Open a project folder so the agent can read files, propose diffs and run commands.'
            : project
              ? 'Ask anything about your code. Answers are grounded in your workspace and codebase index.'
              : 'Open a project for full codebase context, or ask any coding question right now.'}
        </p>
        {modelLabel ? (
          <button
            type="button"
            onClick={onOpenModels}
            className="mt-0.5 flex items-center gap-1 rounded-full border border-accent/30 bg-accent/8 px-2 py-0.5 text-[9.5px] font-medium text-accent hover:border-accent hover:bg-accent/15 transition-colors cursor-pointer"
            title="Click to change or configure models"
          >
            <Zap size={9} />
            {modelLabel}
          </button>
        ) : null}
      </div>

      {/* Suggestions / agent templates */}
      {isAgent ? (
        <div className="w-full max-w-[380px]">
          <p className="mb-1.5 text-[9.5px] font-medium uppercase tracking-wider text-faint">Quick starts</p>
          <div className="grid gap-1.5">
            {(agentTemplates[agentMode] ?? []).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSetInput(suggestion)}
                className="focus-ring rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-left text-[10.5px] leading-snug text-muted hover:border-accent/40 hover:bg-panel-3 hover:text-fg"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="w-full max-w-[380px]">
          <p className="mb-1.5 text-[9.5px] font-medium uppercase tracking-wider text-faint">Suggestions</p>
          <div className="grid gap-1.5">
            {chatSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSendChat(suggestion)}
                className="focus-ring rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-left text-[10.5px] leading-snug text-muted hover:border-accent/40 hover:bg-panel-3 hover:text-fg"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick-action grid */}
      <div className="w-full max-w-[380px]">
        <p className="mb-1.5 text-[9.5px] font-medium uppercase tracking-wider text-faint">Common tasks</p>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => (action.mode === 'chat' ? onSendChat(action.tip) : onSetInput(action.tip))}
              className="focus-ring flex items-center gap-2 rounded-md border border-line-soft bg-panel-2 px-2.5 py-2 text-left text-[10px] text-muted hover:border-accent/40 hover:bg-panel-3 hover:text-fg"
            >
              <span className="shrink-0 text-accent/70">{action.icon}</span>
              <span className="truncate font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Free Models & Claude Guide */}
      <div className="w-full max-w-[380px] rounded-lg border border-accent/30 bg-accent/5 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
            <Sparkles size={13} /> Free Models &amp; Claude
          </p>
          <button
            type="button"
            onClick={onOpenModels}
            className="btn !h-5 !px-2 !text-[9.5px] border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
          >
            Manage Models
          </button>
        </div>
        <p className="mb-2 text-[10px] leading-relaxed text-muted">
          Use high-performance local AI or free cloud models without paying for subscriptions:
        </p>
        <ul className="flex flex-col gap-1 text-[9.5px] text-faint">
          <li>
            <strong className="text-fg">sopu-coder (7B) &amp; fast (4B)</strong>: 100% free, private, offline Apple
            Silicon optimized inference.
          </li>
          <li>
            <strong className="text-fg">Claude 3.5 Sonnet / Haiku</strong>: Connect via OpenRouter or Anthropic in
            Models → Providers.
          </li>
          <li>
            <strong className="text-fg">Free Cloud Models</strong>: OpenRouter (
            <code className="font-mono text-fg">:free</code> endpoints for DeepSeek R1/V3, Llama 3.3 70B) &amp; Groq
            (500+ tok/s).
          </li>
        </ul>
      </div>

      {/* Git onboarding + custom model training info */}
      <div className="w-full max-w-[380px] rounded-lg border border-line-soft bg-panel-2 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-fg">
          <GitBranch size={13} className="text-accent" /> Git &amp; Custom Model Setup
        </p>
        <div className="flex flex-col gap-2 text-[9.5px] text-faint">
          <div>
            <p className="font-semibold text-muted">New to Git?</p>
            <p className="leading-relaxed">
              Run <code className="rounded bg-panel-3 px-1 font-mono text-fg">git init</code> in the terminal, then open
              the Source Control panel (⌘⇧G). After your first commit the branch, staged changes and history all update
              in real time.
            </p>
          </div>
          <div>
            <p className="font-semibold text-muted">First-time install (yarn/npm/pip)?</p>
            <p className="leading-relaxed">
              Run the install command in the terminal. The file tree and SCM panel refresh automatically once the
              command completes — no manual refresh needed.
            </p>
          </div>
          <div>
            <p className="font-semibold text-muted">Train your own Sopu model</p>
            <p className="leading-relaxed">
              Run <code className="rounded bg-panel-3 px-1 font-mono text-fg">yarn export-data</code> to export
              conversation training data, then{' '}
              <code className="rounded bg-panel-3 px-1 font-mono text-fg">yarn train:lora</code> to fine-tune. Publish
              with{' '}
              <code className="rounded bg-panel-3 px-1 font-mono text-fg">ollama create my-model -f Modelfile</code> and
              select it in the model picker. The model is saved alongside Git history and shared with your team via{' '}
              <code className="rounded bg-panel-3 px-1 font-mono text-fg">git push</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="w-full max-w-[380px] rounded-md border border-line-soft bg-panel-2 px-3 py-2.5">
        <p className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-faint">Tips &amp; Shortcuts</p>
        <ul className="flex flex-col gap-1 text-[9.5px] leading-relaxed text-faint">
          <li>
            <span className="text-muted">⌘K ⌘S</span> — open Keyboard Shortcuts settings
          </li>
          <li>
            <span className="text-muted">⌘⌥N</span> — new AI conversation
          </li>
          <li>
            <span className="text-muted">⌘K</span> — inline AI code edit
          </li>
          <li>
            <span className="text-muted">Shift+Enter</span> — multi-line input
          </li>
          <li>
            <span className="text-muted">📎 Attach</span> — pin any file to the prompt
          </li>
          <li>
            <span className="text-muted">Agent mode</span> — autonomous edits, test execution and file verification
          </li>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent task confirmation card — shown before the agent executes
// ---------------------------------------------------------------------------

const AGENT_LABEL: Record<AgentKind, string> = {
  coding: 'Coding',
  planner: 'Planner',
  frontend: 'Frontend',
  animation: 'Animation',
  backend: 'Backend',
  debugging: 'Debugging',
  testing: 'Testing',
  review: 'Review',
  docs: 'Docs',
  seo: 'SEO',
};

function AgentConfirmCard({
  task,
  agentMode,
  onPlanFirst,
  onExecute,
  onCancel,
}: {
  task: string;
  agentMode: AgentKind;
  onPlanFirst: () => void;
  onExecute: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-accent/5 shadow-xs">
      <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/8 px-3 py-2">
        <Bot size={13} className="shrink-0 text-accent" />
        <span className="text-[11.5px] font-semibold text-accent">Ready to run {AGENT_LABEL[agentMode]} Agent</span>
      </div>
      <div className="px-3 py-2.5">
        <p className="rounded-md bg-panel-2 px-2.5 py-2 text-[11.5px] leading-relaxed text-fg border border-line-soft">
          {task}
        </p>
        <p className="mt-2 text-[10px] leading-relaxed text-faint">
          The agent will read files, propose diffs and may run commands. Every write and shell command requires your
          explicit approval.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary flex-1 !text-[11px] cursor-pointer"
            onClick={onExecute}
            title="Start the agent immediately"
          >
            <Bot size={11} /> Execute now
          </button>
          <button
            type="button"
            className="btn flex-1 !text-[11px] cursor-pointer border-accent/40 text-accent hover:bg-accent/10"
            onClick={onPlanFirst}
            title="Run the Planner agent first to produce an implementation plan"
          >
            <Brain size={11} /> Plan first
          </button>
          <button
            type="button"
            className="btn !h-7 !px-2 !text-[10px] text-faint hover:text-fg cursor-pointer"
            onClick={onCancel}
            title="Edit the task"
          >
            Edit
          </button>
        </div>
        <p className="mt-1.5 text-[9px] text-faint text-center">
          <strong className="text-muted">Plan first</strong> runs a read-only Planner that maps out files and steps
          before any edits are made.
        </p>
      </div>
    </div>
  );
}
