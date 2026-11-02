import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ForgeApi, ForgeEventName, ForgeEvents } from '@forgeai/shared';

const EVENT_NAMES: ReadonlySet<string> = new Set<ForgeEventName>([
  'workspace:changed',
  'workspace:opened',
  'index:progress',
  'terminal:data',
  'terminal:exit',
  'ai:stream',
  'ai:pull',
  'permission:request',
  'permission:resolved',
  'agent:event',
  'spec:changed',
  'git:changed',
  'app:command',
  'app:open-workspace',
  'app:toast',
  'runtime:progress',
]);

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api: ForgeApi = {
  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:openExternal', url),
    minimize: () => invoke('app:window', 'minimize'),
    toggleMaximize: () => invoke('app:window', 'maximize'),
    close: () => invoke('app:window', 'close'),
    getFilePath: (file) => webUtils.getPathForFile(file),
  },
  workspace: {
    openDialog: () => invoke('workspace:openDialog'),
    open: (root) => invoke('workspace:open', root),
    recent: () => invoke('workspace:recent'),
    current: () => invoke('workspace:current'),
    close: () => invoke('workspace:close'),
    tree: () => invoke('workspace:tree'),
    list: (dir) => invoke('workspace:list', dir),
    readFile: (path) => invoke('workspace:readFile', path),
    writeFile: (path, content) => invoke('workspace:writeFile', path, content),
    createFile: (path, content) => invoke('workspace:createFile', path, content),
    createDirectory: (path) => invoke('workspace:createDirectory', path),
    rename: (oldPath, newPath) => invoke('workspace:rename', oldPath, newPath),
    remove: (paths) => invoke('workspace:remove', paths),
    reveal: (path) => invoke('workspace:reveal', path),
    browsers: () => invoke('workspace:browsers'),
    openInBrowser: (path, browserId) => invoke('workspace:openInBrowser', path, browserId ?? ''),
    rules: () => invoke('workspace:rules'),
    stack: () => invoke('workspace:stack'),
    projectIdFor: (path) => invoke('workspace:projectIdFor', path),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    recommendRoles: () => invoke('settings:recommendRoles'),
  },
  runtime: {
    status: () => invoke('runtime:status'),
    ensure: () => invoke('runtime:ensure'),
    cancel: () => invoke('runtime:cancel'),
  },
  providers: {
    list: () => invoke('providers:list'),
    upsert: (config) => invoke('providers:upsert', config),
    remove: (id) => invoke('providers:remove', id),
    setApiKey: (id, key) => invoke('providers:setApiKey', id, key),
    clearApiKey: (id) => invoke('providers:clearApiKey', id),
    health: (id) => invoke('providers:health', id),
    models: (refresh) => invoke('providers:models', refresh ?? false),
    pull: (providerId, model) => invoke('providers:pull', providerId, model),
    cancelPull: () => invoke('providers:cancelPull'),
    removeModel: (providerId, model) => invoke('providers:removeModel', providerId, model),
    keepOnly: (providerId, keep) => invoke('providers:keepOnly', providerId, keep),
    running: () => invoke('providers:running'),
    route: (request) => invoke('providers:route', request),
  },
  chat: {
    list: (projectId) => invoke('chat:list', projectId),
    create: (input) => invoke('chat:create', input),
    rename: (id, title) => invoke('chat:rename', id, title),
    remove: (id) => invoke('chat:remove', id),
    messages: (conversationId) => invoke('chat:messages', conversationId),
    addMessage: (input) => invoke('chat:addMessage', input),
    clear: (conversationId) => invoke('chat:clear', conversationId),
  },
  ai: {
    stream: (args) => invoke('ai:stream', args),
    cancel: (requestId) => invoke('ai:cancel', requestId),
    complete: (args) => invoke('ai:complete', args),
    quickEdit: (args) => invoke('ai:quickEdit', args),
    usage: () => invoke('ai:usage'),
  },
  agent: {
    start: (request) => invoke('agent:start', request),
    cancel: (runId) => invoke('agent:cancel', runId),
    respond: (response) => invoke('agent:respond', response),
    pending: () => invoke('agent:pending'),
  },
  specs: {
    list: (projectId) => invoke('specs:list', projectId),
    get: (projectId, feature) => invoke('specs:get', projectId, feature),
    create: (projectId, feature, description) => invoke('specs:create', projectId, feature, description),
    generate: (projectId, feature, phase) => invoke('specs:generate', projectId, feature, phase),
    update: (projectId, feature, part, content) => invoke('specs:update', projectId, feature, part, content),
    approve: (projectId, feature, phase) => invoke('specs:approve', projectId, feature, phase),
    updateTask: (projectId, feature, taskId, patch) => invoke('specs:updateTask', projectId, feature, taskId, patch),
    remove: (projectId, feature) => invoke('specs:remove', projectId, feature),
  },
  index: {
    status: (projectId) => invoke('index:status', projectId),
    start: (projectId) => invoke('index:start', projectId),
    cancel: (projectId) => invoke('index:cancel', projectId),
    search: (projectId, query, limit) => invoke('index:search', projectId, query, limit),
    symbols: (projectId, query) => invoke('index:symbols', projectId, query),
    rebuild: (projectId) => invoke('index:rebuild', projectId),
  },
  search: {
    text: (projectId, options) => invoke('search:text', projectId, options),
    files: (projectId, query, limit) => invoke('search:files', projectId, query, limit),
  },
  git: {
    status: (projectId) => invoke('git:status', projectId),
    diff: (projectId, path, staged) => invoke('git:diff', projectId, path, staged),
    branches: (projectId) => invoke('git:branches', projectId),
    checkout: (projectId, branch) => invoke('git:checkout', projectId, branch),
    createBranch: (projectId, name) => invoke('git:createBranch', projectId, name),
    stage: (projectId, paths) => invoke('git:stage', projectId, paths),
    unstage: (projectId, paths) => invoke('git:unstage', projectId, paths),
    commit: (projectId, message, paths) => invoke('git:commit', projectId, message, paths),
    log: (projectId, limit) => invoke('git:log', projectId, limit),
    discard: (projectId, paths) => invoke('git:discard', projectId, paths),
    generateMessage: (projectId) => invoke('git:generateMessage', projectId),
  },
  terminal: {
    create: (options) => invoke('terminal:create', options),
    write: (id, data) => invoke('terminal:write', id, data),
    resize: (id, cols, rows) => invoke('terminal:resize', id, cols, rows),
    dispose: (id) => invoke('terminal:dispose', id),
    list: () => invoke('terminal:list'),
  },
  checkpoints: {
    list: (projectId) => invoke('checkpoints:list', projectId),
    create: (projectId, label) => invoke('checkpoints:create', projectId, label),
    restore: (projectId, checkpointId) => invoke('checkpoints:restore', projectId, checkpointId),
    diff: (projectId, checkpointId) => invoke('checkpoints:diff', projectId, checkpointId),
  },
  memory: {
    list: (projectId, kind) => invoke('memory:list', projectId, kind),
    save: (memory) => invoke('memory:save', memory),
    remove: (id) => invoke('memory:remove', id),
  },
  events: {
    on: <K extends ForgeEventName>(event: K, callback: (payload: ForgeEvents[K]) => void) => {
      if (!EVENT_NAMES.has(event)) throw new Error(`Unknown event: ${event}`);
      const listener = (_event: Electron.IpcRendererEvent, payload: ForgeEvents[K]) => callback(payload);
      ipcRenderer.on(event, listener);
      return () => {
        ipcRenderer.removeListener(event, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('forge', api);
