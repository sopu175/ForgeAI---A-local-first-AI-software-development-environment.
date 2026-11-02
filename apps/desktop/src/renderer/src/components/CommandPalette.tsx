import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'lucide-react';
import { useAppStore } from '../state/app';
import { COMMANDS, runCommand } from '../lib/commands';
import { cn } from './ui';

export function CommandPalette() {
  const open = useAppStore((state) => state.paletteOpen);
  const setOpen = useAppStore((state) => state.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COMMANDS;
    const tokens = needle.split(/\s+/);
    return COMMANDS.filter((command) => {
      const haystack = `${command.category} ${command.title} ${command.keywords ?? ''}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [query]);

  useEffect(() => {
    if (index >= results.length) setIndex(Math.max(0, results.length - 1));
  }, [results.length, index]);

  if (!open) return null;

  const execute = (id: string) => {
    setOpen(false);
    void runCommand(id);
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
          <Command size={14} className="text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((current) => Math.min(results.length - 1, current + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const command = results[index];
                if (command) execute(command.id);
              }
            }}
            placeholder="Type a command…"
            className="h-11 w-full border-0 !bg-transparent !px-0 text-[13px] !shadow-none"
          />
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-muted">No matching commands.</div>
          ) : (
            results.map((command, position) => (
              <button
                key={command.id}
                type="button"
                onMouseEnter={() => setIndex(position)}
                onClick={() => execute(command.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-3.5 py-2 text-left text-[12px]',
                  position === index ? 'bg-accent-soft text-fg-strong' : 'text-muted hover:bg-panel-2',
                )}
              >
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-faint">{command.category}</span>
                <span className="flex-1 truncate">{command.title}</span>
                {command.shortcut ? <kbd className="text-[10px] text-faint">{command.shortcut}</kbd> : null}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line-soft px-3.5 py-1.5 text-[10px] text-faint">
          <span>{results.length} commands</span>
          <span>↑↓ navigate · ↵ run · esc close</span>
        </div>
      </div>
    </div>
  );
}
