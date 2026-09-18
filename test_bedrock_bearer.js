// ==========================================
// 1. FILL IN YOUR AWS BEARER TOKEN & REGION
// ==========================================
const AWS_BEARER_TOKEN = "ABSKTWFudGxlQXBpS2V5LTJ1N2pkdmFxLWF0LTA1MjQ3Nzg5NTAwMTowdk1tejlPWC9menM0MkF1TndHSUxZVlBUa3ZIVmZpWUlwNllWNVQvbitoUXZIVWFiUHc2d3lIV1RBQT0=";
const AWS_REGION = "ap-south-1"; // e.g. "us-east-1" or "us-west-2"

// Model ID (Cheapest model with minimal tokens)
const MODEL_ID = "amazon.nova-micro-v1:0";
// Alternative: "anthropic.claude-3-haiku-20240307-v1:0"

// ========================================== 
// 2. SEND DIRECT HTTP REQUEST WITH BEARER TOKEN
// ==========================================
async function testBedrockWithBearerToken() {
  console.log("Testing Amazon Bedrock with Bearer Token...");

  const endpoint = `https://bedrock-runtime.${AWS_REGION}.amazonaws.com/model/${encodeURIComponent(MODEL_ID)}/converse`;

  const payload = {
    messages: [
      {
        role: "user",
        content: [{ text: "Say 'Hello' in 1 word." }]
      }
    ],
    inferenceConfig: {
      maxTokens: 5,
      temperature: 0.1
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AWS_BEARER_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("\n❌ Request failed with status:", response.status);
      console.error(JSON.stringify(data, null, 2));
      return;
    }

    const outputText = data.output?.message?.content?.[0]?.text;
    console.log("\n✅ Success! Response from Bedrock:");
    console.log("--------------------------------");
    console.log(outputText);
    console.log("--------------------------------");
    console.log(`Tokens used - Input: ${data.usage?.inputTokens}, Output: ${data.usage?.outputTokens}`);
  } catch (error) {
    console.error("\n❌ Error connecting to Bedrock:", error.message || error);
  }
}

testBedrockWithBearerToken();
