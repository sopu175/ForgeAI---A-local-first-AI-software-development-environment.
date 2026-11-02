import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches any unhandled render errors and shows a
 * recovery UI instead of a blank screen. The user can reload the renderer
 * without restarting the whole Electron process.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to the console so the main-process devtools can capture it.
    console.error('[ForgeAI] Unhandled render error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    // Reset state first so React tries to re-render; if the component tree
    // recovers the boundary clears itself transparently.
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg p-8 text-fg">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger/20 text-2xl text-danger">✕</div>
        <div className="max-w-md text-center">
          <h1 className="text-[15px] font-semibold text-fg-strong">Something went wrong</h1>
          <p className="mt-1 text-[12px] text-muted">
            An unexpected error crashed part of the UI. Your files are safe — this only affects the display.
          </p>
          <pre className="mt-3 max-h-36 overflow-auto rounded bg-surface px-3 py-2 text-left text-[11px] text-danger">
            {error.message}
          </pre>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded bg-accent px-4 py-1.5 text-[12px] font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Try to recover
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-border px-4 py-1.5 text-[12px] font-medium text-fg hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Reload window
          </button>
        </div>
      </div>
    );
  }
}
