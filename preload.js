const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  setCwd: (cwd) => ipcRenderer.invoke('app:set-cwd', cwd),

  // Terminal (multi-session)
  createTerminal: (shellType) => ipcRenderer.invoke('terminal:create', shellType),
  destroyTerminal: (id) => ipcRenderer.send('terminal:destroy', id),
  initTerminal: (id) => ipcRenderer.send('terminal:init', id),
  execTerminal: (id, line) => ipcRenderer.send('terminal:exec', id, line),
  interruptTerminal: (id) => ipcRenderer.send('terminal:interrupt', id),
  sendTerminalInput: (id, data) => ipcRenderer.send('terminal:input', id, data),
  syncTerminalCwd: (id, cwd) => ipcRenderer.send('terminal:cd', id, cwd),
  notifyTerminalFolderOpened: (activeId, cwd) =>
    ipcRenderer.send('terminal:notify-folder-opened', activeId, cwd),
  onTerminalData: (callback) =>
    ipcRenderer.on('terminal:data', (_event, id, data) => callback(id, data)),
  getTerminalCwd: (id) => ipcRenderer.invoke('terminal:get-cwd', id),
  getAvailableShells: () => ipcRenderer.invoke('terminal:available-shells'),
  listTerminals: () => ipcRenderer.invoke('terminal:list'),

  // File system
  readDir: (dirPath) => ipcRenderer.invoke('fs:read-dir', dirPath),
  pathIsDirectory: (dirPath) => ipcRenderer.invoke('fs:path-is-directory', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:read-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('fs:save-file', filePath, content),
  saveFileAs: (defaultPath, content) =>
    ipcRenderer.invoke('fs:save-file-as', defaultPath, content),
  createFile: (dirPath, fileName) =>
    ipcRenderer.invoke('fs:create-file', dirPath, fileName),
  createFolder: (dirPath, folderName) =>
    ipcRenderer.invoke('fs:create-folder', dirPath, folderName),
  renamePath: (oldPath, newName) => ipcRenderer.invoke('fs:rename', oldPath, newName),
  deletePath: (targetPath) => ipcRenderer.invoke('fs:delete', targetPath),
  readFileBase64: (filePath) => ipcRenderer.invoke('fs:read-file-base64', filePath),
  walkTree: (root, maxDepth) => ipcRenderer.invoke('fs:walk-tree', root, maxDepth),

  // Dialogs
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  confirmDialog: (options) => ipcRenderer.invoke('dialog:confirm', options),

  // Environment
  getEnvVars: () => ipcRenderer.invoke('env:get'),

  // Window
  windowControl: (action) => ipcRenderer.send('window-control', action),

  // Theme
  setNativeTheme: (theme) => ipcRenderer.send('theme:set-native', theme),

  // Ports / shell
  listPorts: () => ipcRenderer.invoke('ports:list'),
  forwardPort: (port) => ipcRenderer.invoke('ports:forward', port),
  unforwardPort: (port) => ipcRenderer.invoke('ports:unforward', port),
  getForwardedPorts: () => ipcRenderer.invoke('ports:forwarded-list'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Workspace watcher
  watchFolder: (root) => ipcRenderer.invoke('fs:watch-folder', root),
  unwatchFolder: () => ipcRenderer.invoke('fs:unwatch'),
  onFsChanged: (cb) => ipcRenderer.on('fs:changed', (_e, payload) => cb(payload)),

  // Search
  searchInFolder: (opts) => ipcRenderer.invoke('search:in-folder', opts),

  // AI (Pollinations)
  ai: {
    config: () => ipcRenderer.invoke('ai:config'),
    chatStart: (payload) => ipcRenderer.invoke('ai:chat-start', payload),
    cancel: (messageId) => ipcRenderer.send('ai:chat-cancel', messageId),
    onChunk: (cb) => ipcRenderer.on('ai:chunk', (_e, payload) => cb(payload)),
    onDone: (cb) => ipcRenderer.on('ai:done', (_e, payload) => cb(payload)),
    onError: (cb) => ipcRenderer.on('ai:error', (_e, payload) => cb(payload)),
  },

  // Git
  git: {
    status: (root) => ipcRenderer.invoke('git:status', root),
    stage: (root, paths) => ipcRenderer.invoke('git:stage', root, paths),
    stageAll: (root) => ipcRenderer.invoke('git:stage-all', root),
    unstage: (root, paths) => ipcRenderer.invoke('git:unstage', root, paths),
    discard: (root, filePath) => ipcRenderer.invoke('git:discard', root, filePath),
    commit: (root, message, amend, signoff) => ipcRenderer.invoke('git:commit', root, message, amend, signoff),
    exec: (root, command) => ipcRenderer.invoke('git:exec', root, command),
    push: (root) => ipcRenderer.invoke('git:push', root),
    pull: (root) => ipcRenderer.invoke('git:pull', root),
    fetch: (root) => ipcRenderer.invoke('git:fetch', root),
    init: (root) => ipcRenderer.invoke('git:init', root),
    setRemote: (root, url) => ipcRenderer.invoke('git:set-remote', root, url),
    publish: (root, branch) => ipcRenderer.invoke('git:publish', root, branch),
    diff: (root, file, isStaged) => ipcRenderer.invoke('git:diff', root, file, isStaged),
    show: (root, hash) => ipcRenderer.invoke('git:show', root, hash),
  },

  // Menu events
  onMenu: (channel, callback) => {
    const fullChannel = `menu:${channel}`;
    ipcRenderer.on(fullChannel, () => callback());
  },
});
