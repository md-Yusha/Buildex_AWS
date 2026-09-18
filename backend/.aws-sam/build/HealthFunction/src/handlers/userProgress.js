import { docClient, TABLES } from "../services/dynamo.js";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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
    const userId = event.queryStringParameters?.userId || "anonymous_user";

    if (method === "GET") {
      // Fetch user summary
      const userRes = await docClient.send(new GetCommand({
        TableName: TABLES.USERS,
        Key: { userId }
      }));

      const progressRes = await docClient.send(new QueryCommand({
        TableName: TABLES.PROGRESS,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          user: userRes.Item || { userId, xp: 0, streak: 0, badges: [] },
          progress: progressRes.Items || []
        })
      };
    }

    if (method === "POST") {
      const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};
      const { xpDelta = 0, conceptId, masteryLevel, solved = false } = body;

      // Update XP & Streak
      await docClient.send(new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { userId },
        UpdateExpression: "SET xp = if_not_exists(xp, :zero) + :xp, updatedAt = :now",
        ExpressionAttributeValues: {
          ":zero": 0,
          ":xp": xpDelta,
          ":now": new Date().toISOString()
        }
      }));

      // Update Concept Progress if provided
      if (conceptId) {
        await docClient.send(new PutCommand({
          TableName: TABLES.PROGRESS,
          Item: {
            userId,
            conceptId,
            masteryLevel: masteryLevel || 1,
            solved,
            updatedAt: new Date().toISOString()
          }
        }));
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: "Progress updated successfully" })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("Progress error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Internal server error" })
    };
  }
}
