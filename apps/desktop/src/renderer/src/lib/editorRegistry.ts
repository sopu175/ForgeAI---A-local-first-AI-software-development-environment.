import type * as monaco from 'monaco-editor';

let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null;

export function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
  activeEditor = editor;
}

export function getActiveEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor;
}

export function activeSelection(): {
  code: string;
  language: string;
  path: string;
  hasSelection: boolean;
} | null {
  const editor = activeEditor;
  if (!editor) return null;
  const model = editor.getModel();
  if (!model) return null;
  const selection = editor.getSelection();
  const code = selection && !selection.isEmpty() ? model.getValueInRange(selection) : model.getValue();
  return {
    code,
    language: model.getLanguageId(),
    path: model.uri.path.replace(/^\//, ''),
    hasSelection: Boolean(selection && !selection.isEmpty()),
  };
}

export function applyEditToActive(text: string, replaceSelection: boolean): boolean {
  const editor = activeEditor;
  if (!editor) return false;
  const model = editor.getModel();
  if (!model) return false;
  const selection = editor.getSelection();
  if (replaceSelection && selection && !selection.isEmpty()) {
    editor.executeEdits('forgeai', [{ range: selection, text, forceMoveMarkers: true }]);
  } else {
    const position = editor.getPosition();
    if (!position) return false;
    editor.executeEdits('forgeai', [
      {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        text,
        forceMoveMarkers: true,
      },
    ]);
  }
  editor.focus();
  return true;
}

export function revealRange(editor: monaco.editor.IStandaloneCodeEditor, line: number, column = 1): void {
  editor.revealPositionInCenter({ lineNumber: line, column });
  editor.setPosition({ lineNumber: line, column });
  editor.focus();
}
