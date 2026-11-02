import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  GitCommitHorizontal,
  Globe,
  PackagePlus,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { PermissionKind, PermissionRequest } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { Modal, cn } from './ui';
import { DiffViewer, hunkKey } from './DiffViewer';

const KIND_META: Record<PermissionKind, { label: string; icon: React.ReactNode; tone: string }> = {
  write: { label: 'File write', icon: <Wand2 size={14} />, tone: 'text-accent' },
  delete: { label: 'Delete', icon: <Trash2 size={14} />, tone: 'text-danger' },
  command: { label: 'Command', icon: <TerminalSquare size={14} />, tone: 'text-warning' },
  install: { label: 'Dependency install', icon: <PackagePlus size={14} />, tone: 'text-warning' },
  commit: { label: 'Git commit', icon: <GitCommitHorizontal size={14} />, tone: 'text-cyan' },
  network: { label: 'Network access', icon: <Globe size={14} />, tone: 'text-cyan' },
  restore: { label: 'Checkpoint restore', icon: <ShieldAlert size={14} />, tone: 'text-danger' },
};

export function PermissionModal() {
  const permissions = useAppStore((state) => state.permissions);
  const respond = useAppStore((state) => state.respondPermission);
  const request = permissions[0];

  if (!request) return null;

  return <PermissionCard key={request.id} request={request} index={1} total={permissions.length} onRespond={respond} />;
}

function PermissionCard({
  request,
  index,
  total,
  onRespond,
}: {
  request: PermissionRequest;
  index: number;
  total: number;
  onRespond: (id: string, decision: 'approved' | 'denied' | 'session', acceptedHunks?: number[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const change of request.diff ?? []) {
      for (const hunk of change.hunks) initial.add(hunkKey(change.path, hunk.index));
    }
    return initial;
  });

  useEffect(() => {
    const initial = new Set<string>();
    for (const change of request.diff ?? []) {
      for (const hunk of change.hunks) initial.add(hunkKey(change.path, hunk.index));
    }
    setSelected(initial);
  }, [request.id, request.diff]);

  const meta = KIND_META[request.kind];
  const hasDiff = Boolean(request.diff && request.diff.length > 0);
  const totalHunks = (request.diff ?? []).reduce((sum, change) => sum + change.hunks.length, 0);

  const decide = async (decision: 'approved' | 'denied' | 'session') => {
    if (busy) return;
    setBusy(decision);
    try {
      let acceptedHunks: number[] | undefined;
      if (decision !== 'denied' && hasDiff) {
        const perChange = new Map<string, number[]>();
        for (const key of selected) {
          const separator = key.lastIndexOf(':');
          const path = key.slice(0, separator);
          const hunkIndex = Number(key.slice(separator + 1));
          const list = perChange.get(path) ?? [];
          list.push(hunkIndex);
          perChange.set(path, list);
        }
        // Hunk acceptance is per file; when multiple files are touched the agent applies the
        // union of selected hunk indices for each file.
        acceptedHunks = [...new Set([...perChange.values()].flat())];
      }
      await onRespond(request.id, decision, acceptedHunks);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal onClose={() => void decide('denied')} width={hasDiff ? 940 : 560}>
      <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
        <span className={cn('mt-0.5', meta.tone)}>{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[13.5px] font-semibold text-fg-strong">{request.title}</h2>
            <span className="chip !h-[18px] !text-[9px]">{meta.label}</span>
            {request.dangerous ? (
              <span className="chip chip-danger !h-[18px] !text-[9px]">
                <AlertTriangle size={9} /> high risk
              </span>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{request.detail}</p>
          {request.toolName ? (
            <p className="mt-1 text-[10px] text-faint">Requested by tool {request.toolName}</p>
          ) : null}
        </div>
        {total > 1 ? (
          <span className="chip !h-[19px] !text-[9.5px]">
            {index} of {total}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {request.command ? (
          <div className="border-b border-line-soft bg-panel-2 px-5 py-3">
            <p className="text-[9.5px] uppercase tracking-[0.08em] text-faint">Command</p>
            <code className="mt-1 block whitespace-pre-wrap break-all rounded border border-line bg-bg px-2.5 py-2 font-mono text-[11px] text-fg">
              {request.command}
            </code>
            {request.cwd ? <p className="mt-1 font-mono text-[9.5px] text-faint">cwd: {request.cwd}</p> : null}
          </div>
        ) : null}

        {request.paths && request.paths.length > 0 && !hasDiff ? (
          <div className="border-b border-line-soft px-5 py-3">
            <p className="text-[9.5px] uppercase tracking-[0.08em] text-faint">Paths</p>
            <ul className="mt-1 space-y-0.5">
              {request.paths.map((path) => (
                <li key={path} className="font-mono text-[10.5px] text-fg">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasDiff ? (
          <div>
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-2">
              <p className="text-[10px] text-faint">Choose the hunks to apply. Unchecked hunks are left untouched.</p>
              <div className="flex items-center gap-2 text-[9.5px] text-faint">
                <span>
                  {selected.size}/{totalHunks} selected
                </span>
                <button
                  type="button"
                  className="hover:text-fg"
                  onClick={() => {
                    const next = new Set<string>();
                    for (const change of request.diff ?? []) {
                      for (const hunk of change.hunks) next.add(hunkKey(change.path, hunk.index));
                    }
                    setSelected(next);
                  }}
                >
                  all
                </button>
                <button type="button" className="hover:text-fg" onClick={() => setSelected(new Set())}>
                  none
                </button>
              </div>
            </div>
            <DiffViewer
              changes={request.diff ?? []}
              selectedHunks={selected}
              onToggleHunk={(path, hunkIndex) => {
                const key = hunkKey(path, hunkIndex);
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
            />
          </div>
        ) : null}

        {request.kind === 'delete' || request.kind === 'restore' ? (
          <div className="flex items-start gap-2 border-b border-line-soft bg-danger-soft px-5 py-2.5 text-[10.5px] leading-relaxed text-danger">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            This action changes files on disk. Review the details before approving.
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3">
        <button
          type="button"
          className="btn btn-ghost !h-8"
          disabled={Boolean(busy)}
          onClick={() => void decide('denied')}
        >
          <X size={12} /> {busy === 'denied' ? 'Denying…' : 'Deny'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {request.kind !== 'restore' && request.kind !== 'delete' ? (
            <button type="button" className="btn !h-8" disabled={Boolean(busy)} onClick={() => void decide('session')}>
              Allow for session
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary !h-8"
            disabled={Boolean(busy) || (hasDiff && selected.size === 0)}
            onClick={() => void decide('approved')}
          >
            <Check size={12} />
            {busy === 'approved'
              ? 'Approving…'
              : request.kind === 'write' && hasDiff
                ? `Apply ${selected.size || ''} hunk${selected.size === 1 ? '' : 's'}`
                : 'Allow once'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
