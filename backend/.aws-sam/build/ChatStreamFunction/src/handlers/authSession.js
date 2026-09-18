/*---------------------------------------------------------------------------------------------
 *  BuildeX AWS — Cloud Auth Session Handler
 *  Manages session creation and status polling for pure cloud-native authentication
 *--------------------------------------------------------------------------------------------*/

import { docClient, TABLES } from "../services/dynamo.js";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import crypto from "crypto";

export async function handler(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  const method = event.requestContext?.http?.method || "GET";

  if (method === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const region = process.env.AWS_REGION || "ap-south-1";
    const domainPrefix = process.env.COGNITO_DOMAIN_PREFIX || "buildex-ide";
    const cognitoDomain = process.env.COGNITO_DOMAIN || `https://${domainPrefix}.auth.${region}.amazoncognito.com`;
    const clientId = process.env.COGNITO_CLIENT_ID || "1t0auvpbcr0lb9eb5c3tdunog5";
    const apiBase = process.env.BUILDEX_API_BASE_URL || "https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com";
    const websiteUrl = process.env.BUILDEX_WEBSITE_URL || "http://buildex-ide-web-052477895001.s3-website.ap-south-1.amazonaws.com";
    const redirectUri = `${apiBase}/api/auth/callback`;

    // 1. INITIATE OR APPROVE AUTH SESSION (POST)
    if (method === "POST") {
      let body = {};
      try {
        body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};
      } catch (_) {}

      // A) FULFILL / APPROVE EXISTING SESSION (From Website SSO)
      if (body.sessionId && body.status === "authenticated" && body.user) {
        await docClient.send(new UpdateCommand({
          TableName: TABLES.SESSIONS,
          Key: { sessionId: body.sessionId },
          UpdateExpression: "SET #st = :status, #usr = :user, updatedAt = :now",
          ExpressionAttributeNames: { "#st": "status", "#usr": "user" },
          ExpressionAttributeValues: {
            ":status": "authenticated",
            ":user": body.user,
            ":now": new Date().toISOString()
          }
        }));

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            ok: true,
            sessionId: body.sessionId,
            status: "authenticated"
          })
        };
      }

      // B) CREATE NEW AUTH SESSION
      const action = body.action || "login"; // "login" | "signup"
      const provider = body.provider; // "Google" or undefined
      const authSessionId = "sess_" + crypto.randomBytes(16).toString("hex");
      const expiresAt = Math.floor(Date.now() / 1000) + 900; // 15 mins TTL

      await docClient.send(new PutCommand({
        TableName: TABLES.SESSIONS,
        Item: {
          sessionId: authSessionId,
          status: "pending",
          action: action,
          provider: provider || "cognito",
          createdAt: new Date().toISOString(),
          expiresAt: expiresAt
        }
      }));

      // Construct Cognito Hosted UI / Managed Login URL (as fallback or direct link)
      let cognitoAuthUrl = `${cognitoDomain}/oauth2/authorize?client_id=${clientId}&response_type=code&scope=email+openid+profile&redirect_uri=${encodeURIComponent(redirectUri)}&state=${authSessionId}&prompt=login`;
      if (provider) {
        cognitoAuthUrl += `&identity_provider=${encodeURIComponent(provider)}`;
      }

      // Point primary authUrl to the website SSO onboarding page
      const websiteAuthUrl = `${websiteUrl}/?authSessionId=${authSessionId}&action=${action}${provider ? `&provider=${encodeURIComponent(provider)}` : ''}`;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          authSessionId,
          authUrl: websiteAuthUrl,
          cognitoAuthUrl,
          expiresAt
        })
      };
    }

    // 2. POLL AUTH SESSION STATUS (GET)
    if (method === "GET") {
      const sessionId = event.queryStringParameters?.id || event.queryStringParameters?.sessionId;
      if (!sessionId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ ok: false, error: "Missing sessionId query parameter" })
        };
      }

      const res = await docClient.send(new GetCommand({
        TableName: TABLES.SESSIONS,
        Key: { sessionId }
      }));

      const session = res.Item;
      if (!session) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ ok: false, error: "Session not found or expired" })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          status: session.status || "pending",
          user: session.user || null,
          token: session.token || null
        })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("AuthSession error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message || "Internal server error" })
    };
  }
}
