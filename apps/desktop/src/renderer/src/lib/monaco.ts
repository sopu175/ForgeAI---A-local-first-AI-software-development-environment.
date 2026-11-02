import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import type { AppSettings } from '@forgeai/shared';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { useAppStore } from '../state/app';

interface MonacoEnvironmentShape {
  getWorker(moduleId: string, label: string): Worker;
}

const environment = self as unknown as { MonacoEnvironment?: MonacoEnvironmentShape };
environment.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

let initialized = false;

export function initMonaco(): void {
  if (initialized) return;
  initialized = true;

  monaco.editor.defineTheme('forge-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: '569cd6' },
      { token: 'keyword.control', foreground: 'c586c0' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'type.identifier', foreground: '4ec9b0' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'identifier', foreground: '9cdcfe' },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'delimiter', foreground: 'd4d4d4' },
      { token: 'tag', foreground: '569cd6' },
      { token: 'attribute.name', foreground: '9cdcfe' },
      { token: 'attribute.value', foreground: 'ce9178' },
      { token: 'regexp', foreground: 'd16969' },
      { token: 'function', foreground: 'dcdcaa' },
      { token: 'constant', foreground: '4fc1ff' },
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#3a3d41',
      'editorCursor.foreground': '#aeafad',
      'editorIndentGuide.background1': '#404040',
      'editorIndentGuide.activeBackground1': '#707070',
      'editorWhitespace.foreground': '#3b3b3b',
      'editorWidget.background': '#252526',
      'editorWidget.border': '#454545',
      'editorSuggestWidget.background': '#252526',
      'editorSuggestWidget.border': '#454545',
      'editorSuggestWidget.selectedBackground': '#04395e',
      'editorHoverWidget.background': '#252526',
      'editorHoverWidget.border': '#454545',
      'editorBracketMatch.background': '#0064001a',
      'editorBracketMatch.border': '#888888',
      'editorGutter.background': '#1e1e1e',
      'editorOverviewRuler.border': '#00000000',
      'scrollbarSlider.background': '#79797966',
      'scrollbarSlider.hoverBackground': '#646464b3',
      'scrollbarSlider.activeBackground': '#bfbfbf66',
      'minimap.background': '#1e1e1e',
      'diffEditor.insertedTextBackground': '#9bb95533',
      'diffEditor.removedTextBackground': '#ff000033',
      'input.background': '#3c3c3c',
      'input.border': '#3c3c3c',
      focusBorder: '#007fd4',
    },
  });

  monaco.editor.defineTheme('forge-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      { token: 'keyword', foreground: '0000ff' },
      { token: 'keyword.control', foreground: 'af00db' },
      { token: 'string', foreground: 'a31515' },
      { token: 'number', foreground: '098658' },
      { token: 'type.identifier', foreground: '267f99' },
      { token: 'type', foreground: '267f99' },
      { token: 'identifier', foreground: '001080' },
      { token: 'variable', foreground: '001080' },
      { token: 'tag', foreground: '800000' },
      { token: 'attribute.name', foreground: 'e50000' },
      { token: 'attribute.value', foreground: '0451a5' },
      { token: 'regexp', foreground: '811f3f' },
      { token: 'function', foreground: '795e26' },
      { token: 'constant', foreground: '0070c1' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#000000',
      'editorLineNumber.foreground': '#237893',
      'editorLineNumber.activeForeground': '#0b216f',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editor.selectionBackground': '#add6ff',
      'editor.inactiveSelectionBackground': '#e5ebf1',
      'editorCursor.foreground': '#000000',
      'editorIndentGuide.background1': '#d3d3d3',
      'editorIndentGuide.activeBackground1': '#939393',
      'editorWidget.background': '#f3f3f3',
      'editorWidget.border': '#c8c8c8',
      'editorSuggestWidget.background': '#f3f3f3',
      'editorSuggestWidget.border': '#c8c8c8',
      'editorSuggestWidget.selectedBackground': '#0060c0',
      'editorGutter.background': '#ffffff',
      'scrollbarSlider.background': '#64646466',
      'scrollbarSlider.hoverBackground': '#646464b3',
      'scrollbarSlider.activeBackground': '#00000099',
      'minimap.background': '#ffffff',
      'diffEditor.insertedTextBackground': '#9bb95533',
      'diffEditor.removedTextBackground': '#ff000033',
      focusBorder: '#0090f1',
    },
  });

  const tsDefaults = monaco.typescript.typescriptDefaults;
  tsDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  });
  tsDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  tsDefaults.setEagerModelSync(true);

  monaco.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    noEmit: true,
  });
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  monaco.typescript.javascriptDefaults.setEagerModelSync(true);

  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    schemaValidation: 'warning',
  });

  registerInlineCompletions();
}

