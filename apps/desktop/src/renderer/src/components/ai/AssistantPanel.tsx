import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import type { AgentKind, ChatMessage } from '@forgeai/shared';
import { useAppStore, type AgentRunState } from '../../state/app';
import { cn, EmptyState, Spinner } from '../ui';
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
  coding: ['Add the feature described below and verify it', 'Fix the failing build without changing behaviour'],
  planner: ['Plan this feature and list impacted files', 'Break this refactor into safe, ordered steps'],
  debugging: ['Reproduce this bug and fix the root cause', 'Find why the build or test suite fails'],
  testing: ['Add focused tests for the selected module', 'Make this test deterministic and fast'],
  review: ['Review my uncommitted changes', 'Look for correctness and security risks in this module'],
  docs: ['Document this module for new contributors', 'Update the README for the current setup'],
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

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    if (isAgent) {
      if (!project) {
        toast('info', 'Open a project folder before starting an agent.');
        return;
      }
      setInput('');
      void startAgent({
        projectId: project.id,
        task: text,
        agent: agentMode,
        maxSteps,
        contextFiles: contextFiles.length > 0 ? contextFiles : undefined,
      });
      return;
    }
    setInput('');
    void sendChat(text);
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
      return ['Explain how this codebase is structured', 'Write a README for this project'];
    }
    return [
      'Summarize the architecture of this project and the main entry points.',
      'Where is error handling inconsistent? Point to exact files.',
      'Write a test plan for the next feature I describe.',
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
        <select
          value={conversationId ?? ''}
          onChange={(event) => {
            if (event.target.value) void selectConversation(event.target.value);
          }}
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent text-[11px] text-muted hover:border-line focus:border-accent"
          title="Conversation history"
        >
          <option value="">New conversation</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title || 'Untitled chat'}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={newChat}
          className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
          title="New conversation (⌘⌥N)"
        >
          <MessageSquarePlus size={13} />
        </button>
        <span
          className="chip !h-[18px] !text-[9.5px]"
          title={selectedModel ? `${selectedModel.providerId}/${selectedModel.model}` : 'No chat model'}
        >
          {selectedModel ? shortModelName(selectedModel.model) : 'no model'}
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {empty ? (
          <div className="pt-2">
            <EmptyState
              icon={isAgent ? <Bot size={24} /> : <Brain size={24} />}
              title={isAgent ? 'Give the agent a goal' : 'Ask about your code'}
              description={
                isAgent
                  ? project
                    ? 'The agent plans, reads code, asks your permission before commands and writes, then verifies the result. Its run appears right here in the conversation.'
                    : 'Open a project folder so an agent can read code, propose diffs and verify changes.'
                  : project
                    ? 'Answers are grounded in your workspace: project rules, attached files and semantic retrieval over the index.'
                    : 'Open a project to give the chat full context. You can still ask general programming questions.'
              }
            />
            <div className="mx-auto mt-1 grid max-w-[380px] gap-1.5">
              {(isAgent ? (AGENT_TEMPLATES[agentMode] ?? []) : chatSuggestions).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => (isAgent ? setInput(suggestion) : void sendChat(suggestion))}
                  className="focus-ring rounded-md border border-line-soft bg-panel-2 px-2.5 py-2 text-left text-[10.5px] leading-snug text-muted hover:border-line hover:text-fg"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">{timeline}</div>
        )}

        {chatError ? (
          <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-2.5 py-2 text-[11px] leading-relaxed text-danger">
            {chatError}
          </div>
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

      {message.content.trim() ? (
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
