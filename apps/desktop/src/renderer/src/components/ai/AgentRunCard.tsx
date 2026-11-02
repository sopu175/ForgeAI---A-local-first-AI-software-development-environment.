import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Compass,
  Copy,
  ExternalLink,
  FileCode2,
  FileDiff,
  FilePlus2,
  FolderTree,
  PenTool,
  Search,
  Square,
  Terminal,
  Timer,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import type { AgentEvent, ChatToolCall, FileChange } from '@forgeai/shared';
import type { AgentRunState } from '../../state/app';
import { cn, ProgressBar, Spinner } from '../ui';
import { Markdown } from '../Markdown';
import { DiffViewer } from '../DiffViewer';
import { formatDuration, relativeTime } from '../../lib/format';

/**
 * One agent run rendered inline in the unified conversation. It keeps the
 * full tool/reasoning timeline, report and change list, so switching to Chat
 * mode never hides what the agent did.
 */
export function AgentRunCard({
  run,
  onStop,
  onDismiss,
  onOpenFile,
}: {
  run: AgentRunState;
  onStop: () => void;
  onDismiss: () => void;
  onOpenFile: (path: string) => void;
}) {
  const running = run.status === 'running';
  const [now, setNow] = useState(Date.now());
  const [changesOpen, setChangesOpen] = useState(false);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const elapsed = running ? now - run.startedAt : run.report ? run.report.durationMs : now - run.startedAt;
  const progress = Math.min(100, Math.round((run.steps.step / Math.max(1, run.steps.maxSteps)) * 100));
  const additions = run.changes.reduce((sum, change) => sum + change.additions, 0);
  const deletions = run.changes.reduce((sum, change) => sum + change.deletions, 0);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border bg-bg-elevated shadow-xs transition-all',
        running
          ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)]'
          : run.status === 'error'
            ? 'border-[color-mix(in_srgb,var(--danger)_35%,transparent)]'
            : 'border-line',
      )}
      aria-label={`${run.agent} agent run`}
    >
      <div className="flex items-center gap-2 border-b border-line-soft bg-panel-2/70 px-2.5 py-1.5 backdrop-blur-sm">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            running
              ? 'bg-accent-soft text-accent'
              : run.status === 'done'
                ? 'bg-success-soft text-success'
                : run.status === 'error'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-panel-3 text-faint',
          )}
        >
          {running ? (
            <Spinner className="!h-3 !w-3" />
          ) : run.status === 'done' ? (
            <CheckCircle2 size={12} />
          ) : (
            <XCircle size={12} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium capitalize text-fg">
            {run.agent} agent
            <span
              className={cn(
                'ml-1.5 rounded-full px-1.5 py-0.2 text-[9px] font-normal uppercase tracking-wider',
                running
                  ? 'bg-accent/10 text-accent'
                  : run.status === 'done'
                    ? 'bg-success/10 text-success'
                    : 'bg-panel-3 text-faint',
              )}
            >
              {run.status}
            </span>
          </p>
          <p className="truncate text-[9px] text-faint">
            {run.model ?? 'resolving model'} · step {run.steps.step}/{run.steps.maxSteps} ·{' '}
            {formatDuration(Math.max(0, elapsed))}
          </p>
        </div>
        {running ? null : (
          <button
            type="button"
            className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg cursor-pointer"
            onClick={onDismiss}
            title="Remove this run from the conversation"
            aria-label="Dismiss agent run"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Prominent live-running banner */}
      {running ? (
        <div className="flex items-center gap-2 border-b border-accent/25 bg-accent/8 px-2.5 py-2">
          <Spinner className="!h-3.5 !w-3.5 text-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-accent">Agent is working…</p>
            <p className="text-[9.5px] text-accent/70">
              Step {run.steps.step} of {run.steps.maxSteps} · {formatDuration(Math.max(0, elapsed))}
              {run.model ? ` · ${run.model.split(':')[0]?.split('/')?.pop() ?? run.model}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger !h-6 !px-2.5 !text-[10px] cursor-pointer shrink-0"
            onClick={onStop}
            title="Stop the agent"
          >
            <Square size={9} fill="currentColor" /> Stop
          </button>
        </div>
      ) : null}

      <div className="px-2.5 py-2">
        <p className="text-[11px] leading-relaxed font-medium text-fg">{run.task}</p>
        <div className="mt-1.5">
          <ProgressBar value={progress} tone={run.status === 'error' ? 'warning' : running ? 'accent' : 'success'} />
        </div>

        <div className="mt-2.5">
          <AgentTimeline events={run.events} running={running} onOpenFile={onOpenFile} />
        </div>

        {run.status === 'error' && run.error ? (
          <div className="mt-2.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft p-2.5 text-[11px] leading-relaxed text-danger">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={12} />
              Agent Encountered an Issue
            </div>
            <p className="mt-1 text-[10px] text-danger/90">{run.error}</p>
          </div>
        ) : null}

        {run.report ? (
          <div className="mt-2.5 rounded-lg border border-line-soft bg-panel-2/60 p-3">
            <div className="flex items-center gap-1.5 border-b border-line-soft pb-2">
              <FileDiff size={12} className="text-accent" />
              <span className="text-[11px] font-semibold text-fg">Run Report</span>
              <span className="ml-auto text-[9.5px] text-faint">
                {run.report.cancelled ? 'cancelled' : 'completed'} · {formatDuration(run.report.durationMs)}
              </span>
            </div>
            <Markdown className="mt-2 text-[11px] leading-relaxed">{run.report.summary || '_No summary provided._'}</Markdown>
            {run.report.filesChanged.length > 0 ? (
              <div className="mt-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-faint">Files changed</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {run.report.filesChanged.map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => onOpenFile(path)}
                      className="chip !h-[20px] font-mono !text-[9.5px] hover:border-accent hover:text-accent cursor-pointer transition-colors"
                      title={`Click to open ${path}`}
                    >
                      <FileCode2 size={10} className="text-accent shrink-0" />
                      {path}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {run.report.commandsRun.length > 0 ? (
              <div className="mt-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-faint">Commands run</p>
                {run.report.commandsRun.map((command) => (
                  <code
                    key={command}
                    className="mt-1 block truncate rounded-md bg-panel-3 px-2 py-1 font-mono text-[9.5px] text-muted border border-line-soft"
                  >
                    $ {command}
                  </code>
                ))}
              </div>
            ) : null}
            <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft/60 pt-2 text-[9.5px] text-faint">
              <span>{run.report.steps} steps</span>
              <span>
                {run.report.promptTokens} in → {run.report.outputTokens} out
              </span>
              <span className="ml-auto">{relativeTime(run.startedAt)}</span>
            </p>
          </div>
        ) : null}
      </div>

      {run.changes.length > 0 ? (
        <div className="border-t border-line-soft">
          <button
            type="button"
            onClick={() => setChangesOpen((value) => !value)}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10.5px] text-muted hover:bg-panel-2 hover:text-fg transition-colors cursor-pointer"
          >
            {changesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <FileDiff size={11} className="text-accent" />
            File changes · {run.changes.length}
            <span className="ml-auto font-mono text-[9.5px] text-faint">
              <span className="text-success font-medium">+{additions}</span>{' '}
              <span className="text-danger font-medium">−{deletions}</span>
            </span>
          </button>
          {changesOpen ? (
            <div className="max-h-[46vh] overflow-auto border-t border-line-soft">
              <DiffViewer changes={run.changes} onOpenFile={onOpenFile} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Check if text is raw JSON tool envelope emitted by a model */
function isToolCallJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
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

/** Human-readable tool presentation meta */
function getToolMeta(name: string, args: Record<string, any>) {
  switch (name) {
    case 'read_file':
      return {
        icon: FileCode2,
        badgeColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
        title: 'Read File',
        detail: args.path || args.filePath || '',
        actionType: 'file',
      };
    case 'write_file':
      return {
        icon: FilePlus2,
        badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
        title: 'Create File',
        detail: args.path || args.filePath || '',
        actionType: 'file',
      };
    case 'edit_file':
    case 'patch_file':
    case 'search_replace':
      return {
        icon: PenTool,
        badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        title: 'Edit File',
        detail: args.path || args.filePath || '',
        actionType: 'file',
      };
    case 'execute_command':
    case 'run_command':
      return {
        icon: Terminal,
        badgeColor: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
        title: 'Terminal',
        detail: args.command || '',
        actionType: 'terminal',
      };
    case 'get_project_overview':
      return {
        icon: Compass,
        badgeColor: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
        title: 'Workspace Scan',
        detail: 'Analyzed project structure & stack',
        actionType: 'overview',
      };
    case 'list_directory':
      return {
        icon: FolderTree,
        badgeColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
        title: 'List Directory',
        detail: args.path || '.',
        actionType: 'dir',
      };
    case 'find_files':
    case 'search_files':
    case 'grep_code':
      return {
        icon: Search,
        badgeColor: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
        title: 'Search Codebase',
        detail: args.query || args.pattern || '',
        actionType: 'search',
      };
    default:
      return {
        icon: Wrench,
        badgeColor: 'text-accent bg-accent/10 border-accent/20',
        title: name.replace(/_/g, ' '),
        detail: Object.keys(args).length > 0 ? Object.values(args)[0] : '',
        actionType: 'tool',
      };
  }
}

/** Unified, professional action card combining tool invocation + execution result */
function ActionCard({
  call,
  result,
  fileChange,
  onOpenFile,
}: {
  call: ChatToolCall;
  result?: { ok: boolean; preview: string };
  fileChange?: FileChange;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(!result?.ok && Boolean(result));
  const [copied, setCopied] = useState(false);
  const args = (call.arguments ?? {}) as Record<string, any>;
  const meta = getToolMeta(call.name, args);

  const copyOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!result?.preview) return;
    void navigator.clipboard.writeText(result.preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line-soft bg-panel-2/90 shadow-2xs transition-all hover:border-line">
      {/* Header bar */}
      <div
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none text-[10.5px]"
      >
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px]',
            meta.badgeColor,
          )}
        >
          <meta.icon size={11} />
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="font-semibold text-fg tracking-tight">{meta.title}</span>
          {meta.detail ? (
            <span
              onClick={(e) => {
                if (meta.actionType === 'file') {
                  e.stopPropagation();
                  onOpenFile(meta.detail);
                }
              }}
              className={cn(
                'truncate font-mono text-[9.5px] text-muted',
                meta.actionType === 'file' && 'hover:text-accent hover:underline cursor-pointer',
              )}
              title={meta.detail}
            >
              {meta.detail}
            </span>
          ) : null}
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          {result ? (
            result.ok ? (
              <span className="flex items-center gap-1 rounded-full bg-success/10 border border-success/30 px-1.5 py-0.2 text-[9px] font-medium text-success">
                <Check size={9} /> Completed
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-danger/10 border border-danger/30 px-1.5 py-0.2 text-[9px] font-medium text-danger">
                <AlertCircle size={9} /> Error
              </span>
            )
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-accent/10 border border-accent/30 px-1.5 py-0.2 text-[9px] font-medium text-accent">
              <Spinner className="!h-2.5 !w-2.5" /> Working
            </span>
          )}

          {fileChange ? (
            <span className="font-mono text-[9px] text-muted">
              <span className="text-success font-medium">+{fileChange.additions}</span>{' '}
              <span className="text-danger font-medium">−{fileChange.deletions}</span>
            </span>
          ) : null}

          <span className="text-faint hover:text-fg">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        </div>
      </div>

      {/* Expandable details & preview */}
      {expanded ? (
        <div className="border-t border-line-soft bg-bg/50 px-2.5 py-2 text-[10px] space-y-2">
          {/* Action options */}
          {args.command ? (
            <div className="rounded bg-panel-3 p-1.5 font-mono text-[9.5px] text-muted flex items-center justify-between">
              <code>$ {args.command}</code>
            </div>
          ) : meta.actionType === 'file' ? (
            <div className="flex items-center justify-between text-[9.5px] text-muted">
              <span className="font-mono truncate">{meta.detail}</span>
              <button
                type="button"
                onClick={() => onOpenFile(meta.detail)}
                className="flex items-center gap-1 text-accent hover:underline cursor-pointer"
              >
                <ExternalLink size={9} /> Open in editor
              </button>
            </div>
          ) : null}

          {/* Result preview */}
          {result ? (
            <div>
              <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wider text-faint">
                <span>{result.ok ? 'Output' : 'Error details'}</span>
                {result.preview ? (
                  <button
                    type="button"
                    onClick={copyOutput}
                    className="flex items-center gap-1 text-[9px] text-faint hover:text-fg cursor-pointer"
                  >
                    {copied ? <Check size={9} className="text-success" /> : <Copy size={9} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                ) : null}
              </div>
              <pre
                className={cn(
                  'max-h-[180px] overflow-auto whitespace-pre-wrap rounded-md p-2 font-mono text-[9.5px] leading-relaxed border',
                  result.ok
                    ? 'bg-panel-3/80 text-muted border-line-soft'
                    : 'bg-danger/8 text-danger border-danger/25',
                )}
              >
                {result.preview || (result.ok ? 'Action completed successfully.' : 'No output recorded.')}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AgentTimeline({
  events,
  running,
  onOpenFile,
}: {
  events: AgentEvent[];
  running: boolean;
  onOpenFile: (path: string) => void;
}) {
  const [openReasoning, setOpenReasoning] = useState<Record<number, boolean>>({});

  // Group events into structured steps to avoid flat repetitive rows
  const structured = useMemo(() => {
    type StepData = {
      step: number;
      maxSteps: number;
      usage?: { prompt: number; output: number };
      reasonings: string[];
      prose: string[];
      actions: Array<{
        call: ChatToolCall;
        result?: { ok: boolean; preview: string };
        fileChange?: FileChange;
      }>;
      errors: string[];
    };

    const steps: StepData[] = [];
    const globalNotes: Array<{ type: string; text: string }> = [];

    const ensureStep = (): StepData => {
      let step = steps[steps.length - 1];
      if (!step) {
        step = {
          step: 1,
          maxSteps: 20,
          reasonings: [],
          prose: [],
          actions: [],
          errors: [],
        };
        steps.push(step);
      }
      return step;
    };

    for (const event of events) {
      if (event.type === 'started') {
        globalNotes.push({
          type: 'started',
          text: `${event.agent} agent started on ${event.model}`,
        });
      } else if (event.type === 'step') {
        const nextStep: StepData = {
          step: event.info.step,
          maxSteps: event.info.maxSteps,
          reasonings: [],
          prose: [],
          actions: [],
          errors: [],
        };
        steps.push(nextStep);
      } else if (event.type === 'reasoning') {
        const s = ensureStep();
        if (event.text.trim()) s.reasonings.push(event.text);
      } else if (event.type === 'assistant') {
        // Discard raw JSON tool calls so they never display as text cards
        if (!isToolCallJson(event.text)) {
          const s = ensureStep();
          s.prose.push(event.text);
        }
      } else if (event.type === 'tool_call') {
        const s = ensureStep();
        s.actions.push({ call: event.call });
      } else if (event.type === 'tool_result') {
        const s = ensureStep();
        // Match by callId if available, or attach to the most recent call
        const action =
          s.actions.find((a) => a.call.id === event.callId) ??
          s.actions[s.actions.length - 1];
        if (action) {
          action.result = { ok: event.ok, preview: event.preview };
        } else {
          // Fallback if call was somehow not paired
          s.actions.push({
            call: { id: event.callId, name: event.name, arguments: {} },
            result: { ok: event.ok, preview: event.preview },
          });
        }
      } else if (event.type === 'file_change') {
        const s = ensureStep();
        const action = s.actions.find((a) => (a.call.arguments as any)?.path === event.change.path);
        if (action) {
          action.fileChange = event.change;
        } else {
          // Standalone file change
          s.actions.push({
            call: { id: `fc_${event.change.path}`, name: 'edit_file', arguments: { path: event.change.path } },
            result: { ok: true, preview: `Modified ${event.change.path}` },
            fileChange: event.change,
          });
        }
      } else if (event.type === 'usage') {
        const s = ensureStep();
        s.usage = { prompt: event.promptTokens, output: event.outputTokens };
      } else if (event.type === 'error') {
        const s = ensureStep();
        s.errors.push(event.message);
      } else if (event.type === 'done') {
        globalNotes.push({ type: 'done', text: 'Agent finished task successfully' });
      } else if (event.type === 'cancelled') {
        globalNotes.push({ type: 'cancelled', text: 'Run was cancelled' });
      }
    }

    return { steps, globalNotes };
  }, [events]);

  return (
    <div className="flex flex-col gap-2">
      {/* Started banner */}
      {structured.globalNotes
        .filter((n) => n.type === 'started')
        .map((note, idx) => (
          <div key={`start-${idx}`} className="flex items-center gap-1.5 px-1 text-[9.5px] text-faint">
            <Bot size={11} className="text-accent" />
            <span>{note.text}</span>
          </div>
        ))}

      {/* Render Steps */}
      {structured.steps.map((stepData) => (
        <div
          key={`step-${stepData.step}`}
          className="rounded-lg border border-line-soft/80 bg-panel-1 p-2 space-y-2"
        >
          {/* Step header with token metrics */}
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5 font-medium text-fg">
              <CircleDot size={10} className="text-cyan-400" />
              <span>
                Step {stepData.step} <span className="text-faint font-normal">of {stepData.maxSteps}</span>
              </span>
            </div>

            {stepData.usage ? (
              <span
                className="flex items-center gap-1 font-mono text-[9px] text-faint bg-panel-2 rounded-full px-2 py-0.2 border border-line-soft"
                title={`${stepData.usage.prompt} prompt tokens → ${stepData.usage.output} completion tokens`}
              >
                <Timer size={8.5} />
                {(stepData.usage.prompt / 1000).toFixed(1)}k in · {stepData.usage.output} out
              </span>
            ) : null}
          </div>

          {/* Reasoning thoughts (collapsible) */}
          {stepData.reasonings.map((thought, rIdx) => {
            const key = stepData.step * 100 + rIdx;
            const open = openReasoning[key] ?? false;
            return (
              <div key={`reason-${key}`} className="rounded-md border border-line-soft bg-panel-2/60">
                <button
                  type="button"
                  onClick={() => setOpenReasoning((prev) => ({ ...prev, [key]: !open }))}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[9.5px] text-faint hover:text-muted cursor-pointer"
                >
                  {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                  <Brain size={10} className="text-accent" />
                  <span>Thought process · {thought.length} chars</span>
                </button>
                {open ? (
                  <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap border-t border-line-soft px-2 py-1.5 font-mono text-[9px] leading-relaxed text-muted">
                    {thought}
                  </pre>
                ) : null}
              </div>
            );
          })}

          {/* Assistant natural language prose */}
          {stepData.prose.map((text, pIdx) => (
            <div
              key={`prose-${pIdx}`}
              className="rounded-md border border-line-soft bg-panel-2/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-fg"
            >
              <Markdown>{text}</Markdown>
            </div>
          ))}

          {/* Step Actions (unified tool calls & results) */}
          {stepData.actions.length > 0 ? (
            <div className="space-y-1.5">
              {stepData.actions.map((act) => (
                <ActionCard
                  key={act.call.id}
                  call={act.call}
                  result={act.result}
                  fileChange={act.fileChange}
                  onOpenFile={onOpenFile}
                />
              ))}
            </div>
          ) : null}

          {/* Step errors */}
          {stepData.errors.map((err, eIdx) => (
            <div
              key={`err-${eIdx}`}
              className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-[10px] text-danger flex items-start gap-1.5"
            >
              <AlertCircle size={11} className="shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      ))}

      {/* Done or Cancelled banners */}
      {structured.globalNotes
        .filter((n) => n.type === 'done' || n.type === 'cancelled')
        .map((note, idx) => (
          <div
            key={`fin-${idx}`}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-[9.5px] font-medium border',
              note.type === 'done'
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-warning/10 border-warning/30 text-warning',
            )}
          >
            {note.type === 'done' ? <CheckCircle2 size={11} /> : <Square size={9} />}
            <span>{note.text}</span>
          </div>
        ))}

      {running ? (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-faint bg-panel-2/50 rounded-md border border-line-soft">
          <Spinner className="!h-3 !w-3 text-accent" />
          <span>Generating next step with local model…</span>
        </div>
      ) : null}
    </div>
  );
}
