import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Globe,
  ListFilter,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { BrowserOption, FileNode } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { cn, EmptyState, FileTypeIcon, IconButton, SectionLabel } from '../ui';
import { errorMessage } from '../../lib/format';
import {
  absolutePath,
  copyToClipboard,
  installedBrowsers,
  isHtmlFile,
  openFolderInTerminal,
  openInBrowser,
  revealInFileManager,
} from '../../lib/workspaceActions';

interface ContextMenuState {
  x: number;
  y: number;
  /** The right-clicked entry; `null` means the empty area below the tree (the workspace root). */
  node: FileNode | null;
}

function flatten(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === 'file') out.push(node);
    else if (node.children) flatten(node.children, out);
  }
  return out;
}

function directoryPaths(nodes: FileNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'directory') {
      out.push(node.path);
      if (node.children) directoryPaths(node.children, out);
    }
  }
  return out;
}

export function Explorer() {
  const project = useAppStore((state) => state.project);
  const files = useAppStore((state) => state.files);
  const expanded = useAppStore((state) => state.expanded);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const rules = useAppStore((state) => state.rules);
  const openFile = useAppStore((state) => state.openFile);
  const refreshTree = useAppStore((state) => state.refreshTree);
  const askPrompt = useAppStore((state) => state.askPrompt);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const toast = useAppStore((state) => state.toast);
  const addContextFile = useAppStore((state) => state.addContextFile);
  const indexStatus = useAppStore((state) => state.indexing);

  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [localChildren, setLocalChildren] = useState<Record<string, FileNode[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [browsers, setBrowsers] = useState<BrowserOption[]>([]);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  const openMenu = useCallback((x: number, y: number, node: FileNode | null) => {
    setContextMenu({ x, y, node });
    if (node && node.type === 'file' && isHtmlFile(node.path)) {
      void installedBrowsers().then(setBrowsers);
    }
  }, []);

  // Keep the menu inside the window; measured after layout so it never flashes offscreen.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!contextMenu || !menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setMenuPosition({
      x: Math.max(4, Math.min(contextMenu.x, window.innerWidth - width - 6)),
      y: Math.max(4, Math.min(contextMenu.y, window.innerHeight - height - 6)),
    });
  }, [contextMenu, browsers]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onScroll = (event: Event) => {
      const menu = menuRef.current;
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      closeMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll);
    };
  }, [contextMenu, closeMenu]);

  const activePath = activeTabId?.startsWith('file:') ? activeTabId.slice(5) : null;

  useEffect(() => {
    setLocalChildren({});
    setFilter('');
    setCollapsed(false);
  }, [project?.id]);

  // Whenever the workspace tree updates (from file events, terminal commands, or agent execution),
  // re-fetch directory listings for all currently expanded folders so new files and subdirectories
  // appear immediately in the explorer without collapsing folders.
  useEffect(() => {
    const expandedDirs = Array.from(new Set([...expanded, ...Object.keys(localChildren)]));
    if (expandedDirs.length === 0) return;
    let cancelled = false;
    void Promise.all(
      expandedDirs.map(async (dirPath) => {
        try {
          const entries = await window.forge.workspace.list(dirPath);
          return {
            dirPath,
            nodes: entries.map((entry) => ({
              name: entry.name,
              path: entry.path,
              type: entry.type,
              children: entry.type === 'directory' ? [] : undefined,
            })),
          };
        } catch {
          return { dirPath, nodes: [] };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setLocalChildren((prev) => {
        const next = { ...prev };
        for (const res of results) {
          next[res.dirPath] = res.nodes;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [files, expanded]);

  useEffect(() => {
    if (showFilter) filterRef.current?.focus();
  }, [showFilter]);

  const expandedSet = useMemo(() => new Set(expanded), [expanded]);

  const toggle = useCallback(
    async (node: FileNode) => {
      if (node.type === 'file') {
        await openFile(node.path);
        return;
      }
      if (expandedSet.has(node.path)) {
        useAppStore.setState((state) => ({ expanded: state.expanded.filter((entry) => entry !== node.path) }));
        return;
      }
      useAppStore.setState((state) => ({
        expanded: state.expanded.includes(node.path) ? state.expanded : [...state.expanded, node.path],
      }));
      const children = node.children ?? [];
      if (children.length === 0 && !localChildren[node.path] && !loadingDirs[node.path]) {
        setLoadingDirs((current) => ({ ...current, [node.path]: true }));
        try {
          const entries = await window.forge.workspace.list(node.path);
          setLocalChildren((current) => ({
            ...current,
            [node.path]: entries.map((entry) => ({
              name: entry.name,
              path: entry.path,
              type: entry.type,
              children: entry.type === 'directory' ? [] : undefined,
            })),
          }));
        } catch (error) {
          toast('error', errorMessage(error));
        } finally {
          setLoadingDirs((current) => ({ ...current, [node.path]: false }));
        }
      }
    },
    [expandedSet, localChildren, loadingDirs, openFile, toast],
  );

  const childrenOf = useCallback(
    (node: FileNode): FileNode[] => {
      if (localChildren[node.path]) return localChildren[node.path]!;
      return node.children ?? [];
    },
    [localChildren],
  );

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return null;
    const pool = flatten(files);
    Object.values(localChildren).forEach((list) => flatten(list, pool));
    return pool.filter((node) => node.path.toLowerCase().includes(query)).slice(0, 300);
  }, [filter, files, localChildren]);

  const newFile = (base = '') =>
    askPrompt({
      title: base ? `New file in ${base}` : 'New file',
      message: 'Enter a path relative to the workspace root.',
      placeholder: base ? `${base}/NewFile.tsx` : 'src/components/NewComponent.tsx',
      submitLabel: 'Create file',
      onSubmit: async (value) => {
        const path = value.trim().replace(/^\/+/, '');
        if (!path) return;
        try {
          await window.forge.workspace.createFile(path);
          const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
          if (parent) {
            useAppStore.setState((state) => ({
              expanded: state.expanded.includes(parent) ? state.expanded : [...state.expanded, parent],
            }));
            const entries = await window.forge.workspace.list(parent);
            setLocalChildren((prev) => ({
              ...prev,
              [parent]: entries.map((e) => ({
                name: e.name,
                path: e.path,
                type: e.type,
                children: e.type === 'directory' ? [] : undefined,
              })),
            }));
          }
          await refreshTree();
          await openFile(path);
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });

  const newFolder = (base = '') =>
    askPrompt({
      title: base ? `New folder in ${base}` : 'New folder',
      message: 'Enter a path relative to the workspace root.',
      placeholder: base ? `${base}/new-folder` : 'src/features/new-feature',
      submitLabel: 'Create folder',
      onSubmit: async (value) => {
        const path = value.trim().replace(/^\/+/, '');
        if (!path) return;
        try {
          await window.forge.workspace.createDirectory(path);
          const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
          if (parent) {
            useAppStore.setState((state) => ({
              expanded: state.expanded.includes(parent) ? state.expanded : [...state.expanded, parent],
            }));
            const entries = await window.forge.workspace.list(parent);
            setLocalChildren((prev) => ({
              ...prev,
              [parent]: entries.map((e) => ({
                name: e.name,
                path: e.path,
                type: e.type,
                children: e.type === 'directory' ? [] : undefined,
              })),
            }));
          }
          await refreshTree();
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });

  const removeNode = (node: FileNode) => {
    askConfirm({
      title: `Delete ${node.name}?`,
      message:
        node.type === 'directory'
          ? `This permanently removes the folder and everything inside it from disk.`
          : `This permanently removes the file from disk.`,
      confirmLabel: 'Delete',
      danger: true,
      action: async () => {
        try {
          await window.forge.workspace.remove([node.path], true);
          const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
          if (parent) {
            const entries = await window.forge.workspace.list(parent);
            setLocalChildren((prev) => ({
              ...prev,
              [parent]: entries.map((e) => ({
                name: e.name,
                path: e.path,
                type: e.type,
                children: e.type === 'directory' ? [] : undefined,
              })),
            }));
          }
          await refreshTree();
          toast('success', `Deleted ${node.name}`);
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });
  };

  const renameNode = (node: FileNode) => {
    askPrompt({
      title: `Rename ${node.name}`,
      initial: node.path,
      submitLabel: 'Rename',
      onSubmit: async (value) => {
        const next = value.trim().replace(/^\/+/, '');
        if (!next || next === node.path) return;
        try {
          await window.forge.workspace.rename(node.path, next);
          const oldParent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
          const newParent = next.includes('/') ? next.slice(0, next.lastIndexOf('/')) : '';
          for (const parent of [oldParent, newParent]) {
            if (parent) {
              const entries = await window.forge.workspace.list(parent);
              setLocalChildren((prev) => ({
                ...prev,
                [parent]: entries.map((e) => ({
                  name: e.name,
                  path: e.path,
                  type: e.type,
                  children: e.type === 'directory' ? [] : undefined,
                })),
              }));
            }
          }
          await refreshTree();
          useAppStore.setState((state) => ({ tabs: state.tabs.filter((tab) => tab.path !== node.path) }));
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });
  };

  const renderNodes = (nodes: FileNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const isExpanded = expandedSet.has(node.path);
      const isActive = node.path === activePath;
      if (node.type === 'directory') {
        return (
          <div key={node.path}>
            <div
              role="treeitem"
              aria-expanded={isExpanded}
              tabIndex={0}
              className={cn('tree-row focus-ring', isActive && 'active')}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => void toggle(node)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void toggle(node);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openMenu(event.clientX, event.clientY, node);
              }}
              title={node.path}
            >
              {loadingDirs[node.path] ? (
                <span className="h-3.5 w-3.5 shrink-0 animate-pulse text-faint">…</span>
              ) : isExpanded ? (
                <ChevronDown size={13} className="shrink-0 text-faint" />
              ) : (
                <ChevronRight size={13} className="shrink-0 text-faint" />
              )}
              <span className="truncate">{node.name}</span>
              <button
                type="button"
                aria-label={`Actions for ${node.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  openMenu(rect.left, rect.bottom, node);
                }}
                className="ml-auto hidden rounded p-0.5 text-faint hover:bg-panel-3 hover:text-fg group-hover:block"
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
            {isExpanded ? (
              <div role="group">
                {childrenOf(node).length === 0 && !loadingDirs[node.path] ? (
                  <div className="tree-row italic text-faint" style={{ paddingLeft: 22 + depth * 12 }}>
                    empty folder
                  </div>
                ) : (
                  renderNodes(childrenOf(node), depth + 1)
                )}
              </div>
            ) : null}
          </div>
        );
      }
      return (
        <div
          key={node.path}
          role="treeitem"
          tabIndex={0}
          className={cn('tree-row focus-ring', isActive && 'active')}
          style={{ paddingLeft: 10 + depth * 12 }}
          onClick={() => void openFile(node.path)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void openFile(node.path);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openMenu(event.clientX, event.clientY, node);
          }}
          title={node.path}
        >
          <FileTypeIcon path={node.path} size={13} />
          <span className="truncate">{node.name}</span>
          {rules.some((rule) => rule.path === node.path) ? (
            <span className="ml-auto rounded bg-accent-soft px-1 text-[9px] font-medium text-accent">AI</span>
          ) : null}
        </div>
      );
    });

  if (!project) {
    return (
      <EmptyState
        icon={<FolderPlus size={24} />}
        title="No folder open"
        description="Open a project folder to browse files, index the codebase and give the agent a workspace."
        action={
          <button type="button" className="btn btn-primary" onClick={() => void useAppStore.getState().openFolder()}>
            Open folder
          </button>
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line-soft px-2 py-1.5">
        <button
          type="button"
          className="focus-ring flex min-w-0 items-center gap-1 rounded px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint hover:text-muted"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? 'Expand project' : 'Collapse project'}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          <span className="truncate">{project.name}</span>
        </button>
        <div className="flex items-center">
          <IconButton label="New file" onClick={() => newFile()} title="New file">
            <FilePlus2 size={13} />
          </IconButton>
          <IconButton label="New folder" onClick={() => newFolder()} title="New folder">
            <FolderPlus size={13} />
          </IconButton>
          <IconButton
            label="Filter files"
            active={showFilter}
            onClick={() => {
              setShowFilter((value) => !value);
              if (showFilter) setFilter('');
            }}
            title="Filter files"
          >
            <ListFilter size={13} />
          </IconButton>
          <IconButton
            label="Refresh"
            onClick={async () => {
              setLocalChildren({});
              await refreshTree();
            }}
            title="Refresh explorer"
          >
            <RefreshCw size={12} />
          </IconButton>
        </div>
      </div>

      {showFilter ? (
        <div className="border-b border-line-soft p-2">
          <input
            ref={filterRef}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by file name"
            className="h-7 w-full text-[11.5px]"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setFilter('');
                setShowFilter(false);
              }
            }}
          />
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-auto py-1"
        role="tree"
        aria-label="Project files"
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('[role="treeitem"]')) return;
          event.preventDefault();
          openMenu(event.clientX, event.clientY, null);
        }}
      >
        {filtered ? (
          filtered.length === 0 ? (
            <p className="px-3 py-4 text-[11.5px] text-faint">No files match “{filter}”.</p>
          ) : (
            filtered.map((node) => (
              <div
                key={node.path}
                role="treeitem"
                className={cn('tree-row focus-ring', node.path === activePath && 'active')}
                style={{ paddingLeft: 10 }}
                onClick={() => void openFile(node.path)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openMenu(event.clientX, event.clientY, node);
                }}
                title={node.path}
              >
                <FileTypeIcon path={node.path} size={13} />
                <span className="truncate">{node.path}</span>
              </div>
            ))
          )
        ) : collapsed ? null : files.length === 0 ? (
          <p className="px-3 py-4 text-[11.5px] text-faint">This folder is empty.</p>
        ) : (
          renderNodes(files, 0)
        )}
      </div>

      {rules.length > 0 ? (
        <>
          <SectionLabel right={<span className="text-[10px] text-faint">{rules.length}</span>}>AI rules</SectionLabel>
          <div className="max-h-[140px] overflow-auto pb-2">
            {rules.map((rule) => (
              <button
                key={rule.path}
                type="button"
                className="tree-row w-full text-left"
                onClick={() => {
                  if (rule.path.startsWith('/')) {
                    void navigator.clipboard.writeText(rule.path).catch(() => undefined);
                    toast('info', `Copied ${rule.name} path — global rules live outside the workspace.`);
                  } else {
                    void openFile(rule.path);
                  }
                }}
                title={rule.path}
              >
                <FileTypeIcon path={rule.path} size={12} />
                <span className="truncate">{rule.name}</span>
                <span className="ml-auto text-[9px] uppercase text-faint">{rule.scope}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="flex items-center justify-between border-t border-line-soft px-3 py-1.5 text-[10px] text-faint">
        <span>{indexStatus?.state === 'ready' ? `${indexStatus.filesIndexed} indexed` : 'index pending'}</span>
        <span>{directoryPaths(files).length} folders</span>
      </div>

      {contextMenu ? (
        <>
          <div
            className="fixed inset-0 z-[70]"
            onClick={closeMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              closeMenu();
            }}
          />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Explorer actions"
            className="fixed z-[71] max-h-[70vh] min-w-[228px] overflow-y-auto rounded-md border border-line bg-bg-elevated py-1 shadow-soft"
            style={{ left: menuPosition.x, top: menuPosition.y }}
          >
            {explorerMenu({
              node: contextMenu.node,
              browsers,
              projectName: project?.name ?? 'Workspace',
              onOpen: (path) => {
                void openFile(path);
                closeMenu();
              },
              onAttach: (path, name) => {
                addContextFile(path);
                toast('info', `Attached ${name} to the chat context`);
                closeMenu();
              },
              onBrowse: (path, browserId) => {
                void openInBrowser(path, browserId);
                closeMenu();
              },
              onCopy: (text, label) => {
                void copyToClipboard(text, label);
                closeMenu();
              },
              onReveal: (path) => {
                void revealInFileManager(path);
                closeMenu();
              },
              onNewFile: (base) => {
                newFile(base);
                closeMenu();
              },
              onNewFolder: (base) => {
                newFolder(base);
                closeMenu();
              },
              onTerminal: (base) => {
                openFolderInTerminal(base);
                closeMenu();
              },
              onRename: (node) => {
                renameNode(node);
                closeMenu();
              },
              onDelete: (node) => {
                removeNode(node);
                closeMenu();
              },
              onRefresh: () => {
                void refreshTree();
                closeMenu();
              },
              onFilter: () => {
                setShowFilter(true);
                closeMenu();
              },
              onCollapseAll: () => {
                setCollapsed(true);
                closeMenu();
              },
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface MenuActions {
  node: FileNode | null;
  browsers: BrowserOption[];
  projectName: string;
  onOpen(path: string): void;
  onAttach(path: string, name: string): void;
  onBrowse(path: string, browserId?: string): void;
  onCopy(text: string, label: string): void;
  onReveal(path: string): void;
  onNewFile(base: string): void;
  onNewFolder(base: string): void;
  onTerminal(base: string): void;
  onRename(node: FileNode): void;
  onDelete(node: FileNode): void;
  onRefresh(): void;
  onFilter(): void;
  onCollapseAll(): void;
}

/** The Explorer context-menu contents for a file, a folder or the empty workspace area. */
function explorerMenu(actions: MenuActions) {
  const { node } = actions;

  if (!node) {
    return (
      <>
        <MenuLabel>{actions.projectName}</MenuLabel>
        <MenuItem icon={<FilePlus2 size={12} />} label="New file…" onClick={() => actions.onNewFile('')} />
        <MenuItem icon={<FolderPlus size={12} />} label="New folder…" onClick={() => actions.onNewFolder('')} />
        <MenuItem
          icon={<Terminal size={12} />}
          label="Open in Integrated Terminal"
          onClick={() => actions.onTerminal('')}
        />
        <MenuSeparator />
        <MenuItem icon={<RefreshCw size={12} />} label="Refresh Explorer" onClick={actions.onRefresh} />
        <MenuItem icon={<ListFilter size={12} />} label="Filter files…" onClick={actions.onFilter} />
        <MenuItem icon={<ChevronDown size={12} />} label="Collapse All" onClick={actions.onCollapseAll} />
      </>
    );
  }

  const isFile = node.type === 'file';
  const browseable = isFile && isHtmlFile(node.path);

  return (
    <>
      {isFile ? (
        <>
          <MenuItem icon={<ExternalLink size={12} />} label="Open" onClick={() => actions.onOpen(node.path)} />
          {browseable ? (
            <>
              <MenuItem
                icon={<Globe size={12} />}
                label="Open in Browser"
                hint="default"
                onClick={() => actions.onBrowse(node.path)}
              />
              <MenuSeparator />
              <MenuLabel>Open in Browser</MenuLabel>
              <MenuItem
                icon={<Globe size={11} />}
                label="System default browser"
                onClick={() => actions.onBrowse(node.path, 'default')}
              />
              {actions.browsers
                .filter((browser) => browser.available && browser.id !== 'default')
                .map((browser) => (
                  <MenuItem
                    key={browser.id}
                    icon={<Globe size={11} />}
                    label={browser.name}
                    onClick={() => actions.onBrowse(node.path, browser.id)}
                  />
                ))}
              {actions.browsers.length === 0 ? (
                <MenuItem icon={<Globe size={11} />} label="Detecting browsers…" disabled onClick={() => undefined} />
              ) : null}
            </>
          ) : null}
          <MenuItem
            icon={<Paperclip size={12} />}
            label="Attach to AI chat"
            onClick={() => actions.onAttach(node.path, node.name)}
          />
        </>
      ) : (
        <>
          <MenuItem
            icon={<FilePlus2 size={12} />}
            label="New file here…"
            onClick={() => actions.onNewFile(node.path)}
          />
          <MenuItem
            icon={<FolderPlus size={12} />}
            label="New folder here…"
            onClick={() => actions.onNewFolder(node.path)}
          />
          <MenuItem
            icon={<Terminal size={12} />}
            label="Open in Integrated Terminal"
            onClick={() => actions.onTerminal(node.path)}
          />
        </>
      )}

      <MenuSeparator />
      <MenuItem
        icon={<ClipboardCopy size={12} />}
        label="Copy relative path"
        onClick={() => actions.onCopy(node.path, 'relative path')}
      />
      <MenuItem
        icon={<ClipboardCopy size={12} />}
        label="Copy absolute path"
        onClick={() => actions.onCopy(absolutePath(node.path), 'absolute path')}
      />
      <MenuItem
        icon={<FolderOpen size={12} />}
        label="Reveal in File Manager"
        onClick={() => actions.onReveal(node.path)}
      />

      <MenuSeparator />
      <MenuItem icon={<Pencil size={12} />} label="Rename…" onClick={() => actions.onRename(node)} />
      <MenuItem icon={<Trash2 size={12} />} label="Delete…" danger onClick={() => actions.onDelete(node)} />
    </>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-line-soft" />;
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-[5px] text-left text-[11.5px] hover:bg-panel-2',
        disabled && 'cursor-default opacity-50 hover:bg-transparent',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      <span className="text-faint">{icon}</span>
      <span className="truncate">{label}</span>
      {hint ? <span className="ml-auto pl-2 text-[9.5px] text-faint">{hint}</span> : null}
    </button>
  );
}
