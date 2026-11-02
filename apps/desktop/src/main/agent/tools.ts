import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import type { AgentEvent, AgentKind, FileChange, ToolSchema } from '@forgeai/shared';
import { createFileChange, applySelectedHunks, compactFileTree, suggestedCommands } from '@forgeai/core';
import { formatBytes, languageFromPath, truncateEnd } from '@forgeai/shared';
import type { AgentCheckpointHandle, CheckpointService } from '../services/checkpoints';
import type { IndexerService } from '../services/indexer';
import type { SearchService } from '../services/search';
import type { GitService } from '../services/git';
import type { WorkspaceService } from '../services/workspace';
import type { PermissionBroker } from '../permissions';
import type { Database } from '../db';

export class ToolDenied extends Error {
  constructor(message = 'The user denied this action.') {
    super(message);
    this.name = 'ToolDenied';
  }
}

export interface ToolContext {
  runId: string;
  projectId: string;
  agent: AgentKind;
  workspace: WorkspaceService;
  search: SearchService;
  git: GitService;
  indexer: IndexerService;
  permissions: PermissionBroker;
  db: Database;
  checkpoint: AgentCheckpointHandle | null;
  checkpoints: CheckpointService;
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  changedFiles: Map<string, FileChange>;
  commandsRun: string[];
  /** Reads already served in this run, used to stop small models looping on files. */
  reads?: Map<string, number>;
  specFeature?: string;
  specTaskId?: string;
  updateTask?: (taskId: string, status: 'in_progress' | 'done' | 'failed', note?: string) => Promise<string>;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
  agents?: AgentKind[];
  schema: z.ZodType;
  execute(context: ToolContext, args: unknown): Promise<string>;
}

const relativePath = z.string().min(1).max(1024);
const SECRET_PATH =
  /(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519|ecdsa)|credentials\.json$|(^|\/)\.npmrc$|(^|\/)\.netrc$/i;

function assertNotSecret(filePath: string): void {
  if (SECRET_PATH.test(filePath)) {
    throw new ToolDenied('Secret and credential files are protected. Ask the user to handle this file manually.');
  }
}

function repeatedRead(context: ToolContext, key: string, filePath: string): string | null {
  if (!context.reads) return null;
  const count = (context.reads.get(key) ?? 0) + 1;
  context.reads.set(key, count);
  if (count <= 2) return null;
  return `You already read ${filePath} in this run and it has not changed. Use the earlier observation instead of reading it again, then make the edit or finish with the final answer.`;
}

function forgetReads(context: ToolContext, filePath: string): void {
  if (!context.reads) return;
  for (const key of [...context.reads.keys()]) {
    if (key.startsWith(`${filePath}:`)) context.reads.delete(key);
  }
}

async function readExisting(context: ToolContext, filePath: string): Promise<{ content: string; existed: boolean }> {
  try {
    const file = await context.workspace.readFile(filePath);
    return { content: file.content, existed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file|not found/i.test(message)) return { content: '', existed: false };
    throw error;
  }
}

async function proposeWrite(
  context: ToolContext,
  filePath: string,
  nextContent: string,
  reason: string,
  toolName: string,
): Promise<string> {
  assertNotSecret(filePath);
  if (nextContent.length > 1_500_000) throw new Error('Refusing to write a file larger than 1.5 MB');
  const { content: before, existed } = await readExisting(context, filePath);
  if (before === nextContent) return `${filePath} already matches the requested content. No change written.`;
  const change = createFileChange(filePath, before, nextContent, {
    changeType: existed ? 'update' : 'create',
  });
  const response = await context.permissions.require({
    kind: 'write',
    title: `${existed ? 'Modify' : 'Create'} ${filePath}`,
    detail: reason,
    paths: [filePath],
    diff: [change],
    toolName,
    runId: context.runId,
  });
  if (response.decision !== 'approved') throw new ToolDenied();
  const finalContent = applySelectedHunks(before, change, response.acceptedHunks);
  if (finalContent === before) {
    return 'The user accepted no hunks; the file was left unchanged.';
  }
  if (context.checkpoint) await context.checkpoint.record(filePath, before, existed);
  await context.workspace.writeFile(filePath, finalContent);
  forgetReads(context, filePath);
  context.changedFiles.set(filePath, change);
  context.emit({ type: 'file_change', change });
  return `Wrote ${filePath} (+${change.additions} −${change.deletions}).${response.acceptedHunks ? ' Partial hunks were accepted.' : ''}`;
}

function formatWithLines(content: string, startLine = 1): string {
  return content
    .split('\n')
    .map((line, index) => `${String(startLine + index).padStart(5)} │ ${line}`)
    .join('\n');
}

function isDangerousCommand(command: string): boolean {
  const patterns = [
    /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME|\*)/i,
    /\bmkfs\b/i,
    /\bdiskutil\s+(erase|partition)/i,
    /\bdd\s+if=/i,
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
    /\bshutdown\b|\breboot\b|\bhalt\b/i,
    /\bgit\s+clean\s+-[a-z]*f/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+push\s+--force\b/i,
    /\bnpm\s+publish\b/i,
    /\bcurl\b[^|]*\|\s*(ba|z)?sh/i,
    /\bwget\b[^|]*\|\s*(ba|z)?sh/i,
    /\bsudo\b/i,
    /\bchmod\s+777\s+\//i,
    /\bformat\s+[a-z]:/i,
  ];
  return patterns.some((pattern) => pattern.test(command));
}

