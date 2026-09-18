import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

// ==========================================
// 1. FILL IN YOUR AWS BEDROCK CREDENTIALS
// ==========================================
const AWS_REGION = "us-east-1"; // e.g. "us-east-1" or "us-west-2"
const AWS_ACCESS_KEY_ID = "AKIAQYN7NEFMSJQFRY2O";
const AWS_SECRET_ACCESS_KEY = "2WL2XGVIUxZkkqrSIn3kkGWvDoDDXm7Spcm6nZXe";
const AWS_SESSION_TOKEN = ""; // Optional: Leave empty if you don't use temporary session tokens

// Cheap & fast model ID options:
// - "amazon.nova-micro-v1:0" (cheapest Amazon model)
// - "anthropic.claude-3-haiku-20240307-v1:0" (very low cost Claude)
// - "amazon.titan-text-express-v1"
const MODEL_ID = "amazon.nova-micro-v1:0";

// ==========================================
// 2. INITIALIZE CLIENT
// ==========================================
const clientConfig = {
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    ...(AWS_SESSION_TOKEN ? { sessionToken: AWS_SESSION_TOKEN } : {}),
  },
};

const client = new BedrockRuntimeClient(clientConfig);

async function testBedrock() {
  console.log("Testing Amazon Bedrock connection...");

  // Minimal prompt and strictly 5 max tokens to minimize credit usage
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [
      {
        role: "user",
        content: [{ text: "Say 'Hello' in 1 word." }],
      },
    ],
    inferenceConfig: {
      maxTokens: 5,
      temperature: 0.1,
    },
  });

  try {
    const response = await client.send(command);
    const outputText = response.output?.message?.content?.[0]?.text;
    console.log("\n✅ Success! Response from Bedrock:");
    console.log("--------------------------------");
    console.log(outputText);
    console.log("--------------------------------");
    console.log(`Tokens used - Input: ${response.usage?.inputTokens}, Output: ${response.usage?.outputTokens}`);
  } catch (error) {
    console.error("\n❌ Error connecting to Amazon Bedrock:", error.message || error);
  }
}

testBedrock();
