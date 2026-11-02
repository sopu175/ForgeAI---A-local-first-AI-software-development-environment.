import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSearch } from 'lucide-react';
import type { FileNode } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { cn } from './ui';

function flatten(nodes: FileNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'file') into.push(node.path);
    if (node.children?.length) flatten(node.children, into);
  }
  return into;
}

/** Quick file fuzzy-opener backed by ripgrep-style workspace search. */
export function QuickOpen() {
  const open = useAppStore((state) => state.quickOpenOpen);
  const setOpen = useAppStore((state) => state.setQuickOpenOpen);
  const project = useAppStore((state) => state.project);
  const files = useAppStore((state) => state.files);
  const openFile = useAppStore((state) => state.openFile);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const local = useMemo(() => flatten(files), [files]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMatches([]);
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = query.replace(/:\d+$/, '').trim();
    if (!project) {
      setMatches(local.filter((path) => path.toLowerCase().includes(needle.toLowerCase())).slice(0, 60));
      return;
    }
    if (!needle) {
      setMatches(local.slice(0, 60));
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      window.forge.search
        .files(project.id, needle, 60)
        .then((paths) =>
          setMatches(
            paths.length > 0
              ? paths
              : local.filter((path) => path.toLowerCase().includes(needle.toLowerCase())).slice(0, 60),
          ),
        )
        .catch(() => setMatches(local.filter((path) => path.toLowerCase().includes(needle.toLowerCase())).slice(0, 60)))
        .finally(() => setLoading(false));
    }, 140);
    return () => clearTimeout(timer);
  }, [query, open, project, local]);

  if (!open) return null;

  const choose = (value: string) => {
    const match = /:(\d+)$/.exec(query.trim());
    const path = value.replace(/:(\d+)$/, '');
    setOpen(false);
    void openFile(path, match ? Number(match[1]) : undefined);
  };

  return (
    <div
      className="overlay !pt-[12vh] app-no-drag"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="modal w-[620px] overflow-hidden p-0" role="dialog" aria-modal="true">
        <div className="flex items-center gap-2 border-b border-line-soft px-3.5">
          <FileSearch size={14} className="text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
              else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((current) => Math.min(matches.length - 1, current + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const value = matches[index];
                if (value) choose(value);
              }
            }}
            placeholder="Search files by name, e.g. ChatPanel.tsx:42"
            className="h-11 w-full border-0 !bg-transparent !px-0 text-[13px] !shadow-none"
          />
          {loading ? <span className="text-[10px] text-faint">searching…</span> : null}
        </div>
        <div className="max-h-[56vh] overflow-y-auto py-1">
          {matches.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted">
              {project ? 'No files match. Try a shorter query.' : 'Open a folder to search its files.'}
            </div>
          ) : (
            matches.map((path, position) => {
              const parts = path.split('/');
              const name = parts.pop() ?? path;
              return (
                <button
                  key={path}
                  type="button"
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => choose(path)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3.5 py-1.5 text-left text-[12px]',
                    position === index ? 'bg-accent-soft text-fg-strong' : 'text-muted hover:bg-panel-2',
                  )}
                >
                  <span className="truncate font-medium">{name}</span>
                  <span className="ml-auto truncate text-[10.5px] text-faint">{parts.join('/')}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line-soft px-3.5 py-1.5 text-[10px] text-faint">
          <span>{project ? `${matches.length} files` : 'no workspace'}</span>
          <span>append :line to jump · ↵ open · esc close</span>
        </div>
      </div>
    </div>
  );
}
