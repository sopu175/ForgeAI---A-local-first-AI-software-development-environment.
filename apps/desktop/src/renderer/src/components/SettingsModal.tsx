import { useEffect, useState } from 'react';
import {
  Bot,
  Code2,
  Cpu,
  Globe,
  Info,
  KeyRound,
  Palette,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { AppSettings, BrowserOption, ModelRole, RoleBinding, UsageStats } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { Modal, ModalHeader, SectionLabel, Spinner, Toggle, cn } from './ui';
import { shortModelName } from '../lib/format';
import { forgetBrowserCache, installedBrowsers } from '../lib/workspaceActions';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={13} /> },
  { id: 'editor', label: 'Editor', icon: <Code2 size={13} /> },
  { id: 'preview', label: 'Browser & Preview', icon: <Globe size={13} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={13} /> },
  { id: 'agent', label: 'Agent', icon: <Bot size={13} /> },
  { id: 'approval', label: 'Permissions', icon: <ShieldCheck size={13} /> },
  { id: 'index', label: 'Indexing', icon: <Search size={13} /> },
  { id: 'completion', label: 'Completion', icon: <Sparkles size={13} /> },
  { id: 'roles', label: 'Model roles', icon: <Cpu size={13} /> },
  { id: 'about', label: 'About', icon: <Info size={13} /> },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const ROLE_LABEL: Record<ModelRole, string> = {
  chat: 'Chat',
  plan: 'Planning & specs',
  coding: 'Coding agent',
  review: 'Review',
  fast: 'Fast tasks',
  embedding: 'Embeddings',
};

const ROLE_HINT: Record<ModelRole, string> = {
  chat: 'Conversational answers and explanations.',
  plan: 'Writes requirements, design docs and task plans.',
  coding: 'Drives the coding, debugging and testing agents.',
  review: 'Reviews diffs and uncommitted changes.',
  fast: 'Commit messages, titles and short utilities.',
  embedding: 'Builds the vector index for retrieval.',
};

