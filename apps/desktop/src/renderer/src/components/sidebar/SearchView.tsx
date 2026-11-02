import { useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, Search, WholeWord } from 'lucide-react';
import type { TextSearchResult } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { cn, EmptyState, FileTypeIcon, Spinner } from '../ui';
import { errorMessage } from '../../lib/format';

export function SearchView() {
  const project = useAppStore((state) => state.project);
  const openFile = useAppStore((state) => state.openFile);
  const addContextFile = useAppStore((state) => state.addContextFile);
  const searchFocus = useAppStore((state) => state.searchFocus);
  const toast = useAppStore((state) => state.toast);

  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<TextSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [searchFocus]);

  useEffect(() => {
    setResults([]);
    setError(null);
    setQuery('');
  }, [project?.id]);

  useEffect(() => {
    if (!project) return undefined;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      window.forge.search
        .text(project.id, {
          query: trimmed,
          caseSensitive,
          regex,
          wholeWord,
          include: include.trim() || undefined,
          exclude: exclude.trim() || undefined,
          maxResults: 400,
        })
        .then((hits) => {
          setResults(hits);
          setError(null);
        })
        .catch((caught) => {
          setResults([]);
          setError(errorMessage(caught));
        })
        .finally(() => setLoading(false));
    }, 320);
    return () => {
      clearTimeout(timer);
      setLoading(false);
    };
  }, [query, caseSensitive, regex, wholeWord, include, exclude, project]);

  const grouped = useMemo(() => {
    const map = new Map<string, TextSearchResult[]>();
    for (const result of results) {
      const list = map.get(result.path) ?? [];
      list.push(result);
      map.set(result.path, list);
    }
    return [...map.entries()];
  }, [results]);

  if (!project) {
    return (
      <EmptyState
        icon={<Search size={22} />}
        title="Search needs a folder"
        description="Open a project folder to search its text with ripgrep."
      />
    );
  }

  const openResult = (result: TextSearchResult) => {
    void openFile(result.path, result.line);
  };

  const attachFile = (path: string) => {
    addContextFile(path);
    toast('info', `Attached ${path.split('/').pop()} to the chat context`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line-soft p-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workspace"
              className="h-7 w-full pl-7 text-[11.5px]"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            title="Match case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive((value) => !value)}
            className={cn(
              'focus-ring rounded border border-transparent p-1 text-faint hover:bg-panel-3',
              caseSensitive && 'border-line bg-panel-3 text-accent',
            )}
          >
            <CaseSensitive size={14} />
          </button>
          <button
            type="button"
            title="Match whole word"
            aria-pressed={wholeWord}
            onClick={() => setWholeWord((value) => !value)}
            className={cn(
              'focus-ring rounded border border-transparent p-1 text-faint hover:bg-panel-3',
              wholeWord && 'border-line bg-panel-3 text-accent',
            )}
          >
            <WholeWord size={14} />
          </button>
          <button
            type="button"
            title="Use regular expression"
            aria-pressed={regex}
            onClick={() => setRegex((value) => !value)}
            className={cn(
              'focus-ring rounded border border-transparent p-1 text-faint hover:bg-panel-3',
              regex && 'border-line bg-panel-3 text-accent',
            )}
          >
            <Regex size={14} />
          </button>
          <button
            type="button"
            title="Search options"
            onClick={() => setShowFilters((value) => !value)}
            className={cn(
              'focus-ring rounded border border-transparent p-1 text-faint hover:bg-panel-3',
              showFilters && 'border-line bg-panel-3 text-accent',
            )}
          >
            <Replace size={14} />
          </button>
        </div>
        {showFilters ? (
          <div className="mt-2 grid gap-1.5">
            <input
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              placeholder="files to include — e.g. src/**/*.ts"
              className="h-7 w-full text-[11px]"
              spellCheck={false}
            />
            <input
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              placeholder="files to exclude — e.g. dist/**"
              className="h-7 w-full text-[11px]"
              spellCheck={false}
            />
            <p className="px-0.5 text-[10px] leading-relaxed text-faint">
              Uses ripgrep with the workspace .gitignore. Internal replace is not enabled; use editor replace for safe
              review.
            </p>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-faint">
            <Spinner className="!h-3 !w-3" /> Searching…
          </div>
        ) : null}
        {error ? <p className="px-3 py-3 text-[11.5px] text-danger">{error}</p> : null}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 ? (
          <p className="px-3 py-3 text-[11.5px] text-faint">No matches for “{query.trim()}”.</p>
        ) : null}
        {!query.trim() ? (
          <p className="px-3 py-3 text-[11.5px] leading-relaxed text-faint">
            Search code, strings and configuration. Results stream in as you type and open straight at the matching
            line.
          </p>
        ) : null}

        {grouped.map(([path, hits]) => {
          const isCollapsed = collapsed[path] ?? false;
          return (
            <div key={path}>
              <button
                type="button"
                onClick={() => setCollapsed((current) => ({ ...current, [path]: !isCollapsed }))}
                className="sticky top-0 z-[1] flex w-full items-center gap-1.5 border-b border-line-soft bg-panel px-2 py-1 text-left hover:bg-panel-2"
                title={path}
              >
                {isCollapsed ? (
                  <ChevronRight size={11} className="text-faint" />
                ) : (
                  <ChevronDown size={11} className="text-faint" />
                )}
                <FileTypeIcon path={path} size={12} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg">{path}</span>
                <span className="rounded bg-panel-3 px-1 text-[9.5px] text-faint">{hits.length}</span>
              </button>
              {!isCollapsed
                ? hits.map((hit, index) => (
                    <button
                      key={`${hit.path}:${hit.line}:${hit.column}:${index}`}
                      type="button"
                      onClick={() => openResult(hit)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        attachFile(hit.path);
                      }}
                      className="group flex w-full items-start gap-2 px-3 py-[3px] text-left hover:bg-panel-2"
                      title="Click to open · right-click to attach to AI chat"
                    >
                      <span className="w-8 shrink-0 pt-[2px] text-right font-mono text-[10px] text-faint">
                        {hit.line}
                      </span>
                      <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre font-mono text-[11px] leading-[17px] text-muted">
                        {renderPreview(hit.preview, hit.matchLength, hit.column)}
                      </code>
                    </button>
                  ))
                : null}
            </div>
          );
        })}
      </div>

      {results.length > 0 ? (
        <div className="border-t border-line-soft px-3 py-1.5 text-[10px] text-faint">
          {results.length} match{results.length === 1 ? '' : 'es'} in {grouped.length} file
          {grouped.length === 1 ? '' : 's'}
        </div>
      ) : null}
    </div>
  );
}

function renderPreview(preview: string, matchLength: number, column: number): React.ReactNode {
  const truncated = preview.length > 220;
  const text = truncated ? `${preview.slice(0, 220)}…` : preview;
  const start = Math.max(0, Math.min(column - 1, text.length));
  const end = Math.min(text.length, start + Math.max(matchLength, 1));
  if (start >= text.length || end <= start) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-accent-soft px-0 text-accent">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
