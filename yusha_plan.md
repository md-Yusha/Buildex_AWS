# 🚀 BuildeX AWS — Backend, Cloud Architecture & AI Implementation Plan
**Owner:** Yusha (`yusha_plan.md`)  
**Track:** WeMakeDevs Bharat Builds Tour — **SHIP IT Track (1st Prize ₹2,00,000 + $3,000 AWS Credits)**  
**Target:** Production Serverless Cloud Backend on AWS + Bedrock AI Core + S3/DynamoDB/Cognito + Deployed API  

---

## 📌 1. Executive Summary & Objective

BuildeX is an AI-powered IDE and intelligent learning environment designed to transform passive code generation into active, Socratic learning and debugging. Instead of simply generating code for users, BuildeX uses Amazon Bedrock foundation models to teach programming concepts, diagnose errors interactively, and guide builders through structured development milestones.

As the **Backend & Cloud Lead (Yusha)**, your primary mission is to:
1. Replace legacy third-party AI APIs (Pollinations/OpenAI) with native **Amazon Bedrock (Claude 3.5 Sonnet & Claude 3 Haiku / Amazon Titan)**.
2. Build and deploy a serverless backend using **AWS SAM / CloudFormation**, **AWS Lambda**, and **Amazon API Gateway** with streaming response support.
3. Implement **Amazon Cognito** user pool & identity management for authentication and protected routes.
4. Architect **Amazon DynamoDB** tables for user profiles, project metadata, chat history, learning progress, and code analytics.
5. Setup **Amazon S3** buckets for cloud workspace storage, project archives, code snapshots, and asset uploads.
6. Build multi-step agentic workflows using **Amazon Bedrock Agents** / **AWS Step Functions** and **EventBridge**.
7. Co-write the **AWS Builder Center Blog Post** showcasing the architecture, cost optimization, and serverless design decisions.

---

## 🏗️ 2. Cloud Architecture & Tech Stack

```
                              ┌───────────────────────────────────┐
                              │      BuildeX Client Layer         │
                              │  • Web App (Amplify Hosted)       │
                              │  • Desktop App (.exe / Electron)  │
                              └─────────────────┬─────────────────┘
                                                │
                          ┌─────────────────────┴─────────────────────┐
                          ▼                                           ▼
               ┌──────────────────────┐                    ┌──────────────────────┐
               │   Amazon Cognito     │                    │  Amazon API Gateway  │
               │  • User Pool (Auth)  │                    │  • REST & Stream API │
               │  • JWT Verification  │                    │  • Rate Limiting     │
               └──────────┬───────────┘                    └──────────┬───────────┘
                          │                                           │
                          └─────────────────────┬─────────────────────┘
                                                │
                                                ▼
                               ┌─────────────────────────────────┐
                               │       AWS Lambda Handlers       │
                               │  • /api/chat/stream             │
                               │  • /api/learn /api/debug        │
                               │  • /api/explain /api/agent      │
                               │  • /api/projects /api/progress  │
                               └────────┬───────────────┬────────┘
                                        │               │
                 ┌──────────────────────┼───────────────┼──────────────────────┐
                 ▼                      ▼               ▼                      ▼
        ┌─────────────────┐    ┌─────────────────┐ ┌─────────┐      ┌────────────────────┐
        │ Amazon Bedrock  │    │ Amazon DynamoDB │ │Amazon S3│      │  Step Functions &  │
        │ • Claude 3.5    │    │ • Users         │ │• Files  │      │    EventBridge     │
        │ • Claude Haiku  │    │ • Chat History  │ │• Zips   │      │ • Multi-step Agent │
        │ • Prompt Engine │    │ • Progress/XP   │ │• Assets │      │ • Daily Reminders  │
        └─────────────────┘    └─────────────────┘ └─────────┘      └────────────────────┘
```

---

## 📋 3. Step-by-Step Task Breakdown

### Phase 1: Local Serverless Setup & AWS Infrastructure (Day 1)
- [ ] **Task 1.1: Initialize AWS SAM Project (`backend/`)**
  - Create `template.yaml` defining:
    - API Gateway HTTP/REST API with CORS enabled for `http://localhost:*` and Amplify domain.
    - Cognito User Pool & User Pool Client.
    - DynamoDB tables (`BuildexUsers`, `BuildexProjects`, `BuildexSessions`, `BuildexProgress`).
    - S3 Bucket (`buildex-project-storage-{stage}`).
    - Lambda Functions with Node.js 20.x runtime and appropriate IAM roles.
- [ ] **Task 1.2: Setup LocalStack / SAM Local for Rapid Iteration**
  - Configure `sam local start-api` for local testing without incurring cloud costs during rapid iteration.
