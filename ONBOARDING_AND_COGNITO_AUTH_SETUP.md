# ☁️ BuildeX — 100% AWS Cloud-Native Authentication & Account Sync Guide

> [!IMPORTANT]
> **Zero Localhost Architecture**: This setup eliminates `http://127.0.0.1:4545` and local listeners completely. All authentication, callbacks, and user session syncing run **100% on AWS Cloud infrastructure** (Amazon Cognito, Amazon API Gateway, and Amazon DynamoDB).

---

## 📌 Architecture: Cloud-Native Auth & Session Sync

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          BuildeX Desktop IDE (Electron)                         │
│                                                                                 │
│  1. First Launch? ──► Shows Onboarding Modal (Cursor-Style)                     │
│  2. Click [Log In] or [Sign Up]                                                │
│  3. Calls AWS API: POST /api/auth/session ──► Receives { authSessionId, authUrl}│
│  4. Opens Browser to AWS Cognito Cloud Domain                                   │
│  5. Polls AWS API: GET /api/auth/session?id=... (Cloud Polling)                 │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │ Opens Browser:
                          │ https://<cognito-domain>.auth.ap-south-1.amazoncognito.com
                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       Amazon Cognito Cloud Hosted UI                            │
│                                                                                 │
│  • Email & Password Sign-in / Sign-up                                           │
│  • "Continue with Google" Federated OAuth                                       │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │ On Success ──► Redirects to AWS Cloud API Gateway:
                          │ https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/callback
                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       AWS Lambda Auth Callback Handler                          │
│                                                                                 │
│  1. Exchanges Cognito code for User Tokens & Profile                           │
│  2. Creates / Syncs user in DynamoDB (BuildexUsers) with 500 Credits            │
│  3. Marks authSessionId as "authenticated" in DynamoDB (BuildexSessions)        │
│  4. Displays Sleek Dark "Authentication Successful! Return to BuildeX" Web Page │
└─────────────────────────┬───────────────────────────────────────────────────────┘
                          │ Desktop IDE's Cloud Poll detects "authenticated"
                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          BuildeX Desktop IDE (Electron)                         │
│                                                                                 │
│  1. Receives User Profile, Credits Balance (500) & Token                        │
│  2. Saves Session to Local Storage & Closes Onboarding Modal                    │
│  3. Displays Full IDE with Live Status Bar: "⚡ 500 / 500 Credits"              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Amazon Cognito Setup (Using AWS Cloud Domains Only)

### Step 1.1: Your Cognito Domain
In AWS Cognito Console ➔ User Pool (`buildex-user-pool`) ➔ **App integration** tab ➔ **Domain**:
- Domain Name: `https://buildex-ide.auth.ap-south-1.amazoncognito.com`
- Client ID: `1r59q883oja0acvu9fvq20qn1b`
- API Gateway Callback: `https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/callback`

---

### Step 1.2: App Client Hosted UI Settings (Pure AWS Endpoints)
In your User Pool ➔ **App integration** ➔ click your App Client ➔ scroll to **Hosted UI** ➔ **Edit**:

- **Allowed callback URLs**:
  ```
  https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/callback
  ```
  *(Notice: Pure AWS API Gateway domain — NO localhost!)*

- **Allowed sign-out URLs**:
  ```
  https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/logout
  ```

- **Identity providers**:
  - Check **Cognito user pool**
  - Check **Google**

- **OAuth 2.0 grant types**:
  - Check **Authorization code grant**

- **OpenID Connect scopes**:
  - Check **OpenID**, **Email**, **Profile**, **aws.cognito.signin.user.admin**

- Click **Save changes**.

---

### Step 1.3: Google Cloud Console Credentials (Pure AWS Callback)
In **[Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials)**:
1. Create or edit your **OAuth 2.0 Client ID** (Web application).
2. **Authorized JavaScript origins**:
   ```
   https://buildex-auth.auth.ap-south-1.amazoncognito.com
   ```
3. **Authorized redirect URIs**:
   ```
   https://buildex-auth.auth.ap-south-1.amazoncognito.com/oauth2/idpresponse
   ```
