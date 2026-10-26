# 🌐 BuildeX API Reference

**Base URL:** `https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com`  
**API Version:** v1  
**Region:** ap-south-1 (Mumbai)

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Chat & AI](#chat--ai)
3. [User Management](#user-management)
4. [Projects](#projects)
5. [Payments](#payments)
6. [Error Codes](#error-codes)

---

## 🔐 Authentication

### **Initiate Auth Session**

Creates a new authentication session and returns Cognito Hosted UI URL.

**Endpoint:** `POST /api/auth/session`

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "authSessionId": "sess_1640995200000_abc123",
  "authUrl": "https://buildex-ide.auth.ap-south-1.amazoncognito.com/login?client_id=1t0auvpbcr0lb9eb5c3tdunog5&response_type=code&scope=email+openid+profile&redirect_uri=https%3A%2F%2Fvrgr3ltxr2.execute-api.ap-south-1.amazonaws.com%2Fapi%2Fauth%2Fcallback&state=sess_1640995200000_abc123"
}
```

**Usage Example:**
```javascript
const response = await fetch('https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
const { authSessionId, authUrl } = await response.json();

// Open authUrl in browser
window.open(authUrl);

// Poll session status
const pollInterval = setInterval(async () => {
  const status = await fetch(`https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/session?id=${authSessionId}`);
  const data = await status.json();
  if (data.status === 'authenticated') {
    clearInterval(pollInterval);
    console.log('User authenticated:', data.user);
  }
}, 1500);
```

---

### **Poll Auth Session Status**

Check if user has completed authentication.

**Endpoint:** `GET /api/auth/session?id={sessionId}`

**Query Parameters:**
- `id` (string, required) - Session ID from initiate auth

**Response (Pending):**
```json
{
  "status": "pending",
  "sessionId": "sess_1640995200000_abc123"
}
```

**Response (Authenticated):**
```json
{
  "status": "authenticated",
  "user": {
    "userId": "cognito_sub_abc123",
    "email": "developer@example.com",
    "name": "Jane Developer",
    "avatar": "https://api.dicebear.com/7.x/bottts-neutral/svg?seed=...",
    "tier": "free",
    "creditsTotal": 500,
    "creditsRemaining": 500,
    "creditsUsed": 0,
    "xp": 0,
    "streak": 1,
    "createdAt": "2026-01-15T10:30:00.000Z"
  },
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### **OAuth Callback** *(Internal - Called by Cognito)*

**Endpoint:** `GET /api/auth/callback?code={code}&state={sessionId}`

This endpoint is called automatically by Amazon Cognito after successful authentication. It:
1. Exchanges authorization code for JWT tokens
2. Creates/updates user in DynamoDB
3. Marks session as authenticated
4. Redirects to website or displays success page

**Not intended for direct API calls.**

---

### **Logout**

**Endpoint:** `GET /api/auth/logout`

Displays logout confirmation page and clears Cognito session.

---

## 🤖 Chat & AI

### **Stream Chat Response**

Send a prompt to Amazon Bedrock and receive streaming AI response.

**Endpoint:** `POST /api/chat/stream`

**Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer {jwt_token}` (optional, recommended)

**Request Body:**
```json
{
  "mode": "learn",
  "prompt": "Why is my binary search returning -1?",
  "codeContext": "function binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length;\n  while (left < right) {\n    let mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid;\n  }\n  return -1;\n}",
  "activeFile": "search.js",
  "sessionId": "sess_chat_123"
}
```

**Parameters:**
- `mode` (string, required) - One of: `learn`, `explain`, `debug`, `agent`
- `prompt` (string, required) - User's question or request
- `codeContext` (string, optional) - Code snippet to analyze
- `activeFile` (string, optional) - Filename for context
- `sessionId` (string, optional) - Chat session ID for history

**Response:**
```json
{
  "sessionId": "sess_chat_123",
  "content": "Let's analyze your binary search implementation...",
  "tokensUsed": 342,
  "modelId": "anthropic.claude-3-haiku-20240307-v1:0"
}
```

**Streaming Response Format (SSE - Not currently implemented in Lambda):**
```
data: {"type": "token", "content": "Let's"}
data: {"type": "token", "content": " analyze"}
data: {"type": "done", "sessionId": "sess_chat_123", "tokensUsed": 342}
```

**Example:**
```javascript
const response = await fetch('https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/chat/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    mode: 'debug',
    prompt: 'Why does this crash?',
    codeContext: myCode,
    activeFile: 'app.js'
  })
});

const data = await response.json();
console.log('AI Response:', data.content);
```

**AI Modes:**

| Mode | Description | Use Case |
|------|-------------|----------|
| `learn` | Socratic questioning, conceptual hints | Teaching programming concepts |
| `explain` | Line-by-line code explanation | Understanding complex code |
| `debug` | 3-tier diagnostic hints | Bug hunting and error resolution |
| `agent` | Multi-step project architect | Building features from scratch |

---

## 👤 User Management

### **Get User Progress**

Fetch user's XP, streak, badges, and learning progress.

**Endpoint:** `GET /api/user/progress?userId={userId}`

**Query Parameters:**
- `userId` (string, required) - User ID

**Response:**
```json
{
  "ok": true,
  "user": {
    "userId": "cognito_sub_abc123",
    "email": "developer@example.com",
    "name": "Jane Developer",
    "tier": "free",
    "xp": 1250,
    "streak": 7,
    "badges": ["first_commit", "bug_hunter", "bedrock_pioneer"],
    "creditsTotal": 500,
    "creditsRemaining": 387,
    "creditsUsed": 113,
    "tokensUsed": 45620,
    "requestsCount": 142,
    "createdAt": "2026-01-15T10:30:00.000Z",
    "lastActiveAt": "2026-01-22T14:22:00.000Z"
  },
  "progress": [
    {
      "userId": "cognito_sub_abc123",
      "conceptId": "binary_search",
      "masteryLevel": 2,
      "attemptsCount": 5,
      "solved": true,
      "lastAttemptAt": "2026-01-20T12:00:00.000Z"
    },
    {
      "userId": "cognito_sub_abc123",
      "conceptId": "recursion",
      "masteryLevel": 1,
      "attemptsCount": 3,
      "solved": false,
      "lastAttemptAt": "2026-01-22T10:15:00.000Z"
    }
  ]
}
```

**Example:**
```javascript
const response = await fetch(`https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/user/progress?userId=test_user`);
const { user, progress } = await response.json();
console.log('User XP:', user.xp);
console.log('Current Streak:', user.streak);
```

---

### **Update User Progress**

Record learning progress, XP gains, streak updates.

**Endpoint:** `POST /api/user/progress`

**Request Body:**
```json
{
  "userId": "cognito_sub_abc123",
  "xpDelta": 50,
  "conceptId": "binary_search",
  "masteryLevel": 2,
  "solved": true
}
```

**Parameters:**
- `userId` (string, required) - User ID
- `xpDelta` (number, optional) - XP to add (can be negative for penalties)
- `conceptId` (string, optional) - Learning concept identifier
- `masteryLevel` (number, optional) - 0-3 scale (0=not started, 1=learning, 2=proficient, 3=mastered)
- `solved` (boolean, optional) - Whether concept is solved/completed

**Response:**
```json
{
  "ok": true,
  "updatedUser": {
    "userId": "cognito_sub_abc123",
    "xp": 1300,
    "streak": 7,
    "creditsRemaining": 387
  }
}
```

**Example:**
```javascript
await fetch('https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/user/progress', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'test_user',
    xpDelta: 100,
    conceptId: 'recursion',
    masteryLevel: 2,
    solved: true
  })
});
```

---

## 📁 Projects

### **List User Projects**

Get all projects for a specific user.

**Endpoint:** `GET /api/projects?userId={userId}`

**Query Parameters:**
- `userId` (string, required) - User ID

**Response:**
```json
{
  "projects": [
    {
      "userId": "cognito_sub_abc123",
      "projectId": "proj_1640995200000",
      "name": "My First Web App",
      "description": "A simple Express REST API",
      "s3Key": "workspaces/cognito_sub_abc123/1640995200000_project.zip",
      "updatedAt": "2026-01-20T15:30:00.000Z"
    },
    {
      "userId": "cognito_sub_abc123",
      "projectId": "proj_1641000000000",
      "name": "React Dashboard",
      "description": "Admin dashboard with charts",
      "s3Key": "workspaces/cognito_sub_abc123/1641000000000_dashboard.zip",
      "updatedAt": "2026-01-22T09:15:00.000Z"
    }
  ]
}
```

---

### **Save Project Metadata**

Create or update project metadata in DynamoDB.

**Endpoint:** `POST /api/projects`

**Request Body:**
```json
{
  "userId": "cognito_sub_abc123",
  "projectId": "proj_1640995200000",
  "name": "My First Web App",
  "description": "A simple Express REST API with MongoDB",
  "s3Key": "workspaces/cognito_sub_abc123/1640995200000_project.zip"
}
```

**Parameters:**
- `userId` (string, required) - User ID
- `projectId` (string, optional) - Project ID (auto-generated if not provided)
- `name` (string, required) - Project name
- `description` (string, optional) - Project description
- `s3Key` (string, optional) - S3 object key for project files

**Response:**
```json
{
  "success": true,
  "project": {
    "userId": "cognito_sub_abc123",
    "projectId": "proj_1640995200000",
    "name": "My First Web App",
    "description": "A simple Express REST API with MongoDB",
    "s3Key": "workspaces/cognito_sub_abc123/1640995200000_project.zip",
    "updatedAt": "2026-01-22T14:30:00.000Z"
  }
}
```

---

### **Get S3 Pre-Signed Upload URL**

Generate a secure pre-signed URL to upload project files directly to S3.

**Endpoint:** `POST /api/projects/presigned-url`

**Request Body:**
```json
{
  "userId": "cognito_sub_abc123",
  "filename": "my-project.zip",
  "contentType": "application/zip"
}
```

**Parameters:**
- `userId` (string, required) - User ID
- `filename` (string, optional) - Desired filename (default: `project_{timestamp}.zip`)
- `contentType` (string, optional) - MIME type (default: `application/zip`)

**Response:**
```json
{
  "uploadUrl": "https://buildex-projects-storage-052477895001.s3.ap-south-1.amazonaws.com/workspaces/cognito_sub_abc123/1640995200000_my-project.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...",
  "s3Key": "workspaces/cognito_sub_abc123/1640995200000_my-project.zip"
}
```

**Usage Example:**
```javascript
// 1. Get pre-signed URL
const response = await fetch('https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/projects/presigned-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'test_user',
    filename: 'my-project.zip'
  })
});
const { uploadUrl, s3Key } = await response.json();

