import { docClient, TABLES } from "../services/dynamo.js";
import { createUploadPresignedUrl, createDownloadPresignedUrl } from "../services/s3.js";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

export async function handler(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  const method = event.requestContext?.http?.method || "GET";
  const path = event.requestContext?.http?.path || "";

  if (method === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const userId = event.queryStringParameters?.userId || "anonymous_user";

    // Handle Pre-Signed URL creation for S3 Uploads
    if (path.endsWith("/presigned-url")) {
      const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};
      const { filename = `project_${Date.now()}.zip`, contentType = "application/zip" } = body;
      const s3Key = `workspaces/${userId}/${Date.now()}_${filename}`;

      const uploadUrl = await createUploadPresignedUrl(s3Key, contentType);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          uploadUrl,
          s3Key
        })
      };
    }

    // List user projects
    if (method === "GET") {
      const projectsRes = await docClient.send(new QueryCommand({
        TableName: TABLES.PROJECTS,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId }
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          projects: projectsRes.Items || []
        })
      };
    }

    // Save project metadata
    if (method === "POST") {
      const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};
      const { projectId = `proj_${Date.now()}`, name, description = "", s3Key = "" } = body;

      const item = {
        userId,
        projectId,
        name: name || "Untitled Project",
        description,
        s3Key,
        updatedAt: new Date().toISOString()
      };

      await docClient.send(new PutCommand({
        TableName: TABLES.PROJECTS,
        Item: item
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          project: item
        })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("Projects error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Internal server error" })
    };
  }
}