export function sanitizeSubprocessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const SENSITIVE_KEY_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PRIVATE|ACCESS_KEY|BEARER)/i;
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // Always preserve vital OS and system environment variables
    const upper = key.toUpperCase();
    if (
      [
        'PATH',
        'HOME',
        'USER',
        'SHELL',
        'TMPDIR',
        'TEMP',
        'TMP',
        'APPDATA',
        'LOCALAPPDATA',
        'SYSTEMROOT',
        'WINDIR',
        'COMSPEC',
        'LANG',
        'LC_ALL',
        'NODE_ENV',
        'TERM',
        'COLORTERM',
      ].includes(upper)
    ) {
      sanitized[key] = value;
      continue;
    }
    // Filter out credentials and sensitive keys from being passed to subprocesses
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function shellCommand(command: string): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    const comspec = process.env.COMSPEC || 'cmd.exe';
    if (comspec.toLowerCase().includes('powershell')) {
      return { shell: comspec, args: ['-NoProfile', '-NonInteractive', '-Command', command] };
    }
    return { shell: comspec, args: ['/d', '/s', '/c', command] };
  }
  const shell = process.env.SHELL || '/bin/zsh';
  return { shell, args: ['-lc', command] };
}

async function runShell(
  context: ToolContext,
  command: string,
  cwdRelative: string | undefined,
  timeoutMs: number,
  options: { toolName?: string; preapproved?: boolean; kind?: 'command' | 'install' } = {},
): Promise<string> {
  const cwd = await context.workspace.resolveSafe(cwdRelative ?? '', false);
  const { shell, args } = shellCommand(command);
  const dangerous = isDangerousCommand(command);
  if (!options.preapproved) {
    const response = await context.permissions.require({
      kind: options.kind ?? 'command',
      title: dangerous ? 'Run potentially destructive command' : 'Run command',
      detail: `Working directory: ${path.relative(context.workspace.root, cwd) || '.'}`,
      command,
      cwd,
      paths: [],
      dangerous,
      toolName: options.toolName ?? 'run_command',
      runId: context.runId,
    });
    if (response.decision !== 'approved') throw new ToolDenied('The user denied this command.');
  }

  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd,
      env: { ...sanitizeSubprocessEnv(process.env), FORGEAI_AGENT: '1', TERM: 'dumb', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const append = (chunk: string) => {
      output += chunk;
      if (output.length > 80_000) output = `${output.slice(0, 60_000)}\n… [output capped]\n${output.slice(-15_000)}`;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const finish = (code: number | null, note = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal.removeEventListener('abort', abort);
      context.commandsRun.push(command);
      const status = code === 0 ? 'exit 0' : `exit ${code ?? 'unknown'}`;
      resolve(`${status}${note ? ` (${note})` : ''}\n${output.trim() || '(no output)'}`);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref?.();
      finish(-1, `timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
    const abort = () => {
      child.kill('SIGTERM');
      finish(-1, 'cancelled');
    };
    if (context.signal.aborted) abort();
    else context.signal.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => {
      append(`\n${error.message}`);
      finish(-1, 'spawn error');
    });
    child.on('close', (code) => finish(code));
  });
}

const readFileTool: AgentTool = {
  name: 'read_file',
  description:
    'Read a UTF-8 file in the workspace with line numbers. Optionally read a line range. Always read before editing.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path, e.g. src/app.tsx' },
      start_line: { type: 'number', description: 'First line, 1-based (optional)' },
      end_line: { type: 'number', description: 'Last line, inclusive (optional)' },
    },
    required: ['path'],
  },
  schema: z.object({
    path: relativePath,
    start_line: z.coerce.number().int().min(1).optional(),
    end_line: z.coerce.number().int().min(1).optional(),
  }),
  async execute(context, raw) {
    const args = raw as { path: string; start_line?: number; end_line?: number };
    assertNotSecret(args.path);
    const repeated = repeatedRead(
      context,
      `${args.path}:${args.start_line ?? 1}-${args.end_line ?? 'auto'}`,
      args.path,
    );
    if (repeated) return repeated;
    const file = await context.workspace.readFile(args.path);
    const lines = file.content.split('\n');
    const start = Math.max(1, args.start_line ?? 1);
    const end = Math.min(lines.length, args.end_line ?? start + 399);
    if (start > lines.length) return `File has ${lines.length} lines; start_line ${start} is out of range.`;
    const slice = lines.slice(start - 1, end).join('\n');
    const note =
      end < lines.length || start > 1
        ? `\n… showing lines ${start}-${end} of ${lines.length}. Use start_line/end_line to read more.`
        : '';
    return `${args.path} (${languageFromPath(args.path)}, ${formatBytes(file.size)})${note ? '' : '\n'}${formatWithLines(slice, start)}${note}`;
  },
};

const readMultipleTool: AgentTool = {
  name: 'read_multiple_files',
  description: 'Read up to 6 files at once. Use when the task clearly spans several known files.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths' },
    },
    required: ['paths'],
  },
  schema: z.object({ paths: z.array(relativePath).min(1).max(6) }),
  async execute(context, raw) {
    const { paths } = raw as { paths: string[] };
    const sections: string[] = [];
    for (const filePath of paths) {
      assertNotSecret(filePath);
      const repeated = repeatedRead(context, `${filePath}:whole`, filePath);
      if (repeated) {
        sections.push(`### ${filePath}\n${repeated}`);
        continue;
      }
      try {
        const file = await context.workspace.readFile(filePath);
        sections.push(`### ${filePath}\n${truncateEnd(formatWithLines(file.content), 9000)}`);
      } catch (error) {
        sections.push(`### ${filePath}\n[error: ${error instanceof Error ? error.message : String(error)}]`);
      }
    }
    return sections.join('\n\n');
  },
};

const listFilesTool: AgentTool = {
  name: 'list_files',
  description:
    'List files and directories under a workspace path. Respects .gitignore and skips dependencies/build output.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory (default: project root)' },
      depth: { type: 'number', description: 'Recursion depth 1-3 (default 1)' },
    },
  },
  schema: z.object({ path: z.string().max(1024).optional(), depth: z.coerce.number().int().min(1).max(3).optional() }),
  async execute(context, raw) {
    const args = raw as { path?: string; depth?: number };
    const depth = args.depth ?? 1;
    const lines: string[] = [];
    const walk = async (dir: string, level: number) => {
      const entries = await context.workspace.list(dir);
      for (const entry of entries) {
        if (lines.length > 500) return;
        lines.push(`${entry.type === 'directory' ? '▸' : '·'} ${entry.path}${entry.type === 'directory' ? '/' : ''}`);
        if (entry.type === 'directory' && level < depth) await walk(entry.path, level + 1);
      }
    };
    await walk(args.path ?? '', 1);
    return lines.join('\n') || '(empty directory)';
  },
};

