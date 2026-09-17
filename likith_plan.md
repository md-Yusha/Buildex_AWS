# 💻 BuildeX AWS — Frontend, Amplify Deployment & Desktop EXE Packaging Plan
**Owner:** Likith (`likith_plan.md`)  
**Track:** WeMakeDevs Bharat Builds Tour — **SHIP IT Track (1st Prize ₹2,00,000) & BEST UI Track (3rd Prize ₹1,00,000)**  
**Target:** Live AWS Amplify Web URL + Packaged Windows `.exe` Desktop Installer + Premium IDE UI/UX  

---

## 📌 1. Executive Summary & Objective

BuildeX is an intelligent AI IDE designed to revolutionize how developers and students learn to code. As the **Frontend & Product Packaging Lead (Likith)**, your mission is twofold:
1. **Ship It Track Deliverable:** Deploy the fully-featured BuildeX Web IDE on **AWS Amplify Hosting** with a live public URL.
2. **Best UI & Desktop Deliverable:** Craft a world-class, fluid IDE interface (Monaco Editor, multi-mode Socratic AI chat, code diff preview, learning analytics) and package the standalone desktop app into a Windows executable (`.exe`) via `electron-builder`.

You will interface seamlessly with Yusha's AWS serverless backend (Amazon Bedrock, Cognito, DynamoDB, S3) using clear API contracts.

---

## 🎨 2. Design System & UI/UX Vision (Targeting "Best UI" Prize)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [BuildeX Coder IDE] 🔍 Search Files   ● Learn  ● Debug  ● Explain  ● Agent   [👤 Yusha | 450 XP] │
├──────────┬────────────────────────────────────────────────┬────────────────────────────────┤
│ EXPLORER │ 📄 index.js  |  📄 bedrock.js                  │ 🧠 SOCRATIC AI ASSISTANT (Bedrock)│
│          ├────────────────────────────────────────────────┤                                │
│ 📁 src   │ 1  import { BedrockRuntimeClient } from '...'; │ [Debug Mode: Active]           │
│   📄 main│ 2                                              │                                │
│   📄 auth│ 3  async function handleStream() {            │ 💡 Hint Level 1:               │
│ 📁 test  │ 4    // Line highlighted by AI debugger        │ Notice what happens on line 4  │
│ 📁 aws   │ 5    const result = await client.send(...);    │ when result is null.           │
│          │ 6  }                                           │                                │
│          │                                                │ [🔘 Apply Suggestion] [❓ Why?] │
├──────────┴────────────────────────────────────────────────┼────────────────────────────────┤
│ 🖥️ TERMINAL (xterm.js)                                     │ 🏆 LEARNING PROGRESS           │
│ $ sam local start-api --port 3000                         │ 🔥 5-Day Streak  ⭐ 85% Mastery │
└───────────────────────────────────────────────────────────┴────────────────────────────────┘
```

- **Aesthetics:** Deep slate/zinc dark theme (`#090d16`), luminous purple/indigo accents (`#9b8fe8`), glassmorphic panels, glowing status badges.
- **Typography:** JetBrains Mono for code editor and terminal, Outfit / Inter for UI typography.
- **Interactions:** Streaming token animations, smooth collapsible split panes, interactive diff acceptance buttons, confetti on quiz completion.

---

## 📋 3. Step-by-Step Task Breakdown

### Phase 1: Dual-Target Architecture & Amplify Setup (Day 1)
- [ ] **Task 1.1: Refactor Codebase for Dual-Target (Web + Electron)**
  - Ensure the core IDE logic can run both in standard browser environments (Amplify) and in desktop Electron.
  - Abstract filesystem and terminal APIs:
    - In Electron: uses native Node.js / `node-pty` / child process.
    - In Web (Amplify): uses In-Memory / IndexedDB virtual filesystem + WebAssembly / Cloud Runner terminal.
- [ ] **Task 1.2: Connect & Deploy on AWS Amplify Hosting**
  - Create `amplify.yml` build configuration for the frontend:
    ```yaml
    version: 1
    frontend:
      phases:
        preBuild:
          run: npm install
        build:
          run: npm run build:web # or static export
      artifacts:
        baseDirectory: dist # or public/
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
    ```
  - Connect the GitHub repository `Buildex_AWS` to AWS Amplify Console to enable automated CI/CD deployments on `git push`.
  - Verify live SSL URL (e.g., `https://main.d1234abcd.amplifyapp.com`).

---

### Phase 2: Amazon Cognito Auth UI & Socratic AI Chat (Day 2)
- [ ] **Task 2.1: Implement Cognito Auth Modal & State Management**
  - Build sleek Sign In / Sign Up modal with email verification code input.
  - Integrate with AWS Cognito via `@aws-sdk/client-cognito-identity-provider` or Amazon Cognito REST API.
  - Store JWT tokens (`idToken`, `accessToken`) securely in `localStorage` (Web) or `electron-store` (Desktop).
  - Add auth state pill to the top navigation bar (User avatar, display name, XP indicator, sign out button).
