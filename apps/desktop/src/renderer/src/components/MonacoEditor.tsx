import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { useAppStore, type EditorTab, type ProblemItem, type QuickEditState } from '../state/app';
import { createEditorOptions, initMonaco } from '../lib/monaco';
import { setActiveEditor } from '../lib/editorRegistry';
import {
  absolutePath,
  copyToClipboard,
  installedBrowsers,
  isHtmlFile,
  openInBrowser,
  revealInFileManager,
} from '../lib/workspaceActions';

// Monaco is a multi-megabyte chunk. This module only loads when the first
// editor opens, so the welcome screen and shell paint immediately at startup.
initMonaco();

function resolveTheme(theme: 'dark' | 'light' | 'system' | undefined): 'forge-dark' | 'forge-light' {
  if (theme === 'light') return 'forge-light';
  if (
    theme === 'system' &&
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    return 'forge-light';
  }
  return 'forge-dark';
}

function languageId(tab: EditorTab): string {
  const path = tab.path ?? '';
  if (path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.jsx')) return 'javascript';
  return tab.language ?? 'plaintext';
}

type EditorMarker = {
  severity: number;
  startLineNumber: number;
  startColumn: number;
  message: string;
  source?: string;
};

const SEVERITY: Record<number, ProblemItem['severity']> = {
  8: 'error',
  4: 'warning',
  2: 'info',
  1: 'info',
};

export function MonacoEditor({
  tab,
  readOnly = false,
  focus = false,
}: {
  tab: EditorTab;
  readOnly?: boolean;
  focus?: boolean;
}) {
  const settings = useAppStore((state) => state.settings);
  const reveal = useAppStore((state) => state.reveal);
  const setTabContent = useAppStore((state) => state.setTabContent);
  const setProblems = useAppStore((state) => state.setProblems);
  const setCursor = useAppStore((state) => state.setCursor);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const disposables = useRef<Array<{ dispose: () => void }>>([]);
  const [ready, setReady] = useState(false);

  // The editor surface is reused when switching tabs, so menu actions must read
  // the current tab at run time rather than the one captured at mount.
  const tabRef = useRef(tab);

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const theme = resolveTheme(settings?.theme);
  const options = settings
    ? createEditorOptions(settings)
    : { fontFamily: 'monospace', fontSize: 13, automaticLayout: true };

  const dirty = tab.kind === 'file' && tab.content !== tab.saved;

  useEffect(() => {
    return () => {
      for (const disposable of disposables.current) disposable.dispose();
      disposables.current = [];
      setActiveEditor(null);
    };
  }, []);

  // Auto save: debounce writes while the user keeps typing.
  useEffect(() => {
    const autoSave = settings?.editor.autoSave ?? 'off';
    if (autoSave !== 'afterDelay' || !dirty || readOnly) return;
    const delay = settings?.editor.autoSaveDelayMs ?? 1000;
    const timer = window.setTimeout(() => void useAppStore.getState().saveTab(tab.id), delay);
    return () => window.clearTimeout(timer);
  }, [dirty, readOnly, settings?.editor.autoSave, settings?.editor.autoSaveDelayMs, tab.id, tab.content]);

  // "Open in Browser" only belongs to markup files, so it is added per tab.
  useEffect(() => {
    const editor = editorRef.current;
    const path = tab.path ?? '';
    if (!editor || !ready || !isHtmlFile(path)) return;
    const added: Array<{ dispose: () => void }> = [];
    const add = (id: string, label: string, order: number, browserId?: string) => {
      added.push(
        editor.addAction({
          id,
          label,
          contextMenuGroupId: '9_forge_open',
          contextMenuOrder: order,
          run: () => {
            void openInBrowser(tabRef.current.path ?? path, browserId);
          },
        }),
      );
    };
    add('forge.openInBrowser', 'Open in Browser', 0);
    let cancelled = false;
    void installedBrowsers().then((list) => {
      if (cancelled) return;
      list
        .filter((browser) => browser.available && browser.id !== 'default')
        .slice(0, 6)
        .forEach((browser, index) => {
          add(`forge.openInBrowser.${browser.id}`, `Open in ${browser.name}`, index + 1, browser.id);
        });
    });
    return () => {
      cancelled = true;
      for (const action of added) action.dispose();
    };
  }, [ready, tab.path]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal) return;
    if (tab.path !== reveal.path) return;
    if (!editor.getModel()) return;
    editor.revealPositionInCenter({ lineNumber: reveal.line, column: 1 });
    editor.setPosition({ lineNumber: reveal.line, column: 1 });
    editor.focus();
  }, [reveal, tab.path]);

  useEffect(() => {
    if (!focus) return;
    editorRef.current?.focus();
  }, [focus, tab.id]);

  const onMount: OnMount = (editor, monacoApi) => {
    editorRef.current = editor;
    setActiveEditor(editor);
    if (readOnly) editor.updateOptions({ readOnly: true });

    disposables.current.push(
      editor.onDidFocusEditorText(() => setActiveEditor(editor)),
      editor.onDidChangeCursorPosition((event) => {
        setCursor(event.position.lineNumber, event.position.column);
      }),
    );

    const syncMarkers = () => {
      const model = editor.getModel();
      if (!model) return;
      const markers = monacoApi.editor.getModelMarkers({ resource: model.uri }) as EditorMarker[];
      const problems: ProblemItem[] = markers
        .filter((marker) => marker.severity >= 2)
        .map((marker) => ({
          path: tab.path ?? 'untitled',
          line: marker.startLineNumber,
          column: marker.startColumn,
          message: marker.message,
          severity: SEVERITY[marker.severity] ?? 'info',
          source: marker.source ?? 'editor',
        }));
      setProblems(tab.path ?? 'untitled', problems);
    };

    disposables.current.push(monacoApi.editor.onDidChangeMarkers(syncMarkers));
    window.setTimeout(syncMarkers, 900);

    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      void useAppStore.getState().saveTab(tab.id);
    });
    const runQuickEdit = (action: QuickEditState['action']) => {
      const model = editor.getModel();
      if (!model) return;
      const selection = editor.getSelection();
      const hasSelection = Boolean(selection && !selection.isEmpty());
      const code = selection && hasSelection ? model.getValueInRange(selection) : model.getValue();
      useAppStore
        .getState()
        .openQuickEdit(
          action,
          code,
          model.getLanguageId(),
          tabRef.current.path ?? '',
          action !== 'explain' && action !== 'docs' ? hasSelection : false,
        );
    };

    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyK, () => {
      runQuickEdit('refactor');
    });
    editor.addCommand(monacoApi.KeyMod.Shift | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyF, () => {
      void editor.getAction('editor.action.formatDocument')?.run();
    });

    // Right-click menu: Monaco already contributes navigation, the clipboard
    // actions and a few edits, so only the gaps are filled here — anything that
    // would repeat a built-in entry (Format Document, Rename Symbol) is skipped.
    const menu = (id: string, label: string, group: string, order: number, run: () => void) => {
      disposables.current.push(
        editor.addAction({ id, label, contextMenuGroupId: group, contextMenuOrder: order, run }),
      );
    };
    const runBuiltIn = (actionId: string) => {
      void editor.getAction(actionId)?.run();
    };
    const currentPath = () => tabRef.current.path ?? '';

    menu('forge.find', 'Find…', '5_forge_find', 0, () => runBuiltIn('actions.find'));
    menu('forge.replace', 'Replace…', '5_forge_find', 1, () => runBuiltIn('editor.action.startFindReplaceAction'));
    menu('forge.selectAll', 'Select All', '5_forge_find', 2, () => runBuiltIn('editor.action.selectAll'));
    menu('forge.comment', 'Toggle Line Comment', '6_forge_modify', 0, () => runBuiltIn('editor.action.commentLine'));
    menu('forge.copyAbsolutePath', 'Copy Absolute Path', '7_forge_file', 0, () => {
      void copyToClipboard(absolutePath(currentPath()), 'absolute path');
    });
    menu('forge.copyRelativePath', 'Copy Relative Path', '7_forge_file', 1, () => {
      void copyToClipboard(currentPath(), 'relative path');
    });
    menu('forge.reveal', 'Reveal in File Manager', '7_forge_file', 2, () => void revealInFileManager(currentPath()));
    menu('forge.explain', 'Explain Selection', '8_forge_ai', 0, () => runQuickEdit('explain'));
    menu('forge.inlineEdit', 'Inline AI Edit', '8_forge_ai', 1, () => runQuickEdit('refactor'));
    menu('forge.tests', 'Generate Tests', '8_forge_ai', 2, () => runQuickEdit('tests'));
    menu('forge.docs', 'Generate Documentation', '8_forge_ai', 3, () => runQuickEdit('docs'));
    menu('forge.attach', 'Attach File to AI Chat', '8_forge_ai', 4, () => {
      const path = currentPath();
      if (!path) return;
      const state = useAppStore.getState();
      state.addContextFile(path);
      state.toast('info', `Attached ${path.split('/').pop() ?? path} to the chat context`);
    });

    setReady(true);

    if (reveal && reveal.path === tab.path) {
      editor.revealPositionInCenter({ lineNumber: reveal.line, column: 1 });
      editor.setPosition({ lineNumber: reveal.line, column: 1 });
    }
  };

  return (
    <div className="h-full w-full overflow-hidden">
      <Editor
        path={`file:///${tab.path ?? tab.id}`}
        value={tab.content ?? ''}
        language={languageId(tab)}
        theme={theme}
        options={options}
        loading={
          <div className="flex h-full items-center justify-center text-[11.5px] text-faint">Loading editor…</div>
        }
        onMount={onMount}
        onChange={(value) => {
          if (readOnly) return;
          setTabContent(tab.id, value ?? '');
        }}
      />
    </div>
  );
}
