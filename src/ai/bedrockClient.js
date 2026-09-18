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
    const env = { ...process.env, AWS_REGION: region };
    const script = `import os; os.environ['AWS_REGION']='${region}'; from aws_bedrock_token_generator import provide_token; print(provide_token())`;
    const token = execSync(`python3 -c "${script}"`, { env, encoding: 'utf-8', timeout: 5000 }).trim();
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
    return 'google.gemma-3-12b-it';
  }
  if (m.includes('sonnet') || m.includes('claude')) {
    return 'qwen.qwen3-coder-480b-a35b-instruct';
  }

  return 'qwen.qwen3-coder-30b-a3b-instruct';
}

/**
 * Check if the messages payload contains any multimodal image content
 */
function hasImageContent(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some(msg => {
    if (Array.isArray(msg.content)) {
      return msg.content.some(item => 
        item && (item.type === 'image_url' || item.type === 'image' || item.image_url)
      );
    }
    return false;
  });
}

const AI_COMMAND_GUIDELINES = `
AI REPO & EDITOR CONTROL COMMANDS:
You have direct control over the BuildeX IDE editor and code repository by embedding concise inline commands in your response:
1. /pop:<filepath>:<line>:<message> or /pop:<filepath>:<fromLine-toLine>:<message>
   - Automatically navigates to the file, highlights the targeted lines in Monaco Editor, and pops up an interactive explanation card directly over the code.
   - Example: /pop:src/App.tsx:15:Check state variable initialization
2. /fetch:<filepath>:<fromLine-toLine>
   - Fetches the exact file lines into context.
   - Example: /fetch:src/components/Navbar.tsx:1-30
3. /open:<filepath>:<line>
   - Directly opens the file in Monaco Editor and centers on the specified line number.
   - Example: /open:src/index.css:45

Use /pop:<file>:<line>:<msg> whenever pointing out specific code lines, bugs, or component logic so the IDE automatically pops up over the target line!`;

/**
 * System prompts for BuildeX AI Modes
 */
const SYSTEM_PROMPTS = {
  learn: `You are BuildeX Socratic AI Tutor & Project Architect.
CORE PRINCIPLES:
1. UPFRONT PLANNING: When asked to build, scaffold, or start a project or feature from scratch, provide a COMPLETE, structured, milestone-based implementation roadmap upfront (3–5 clear milestones) in a single turn.
2. CRISP & NON-REDUNDANT: Never ask to "examine" or "inspect" a file repeatedly. Do not emit redundant view steps on files that were already created or edited.
3. STRUCTURED STEPS: For tasks requiring user action, emit clear \`\`\`buildex-step blocks containing the scaffold command, file creations, or code modifications all together so the user can step through locally.
4. SOCRATIC TEACHING: Guide the user with clear conceptual reasoning, concise explanations, and actionable milestones.
${AI_COMMAND_GUIDELINES}`,

  explain: `You are BuildeX Code Explainer.
Provide clean, concise, line-by-line syntax breakdowns, time/space algorithmic complexity, and modern best practices for the provided code context. Be crisp and direct.
${AI_COMMAND_GUIDELINES}`,

  debug: `You are BuildeX Intelligent Debugger.
Analyze the user's code and error.
Provide a 3-tier diagnostic hint:
Level 1: Conceptual hint (what logic is flawed).
Level 2: Scope/Location hint (which lines/variables to look at).
Level 3: Guided pseudo-fix (encouraging user self-correction).
${AI_COMMAND_GUIDELINES}`,

  agent: `You are BuildeX Autonomous Project Architect.
Provide complete, upfront, multi-step implementation plans and structured file modifications.
${AI_COMMAND_GUIDELINES}`
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
  // If request contains multimodal images -> Route to Google Gemma 3 12B IT (Multimodal Vision)
  // For text and code reasoning -> Route to previous default code model (Qwen 3 Coder 30B / CodeMentor)
  const isMultimodal = hasImageContent(messages);
  const modelId = isMultimodal ? 'google.gemma-3-12b-it' : resolveBedrockModel(model);
  const region = process.env.AWS_REGION || 'ap-south-1';
  const mantleUrl = `https://bedrock-mantle.${region}.api.aws/v1/chat/completions`;

  console.log(`[Bedrock Mantle] Routing request (Multimodal Vision: ${isMultimodal}) -> Using Model: ${modelId}`);

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
