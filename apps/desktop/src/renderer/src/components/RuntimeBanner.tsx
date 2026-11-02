import { AlertTriangle, ChevronRight, Download, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../state/app';
import { bytes } from '../lib/format';
import { ProgressBar, Spinner } from './ui';

const BUSY = new Set(['checking', 'starting', 'installing', 'pulling']);

function stageLabel(stage: string): string {
  switch (stage) {
    case 'checking':
      return 'Looking for Ollama…';
    case 'starting':
      return 'Starting the local Ollama server…';
    case 'installing':
      return 'Installing the Ollama runtime…';
    case 'pulling':
      return 'Downloading the default model…';
    case 'error':
      return 'Local model setup needs attention';
    case 'cancelled':
      return 'Local model setup cancelled';
    default:
      return 'Local model';
  }
}

/**
 * Slim, always-visible bootstrap banner for the default local model. It is
 * hidden once qwen3.5:4b is ready, and offers a retry path on failures.
 */
export function RuntimeBanner() {
  const runtime = useAppStore((state) => state.runtime);
  const ensureRuntime = useAppStore((state) => state.ensureRuntime);
  const cancelRuntime = useAppStore((state) => state.cancelRuntime);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);

  if (!runtime || runtime.stage === 'idle' || runtime.stage === 'ready') return null;

  const busy = BUSY.has(runtime.stage);
  const failed = runtime.stage === 'error';
  const cancelled = runtime.stage === 'cancelled';
  const progress = runtime.percent;
  const size =
    runtime.completedBytes && runtime.totalBytes
      ? `${bytes(runtime.completedBytes)} / ${bytes(runtime.totalBytes)}`
      : undefined;

  return (
    <div
      className={
        failed
          ? 'flex flex-none items-center gap-2 border-b border-danger/30 bg-danger-soft px-3 py-1.5 text-[11.5px] text-fg'
          : 'flex flex-none items-center gap-2 border-b border-line-soft bg-panel-2 px-3 py-1.5 text-[11.5px] text-fg'
      }
      role="status"
    >
      {busy ? <Spinner className="!h-3 !w-3" /> : null}
      {failed ? <AlertTriangle size={13} className="shrink-0 text-danger" /> : null}
      {!busy && !failed ? <Download size={12} className="shrink-0 text-muted" /> : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 font-medium text-fg-strong">
          {runtime.model}
          <span className="ml-2 font-normal text-muted">{stageLabel(runtime.stage)}</span>
        </span>
        <span className="truncate text-muted">
          {failed || cancelled ? (runtime.error ?? runtime.detail ?? '') : (runtime.detail ?? '')}
          {size ? ` · ${size}` : ''}
        </span>
        {progress !== undefined && busy ? (
          <div className="w-28 shrink-0">
            <ProgressBar value={progress} />
          </div>
        ) : null}
        {failed || cancelled ? (
          <>
            <button type="button" className="btn btn-ghost h-6 px-2 text-[11px]" onClick={() => void ensureRuntime()}>
              <RefreshCw size={11} /> Retry
            </button>
            <button type="button" className="btn btn-ghost h-6 px-2 text-[11px]" onClick={() => setModelsOpen(true)}>
              Model manager <ChevronRight size={11} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost ml-auto h-6 px-2 text-[11px]"
            onClick={() => void cancelRuntime()}
            title="Stop downloading"
          >
            <X size={11} /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}