const searchCodeTool: AgentTool = {
  name: 'search_code',
  description:
    'Fast text search across the project (ripgrep). Returns file:line matches. Literal by default; set regex=true for alternation or patterns.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regex to find' },
      include: { type: 'string', description: 'Optional glob filter, e.g. src/**/*.ts' },
      regex: {
        type: 'boolean',
        description: 'Set true to treat query as a regular expression; default false (literal)',
      },
      case_sensitive: { type: 'boolean' },
      max_results: { type: 'number' },
    },
    required: ['query'],
  },
  schema: z.object({
    query: z.string().min(1).max(500),
    include: z.string().max(200).optional(),
    regex: z.boolean().optional(),
    case_sensitive: z.boolean().optional(),
    max_results: z.coerce.number().int().min(1).max(200).optional(),
  }),
  async execute(context, raw) {
    const args = raw as {
      query: string;
      include?: string;
      regex?: boolean;
      case_sensitive?: boolean;
      max_results?: number;
    };
    const results = await context.search.text({
      query: args.query,
      include: args.include,
      regex: args.regex,
      caseSensitive: args.case_sensitive,
      maxResults: args.max_results ?? 60,
    });
    if (results.length === 0) return `No matches for "${args.query}".`;
    return results
      .map((result) => `${result.path}:${result.line}:${result.column} │ ${result.preview.trim()}`)
      .join('\n');
  },
};

const semanticSearchTool: AgentTool = {
  name: 'semantic_search',
  description: 'Search the indexed project semantically. Best for conceptual questions when exact terms are unknown.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Concept or task to find relevant code for' },
      limit: { type: 'number' },
    },
    required: ['query'],
  },
  schema: z.object({ query: z.string().min(2).max(1000), limit: z.coerce.number().int().min(1).max(20).optional() }),
  async execute(context, raw) {
    const args = raw as { query: string; limit?: number };
    // Pass any open context files so active-file boosting applies to on-demand searches too.
    const results = await context.indexer.search(
      context.projectId,
      args.query,
      args.limit ?? 8,
      context.reads ? [...context.reads.keys()].map((key) => key.split(':')[0] ?? '').filter(Boolean) : [],
    );
    if (results.length === 0) {
      return 'No semantic index results. The project may not be indexed yet; use search_code or read_file.';
    }
    return results
      .map(
        (result) =>
          `### ${result.path} L${result.startLine}-${result.endLine} (${result.reason}, score ${result.score.toFixed(2)})\n${truncateEnd(result.content, 4000)}`,
      )
      .join('\n\n');
  },
};

const symbolsTool: AgentTool = {
  name: 'list_symbols',
  description: 'List classes, functions, methods and types in the project index, optionally filtered by name or path.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Name or path fragment (optional)' } },
  },
  schema: z.object({ query: z.string().max(200).optional() }),
  async execute(context, raw) {
    const { query } = raw as { query?: string };
    const symbols = context.indexer.symbols(context.projectId, query);
    if (symbols.length === 0) return 'No symbols found. The project may not be indexed yet.';
    return symbols
      .slice(0, 120)
      .map(
        (symbol) =>
          `${symbol.kind} ${symbol.container ? `${symbol.container}.` : ''}${symbol.name} — ${symbol.path}:${symbol.line}`,
      )
      .join('\n');
  },
};

const overviewTool: AgentTool = {
  name: 'get_project_overview',
  description:
    'Get a compact overview of the project: stack, structure, entry points, test setup, git state, and key config files.',
  readOnly: true,
  parameters: { type: 'object', properties: {} },
  schema: z.object({}),
  async execute(context) {
    const stack = await context.workspace.getStack();
    const files = await context.search.files('', 400);
    const git = await context.git.status();
    const keyFiles = ['package.json', 'README.md', 'pyproject.toml', 'composer.json', 'go.mod', 'Cargo.toml'];
    const sections: string[] = [
      `Root: ${context.workspace.root}`,
      `Languages: ${stack.languages.join(', ') || 'unknown'}`,
      `Frameworks: ${stack.frameworks.join(', ') || 'none detected'}`,
      `Package managers: ${stack.packageManagers.join(', ') || 'unknown'}`,
      `Test runners: ${stack.testRunners.join(', ') || 'unknown'}`,
      `Entry points: ${stack.entryPoints.join(', ') || 'unknown'}`,
      `Files: ${files.length}${files.length >= 400 ? '+' : ''}`,
      git
        ? `Git: ${git.branch}${git.clean ? ' (clean)' : ` (${git.files.length} changes)`}${git.ahead ? `, ahead ${git.ahead}` : ''}`
        : 'Git: not a repository',
      '',
      'Structure:',
      compactFileTree(files, 250),
    ];
    for (const candidate of keyFiles) {
      try {
        const file = await context.workspace.readFile(candidate);
        sections.push(`\n### ${candidate}\n${truncateEnd(file.content, 4000)}`);
      } catch {
        // optional
      }
    }
    return sections.join('\n');
  },
};

