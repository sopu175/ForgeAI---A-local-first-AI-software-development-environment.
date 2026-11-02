import { useState } from 'react';
import {
  Bot,
  BookText,
  Bug,
  ChevronRight,
  FlaskConical,
  ListTree,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
} from 'lucide-react';
import type { AgentKind } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { cn, EmptyState, Spinner } from '../ui';
import { relativeTime } from '../../lib/format';

interface AgentProfile {
  kind: AgentKind;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  examples: string[];
}

const AGENTS: AgentProfile[] = [
  {
    kind: 'coding',
    title: 'Coding',
    blurb: 'Implements features and fixes. Plans steps, edits files with diff approval, and verifies with commands.',
    icon: <Sparkles size={15} />,
    examples: [
      'Add pagination to the users list API and wire the UI controls',
      'Refactor the checkout service to accept multiple payment methods',
    ],
  },
  {
    kind: 'planner',
    title: 'Planner',
    blurb: 'Explores the codebase and produces a concrete implementation plan without editing code.',
    icon: <ListTree size={15} />,
    examples: ['Plan a migration from REST controllers to service classes', 'Break down adding SSO into ordered tasks'],
  },
  {
    kind: 'debugging',
    title: 'Debugging',
    blurb: 'Reproduces failures, reads logs and stack traces, then proposes and applies the smallest safe fix.',
    icon: <Bug size={15} />,
    examples: [
      'The Laravel queue worker crashes on retry — find the root cause',
      'Next.js build fails on the dashboard route',
    ],
  },
  {
    kind: 'testing',
    title: 'Testing',
    blurb: 'Writes and runs tests, fills coverage gaps and reports the exact commands it used.',
    icon: <FlaskConical size={15} />,
    examples: [
      'Add tests for the pricing calculator including edge cases',
      'Cover the auth middleware with integration tests',
    ],
  },
  {
    kind: 'review',
    title: 'Review',
    blurb: 'Audits the working tree for correctness, security, performance and consistency. Read-only by default.',
    icon: <ShieldCheck size={15} />,
    examples: [
      'Review my uncommitted changes before I commit',
      'Look for N+1 queries and missing authorization checks',
    ],
  },
  {
    kind: 'docs',
    title: 'Docs',
    blurb: 'Writes README sections, API references and code documentation grounded in the real codebase.',
    icon: <BookText size={15} />,
    examples: ['Document the webhook endpoints and payloads', 'Add a getting-started guide for new contributors'],
  },
  {
    kind: 'seo',
    title: 'SEO',
    blurb:
      'Audits crawlability, metadata, structured data, headings, alt text and Core Web Vitals, then fixes them in the real pages.',
    icon: <Search size={15} />,
    examples: [
      'Audit the site and fix missing titles, descriptions and canonicals',
      'Add Open Graph tags and JSON-LD to every public route',
      'Generate robots.txt and a sitemap for the current routes',
    ],
  },
];