// 2. Upload file directly to S3
const fileBlob = await createProjectZip(); // Your zip creation logic
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/zip' },
  body: fileBlob
});

// 3. Save project metadata
await fetch('https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/projects', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'test_user',
    projectId: 'proj_123',
    name: 'My Project',
    s3Key: s3Key
  })
});
```

---

## 💳 Payments

### **Get Payment Configuration**

Fetch Razorpay public key and available plans.

**Endpoint:** `GET /api/payment/config`

**Response:**
```json
{
  "ok": true,
  "configured": true,
  "keyId": "rzp_test_abc123xyz789",
  "plans": {
    "start": {
      "id": "start",
      "name": "BuildeX Start Plan",
      "amount": 649,
      "amountPaise": 64900,
      "credits": 2000,
      "tier": "pro",
      "cognitoGroup": "ProTier"
    },
    "enterprise": {
      "id": "enterprise",
      "name": "BuildeX Enterprise Plan",
      "amount": 1999,
      "amountPaise": 199900,
      "credits": 10000,
      "tier": "enterprise",
      "cognitoGroup": "EnterpriseTier"
    }
  }
}
```

---

### **Create Payment Order**

Create a Razorpay order for plan purchase.

**Endpoint:** `POST /api/payment/create-order`

**Request Body:**
```json
{
  "planId": "start",
  "userId": "cognito_sub_abc123",
  "userEmail": "developer@example.com"
}
```

**Parameters:**
- `planId` (string, required) - One of: `start`, `enterprise`
- `userId` (string, required) - User ID
- `userEmail` (string, optional) - User email for receipt

**Response:**
```json
{
  "ok": true,
  "orderId": "order_abc123xyz789",
  "amount": 64900,
  "currency": "INR",
  "planId": "start",
  "planName": "BuildeX Start Plan",
  "keyId": "rzp_test_abc123xyz789",
  "isSimulated": false
}
```

**Usage Example:**
```javascript
// 1. Create order
const orderRes = await fetch('https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/payment/create-order', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    planId: 'start',
    userId: currentUser.userId,
    userEmail: currentUser.email
  })
});
const orderData = await orderRes.json();