const writeFileTool: AgentTool = {
  name: 'write_file',
  description:
    'Create or fully overwrite a file. Prefer edit_file for small changes. The user reviews a diff and may accept only some hunks.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string', description: 'Complete new file content' },
      reason: { type: 'string', description: 'Why this change is needed' },
    },
    required: ['path', 'content'],
  },
  schema: z.object({ path: relativePath, content: z.string().max(1_500_000), reason: z.string().max(2000).optional() }),
  async execute(context, raw) {
    const args = raw as { path: string; content: string; reason?: string };
    return proposeWrite(context, args.path, args.content, args.reason ?? 'Agent file change', 'write_file');
  },
};

const editFileTool: AgentTool = {
  name: 'edit_file',
  description:
    'Apply one or more exact find/replace edits to a file. Each find string must match exactly once unless replace_all is true. Preferred for surgical changes. Use 1-4 focused edits per call with unique anchors; if any edit fails, none are written.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            find: { type: 'string' },
            replace: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          required: ['find', 'replace'],
        },
      },
      reason: { type: 'string' },
    },
    required: ['path', 'edits'],
  },
  schema: z.object({
    path: relativePath,
    edits: z
      .array(
        z.object({
          find: z.string().min(1).max(60_000),
          replace: z.string().max(60_000),
          replace_all: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(20),
    reason: z.string().max(2000).optional(),
  }),
  async execute(context, raw) {
    const args = raw as {
      path: string;
      edits: Array<{ find: string; replace: string; replace_all?: boolean }>;
      reason?: string;
    };
    assertNotSecret(args.path);
    const { content, existed } = await readExisting(context, args.path);
    if (!existed) throw new Error(`File ${args.path} does not exist. Use write_file to create it.`);
    let next = content;
    for (const [index, edit] of args.edits.entries()) {
      const occurrences = next.split(edit.find).length - 1;
      if (occurrences === 0)
        throw new Error(
          `Edit ${index + 1}: find text not found in ${args.path}. No edits were written. Retry with a smaller batch and copy exact text from the current file.`,
        );
      if (occurrences > 1 && !edit.replace_all) {
        throw new Error(
          `Edit ${index + 1}: find text occurs ${occurrences} times. No edits were written. Retry with a unique anchor that includes surrounding lines, or set replace_all.`,
        );
      }
      next = edit.replace_all ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, edit.replace);
    }
    return proposeWrite(context, args.path, next, args.reason ?? `${args.edits.length} edit(s)`, 'edit_file');
  },
};

const deleteFileTool: AgentTool = {
  name: 'delete_file',
  description: 'Delete a single file. Requires explicit user approval. Never use without a clear reason.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, reason: { type: 'string' } },
    required: ['path', 'reason'],
  },
  schema: z.object({ path: relativePath, reason: z.string().min(1).max(2000) }),
  async execute(context, raw) {
    const args = raw as { path: string; reason: string };
    assertNotSecret(args.path);
    const { content, existed } = await readExisting(context, args.path);
    if (!existed) return `${args.path} does not exist; nothing to delete.`;
    const change = createFileChange(args.path, content, '', { changeType: 'delete' });
    const response = await context.permissions.require({
      kind: 'delete',
      title: `Delete ${args.path}`,
      detail: args.reason,
      paths: [args.path],
      diff: [change],
      toolName: 'delete_file',
      runId: context.runId,
    });
    if (response.decision !== 'approved') throw new ToolDenied();
    if (context.checkpoint) await context.checkpoint.record(args.path, content, true);
    await context.workspace.remove([args.path], true);
    forgetReads(context, args.path);
    context.changedFiles.set(args.path, change);
    context.emit({ type: 'file_change', change });
    return `Deleted ${args.path}.`;
  },
};

const runCommandTool: AgentTool = {
  name: 'run_command',
  description:
    'Run a shell command in the workspace. Requires approval. Use for builds, tests, formatters, linters and diagnostics. Not for long-running servers.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string', description: 'Workspace-relative directory (optional)' },
      timeout_ms: { type: 'number', description: 'Default 120000, max 600000' },
      purpose: { type: 'string' },
    },
    required: ['command'],
  },
  schema: z.object({
    command: z.string().min(1).max(4000),
    cwd: z.string().max(1024).optional(),
    timeout_ms: z.coerce.number().int().min(1000).max(600_000).optional(),
    purpose: z.string().max(1000).optional(),
  }),
  async execute(context, raw) {
    const args = raw as { command: string; cwd?: string; timeout_ms?: number };
    return runShell(context, args.command, args.cwd, args.timeout_ms ?? 120_000);
  },
};

const runTestsTool: AgentTool = {
  name: 'run_tests',
  description: 'Run the project test command, or a specific test command you provide. Requires approval.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' }, timeout_ms: { type: 'number' } },
  },
  schema: z.object({
    command: z.string().min(1).max(2000).optional(),
    timeout_ms: z.coerce.number().int().min(1000).max(600_000).optional(),
  }),
  async execute(context, raw) {
    const args = raw as { command?: string; timeout_ms?: number };
    let command = args.command;
    if (!command) {
      const stack = await context.workspace.getStack();
      const test = suggestedCommands(stack).find((entry) => entry.label === 'Test');
      if (!test) throw new Error('Could not detect a test command. Provide one explicitly.');
      command = test.command;
    }
    return runShell(context, command, undefined, args.timeout_ms ?? 300_000, { toolName: 'run_tests' });
  },
};

/**
 * Returns true if the install command appears to pull a package from a non-registry
 * source (URL, local path with traversal, `file:` protocol, or a known suspicious
 * pattern). These are flagged `dangerous` so the permission broker always requires
 * an explicit human decision regardless of the approval policy.
 */
