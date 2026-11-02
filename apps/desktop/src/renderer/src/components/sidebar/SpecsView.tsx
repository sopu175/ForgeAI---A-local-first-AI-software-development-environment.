import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FileText, ListChecks, Plus, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import type { SpecDocument, SpecPhase } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { cn, EmptyState, IconButton, Spinner } from '../ui';
import { errorMessage, relativeTime, slugify } from '../../lib/format';

const PHASE_LABEL: Record<SpecPhase, string> = {
  requirements: 'Requirements',
  design: 'Design',
  tasks: 'Tasks',
  implementation: 'Implementing',
  done: 'Done',
};

const PHASE_TONE: Record<SpecPhase, string> = {
  requirements: 'chip',
  design: 'chip chip-accent',
  tasks: 'chip chip-warning',
  implementation: 'chip chip-success',
  done: 'chip chip-success',
};

export function SpecsView() {
  const project = useAppStore((state) => state.project);
  const specVersion = useAppStore((state) => state.specVersion);
  const newSpecSignal = useAppStore((state) => state.newSpecSignal);
  const openSpecTab = useAppStore((state) => state.openSpecTab);
  const askPrompt = useAppStore((state) => state.askPrompt);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const toast = useAppStore((state) => state.toast);

  const [specs, setSpecs] = useState<SpecDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!project) {
      setSpecs([]);
      return;
    }
    setLoading(true);
    try {
      setSpecs(await window.forge.specs.list(project.id));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void reload();
  }, [reload, specVersion]);

  const createSpec = useCallback(() => {
    if (!project) {
      toast('info', 'Open a project folder before creating a spec.');
      return;
    }
    askPrompt({
      title: 'New feature spec',
      message: 'Describe the feature. ForgeAI writes requirements, design and a task plan into .kiro/specs/.',
      placeholder: 'Email magic-link authentication for existing users',
      submitLabel: 'Create spec',
      onSubmit: async (value) => {
        const description = value.trim();
        if (description.length < 8) {
          toast('info', 'Describe the feature in a little more detail.');
          return;
        }
        const feature = slugify(description) || `feature-${Date.now().toString(36)}`;
        try {
          const spec = await window.forge.specs.create(project.id, feature, description);
          await reload();
          openSpecTab(spec.meta.feature, spec.meta.title);
          toast('success', 'Spec created — generate the requirements next.');
        } catch (caught) {
          toast('error', errorMessage(caught));
        }
      },
    });
  }, [askPrompt, openSpecTab, project, reload, toast]);

  useEffect(() => {
    if (newSpecSignal > 0) createSpec();
    // Only react to explicit new-spec requests, not to project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSpecSignal]);

  const remove = (spec: SpecDocument) => {
    if (!project) return;
    askConfirm({
      title: `Delete spec “${spec.meta.title}”?`,
      message: 'This removes the feature folder from .kiro/specs and cannot be undone.',
      confirmLabel: 'Delete spec',
      danger: true,
      action: async () => {
        try {
          await window.forge.specs.remove(project.id, spec.meta.feature);
          await reload();
          toast('success', 'Spec deleted');
        } catch (caught) {
          toast('error', errorMessage(caught));
        }
      },
    });
  };

  if (!project) {
    return (
      <EmptyState
        icon={<ScrollText size={22} />}
        title="Specs need a workspace"
        description="Open a project to plan features with Kiro-style requirements, design and task documents."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line-soft px-2 py-1.5">
        <span className="pl-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Spec-driven</span>
        <div className="flex items-center">
          <IconButton label="New spec" onClick={createSpec} title="New spec">
            <Plus size={14} />
          </IconButton>
          <IconButton label="Refresh specs" onClick={() => void reload()} title="Refresh specs">
            <RefreshCw size={12} />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && specs.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-faint">
            <Spinner className="!h-3 !w-3" /> Loading specs…
          </div>
        ) : null}
        {error ? <p className="px-3 py-2 text-[11px] text-danger">{error}</p> : null}
        {!loading && specs.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="No specs yet"
            description="Turn a feature idea into a reviewed requirements doc, technical design and ordered task list before the agent writes code."
            action={
              <button type="button" className="btn btn-primary" onClick={createSpec}>
                <Plus size={12} /> New spec
              </button>
            }
          />
        ) : null}

        {specs.map((spec) => {
          const done = spec.meta.tasks.filter((task) => task.status === 'done').length;
          const total = spec.meta.tasks.length;
          const approved = Object.values(spec.meta.approvals).filter(Boolean).length;
          return (
            <div key={spec.meta.feature} className="group border-b border-line-soft px-2 py-2 hover:bg-panel-2">
              <div className="flex items-start gap-1.5">
                <button
                  type="button"
                  onClick={() => openSpecTab(spec.meta.feature, spec.meta.title)}
                  className="min-w-0 flex-1 text-left"
                  title={`Open ${spec.meta.feature}`}
                >
                  <div className="flex items-center gap-1.5">
                    <ScrollText size={12} className="shrink-0 text-accent" />
                    <span className="truncate text-[12px] font-medium text-fg">{spec.meta.title}</span>
                    <ChevronRight
                      size={11}
                      className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                  <p className="mt-0.5 line-clamp-2 pl-[18px] text-[10.5px] leading-relaxed text-faint">
                    {spec.meta.description}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => remove(spec)}
                  className="focus-ring rounded p-1 text-faint opacity-0 hover:bg-panel-3 hover:text-danger group-hover:opacity-100"
                  title="Delete spec"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[18px]">
                <span className={cn(PHASE_TONE[spec.meta.phase], '!h-[18px] !text-[9.5px]')}>
                  {PHASE_LABEL[spec.meta.phase]}
                </span>
                {total > 0 ? (
                  <span className="chip !h-[18px] !text-[9.5px]">
                    <ListChecks size={9} /> {done}/{total} tasks
                  </span>
                ) : null}
                <span className="chip !h-[18px] !text-[9.5px]">{approved}/3 approved</span>
                <span className="ml-auto text-[9.5px] text-faint">{relativeTime(spec.meta.updatedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line-soft px-3 py-2 text-[10px] leading-relaxed text-faint">
        Specs live in <code className="font-mono">.kiro/specs/&lt;feature&gt;/</code>. Each phase must be approved
        before the agent implements its tasks.
      </div>
    </div>
  );
}