// 2. Open Razorpay checkout
const options = {
  key: orderData.keyId,
  amount: orderData.amount,
  currency: orderData.currency,
  order_id: orderData.orderId,
  name: 'BuildeX Coder IDE',
  description: orderData.planName,
  handler: function (response) {
    // 3. Verify payment (see next endpoint)
    verifyPayment(response);
  }
};
const rzp = new Razorpay(options);
rzp.open();
```

---

### **Verify Payment**

Verify Razorpay payment signature and upgrade user tier.

**Endpoint:** `POST /api/payment/verify`

**Request Body:**
```json
{
  "razorpay_order_id": "order_abc123xyz789",
  "razorpay_payment_id": "pay_xyz789abc123",
  "razorpay_signature": "abcd1234efgh5678ijkl9012mnop3456",
  "userId": "cognito_sub_abc123",
  "planId": "start"
}
```

**Parameters:**
- `razorpay_order_id` (string, required) - Order ID from create-order
- `razorpay_payment_id` (string, required) - Payment ID from Razorpay
- `razorpay_signature` (string, required) - HMAC signature from Razorpay
- `userId` (string, required) - User ID
- `planId` (string, required) - Plan ID

**Response (Success):**
```json
{
  "ok": true,
  "success": true,
  "message": "Successfully upgraded to BuildeX Start Plan",
  "paymentId": "pay_xyz789abc123",
  "orderId": "order_abc123xyz789",
  "plan": "start",
  "tier": "pro",
  "creditsGranted": 2000,
  "user": {
    "userId": "cognito_sub_abc123",
    "tier": "pro",
    "creditsTotal": 2000,
    "creditsRemaining": 2000,
    "subscriptionStatus": "ACTIVE"
  }
}
```

**Response (Failure):**
```json
{
  "ok": false,
  "error": "Invalid payment signature"
}
```

---

## 🏥 System

### **Health Check**

Verify API is operational.

**Endpoint:** `GET /api/health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-22T14:30:00.000Z",
  "version": "1.0.0"
}
```

---

## ❌ Error Codes

All error responses follow this format:

```json
{
  "ok": false,
  "error": "Error message description"
}
```

**HTTP Status Codes:**

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 400 | Bad Request | Invalid parameters or missing required fields |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Endpoint or resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Lambda function error or AWS service issue |

**Common Error Messages:**

| Error | Cause | Solution |
|-------|-------|----------|
| `Missing required 'prompt' parameter` | No prompt in chat request | Include `prompt` field in request body |
| `Invalid payment signature` | Razorpay signature verification failed | Ensure correct order_id, payment_id, and signature |
| `User not found` | User ID doesn't exist in DynamoDB | Authenticate first via `/api/auth/session` |
| `Insufficient credits` | User ran out of credits | Upgrade plan via `/api/payment/create-order` |
| `AccessDeniedException` | Bedrock model not enabled | Enable model access in AWS Bedrock Console |

---

## 🔒 Security & Rate Limiting

### **Authentication**
- All endpoints accept optional `Authorization: Bearer {jwt_token}` header
- JWT tokens issued by Amazon Cognito with 1-hour expiry
- Refresh tokens valid for 30 days

### **Rate Limiting**
- Free tier: 100 requests/hour per user
- Pro tier: 500 requests/hour per user
- Enterprise tier: 2000 requests/hour per user

### **CORS**
All endpoints return CORS headers allowing requests from any origin (`Access-Control-Allow-Origin: *`). In production, restrict this to your domain.

---

## 📝 Changelog

### v1.0.0 (2026-01-22)
- Initial API release
- Bedrock chat streaming
- Cognito authentication
- DynamoDB user/project management
- S3 pre-signed URLs
- Razorpay payment integration

---

## 💬 Support

For API issues, contact:
- **GitHub:** https://github.com/md-Yusha/Buildex_AWS/issues
- **Email:** support@buildexide.dev

---

**BuildeX Coder IDE — Powered by AWS ☁️**