function isDangerousInstall(command: string): boolean {
  const patterns = [
    /https?:\/\//i, // npm install http://evil.com/pkg
    /file:\.\./i, // file:../../something
    /\bgit\+https?:/i, // git+https://
    /\bgit\+ssh:/i, // git+ssh://
    /\bssh:/i,
    /(^|\s)\.\.[\\/]/, // relative path traversal
    /\btar\b.*\.tgz/i, // tarball installs
    /@[^/]+\/[^@\s]+@https?:\/\//i, // scoped pkg with URL version
  ];
  return patterns.some((pattern) => pattern.test(command));
}

const installDepsTool: AgentTool = {
  name: 'install_dependencies',
  description: 'Install project dependencies using the detected package manager. Requires approval.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' }, reason: { type: 'string' } },
  },
  schema: z.object({ command: z.string().min(1).max(2000).optional(), reason: z.string().max(1000).optional() }),
  async execute(context, raw) {
    const args = raw as { command?: string; reason?: string };
    let command = args.command;
    if (!command) {
      const stack = await context.workspace.getStack();
      const install = suggestedCommands(stack).find((entry) => entry.label === 'Install');
      command = install?.command ?? 'npm install';
    }
    const cwd = await context.workspace.resolveSafe('', false);
    const dangerous = isDangerousInstall(command);
    const response = await context.permissions.require({
      kind: 'install',
      title: dangerous ? 'Install from non-registry source (potentially unsafe)' : 'Install dependencies',
      detail: args.reason ?? 'The agent needs additional packages.',
      command,
      cwd,
      dangerous,
      toolName: 'install_dependencies',
      runId: context.runId,
    });
    if (response.decision !== 'approved') throw new ToolDenied();
    return runShell(context, command, undefined, 300_000, {
      preapproved: true,
      toolName: 'install_dependencies',
      kind: 'install',
    });
  },
};

const gitStatusTool: AgentTool = {
  name: 'git_status',
  description: 'Show the current Git branch and changed files.',
  readOnly: true,
  parameters: { type: 'object', properties: {} },
  schema: z.object({}),
  async execute(context) {
    const status = await context.git.status();
    if (!status) return 'This project is not a Git repository.';
    const lines = status.files.map((file) => `${file.index}${file.worktree} ${file.path}`);
    return `On ${status.branch}${status.upstream ? ` -> ${status.upstream}` : ''}${status.ahead ? ` [ahead ${status.ahead}]` : ''}${status.behind ? ` [behind ${status.behind}]` : ''}\n${lines.join('\n') || '(clean)'}`;
  },
};

const gitDiffTool: AgentTool = {
  name: 'git_diff',
  description: 'Show Git diffs for the working tree or a specific file.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, staged: { type: 'boolean' } },
  },
  schema: z.object({ path: z.string().max(1024).optional(), staged: z.boolean().optional() }),
  async execute(context, raw) {
    const args = raw as { path?: string; staged?: boolean };
    const diffs = await context.git.diff(args.path, args.staged);
    if (diffs.length === 0) return 'No diff.';
    return truncateEnd(diffs.map((diff) => `### ${diff.path}\n${diff.patch}`).join('\n\n'), 24_000);
  },
};

const gitCommitTool: AgentTool = {
  name: 'git_commit',
  description: 'Stage the listed files (or all changes) and create a Git commit. Requires approval.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } } },
    required: ['message'],
  },
  schema: z.object({ message: z.string().min(1).max(5000), paths: z.array(relativePath).max(200).optional() }),
  async execute(context, raw) {
    const args = raw as { message: string; paths?: string[] };
    const status = await context.git.status();
    if (!status) throw new Error('Not a Git repository.');
    const paths = args.paths ?? status.files.map((file) => file.path);
    if (paths.length === 0 && status.clean) return 'Nothing to commit.';
    const response = await context.permissions.require({
      kind: 'commit',
      title: 'Create Git commit',
      detail: args.message,
      command: `git add ${paths.length} file(s) && git commit -m ${JSON.stringify(args.message)}`,
      paths,
      toolName: 'git_commit',
      runId: context.runId,
    });
    if (response.decision !== 'approved') throw new ToolDenied();
    await context.git.stage(paths);
    const hash = await context.git.commit(args.message);
    return `Committed ${hash.slice(0, 10)}: ${args.message}`;
  },
};

const gitLogTool: AgentTool = {
  name: 'git_log',
  description: 'Show recent Git history.',
  readOnly: true,
  parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  schema: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
  async execute(context, raw) {
    const { limit } = raw as { limit?: number };
    const entries = await context.git.log(limit ?? 15);
    if (entries.length === 0) return 'No commits.';
    return entries
      .map((entry) => `${entry.shortHash} ${entry.date.slice(0, 10)} ${entry.author}: ${entry.subject}`)
      .join('\n');
  },
};

const checkpointTool: AgentTool = {
  name: 'create_checkpoint',
  description: 'Create a manual checkpoint of the source tree that the user can restore later.',
  readOnly: false,
  parameters: { type: 'object', properties: { label: { type: 'string' } } },
  schema: z.object({ label: z.string().min(1).max(200) }),
  async execute(context, raw) {
    const { label } = raw as { label: string };
    const checkpoint = await context.checkpoints.create(context.projectId, label);
    return `Created checkpoint "${label}" with ${checkpoint.fileCount} files.`;
  },
};

