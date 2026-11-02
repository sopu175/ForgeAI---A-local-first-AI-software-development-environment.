import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Cpu,
  FolderSearch,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import { useAppStore } from '../../state/app';
import { SectionLabel, StatusDot } from '../ui';
import { suggestedCommands } from '../../lib/stack';
import { requestTerminalCommand } from '../../lib/terminalBus';
import { errorMessage, relativeTime, shortModelName } from '../../lib/format';

const TOOLS = [
  ['read_file', 'Read a file with line numbers'],
  ['list_files', 'List a directory (ignore-aware)'],
  ['search_text', 'Ripgrep search across the workspace'],
  ['semantic_search', 'Vector retrieval over indexed chunks'],
  ['find_symbols', 'Locate definitions and references'],
  ['write_file', 'Create or replace a file — diff approved'],
  ['apply_patch', 'Apply targeted hunks to a file'],
  ['delete_path', 'Delete files or folders — always gated'],
  ['run_command', 'Run a shell command with a timeout'],
  ['git_status / git_diff / git_commit', 'Inspect and commit changes'],
  ['run_tests', 'Detect and run the project test suite'],
  ['read_rules', 'Load AGENTS.md, .cursorrules, CLAUDE.md'],
];

export function ExtensionsView() {
  const project = useAppStore((state) => state.project);
  const rules = useAppStore((state) => state.rules);
  const stack = useAppStore((state) => state.stack);
  const models = useAppStore((state) => state.models);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const settings = useAppStore((state) => state.settings);
  const indexing = useAppStore((state) => state.indexing);
  const startIndex = useAppStore((state) => state.startIndex);
  const toast = useAppStore((state) => state.toast);
  const sidebarOpenCount = useAppStore((state) => state.models.length);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const commands = useMemo(() => (stack ? suggestedCommands(stack) : []), [stack]);
  const roleBindings = useMemo(
    () =>
      Object.entries(settings?.modelRoles ?? {})
        .filter((entry): entry is [string, { providerId: string; model: string }] => Boolean(entry[1]))
        .map(([role, binding]) => ({ role, ...binding })),
    [settings?.modelRoles],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">AI rules & tools</span>
        <span className="text-[9.5px] text-faint">{sidebarOpenCount} models</span>
      </div>

      <SectionLabel>Project rules</SectionLabel>
      {rules.length === 0 ? (
        <p className="px-3 pb-2 text-[11px] leading-relaxed text-faint">
          No rule files found. Add <code className="font-mono">AGENTS.md</code>,{' '}
          <code className="font-mono">.cursorrules</code>, <code className="font-mono">CLAUDE.md</code>, or{' '}
          <code className="font-mono">.github/copilot-instructions.md</code> — they are injected into every chat and
          agent run.
        </p>
      ) : (
        rules.map((rule) => {
          const open = expanded[rule.path] ?? false;
          return (
            <div key={rule.path} className="border-b border-line-soft px-3 py-1.5">
              <button
                type="button"
                onClick={() => setExpanded((current) => ({ ...current, [rule.path]: !open }))}
                className="flex w-full items-center gap-1.5 text-left"
                title={rule.path}
              >
                {open ? (
                  <ChevronDown size={11} className="text-faint" />
                ) : (
                  <ChevronRight size={11} className="text-faint" />
                )}
                <span className="truncate text-[11.5px] text-fg">{rule.name}</span>
                <span className="ml-auto rounded bg-panel-3 px-1 text-[9px] uppercase text-faint">{rule.scope}</span>
              </button>
              {open ? (
                <>
                  <pre className="mt-1.5 max-h-[180px] overflow-auto whitespace-pre-wrap rounded border border-line-soft bg-panel-2 p-2 font-mono text-[10px] leading-relaxed text-muted">
                    {rule.content.slice(0, 4000) || '(empty)'}
                  </pre>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[9.5px] text-faint hover:text-fg"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(rule.path)
                          .catch((error) => toast('error', errorMessage(error)));
                        toast('info', 'Rule path copied');
                      }}
                    >
                      <ClipboardCopy size={10} /> Copy path
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          );
        })
      )}

      <SectionLabel>Detected stack</SectionLabel>
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {!stack || (stack.languages.length === 0 && stack.frameworks.length === 0) ? (
          <span className="text-[11px] text-faint">Open a project to detect languages and frameworks.</span>
        ) : (
          <>
            {stack.languages.map((language) => (
              <span key={language} className="chip !text-[9.5px] capitalize">
                {language}
              </span>
            ))}
            {stack.frameworks.map((framework) => (
              <span key={framework} className="chip chip-accent !text-[9.5px]">
                {framework}
              </span>
            ))}
            {stack.packageManagers.map((manager) => (
              <span key={manager} className="chip !text-[9.5px]">
                {manager}
              </span>
            ))}
            {stack.testRunners.slice(0, 4).map((runner) => (
              <span key={runner} className="chip chip-success !text-[9.5px]">
                {runner}
              </span>
            ))}
          </>
        )}
      </div>

      {commands.length > 0 ? (
        <>
          <SectionLabel>Project commands</SectionLabel>
          <div className="grid gap-1 px-2 pb-2">
            {commands.slice(0, 8).map((command) => (
              <button
                key={`${command.label}:${command.command}`}
                type="button"
                onClick={() => {
                  useAppStore.getState().showBottom('terminal');
                  requestTerminalCommand(command.command);
                }}
                className="flex items-center gap-2 rounded border border-transparent px-1.5 py-1 text-left hover:border-line hover:bg-panel-2"
                title={`Run ${command.command}`}
              >
                <TerminalSquare size={11} className="shrink-0 text-faint" />
                <span className="text-[10.5px] text-muted">{command.label}</span>
                <code className="ml-auto truncate font-mono text-[10px] text-faint">{command.command}</code>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <SectionLabel>Agent tool registry</SectionLabel>
      <div className="px-3 pb-2">
        <p className="mb-1.5 text-[10px] leading-relaxed text-faint">
          Every call is schema-validated. Destructive tools require your approval unless you explicitly auto-approve
          that category.
        </p>
        {TOOLS.map(([name, description]) => (
          <div key={name} className="flex items-start gap-2 py-1">
            <Wrench size={10} className="mt-[3px] shrink-0 text-faint" />
            <div className="min-w-0">
              <code className="font-mono text-[10px] text-fg">{name}</code>
              <p className="text-[10px] leading-relaxed text-faint">{description}</p>
            </div>
          </div>
        ))}
      </div>

      <SectionLabel>Model roles</SectionLabel>
      <div className="px-3 pb-2">
        {roleBindings.length === 0 ? (
          <button
            type="button"
            onClick={() => useAppStore.getState().setModelsOpen(true)}
            className="text-[11px] text-accent hover:underline"
          >
            Assign models to roles
          </button>
        ) : (
          roleBindings.map((binding) => (
            <div key={binding.role} className="flex items-center gap-2 py-0.5 text-[10.5px]">
              <Cpu size={10} className="text-faint" />
              <span className="capitalize text-muted">{binding.role}</span>
              <span
                className="ml-auto truncate font-mono text-[10px] text-faint"
                title={`${binding.providerId}/${binding.model}`}
              >
                {shortModelName(binding.model)}
              </span>
            </div>
          ))
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">
          <StatusDot tone={selectedModel && models.length ? 'success' : 'danger'} />
          {models.length
            ? `${models.length} local models · ${selectedModel ? shortModelName(selectedModel.model) : 'no chat model'}`
            : 'No models installed'}
        </div>
      </div>

      <SectionLabel>Codebase index</SectionLabel>
      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 text-[10.5px] text-muted">
          <FolderSearch size={11} className="text-faint" />
          {indexing?.state === 'ready' ? (
            <>
              {indexing.filesIndexed} files · {indexing.chunks} chunks · {indexing.embedded} embedded
            </>
          ) : indexing?.state === 'error' ? (
            <span className="text-danger">{indexing.error ?? 'Index failed'}</span>
          ) : (
            <span>Not indexed yet</span>
          )}
        </div>
        {indexing?.finishedAt ? (
          <p className="mt-0.5 text-[9.5px] text-faint">Updated {relativeTime(indexing.finishedAt)}</p>
        ) : null}
        <button
          type="button"
          className="btn mt-2 !h-7 w-full !text-[10.5px]"
          onClick={() => void startIndex(true)}
          disabled={!project}
        >
          <RefreshCw size={11} /> Rebuild index
        </button>
      </div>

      <SectionLabel>Safety</SectionLabel>
      <div className="flex items-start gap-2 px-3 pb-4">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
        <p className="text-[10px] leading-relaxed text-faint">
          The renderer is sandboxed with context isolation. File access is confined to the workspace, secret files are
          blocked, commands run only after approval and every permission decision is written to the local audit log.
        </p>
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t border-line-soft px-3 py-2 text-[9.5px] text-faint">
        <Puzzle size={10} /> Extensions model: rules + tools, no remote marketplace.
      </div>
    </div>
  );
}
