import { X } from 'lucide-react';
import { useAppStore } from '../state/app';
import { cn, ToastIcon } from './ui';

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-8 right-3 z-[80] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-bg-elevated px-3 py-2.5 shadow-soft',
            toast.kind === 'error'
              ? 'border-[color-mix(in_srgb,var(--danger)_35%,transparent)]'
              : toast.kind === 'success'
                ? 'border-[color-mix(in_srgb,var(--success)_30%,transparent)]'
                : 'border-line',
          )}
          role="status"
        >
          <span className="mt-[1px] shrink-0">
            <ToastIcon kind={toast.kind} />
          </span>
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-fg">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="focus-ring -mr-1 -mt-0.5 shrink-0 rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
            aria-label="Dismiss notification"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
