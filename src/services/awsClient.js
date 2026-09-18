/* ============================================================
 * BuildeX AWS Services Manager (Main Process)
 *
 * Provides high-level methods to interact with DynamoDB, S3,
 * and the deployed API Gateway.
 * ============================================================ */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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
    ddbDocClient = DynamoDBDocumentClient.from(ddb);
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

module.exports = {
  getUserProgress,
  updateUserProgress,
  getPresignedUploadUrl
};
