import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Eye,
  ListChecks,
  Pencil,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { SpecDocument, SpecPhase, SpecTask } from '@forgeai/shared';
import type { EditorTab } from '../state/app';
import { useAppStore } from '../state/app';
import { cn, EmptyState, Spinner, StatusDot } from './ui';
import { Markdown } from './Markdown';
import { errorMessage, relativeTime } from '../lib/format';

type Part = 'requirements' | 'design' | 'tasks';

const PART_LABEL: Record<Part, string> = {
  requirements: 'Requirements',
  design: 'Design',
  tasks: 'Tasks',
};

const PHASE_ORDER: Record<SpecPhase, number> = {
  requirements: 0,
  design: 1,
  tasks: 2,
  implementation: 3,
  done: 4,
};

export function SpecEditor({ tab }: { tab: EditorTab }) {
  const project = useAppStore((state) => state.project);
  const openFile = useAppStore((state) => state.openFile);
  const toast = useAppStore((state) => state.toast);
  const startAgent = useAppStore((state) => state.startAgent);
  const openAI = useAppStore((state) => state.openAI);
  const agentRunning = useAppStore((state) => state.agentRun?.status === 'running');
  const specVersion = useAppStore((state) => state.specVersion);

  const [doc, setDoc] = useState<SpecDocument | null>(null);
  const [part, setPart] = useState<Part>('requirements');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<SpecPhase | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const feature = tab.feature ?? '';

  const load = useCallback(async () => {
    if (!project || !feature) return;
    setLoading(true);
    try {
      const fetched = await window.forge.specs.get(project.id, feature);
      setDoc(fetched);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [feature, project]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!doc) return;
    const content = part === 'requirements' ? doc.requirements : part === 'design' ? doc.design : doc.tasks;
    setDraft(content);
    setEditing(false);
  }, [doc, part]);

  useEffect(() => {
    if (specVersion > 0 && !editing) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specVersion]);

  const content = doc ? (part === 'requirements' ? doc.requirements : part === 'design' ? doc.design : doc.tasks) : '';
  const approved = doc ? doc.meta.approvals[part] : false;
  const partUnlocked = useMemo(() => {
    if (!doc) return false;
    if (part === 'requirements') return true;
    if (part === 'design') return doc.meta.approvals.requirements || doc.requirements.trim().length > 0;
    return doc.meta.approvals.design || doc.design.trim().length > 0;
  }, [doc, part]);

  const generate = async (target: Part) => {
    if (!project) return;
    setGenerating(target);
    try {
      const updated = await window.forge.specs.generate(project.id, feature, target);
      setDoc(updated);
      setPart(target);
      toast('success', `${PART_LABEL[target]} generated — review and approve it.`);
    } catch (caught) {
      toast('error', errorMessage(caught));
    } finally {
      setGenerating(null);
    }
  };

  const save = async () => {
    if (!project) return;
    setBusy('save');
    try {
      const updated = await window.forge.specs.update(project.id, feature, part, draft);
      setDoc(updated);
      setEditing(false);
      toast('success', 'Spec document saved');
    } catch (caught) {
      toast('error', errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const approve = async (target: Part) => {
    if (!project) return;
    setBusy(`approve:${target}`);
    try {
      const updated = await window.forge.specs.approve(project.id, feature, target);
      setDoc(updated);
      toast('success', `${PART_LABEL[target]} approved.`);
      if (target === 'requirements') setPart('design');
      else if (target === 'design') setPart('tasks');
    } catch (caught) {
      toast('error', errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const setTaskStatus = async (task: SpecTask, status: SpecTask['status']) => {
    if (!project) return;
    setBusy(`task:${task.id}`);
    try {
      await window.forge.specs.updateTask(project.id, feature, task.id, { status });
      await load();
    } catch (caught) {
      toast('error', errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const runTask = (task: SpecTask) => {
    if (!project) return;
    const taskText = [
      `Implement spec task ${task.id}: ${task.title}`,
      '',
      task.details,
      task.files.length ? `\nLikely files:\n${task.files.map((file) => `- ${file}`).join('\n')}` : '',
      task.acceptance.length ? `\nAcceptance criteria:\n${task.acceptance.map((item) => `- ${item}`).join('\n')}` : '',
    ]
      .join('\n')
      .trim();
    void startAgent({
      projectId: project.id,
      agent: 'coding',
      task: taskText,
      feature,
      specTaskId: task.id,
    });
    openAI('agent');
  };

  if (!project) {
    return <EmptyState title="Open a project to view this spec" />;
  }

  if (loading && !doc) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-faint">
        <Spinner /> Loading spec…
      </div>
    );
  }

  if (error && !doc) {
    return (
      <EmptyState
        title="Could not load spec"
        description={error}
        action={
          <button type="button" className="btn" onClick={() => void load()}>
            Retry
          </button>
        }
      />
    );
  }

  if (!doc) return null;

  const tasks = doc.meta.tasks;
  const doneTasks = tasks.filter((task) => task.status === 'done').length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-bg-elevated px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-fg-strong">{doc.meta.title}</h2>
          <p className="truncate font-mono text-[10px] text-faint">.kiro/specs/{doc.meta.feature}/</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(['requirements', 'design', 'tasks'] as Part[]).map((phase) => (
            <span
              key={phase}
              className={cn(
                'chip !h-[19px] !text-[9.5px]',
                doc.meta.approvals[phase]
                  ? 'chip-success'
                  : PHASE_ORDER[doc.meta.phase] === PHASE_ORDER[phase]
                    ? 'chip-accent'
                    : '',
              )}
              title={doc.meta.approvals[phase] ? `${phase} approved` : `${phase} not approved`}
            >
              {doc.meta.approvals[phase] ? <CheckCircle2 size={9} /> : <Circle size={9} />}
              {PART_LABEL[phase]}
            </span>
          ))}
          <span className="chip !h-[19px] !text-[9.5px] capitalize">{doc.meta.phase}</span>
          <button
            type="button"
            className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
            onClick={() => void load()}
            title="Reload spec"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-panel px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-panel-2 p-0.5">
          {(['requirements', 'design', 'tasks'] as Part[]).map((phase) => (
            <button
              key={phase}
              type="button"
              onClick={() => setPart(phase)}
              className={cn(
                'focus-ring rounded px-2 py-1 text-[11px] transition-colors',
                part === phase ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {PART_LABEL[phase]}
              {doc.meta.approvals[phase] ? <CheckCircle2 size={9} className="ml-1 inline text-success" /> : null}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {editing ? (
            <>
              <button type="button" className="btn !h-7 !text-[10.5px]" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary !h-7 !text-[10.5px]"
                disabled={busy === 'save'}
                onClick={() => void save()}
              >
                {busy === 'save' ? <Spinner className="!h-3 !w-3" /> : <Save size={11} />} Save
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn !h-7 !text-[10.5px]" onClick={() => setEditing(true)}>
                <Pencil size={11} /> Edit
              </button>
              <button
                type="button"
                className="btn !h-7 !text-[10.5px]"
                disabled={Boolean(generating) || !partUnlocked}
                onClick={() => void generate(part)}
                title={partUnlocked ? `Generate ${part} with the local plan model` : 'Approve the previous phase first'}
              >
                {generating === part ? <Spinner className="!h-3 !w-3" /> : <Wand2 size={11} className="text-accent" />}
                {content.trim() ? 'Regenerate' : 'Generate'}
              </button>
              {!approved ? (
                <button
                  type="button"
                  className="btn btn-primary !h-7 !text-[10.5px]"
                  disabled={!content.trim() || Boolean(busy) || Boolean(generating)}
                  onClick={() => void approve(part)}
                  title="Approve this phase"
                >
                  <ShieldCheck size={11} /> Approve
                </button>
              ) : (
                <span className="chip chip-success !h-7 !text-[10px]">
                  <CheckCircle2 size={10} /> Approved
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {generating ? (
          <div className="m-3 flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-[11.5px] text-muted">
            <Spinner className="!h-3 !w-3" />
            Generating {generating} with the plan model. This can take a minute on local hardware…
          </div>
        ) : null}

        {part === 'tasks' && tasks.length > 0 && !editing ? (
          <div className="p-3">
            <div className="mb-2 flex items-center gap-2 text-[10.5px] text-faint">
              <ListChecks size={11} />
              {doneTasks}/{tasks.length} tasks complete
              {doc.meta.approvals.tasks ? (
                <span className="chip chip-success !h-[18px] !text-[9px]">approved — agent may implement</span>
              ) : (
                <span className="chip chip-warning !h-[18px] !text-[9px]">approve tasks to enable implementation</span>
              )}
            </div>
            <div className="grid gap-2">
              {tasks.map((task) => {
                const statusTone =
                  task.status === 'done'
                    ? 'text-success'
                    : task.status === 'in_progress'
                      ? 'text-accent'
                      : task.status === 'failed'
                        ? 'text-danger'
                        : task.status === 'blocked'
                          ? 'text-warning'
                          : 'text-faint';
                return (
                  <div key={task.id} className="rounded-md border border-line bg-panel-2 p-2.5">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => void setTaskStatus(task, task.status === 'done' ? 'pending' : 'done')}
                        disabled={Boolean(busy)}
                        className="mt-[1px] shrink-0 text-faint hover:text-success"
                        title={task.status === 'done' ? 'Mark as pending' : 'Mark as done'}
                      >
                        {task.status === 'done' ? (
                          <CheckCircle2 size={13} className="text-success" />
                        ) : (
                          <Circle size={13} />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-faint">{task.id}</span>
                          <span className="min-w-0 flex-1 text-[12px] font-medium text-fg">{task.title}</span>
                          <span className={cn('flex items-center gap-1 text-[9.5px] uppercase', statusTone)}>
                            <StatusDot
                              tone={task.status === 'done' ? 'success' : task.status === 'failed' ? 'danger' : 'muted'}
                            />
                            {task.status}
                          </span>
                        </div>
                        {task.details ? (
                          <p className="mt-1 whitespace-pre-wrap text-[10.5px] leading-relaxed text-muted">
                            {task.details}
                          </p>
                        ) : null}
                        {task.files.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {task.files.map((file) => (
                              <button
                                key={file}
                                type="button"
                                onClick={() => void openFile(file)}
                                className="chip !h-[17px] font-mono !text-[9px] hover:text-fg"
                                title={`Open ${file}`}
                              >
                                {file}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {task.acceptance.length > 0 ? (
                          <ul className="mt-1.5 space-y-0.5">
                            {task.acceptance.map((item, index) => (
                              <li
                                key={index}
                                className="flex items-start gap-1.5 text-[10px] leading-relaxed text-faint"
                              >
                                <span className="mt-[5px] h-[3px] w-[3px] shrink-0 rounded-full bg-faint" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {task.dependsOn.length > 0 ? (
                          <p className="mt-1 text-[9.5px] text-faint">Depends on {task.dependsOn.join(', ')}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          className="btn !h-6 !px-2 !text-[9.5px]"
                          disabled={!doc.meta.approvals.tasks || agentRunning}
                          onClick={() => runTask(task)}
                          title={
                            doc.meta.approvals.tasks
                              ? 'Let the coding agent implement this task'
                              : 'Approve the task list before running agents'
                          }
                        >
                          <Play size={9} /> Run
                        </button>
                        {task.approved ? <span className="text-[8.5px] uppercase text-success">approved</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[9.5px] text-faint">
              Updated {relativeTime(doc.meta.updatedAt)} · implementation reports are appended to
              <span className="font-mono"> implementation-report.md</span>.
            </p>
          </div>
        ) : editing ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="h-full min-h-[420px] w-full resize-none rounded-none border-0 bg-bg p-4 font-mono text-[12px] leading-relaxed text-fg focus:shadow-none"
          />
        ) : content.trim() ? (
          <div className="mx-auto max-w-[860px] px-6 py-5">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <Sparkles size={20} className="mx-auto mb-2 text-faint" />
            <p className="text-[12px] text-muted">No {part} yet.</p>
            <p className="mx-auto mt-1 max-w-[360px] text-[10.5px] leading-relaxed text-faint">
              Generate this phase from the feature description, project rules and retrieved code, then review and
              approve it before moving on.
            </p>
            <button
              type="button"
              className="btn btn-primary mt-3 !h-7 !text-[11px]"
              disabled={Boolean(generating) || !partUnlocked}
              onClick={() => void generate(part)}
            >
              <Wand2 size={11} /> Generate {part}
            </button>
          </div>
        )}

        {part === 'tasks' && tasks.length > 0 && editing ? (
          <p className="px-3 py-1 text-[9.5px] text-faint">
            Editing the raw tasks markdown replaces the parsed task list after saving.
          </p>
        ) : null}
      </div>

      {!partUnlocked ? (
        <div className="border-t border-line-soft bg-warning-soft px-3 py-1.5 text-[10px] text-warning">
          <Eye size={10} className="mr-1 inline" />
          Approve {part === 'design' ? 'requirements' : 'the design'} first to unlock this phase.
        </div>
      ) : null}
    </div>
  );
}
