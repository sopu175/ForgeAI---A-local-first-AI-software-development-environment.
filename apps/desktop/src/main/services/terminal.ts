import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import * as pty from 'node-pty';
import { nanoid } from 'nanoid';
import type { Broadcast, WorkspaceService } from './workspace';

interface Session {
  id: string;
  cwd: string;
  title: string;
  shell: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

class PtySession implements Session {
  readonly id: string;
  readonly title: string;
  readonly shell: string;

  constructor(
    id: string,
    private readonly process: pty.IPty,
    readonly cwd: string,
    shell: string,
    private readonly broadcast: Broadcast,
  ) {
    this.id = id;
    this.shell = shell;
    this.title = shellName(shell);
    this.process.onData((data) => broadcast('terminal:data', { id, data }));
    this.process.onExit(({ exitCode }) => {
      broadcast('terminal:exit', { id, exitCode });
    });
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(Math.max(2, cols), Math.max(2, rows));
  }

  dispose(): void {
    try {
      this.process.kill();
    } catch {
      // already exited
    }
  }
}

class PipeSession implements Session {
  readonly title: string;
  readonly shell: string;
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(
    readonly id: string,
    command: string,
    readonly cwd: string,
    broadcast: Broadcast,
  ) {
    this.shell = command;
    this.title = `${shellName(command)} (pipe)`;
    this.child = spawn(command, [], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', FORGEAI: '1' },
      stdio: 'pipe',
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (data: string) => broadcast('terminal:data', { id, data }));
    this.child.stderr.on('data', (data: string) => broadcast('terminal:data', { id, data }));
    this.child.on('exit', (code) => broadcast('terminal:exit', { id, exitCode: code ?? 0 }));
  }

  write(data: string): void {
    // xterm sends \r for Enter; a piped shell only executes on \n.
    this.child.stdin.write(data.endsWith('\r') ? `${data.slice(0, -1)}\n` : data);
  }

  resize(): void {
    // Pipe-backed terminals have no PTY window size.
  }

  dispose(): void {
    this.child.kill();
  }
}

export class TerminalService {
  private sessions = new Map<string, Session>();
  private counter = 0;

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly broadcast: Broadcast,
  ) {}

  create(options: { cwd?: string; cols?: number; rows?: number } = {}): { id: string; shell: string } {
    const cwd = options.cwd ? this.workspace.root : this.workspace.root;
    const shell = defaultShell();
    const cols = Math.max(2, options.cols ?? 100);
    const rows = Math.max(2, options.rows ?? 30);
    const id = `term-${++this.counter}-${nanoid(6)}`;
    let session: Session;
    try {
      const child = pty.spawn(shell, shellArgs(shell), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', FORGEAI: '1', COLORTERM: 'truecolor' },
      });
      session = new PtySession(id, child, cwd, shell, this.broadcast);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = new PipeSession(id, shell, cwd, this.broadcast);
      // Nothing typed into a pipe-mode shell is echoed, so say so on the output
      // stream where the user can actually see it.
      this.broadcast('terminal:data', {
        id,
        data: `\r\n\x1b[33mForgeAI: no PTY available (${message}) — pipe mode, commands run but there is no echo or prompt.\x1b[0m\r\n`,
      });
      session = fallback;
    }
    this.sessions.set(id, session);
    return { id, shell: session.shell };
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  dispose(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.dispose();
    this.sessions.delete(id);
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }

  list(): Array<{ id: string; cwd: string; title: string }> {
    return [...this.sessions.values()].map((session) => ({ id: session.id, cwd: session.cwd, title: session.title }));
  }
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

function shellArgs(shell: string): string[] {
  if (process.platform === 'win32') return [];
  const name = shell.toLowerCase();
  if (name.includes('zsh') || name.includes('bash')) return ['-l'];
  return [];
}

function shellName(shell: string): string {
  return shell.split(/[\\/]/).pop() || shell || os.platform();
}
