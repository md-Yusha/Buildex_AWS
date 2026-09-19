/* ============================================================
   BuildeX Coder IDE — Renderer
============================================================ */

/* -------------------- State -------------------- */
const state = {
  workspaceRoot: null,
  appInfo: null,
  /** Map<filePath, { model, lang, savedContent, dirty, name }> */
  openFiles: new Map(),
  activeFile: null,
  selectedDirPath: null, // dir context for "new file/folder"
  expandedDirs: new Set(),
  treeChildren: new Map(), // dir -> [items]
  unsavedTabIdx: 0,
  theme: localStorage.getItem("buildex.theme") || "dark",
  guideMode: localStorage.getItem("buildex.guideMode") || "popup",
  activePanel: "terminal",
  modelPathById: new Map(), // monaco model.id -> filePath
  chatMode: "agent",
  chatModel: "codementor",
  activeView: "explorer",
  /** Set during Cmd+Shift+D with selection; consumed when the bot reply finishes (bounds check). */
  debugLineBounds: null,
  /** Last Explain/Debug anchor; kept across turns until new Explain/Debug clears it (collapse selection no longer drops context). */
  stickyIdeSelection: null,
};

// Apply persisted theme as early as possible
document.documentElement.setAttribute("data-theme", state.theme);

function pathsLikelyEqual(a, b) {
  if (!a || !b) return false;
  return (
    String(a).replace(/\\/g, "/").toLowerCase() ===
    String(b).replace(/\\/g, "/").toLowerCase()
  );
}

/** After Explain/Debug shortcuts, Monaco selection often collapses; refresh sticky text from disk model so follow-ups still see current lines. */
function refreshStickyIdeSelectionIfPossible() {
  const st = state.stickyIdeSelection;
  if (!st || !st.filePath) return;
  let meta = state.openFiles.get(st.filePath);
  if (!meta) {
    for (const [fp, m] of state.openFiles) {
      if (pathsLikelyEqual(fp, st.filePath)) {
        meta = m;
        break;
      }
    }
  }
  if (!meta || !meta.model) return;
  try {
    const model = meta.model;
    if (model.isDisposed?.()) return;
    const end = Math.min(
      Math.max(st.endLine, st.startLine),
      model.getLineCount(),
    );
    const start = Math.min(Math.max(st.startLine, 1), end);
    const range = {
      startLineNumber: start,
      startColumn: 1,
      endLineNumber: end,
      endColumn: model.getLineMaxColumn(end),
    };
    st.code = model.getValueInRange(range);
    const padTop = Math.max(1, start - 6);
    const padBot = Math.min(model.getLineCount(), end + 6);
    st.surrounding = model.getValueInRange({
      startLineNumber: padTop,
      startColumn: 1,
      endLineNumber: padBot,
      endColumn: model.getLineMaxColumn(padBot),
    });
    st.startLine = start;
    st.endLine = end;
  } catch (_) {}
}

function captureStickyIdeSelection(sel) {
  if (!sel || sel.empty || !sel.code) return;
  state.stickyIdeSelection = {
    filePath: sel.filePath,
    fileName: sel.fileName,
    startLine: sel.startLine,
    endLine: sel.endLine,
    code: sel.code,
    surrounding: sel.surrounding || "",
    empty: false,
  };
}

let editor = null;
let diffEditor = null;
let monacoLoaded = false;

/** The editor instance for whichever tab is visible (single-file or diff modified pane). */
function getActiveCodeEditor() {
  if (!monacoLoaded) return null;
  const meta = state.activeFile ? state.openFiles.get(state.activeFile) : null;
  if (
    meta &&
    meta.isDiff &&
    diffEditor &&
    typeof diffEditor.getModifiedEditor === "function"
  ) {
    const modified = diffEditor.getModifiedEditor();
    if (modified) return modified;
  }
  return editor || null;
}

/** Workspace path backing a tab key (handles diff:// URIs). */
function realPathFromTab(filePathLike) {
  if (!filePathLike) return null;
  let p = String(filePathLike);
  if (p.startsWith("diff://")) {
    p = p.slice("diff://".length).split("?")[0];
  }
  return p || null;
}

/* -------------------- DOM helpers -------------------- */
const $ = (id) => document.getElementById(id);
const tabsEl = () => $("tabs");
const fileTreeEl = () => $("file-tree");

/* -------------------- Theme -------------------- */
function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem("buildex.theme", theme);
  document.documentElement.setAttribute("data-theme", theme);
  if (window.electronAPI && window.electronAPI.setNativeTheme) {
    window.electronAPI.setNativeTheme(theme === "light" ? "light" : "dark");
  }
  syncThemeIcon();
  // Sync Monaco
  if (monacoLoaded && window.monaco) {
    let mTheme = "buildex-dark";
    if (theme === "light") mTheme = "buildex-light";
    else if (theme === "ocean") mTheme = "buildex-ocean";
    else if (theme === "dracula") mTheme = "buildex-dracula";
    else if (theme === "monokai") mTheme = "buildex-monokai";
    monaco.editor.setTheme(mTheme);
  }
  // Sync all xterm instances
  for (const inst of terminals.values()) {
    inst.applyTheme(theme);
  }
  showToast(`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`);
}

function syncThemeIcon() {
  const dark = $("theme-icon-dark");
  const light = $("theme-icon-light");
  if (!dark || !light) return;
  if (state.theme === "light") {
    dark.style.display = "none";
    light.style.display = "";
  } else {
    // For dark, ocean, dracula, monokai -> use the dark icon
    dark.style.display = "";
    light.style.display = "none";
  }
}

/* -------------------- Toasts -------------------- */
function showToast(message, type = "info", duration = 2400) {
  const t = $("toast");
  t.textContent = message;
  t.className = "toast " + (type || "");
  t.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (t.style.display = "none"), duration);
}

/* -------------------- Custom prompt modal -------------------- */
function customPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    const modal = $("prompt-modal");
    const msgEl = $("prompt-message");
    const inputEl = $("prompt-input");
    const okBtn = $("prompt-ok");
    const cancelBtn = $("prompt-cancel");

    msgEl.innerText = message;
    inputEl.value = defaultValue;
    modal.style.display = "flex";
    inputEl.focus();
    inputEl.select();

    const cleanup = () => {
      modal.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("keydown", onKey);
    };
    const onOk = () => {
      const v = inputEl.value;
      cleanup();
      resolve(v);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onKey = (e) => {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") onCancel();
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    inputEl.addEventListener("keydown", onKey);
  });
}

/* -------------------- Monaco Editor -------------------- */
require.config({ paths: { vs: "./node_modules/monaco-editor/min/vs" } });

function initMonaco() {
  return new Promise((resolve) => {
    require(["vs/editor/editor.main"], function () {
      // Configure TypeScript and JavaScript compiler options with React & JSX support
      if (monaco.languages && monaco.languages.typescript) {
        const tsDefaults = monaco.languages.typescript.typescriptDefaults;
        const jsDefaults = monaco.languages.typescript.javascriptDefaults;

        const compilerOptions = {
          target: monaco.languages.typescript.ScriptTarget.ESNext,
          module: monaco.languages.typescript.ModuleKind.ESNext,
          moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          allowJs: true,
          jsx: monaco.languages.typescript.JsxEmit.ReactJSX || monaco.languages.typescript.JsxEmit.React || 2,
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          noEmit: true,
          isolatedModules: true,
          skipLibCheck: true,
        };

        try {
          tsDefaults.setCompilerOptions(compilerOptions);
          jsDefaults.setCompilerOptions(compilerOptions);

          // Add ambient type declarations for React JSX elements and common asset modules
          const reactTypes = `
            declare namespace JSX {
              interface IntrinsicElements {
                [elemName: string]: any;
              }
            }
            declare module "react" {
              export = React;
            }
            declare module "react/jsx-runtime" {
              export const jsx: any;
              export const jsxs: any;
              export const Fragment: any;
            }
            declare module "*.css" { const content: any; export default content; }
            declare module "*.scss" { const content: any; export default content; }
            declare module "*.svg" { const content: any; export default content; }
            declare module "*.png" { const content: any; export default content; }
            declare module "*.jpg" { const content: any; export default content; }
          `;
          tsDefaults.addExtraLib(reactTypes, "ts:react-shim.d.ts");
          jsDefaults.addExtraLib(reactTypes, "js:react-shim.d.ts");

          // Suppress false positive diagnostic error codes
          const diagOptions = {
            noSemanticValidation: false,
            noSyntaxValidation: false,
            diagnosticCodesToIgnore: [
              2307, // Cannot find module '...' or its corresponding type declarations
              2304, // Cannot find name '...'
              7016, // Could not find a declaration file for module '...'
              2686, // 'React' refers to a UMD global, but the current file is a module
              2792, // Cannot find module '...'. Did you mean to set the 'moduleResolution' option to 'nodenext'
            ]
          };
          tsDefaults.setDiagnosticsOptions(diagOptions);
          jsDefaults.setDiagnosticsOptions(diagOptions);
        } catch (e) {
          console.warn("Could not set TypeScript options:", e);
        }
      }

      // Professional dark theme tuned for clarity (close to VS Code Dark+)
      monaco.editor.defineTheme("buildex-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6a9955", fontStyle: "italic" },
          { token: "keyword", foreground: "569cd6" },
          { token: "keyword.control", foreground: "c586c0" },
          { token: "string", foreground: "ce9178" },
          { token: "number", foreground: "b5cea8" },
          { token: "type", foreground: "4ec9b0" },
          { token: "class", foreground: "4ec9b0" },
          { token: "function", foreground: "dcdcaa" },
          { token: "variable", foreground: "9cdcfe" },
          { token: "constant", foreground: "4fc1ff" },
          { token: "tag", foreground: "569cd6" },
          { token: "attribute.name", foreground: "9cdcfe" },
          { token: "attribute.value", foreground: "ce9178" },
        ],
        colors: {
          "editor.background": "#1e1e1e",
          "editor.foreground": "#d4d4d4",
          "editorLineNumber.foreground": "#858585",
          "editorLineNumber.activeForeground": "#c6c6c6",
          "editor.selectionBackground": "#264f78",
          "editor.lineHighlightBackground": "#2a2d2e",
          "editor.lineHighlightBorder": "#00000000",
          "editorCursor.foreground": "#aeafad",
          "editorIndentGuide.background": "#404040",
          "editorIndentGuide.activeBackground": "#707070",
          "editorBracketMatch.background": "#0078d433",
          "editorBracketMatch.border": "#888888",
          "editorWhitespace.foreground": "#3b3b3b",
          "editorGutter.background": "#1e1e1e",
        },
      });

      // Professional light theme (close to VS Code Light+)
      monaco.editor.defineTheme("buildex-light", {
        base: "vs",
        inherit: true,
        rules: [
          { token: "comment", foreground: "008000", fontStyle: "italic" },
          { token: "keyword", foreground: "0000ff" },
          { token: "keyword.control", foreground: "af00db" },
          { token: "string", foreground: "a31515" },
          { token: "number", foreground: "098658" },
          { token: "type", foreground: "267f99" },
          { token: "class", foreground: "267f99" },
          { token: "function", foreground: "795e26" },
          { token: "variable", foreground: "001080" },
          { token: "constant", foreground: "0070c1" },
          { token: "tag", foreground: "800000" },
          { token: "attribute.name", foreground: "e50000" },
          { token: "attribute.value", foreground: "0451a5" },
        ],
        colors: {
          "editor.background": "#ffffff",
          "editor.foreground": "#1f1f1f",
          "editorLineNumber.foreground": "#a0a0a0",
          "editorLineNumber.activeForeground": "#0066b8",
          "editor.selectionBackground": "#add6ff",
          "editor.lineHighlightBackground": "#f3f3f3",
          "editor.lineHighlightBorder": "#00000000",
          "editorCursor.foreground": "#000000",
          "editorIndentGuide.background": "#d3d3d3",
          "editorIndentGuide.activeBackground": "#939393",
          "editorBracketMatch.background": "#0066b833",
          "editorBracketMatch.border": "#b9b9b9",
          "editorWhitespace.foreground": "#d3d3d3",
          "editorGutter.background": "#ffffff",
        },
      });

      monaco.editor.defineTheme("buildex-ocean", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: { "editor.background": "#1e2630" },
      });
      monaco.editor.defineTheme("buildex-dracula", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: { "editor.background": "#282a36" },
      });
      monaco.editor.defineTheme("buildex-monokai", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: { "editor.background": "#272822" },
      });

      editor = monaco.editor.create($("monaco-editor"), {
        value: "",
        language: "plaintext",
        theme:
          state.theme === "light"
            ? "buildex-light"
            : state.theme === "ocean"
              ? "buildex-ocean"
              : state.theme === "dracula"
                ? "buildex-dracula"
                : state.theme === "monokai"
                  ? "buildex-monokai"
                  : "buildex-dark",
        automaticLayout: true,
        fontSize: parseInt(localStorage.getItem("buildex.fontSize"), 10) || 14,
        wordWrap: localStorage.getItem("buildex.wordWrap") === "false" ? "off" : "on",
        lineNumbers: localStorage.getItem("buildex.lineNumbers") === "false" ? "off" : "on",
        lineHeight: 20,
        letterSpacing: 0.2,
        fontFamily:
          '"JetBrains Mono", "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
        fontLigatures: true,
        minimap: {
          enabled: localStorage.getItem("buildex.minimap") === "true",
          scale: 1,
          renderCharacters: false,
        },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        renderWhitespace: "selection",
        renderLineHighlight: "all",
        padding: { top: 12 },
        scrollBeyondLastLine: false,
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, bracketPairs: false },
      });

      diffEditor = monaco.editor.createDiffEditor($("monaco-diff-editor"), {
        theme:
          state.theme === "light"
            ? "buildex-light"
            : state.theme === "ocean"
              ? "buildex-ocean"
              : state.theme === "dracula"
                ? "buildex-dracula"
                : state.theme === "monokai"
                  ? "buildex-monokai"
                  : "buildex-dark",
        automaticLayout: true,
        renderSideBySide: true,
        readOnly: true,
        fontSize: 13,
        lineHeight: 20,
        fontFamily:
          '"JetBrains Mono", "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
        padding: { top: 12 },
        scrollBeyondLastLine: false,
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () =>
        saveActive(),
      );
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
        async () => saveAsActive(),
      );
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
        if (state.activeFile) closeFile(state.activeFile);
      });

      editor.onDidChangeCursorPosition((e) => {
        $("status-cursor").textContent =
          `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
      });

      monacoLoaded = true;
      try {
        Problems.attach();
      } catch (_) {}
      try {
        Selection.attach(editor);
      } catch (_) {}
      try {
        Selection.attachDiffPanes(diffEditor);
      } catch (_) {}
      resolve();
    });
  });
}

function languageFromName(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    json: "json",
    jsonc: "json",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    xml: "xml",
    sql: "sql",
    swift: "swift",
    kt: "kotlin",
    dart: "dart",
    vue: "html",
    svg: "xml",
    toml: "ini",
    ini: "ini",
    dockerfile: "dockerfile",
  };
  return map[ext] || "plaintext";
}

const defaultFileSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7; vertical-align: middle;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>`;
const defaultImageSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7; vertical-align: middle;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
const folderSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="#dcb67a" style="vertical-align: middle;"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
const folderOpenSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="#dcb67a" style="vertical-align: middle;"><path d="M19 8H9.46c-.52 0-.96.28-1.19.72L5 16H3V6c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2zm-1.8 11.23L19.46 10H8.54l-2.26 9.23c-.15.61.3 1.2.91 1.2h10.95c.42 0 .8-.26.91-.66z"/></svg>`;
const terminalSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8; vertical-align: middle;"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;

function fileIconFor(name) {
  const ext = name.split(".").pop().toLowerCase();
  const getIcon = (cls) =>
    `<i class="${cls}" style="font-size: 14px; vertical-align: middle;"></i>`;

  const map = {
    js: getIcon("devicon-javascript-plain colored"),
    jsx: getIcon("devicon-react-original colored"),
    ts: getIcon("devicon-typescript-plain colored"),
    tsx: getIcon("devicon-react-original colored"),
    html: getIcon("devicon-html5-plain colored"),
    css: getIcon("devicon-css3-plain colored"),
    scss: getIcon("devicon-sass-original colored"),
    json: getIcon("devicon-json-plain colored"),
    md: getIcon("devicon-markdown-original"),
    py: getIcon("devicon-python-plain colored"),
    rs: getIcon("devicon-rust-plain"),
    go: getIcon("devicon-go-original-wordmark colored"),
    java: getIcon("devicon-java-plain colored"),
    c: getIcon("devicon-c-plain colored"),
    cpp: getIcon("devicon-cplusplus-plain colored"),
    cs: getIcon("devicon-csharp-plain colored"),
    php: getIcon("devicon-php-plain colored"),
    rb: getIcon("devicon-ruby-plain colored"),
    sh: terminalSVG,
    bash: terminalSVG,
    cmd: terminalSVG,
    bat: terminalSVG,
    ps1: terminalSVG,
    yml: getIcon("devicon-yaml-plain colored"),
    yaml: getIcon("devicon-yaml-plain colored"),
    xml: defaultFileSVG,
    sql: getIcon("devicon-azuresqldatabase-plain colored"),
    png: defaultImageSVG,
    jpg: defaultImageSVG,
    jpeg: defaultImageSVG,
    gif: defaultImageSVG,
    svg: defaultImageSVG,
    pdf: defaultFileSVG,
    zip: defaultFileSVG,
    tar: defaultFileSVG,
    gz: defaultFileSVG,
    txt: defaultFileSVG,
    log: defaultFileSVG,
  };

  if (name.toLowerCase() === "dockerfile")
    return getIcon("devicon-docker-plain colored");
  if (name.toLowerCase() === "package.json")
    return getIcon("devicon-npm-original-wordmark colored");
  if (name.toLowerCase() === ".gitignore")
    return getIcon("devicon-git-plain colored");
  if (name.toLowerCase() === "readme.md")
    return getIcon("devicon-markdown-original colored");
  return map[ext] || defaultFileSVG;
}

/* -------------------- File Tree (recursive, expandable) -------------------- */
async function loadWorkspace(rootPath) {
  const prevRoot = state.workspaceRoot;
  if (prevRoot && prevRoot !== rootPath) {
    state.stickyIdeSelection = null;
    try {
      localStorage.removeItem(OPEN_EDITORS_KEY);
    } catch (_) {}
  }
  state.workspaceRoot = rootPath;
  state.expandedDirs = new Set([rootPath]);
  state.treeChildren = new Map();
  state.selectedDirPath = rootPath;
  await window.electronAPI.setCwd(rootPath);
  window.electronAPI.notifyTerminalFolderOpened(activeTerminalId, rootPath);
  Output.log("BuildeX", `Workspace: ${rootPath}`);

  const folderName = rootPath.split("/").filter(Boolean).pop() || rootPath;
  state.workspaceFolderName = folderName;
  if (state.activeView === "explorer") {
    $("sidebar-title").textContent = folderName.toUpperCase();
  }
  $("status-folder").textContent = folderName;
  $("window-title").textContent = folderName + " — BuildeX Coder IDE";
  document.title = folderName + " — BuildeX Coder IDE";

  const wsInfo = $("workspace-info");
  if (wsInfo) wsInfo.style.display = "none";
  // Do not hide #welcome-screen here — with no tabs open it shows shortcuts; hiding is handled in setActiveFile / closeFile.

  try {
    localStorage.setItem("buildex.workspaceRoot", rootPath);
  } catch (_) {}

  await renderTree();
  if (typeof Git !== "undefined" && Git.onWorkspaceChanged)
    Git.onWorkspaceChanged();

  // Start watching for filesystem changes so tree auto-refreshes when
  // commands (npm create, git clone, etc.) generate files outside the IDE.
  try {
    window.electronAPI.watchFolder(rootPath);
  } catch (_) {}
}

let _treeRefreshTimer = null;
function scheduleTreeRefresh() {
  if (_treeRefreshTimer) clearTimeout(_treeRefreshTimer);
  _treeRefreshTimer = setTimeout(async () => {
    _treeRefreshTimer = null;
    if (!state.workspaceRoot) return;
    state.treeChildren = new Map();
    try {
      await renderTree();
    } catch (_) {}
    // Also refresh git status if open
    try {
      if (
        typeof Git !== "undefined" &&
        state.activeView === "git" &&
        Git.refresh
      )
        Git.refresh();
    } catch (_) {}
  }, 280);
}

async function getChildren(dirPath) {
  if (state.treeChildren.has(dirPath)) return state.treeChildren.get(dirPath);
  const children = await window.electronAPI.readDir(dirPath);
  state.treeChildren.set(dirPath, children);
  return children;
}

async function renderTree() {
  const tree = fileTreeEl();
  tree.innerHTML = "";
  if (!state.workspaceRoot) return;
  await renderDir(state.workspaceRoot, tree, 0);
}

async function renderDir(dirPath, container, depth) {
  const children = await getChildren(dirPath);
  for (const child of children) {
    const item = document.createElement("div");
    item.className = "file-item";
    item.dataset.path = child.path;
    item.dataset.isDir = String(child.isDirectory);
    item.style.paddingLeft = 8 + depth * 12 + "px";

    const chev = document.createElement("span");
    chev.className = "chevron" + (child.isDirectory ? "" : " empty");
    if (child.isDirectory && state.expandedDirs.has(child.path))
      chev.classList.add("expanded");
    chev.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l6 6-6 6z"/></svg>';
    item.appendChild(chev);

    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.innerHTML = child.isDirectory
      ? state.expandedDirs.has(child.path)
        ? folderOpenSVG
        : folderSVG
      : fileIconFor(child.name);
    item.appendChild(icon);

    const nameEl = document.createElement("span");
    nameEl.className = "file-name";
    nameEl.textContent = child.name;
    item.appendChild(nameEl);

    if (state.activeFile === child.path) item.classList.add("active");

    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      document
        .querySelectorAll(".file-item.selected")
        .forEach((el) => el.classList.remove("selected"));
      item.classList.add("selected");

      if (child.isDirectory) {
        state.selectedDirPath = child.path;
        if (state.expandedDirs.has(child.path)) {
          state.expandedDirs.delete(child.path);
        } else {
          state.expandedDirs.add(child.path);
        }
        renderTree();
      } else {
        state.selectedDirPath = child.path.split("/").slice(0, -1).join("/");
        await openFile(child.path, child.name);
      }
    });

    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showFileContextMenu(e.clientX, e.clientY, child);
    });

    container.appendChild(item);

    if (child.isDirectory && state.expandedDirs.has(child.path)) {
      const childContainer = document.createElement("div");
      container.appendChild(childContainer);
      await renderDir(child.path, childContainer, depth + 1);
    }
  }
}

function refreshTree() {
  state.treeChildren.clear();
  renderTree();
}

function showFileContextMenu(x, y, file) {
  const menu = $("context-menu");
  menu.innerHTML = "";
  const items = [];

  if (file.isDirectory) {
    items.push({
      label: "New File",
      action: async () => {
        const name = await customPrompt("New file name:");
        if (name) {
          const r = await window.electronAPI.createFile(file.path, name.trim());
          if (r.ok) {
            state.expandedDirs.add(file.path);
            state.treeChildren.delete(file.path);
            renderTree();
            showToast("File created", "success");
          } else showToast(r.error || "Failed", "error");
        }
      },
    });
    items.push({
      label: "New Folder",
      action: async () => {
        const name = await customPrompt("New folder name:");
        if (name) {
          const r = await window.electronAPI.createFolder(
            file.path,
            name.trim(),
          );
          if (r.ok) {
            state.expandedDirs.add(file.path);
            state.treeChildren.delete(file.path);
            renderTree();
          } else showToast(r.error || "Failed", "error");
        }
      },
    });
    items.push({ divider: true });
  }

  items.push({
    label: "Rename",
    action: async () => {
      const newName = await customPrompt("New name:", file.name);
      if (newName && newName !== file.name) {
        const r = await window.electronAPI.renamePath(
          file.path,
          newName.trim(),
        );
        if (r.ok) {
          state.treeChildren.delete(
            file.path.split("/").slice(0, -1).join("/"),
          );
          renderTree();
          showToast("Renamed", "success");
        } else showToast(r.error || "Failed", "error");
      }
    },
  });
  items.push({
    label: "Delete",
    danger: true,
    action: async () => {
      const idx = await window.electronAPI.confirmDialog({
        title: "Delete",
        message: `Delete "${file.name}"?`,
        detail: "This cannot be undone.",
        buttons: ["Cancel", "Delete"],
      });
      if (idx === 1) {
        const r = await window.electronAPI.deletePath(file.path);
        if (r.ok) {
          if (!file.isDirectory && state.openFiles.has(file.path))
            closeFile(file.path);
          state.treeChildren.delete(
            file.path.split("/").slice(0, -1).join("/"),
          );
          renderTree();
          showToast("Deleted", "success");
        } else showToast(r.error || "Failed", "error");
      }
    },
  });
  items.push({ divider: true });
  items.push({
    label: "Reveal Path",
    action: () => {
      showToast(file.path);
      navigator.clipboard?.writeText(file.path);
    },
  });

  for (const it of items) {
    if (it.divider) {
      const d = document.createElement("div");
      d.className = "context-menu-divider";
      menu.appendChild(d);
    } else {
      const el = document.createElement("div");
      el.className = "context-menu-item" + (it.danger ? " danger" : "");
      el.textContent = it.label;
      el.addEventListener("click", () => {
        hideContextMenu();
        it.action();
      });
      menu.appendChild(el);
    }
  }

  menu.style.display = "block";
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  // Prevent overflow
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth)
    menu.style.left = window.innerWidth - rect.width - 4 + "px";
  if (rect.bottom > window.innerHeight)
    menu.style.top = window.innerHeight - rect.height - 4 + "px";
}

function hideContextMenu() {
  $("context-menu").style.display = "none";
}

document.addEventListener("click", hideContextMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideContextMenu();
});

/* -------------------- Tabs / File Editing -------------------- */
async function openFile(filePath, name) {
  if (!monacoLoaded) await initMonaco();

  if (state.openFiles.has(filePath)) {
    setActiveFile(filePath);
    return;
  }

  const result = await window.electronAPI.readFile(filePath);
  if (!result.ok) {
    showToast(result.error || "Failed to open file", "error");
    return;
  }

  const lang = languageFromName(name || filePath.split("/").pop());
  const model = monaco.editor.createModel(result.content, lang);
  state.modelPathById.set(model.id, filePath);
  state.openFiles.set(filePath, {
    model,
    lang,
    name: name || filePath.split("/").pop(),
    savedContent: result.content,
    dirty: false,
  });
  Output.log("Files", `Opened ${filePath}`);

  model.onDidChangeContent(() => {
    const meta = state.openFiles.get(filePath);
    if (!meta) return;
    const isDirty = model.getValue() !== meta.savedContent;
    if (isDirty !== meta.dirty) {
      meta.dirty = isDirty;
      renderTabs();
    }
  });

  setActiveFile(filePath);
  renderTabs();
}

async function openFileDiff(filePath, isStaged) {
  if (!monacoLoaded) await initMonaco();

  const diffPath = `diff://${filePath}${isStaged ? "?staged" : ""}`;
  if (state.openFiles.has(diffPath)) {
    setActiveFile(diffPath);
    return;
  }

  const name = filePath.split("/").pop();
  const lang = languageFromName(name);

  // Fetch original and modified content
  let originalContent = "";
  let modifiedContent = "";

  if (isStaged) {
    const origRes = await window.electronAPI.git.show(
      state.workspaceRoot,
      `HEAD:${filePath}`,
    );
    if (origRes.ok) originalContent = origRes.stdout;
    const modRes = await window.electronAPI.git.show(
      state.workspaceRoot,
      `:${filePath}`,
    );
    if (modRes.ok) modifiedContent = modRes.stdout;
  } else {
    const origRes = await window.electronAPI.git.show(
      state.workspaceRoot,
      `:${filePath}`,
    );
    if (origRes.ok) {
      originalContent = origRes.stdout;
    } else {
      // If it fails, maybe it's not in the index at all. Fallback to HEAD
      const origHeadRes = await window.electronAPI.git.show(
        state.workspaceRoot,
        `HEAD:${filePath}`,
      );
      if (origHeadRes.ok) originalContent = origHeadRes.stdout;
    }

    const modRes = await window.electronAPI.readFile(filePath);
    if (modRes.ok) modifiedContent = modRes.content;
  }

  const originalModel = monaco.editor.createModel(originalContent, lang);
  const modifiedModel = monaco.editor.createModel(modifiedContent, lang);

  state.modelPathById.set(originalModel.id, diffPath);
  state.modelPathById.set(modifiedModel.id, diffPath);

  state.openFiles.set(diffPath, {
    isDiff: true,
    originalModel,
    modifiedModel,
    lang,
    name: `${name} (${isStaged ? "Index" : "Working Tree"})`,
    savedContent: modifiedContent,
    dirty: false,
  });

  setActiveFile(diffPath);
  renderTabs();
}

function setActiveFile(filePath) {
  state.activeFile = filePath;
  const meta = state.openFiles.get(filePath);
  if (!meta) return;
  $("welcome-screen").classList.add("hidden");

  if (meta.isDiff) {
    $("monaco-editor").classList.remove("visible");
    $("monaco-diff-editor").classList.add("visible");
    diffEditor.setModel({
      original: meta.originalModel,
      modified: meta.modifiedModel,
    });
    $("status-cursor").textContent = "Diff View";
  } else {
    $("monaco-diff-editor").classList.remove("visible");
    $("monaco-editor").classList.add("visible");
    editor.setModel(meta.model);
    editor.focus();
    const pos = editor.getPosition();
    if (pos)
      $("status-cursor").textContent =
        `Ln ${pos.lineNumber}, Col ${pos.column}`;
  }

  $("window-title").textContent = `${meta.name} — BuildeX Coder IDE`;
  document.title = `${meta.name} — BuildeX Coder IDE`;
  $("status-language").textContent = labelForLang(meta.lang);

  // Highlight in tree
  document
    .querySelectorAll(".file-item.active")
    .forEach((el) => el.classList.remove("active"));
  // For diffs, we try to highlight the real file path in the tree
  const realPath = filePath.startsWith("diff://")
    ? filePath.replace("diff://", "").split("?")[0]
    : filePath;
  const treeItem = document.querySelector(
    `.file-item[data-path="${cssEscape(realPath)}"]`,
  );
  if (treeItem) treeItem.classList.add("active");

  renderTabs();
  // Show/hide run button based on file type
  try {
    updateRunButton();
  } catch (_) {}
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
}

function labelForLang(lang) {
  const map = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    markdown: "Markdown",
    python: "Python",
    rust: "Rust",
    go: "Go",
    java: "Java",
    cpp: "C++",
    c: "C",
    csharp: "C#",
    php: "PHP",
    ruby: "Ruby",
    shell: "Shell",
    yaml: "YAML",
    xml: "XML",
    sql: "SQL",
    plaintext: "Plain Text",
    dockerfile: "Dockerfile",
    ini: "INI",
  };
  return map[lang] || lang;
}

function renderTabs() {
  const tabsContainer = tabsEl();
  const tabsBar = $("tabs-bar");
  if (state.openFiles.size === 0) {
    if (tabsBar) tabsBar.style.display = "none";
  } else {
    if (tabsBar) tabsBar.style.display = "flex";
  }
  tabsContainer.innerHTML = "";
  for (const [filePath, meta] of state.openFiles) {
    const tab = document.createElement("div");
    tab.className =
      "tab" +
      (filePath === state.activeFile ? " active" : "") +
      (meta.dirty ? " dirty" : "");
    tab.dataset.path = filePath;

    const icon = document.createElement("span");
    icon.className = "tab-icon";
    icon.innerHTML = fileIconFor(meta.name);
    tab.appendChild(icon);

    const nameEl = document.createElement("span");
    nameEl.className = "tab-name";
    nameEl.textContent = meta.name;
    nameEl.title = filePath;
    tab.appendChild(nameEl);

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = meta.dirty ? "●" : "×";
    close.title = "Close";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeFile(filePath);
    });
    tab.appendChild(close);

    tab.addEventListener("click", () => setActiveFile(filePath));
    tab.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeFile(filePath);
      }
    });

    tabsContainer.appendChild(tab);
  }
  schedulePersistOpenEditorsSnapshot();
}

async function closeFile(filePath) {
  const meta = state.openFiles.get(filePath);
  if (!meta) return;
  if (meta.dirty) {
    const idx = await window.electronAPI.confirmDialog({
      title: "Unsaved changes",
      message: `Save changes to "${meta.name}"?`,
      buttons: ["Don't Save", "Cancel", "Save"],
    });
    if (idx === 1) return; // cancel
    if (idx === 2) {
      const ok = await saveActive(filePath);
      if (!ok) return;
    }
  }

  if (meta.isDiff) {
    state.modelPathById.delete(meta.originalModel.id);
    state.modelPathById.delete(meta.modifiedModel.id);
    meta.originalModel.dispose();
    meta.modifiedModel.dispose();
  } else {
    state.modelPathById.delete(meta.model.id);
    meta.model.dispose();
  }
  state.openFiles.delete(filePath);

  if (state.activeFile === filePath) {
    const next = Array.from(state.openFiles.keys()).pop();
    if (next) {
      setActiveFile(next);
    } else {
      state.activeFile = null;
      $("monaco-editor").classList.remove("visible");
      $("monaco-diff-editor").classList.remove("visible");
      $("welcome-screen").classList.remove("hidden");
      $("window-title").textContent = state.workspaceRoot
        ? state.workspaceRoot.split("/").pop() + " — BuildeX Coder IDE"
        : "Welcome";
      $("status-language").textContent = "Plain Text";
      $("status-cursor").textContent = "Ln 1, Col 1";
    }
  }
  renderTabs();
}

async function saveActive(targetPath) {
  const filePath = targetPath || state.activeFile;
  if (!filePath) return false;
  const meta = state.openFiles.get(filePath);
  if (!meta) return false;
  // If untitled (path starts with "untitled:"), do save-as instead
  if (filePath.startsWith("untitled:")) {
    return saveAsActive();
  }
  const content = meta.model.getValue();
  const r = await window.electronAPI.saveFile(filePath, content);
  if (r.ok) {
    meta.savedContent = content;
    meta.dirty = false;
    renderTabs();
    showToast(`Saved ${meta.name}`, "success", 1400);
    Output.log("Files", `Saved ${filePath}`);
    return true;
  } else {
    showToast(r.error || "Save failed", "error");
    Output.log("Files", `Save failed: ${r.error || "unknown"}`, "error");
    return false;
  }
}

async function saveAsActive() {
  const filePath = state.activeFile;
  if (!filePath) return false;
  const meta = state.openFiles.get(filePath);
  if (!meta) return false;
  const content = meta.model.getValue();
  const defaultPath = filePath.startsWith("untitled:")
    ? state.workspaceRoot
      ? state.workspaceRoot + "/" + meta.name
      : meta.name
    : filePath;
  const r = await window.electronAPI.saveFileAs(defaultPath, content);
  if (r.ok) {
    state.openFiles.delete(filePath);
    state.modelPathById.delete(meta.model.id);
    if (meta.model && !meta.model.isDisposed?.()) meta.model.dispose();
    const newName = r.filePath.split("/").pop();
    const lang = languageFromName(newName);
    const model = monaco.editor.createModel(content, lang);
    state.modelPathById.set(model.id, r.filePath);
    state.openFiles.set(r.filePath, {
      model,
      lang,
      name: newName,
      savedContent: content,
      dirty: false,
    });
    model.onDidChangeContent(() => {
      const m = state.openFiles.get(r.filePath);
      if (!m) return;
      const isDirty = model.getValue() !== m.savedContent;
      if (isDirty !== m.dirty) {
        m.dirty = isDirty;
        renderTabs();
      }
    });
    setActiveFile(r.filePath);
    if (state.workspaceRoot && r.filePath.startsWith(state.workspaceRoot)) {
      state.treeChildren.clear();
      renderTree();
    }
    showToast("Saved", "success", 1400);
    return true;
  } else if (!r.canceled) {
    showToast(r.error || "Save failed", "error");
  }
  return false;
}

async function newUntitledFile() {
  if (!monacoLoaded) await initMonaco();
  state.unsavedTabIdx += 1;
  const id = "untitled:" + state.unsavedTabIdx;
  const name = `Untitled-${state.unsavedTabIdx}`;
  const model = monaco.editor.createModel("", "plaintext");
  state.modelPathById.set(model.id, id);
  state.openFiles.set(id, {
    model,
    lang: "plaintext",
    name,
    savedContent: "",
    dirty: false,
  });
  model.onDidChangeContent(() => {
    const m = state.openFiles.get(id);
    if (!m) return;
    const isDirty = model.getValue() !== m.savedContent;
    if (isDirty !== m.dirty) {
      m.dirty = isDirty;
      renderTabs();
    }
  });
  setActiveFile(id);
  renderTabs();
}

const WORKSPACE_STORAGE_KEY = "buildex.workspaceRoot";
const OPEN_EDITORS_KEY = "buildex.openEditors";

let _persistEditorsTimer = null;

function persistOpenEditorsSnapshot() {
  if (!state.workspaceRoot) return;
  try {
    const paths = [];
    for (const key of state.openFiles.keys()) {
      if (key.startsWith("diff://") || key.startsWith("untitled:")) continue;
      paths.push(key);
    }
    let active = state.activeFile;
    if (
      !active ||
      active.startsWith("diff://") ||
      active.startsWith("untitled:")
    ) {
      active = paths.length ? paths[paths.length - 1] : null;
    }
    localStorage.setItem(
      OPEN_EDITORS_KEY,
      JSON.stringify({
        workspaceRoot: state.workspaceRoot,
        paths,
        active,
      }),
    );
  } catch (_) {}
}

function schedulePersistOpenEditorsSnapshot() {
  if (_persistEditorsTimer) clearTimeout(_persistEditorsTimer);
  _persistEditorsTimer = setTimeout(() => {
    _persistEditorsTimer = null;
    persistOpenEditorsSnapshot();
  }, 100);
}

/** After reload — reopen saved tabs if they still belong to this workspace and exist on disk. */
async function restorePersistedOpenEditors() {
  if (!state.workspaceRoot || !monacoLoaded) return;
  let snap = null;
  try {
    const raw = localStorage.getItem(OPEN_EDITORS_KEY);
    if (!raw) return;
    snap = JSON.parse(raw);
  } catch (_) {
    return;
  }
  if (!snap || snap.workspaceRoot !== state.workspaceRoot) return;
  const paths = Array.isArray(snap.paths) ? snap.paths : [];

  const opened = [];
  for (const p of paths) {
    if (!p || typeof p !== "string") continue;
    try {
      const probe = await window.electronAPI.readFile(p);
      if (!probe.ok) continue;
    } catch (_) {
      continue;
    }
    const nm = p.replace(/\\/g, "/").split("/").pop() || p;
    try {
      await openFile(p, nm);
      opened.push(p);
    } catch (_) {
      /* ignore */
    }
  }

  if (opened.length === 0) {
    persistOpenEditorsSnapshot();
    return;
  }

  let focus =
    snap.active && state.openFiles.has(snap.active)
      ? snap.active
      : opened[opened.length - 1];
  if (focus && state.openFiles.has(focus)) {
    setActiveFile(focus);
  }
  persistOpenEditorsSnapshot();
}

/** Reload app: reopen last workspace if the folder still exists. */
async function tryRestorePersistedWorkspace() {
  let saved = null;
  try {
    saved = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch (_) {
    return false;
  }
  if (!saved) return false;
  let ok = false;
  try {
    ok = !!(
      window.electronAPI.pathIsDirectory &&
      (await window.electronAPI.pathIsDirectory(saved))
    );
  } catch (_) {
    ok = false;
  }
  if (!ok) {
    try {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } catch (_) {}
    return false;
  }
  try {
    await loadWorkspace(saved);
    return true;
  } catch (_) {
    try {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } catch (_) {}
    return false;
  }
}

/* -------------------- Open Folder/File flows -------------------- */
async function openFolderFlow() {
  const folder = await window.electronAPI.openFolderDialog();
  if (folder) {
    await loadWorkspace(folder);
    showToast("Opened " + folder.split("/").pop(), "success");
  }
}

async function openFileFlow() {
  const filePath = await window.electronAPI.openFileDialog();
  if (filePath) {
    await openFile(filePath, filePath.split("/").pop());
  }
}

/* -------------------- Terminal (line-based, robust) -------------------- */
const TERMINAL_THEMES = {
  dark: {
    background: "#1e1e1e",
    foreground: "#cccccc",
    cursor: "#aeafad",
    cursorAccent: "#1e1e1e",
    selectionBackground: "#264f7866",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#1f1f1f",
    cursor: "#000000",
    cursorAccent: "#ffffff",
    selectionBackground: "#add6ff",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc00",
    yellow: "#949800",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#14ce14",
    brightYellow: "#b5ba00",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  },
};

// Map<id, instance> where instance encapsulates xterm + per-session state.
const terminals = new Map();
let activeTerminalId = null;
let terminalDataBound = false;

function activeTerminal() {
  return activeTerminalId != null ? terminals.get(activeTerminalId) : null;
}

/** If the user highlighted text in the terminal, copy it instead of treating Ctrl+C as interrupt. */
function terminalTryCopySelection(term) {
  if (!term) return false;
  const hasSel =
    typeof term.hasSelection === "function" ? term.hasSelection() : false;
  const raw =
    typeof term.getSelection === "function" ? term.getSelection() || "" : "";
  const text = typeof raw === "string" ? raw : String(raw || "");
  if (!hasSel && text.length === 0) return false;
  try {
    navigator.clipboard.writeText(text);
  } catch (_) {}
  try {
    if (typeof term.clearSelection === "function") term.clearSelection();
  } catch (_) {}
  return true;
}

/** Bash/cmd often echoes literal ^C to stdout/err right after SIGINT — hide that brief glitch. */
function stripInterruptCaretCEcho(chunk, inst) {
  if (!chunk || typeof chunk !== "string") return chunk;
  if (
    !inst ||
    !inst._interruptEchoDeadline ||
    Date.now() > inst._interruptEchoDeadline
  )
    return chunk;
  let s = chunk;
  const before = s;
  // Line break + ^ C common on Unix shells; (^C suffix) — (?!\w) avoids ^CMake-ish false positives on one line
  s = s.replace(/(\r?\n)\^\s*C(?!\w)/g, "$1");
  s = s.replace(/\^\s*C(?!\w)(\r?\n|$)/gm, "");
  if (before !== s && s.length === 0) inst._interruptEchoDeadline = 0;
  return s;
}

function bindTerminalDataOnce() {
  if (terminalDataBound) return;
  terminalDataBound = true;
  // Single global listener; demux by session id.
  window.electronAPI.onTerminalData((id, data) => {
    const inst = terminals.get(id);
    if (inst) inst.handleIncoming(data);
    // Capture terminal output into ProjectContext for Debug mode awareness.
    try {
      if (typeof ProjectContext !== "undefined") {
        ProjectContext.noteTerminalOutput(data);
      }
    } catch (_) {}
  });
}

function createTerminalInstance(id) {
  const container = document.createElement("div");
  container.className = "terminal-instance";
  container.dataset.id = String(id);
  $("terminals-area").appendChild(container);

  const term = new window.Terminal({
    theme: TERMINAL_THEMES[state.theme] || TERMINAL_THEMES.dark,
    cursorBlink: true,
    fontFamily:
      '"JetBrains Mono", "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.3,
    letterSpacing: 0.2,
  });
  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  if (window.WebLinksAddon) {
    try {
      term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
    } catch (_) {}
  }
  term.open(container);

  // Ctrl/Cmd+C: copy whenever there is a real selection — do not emit \x03 into onData
  term.attachCustomKeyEventHandler((domEvent) => {
    try {
      if (!domEvent || domEvent.type !== "keydown") return true;
      const key = domEvent.key;
      const isCopyChord =
        !domEvent.altKey &&
        (domEvent.ctrlKey || domEvent.metaKey) &&
        !domEvent.shiftKey &&
        (key === "c" || key === "C" || domEvent.code === "KeyC");
      if (!isCopyChord) return true;
      if (typeof term.hasSelection === "function" && term.hasSelection()) {
        domEvent.preventDefault();
        terminalTryCopySelection(term);
        return false;
      }
    } catch (_) {}
    return true;
  });

  const inst = {
    id,
    shellType: null,
    name: `zsh ${id}`,
    container,
    term,
    fitAddon,
    buffer: "",
    cursor: 0,
    history: [],
    historyIdx: -1,
    prompted: false,
    waitingForOutput: false,
    lastPrompt: "",
    /** Main-process interrupt often causes a caret-C echo strip for a short window */
    _interruptEchoDeadline: 0,
  };

  function redrawLine() {
    inst.term.write("\r\x1b[K");
    inst.term.write(inst.lastPrompt + inst.buffer);
    if (inst.cursor < inst.buffer.length) {
      inst.term.write(`\x1b[${inst.buffer.length - inst.cursor}D`);
    }
  }

  inst.handleIncoming = (data) => {
    const cleaned = stripInterruptCaretCEcho(String(data), inst);
    if (!cleaned) return;
    const idx = Math.max(cleaned.lastIndexOf("\n"), cleaned.lastIndexOf("\r"));
    const tail = cleaned.slice(idx + 1);
    // Match prompt: supports (venv) prefix, [shell] label, user@host:path$ format
    if (/\$\s*$/.test(tail) || /[#>]\s*$/.test(tail)) {
      inst.lastPrompt = tail;
      inst.prompted = true;
      inst.waitingForOutput = false;
      inst.buffer = "";
      inst.cursor = 0;
    }
    inst.term.write(cleaned);
  };

  term.onData((data) => {
    if (inst.waitingForOutput) {
      if (data === "\u0003") {
        if (!terminalTryCopySelection(inst.term)) {
          inst._interruptEchoDeadline = Date.now() + 550;
          window.electronAPI.interruptTerminal(inst.id);
        }
        return;
      }
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (ch === "\u0003") {
          if (!terminalTryCopySelection(inst.term)) {
            inst._interruptEchoDeadline = Date.now() + 550;
            window.electronAPI.interruptTerminal(inst.id);
          }
          return;
        }
        if (ch === "\r") {
          inst.term.write("\r\n");
          const inputLine = inst.buffer + "\n";
          inst.buffer = "";
          if (window.electronAPI.sendTerminalInput) {
            window.electronAPI.sendTerminalInput(inst.id, inputLine);
          }
        } else if (code === 127 || ch === "\b") {
          if (inst.buffer.length > 0) {
            inst.buffer = inst.buffer.slice(0, -1);
            inst.term.write("\b \b");
          }
        } else if (code >= 32) {
          inst.buffer += ch;
          inst.term.write(ch);
        }
      }
      return;
    }
    if (!inst.prompted) return;

    for (const ch of data) {
      const code = ch.charCodeAt(0);

      if (ch === "\r") {
        // Enter
        inst.term.write("\r\n");
        const command = inst.buffer;
        if (command.trim()) {
          inst.history.push(command);
          if (inst.history.length > 200) inst.history.shift();
        }
        inst.historyIdx = inst.history.length;
        inst.buffer = "";
        inst.cursor = 0;
        inst.prompted = false;
        inst.waitingForOutput = true;
        window.electronAPI.execTerminal(inst.id, command);
        return;
      }

      if (code === 127 || ch === "\b") {
        // Backspace
        if (inst.cursor > 0) {
          if (inst.cursor === inst.buffer.length) {
            inst.buffer = inst.buffer.slice(0, -1);
            inst.cursor -= 1;
            inst.term.write("\b \b");
          } else {
            inst.buffer =
              inst.buffer.slice(0, inst.cursor - 1) +
              inst.buffer.slice(inst.cursor);
            inst.cursor -= 1;
            inst.term.write("\b");
            inst.term.write("\x1b[s"); // Save cursor
            inst.term.write("\x1b[K"); // Clear to end of line
            inst.term.write(inst.buffer.slice(inst.cursor));
            inst.term.write("\x1b[u"); // Restore cursor
          }
        }
        continue;
      }

      if (ch === "\u0003") {
        // Ctrl+C: copy selection, else cancel current input (no IPC, no ^C echo)
        if (terminalTryCopySelection(inst.term)) continue;
        inst.buffer = "";
        inst.cursor = 0;
        inst.term.write("\r\x1b[K");
        inst.term.write(inst.lastPrompt);
        continue;
      }

      if (ch === "\u000c") {
        // Ctrl-L: clear screen
        inst.term.clear();
        inst.term.write("\x1b[H" + inst.lastPrompt + inst.buffer);
        if (inst.cursor < inst.buffer.length) {
          inst.term.write(`\x1b[${inst.buffer.length - inst.cursor}D`);
        }
        continue;
      }

      if (ch === "\x1b") {
        // Escape sequence
        const restIdx = data.indexOf("\x1b");
        const seq = data.slice(restIdx);
        if (seq.startsWith("\x1b[A")) {
          if (inst.history.length > 0 && inst.historyIdx > 0) {
            inst.historyIdx -= 1;
            inst.buffer = inst.history[inst.historyIdx] || "";
            inst.cursor = inst.buffer.length;
            redrawLine();
          }
          break;
        }
        if (seq.startsWith("\x1b[B")) {
          if (inst.historyIdx < inst.history.length) {
            inst.historyIdx += 1;
            inst.buffer = inst.history[inst.historyIdx] || "";
            inst.cursor = inst.buffer.length;
            redrawLine();
          }
          break;
        }
        if (seq.startsWith("\x1b[D")) {
          if (inst.cursor > 0) {
            inst.cursor -= 1;
            inst.term.write("\x1b[D");
          }
          break;
        }
        if (seq.startsWith("\x1b[C")) {
          if (inst.cursor < inst.buffer.length) {
            inst.cursor += 1;
            inst.term.write("\x1b[C");
          }
          break;
        }
        if (seq.startsWith("\x1b[H") || seq.startsWith("\x1b[1~")) {
          if (inst.cursor > 0) {
            inst.term.write(`\x1b[${inst.cursor}D`);
            inst.cursor = 0;
          }
          break;
        }
        if (seq.startsWith("\x1b[F") || seq.startsWith("\x1b[4~")) {
          if (inst.cursor < inst.buffer.length) {
            inst.term.write(`\x1b[${inst.buffer.length - inst.cursor}C`);
            inst.cursor = inst.buffer.length;
          }
          break;
        }
        break;
      }

      if (code < 32) continue;

      inst.buffer =
        inst.buffer.slice(0, inst.cursor) + ch + inst.buffer.slice(inst.cursor);
      inst.cursor += 1;
      if (inst.cursor === inst.buffer.length) {
        inst.term.write(ch);
      } else {
        redrawLine();
      }
    }
  });

  inst.applyTheme = (themeName) => {
    inst.term.options.theme =
      TERMINAL_THEMES[themeName] || TERMINAL_THEMES.dark;
  };

  inst.fit = () => {
    try {
      fitAddon.fit();
    } catch (_) {}
  };

  inst.dispose = () => {
    try {
      term.dispose();
    } catch (_) {}
    try {
      container.remove();
    } catch (_) {}
  };

  return inst;
}

async function newTerminal(shellType) {
  bindTerminalDataOnce();
  const id = await window.electronAPI.createTerminal(shellType || null);
  const inst = createTerminalInstance(id);
  inst.shellType = shellType || "default";
  const shellLabel = shellType || "zsh";
  inst.name = `${shellLabel} ${id}`;
  terminals.set(id, inst);
  switchTerminal(id);
  // Tell main to send the welcome banner + first prompt for this session
  window.electronAPI.initTerminal(id);
  renderTerminalSidebar();
  return inst;
}

function switchTerminal(id) {
  const inst = terminals.get(id);
  if (!inst) return;
  activeTerminalId = id;
  document
    .querySelectorAll(".terminal-instance")
    .forEach((el) => el.classList.remove("active"));
  inst.container.classList.add("active");
  setTimeout(() => {
    inst.fit();
    try {
      inst.term.focus();
    } catch (_) {}
  }, 30);
  renderTerminalSelect();
}

async function closeTerminal(id) {
  const inst = terminals.get(id);
  if (!inst) return;
  window.electronAPI.destroyTerminal(id);
  inst.dispose();
  terminals.delete(id);
  if (activeTerminalId === id) {
    const remaining = Array.from(terminals.keys());
    if (remaining.length > 0) {
      switchTerminal(remaining[remaining.length - 1]);
    } else {
      activeTerminalId = null;
      // Auto-create a new one so the panel is never empty.
      await newTerminal();
    }
  }
  renderTerminalSelect();
}

function renderTerminalSelect() {
  // Update the shell selector button label
  const label = $("terminal-shell-label");
  if (label) {
    const inst = activeTerminal();
    label.textContent = inst ? inst.name : "Terminal";
  }
  renderTerminalSidebar();
}

function renderTerminalSidebar() {
  const list = $("terminal-sidebar-list");
  if (!list) return;
  list.innerHTML = "";
  for (const inst of terminals.values()) {
    const tab = document.createElement("div");
    tab.className =
      "terminal-sidebar-tab" + (inst.id === activeTerminalId ? " active" : "");
    tab.dataset.id = inst.id;
    tab.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      <span class="terminal-sidebar-name">${escapeHtml(inst.name)}</span>
      <button class="terminal-sidebar-close" title="Close">&times;</button>
    `;
    tab.addEventListener("click", (e) => {
      if (e.target.closest(".terminal-sidebar-close")) return;
      switchTerminal(inst.id);
    });
    tab
      .querySelector(".terminal-sidebar-close")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        closeTerminal(inst.id);
      });
    list.appendChild(tab);
  }
}

async function setupShellSelector() {
  const shells = await window.electronAPI.getAvailableShells();
  const dropdown = $("terminal-shell-dropdown");
  const btn = $("terminal-shell-btn");
  if (!dropdown || !btn) return;

  // Populate the shell dropdown
  dropdown.innerHTML = "";
  const header = document.createElement("div");
  header.className = "shell-dropdown-header";
  header.textContent = "Select Terminal Shell";
  dropdown.appendChild(header);

  // Add terminal switcher section
  const switcherHeader = document.createElement("div");
  switcherHeader.className = "shell-dropdown-section";
  switcherHeader.textContent = "Active Terminals";
  dropdown.appendChild(switcherHeader);

  const switcherList = document.createElement("div");
  switcherList.className = "shell-dropdown-terminals";
  switcherList.id = "shell-dropdown-terminals";
  dropdown.appendChild(switcherList);

  const divider = document.createElement("div");
  divider.className = "shell-dropdown-divider";
  dropdown.appendChild(divider);

  const newHeader = document.createElement("div");
  newHeader.className = "shell-dropdown-section";
  newHeader.textContent = "New Terminal";
  dropdown.appendChild(newHeader);

  for (const shell of shells) {
    const item = document.createElement("button");
    item.className = "shell-dropdown-item";
    item.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      <span>${escapeHtml(shell.name)}</span>
    `;
    item.addEventListener("click", () => {
      dropdown.setAttribute("hidden", "");
      newTerminal(shell.id);
      switchPanel("terminal");
    });
    dropdown.appendChild(item);
  }

  // Toggle dropdown
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.hasAttribute("hidden")) {
      // Update the active terminals list
      const termList = dropdown.querySelector("#shell-dropdown-terminals");
      termList.innerHTML = "";
      for (const inst of terminals.values()) {
        const item = document.createElement("button");
        item.className =
          "shell-dropdown-item" +
          (inst.id === activeTerminalId ? " active" : "");
        item.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          <span>${escapeHtml(inst.name)}</span>
        `;
        item.addEventListener("click", () => {
          dropdown.setAttribute("hidden", "");
          switchTerminal(inst.id);
        });
        termList.appendChild(item);
      }
      dropdown.removeAttribute("hidden");
    } else {
      dropdown.setAttribute("hidden", "");
    }
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.setAttribute("hidden", "");
    }
  });
}

// Backwards-compat helpers used elsewhere in this file.
function fitActiveTerminal() {
  const inst = activeTerminal();
  if (inst) inst.fit();
}

/* -------------------- Terminal Resize Handle -------------------- */
function setupTerminalResize() {
  const handle = $("terminal-resize-handle");
  const container = $("terminal-container");
  let dragging = false;
  let startY = 0;
  let startH = 0;
  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    startY = e.clientY;
    startH = container.getBoundingClientRect().height;
    document.body.style.cursor = "ns-resize";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    const newH = Math.max(80, Math.min(window.innerHeight - 220, startH + dy));
    container.style.height = newH + "px";
    fitActiveTerminal();
  });
  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = "";
    }
  });
}

/* -------------------- Panel Resize Handles -------------------- */
function setupPanelResize() {
  const sidebar = $("sidebar");
  const sidebarResizer = $("sidebar-resizer");
  if (sidebarResizer && sidebar) {
    let dragging = false;
    let startX = 0;
    let startW = 0;
    sidebarResizer.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      sidebarResizer.classList.add("active");
      document.body.style.cursor = "ew-resize";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const newW = Math.max(
        160,
        Math.min(window.innerWidth * 0.6, startW + dx),
      );
      sidebar.style.width = newW + "px";
    });
    window.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        sidebarResizer.classList.remove("active");
        document.body.style.cursor = "";
      }
    });
  }

  const chatbot = $("chatbot-container");
  const chatbotResizer = $("chatbot-resizer");
  if (chatbotResizer && chatbot) {
    let dragging = false;
    let startX = 0;
    let startW = 0;
    chatbotResizer.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = chatbot.getBoundingClientRect().width;
      chatbotResizer.classList.add("active");
      document.body.style.cursor = "ew-resize";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = startX - e.clientX;
      const newW = Math.max(
        260,
        Math.min(window.innerWidth * 0.6, startW + dx),
      );
      chatbot.style.width = newW + "px";
    });
    window.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        chatbotResizer.classList.remove("active");
        document.body.style.cursor = "";
      }
    });
  }
}

/* -------------------- Chatbot (mock) -------------------- */
/* -------------------- Chat (Cursor-like) -------------------- */
const Chat = (() => {
  /** @type {Map<string, {id:string,title:string,messages:Array<{role:'user'|'bot',text:string}>,createdAt:number,updatedAt:number}>} */
  const chats = new Map();
  let activeId = null;
  let _currentUserId = null; // tracks which user's data is loaded

  const STORAGE_KEY_PREFIX = "buildex.chats.";
  const ANON_STORAGE_KEY = "buildex.chats.anonymous";

  function getStorageKey() {
    return _currentUserId ? (STORAGE_KEY_PREFIX + _currentUserId) : ANON_STORAGE_KEY;
  }

  function load(userId) {
    _currentUserId = userId || null;
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) return;
      const obj = JSON.parse(raw);
      for (const c of obj.chats || []) chats.set(c.id, c);
      activeId = obj.activeId || null;
    } catch (_) {}
  }

  /**
   * Wipe in-memory state and clear old anonymous / any stale local data.
   * Called on logout so new login starts clean.
   */
  function reset() {
    clearTimeout(backupDebounceTimer);
    chats.clear();
    activeId = null;
    _currentUserId = null;
    renderMessages();
    renderHeader();
    renderHistory();
  }

  /**
   * Called on login — loads this user's local cache then pulls cloud chats.
   * If a different user was previously loaded, their data stays untouched in localStorage.
   */
  async function switchUser(userId) {
    clearTimeout(backupDebounceTimer);
    chats.clear();
    activeId = null;
    load(userId);
    if (chats.size === 0 || !chats.get(activeId)) newChat();
    renderMessages();
    renderHeader();
    renderHistory();
    // Pull cloud chats for this user and merge
    await syncFromDynamoDB();
  }

  let backupDebounceTimer = null;
  function backupToDynamoDB(chatToBackup) {
    if (!window.electronAPI?.aws?.backupChat) return;
    const session = typeof AuthManager !== "undefined" ? AuthManager.getStoredSession() : null;
    if (!session || !session.userId) return;

    const targetChat = chatToBackup || chats.get(activeId);
    if (!targetChat || !targetChat.id || !targetChat.messages || targetChat.messages.length === 0) return;

    clearTimeout(backupDebounceTimer);
    backupDebounceTimer = setTimeout(async () => {
      try {
        await window.electronAPI.aws.backupChat({
          userId: session.userId,
          chat: {
            id: targetChat.id,
            title: targetChat.title || "New chat",
            messages: targetChat.messages,
            createdAt: targetChat.createdAt,
            updatedAt: targetChat.updatedAt || Date.now()
          }
        });
      } catch (err) {
        console.warn("Cloud chat backup failed:", err);
      }
    }, 800);
  }

  async function syncFromDynamoDB() {
    try {
      const session = typeof AuthManager !== "undefined" ? AuthManager.getStoredSession() : null;
      if (!session || !session.userId || !window.electronAPI?.aws?.getChats) return;
      const res = await window.electronAPI.aws.getChats(session.userId);
      if (res && res.ok && Array.isArray(res.chats) && res.chats.length > 0) {
        let changed = false;
        for (const cloudChat of res.chats) {
          const local = chats.get(cloudChat.chatId);
          const cloudUpdated = new Date(cloudChat.updatedAt || 0).getTime();
          if (!local || cloudUpdated > (local.updatedAt || 0)) {
            chats.set(cloudChat.chatId, {
              id: cloudChat.chatId,
              title: cloudChat.title || "Chat",
              messages: Array.isArray(cloudChat.messages) ? cloudChat.messages : [],
              createdAt: new Date(cloudChat.createdAt || Date.now()).getTime(),
              updatedAt: cloudUpdated || Date.now()
            });
            changed = true;
          }
        }
        if (changed) {
          // Remove empty placeholder new chat if cloud has real data
          for (const [id, chat] of chats) {
            if (chat.messages.length === 0 && id !== activeId) chats.delete(id);
          }
          if (!activeId || !chats.has(activeId)) {
            activeId = Array.from(chats.keys())[0];
          }
          save(true);
          renderMessages();
          renderHeader();
          renderHistory();
        }
      }
    } catch (err) {
      console.warn("DynamoDB chat sync error:", err);
    }
  }

  function save(skipCloudBackup = false) {
    try {
      const data = {
        chats: Array.from(chats.values()).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
        activeId,
      };
      localStorage.setItem(getStorageKey(), JSON.stringify(data));
      if (!skipCloudBackup) {
        backupToDynamoDB();
      }
    } catch (_) {}
  }

  function newChat(switchTo = true) {
    const id =
      "c_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 6);
    const now = Date.now();
    const chat = {
      id,
      title: "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    chats.set(id, chat);
    if (switchTo) setActive(id);
    save();
    renderHistory();
    return chat;
  }

  function setActive(id) {
    if (!chats.has(id)) return;
    activeId = id;
    save();
    renderMessages();
    renderHeader();
    renderHistory();
  }

  function deleteChat(id) {
    chats.delete(id);
    const session = typeof AuthManager !== "undefined" ? AuthManager.getStoredSession() : null;
    if (session && session.userId && window.electronAPI?.aws?.deleteChat) {
      window.electronAPI.aws.deleteChat({ userId: session.userId, chatId: id }).catch(() => {});
    }
    if (activeId === id) {
      const next = Array.from(chats.keys())[0];
      if (next) setActive(next);
      else newChat();
    }
    save();
    renderHistory();
  }

  function clearActive() {
    const c = chats.get(activeId);
    if (!c) return;
    c.messages = [];
    c.title = "New chat";
    c.updatedAt = Date.now();
    save();
    renderMessages();
    renderHeader();
    renderHistory();
  }

  function renameChat(id, title) {
    const c = chats.get(id);
    if (!c) return;
    const next = (title || "").trim().slice(0, 80) || "New chat";
    if (c.title === next) return;
    c.title = next;
    c.userTitled = true;
    c.updatedAt = Date.now();
    save();
    renderHeader();
    renderHistory();
  }

  function appendMessage(role, text, meta = {}) {
    const c = chats.get(activeId);
    if (!c) return;
    const msgObj = { role, text, ...meta };
    c.messages.push(msgObj);
    if (
      role === "user" &&
      !c.userTitled &&
      (!c.title || c.title === "New chat")
    ) {
      c.title = text.slice(0, 48).replace(/\s+/g, " ").trim() || "New chat";
    }
    c.updatedAt = Date.now();
    save();
    renderMessages();
    renderHeader();
    renderHistory();
    if (typeof updateContextMeter === "function") updateContextMeter();
  }

  function renderHeader() {
    const c = chats.get(activeId);
    $("chat-name").textContent = c ? c.title : "New chat";
    if (typeof updateContextMeter === "function") updateContextMeter();
  }

  function renderMessages() {
    const messages = $("chat-messages");
    const empty = $("chat-empty");
    const history = $("chat-history");
    if (!messages) return;
    const c = chats.get(activeId);
    messages.innerHTML = "";

    if (!c || c.messages.length === 0) {
      if (empty) empty.style.display = "";
      if (typeof updateContextMeter === "function") updateContextMeter();
      return;
    }

    if (empty) empty.style.display = "none";

    for (const m of c.messages) {
      // Skip pending streaming messages — AIChat is rendering them live.
      if (m.pending) continue;
      const el = document.createElement("div");
      if (m.role === "user") {
        el.className = "chat-message user";
        // Style @file and [📄 file] references as chips
        const escaped = escapeHtml(m.text || "");
        let bodyHtml = escaped
          .replace(/@([\w.\/\-]+\.\w+)/g, (match, path) => {
            return `<span class="chat-file-chip"><span class="chip-icon">📄</span>${escapeHtml(path.split("/").pop())}</span>`;
          })
          .replace(/\[📄\s+([^\]]+)\]/g, (match, name) => {
            return `<span class="chat-file-chip"><span class="chip-icon">📄</span>${escapeHtml(name.split("/").pop())}</span>`;
          });
        if (m.attachments && m.attachments.length > 0) {
          const imgsHtml = m.attachments
            .map(
              (att) =>
                `<img src="${escapeAttr(att.data)}" alt="${escapeAttr(att.name || "image")}" class="user-msg-img" title="${escapeAttr(att.name || "attachment")}" />`,
            )
            .join("");
          bodyHtml += `<div class="user-msg-images">${imgsHtml}</div>`;
        }
        el.innerHTML = bodyHtml;
      } else {
        el.className = "chat-message bot";
        if (m.mode) el.dataset.mode = m.mode;
        const av = document.createElement("div");
        av.className = "bot-avatar";
        av.textContent = "B";
        const body = document.createElement("div");
        body.className = "msg-body";
        const allowCopy = m.mode
          ? !!(typeof Modes !== "undefined" && Modes.meta(m.mode).allowCopy)
          : true;
        if (typeof Markdown !== "undefined") {
          const { html, steps } = Markdown.render(m.text || "", { allowCopy });
          body.innerHTML = html;
          if (steps && steps.length) {
            body.querySelectorAll("[data-step-placeholder]").forEach((ph) => {
              const idx = parseInt(ph.dataset.stepPlaceholder, 10);
              const step = steps[idx];
              if (!step || typeof Guide === "undefined") return;
              ph.replaceWith(Guide.renderStepCard({ ...step, mode: m.mode }));
            });
          }
          if (allowCopy) {
            body.querySelectorAll(".md-copy").forEach((btn) => {
              btn.addEventListener("click", () => {
                const code =
                  btn.parentElement.querySelector("code")?.textContent || "";
                try {
                  navigator.clipboard.writeText(code);
                  btn.textContent = "Copied";
                  setTimeout(() => (btn.textContent = "Copy"), 1200);
                } catch (_) {}
              });
            });
          }
        } else {
          body.textContent = m.text;
        }
        el.append(av, body);
      }
      messages.appendChild(el);
    }
    if (history) history.scrollTop = history.scrollHeight;
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function bucketLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return "Today";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    const days = Math.floor((now - d) / 86400000);
    if (days < 7) return "Last 7 days";
    if (days < 30) return "Last 30 days";
    return "Older";
  }

  function renderHistory() {
    const list = $("chat-history-list");
    if (!list) return;
    list.innerHTML = "";
    const sorted = Array.from(chats.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    if (sorted.length === 0) {
      list.innerHTML =
        '<div class="chat-empty-sub" style="padding:18px;text-align:center;">No chats yet.</div>';
      return;
    }
    let lastBucket = null;
    for (const c of sorted) {
      const bucket = bucketLabel(c.updatedAt);
      if (bucket !== lastBucket) {
        const sec = document.createElement("div");
        sec.className = "chat-history-section";
        sec.textContent = bucket;
        list.appendChild(sec);
        lastBucket = bucket;
      }
      const item = document.createElement("div");
      item.className =
        "chat-history-item" + (c.id === activeId ? " active" : "");
      item.dataset.id = c.id;
      item.innerHTML = `
        <span class="chat-history-title" title="Double-click to rename">${escapeHtml(c.title)}</span>
        <span class="chat-history-time">${timeLabel(c.updatedAt)}</span>
        <button class="chat-history-rename" title="Rename">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="chat-history-delete" title="Delete">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.5 14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      `;
      const titleEl = item.querySelector(".chat-history-title");
      item.addEventListener("click", () => {
        if (item.classList.contains("renaming")) return;
        setActive(c.id);
        toggleHistoryPanel(false);
      });
      titleEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startInlineRename(item, c);
      });
      item
        .querySelector(".chat-history-rename")
        .addEventListener("click", (e) => {
          e.stopPropagation();
          startInlineRename(item, c);
        });
      item
        .querySelector(".chat-history-delete")
        .addEventListener("click", (e) => {
          e.stopPropagation();
          deleteChat(c.id);
        });
      list.appendChild(item);
    }
  }

  function startInlineRename(itemEl, chat) {
    if (!itemEl || itemEl.classList.contains("renaming")) return;
    const titleEl = itemEl.querySelector(".chat-history-title");
    if (!titleEl) return;
    itemEl.classList.add("renaming");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-history-title-input";
    input.value = chat.title;
    input.maxLength = 80;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      itemEl.classList.remove("renaming");
      if (commit) renameChat(chat.id, input.value);
      else renderHistory();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  function toggleHistoryPanel(force) {
    const panel = $("chat-history-panel");
    const show =
      typeof force === "boolean" ? force : panel.hasAttribute("hidden");
    if (show) {
      renderHistory();
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
  }

  function init() {
    // On startup, load as anonymous — AuthManager.init() will call switchUser once session is confirmed
    load(null);
    if (chats.size === 0 || !chats.get(activeId)) newChat();
    else {
      renderMessages();
      renderHeader();
      renderHistory();
    }
  }

  function appendPending(messageId, mode) {
    const c = chats.get(activeId);
    if (!c) return;
    c.messages.push({ role: "bot", text: "", pending: true, messageId, mode });
    c.updatedAt = Date.now();
    save();
    // We do NOT call renderMessages() here — the AIChat owns the live
    // bubble DOM until it's finalized (preserves streaming animation).
  }

  function replacePending(messageId, finalText) {
    const c = chats.get(activeId);
    if (!c) return;
    const idx = c.messages.findIndex(
      (m) => m.pending && m.messageId === messageId,
    );
    if (idx === -1) {
      c.messages.push({ role: "bot", text: finalText });
    } else {
      c.messages[idx] = {
        role: "bot",
        text: finalText,
        mode: c.messages[idx].mode,
      };
    }
    c.updatedAt = Date.now();
    save();
    // Re-render now that streaming is done so the message persists across reloads.
    renderHistory();
  }

  return {
    init,
    reset,
    switchUser,
    newChat,
    setActive,
    deleteChat,
    clearActive,
    renameChat,
    appendMessage,
    appendPending,
    replacePending,
    toggleHistoryPanel,
    renderMessages,
    renderHeader,
    getActiveId: () => activeId,
    getActive: () => chats.get(activeId),
    backupToDynamoDB,
    syncFromDynamoDB,
  };
})();

function updateContextMeter() {
  const btn = $("chat-context-btn");
  const progress = $("context-circle-progress");
  const btnText = $("context-btn-text");
  if (!btn || !progress) return;

  const c = typeof Chat !== "undefined" ? Chat.getActive() : null;
  const maxTokens = 128000;

  // Estimated tokens calculation
  let sysTokens = 800;
  let historyTokens = 0;
  let attachedTokens = 0;

  if (c && c.messages && c.messages.length > 0) {
    for (const m of c.messages) {
      const msgTokens = Math.round((m.text || "").length / 4);
      historyTokens += msgTokens;
      if (m.attachments && m.attachments.length) {
        attachedTokens += (m.attachments.length * 256);
      }
    }
  }

  // Active attached snippets in state
  if (state.contextSnippets) {
    for (const k in state.contextSnippets) {
      attachedTokens += Math.round((state.contextSnippets[k] || "").length / 4);
    }
  }

  const totalUsed = (c && c.messages && c.messages.length > 0) ? (sysTokens + historyTokens + attachedTokens) : 0;
  const availTokens = Math.max(0, maxTokens - totalUsed);
  const pct = Math.min(100, Math.max(0, (totalUsed / maxTokens) * 100));
  const roundedPct = Math.round(pct);

  // SVG circular stroke-dasharray (circumference normalized to 100)
  progress.setAttribute("stroke-dasharray", `${Math.max(1, roundedPct)}, 100`);

  if (roundedPct >= 80) {
    btn.className = "chat-context-btn critical";
  } else if (roundedPct >= 50) {
    btn.className = "chat-context-btn warning";
  } else {
    btn.className = "chat-context-btn";
  }

  if (btnText) {
    btnText.textContent = totalUsed > 1000 ? `${(totalUsed / 1000).toFixed(1)}K` : (totalUsed > 0 ? `${totalUsed}` : "128K");
  }

  // Update Popover elements
  const usedEl = $("ctx-used-tokens");
  const usedPctEl = $("ctx-used-pct");
  const availEl = $("ctx-avail-tokens");
  const barFill = $("ctx-bar-fill");
  const sysEl = $("ctx-system-tokens");
  const histEl = $("ctx-history-tokens");
  const attEl = $("ctx-attached-tokens");
  const badge = $("ctx-status-badge");

  if (usedEl) usedEl.textContent = totalUsed.toLocaleString();
  if (usedPctEl) usedPctEl.textContent = `${pct < 1 && pct > 0 ? pct.toFixed(1) : roundedPct}%`;
  if (availEl) availEl.textContent = `${(availTokens / 1000).toFixed(1)}K`;
  if (barFill) barFill.style.width = `${Math.max(1, roundedPct)}%`;
  if (sysEl) sysEl.textContent = totalUsed > 0 ? `~${sysTokens} tokens` : "0 tokens";
  if (histEl) histEl.textContent = `${historyTokens.toLocaleString()} tokens`;
  if (attEl) attEl.textContent = `${attachedTokens.toLocaleString()} tokens`;

  if (badge) {
    if (roundedPct >= 80) {
      badge.textContent = "HIGH USAGE";
      badge.className = "context-status-badge warning";
    } else {
      badge.textContent = "OPTIMAL";
      badge.className = "context-status-badge";
    }
  }
}

function autoGrowTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function setupChat() {
  const input = $("chat-input");
  const sendBtn = $("chat-send");
  const contextBtn = $("chat-context-btn");
  const contextPop = $("chat-context-popover");

  if (contextBtn && contextPop) {
    contextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = contextPop.hasAttribute("hidden");
      closeAllPopovers(contextPop);
      if (isHidden) {
        updateContextMeter();
        contextPop.removeAttribute("hidden");
        positionPopover(contextPop, contextBtn);
      } else {
        contextPop.setAttribute("hidden", "");
      }
    });

    contextPop.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    const closeBtn = $("ctx-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        contextPop.setAttribute("hidden", "");
      });
    }
  }

  const newChatCtxBtn = $("ctx-new-chat-btn");
  if (newChatCtxBtn) {
    newChatCtxBtn.addEventListener("click", () => {
      Chat.newChat();
      Chat.toggleHistoryPanel(false);
      if (contextPop) contextPop.setAttribute("hidden", "");
      showToast("Started fresh conversation (0 / 128K context)", "info", 1500);
      input.focus();
    });
  }

  Chat.init();

  const SLASH_COMMANDS = [
    {
      name: "/plan",
      syntax: "<goal>",
      desc: "Generate an upfront, end-to-end milestone roadmap",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
      insert: "/plan "
    },
    {
      name: "/fetch",
      syntax: "<file> [lines]",
      desc: "Load exact file lines into AI context",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      insert: "/fetch "
    },
    {
      name: "/pop",
      syntax: "<file:line> [msg]",
      desc: "Anchor in-editor highlight & popover tooltip",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      insert: "/pop "
    },
    {
      name: "/explain",
      syntax: "[query]",
      desc: "Explain code, components, or architecture in detail",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      insert: "/explain "
    },
    {
      name: "/debug",
      syntax: "[issue]",
      desc: "Analyze and diagnose bugs or runtime errors",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><path d="M10 14h4"/></svg>`,
      insert: "/debug "
    },
    {
      name: "/roadmap",
      syntax: "",
      desc: "View your DynamoDB learning progress & achievements",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
      insert: "/roadmap"
    },
    {
      name: "/clear",
      syntax: "",
      desc: "Clear chat conversation history",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
      insert: "/clear"
    },
    {
      name: "/help",
      syntax: "",
      desc: "Show full command cheat sheet and documentation",
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
      insert: "/help"
    }
  ];

  async function handleSlashCommand(rawText) {
    const trimmed = rawText.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = trimmed.slice(parts[0].length).trim();

    // /help
    if (cmd === "/help") {
      Chat.appendMessage("user", rawText);
      Chat.appendMessage(
        "bot",
        `### 🛠️ BuildeX Slash Commands
- \`/plan <goal>\` — Generate an upfront, end-to-end milestone roadmap
- \`/fetch <file> [lines]\` — Load exact file lines into AI context (e.g. \`/fetch src/App.tsx 1-25\`)
- \`/pop <file:line> [message]\` — Anchor an in-editor highlight & popover tooltip (e.g. \`/pop src/App.tsx:10 Check state\`)
- \`/explain [query]\` — Explain code, architecture, or components in detail
- \`/debug [issue]\` — Diagnose errors, stack traces, and provide fixes
- \`/roadmap\` — View your current progress and DynamoDB achievements
- \`/clear\` — Clear chat conversation history`
      );
      return true;
    }

    // /clear
    if (cmd === "/clear") {
      if (typeof Chat !== "undefined" && Chat.newChat) {
        Chat.newChat();
        showToast("Chat cleared", "info", 1500);
      }
      return true;
    }

    // /roadmap
    if (cmd === "/roadmap") {
      Chat.appendMessage("user", rawText);
      if (typeof openRoadmapModal === "function") {
        openRoadmapModal();
      } else if ($("btn-roadmap")) {
        $("btn-roadmap").click();
      } else {
        Chat.appendMessage("bot", "_🗺️ Opening Roadmap... Check the top bar or sidebar for the full progress map._");
      }
      return true;
    }

    // /explain
    if (cmd === "/explain") {
      const topic = args || "the active file";
      if (typeof AIChat !== "undefined") {
        AIChat.send(`Please explain ${topic} in clear detail, including its purpose, structure, and key logic.`, { visibleText: `/explain ${topic}` });
      }
      return true;
    }

    // /debug
    if (cmd === "/debug") {
      const issue = args || "the current active file or recent terminal errors";
      if (typeof AIChat !== "undefined") {
        AIChat.send(`Please analyze and debug: ${issue}. Look for common pitfalls, syntax errors, or runtime bugs and provide the exact fix.`, { visibleText: `/debug ${issue}` });
      }
      return true;
    }

    // /fetch <file> [start-end]
    if (cmd === "/fetch") {
      Chat.appendMessage("user", rawText);
      if (!args) {
        Chat.appendMessage("bot", "_⚠ Usage: \`/fetch <filename> [startLine-endLine]\` (e.g. \`/fetch src/App.tsx 1-30\`)_");
        return true;
      }
      const fetchParts = args.split(/\s+/);
      const filePath = fetchParts[0];
      const rangeStr = fetchParts[1] || "";
      
      const fullPath = state.workspaceRoot ? (filePath.startsWith("/") ? filePath : `${state.workspaceRoot}/${filePath}`) : filePath;
      try {
        const fileContent = await window.electronAPI.readFile(fullPath);
        if (typeof fileContent !== "string") throw new Error("Could not read file");
        
        let lines = fileContent.split("\n");
        let startLine = 1;
        let endLine = lines.length;
        
        if (rangeStr && rangeStr.includes("-")) {
          const [s, e] = rangeStr.split("-").map(n => parseInt(n, 10));
          if (!isNaN(s)) startLine = Math.max(1, s);
          if (!isNaN(e)) endLine = Math.min(lines.length, e);
        }
        
        const sliced = lines.slice(startLine - 1, endLine).join("\n");
        const lang = filePath.split(".").pop() || "txt";
        const tag = `[${lang.toUpperCase()} ${filePath} #L${startLine}-${endLine}]`;
        const snippet = `\n\`\`\`${lang}\n// ${filePath} (lines ${startLine}-${endLine})\n${sliced}\n\`\`\`\n`;
        
        state.contextSnippets = state.contextSnippets || {};
        state.contextSnippets[tag] = snippet;
        renderContextChips();
        
        Chat.appendMessage("bot", `_📎 Successfully fetched \`${filePath}\` (lines ${startLine}–${endLine}) into context._`);
        showToast(`Fetched ${filePath} (${endLine - startLine + 1} lines)`, "success", 2000);
      } catch (err) {
        Chat.appendMessage("bot", `_⚠ Failed to fetch \`${filePath}\`: ${err.message}_`);
      }
      return true;
    }

    // /pop <file:line> [message]
    if (cmd === "/pop") {
      Chat.appendMessage("user", rawText);
      if (!args) {
        Chat.appendMessage("bot", "_⚠ Usage: \`/pop <file:line> [message]\` (e.g. \`/pop src/App.tsx:10 Check state definition\`)_");
        return true;
      }
      const firstSpace = args.indexOf(" ");
      const loc = firstSpace === -1 ? args : args.slice(0, firstSpace);
      const msg = firstSpace === -1 ? "Target highlighted line" : args.slice(firstSpace + 1).trim();
      
      const [filePath, lineStr] = loc.split(":");
      const lineNum = parseInt(lineStr, 10) || 1;
      const fullPath = state.workspaceRoot ? (filePath.startsWith("/") ? filePath : `${state.workspaceRoot}/${filePath}`) : filePath;
      
      try {
        if (typeof openFile === "function") {
          await openFile(fullPath);
        }
        const ed = getActiveCodeEditor();
        if (ed && ed.revealLineInCenter) {
          ed.revealLineInCenter(lineNum);
        }
        if (typeof ActiveStep !== "undefined") {
          ActiveStep.show({
            actionType: "highlight",
            targetFile: filePath,
            lineRanges: [{ from: lineNum, to: lineNum }],
            stepTitle: `Line ${lineNum} Highlight`,
            explanation: msg
          }, state.chatMode || "learn");
        }
        Chat.appendMessage("bot", `_📍 Opened \`${filePath}\` and displayed popover at line ${lineNum}._`);
        showToast(`Popover shown at ${filePath}:${lineNum}`, "success", 2000);
      } catch (err) {
        Chat.appendMessage("bot", `_⚠ Failed to pop to \`${loc}\`: ${err.message}_`);
      }
      return true;
    }

    // /plan <goal>
    if (cmd === "/plan") {
      const goal = args || "Complete project implementation plan";
      const planPrompt = `Please create a complete, structured, end-to-end implementation plan for: "${goal}".
Break it down into 3–5 comprehensive milestones with all necessary buildex-step blocks (scaffolding, files, and commands) upfront in a single response so I can follow it end-to-end.`;
      if (typeof AIChat !== "undefined") {
        AIChat.send(planPrompt, { visibleText: `/plan ${goal}` });
      }
      return true;
    }

    return false;
  }

  async function send() {
    // If currently streaming, the send button doubles as Stop.
    if (typeof AIChat !== "undefined" && AIChat.isStreaming()) {
      AIChat.cancelCurrent();
      return;
    }
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    autoGrowTextarea(input);

    // Check if slash command
    if (text.startsWith("/")) {
      const handled = await handleSlashCommand(text);
      if (handled) return;
    }

    let systemPrefix = "";
    if (state.contextSnippets) {
      for (const [tag, snippet] of Object.entries(state.contextSnippets)) {
        if (text.includes(tag)) {
          systemPrefix += snippet + "\n";
        }
      }
    }

    // Check credits balance
    if (typeof AuthManager !== "undefined") {
      const session = AuthManager.getStoredSession();
      if (session && session.creditsRemaining !== undefined && session.creditsRemaining <= 0) {
        showToast("⚠️ Credit limit reached (0 remaining). Please sync or upgrade in your Account modal.", "error", 4500);
        return;
      }
    }

    // Clear context files after sending
    state.contextSnippets = {};
    renderContextChips();
    // Include image attachments if any
    let attachments = [];
    if (state.chatAttachments && state.chatAttachments.length > 0) {
      attachments = [...state.chatAttachments];
      state.chatAttachments = [];
      renderAttachmentPreviews();
    }

    // AWS S3 upload for storage tracking with authenticated userId
    if (attachments.length > 0 && window.electronAPI.aws?.uploadImage) {
      const session = typeof AuthManager !== "undefined" ? AuthManager.getStoredSession() : null;
      const userId = session?.userId || state.currentUserId || "anonymous_user";
      attachments.forEach((att) => {
        if (!att.s3Url) {
          window.electronAPI.aws.uploadImage({
            base64Data: att.data,
            filename: att.name,
            userId
          }).then((res) => {
            if (res && res.ok) {
              att.s3Url = res.s3Url;
              att.s3Uri = res.s3Uri;
              if (typeof Chat !== "undefined") Chat.backupToDynamoDB();
            }
          }).catch((err) => console.warn("S3 upload failed:", err));
        }
      });
    }

    if (typeof AIChat !== "undefined") {
      AIChat.send(text, { systemPrefix, attachments });
    } else {
      Chat.appendMessage("user", text, { attachments });
      Chat.appendMessage(
        "bot",
        "_AI not initialized yet — try again in a moment._",
      );
    }
  }

  // Mention Popover
  const mentionPopover = $("chat-mention-popover");
  const mentionList = $("mention-popover-list");
  let mentionActiveIndex = 0;
  let currentMentionFiles = [];

  function hideMentionPopover() {
    if (mentionPopover) mentionPopover.setAttribute("hidden", "");
  }

  function renderMentionPopover(files) {
    if (!mentionList) return;
    mentionList.innerHTML = "";
    currentMentionFiles = files;
    if (files.length === 0) {
      mentionList.innerHTML =
        '<div style="padding:8px 12px;color:var(--text-dim);font-size:12px;">No files found</div>';
      return;
    }
    files.forEach((file, index) => {
      const btn = document.createElement("button");
      btn.className =
        "chat-popover-item compact" +
        (index === mentionActiveIndex ? " active" : "");
      const nameSpan = document.createElement("span");
      nameSpan.className = "popover-row-name";
      nameSpan.textContent = file;
      btn.appendChild(nameSpan);

      btn.addEventListener("click", () => {
        const val = input.value;
        const lastAt = val.lastIndexOf("@");
        if (lastAt !== -1) {
          input.value = val.substring(0, lastAt) + "@" + file + " ";
          input.focus();
          autoGrowTextarea(input);
          hideMentionPopover();
        }
      });
      mentionList.appendChild(btn);
    });
  }

  // Slash Command Popover
  const slashPopover = $("chat-slash-popover");
  const slashList = $("slash-popover-list");
  let slashActiveIndex = 0;
  let currentSlashCommands = [];

  function hideSlashPopover() {
    if (slashPopover) slashPopover.setAttribute("hidden", "");
  }

  function selectSlashCommand(cmd) {
    input.value = cmd.insert;
    autoGrowTextarea(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    hideSlashPopover();
  }

  function renderSlashPopover(cmds) {
    if (!slashList) return;
    slashList.innerHTML = "";
    currentSlashCommands = cmds;
    if (cmds.length === 0) {
      slashList.innerHTML =
        '<div style="padding:10px 12px;color:var(--text-dim);font-size:12px;">No matching commands</div>';
      return;
    }
    cmds.forEach((cmd, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "slash-cmd-item" + (index === slashActiveIndex ? " active" : "");
      btn.innerHTML = `
        <span class="slash-cmd-icon">${cmd.icon}</span>
        <div class="slash-cmd-body">
          <div class="slash-cmd-header">
            <span class="slash-cmd-name">${cmd.name}</span>
            ${cmd.syntax ? `<span class="slash-cmd-syntax">${cmd.syntax}</span>` : ""}
          </div>
          <div class="slash-cmd-desc">${cmd.desc}</div>
        </div>
      `;
      btn.addEventListener("click", () => {
        selectSlashCommand(cmd);
      });
      btn.addEventListener("mouseenter", () => {
        slashActiveIndex = index;
        const allItems = slashList.querySelectorAll(".slash-cmd-item");
        allItems.forEach((it, idx) => {
          if (idx === slashActiveIndex) it.classList.add("active");
          else it.classList.remove("active");
        });
      });
      slashList.appendChild(btn);
    });
  }

  input.addEventListener("input", async () => {
    autoGrowTextarea(input);
    const val = input.value;

    // Check slash command trigger
    if (val.startsWith("/") && !val.includes(" ")) {
      const query = val.slice(1).toLowerCase();
      const filtered = SLASH_COMMANDS.filter(
        c => c.name.slice(1).toLowerCase().includes(query) ||
             c.desc.toLowerCase().includes(query)
      );
      slashActiveIndex = 0;
      closeAllPopovers(slashPopover);
      renderSlashPopover(filtered);
      if (slashPopover) {
        slashPopover.removeAttribute("hidden");
        positionPopover(slashPopover, $("chat-mention-btn") || input);
      }
      hideMentionPopover();
      return;
    } else {
      hideSlashPopover();
    }

    // Mention @ logic
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1 && mentionPopover) {
      const afterAt = val.substring(lastAt + 1);
      if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
        const term = afterAt.toLowerCase();
        // Use the full project file tree
        await loadProjectFilesForMention(term);
        // Update the search input in the popover
        const searchInput = $("mention-search-input");
        if (searchInput) searchInput.value = afterAt;
        mentionActiveIndex = 0;
        closeAllPopovers(mentionPopover);
        mentionPopover.removeAttribute("hidden");
        positionPopover(mentionPopover, $("chat-mention-btn"));
      } else {
        hideMentionPopover();
      }
    } else {
      hideMentionPopover();
    }
  });

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    // Handle Slash Popover Key Navigation
    if (slashPopover && !slashPopover.hasAttribute("hidden")) {
      const items = slashList.querySelectorAll(".slash-cmd-item");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (currentSlashCommands.length > 0) {
          slashActiveIndex = (slashActiveIndex + 1) % currentSlashCommands.length;
          renderSlashPopover(currentSlashCommands);
          if (items[slashActiveIndex]) items[slashActiveIndex].scrollIntoView({ block: "nearest" });
        }
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (currentSlashCommands.length > 0) {
          slashActiveIndex =
            (slashActiveIndex - 1 + currentSlashCommands.length) %
            currentSlashCommands.length;
          renderSlashPopover(currentSlashCommands);
          if (items[slashActiveIndex]) items[slashActiveIndex].scrollIntoView({ block: "nearest" });
        }
        return;
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (currentSlashCommands[slashActiveIndex]) {
          selectSlashCommand(currentSlashCommands[slashActiveIndex]);
        }
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideSlashPopover();
        return;
      }
    }

    // Handle Mention Popover Key Navigation
    if (mentionPopover && !mentionPopover.hasAttribute("hidden")) {
      const items = mentionList.querySelectorAll(".chat-popover-item");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mentionActiveIndex =
          (mentionActiveIndex + 1) % currentMentionFiles.length;
        renderMentionPopover(currentMentionFiles);
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        mentionActiveIndex =
          (mentionActiveIndex - 1 + currentMentionFiles.length) %
          currentMentionFiles.length;
        renderMentionPopover(currentMentionFiles);
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[mentionActiveIndex]) {
          items[mentionActiveIndex].click();
        }
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideMentionPopover();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  });
  autoGrowTextarea(input);

  $("chat-new-btn").addEventListener("click", () => {
    Chat.newChat();
    Chat.toggleHistoryPanel(false);
    input.focus();
  });
  $("chat-clear").addEventListener("click", () => Chat.clearActive());
  const historyBtn = $("chat-history-btn");
  const historyPanel = $("chat-history-panel");
  historyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    Chat.toggleHistoryPanel();
  });
  $("chat-history-close").addEventListener("click", (e) => {
    e.stopPropagation();
    Chat.toggleHistoryPanel(false);
  });
  document.addEventListener("click", (e) => {
    if (historyPanel.hasAttribute("hidden")) return;
    if (historyPanel.contains(e.target)) return;
    if (historyBtn.contains(e.target)) return;
    Chat.toggleHistoryPanel(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !historyPanel.hasAttribute("hidden")) {
      Chat.toggleHistoryPanel(false);
    }
  });

  // Header inline rename
  const chatNameEl = $("chat-name");
  const chatRenameBtn = $("chat-rename-btn");
  function startHeaderRename() {
    const id = Chat.getActiveId();
    const c = Chat.getActive();
    if (!id || !c) return;
    if (chatNameEl.dataset.editing === "1") return;
    chatNameEl.dataset.editing = "1";
    const original = c.title;
    chatNameEl.contentEditable = "true";
    chatNameEl.classList.add("editing");
    chatNameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(chatNameEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      chatNameEl.contentEditable = "false";
      chatNameEl.classList.remove("editing");
      delete chatNameEl.dataset.editing;
      if (commit) Chat.renameChat(id, chatNameEl.textContent);
      else chatNameEl.textContent = original;
      chatNameEl.removeEventListener("keydown", onKey);
      chatNameEl.removeEventListener("blur", onBlur);
    };
    const onKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        chatNameEl.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    chatNameEl.addEventListener("keydown", onKey);
    chatNameEl.addEventListener("blur", onBlur);
  }
  chatNameEl.addEventListener("click", startHeaderRename);
  chatNameEl.addEventListener("dblclick", startHeaderRename);
  if (chatRenameBtn) chatRenameBtn.addEventListener("click", startHeaderRename);

  // Suggestion buttons in empty state
  document.querySelectorAll(".chat-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prompt =
        btn.dataset.prompt ||
        btn.querySelector(".suggestion-text")?.textContent ||
        "";
      input.value = prompt;
      autoGrowTextarea(input);
      input.focus();
    });
  });

  // Mode popover
  const modeBtn = $("chat-mode-btn");
  const modePop = $("chat-mode-popover");
  modeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllPopovers(modePop);
    if (modePop.hasAttribute("hidden")) {
      modePop.removeAttribute("hidden");
      positionPopover(modePop, modeBtn);
    } else {
      modePop.setAttribute("hidden", "");
    }
  });
  modePop.querySelectorAll(".chat-popover-item").forEach((item) => {
    item.addEventListener("click", () => {
      const mode = item.dataset.mode;
      setChatMode(mode);
      modePop.setAttribute("hidden", "");
    });
  });

  // Model popover
  const modelBtn = $("chat-model-btn");
  const modelPop = $("chat-model-popover");
  modelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllPopovers(modelPop);
    if (modelPop.hasAttribute("hidden")) {
      modelPop.removeAttribute("hidden");
      positionPopover(modelPop, modelBtn);
    } else {
      modelPop.setAttribute("hidden", "");
    }
  });
  modelPop.querySelectorAll(".chat-popover-item").forEach((item) => {
    item.addEventListener("click", () => {
      const model = item.dataset.model;
      const label =
        item.dataset.label ||
        item.querySelector(".popover-row-name")?.textContent;
      setChatModel(model, label);
      modelPop.setAttribute("hidden", "");
    });
  });

  document.addEventListener("click", () => closeAllPopovers());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllPopovers();
  });

  // Restore saved selections
  const savedMode = localStorage.getItem("buildex.chatMode") || "agent";
  setChatMode(savedMode);
  const savedModel = localStorage.getItem("buildex.chatModel") || "codementor";
  const savedModelLabel =
    localStorage.getItem("buildex.chatModelLabel") || "CodeMentor";
  setChatModel(savedModel, savedModelLabel);

  // Attach context: insert active file as a chip
  $("chat-attach-btn").addEventListener("click", () => {
    const meta = state.activeFile && state.openFiles.get(state.activeFile);
    const name = meta ? meta.name : null;
    if (!name) {
      showToast("No active file to attach", "info", 1500);
      return;
    }
    const tag = `[📄 ${name}]`;
    state.contextSnippets = state.contextSnippets || {};
    state.contextSnippets[tag] = `\n\n[Context attached: ${name}]\n`;
    renderContextChips();

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const before = input.value.substring(0, start);
    const after = input.value.substring(end);
    const space = before.endsWith(" ") || before.length === 0 ? "" : " ";
    input.value = before + space + tag + " " + after;

    const newPos = before.length + space.length + tag.length + 1;
    input.focus();
    input.setSelectionRange(newPos, newPos);
    autoGrowTextarea(input);
  });

  // Mention button: show file picker popover
  const mentionBtn = $("chat-mention-btn");
  mentionBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    input.value += (input.value && !input.value.endsWith(" ") ? " " : "") + "@";
    input.focus();
    autoGrowTextarea(input);
    // Trigger file tree popover
    await loadProjectFilesForMention("");
    closeAllPopovers(mentionPopover);
    mentionPopover.removeAttribute("hidden");
    positionPopover(mentionPopover, mentionBtn);
  });

  if (mentionPopover) {
    mentionPopover.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  // Search input inside mention popover
  const mentionSearchInput = $("mention-search-input");
  if (mentionSearchInput) {
    mentionSearchInput.addEventListener("input", async () => {
      const term = mentionSearchInput.value.trim().toLowerCase();
      await loadProjectFilesForMention(term);
    });
    mentionSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideMentionPopover();
        input.focus();
      }
    });
  }

  // Image upload button
  const imageBtn = $("chat-image-btn");
  const imageInput = $("chat-image-input");
  if (imageBtn && imageInput) {
    imageBtn.addEventListener("click", () => imageInput.click());
    imageInput.addEventListener("change", (e) => {
      handleImageFiles(Array.from(e.target.files));
      imageInput.value = "";
    });
  }

  // Drag and drop images on chat composer
  const composer = document.querySelector(".chat-composer");
  const dropZone = $("chat-drop-zone");
  if (composer && dropZone) {
    let dragCounter = 0;
    composer.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragCounter++;
      if (hasImageFiles(e.dataTransfer)) {
        dropZone.style.display = "flex";
      }
    });
    composer.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropZone.style.display = "none";
      }
    });
    composer.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    composer.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropZone.style.display = "none";
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length > 0) {
        handleImageFiles(files);
      }
    });
  }

  // Clipboard paste images
  input.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((i) => i.type.startsWith("image/"));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map((i) => i.getAsFile()).filter(Boolean);
      handleImageFiles(files);
    }
  });
}

function setChatMode(mode) {
  if (!mode) return;
  state.chatMode = mode;
  localStorage.setItem("buildex.chatMode", mode);
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);
  $("chat-mode-label").textContent = label;
  $("chat-mode-btn").querySelector(".pill-dot").dataset.modeStyle = mode;
  document
    .querySelectorAll("#chat-mode-popover .chat-popover-item")
    .forEach((it) => {
      it.classList.toggle("active", it.dataset.mode === mode);
    });
  const placeholders = {
    learn: "Step-by-step — what do you want to learn?",
    explain: "Paste or @-mention code to explain…",
    debug: "Describe the bug or paste an error…",
    agent: "Plan, search, build anything…",
  };
  $("chat-input").placeholder = placeholders[mode] || "Ask BuildeX…";
}

function setChatModel(model, label) {
  if (!model) return;
  state.chatModel = model;
  localStorage.setItem("buildex.chatModel", model);
  if (label) {
    localStorage.setItem("buildex.chatModelLabel", label);
    $("chat-model-label").textContent = label;
  }
  document
    .querySelectorAll("#chat-model-popover .chat-popover-item")
    .forEach((it) => {
      it.classList.toggle("active", it.dataset.model === model);
    });
}

function positionPopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.bottom = window.innerHeight - rect.top + 6 + "px";
  popover.style.left = rect.left + "px";
  popover.style.right = "auto";
  popover.style.top = "auto";
  // Keep within window
  setTimeout(() => {
    const pr = popover.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      popover.style.left = "auto";
      popover.style.right = "12px";
    }
  }, 0);
}

function closeAllPopovers(except) {
  for (const id of [
    "chat-mode-popover",
    "chat-model-popover",
    "chat-mention-popover",
    "chat-slash-popover",
    "chat-context-popover",
    "settings-menu-popover",
  ]) {
    const el = $(id);
    if (el && el !== except) el.setAttribute("hidden", "");
  }
}

/* -------------------- Layout Toggles -------------------- */
function toggleEl(id) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle("hidden");
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
    fitActiveTerminal();
  }, 50);
}

/* -------------------- Utilities -------------------- */
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* -------------------- Bottom Panel switching -------------------- */
function switchPanel(name) {
  state.activePanel = name;
  document.querySelectorAll(".terminal-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.panel === name);
  });
  document.querySelectorAll(".panel-view").forEach((v) => {
    v.classList.toggle("active", v.dataset.panel === name);
  });

  if (name === "terminal") {
    setTimeout(() => {
      const inst = activeTerminal();
      if (inst) {
        inst.fit();
        try {
          inst.term.focus();
        } catch (_) {}
      }
    }, 30);
  } else if (name === "ports") {
    if (!Ports.loadedOnce) refreshPorts();
  } else if (name === "debug") {
    setTimeout(() => $("debug-input")?.focus(), 30);
  }
}

function setupPanelTabs() {
  document.querySelectorAll(".terminal-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const panel = tab.dataset.panel;
      if (panel) switchPanel(panel);
    });
  });
}

/* -------------------- Problems panel -------------------- */
const Problems = (() => {
  let scheduled = false;

  function refresh() {
    if (!monacoLoaded) return;
    const list = $("problems-list");
    const empty = $("problems-empty");
    const badge = $("problems-badge");
    if (!list) return;
    list.innerHTML = "";

    const all = [];
    monaco.editor.getModels().forEach((model) => {
      const filePath = state.modelPathById.get(model.id);
      if (!filePath) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      for (const m of markers) all.push({ filePath, marker: m });
    });

    all.sort((a, b) => {
      if (a.marker.severity !== b.marker.severity)
        return b.marker.severity - a.marker.severity;
      const an = (state.openFiles.get(a.filePath) || { name: a.filePath }).name;
      const bn = (state.openFiles.get(b.filePath) || { name: b.filePath }).name;
      if (an !== bn) return an.localeCompare(bn);
      return a.marker.startLineNumber - b.marker.startLineNumber;
    });

    let errors = 0;
    let warnings = 0;
    for (const { filePath, marker } of all) {
      const meta = state.openFiles.get(filePath) || {
        name: filePath.split("/").pop(),
      };
      const sevClass =
        marker.severity >= 8 ? "error" : marker.severity >= 4 ? "warn" : "info";
      const sevLabel =
        sevClass === "error" ? "!" : sevClass === "warn" ? "!" : "i";
      if (sevClass === "error") errors++;
      else if (sevClass === "warn") warnings++;

      const item = document.createElement("div");
      item.className = "problem-item";
      item.innerHTML = `
        <span class="problem-icon ${sevClass}">${sevLabel}</span>
        <div class="problem-text">${escapeHtml(marker.message)}</div>
        <div class="problem-location">${escapeHtml(meta.name)}:${marker.startLineNumber}:${marker.startColumn}</div>
      `;
      item.addEventListener("click", () => {
        if (state.openFiles.has(filePath)) {
          setActiveFile(filePath);
          setTimeout(() => {
            if (!editor) return;
            editor.revealLineInCenter(marker.startLineNumber);
            editor.setPosition({
              lineNumber: marker.startLineNumber,
              column: marker.startColumn,
            });
            editor.focus();
          }, 30);
        }
      });
      list.appendChild(item);
    }

    const total = all.length;
    if (total > 0) {
      empty.style.display = "none";
      badge.textContent = String(total);
      badge.classList.add("visible");
    } else {
      empty.style.display = "";
      badge.textContent = "";
      badge.classList.remove("visible");
    }
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      refresh();
    }, 100);
  }

  function attach() {
    if (!monacoLoaded || !window.monaco) return;
    monaco.editor.onDidChangeMarkers(scheduleRefresh);
    refresh();
  }

  return { attach, refresh };
})();

/* -------------------- Output panel -------------------- */
const Output = (() => {
  /** @type {Map<string, Array<{time:string,message:string,level:string}>>} */
  const channels = new Map();
  let active = "BuildeX";
  const MAX_LINES = 1000;

  function ensure(name) {
    if (!channels.has(name)) {
      channels.set(name, []);
      const select = $("output-channel");
      if (select && !Array.from(select.options).find((o) => o.value === name)) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      }
    }
  }

  function log(channel, message, level = "info") {
    ensure(channel);
    const lines = channels.get(channel);
    lines.push({ time: timestamp(), message: String(message), level });
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    if (channel === active) render();
  }

  function render() {
    const log = $("output-log");
    if (!log) return;
    log.innerHTML = "";
    const lines = channels.get(active) || [];
    if (lines.length === 0) {
      log.innerHTML = `<div class="log-line muted">[${active}] no output yet.</div>`;
      return;
    }
    for (const { time, message, level } of lines) {
      const div = document.createElement("div");
      div.className = `log-line ${level}`;
      div.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }

  function setActive(name) {
    active = name;
    render();
  }

  function clearActive() {
    if (channels.has(active)) channels.set(active, []);
    render();
  }

  function init() {
    ensure("BuildeX");
    ensure("Files");
    ensure("Terminal");
    const select = $("output-channel");
    if (select) {
      select.value = active;
      select.addEventListener("change", (e) => setActive(e.target.value));
    }
    render();
  }

  return { init, log, render, setActive, clearActive, ensure };
})();

/* -------------------- Debug Console panel -------------------- */
const DebugConsole = (() => {
  const history = [];
  let historyIdx = -1;
  let installed = false;

  function append(text, level = "info", prefix = "") {
    const log = $("debug-log");
    if (!log) return;
    const div = document.createElement("div");
    div.className = `log-line ${level}`;
    div.innerHTML =
      (prefix ? `<span class="log-prefix">${prefix}</span>` : "") +
      escapeHtml(text);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function formatResult(r) {
    if (r === undefined) return "undefined";
    if (r === null) return "null";
    if (typeof r === "string") return JSON.stringify(r);
    if (typeof r === "function") return r.toString();
    if (typeof r === "object") {
      try {
        return JSON.stringify(r, null, 2);
      } catch {
        return String(r);
      }
    }
    return String(r);
  }

  function evalExpr(expr) {
    append(expr, "info", "›");
    try {
      // Indirect eval to get global scope. eslint-disable-next-line no-eval
      const result = (0, eval)(expr);
      if (result && typeof result.then === "function") {
        result
          .then((v) => append(formatResult(v), "muted", "←"))
          .catch((err) =>
            append(String(err && err.stack ? err.stack : err), "error"),
          );
      } else {
        append(formatResult(result), "muted", "←");
      }
    } catch (err) {
      append(String(err && err.stack ? err.stack : err), "error");
    }
  }

  function init() {
    if (installed) return;
    installed = true;

    // Forward console.* into the Debug Console panel as well as DevTools.
    ["log", "info", "warn", "error", "debug"].forEach((method) => {
      const orig = console[method].bind(console);
      console[method] = (...args) => {
        orig(...args);
        const text = args
          .map((a) => {
            if (a instanceof Error) return a.stack || a.message;
            if (typeof a === "object") {
              try {
                return JSON.stringify(a, null, 2);
              } catch {
                return String(a);
              }
            }
            return String(a);
          })
          .join(" ");
        const level =
          method === "error"
            ? "error"
            : method === "warn"
              ? "warn"
              : method === "debug"
                ? "muted"
                : "info";
        append(text, level);
      };
    });

    append(
      "Debug Console — JavaScript expressions are evaluated in the renderer context.",
      "muted",
    );

    const input = $("debug-input");
    if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const expr = input.value;
        if (!expr.trim()) return;
        history.push(expr);
        historyIdx = history.length;
        input.value = "";
        evalExpr(expr);
      } else if (e.key === "ArrowUp") {
        if (historyIdx > 0) {
          historyIdx -= 1;
          input.value = history[historyIdx];
          e.preventDefault();
        }
      } else if (e.key === "ArrowDown") {
        if (historyIdx < history.length) {
          historyIdx += 1;
          input.value = history[historyIdx] || "";
          e.preventDefault();
        }
      } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
        $("debug-log").innerHTML = "";
        e.preventDefault();
      }
    });
  }

  return { init, append, evalExpr };
})();

/* -------------------- Ports panel -------------------- */
const Ports = {
  loadedOnce: false,
};

async function refreshPorts() {
  const list = $("ports-list");
  const badge = $("ports-badge");
  if (!list) return;
  Ports.loadedOnce = true;
  list.innerHTML = '<div class="panel-empty">Loading forwarded ports…</div>';
  try {
    const ports = await window.electronAPI.getForwardedPorts();
    list.innerHTML = "";
    if (!ports || ports.length === 0) {
      list.innerHTML = `
        <div class="panel-empty">
          No forwarded ports. Forward a port to access your locally running services over the internet.<br><br>
          <button class="primary-btn" id="ports-forward-empty-btn-dynamic">Forward a Port</button>
        </div>
      `;
      $("ports-forward-empty-btn-dynamic")?.addEventListener(
        "click",
        promptForwardPort,
      );
      badge.textContent = "";
      badge.classList.remove("visible");
      return;
    }
    badge.textContent = String(ports.length);
    badge.classList.add("visible");
    for (const p of ports) {
      const row = document.createElement("div");
      row.className = "port-row";
      row.innerHTML = `
        <a class="port-num" title="Open in browser">${p.port}</a>
        <div class="port-addr" style="flex: 1;"><a href="${escapeHtml(p.url)}" target="_blank">${escapeHtml(p.url)}</a></div>
        <button class="ghost-btn small port-stop-btn" data-port="${p.port}">Stop</button>
      `;
      row.querySelector(".port-num").addEventListener("click", () => {
        window.electronAPI.openExternal(`http://localhost:${p.port}`);
      });
      row.querySelector(".port-addr a").addEventListener("click", (e) => {
        e.preventDefault();
        window.electronAPI.openExternal(p.url);
      });
      row
        .querySelector(".port-stop-btn")
        .addEventListener("click", async () => {
          await window.electronAPI.unforwardPort(p.port);
          refreshPorts();
        });
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div class="panel-empty">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function promptForwardPort() {
  const portStr = await customPrompt("Port to forward (e.g. 3000):");
  if (!portStr) return;
  const port = parseInt(portStr.trim(), 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    return showToast("Invalid port number", "error");
  }
  showToast(`Starting tunnel on port ${port}...`);
  $("ports-list").innerHTML =
    '<div class="panel-empty">Forwarding port...</div>';
  const res = await window.electronAPI.forwardPort(port);
  if (res.ok) {
    showToast(`Port ${port} forwarded successfully!`, "success");
  } else {
    showToast(`Failed: ${res.error}`, "error");
  }
  refreshPorts();
}

/* -------------------- Wire-up UI -------------------- */
function setupUI() {
  $("open-folder-side").addEventListener("click", openFolderFlow);
  $("open-folder-empty")?.addEventListener("click", openFolderFlow);
  $("welcome-open-folder").addEventListener("click", openFolderFlow);
  $("welcome-open-file").addEventListener("click", openFileFlow);
  $("welcome-new-file").addEventListener("click", newUntitledFile);

  $("toggle-sidebar").addEventListener("click", () => toggleEl("sidebar"));
  $("toggle-terminal").addEventListener("click", () =>
    toggleEl("terminal-container"),
  );
  $("toggle-chatbot").addEventListener("click", () =>
    toggleEl("chatbot-container"),
  );

  // Window controls
  if (window.electronAPI && window.electronAPI.windowControl) {
    const minBtn = $("win-min");
    const maxBtn = $("win-max");
    const closeBtn = $("win-close");
    const maxIcon = $("win-max-icon");
    const restoreIcon = $("win-restore-icon");

    const updateMaxIcon = (isMax) => {
      if (maxIcon && restoreIcon) {
        maxIcon.style.display = isMax ? "none" : "block";
        restoreIcon.style.display = isMax ? "block" : "none";
      }
      if (maxBtn) {
        maxBtn.title = isMax ? "Restore Down" : "Maximize";
        maxBtn.setAttribute("aria-label", isMax ? "Restore Down" : "Maximize");
      }
    };

    if (minBtn) {
      minBtn.addEventListener("click", () =>
        window.electronAPI.windowControl("minimize"),
      );
    }
    if (maxBtn) {
      maxBtn.addEventListener("click", () =>
        window.electronAPI.windowControl("maximize"),
      );
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () =>
        window.electronAPI.windowControl("close"),
      );
    }

    if (window.electronAPI.onMaximizedChange) {
      window.electronAPI.onMaximizedChange((isMax) => updateMaxIcon(isMax));
    }
    if (window.electronAPI.isMaximized) {
      window.electronAPI.isMaximized().then((isMax) => updateMaxIcon(isMax));
    }

    // Double-click titlebar to maximize / restore
    const titlebarEl = $("titlebar");
    if (titlebarEl) {
      titlebarEl.addEventListener("dblclick", (e) => {
        if (!e.target.closest("button, input, a, .titlebar-section.right, .titlebar-window-controls")) {
          window.electronAPI.windowControl("maximize");
        }
      });
    }
  }

  // Load Custom ML Models from .env
  async function loadCustomModels() {
    if (!window.electronAPI || !window.electronAPI.getEnvVars) return;
    const env = await window.electronAPI.getEnvVars();
    const customModels = [];

    // Look for pairs like CUSTOM_MODEL_1_NAME, CUSTOM_MODEL_1_URL, CUSTOM_MODEL_1_ID
    for (const key of Object.keys(env)) {
      if (key.startsWith("CUSTOM_MODEL_") && key.endsWith("_NAME")) {
        const idStr = key.replace("CUSTOM_MODEL_", "").replace("_NAME", "");
        const urlKey = `CUSTOM_MODEL_${idStr}_URL`;
        const modelIdKey = `CUSTOM_MODEL_${idStr}_ID`;
        if (env[urlKey]) {
          customModels.push({
            name: env[key],
            url: env[urlKey],
            modelId: env[modelIdKey] || "default",
          });
        }
      }
    }

    // Skip .env rows that duplicate the built-in picker (already under Local).
    const builtInPopoverNames = new Set(
      ["codementor"].map((s) => s.toLowerCase()),
    );
    const deduped = customModels.filter((m) => {
      const nm = String(m.name || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!nm) return false;
      return !builtInPopoverNames.has(nm);
    });

    if (deduped.length > 0) {
      const popover = $("chat-model-popover");
      const section = document.createElement("div");
      section.className = "popover-section custom-model-section";
      section.textContent = "From .env";
      popover.appendChild(section);

      for (const m of deduped) {
        const btn = document.createElement("button");
        btn.className = "chat-popover-item compact custom-model-item";
        btn.dataset.model = `CUSTOM|${m.url}|${m.modelId}`;
        btn.dataset.label = m.name;
        btn.innerHTML = `<span class="popover-row-name">${m.name}</span><span class="popover-row-tag">Local</span>`;
        btn.addEventListener("click", () => {
          setChatModel(btn.dataset.model, btn.dataset.label);
          popover.setAttribute("hidden", "");
        });
        popover.appendChild(btn);
      }
    }
  }
  loadCustomModels();

  // Theme toggle
  const THEMES = ["dark", "light", "ocean", "dracula", "monokai"];
  syncThemeIcon();
  $("theme-toggle").addEventListener("click", () => {
    const currentIndex = THEMES.indexOf(state.theme) || 0;
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setTheme(THEMES[nextIndex]);
  });

  $("new-file-btn").addEventListener("click", async () => {
    if (!state.workspaceRoot) {
      newUntitledFile();
      return;
    }
    const dir = state.selectedDirPath || state.workspaceRoot;
    const name = await customPrompt("New file name:");
    if (name && name.trim()) {
      const r = await window.electronAPI.createFile(dir, name.trim());
      if (r.ok) {
        state.expandedDirs.add(dir);
        state.treeChildren.delete(dir);
        await renderTree();
        await openFile(r.path, name.trim());
      } else showToast(r.error || "Failed", "error");
    }
  });

  $("new-folder-btn").addEventListener("click", async () => {
    if (!state.workspaceRoot) {
      showToast("Open a folder first.", "error");
      return;
    }
    const dir = state.selectedDirPath || state.workspaceRoot;
    const name = await customPrompt("New folder name:");
    if (name && name.trim()) {
      const r = await window.electronAPI.createFolder(dir, name.trim());
      if (r.ok) {
        state.expandedDirs.add(dir);
        state.treeChildren.delete(dir);
        await renderTree();
      } else showToast(r.error || "Failed", "error");
    }
  });

  $("refresh-btn").addEventListener("click", () => {
    refreshTree();
    showToast("Refreshed");
  });
  $("collapse-btn").addEventListener("click", () => {
    state.expandedDirs = new Set([state.workspaceRoot]);
    renderTree();
  });

  setupPanelTabs();
  $("ports-forward-btn")?.addEventListener("click", promptForwardPort);
  $("ports-forward-empty-btn")?.addEventListener("click", promptForwardPort);

  $("panel-action-clear").addEventListener("click", () => {
    if (state.activePanel === "terminal") {
      const inst = activeTerminal();
      if (inst) {
        inst.term.write("\x1b[2J\x1b[H");
        window.electronAPI.execTerminal(inst.id, "");
      }
    } else if (state.activePanel === "output") {
      Output.clearActive();
    } else if (state.activePanel === "debug") {
      $("debug-log").innerHTML = "";
    } else if (state.activePanel === "problems") {
      // Markers are managed by Monaco; just refresh.
      Problems.refresh();
    } else if (state.activePanel === "ports") {
      refreshPorts();
    }
  });
  $("terminal-close").addEventListener("click", () =>
    toggleEl("terminal-container"),
  );

  // Activity bar
  document.querySelectorAll(".activity-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (!view) return;
      const sidebar = $("sidebar");
      // Toggle: clicking the active view hides the sidebar
      if (state.activeView === view && !sidebar.classList.contains("hidden")) {
        sidebar.classList.add("hidden");
        return;
      }
      sidebar.classList.remove("hidden");
      setActiveView(view);
    });
  });

  // Settings Dropdown Popover
  const settingsBtn = $("activity-settings-btn");
  const topSettingsBtn = $("open-settings-btn");
  const settingsPop = $("settings-menu-popover");

  function toggleSettingsMenu(anchor) {
    if (!settingsPop || !anchor) return;
    const isHidden = settingsPop.hasAttribute("hidden");
    closeAllPopovers(settingsPop);
    if (isHidden) {
      settingsPop.removeAttribute("hidden");
      const rect = anchor.getBoundingClientRect();
      if (anchor === settingsBtn) {
        settingsPop.style.position = "fixed";
        settingsPop.style.bottom = (window.innerHeight - rect.top + 6) + "px";
        settingsPop.style.left = (rect.right + 6) + "px";
        settingsPop.style.top = "auto";
        settingsPop.style.right = "auto";
      } else {
        settingsPop.style.position = "fixed";
        settingsPop.style.top = (rect.bottom + 6) + "px";
        settingsPop.style.right = (window.innerWidth - rect.right) + "px";
        settingsPop.style.bottom = "auto";
        settingsPop.style.left = "auto";
      }
    } else {
      settingsPop.setAttribute("hidden", "");
    }
  }

  settingsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSettingsMenu(settingsBtn);
  });

  topSettingsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSettingsMenu(topSettingsBtn);
  });

  settingsPop?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  $("settings-profile-btn")?.addEventListener("click", () => {
    settingsPop?.setAttribute("hidden", "");
    if (typeof AuthManager !== "undefined") {
      if (AuthManager.getCurrentUser()) {
        AuthManager.showAccountModal();
      } else {
        AuthManager.showOnboarding();
      }
    }
  });

  $("settings-logout-btn")?.addEventListener("click", () => {
    settingsPop?.setAttribute("hidden", "");
    if (typeof AuthManager !== "undefined") {
      AuthManager.clearSession();
      showToast("Logged out successfully.", "info", 2000);
      AuthManager.showOnboarding();
    }
  });

  // Dedicated Settings Modals Controller
  const settingsModals = (() => {
    // 1. Quick Settings
    const qsModal = $("quick-settings-modal");
    const qsClose = $("quick-settings-close");
    const qsDone = $("quick-settings-done");
    const qsModelSelect = $("qs-ai-model-select");
    const qsTempSlider = $("qs-temperature-slider");
    const qsTempVal = $("qs-temperature-val");
    const qsFontSize = $("qs-font-size-select");
    const qsWordWrap = $("qs-word-wrap-toggle");
    const qsMinimap = $("qs-minimap-toggle");
    const qsLineNumbers = $("qs-linenumbers-toggle");

    function openQuickSettings() {
      if (!qsModal) return;
      if (qsModelSelect) {
        qsModelSelect.value = state.chatModel || localStorage.getItem("buildex.chatModel") || "codementor";
      }
      const currentTemp = localStorage.getItem("buildex.chatTemperature") || "0.6";
      if (qsTempSlider) qsTempSlider.value = currentTemp;
      if (qsTempVal) qsTempVal.textContent = currentTemp;

      const currentFont = localStorage.getItem("buildex.fontSize") || "14";
      if (qsFontSize) qsFontSize.value = currentFont;

      const currentWordWrap = localStorage.getItem("buildex.wordWrap") !== "false";
      if (qsWordWrap) qsWordWrap.checked = currentWordWrap;

      const currentMinimap = localStorage.getItem("buildex.minimap") === "true";
      if (qsMinimap) qsMinimap.checked = currentMinimap;

      const currentLineNumbers = localStorage.getItem("buildex.lineNumbers") !== "false";
      if (qsLineNumbers) qsLineNumbers.checked = currentLineNumbers;

      qsModal.style.display = "flex";
    }

    function closeQuickSettings() {
      if (qsModal) qsModal.style.display = "none";
    }

    qsClose?.addEventListener("click", closeQuickSettings);
    qsDone?.addEventListener("click", closeQuickSettings);
    qsModal?.addEventListener("click", (e) => {
      if (e.target.id === "quick-settings-modal") closeQuickSettings();
    });

    qsModelSelect?.addEventListener("change", (e) => {
      const model = e.target.value;
      const optText = e.target.options[e.target.selectedIndex]?.text || model;
      if (typeof setChatModel === "function") {
        setChatModel(model, optText);
      }
      showToast(`🤖 Default AI Model set to ${optText}`, "info", 1800);
    });

    qsTempSlider?.addEventListener("input", (e) => {
      const val = e.target.value;
      if (qsTempVal) qsTempVal.textContent = val;
      localStorage.setItem("buildex.chatTemperature", val);
    });

    qsFontSize?.addEventListener("change", (e) => {
      const size = parseInt(e.target.value, 10) || 14;
      localStorage.setItem("buildex.fontSize", String(size));
      if (editor) editor.updateOptions({ fontSize: size });
      showToast(`Font size set to ${size}px`, "info", 1500);
    });

    qsWordWrap?.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      localStorage.setItem("buildex.wordWrap", String(enabled));
      if (editor) editor.updateOptions({ wordWrap: enabled ? "on" : "off" });
      showToast(`Word wrap ${enabled ? "enabled" : "disabled"}`, "info", 1500);
    });

    qsMinimap?.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      localStorage.setItem("buildex.minimap", String(enabled));
      if (editor) editor.updateOptions({ minimap: { enabled } });
      showToast(`Minimap ${enabled ? "shown" : "hidden"}`, "info", 1500);
    });

    qsLineNumbers?.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      localStorage.setItem("buildex.lineNumbers", String(enabled));
      if (editor) editor.updateOptions({ lineNumbers: enabled ? "on" : "off" });
      showToast(`Line numbers ${enabled ? "shown" : "hidden"}`, "info", 1500);
    });

    // 2. Updates Modal & In-App Update Engine
    const updatesModal = $("updates-modal");
    const updatesClose = $("updates-close");
    const updatesCheckAgain = $("updates-check-again");
    const updatesActionBtn = $("updates-action-btn") || $("updates-changelog-btn");
    const updateCheckingBox = $("update-checking-state");
    const updateResultBox = $("update-result-state");
    const updateResultIcon = $("update-result-icon");
    const updateResultTitle = $("update-result-title");
    const updateResultDesc = $("update-result-desc");
    const updateInstalledVer = $("update-installed-ver");
    const updateRemoteVer = $("update-remote-ver");
    const updateNotesRow = $("update-notes-row");
    const updateNotesText = $("update-notes-text");
    const updateHeaderBadge = $("update-header-badge");

    // Floating Update Toast
    const updateToast = $("app-update-banner");
    const toastUpdateVer = $("toast-update-version");
    const toastUpdateSub = $("toast-update-sub");
    const toastUpdateBtn = $("toast-update-btn");
    const toastUpdateDismiss = $("toast-update-dismiss");

    let currentUpdateUrl = "https://buildexide.dev/#download";
    let hasAvailableUpdate = false;

    function renderUpdateState(data) {
      if (!data) return;
      if (updateCheckingBox) updateCheckingBox.style.display = "none";
      if (updateResultBox) updateResultBox.style.display = "flex";

      if (data.currentVersion && updateInstalledVer) {
        updateInstalledVer.textContent = `v${data.currentVersion}`;
      }
      if (data.latestVersion && updateRemoteVer) {
        updateRemoteVer.textContent = `v${data.latestVersion}`;
      }

      if (data.hasUpdate) {
        hasAvailableUpdate = true;
        currentUpdateUrl = data.downloadUrl || "https://buildexide.dev/#download";

        if (updateResultIcon) {
          updateResultIcon.textContent = "⚡";
          updateResultIcon.style.color = "#3b82f6";
          updateResultIcon.style.borderColor = "#3b82f6";
          updateResultIcon.style.background = "rgba(59, 130, 246, 0.15)";
        }
        if (updateHeaderBadge) updateHeaderBadge.textContent = "🚀";
        if (updateResultTitle) updateResultTitle.textContent = `New Update Available: v${data.latestVersion}`;
        if (updateResultDesc) {
          updateResultDesc.textContent = `A newer release of BuildeX Coder IDE is available for your platform. Upgrade now to get the latest Bedrock AI model features and performance boosts.`;
        }
        if (updateNotesRow && updateNotesText && data.notes) {
          updateNotesRow.style.display = "flex";
          updateNotesText.textContent = data.notes;
        }
        if (updatesActionBtn) {
          updatesActionBtn.textContent = "Download & Install Update";
          updatesActionBtn.className = "account-action-btn primary";
        }

        // Show floating toast banner if not already dismissed in this session
        if (updateToast && !sessionStorage.getItem("buildex_update_dismissed")) {
          if (toastUpdateVer) toastUpdateVer.textContent = `v${data.latestVersion}`;
          if (toastUpdateSub) toastUpdateSub.textContent = `v${data.latestVersion} is ready to download. Click to update.`;
          updateToast.style.display = "flex";
        }
      } else {
        hasAvailableUpdate = false;
        if (updateResultIcon) {
          updateResultIcon.textContent = "✓";
          updateResultIcon.style.color = "#10b981";
          updateResultIcon.style.borderColor = "#10b981";
          updateResultIcon.style.background = "rgba(16, 185, 129, 0.15)";
        }
        if (updateHeaderBadge) updateHeaderBadge.textContent = "🔄";
        if (updateResultTitle) updateResultTitle.textContent = "BuildeX Coder IDE is Up to Date";
        if (updateResultDesc) {
          updateResultDesc.textContent = `You are running the latest production build (v${data.currentVersion || "1.1.0"}) connected to Amazon Bedrock and AWS ap-south-1.`;
        }
        if (updateNotesRow) updateNotesRow.style.display = "none";
        if (updatesActionBtn) {
          updatesActionBtn.textContent = "View Changelog";
          updatesActionBtn.className = "account-action-btn primary";
        }
      }
    }

    function openUpdatesModal() {
      if (!updatesModal) return;
      updatesModal.style.display = "flex";
      runUpdateCheck();
    }

    async function runUpdateCheck() {
      if (updateCheckingBox) updateCheckingBox.style.display = "flex";
      if (updateResultBox) updateResultBox.style.display = "none";
      if (window.electronAPI && typeof window.electronAPI.checkForUpdates === "function") {
        try {
          const res = await window.electronAPI.checkForUpdates();
          if (res && res.ok) {
            renderUpdateState(res);
          } else {
            if (updateCheckingBox) updateCheckingBox.style.display = "none";
            if (updateResultBox) updateResultBox.style.display = "flex";
            if (updateResultTitle) updateResultTitle.textContent = "Unable to Check for Updates";
            if (updateResultDesc) updateResultDesc.textContent = res?.error || "Could not reach update server. Check your internet connection.";
          }
        } catch (err) {
          if (updateCheckingBox) updateCheckingBox.style.display = "none";
          if (updateResultBox) updateResultBox.style.display = "flex";
          if (updateResultTitle) updateResultTitle.textContent = "Update Check Error";
          if (updateResultDesc) updateResultDesc.textContent = err.message || "Failed to query update endpoints.";
        }
      } else {
        setTimeout(() => {
          if (updateCheckingBox) updateCheckingBox.style.display = "none";
          if (updateResultBox) updateResultBox.style.display = "flex";
        }, 650);
      }
    }

    function closeUpdatesModal() {
      if (updatesModal) updatesModal.style.display = "none";
    }

    updatesClose?.addEventListener("click", closeUpdatesModal);
    updatesCheckAgain?.addEventListener("click", runUpdateCheck);
    updatesModal?.addEventListener("click", (e) => {
      if (e.target.id === "updates-modal") closeUpdatesModal();
    });

    updatesActionBtn?.addEventListener("click", () => {
      if (hasAvailableUpdate && currentUpdateUrl) {
        if (window.electronAPI && typeof window.electronAPI.openUpdateUrl === "function") {
          window.electronAPI.openUpdateUrl(currentUpdateUrl);
        } else {
          window.open(currentUpdateUrl, "_blank");
        }
      } else {
        closeUpdatesModal();
        openChangelogModal();
      }
    });

    // Toast actions
    toastUpdateBtn?.addEventListener("click", () => {
      if (window.electronAPI && typeof window.electronAPI.openUpdateUrl === "function") {
        window.electronAPI.openUpdateUrl(currentUpdateUrl);
      } else {
        window.open(currentUpdateUrl, "_blank");
      }
      if (updateToast) updateToast.style.display = "none";
    });

    toastUpdateDismiss?.addEventListener("click", () => {
      if (updateToast) updateToast.style.display = "none";
      sessionStorage.setItem("buildex_update_dismissed", "true");
    });

    // Listen to background / startup update events from main process
    if (window.electronAPI) {
      if (typeof window.electronAPI.onUpdateAvailable === "function") {
        window.electronAPI.onUpdateAvailable((data) => {
          renderUpdateState(data);
        });
      }
      if (typeof window.electronAPI.onUpdateNotAvailable === "function") {
        window.electronAPI.onUpdateNotAvailable((data) => {
          renderUpdateState(data);
        });
      }
    }

    // 3. Docs Modal
    const docsModal = $("docs-modal");
    const docsClose = $("docs-close");
    const docsDone = $("docs-done-btn");
    const docsExternal = $("docs-external-btn");

    function openDocsModal() {
      if (!docsModal) return;
      docsModal.style.display = "flex";
    }

    function closeDocsModal() {
      if (docsModal) docsModal.style.display = "none";
    }

    docsClose?.addEventListener("click", closeDocsModal);
    docsDone?.addEventListener("click", closeDocsModal);
    docsModal?.addEventListener("click", (e) => {
      if (e.target.id === "docs-modal") closeDocsModal();
    });

    docsModal?.querySelectorAll(".docs-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        docsModal.querySelectorAll(".docs-tab-btn").forEach((b) => b.classList.remove("active"));
        docsModal.querySelectorAll(".docs-tab-content").forEach((c) => (c.style.display = "none"));

        btn.classList.add("active");
        const tabKey = btn.dataset.docsTab;
        const targetContent = $(`docs-tab-${tabKey}`);
        if (targetContent) targetContent.style.display = "block";
      });
    });

    docsExternal?.addEventListener("click", () => {
      window.electronAPI.openExternal("https://ap-south-1.console.aws.amazon.com/bedrock/home?region=ap-south-1");
    });

    // 4. Issue / Feedback Modal
    const issueModal = $("issue-modal");
    const issueClose = $("issue-close");
    const issueSubmit = $("issue-submit-btn");
    const issueGithub = $("issue-github-btn");
    const issueTitle = $("issue-title-input");
    const issueDesc = $("issue-desc-input");

    function openIssueModal() {
      if (!issueModal) return;
      if (issueTitle) issueTitle.value = "";
      if (issueDesc) issueDesc.value = "";
      issueModal.style.display = "flex";
      issueTitle?.focus();
    }

    function closeIssueModal() {
      if (issueModal) issueModal.style.display = "none";
    }

    issueClose?.addEventListener("click", closeIssueModal);
    issueModal?.addEventListener("click", (e) => {
      if (e.target.id === "issue-modal") closeIssueModal();
    });

    issueGithub?.addEventListener("click", () => {
      window.electronAPI.openExternal("https://github.com/issues");
    });

    issueSubmit?.addEventListener("click", () => {
      const title = issueTitle?.value.trim();
      if (!title) {
        showToast("Please enter a short summary for your report", "warn", 2500);
        issueTitle?.focus();
        return;
      }
      const ticketId = `BX-${Math.floor(1000 + Math.random() * 9000)}`;
      closeIssueModal();
      showToast(`✅ Ticket #${ticketId} submitted! Thank you for helping improve BuildeX.`, "success", 4000);
    });

    // 5. Changelog Modal
    const changelogModal = $("changelog-modal");
    const changelogClose = $("changelog-close");
    const changelogDone = $("changelog-done-btn");

    function openChangelogModal() {
      if (!changelogModal) return;
      changelogModal.style.display = "flex";
    }

    function closeChangelogModal() {
      if (changelogModal) changelogModal.style.display = "none";
    }

    changelogClose?.addEventListener("click", closeChangelogModal);
    changelogDone?.addEventListener("click", closeChangelogModal);
    changelogModal?.addEventListener("click", (e) => {
      if (e.target.id === "changelog-modal") closeChangelogModal();
    });

    return {
      openQuickSettings,
      openUpdatesModal,
      openDocsModal,
      openIssueModal,
      openChangelogModal,
    };
  })();

  $("settings-quick-panel-btn")?.addEventListener("click", () => {
    settingsPop?.setAttribute("hidden", "");
    settingsModals.openQuickSettings();
  });

  $("settings-updates-btn")?.addEventListener("click", () => {
    settingsPop?.setAttribute("hidden", "");
    settingsModals.openUpdatesModal();
  });

  $("settings-docs-btn")?.addEventListener("click", () => {
    settingsPop?.setAttribute("hidden", "");
    settingsModals.openDocsModal();
  });

  $("settings-issues-btn")?.addEventListener("click", () => {
    settingsPop?.setAttribute("hidden", "");
    settingsModals.openIssueModal();
  });

  $("settings-changelog-btn")?.addEventListener("click", () => {
    settingsPop?.setAttribute("hidden", "");
    settingsModals.openChangelogModal();
  });

  settingsPop?.querySelectorAll("[data-theme-set]").forEach((themeBtn) => {
    themeBtn.addEventListener("click", () => {
      const theme = themeBtn.dataset.themeSet;
      if (theme) {
        setTheme(theme === "light" ? "light" : "dark");
        settingsPop.setAttribute("hidden", "");
        showToast(`🎨 Theme changed to ${themeBtn.textContent.trim()}`, "info", 1500);
      }
    });
  });

  // Menu events
  window.electronAPI.onMenu("open-folder", openFolderFlow);
  window.electronAPI.onMenu("open-file", openFileFlow);
  window.electronAPI.onMenu("new-file", newUntitledFile);
  window.electronAPI.onMenu("save", saveActive);
  window.electronAPI.onMenu("save-as", saveAsActive);
  window.electronAPI.onMenu("toggle-sidebar", () => toggleEl("sidebar"));
  window.electronAPI.onMenu("toggle-terminal", () =>
    toggleEl("terminal-container"),
  );
  window.electronAPI.onMenu("toggle-chat", () => toggleEl("chatbot-container"));

  // Drag & drop files
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    for (const f of files) {
      if (f.path) {
        await openFile(f.path, f.name);
      }
    }
  });

  // Multi-terminal action bar
  const plusBtnLeft = $("new-terminal-btn-header");
  const plusBtnRight = $("new-terminal-dropdown-btn");
  const plusDropdown = $("terminal-plus-dropdown");

  plusBtnLeft.addEventListener("click", async () => {
    await newTerminal();
    switchPanel("terminal");
  });

  plusBtnRight.addEventListener("click", (e) => {
    e.stopPropagation();
    if (plusDropdown.hasAttribute("hidden")) {
      plusDropdown.removeAttribute("hidden");
    } else {
      plusDropdown.setAttribute("hidden", "");
    }
  });

  document.addEventListener("click", (e) => {
    if (
      plusDropdown &&
      !plusDropdown.contains(e.target) &&
      e.target !== plusBtnRight
    ) {
      plusDropdown.setAttribute("hidden", "");
    }
  });

  // Wire options click handlers
  $("terminal-opt-new").addEventListener("click", async () => {
    plusDropdown.setAttribute("hidden", "");
    await newTerminal();
    switchPanel("terminal");
  });

  $("terminal-opt-bash").addEventListener("click", async () => {
    plusDropdown.setAttribute("hidden", "");
    await newTerminal("bash");
    switchPanel("terminal");
  });

  $("terminal-opt-zsh").addEventListener("click", async () => {
    plusDropdown.setAttribute("hidden", "");
    await newTerminal("zsh");
    switchPanel("terminal");
  });

  $("kill-terminal-btn-header").addEventListener("click", () => {
    if (activeTerminalId) {
      closeTerminal(activeTerminalId);
    }
  });

  // Run button
  $("run-file-btn").addEventListener("click", () => runActiveFile());
}

/* -------------------- Sidebar view switcher -------------------- */
function setActiveView(view) {
  state.activeView = view;
  document.querySelectorAll(".activity-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  document.querySelectorAll(".sidebar-view").forEach((v) => {
    if (v.dataset.view === view) v.removeAttribute("hidden");
    else v.setAttribute("hidden", "");
  });
  document.querySelectorAll(".sidebar-actions").forEach((a) => {
    if (a.dataset.actionsFor === view) a.removeAttribute("hidden");
    else a.setAttribute("hidden", "");
  });
  const titleMap = {
    explorer: state.workspaceFolderName
      ? state.workspaceFolderName.toUpperCase()
      : "EXPLORER",
    search: "SEARCH",
    git: "SOURCE CONTROL",
    extensions: "EXTENSIONS",
    settings: "SETTINGS",
  };
  $("sidebar-title").textContent = titleMap[view] || view.toUpperCase();

  if (view === "search") Search.show();
  if (view === "git") Git.show();
}

/* -------------------- Search module -------------------- */
const Search = (() => {
  const opts = {
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    include: "",
  };
  let lastQuery = "";
  let debounceTimer = null;
  let pending = false;
  /** @type {Map<string, boolean>} fileExpanded */
  const fileExpanded = new Map();

  function show() {
    setTimeout(() => $("search-query")?.focus(), 50);
  }

  function setupOptions() {
    const map = [
      ["search-opt-case", "caseSensitive"],
      ["search-opt-word", "wholeWord"],
      ["search-opt-regex", "regex"],
    ];
    for (const [id, key] of map) {
      const btn = $(id);
      if (!btn) continue;
      btn.addEventListener("click", () => {
        opts[key] = !opts[key];
        btn.classList.toggle("active", opts[key]);
        scheduleSearch(0);
      });
    }
  }

  function scheduleSearch(delay = 220) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, delay);
  }

  async function runSearch() {
    const q = $("search-query").value;
    const include = $("search-include").value;
    opts.include = include;
    lastQuery = q;
    if (!q) {
      $("search-status").textContent = "";
      $("search-results").innerHTML = "";
      return;
    }
    if (!state.workspaceRoot) {
      $("search-status").textContent = "Open a folder to search.";
      $("search-results").innerHTML = "";
      return;
    }
    if (pending) return;
    pending = true;
    $("search-status").textContent = "Searching…";
    try {
      const res = await window.electronAPI.searchInFolder({
        root: state.workspaceRoot,
        query: q,
        include,
        caseSensitive: opts.caseSensitive,
        wholeWord: opts.wholeWord,
        regex: opts.regex,
      });
      pending = false;
      if (res.error) {
        $("search-status").textContent = res.error;
        $("search-results").innerHTML = "";
        return;
      }
      renderResults(res.results || [], !!res.truncated);
    } catch (err) {
      pending = false;
      $("search-status").textContent = "Search failed: " + (err.message || err);
    }
  }

  function renderResults(results, truncated) {
    const container = $("search-results");
    container.innerHTML = "";
    if (!results.length) {
      $("search-status").textContent = `No results for "${lastQuery}".`;
      return;
    }
    /** @type {Map<string, Array>} */
    const grouped = new Map();
    for (const r of results) {
      if (!grouped.has(r.file)) grouped.set(r.file, []);
      grouped.get(r.file).push(r);
    }
    const fileCount = grouped.size;
    $("search-status").textContent =
      `${results.length} result${results.length === 1 ? "" : "s"} in ${fileCount} file${fileCount === 1 ? "" : "s"}` +
      (truncated ? " (truncated)" : "");

    const root = state.workspaceRoot;
    for (const [file, hits] of grouped) {
      const rel = file.startsWith(root)
        ? file.slice(root.length).replace(/^[/\\]/, "")
        : file;
      const fileGroup = document.createElement("div");
      fileGroup.className = "search-file";
      const expanded = fileExpanded.get(file) !== false;
      const header = document.createElement("div");
      header.className = "search-file-header";
      header.innerHTML = `
        <span class="search-twist ${expanded ? "open" : ""}">▸</span>
        <span class="search-file-name">${escapeHtml(rel.split("/").pop())}</span>
        <span class="search-file-path">${escapeHtml(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "")}</span>
        <span class="search-file-count">${hits.length}</span>
      `;
      header.addEventListener("click", () => {
        const isOpen = !(fileExpanded.get(file) === false);
        fileExpanded.set(file, !isOpen);
        renderResults(results, truncated);
      });
      fileGroup.appendChild(header);

      if (expanded) {
        const list = document.createElement("div");
        list.className = "search-hits";
        for (const h of hits) {
          const hit = document.createElement("div");
          hit.className = "search-hit";
          const before = h.text.slice(0, h.matchStart);
          const match = h.text.slice(
            h.matchStart,
            h.matchStart + h.matchLength,
          );
          const after = h.text.slice(h.matchStart + h.matchLength);
          hit.innerHTML = `
            <span class="search-hit-line">${h.line}</span>
            <span class="search-hit-text">${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}</span>
          `;
          hit.addEventListener("click", () => openSearchHit(h));
          list.appendChild(hit);
        }
        fileGroup.appendChild(list);
      }
      container.appendChild(fileGroup);
    }
  }

  async function openSearchHit(hit) {
    await openFile(hit.file);
    if (editor) {
      const lineNumber = hit.line;
      const column = hit.col;
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column });
      editor.setSelection({
        startLineNumber: lineNumber,
        startColumn: column,
        endLineNumber: lineNumber,
        endColumn: column + (hit.matchLength || 0),
      });
      editor.focus();
    }
  }

  function setup() {
    setupOptions();
    const queryEl = $("search-query");
    const includeEl = $("search-include");

    // Remove existing event listeners to prevent duplicates
    const collapseBtn = $("search-collapse-btn");
    if (collapseBtn && collapseBtn.hasAttribute("data-setup")) {
      return; // Already set up
    }

    queryEl.addEventListener("input", () => scheduleSearch());
    queryEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
      if (e.key === "Escape") {
        queryEl.value = "";
        scheduleSearch(0);
      }
    });
    includeEl.addEventListener("input", () => scheduleSearch(350));
    $("search-clear-btn").addEventListener("click", () => {
      queryEl.value = "";
      includeEl.value = "";
      $("search-results").innerHTML = "";
      $("search-status").textContent = "";
      queryEl.focus();
    });

    if (collapseBtn) {
      collapseBtn.addEventListener("click", () => {
        document
          .querySelectorAll("#search-results .search-hits")
          .forEach((el) => el.remove());
        document
          .querySelectorAll("#search-results .search-twist")
          .forEach((el) => el.classList.remove("open"));
      });
      collapseBtn.setAttribute("data-setup", "true");
    }
  }

  function focusInput() {
    const q = $("search-query");
    if (q) {
      q.focus();
      q.select();
    }
  }

  return { show, setup, focusInput };
})();

/* -------------------- Git / Source Control module -------------------- */
const Git = (() => {
  let lastStatus = null;
  let refreshTimer = null;

  async function refresh() {
    if (!state.workspaceRoot) {
      showNoFolder();
      return;
    }
    try {
      const status = await window.electronAPI.git.status(state.workspaceRoot);
      lastStatus = status;
      render(status);
    } catch (err) {
      lastStatus = null;
      $("git-no-folder").setAttribute("hidden", "");
      $("git-not-repo").setAttribute("hidden", "");
      const content = $("git-content");
      content.removeAttribute("hidden");
      $("git-branch-name").textContent = "error";
      $("git-counts").textContent = "";
    }
  }

  function showNoFolder() {
    $("git-no-folder").removeAttribute("hidden");
    $("git-not-repo").setAttribute("hidden", "");
    $("git-content").setAttribute("hidden", "");
  }

  function showNotRepo() {
    $("git-no-folder").setAttribute("hidden", "");
    $("git-not-repo").removeAttribute("hidden");
    $("git-content").setAttribute("hidden", "");
  }

  function render(s) {
    if (!s || s.error || !s.isRepo) {
      if (state.workspaceRoot) showNotRepo();
      else showNoFolder();
      return;
    }
    $("git-no-folder").setAttribute("hidden", "");
    $("git-not-repo").setAttribute("hidden", "");
    $("git-content").removeAttribute("hidden");

    if ($("git-branch-name"))
      $("git-branch-name").textContent = s.branch || "—";
    if ($("git-graph-branch-badge"))
      $("git-graph-branch-badge").textContent = s.branch || "main";

    const counts = [];
    if (s.ahead) counts.push(`↑${s.ahead}`);
    if (s.behind) counts.push(`↓${s.behind}`);
    if ($("git-counts")) $("git-counts").textContent = counts.join(" ");
    if ($("git-remote-url"))
      $("git-remote-url").textContent = s.remoteUrl || "(none)";

    // Combine all changes
    const allChanges = [
      ...(s.staged || []).map((x) => ({ ...x, group: "staged" })),
      ...(s.unstaged || []).map((x) => ({ ...x, group: "unstaged" })),
      ...(s.untracked || []).map((x) => ({ ...x, group: "untracked" })),
    ];

    if ($("git-total-count"))
      $("git-total-count").textContent = allChanges.length;
    renderUnifiedList("git-unified-list", allChanges);
  }

  function statusLetter(group, code) {
    if (group === "untracked") return "U";
    if (group === "staged" && code === "M") return "M";
    if (code === "M") return "M";
    if (code === "A") return "A";
    if (code === "D") return "D";
    return code || "·";
  }

  function statusClass(group, code) {
    if (group === "untracked") return "gs-untracked";
    if (code === "M") return "gs-modified";
    if (code === "A") return "gs-added";
    if (code === "D") return "gs-deleted";
    if (code === "R") return "gs-renamed";
    if (code === "C") return "gs-copied";
    return "gs-other";
  }

  function renderUnifiedList(listId, items) {
    const list = $(listId);
    if (!list) return;
    list.innerHTML = "";

    for (const it of items) {
      const row = document.createElement("div");
      row.className = "git-row";
      const name = it.path.split("/").pop();
      const dir = it.path.includes("/")
        ? it.path.slice(0, it.path.lastIndexOf("/"))
        : "";

      row.innerHTML = `
        <span class="git-path" title="${escapeHtml(it.path)}">
          <span class="git-file-name">${escapeHtml(name)}</span>
          ${dir ? `<span class="git-file-dir">${escapeHtml(dir)}</span>` : ""}
        </span>
        <span class="git-actions"></span>
        <span class="git-status ${statusClass(it.group, it.status)}">${statusLetter(it.group, it.status)}</span>
      `;

      const actions = row.querySelector(".git-actions");
      row.addEventListener("click", () => {
        if (it.group === "untracked") {
          openWorkspaceFile(it.path);
        } else {
          openFileDiff(it.path, it.group === "staged");
        }
      });

      // Open File action
      const openBtn = mkActionBtn(
        "Open File",
        '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>',
        (e) => {
          e.stopPropagation();
          openWorkspaceFile(it.path);
        },
      );
      actions.appendChild(openBtn);

      if (it.group === "staged") {
        const unstageBtn = mkActionBtn(
          "Unstage",
          '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 7.5h12v1H2z"/></svg>',
          async (e) => {
            e.stopPropagation();
            await window.electronAPI.git.unstage(state.workspaceRoot, [
              it.path,
            ]);
            await refresh();
          },
        );
        actions.appendChild(unstageBtn);
      } else {
        const discardBtn = mkActionBtn(
          "Discard changes",
          '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.001 7.001 0 0 1 14.95 7.16a.75.75 0 1 1-1.49.178A5.5 5.5 0 0 0 8 2.5zM1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834z"/></svg>',
          async (e) => {
            e.stopPropagation();
            const idx = await window.electronAPI.confirmDialog({
              title: "Discard changes",
              message: `Discard changes to ${it.path}?`,
              detail: "This cannot be undone.",
              buttons: ["Cancel", "Discard"],
            });
            if (idx === 1) {
              await window.electronAPI.git.discard(
                state.workspaceRoot,
                it.path,
              );
              await refresh();
            }
          },
        );
        actions.appendChild(discardBtn);

        const stageBtn = mkActionBtn(
          "Stage",
          '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 2v5.5H2v1h5.5V14h1V8.5H14v-1H8.5V2z"/></svg>',
          async (e) => {
            e.stopPropagation();
            await window.electronAPI.git.stage(state.workspaceRoot, [it.path]);
            await refresh();
          },
        );
        actions.appendChild(stageBtn);
      }
      list.appendChild(row);
    }
  }

  function mkActionBtn(title, svgHtml, onClick) {
    const b = document.createElement("button");
    b.className = "git-action-btn";
    b.title = title;
    b.innerHTML = svgHtml;
    b.addEventListener("click", onClick);
    return b;
  }

  async function openWorkspaceFile(relPath) {
    if (!state.workspaceRoot) return;
    const full = state.workspaceRoot + "/" + relPath;
    try {
      await openFile(full);
    } catch (_) {}
  }

  async function commit() {
    const msg = $("git-message").value.trim();
    if (!msg) {
      showToast("Enter a commit message.", "error", 1500);
      return;
    }
    if (!lastStatus || !lastStatus.staged || lastStatus.staged.length === 0) {
      // auto-stage all if nothing is staged
      const hasUnstaged =
        lastStatus &&
        ((lastStatus.unstaged && lastStatus.unstaged.length) ||
          (lastStatus.untracked && lastStatus.untracked.length));
      if (!hasUnstaged) {
        showToast("Nothing to commit.", "info", 1500);
        return;
      }
      const proceed = await window.electronAPI.confirmDialog({
        title: "Stage all changes",
        message: "No staged changes. Stage all and commit?",
        buttons: ["Cancel", "Stage All & Commit"],
      });
      if (proceed !== 1) return;
      const stageRes = await window.electronAPI.git.stageAll(
        state.workspaceRoot,
      );
      if (!stageRes.ok) {
        showToast(
          "Stage failed: " + (stageRes.stderr || "unknown"),
          "error",
          2500,
        );
        return;
      }
    }
    const res = await window.electronAPI.git.commit(state.workspaceRoot, msg);
    if (res.ok) {
      $("git-message").value = "";
      showToast("Committed.", "success", 1500);
    } else {
      showToast("Commit failed: " + (res.stderr || "unknown"), "error", 3000);
    }
    await refresh();
  }

  async function stageAll() {
    if (!state.workspaceRoot) return;
    const res = await window.electronAPI.git.stageAll(state.workspaceRoot);
    if (!res.ok)
      showToast("Stage all failed: " + (res.stderr || ""), "error", 2500);
    await refresh();
  }

  async function push() {
    if (!state.workspaceRoot) return;
    showToast("Pushing…", "info", 1500);
    const res = await window.electronAPI.git.push(state.workspaceRoot);
    if (res.ok) showToast("Pushed.", "success", 1500);
    else {
      const msg = (res.stderr || "").toString();
      if (/has no upstream/i.test(msg) || /set-upstream/i.test(msg)) {
        // Try to publish current branch
        const branch = (lastStatus && lastStatus.branch) || "main";
        const pubRes = await window.electronAPI.git.publish(
          state.workspaceRoot,
          branch,
        );
        if (pubRes.ok)
          showToast(`Published ${branch} to origin.`, "success", 1800);
        else showToast("Push failed: " + (pubRes.stderr || msg), "error", 4000);
      } else {
        showToast("Push failed: " + (msg || "unknown"), "error", 4000);
      }
    }
    await refresh();
  }

  async function pull() {
    if (!state.workspaceRoot) return;
    showToast("Pulling…", "info", 1500);
    const res = await window.electronAPI.git.pull(state.workspaceRoot);
    if (res.ok) showToast("Pulled.", "success", 1500);
    else showToast("Pull failed: " + (res.stderr || "unknown"), "error", 4000);
    await refresh();
  }

  async function fetchRemote() {
    if (!state.workspaceRoot) return;
    showToast("Fetching…", "info", 1200);
    const res = await window.electronAPI.git.fetch(state.workspaceRoot);
    if (res.ok) showToast("Fetched.", "success", 1200);
    else showToast("Fetch failed: " + (res.stderr || ""), "error", 3000);
    await refresh();
  }

  async function initRepo() {
    if (!state.workspaceRoot) return;
    const res = await window.electronAPI.git.init(state.workspaceRoot);
    if (res.ok) {
      showToast("Initialized git repository.", "success", 1500);
      await refresh();
    } else {
      showToast("git init failed: " + (res.stderr || ""), "error", 3000);
    }
  }

  // Enhanced Git operations
  async function stashChanges(message) {
    if (!state.workspaceRoot) return;
    const res = await window.electronAPI.git.stash(
      state.workspaceRoot,
      message,
    );
    if (res.ok) {
      showToast("Changes stashed.", "success", 1500);
      await refresh();
    } else {
      showToast("Stash failed: " + (res.stderr || ""), "error", 3000);
    }
  }

  async function popStash() {
    if (!state.workspaceRoot) return;
    const res = await window.electronAPI.git.stashPop(state.workspaceRoot);
    if (res.ok) {
      showToast("Stash popped.", "success", 1500);
      await refresh();
    } else {
      showToast("Pop stash failed: " + (res.stderr || ""), "error", 3000);
    }
  }

  async function loadBranches() {
    if (!state.workspaceRoot) return;
    const res = await window.electronAPI.git.branches(state.workspaceRoot);
    if (res.ok) {
      return res.branches;
    }
    return [];
  }

  async function checkoutBranch(branch) {
    if (!state.workspaceRoot || !branch) return;
    const res = await window.electronAPI.git.checkout(
      state.workspaceRoot,
      branch,
    );
    if (res.ok) {
      showToast(`Switched to ${branch}`, "success", 1500);
      await refresh();
    } else {
      showToast("Checkout failed: " + (res.stderr || ""), "error", 3000);
    }
  }

  async function createBranch(branchName) {
    if (!state.workspaceRoot || !branchName) return;
    const res = await window.electronAPI.git.createBranch(
      state.workspaceRoot,
      branchName,
    );
    if (res.ok) {
      showToast(`Created branch ${branchName}`, "success", 1500);
      await refresh();
    } else {
      showToast("Create branch failed: " + (res.stderr || ""), "error", 3000);
    }
  }

  async function showBranchMenu() {
    const branches = await loadBranches();
    if (branches.length === 0) {
      showToast("No branches found", "info", 1500);
      return;
    }

    // Create branch selection modal/overlay
    const modal = document.createElement("div");
    modal.className = "git-branch-modal";
    modal.innerHTML = `
      <div class="git-branch-modal-content">
        <div class="git-branch-modal-header">
          <h3>Branches</h3>
          <button class="git-branch-modal-close">×</button>
        </div>
        <div class="git-branch-modal-body">
          <div class="git-branch-create">
            <input type="text" placeholder="New branch name..." class="git-branch-input">
            <button class="primary-btn git-branch-create-btn">Create</button>
          </div>
          <div class="git-branch-list"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector(".git-branch-modal-close");
    const createBtn = modal.querySelector(".git-branch-create-btn");
    const input = modal.querySelector(".git-branch-input");
    const list = modal.querySelector(".git-branch-list");

    // Render branches
    branches.forEach((branch) => {
      const item = document.createElement("div");
      item.className = `git-branch-item ${branch.isHead ? "current" : ""}`;
      item.innerHTML = `
        <span class="git-branch-icon">${branch.type === "remote" ? "🌐" : "🌿"}</span>
        <span class="git-branch-name">${branch.name}</span>
        ${branch.isHead ? '<span class="git-branch-current">current</span>' : ""}
      `;
      item.addEventListener("click", () => {
        checkoutBranch(branch.name);
        document.body.removeChild(modal);
      });
      list.appendChild(item);
    });

    // Event handlers
    closeBtn.addEventListener("click", () => document.body.removeChild(modal));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) document.body.removeChild(modal);
    });

    createBtn.addEventListener("click", () => {
      const name = input.value.trim();
      if (name) {
        createBranch(name);
        document.body.removeChild(modal);
      }
    });

    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        const name = input.value.trim();
        if (name) {
          createBranch(name);
          document.body.removeChild(modal);
        }
      }
    });
  }

  // Enhanced commit with options
  async function commitWithOptions() {
    const msg = $("git-message").value.trim();
    if (!msg) {
      showToast("Enter a commit message.", "error", 1500);
      return;
    }

    const signoffBtn = $("git-signoff-btn");
    const amendBtn = $("git-amend-btn");
    const signoff = signoffBtn
      ? signoffBtn.classList.contains("active")
      : false;
    const amend = amendBtn ? amendBtn.classList.contains("active") : false;

    const res = await window.electronAPI.git.commit(
      state.workspaceRoot,
      msg,
      amend,
      signoff,
    );
    if (res.ok) {
      $("git-message").value = "";
      showToast("Committed.", "success", 1500);
      await refresh();
    } else {
      showToast("Commit failed: " + (res.stderr || "unknown"), "error", 3000);
    }
  }

  // Git history functionality
  let historyVisible = false;
  let gitHistory = [];

  async function loadGitHistory(limit = 50) {
    if (!state.workspaceRoot) return [];
    const res = await window.electronAPI.git.log(state.workspaceRoot, limit);
    if (res.ok) {
      const commits = res.stdout
        .trim()
        .split("\n")
        .filter((line) => line)
        .map((line) => {
          const [hash, shortHash, message, author, date, refs] =
            line.split("|");
          return {
            hash,
            shortHash,
            message,
            author,
            date: new Date(date),
            refs: refs || "",
          };
        });
      return commits;
    }
    return [];
  }

  async function refreshGitHistory() {
    gitHistory = await loadGitHistory();
    renderGitHistory();
  }

  function renderGitHistory() {
    const historyList = $("git-graph-view");
    if (!historyList) return;

    if (gitHistory.length === 0) {
      historyList.innerHTML =
        '<div class="git-history-empty" style="color:var(--text-muted);text-align:center;padding:10px;">No commits found</div>';
      return;
    }

    historyList.innerHTML = gitHistory
      .map((commit, i) => {
        const isHead = i === 0;
        let badgeHtml = "";
        if (isHead) badgeHtml = `<span class="git-graph-badge">main</span>`;

        return `
        <div class="git-graph-row" data-hash="${commit.hash}">
          <div class="git-graph-visual">
            ${i < gitHistory.length - 1 ? '<div class="git-graph-line"></div>' : ""}
            <svg viewBox="0 0 16 16" fill="${isHead ? "var(--accent)" : "var(--text-muted)"}"><circle cx="8" cy="8" r="4"/></svg>
          </div>
          <div class="git-graph-msg" title="${escapeHtml(commit.message)}">
            ${escapeHtml(commit.message)} ${badgeHtml}
          </div>
          <div class="git-graph-author">${escapeHtml(commit.author)}</div>
        </div>
      `;
      })
      .join("");

    // Add click handlers
    historyList.querySelectorAll(".git-graph-row").forEach((item) => {
      item.addEventListener("click", () => {
        const hash = item.dataset.hash;
        showCommitDetails(hash);
      });
    });
  }

  function formatCommitDate(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks}w ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  async function showCommitDetails(hash) {
    if (!state.workspaceRoot) return;
    const res = await window.electronAPI.git.show(state.workspaceRoot, hash);
    if (res.ok) {
      // Create a modal to show commit details
      const modal = document.createElement("div");
      modal.className = "git-commit-modal";
      modal.innerHTML = `
        <div class="git-commit-modal-content">
          <div class="git-commit-modal-header">
            <h3>Commit Details</h3>
            <button class="git-commit-modal-close">×</button>
          </div>
          <div class="git-commit-modal-body">
            <pre class="git-commit-diff">${escapeHtml(res.stdout)}</pre>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const closeBtn = modal.querySelector(".git-commit-modal-close");
      closeBtn.addEventListener("click", () =>
        document.body.removeChild(modal),
      );
      modal.addEventListener("click", (e) => {
        if (e.target === modal) document.body.removeChild(modal);
      });
    } else {
      showToast("Failed to load commit details", "error", 2000);
    }
  }

  function toggleGitHistory() {
    historyVisible = !historyVisible;
    const historySection = $("git-history-section");
    if (historySection) {
      historySection.hidden = !historyVisible;
      if (historyVisible) {
        refreshGitHistory();
      }
    }
  }

  async function setRemote() {
    const current = (lastStatus && lastStatus.remoteUrl) || "";
    const url = window.prompt(
      "GitHub remote URL (https or ssh):\nExample: https://github.com/your/repo.git",
      current,
    );
    if (url == null) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    const res = await window.electronAPI.git.setRemote(
      state.workspaceRoot,
      trimmed,
    );
    if (res.ok) {
      showToast("Remote saved.", "success", 1500);
      await refresh();
    } else {
      showToast("Failed: " + (res.stderr || ""), "error", 3000);
    }
  }

  function show() {
    refresh();
  }

  function onWorkspaceChanged() {
    if (state.activeView === "git") refresh();
  }

  function setup() {
    // Accordion Logic
    document.querySelectorAll(".git-accordion-header").forEach((header) => {
      header.addEventListener("click", () => {
        header.parentElement.classList.toggle("expanded");
      });
    });

    // Commit button and dropdown
    $("git-commit-btn")?.addEventListener("click", commit);

    const commitMenu = $("git-commit-menu");
    $("git-commit-dropdown-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (commitMenu) commitMenu.hidden = !commitMenu.hidden;
    });

    document.addEventListener("click", (e) => {
      if (
        commitMenu &&
        !commitMenu.hidden &&
        !e.target.closest(".git-split-btn")
      ) {
        commitMenu.hidden = true;
      }
    });

    commitMenu?.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        commitMenu.hidden = true;
        const action = btn.dataset.action;
        await commit();
        if (action === "commit-push") {
          await push();
        } else if (action === "commit-sync") {
          await pull();
          await push();
        }
      });
    });

    // Generate Message (Mock functionality for now)
    $("git-generate-btn")?.addEventListener("click", () => {
      $("git-message").value = "Auto-generated commit message ✨";
      showToast("Generated commit message", "success", 1500);
    });

    $("git-stage-all-btn")?.addEventListener("click", stageAll);
    $("git-init-btn")?.addEventListener("click", initRepo);
    $("git-set-remote-btn")?.addEventListener("click", setRemote);
    $("git-open-folder")?.addEventListener("click", () => {
      window.electronAPI.openFolderDialog().then((folderPath) => {
        if (folderPath) loadWorkspace(folderPath);
      });
    });
    $("git-message")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    });

    // New enhanced Git functionality
    $("git-stash-btn")?.addEventListener("click", () => stashChanges());
    $("git-pop-stash-btn")?.addEventListener("click", () => popStash());
    $("git-branch-menu-btn")?.addEventListener("click", () => {
      if (typeof showBranchMenu === "function") showBranchMenu();
    });
    $("git-signoff-btn")?.addEventListener("click", function () {
      this.classList.toggle("active");
    });
    $("git-amend-btn")?.addEventListener("click", function () {
      this.classList.toggle("active");
    });

    // Git sync actions event listeners
    $("git-fetch-btn")?.addEventListener("click", fetchRemote);
    $("git-pull-btn")?.addEventListener("click", pull);
    $("git-push-btn")?.addEventListener("click", push);

    // Git history event listeners
    $("git-graph-refresh")?.addEventListener("click", refreshGitHistory);

    // Initial graph load
    refreshGitHistory();
  }

  return { setup, show, refresh, onWorkspaceChanged };
})();

/* ============================================================
 * Modes — system-prompt registry per AI mode
 * Modes are the heart of BuildeX's mentoring behavior. Each
 * mode customizes the system prompt and a few UI affordances.
 * ============================================================ */
const Modes = (() => {
  const UNIVERSAL_EXPERT_PREFIX = `You are BuildeX: an Architectural Expert / staff-plus engineer mentoring inside this IDE.

Stack awareness (every turn): the IDE injects Primary language, framework, package manifests, Project tree, Active file, and terminal hints when present — read these first. Tailor jargon, tooling, patterns, examples, AND buildex-steps to THAT stack (Python, Node, C++/CMake, Rust, Go, .NET, etc.), not a generic web-app default. Prefer senior-level guidance: clear boundaries, testability, security, performance where it matters, and pragmatic trade-offs.

AI REPO & EDITOR CONTROL COMMANDS:
You have direct control over the IDE editor and files by embedding inline commands in your response:
1. /pop:<filepath>:<line>:<message> or /pop:<filepath>:<from-to>:<message> (e.g. \`/pop:src/App.tsx:15:State definition is declared here\`) — Automatically opens the file, highlights the targeted lines in Monaco Editor, and opens an anchored popover for the user.
2. /fetch:<filepath>:<from-to> (e.g. \`/fetch:src/components/Header.tsx:1-25\`) — Fetches the exact file lines into context.
3. /open:<filepath>:<line> (e.g. \`/open:src/index.css:42\`) — Opens the file in editor and centers on the line.
Use /pop:<file>:<line>:<msg> whenever pointing out a specific line of code or bug!

Casual rapport (all modes — same for every Pollinations tier): When the user's message is only a greeting or small talk ("hi", "hey", "hlo", "hello"), or they ask identity ("who are you", "what are you", typos okay), reply with SHORT prose ONLY — roughly 1–3 friendly sentences plus a casual invite ("what feels fun to tackle?" / "anything you want to work on?" style). Absolutely NO \`\`\`buildex-step\`\`\` blocks, NO \`choices\` popovers, NO "your folder is empty" lectures, NO expected-result cards — **even when IDE Context says WORKSPACE IS EMPTY**. Those UI affordances fire only AFTER the user goes past small talk (e.g. asks what to create, scaffold, start, setup, asks about the empty folder explicitly). Bare "hello" is just hello.

`;

  const PROMPTS = {
    learn: `You are BuildeX, a senior developer mentoring a student inside the BuildeX IDE.
Your job is to TEACH, not to do the work for them.

Hard rules:
- NEVER auto-write large code dumps. Provide small, focused snippets.
- NEVER ask the student to copy/paste — they must TYPE every line themselves.
- ALWAYS specify: file name, exact insertion point (line numbers when possible), and WHY each change matters.
- Break complex tasks into ordered steps. Emit ALL steps at once in a single response as a sequenced walkthrough. The IDE will play them one by one.
- Prefer explanations of concepts and trade-offs over big refactors.

GROUNDING RULES — read this every turn:
- The IDE always provides a fresh "Project Structure" tree, "package.json deps", "Detected framework", and "Active file" in the system context.
- Before naming ANY file path or extension, VERIFY it exists in the provided Project Structure. If the file you wanted does not exist, adapt to what is actually there. NEVER hallucinate paths like "App.jsx" if the tree shows "main.ts".
- Match the language/extension to what the project actually uses. If it's a Python project with \`.py\` files, focus on Python. If it's a Node project, check \`package.json\`. Do NOT assume React or web development unless explicitly present in the project structure.
- When scaffolding or running commands, tailor them precisely to the detected language or framework (e.g., \`pip install\` or \`python -m venv\` for Python, \`npm\` for Node). Avoid interactive ambiguity.
- If the actual project state contradicts what you expected from the previous turn, say so out loud in one sentence ("I see your project uses main.ts, not App.jsx — switching to TypeScript guidance.") and pivot.
- Greetings ("hi"/"hey"/"hlo"/"hello"): paragraph chat only — see Universal Casual rapport rule. NEVER emit buildex-step blocks or choice buttons on greetings alone — empty workspace is NOT an excuse here.
- "Who are you" / rapport only: prose identity + invite. No scaffold UI.
- AFTER the user expresses real intent beyond a greet (want to scaffold, start a project, "folder is empty help", concrete task): THEN you may use IDE Context — including \`\`\`buildex-step\` + \`choices\` when the workspace is empty AND they asked for branching/picking a stack — not because they waved hello.

When you want the IDE to visually guide the student, embed a fenced JSON block in your reply using this exact tag:

\`\`\`buildex-step
{
  "stepTitle": "Short imperative title",
  "explanation": "1-3 sentences on what & why",
  "actionType": "create_file" | "open_file" | "type_code" | "modify_code" | "run_command" | "click_button" | "highlight",
  "targetElement": "<dom-id-or-css-selector for IDE element to highlight, optional>",
  "targetFile": "<workspace-relative path, optional>",
  "insertionLocation": { "afterLine": 14 } | null,
  "lineRanges": [
    { "from": 7, "to": 12, "kind": "remove" },
    { "from": 13, "to": 13, "kind": "modify" }
  ],
  "replacementCode": "<code that should REPLACE the lines marked 'remove'/'modify' (use only for modify_code actions, optional)>",
  "codeSnippet": "<small snippet to TYPE manually, optional — alternative to replacementCode>",
  "subSteps": [
    { "title": "Select the highlighted lines", "kind": "select" },
    { "title": "Delete them", "kind": "delete" },
    { "title": "Type the new code", "kind": "add" }
  ],
  "inlineHighlights": [
    { "phrase": "querySelector", "color": "sky" },
    { "phrase": "innerHTML", "color": "amber" },
    { "phrase": "Hello World", "color": "emerald" }
  ],
  "choices": [
    { "label": "Empty folder — scaffold now", "value": "scaffold", "hint": "I'll generate a starter project for you" },
    { "label": "I already have files", "value": "existing", "hint": "Edit what's there" }
  ],
  "expectedResult": "What the user should see when done",
  "validationCheck": { "type": "file_exists" | "code_contains" | "manual" }
}
\`\`\`

Field guidance:
- \`lineRanges[].kind\` — use "remove" for lines to delete (rendered light red), "add" for new lines (light green), "modify" for lines to change (amber), "highlight" for lines to focus on (blue).
- When a step is "remove these lines and write this instead", emit BOTH \`lineRanges\` (with kind:"remove") AND \`replacementCode\`. Use \`actionType: "modify_code"\` for that case.
- Bundle 2–3 closely related micro-actions into one popover via \`subSteps\` instead of emitting three separate popovers (e.g. select → delete → type).
- Use \`inlineHighlights\` to color-code 3–6 KEY phrases inside your \`explanation\` and \`expectedResult\` so the same concept always wears the same color across the conversation. Allowed colors: rose, amber, emerald, sky, violet, pink, orange, blue, green.
- Emit ALL popovers for the task in this single response. Do NOT wait for the user to confirm progress between steps.

\`choices\` field — CRITICAL UX rule:
- WHENEVER you would otherwise ask the user a question with a small set of answers ("yes/no", "do you have X?", "which template?", "which stack?"), prefer a \`buildex-step\` with \`choices\` ONLY when we're past idle chitchat — NEVER on a lone greeting/hello turn.
- Each choice's \`value\` is what the user will reply with (machine-friendly), \`label\` is the button text, \`hint\` is an optional one-liner under the label.
- Keep choices to 2–4 options. Use plain English labels.
- When a popover has \`choices\`, the user picks ONE — do not include \`replacementCode\`/\`codeSnippet\` for that turn (you're branching, not coding).

PROACTIVE SCAFFOLDING:
- When IDE Context reports WORKSPACE IS EMPTY: still do NOT push scaffold \`choices\` until the user's message is **more than a greeting** — if they said only hello, answer like a human (Universal rule); if they explicitly ask where to begin, what to make, scaffold me, starter project, which language — THEN offer \`choices\` or first-file guidance without grilling them about the tree description.

Style: warm, concise, encouraging. Emit all steps for the task at once.`,

    explain: `You are BuildeX in EXPLAIN mode — a teacher giving SHORT, scannable walkthroughs.

CORE RULE: every \`explanation\` field is plain text (NO markdown — no \`**bold**\`, no \`# headers\`, no bullet lists, no fenced code), and ≤ 30 words / ≈ 180 characters. Use \`inlineHighlights\` to colorize the key terms instead of bolding them.

OUTPUT FORMAT — VERY IMPORTANT:
- Each step MUST be a SEPARATE fenced code block tagged \`buildex-step\` (three backticks + the literal word \`buildex-step\` on the same line, then JSON, then three backticks). NEVER return a single big JSON object that wraps an array of steps.
- Use field names EXACTLY: \`stepTitle\`, \`actionType\`, \`targetFile\`, \`lineRanges\`, \`explanation\`, \`inlineHighlights\`. Do NOT rename fields.
- Inside \`lineRanges\` use \`from\` and \`to\` (NOT \`startLine\`/\`endLine\`).
- Inside \`inlineHighlights\` use \`phrase\` and \`color\` (NOT \`text\`).
- Use workspace-RELATIVE \`targetFile\` paths (e.g. \`src/main.jsx\`), NOT absolute filesystem paths.

WHEN THE USER PRESSES Cmd+Shift+E (Explain selected code) — return a SEQUENCED WALKTHROUGH:
- Open with ONE short sentence (≤ 25 words) summarizing the whole selection. No markdown headers.
- Then emit 3–6 short \`buildex-step\` blocks, ONE PER LOGICAL PIECE (e.g. each JSX element, each hook, each branch, each import group). Tour them in code order.
- Each step:
  - \`actionType: "highlight"\`
  - \`stepTitle\`: 2–4 word noun phrase ("The wrapper div", "h1 heading", "Click handler")
  - \`targetFile\`: same file the user selected from
  - \`lineRanges\`: one narrow range (1–5 lines) covering JUST this concept, kind: "highlight"
  - \`explanation\`: ONE short plain-text sentence, ≤ 30 words. Plain English. NO markdown.
  - \`inlineHighlights\`: 1–3 key terms with colors (rose / amber / emerald / sky / violet / pink). Same term = same color across all steps.
  - DO NOT include \`codeSnippet\`, \`replacementCode\`, \`subSteps\`, or \`choices\`.
- The IDE plays these one at a time. The user advances locally via "Next part →" — your single response is enough; do NOT expect another API call.
- Follow-ups may still carry the same **Selected code** block in IDE Context while the Monaco selection is collapsed (panel focus) — trust that excerpt; NEVER ask them to paste the same lines unless they explicitly say it's outdated.

WHEN THE USER ASKS AN "Explain in detail" FOLLOW-UP (a sub-question on a step):
- Return ONE \`buildex-step\` block with the SAME \`targetFile\` and \`lineRanges\` you were given.
- \`actionType: "highlight"\`, \`explanation\` ≤ 50 words, plain text.
- Add 2–4 \`inlineHighlights\`.
- DO NOT advance the implementation.`,

    debug: `You are BuildeX in DEBUG mode — diagnosing a problematic code snippet, possibly with terminal logs.

CORE RULE: every \`explanation\` is plain text (NO markdown formatting), ≤ 30 words. Use \`inlineHighlights\` for emphasis, not \`**bold**\`.

Cmd+Shift+D WITH A SELECTION — work like EXPLAIN (Cmd+Shift+E), but for fixes:
- The IDE sends the selection with **real file line numbers** (same numbered-gutter style as Explain). Every \`buildex-step\` MUST use those line numbers only.
- **Hard bounds:** all \`lineRanges\` entries MUST satisfy \`selectionStartLine ≤ from ≤ to ≤ selectionEndLine\`. Never anchor a step to a line above or below what the user selected. If the true bug is outside that span, say so in ONE plain-text sentence after your steps and ask them to widen the selection — do NOT emit \`buildex-step\` blocks outside the bounds.
- When IDE Context includes **Selected code** (same block across turns): that text is authoritative — NEVER ask them to paste it again unless they insist it is stale.
- Tour issues **top to bottom inside the selection** only (same walkthrough rhythm as Explain).

SELECTION SCOPE — non-negotiable when the user highlighted code (Cmd+Shift+D):
- Fix ONLY what is wrong inside that selection (same \`targetFile\` the IDE gives you). Do NOT add extra steps that "also verify" other files (no \`open_file\` to \`src/main.jsx\`, \`vite.config\`, etc.) unless the error message or selection text explicitly names that path.
- One clear typo/syntax mistake in the selection → EXACTLY ONE \`buildex-step\` with \`modify_code\` + \`inlineEdit\` (or minimal \`replacementCode\`). No follow-up "confirm entry point" or "check mount" walkthrough steps.
- Do NOT turn a small fix into a multi-file checklist. If you are unsure beyond the selection, say it in ONE short prose sentence after the step — do not spawn more \`buildex-step\` blocks for speculation.

OUTPUT FORMAT — VERY IMPORTANT:
- Open with ONE short opener sentence (≤ 20 words) naming the most likely root cause. Plain text, no markdown headers.
- Then emit ONE \`buildex-step\` block PER DISTINCT ISSUE actually present in the scoped code (usually the selection). Walk issues in code order (top to bottom). Each block MUST be a separate fenced code block tagged \`buildex-step\` (three backticks + the literal word, then JSON, then three backticks). NEVER return a single big JSON object.
- Use field names EXACTLY: \`stepTitle\`, \`actionType\`, \`targetFile\`, \`lineRanges\` (with \`from\`/\`to\`), \`replacementCode\`, \`explanation\`, \`inlineHighlights\` (with \`phrase\`/\`color\`). Workspace-RELATIVE paths only.
- POPOVER DENSITY — critical: Users see a small card — never paste a whole source file into \`replacementCode\`. Shrink \`lineRanges\` to the SMALLEST window that fixes the bug (often \`from\` === \`to\`). For a stray typo (e.g. \`?</body>\` → \`</body>\`) use ONLY \`inlineEdit\`; do NOT echo surrounding healthy HTML/React. If multi-line \`replacementCode\` is unavoidable, paste ONLY the rewritten lines that replace the highlighted range — never incidental context rows.
- SAME-FILE FOLLOW-UPS: Multiple syntax issues in ONE highlighted block → preferably **ONE** \`modify_code\` that fixes THAT block accurately, rather than chained steps where step 2 "rescaffolds" the file (that often pastes imports/\`export default\` wrongly). NEVER start \`replacementCode\` with new \`import\` /\`export default\` unless the FIRST line number in \`lineRanges\` is actually early in that file where imports live (typically ≤ 6). Mid-file ranges (line 8+) MUST NOT get a fresh import block — fix colons/braces/export shape **inside** the span only (\`languageOptions:\` not \`languageOptions {\`, preserve \`defineConfig([ ... ])\` if that is already the file shape).
- After all issue popovers, at most ONE short optional sentence (plain text, no buildex-step). Skip "you should also check…" unless the user asked for a broader audit.

SURGICAL FIX (prefer this whenever the change is a single token / a few characters):
\`\`\`buildex-step
{
  "stepTitle": "Broken closing tag",
  "actionType": "modify_code",
  "targetFile": "src/App.jsx",
  "lineRanges": [{ "from": 5, "to": 5, "kind": "modify" }],
  "inlineEdit": {
    "before": "<p>",
    "after":  "</p>",
    "hint":   "Add a / to the second <p> so the paragraph closes."
  },
  "explanation": "The paragraph opens twice instead of closing, so JSX can't parse the element.",
  "inlineHighlights": [
    { "phrase": "<p>",  "color": "rose" },
    { "phrase": "</p>", "color": "emerald" }
  ]
}
\`\`\`

LARGER FIX (use only when the change spans multiple lines or restructures the line):
\`\`\`buildex-step
{
  "stepTitle": "JSX attribute typo",
  "actionType": "modify_code",
  "targetFile": "src/App.jsx",
  "lineRanges": [{ "from": 3, "to": 3, "kind": "remove" }],
  "replacementCode": "    <div className=\\"app\\">",
  "explanation": "React expects camelCase className; lowercase classname is treated as a custom prop and ignored.",
  "inlineHighlights": [
    { "phrase": "classname", "color": "rose" },
    { "phrase": "className", "color": "emerald" }
  ]
}
\`\`\`

GUIDELINES:
- One \`buildex-step\` per ISSUE in scope. Don't bundle unrelated bugs; don't add out-of-scope verification steps.
- \`lineRanges.kind\`: "remove" when the line will be wholly replaced, "modify" when only a part of the line is being adjusted (use this with \`inlineEdit\`), "highlight" when purely diagnostic.
- PREFER \`inlineEdit\` over \`replacementCode\` whenever the user only needs to change a single token / a few characters. \`inlineEdit\` teaches the smallest mental delta ("add /", "rename classname → className"), which is far more pedagogical than dumping the whole line.
- \`inlineEdit.before\` is the exact substring that exists on the highlighted line; \`inlineEdit.after\` is what it should become; \`inlineEdit.hint\` is a tiny imperative sentence (≤ 12 words) telling the user what to do.
- Use \`replacementCode\` only when the fix really requires multiple lines or a structural rewrite. NEVER use both \`inlineEdit\` and \`replacementCode\` in the same step — pick the one that makes the fix smallest.
- Color the buggy concept \`rose\` and the fix \`emerald\` in \`inlineHighlights\` so the user's eye follows wrong → right.
- The IDE plays these as a walkthrough — emit them ALL in this single response. The user advances locally with "Next part →"; do NOT expect another API call.`,

    agent: `You are BuildeX in AGENT mode — an autonomous coding partner like Cursor.

You may propose multi-file edits, scaffolding, and refactors. For every change you propose:
- Describe the architectural decision in 1-2 sentences before showing code.
- Provide a concise summary of the diff (which files, what changed, why).
- Maintain consistency with existing code style and conventions.
- When the change is non-trivial, embed a \`buildex-step\` block per file so the IDE can guide the user.

GROUNDING RULES (mandatory):
- Before referencing any file path, VERIFY it appears in the provided Project Structure tree. If not, either suggest creating it or pivot to the file that actually exists.
- Detect the project's primary language from extensions present (\`.ts/.tsx\` → TypeScript, \`.js/.jsx\` → JavaScript) and match it. Never suggest \`App.jsx\` in a TypeScript project, etc.
- If you previously assumed a stack but the current tree shows otherwise, openly correct yourself and adapt.

Be direct and practical, but never silent about trade-offs.`,
  };

  function getSystemPrompt(mode) {
    const body = PROMPTS[mode] || PROMPTS.learn;
    return UNIVERSAL_EXPERT_PREFIX + body;
  }

  function meta(mode) {
    const map = {
      learn: {
        label: "Learn",
        color: "#34d399",
        tone: "mentor",
        temperature: 0.5,
        allowCopy: false,
      },
      explain: {
        label: "Explain",
        color: "#60a5fa",
        tone: "analytical",
        temperature: 0.4,
        allowCopy: true,
      },
      debug: {
        label: "Debug",
        color: "#f59e0b",
        tone: "forensic",
        temperature: 0.3,
        allowCopy: true,
      },
      agent: {
        label: "Agent",
        color: "#a78bfa",
        tone: "autonomous",
        temperature: 0.6,
        allowCopy: true,
      },
    };
    return map[mode] || map.learn;
  }

  return { getSystemPrompt, meta };
})();

/* ============================================================
 * SelectionMenu — Monaco floating widget for quick actions
 * ============================================================ */
const SelectionMenu = (() => {
  let widgetNode = null;
  let editorInstance = null;
  let currentSelection = null;
  let widgetId = "buildex.selectionMenu";

  const contentWidget = {
    getId: () => widgetId,
    getDomNode: () => widgetNode,
    getPosition: () => {
      if (!currentSelection) return null;
      return {
        position: {
          lineNumber: currentSelection.endLineNumber,
          column: currentSelection.endColumn,
        },
        preference: [
          monaco.editor.ContentWidgetPositionPreference.BELOW,
          monaco.editor.ContentWidgetPositionPreference.ABOVE,
        ],
      };
    },
  };

  /** Move the floating Explain/Debug menu to whichever editor owns the selection. */
  function ensureHostEditor(monacoEditor) {
    if (!monacoEditor || !widgetNode || !contentWidget) return;
    if (editorInstance === monacoEditor) return;
    try {
      if (editorInstance) editorInstance.removeContentWidget(contentWidget);
    } catch (_) {}
    editorInstance = monacoEditor;
    if (typeof monacoEditor.getId === "function") {
      widgetId = "buildex.selectionMenu." + String(monacoEditor.getId());
    } else {
      widgetId = "buildex.selectionMenu";
    }
    try {
      monacoEditor.addContentWidget(contentWidget);
    } catch (_) {}
  }

  function init(editor) {
    if (!editor || typeof monaco === "undefined") return;
    editorInstance = editor;

    widgetNode = document.createElement("div");
    widgetNode.className = "selection-menu-widget";
    widgetNode.innerHTML = `
      <button class="sel-btn" data-action="learn" title="Add to chat (Cmd+Shift+L)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        Add
      </button>
      <div class="sel-divider"></div>
      <button class="sel-btn" data-action="explain" title="Explain (Cmd+Shift+E)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
        Explain
      </button>
      <div class="sel-divider"></div>
      <button class="sel-btn" data-action="debug" title="Debug (Cmd+Shift+D)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="m8 2 1.88 1.88"></path><path d="M14.12 3.88 16 2"></path><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path><path d="M12 20v-9"></path><path d="M6.53 9C4.6 8.8 3 7.1 3 5"></path><path d="M6 13H2"></path><path d="M3 21c0-2.1 1.7-3.9 3.8-4"></path><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"></path><path d="M22 13h-4"></path><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"></path></svg>
        Debug
      </button>
    `;

    widgetNode.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    widgetNode.addEventListener("click", (e) => {
      const btn = e.target.closest(".sel-btn");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "learn" && typeof learnSelectedCode === "function")
        learnSelectedCode();
      if (action === "explain" && typeof explainSelectedCode === "function")
        explainSelectedCode();
      if (action === "debug" && typeof debugSelectedCode === "function")
        debugSelectedCode();
      hide();
    });

    widgetId =
      typeof editor.getId === "function"
        ? "buildex.selectionMenu." + String(editor.getId())
        : "buildex.selectionMenu";
    editor.addContentWidget(contentWidget);
  }

  function show(selection) {
    if (!editorInstance || !widgetNode) return;
    currentSelection = selection;
    editorInstance.layoutContentWidget(contentWidget);
    widgetNode.classList.add("visible");
  }

  function hide() {
    if (!editorInstance || !widgetNode) return;
    currentSelection = null;
    editorInstance.layoutContentWidget(contentWidget);
    widgetNode.classList.remove("visible");
  }

  return { init, show, hide, ensureHostEditor };
})();

/* ============================================================
 * Selection — track Monaco editor selection metadata
 * Used by Explain/Debug shortcuts and the project context.
 * ============================================================ */
const Selection = (() => {
  let current = null;
  const registeredEditors = new WeakSet();

  function normalizeFilePath(raw) {
    const fromModel = raw || "";
    const real = realPathFromTab(fromModel) || fromModel;
    return real || null;
  }

  function wireEditor(monacoEditor, withFloatingMenu) {
    if (!monacoEditor || registeredEditors.has(monacoEditor)) return;
    registeredEditors.add(monacoEditor);
    if (withFloatingMenu && typeof SelectionMenu !== "undefined")
      SelectionMenu.init(monacoEditor);
    monacoEditor.onDidChangeCursorSelection((e) => {
      try {
        const sel = e.selection;
        const model = monacoEditor.getModel();
        if (!model) {
          current = null;
          return;
        }

        const rawFp = state.modelPathById.get(model.id) || state.activeFile;
        const filePathNorm = normalizeFilePath(rawFp);
        const fileName = filePathNorm ? filePathNorm.split("/").pop() : null;

        if (
          sel.startLineNumber === sel.endLineNumber &&
          sel.startColumn === sel.endColumn
        ) {
          if (typeof SelectionMenu !== "undefined") SelectionMenu.hide();
          current = rawFp
            ? {
                filePath: filePathNorm,
                fileName,
                startLine: sel.startLineNumber,
                endLine: sel.endLineNumber,
                cursorLine: sel.positionLineNumber,
                code: "",
                surrounding: "",
                imports: [],
                empty: true,
              }
            : null;
          return;
        }

        if (typeof SelectionMenu !== "undefined") {
          SelectionMenu.ensureHostEditor(monacoEditor);
          SelectionMenu.show(sel);
        }

        const text = model.getValueInRange(sel);
        const startLine = sel.startLineNumber;
        const endLine = sel.endLineNumber;
        const padTop = Math.max(1, startLine - 6);
        const padBot = Math.min(model.getLineCount(), endLine + 6);
        const surrounding = model.getValueInRange({
          startLineNumber: padTop,
          startColumn: 1,
          endLineNumber: padBot,
          endColumn: model.getLineMaxColumn(padBot),
        });
        const imports = extractImports(model);
        current = {
          filePath: filePathNorm,
          fileName,
          startLine,
          endLine,
          code: text,
          surrounding,
          imports,
          empty: false,
        };
      } catch (_) {
        current = null;
      }
    });
  }

  function attach(monacoEditor) {
    wireEditor(monacoEditor, true);
  }

  /** Call after diffEditor is constructed so Explain/Debug work in comparison view. */
  function attachDiffPanes(diff) {
    if (!diff || typeof diff.getModifiedEditor !== "function") return;
    wireEditor(diff.getModifiedEditor(), false);
    if (typeof diff.getOriginalEditor === "function") {
      wireEditor(diff.getOriginalEditor(), false);
    }
  }

  function extractImports(model) {
    try {
      const total = Math.min(model.getLineCount(), 80);
      const imports = [];
      for (let i = 1; i <= total; i++) {
        const line = model.getLineContent(i);
        if (
          /^\s*(import|from\s+["'][^"']+["']\s+import|require\(|#include\s+)/.test(
            line,
          )
        ) {
          imports.push(line.trim());
        }
      }
      return imports.slice(0, 25);
    } catch (_) {
      return [];
    }
  }

  function snapshot() {
    return current;
  }
  function hasSelection() {
    return !!(current && !current.empty && current.code);
  }

  return { attach, attachDiffPanes, snapshot, hasSelection };
})();

/* ============================================================
 * ProjectContext — lightweight project intelligence
 * Aggregates project structure, deps, framework hints, recent
 * terminal output, and the current selection so the AI can
 * answer with grounded awareness.
 * ============================================================ */
const ProjectContext = (() => {
  const recentTerminalLogs = []; // ring buffer of plain-text lines
  const TERMINAL_LOG_MAX = 200;

  // ANSI color stripper
  const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

  function noteTerminalOutput(text) {
    if (!text) return;
    const clean = String(text).replace(ANSI_RE, "");
    if (!clean.trim()) return;
    for (const line of clean.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      recentTerminalLogs.push(t);
      while (recentTerminalLogs.length > TERMINAL_LOG_MAX)
        recentTerminalLogs.shift();
    }
  }

  function getRecentTerminalLogs(n = 60) {
    return recentTerminalLogs.slice(-n);
  }

  function detectErrorsInLogs(n = 60) {
    const lines = getRecentTerminalLogs(n);
    return lines
      .filter((l) =>
        /\b(error|err|exception|fail(ed|ure)?|cannot find|undefined is not|TypeError|SyntaxError|ReferenceError|ENOENT|EACCES|EADDRINUSE|stack|traceback)\b/i.test(
          l,
        ),
      )
      .slice(-30);
  }

  async function readProjectStructure(maxDepth = 3, maxEntries = 200) {
    const root = state.workspaceRoot;
    if (!root) return null;
    const tree = [];
    let count = 0;
    const ignore = new Set([
      ".git",
      "node_modules",
      "dist",
      "build",
      ".next",
      ".cache",
      "coverage",
      "__pycache__",
      ".turbo",
      ".parcel-cache",
    ]);

    async function walk(dir, depth, prefix) {
      if (count >= maxEntries) return;
      if (depth > maxDepth) return;
      let entries;
      try {
        entries = await window.electronAPI.readDir(dir);
      } catch (_) {
        return;
      }
      if (!Array.isArray(entries)) return;
      // Sort: dirs first
      entries.sort(
        (a, b) =>
          (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) ||
          a.name.localeCompare(b.name),
      );
      for (const e of entries) {
        if (count >= maxEntries) return;
        if (ignore.has(e.name)) continue;
        if (e.name.startsWith(".") && depth === 0 && e.name !== ".env.example")
          continue;
        const rel = prefix ? prefix + "/" + e.name : e.name;
        tree.push((e.isDirectory ? "[DIR] " : "      ") + rel);
        count++;
        if (e.isDirectory) await walk(e.path, depth + 1, rel);
      }
    }
    await walk(root, 0, "");
    return tree;
  }

  async function readPackageJson() {
    if (!state.workspaceRoot) return null;
    try {
      const pkgPath = state.workspaceRoot + "/package.json";
      const r = await window.electronAPI.readFile(pkgPath);
      if (!r || !r.ok) return null;
      const json = JSON.parse(r.content);
      return {
        name: json.name,
        version: json.version,
        scripts: json.scripts || {},
        dependencies: Object.keys(json.dependencies || {}),
        devDependencies: Object.keys(json.devDependencies || {}),
      };
    } catch (_) {
      return null;
    }
  }

  function detectFramework(pkg) {
    if (!pkg) return null;
    const all = new Set([
      ...(pkg.dependencies || []),
      ...(pkg.devDependencies || []),
    ]);
    if (all.has("next")) return "Next.js";
    if (all.has("@remix-run/react")) return "Remix";
    if (all.has("astro")) return "Astro";
    if (all.has("@sveltejs/kit")) return "SvelteKit";
    if (all.has("nuxt") || all.has("nuxt3")) return "Nuxt";
    if (all.has("vite") && all.has("react")) return "Vite + React";
    if (all.has("vite") && all.has("vue")) return "Vite + Vue";
    if (all.has("vite") && all.has("svelte")) return "Vite + Svelte";
    if (all.has("vite") && all.has("typescript"))
      return "Vite + TypeScript (vanilla)";
    if (all.has("vite")) return "Vite (vanilla)";
    if (all.has("react-native")) return "React Native";
    if (all.has("expo")) return "Expo";
    if (all.has("react")) return "React";
    if (all.has("vue")) return "Vue";
    if (all.has("electron")) return "Electron";
    if (all.has("express") || all.has("koa") || all.has("fastify"))
      return "Node API";
    return null;
  }

  // Inspect the project tree to classify the primary source language by
  // counting file extensions inside src/ (or root if no src/).
  function detectPrimaryLanguage(tree) {
    if (!tree || !tree.length) return null;
    const counts = {
      ts: 0,
      tsx: 0,
      js: 0,
      jsx: 0,
      vue: 0,
      svelte: 0,
      py: 0,
      go: 0,
      rs: 0,
    };
    for (const line of tree) {
      const m = /\.([a-zA-Z0-9]+)$/.exec(line);
      if (!m) continue;
      const ext = m[1].toLowerCase();
      if (ext in counts) counts[ext]++;
    }
    const ts = counts.ts + counts.tsx;
    const js = counts.js + counts.jsx;
    if (
      ts === 0 &&
      js === 0 &&
      !counts.vue &&
      !counts.svelte &&
      !counts.py &&
      !counts.go &&
      !counts.rs
    )
      return null;
    if (ts > js && counts.tsx > 0) return "TypeScript + JSX (.tsx)";
    if (ts > js) return "TypeScript (.ts)";
    if (js > ts && counts.jsx > 0) return "JavaScript + JSX (.jsx)";
    if (js > ts) return "JavaScript (.js)";
    if (counts.vue) return "Vue SFC (.vue)";
    if (counts.svelte) return "Svelte (.svelte)";
    if (counts.py) return "Python (.py)";
    if (counts.go) return "Go (.go)";
    if (counts.rs) return "Rust (.rs)";
    return null;
  }

  async function build({
    includeStructure = true,
    includeSelection = true,
  } = {}) {
    const ctx = {
      workspaceRoot: state.workspaceRoot,
      activeFile: state.activeFile,
      openFiles: Array.from(state.openFiles.keys()).map((p) => ({
        path: p,
        name: state.openFiles.get(p)?.name,
        dirty: !!state.openFiles.get(p)?.dirty,
      })),
      theme: state.theme,
      mode: state.chatMode,
      uiModel: state.chatModel,
    };
    if (includeStructure) {
      const [tree, pkg] = await Promise.all([
        readProjectStructure(),
        readPackageJson(),
      ]);
      ctx.projectStructure = tree;
      ctx.dependencies = pkg;
      ctx.framework = detectFramework(pkg);
      ctx.primaryLanguage = detectPrimaryLanguage(tree);
    }
    if (includeSelection) {
      if (Selection.hasSelection()) {
        ctx.selectedCode = Selection.snapshot();
      } else if (state.stickyIdeSelection) {
        refreshStickyIdeSelectionIfPossible();
        ctx.selectedCode = state.stickyIdeSelection;
      }
    }
    ctx.recentTerminalLogs = getRecentTerminalLogs(20);
    if (state.chatMode === "debug") {
      ctx.terminalErrors = detectErrorsInLogs(80);
    }
    return ctx;
  }

  function toPromptString(ctx) {
    if (!ctx) return "";
    const lines = [];
    lines.push(
      "# IDE Context (ground truth — verify every path against this before answering)",
    );
    if (ctx.workspaceRoot) lines.push(`Workspace: ${ctx.workspaceRoot}`);
    if (ctx.framework) lines.push(`Framework: ${ctx.framework}`);
    if (ctx.primaryLanguage) {
      lines.push(`Primary language: ${ctx.primaryLanguage}`);
      // Give the model a hard, explicit instruction about which extension to use.
      const langHint = ctx.primaryLanguage;
      let extHint = "";
      if (/TypeScript \+ JSX/.test(langHint))
        extHint =
          "Use .tsx for components and .ts for plain modules. Do NOT suggest .jsx or .js files.";
      else if (/TypeScript/.test(langHint))
        extHint = "Use .ts files. Do NOT suggest .js or .jsx files.";
      else if (/JavaScript \+ JSX/.test(langHint))
        extHint =
          "Use .jsx for components and .js for plain modules. Do NOT suggest .tsx or .ts files.";
      else if (/JavaScript/.test(langHint))
        extHint =
          "Use .js files. Do NOT suggest .ts or .tsx unless the user adds TS first.";
      else if (/Vue SFC/.test(langHint))
        extHint = "Use .vue single-file components.";
      else if (/Svelte/.test(langHint)) extHint = "Use .svelte components.";
      if (extHint) lines.push(`Extension policy: ${extHint}`);
    }
    if (ctx.activeFile) lines.push(`Active file: ${ctx.activeFile}`);
    if (ctx.openFiles && ctx.openFiles.length) {
      lines.push(
        "Open tabs: " +
          ctx.openFiles.map((f) => f.name + (f.dirty ? "*" : "")).join(", "),
      );
    }
    if (ctx.dependencies) {
      const pkg = ctx.dependencies;
      lines.push(
        `package.json: ${pkg.name || "(unnamed)"}@${pkg.version || "?"}`,
      );
      if (pkg.dependencies?.length)
        lines.push("Deps: " + pkg.dependencies.slice(0, 30).join(", "));
      if (pkg.devDependencies?.length)
        lines.push("DevDeps: " + pkg.devDependencies.slice(0, 20).join(", "));
      const scripts = Object.keys(pkg.scripts || {});
      if (scripts.length)
        lines.push("Scripts: " + scripts.slice(0, 12).join(", "));
    }
    if (ctx.projectStructure) {
      if (ctx.projectStructure.length === 0) {
        lines.push(
          "Project tree: ⚠️ WORKSPACE IS EMPTY — there are NO files in this folder yet.",
        );
        lines.push(
          '  → Do NOT ask the user "what do you see in the folder" or "is this empty?". You already know it is empty.',
        );
        lines.push(
          "  → Offer to initialize a project based on what they want to build (e.g. \`npm init\`, \`pip install\`, or just creating \`main.py\`).",
        );
      } else {
        lines.push(
          `Project tree (${ctx.projectStructure.length} entries — REAL files; do not invent paths outside this list):`,
        );
        lines.push("```");
        lines.push(ctx.projectStructure.slice(0, 120).join("\n"));
        lines.push("```");
      }
    }
    if (ctx.selectedCode && !ctx.selectedCode.empty) {
      const s = ctx.selectedCode;
      lines.push(
        `Selected code from ${s.fileName} (lines ${s.startLine}-${s.endLine}):`,
      );
      lines.push("```");
      lines.push(s.code);
      lines.push("```");
      if (s.surrounding && s.surrounding !== s.code) {
        lines.push("Surrounding context:");
        lines.push("```");
        lines.push(s.surrounding);
        lines.push("```");
      }
      lines.push(
        "This block is anchored for Explain/Debug follow-ups — the Monaco highlight may have collapsed while the user used the sidebar, but the text above reflects the CURRENT buffer for those line numbers.",
      );
      lines.push(
        "Do NOT ask the user to paste or re-select the same lines unless they say the snippet is wrong/outdated.",
      );
    }
    if (ctx.terminalErrors && ctx.terminalErrors.length) {
      lines.push("Recent terminal errors:");
      lines.push("```");
      lines.push(ctx.terminalErrors.join("\n"));
      lines.push("```");
    } else if (
      ctx.recentTerminalLogs &&
      ctx.recentTerminalLogs.length &&
      state.chatMode === "debug"
    ) {
      lines.push("Recent terminal output:");
      lines.push("```");
      lines.push(ctx.recentTerminalLogs.join("\n"));
      lines.push("```");
    }
    return lines.join("\n");
  }

  return {
    build,
    toPromptString,
    noteTerminalOutput,
    getRecentTerminalLogs,
    detectErrorsInLogs,
  };
})();

/* ============================================================
 * Markdown — minimal, safe markdown-to-HTML for chat messages
 * Handles code fences (incl. buildex-step), inline code, bold,
 * italic, lists, headers, and links.
 * ============================================================ */
const Markdown = (() => {
  // Normalize a buildex-step object — accept the documented field names
  // AND common aliases the AI sometimes emits (startLine/endLine instead
  // of from/to, text instead of phrase, absolute paths, etc.).
  function normalizeStep(raw) {
    if (!raw || typeof raw !== "object") return raw;
    const s = { ...raw };

    // lineRanges aliases
    if (Array.isArray(s.lineRanges)) {
      s.lineRanges = s.lineRanges.map((r) => {
        if (!r || typeof r !== "object") return r;
        const n = { ...r };
        if (n.from === undefined && n.startLine !== undefined)
          n.from = n.startLine;
        if (n.to === undefined && n.endLine !== undefined) n.to = n.endLine;
        if (n.from === undefined && n.line !== undefined) n.from = n.line;
        if (n.from === undefined && n.lineNumber !== undefined)
          n.from = n.lineNumber;
        if (n.to === undefined) n.to = n.from;
        return n;
      });
    }
    // inlineHighlights aliases
    if (Array.isArray(s.inlineHighlights)) {
      s.inlineHighlights = s.inlineHighlights.map((h) => {
        if (!h || typeof h !== "object") return h;
        const n = { ...h };
        if (n.phrase === undefined && n.text !== undefined) n.phrase = n.text;
        if (n.phrase === undefined && n.term !== undefined) n.phrase = n.term;
        if (n.phrase === undefined && n.word !== undefined) n.phrase = n.word;
        return n;
      });
    }
    // subSteps aliases
    if (Array.isArray(s.subSteps)) {
      s.subSteps = s.subSteps.map((x) => {
        if (!x || typeof x !== "object") return x;
        const n = { ...x };
        if (n.title === undefined && n.label !== undefined) n.title = n.label;
        if (n.title === undefined && n.text !== undefined) n.title = n.text;
        return n;
      });
    }
    // inlineEdit aliases — accept was/now, old/new, find/replace as well
    if (s.inlineEdit && typeof s.inlineEdit === "object") {
      const ie = { ...s.inlineEdit };
      if (ie.before === undefined) {
        if (ie.was !== undefined) ie.before = ie.was;
        else if (ie.old !== undefined) ie.before = ie.old;
        else if (ie.find !== undefined) ie.before = ie.find;
        else if (ie.from !== undefined && typeof ie.from === "string")
          ie.before = ie.from;
      }
      if (ie.after === undefined) {
        if (ie.now !== undefined) ie.after = ie.now;
        else if (ie.new !== undefined) ie.after = ie.new;
        else if (ie.replace !== undefined) ie.after = ie.replace;
        else if (ie.to !== undefined && typeof ie.to === "string")
          ie.after = ie.to;
      }
      if (ie.hint === undefined) {
        if (ie.note !== undefined) ie.hint = ie.note;
        else if (ie.description !== undefined) ie.hint = ie.description;
      }
      s.inlineEdit = ie;
    }
    // choices aliases
    if (Array.isArray(s.choices)) {
      s.choices = s.choices.map((c) => {
        if (!c || typeof c !== "object") return c;
        const n = { ...c };
        if (n.label === undefined && n.text !== undefined) n.label = n.text;
        if (n.label === undefined && n.title !== undefined) n.label = n.title;
        return n;
      });
    }
    // Strip workspace prefix from absolute targetFile paths
    if (
      typeof s.targetFile === "string" &&
      typeof state !== "undefined" &&
      state.workspaceRoot
    ) {
      const root = state.workspaceRoot.replace(/\/$/, "");
      if (s.targetFile.startsWith(root + "/")) {
        s.targetFile = s.targetFile.slice(root.length + 1);
      } else if (s.targetFile === root) {
        s.targetFile = "";
      }
    }
    return s;
  }

  // Some models ignore the "emit fenced ```buildex-step blocks" instruction
  // and instead return a single JSON object like { explanation, steps:[...] }.
  // Detect that and rewrite the source so the rest of the pipeline sees
  // proper fenced blocks.
  function tryRecoverJsonResponse(text) {
    let modified = String(text);
    let rewritten = false;

    function findBlocks(str) {
      const blocks = [];
      let depth = 0;
      let start = -1;
      let inString = false;
      let escape = false;
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === "\\") {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (c === "{" || c === "[") {
            if (depth === 0) start = i;
            depth++;
          } else if (c === "}" || c === "]") {
            depth--;
            if (depth === 0 && start !== -1) {
              blocks.push({
                start,
                end: i + 1,
                text: str.substring(start, i + 1),
              });
              start = -1;
            }
          }
        }
      }
      return blocks;
    }

    const blocks = findBlocks(modified);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const { start, end, text: blockText } = blocks[i];
      // Skip if already fenced
      const prefix = modified.substring(Math.max(0, start - 25), start);
      if (prefix.includes("buildex-step")) continue;

      if (
        blockText.includes('"stepTitle"') ||
        blockText.includes('"actionType"') ||
        blockText.includes('"lineRanges"')
      ) {
        try {
          const obj = JSON.parse(blockText);
          if (Array.isArray(obj)) {
            const out = obj
              .map((o) => "```buildex-step\n" + JSON.stringify(o) + "\n```")
              .join("\n\n");
            modified =
              modified.slice(0, start) +
              "\n" +
              out +
              "\n" +
              modified.slice(end);
            rewritten = true;
          } else if (obj && obj.steps && Array.isArray(obj.steps)) {
            const out = obj.steps
              .map((o) => "```buildex-step\n" + JSON.stringify(o) + "\n```")
              .join("\n\n");
            modified =
              modified.slice(0, start) +
              "\n" +
              out +
              "\n" +
              modified.slice(end);
            rewritten = true;
          } else if (
            obj &&
            (obj.stepTitle || obj.actionType || obj.lineRanges)
          ) {
            modified =
              modified.slice(0, start) +
              "\n```buildex-step\n" +
              blockText +
              "\n```\n" +
              modified.slice(end);
            rewritten = true;
          }
        } catch (_) {}
      }
    }
    return rewritten ? modified : null;
  }

  function render(input, opts = {}) {
    if (!input) return { html: "", steps: [], aiCommands: [] };
    const allowCopy = opts.allowCopy !== false;
    const placeholders = [];
    const steps = [];
    const aiCommands = [];
    let src = String(input);

    // 0. Recover from raw-JSON responses by rewriting them into the
    //    canonical fenced-block format. Failures (mid-stream / malformed)
    //    silently pass through.
    const recovered = tryRecoverJsonResponse(src);
    if (recovered) src = recovered;

    // 1. Extract fenced code blocks first (incl. buildex-step)
    src = src.replace(
      /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
      (m, lang, code) => {
        lang = (lang || "").trim().toLowerCase();
        if (lang === "buildex-step") {
          try {
            const obj = normalizeStep(JSON.parse(code.trim()));
            steps.push(obj);
            const idx = placeholders.length;
            placeholders.push({
              kind: "step",
              html: "" /* filled later by caller */,
              step: obj,
            });
            return `\u0000PLACEHOLDER_${idx}\u0000`;
          } catch (_) {
            // Fall through to a normal code block on parse failure
          }
        }
        const idx = placeholders.length;
        const codeHtml = `<pre class="md-pre" data-lang="${escapeAttr(lang)}"><code>${escapeHtml(code)}</code>${allowCopy ? '<button class="md-copy" type="button" title="Copy">Copy</button>' : ""}</pre>`;
        placeholders.push({ kind: "code", html: codeHtml });
        return `\u0000PLACEHOLDER_${idx}\u0000`;
      },
    );

    // 1.5 Extract AI Repo & Editor Control Commands (/pop, /fetch, /open, /highlight)
    // Pattern 1: Colon format e.g. /pop:src/App.tsx:15:State definition
    src = src.replace(
      /(?:^|\s)(\/(?:pop|fetch|open|highlight):([^\s\n:]+)(?::([0-9]+(?:-[0-9]+)?))?(?::([^\n]+))?)(?=\s|$)/g,
      (match, fullCmd, path, lines, msg) => {
        const cmdType = fullCmd.split(":")[0].slice(1);
        const commandObj = {
          type: cmdType,
          path: path.trim(),
          lines: (lines || "").trim(),
          msg: (msg || "").trim()
        };
        aiCommands.push(commandObj);
        
        let icon = "📍";
        let label = `${commandObj.path}${commandObj.lines ? `:${commandObj.lines}` : ""}`;
        let extra = commandObj.msg ? `<span class="ai-cmd-desc">${escapeHtml(commandObj.msg)}</span>` : "";
        if (cmdType === "fetch") icon = "📎";
        else if (cmdType === "open") icon = "📂";
        else if (cmdType === "highlight") icon = "✨";

        const idx = placeholders.length;
        const pillHtml = `<button type="button" class="ai-cmd-pill ai-cmd-${cmdType}" data-ai-cmd="${escapeAttr(cmdType)}" data-file="${escapeAttr(commandObj.path)}" data-lines="${escapeAttr(commandObj.lines)}" data-msg="${escapeAttr(commandObj.msg)}"><span class="ai-cmd-icon">${icon}</span><span class="ai-cmd-label">${escapeHtml(label)}</span>${extra}</button>`;
        placeholders.push({ kind: "pill", html: pillHtml });
        return ` \u0000PLACEHOLDER_${idx}\u0000 `;
      }
    );

    // Pattern 2: Space format e.g. /pop src/App.tsx:15 State definition
    src = src.replace(
      /(?:^|\s)(\/(?:pop|fetch|open|highlight)\s+([a-zA-Z0-9_./\\-]+)(?::([0-9]+(?:-[0-9]+)?))?(?:\s+([^\n]+))?)(?=\n|$)/g,
      (match, fullCmd, path, lines, msg) => {
        const cmdType = fullCmd.trim().split(/\s+/)[0].slice(1);
        const commandObj = {
          type: cmdType,
          path: path.trim(),
          lines: (lines || "").trim(),
          msg: (msg || "").trim()
        };
        aiCommands.push(commandObj);

        let icon = "📍";
        let label = `${commandObj.path}${commandObj.lines ? `:${commandObj.lines}` : ""}`;
        let extra = commandObj.msg ? `<span class="ai-cmd-desc">${escapeHtml(commandObj.msg)}</span>` : "";
        if (cmdType === "fetch") icon = "📎";
        else if (cmdType === "open") icon = "📂";
        else if (cmdType === "highlight") icon = "✨";

        const idx = placeholders.length;
        const pillHtml = `<button type="button" class="ai-cmd-pill ai-cmd-${cmdType}" data-ai-cmd="${escapeAttr(cmdType)}" data-file="${escapeAttr(commandObj.path)}" data-lines="${escapeAttr(commandObj.lines)}" data-msg="${escapeAttr(commandObj.msg)}"><span class="ai-cmd-icon">${icon}</span><span class="ai-cmd-label">${escapeHtml(label)}</span>${extra}</button>`;
        placeholders.push({ kind: "pill", html: pillHtml });
        return ` \u0000PLACEHOLDER_${idx}\u0000 `;
      }
    );

    // 2. Escape remaining HTML
    src = escapeHtml(src);

    // 3. Headers
    src = src.replace(/^######\s+(.*)$/gm, "<h6>$1</h6>");
    src = src.replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>");
    src = src.replace(/^####\s+(.*)$/gm, "<h4>$1</h4>");
    src = src.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
    src = src.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
    src = src.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");

    // 4. Inline: bold, italic, inline code, links
    src = src.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');
    src = src.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    src = src.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    src = src.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
      return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${text}</a>`;
    });

    // 5. Lists (very basic)
    src = src.replace(/(^|\n)((?:[-*]\s+.+(?:\n|$))+)/g, (m, lead, block) => {
      const items = block
        .trim()
        .split(/\n/)
        .map((l) => l.replace(/^[-*]\s+/, ""))
        .map((l) => `<li>${l}</li>`)
        .join("");
      return `${lead}<ul class="md-ul">${items}</ul>`;
    });
    src = src.replace(/(^|\n)((?:\d+\.\s+.+(?:\n|$))+)/g, (m, lead, block) => {
      const items = block
        .trim()
        .split(/\n/)
        .map((l) => l.replace(/^\d+\.\s+/, ""))
        .map((l) => `<li>${l}</li>`)
        .join("");
      return `${lead}<ol class="md-ol">${items}</ol>`;
    });

    // 6. Paragraphs / line breaks
    src = src
      .split(/\n{2,}/)
      .map((p) => {
        if (/^\s*<(h\d|ul|ol|pre|blockquote)/.test(p)) return p;
        if (!p.trim()) return "";
        return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
      })
      .join("\n");

    // 7. Restore placeholders
    src = src.replace(/\u0000PLACEHOLDER_(\d+)\u0000/g, (_m, idx) => {
      const ph = placeholders[parseInt(idx, 10)];
      if (!ph) return "";
      if (ph.kind === "step")
        return `<div data-step-placeholder="${idx}"></div>`;
      return ph.html;
    });

    return { html: src, steps, placeholders, aiCommands };
  }

  function escapeAttr(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  return { render };
})();

/* ============================================================
 * Guide — visual highlighter, tooltips, step cards
 * Lets the AI point at IDE elements and walk the user through
 * tasks. Targets are CSS selectors or element IDs (e.g.
 * "#new-file-btn", "[data-view='git']", ".terminal-tab").
 * ============================================================ */
const Guide = (() => {
  let current = null;

  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target !== "string") return null;
    // Treat plain id-looking strings as IDs
    let el = null;
    if (/^[a-zA-Z][\w-]*$/.test(target)) {
      el = document.getElementById(target) || document.querySelector(target);
    }
    if (!el) {
      try {
        el = document.querySelector(target);
      } catch (_) {}
    }
    if (!el && target.startsWith("#")) {
      el = document.getElementById(target.slice(1));
    }
    return el;
  }

  function clear() {
    if (!current) return;
    current.ring && current.ring.remove();
    current.tooltip && current.tooltip.remove();
    current.cleanup && current.cleanup();
    current = null;
  }

  function highlight(target, options = {}) {
    clear();
    const el = resolveTarget(target);
    if (!el) {
      if (options.tooltip) showFloatingMessage(options.tooltip);
      return null;
    }
    el.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    const ring = document.createElement("div");
    ring.className = "guide-ring" + (options.pulse !== false ? " pulse" : "");
    document.body.appendChild(ring);

    let tooltip = null;
    if (options.tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "guide-tooltip";
      const arrow = document.createElement("div");
      arrow.className = "guide-arrow";
      const body = document.createElement("div");
      body.className = "guide-tooltip-body";
      body.textContent = options.tooltip;
      const close = document.createElement("button");
      close.className = "guide-tooltip-close";
      close.textContent = "×";
      close.addEventListener("click", clear);
      tooltip.append(arrow, body, close);
      document.body.appendChild(tooltip);
    }

    function position() {
      const r = el.getBoundingClientRect();
      const pad = 6;
      Object.assign(ring.style, {
        left: r.left - pad + "px",
        top: r.top - pad + "px",
        width: r.width + pad * 2 + "px",
        height: r.height + pad * 2 + "px",
      });
      if (tooltip) {
        const tipW = Math.min(280, window.innerWidth - 32);
        tooltip.style.maxWidth = tipW + "px";
        const tipRect = tooltip.getBoundingClientRect();
        let left = Math.max(
          8,
          Math.min(
            window.innerWidth - tipW - 8,
            r.left + r.width / 2 - tipW / 2,
          ),
        );
        let top = r.bottom + 12;
        if (top + tipRect.height > window.innerHeight - 8) {
          top = Math.max(8, r.top - tipRect.height - 12);
          tooltip.classList.add("above");
        } else {
          tooltip.classList.remove("above");
        }
        tooltip.style.left = left + "px";
        tooltip.style.top = top + "px";
      }
    }
    position();
    const onResize = () => position();
    const onScroll = () => position();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    const cleanup = () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };

    let timeoutId = null;
    if (options.duration) {
      timeoutId = setTimeout(clear, options.duration);
    }

    current = { el, ring, tooltip, cleanup };
    return { clear };
  }

  function showFloatingMessage(text, ms = 2200) {
    const t = document.createElement("div");
    t.className = "guide-floating";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("out"), Math.max(200, ms - 300));
    setTimeout(() => t.remove(), ms);
  }

  /* Step cards rendered inside chat messages (Collapsible Antigravity Style) */
  function renderStepCard(step) {
    const card = document.createElement("details");
    card.className =
      "step-card mode-" + (step.mode || state.chatMode || "learn");
    
    // Default open if code snippet is present or only single step, else cleanly collapsed
    card.open = true;

    const summary = document.createElement("summary");
    summary.className = "step-card-header";

    const left = document.createElement("div");
    left.className = "step-card-header-left";

    const icon = document.createElement("span");
    icon.className = "step-card-icon";
    icon.textContent = stepIcon(step.actionType);

    const title = document.createElement("div");
    title.className = "step-card-title";
    title.textContent = step.stepTitle || "Step";

    left.append(icon, title);

    if (step.targetFile) {
      const fileChip = document.createElement("span");
      fileChip.className = "step-card-header-file";
      fileChip.textContent = step.targetFile.split("/").pop();
      fileChip.title = step.targetFile;
      left.appendChild(fileChip);
    }

    const right = document.createElement("div");
    right.className = "step-card-header-right";

    // Quick open file / run button in header
    if (step.targetFile && state.workspaceRoot) {
      const quickBtn = document.createElement("button");
      quickBtn.className = "step-card-quick-btn";
      quickBtn.innerHTML = `<span>Open</span>`;
      quickBtn.title = `Open ${step.targetFile}`;
      quickBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const full = step.targetFile.startsWith("/")
          ? step.targetFile
          : state.workspaceRoot.replace(/\/$/, "") +
            "/" +
            step.targetFile.replace(/^\//, "");
        try {
          if (state.openFiles && state.openFiles.has(full)) {
            setActiveFile(full);
          } else {
            await openFile(full);
          }
        } catch (_) {
          showToast("Could not open " + step.targetFile, "error", 1800);
        }
      });
      right.appendChild(quickBtn);
    }

    const chevron = document.createElement("span");
    chevron.className = "step-card-chevron";
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    right.appendChild(chevron);

    summary.append(left, right);

    const body = document.createElement("div");
    body.className = "step-card-body";

    if (step.explanation) {
      const p = document.createElement("p");
      p.className = "step-card-explain";
      p.textContent = step.explanation;
      body.appendChild(p);
    }

    const meta = document.createElement("div");
    meta.className = "step-card-meta";
    if (step.targetFile) {
      const m = document.createElement("span");
      m.className = "step-card-chip";
      m.innerHTML = `<span class="chip-key">file</span> <code>${escapeHtml(step.targetFile)}</code>`;
      meta.appendChild(m);
    }
    if (
      step.insertionLocation &&
      typeof step.insertionLocation.afterLine === "number"
    ) {
      const m = document.createElement("span");
      m.className = "step-card-chip";
      m.innerHTML = `<span class="chip-key">after line</span> <code>${step.insertionLocation.afterLine}</code>`;
      meta.appendChild(m);
    }
    if (step.targetElement) {
      const m = document.createElement("span");
      m.className = "step-card-chip";
      m.innerHTML = `<span class="chip-key">target</span> <code>${escapeHtml(step.targetElement)}</code>`;
      meta.appendChild(m);
    }
    if (meta.children.length) body.appendChild(meta);

    if (step.codeSnippet) {
      const pre = document.createElement("pre");
      pre.className = "step-card-code";
      const code = document.createElement("code");
      code.textContent = step.codeSnippet;
      pre.appendChild(code);

      const codeHeader = document.createElement("div");
      codeHeader.className = "step-code-header";
      codeHeader.innerHTML = `<span>${escapeHtml(step.targetFile || "Code snippet")}</span><button class="step-code-copy">Copy</button>`;
      
      codeHeader.querySelector(".step-code-copy").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(step.codeSnippet);
        showToast("Code copied to clipboard", "success", 1500);
      });

      body.appendChild(codeHeader);
      body.appendChild(pre);
    }

    if (step.expectedResult) {
      const er = document.createElement("div");
      er.className = "step-card-expected";
      er.innerHTML = `<span class="chip-key">expected</span> ${escapeHtml(step.expectedResult)}`;
      body.appendChild(er);
    }

    card.append(summary, body);
    return card;
  }

  function stepIcon(actionType) {
    switch (actionType) {
      case "create_file":
        return "＋";
      case "open_file":
        return "↗";
      case "type_code":
        return "⌨";
      case "run_command":
        return "▶";
      case "click_button":
        return "☞";
      case "highlight":
        return "◎";
      default:
        return "•";
    }
  }

  function mkBtn(label, onClick) {
    const b = document.createElement("button");
    b.className = "step-card-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  return { highlight, clear, showFloatingMessage, renderStepCard };
})();

/* ============================================================
 * AIChat — orchestrates streaming chat with Pollinations
 * Replaces fakeReply with real, streaming, mode-aware AI calls.
 * ============================================================ */
const AIChat = (() => {
  let aiConfig = null;
  /** @type {Map<string, {bubbleEl: HTMLElement, bodyEl: HTMLElement, statusEl: HTMLElement, text: string, mode: string, cancelBtn: HTMLElement, mid: string}>} */
  const live = new Map();
  let currentStreamId = null;

  async function init() {
    try {
      aiConfig = await window.electronAPI.ai.config();
    } catch (_) {
      aiConfig = { hasKey: false };
    }
    window.electronAPI.ai.onChunk(({ messageId, delta }) => {
      const entry = live.get(messageId);
      if (!entry) return;
      entry.text += delta;
      // Show "stop" while streaming
      entry.bubbleEl.classList.add("streaming");
      entry.bodyEl.dataset.raw = entry.text;
      // Throttled re-render
      if (!entry.renderTimer) {
        entry.renderTimer = requestAnimationFrame(() => {
          entry.renderTimer = null;
          renderBubble(entry, /*final*/ false);
        });
      }
    });
    window.electronAPI.ai.onDone(({ messageId, text, aborted }) => {
      const entry = live.get(messageId);
      if (!entry) return;
      entry.text = text || entry.text;
      entry.bubbleEl.classList.remove("streaming");
      renderBubble(entry, /*final*/ true);
      // Persist into Chat history (replace pending placeholder)
      Chat.replacePending(
        messageId,
        entry.text || (aborted ? "_(stopped)_" : ""),
      );
      live.delete(messageId);
      if (currentStreamId === messageId) currentStreamId = null;
      updateComposerStreamingUI(false);
      if (!aborted && typeof AuthManager !== "undefined") {
        AuthManager.handleAiCompletion(state.chatModel, entry.text);
      }
    });
    window.electronAPI.ai.onError(({ messageId, message }) => {
      const entry = live.get(messageId);
      if (entry) {
        entry.text = (entry.text || "") + `\n\n_⚠ ${message}_`;
        entry.bubbleEl.classList.remove("streaming");
        entry.bubbleEl.classList.add("errored");
        renderBubble(entry, true);
        Chat.replacePending(messageId, entry.text);
        live.delete(messageId);
        if (currentStreamId === messageId) currentStreamId = null;
      } else {
        showToast(message || "AI error", "error", 3000);
      }
      updateComposerStreamingUI(false);
    });
  }

  async function executeAiCommand(cmdType, targetFile, linesStr, msg) {
    if (!targetFile) return;
    const fullPath = state.workspaceRoot
      ? (targetFile.startsWith("/") ? targetFile : `${state.workspaceRoot}/${targetFile}`)
      : targetFile;

    let fromLine = 1;
    let toLine = 1;
    if (linesStr) {
      if (linesStr.includes("-")) {
        const [s, e] = linesStr.split("-").map((n) => parseInt(n, 10));
        if (!isNaN(s)) fromLine = s;
        if (!isNaN(e)) toLine = e;
      } else {
        const n = parseInt(linesStr, 10);
        if (!isNaN(n)) {
          fromLine = n;
          toLine = n;
        }
      }
    }

    if (cmdType === "pop" || cmdType === "highlight") {
      try {
        if (typeof openFile === "function") {
          await openFile(fullPath);
        }
        const ed = getActiveCodeEditor();
        if (ed && ed.revealLineInCenter) {
          ed.revealLineInCenter(fromLine);
        }
        if (typeof ActiveStep !== "undefined") {
          ActiveStep.show(
            {
              actionType: "highlight",
              targetFile: targetFile,
              lineRanges: [{ from: fromLine, to: toLine }],
              stepTitle: `Line ${fromLine}${toLine > fromLine ? `–${toLine}` : ""} Highlight`,
              explanation: msg || "Targeted region in code",
            },
            state.chatMode || "learn",
          );
        }
        showToast(`📍 Popover shown on ${targetFile}:${fromLine}`, "info", 1800);
      } catch (err) {
        console.warn("Failed to pop editor line:", err);
      }
    } else if (cmdType === "open") {
      try {
        if (typeof openFile === "function") {
          await openFile(fullPath);
        }
        const ed = getActiveCodeEditor();
        if (ed && ed.revealLineInCenter) {
          ed.revealLineInCenter(fromLine);
        }
      } catch (err) {
        console.warn("Failed to open file:", err);
      }
    } else if (cmdType === "fetch") {
      try {
        const fileContent = await window.electronAPI.readFile(fullPath);
        if (typeof fileContent === "string") {
          const lines = fileContent.split("\n");
          const s = Math.max(1, fromLine);
          const e = Math.min(lines.length, toLine || lines.length);
          const sliced = lines.slice(s - 1, e).join("\n");
          const lang = targetFile.split(".").pop() || "txt";
          const tag = `[${lang.toUpperCase()} ${targetFile} #L${s}-${e}]`;
          const snippet = `\n\`\`\`${lang}\n// ${targetFile} (lines ${s}-${e})\n${sliced}\n\`\`\`\n`;
          state.contextSnippets = state.contextSnippets || {};
          state.contextSnippets[tag] = snippet;
          renderContextChips();
          showToast(`📎 Fetched ${targetFile} (${e - s + 1} lines)`, "success", 1800);
        }
      } catch (err) {
        console.warn("Failed to fetch file:", err);
      }
    }
  }

  function wireAiCommandPills(root) {
    root.querySelectorAll(".ai-cmd-pill").forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const cmd = btn.dataset.aiCmd;
        const file = btn.dataset.file;
        const lines = btn.dataset.lines;
        const msg = btn.dataset.msg;
        executeAiCommand(cmd, file, lines, msg);
      });
    });
  }

  function renderBubble(entry, final) {
    const allowCopy = Modes.meta(entry.mode).allowCopy;
    const { html, steps, aiCommands } = Markdown.render(entry.text, { allowCopy });
    entry.bodyEl.innerHTML =
      html || (final ? "" : '<span class="md-typing">…</span>');
    if (steps && steps.length) {
      const placeholders = entry.bodyEl.querySelectorAll(
        "[data-step-placeholder]",
      );
      placeholders.forEach((ph) => {
        const idx = parseInt(ph.dataset.stepPlaceholder, 10);
        const step = steps[idx];
        if (!step) return;
        const card = Guide.renderStepCard({ ...step, mode: entry.mode });
        ph.replaceWith(card);
      });
    }
    if (allowCopy) wireCopyButtons(entry.bodyEl);
    wireAiCommandPills(entry.bodyEl);

    // Auto-scroll if near bottom
    const history = $("chat-history");
    if (history) {
      const nearBottom =
        history.scrollTop + history.clientHeight >= history.scrollHeight - 80;
      if (nearBottom) history.scrollTop = history.scrollHeight;
    }
    // Always tear down Explain/Debug loading popover when this bot turn finishes
    if (final && typeof ActiveStep !== "undefined") ActiveStep.dismiss();
    // Hand parsed steps to ActiveStep — show() clears again then paints anchored walkthrough / popovers
    if (final && steps && steps.length && typeof ActiveStep !== "undefined") {
      if (entry.mode === "debug" && state.debugLineBounds) {
        warnDebugStepsOutOfBounds(steps, state.debugLineBounds);
      }
      ActiveStep.play(
        steps.map((s) => ({ ...s, mode: entry.mode })),
        entry.mode,
      );
    } else if (final && aiCommands && aiCommands.length > 0 && (!steps || steps.length === 0)) {
      // Auto-trigger the first pop/highlight command from AI if no buildex-steps were used
      const firstPop = aiCommands.find((c) => c.type === "pop" || c.type === "highlight");
      if (firstPop) {
        executeAiCommand(firstPop.type, firstPop.path, firstPop.lines, firstPop.msg);
      }
    }
    if (final && entry.mode === "debug" && state.debugLineBounds) {
      state.debugLineBounds = null;
    }
  }

  function wireCopyButtons(root) {
    root.querySelectorAll(".md-copy").forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const code = btn.parentElement.querySelector("code")?.textContent || "";
        try {
          navigator.clipboard.writeText(code);
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1200);
        } catch (_) {
          showToast("Copy failed", "error", 1500);
        }
      });
    });
  }

  function buildPendingMessageEl(messageId, mode) {
    const wrap = document.createElement("div");
    wrap.className = "chat-message bot streaming";
    wrap.dataset.messageId = messageId;
    const av = document.createElement("div");
    av.className = "bot-avatar";
    av.textContent = "B";
    const body = document.createElement("div");
    body.className = "msg-body";
    const status = document.createElement("div");
    status.className = "msg-status";
    const modeMeta = Modes.meta(mode);
    status.innerHTML = `<span class="msg-mode" style="--mode-color:${modeMeta.color}">${modeMeta.label}</span> <span class="msg-typing-dots"><span></span><span></span><span></span></span>`;
    wrap.append(av, body);
    body.appendChild(status);
    return { wrap, body, status };
  }

  async function send(text, opts = {}) {
    if (!text || !text.trim()) return;
    // Dismiss any active step popover — user is moving on / asking new q.
    if (typeof ActiveStep !== "undefined") ActiveStep.dismiss();
    const mode = opts.mode || state.chatMode;
    const chat = Chat.getActive();
    if (!chat) Chat.newChat();
    const userMsg =
      (opts.systemPrefix ? opts.systemPrefix + "\n\n" : "") + text;

    // Show user message (use the visible text if provided, otherwise the prompt text)
    Chat.appendMessage("user", opts.visibleText || text, { attachments: opts.attachments });

    // Build messages array: system + history (user/assistant only) + this user turn
    const sys = Modes.getSystemPrompt(mode);
    const ctx = await ProjectContext.build({
      includeStructure: opts.includeStructure !== false,
    });
    const ctxStr = ProjectContext.toPromptString(ctx);
    const systemContent = `${sys}\n\n${ctxStr}`;

    const history = (Chat.getActive()?.messages || [])
      .filter((m) => m.role === "user" || m.role === "bot")
      .slice(-12)
      .map((m) => {
        if (m.role === "user" && m.attachments && m.attachments.length > 0) {
          return {
            role: "user",
            content: [
              { type: "text", text: m.text || "" },
              ...m.attachments.map((att) => ({
                type: "image_url",
                image_url: { url: att.data }
              }))
            ]
          };
        }
        return {
          role: m.role === "bot" ? "assistant" : "user",
          content: m.text,
        };
      });
    // Drop the very last user (just appended) to avoid duplicate
    if (history.length && history[history.length - 1].role === "user")
      history.pop();

    let userContent;
    if (opts.attachments && opts.attachments.length > 0) {
      userContent = [
        { type: "text", text: userMsg },
        ...opts.attachments.map((att) => ({
          type: "image_url",
          image_url: { url: att.data }
        }))
      ];
    } else {
      userContent = userMsg;
    }

    const messages = [
      { role: "system", content: systemContent },
      ...history,
      { role: "user", content: userContent },
    ];

    const messageId =
      "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    currentStreamId = messageId;

    // Insert pending bot message bubble in chat history
    const { wrap, body } = buildPendingMessageEl(messageId, mode);
    const messagesContainer = $("chat-messages");
    if (messagesContainer) {
      const empty = $("chat-empty");
      if (empty) empty.style.display = "none";
      messagesContainer.appendChild(wrap);
      const histEl = $("chat-history");
      if (histEl) histEl.scrollTop = histEl.scrollHeight;
    }
    // Persist a pending placeholder in Chat state
    Chat.appendPending(messageId, mode);

    live.set(messageId, {
      bubbleEl: wrap,
      bodyEl: body,
      text: "",
      mode,
      mid: messageId,
    });

    if (!aiConfig?.hasKey) {
      const msg = `**No Pollinations API key configured.**\n\nAdd \`POLLINATIONS_API_KEY\` to a \`.env\` file at the project root and restart BuildeX. See \`.env.example\` for the template.`;
      const entry = live.get(messageId);
      entry.text = msg;
      renderBubble(entry, true);
      Chat.replacePending(messageId, msg);
      live.delete(messageId);
      currentStreamId = null;
      updateComposerStreamingUI(false);
      return;
    }

    updateComposerStreamingUI(true);
    try {
      await window.electronAPI.ai.chatStart({
        messageId,
        messages,
        uiModel: state.chatModel,
        temperature: Modes.meta(mode).temperature,
      });
    } catch (err) {
      const entry = live.get(messageId);
      if (entry) {
        entry.text = `_⚠ Failed to start: ${err.message || err}_`;
        renderBubble(entry, true);
        Chat.replacePending(messageId, entry.text);
        live.delete(messageId);
      }
      currentStreamId = null;
      updateComposerStreamingUI(false);
    }
  }

  function cancelCurrent() {
    if (!currentStreamId) return;
    window.electronAPI.ai.cancel(currentStreamId);
  }

  function updateComposerStreamingUI(streaming) {
    const sendBtn = $("chat-send");
    if (!sendBtn) return;
    if (streaming) {
      sendBtn.classList.add("streaming");
      sendBtn.title = "Stop generating (Esc)";
      sendBtn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    } else {
      sendBtn.classList.remove("streaming");
      sendBtn.title = "Send (⌘↵)";
      sendBtn.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    }
  }

  function isStreaming() {
    return !!currentStreamId;
  }

  return { init, send, cancelCurrent, isStreaming };
})();

/* ============================================================
 * Highlights — Monaco line decorations for AI-driven guidance.
 * Paints "remove" lines light red, "add" lines light green,
 * "modify" lines amber, "highlight" lines sky-blue. Also exposes
 * helpers to compute the screen rect of a target line so we can
 * anchor a popover beside it.
 * ============================================================ */
const Highlights = (() => {
  let lastIds = [];
  let lastModel = null;
  let changeListener = null;

  function kindColor(k) {
    if (k === "remove") return "#ef4444";
    if (k === "add") return "#10b981";
    if (k === "modify") return "#f59e0b";
    return "#60a5fa";
  }

  function classFor(kind) {
    const k = String(kind || "highlight").toLowerCase();
    if (k === "remove") return "buildex-line-remove";
    if (k === "add") return "buildex-line-add";
    if (k === "modify") return "buildex-line-modify";
    return "buildex-line-highlight";
  }

  function apply(ranges) {
    const ed = getActiveCodeEditor();
    if (!ed || typeof monaco === "undefined") return;
    const model = ed.getModel && ed.getModel();
    if (!model) return;
    if (!Array.isArray(ranges) || !ranges.length) {
      clear();
      return;
    }
    // Reset id tracking when the editor switched to a different model — old
    // ids belong to the previous model and won't be valid here.
    if (lastModel !== model) {
      lastIds = [];
      lastModel = model;
    }

    if (changeListener) {
      changeListener.dispose();
      changeListener = null;
    }

    const decos = [];
    const activeRemoveRanges = [];

    for (const r of ranges) {
      const from = Math.max(1, parseInt(r.from, 10) || 1);
      const total = model.getLineCount();
      const fromClamped = Math.min(from, total);
      const to = Math.max(
        fromClamped,
        Math.min(parseInt(r.to ?? r.from, 10) || fromClamped, total),
      );
      const kind = String(r.kind || "highlight").toLowerCase();
      const cls = classFor(kind);
      const endCol = (() => {
        try {
          return model.getLineMaxColumn(to);
        } catch (_) {
          return 1;
        }
      })();

      if (kind === "remove") {
        activeRemoveRanges.push({ from: fromClamped, to });
      }

      decos.push({
        range: new monaco.Range(fromClamped, 1, to, endCol),
        options: {
          isWholeLine: true,
          className: cls,
          marginClassName: cls + "-margin",
          linesDecorationsClassName: cls + "-gutter",
          minimap: { color: kindColor(kind), position: 1 },
          overviewRuler: { color: kindColor(kind), position: 4 },
        },
      });
    }
    // Prefer model.deltaDecorations (current API); fall back to the older
    // editor-level call for safety.
    try {
      lastIds = model.deltaDecorations(lastIds, decos);
    } catch (_) {
      try {
        lastIds = ed.deltaDecorations(lastIds, decos);
      } catch (__) {}
    }

    if (activeRemoveRanges.length > 0) {
      const originalRanges = ranges;
      changeListener = ed.onDidChangeModelContent((e) => {
        let modifiedRemove = false;
        for (const change of e.changes) {
          const changeFrom = change.range.startLineNumber;
          const changeTo = change.range.endLineNumber;
          for (const rr of activeRemoveRanges) {
            if (changeFrom <= rr.to && changeTo >= rr.from) {
              modifiedRemove = true;
              break;
            }
          }
          if (modifiedRemove) break;
        }

        if (modifiedRemove) {
          if (changeListener) {
            changeListener.dispose();
            changeListener = null;
          }
          const remainingRanges = originalRanges.filter(
            (r) => String(r.kind || "highlight").toLowerCase() !== "remove",
          );
          apply(remainingRanges);
        }
      });
    }
  }

  function clear() {
    if (changeListener) {
      changeListener.dispose();
      changeListener = null;
    }
    if (lastModel) {
      try {
        lastIds = lastModel.deltaDecorations(lastIds, []);
      } catch (_) {}
    }
    lastIds = [];
    lastModel = null;
  }

  function firstLine(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return null;
    const r = ranges[0];
    return Math.max(1, parseInt(r.from, 10) || 1);
  }

  function lastLine(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return null;
    const r = ranges[ranges.length - 1];
    return Math.max(1, parseInt(r.to ?? r.from, 10) || 1);
  }

  // Returns the on-screen rectangle of the (top of the) given line in the
  // active Monaco editor, plus the editor's overall rect for layout decisions.
  function lineRect(line, customEditor) {
    const ed = customEditor || (typeof editor !== "undefined" ? editor : null);
    if (!ed) return null;
    const editorEl = ed.getDomNode && ed.getDomNode();
    if (!editorEl) return null;
    try {
      const lineHeight =
        ed.getOption(monaco.editor.EditorOption.lineHeight) || 18;
      const top = ed.getTopForLineNumber(line) - ed.getScrollTop();
      const eRect = editorEl.getBoundingClientRect();
      return {
        top: eRect.top + top,
        bottom: eRect.top + top + lineHeight,
        height: lineHeight,
        editorRect: eRect,
      };
    } catch (_) {
      return null;
    }
  }

  return { apply, clear, firstLine, lastLine, lineRect };
})();

// Wraps text occurrences of `phrase` values in colored <mark> spans for
// concept-coded explanations. Operates on already-escaped HTML and skips
// inside existing tags.
function inlineColorize(html, highlights) {
  if (!Array.isArray(highlights) || !highlights.length) return html;
  const allowed = new Set([
    "rose",
    "amber",
    "emerald",
    "sky",
    "violet",
    "orange",
    "blue",
    "green",
    "pink",
  ]);
  const sorted = [...highlights]
    .filter((h) => h && h.phrase)
    .sort((a, b) => String(b.phrase).length - String(a.phrase).length);
  let out = html;
  for (const h of sorted) {
    const phrase = String(h.phrase || "").trim();
    if (!phrase) continue;
    const color = String(h.color || "sky").toLowerCase();
    const cls = "hl-" + (allowed.has(color) ? color : "sky");
    const escaped = escapeHtml(phrase).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    if (!escaped) continue;
    const re = new RegExp(escaped, "g");
    out = out
      .split(/(<[^>]+>)/g)
      .map((part, idx) => {
        if (idx % 2 === 1) return part; // preserve HTML tags
        return part.replace(re, (m) => `<mark class="${cls}">${m}</mark>`);
      })
      .join("");
  }
  return out;
}

/* ============================================================
 * ActiveStep — anchored, in-place step popover
 * Renders the AI's current "buildex-step" instruction next to
 * the IDE area it concerns (terminal, file tree, editor, etc.)
 * with inline Done / Got-an-error / Close actions.
 * ============================================================ */
const ActiveStep = (() => {
  let current = null;

  // Walkthrough state — when one AI response yields multiple buildex-step
  // blocks, we play them sequentially without burning extra API tokens. The
  // user advances locally via the "Next part →" button.
  let walkthroughActive = false;
  let stepQueue = [];
  let stepCursor = 0;
  let stepTotal = 0;

  // "Explain in detail" detour state. When the user asks a follow-up
  // question on a walkthrough step, the AI's reply (a single detail step)
  // is shown ON TOP of the paused walkthrough. Pressing Next/Done on the
  // detail returns to the original walkthrough at the next step — no
  // additional API call.
  let detailExpected = false;
  let inDetailDetour = false;

  function dismiss() {
    try {
      Highlights.clear();
    } catch (_) {}
    if (!current) return;
    try {
      current.popoverEl && current.popoverEl.remove();
    } catch (_) {}
    try {
      current.cleanup && current.cleanup();
    } catch (_) {}
    if (current.anchorEl)
      current.anchorEl.classList.remove("active-step-anchor");
    current = null;
  }

  // Hard reset — used when a brand-new AI response arrives, clearing any
  // queued walkthrough from a prior turn so the new content takes over.
  function resetWalkthrough() {
    walkthroughActive = false;
    stepQueue = [];
    stepCursor = 0;
    stepTotal = 0;
  }

  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return String(s).replace(/(["\\])/g, "\\$1");
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0;
  }

  function findFileNode(targetFile) {
    if (!targetFile) return null;
    const tree = $("file-tree");
    if (!tree) return null;
    const all = tree.querySelectorAll("[data-path]");
    // Best match: exact path or longest suffix match
    let best = null;
    for (const node of all) {
      const p = node.getAttribute("data-path") || "";
      if (
        p === targetFile ||
        p.endsWith("/" + targetFile) ||
        p.endsWith(targetFile)
      ) {
        if (!best || p.length > (best.getAttribute("data-path") || "").length)
          best = node;
      }
    }
    return best;
  }

  /**
   * Side-effects to make the anchor work:
   *   - open the targetFile in Monaco (so the editor is visible)
   *   - reveal the insertion line (so the user sees where to type)
   *   - show the explorer for create_file
   *   - refresh the tree if a file we expect isn't visible
   */
  async function prepareAnchor(step) {
    const at = String(step.actionType || "").toLowerCase();

    if (at === "create_file") {
      const sidebar = $("sidebar");
      if (sidebar && sidebar.classList.contains("hidden"))
        sidebar.classList.remove("hidden");
      if (
        typeof setActiveView === "function" &&
        state.activeView !== "explorer"
      )
        setActiveView("explorer");
      return;
    }

    const fileBoundActions = new Set([
      "type_code",
      "open_file",
      "modify_code",
      "highlight",
    ]);
    if (fileBoundActions.has(at) && step.targetFile && state.workspaceRoot) {
      const full = step.targetFile.startsWith("/")
        ? step.targetFile
        : state.workspaceRoot.replace(/\/$/, "") +
          "/" +
          step.targetFile.replace(/^\//, "");

      // If file already open, just focus it
      if (state.openFiles && state.openFiles.has(full)) {
        try {
          setActiveFile(full);
        } catch (_) {}
      } else {
        // Probe existence first — if it doesn't exist, do NOT show a misleading
        // popover anchored at the empty editor. Instead, ping the AI to pivot.
        let exists = true;
        try {
          const r = await window.electronAPI.readFile(full);
          exists = !!(r && r.ok);
        } catch (_) {
          exists = false;
        }

        if (!exists) {
          return { abort: "missing-file", missingPath: step.targetFile };
        }
        try {
          await openFile(full);
        } catch (_) {}
      }
      // Brief wait for Monaco to lay out
      await new Promise((r) => setTimeout(r, 60));

      // Reveal the first highlighted line if lineRanges provided, else the
      // explicit insertion line, else nothing.
      const focusLine =
        Array.isArray(step.lineRanges) && step.lineRanges.length
          ? Highlights.firstLine(step.lineRanges)
          : step.insertionLocation &&
              typeof step.insertionLocation.afterLine === "number"
            ? Math.max(1, (step.insertionLocation.afterLine || 0) + 1)
            : null;
      const edFocus = getActiveCodeEditor();
      if (edFocus && focusLine) {
        try {
          edFocus.revealLineInCenter(focusLine);
          edFocus.setPosition({ lineNumber: focusLine, column: 1 });
        } catch (_) {}
      }

      // Paint the line decorations now that the file is open.
      if (Array.isArray(step.lineRanges) && step.lineRanges.length) {
        Highlights.apply(step.lineRanges);
      } else {
        Highlights.clear();
      }
    } else {
      Highlights.clear();
    }

    if (at === "open_file" && step.targetFile) {
      // If we couldn't find the file row, refresh and try once more
      if (!findFileNode(step.targetFile)) {
        scheduleTreeRefresh();
        await new Promise((r) => setTimeout(r, 320));
      }
    }
    return { abort: null };
  }

  function resolveAnchor(step) {
    // 1. Honor explicit selector/id from AI
    if (step.targetElement) {
      let el = null;
      try {
        el = document.querySelector(step.targetElement);
      } catch (_) {}
      if (!el) {
        const id = String(step.targetElement).replace(/^#/, "");
        el = document.getElementById(id);
      }
      if (el && isVisible(el)) return el;
    }
    // 2. Action-type defaults
    const at = String(step.actionType || "").toLowerCase();
    switch (at) {
      case "run_command": {
        const ta = $("terminals-area");
        if (ta) {
          const active =
            ta.querySelector(".terminal-instance.active") ||
            ta.querySelector(".terminal-instance");
          if (active && isVisible(active)) return active;
          if (isVisible(ta)) return ta;
        }
        const tc = $("terminal-container");
        return isVisible(tc) ? tc : null;
      }
      case "create_file": {
        const btn = $("new-file-btn");
        if (btn && isVisible(btn)) return btn;
        const tree = $("file-tree");
        if (tree && isVisible(tree)) return tree;
        return null;
      }
      case "open_file": {
        const node = findFileNode(step.targetFile);
        if (node && isVisible(node)) return node;
        // If file is opened in editor or diff viewer, anchor the visible pane
        const diffEl = $("monaco-diff-editor");
        const monoEl = $("monaco-editor");
        const monacoEl =
          (diffEl && diffEl.classList.contains("visible") && diffEl) ||
          (monoEl && monoEl.classList.contains("visible") && monoEl) ||
          monoEl;
        if (monacoEl && isVisible(monacoEl)) return monacoEl;
        const tree = $("file-tree");
        return tree && isVisible(tree) ? tree : null;
      }
      case "type_code": {
        const view =
          document.querySelector(
            "#monaco-diff-editor.visible .monaco-editor",
          ) || document.querySelector("#monaco-editor.visible .monaco-editor");
        if (view && isVisible(view)) return view;
        const monacoEl =
          ($("monaco-diff-editor") &&
            $("monaco-diff-editor").classList.contains("visible") &&
            $("monaco-diff-editor")) ||
          $("monaco-editor");
        if (monacoEl && isVisible(monacoEl)) return monacoEl;
        return null;
      }
      case "click_button":
      case "highlight":
      default:
        return null;
    }
  }

  function stepIcon(actionType) {
    switch (String(actionType || "").toLowerCase()) {
      case "create_file":
        return "＋";
      case "open_file":
        return "↗";
      case "type_code":
        return "⌨";
      case "modify_code":
        return "⟳";
      case "run_command":
        return "▶";
      case "click_button":
        return "☞";
      case "highlight":
        return "◎";
      default:
        return "•";
    }
  }

  // Minimal inline-markdown for popover prose. Handles `**bold**`,
  // \`inline code\`, and `*italic*`. Strips heading markers. The AI is told
  // to send plain text but this is a safety net so a stray ** never shows
  // up as raw asterisks.
  function earliestLineInRanges(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return null;
    let min = Infinity;
    for (const r of ranges) {
      const f = parseInt(r && r.from, 10);
      if (Number.isFinite(f)) min = Math.min(min, f);
    }
    return Number.isFinite(min) ? min : null;
  }

  /** Replacement that begins with import/export usually belongs at top of file */
  function replacementLooksLikeMisplacedModulePreamble(
    replacementCode,
    earliestLine,
  ) {
    if (typeof replacementCode !== "string" || earliestLine === null)
      return false;
    const t = replacementCode.trimStart();
    if (!t) return false;
    // Only flag when highlighted region starts clearly below typical import preamble
    if (earliestLine <= 6) return false;
    return /^(?:import\b|export\s+default\b)/m.test(t);
  }

  function lightInline(text) {
    if (!text) return "";
    let s = escapeHtml(String(text));
    // Strip leading "## " / "# " on lines (treat as plain text)
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
    // Inline code first (so * inside code stays literal)
    s = s.replace(/`([^`]+?)`/g, "<code>$1</code>");
    // Bold then italic
    s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
    return s;
  }

  function buildPopover(step, mode) {
    const root = document.createElement("div");
    root.className =
      "active-step mode-" +
      (mode || "learn") +
      (step._detail ? " is-detail" : "");
    if (state.guideMode === "inline") root.classList.add("inline-guide");
    root.setAttribute("role", "dialog");
    const arrow = document.createElement("div");
    arrow.className = "active-step-arrow";

    const inner = document.createElement("div");
    inner.className = "active-step-inner";

    // Header
    const header = document.createElement("div");
    header.className = "active-step-header";
    const iconEl = document.createElement("span");
    iconEl.className = "active-step-icon";
    iconEl.textContent = stepIcon(step.actionType);
    const title = document.createElement("div");
    title.className = "active-step-title";
    title.textContent = step.stepTitle || "Step";

    // Header chip — either the walkthrough counter ("2 / 5") for a normal
    // walkthrough step, or a "Detail" badge while in the detail detour.
    let chipEl = null;
    if (step._detail) {
      chipEl = document.createElement("span");
      chipEl.className = "active-step-detail-badge";
      chipEl.textContent = "Detail";
    } else if (
      step._walk &&
      typeof step._walk.index === "number" &&
      step._walk.total > 1
    ) {
      chipEl = document.createElement("span");
      chipEl.className = "active-step-counter";
      chipEl.textContent = `${step._walk.index + 1} / ${step._walk.total}`;
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "active-step-close";
    closeBtn.title = "Dismiss";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", dismiss);
    if (chipEl) header.append(iconEl, title, chipEl, closeBtn);
    else header.append(iconEl, title, closeBtn);

    header.style.cursor = "grab";
    header.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const rect = root.getBoundingClientRect();
      const origLeft = rect.left;
      const origTop = rect.top;
      let manualMoved = false;

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const width = root.offsetWidth;
        const height = root.offsetHeight;
        const newLeft = clamp(origLeft + dx, 8, window.innerWidth - width - 8);
        const newTop = clamp(origTop + dy, 8, window.innerHeight - height - 8);
        root.style.left = `${newLeft}px`;
        root.style.top = `${newTop}px`;
        if (!manualMoved) {
          manualMoved = true;
          root.classList.add("manual-moved");
        }
        root.classList.add("dragging");
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        root.classList.remove("dragging");
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Body
    const body = document.createElement("div");
    body.className = "active-step-body";

    if (step.explanation) {
      const p = document.createElement("p");
      p.className = "active-step-explanation";
      p.innerHTML = inlineColorize(
        lightInline(step.explanation),
        step.inlineHighlights,
      );
      body.appendChild(p);
    }

    // Sub-steps — used to bundle 2–3 micro-actions into one popover.
    if (Array.isArray(step.subSteps) && step.subSteps.length) {
      const list = document.createElement("ol");
      list.className = "active-step-substeps";
      step.subSteps.forEach((s, i) => {
        const li = document.createElement("li");
        const kind = String(s.kind || "").toLowerCase();
        li.className = "active-step-substep" + (kind ? " kind-" + kind : "");
        const num = document.createElement("span");
        num.className = "substep-num";
        num.textContent = String(i + 1);
        const txt = document.createElement("span");
        txt.className = "substep-title";
        txt.innerHTML = inlineColorize(
          escapeHtml(s.title || s.label || ""),
          step.inlineHighlights,
        );
        li.append(num, txt);
        if (s.description) {
          const desc = document.createElement("div");
          desc.className = "substep-desc";
          desc.innerHTML = inlineColorize(
            escapeHtml(s.description),
            step.inlineHighlights,
          );
          li.appendChild(desc);
        }
        list.appendChild(li);
      });
      body.appendChild(list);
    }

    const meta = document.createElement("div");
    meta.className = "active-step-meta";
    if (step.targetFile) {
      const m = document.createElement("span");
      m.className = "active-step-chip";
      m.innerHTML = `<span class="chip-key">file</span> <code>${escapeHtml(step.targetFile)}</code>`;
      meta.appendChild(m);
    }
    if (Array.isArray(step.lineRanges) && step.lineRanges.length) {
      // Render a chip per range (max 3 to keep header tidy).
      step.lineRanges.slice(0, 3).forEach((r) => {
        const kind = String(r.kind || "highlight").toLowerCase();
        const verb =
          kind === "remove"
            ? "remove"
            : kind === "add"
              ? "insert"
              : kind === "modify"
                ? "modify"
                : "lines";
        const from = parseInt(r.from, 10) || 0;
        const to = parseInt(r.to ?? r.from, 10) || from;
        const range = from === to ? String(from) : `${from}–${to}`;
        const m = document.createElement("span");
        m.className = "active-step-chip range-chip range-" + kind;
        m.innerHTML = `<span class="chip-key">${verb}</span> <code>L${range}</code>`;
        meta.appendChild(m);
      });
    }
    if (
      step.insertionLocation &&
      typeof step.insertionLocation.afterLine === "number"
    ) {
      const m = document.createElement("span");
      m.className = "active-step-chip";
      m.innerHTML = `<span class="chip-key">after line</span> <code>${step.insertionLocation.afterLine}</code>`;
      meta.appendChild(m);
    }
    if (meta.children.length) body.appendChild(meta);

    // Surgical token-level diff (preferred for small fixes like typos)
    if (
      step.inlineEdit &&
      (step.inlineEdit.before !== undefined ||
        step.inlineEdit.after !== undefined)
    ) {
      const ie = step.inlineEdit;
      const wrap = document.createElement("div");
      wrap.className = "active-step-inline-edit";

      const diff = document.createElement("div");
      diff.className = "inline-edit-diff";
      const before = document.createElement("span");
      before.className = "inline-edit-pill before";
      before.textContent = String(ie.before ?? "");
      const arrow = document.createElement("span");
      arrow.className = "inline-edit-arrow";
      arrow.textContent = "→";
      const after = document.createElement("span");
      after.className = "inline-edit-pill after";
      after.textContent = String(ie.after ?? "");
      diff.append(before, arrow, after);
      wrap.appendChild(diff);

      if (ie.hint) {
        const hint = document.createElement("div");
        hint.className = "inline-edit-hint";
        hint.innerHTML = inlineColorize(
          lightInline(ie.hint),
          step.inlineHighlights,
        );
        wrap.appendChild(hint);
      }
      body.appendChild(wrap);
    }

    // For modify_code steps with a multi-line fix, fall back to a code block
    let snippet = step.replacementCode || step.codeSnippet;
    const atLower = String(step.actionType || "").toLowerCase();
    const dbgMisplacedImports =
      mode === "debug" &&
      atLower === "modify_code" &&
      step.replacementCode &&
      !step.inlineEdit &&
      replacementLooksLikeMisplacedModulePreamble(
        step.replacementCode,
        earliestLineInRanges(step.lineRanges),
      );

    const DBG_SNIP_LINES = 9;
    const DBG_SNIP_CHARS = 620;
    if (snippet && mode === "debug" && typeof snippet === "string") {
      const raw = snippet;
      const L = raw.split(/\n/);
      if (L.length > DBG_SNIP_LINES || raw.length > DBG_SNIP_CHARS) {
        const head = Math.max(4, DBG_SNIP_LINES - 2);
        const shown = L.slice(0, head).join("\n");
        const rest = Math.max(0, L.length - head);
        snippet = `${shown}\n/* … (${rest} more replacement-line(s) omitted in preview — scroll full reply in chat if needed) … */`;
        if (snippet.length > DBG_SNIP_CHARS + 120)
          snippet = snippet.slice(0, DBG_SNIP_CHARS) + "\n…";
      }
    }
    const showSnippet = snippet && !step.inlineEdit;
    if (dbgMisplacedImports) {
      const w = document.createElement("div");
      w.className = "active-step-warn";
      w.textContent =
        "This snippet starts with import/export but the highlight begins lower in the file — the second step may be mis-scoped. Prefer fixing colons/braces inside the highlighted block (or regenerate with narrower replacement). Do not paste as-is.";
      body.appendChild(w);
    }
    if (showSnippet) {
      const pre = document.createElement("pre");
      pre.className =
        "active-step-code" +
        (step.replacementCode ? " code-add" : "") +
        (mode === "debug" ? " compact-debug-snippet" : "");
      const code = document.createElement("code");
      code.textContent = snippet;
      pre.appendChild(code);
      body.appendChild(pre);
      const cap = document.createElement("div");
      cap.className = "active-step-caption";
      cap.textContent =
        mode === "learn"
          ? step.replacementCode
            ? "Delete the highlighted lines, then type this in their place."
            : "Type this manually — typing builds memory."
          : step.replacementCode
            ? mode === "debug"
              ? "These lines replace only the highlighted span — gutters show surrounding context."
              : "Replace the highlighted lines with this."
            : "Type or apply at the highlighted spot.";
      body.appendChild(cap);
    }

    if (step.expectedResult) {
      const er = document.createElement("div");
      er.className = "active-step-expected";
      er.innerHTML = `<span class="chip-key">expected</span> ${inlineColorize(lightInline(step.expectedResult), step.inlineHighlights)}`;
      body.appendChild(er);
    }

    // Clickable choice buttons — when the AI needs the user to pick from a
    // small set of options instead of typing a free-text reply.
    const hasChoices = Array.isArray(step.choices) && step.choices.length > 0;
    if (hasChoices) {
      const grid = document.createElement("div");
      grid.className = "active-step-choices";
      if (step.choices.length === 2) grid.classList.add("cols-2");
      step.choices.forEach((c, i) => {
        const btn = document.createElement("button");
        btn.className = "active-step-choice";
        btn.dataset.value = String(c.value ?? c.label ?? i);
        const lbl = document.createElement("span");
        lbl.className = "choice-label";
        lbl.textContent = c.label || c.value || `Option ${i + 1}`;
        btn.appendChild(lbl);
        if (c.hint) {
          const h = document.createElement("span");
          h.className = "choice-hint";
          h.textContent = c.hint;
          btn.appendChild(h);
        }
        btn.addEventListener("click", () => pickChoice(step, c, mode));
        grid.appendChild(btn);
      });
      body.appendChild(grid);
    }

    // Actions
    const actions = document.createElement("div");
    actions.className = "active-step-actions";
    const errBtn = document.createElement("button");
    errBtn.className = "active-step-btn ghost";
    errBtn.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> I got an error';
    errBtn.addEventListener("click", () => reportError(step));
    const explainBtn = document.createElement("button");
    explainBtn.className = "active-step-btn ghost explain-btn";
    explainBtn.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Explain in detail';
    explainBtn.addEventListener("click", () =>
      toggleExplainQuery(root, step, mode),
    );
    actions.append(errBtn, explainBtn);

    // The "Done" button is only shown when the user is meant to advance the
    // step themselves. When choices are present, the next step is gated on
    // the user picking an option, so we hide Done to avoid ambiguity.
    if (!hasChoices) {
      const doneBtn = document.createElement("button");
      doneBtn.className = "active-step-btn primary";
      // Walkthrough mode → "Next part →" or "Finish" depending on queue.
      // Single-step mode → "Done — Next step" (existing behavior, calls AI).
      let label = "Done — Next step";
      let icon =
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      if (step._detail) {
        // We're in a detail detour. Going back resumes the walkthrough.
        const remaining = walkthroughActive ? stepQueue.length : 0;
        label = remaining > 0 ? "Back to walkthrough" : "Done";
        icon =
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
      } else if (walkthroughActive) {
        if (stepQueue.length > 0) {
          label = "Next part";
          icon =
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
        } else {
          label = "Finish";
        }
      }
      doneBtn.innerHTML = icon + " " + label;
      doneBtn.addEventListener("click", () => complete(step));
      actions.appendChild(doneBtn);
    }

    inner.append(header, body, actions);
    root.append(arrow, inner);
    return root;
  }

  // User clicked a choice button — relay the pick to the AI as a fresh
  // message and dismiss this popover. The AI will respond with the next
  // grounded step.
  async function pickChoice(step, choice, mode) {
    const value = choice.value ?? choice.label ?? "unknown";
    const label = choice.label || String(value);
    dismiss();
    if (typeof showToast === "function") {
      try {
        showToast(`Picked: ${label}`, "info", 1400);
      } catch (_) {}
    }
    if (typeof AIChat !== "undefined") {
      const prompt = `On step "${step.stepTitle || ""}", I picked: **${label}** (value: \`${value}\`).
Continue with the next step grounded in the current workspace state. Do not re-ask the same question.`;
      await AIChat.send(prompt, {
        mode: mode || state.chatMode,
        includeStructure: true,
        visibleText: `Picked: ${label}`,
      });
    }
  }

  // Toggles a small inline query input inside the popover. The user types a
  // follow-up question; we send it to the AI which (per the prompts) responds
  // with a NEW buildex-step anchored to the same code area.
  function toggleExplainQuery(root, step, mode) {
    const existing = root.querySelector(".explain-query");
    if (existing) {
      existing.remove();
      return;
    }

    const area = document.createElement("div");
    area.className = "explain-query";

    const lbl = document.createElement("label");
    lbl.className = "explain-query-label";
    lbl.textContent = "What part do you want explained?";
    area.appendChild(lbl);

    const inputRow = document.createElement("div");
    inputRow.className = "explain-query-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "explain-query-input";
    input.placeholder = "e.g. Why querySelector? What does !innerHTML mean?";
    const submit = document.createElement("button");
    submit.className = "explain-query-submit";
    submit.textContent = "Ask";

    const submitFn = async () => {
      const q = (input.value || "").trim();
      if (!q) {
        input.focus();
        return;
      }
      input.disabled = true;
      submit.disabled = true;
      submit.textContent = "Asking…";
      await askDetailQuery(step, q, mode);
    };
    submit.addEventListener("click", submitFn);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitFn();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        area.remove();
      }
    });
    inputRow.append(input, submit);
    area.appendChild(inputRow);

    const actionsEl = root.querySelector(".active-step-actions");
    if (actionsEl && actionsEl.parentNode) {
      actionsEl.parentNode.insertBefore(area, actionsEl);
    } else {
      root.appendChild(area);
    }
    setTimeout(() => input.focus(), 30);
  }

  async function askDetailQuery(step, question, mode) {
    // Compose a focused prompt that asks the AI to answer the user's
    // sub-question and emit a follow-up buildex-step anchored to the same
    // code area, so the next popover lands beside the relevant lines.
    const compactStep = {
      stepTitle: step.stepTitle,
      actionType: step.actionType,
      targetFile: step.targetFile,
      lineRanges: step.lineRanges,
      explanation: step.explanation,
      replacementCode: step.replacementCode,
      codeSnippet: step.codeSnippet,
    };
    const prompt = `EXPLAIN-IN-DETAIL request from the user.

Current step the user is on:
\`\`\`json
${JSON.stringify(compactStep, null, 2)}
\`\`\`

Their follow-up question:
> ${question}

Please answer concisely with a teaching tone. Return EXACTLY ONE \`buildex-step\` block at the end of your reply, with:
- "actionType": "highlight"
- the SAME "targetFile" and "lineRanges" as above (so the popover stays anchored to the same code)
- a thorough "explanation" answering the user's question
- helpful "inlineHighlights" (3–6 phrases with colors: rose / amber / emerald / sky / violet / pink) to color-code key concepts in your explanation
- DO NOT include "replacementCode" or "codeSnippet" — they're learning, not coding right now
- do NOT advance to the next implementation step yet`;

    if (typeof AIChat !== "undefined") {
      // Mark this AI request as a detail detour so play() preserves the
      // walkthrough queue when the response arrives.
      detailExpected = true;
      // Use 'explain' mode for the question regardless of the global mode so
      // the AI's tone is analytical and concept-first.
      await AIChat.send(prompt, { mode: "explain", includeStructure: false });
    }
  }

  function position(popoverEl, anchor) {
    const r = anchor.getBoundingClientRect();
    const pop = popoverEl.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const pad = 12;
    const tipW = pop.width;
    const tipH = pop.height;

    const spaceAbove = r.top;
    const spaceBelow = winH - r.bottom;
    const spaceLeft = r.left;
    const spaceRight = winW - r.right;

    let mode = "above";
    let top, left;

    // Anchor is the chat panel? Definitely not. Anchor is editor/terminal — pick best side.
    if (state.guideMode === "popup" && spaceBelow >= tipH + pad + 16) {
      mode = "below";
      top = r.bottom + pad;
    } else if (spaceAbove >= tipH + pad + 16) {
      mode = "above";
      top = r.top - tipH - pad;
    } else if (spaceBelow >= tipH + pad + 16) {
      mode = "below";
      top = r.bottom + pad;
    } else if (spaceLeft >= tipW + pad + 16) {
      mode = "left";
      top = clamp(r.top + r.height / 2 - tipH / 2, 8, winH - tipH - 8);
      left = r.left - tipW - pad;
    } else if (spaceRight >= tipW + pad + 16) {
      mode = "right";
      top = clamp(r.top + r.height / 2 - tipH / 2, 8, winH - tipH - 8);
      left = r.right + pad;
    } else {
      // No room anywhere — float at bottom-right of viewport
      mode = "floating";
      top = Math.max(8, winH - tipH - 80);
      left = Math.max(8, winW - tipW - 24);
    }

    if (mode === "above" || mode === "below") {
      left = clamp(r.left + r.width / 2 - tipW / 2, 8, winW - tipW - 8);
    }

    popoverEl.style.left = left + "px";
    popoverEl.style.top = top + "px";
    popoverEl.classList.remove(
      "above",
      "below",
      "side-left",
      "side-right",
      "floating",
    );
    if (mode === "above") popoverEl.classList.add("above");
    else if (mode === "below") popoverEl.classList.add("below");
    else if (mode === "left") popoverEl.classList.add("side-left");
    else if (mode === "right") popoverEl.classList.add("side-right");
    else popoverEl.classList.add("floating");

    // Position the arrow horizontally to point at the anchor center
    const arrow = popoverEl.querySelector(".active-step-arrow");
    if (arrow) {
      if (mode === "above" || mode === "below") {
        const anchorCenterX = r.left + r.width / 2;
        const popLeft = parseFloat(popoverEl.style.left);
        const arrowX = clamp(anchorCenterX - popLeft, 16, tipW - 16);
        arrow.style.left = arrowX + "px";
        arrow.style.top = "";
      } else if (mode === "left" || mode === "right") {
        const anchorCenterY = r.top + r.height / 2;
        const popTop = parseFloat(popoverEl.style.top);
        const arrowY = clamp(anchorCenterY - popTop, 16, tipH - 16);
        arrow.style.top = arrowY + "px";
        arrow.style.left = "";
      } else {
        arrow.style.left = "";
        arrow.style.top = "";
      }
    }
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // Position the popover beside the highlighted line(s) inside the Monaco
  // editor: aligns vertically with the first line and prefers the right side
  // of the editor (falling back to left, or floating over the right edge).
  function positionBesideLine(popoverEl, ranges, preferPopupBelow = false) {
    const activeEd = getActiveCodeEditor();
    if (!activeEd || !activeEd.getModel || !activeEd.getModel()) return false;
    const fLine = Highlights.firstLine(ranges);
    const lLine = Highlights.lastLine(ranges) || fLine;
    if (!fLine) return false;

    // Use a slightly more robust lineRect lookup
    const lineRect = Highlights.lineRect(fLine, activeEd);
    if (!lineRect) {
      // Fallback: anchor to the editor container itself if we can't get line rect
      const edDom = activeEd.getDomNode && activeEd.getDomNode();
      if (edDom) position(popoverEl, edDom);
      return true; // positioned; skip rAF retries
    }

    const pop = popoverEl.getBoundingClientRect();
    const tipW = pop.width;
    const tipH = pop.height;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const pad = 14;

    const eRect = lineRect.editorRect;
    const lineSpanHeight = Math.max(
      lineRect.height,
      (lLine - fLine + 1) * lineRect.height,
    );
    const lineCenterY = lineRect.top + lineSpanHeight / 2;

    const spaceRight = winW - eRect.right;
    const spaceLeft = eRect.left;
    const spaceBelow = winH - eRect.bottom;
    const spaceAbove = eRect.top;
    let mode, left, top;

    if (preferPopupBelow && spaceBelow >= tipH + pad + 16) {
      mode = "below";
      left = clamp(
        eRect.left + eRect.width / 2 - tipW / 2,
        12,
        winW - tipW - 12,
      );
      top = eRect.bottom + pad;
    } else if (preferPopupBelow && spaceAbove >= tipH + pad + 16) {
      mode = "above";
      left = clamp(
        eRect.left + eRect.width / 2 - tipW / 2,
        12,
        winW - tipW - 12,
      );
      top = eRect.top - tipH - pad;
    } else if (spaceRight >= tipW + pad + 16) {
      mode = "side-right";
      left = eRect.right + pad;
      top = clamp(lineCenterY - tipH / 2, 12, winH - tipH - 12);
    } else if (spaceLeft >= tipW + pad + 16) {
      mode = "side-left";
      left = eRect.left - tipW - pad;
      top = clamp(lineCenterY - tipH / 2, 12, winH - tipH - 12);
    } else {
      mode = "floating";
      left = Math.min(eRect.right - tipW - 16, winW - tipW - 12);
      top = clamp(lineCenterY - tipH / 2, 12, winH - tipH - 12);
    }

    popoverEl.style.left = Math.max(12, left) + "px";
    popoverEl.style.top = top + "px";
    popoverEl.classList.remove(
      "above",
      "below",
      "side-left",
      "side-right",
      "floating",
    );
    popoverEl.classList.add(mode);

    const arrow = popoverEl.querySelector(".active-step-arrow");
    if (arrow) {
      if (mode === "side-left" || mode === "side-right") {
        const arrowY = clamp(lineCenterY - top, 16, tipH - 16);
        arrow.style.top = arrowY + "px";
        arrow.style.left = "";
      } else {
        arrow.style.top = "";
        arrow.style.left = "";
      }
    }
    return true;
  }

  async function show(step, mode) {
    dismiss();
    // Side-effects first: open files, reveal lines, paint decorations.
    const prep = await prepareAnchor(step);

    // If the AI referenced a file that doesn't exist, don't render a popover
    // floating in nowhere. Quietly cancel and ask the AI to ground itself.
    if (prep && prep.abort === "missing-file") {
      try {
        if (typeof showToast === "function") {
          showToast(
            `BuildeX: \`${prep.missingPath}\` doesn't exist — asking the AI to correct itself.`,
            "warning",
          );
        }
      } catch (_) {}
      if (typeof AIChat !== "undefined") {
        const msg = `Heads up: the file \`${prep.missingPath}\` you referenced does NOT exist in the current project tree. Re-read the IDE Context above (Project tree + Primary language + Extension policy) and pivot. Use the actual file that performs the equivalent role (for example, \`main.ts\` instead of \`App.jsx\` in a Vite + TypeScript vanilla project). Then issue the corrected next step.`;
        await AIChat.send(msg, {
          mode: state.chatMode,
          includeStructure: true,
        });
      }
      return;
    }

    const popoverEl = buildPopover(step, mode);
    document.body.appendChild(popoverEl);

    // If the user selected Inline guide mode, and the step includes a
    // code snippet or replacement, render a lightweight in-editor overlay
    // showing the suggested code. In learn mode this is a ghost overlay
    // only: the user types through it and no auto-insert happens.
    let _inlineWidget = null;
    let _inlineWidgetId = null;
    let _inlineWidgetDisposable = null;
    const canShowInlineSuggestion =
      state.guideMode === "inline" &&
      (step.codeSnippet || step.replacementCode || step.replacement);
    if (canShowInlineSuggestion) {
      try {
        const ed = getActiveCodeEditor();
        if (ed && typeof ed.addContentWidget === "function") {
          const focusLine =
            Array.isArray(step.lineRanges) && step.lineRanges.length
              ? Highlights.firstLine(step.lineRanges)
              : step.insertionLocation && typeof step.insertionLocation.afterLine === "number"
              ? Math.max(1, (step.insertionLocation.afterLine || 0) + 1)
              : null;
          const isLearnModeSuggestion = state.chatMode === "learn";

          const node = document.createElement("div");
          node.className = "ai-inline-suggestion";
          if (isLearnModeSuggestion) {
            node.classList.add("learn-mode");
            node.style.pointerEvents = "none";
          }

          const preview = document.createElement("div");
          preview.className = "ai-inline-suggestion-preview";
          preview.textContent = step.codeSnippet || step.replacementCode || step.replacement || "";
          node.appendChild(preview);

          if (!isLearnModeSuggestion) {
            const editable = document.createElement("div");
            editable.className = "ai-inline-suggestion-editable";
            editable.contentEditable = true;
            editable.spellcheck = false;
            editable.setAttribute("role", "textbox");
            editable.setAttribute("aria-label", "AI suggested code");
            editable.textContent = step.codeSnippet || step.replacementCode || step.replacement || "";
            node.appendChild(editable);

            const actionsRow = document.createElement("div");
            actionsRow.className = "ai-inline-suggestion-actions";
            const acceptBtn = document.createElement("button");
            acceptBtn.className = "ai-inline-suggestion-accept";
            acceptBtn.textContent = "Accept";
            const cancelBtn = document.createElement("button");
            cancelBtn.className = "ai-inline-suggestion-cancel";
            cancelBtn.textContent = "Cancel";
            actionsRow.appendChild(acceptBtn);
            actionsRow.appendChild(cancelBtn);
            node.appendChild(actionsRow);

            acceptBtn.addEventListener("click", async () => {
              try {
                const model = ed.getModel();
                if (!model) return;
                const codeText = editable.textContent || "";
                const insertLine = focusLine || 1;
                const insertPos = { lineNumber: insertLine, column: 1 };
                if (step.insertionLocation && typeof step.insertionLocation.afterLine === "number") {
                  insertPos.lineNumber = Math.max(1, (step.insertionLocation.afterLine || 0) + 1);
                }
                ed.pushUndoStop();
                ed.executeEdits(_inlineWidgetId, [
                  {
                    range: new monaco.Range(insertPos.lineNumber, 1, insertPos.lineNumber, 1),
                    text: codeText + "\n",
                    forceMoveMarkers: true,
                  },
                ]);
                ed.pushUndoStop();
                try {
                  ed.removeContentWidget(_inlineWidget);
                } catch (_) {}
                try {
                  if (typeof showToast === "function") showToast("Inserted suggested code", "success", 1600);
                } catch (_) {}
              } catch (err) {
                console.error(err);
              }
            });
            cancelBtn.addEventListener("click", () => {
              try {
                ed.removeContentWidget(_inlineWidget);
              } catch (_) {}
            });
            setTimeout(() => { try { editable.focus(); } catch (_) {} }, 40);
          }

          _inlineWidgetId = "ai-inline-" + Date.now();
          const widget = {
            getId() {
              return _inlineWidgetId;
            },
            getDomNode() {
              return node;
            },
            getPosition() {
              if (focusLine) {
                return {
                  position: { lineNumber: focusLine, column: 1 },
                  preference: [
                    monaco.editor.ContentWidgetPositionPreference.ABOVE,
                    monaco.editor.ContentWidgetPositionPreference.BELOW,
                  ],
                };
              }
              return {
                position: { lineNumber: 1, column: 1 },
                preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
              };
            },
          };

          ed.addContentWidget(widget);
          _inlineWidget = widget;

          if (isLearnModeSuggestion) {
            _inlineWidgetDisposable = ed.onDidChangeModelContent(() => {
              try {
                const dom = widget.getDomNode();
                if (dom) dom.classList.add("ai-inline-suggestion-faded");
              } catch (_) {}
            });
          }
        }
      } catch (e) {
        console.error("inline suggestion failed", e);
      }
    }

    // PATH A: line-anchored — popover sits beside the highlighted Monaco lines.
    const hasEd = !!getActiveCodeEditor();
    const useLineAnchor =
      Array.isArray(step.lineRanges) && step.lineRanges.length && hasEd;
    if (useLineAnchor) {
      let retryCount = 0;
      const reposition = () => {
        if (popoverEl.classList.contains("manual-moved")) return;
        const success = positionBesideLine(
          popoverEl,
          step.lineRanges,
          state.guideMode === "popup",
        );
        // If we failed to get a line rect, retry a few times as Monaco might be laying out
        if (!success && retryCount < 5) {
          retryCount++;
          requestAnimationFrame(reposition);
        }
      };
      requestAnimationFrame(reposition);

      let scrollDisp = null;
      try {
        const edScroll = getActiveCodeEditor();
        if (edScroll) scrollDisp = edScroll.onDidScrollChange(reposition);
      } catch (_) {}

      // If we're in inline guide mode, gently dim the editor and keep
      // an inline-focused class on the editor container so CSS can style
      // the inline callout and dim unrelated lines.
      let _inlineEditorDom = null;
      if (state.guideMode === "inline") {
        try {
          const ed = getActiveCodeEditor();
          if (ed && ed.getDomNode) {
            _inlineEditorDom = ed.getDomNode();
            if (_inlineEditorDom)
              _inlineEditorDom.classList.add("inline-guide-active");
          }
        } catch (_) {}
      }

      window.addEventListener("resize", reposition);
      const cleanup = () => {
        window.removeEventListener("resize", reposition);
        try {
          scrollDisp && scrollDisp.dispose();
        } catch (_) {}
        try {
          if (_inlineEditorDom)
            _inlineEditorDom.classList.remove("inline-guide-active");
        } catch (_) {}
        try {
          const _ed = getActiveCodeEditor();
          if (_ed && _inlineWidget) _ed.removeContentWidget(_inlineWidget);
        } catch (_) {}
        try {
          if (_inlineWidgetDisposable) _inlineWidgetDisposable.dispose();
        } catch (_) {}
      };
      current = { step, mode, anchorEl: null, popoverEl, cleanup };
      return;
    }

    // PATH B: anchor-element based (terminal, file-tree node, button, etc.)
    const anchor = resolveAnchor(step);

    if (anchor) {
      anchor.classList.add("active-step-anchor");
      try {
        anchor.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      } catch (_) {}
    } else {
      // No explicit anchor (e.g., general instruction). If the user prefers
      // inline guide mode, try to position the compact inline callout beside
      // the active editor instead of showing the large floating popup.
      if (state.guideMode === "inline") {
        try {
          const ed = getActiveCodeEditor();
          const edDom = ed && ed.getDomNode && ed.getDomNode();
          if (edDom) {
            requestAnimationFrame(() => {
              position(popoverEl, edDom);
            });
          } else {
            popoverEl.classList.add("floating");
            const winW = window.innerWidth,
              winH = window.innerHeight;
            requestAnimationFrame(() => {
              const pop = popoverEl.getBoundingClientRect();
              popoverEl.style.left = Math.max(8, winW - pop.width - 24) + "px";
              popoverEl.style.top = Math.max(8, winH - pop.height - 80) + "px";
            });
          }
        } catch (_) {
          popoverEl.classList.add("floating");
        }
      } else {
        popoverEl.classList.add("floating");
        const winW = window.innerWidth,
          winH = window.innerHeight;
        requestAnimationFrame(() => {
          const pop = popoverEl.getBoundingClientRect();
          popoverEl.style.left = Math.max(8, winW - pop.width - 24) + "px";
          popoverEl.style.top = Math.max(8, winH - pop.height - 80) + "px";
        });
      }
    }

    let cleanup = () => {};
    if (anchor) {
      const reposition = () => {
        if (!popoverEl.classList.contains("manual-moved"))
          position(popoverEl, anchor);
      };
      requestAnimationFrame(() => {
        reposition();
      });
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);
      cleanup = () => {
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
        try {
          const _ed = getActiveCodeEditor();
          if (_ed && _inlineWidget) _ed.removeContentWidget(_inlineWidget);
        } catch (_) {}
      };
    }

    current = { step, mode, anchorEl: anchor, popoverEl, cleanup };
  }

  async function complete(step) {
    // Award XP in DynamoDB for completing step
    try {
      const session = typeof AuthManager !== "undefined" ? AuthManager.getStoredSession() : null;
      const userId = session?.userId || state.currentUserId || "anonymous_user";
      if (window.electronAPI?.aws?.updateProgress) {
        window.electronAPI.aws.updateProgress({
          userId,
          xpDelta: 25,
          conceptId: step.stepTitle || "step_completion",
          solved: true
        });
      }
    } catch (_) {}

    // Detail-detour exit — return to the paused walkthrough WITHOUT calling the AI
    if (inDetailDetour) {
      inDetailDetour = false;
      if (walkthroughActive && stepQueue.length > 0) {
        advance();
      } else {
        walkthroughActive = false;
        dismiss();
        showToast("Step completed! (+25 XP)", "success", 2000);
      }
      return;
    }

    // During an active walkthrough, "Done" advances LOCALLY through the queue without extra API calls
    if (walkthroughActive) {
      if (stepQueue.length > 0) {
        advance();
      } else {
        walkthroughActive = false;
        dismiss();
        showToast("Milestone completed! (+25 XP) 🎉", "success", 2500);
      }
      return;
    }

    // Standalone step completion — complete cleanly without infinite AI loops
    dismiss();
    showToast("Step completed! (+25 XP) ✨", "success", 2000);
  }

  async function reportError(step) {
    let captured = "";
    let source = "recent terminal output";
    // 1. Prefer xterm selection
    try {
      const inst =
        typeof terminals !== "undefined" &&
        typeof activeTerminalId !== "undefined"
          ? terminals.get(activeTerminalId)
          : null;
      const sel =
        inst && inst.term && typeof inst.term.getSelection === "function"
          ? inst.term.getSelection()
          : "";
      if (sel && sel.trim()) {
        captured = sel.trim();
        source = "selected terminal lines";
      }
    } catch (_) {}
    // 2. Otherwise, recent error-flagged lines
    if (!captured && typeof ProjectContext !== "undefined") {
      const errs = ProjectContext.detectErrorsInLogs(80);
      const logs = ProjectContext.getRecentTerminalLogs(40);
      const lines = errs && errs.length ? errs : logs;
      captured = lines.slice(-25).join("\n");
      if (errs && errs.length) source = "recent terminal errors";
    }
    dismiss();
    const intro = `I'm stuck on step: "${step.stepTitle}".`;
    const body = captured
      ? `\n\nHere are the ${source}:\n\n\`\`\`\n${captured}\n\`\`\``
      : `\n\n(No terminal output captured. Ask me what I see.)`;
    const tail = `\n\nDiagnose what went wrong, explain it, and give me the next step to recover.`;
    if (typeof AIChat !== "undefined") {
      const visibleText = `I got an error on step: ${step.stepTitle}`;
      await AIChat.send(intro + body + tail, {
        mode: state.chatMode,
        includeStructure: true,
        visibleText,
      });
    }
  }

  // Show an instant lightweight popover anchored to a line range BEFORE the
  // AI response arrives. Gives the user a snappy visual confirmation that
  // the request was received.
  async function showLoading({
    title = "Analyzing…",
    targetFile = null,
    lineRanges = null,
    mode = "explain",
  } = {}) {
    dismiss();
    if (!Array.isArray(lineRanges) || !lineRanges.length) return;

    // Make sure the file is open and the lines are revealed
    if (targetFile && state.workspaceRoot) {
      const full = targetFile.startsWith("/")
        ? targetFile
        : state.workspaceRoot.replace(/\/$/, "") +
          "/" +
          targetFile.replace(/^\//, "");
      try {
        if (state.openFiles && state.openFiles.has(full)) setActiveFile(full);
        else await openFile(full);
      } catch (_) {}
    }

    // Paint the highlight rail
    Highlights.apply(lineRanges);

    // Build a minimal popover (no actions, just a spinner and a label).
    const root = document.createElement("div");
    root.className =
      "active-step active-step-loading mode-" + (mode || "explain");
    root.setAttribute("role", "status");
    const arrow = document.createElement("div");
    arrow.className = "active-step-arrow";
    const inner = document.createElement("div");
    inner.className = "active-step-inner";
    const spinner = document.createElement("div");
    spinner.className = "active-step-spinner";
    const label = document.createElement("div");
    label.className = "active-step-loading-label";
    label.textContent = title;
    inner.append(spinner, label);
    root.append(arrow, inner);
    document.body.appendChild(root);

    const reposition = () => positionBesideLine(root, lineRanges);
    requestAnimationFrame(reposition);
    let scrollDisp = null;
    try {
      const edScroll = getActiveCodeEditor();
      if (edScroll) scrollDisp = edScroll.onDidScrollChange(reposition);
    } catch (_) {}
    window.addEventListener("resize", reposition);
    const cleanup = () => {
      window.removeEventListener("resize", reposition);
      try {
        scrollDisp && scrollDisp.dispose();
      } catch (_) {}
      try {
        const _ed = getActiveCodeEditor();
        if (_ed && _inlineWidget) _ed.removeContentWidget(_inlineWidget);
      } catch (_) {}
    };
    current = {
      step: { _loading: true },
      mode,
      anchorEl: null,
      popoverEl: root,
      cleanup,
    };
  }

  // Entry point used by AIChat when an AI response is parsed: if there are
  // 2+ steps it becomes a walkthrough; if 1 it's the existing single-step.
  // Special case: when the user asked an "Explain in detail" follow-up and
  // a walkthrough is currently paused for them, treat the incoming step as
  // a detail detour overlay and preserve the queue.
  async function play(steps, mode) {
    if (!Array.isArray(steps) || !steps.length) return;

    if (detailExpected && walkthroughActive && steps.length === 1) {
      detailExpected = false;
      inDetailDetour = true;
      const det = { ...steps[0], mode, _detail: true };
      await show(det, mode);
      return;
    }
    detailExpected = false;
    inDetailDetour = false;

    resetWalkthrough();
    if (steps.length === 1) {
      await show({ ...steps[0], mode }, mode);
      return;
    }
    walkthroughActive = true;
    stepTotal = steps.length;
    stepCursor = 0;
    stepQueue = steps.slice(1).map((s) => ({ ...s, mode }));
    await show(
      { ...steps[0], mode, _walk: { index: 0, total: stepTotal } },
      mode,
    );
  }

  function advance() {
    if (!walkthroughActive || !stepQueue.length) {
      walkthroughActive = false;
      stepQueue = [];
      dismiss();
      return false;
    }
    stepCursor += 1;
    const next = stepQueue.shift();
    next._walk = { index: stepCursor, total: stepTotal };
    show(next, next.mode || state.chatMode);
    return true;
  }

  function isWalkthroughActive() {
    return walkthroughActive;
  }

  return {
    show,
    dismiss,
    complete,
    reportError,
    play,
    advance,
    showLoading,
    resetWalkthrough,
    isWalkthroughActive,
  };
})();

/* -------------------- Run File -------------------- */
function getRunCommand(filePath, lang) {
  const ext = filePath.split(".").pop().toLowerCase();
  const name = filePath.split(/[/\\]/).pop();
  const map = {
    py: { cmd: `python ${name}` },
  };
  return map[ext] || null;
}

async function runActiveFile() {
  const filePath = state.activeFile;
  if (
    !filePath ||
    filePath.startsWith("untitled:") ||
    filePath.startsWith("diff://")
  ) {
    showToast("Save the file first to run it.", "info");
    return;
  }
  const meta = state.openFiles.get(filePath);
  if (!meta) return;

  // Save first if dirty
  if (meta.dirty) {
    const ok = await saveActive(filePath);
    if (!ok) return;
  }

  const runInfo = getRunCommand(filePath, meta.lang);
  if (!runInfo) {
    showToast(
      `No run command configured for .${filePath.split(".").pop()} files`,
      "info",
    );
    return;
  }

  if (runInfo.browser) {
    // Open HTML files in browser
    window.electronAPI.openExternal("file://" + filePath);
    showToast("Opened in browser", "success", 1400);
    return;
  }

  // Execute in terminal
  const container = $("terminal-container");
  if (container.classList.contains("hidden"))
    container.classList.remove("hidden");
  switchPanel("terminal");

  const inst = activeTerminal();
  if (inst && inst.prompted) {
    inst.term.write("\r\n");
    inst.buffer = "";
    inst.cursor = 0;
    inst.prompted = false;
    inst.waitingForOutput = true;
    window.electronAPI.execTerminal(inst.id, runInfo.cmd);
    showToast(`Running ${meta.name}`, "success", 1400);
  } else {
    showToast("Terminal is busy, please wait...", "info");
  }
}

function updateRunButton() {
  const btn = $("run-file-btn");
  if (!btn) return;
  const filePath = state.activeFile;
  if (
    !filePath ||
    filePath.startsWith("untitled:") ||
    filePath.startsWith("diff://")
  ) {
    btn.style.display = "none";
    return;
  }
  const runInfo = getRunCommand(filePath);
  if (runInfo) {
    btn.style.display = "flex";
    btn.title = runInfo.browser ? "Open in Browser (⌘⇧R)" : `Run File (⌘⇧R)`;
  } else {
    btn.style.display = "none";
  }
}

/* -------------------- @-Mention File Picker -------------------- */
let _projectFileCache = null;
let _projectFileCacheTime = 0;

async function loadProjectFilesForMention(searchTerm) {
  const mentionList = $("mention-popover-list");
  const input = $("chat-input");
  if (!mentionList) return;

  // Load full file tree (with caching)
  if (!state.workspaceRoot) {
    mentionList.innerHTML =
      '<div style="padding:8px 12px;color:var(--text-dim);font-size:12px;">Open a folder first</div>';
    return;
  }

  const now = Date.now();
  if (!_projectFileCache || now - _projectFileCacheTime > 10000) {
    try {
      _projectFileCache = await window.electronAPI.walkTree(
        state.workspaceRoot,
      );
      _projectFileCacheTime = now;
    } catch (e) {
      mentionList.innerHTML =
        '<div style="padding:8px 12px;color:var(--text-dim);font-size:12px;">Failed to load files</div>';
      return;
    }
  }

  // Filter to files only (not dirs) and apply search
  let files = (_projectFileCache || []).filter((f) => !f.isDir);
  if (searchTerm) {
    files = files.filter(
      (f) =>
        f.path.toLowerCase().includes(searchTerm) ||
        f.name.toLowerCase().includes(searchTerm),
    );
  }
  files = files.slice(0, 50); // Cap at 50 results

  mentionList.innerHTML = "";
  if (files.length === 0) {
    mentionList.innerHTML =
      '<div style="padding:8px 12px;color:var(--text-dim);font-size:12px;">No files found</div>';
    return;
  }

  for (const file of files) {
    const btn = document.createElement("button");
    btn.className = "chat-popover-item compact mention-file-item";
    btn.innerHTML = `
      <span class="mention-file-icon">${fileIconFor(file.name)}</span>
      <span class="mention-file-name">${escapeHtml(file.name)}</span>
      <span class="mention-file-path">${escapeHtml(file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "")}</span>
    `;
    btn.addEventListener("click", async () => {
      // Insert styled file reference
      const val = input.value;
      const lastAt = val.lastIndexOf("@");
      const fileTag = `@${file.path}`;
      if (lastAt !== -1) {
        input.value = val.substring(0, lastAt) + fileTag + " ";
      } else {
        input.value +=
          (input.value && !input.value.endsWith(" ") ? " " : "") +
          fileTag +
          " ";
      }
      input.focus();
      autoGrowTextarea(input);
      closeAllPopovers();

      // Attach file content as context
      try {
        const result = await window.electronAPI.readFile(file.fullPath);
        if (result.ok) {
          state.contextSnippets = state.contextSnippets || {};
          const snippet =
            result.content.length > 8000
              ? result.content.slice(0, 8000) + "\n... (truncated)"
              : result.content;
          state.contextSnippets[fileTag] =
            `\n\n[File: ${file.path}]\n\`\`\`\n${snippet}\n\`\`\`\n`;
          renderContextChips();
        }
      } catch (_) {}
    });
    mentionList.appendChild(btn);
  }
}

/* -------------------- Chat Image Attachments -------------------- */
state.chatAttachments = [];

function hasImageFiles(dt) {
  if (!dt || !dt.types) return false;
  if (dt.types.includes("Files")) {
    for (const item of dt.items || []) {
      if (item.type && item.type.startsWith("image/")) return true;
    }
  }
  return false;
}

function handleImageFiles(files) {
  const session = typeof AuthManager !== "undefined" ? AuthManager.getStoredSession() : null;
  const userId = session?.userId || state.currentUserId || "anonymous_user";

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const reader = new FileReader();
    reader.onload = async () => {
      const att = {
        name: file.name,
        data: reader.result,
        size: file.size,
        uploading: true
      };
      state.chatAttachments.push(att);
      renderAttachmentPreviews();

      if (window.electronAPI?.aws?.uploadImage) {
        try {
          const res = await window.electronAPI.aws.uploadImage({
            base64Data: reader.result,
            filename: file.name,
            userId
          });
          if (res && res.ok) {
            att.s3Url = res.s3Url;
            att.s3Uri = res.s3Uri;
            att.uploading = false;
            renderAttachmentPreviews();
            showToast(`☁️ Image saved to AWS S3: ${file.name}`, "info", 2000);
          }
        } catch (err) {
          att.uploading = false;
          console.warn("S3 image upload error:", err);
        }
      }
    };
    reader.readAsDataURL(file);
  }
}

function renderAttachmentPreviews() {
  const preview = $("chat-attachments-preview");
  if (!preview) return;
  if (state.chatAttachments.length === 0) {
    preview.style.display = "none";
    preview.innerHTML = "";
    return;
  }
  preview.style.display = "flex";
  preview.innerHTML = "";
  state.chatAttachments.forEach((att, idx) => {
    const card = document.createElement("div");
    card.className = "attachment-preview-card";
    const cloudBadge = att.s3Url ? '<span title="Saved to AWS S3" style="font-size:10px;color:var(--accent-emerald,#10b981);margin-right:3px;">☁️</span>' : '';
    card.innerHTML = `
      <img src="${att.data}" alt="${escapeHtml(att.name)}" />
      <button class="attachment-remove" title="Remove">&times;</button>
      <span class="attachment-name">${cloudBadge}${escapeHtml(att.name)}</span>
    `;
    card.querySelector(".attachment-remove").addEventListener("click", () => {
      state.chatAttachments.splice(idx, 1);
      renderAttachmentPreviews();
    });
    preview.appendChild(card);
  });
}

function renderContextChips() {
  const container = $("chat-context-chips");
  if (!container) return;
  const keys = state.contextSnippets ? Object.keys(state.contextSnippets) : [];
  if (keys.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }
  container.style.display = "flex";
  container.innerHTML = "";
  keys.forEach((tag) => {
    const isAt = tag.startsWith("@");
    const name = isAt
      ? tag.substring(1)
      : tag.replace(/^\[📄\s*/, "").replace(/\]$/, "");
    const chip = document.createElement("div");
    chip.className = "context-chip";
    chip.innerHTML = `
      <span class="context-chip-icon">📄</span>
      <span class="context-chip-name" title="${escapeHtml(name)}">${escapeHtml(name.split("/").pop())}</span>
      <button class="context-chip-remove" title="Remove">&times;</button>
    `;
    chip.querySelector(".context-chip-remove").addEventListener("click", () => {
      delete state.contextSnippets[tag];
      const input = $("chat-input");
      if (input) {
        input.value = input.value.replace(tag, "").replace(/\s+/g, " ").trim();
      }
      renderContextChips();
    });
    container.appendChild(chip);
  });
}

/* ============================================================
 * AuthManager — Handles Onboarding, Cognito Auth, & Credits Sync
 * ============================================================ */
const AuthManager = (() => {
  const SESSION_KEY = "buildex_user_session";
  let pollTimer = null;
  let currentUser = null;
  let currentAuthSessionId = null;
  let currentAuthUrl = null;

  function getStoredSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(user) {
    currentUser = user;
    state.currentUserId = user?.userId || null;
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    updateUI();
  }

  function clearSession() {
    currentUser = null;
    state.currentUserId = null;
    localStorage.removeItem(SESSION_KEY);
    // Wipe in-memory chats so they don't bleed into the next user's session
    if (typeof Chat !== "undefined") Chat.reset();
    updateUI();
  }

  function showOnboarding() {
    const overlay = $("onboarding-overlay");
    if (!overlay) return;
    overlay.style.display = "flex";
    const actions = $("onboarding-actions-box");
    if (actions) actions.style.display = "flex";
    const wait = $("onboarding-waiting-box");
    if (wait) wait.style.display = "none";
  }

  function hideOnboarding() {
    if (!getStoredSession()) {
      return; // Force sign in — no bypass without active session
    }
    const overlay = $("onboarding-overlay");
    if (overlay) overlay.style.display = "none";
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    currentAuthSessionId = null;
  }

  async function initiateAuth({ action = "login", provider = null } = {}) {
    const actionsBox = $("onboarding-actions-box");
    const waitingBox = $("onboarding-waiting-box");
    if (actionsBox) actionsBox.style.display = "none";
    if (waitingBox) waitingBox.style.display = "flex";

    try {
      const res = await window.electronAPI.auth.initiate({ action, provider });
      if (!res || !res.ok) {
        showToast(res?.error || "Failed to start authentication session", "error", 4000);
        cancelWaiting();
        return;
      }

      currentAuthSessionId = res.authSessionId;
      currentAuthUrl = res.authUrl;
      startPolling(res.authSessionId);
    } catch (err) {
      showToast(err.message || "Error opening authentication browser", "error", 4000);
      cancelWaiting();
    }
  }

  function cancelWaiting() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    currentAuthSessionId = null;
    const actionsBox = $("onboarding-actions-box");
    const waitingBox = $("onboarding-waiting-box");
    if (actionsBox) actionsBox.style.display = "flex";
    if (waitingBox) waitingBox.style.display = "none";
  }

  async function checkSessionStatus(sessionId) {
    if (!sessionId) return false;
    try {
      const pollRes = await window.electronAPI.auth.poll(sessionId);
      if (pollRes && pollRes.ok) {
        const status = pollRes.status || pollRes.session?.status;
        const user = pollRes.user || pollRes.session?.user;
        if (status === "authenticated" && user) {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          currentAuthSessionId = null;
          saveSession(user);
          hideOnboarding();
          showToast(`Welcome to BuildeX, ${user.name || user.email || "Developer"}!`, "success", 3500);
          // Load this user's chats: local cache first, then cloud sync
          if (typeof Chat !== "undefined") {
            Chat.switchUser(user.userId);
          }
          return true;
        } else if (status === "expired") {
          cancelWaiting();
          showToast("Authentication session expired. Please try again.", "error", 3500);
          return true;
        }
      }
    } catch (err) {
      console.warn("Auth check error:", err);
    }
    return false;
  }

  function startPolling(sessionId) {
    if (pollTimer) clearInterval(pollTimer);
    let attempts = 0;
    const maxAttempts = 300; // ~7.5 minutes at 1.5s interval

    pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        cancelWaiting();
        showToast("Login session timed out. Please try again.", "warn", 4000);
        return;
      }

      await checkSessionStatus(sessionId);
    }, 1500);
  }

  async function refreshAccount() {
    const session = getStoredSession();
    if (!session || !session.userId) return;
    try {
      const res = await window.electronAPI.auth.getAccount(session.userId);
      if (res && res.ok && res.user) {
        saveSession(res.user);
        renderAccountModal(res.user);
      }
    } catch (err) {
      console.warn("Account sync error:", err);
    }
  }

  function updateUI() {
    const session = getStoredSession();
    currentUser = session;

    const creditsEl = $("status-credits-text");
    const userPill = $("status-user-name");
    const avatarMini = $("status-avatar-mini");

    const settingsName = $("settings-user-name");
    const settingsAvatar = $("settings-user-avatar");
    const settingsRole = $("settings-user-role");
    const settingsLogoutBtn = $("settings-logout-btn");
    const settingsLogoutDiv = $("settings-logout-divider");

    if (session) {
      const displayName = session.name || (session.email ? session.email.split("@")[0] : "Developer");
      const rem = session.creditsRemaining !== undefined ? session.creditsRemaining : 500;
      const tot = session.creditsTotal || 500;
      const displayRem = typeof rem === "number" ? (rem % 1 === 0 ? rem : rem.toFixed(1)) : rem;
      
      if (creditsEl) creditsEl.textContent = `${displayRem} / ${tot} Credits`;
      if (userPill) userPill.textContent = displayName;
      if (avatarMini) avatarMini.textContent = "⚡";

      if (settingsName) settingsName.textContent = displayName;
      if (settingsRole) settingsRole.textContent = `${session.email || "AWS Connected"} • ap-south-1`;
      if (settingsAvatar) {
        if (session.avatar) {
          settingsAvatar.innerHTML = `<img src="${session.avatar}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
        } else {
          settingsAvatar.textContent = displayName.charAt(0).toUpperCase();
        }
      }
      if (settingsLogoutBtn) settingsLogoutBtn.style.display = "flex";
      if (settingsLogoutDiv) settingsLogoutDiv.style.display = "block";
    } else {
      if (creditsEl) creditsEl.textContent = "Sign in for credits";
      if (userPill) userPill.textContent = "Sign In";
      if (avatarMini) avatarMini.textContent = "👤";

      if (settingsName) settingsName.textContent = "Sign In";
      if (settingsRole) settingsRole.textContent = "AWS Cloud • ap-south-1";
      if (settingsAvatar) settingsAvatar.textContent = "👤";
      if (settingsLogoutBtn) settingsLogoutBtn.style.display = "none";
      if (settingsLogoutDiv) settingsLogoutDiv.style.display = "none";
    }
  }

  function resetNameEditor() {
    const editor = $("account-modal-name-editor");
    const nameEl = $("account-modal-name");
    const editBtn = $("account-modal-edit-name");
    if (editor) editor.style.display = "none";
    if (nameEl) nameEl.style.display = "";
    if (editBtn) editBtn.style.display = "";
  }

  function renderAccountModal(user) {
    const u = user || getStoredSession();
    if (!u) return;

    // Always reset inline editor when re-rendering
    resetNameEditor();

    const displayName = u.name || (u.email ? u.email.split("@")[0] : "Developer");
    const modalName = $("account-modal-name");
    if (modalName) modalName.textContent = displayName;
    const modalEmail = $("account-modal-email");
    if (modalEmail) modalEmail.textContent = u.email || "";
    const modalTier = $("account-modal-tier");
    if (modalTier) {
      const tierVal = (u.tier || "").toLowerCase();
      modalTier.textContent = (tierVal === "pro" || tierVal === "start") ? "Pro Tier" : (tierVal === "enterprise" ? "Enterprise" : "Free Tier");
    }

    const rem = u.creditsRemaining !== undefined ? u.creditsRemaining : 500;
    const tot = u.creditsTotal || 500;
    const displayRem = typeof rem === "number" ? (rem % 1 === 0 ? rem : rem.toFixed(1)) : rem;
    const remEl = $("account-credits-rem");
    if (remEl) remEl.textContent = displayRem;
    const totEl = $("account-credits-total");
    if (totEl) totEl.textContent = `of ${tot} granted`;
    const tokensEl = $("account-tokens-used");
    if (tokensEl) tokensEl.textContent = (u.tokensUsed || 0).toLocaleString();
    const reqEl = $("account-requests-count");
    if (reqEl) reqEl.textContent = u.requestsCount || 0;
    const streakEl = $("account-streak");
    if (streakEl) streakEl.textContent = `🔥 ${u.streak || 1}`;

    const pct = Math.min(100, Math.max(0, Math.round(((tot - rem) / tot) * 100)));
    const pctEl = $("account-credits-pct");
    if (pctEl) pctEl.textContent = `${pct}%`;
    const fillEl = $("account-credits-fill");
    if (fillEl) fillEl.style.width = `${pct}%`;

    const avatarImg = $("account-modal-avatar");
    if (avatarImg) {
      if (u.avatar) {
        avatarImg.src = u.avatar;
      } else {
        const seed = encodeURIComponent(u.email || displayName);
        avatarImg.src = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${seed}`;
      }
    }
  }

  function showAccountModal() {
    if (!getStoredSession()) {
      showOnboarding();
      return;
    }
    renderAccountModal(currentUser);
    const modal = $("account-modal");
    if (modal) modal.style.display = "flex";
  }

  function hideAccountModal() {
    resetNameEditor();
    const modal = $("account-modal");
    if (modal) modal.style.display = "none";
  }

  async function handleAiCompletion(modelName, text) {
    const session = getStoredSession();
    if (!session || !session.userId) return;

    let creditsDelta = 0.25;
    const m = (modelName || "").toLowerCase();
    if (m.includes("sonnet") || m.includes("claude-3-7") || m.includes("claude-3-5")) {
      creditsDelta = 2.0;
    } else if (m.includes("mistral") || m.includes("large")) {
      creditsDelta = 1.0;
    } else if (m.includes("deepseek") || m.includes("v3") || m.includes("gemma") || m.includes("haiku")) {
      creditsDelta = 0.5;
    } else if (m.includes("qwen") || m.includes("coder") || m.includes("codementor")) {
      creditsDelta = 0.25;
    }

    const approxTokens = Math.max(1, Math.round((text || "").length / 4));

    try {
      const res = await window.electronAPI.auth.deductCredits({
        userId: session.userId,
        creditsDelta,
        tokensUsed: approxTokens
      });

      if (res && res.ok && res.user) {
        saveSession(res.user);
        if (res.user.creditsRemaining <= 0) {
          showToast("⚠️ Credit Balance Depleted (0 remaining).", "error", 5000);
        } else if (res.user.creditsRemaining < 10) {
          showToast(`Low Credits Warning: ${res.user.creditsRemaining.toFixed(1)} credits remaining.`, "warn", 4000);
        }
      }
    } catch (err) {
      console.warn("Failed to deduct credits:", err);
    }

    // Backup chat conversation to DynamoDB after AI completion
    if (typeof Chat !== "undefined") {
      Chat.backupToDynamoDB();
    }
  }

  function init() {
    const session = getStoredSession();
    if (!session) {
      showOnboarding();
    } else {
      state.currentUserId = session.userId;
      updateUI();
      refreshAccount();
      // Switch Chat to this user — loads their local cache then syncs from cloud
      if (typeof Chat !== "undefined") {
        Chat.switchUser(session.userId);
      }
    }

    // Wire Onboarding buttons
    $("btn-onboarding-google")?.addEventListener("click", () => initiateAuth({ action: "login", provider: "Google" }));
    $("btn-onboarding-login")?.addEventListener("click", () => initiateAuth({ action: "login" }));
    $("btn-onboarding-reopen")?.addEventListener("click", async () => {
      if (currentAuthUrl) {
        window.electronAPI.openExternal(currentAuthUrl);
      } else {
        initiateAuth({ action: "login" });
      }
    });
    $("btn-onboarding-cancel")?.addEventListener("click", () => cancelWaiting());

    // Window focus triggers instant sync check if polling is active
    window.addEventListener("focus", () => {
      if (currentAuthSessionId && pollTimer) {
        checkSessionStatus(currentAuthSessionId);
      }
    });

    // Wire Status Bar Badges
    $("status-credits")?.addEventListener("click", () => {
      if (getStoredSession()) {
        showAccountModal();
      } else {
        showOnboarding();
      }
    });
    $("status-user-pill")?.addEventListener("click", () => {
      if (getStoredSession()) {
        showAccountModal();
      } else {
        showOnboarding();
      }
    });

    // Wire Activity Bar Account button
    $("activity-account-btn")?.addEventListener("click", () => {
      if (getStoredSession()) {
        showAccountModal();
      } else {
        showOnboarding();
      }
    });

    // Wire Account Modal buttons
    $("account-modal-close")?.addEventListener("click", () => hideAccountModal());
    $("account-modal-refresh")?.addEventListener("click", async () => {
      showToast("Syncing with AWS Cloud...", "info", 1500);
      await refreshAccount();
      if (typeof Chat !== "undefined") {
        await Chat.syncFromDynamoDB();
      }
    });
    $("account-modal-upgrade")?.addEventListener("click", () => {
      if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
        window.electronAPI.openExternal("https://buildexide.dev/#pricing");
      } else {
        window.open("https://buildexide.dev/#pricing", "_blank");
      }
      hideAccountModal();
      showToast("Opening BuildeX subscription plans in browser...", "info", 2000);
    });
    $("account-modal-logout")?.addEventListener("click", () => {
      clearSession();
      hideAccountModal();
      showToast("Logged out successfully.", "info", 2000);
      showOnboarding();
    });
    $("account-modal-edit-name")?.addEventListener("click", () => {
      const session = getStoredSession();
      if (!session) return;
      const currentName = session.name || (session.email ? session.email.split("@")[0] : "");

      // Show inline editor, hide static name + edit button
      const nameEl = $("account-modal-name");
      const editBtn = $("account-modal-edit-name");
      const nameEditor = $("account-modal-name-editor");
      const nameInput = $("account-modal-name-input");

      if (nameEl) nameEl.style.display = "none";
      if (editBtn) editBtn.style.display = "none";
      if (nameEditor) nameEditor.style.display = "flex";
      if (nameInput) {
        nameInput.value = currentName;
        nameInput.focus();
        nameInput.select();
      }
    });

    async function saveInlineName() {
      const session = getStoredSession();
      if (!session) return;
      const nameInput = $("account-modal-name-input");
      const newName = nameInput?.value?.trim();
      const currentName = session.name || (session.email ? session.email.split("@")[0] : "");

      resetNameEditor();

      if (newName && newName !== currentName) {
        session.name = newName;
        saveSession(session);
        currentUser = session;
        renderAccountModal(session);
        updateUI();
        if (window.electronAPI.auth?.updateProfile) {
          try {
            await window.electronAPI.auth.updateProfile({
              userId: session.userId,
              name: session.name
            });
            showToast(`✅ Display name updated to "${session.name}"`, "success", 2500);
          } catch (err) {
            console.warn("DynamoDB profile sync error:", err);
            showToast(`Display name saved locally`, "info", 2000);
          }
        }
      } else {
        // Just re-render to restore static view
        renderAccountModal(session);
      }
    }

    $("account-modal-name-save")?.addEventListener("click", saveInlineName);

    $("account-modal-name-cancel")?.addEventListener("click", () => {
      const session = getStoredSession();
      resetNameEditor();
      if (session) renderAccountModal(session);
    });

    $("account-modal-name-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveInlineName(); }
      if (e.key === "Escape") { e.preventDefault(); const s = getStoredSession(); resetNameEditor(); if (s) renderAccountModal(s); }
    });

    // Close modal when clicking backdrop
    $("account-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "account-modal") hideAccountModal();
    });
  }

  return {
    init,
    showOnboarding,
    hideOnboarding,
    showAccountModal,
    hideAccountModal,
    refreshAccount,
    clearSession,
    saveSession,
    getStoredSession,
    updateUI,
    handleAiCompletion,
    getCurrentUser: () => currentUser
  };
})();

/* -------------------- Boot -------------------- */
async function boot() {
  state.appInfo = await window.electronAPI.getAppInfo();
  if (state.appInfo && state.appInfo.platform) {
    document.body.classList.add('platform-' + state.appInfo.platform);
    if (state.appInfo.platform === 'darwin') {
      document.body.classList.add('is-mac');
      document.documentElement.classList.add('platform-darwin', 'is-mac');
    }
  }

  const setFullscreenState = (isFull) => {
    document.body.classList.toggle('is-fullscreen', isFull);
    document.documentElement.classList.toggle('is-fullscreen', isFull);
  };

  if (state.appInfo?.isFullScreen) {
    setFullscreenState(true);
  }

  if (window.electronAPI.onFullscreenChange) {
    window.electronAPI.onFullscreenChange(setFullscreenState);
  }

  window.addEventListener('resize', () => {
    const isFull = (window.innerHeight >= screen.availHeight - 10 && window.innerWidth >= screen.availWidth - 10);
    if (isFull !== document.body.classList.contains('is-fullscreen')) {
      // In fullscreen on mac, the titlebar slides to 12px padding
    }
  });

  setupUI();
  setupChat();
  setupTerminalResize();
  setupPanelResize();
  Output.init();
  DebugConsole.init();
  Search.setup();
  Git.setup();
  setupGlobalSearchShortcuts();
  setupAIShortcuts();
  AIChat.init();
  AuthManager.init();
  await tryRestorePersistedWorkspace();
  // Listen for workspace fs changes
  try {
    window.electronAPI.onFsChanged(() => scheduleTreeRefresh());
  } catch (_) {}
  Output.log("BuildeX", "BuildeX Coder IDE started.");
  await initMonaco();
  await restorePersistedOpenEditors();
  // Create the first terminal session shortly after xterm scripts are ready
  setTimeout(() => {
    newTerminal();
  }, 200);
}

function setupAIShortcuts() {
  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta || !e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === "e") {
      e.preventDefault();
      explainSelectedCode();
    } else if (key === "d") {
      e.preventDefault();
      debugSelectedCode();
    } else if (key === "l") {
      e.preventDefault();
      learnSelectedCode();
    } else if (key === "r") {
      e.preventDefault();
      runActiveFile();
    }
  });
  // Esc cancels active streaming
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && AIChat.isStreaming()) {
      e.preventDefault();
      AIChat.cancelCurrent();
    }
  });
}

async function learnSelectedCode() {
  const sel = Selection.snapshot();
  if (!sel || sel.empty || !sel.code) {
    showToast("Select code in the editor first.", "info", 2000);
    return;
  }
  const chatEl = $("chatbot-container");
  chatEl.classList.remove("hidden");
  if (typeof setChatMode === "function") setChatMode("learn");

  const input = $("chat-input");
  if (!input) return;

  const targetFile = sel.fileName || "code";
  const lang = targetFile.split(".").pop() || "";
  const markdownBlock = `\n\n\`\`\`${lang}\n// ${targetFile} (lines ${sel.startLine}-${sel.endLine})\n${sel.code}\n\`\`\`\n`;

  const tag = `[${lang.toUpperCase()} ${targetFile} #L${sel.startLine}-${sel.endLine}]`;
  state.contextSnippets = state.contextSnippets || {};
  state.contextSnippets[tag] = markdownBlock;

  const start = input.selectionStart;
  const end = input.selectionEnd;
  const before = input.value.substring(0, start);
  const after = input.value.substring(end);
  const space = before.endsWith(" ") || before.length === 0 ? "" : " ";

  input.value = before + space + tag + " " + after;
  const newPos = before.length + space.length + tag.length + 1;
  input.setSelectionRange(newPos, newPos);

  autoGrowTextarea(input);

  if (typeof autoGrowTextarea === "function") autoGrowTextarea(input);
}

/** If the model ignored selection bounds, nudge the user (prompts already forbid this). */
function warnDebugStepsOutOfBounds(steps, bounds) {
  if (!bounds || !Array.isArray(steps)) return;
  const start = bounds.start;
  const end = bounds.end;
  const wantBase = bounds.file ? String(bounds.file).split(/[/\\]/).pop() : "";
  let bad = false;
  outer: for (const s of steps) {
    if (!Array.isArray(s.lineRanges) || !s.lineRanges.length) continue;
    const stepBase = s.targetFile
      ? String(s.targetFile).split(/[/\\]/).pop()
      : "";
    if (wantBase && stepBase && stepBase !== wantBase) continue;
    for (const r of s.lineRanges) {
      const f = parseInt(r.from, 10);
      const t = parseInt(r.to ?? r.from, 10);
      if (!Number.isFinite(f) || !Number.isFinite(t)) continue;
      if (f < start || t > end) {
        bad = true;
        break outer;
      }
    }
  }
  if (bad) {
    showToast(
      "A step targets lines outside what you selected. Widen the selection or retry.",
      "warning",
      3800,
    );
  }
}

async function explainSelectedCode() {
  const sel = Selection.snapshot();
  if (!sel || sel.empty || !sel.code) {
    showToast("Select code in the editor first.", "info", 2000);
    return;
  }
  state.debugLineBounds = null;
  captureStickyIdeSelection(sel);
  // Open chat panel and switch to Explain mode
  const chatEl = $("chatbot-container");
  chatEl.classList.remove("hidden");
  if (typeof setChatMode === "function") setChatMode("explain");

  // Snappy: paint a blue highlight + lightweight loading popover IMMEDIATELY,
  // anchored to the selected lines, so the user sees an instant response
  // instead of staring at the chat panel waiting for tokens to stream in.
  const targetFile = sel.filePath
    ? sel.filePath.replace(
        state.workspaceRoot ? state.workspaceRoot.replace(/\/$/, "") + "/" : "",
        "",
      )
    : sel.fileName;
  try {
    if (typeof ActiveStep !== "undefined" && ActiveStep.showLoading) {
      ActiveStep.showLoading({
        title: "Building walkthrough…",
        targetFile,
        lineRanges: [
          { from: sel.startLine, to: sel.endLine, kind: "highlight" },
        ],
        mode: "explain",
      });
    }
  } catch (_) {}

  // Number each selected line so the AI can cite EXACT line numbers in its
  // lineRanges (otherwise it hallucinates positions).
  const numberedCode = sel.code
    .split("\n")
    .map((ln, i) => String(sel.startLine + i).padStart(4, " ") + " │ " + ln)
    .join("\n");

  const prompt = `EXPLAIN-WALKTHROUGH request via Cmd+Shift+E.

I selected code in \`${sel.fileName}\` (lines ${sel.startLine}–${sel.endLine}).

Selected code WITH ACTUAL LINE NUMBERS (use these EXACT numbers in every \`lineRanges\` entry):
\`\`\`
${numberedCode}
\`\`\`

Give me a SEQUENCED walkthrough:
- ONE short opener sentence.
- 3–6 short \`buildex-step\` blocks, each highlighting a tight, ACCURATE line range from the numbered code above and explaining ONE concept in ≤30 words plain text.
- Walk in CODE ORDER (top to bottom).
- Reuse the same \`inlineHighlights\` color for the same concept across all steps.
The IDE plays them one at a time — emit them all in this single response.`;
  const visibleText = `Explain selection in ${sel.fileName} (lines ${sel.startLine}–${sel.endLine})`;
  await AIChat.send(prompt, {
    mode: "explain",
    includeStructure: false,
    visibleText,
  });
}

async function debugSelectedCode() {
  const sel = Selection.snapshot();
  const errors = ProjectContext.detectErrorsInLogs(80);
  if ((!sel || sel.empty || !sel.code) && (!errors || errors.length === 0)) {
    showToast(
      "Select problematic code or run a command that errors first.",
      "info",
      2400,
    );
    return;
  }
  const chatEl = $("chatbot-container");
  chatEl.classList.remove("hidden");
  if (typeof setChatMode === "function") setChatMode("debug");

  let targetFile = null;
  if (sel && !sel.empty && sel.code) {
    targetFile = sel.filePath
      ? sel.filePath.replace(
          state.workspaceRoot
            ? state.workspaceRoot.replace(/\/$/, "") + "/"
            : "",
          "",
        )
      : sel.fileName;
    state.debugLineBounds = {
      start: sel.startLine,
      end: sel.endLine,
      file: targetFile || sel.fileName,
    };
    captureStickyIdeSelection(sel);
    try {
      if (typeof ActiveStep !== "undefined" && ActiveStep.showLoading) {
        ActiveStep.showLoading({
          title: "Analyzing selection…",
          targetFile,
          lineRanges: [
            { from: sel.startLine, to: sel.endLine, kind: "highlight" },
          ],
          mode: "debug",
        });
      }
    } catch (_) {}
  } else {
    state.debugLineBounds = null;
    state.stickyIdeSelection = null;
  }

  let prompt;
  if (sel && !sel.empty && sel.code) {
    // Line-number each row so the AI can cite EXACT positions in lineRanges.
    const numberedCode = sel.code
      .split("\n")
      .map((ln, i) => String(sel.startLine + i).padStart(4, " ") + " │ " + ln)
      .join("\n");
    const errorsBlock =
      errors && errors.length
        ? `\n\nRecent terminal errors that may be related:\n\`\`\`\n${errors.slice(-15).join("\n")}\n\`\`\``
        : "";
    prompt = `DEBUG-WALKTHROUGH request via Cmd+Shift+D — same grounding as EXPLAIN (Cmd+Shift+E), but output fixes not teaching highlights.

I selected code in \`${sel.fileName}\` (lines ${sel.startLine}–${sel.endLine}).

**Bounds:** every \`from\` and \`to\` in every step MUST stay within ${sel.startLine}–${sel.endLine} inclusive. Do not reference or highlight any other line in this file. If terminal errors or logs mention other files/lines, use them only to understand the bug — still only emit \`buildex-step\` edits inside ${sel.startLine}–${sel.endLine}. If that is impossible, explain in plain text and ask the user to select a wider range (no out-of-bounds steps).

Selected code WITH ACTUAL LINE NUMBERS (use these EXACT numbers in every \`lineRanges\` entry):
\`\`\`
${numberedCode}
\`\`\`${errorsBlock}

Look for problems **only inside this block** (syntax, typos, bad tokens, obvious logic/safety issues visible here). Same file: \`${targetFile || sel.fileName}\`. Do not add steps to open or "confirm" other files unless the selection text names that path. One obvious typo → exactly one step.
If eslint.config.js / vite config / rollup config shows **syntax** errors (\`missing ':'\`, malformed object key), prefer **narrow \`inlineEdit\`** fixes (add \`:\`, fix brace/comma). Do NOT rewrite the flat-config array starting with duplicate \`import\` statements when line numbers start mid-file (\`from\` > 6).

Walk me through fixing this:
- ONE short opener sentence naming the most likely root cause **within the selection**.
- ONE \`buildex-step\` block PER DISTINCT ISSUE **inside lines ${sel.startLine}–${sel.endLine}**, in code order.
  - \`actionType\`: "modify_code"
  - \`targetFile\`: \`${targetFile || sel.fileName}\` (do not switch files for side quests)
  - \`lineRanges\`: narrow range; every \`from\`/\`to\` MUST satisfy ${sel.startLine} ≤ \`from\` ≤ \`to\` ≤ ${sel.endLine}
  - PREFER \`inlineEdit: { before, after, hint }\` for small token fixes (typos, missing characters, attribute renames). The hint should be a short imperative like "Add a / so the tag closes." Use \`lineRanges.kind: "modify"\` with \`inlineEdit\`.
  - Use \`replacementCode\` ONLY when multi-line substitution is unavoidable — its text must contain ONLY those replacement lines (not the whole selection / file); keep \`lineRanges\` as tight as the actual edit.
  - NEVER include both \`inlineEdit\` and \`replacementCode\` in the same step.
  - Prefer \`lineRanges.from === lineRanges.to\` (single offending line) for typos/stray characters instead of widening to show "full context".
  - \`explanation\`: ≤30 word plain-text reason WHY it's wrong + what the fix does
  - \`inlineHighlights\`: color the buggy concept \`rose\` and the fix \`emerald\` (use \`phrase\`/\`color\`)
- The IDE plays these as a walkthrough — emit ALL in this single response. The user advances locally; no extra API calls.`;
  } else {
    prompt = `DEBUG-WALKTHROUGH request via Cmd+Shift+D.

I have no code selected, but recent terminal output shows errors. Walk me through identifying and fixing them.

Recent terminal output:
\`\`\`
${(errors || []).slice(-25).join("\n")}
\`\`\`

If you can identify a specific file + line from the stack traces, return one \`buildex-step\` per issue (\`actionType: "modify_code"\` with \`targetFile\`, \`lineRanges\`, \`replacementCode\`, \`explanation\`, \`inlineHighlights\`). Otherwise, return diagnostic \`buildex-step\` blocks with \`actionType: "highlight"\` and helpful explanations. Walkthrough format — single response, all blocks emitted at once.
Do not add unrelated "also open and verify" steps for files not implicated by the error output.`;
  }
  const visibleText =
    sel && !sel.empty && sel.code
      ? `Debug selection in ${sel.fileName} (lines ${sel.startLine}–${sel.endLine})`
      : `Debug terminal errors`;
  await AIChat.send(prompt, {
    mode: "debug",
    includeStructure: false,
    visibleText,
  });
}

function setupGlobalSearchShortcuts() {
  document.addEventListener("keydown", (e) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) return;
    const key = e.key.toLowerCase();
    if (key === "f" && e.shiftKey) {
      e.preventDefault();
      const sidebar = $("sidebar");
      sidebar.classList.remove("hidden");
      setActiveView("search");
      // Pre-fill from selection or current word
      const q = $("search-query");
      if (editor && q) {
        const sel = editor.getModel()?.getValueInRange(editor.getSelection());
        if (sel && sel.length > 0 && sel.length < 200 && !sel.includes("\n")) {
          q.value = sel;
        }
      }
      Search.focusInput();
      // Trigger search if there's a value
      if (q && q.value) q.dispatchEvent(new Event("input"));
    } else if (key === "f" && !e.shiftKey) {
      // Cmd/Ctrl+F: in-file find via Monaco
      if (editor) {
        const target = e.target;
        const isInputLike =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        // Don't hijack Cmd+F when user is typing in an input/textarea
        if (isInputLike) return;
        e.preventDefault();
        editor.focus();
        editor.trigger("keyboard", "actions.find");
      }
    }
  });
}

boot();
