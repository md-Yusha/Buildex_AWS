/*---------------------------------------------------------------------------------------------
 *  BuildeX AWS — Cloud Auth Callback Handler
 *  Receives redirect from Amazon Cognito Hosted UI (Email/Password or Google)
 *  Exchanges authorization code for JWT tokens, syncs user in DynamoDB with credits,
 *  and marks the cloud auth session as authenticated.
 *--------------------------------------------------------------------------------------------*/

import { docClient, TABLES } from "../services/dynamo.js";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export async function handler(event) {
  const queryParams = event.queryStringParameters || {};
  const code = queryParams.code;
  const authSessionId = queryParams.state;
  const error = queryParams.error;
  const errorDescription = queryParams.error_description;

  const region = process.env.AWS_REGION || "ap-south-1";
  const domainPrefix = process.env.COGNITO_DOMAIN_PREFIX || "buildex-ide";
  const cognitoDomain = process.env.COGNITO_DOMAIN || `https://${domainPrefix}.auth.${region}.amazoncognito.com`;
  const clientId = process.env.COGNITO_CLIENT_ID || "1t0auvpbcr0lb9eb5c3tdunog5";
  const apiBase = process.env.BUILDEX_API_BASE_URL || "https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com";
  const redirectUri = `${apiBase}/api/auth/callback`;

  // Handle Logout route
  const requestPath = event.rawPath || event.requestContext?.http?.path || "";
  if (requestPath.endsWith("/logout")) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderHtmlLogout(apiBase, cognitoDomain, clientId)
    };
  }

  // Handle Cognito errors
  if (error || !code) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderHtmlError(errorDescription || error || "No authorization code provided.")
    };
  }

  try {
    // 1. Exchange authorization code for Cognito tokens
    const tokenUrl = `${cognitoDomain}/oauth2/token`;
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code,
      redirect_uri: redirectUri
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: tokenParams.toString()
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Token exchange failed:", errText);
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: renderHtmlError("Failed to exchange authorization code with AWS Cognito: " + errText)
      };
    }

    const tokens = await tokenResponse.json();
    const idToken = tokens.id_token;

    // 2. Decode ID token payload to get user identity
    let userClaims = {};
    try {
      const payloadBase64 = idToken.split(".")[1];
      userClaims = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8"));
    } catch (parseErr) {
      console.warn("Could not parse JWT payload, falling back to claims", parseErr);
    }

    const userId = userClaims.sub || ("usr_" + (userClaims.email ? Buffer.from(userClaims.email).toString("hex").slice(0, 16) : Date.now().toString(36)));
    const email = (userClaims.email || "developer@buildex.dev").toLowerCase();
    const name = userClaims.name || email.split("@")[0].split(".").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    const avatar = userClaims.picture || `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(email)}`;

    // 3. Query existing user in DynamoDB or create new profile with 500 Credits
    const userRes = await docClient.send(new GetCommand({
      TableName: TABLES.USERS,
      Key: { userId }
    }));

    let userRecord = userRes.Item;

    if (!userRecord) {
      userRecord = {
        userId,
        email,
        name,
        avatar,
        tier: "free",
        creditsTotal: 500,
        creditsUsed: 0,
        creditsRemaining: 500,
        tokensUsed: 0,
        requestsCount: 0,
        streak: 1,
        xp: 0,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      };

      await docClient.send(new PutCommand({
        TableName: TABLES.USERS,
        Item: userRecord
      }));
    } else {
      // Ensure credits exist on existing profile
      if (typeof userRecord.creditsTotal !== "number") {
        userRecord.creditsTotal = 500;
        userRecord.creditsUsed = userRecord.creditsUsed || 0;
        userRecord.creditsRemaining = userRecord.creditsTotal - userRecord.creditsUsed;
      }
      userRecord.lastActiveAt = new Date().toISOString();

      await docClient.send(new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { userId },
        UpdateExpression: "SET lastActiveAt = :now, email = :email, #n = :name",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: {
          ":now": userRecord.lastActiveAt,
          ":email": email,
          ":name": name
        }
      }));
    }

    // 4. Update the cloud auth session in DynamoDB if session ID was provided in state
    if (authSessionId) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLES.SESSIONS,
          Key: { sessionId: authSessionId },
          UpdateExpression: "SET #st = :status, #usr = :user, #tok = :token, updatedAt = :now",
          ExpressionAttributeNames: {
            "#st": "status",
            "#usr": "user",
            "#tok": "token"
          },
          ExpressionAttributeValues: {
            ":status": "authenticated",
            ":user": userRecord,
            ":token": idToken,
            ":now": new Date().toISOString()
          }
        }));
      } catch (sessErr) {
        console.error("Could not update auth session:", sessErr);
      }
    }

    // 5. Redirect back to the hosted BuildeX website with verified user payload
    const websiteUrl = process.env.BUILDEX_WEBSITE_URL || "http://buildex-ide-web-052477895001.s3-website.ap-south-1.amazonaws.com";
    const userPayloadBase64 = Buffer.from(JSON.stringify({
      userId: userRecord.userId,
      email: userRecord.email,
      name: userRecord.name,
      avatar: userRecord.avatar,
      tier: userRecord.tier || "free",
      creditsRemaining: userRecord.creditsRemaining ?? 500,
      creditsTotal: userRecord.creditsTotal ?? 500
    })).toString("base64");

    const redirectTarget = `${websiteUrl}/?authSuccess=1&u=${encodeURIComponent(userPayloadBase64)}${authSessionId ? `&authSessionId=${encodeURIComponent(authSessionId)}` : ""}`;

    return {
      statusCode: 302,
      headers: {
        "Location": redirectTarget
      },
      body: ""
    };
  } catch (err) {
    console.error("AuthCallback error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderHtmlError(err.message || "An unexpected error occurred during authentication.")
    };
  }
}

