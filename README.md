# BuildeX Coder IDE

BuildeX Coder IDE is a modern, lightweight, and incredibly fast code editor built with web technologies. Designed for performance and productivity, it combines the power of the Monaco Editor, an integrated multi-session terminal, an AI coding assistant, and advanced source control management into a single, cohesive desktop application.

## Features

### 📝 Advanced Code Editing
- **Powered by Monaco Editor:** The same core editor that powers VS Code.
- **Syntax Highlighting & IntelliSense:** Built-in support for dozens of languages including JavaScript, TypeScript, HTML, CSS, Python, Rust, Go, C++, and more.
- **Multi-Tab Support:** Open, manage, and edit multiple files simultaneously.
- **Custom Themes:** Professionally tuned Light and Dark themes for optimal code legibility.

### 💻 Integrated Terminal
- **xterm.js Integration:** A fully featured, fast terminal emulator built right into the editor.
- **Multi-Session Management:** Run multiple terminal instances side-by-side with an intuitive session manager.
- **Color & Styling:** Full ANSI color support for your builds and scripts.

### 🤖 AI Coding Assistant
- **Pollinations AI Integration:** Chat with advanced AI models directly in your IDE (Claude 3 Opus/Sonnet/Haiku, GPT-4o, Gemini 2, and local Ollama models).
- **Multiple Modes:**
  - **Agent:** Autonomous edits across files.
  - **Learn:** Step-by-step guidance and hints.
  - **Explain:** Understand complex code blocks.
  - **Debug:** Track down bugs and errors.

### 🌳 Workspace Management
- **File Explorer:** A recursive, expandable file tree to navigate your projects.
- **File Operations:** Create, rename, delete, and move files/folders seamlessly.
- **Fast Search:** Lightning-fast, regex-capable folder-wide search with path filtering.

### 🌿 Source Control (Git)
- **Visual Git Management:** Track changes with a dedicated Source Control view.
- **Diff & History:** View staged/unstaged changes, untracked files, and repository commit history.
- **Branching & Syncing:** Create branches, stash changes, and push/pull/fetch directly from the UI.
- **Commit Management:** Stage files, write commit messages, and even amend or sign off commits.

### 🌐 Ports Management
- **Local Port Discovery:** View locally running services and their associated ports.
- **Port Forwarding:** Instantly expose your local environment to the internet using integrated `localtunnel` support.

## Architecture & Working

BuildeX Coder IDE is built on top of **Electron**, splitting responsibilities between the Main Process and Renderer Process for maximum performance and security:

1. **Main Process (`main.js`):**
   - Handles OS-level file system operations (`fs`).
   - Manages terminal sessions by spawning child processes (`child_process.spawn`).
   - Executes Git CLI commands directly for the Source Control UI.
   - Manages AI API requests and streams the responses.
   - Handles native OS dialogs for opening files and folders.

2. **Renderer Process (`renderer.js`, `index.html`, `styles.css`):**
   - Built with high-performance Vanilla JavaScript and DOM manipulation—no heavy frontend frameworks.
   - Embeds the Monaco Editor and xterm.js UI.
   - Communicates securely with the Main Process via standard IPC patterns exposed through `preload.js`.

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- Git (for Source Control features)

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd Budilex
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the application:
   ```bash
   npm start
   ```

### Configuration
To configure the AI assistant, you can create a `.env` file in the root directory:
```env
POLLINATIONS_API_KEY=your_api_key_here
POLLINATIONS_BASE_URL=https://gen.pollinations.ai
POLLINATIONS_DEFAULT_MODEL=openai
```

## Technologies Used
- **Electron** - Cross-platform desktop application framework.
- **Monaco Editor** - Code editor widget.
- **xterm.js** - Terminal emulator component.
- **Pollinations AI** - AI text generation integration.
- **localtunnel** - For exposing local ports.
