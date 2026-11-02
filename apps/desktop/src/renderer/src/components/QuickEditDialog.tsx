import { useEffect, useRef } from 'react';
import { Clipboard, Sparkles, Wand2 } from 'lucide-react';
import { useAppStore } from '../state/app';
import { errorMessage } from '../lib/format';
import { Markdown } from './Markdown';
import { Modal, ModalHeader, Spinner, cn } from './ui';

const ACTION_TITLES: Record<string, string> = {
  explain: 'Explain selection',
  refactor: 'Refactor selection',
  tests: 'Generate tests',
  docs: 'Write documentation',
};

/** Quick-edit surface for explain/refactor/tests/docs on the current selection. */
export function QuickEditDialog() {
  const quickEdit = useAppStore((state) => state.quickEdit);
  const runQuickEdit = useAppStore((state) => state.runQuickEdit);
  const closeQuickEdit = useAppStore((state) => state.closeQuickEdit);
  const applyQuickEditResult = useAppStore((state) => state.applyQuickEditResult);
  const toast = useAppStore((state) => state.toast);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!quickEdit) {
      started.current = null;
      return;
    }
    const key = `${quickEdit.action}:${quickEdit.path}:${quickEdit.code.length}`;
    if (quickEdit.loading || quickEdit.result || quickEdit.error) return;
    if (started.current === key) return;
    started.current = key;
    void runQuickEdit();
  }, [quickEdit, runQuickEdit]);

  if (!quickEdit) return null;

  const canApply = quickEdit.action !== 'explain';
  const isCode = quickEdit.action === 'refactor' || quickEdit.action === 'tests';

  return (
    <Modal onClose={closeQuickEdit} width={760} className="max-h-[82vh] overflow-hidden">
      <ModalHeader
        title={ACTION_TITLES[quickEdit.action] ?? 'AI edit'}
        subtitle={`${quickEdit.path}${quickEdit.replaceSelection ? ' · selection' : ' · whole file'}`}
        icon={<Wand2 size={17} />}
        onClose={closeQuickEdit}
      />
      <div className="max-h-[calc(82vh-118px)] overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-line-soft px-5 py-2 text-[11px] text-muted">
          <Sparkles size={11} className="text-accent" />
          <span className="capitalize">{quickEdit.action}</span>
          <span className="text-faint">·</span>
          <span>{quickEdit.language}</span>
          <span className="ml-auto">{quickEdit.loading ? 'Thinking…' : quickEdit.result ? 'Ready' : ''}</span>
        </div>

        <div className="px-5 py-4">
          {quickEdit.loading ? (
            <div className="flex items-center gap-2 py-8 text-[12px] text-muted">
              <Spinner /> Asking the local model. This stays on your machine.
            </div>
          ) : quickEdit.error ? (
            <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-[12px] text-danger">
              {quickEdit.error}
            </div>
          ) : quickEdit.result ? (
            isCode ? (
              <pre className="mono max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-panel p-3 text-[11.5px] leading-relaxed text-fg">
                {quickEdit.result}
              </pre>
            ) : (
              <div className="markdown max-h-[46vh] overflow-y-auto">
                <Markdown>{quickEdit.result}</Markdown>
              </div>
            )
          ) : null}
        </div>

        <details className="border-t border-line-soft px-5 py-2 text-[11px] text-muted">
          <summary className="cursor-pointer select-none">
            Selected code ({quickEdit.code.split('\n').length} lines)
          </summary>
          <pre className="mono mt-2 max-h-[24vh] overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-panel p-2 text-[10.5px]">
            {quickEdit.code.slice(0, 8000)}
          </pre>
        </details>
      </div>

      <div className="flex items-center gap-2 border-t border-line-soft px-5 py-3">
        <button
          type="button"
          className="btn btn-ghost h-7"
          disabled={!quickEdit.result}
          onClick={() => {
            if (!quickEdit.result) return;
            void navigator.clipboard
              .writeText(quickEdit.result)
              .then(() => toast('success', 'Copied to clipboard'))
              .catch((error) => toast('error', errorMessage(error)));
          }}
        >
          <Clipboard size={12} /> Copy
        </button>
        <button
          type="button"
          className="btn btn-ghost h-7"
          onClick={() => void runQuickEdit()}
          disabled={quickEdit.loading}
        >
          Regenerate
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn h-7" onClick={closeQuickEdit}>
            Close
          </button>
          {canApply ? (
            <button
              type="button"
              className={cn('btn btn-primary h-7')}
              onClick={applyQuickEditResult}
              disabled={!quickEdit.result || quickEdit.loading}
            >
              {quickEdit.action === 'refactor' ? 'Apply replacement' : 'Insert at cursor'}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
