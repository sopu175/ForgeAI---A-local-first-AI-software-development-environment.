import path from 'node:path';
import { app } from 'electron';
import { Database } from './db';
import { broadcast } from './broadcast';
import { SettingsService } from './services/settings';
import { WorkspaceService, type Broadcast } from './services/workspace';
import { ProvidersService } from './services/providers';
import { OllamaRuntime } from './services/ollama';
import { PermissionBroker } from './permissions';
import { SearchService } from './services/search';
import { GitService } from './services/git';
import { TerminalService } from './services/terminal';
import { IndexerService } from './services/indexer';
import { CheckpointService } from './services/checkpoints';
import { SpecService } from './specs/service';
import { AgentRuntimeService } from './agent/runtime';

export const LAST_WORKSPACE_KEY = 'workspace:last';

export interface AppContext {
  userDataDir: string;
  broadcast: Broadcast;
  db: Database;
  settings: SettingsService;
  workspace: WorkspaceService;
  providers: ProvidersService;
  runtime: OllamaRuntime;
  permissions: PermissionBroker;
  search: SearchService;
  git: GitService;
  terminal: TerminalService;
  indexer: IndexerService;
  checkpoints: CheckpointService;
  specs: SpecService;
  agent: AgentRuntimeService;
  dispose(): void;
}

/**
 * Opens a workspace, remembers it for the next launch and kicks off background
 * indexing. Shared by the IPC layer and the startup restore path.
 */
export async function openWorkspace(context: AppContext, root: string) {
  const summary = await context.workspace.open(root);
  context.db.setSetting(LAST_WORKSPACE_KEY, summary.root);
  if (context.settings.get().indexing.enabled) {
    // Indexing is incremental and skips unchanged files, so this is cheap on
    // reopen. Delay it past the local-model warm-up so they do not compete for
    // CPU/GPU during the first few seconds.
    setTimeout(() => {
      try {
        if (context.workspace.isOpen() && context.workspace.projectId === summary.id) {
          void context.indexer.start(summary.id);
        }
      } catch {
        // Indexing is best-effort at startup.
      }
    }, 4000).unref?.();
  }
  return summary;
}

export function createContext(): AppContext {
  const userDataDir = app.getPath('userData');
  const db = new Database(path.join(userDataDir, 'forgeai.db'));
  const settings = new SettingsService(db);
  const workspace = new WorkspaceService(db, userDataDir, broadcast);
  const providers = new ProvidersService(db, settings, broadcast);
  const runtime = new OllamaRuntime(userDataDir, providers, settings, broadcast);
  const permissions = new PermissionBroker(db, settings, broadcast);
  const search = new SearchService(workspace);
  const git = new GitService(workspace);
  const terminal = new TerminalService(workspace, broadcast);
  const indexer = new IndexerService(db, workspace, providers, settings, broadcast);
  const checkpoints = new CheckpointService(db, workspace, userDataDir);
  const specs = new SpecService(db, workspace, providers, settings, indexer, search, broadcast);
  const agent = new AgentRuntimeService(
    db,
    workspace,
    providers,
    settings,
    indexer,
    search,
    git,
    checkpoints,
    permissions,
    broadcast,
    specs,
  );

  // File changes from any source (agent, terminal, external editor) should
  // refresh the source-control view.
  let gitTimer: NodeJS.Timeout | null = null;
  workspace.onFileEvents(() => {
    if (!workspace.isOpen()) return;
    if (gitTimer) return;
    const projectId = workspace.projectId;
    gitTimer = setTimeout(() => {
      gitTimer = null;
      broadcast('git:changed', { projectId });
    }, 250);
    gitTimer.unref?.();
  });

  const context: AppContext = {
    userDataDir,
    broadcast,
    db,
    settings,
    workspace,
    providers,
    runtime,
    permissions,
    search,
    git,
    terminal,
    indexer,
    checkpoints,
    specs,
    agent,
    dispose: () => {
      agent.cancelAll();
      runtime.dispose();
      terminal.disposeAll();
      db.close();
    },
  };
  return context;
}