- [ ] **Task 1.3: AWS IAM Permissions & Environment Config**
  - Ensure AWS credentials with Bedrock (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`), DynamoDB, S3, Cognito permissions are verified.

---

### Phase 2: Bedrock AI Engine & Socratic Prompt Pipeline (Day 1 - Day 2)
- [ ] **Task 2.1: Implement AWS Bedrock Runtime Client (`backend/src/services/bedrock.js`)**
  - Use `@aws-sdk/client-bedrock-runtime` (`InvokeModelCommand`, `InvokeModelWithResponseStreamCommand`).
  - Support models:
    - Primary: `anthropic.claude-3-5-sonnet-20240620-v1:0` (or `anthropic.claude-3-haiku-20240307-v1:0` for low-latency fast hints).
    - Fallback: `amazon.titan-text-premier-v1:0` / `meta.llama3-70b-instruct-v1:0`.
- [ ] **Task 2.2: Migrate BuildeX AI Modes to Bedrock Prompt Templates**
  - **Learn Mode:** Socratic dialogue, conceptual breakdown, no direct spoon-feeding, guided scaffolding.
  - **Explain Mode:** Line-by-line syntax & algorithmic complexity breakdown, best-practice commentary.
  - **Debug Mode:** Root-cause detection, hint escalation levels (Level 1: conceptual hint -> Level 2: line area hint -> Level 3: pseudo-fix), encouraging user self-correction.
  - **Agent Mode:** Multi-step autonomous task planning, file creation instructions in structured JSON/XML blocks (`<buildex-action type="write_file" path="..." />`).
- [ ] **Task 2.3: Build Lambda Streaming Response Handler (`backend/src/handlers/chatStream.js`)**
  - Implement AWS Lambda Response Streaming (`awslambda.streamifyResponse`) or Server-Sent Events (SSE) format to stream tokens directly from Bedrock to client.
  - Output standard SSE events: `data: {"type": "token", "content": "..."}\n\n` and `data: {"type": "done"}\n\n`.

---

### Phase 3: Authentication, DynamoDB & S3 Data Layer (Day 2)
- [ ] **Task 3.1: Amazon Cognito Auth Integration**
  - Create Cognito User Pool with email sign-up and verification.
  - Add API Gateway Cognito JWT Authorizer to protect `/api/projects`, `/api/progress`, `/api/history`.
- [ ] **Task 3.2: DynamoDB Data Access Layer (`backend/src/services/dynamo.js`)**
  - **Users Table:** `userId` (PK), `email`, `name`, `xp`, `streak`, `badges`, `createdAt`.
  - **Projects Table:** `userId` (PK), `projectId` (SK), `name`, `description`, `s3Key`, `updatedAt`.
  - **Sessions Table:** `sessionId` (PK), `userId`, `mode`, `messages` (JSON), `updatedAt`.
  - **Progress Table:** `userId` (PK), `conceptId` (SK), `masteryLevel`, `attemptsCount`, `solved`.
- [ ] **Task 3.3: S3 Project Management API (`backend/src/handlers/projects.js`)**
  - Implement Pre-Signed URL generation for direct secure S3 upload/download of project zip files and workspace files.
  - S3 Event triggers (optional): Trigger code linting / structure analysis on zip upload.

---

### Phase 4: Advanced Workflows & Agentic Engine (Day 3)
- [ ] **Task 4.1: Strands Agents SDK / Step Functions Workflow**
  - Multi-step Project Scaffolding & Code Review workflow:
    - Step 1: Ingest project structure.
    - Step 2: Bedrock code analysis against security & clean-code rules.
    - Step 3: Generate learning curriculum / debugging roadmap.
    - Step 4: Persist to DynamoDB & notify client.
- [ ] **Task 4.2: EventBridge Scheduled Reminders & Adaptive Learning**
  - Trigger daily challenge generator Lambda for active users based on their weakest topics stored in DynamoDB.

---

### Phase 5: Deployment, API Polish & Hackathon Deliverables (Day 4)
- [ ] **Task 5.1: Deploy Backend to AWS**
  - Run `sam build && sam deploy --guided --stack-name buildex-backend-prod` to deploy live API Gateway & Lambdas.
  - Note down the deployed API Gateway endpoint URL (e.g., `https://xyz.execute-api.ap-south-1.amazonaws.com/prod`).
- [ ] **Task 5.2: Provide Config & Environment variables to Likith**
  - Hand off:
    - `API_BASE_URL`
    - `COGNITO_USER_POOL_ID`
    - `COGNITO_CLIENT_ID`
    - `AWS_REGION`
- [ ] **Task 5.3: Co-author AWS Builder Center Blog Post & Architecture Specs**
  - Document the AWS architecture diagram, Cost & Scale justification (scales to zero with free tier credits), Bedrock prompt engineering, and security model with Cognito.

---

## 🔗 4. API Contract & Interface Specification (Shared with Likith)

### 1. `POST /api/chat/stream`
- **Headers:** `Authorization: Bearer <Cognito_JWT>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "mode": "learn" | "explain" | "debug" | "agent",
    "prompt": "Why is my binary search returning -1 on odd arrays?",
    "codeContext": "function binarySearch(arr, target) { ... }",
    "activeFile": "search.js",
    "sessionId": "sess_123"
  }
  ```
- **Response:** `Transfer-Encoding: chunked` / SSE Stream
  ```
  data: {"type": "token", "content": "Let's"}
  data: {"type": "token", "content": " look at line 4..."}
  data: {"type": "done", "sessionId": "sess_123", "tokensUsed": 142}
  ```

### 2. `GET /api/user/progress` & `POST /api/user/progress`
- Fetch and update user XP, learning streaks, unlocked achievements, and quiz attempts.

### 3. `POST /api/projects/presigned-url`
- Returns `{ "uploadUrl": "https://buildex-project-storage.s3...", "s3Key": "..." }`.

---

## 🧪 5. Verification & Testing Checklist
- [ ] Bedrock invocation returns streaming responses in under 800ms Time-To-First-Token.
- [ ] Cognito sign-up, verification code confirmation, and login return valid JWTs.
- [ ] API Gateway blocks unauthorized requests with 401 Unauthorized.
- [ ] DynamoDB CRUD operations correctly update streak and project metadata.
- [ ] S3 pre-signed upload securely accepts and saves project files.
- [ ] Production deployment is 100% operational on live AWS cloud endpoints.