export function SettingsModal() {
  const open = useAppStore((state) => state.settingsOpen);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const settings = useAppStore((state) => state.settings);
  const info = useAppStore((state) => state.info);
  const models = useAppStore((state) => state.models);
  const rules = useAppStore((state) => state.rules);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const toast = useAppStore((state) => state.toast);

  const [section, setSection] = useState<SectionId>('appearance');
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [ignoreDraft, setIgnoreDraft] = useState('');
  const [browsers, setBrowsers] = useState<BrowserOption[]>([]);
  const [browserScan, setBrowserScan] = useState(0);

  useEffect(() => {
    if (open) setIgnoreDraft((settings?.indexing.ignoreGlobs ?? []).join('\n'));
  }, [open, settings?.indexing.ignoreGlobs]);

  useEffect(() => {
    if (!open || section !== 'preview') return;
    let active = true;
    void installedBrowsers().then((list) => {
      if (active) setBrowsers(list);
    });
    return () => {
      active = false;
    };
  }, [open, section, browserScan]);

  useEffect(() => {
    if (!open || section !== 'about') return;
    void window.forge.ai
      .usage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [open, section]);

  if (!open || !settings) return null;

  const patch = (partial: Partial<AppSettings>) => void updateSettings(partial);
  const nested = <K extends 'approval' | 'indexing' | 'completion' | 'agent' | 'editor' | 'preview' | 'terminal'>(
    key: K,
    value: Partial<AppSettings[K]>,
  ) => void updateSettings({ [key]: { ...settings[key], ...value } } as Partial<AppSettings>);

  const groupedModels = [...models].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <Modal onClose={() => setOpen(false)} width={840}>
      <ModalHeader
        title="Settings"
        subtitle="Everything is stored locally. Changes apply immediately."
        icon={<SlidersHorizontal size={16} />}
        onClose={() => setOpen(false)}
      />
      <div className="flex min-h-[440px]">
        <nav className="w-[172px] shrink-0 border-r border-line-soft bg-panel py-2">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              className={cn(
                'flex w-full items-center gap-2 border-l-2 px-3 py-[7px] text-left text-[11.5px]',
                section === entry.id
                  ? 'border-accent bg-accent-soft text-fg'
                  : 'border-transparent text-muted hover:bg-panel-2 hover:text-fg',
              )}
            >
              <span className={section === entry.id ? 'text-accent' : 'text-faint'}>{entry.icon}</span>
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {section === 'appearance' ? (
            <div className="space-y-4">
              <div>
                <SectionLabel>Theme</SectionLabel>
                <div className="mt-1 flex items-center gap-2">
                  {(['dark', 'light', 'system'] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      onClick={() => patch({ theme })}
                      className={cn(
                        'btn !h-7 flex-1 !text-[11px] capitalize',
                        settings.theme === theme && 'border-accent bg-accent-soft text-fg',
                      )}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <SectionLabel>Fonts</SectionLabel>
                <NumberRow
                  label="Interface size"
                  description="Base size for menus, panels and chat."
                  value={settings.uiFontSize}
                  min={11}
                  max={16}
                  suffix="px"
                  onCommit={(value) => patch({ uiFontSize: value })}
                />
              </div>
              <p className="rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-[10.5px] leading-relaxed text-faint">
                Code font, indentation, auto save, browser preview and terminal settings each have their own section in
                the sidebar.
              </p>
            </div>
          ) : null}

          {section === 'editor' ? (
            <div className="space-y-4">
              <div>
                <SectionLabel>Text</SectionLabel>
                <NumberRow
                  label="Code font size"
                  description="Monospace size used by the editor."
                  value={settings.codeFontSize}
                  min={10}
                  max={22}
                  suffix="px"
                  onCommit={(value) => patch({ codeFontSize: value })}
                />
                <ToggleRow
                  label="Font ligatures"
                  description="Combine characters like => into single glyphs."
                  checked={settings.editor.fontLigatures}
                  onChange={(value) => nested('editor', { fontLigatures: value })}
                />
                <ToggleRow
                  label="Word wrap"
                  description="Wrap long lines instead of horizontal scrolling."
                  checked={settings.wordWrap}
                  onChange={(value) => patch({ wordWrap: value })}
                />
                <ToggleRow
                  label="Minimap"
                  description="Show the code overview map on the right."
                  checked={settings.editorMinimap}
                  onChange={(value) => patch({ editorMinimap: value })}
                />
                <ApprovalRow
                  label="Line numbers"
                  description="Relative numbers make pair-programming callouts easier."
                  value={settings.editor.lineNumbers}
                  options={['on', 'relative', 'off']}
                  onChange={(value) => nested('editor', { lineNumbers: value as AppSettings['editor']['lineNumbers'] })}
                />
                <ApprovalRow
                  label="Render whitespace"
                  description="When to draw dots for spaces and tabs."
                  value={settings.editor.renderWhitespace}
                  options={['selection', 'none', 'all']}
                  onChange={(value) =>
                    nested('editor', { renderWhitespace: value as AppSettings['editor']['renderWhitespace'] })
                  }
                />
              </div>
              <div>
                <SectionLabel>Indentation</SectionLabel>
                <NumberRow
                  label="Tab size"
                  description="Spaces inserted by one Tab press."
                  value={settings.editor.tabSize}
                  min={2}
                  max={8}
                  onCommit={(value) => nested('editor', { tabSize: value })}
                />
                <ToggleRow
                  label="Insert spaces"
                  description="Use spaces instead of tab characters."
                  checked={settings.editor.insertSpaces}
                  onChange={(value) => nested('editor', { insertSpaces: value })}
                />
                <ToggleRow
                  label="Detect indentation"
                  description="Follow the file’s own indentation when it differs from the settings above."
                  checked={settings.editor.detectIndentation}
                  onChange={(value) => nested('editor', { detectIndentation: value })}
                />
              </div>
              <div>
                <SectionLabel>Saving &amp; formatting</SectionLabel>
                <ApprovalRow
                  label="Auto save"
                  description="Write changes to disk without pressing ⌘S."
                  value={settings.editor.autoSave}
                  options={['off', 'afterDelay']}
                  onChange={(value) => nested('editor', { autoSave: value as AppSettings['editor']['autoSave'] })}
                />
                {settings.editor.autoSave === 'afterDelay' ? (
                  <NumberRow
                    label="Auto save delay"
                    description="Idle time before the file is written."
                    value={settings.editor.autoSaveDelayMs}
                    min={250}
                    max={5000}
                    step={250}
                    suffix="ms"
                    onCommit={(value) => nested('editor', { autoSaveDelayMs: value })}
                  />
                ) : null}
                <ToggleRow
                  label="Format on save"
                  description="Run the editor formatter before every write."
                  checked={settings.editor.formatOnSave}
                  onChange={(value) => nested('editor', { formatOnSave: value })}
                />
              </div>
              <div>
                <SectionLabel>Navigation &amp; editing</SectionLabel>
                <ToggleRow
                  label="Smooth scrolling"
                  description="Animate editor and scrollbar movement."
                  checked={settings.editor.smoothScrolling}
                  onChange={(value) => nested('editor', { smoothScrolling: value })}
                />
                <ToggleRow
                  label="Bracket pair colorization"
                  description="Colour matching brackets by nesting depth."
                  checked={settings.editor.bracketPairColorization}
                  onChange={(value) => nested('editor', { bracketPairColorization: value })}
                />
                <ToggleRow
                  label="Sticky scroll"
                  description="Pin the enclosing scope at the top of the editor."
                  checked={settings.editor.stickyScroll}
                  onChange={(value) => nested('editor', { stickyScroll: value })}
                />
                <ToggleRow
                  label="Auto close brackets"
                  description="Also auto-close quotes and surround selections."
                  checked={settings.editor.autoClosingBrackets}
                  onChange={(value) => nested('editor', { autoClosingBrackets: value })}
                />
                <ToggleRow
                  label="Suggestions while typing"
                  description="Pop the IntelliSense list as you type (AI ghost text is under Completion)."
                  checked={settings.editor.suggestOnTyping}
                  onChange={(value) => nested('editor', { suggestOnTyping: value })}
                />
                <ApprovalRow
                  label="Multi-cursor modifier"
                  description="Modifier for adding extra cursors with the mouse."
                  value={settings.editor.multiCursorModifier}
                  options={['alt', 'ctrlCmd']}
                  onChange={(value) =>
                    nested('editor', { multiCursorModifier: value as AppSettings['editor']['multiCursorModifier'] })
                  }
                />
              </div>
            </div>
          ) : null}

          {section === 'preview' ? (
            <div className="space-y-4">
              <SectionLabel>Browser preview</SectionLabel>
              <p className="text-[10.5px] leading-relaxed text-faint">
                Right-click an HTML file in the Explorer — or use the editor context menu and the File menu — to open it
                in a browser. Choose the browser used when no explicit one is picked.
              </p>
              <SelectRow
                label="Default browser"
                description="Used by “Open in Browser” when no browser is chosen."
                value={settings.preview.defaultBrowser}
                options={[
                  { value: 'default', label: 'System default browser' },
                  ...browsers
                    .filter((browser) => browser.available && browser.id !== 'default')
                    .map((browser) => ({ value: browser.id, label: browser.name })),
                  ...(settings.preview.defaultBrowser !== 'default' &&
                  !browsers.some((browser) => browser.id === settings.preview.defaultBrowser && browser.available)
                    ? [
                        {
                          value: settings.preview.defaultBrowser,
                          label: `${settings.preview.defaultBrowser} (not detected)`,
                        },
                      ]
                    : []),
                ]}
                onChange={(value) => nested('preview', { defaultBrowser: value })}
              />
              <div>
                <SectionLabel>Detected browsers</SectionLabel>
                {browsers.filter((browser) => browser.available && browser.id !== 'default').length === 0 ? (
                  <p className="text-[10.5px] text-faint">
                    None detected in the usual install locations. The system default browser is always available.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {browsers
                      .filter((browser) => browser.available && browser.id !== 'default')
                      .map((browser) => (
                        <li key={browser.id} className="flex items-center gap-2 text-[11px] text-muted">
                          <Globe size={11} className="text-faint" />
                          {browser.name}
                          <span className="font-mono text-[9.5px] text-faint">{browser.id}</span>
                          {settings.preview.defaultBrowser === browser.id ? (
                            <span className="ml-auto rounded bg-accent-soft px-1 text-[9px] text-accent">default</span>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                )}
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="btn !h-7 !text-[10.5px]"
                    onClick={() => {
                      forgetBrowserCache();
                      setBrowsers([]);
                      setBrowserScan((value) => value + 1);
                    }}
                  >
                    <RefreshCw size={11} /> Re-scan browsers
                  </button>
                </div>
              </div>
              <p className="rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-[10.5px] leading-relaxed text-faint">
                Files open from disk with their real path, so relative CSS, JS and image references keep working. If
                “System default browser” starts your editor instead, pick Chrome, Firefox or another browser above.
              </p>
            </div>
          ) : null}

          {section === 'terminal' ? (
            <div className="space-y-4">
              <SectionLabel>Integrated terminal</SectionLabel>
              <NumberRow
                label="Font size"
                description="Terminal rows are re-laid out the next time the panel opens."
                value={settings.terminal.fontSize}
                min={9}
                max={22}
                suffix="px"
                onCommit={(value) => nested('terminal', { fontSize: value })}
              />
              <ToggleRow
                label="Cursor blink"
                description="Animate the terminal cursor."
                checked={settings.terminal.cursorBlink}
                onChange={(value) => nested('terminal', { cursorBlink: value })}
              />
              <p className="text-[10.5px] leading-relaxed text-faint">
                The terminal runs your login shell in the workspace folder. “Open in Integrated Terminal” is available
                from the Explorer context menu.
              </p>
            </div>
          ) : null}

          {section === 'agent' ? (
            <div className="space-y-4">
              <SectionLabel>Autonomy</SectionLabel>
              <NumberRow
                label="Maximum steps per run"
                description="Hard stop for the agent loop. Lower is safer and faster."
                value={settings.agent.maxSteps}
                min={1}
                max={60}
                onCommit={(value) => nested('agent', { maxSteps: value })}
              />
              <NumberRow
                label="Temperature"
                description="0 is deterministic, 1 is exploratory. Steps use a small jitter regardless."
                value={settings.agent.temperature}
                min={0}
                max={1}
                step={0.05}
                onCommit={(value) => nested('agent', { temperature: value })}
              />
              <ToggleRow
                label="Checkpoint before first write"
                description="Creates a rollback point before the agent modifies files."
                checked={settings.agent.autoCheckpoint}
                onChange={(value) => nested('agent', { autoCheckpoint: value })}
              />
              <ToggleRow
                label="Run read-only tools in parallel"
                description="Batch independent file reads and searches in one step. Faster on large projects; disable it if a small model loses track of the results."
                checked={settings.agent.parallelReadOnly}
                onChange={(value) => nested('agent', { parallelReadOnly: value })}
              />
              <p className="rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-[10.5px] leading-relaxed text-faint">
                Agents can only use tools from the validated registry. Destructive tools always raise a permission
                request unless you explicitly auto-approve that category below.
              </p>
            </div>
          ) : null}

          {section === 'approval' ? (
            <div className="space-y-1">
              <p className="mb-3 text-[10.5px] leading-relaxed text-faint">
                Choose how much autonomy you grant. “Once” asks every time, “Session” remembers the decision until
                ForgeAI restarts, “Auto” approves silently. Deletes can never be fully automatic.
              </p>
              <ApprovalRow
                label="File writes"
                description="Agent edits arrive as diff previews first."
                value={settings.approval.writes}
                options={['once', 'session', 'auto']}
                onChange={(value) => nested('approval', { writes: value as AppSettings['approval']['writes'] })}
              />
              <ApprovalRow
                label="Commands"
                description="Anything run in the integrated terminal on your behalf."
                value={settings.approval.commands}
                options={['once', 'session', 'auto']}
                onChange={(value) => nested('approval', { commands: value as AppSettings['approval']['commands'] })}
              />
              <ApprovalRow
                label="Dependencies"
                description="Package installs and upgrades."
                value={settings.approval.installs}
                options={['once', 'session', 'auto']}
                onChange={(value) => nested('approval', { installs: value as AppSettings['approval']['installs'] })}
              />
              <ApprovalRow
                label="Network requests"
                description="Outbound HTTP probing and downloads."
                value={settings.approval.network}
                options={['once', 'session', 'auto']}
                onChange={(value) => nested('approval', { network: value as AppSettings['approval']['network'] })}
              />
              <ApprovalRow
                label="Git commits"
                description="Committing staged changes from tools."
                value={settings.approval.commits}
                options={['once', 'session', 'auto']}
                onChange={(value) => nested('approval', { commits: value as AppSettings['approval']['commits'] })}
              />
              <ApprovalRow
                label="Deletes"
                description="Removing files or folders from disk."
                value={settings.approval.deletes}
                options={['always', 'session']}
                onChange={(value) => nested('approval', { deletes: value as AppSettings['approval']['deletes'] })}
              />
            </div>
          ) : null}

          {section === 'index' ? (
            <div className="space-y-4">
              <ToggleRow
                label="Index workspace automatically"
                description="Scans and embeds changed files in the background after opening a project."
                checked={settings.indexing.enabled}
                onChange={(value) => nested('indexing', { enabled: value })}
              />
              <ToggleRow
                label="Generate embeddings"
                description="Turns the index semantic. Disable to use keyword and symbol retrieval only."
                checked={settings.indexing.embedOnIndex}
                onChange={(value) => nested('indexing', { embedOnIndex: value })}
              />
              <NumberRow
                label="Maximum file size"
                description="Larger files are skipped during indexing."
                value={settings.indexing.maxFileSizeKb}
                min={64}
                max={4096}
                suffix="KB"
                onCommit={(value) => nested('indexing', { maxFileSizeKb: value })}
              />
              <NumberRow
                label="Embedding batch size"
                description="Lower this if the embedding model runs out of memory."
                value={settings.indexing.batchSize}
                min={1}
                max={128}
                onCommit={(value) => nested('indexing', { batchSize: value })}
              />
              <div>
                <SectionLabel>Ignore globs</SectionLabel>
                <p className="mb-1 text-[10px] text-faint">One pattern per line, in addition to .gitignore.</p>
                <textarea
                  value={ignoreDraft}
                  onChange={(event) => setIgnoreDraft(event.target.value)}
                  rows={5}
                  spellCheck={false}
                  className="w-full resize-y font-mono text-[10.5px] leading-relaxed"
                />
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    className="btn !h-7 !text-[10.5px]"
                    onClick={() => {
                      const next = ignoreDraft
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean);
                      nested('indexing', { ignoreGlobs: next });
                      toast('success', 'Ignore patterns saved');
                    }}
                  >
                    Save patterns
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {section === 'completion' ? (
            <div className="space-y-4">
              <ToggleRow
                label="Inline completions"
                description="Ghost-text suggestions from the local completion model at the cursor."
                checked={settings.completion.enabled}
                onChange={(value) => nested('completion', { enabled: value })}
              />
              <NumberRow
                label="Debounce"
                description="Wait this long after typing before requesting a completion."
                value={settings.completion.debounceMs}
                min={150}
                max={2000}
                step={50}
                suffix="ms"
                onCommit={(value) => nested('completion', { debounceMs: value })}
              />
              <NumberRow
                label="Maximum tokens"
                description="Upper bound on generated completion length."
                value={settings.completion.maxTokens}
                min={32}
                max={1024}
                onCommit={(value) => nested('completion', { maxTokens: value })}
              />
              <p className="rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-[10.5px] leading-relaxed text-faint">
                Inline completion only runs when a project is open. Press Escape to dismiss a suggestion, Tab to accept.
              </p>
            </div>
          ) : null}

          {section === 'roles' ? (
            <div>
              <p className="mb-3 text-[10.5px] leading-relaxed text-faint">
                Assign installed models to each role. ForgeAI picks sensible defaults when a role is unset, falling back
                to the chat model.
              </p>
              {(Object.keys(ROLE_LABEL) as ModelRole[]).map((role) => {
                const binding = settings.modelRoles[role];
                const value = binding ? `${binding.providerId}::${binding.model}` : '';
                const compatible =
                  role === 'embedding' ? groupedModels.filter((model) => model.capabilities.embedding) : groupedModels;
                return (
                  <div key={role} className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] text-fg">{ROLE_LABEL[role]}</p>
                      <p className="text-[9.5px] text-faint">{ROLE_HINT[role]}</p>
                    </div>
                    <select
                      value={value}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (!raw) {
                          const next = { ...settings.modelRoles };
                          delete next[role];
                          patch({ modelRoles: next });
                          return;
                        }
                        const [providerId, ...rest] = raw.split('::');
                        const model = rest.join('::');
                        if (!providerId || !model) return;
                        patch({ modelRoles: { ...settings.modelRoles, [role]: { providerId, model } as RoleBinding } });
                      }}
                      className="h-7 w-[220px] text-[10.5px]"
                    >
                      <option value="">Automatic</option>
                      {(compatible.length ? compatible : groupedModels).map((model) => (
                        <option key={`${model.providerId}::${model.id}`} value={`${model.providerId}::${model.id}`}>
                          {shortModelName(model.id)}
                          {model.parameterSize ? ` · ${model.parameterSize}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[10px] text-faint">
                  {models.length === 0 ? 'No models installed yet.' : `${models.length} models available.`}
                </p>
                <button
                  type="button"
                  className="btn !h-7 !text-[10.5px]"
                  onClick={() => {
                    setOpen(false);
                    setModelsOpen(true);
                  }}
                >
                  <Cpu size={11} /> Manage models
                </button>
              </div>
            </div>
          ) : null}

          {section === 'about' ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#007acc] text-[15px] font-black text-white">
                    F
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-fg-strong">ForgeAI (SopuForge)</p>
                    <p className="text-[10px] text-faint">Version {info?.version ?? '0.1.0'} · local-first AI IDE</p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <InfoLine label="Electron" value={info?.electron ?? '—'} />
                  <InfoLine label="Chromium" value={info?.chrome ?? '—'} />
                  <InfoLine label="Node" value={info?.node ?? '—'} />
                  <InfoLine label="Platform" value={`${info?.platform ?? '—'} ${info?.arch ?? ''}`} />
                </dl>
                <p className="mt-2 break-all font-mono text-[9px] text-faint">userData: {info?.userData ?? '—'}</p>
              </div>

              <div>
                <SectionLabel>Local usage</SectionLabel>
                {usage ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Runs recorded" value={String(usage.runs)} />
                    <Stat
                      label="Avg tokens/sec"
                      value={usage.avgTokensPerSecond ? usage.avgTokensPerSecond.toFixed(1) : '—'}
                    />
                    <Stat label="Prompt tokens" value={usage.totalPromptTokens.toLocaleString()} />
                    <Stat label="Output tokens" value={usage.totalOutputTokens.toLocaleString()} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10.5px] text-faint">
                    <Spinner className="!h-3 !w-3" /> Loading usage…
                  </div>
                )}
              </div>

              <div>
                <SectionLabel>Workspace rules</SectionLabel>
                {rules.length === 0 ? (
                  <p className="text-[10.5px] text-faint">
                    No rule files detected. Add AGENTS.md at the project root to guide chat and agents.
                  </p>
                ) : (
                  rules.map((rule) => (
                    <p key={rule.path} className="truncate font-mono text-[10px] text-muted" title={rule.path}>
                      {rule.scope === 'global' ? '~' : ''}
                      {rule.path}
                    </p>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-danger !h-7 !text-[10.5px]"
                  onClick={() =>
                    askConfirm({
                      title: 'Clear local AI history?',
                      message:
                        'This removes conversations, usage records and cached embeddings from the local database. Files and specs are untouched.',
                      confirmLabel: 'Clear history',
                      danger: true,
                      action: async () => {
                        try {
                          const conversations = useAppStore.getState().conversations;
                          for (const conversation of conversations) {
                            await window.forge.chat.remove(conversation.id);
                          }
                          await useAppStore.getState().loadConversations();
                          useAppStore.setState({ conversationId: null, messages: [] });
                          toast('success', 'Local chat history cleared');
                        } catch {
                          toast('error', 'Could not clear all conversations');
                        }
                      },
                    })
                  }
                >
                  Clear chat history
                </button>
                <span className="text-[9.5px] text-faint">
                  No telemetry. Nothing leaves this machine unless you configure a remote provider.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line-soft px-5 py-2.5">
        <span className="flex items-center gap-1.5 text-[9.5px] text-faint">
          <KeyRound size={10} /> API keys use the OS keychain and never reach the renderer.
        </span>
        <button type="button" className="btn !h-7 !text-[11px]" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line-soft py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] text-fg">{label}</p>
        <p className="text-[9.5px] leading-relaxed text-faint">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function NumberRow({
  label,
  description,
  value,
  min,
  max,
  step,
  suffix,
  onCommit,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <div className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] text-fg">{label}</p>
        {description ? <p className="text-[9.5px] leading-relaxed text-faint">{description}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          className="h-7 w-[74px] text-right font-mono text-[10.5px]"
        />
        {suffix ? <span className="w-6 text-[9.5px] text-faint">{suffix}</span> : null}
      </div>
    </div>
  );
}

function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] text-fg">{label}</p>
        <p className="text-[9.5px] leading-relaxed text-faint">{description}</p>
      </div>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-[180px] text-[10.5px]">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ApprovalRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] text-fg">{label}</p>
        <p className="text-[9.5px] leading-relaxed text-faint">{description}</p>
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-[132px] text-[10.5px] capitalize"
      >
        {options.map((option) => (
          <option key={option} value={option} className="capitalize">
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className="truncate font-mono text-muted">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-soft bg-panel-2 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-0.5 font-mono text-[13px] text-fg">{value}</p>
    </div>
  );
}