const fetchUrlTool: AgentTool = {
  name: 'fetch_url',
  description: 'Fetch a public http(s) URL for documentation reference. Requires network approval.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'http:// or https:// URL' } },
    required: ['url'],
  },
  schema: z.object({ url: z.string().url().max(2000) }),
  async execute(context, raw) {
    const { url } = raw as { url: string };
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are supported.');
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (
        host === '169.254.169.254' ||
        host === 'metadata.google.internal' ||
        host === 'instance-data' ||
        host.startsWith('169.254.')
      ) {
        throw new Error('Fetching cloud metadata endpoints is prohibited for security.');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('prohibited')) throw e;
      throw new Error('Invalid URL format');
    }
    const response = await context.permissions.require({
      kind: 'network',
      title: 'Fetch external URL',
      detail: 'The agent wants to read documentation from the network.',
      command: `GET ${url}`,
      toolName: 'fetch_url',
      runId: context.runId,
    });
    if (response.decision !== 'approved') throw new ToolDenied();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Network request timed out after 30s')), 30_000);
    try {
      const result = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'ForgeAI/0.1 (+local agent)' },
        redirect: 'follow',
      });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const type = result.headers.get('content-type') ?? '';
      const text = (await result.text()).slice(0, 60_000);
      if (type.includes('html')) {
        return text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .slice(0, 30_000);
      }
      return truncateEnd(text, 30_000);
    } finally {
      clearTimeout(timer);
    }
  },
};

const inspectUrlTool: AgentTool = {
  name: 'inspect_url',
  description:
    'Inspect a local dev server or live URL (e.g. http://localhost:3000, http://127.0.0.1:8080, https://...) for response latency, HTTP status, security headers (CSP, HSTS, nosniff, frame options, CORS), SEO metadata, headings, broken images, and mixed content. Returns detailed issues and suggested fixes.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to inspect (supports localhost:port or full http/https URLs)',
      },
    },
    required: ['url'],
  },
  schema: z.object({
    url: z.string().min(1).max(2048),
  }),
  async execute(context, raw) {
    const args = raw as { url: string };
    let normalized = args.url.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      if (normalized.includes('localhost') || normalized.startsWith('127.0.0.1')) {
        normalized = `http://${normalized}`;
      } else {
        normalized = `https://${normalized}`;
      }
    }

    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();
      if (
        host === '169.254.169.254' ||
        host === 'metadata.google.internal' ||
        host === 'instance-data' ||
        host.startsWith('169.254.')
      ) {
        throw new Error('Fetching cloud metadata endpoints is prohibited for security.');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('prohibited')) throw e;
      throw new Error(`Invalid URL format: ${args.url}`);
    }

    const startTime = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Inspection request timed out after 20s')), 20_000);

    try {
      const res = await fetch(normalized, {
        signal: controller.signal,
        headers: {
          'user-agent': 'ForgeAI-Inspector/0.1 (+local agent; web diagnostic tool)',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });

      const latencyMs = Math.round(performance.now() - startTime);
      const contentType = res.headers.get('content-type') ?? '';
      const body = await res.text();
      const isHttps = res.url.startsWith('https://');

      const issues: string[] = [];
      const findings: string[] = [];

      findings.push(`- **URL**: ${normalized} (resolved: ${res.url})`);
      findings.push(`- **Status**: ${res.status} ${res.statusText}`);
      findings.push(`- **Latency**: ${latencyMs}ms`);
      findings.push(`- **Content-Type**: ${contentType || 'not specified'}`);
      findings.push(`- **Content-Length**: ${body.length} bytes`);

      // Status check
      if (res.status >= 500) {
        issues.push(`[CRITICAL] Server Error ${res.status}: Backend application threw an unhandled error or server crashed.`);
      } else if (res.status >= 400) {
        issues.push(`[CRITICAL] Client Error ${res.status}: Resource was not found or requires authentication.`);
      }

      // Security headers
      const csp = res.headers.get('content-security-policy');
      const hsts = res.headers.get('strict-transport-security');
      const xContentType = res.headers.get('x-content-type-options');
      const xFrame = res.headers.get('x-frame-options');
      const cors = res.headers.get('access-control-allow-origin');

      if (!csp) issues.push('[WARNING] Missing Content-Security-Policy (CSP) header: increases vulnerability to XSS attacks.');
      if (isHttps && !hsts) issues.push('[WARNING] Missing Strict-Transport-Security (HSTS) header: connections not forced to HTTPS.');
      if (!xContentType || !xContentType.toLowerCase().includes('nosniff')) {
        issues.push('[WARNING] Missing X-Content-Type-Options: nosniff header: MIME-type sniffing is not prevented.');
      }
      if (!xFrame) issues.push('[WARNING] Missing X-Frame-Options header: page can be embedded in third-party iframes (Clickjacking risk).');
      if (cors === '*') issues.push('[INFO] Wildcard CORS header detected (*): ensure sensitive endpoints restrict origins.');

      // DOM & SEO check
      if (contentType.includes('html') || body.includes('<html') || body.includes('<!DOCTYPE')) {
        const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : null;
        if (!title) {
          issues.push('[CRITICAL] Missing <title> tag in HTML.');
        } else if (title.length < 20 || title.length > 70) {
          issues.push(`[WARNING] Title tag length (${title.length} chars) is outside optimal 30-65 range: "${title}"`);
        } else {
          findings.push(`- **Title**: "${title}" (${title.length} chars)`);
        }

        const descMatch = body.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
        const desc = descMatch && descMatch[1] ? descMatch[1].trim() : null;
        if (!desc) {
          issues.push('[WARNING] Missing <meta name="description"> tag.');
        } else {
          findings.push(`- **Meta Description**: "${desc}" (${desc.length} chars)`);
        }

        const h1Matches = body.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
        if (h1Matches.length === 0) {
          issues.push('[WARNING] No <h1> tag found on page.');
        } else if (h1Matches.length > 1) {
          issues.push(`[WARNING] Multiple <h1> tags found (${h1Matches.length}). Use exactly one <h1> per page.`);
        } else {
          findings.push(`- **Heading**: 1 <h1> tag detected`);
        }

        const imgMatches = body.match(/<img[^>]*>/gi) ?? [];
        let missingAlt = 0;
        for (const img of imgMatches) {
          if (!/\balt=(["'])(.*?)\1/i.test(img)) missingAlt++;
        }
        if (missingAlt > 0) {
          issues.push(`[WARNING] ${missingAlt}/${imgMatches.length} <img> tags are missing alt attributes.`);
        }

        if (isHttps) {
          const mixed = body.match(/(?:src|href)=["']http:\/\/[^"'>]+["']/gi) ?? [];
          if (mixed.length > 0) {
            issues.push(`[CRITICAL] Mixed Content: HTTPS page references ${mixed.length} insecure HTTP resources.`);
          }
        }
      }

      return [
        `## URL Inspection Report for ${normalized}`,
        '',
        '### Overview',
        ...findings,
        '',
        '### Issues Detected (' + issues.length + ')',
        issues.length === 0 ? '- No critical issues detected! Clean configuration.' : issues.map((i) => `- ${i}`).join('\n'),
      ].join('\n');
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      const msg = error instanceof Error ? error.message : String(error);
      return [
        `## URL Inspection Failed for ${normalized}`,
        `- **Status**: Connection Failed (${latencyMs}ms)`,
        `- **Error**: ${msg}`,
        '',
        '### Recommended Actions',
        '1. Ensure your local server is running (e.g. `npm run dev`).',
        '2. Verify the port matches your dev server configuration.',
        '3. Check network and firewall settings.',
      ].join('\n');
    } finally {
      clearTimeout(timer);
    }
  },
};

const updateTaskTool: AgentTool = {
  name: 'update_task',
  description: 'Update the status of the spec task currently being implemented. Used during spec execution.',
  readOnly: false,
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      status: { type: 'string', enum: ['in_progress', 'done', 'failed'] },
      note: { type: 'string' },
    },
    required: ['task_id', 'status'],
  },
  schema: z.object({
    task_id: z.string().min(1).max(40),
    status: z.enum(['in_progress', 'done', 'failed']),
    note: z.string().max(4000).optional(),
  }),
  async execute(context, raw) {
    const args = raw as { task_id: string; status: 'in_progress' | 'done' | 'failed'; note?: string };
    if (!context.updateTask) throw new Error('Task updates are only available while executing a spec task.');
    return context.updateTask(args.task_id, args.status, args.note);
  },
};

