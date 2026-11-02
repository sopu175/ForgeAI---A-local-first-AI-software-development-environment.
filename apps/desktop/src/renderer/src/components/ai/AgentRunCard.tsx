import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileDiff,
  Square,
  Timer,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import type { AgentEvent } from '@forgeai/shared';
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
        'overflow-hidden rounded-xl border bg-bg-elevated',
        running
          ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)]'
          : run.status === 'error'
            ? 'border-[color-mix(in_srgb,var(--danger)_35%,transparent)]'
            : 'border-line',
      )}
      aria-label={`${run.agent} agent run`}
    >
      <div className="flex items-center gap-2 border-b border-line-soft bg-panel-2/60 px-2.5 py-1.5">
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
          <p className="truncate text-[11px] capitalize text-fg">
            {run.agent} agent
            <span className="ml-1.5 text-[9.5px] normal-case text-faint">{run.status}</span>
          </p>
          <p className="truncate text-[9px] text-faint">
            {run.model ?? 'resolving model'} · step {run.steps.step}/{run.steps.maxSteps} ·{' '}
            {formatDuration(Math.max(0, elapsed))}
          </p>
        </div>
        {running ? (
          <button
            type="button"
            className="btn btn-danger !h-6 !px-2 !text-[10px]"
            onClick={onStop}
            title="Stop the agent"
          >
            <Square size={9} fill="currentColor" /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
            onClick={onDismiss}
            title="Remove this run from the conversation"
            aria-label="Dismiss agent run"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="px-2.5 py-2">
        <p className="text-[10.5px] leading-relaxed text-muted">{run.task}</p>
        <div className="mt-1.5">
          <ProgressBar value={progress} tone={run.status === 'error' ? 'warning' : running ? 'accent' : 'success'} />
        </div>

        <div className="mt-2">
          <AgentTimeline events={run.events} running={running} />
        </div>

        {run.status === 'error' && run.error ? (
          <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-2.5 py-2 text-[11px] leading-relaxed text-danger">
            <AlertTriangle size={11} className="mr-1 inline" />
            {run.error}
          </div>
        ) : null}

        {run.report ? (
          <div className="mt-2 rounded-md border border-line-soft bg-panel-2 p-2.5">
            <div className="flex items-center gap-1.5">
              <FileDiff size={12} className="text-accent" />
              <span className="text-[11px] font-medium text-fg">Run report</span>
              <span className="ml-auto text-[9.5px] text-faint">
                {run.report.cancelled ? 'cancelled' : 'completed'} · {formatDuration(run.report.durationMs)}
              </span>
            </div>
            <Markdown className="mt-1.5 text-[11px]">{run.report.summary || '_No summary provided._'}</Markdown>
            {run.report.filesChanged.length > 0 ? (
              <div className="mt-2">
                <p className="text-[9.5px] uppercase tracking-wide text-faint">Files changed</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {run.report.filesChanged.map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => onOpenFile(path)}
                      className="chip !h-[18px] font-mono !text-[9px] hover:text-fg"
                      title={path}
                    >
                      {path}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {run.report.commandsRun.length > 0 ? (
              <div className="mt-2">
                <p className="text-[9.5px] uppercase tracking-wide text-faint">Commands run</p>
                {run.report.commandsRun.map((command) => (
                  <code
                    key={command}
                    className="mt-1 block truncate rounded bg-bg px-1.5 py-1 font-mono text-[9.5px] text-muted"
                  >
                    $ {command}
                  </code>
                ))}
              </div>
            ) : null}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-faint">
              <span>{run.report.steps} steps</span>
              <span>
                {run.report.promptTokens} → {run.report.outputTokens} tokens
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
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10.5px] text-muted hover:bg-panel-2 hover:text-fg"
          >
            {changesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <FileDiff size={11} className="text-accent" />
            File changes · {run.changes.length}
            <span className="ml-auto text-[9.5px] text-faint">
              +{additions} −{deletions}
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

export function AgentTimeline({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const [openReasoning, setOpenReasoning] = useState<Record<number, boolean>>({});

  return (
    <div className="flex flex-col gap-1.5">
      {events.map((event, index) => {
        if (event.type === 'started') {
          return (
            <div key={index} className="flex items-center gap-1.5 px-1 text-[9.5px] text-faint">
              <Bot size={10} className="text-accent" />
              {event.agent} agent started on {event.model}
            </div>
          );
        }
        if (event.type === 'step') {
          return (
            <div key={index} className="flex items-center gap-1.5 px-1 text-[9.5px] text-faint">
              <CircleDot size={9} className="text-cyan" />
              Step {event.info.step} of {event.info.maxSteps}
            </div>
          );
        }
        if (event.type === 'thinking') {
          return (
            <div
              key={index}
              className="rounded-md border border-line-soft bg-panel-2 px-2 py-1 text-[10.5px] italic text-muted"
            >
              {event.text}
            </div>
          );
        }
        if (event.type === 'reasoning') {
          const open = openReasoning[index] ?? false;
          return (
            <div key={index} className="rounded-md border border-line-soft bg-panel-2">
              <button
                type="button"
                onClick={() => setOpenReasoning((current) => ({ ...current, [index]: !open }))}
                className="flex w-full items-center gap-1 px-2 py-1 text-left text-[9.5px] text-faint hover:text-muted"
              >
                {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                <Brain size={9} /> reasoning · {event.text.length} chars
              </button>
              {open ? (
                <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap border-t border-line-soft px-2 py-1 font-mono text-[9.5px] leading-relaxed text-muted">
                  {event.text}
                </pre>
              ) : null}
            </div>
          );
        }
        if (event.type === 'assistant') {
          if (!event.text.trim()) return null;
          return (
            <div key={index} className="rounded-md border border-line-soft bg-panel-2 px-2.5 py-1.5">
              <Markdown className="text-[11px]">{event.text}</Markdown>
            </div>
          );
        }
        if (event.type === 'tool_call') {
          const args = JSON.stringify(event.call.arguments);
          return (
            <div
              key={index}
              className="rounded-md border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-accent-soft px-2 py-1"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-fg">
                <Wrench size={10} className="text-accent" />
                <span className="font-mono">{event.call.name}</span>
              </div>
              {args.length > 4 ? (
                <p className="mt-0.5 truncate font-mono text-[9px] text-faint" title={args}>
                  {args}
                </p>
              ) : null}
            </div>
          );
        }
        if (event.type === 'tool_result') {
          return (
            <div key={index} className="flex items-start gap-1.5 px-1 text-[9.5px]">
              {event.ok ? (
                <CheckCircle2 size={10} className="mt-[2px] shrink-0 text-success" />
              ) : (
                <XCircle size={10} className="mt-[2px] shrink-0 text-danger" />
              )}
              <span className="min-w-0">
                <span className="font-mono text-muted">{event.name}</span>
                <span className="block truncate text-faint" title={event.preview}>
                  {event.preview}
                </span>
              </span>
            </div>
          );
        }
        if (event.type === 'file_change') {
          return (
            <div key={index} className="flex items-center gap-1.5 px-1 text-[9.5px]">
              <FileDiff size={10} className="text-warning" />
              <span className="truncate font-mono text-muted">{event.change.path}</span>
              <span className="ml-auto shrink-0 text-success">+{event.change.additions}</span>
              <span className="shrink-0 text-danger">−{event.change.deletions}</span>
            </div>
          );
        }
        if (event.type === 'usage') {
          return (
            <div key={index} className="flex items-center gap-1.5 px-1 text-[9px] text-faint">
              <Timer size={9} /> {event.promptTokens} prompt → {event.outputTokens} output tokens
            </div>
          );
        }
        if (event.type === 'error') {
          return (
            <div
              key={index}
              className="rounded-md border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-soft px-2 py-1 text-[10px] text-danger"
            >
              {event.message}
            </div>
          );
        }
        if (event.type === 'done') {
          return (
            <div key={index} className="flex items-center gap-1.5 px-1 text-[9.5px] text-success">
              <CheckCircle2 size={10} /> Agent finished
            </div>
          );
        }
        if (event.type === 'cancelled') {
          return (
            <div key={index} className="flex items-center gap-1.5 px-1 text-[9.5px] text-warning">
              <Square size={9} /> Run cancelled
            </div>
          );
        }
        return null;
      })}
      {running ? (
        <div className="flex items-center gap-1.5 px-1 py-1 text-[9.5px] text-faint">
          <Spinner className="!h-2.5 !w-2.5" /> waiting for the model…
        </div>
      ) : null}
    </div>
  );
}