function renderHtmlSuccess(user, sessionId, cognitoDomain, clientId, apiBase) {
  const safeName = escapeHtml(user.name || "Developer");
  const safeEmail = escapeHtml(user.email || "");
  const credits = user.creditsRemaining ?? 500;
  const logoutUrl = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(apiBase + '/api/auth/logout')}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Successful — BuildeX</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111726;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.35);
      --success: #10b981;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(ellipse at top, rgba(59, 130, 246, 0.12) 0%, transparent 60%),
        radial-gradient(circle at bottom, rgba(16, 185, 129, 0.06) 0%, transparent 40%);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 460px;
      width: 100%;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border);
      animation: cardIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes cardIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .icon-badge {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      color: var(--success);
      box-shadow: 0 0 24px rgba(16, 185, 129, 0.2);
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    p {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .profile-pill {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      text-align: left;
      margin-bottom: 24px;
    }
    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid var(--accent);
    }
    .profile-info { flex: 1; min-width: 0; }
    .profile-name { font-weight: 600; font-size: 15px; }
    .profile-email { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .credits-tag {
      background: rgba(16, 185, 129, 0.16);
      color: #34d399;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid rgba(52, 211, 153, 0.3);
      white-space: nowrap;
    }
    .actions-wrap {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      margin-bottom: 16px;
    }
    .action-btn {
      display: block;
      width: 100%;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      background: var(--accent);
      color: #fff;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px var(--accent-glow);
      transition: all 0.15s ease;
    }
    .action-btn:hover {
      background: #2563eb;
      transform: translateY(-1px);
    }
    .action-btn.secondary {
      background: rgba(255, 255, 255, 0.07);
      color: #cbd5e1;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: none;
    }
    .action-btn.secondary:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      transform: translateY(-1px);
    }
    .status-banner {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      text-align: left;
      margin-bottom: 20px;
      font-size: 13px;
      color: #34d399;
      line-height: 1.45;
      animation: cardIn 0.25s ease;
    }
    .status-banner-icon {
      font-size: 24px;
      flex-shrink: 0;
    }
    .note {
      font-size: 12.5px;
      color: #6b7280;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
    <h1>Authentication Successful</h1>
    <p>Welcome to BuildeX. Your AWS cloud account has been verified and synced.</p>

    <div class="profile-pill">
      <img src="${user.avatar || "https://api.dicebear.com/7.x/bottts-neutral/svg?seed=" + encodeURIComponent(safeEmail)}" alt="Avatar" class="avatar" />
      <div class="profile-info">
        <div class="profile-name">${safeName}</div>
        <div class="profile-email">${safeEmail}</div>
      </div>
      <div class="credits-tag">⚡ ${credits} Credits</div>
    </div>

    <div class="actions-wrap">
      <button id="return-btn" onclick="returnToApp()" class="action-btn">
        Return to BuildeX IDE
      </button>
      <a href="http://buildex-ide-web-052477895001.s3-website.ap-south-1.amazonaws.com" class="action-btn secondary">
        Open Web Dashboard & Cloud Agents
      </a>
      <a href="${logoutUrl}" class="action-btn secondary">
        Log Out / Switch Account
      </a>
    </div>

    <div id="return-banner" class="status-banner" style="display: none;">
      <div class="status-banner-icon">🚀</div>
      <div>
        <strong>Ready to Code!</strong><br>
        Your desktop IDE has synced automatically. Switch back to <strong>BuildeX IDE</strong> in your dock or taskbar.
      </div>
    </div>

    <div class="note">You can safely close this browser tab at any time.</div>
  </div>

  <script>
    function returnToApp() {
      const btn = document.getElementById('return-btn');
      const banner = document.getElementById('return-banner');
      if (btn) {
        btn.innerHTML = '✓ Return to BuildeX IDE';
        btn.style.background = '#10b981';
      }
      if (banner) {
        banner.style.display = 'flex';
      }
      try {
        window.open('', '_self', '');
        window.close();
      } catch (_) {}
    }
    // Auto-attempt return after brief display
    setTimeout(() => {
      returnToApp();
    }, 1500);
  </script>
</body>
</html>`;
}

function renderHtmlLogout(apiBase, cognitoDomain, clientId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signed Out — BuildeX</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111726;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #3b82f6;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: radial-gradient(ellipse at top, rgba(59, 130, 246, 0.1) 0%, transparent 60%);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    }
    .icon-badge {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      color: #f87171;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    p { font-size: 14px; color: var(--text-muted); line-height: 1.5; margin-bottom: 24px; }
    .action-btn {
      display: inline-block;
      width: 100%;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      background: var(--accent);
      color: #fff;
      border: none;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
    </div>
    <h1>Logged Out Successfully</h1>
    <p>You have signed out from BuildeX and Amazon Cognito. Return to your BuildeX IDE desktop app to log in again.</p>
    <button onclick="window.close()" class="action-btn">Close Window</button>
  </div>
</body>
</html>`;
}

function renderHtmlError(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authentication Error — BuildeX</title>
  <style>
    body { background: #090d16; color: #f3f4f6; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #111726; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 36px; max-width: 440px; text-align: center; }
    h1 { color: #f87171; font-size: 20px; margin-bottom: 12px; }
    p { font-size: 14px; color: #9ca3af; margin-bottom: 20px; line-height: 1.5; }
    a { color: #60a5fa; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authentication Failed</h1>
    <p>${escapeHtml(message)}</p>
    <a href="javascript:window.close()">Close this window and try again</a>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c] || c));
}
