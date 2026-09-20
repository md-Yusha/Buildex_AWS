const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const https = require('https');
const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { chatStream: bedrockChatStream, resolveBedrockModel } = require('./src/ai/bedrockClient');
const { 
  getUserProgress, 
  updateUserProgress, 
  getPresignedUploadUrl, 
  uploadImageToS3, 
  getUserAccount, 
  deductUserCredits, 
  updateUserProfile,
  backupChatToDynamoDB,
  getChatsFromDynamoDB,
  deleteChatFromDynamoDB,
  initiateAuthSession, 
  pollAuthSession 
} = require('./src/services/awsClient');

let mainWindow;

/** Helper to kill a process and its entire tree on Windows/Unix */
function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${pid} /t /f`, () => {});
    } else {
      // On Unix, we kill the process group if possible
      try { process.kill(-pid, 'SIGKILL'); } catch (_) {
        try { process.kill(pid, 'SIGKILL'); } catch (_) {}
      }
    }
  } catch (_) {}
}

/* -------------------- .env loader (zero-dep) -------------------- */
function getEnvFilePath() {
  const candidatePaths = [
    process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
    path.join(__dirname, '.env'),
    path.join(process.cwd(), '.env'),
    typeof app !== 'undefined' && app.getAppPath ? path.join(app.getAppPath(), '.env') : null,
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadEnvFile() {
  const envPath = getEnvFilePath();
  if (!envPath) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.error('Failed to load .env:', err.message);
  }
}
loadEnvFile();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'BuildeX Coder IDE',
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Open http(s) including localhost in the system browser instead of the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (_) { }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const u = new URL(navigationUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        event.preventDefault();
        shell.openExternal(navigationUrl);
      }
    } catch (_) { }
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-change', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-change', false);
  });
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-change', false);
  });

  mainWindow.loadFile('index.html');

  // Register terminal handlers as early as possible
  ipcMain.handle('terminal:create', (_event, shellType) => {
    const id = nextTerminalId++;
    terminalSessions.set(id, { id, cwd: defaultTerminalCwd, running: null, shellType: shellType || null });
    return id;
  });

  ipcMain.handle('terminal:available-shells', () => {
    return detectAvailableShells();
  });

  ipcMain.handle('terminal:list', () => {
    try {
      return Array.from(terminalSessions.values()).map(s => ({
        id: s.id,
        cwd: s.cwd,
        shellType: s.shellType,
        isRunning: !!s.running
      }));
    } catch (e) {
      console.error('Error listing terminals:', e);
      return [];
    }
  });

  // Kill everything ONLY on app close, not on reload, to allow persistence.
  // We keep terminal:destroy and terminal:interrupt for explicit port cleanup.
  const cleanupAll = () => {
    for (const sess of terminalSessions.values()) {
      if (sess.running) killProcessTree(sess.running.pid);
    }
    terminalSessions.clear();
    for (const tunnel of activeTunnels.values()) {
      if (tunnel.child) killProcessTree(tunnel.child.pid);
    }
    activeTunnels.clear();
  };

  mainWindow.on('closed', cleanupAll);

  // Build a basic native menu
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+K CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu:open-folder'),
        },
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu:open-file'),
        },
        { type: 'separator' },
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:new-file'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu:save-as'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow.webContents.send('menu:toggle-sidebar'),
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => mainWindow.webContents.send('menu:toggle-terminal'),
        },
        {
          label: 'Toggle Chat',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow.webContents.send('menu:toggle-chat'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('theme:set-native', (event, theme) => {
  nativeTheme.themeSource = theme;
});

ipcMain.handle('env:get', () => {
  try {
    const envPath = getEnvFilePath();
    if (!envPath) return { ...process.env };
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const env = {};
    for (const line of lines) {
      if (line.trim() && !line.startsWith('#')) {
        const [key, ...vals] = line.split('=');
        if (key && vals.length > 0) {
          env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    }
    return env;
  } catch (e) {
    return {};
  }
});

ipcMain.handle('window:is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.isMaximized() : false;
});

ipcMain.on('window-control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (action === 'close') win.close();
});

app.whenReady().then(() => {
  createWindow();

  // Automatic update check 5 seconds after launch
  setTimeout(() => {
    checkAppUpdates(false).catch(() => {});
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* -------------------- Terminal (multi-session, line-based) -------------------- */
// Per-window default cwd used by new terminal sessions. Each session owns
// its own cwd and (optionally) running child process.
let defaultTerminalCwd = os.homedir();
const terminalSessions = new Map(); // id -> { id, cwd, running, shellType }
let nextTerminalId = 1;

/* Detect available shells on the system */
function detectAvailableShells() {
  const shells = [];
  if (process.platform === 'win32') {
    shells.push({ id: 'powershell', name: 'PowerShell', path: 'powershell.exe' });
    shells.push({ id: 'cmd', name: 'Command Prompt', path: process.env.COMSPEC || 'cmd.exe' });
    // Check for Git Bash
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const p of gitBashPaths) {
      if (fs.existsSync(p)) { shells.push({ id: 'gitbash', name: 'Git Bash', path: p }); break; }
    }
    // Check for WSL
    try {
      require('child_process').execSync('where wsl', { stdio: 'ignore' });
      shells.push({ id: 'wsl', name: 'WSL', path: 'wsl.exe' });
    } catch (_) { }
  } else {
    // macOS / Linux
    const candidates = [
      { id: 'zsh', name: 'zsh', path: '/bin/zsh' },
      { id: 'bash', name: 'bash', path: '/bin/bash' },
      { id: 'sh', name: 'sh', path: '/bin/sh' },
      { id: 'fish', name: 'fish', path: '/usr/local/bin/fish' },
      { id: 'fish', name: 'fish', path: '/opt/homebrew/bin/fish' },
    ];
    const seen = new Set();
    for (const c of candidates) {
      if (!seen.has(c.id) && fs.existsSync(c.path)) {
        shells.push(c);
        seen.add(c.id);
      }
    }
  }
  return shells;
}

function getSession(id) {
  return terminalSessions.get(id);
}

function termWrite(id, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal:data', id, data);
  }
}

function detectVenvPrefix(sess) {
  // Check VIRTUAL_ENV in process env (globally activated)
  if (process.env.VIRTUAL_ENV) {
    const name = path.basename(process.env.VIRTUAL_ENV);
    return `\x1b[33m(${name})\x1b[0m `;
  }
  // Check CONDA_DEFAULT_ENV
  if (process.env.CONDA_DEFAULT_ENV && process.env.CONDA_DEFAULT_ENV !== 'base') {
    return `\x1b[33m(${process.env.CONDA_DEFAULT_ENV})\x1b[0m `;
  }
  // Auto-detect venv folder in current cwd
  const venvDirs = ['venv', '.venv', 'env', '.env'];
  for (const d of venvDirs) {
    const activatePath = path.join(sess.cwd, d, 'bin', 'activate');
    const activateWinPath = path.join(sess.cwd, d, 'Scripts', 'activate.bat');
    if (fs.existsSync(activatePath) || fs.existsSync(activateWinPath)) {
      return `\x1b[33m(${d})\x1b[0m `;
    }
  }
  return '';
}

function buildPrompt(sess) {
  const userInfo = os.userInfo();
  const hostname = os.hostname().split('.')[0];
  const home = os.homedir();
  let displayCwd = sess.cwd;
  if (displayCwd.startsWith(home)) {
    displayCwd = '~' + displayCwd.slice(home.length);
  }
  const venvPrefix = detectVenvPrefix(sess);
  const shellLabel = sess.shellType ? `\x1b[2m[${sess.shellType}]\x1b[0m ` : '';
  return `${venvPrefix}${shellLabel}\x1b[1;32m${userInfo.username}@${hostname}\x1b[0m:\x1b[1;34m${displayCwd}\x1b[0m$ `;
}

// Used when starting fresh / after errors; ensures we are on a new line.
function termPrompt(sess) {
  termWrite(sess.id, '\r\n' + buildPrompt(sess));
}

// Used right after command output finished. Caller has already ensured we're
// at the start of a fresh line, so we write the prompt without prefix.
function termPromptAfterOutput(sess) {
  termWrite(sess.id, buildPrompt(sess));
}

// Handlers moved higher up


ipcMain.on('terminal:destroy', (_event, id) => {
  const sess = getSession(id);
  if (!sess) return;
  if (sess.running) {
    killProcessTree(sess.running.pid);
  }
  terminalSessions.delete(id);
});

ipcMain.on('terminal:init', (_event, id) => {
  const sess = getSession(id);
  if (!sess) return;
  termPrompt(sess);
});

ipcMain.on('terminal:cd', (_event, id, newCwd) => {
  const sess = getSession(id);
  if (!sess) return;
  if (newCwd && fs.existsSync(newCwd) && fs.statSync(newCwd).isDirectory()) {
    sess.cwd = newCwd;
  }
});

// Refresh the visible terminal after a workspace folder is opened. Updates
// the default cwd for new terminals, and (if the active session is idle)
// shows a fresh prompt at the new directory.
ipcMain.on('terminal:notify-folder-opened', (_event, activeId, newCwd) => {
  if (!newCwd) return;
  try {
    if (!fs.statSync(newCwd).isDirectory()) return;
  } catch (_) {
    return;
  }
  defaultTerminalCwd = newCwd;
  const sess = getSession(activeId);
  if (!sess) return;
  sess.cwd = newCwd;
  if (sess.running) return;
  termWrite(sess.id, '\r\n\x1b[2m── Workspace: ' + newCwd + '\x1b[0m\r\n');
  termPromptAfterOutput(sess);
});

ipcMain.on('terminal:exec', (_event, id, line) => {
  const sess = getSession(id);
  if (!sess) return;
  const cmd = (line || '').trim();
  if (!cmd) {
    termPromptAfterOutput(sess);
    return;
  }

  if (cmd === 'clear' || cmd === 'cls') {
    termWrite(sess.id, '\x1b[2J\x1b[H\x1b[3J');
    termPromptAfterOutput(sess);
    return;
  }

  if (cmd === 'cd' || cmd.startsWith('cd ')) {
    const arg = cmd === 'cd' ? os.homedir() : cmd.slice(3).trim();
    let target = arg.replace(/^~(?=\/|$)/, os.homedir());
    if (!path.isAbsolute(target)) {
      target = path.resolve(sess.cwd, target);
    }
    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        sess.cwd = target;
      } else {
        termWrite(sess.id, `\x1b[31mcd: not a directory: ${arg}\x1b[0m\r\n`);
      }
    } catch (e) {
      termWrite(sess.id, `\x1b[31mcd: no such file or directory: ${arg}\x1b[0m\r\n`);
    }
    termPromptAfterOutput(sess);
    return;
  }

  if (cmd === 'pwd') {
    termWrite(sess.id, `${sess.cwd}\r\n`);
    termPromptAfterOutput(sess);
    return;
  }

  // Resolve shell path: use session's shell type if set, otherwise fall back to system default
  let shellPath;
  if (sess.shellType) {
    const shells = detectAvailableShells();
    const match = shells.find(s => s.id === sess.shellType || s.name === sess.shellType);
    shellPath = match ? match.path : (process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash'));
  } else {
    shellPath = process.platform === 'win32'
      ? process.env.COMSPEC || 'cmd.exe'
      : process.env.SHELL || '/bin/bash';
  }

  // Build shell args — handle venv activation for Python environments
  let effectiveCmd = cmd;
  const venvDirs = ['venv', '.venv', 'env', '.env'];
  let venvActivate = null;
  for (const d of venvDirs) {
    const ap = path.join(sess.cwd, d, 'bin', 'activate');
    if (fs.existsSync(ap)) { venvActivate = ap; break; }
  }
  if (venvActivate && !cmd.startsWith('deactivate')) {
    effectiveCmd = `source ${JSON.stringify(venvActivate)} 2>/dev/null; ${cmd}`;
  }

  const isWin = process.platform === 'win32';
  const shellArgs = isWin ? ['/c', effectiveCmd] : ['-lc', effectiveCmd];

  const childEnv = {
    ...process.env,
    FORCE_COLOR: '3',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    COLUMNS: '120',
    LINES: '30'
  };
  // Pass through venv env vars if present
  if (process.env.VIRTUAL_ENV) childEnv.VIRTUAL_ENV = process.env.VIRTUAL_ENV;
  if (process.env.CONDA_DEFAULT_ENV) childEnv.CONDA_DEFAULT_ENV = process.env.CONDA_DEFAULT_ENV;

  const child = spawn(shellPath, shellArgs, {
    cwd: sess.cwd,
    env: childEnv,
  });
  sess.running = child;

  let lastByteWasNewline = true;
  const writeStream = (data) => {
    const str = data.toString();
    termWrite(sess.id, str);
    if (str.length > 0) {
      lastByteWasNewline = str.endsWith('\r\n') || str.endsWith('\n');
    }
  };
  child.stdout.on('data', (data) => writeStream(data));
  child.stderr.on('data', (data) => writeStream(data));
  child.on('close', (code) => {
    sess.running = null;
    if (code !== 0 && code !== null) {
      const prefix = lastByteWasNewline ? '' : '\r\n';
      termWrite(sess.id, `${prefix}\x1b[2m[exit ${code}]\x1b[0m`);
      lastByteWasNewline = false;
    }
    if (!lastByteWasNewline) termWrite(sess.id, '\r\n');
    termPromptAfterOutput(sess);
  });
  child.on('error', (err) => {
    sess.running = null;
    termWrite(sess.id, `\x1b[31m${err.message}\x1b[0m\r\n`);
    termPromptAfterOutput(sess);
  });
});

ipcMain.on('terminal:input', (_event, id, data) => {
  const sess = getSession(id);
  if (sess && sess.running && sess.running.stdin) {
    sess.running.stdin.write(data);
  }
});

ipcMain.on('terminal:interrupt', (_event, id) => {
  const sess = getSession(id);
  if (sess && sess.running) {
    // Try graceful stdin break first
    if (sess.running.stdin && sess.running.stdin.writable) {
      try { sess.running.stdin.write('\x03'); } catch (_) {}
    }
    // Forceful tree kill
    killProcessTree(sess.running.pid);
  }
});

ipcMain.handle('terminal:get-cwd', (_event, id) => {
  const sess = getSession(id);
  return sess ? sess.cwd : defaultTerminalCwd;
});

/* -------------------- File system APIs -------------------- */
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache']);

ipcMain.handle('fs:read-dir', async (_event, dirPath) => {
  try {
    const target = dirPath || os.homedir();
    const items = await fs.promises.readdir(target, { withFileTypes: true });
    return items
      .map((item) => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: path.join(target, item.name),
      }))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    console.error(err);
    return [];
  }
});

ipcMain.handle('fs:read-file', async (_event, filePath) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const stat = await fs.promises.stat(filePath);
    return { ok: true, content, size: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:save-file', async (_event, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:save-file-as', async (_event, defaultPath, content) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save File As',
      defaultPath: defaultPath || path.join(os.homedir(), 'untitled.txt'),
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(result.filePath, content, 'utf-8');
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:create-file', async (_event, dirPath, fileName) => {
  try {
    const targetPath = path.join(dirPath || defaultTerminalCwd, fileName);
    if (fs.existsSync(targetPath)) {
      return { ok: false, error: 'File already exists' };
    }
    await fs.promises.writeFile(targetPath, '', 'utf-8');
    return { ok: true, path: targetPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:create-folder', async (_event, dirPath, folderName) => {
  try {
    const targetPath = path.join(dirPath || defaultTerminalCwd, folderName);
    await fs.promises.mkdir(targetPath, { recursive: false });
    return { ok: true, path: targetPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:rename', async (_event, oldPath, newName) => {
  try {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    await fs.promises.rename(oldPath, newPath);
    return { ok: true, path: newPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:path-is-directory', (_event, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
});

ipcMain.handle('fs:delete', async (_event, targetPath) => {
  try {
    const stat = await fs.promises.stat(targetPath);
    if (stat.isDirectory()) {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(targetPath);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('shell:show-item-in-folder', async (_event, fullPath) => {
  try {
    if (!fullPath) return { ok: false, error: 'Path required' };
    shell.showItemInFolder(fullPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:copy-item', async (_event, srcPath, destDir) => {
  try {
    if (!srcPath || !destDir) return { ok: false, error: 'Invalid paths' };
    const base = path.basename(srcPath);
    let destPath = path.join(destDir, base);
    if (srcPath === destPath || fs.existsSync(destPath)) {
      const ext = path.extname(base);
      const nameWithoutExt = path.basename(base, ext);
      destPath = path.join(destDir, `${nameWithoutExt} copy${ext}`);
    }
    await fs.promises.cp(srcPath, destPath, { recursive: true });
    return { ok: true, path: destPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:move-item', async (_event, srcPath, destDir) => {
  try {
    if (!srcPath || !destDir) return { ok: false, error: 'Invalid paths' };
    const base = path.basename(srcPath);
    const destPath = path.join(destDir, base);
    await fs.promises.rename(srcPath, destPath);
    return { ok: true, path: destPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});


/* -------------------- Dialogs -------------------- */
ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  // Update default cwd for new terminal sessions to follow opened folder.
  defaultTerminalCwd = result.filePaths[0];
  return result.filePaths[0];
});

ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open File',
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:confirm', async (_event, options) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: options.buttons || ['Cancel', 'OK'],
    defaultId: 1,
    cancelId: 0,
    title: options.title || 'Confirm',
    message: options.message || '',
    detail: options.detail || '',
  });
  return result.response;
});

/* -------------------- Ports listing -------------------- */
ipcMain.handle('ports:list', async () => {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('netstat -ano -p TCP', (err, stdout) => {
        if (err) return resolve([]);
        const ports = [];
        const seen = new Set();
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          if (!/LISTENING/i.test(line)) continue;
          const parts = line.trim().split(/\s+/);
          if (parts.length < 5) continue;
          const local = parts[1];
          const pid = parseInt(parts[parts.length - 1], 10);
          const m = local && local.match(/:(\d+)$/);
          if (!m) continue;
          const port = parseInt(m[1], 10);
          const key = `${port}-${pid}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ports.push({ port, pid, command: '', address: local });
        }
        resolve(ports.sort((a, b) => a.port - b.port));
      });
    } else {
      exec('lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null', (err, stdout) => {
        if (err && !stdout) return resolve([]);
        const ports = [];
        const seen = new Set();
        const lines = stdout.split('\n');
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const parts = line.split(/\s+/);
          if (parts.length < 9) continue;
          const command = parts[0];
          const pid = parseInt(parts[1], 10);
          const name = parts.slice(8).join(' ');
          const m = name.match(/:(\d+)\s*\(LISTEN\)/);
          if (!m) continue;
          const port = parseInt(m[1], 10);
          const key = `${port}-${pid}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ports.push({ port, pid, command, address: name.replace(/\s*\(LISTEN\)\s*$/, '') });
        }
        resolve(ports.sort((a, b) => a.port - b.port || a.pid - b.pid));
      });
    }
  });
});

const activeTunnels = new Map();

ipcMain.handle('ports:forward', async (_event, port) => {
  return new Promise((resolve) => {
    if (activeTunnels.has(port)) {
      return resolve({ ok: true, url: activeTunnels.get(port).url });
    }
    const shellPath = process.platform === 'win32' ? true : false;
    const child = spawn('npx', ['localtunnel', '--port', port], { shell: shellPath });
    let url = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/your url is: (https?:\/\/[^\s]+)/);
      if (match && !url) {
        url = match[1];
        activeTunnels.set(port, { child, url });
        resolve({ ok: true, url });
      }
    });

    child.stderr.on('data', (data) => {
      if (!url && data.toString().trim() && !data.toString().includes('npm')) {
        resolve({ ok: false, error: data.toString() });
      }
    });

    child.on('close', () => {
      activeTunnels.delete(port);
    });

    setTimeout(() => {
      if (!url) {
        try { child.kill(); } catch (_) { }
        resolve({ ok: false, error: 'Timeout waiting for localtunnel' });
      }
    }, 15000);
  });
});

ipcMain.handle('ports:unforward', async (_event, port) => {
  if (activeTunnels.has(port)) {
    const tunnel = activeTunnels.get(port);
    if (tunnel.child) killProcessTree(tunnel.child.pid);
    activeTunnels.delete(port);
  }
  return { ok: true };
});

ipcMain.handle('ports:forwarded-list', async () => {
  const list = [];
  for (const [port, data] of activeTunnels.entries()) {
    list.push({ port, url: data.url });
  }
  return list;
});


ipcMain.handle('shell:open-external', async (_event, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

/* Read file as base64 (for image attachments in chat) */
ipcMain.handle('fs:read-file-base64', async (_event, filePath) => {
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
    const mime = mimeMap[ext] || 'application/octet-stream';
    return { ok: true, data: `data:${mime};base64,${data.toString('base64')}`, name: path.basename(filePath), size: data.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* Walk directory tree for file picker (chat @-mention) */
ipcMain.handle('fs:walk-tree', async (_event, root, maxDepth = 6) => {
  const IGNORE = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '__pycache__', '.turbo', '.parcel-cache', 'coverage', '.svelte-kit', '.expo', '.gradle', 'target', '.venv', 'venv', 'env']);
  const results = [];
  const MAX = 2000;
  async function walk(dir, depth, prefix) {
    if (depth > maxDepth || results.length >= MAX) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (results.length >= MAX) return;
      if (e.name.startsWith('.') && IGNORE.has(e.name)) continue;
      if (IGNORE.has(e.name)) continue;
      const rel = prefix ? prefix + '/' + e.name : e.name;
      const full = path.join(dir, e.name);
      results.push({ name: e.name, path: rel, fullPath: full, isDir: e.isDirectory() });
      if (e.isDirectory()) {
        await walk(full, depth + 1, rel);
      }
    }
  }
  await walk(root, 0, '');
  return results;
});

/* -------------------- Misc -------------------- */
ipcMain.handle('app:get-info', () => ({
  homedir: os.homedir(),
  platform: process.platform,
  appVersion: app.getVersion(),
  appName: 'BuildeX Coder IDE',
  initialCwd: defaultTerminalCwd,
  isFullScreen: mainWindow ? mainWindow.isFullScreen() : false,
}));

ipcMain.handle('app:set-cwd', (_event, newCwd) => {
  if (newCwd && fs.existsSync(newCwd) && fs.statSync(newCwd).isDirectory()) {
    defaultTerminalCwd = newCwd;
    return true;
  }
  return false;
});

/* -------------------- Application Updates -------------------- */
function semverCompare(a, b) {
  const pa = (a || '').replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
  const pb = (b || '').replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function fetchJsonUrl(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const req = https.get(parsed, {
        headers: { 'User-Agent': 'BuildeX-IDE-Updater/1.0' },
        timeout: timeoutMs,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchJsonUrl(res.headers.location, timeoutMs).then(resolve, reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Update check timed out'));
      });
      req.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function checkAppUpdates(manual = false) {
  const currentVersion = app.getVersion();
  const S3_VERSION_URL = 'https://buildex-ide-web-052477895001.s3.ap-south-1.amazonaws.com/downloads/version.json';
  const GITHUB_API_URL = 'https://api.github.com/repos/md-Yusha/Buildex_AWS/releases/latest';

  let remoteData = null;
  // 1. Try S3 version.json
  try {
    remoteData = await fetchJsonUrl(S3_VERSION_URL);
  } catch (err) {
    // 2. Fallback to GitHub releases API
    try {
      const gh = await fetchJsonUrl(GITHUB_API_URL);
      if (gh && gh.tag_name) {
        remoteData = {
          version: gh.tag_name.replace(/^v/, ''),
          tag: gh.tag_name,
          releaseDate: (gh.published_at || '').split('T')[0],
          notes: gh.body || 'New release available with updates and improvements.',
          mac: { downloadUrl: (gh.assets?.find(a => a.name.endsWith('.dmg')) || {}).browser_download_url },
          windows: { downloadUrl: (gh.assets?.find(a => a.name.endsWith('.exe')) || {}).browser_download_url },
        };
      }
    } catch (ghErr) {
      console.warn('Update check failed:', err.message, ghErr.message);
      if (manual && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:update-error', { error: 'Unable to connect to update servers. Check your connection.' });
      }
      return { ok: false, error: err.message };
    }
  }

  if (!remoteData || !remoteData.version) {
    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-error', { error: 'Invalid update information received.' });
    }
    return { ok: false, error: 'Invalid version data' };
  }

  const latestVersion = remoteData.version.replace(/^v/, '');
  const hasUpdate = semverCompare(latestVersion, currentVersion) > 0;

  const isMac = process.platform === 'darwin';
  const downloadUrl = (isMac ? remoteData.mac?.downloadUrl : remoteData.windows?.downloadUrl) ||
    'https://buildexide.dev/#download';

  const payload = {
    currentVersion,
    latestVersion,
    hasUpdate,
    notes: remoteData.notes || 'Bug fixes and performance enhancements.',
    releaseDate: remoteData.releaseDate || '',
    downloadUrl,
    isManual: manual,
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (hasUpdate) {
      mainWindow.webContents.send('app:update-available', payload);
    } else if (manual) {
      mainWindow.webContents.send('app:update-not-available', payload);
    }
  }

  return { ok: true, ...payload };
}

ipcMain.handle('app:check-for-updates', async () => {
  return await checkAppUpdates(true);
});

ipcMain.handle('app:open-update-url', async (_e, url) => {
  const target = url || 'https://buildexide.dev/#download';
  shell.openExternal(target);
  return true;
});

/* -------------------- Search -------------------- */
const SEARCH_IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', '.cache',
  '.idea', '.vscode', 'coverage', '.turbo', '__pycache__',
  '.parcel-cache', '.svelte-kit', '.expo', '.gradle', 'target',
]);
const SEARCH_MAX_RESULTS = 1000;
const SEARCH_MAX_FILE_BYTES = 4 * 1024 * 1024;

ipcMain.handle('search:in-folder', async (_event, opts) => {
  const root = opts && opts.root;
  const query = (opts && opts.query) || '';
  if (!root || !query) return { results: [], truncated: false };
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { error: 'Folder not found.' };
  }

  let regex;
  try {
    if (opts.regex) {
      regex = new RegExp(query, opts.caseSensitive ? 'g' : 'gi');
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
      regex = new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return { error: 'Invalid pattern: ' + err.message };
  }

  const include = (opts.include || '').trim();
  let includeRegex = null;
  if (include) {
    const parts = include.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) {
      const escapedParts = parts.map((p) =>
        '^' + p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.') + '$'
      );
      includeRegex = new RegExp(escapedParts.join('|'));
    }
  }

  const results = [];
  let truncated = false;

  async function walk(dir) {
    if (results.length >= SEARCH_MAX_RESULTS) { truncated = true; return; }
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (results.length >= SEARCH_MAX_RESULTS) { truncated = true; return; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SEARCH_IGNORE_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        if (includeRegex) {
          const rel = path.relative(root, full).split(path.sep).join('/');
          if (!includeRegex.test(rel) && !includeRegex.test(e.name)) continue;
        }
        let stat;
        try { stat = await fs.promises.stat(full); } catch { continue; }
        if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
        let content;
        try { content = await fs.promises.readFile(full, 'utf8'); } catch { continue; }
        if (content.indexOf('\u0000') !== -1) continue; // skip binaries
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= SEARCH_MAX_RESULTS) { truncated = true; return; }
          regex.lastIndex = 0;
          const m = regex.exec(lines[i]);
          if (m) {
            results.push({
              file: full,
              line: i + 1,
              col: m.index + 1,
              text: lines[i].length > 400 ? lines[i].slice(0, 400) + '…' : lines[i],
              matchStart: m.index,
              matchLength: m[0].length,
            });
          }
        }
      }
    }
  }

  try {
    await walk(root);
  } catch (err) {
    return { error: err.message || String(err) };
  }
  return { results, truncated };
});

/* -------------------- Git -------------------- */
function gitExec(args, cwd) {
  return new Promise((resolve) => {
    exec(`git ${args}`, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err ? err.code || 1 : 0 });
    });
  });
}

ipcMain.handle('git:status', async (_event, root) => {
  if (!root) return { isRepo: false, error: 'No folder open.' };
  const probe = await gitExec('rev-parse --is-inside-work-tree', root);
  if (!probe.ok) return { isRepo: false };
  const topLevelRes = await gitExec('rev-parse --show-toplevel', root);
  const topLevel = topLevelRes.stdout.trim();
  const branchRes = await gitExec('symbolic-ref --short -q HEAD', root);
  let branch = branchRes.stdout.trim();
  if (!branch) {
    const headRes = await gitExec('rev-parse --short HEAD', root);
    branch = headRes.stdout.trim() ? `(detached @ ${headRes.stdout.trim()})` : '(no commits yet)';
  }
  const statusRes = await gitExec('status --porcelain=v1 -b -z', root);
  const remoteRes = await gitExec('config --get remote.origin.url', root);
  const remoteUrl = remoteRes.stdout.trim();

  let ahead = 0, behind = 0;
  const staged = [], unstaged = [], untracked = [];

  const buf = statusRes.stdout;
  const tokens = buf.split('\u0000').filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith('## ')) {
      const m = token.match(/ahead (\d+)/);
      const m2 = token.match(/behind (\d+)/);
      if (m) ahead = parseInt(m[1], 10);
      if (m2) behind = parseInt(m2[1], 10);
      continue;
    }
    if (token.length < 3) continue;
    const x = token[0];
    const y = token[1];
    const file = token.slice(3);
    if (x === '?' && y === '?') {
      untracked.push({ path: file, status: '?' });
    } else {
      if (x !== ' ' && x !== '?') staged.push({ path: file, status: x });
      if (y !== ' ' && y !== '?') unstaged.push({ path: file, status: y });
    }
  }
  return { isRepo: true, root: topLevel, branch, ahead, behind, staged, unstaged, untracked, remoteUrl };
});

function shellEscape(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

ipcMain.handle('git:stage', async (_event, root, paths) => {
  if (!root || !Array.isArray(paths) || paths.length === 0) return { ok: false, stderr: 'Nothing to stage' };
  const args = paths.map(shellEscape).join(' ');
  return await gitExec(`add -- ${args}`, root);
});

ipcMain.handle('git:stage-all', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('add -A', root);
});

ipcMain.handle('git:unstage', async (_event, root, paths) => {
  if (!root || !Array.isArray(paths) || paths.length === 0) return { ok: false, stderr: 'Nothing to unstage' };
  const args = paths.map(shellEscape).join(' ');
  return await gitExec(`reset HEAD -- ${args}`, root);
});

ipcMain.handle('git:discard', async (_event, root, filePath) => {
  if (!root || !filePath) return { ok: false, stderr: 'No file' };
  return await gitExec(`checkout -- ${shellEscape(filePath)}`, root);
});

ipcMain.handle('git:commit', async (_event, root, message, amend = false, signoff = false) => {
  if (!root || !message) return { ok: false, stderr: 'Empty commit message' };

  let command = 'commit';
  if (amend) command += ' --amend';
  if (signoff) command += ' --signoff';
  command += ` -m ${shellEscape(message)}`;

  return await gitExec(command, root);
});

// Add generic git exec function for advanced operations
ipcMain.handle('git:exec', async (_event, root, command) => {
  if (!root || !command) return { ok: false, stderr: 'Missing arguments' };
  return await gitExec(command, root);
});

ipcMain.handle('git:push', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('push', root);
});

ipcMain.handle('git:pull', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('pull --rebase --autostash', root);
});

ipcMain.handle('git:fetch', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('fetch --prune', root);
});

ipcMain.handle('git:init', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('init', root);
});

ipcMain.handle('git:set-remote', async (_event, root, url) => {
  if (!root || !url) return { ok: false, stderr: 'Missing args' };
  const existing = await gitExec('config --get remote.origin.url', root);
  if (existing.ok && existing.stdout.trim()) {
    return await gitExec(`remote set-url origin ${shellEscape(url)}`, root);
  }
  return await gitExec(`remote add origin ${shellEscape(url)}`, root);
});

/* -------------------- Workspace file watcher -------------------- */
let workspaceWatcher = null;
let workspaceWatchRoot = null;
let watcherDebounce = null;
const WATCHER_IGNORE_RE = /(^|[\/\\])(\.git|node_modules|\.next|dist|build|\.cache|\.turbo|\.parcel-cache|coverage|__pycache__)([\/\\]|$)/;

function stopWorkspaceWatcher() {
  if (workspaceWatcher) {
    try { workspaceWatcher.close(); } catch (_) { }
  }
  workspaceWatcher = null;
  workspaceWatchRoot = null;
  if (watcherDebounce) {
    clearTimeout(watcherDebounce);
    watcherDebounce = null;
  }
}

ipcMain.handle('fs:watch-folder', async (_event, root) => {
  stopWorkspaceWatcher();
  if (!root || !fs.existsSync(root)) return { ok: false };
  try {
    // recursive: works on macOS (FSEvents) and Windows. On Linux, we
    // get top-level only — good enough as a fallback.
    workspaceWatcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const fname = String(filename);
      if (WATCHER_IGNORE_RE.test(fname)) return;
      if (watcherDebounce) clearTimeout(watcherDebounce);
      watcherDebounce = setTimeout(() => {
        watcherDebounce = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('fs:changed', { root, filename: fname });
        }
      }, 220);
    });
    workspaceWatcher.on('error', (err) => {
      console.error('Workspace watcher error:', err.message);
    });
    workspaceWatchRoot = root;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('fs:unwatch', () => {
  stopWorkspaceWatcher();
  return { ok: true };
});

ipcMain.handle('git:publish', async (_event, root, branch) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  const b = branch || 'main';
  return await gitExec(`push -u origin ${shellEscape(b)}`, root);
});

/* -------------------- Enhanced Git Operations -------------------- */
ipcMain.handle('git:stash', async (_event, root, message) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  const msg = message ? `push -m ${shellEscape(message)}` : 'push';
  return await gitExec(`stash ${msg}`, root);
});

ipcMain.handle('git:stash-pop', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('stash pop', root);
});

ipcMain.handle('git:stash-list', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('stash list', root);
});

ipcMain.handle('git:branches', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  const localRes = await gitExec('branch --format="%(refname:short)|%(HEAD)"', root);
  const remoteRes = await gitExec('branch -r --format="%(refname:short)"', root);

  const localBranches = localRes.ok ? localRes.stdout.trim().split('\n')
    .filter(line => line)
    .map(line => {
      const [name, isHead] = line.split('|');
      return { name, isHead: isHead === 'head', type: 'local' };
    }) : [];

  const remoteBranches = remoteRes.ok ? remoteRes.stdout.trim().split('\n')
    .filter(line => line)
    .map(name => ({ name, isHead: false, type: 'remote' })) : [];

  return { ok: true, branches: [...localBranches, ...remoteBranches] };
});

ipcMain.handle('git:checkout', async (_event, root, branch) => {
  if (!root || !branch) return { ok: false, stderr: 'Missing arguments' };
  return await gitExec(`checkout ${shellEscape(branch)}`, root);
});

ipcMain.handle('git:create-branch', async (_event, root, branchName, checkout = true) => {
  if (!root || !branchName) return { ok: false, stderr: 'Missing arguments' };
  const cmd = checkout ? `checkout -b ${shellEscape(branchName)}` : `branch ${shellEscape(branchName)}`;
  return await gitExec(cmd, root);
});

ipcMain.handle('git:delete-branch', async (_event, root, branchName, force = false) => {
  if (!root || !branchName) return { ok: false, stderr: 'Missing arguments' };
  const f = force ? '-D' : '-d';
  return await gitExec(`branch ${f} ${shellEscape(branchName)}`, root);
});

ipcMain.handle('git:merge', async (_event, root, branch) => {
  if (!root || !branch) return { ok: false, stderr: 'Missing arguments' };
  return await gitExec(`merge ${shellEscape(branch)}`, root);
});

ipcMain.handle('git:log', async (_event, root, limit = 50) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  const format = '--pretty=format:%H|%h|%s|%an|%ad|%D';
  const cmd = `log --date=iso -n ${limit} ${format}`;
  return await gitExec(cmd, root);
});

ipcMain.handle('git:diff', async (_event, root, file, isStaged) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  const target = file ? `-- ${shellEscape(file)}` : '';
  const cached = isStaged ? '--cached' : '';
  return await gitExec(`diff ${cached} ${target}`, root);
});

ipcMain.handle('git:show', async (_event, root, commit) => {
  if (!root || !commit) return { ok: false, stderr: 'Missing arguments' };
  return await gitExec(`show ${shellEscape(commit)}`, root);
});

ipcMain.handle('git:reset', async (_event, root, mode = 'mixed', commit = 'HEAD') => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec(`reset --${mode} ${shellEscape(commit)}`, root);
});

ipcMain.handle('git:tag', async (_event, root, tagName, message) => {
  if (!root || !tagName) return { ok: false, stderr: 'Missing tag name' };
  const msg = message ? `-m ${shellEscape(message)}` : '';
  return await gitExec(`tag ${shellEscape(tagName)} ${msg}`, root);
});

ipcMain.handle('git:tags', async (_event, root) => {
  if (!root) return { ok: false, stderr: 'No folder' };
  return await gitExec('tag --sort=-version:refname', root);
});

/* -------------------- AI & AWS Cloud Integration -------------------- */
const aiAbortControllers = new Map();

function getAiConfig() {
  const hasAws = !!(process.env.AWS_ACCESS_KEY_ID || process.env.BUILDEX_API_BASE_URL);
  return {
    provider: hasAws ? 'bedrock' : 'pollinations',
    hasKey: hasAws || !!process.env.POLLINATIONS_API_KEY,
    region: process.env.AWS_REGION || 'ap-south-1',
    apiBaseUrl: process.env.BUILDEX_API_BASE_URL || '',
    defaultModel: process.env.BEDROCK_DEFAULT_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0',
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID || '',
    cognitoClientId: process.env.COGNITO_CLIENT_ID || '',
    s3Bucket: process.env.S3_PROJECTS_BUCKET || ''
  };
}

ipcMain.handle('ai:config', () => {
  return getAiConfig();
});

ipcMain.handle('aws:config', () => {
  return getAiConfig();
});

ipcMain.handle('aws:get-progress', async (_event, userId) => {
  return await getUserProgress(userId);
});

ipcMain.handle('aws:update-progress', async (_event, payload) => {
  return await updateUserProgress(payload);
});

ipcMain.handle('aws:get-upload-url', async (_event, { userId, filename }) => {
  return await getPresignedUploadUrl(userId, filename);
});

ipcMain.handle('aws:upload-image', async (_event, { base64Data, filename, userId }) => {
  return await uploadImageToS3(base64Data, filename, userId);
});

ipcMain.handle('aws:backup-chat', async (_event, payload) => {
  return await backupChatToDynamoDB(payload);
});

ipcMain.handle('aws:get-chats', async (_event, userId) => {
  return await getChatsFromDynamoDB(userId);
});

ipcMain.handle('aws:delete-chat', async (_event, payload) => {
  return await deleteChatFromDynamoDB(payload);
});

// Cloud Auth & Credits IPC Handlers
ipcMain.handle('auth:initiate', async (_event, { action = 'login', provider = null } = {}) => {
  const result = await initiateAuthSession({ action, provider });
  if (result.ok && result.authUrl) {
    shell.openExternal(result.authUrl);
  }
  return result;
});

ipcMain.handle('auth:poll', async (_event, authSessionId) => {
  return await pollAuthSession(authSessionId);
});

ipcMain.handle('auth:get-account', async (_event, userId) => {
  return await getUserAccount(userId);
});

ipcMain.handle('auth:deduct-credits', async (_event, payload) => {
  return await deductUserCredits(payload);
});

ipcMain.handle('auth:update-profile', async (_event, payload) => {
  return await updateUserProfile(payload);
});

ipcMain.handle('ai:chat-start', async (event, payload) => {
  const { messageId, messages, uiModel, temperature, responseFormat, mode = 'learn' } = payload || {};
  if (!messageId) return { ok: false, error: 'Missing messageId' };
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'Missing messages' };
  }

  // Cancel any prior stream sharing this id (defensive)
  const prior = aiAbortControllers.get(messageId);
  if (prior) try { prior.abort(); } catch (_) { }

  const controller = new AbortController();
  aiAbortControllers.set(messageId, controller);

  const send = (channel, data) => {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send(channel, { messageId, ...data });
    }
  };

  const hasAws = !!(process.env.AWS_ACCESS_KEY_ID || process.env.BUILDEX_API_BASE_URL);
  const streamFn = hasAws ? bedrockChatStream : pollinationsChatStream;
  const model = hasAws 
    ? resolveBedrockModel(uiModel)
    : resolvePollinationsModel(uiModel);

  // Fire-and-forget; the renderer listens to chunk/done/error events.
  streamFn({
    messages,
    model,
    mode,
    temperature: typeof temperature === 'number' ? temperature : 0.6,
    responseFormat,
    signal: controller.signal,
    onChunk: ({ delta }) => send('ai:chunk', { delta }),
    onDone: ({ text, aborted, finishReason }) => {
      aiAbortControllers.delete(messageId);
      send('ai:done', { text, aborted: !!aborted, finishReason: finishReason || null, model });
    },
    onError: ({ message, status }) => {
      aiAbortControllers.delete(messageId);
      send('ai:error', { message: message || 'Unknown error', status: status || null });
    },
  });

  return { ok: true, model, provider: hasAws ? 'bedrock' : 'pollinations' };
});

ipcMain.on('ai:chat-cancel', (_event, messageId) => {
  const c = aiAbortControllers.get(messageId);
  if (c) {
    try { c.abort(); } catch (_) { }
    aiAbortControllers.delete(messageId);
  }
});
