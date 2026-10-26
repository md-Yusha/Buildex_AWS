import { invokeBedrock } from "../services/bedrock.js";
import { docClient, TABLES } from "../services/dynamo.js";
import { PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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
    const { mode = "learn", prompt, codeContext = "", activeFile = "", sessionId = `sess_${Date.now()}`, userId, modelId = "amazon.nova-micro-v1:0" } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required 'prompt' parameter." })
      };
    }

    // Credit cost per model (in credits)
    const MODEL_COSTS = {
      "amazon.nova-micro-v1:0": 0.1,
      "qwen.qwen-3-coder-30b": 0.3,
      "anthropic.claude-3-haiku-20240307-v1:0": 0.5,
      "deepseek-ai.DeepSeek-V3": 0.8,
      "anthropic.claude-3-5-sonnet-20241022-v2:0": 2.0,
      "google.gemma-2-12b-it-v1:0": 0.2
    };

    const creditCost = MODEL_COSTS[modelId] || 0.3;

    // Check user credits if userId provided
    if (userId) {
      try {
        const userResult = await docClient.send(new GetCommand({
          TableName: TABLES.USERS,
          Key: { userId }
        }));

        const user = userResult.Item;
        if (!user) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: "User not found. Please sign in." })
          };
        }

        const creditsRemaining = user.creditsRemaining ?? 0;

        // Check if user has enough credits
        if (creditsRemaining < creditCost) {
          return {
            statusCode: 402,
            headers,
            body: JSON.stringify({ 
              error: "Insufficient credits. Please purchase more credits to continue.",
              creditsRequired: creditCost,
              creditsRemaining: creditsRemaining
            })
          };
        }

        // Deduct credits BEFORE making the API call
        const newCreditsRemaining = Math.max(0, creditsRemaining - creditCost);
        const newCreditsUsed = (user.creditsUsed || 0) + creditCost;

        await docClient.send(new UpdateCommand({
          TableName: TABLES.USERS,
          Key: { userId },
          UpdateExpression: "SET creditsRemaining = :rem, creditsUsed = :used, requestsCount = if_not_exists(requestsCount, :zero) + :one, lastActiveAt = :now",
          ExpressionAttributeValues: {
            ":rem": newCreditsRemaining,
            ":used": newCreditsUsed,
            ":one": 1,
            ":zero": 0,
            ":now": new Date().toISOString()
          }
        }));

      } catch (creditErr) {
        console.error("Credit check/deduction error:", creditErr);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Failed to process credits. Please try again." })
        };
      }
    }

    // Invoke Bedrock
    const result = await invokeBedrock({ mode, prompt, codeContext, activeFile, modelId });

    // Save session message to DynamoDB
    try {
      await docClient.send(new PutCommand({
        TableName: TABLES.CHATS,
        Item: {
          chatId: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sessionId,
          userId: userId || "anonymous",
          mode,
          prompt,
          response: result.text,
          modelId: result.modelId || modelId,
          tokensUsed: result.usage?.outputTokens || 0,
          creditsCost: creditCost,
          timestamp: new Date().toISOString()
        }
      }));
    } catch (dbErr) {
      console.warn("Could not write chat to DynamoDB:", dbErr.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sessionId,
        content: result.text,
        tokensUsed: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
        modelId: result.modelId || modelId,
        creditsCost: creditCost
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