function registerInlineCompletions(): void {
  const languages = [
    'typescript',
    'javascript',
    'typescriptreact',
    'javascriptreact',
    'python',
    'php',
    'go',
    'rust',
    'css',
    'scss',
    'html',
    'json',
    'markdown',
    'yaml',
  ];
  for (const language of languages) {
    monaco.languages.registerInlineCompletionsProvider(language, {
      async provideInlineCompletions(model, position, _context, token) {
        const settings = useAppStore.getState().settings;
        if (!settings?.completion.enabled) return { items: [] };
        if (!useAppStore.getState().project) return { items: [] };
        const lineContent = model.getLineContent(position.lineNumber);
        if (lineContent.trim().length === 0 && position.column === lineContent.length + 1) return { items: [] };
        const prefix = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const suffix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: model.getLineCount(),
          endColumn: model.getLineMaxColumn(model.getLineCount()),
        });
        if (prefix.length < 3) return { items: [] };

        // Keystroke debounce: wait debounceMs and abort if typing continues
        const debounceMs = settings.completion.debounceMs ?? 200;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, debounceMs);
          token.onCancellationRequested(() => {
            clearTimeout(timer);
            resolve();
          });
        });
        if (token.isCancellationRequested) return { items: [] };

        try {
          const response = await window.forge.ai.complete({
            filePath: model.uri.path,
            language: model.getLanguageId(),
            prefix: prefix.slice(-1500),
            suffix: suffix.slice(0, 800),
          });
          if (token.isCancellationRequested || !response.text) return { items: [] };
          return {
            items: [
              {
                insertText: response.text,
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
              },
            ],
          };
        } catch {
          return { items: [] };
        }
      },
      disposeInlineCompletions() {
        // No resources retained between requests.
      },
    });
  }
}

export const editorFontFamily =
  "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace";

export function createEditorOptions(settings: AppSettings): monaco.editor.IStandaloneEditorConstructionOptions {
  const editor = settings.editor;
  const closing = editor.autoClosingBrackets ? 'always' : 'never';
  return {
    fontFamily: editorFontFamily,
    fontSize: settings.codeFontSize,
    fontLigatures: editor.fontLigatures,
    lineHeight: Math.round(settings.codeFontSize * 1.5),
    minimap: { enabled: settings.editorMinimap, renderCharacters: false, maxColumn: 90 },
    wordWrap: settings.wordWrap ? 'on' : 'off',
    smoothScrolling: editor.smoothScrolling,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: 'all',
    padding: { top: 8, bottom: 16 },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: editor.tabSize,
    insertSpaces: editor.insertSpaces,
    detectIndentation: editor.detectIndentation,
    autoIndent: 'full',
    formatOnPaste: true,
    formatOnType: true,
    bracketPairColorization: { enabled: editor.bracketPairColorization },
    guides: { bracketPairs: editor.bracketPairColorization, indentation: true },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    stickyScroll: { enabled: editor.stickyScroll },
    lineNumbers: editor.lineNumbers,
    renderWhitespace: editor.renderWhitespace,
    inlineSuggest: { enabled: settings.completion.enabled, showToolbar: 'onHover' },
    suggest: { preview: true, showWords: false, insertMode: 'replace' },
    snippetSuggestions: 'top',
    acceptSuggestionOnEnter: 'smart',
    quickSuggestions: { other: editor.suggestOnTyping, comments: false, strings: editor.suggestOnTyping },
    autoClosingBrackets: closing,
    autoClosingQuotes: closing,
    autoSurround: editor.autoClosingBrackets ? 'languageDefined' : 'never',
    overviewRulerBorder: false,
    fixedOverflowWidgets: true,
    contextmenu: true,
    multiCursorModifier: editor.multiCursorModifier,
    multiCursorLimit: 10000,
    maxTokenizationLineLength: 20000,
    stopRenderingLineAfter: 10000,
    cursorSurroundingLines: 3,
    fastScrollSensitivity: 6,
    foldingStrategy: 'indentation',
    renderControlCharacters: false,
    dragAndDrop: true,
    links: true,
    colorDecorators: true,
  };
}

export { monaco };