const SEO_PAGE_FILE =
  /\.(html?|astro)$|(^|\/)(page|layout|head|_document|_app|index|home|about|contact|pricing|blog|post|product|services)\.[cm]?[jt]sx?$|\.(vue|svelte)$/i;
const SEO_CONFIG_FILE =
  /(^|\/)(robots\.txt|sitemap[^/]*\.(xml|js|mjs|cjs|ts)|next\.config\.[cm]?[jt]s|astro\.config\.[cm]?[jt]s|nuxt\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|package\.json)$/i;

function countMatches(content: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...content.matchAll(new RegExp(pattern.source, flags))].length;
}

function globalSeoPatterns(content: string): { present: string[]; missing: string[] } {
  const meta = (name: string) => new RegExp(`<meta[^>]+(?:name|property)=["']${name}["']`, 'i');
  const checks: Array<[string, boolean]> = [
    ['title', /<title[^>]*>[\s\S]{1,240}?<\/title>/i.test(content) || /\b(?:title|ogTitle)\s*:/i.test(content)],
    ['meta description', meta('description').test(content) || /\b(?:description|summary)\s*:\s*['"`]/i.test(content)],
    ['canonical', /rel=["']canonical["']/i.test(content) || /\bcanonical\s*:/i.test(content)],
    ['Open Graph', /(?:property|name)=["']og:/i.test(content) || /\bopenGraph\s*:/i.test(content)],
    ['Twitter card', /(?:property|name)=["']twitter:/i.test(content) || /\btwitter\s*:/i.test(content)],
    ['JSON-LD', /application\/ld\+json/i.test(content)],
    ['viewport', meta('viewport').test(content)],
  ];
  return {
    present: checks.filter(([, ok]) => ok).map(([label]) => label),
    missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
  };
}

const seoAuditTool: AgentTool = {
  name: 'seo_audit',
  description:
    'Scan the project for SEO basics: titles, meta descriptions, canonicals, Open Graph/Twitter tags, JSON-LD, headings, image alt text, robots.txt and sitemaps. Read-only; start every SEO task with this tool.',
  readOnly: true,
  agents: ['seo'],
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', description: 'Optional workspace-relative directory to limit the audit' },
    },
  },
  schema: z.object({ scope: z.string().max(1024).optional() }),
  async execute(context, raw) {
    const args = raw as { scope?: string };
    const all = await context.search.files('', 2000);
    const rawScope = (args.scope ?? '').trim();
    // Models often pass "." or "./" to mean the project root. Treat those as
    // no scope; otherwise the filter below matches nothing and the audit
    // wrongly reports that a project has no pages or robots.txt.
    const prefix = rawScope === '.' || rawScope === './' ? '' : rawScope.replace(/^\.?\//, '').replace(/\/$/, '');
    const files = prefix ? all.filter((file) => file === prefix || file.startsWith(`${prefix}/`)) : all;
    const robots = files.find((file) => /(^|\/)robots\.txt$/i.test(file));
    const sitemaps = files.filter((file) => /(^|\/)sitemap[^/]*\.(xml|js|mjs|cjs|ts)$/i.test(file));

    const pages = files.filter((file) => SEO_PAGE_FILE.test(file) && !SEO_CONFIG_FILE.test(file)).slice(0, 24);
    const configs = files
      .filter((file) => SEO_CONFIG_FILE.test(file) && !/(^|\/)package\.json$/i.test(file))
      .slice(0, 6);
    const targets = [...new Set([...pages, ...configs])];
    const sections: string[] = [
      `# SEO audit (${targets.length} files inspected, ${files.length} files visible)`,
      '',
      '## Crawl setup',
      `- robots.txt: ${robots ? `found at ${robots}` : 'MISSING — crawlers will not see sitemap or crawl hints'}`,
      sitemaps.length > 0
        ? `- sitemap: ${sitemaps.join(', ')}`
        : '- sitemap: MISSING — add sitemap.xml or a framework sitemap generator',
    ];
    if (configs.length > 0) sections.push(`- config files: ${configs.join(', ')}`);

    const issues = new Map<string, number>();
    const noteIssue = (label: string) => issues.set(label, (issues.get(label) ?? 0) + 1);
    let pagesWithH1 = 0;
    let imagesWithoutAlt = 0;
    let totalImages = 0;
    let noindexPages = 0;

    for (const file of pages) {
      if (context.signal.aborted) break;
      let content = '';
      try {
        content = (await context.workspace.readFile(file)).content.slice(0, 200_000);
      } catch {
        continue;
      }
      if (content.trim().length === 0) continue;
      const { missing, present } = globalSeoPatterns(content);
      const h1 = countMatches(content, /<h1\b[^>]*>/gi);
      const h1FromMetadata = /(?:heading|h1|title)\s*:/i.test(content) && !/<h1\b/i.test(content);
      if (h1 > 0) pagesWithH1 += 1;
      const images = [...content.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
      totalImages += images.length;
      const missingAlt = images.filter((tag) => !/\balt\s*=/i.test(tag)).length;
      imagesWithoutAlt += missingAlt;
      const noindex = /(?:name=["']robots["'][^>]*noindex|robots\s*:\s*['"`][^'"`]*noindex)/i.test(content);
      if (noindex) noindexPages += 1;
      for (const label of missing) noteIssue(label);

      const notes: string[] = [];
      if (missing.length > 0) notes.push(`missing: ${missing.join(', ')}`);
      if (present.length > 0) notes.push(`present: ${present.join(', ')}`);
      if (/<h1\b/i.test(content) && h1 > 1) notes.push(`${h1} h1 tags (use exactly one)`);
      if (!/<h1\b/i.test(content) && !h1FromMetadata) notes.push('no h1 found');
      if (missingAlt > 0) notes.push(`${missingAlt}/${images.length} <img> without alt`);
      if (noindex) notes.push('page is noindex');
      sections.push('', `### ${file}`, ...notes.map((note) => `- ${note}`));
    }

    sections.push('', '## Summary');
    if (pages.length === 0) {
      sections.push('- No page or layout files matched. Check the scope or use list_files/search_code.');
    } else {
      sections.push(
        `- Metadata gaps: ${[...issues.entries()].map(([label, count]) => `${label} (${count})`).join(', ') || 'none detected'}`,
      );
      sections.push(`- Pages with an h1: ${pagesWithH1}/${pages.length}`);
      sections.push(`- Images without alt: ${imagesWithoutAlt}/${totalImages}`);
      if (noindexPages > 0) sections.push(`- noindex pages: ${noindexPages}`);
      if (!robots) sections.push('- Add a robots.txt that references the sitemap.');
      if (sitemaps.length === 0)
        sections.push('- Add a sitemap (Next.js sitemap.ts, Astro sitemap integration, or a static XML file).');
      sections.push(
        '- Next: use read_file on the pages that matter, then make minimal edits with edit_file. Do not add tags that do not describe real content.',
      );
    }
    return sections.join('\n');
  },
};

const ALL_TOOLS: AgentTool[] = [
  readFileTool,
  readMultipleTool,
  listFilesTool,
  searchCodeTool,
  semanticSearchTool,
  symbolsTool,
  overviewTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  runCommandTool,
  runTestsTool,
  installDepsTool,
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitLogTool,
  checkpointTool,
  fetchUrlTool,
  inspectUrlTool,
  updateTaskTool,
  seoAuditTool,
];

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[] = ALL_TOOLS) {
    for (const tool of tools) this.tools.set(tool.name, tool);
  }

  forAgent(agent: AgentKind): AgentTool[] {
    return [...this.tools.values()].filter((tool) => {
      if (agent === 'planner' || agent === 'review') {
        if (!tool.readOnly) return false;
      }
      return !tool.agents || tool.agents.includes(agent);
    });
  }

  schemas(agent: AgentKind): ToolSchema[] {
    return this.forAgent(agent).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  names(agent: AgentKind): string[] {
    return this.forAgent(agent).map((tool) => tool.name);
  }

  /** True for tools that only observe the workspace, so they are safe to run concurrently. */
  isReadOnly(name: string): boolean {
    return this.tools.get(name)?.readOnly === true;
  }

  async execute(name: string, args: unknown, context: ToolContext): Promise<{ ok: boolean; observation: string }> {
    const tool = this.tools.get(name);
    if (!tool)
      return { ok: false, observation: `Unknown tool "${name}". Available: ${this.names(context.agent).join(', ')}` };
    if (!this.forAgent(context.agent).some((candidate) => candidate.name === name)) {
      return { ok: false, observation: `Tool "${name}" is not available to the ${context.agent} agent.` };
    }
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
        .join('; ');
      return { ok: false, observation: `Invalid arguments for ${name}: ${detail}` };
    }
    try {
      const observation = await tool.execute(context, parsed.data);
      return { ok: true, observation };
    } catch (error) {
      if (error instanceof ToolDenied) return { ok: false, observation: error.message };
      if (error instanceof Error && error.name === 'AbortError') return { ok: false, observation: 'Cancelled.' };
      return { ok: false, observation: `Tool error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

export const toolRegistry = new ToolRegistry();

export function describeToolsForFallback(registry: ToolRegistry, agent: AgentKind): string {
  return registry
    .forAgent(agent)
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join('\n');
}
