import { invokeBedrock } from "../services/bedrock.js";
import { docClient, TABLES } from "../services/dynamo.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

export async function handler(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};
    const { mode = "learn", prompt, codeContext = "", activeFile = "", sessionId = `sess_${Date.now()}` } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required 'prompt' parameter." })
      };
    }

    // Invoke Bedrock
    const result = await invokeBedrock({ mode, prompt, codeContext, activeFile });

    // Save session message to DynamoDB
    try {
      await docClient.send(new PutCommand({
        TableName: TABLES.SESSIONS,
        Item: {
          sessionId,
          mode,
          prompt,
          response: result.text,
          tokensUsed: result.usage?.outputTokens || 0,
          timestamp: new Date().toISOString()
        }
      }));
    } catch (dbErr) {
      console.warn("Could not write session to DynamoDB:", dbErr.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sessionId,
        content: result.text,
        tokensUsed: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
        modelId: result.modelId
      })
    };
  } catch (err) {
    console.error("Chat error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Internal server error" })
    };
  }
}
