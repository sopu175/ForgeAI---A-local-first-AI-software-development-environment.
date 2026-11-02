import { useCallback, useEffect, useState } from 'react';
import {
  ArchiveRestore,
  Bot,
  ChevronRight,
  Clock,
  History,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { Checkpoint, FileChange } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { EmptyState, IconButton, Modal, ModalHeader, Spinner, cn } from '../ui';
import { DiffViewer } from '../DiffViewer';
import { errorMessage, pluralize, relativeTime } from '../../lib/format';

export function HistoryView() {
  const project = useAppStore((state) => state.project);
  const agentRun = useAppStore((state) => state.agentRun);
  const agentHistory = useAppStore((state) => state.agentHistory);
  const conversations = useAppStore((state) => state.conversations);
  const conversationId = useAppStore((state) => state.conversationId);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const askPrompt = useAppStore((state) => state.askPrompt);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const toast = useAppStore((state) => state.toast);
  const refreshTree = useAppStore((state) => state.refreshTree);
  const openAI = useAppStore((state) => state.openAI);

  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<{ checkpoint: Checkpoint; changes: FileChange[] } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!project) {
      setCheckpoints([]);
      return;
    }
    setLoading(true);
    try {
      setCheckpoints(await window.forge.checkpoints.list(project.id));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void reload();
  }, [reload, agentRun?.status]);

  const create = () => {
    if (!project) return;
    askPrompt({
      title: 'Create checkpoint',
      message: 'Snapshots the files the agent can modify, so you can roll back later.',
      placeholder: 'Before refactoring checkout',
      initial: `Checkpoint ${new Date().toLocaleString()}`,
      submitLabel: 'Create checkpoint',
      onSubmit: async (value) => {
        try {
          await window.forge.checkpoints.create(project.id, value.trim());
          await reload();
          toast('success', 'Checkpoint created');
        } catch (caught) {
          toast('error', errorMessage(caught));
        }
      },
    });
  };

  const showDiff = async (checkpoint: Checkpoint) => {
    if (!project) return;
    setDiffLoading(true);
    try {
      const changes = await window.forge.checkpoints.diff(project.id, checkpoint.id);
      setDiffState({ checkpoint, changes });
    } catch (caught) {
      toast('error', errorMessage(caught));
    } finally {
      setDiffLoading(false);
    }
  };

  const restore = (checkpoint: Checkpoint) => {
    if (!project) return;
    askConfirm({
      title: `Restore “${checkpoint.label}”?`,
      message:
        'Files covered by this checkpoint are rewritten to their saved contents. A rollback checkpoint is created first so the restore itself can be undone.',
      confirmLabel: 'Restore checkpoint',
      danger: true,
      action: async () => {
        setBusy(checkpoint.id);
        try {
          await window.forge.checkpoints.restore(project.id, checkpoint.id);
          await reload();
          await refreshTree();
          toast('success', 'Checkpoint restored');
        } catch (caught) {
          toast('error', errorMessage(caught));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const runs = [agentRun, ...agentHistory].filter((run): run is NonNullable<typeof run> => Boolean(run)).slice(0, 6);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line-soft px-2 py-1.5">
        <span className="pl-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">History</span>
        <div className="flex items-center">
          <IconButton label="Create checkpoint" onClick={create} disabled={!project} title="Create checkpoint">
            <Plus size={14} />
          </IconButton>
          <IconButton label="Refresh" onClick={() => void reload()} title="Refresh checkpoints">
            <RefreshCw size={12} />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
          Checkpoints
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-faint">
            <Spinner className="!h-3 !w-3" /> Loading…
          </div>
        ) : null}
        {error ? <p className="px-3 py-2 text-[11px] text-danger">{error}</p> : null}
        {!loading && checkpoints.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-faint">
            No checkpoints yet. Agents create one automatically before their first write when auto-checkpoint is
            enabled.
          </p>
        ) : null}
        {checkpoints.map((checkpoint) => (
          <div key={checkpoint.id} className="group border-b border-line-soft px-2 py-2 hover:bg-panel-2">
            <div className="flex items-start gap-1.5">
              <History size={12} className="mt-0.5 shrink-0 text-accent" />
              <button
                type="button"
                onClick={() => void showDiff(checkpoint)}
                className="min-w-0 flex-1 text-left"
                title="View differences since this checkpoint"
              >
                <p className="truncate text-[11.5px] text-fg">{checkpoint.label}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-faint">
                  <span className="uppercase">{checkpoint.kind}</span>
                  <span>·</span>
                  <span>{pluralize(checkpoint.fileCount, 'file')}</span>
                  <span>·</span>
                  <span>{relativeTime(checkpoint.createdAt)}</span>
                </p>
              </button>
              <button
                type="button"
                onClick={() => restore(checkpoint)}
                disabled={busy === checkpoint.id}
                className="focus-ring rounded p-1 text-faint opacity-0 hover:bg-panel-3 hover:text-fg group-hover:opacity-100"
                title="Restore checkpoint"
              >
                {busy === checkpoint.id ? <Spinner className="!h-3 !w-3" /> : <ArchiveRestore size={12} />}
              </button>
            </div>
          </div>
        ))}

        {runs.length > 0 ? (
          <>
            <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
              Agent runs
            </div>
            {runs.map((run) => (
              <button
                key={`${run.runId}:${run.startedAt}`}
                type="button"
                onClick={() => openAI('agent')}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-panel-2"
              >
                <Bot size={12} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-fg">{run.task}</span>
                  <span className="text-[9.5px] capitalize text-faint">
                    {run.agent} · {run.status} · {relativeTime(run.startedAt)}
                  </span>
                </span>
                <ChevronRight size={11} className="shrink-0 text-faint" />
              </button>
            ))}
          </>
        ) : null}

        <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
          Conversations
        </div>
        {conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={18} />}
            title="No conversations"
            description="Chats you start are stored locally and listed here."
          />
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1.5 hover:bg-panel-2',
                conversation.id === conversationId && 'bg-accent-soft',
              )}
            >
              <button
                type="button"
                onClick={() => void selectConversation(conversation.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title={conversation.title}
              >
                <Clock size={11} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-fg">{conversation.title || 'Untitled chat'}</span>
                  <span className="text-[9.5px] text-faint">
                    {conversation.model ? `${conversation.model} · ` : ''}
                    {relativeTime(conversation.updatedAt)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  askConfirm({
                    title: 'Delete conversation?',
                    message: 'The transcript is permanently removed from the local database.',
                    confirmLabel: 'Delete',
                    danger: true,
                    action: () => deleteConversation(conversation.id),
                  })
                }
                className="focus-ring rounded p-1 text-faint opacity-0 hover:bg-panel-3 hover:text-danger group-hover:opacity-100"
                title="Delete conversation"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        )}
      </div>

      {diffLoading ? (
        <div className="flex items-center gap-2 border-t border-line-soft px-3 py-1.5 text-[10px] text-faint">
          <Spinner className="!h-3 !w-3" /> Building diff…
        </div>
      ) : null}

      {diffState ? (
        <Modal onClose={() => setDiffState(null)} width={860}>
          <ModalHeader
            title={diffState.checkpoint.label}
            subtitle={`${diffState.changes.length} changed file(s) versus the current workspace`}
            icon={<History size={16} />}
            onClose={() => setDiffState(null)}
          />
          <div className="min-h-[200px] overflow-auto">
            <DiffViewer changes={diffState.changes} />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
            <button type="button" className="btn btn-ghost" onClick={() => setDiffState(null)}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                const checkpoint = diffState.checkpoint;
                setDiffState(null);
                restore(checkpoint);
              }}
            >
              <ArchiveRestore size={12} /> Restore this checkpoint
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