- [ ] **Task 2.2: Migrate AI Chat Client to Bedrock API Gateway Stream**
  - Replace legacy Pollinations client (`src/ai/pollinations.js`) with new streaming fetch client (`src/ai/bedrockClient.js`).
  - Implement Fetch Stream Reader for Server-Sent Events from `POST /api/chat/stream`.
  - Handle stream chunks, formatting code blocks, rendering diffs, and parsing `<buildex-step>` or `<buildex-action>` triggers.
- [ ] **Task 2.3: Build Socratic Learning Mode Selectors**
  - Mode toggle tabs: **Learn** (Socratic Tutor), **Explain** (Complexity & Walkthrough), **Debug** (Guided Bug Hunter), **Agent** (Autonomous Project Builder).
  - Mode-specific quick action prompts (e.g., "Explain time complexity", "Give me a hint without spoiling the answer", "Find memory leaks").

---

### Phase 3: IDE Feature Polish & Cloud S3 Sync (Day 3)
- [ ] **Task 3.1: Monaco Editor Enhancements**
  - AI Code Lens: Inline "💡 Ask BuildeX" action above functions and errors.
  - Inline Diff View: When Bedrock proposes a fix, display side-by-side or inline Monaco diff with `[Accept]` and `[Reject]` buttons.
- [ ] **Task 3.2: S3 Project Cloud Backup & Sync**
  - Add "☁️ Save to AWS S3" button in the header.
  - Use Yusha's S3 Pre-Signed URL API to upload project bundles directly to AWS S3.
  - Add "Recent Projects" modal populated from DynamoDB API.
- [ ] **Task 3.3: Gamification & Progress Dashboard (Best UI Booster)**
  - Floating or sidebar panel showing:
    - Current Learning Streak (🔥 flame icon with counter).
    - Skill Mastery Radar chart (Algorithms, Debugging, Cloud Architecture).
    - Badges Unlocked ("First Commit", "Bug Hunter", "Bedrock Pioneer").

---

### Phase 4: Desktop Executable (`.exe`) Packaging (Day 3 - Day 4)
- [ ] **Task 4.1: Configure `electron-builder`**
  - Update `package.json` with build configuration:
    ```json
    "build": {
      "appId": "com.buildex.ide",
      "productName": "BuildeX IDE",
      "directories": {
        "output": "dist-electron"
      },
      "win": {
        "target": ["nsis", "portable"],
        "icon": "assets/icon.ico"
      },
      "mac": {
        "target": ["dmg", "zip"],
        "icon": "assets/icon.icns"
      },
      "nsis": {
        "oneClick": false,
        "allowToChangeInstallationDirectory": true,
        "createDesktopShortcut": true
      }
    }
    ```
- [ ] **Task 4.2: Build and Test Windows `.exe` Installer**
  - Run `npm run build:exe` / `npx electron-builder --win` to generate:
    - `BuildeX-Setup-1.0.0.exe` (Installer)
    - `BuildeX-1.0.0-portable.exe` (Standalone Portable)
  - Verify that the `.exe` launches smoothly, connects to the deployed AWS backend, and executes code locally.
- [ ] **Task 4.3: Host EXE on GitHub Releases & S3 Download Link**
  - Upload the final `.exe` to GitHub Releases and S3 bucket to provide a direct download link in the project README and live Amplify website.

---

### Phase 5: Testing, Demo Video & Submission (Day 4)
- [ ] **Task 5.1: End-to-End User Flow Verification**
  - Verify complete flow: Register -> Login via Cognito -> Open Project -> Run Code -> Ask Bedrock for Socratic Debugging -> Save snapshot to S3 -> Gain XP in DynamoDB.
- [ ] **Task 5.2: Record 2-3 Minute Product Demo Video**
  - Showcase:
    1. The live deployed URL on AWS Amplify.
    2. Real-time Socratic debugging with Amazon Bedrock.
    3. Seamless Cognito auth & cloud project saving to S3.
    4. Downloading and launching the standalone Windows `.exe`.
- [ ] **Task 5.3: Co-publish AWS Builder Center Article & Final Submission**
  - Ensure the deployed URL, GitHub repository link, demo video, architecture diagram, and AWS Builder Center blog post link are submitted before the deadline.

---

## 🔗 4. Shared API Configurations (Provided by Yusha)

```javascript
// src/config/awsConfig.js
export const AWS_CONFIG = {
  region: process.env.VITE_AWS_REGION || 'ap-south-1',
  apiGatewayUrl: process.env.VITE_API_BASE_URL || 'https://xyz.execute-api.ap-south-1.amazonaws.com/prod',
  cognitoUserPoolId: process.env.VITE_COGNITO_USER_POOL_ID || 'ap-south-1_xxxxxxxxx',
  cognitoClientId: process.env.VITE_COGNITO_CLIENT_ID || 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
  s3BucketName: 'buildex-project-storage-prod',
};
```

---

## 🧪 5. Verification & Quality Checklist
- [ ] Live URL on AWS Amplify opens without errors and supports all modern browsers.
- [ ] Windows `.exe` installer builds cleanly and runs as a standalone desktop app.
- [ ] Bedrock streaming tokens render smoothly without freezing the Monaco Editor.
- [ ] Cognito authentication state persists across refreshes and app restarts.
- [ ] UI achieves 60fps animations with responsive dark theme styling.
- [ ] Demo video & AWS Builder Center blog links are validated and published.