export function AgentsView() {
  const project = useAppStore((state) => state.project);
  const agentMode = useAppStore((state) => state.agentMode);
  const setAgentMode = useAppStore((state) => state.setAgentMode);
  const agentRun = useAppStore((state) => state.agentRun);
  const agentHistory = useAppStore((state) => state.agentHistory);
  const contextFiles = useAppStore((state) => state.contextFiles);
  const startAgent = useAppStore((state) => state.startAgent);
  const cancelAgent = useAppStore((state) => state.cancelAgent);
  const openAI = useAppStore((state) => state.openAI);
  const rules = useAppStore((state) => state.rules);
  const settings = useAppStore((state) => state.settings);
  const maxSteps = settings?.agent.maxSteps ?? 20;

  const [task, setTask] = useState('');
  const [maxStepsLocal, setMaxStepsLocal] = useState(maxSteps);

  const profile = AGENTS.find((entry) => entry.kind === agentMode) ?? AGENTS[0]!;
  const running = agentRun?.status === 'running';

  if (!project) {
    return (
      <EmptyState
        icon={<Bot size={22} />}
        title="Agents need a workspace"
        description="Open a project so the agents can inspect code, request permissions and verify their changes."
      />
    );
  }

  const start = () => {
    const trimmed = task.trim();
    if (!trimmed) return;
    void startAgent({
      projectId: project.id,
      task: trimmed,
      agent: profile.kind,
      maxSteps: maxStepsLocal,
      contextFiles: contextFiles.length ? contextFiles : undefined,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line-soft p-2">
        <div className="grid grid-cols-3 gap-1">
          {AGENTS.map((agent) => (
            <button
              key={agent.kind}
              type="button"
              title={agent.blurb}
              onClick={() => setAgentMode(agent.kind)}
              className={cn(
                'focus-ring flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[10.5px] transition-colors',
                agent.kind === profile.kind
                  ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft text-fg'
                  : 'border-line-soft bg-panel-2 text-muted hover:bg-panel-3 hover:text-fg',
              )}
            >
              <span className={agent.kind === profile.kind ? 'text-accent' : 'text-faint'}>{agent.icon}</span>
              {agent.title}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3 py-2.5">
          <p className="text-[11.5px] leading-relaxed text-muted">{profile.blurb}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="chip !text-[9.5px]">{maxStepsLocal} steps max</span>
            <span className="chip !text-[9.5px]">
              {rules.length} rule file{rules.length === 1 ? '' : 's'}
            </span>
            {contextFiles.length > 0 ? (
              <span className="chip chip-accent !text-[9.5px]">{contextFiles.length} attached</span>
            ) : null}
          </div>
        </div>

        <div className="px-3">
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={5}
            placeholder={`Describe the task for the ${profile.title.toLowerCase()} agent…`}
            className="w-full resize-y text-[12px] leading-relaxed"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                if (!running) start();
              }
            }}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-faint">
              Max steps
              <input
                type="number"
                min={1}
                max={60}
                value={maxStepsLocal}
                onChange={(event) => setMaxStepsLocal(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
                className="h-6 w-12 px-1 text-center font-mono text-[10.5px]"
              />
            </label>
            {running ? (
              <button
                type="button"
                className="btn btn-danger ml-auto !h-7 !text-[11px]"
                onClick={() => void cancelAgent()}
              >
                <Square size={10} fill="currentColor" /> Stop agent
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary ml-auto !h-7 !text-[11px]"
                disabled={!task.trim()}
                onClick={start}
                title="Start agent (⌘⇧↵ starts the coding agent from anywhere)"
              >
                <Play size={11} fill="currentColor" /> Start
              </button>
            )}
          </div>
        </div>

        {agentRun ? (
          <button
            type="button"
            onClick={() => openAI('agent')}
            className="mx-3 mt-3 flex w-[calc(100%-24px)] items-start gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-2 text-left hover:bg-panel-3"
          >
            {agentRun.status === 'running' ? (
              <Spinner className="mt-0.5 !h-3 !w-3" />
            ) : (
              <Bot size={13} className="mt-0.5 text-accent" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[11px] text-fg">
                <span className="capitalize">{agentRun.agent}</span>
                <span
                  className={cn(
                    'text-[9.5px] uppercase',
                    agentRun.status === 'running'
                      ? 'text-success'
                      : agentRun.status === 'error'
                        ? 'text-danger'
                        : 'text-faint',
                  )}
                >
                  {agentRun.status}
                </span>
                <span className="ml-auto text-[9.5px] text-faint">
                  {agentRun.steps.step}/{agentRun.steps.maxSteps}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] text-muted">{agentRun.task}</span>
            </span>
            <ChevronRight size={12} className="mt-0.5 shrink-0 text-faint" />
          </button>
        ) : null}

        <div className="px-3 pb-2 pt-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
            Example {profile.title.toLowerCase()} tasks
          </p>
          <div className="grid gap-1.5">
            {profile.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setTask(example)}
                className="focus-ring rounded-md border border-line-soft bg-panel-2 px-2.5 py-2 text-left text-[11px] leading-snug text-muted hover:border-line hover:text-fg"
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        {agentHistory.length > 0 ? (
          <div className="px-3 pb-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Recent runs</p>
            {agentHistory.slice(0, 5).map((run) => (
              <button
                key={`${run.runId}:${run.startedAt}`}
                type="button"
                onClick={() => openAI('agent')}
                className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[10.5px] text-muted hover:bg-panel-2 hover:text-fg"
              >
                <span
                  className={
                    run.status === 'error' ? 'text-danger' : run.status === 'done' ? 'text-success' : 'text-faint'
                  }
                >
                  ●
                </span>
                <span className="truncate capitalize">{run.agent}</span>
                <span className="ml-auto whitespace-nowrap text-[9.5px] text-faint">{relativeTime(run.startedAt)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
