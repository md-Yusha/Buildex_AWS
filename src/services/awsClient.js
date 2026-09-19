/* ============================================================
 * BuildeX AWS Services Manager (Main Process)
 *
 * Provides high-level methods to interact with DynamoDB, S3,
 * and the deployed API Gateway.
 * ============================================================ */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let ddbDocClient = null;
let s3Client = null;

function getCredentialsConfig() {
  const region = process.env.AWS_REGION || 'ap-south-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  const config = { region };
  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {})
    };
  }
  return config;
}

function getDynamoDocClient() {
  if (!ddbDocClient) {
    const ddb = new DynamoDBClient(getCredentialsConfig());
    ddbDocClient = DynamoDBDocumentClient.from(ddb, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }
  return ddbDocClient;
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client(getCredentialsConfig());
  }
  return s3Client;
}

// ==========================================
// 1. DYNAMODB OPERATIONS
// ==========================================

async function getUserProgress(userId = 'anonymous_user') {
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_USERS_TABLE || 'BuildexUsers';
    const progressTable = process.env.DYNAMODB_PROGRESS_TABLE || 'BuildexProgress';

    const userRes = await ddb.send(new GetCommand({
      TableName: table,
      Key: { userId }
    }));

    const progressRes = await ddb.send(new QueryCommand({
      TableName: progressTable,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId }
    }));

    return {
      ok: true,
      user: userRes.Item || { userId, xp: 0, streak: 0, badges: [] },
      progress: progressRes.Items || []
    };
  } catch (err) {
    // Fallback to API Gateway if local direct SDK fails
    const apiBase = process.env.BUILDEX_API_BASE_URL;
    if (apiBase) {
      try {
        const res = await fetch(`${apiBase}/api/user/progress?userId=${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          return { ok: true, ...data };
        }
      } catch (_) {}
    }
    return { ok: false, error: err.message };
  }
}

async function updateUserProgress(payload = {}) {
  const { userId = 'anonymous_user', xpDelta = 0, conceptId, masteryLevel, solved = false } = payload;
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_USERS_TABLE || 'BuildexUsers';
    const progressTable = process.env.DYNAMODB_PROGRESS_TABLE || 'BuildexProgress';

    await ddb.send(new UpdateCommand({
      TableName: table,
      Key: { userId },
      UpdateExpression: 'SET xp = if_not_exists(xp, :zero) + :xp, updatedAt = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':xp': xpDelta,
        ':now': new Date().toISOString()
      }
    }));

    if (conceptId) {
      await ddb.send(new PutCommand({
        TableName: progressTable,
        Item: {
          userId,
          conceptId,
          masteryLevel: masteryLevel || 1,
          solved,
          updatedAt: new Date().toISOString()
        }
      }));
    }

    return { ok: true, message: 'Progress updated in DynamoDB' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ==========================================
// 2. S3 STORAGE OPERATIONS
// ==========================================

async function getPresignedUploadUrl(userId = 'anonymous_user', filename = `workspace_${Date.now()}.zip`) {
  try {
    const s3 = getS3Client();
    const bucket = process.env.S3_PROJECTS_BUCKET || 'buildex-projects-storage-052477895001';
    const key = `workspaces/${userId}/${Date.now()}_${filename}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: 'application/zip'
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return { ok: true, uploadUrl, key, bucket };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function uploadImageToS3(base64DataOrOpts, filenameParam = `image_${Date.now()}.png`, userIdParam = 'anonymous_user') {
  try {
    let base64Data = base64DataOrOpts;
    let filename = filenameParam;
    let userId = userIdParam;

    if (base64DataOrOpts && typeof base64DataOrOpts === 'object' && base64DataOrOpts.base64Data) {
      base64Data = base64DataOrOpts.base64Data;
      filename = base64DataOrOpts.filename || filenameParam;
      userId = base64DataOrOpts.userId || userIdParam;
    }

    const s3 = getS3Client();
    const bucket = process.env.S3_PROJECTS_BUCKET || 'buildex-projects-storage-052477895001';
    const cleanFilename = String(filename || `image_${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `chat-attachments/${userId}/${Date.now()}_${cleanFilename}`;

    // Extract base64 buffer and mime type
    const matches = typeof base64Data === 'string' ? base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/) : null;
    const contentType = matches ? matches[1] : 'image/png';
    const buffer = matches ? Buffer.from(matches[2], 'base64') : (Buffer.isBuffer(base64Data) ? base64Data : Buffer.from(base64Data, 'base64'));

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }));

    const s3Uri = `s3://${bucket}/${key}`;
    const region = process.env.AWS_REGION || 'ap-south-1';
    const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    return { ok: true, s3Uri, s3Url, bucket, key };
  } catch (err) {
    console.warn("S3 image upload error:", err.message);
    return { ok: false, error: err.message };
  }
}

// ==========================================
// 3. CLOUD AUTH & CREDITS SYNC
// ==========================================

async function getUserAccount(userId = 'anonymous_user') {
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_USERS_TABLE || 'BuildexUsers';

    const userRes = await ddb.send(new GetCommand({
      TableName: table,
      Key: { userId }
    }));

    let user = userRes.Item;
    if (!user) {
      user = {
        userId,
        email: 'developer@buildex.dev',
        name: 'Developer',
        avatar: `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(userId)}`,
        tier: 'free',
        creditsTotal: 500,
        creditsUsed: 0,
        creditsRemaining: 500,
        tokensUsed: 0,
        requestsCount: 0,
        streak: 1,
        xp: 0
      };
    } else {
      if (typeof user.creditsTotal !== 'number') user.creditsTotal = 500;
      if (typeof user.creditsUsed !== 'number') user.creditsUsed = 0;
      user.creditsRemaining = Math.max(0, user.creditsTotal - user.creditsUsed);
    }

    return { ok: true, user };
  } catch (err) {
    const apiBase = process.env.BUILDEX_API_BASE_URL;
    if (apiBase) {
      try {
        const res = await fetch(`${apiBase}/api/user/progress?userId=${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          return { ok: true, user: data.user || { userId, creditsRemaining: 500 } };
        }
      } catch (_) {}
    }
    return { ok: false, error: err.message, user: { userId, creditsTotal: 500, creditsUsed: 0, creditsRemaining: 500 } };
  }
}

async function deductUserCredits({ userId = 'anonymous_user', creditsDelta = 0.5, tokensUsed = 0 }) {
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_USERS_TABLE || 'BuildexUsers';

    const res = await ddb.send(new UpdateCommand({
      TableName: table,
      Key: { userId },
      UpdateExpression: 'SET creditsUsed = if_not_exists(creditsUsed, :zero) + :delta, tokensUsed = if_not_exists(tokensUsed, :zero) + :tok, requestsCount = if_not_exists(requestsCount, :zero) + :one, lastActiveAt = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':delta': Number(creditsDelta) || 0.5,
        ':tok': Number(tokensUsed) || 0,
        ':one': 1,
        ':now': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }));

    const u = res.Attributes || {};
    const total = u.creditsTotal ?? 500;
    const used = u.creditsUsed ?? 0;
    const remaining = Math.max(0, total - used);
    u.creditsTotal = total;
    u.creditsUsed = used;
    u.creditsRemaining = remaining;

    return { ok: true, user: u, creditsTotal: total, creditsUsed: used, creditsRemaining: remaining };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function updateUserProfile({ userId = 'anonymous_user', name, avatar }) {
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_USERS_TABLE || 'BuildexUsers';

    const updates = ['#n = :name', 'lastActiveAt = :now'];
    const names = { '#n': 'name' };
    const values = {
      ':name': String(name || 'Developer'),
      ':now': new Date().toISOString()
    };

    if (avatar) {
      updates.push('avatar = :avatar');
      values[':avatar'] = String(avatar);
    }

    const res = await ddb.send(new UpdateCommand({
      TableName: table,
      Key: { userId },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW'
    }));

    return { ok: true, user: res.Attributes };
  } catch (err) {
    console.warn('Update user profile error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function initiateAuthSession({ action = 'login', provider = null } = {}) {
  const apiBase = process.env.BUILDEX_API_BASE_URL || 'https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com';
  const region = process.env.AWS_REGION || 'ap-south-1';
  const domainPrefix = process.env.COGNITO_DOMAIN_PREFIX || 'buildex-ide';
  const rawDomain = process.env.COGNITO_DOMAIN || `${domainPrefix}.auth.${region}.amazoncognito.com`;
  const cognitoDomain = rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`;
  const clientId = process.env.COGNITO_CLIENT_ID || '1t0auvpbcr0lb9eb5c3tdunog5';
  const redirectUri = `${apiBase}/api/auth/callback`;

  // 1. Try cloud API Gateway session initiation first
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, provider })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
  }

  // 2. Direct DynamoDB session creation fallback
  try {
    const crypto = require('crypto');
    const authSessionId = 'sess_' + crypto.randomBytes(16).toString('hex');
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_SESSIONS_TABLE || 'BuildexSessions';

    await ddb.send(new PutCommand({
      TableName: table,
      Item: {
        sessionId: authSessionId,
        status: 'pending',
        action: action,
        provider: provider || 'cognito',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 900
      }
    }));

    const websiteUrl = process.env.BUILDEX_WEBSITE_URL || 'https://buildexide.dev';
    let authUrl = `${websiteUrl}/?authSessionId=${authSessionId}&action=${action}${provider ? `&provider=${encodeURIComponent(provider)}` : ''}`;
    return { ok: true, authSessionId, authUrl };
  } catch (err) {
    // Ultimate URL fallback
    const authSessionId = 'sess_' + Date.now().toString(36);
    const websiteUrl = process.env.BUILDEX_WEBSITE_URL || 'https://buildexide.dev';
    let authUrl = `${websiteUrl}/?authSessionId=${authSessionId}&action=${action}${provider ? `&provider=${encodeURIComponent(provider)}` : ''}`;
    return { ok: true, authSessionId, authUrl };
  }
}

async function pollAuthSession(authSessionId) {
  if (!authSessionId) return { ok: false, status: 'error', error: 'Missing session ID' };

  const apiBase = process.env.BUILDEX_API_BASE_URL;
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/auth/session?id=${encodeURIComponent(authSessionId)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
  }

  // Fallback to direct DynamoDB query
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_SESSIONS_TABLE || 'BuildexSessions';
    const res = await ddb.send(new GetCommand({
      TableName: table,
      Key: { sessionId: authSessionId }
    }));
    const s = res.Item;
    if (s && s.status === 'authenticated') {
      return { ok: true, status: 'authenticated', user: s.user, token: s.token };
    }
    return { ok: true, status: s?.status || 'pending' };
  } catch (err) {
    return { ok: false, status: 'pending', error: err.message };
  }
}

// ==========================================
// 4. CLOUD CHAT BACKUPS (DynamoDB BuildexChats)
// ==========================================

async function backupChatToDynamoDB({ userId = 'anonymous_user', chat }) {
  if (!chat || !chat.id) return { ok: false, error: 'Missing chat payload' };
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_CHATS_TABLE || 'BuildexChats';

    // Sanitize messages so giant base64 images don't exceed DynamoDB's 400KB limit
    const rawMessages = Array.isArray(chat.messages) ? chat.messages : [];
    const sanitizedMessages = rawMessages.map(m => {
      const clean = { ...m };
      if (Array.isArray(clean.attachments)) {
        clean.attachments = clean.attachments.map(att => {
          const { data, ...rest } = att;
          return {
            ...rest,
            s3Url: att.s3Url || null,
            s3Uri: att.s3Uri || null,
            name: att.name || 'image.png',
            size: att.size || 0
          };
        });
      }
      return clean;
    });

    const item = {
      userId: String(userId),
      chatId: String(chat.id),
      title: String(chat.title || 'New chat'),
      messages: sanitizedMessages,
      messageCount: sanitizedMessages.length,
      createdAt: chat.createdAt ? (typeof chat.createdAt === 'number' ? new Date(chat.createdAt).toISOString() : String(chat.createdAt)) : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await ddb.send(new PutCommand({
      TableName: table,
      Item: item
    }));

    return { ok: true, chatId: chat.id, updatedAt: item.updatedAt };
  } catch (err) {
    console.warn('Chat backup to DynamoDB error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function getChatsFromDynamoDB(userId = 'anonymous_user') {
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_CHATS_TABLE || 'BuildexChats';

    const res = await ddb.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': String(userId) }
    }));

    return { ok: true, chats: res.Items || [] };
  } catch (err) {
    console.warn('Fetch chats from DynamoDB error:', err.message);
    return { ok: false, error: err.message, chats: [] };
  }
}

async function deleteChatFromDynamoDB({ userId = 'anonymous_user', chatId }) {
  if (!chatId) return { ok: false, error: 'Missing chatId' };
  try {
    const ddb = getDynamoDocClient();
    const table = process.env.DYNAMODB_CHATS_TABLE || 'BuildexChats';

    await ddb.send(new DeleteCommand({
      TableName: table,
      Key: {
        userId: String(userId),
        chatId: String(chatId)
      }
    }));

    return { ok: true };
  } catch (err) {
    console.warn('Delete chat from DynamoDB error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
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
};
