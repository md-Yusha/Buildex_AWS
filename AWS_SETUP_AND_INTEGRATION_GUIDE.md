# 🛠️ BuildeX AWS — Complete Setup & Service Integration Guide

This guide walks you step-by-step through setting up, configuring, and integrating all required AWS services into **BuildeX Coder IDE**.

---

## 📌 Table of Contents
1. [Prerequisites & AWS IAM Setup (Access Keys & Permissions)](#1-prerequisites--iam-setup)
2. [Amazon Bedrock Setup (Unlocking Model Access)](#2-amazon-bedrock-setup)
3. [Amazon Cognito Setup (Authentication & User Pools)](#3-amazon-cognito-setup)
4. [Amazon DynamoDB Setup (Database Tables)](#4-amazon-dynamodb-setup)
5. [Amazon S3 Setup (Cloud Workspaces & Storage)](#5-amazon-s3-setup)
6. [Automated 1-Click Deployment with AWS SAM](#6-automated-deployment-with-aws-sam)
7. [Integrating AWS into the BuildeX IDE Codebase](#7-integrating-aws-into-the-ide)
8. [Service Health-Check & Verification Scripts](#8-health-check--testing)

---

## 1. Prerequisites & IAM Setup

To allow your scripts and backend to talk to AWS, you need an **IAM User** with programmatic access keys.

### Step 1.1: Create an IAM User
1. Log into the **[AWS Management Console](https://console.aws.amazon.com/)**.
2. Select your desired region in the top-right header (e.g. `us-east-1` for US East N. Virginia or `ap-south-1` for Mumbai).
3. Search for **IAM** in the search bar and click on it.
4. On the left menu, click **Users** → click **Create user**.
5. Name the user: `buildex-admin` (or your preferred name).
6. Under **Permissions options**, choose **Attach policies directly**.
7. Search and select the following AWS managed policies:
   - `AmazonBedrockFullAccess`
   - `AmazonDynamoDBFullAccess`
   - `AmazonS3FullAccess`
   - `AmazonCognitoPowerUser`
   - `AWSLambda_FullAccess`
8. Click **Next** → click **Create user**.

### Step 1.2: Generate Access Keys
1. Click on the newly created user (`buildex-admin`).
2. Go to the **Security credentials** tab.
3. Scroll down to **Access keys** and click **Create access key**.
4. Choose **Application running outside AWS** (or Command Line Interface).
5. Click **Next** → click **Create access key**.
6. **Copy and save** both:
   - `Access key ID` (e.g. `AKIA...`)
   - `Secret access key` (e.g. `wJalrXUtnFEMI...`)

---

## 2. Amazon Bedrock Setup

> [!IMPORTANT]
> By default, AWS Bedrock models are locked until you explicitly enable **Model Access** in your AWS account console. This is why you get `400: Operation not allowed` until this step is completed.

### Step 2.1: Enable Model Access in Bedrock Console
1. Open the **[Amazon Bedrock Console](https://console.aws.amazon.com/bedrock/)**.
2. Make sure your region is set to **`us-east-1` (US East N. Virginia)** or **`ap-south-1` (Mumbai)**.
   *(Note: `us-east-1` has access to all latest models including Claude 3.5 Sonnet, Claude 3 Haiku, Amazon Nova, and Llama 3).*
3. On the left sidebar menu, scroll to the bottom and click **Model access** (or [open direct link](https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess)).
4. Click the orange **Enable specific models** / **Modify model access** button.
5. Check the checkboxes for:
   - **Anthropic**: *Claude 3.5 Sonnet*, *Claude 3 Haiku*
   - **Amazon**: *Nova Micro*, *Nova Lite*, *Titan Text*
   - **Meta**: *Llama 3 8B / 70B*
6. If prompted with a short use-case form for Anthropic models, enter basic details (e.g., *Educational code-learning platform*) and submit.
7. Click **Next** and click **Submit**.
8. The status will change to **Access granted** (instant for Nova, Titan, and Claude Haiku).

---

## 3. Amazon Cognito Setup

Cognito handles user registration, email verification codes, password resets, and JWT authentication.

### Step 3.1: Create a Cognito User Pool
1. Go to **[Amazon Cognito Console](https://console.aws.amazon.com/cognito/)**.
2. Click **Create user pool**.
3. **Step 1 (Authentication provider):**
   - Select **Cognito user pool**.
   - Check **Email**.
4. **Step 2 (Security requirements):**
   - Keep default password policy or set *No MFA* (for easy hackathon onboarding/testing).
5. **Step 3 (Sign-up experience):**
   - Select **Send email message, verify email address**.
   - Under standard attributes, ensure `email` is required.
6. **Step 4 (Configure message delivery):**
   - Select **Send email with Cognito** (50 emails/day free tier for development).
7. **Step 5 (Integrate your app):**
   - User pool name: `buildex-user-pool`.
   - App client name: `buildex-client`.
   - Client secret: Select **Don't generate a client secret** (required for client-side/Electron apps).
8. Click **Next** → click **Create user pool**.
9. Note down:
   - **User Pool ID** (e.g. `us-east-1_AbCdEf123`)
   - **App Client ID** (e.g. `3a4b5c6d7e8f9g0h1i2j3k4l5m`)

---

## 4. Amazon DynamoDB Setup

DynamoDB stores user XP/streaks, chat histories, active sessions, and project metadata with single-digit millisecond latency.

### Step 4.1: Create Tables in DynamoDB Console
Go to **[Amazon DynamoDB Console](https://console.aws.amazon.com/dynamodb/)** → click **Create table** for each of the following:

| Table Name | Partition Key (PK) | Sort Key (SK) | Capacity Mode |
|---|---|---|---|
| `BuildexUsers` | `userId` (String) | *None* | On-Demand (Pay per request) |
| `BuildexProjects` | `userId` (String) | `projectId` (String) | On-Demand |
| `BuildexSessions` | `sessionId` (String) | *None* | On-Demand |
| `BuildexProgress` | `userId` (String) | `conceptId` (String) | On-Demand |

> [!TIP]
> Selecting **On-Demand (Pay-per-request)** capacity mode ensures $0 idle cost and automatic scaling.

---

## 5. Amazon S3 Setup

S3 stores user workspace archives, project zip files, code snapshots, and shared starter templates.

### Step 5.1: Create the S3 Bucket
1. Go to **[Amazon S3 Console](https://console.aws.amazon.com/s3/)**.
2. Click **Create bucket**.
3. Bucket name: `buildex-projects-storage-` + *your-account-id* (e.g., `buildex-projects-storage-052477895001`).
4. AWS Region: Same as your other services (e.g. `us-east-1` or `ap-south-1`).
5. **Block Public Access**: Keep all enabled (access will be securely signed via Pre-Signed URLs).
6. Click **Create bucket**.

### Step 5.2: Configure Bucket CORS
1. Click on your created bucket → Go to the **Permissions** tab.
2. Scroll to the bottom to **Cross-origin resource sharing (CORS)** → click **Edit**.
3. Paste the following JSON:
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
       "AllowedOrigins": ["*"],
       "ExposeHeaders": ["ETag"]
     }
   ]
   ```
4. Click **Save changes**.

---

## 6. Automated Deployment with AWS SAM

Instead of manually configuring each Lambda and API Gateway route, you can deploy the complete serverless architecture using **AWS SAM (Serverless Application Model)**.

### Step 6.1: Install AWS SAM CLI
```bash
# On macOS:
brew install aws-sam-cli

# Verify installation:
sam --version
```

### Step 6.2: Configure AWS CLI Credentials locally
Run:
```bash
aws configure
```
Enter:
- **AWS Access Key ID**: *(From Step 1.2)*
- **AWS Secret Access Key**: *(From Step 1.2)*
- **Default region name**: `us-east-1`
- **Default output format**: `json`

### Step 6.3: Deploy the Backend
Inside your project's `backend/` directory:
```bash
sam build
sam deploy --guided
```
SAM will ask for stack name (e.g., `buildex-backend-prod`) and automatically create:
- API Gateway with SSE Streaming & CORS.
- Lambda functions for Chat, Learn, Debug, and Project Sync.
- All DynamoDB tables and S3 buckets with IAM roles automatically wired together.

---

## 7. Integrating AWS into the IDE

### Step 7.1: Configure `.env` in `Buildex_AWS/`
Create or update `.env` in the root of your project:

```env
# ==========================================
# AWS Core Credentials
# ==========================================
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_access_key_here

# ==========================================
# Amazon Bedrock Models
# ==========================================
BEDROCK_DEFAULT_MODEL=anthropic.claude-3-5-sonnet-20240620-v1:0
BEDROCK_FAST_MODEL=anthropic.claude-3-haiku-20240307-v1:0
BEDROCK_CHEAP_MODEL=amazon.nova-micro-v1:0

# ==========================================
# Amazon Cognito
# ==========================================
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx

# ==========================================
# Amazon DynamoDB & S3
# ==========================================
DYNAMODB_USERS_TABLE=BuildexUsers
DYNAMODB_PROJECTS_TABLE=BuildexProjects
DYNAMODB_SESSIONS_TABLE=BuildexSessions
S3_PROJECTS_BUCKET=buildex-projects-storage-xxxxxx
```

### Step 7.2: Bedrock AI Client in Node.js / Electron
Here is the production wrapper ready to integrate into `main.js` / `renderer.js`:

```javascript
import { 
  BedrockRuntimeClient, 
  ConverseStreamCommand,
  ConverseCommand 
} from "@aws-sdk/client-bedrock-runtime";

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Stream responses directly from Amazon Bedrock (Claude / Nova)
 */
export async function streamBedrockChat(messages, systemPrompt, onToken, onDone, onError) {
  try {
    const command = new ConverseStreamCommand({
      modelId: process.env.BEDROCK_FAST_MODEL || "anthropic.claude-3-haiku-20240307-v1:0",
      system: [{ text: systemPrompt }],
      messages: messages,
      inferenceConfig: {
        maxTokens: 2048,
        temperature: 0.7,
      },
    });

    const response = await bedrockClient.send(command);
    
    for await (const chunk of response.stream) {
      if (chunk.contentBlockDelta?.delta?.text) {
        onToken(chunk.contentBlockDelta.delta.text);
      }
    }
    if (onDone) onDone();
  } catch (err) {
    if (onError) onError(err);
  }
}
```

---

## 8. Health-Check & Testing

Run these one-command checks to verify each service connection:

### 1. Test Bedrock
```bash
node test_bedrock.js
```
*(Tests connection and prints response tokens).*

### 2. Test S3 and DynamoDB
```bash
node -e '
const { S3Client, ListBucketsCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient, ListTablesCommand } = require("@aws-sdk/client-dynamodb");
require("dotenv").config();

async function check() {
  const cfg = { region: process.env.AWS_REGION, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } };
  const s3 = new S3Client(cfg);
  const dynamo = new DynamoDBClient(cfg);
  console.log("Checking S3...", await s3.send(new ListBucketsCommand({})));
  console.log("Checking DynamoDB...", await dynamo.send(new ListTablesCommand({})));
}
check().catch(console.error);
'
```
