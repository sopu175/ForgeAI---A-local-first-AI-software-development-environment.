import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/app';
import { Modal, ModalHeader } from './ui';

export function PromptDialog() {
  const prompt = useAppStore((state) => state.prompt);
  const closePrompt = useAppStore((state) => state.closePrompt);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompt) {
      setValue(prompt.initial ?? '');
      setBusy(false);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 40);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [prompt]);

  if (!prompt) return null;

  const submit = async () => {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await prompt.onSubmit(trimmed);
      closePrompt();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closePrompt} width={460}>
      <ModalHeader title={prompt.title} subtitle={prompt.message} onClose={closePrompt} />
      <div className="px-5 py-4">
        <input
          ref={inputRef}
          value={value}
          placeholder={prompt.placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="h-9 w-full text-[13px]"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
            if (event.key === 'Escape') closePrompt();
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
        <button type="button" className="btn btn-ghost" onClick={closePrompt}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!value.trim() || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Working…' : (prompt.submitLabel ?? 'Create')}
        </button>
      </div>
    </Modal>
  );
}

export function ConfirmDialog() {
  const confirm = useAppStore((state) => state.confirm);
  const closeConfirm = useAppStore((state) => state.closeConfirm);
  const [busy, setBusy] = useState(false);

  useEffect(() => setBusy(false), [confirm]);

  if (!confirm) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await confirm.action();
      closeConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeConfirm} width={440}>
      <ModalHeader title={confirm.title} onClose={closeConfirm} />
      <div className="px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted">{confirm.message}</p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
        <button type="button" className="btn btn-ghost" onClick={closeConfirm}>
          Cancel
        </button>
        <button
          type="button"
          className={confirm.danger ? 'btn btn-danger' : 'btn btn-primary'}
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? 'Working…' : confirm.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