4. Copy your **Client ID** and **Client Secret**.

---

### Step 1.4: Add Google to Cognito
In Cognito User Pool ➔ **Sign-in experience** ➔ **Add identity provider** ➔ **Google**:
- Enter Google Client ID and Secret.
- Scopes: `profile email openid`
- Attribute mapping: `email` ➔ `email`, `name` ➔ `name`.

---

## 2. AWS Backend Implementation: Two Cloud Endpoints

Add these two lightweight endpoints to your AWS SAM / API Gateway stack (`backend/template.yaml`):

### Endpoint 1: `POST /api/auth/session` (Initiate Session)
- **What it does**: Generates a temporary `authSessionId` (e.g. `sess_8f3d...`) and saves it to DynamoDB `BuildexSessions` with status `"pending"`.
- **Returns**:
  ```json
  {
    "authSessionId": "sess_8f3d9a1b2c",
    "authUrl": "https://buildex-auth.auth.ap-south-1.amazoncognito.com/login?client_id=3a4b5c6d7e8f9g0h1i2j3k4l5m&response_type=code&scope=email+openid+profile&redirect_uri=https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/callback&state=sess_8f3d9a1b2c"
  }
  ```

### Endpoint 2: `GET /api/auth/callback` (Cognito Return on AWS Cloud)
- **What it does**:
  1. Receives `code` and `state` (`authSessionId`) from Cognito.
  2. Exchanges `code` for tokens at Cognito's `/oauth2/token` endpoint.
  3. Gets user profile (`userId`, `email`, `name`).
  4. Queries or creates user in DynamoDB `BuildexUsers` with **500 starter credits**.
  5. Updates `BuildexSessions` for `authSessionId`:
     `status: "authenticated"`, `user: { ... }`, `token: id_token`.
  6. Returns an HTML response rendered in the user's browser:
     - Sleek dark background matching BuildeX branding.
     - Green checkmark: *"Authentication Successful! Welcome to BuildeX. You can close this tab and return to your IDE."*
     - Optional "Return to App" deep-link button (`buildex://auth?session=...`).

### Endpoint 3: `GET /api/auth/session?id=sess_...` (Session Status Poll)
- Desktop app polls this every 1.5 seconds.
- As soon as status is `"authenticated"`, returns user profile, credits, and token.

---

## 3. Account Credits & Usage Tracking in DynamoDB

### Schema: `BuildexUsers` Table
```json
{
  "userId": "cognito_sub_or_id",
  "email": "developer@example.com",
  "name": "Jane Developer",
  "avatar": "https://api.dicebear.com/7.x/bottts-neutral/svg?seed=...",
  "tier": "free",
  "creditsTotal": 500,
  "creditsUsed": 0,
  "creditsRemaining": 500,
  "tokensUsed": 0,
  "requestsCount": 0,
  "createdAt": "2026-09-18T16:00:00.000Z",
  "lastActiveAt": "2026-09-18T16:00:00.000Z"
}
```

### Live Deduction in Desktop IDE:
- Every prompt sent through Bedrock calls AWS API or Lambda.
- Deducts credits:
  - **Amazon Nova Micro**: `0.1 credits`
  - **Claude 3 Haiku**: `0.5 credits`
  - **Claude 3.5 Sonnet**: `2.0 credits`
- Desktop status bar live counter updates:
  ```
  ⚡ 485 / 500 Credits  [Pro Tier]
  ```

---

## 4. Cursor-Style Onboarding UI (Desktop App)

- **Trigger**: App launch checks `localStorage.getItem('buildex_user_session')`.
- If null: Renders full-window dark overlay:
  - Centered Electron logo (clean SVG with neon gradient pulse).
  - Title: **BUILDEX**
  - Subtitle: *"The best way to code with AI"*
  - Blue button: **Log In**
  - Graphite button: **Sign Up**
- Clicking either calls `POST /api/auth/session` and opens the AWS Cognito Hosted UI in the browser.
- Automatically listens via cloud poll; once verified, the modal dissolves smoothly into the workspace!
