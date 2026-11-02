import { useEffect, useState, useCallback } from 'react';
import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  Database,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { RetrievalResult, ProjectMemory, MemoryKind } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { cn, EmptyState, Spinner } from '../ui';
import { compactPath, errorMessage, pluralize } from '../../lib/format';
import { getActiveEditor } from '../../lib/editorRegistry';

export function ContextPanel() {
  const project = useAppStore((state) => state.project);
  const rules = useAppStore((state) => state.rules);
  const stack = useAppStore((state) => state.stack);
  const indexing = useAppStore((state) => state.indexing);
  const contextFiles = useAppStore((state) => state.contextFiles);
  const addContextFile = useAppStore((state) => state.addContextFile);
  const removeContextFile = useAppStore((state) => state.removeContextFile);
  const clearContext = useAppStore((state) => state.clearContext);
  const openFile = useAppStore((state) => state.openFile);
  const startIndex = useAppStore((state) => state.startIndex);
  const cancelIndex = useAppStore((state) => state.cancelIndex);
  const refreshIndex = useAppStore((state) => state.refreshIndex);
  const toast = useAppStore((state) => state.toast);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryKind, setMemoryKind] = useState<MemoryKind>('convention');

  const loadMemories = useCallback(async () => {
    if (!project) {
      setMemories([]);
      return;
    }
    try {
      const list = await window.forge.memory.list(project.id);
      setMemories(list);
    } catch {
      setMemories([]);
    }
  }, [project]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const handleSaveMemory = async () => {
    if (!project || !memoryTitle.trim() || !memoryContent.trim()) return;
    try {
      await window.forge.memory.save({
        projectId: project.id,
        kind: memoryKind,
        title: memoryTitle.trim(),
        content: memoryContent.trim(),
        source: 'user',
      });
      setMemoryTitle('');
      setMemoryContent('');
      setIsAddingMemory(false);
      toast('success', 'Project memory saved');
      void loadMemories();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await window.forge.memory.remove(id);
      toast('info', 'Memory deleted');
      void loadMemories();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  useEffect(() => {
    setResults([]);
    setQuery('');
  }, [project?.id]);

  useEffect(() => {
    void refreshIndex();
  }, [refreshIndex]);

  const attachCurrent = () => {
    const model = getActiveEditor()?.getModel();
    const path = model?.uri.path.replace(/^\//, '');
    if (!path) {
      toast('info', 'No file is open.');
      return;
    }
    addContextFile(path);
    toast('success', `Attached ${path.split('/').pop()}`);
  };

  const search = async () => {
    if (!project) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    setSearching(true);
    try {
      setResults(await window.forge.index.search(project.id, trimmed, 8));
    } catch (error) {
      toast('error', errorMessage(error));
    } finally {
      setSearching(false);
    }
  };

  if (!project) {
    return (
      <EmptyState
        icon={<Database size={22} />}
        title="No workspace context"
        description="Open a project to inspect rules, attachments and retrieval."
      />
    );
  }

  const busy = indexing?.state === 'scanning' || indexing?.state === 'embedding';
  const built = indexing?.state === 'ready';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section className="border-b border-line-soft px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Attached files</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
              onClick={attachCurrent}
              title="Attach the active file"
            >
              <Paperclip size={11} />
            </button>
            {contextFiles.length > 0 ? (
              <button
                type="button"
                className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-danger"
                onClick={clearContext}
                title="Clear attachments"
              >
                <Trash2 size={11} />
              </button>
            ) : null}
          </div>
        </div>
        {contextFiles.length === 0 ? (
          <p className="mt-1 text-[10px] leading-relaxed text-faint">
            No files attached. Chat still retrieves relevant code automatically; attachments pin exact files into the
            prompt.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {contextFiles.map((path) => (
              <div key={path} className="flex items-center gap-1.5 py-0.5">
                <Paperclip size={9} className="shrink-0 text-accent" />
                <button
                  type="button"
                  onClick={() => void openFile(path)}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[9.5px] text-muted hover:text-fg"
                  title={path}
                >
                  {compactPath(path, 42)}
                </button>
                <button
                  type="button"
                  onClick={() => removeContextFile(path)}
                  className="focus-ring rounded p-0.5 text-faint hover:text-danger"
                  aria-label={`Remove ${path}`}
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-b border-line-soft px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Project rules</span>
          <span className="text-[9.5px] text-faint">{rules.length}</span>
        </div>
        {rules.length === 0 ? (
          <p className="mt-1 text-[10px] leading-relaxed text-faint">
            No AGENTS.md, .cursorrules, CLAUDE.md or Copilot instructions found.
          </p>
        ) : (
          rules.map((rule) => {
            const open = expanded[rule.path] ?? false;
            return (
              <div key={rule.path} className="mt-1 rounded border border-line-soft bg-panel-2">
                <button
                  type="button"
                  onClick={() => setExpanded((current) => ({ ...current, [rule.path]: !open }))}
                  className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left"
                  title={rule.path}
                >
                  {open ? (
                    <ChevronDown size={9} className="text-faint" />
                  ) : (
                    <ChevronRight size={9} className="text-faint" />
                  )}
                  <BookOpen size={10} className="text-accent" />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-fg">{rule.name}</span>
                  <span className="text-[8.5px] uppercase text-faint">{rule.scope}</span>
                </button>
                {open ? (
                  <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap border-t border-line-soft p-1.5 font-mono text-[9px] leading-relaxed text-muted">
                    {rule.content.slice(0, 3000) || '(empty)'}
                  </pre>
                ) : null}
              </div>
            );
          })
        )}
      </section>

      <section className="border-b border-line-soft px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Project memory</span>
          <div className="flex items-center gap-1">
            <span className="text-[9.5px] text-faint">{memories.length}</span>
            <button
              type="button"
              className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
              onClick={() => setIsAddingMemory((prev) => !prev)}
              title="Add memory or convention"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>

        {isAddingMemory ? (
          <div className="mt-2 space-y-1.5 rounded border border-line-soft bg-panel-2 p-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Title (e.g. Auth Architecture)"
                value={memoryTitle}
                onChange={(e) => setMemoryTitle(e.target.value)}
                className="h-6 flex-1 text-[10px]"
              />
              <select
                value={memoryKind}
                onChange={(e) => setMemoryKind(e.target.value as MemoryKind)}
                className="h-6 text-[9.5px]"
              >
                <option value="convention">Convention</option>
                <option value="decision">Decision</option>
                <option value="issue">Issue</option>
                <option value="feedback">Feedback</option>
              </select>
            </div>
            <textarea
              placeholder="Content or guidelines for agents to remember..."
              value={memoryContent}
              onChange={(e) => setMemoryContent(e.target.value)}
              className="h-16 w-full resize-none text-[9.5px]"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                className="btn !h-5 !px-2 !text-[9px]"
                onClick={() => {
                  setIsAddingMemory(false);
                  setMemoryTitle('');
                  setMemoryContent('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary !h-5 !px-2 !text-[9px]"
                onClick={() => void handleSaveMemory()}
                disabled={!memoryTitle.trim() || !memoryContent.trim()}
              >
                Save
              </button>
            </div>
          </div>
        ) : null}

        {memories.length === 0 && !isAddingMemory ? (
          <p className="mt-1 text-[10px] leading-relaxed text-faint">
            No persistent memory yet. Add conventions, architectural decisions, or feedback for agents.
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            {memories.map((mem) => {
              const open = expanded[`mem-${mem.id}`] ?? false;
              return (
                <div key={mem.id} className="rounded border border-line-soft bg-panel-2">
                  <div className="flex w-full items-center gap-1.5 px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => setExpanded((curr) => ({ ...curr, [`mem-${mem.id}`]: !open }))}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      title={mem.title}
                    >
                      {open ? (
                        <ChevronDown size={9} className="text-faint" />
                      ) : (
                        <ChevronRight size={9} className="text-faint" />
                      )}
                      <Brain size={10} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-fg">{mem.title}</span>
                      <span className="shrink-0 text-[8.5px] uppercase text-faint">{mem.kind}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteMemory(mem.id)}
                      className="focus-ring rounded p-0.5 text-faint hover:text-danger"
                      title="Delete memory"
                    >
                      <Trash2 size={9} />
                    </button>
                  </div>
                  {open ? (
                    <div className="border-t border-line-soft p-1.5">
                      <p className="whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-muted">
                        {mem.content}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[8px] text-faint">
                        <span>Source: {mem.source || 'user'}</span>
                        <span>{new Date(mem.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="border-b border-line-soft px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Code index</span>
          {busy ? <Spinner className="!h-3 !w-3" /> : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
          <Database size={10} className="text-faint" />
          {built
            ? `${pluralize(indexing?.filesIndexed ?? 0, 'file')} · ${indexing?.chunks ?? 0} chunks · ${indexing?.embedded ?? 0} embedded`
            : busy
              ? `${indexing?.message ?? 'Indexing'}…`
              : 'Not indexed'}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            className="btn !h-6 !px-2 !text-[9.5px]"
            onClick={() => void startIndex(false)}
            disabled={busy}
          >
            <RefreshCw size={9} /> {built ? 'Refresh' : 'Build index'}
          </button>
          <button
            type="button"
            className="btn !h-6 !px-2 !text-[9.5px]"
            onClick={() => void startIndex(true)}
            disabled={busy}
          >
            Rebuild
          </button>
          {busy ? (
            <button
              type="button"
              className="btn btn-danger !h-6 !px-2 !text-[9.5px]"
              onClick={() => void cancelIndex()}
            >
              Cancel
            </button>
          ) : null}
        </div>
        {indexing?.error ? <p className="mt-1 text-[9.5px] text-danger">{indexing.error}</p> : null}
      </section>

      <section className="px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Semantic retrieval</span>
        <div className="mt-1 flex items-center gap-1">
          <div className="relative flex-1">
            <Search size={10} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void search();
              }}
              placeholder="What code is relevant to…"
              className="h-6 w-full pl-6 text-[10.5px]"
            />
          </div>
          <button
            type="button"
            className="btn !h-6 !px-2 !text-[9.5px]"
            onClick={() => void search()}
            disabled={searching || query.trim().length < 2}
          >
            {searching ? <Spinner className="!h-2.5 !w-2.5" /> : <Search size={9} />}
          </button>
        </div>

        {results.length > 0 ? (
          <div className="mt-1.5 flex flex-col gap-1">
            {results.map((result) => {
              const key = `${result.path}:${result.startLine}`;
              const open = expanded[key] ?? false;
              return (
                <div key={key} className="rounded border border-line-soft bg-panel-2">
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))}
                    className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left"
                    title={`${result.path}:${result.startLine}`}
                  >
                    {open ? (
                      <ChevronDown size={9} className="text-faint" />
                    ) : (
                      <ChevronRight size={9} className="text-faint" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-fg">{result.path}</span>
                    <span className="shrink-0 text-[8.5px] text-faint">
                      {result.startLine}–{result.endLine}
                    </span>
                    <span className="shrink-0 text-[8.5px] text-accent">{result.score.toFixed(2)}</span>
                  </button>
                  {open ? (
                    <>
                      <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap border-t border-line-soft p-1.5 font-mono text-[9px] leading-relaxed text-muted">
                        {result.content.slice(0, 2400)}
                      </pre>
                      <div className="flex items-center gap-2 border-t border-line-soft px-1.5 py-1">
                        <button
                          type="button"
                          className="text-[8.5px] text-cyan hover:underline"
                          onClick={() => void openFile(result.path, result.startLine)}
                        >
                          open
                        </button>
                        <button
                          type="button"
                          className="text-[8.5px] text-faint hover:text-fg"
                          onClick={() => {
                            addContextFile(result.path);
                            toast('success', `Attached ${result.path.split('/').pop()}`);
                          }}
                        >
                          attach
                        </button>
                        <span className="ml-auto text-[8.5px] uppercase text-faint">{result.reason}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : query.trim().length >= 2 && !searching ? (
          <p className="mt-1 text-[9.5px] text-faint">No chunks matched. Try different wording or rebuild the index.</p>
        ) : null}
      </section>

      {stack ? (
        <section className="border-t border-line-soft px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Workspace</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {[...stack.languages, ...stack.frameworks, ...stack.packageManagers].map((tag) => (
              <span key={tag} className={cn('chip !h-[17px] !text-[8.5px] capitalize')}>
                {tag}
              </span>
            ))}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[9px] text-faint">
            <Plus size={9} /> Retrieval packs at most 8 chunks into agent and chat prompts.
          </p>
        </section>
      ) : null}
    </div>
  );
}
