import { useEffect, useRef, useState } from 'react';
import { Plus, SquareTerminal, Trash2 } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useAppStore } from '../state/app';
import { errorMessage } from '../lib/format';
import { subscribeTerminalCommands } from '../lib/terminalBus';

function terminalTheme(light: boolean) {
  return light
    ? {
        background: '#ffffff',
        foreground: '#333333',
        cursor: '#005fb8',
        selectionBackground: '#add6ff',
        black: '#000000',
        red: '#cd3131',
        green: '#00bc00',
        yellow: '#949800',
        blue: '#0451a5',
        magenta: '#bc05bc',
        cyan: '#0598bc',
        white: '#555555',
      }
    : {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
      };
}

/**
 * xterm is a sizeable dependency. This module is only imported when the
 * terminal is used, so it never delays the initial shell paint.
 */
export function TerminalPanel() {
  const project = useAppStore((state) => state.project);
  const settings = useAppStore((state) => state.settings);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const idRef = useRef<string | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [shell, setShell] = useState('');
  const [session, setSession] = useState(0);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setExited(false);
    const term = new Terminal({
      fontFamily: 'var(--font-code), ui-monospace, monospace',
      fontSize: settings?.terminal?.fontSize ?? settings?.codeFontSize ?? 13,
      lineHeight: 1.25,
      cursorBlink: settings?.terminal?.cursorBlink ?? true,
      cursorStyle: 'bar',
      allowTransparency: true,
      scrollback: 5000,
      theme: terminalTheme(settings?.theme === 'light'),
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // Hidden panels have no measurable size yet.
    }
    termRef.current = term;
    fitRef.current = fit;
    term.writeln('\x1b[38;5;244mForgeAI terminal — local shell\x1b[0m');

    let disposed = false;
    const pending: string[] = [];
    // A login shell prints its prompt only after the rc files have run. Anything
    // typed before that is swallowed, so queued commands wait for the output to
    // go quiet, with a hard fallback so a silent shell still gets them.
    let shellReady = false;
    let settle: number | undefined;
    const flush = () => {
      const id = idRef.current;
      if (!id) return;
      while (pending.length > 0) {
        const command = pending.shift();
        if (command) void window.forge.terminal.write(id, `${command}\r`).catch(() => undefined);
      }
    };
    const makeReady = () => {
      shellReady = true;
      flush();
    };
    const offData = window.forge.events.on('terminal:data', (payload) => {
      if (payload.id !== idRef.current) return;
      term.write(payload.data);
      if (shellReady) return;
      if (settle !== undefined) window.clearTimeout(settle);
      settle = window.setTimeout(makeReady, 300);
    });
    const offExit = window.forge.events.on('terminal:exit', (payload) => {
      if (payload.id !== idRef.current) return;
      setExited(true);
      term.writeln(`\r\n\x1b[38;5;244m[process exited with code ${payload.exitCode}]\x1b[0m`);
    });
    const offCommands = subscribeTerminalCommands((command) => {
      if (idRef.current && shellReady)
        void window.forge.terminal.write(idRef.current, `${command}\r`).catch(() => undefined);
      else pending.push(command);
    });

    const onData = term.onData((data) => {
      if (idRef.current) void window.forge.terminal.write(idRef.current, data).catch(() => undefined);
    });

    void window.forge.terminal
      .create({ cols: term.cols, rows: term.rows })
      .then(({ id, shell: shellName }) => {
        if (disposed) {
          void window.forge.terminal.dispose(id).catch(() => undefined);
          return;
        }
        idRef.current = id;
        setShell(shellName);
        if (settle !== undefined) window.clearTimeout(settle);
        settle = window.setTimeout(makeReady, 1500);
      })
      .catch((error) => {
        term.writeln(`\r\n\x1b[31mCould not start a shell: ${errorMessage(error)}\x1b[0m`);
        makeReady();
      });

    const observer = new ResizeObserver(() => {
      if (!hostRef.current || hostRef.current.offsetParent === null) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (idRef.current) void window.forge.terminal.resize(idRef.current, term.cols, term.rows).catch(() => undefined);
    });
    observer.observe(host);

    return () => {
      disposed = true;
      if (settle !== undefined) window.clearTimeout(settle);
      observer.disconnect();
      offData();
      offExit();
      offCommands();
      onData.dispose();
      const id = idRef.current;
      idRef.current = null;
      if (id) void window.forge.terminal.dispose(id).catch(() => undefined);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Re-create the shell when the folder or explicit "new terminal" changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, session]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalTheme(settings?.theme === 'light');
    term.options.fontSize = settings?.terminal?.fontSize ?? settings?.codeFontSize ?? 13;
    term.options.cursorBlink = settings?.terminal?.cursorBlink ?? true;
    try {
      fitRef.current?.fit();
    } catch {
      // ignore
    }
  }, [settings?.theme, settings?.codeFontSize, settings?.terminal?.fontSize, settings?.terminal?.cursorBlink]);

  const clear = () => {
    termRef.current?.clear();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 flex-none items-center gap-1 border-b border-line-soft px-2 text-[10.5px] text-muted">
        <SquareTerminal size={12} className="text-accent" />
        <span className="mono">{shell || 'shell'}</span>
        {exited ? <span className="chip chip-danger">exited</span> : null}
        {project ? <span className="truncate text-faint">{project.root}</span> : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="focus-ring rounded p-1 hover:bg-panel-3 hover:text-fg"
            title="Clear"
            onClick={clear}
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            className="focus-ring rounded p-1 hover:bg-panel-3 hover:text-fg"
            title="New terminal"
            onClick={() => setSession((value) => value + 1)}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  );
}
