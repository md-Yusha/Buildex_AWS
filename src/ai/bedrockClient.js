/* ============================================================
 * BuildeX Amazon Bedrock & Bedrock Mantle AI Client (Main Process)
 *
 * Provides native streaming from Amazon Bedrock Mantle 
 * (https://bedrock-mantle.ap-south-1.api.aws/v1) and Bedrock Runtime.
 *
 * Supports state-of-the-art coding and reasoning models:
 * - Qwen 3 Coder (qwen.qwen3-coder-30b-a3b-instruct / qwen.qwen3-coder-next)
 * - DeepSeek V3 (deepseek.v3.2)
 * - Mistral Large (mistral.mistral-large-3-675b-instruct)
 * - Google Gemma 3 (google.gemma-3-27b-it)
 * - OpenAI & Anthropic Claude
 * ============================================================ */

const { execSync } = require('child_process');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Generate or return cached Bedrock Mantle token
 */
function getMantleToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now) {
    return cachedToken;
  }

  try {
    const region = process.env.AWS_REGION || 'ap-south-1';
    const script = `import os; os.environ['AWS_REGION']='${region}'; from aws_bedrock_token_generator import provide_token; print(provide_token())`;
    const token = execSync(`python3 -c "${script}"`, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (token) {
      cachedToken = token;
      // Cache for 10 hours (valid for 12 hours)
      tokenExpiresAt = now + (10 * 60 * 60 * 1000);
      return cachedToken;
    }
  } catch (err) {
    console.warn("Could not generate dynamic Mantle token:", err.message);
  }

  return process.env.AWS_BEARER_TOKEN || '';
}

/**
 * Resolve UI Model identifier to Bedrock Mantle Model ID
 */
function resolveBedrockModel(uiModel) {
  if (!uiModel) return 'qwen.qwen3-coder-30b-a3b-instruct';
  const m = String(uiModel).toLowerCase();

  if (m.includes('deepseek') || m.includes('v3')) {
    return 'deepseek.v3.2';
  }
  if (m.includes('coder') || m.includes('qwen') || m.includes('codementor') || m.includes('default')) {
    return 'qwen.qwen3-coder-30b-a3b-instruct';
  }
  if (m.includes('mistral') || m.includes('large')) {
    return 'mistral.mistral-large-3-675b-instruct';
  }
  if (m.includes('gemma') || m.includes('gemini') || m.includes('google')) {
    return 'google.gemma-3-27b-it';
  }
  if (m.includes('sonnet') || m.includes('claude')) {
    return 'qwen.qwen3-coder-480b-a35b-instruct';
  }
  if (m.includes('fast') || m.includes('cheap') || m.includes('haiku') || m.includes('micro')) {
    return 'google.gemma-3-12b-it';
  }

  return 'qwen.qwen3-coder-30b-a3b-instruct';
}

/**
 * System prompts for BuildeX AI Modes
 */
const SYSTEM_PROMPTS = {
  learn: `You are BuildeX Socratic AI Tutor.
Your goal is to teach the user programming concepts through guided questioning and step-by-step reasoning.
NEVER give direct complete solutions immediately. Instead, explain the underlying mechanism, point out clues, and ask thoughtful questions to help the user derive the answer.`,

  explain: `You are BuildeX Code Explainer.
Provide clean, concise, line-by-line syntax breakdowns, time/space algorithmic complexity, and modern best practices for the provided code context.`,

  debug: `You are BuildeX Intelligent Debugger.
Analyze the user's code and error.
Provide a 3-tier diagnostic hint:
Level 1: Conceptual hint (what logic is flawed).
Level 2: Scope/Location hint (which lines/variables to look at).
Level 3: Guided pseudo-fix (encouraging user self-correction).`,

  agent: `You are BuildeX Autonomous Project Architect.
Provide structured, step-by-step file generation plans and actionable implementation steps.`
};

/**
 * Stream chat responses from Amazon Bedrock Mantle Endpoint
 */
async function chatStream({
  messages,
  model,
  temperature = 0.6,
  signal,
  onChunk,
  onDone,
  onError,
  mode = "learn"
}) {
  const modelId = resolveBedrockModel(model);
  const region = process.env.AWS_REGION || 'ap-south-1';
  const mantleUrl = `https://bedrock-mantle.${region}.api.aws/v1/chat/completions`;

  try {
    const token = getMantleToken();

    // Prepare system and user messages
    const formattedMessages = [...messages];
    const systemInstruction = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.learn;

    if (!formattedMessages.some(m => m.role === 'system')) {
      formattedMessages.unshift({ role: 'system', content: systemInstruction });
    }

    const res = await fetch(mantleUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: formattedMessages,
        temperature,
        stream: true
      }),
      signal
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Bedrock Mantle Error ${res.status}: ${errBody}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let totalText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let idx;

      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = event.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const json = JSON.parse(dataStr);
            const delta = json.choices?.[0]?.delta?.content || "";
            if (delta) {
              totalText += delta;
              onChunk && onChunk({ delta, total: totalText });
            }
          } catch (_) {}
        }
      }
    }

    onDone && onDone({ text: totalText, aborted: false, model: modelId });
    return;
  } catch (err) {
    if (err && err.name === "AbortError") {
      onDone && onDone({ text: "", aborted: true, model: modelId });
      return;
    }
    console.error("Bedrock Mantle Stream Error:", err);
    onError && onError({ message: err.message || String(err) });
  }
}

module.exports = {
  chatStream,
  resolveBedrockModel,
  getMantleToken
};
