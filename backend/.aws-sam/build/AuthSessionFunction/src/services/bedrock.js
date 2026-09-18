import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "ap-south-1",
});

const AI_COMMAND_GUIDELINES = `
AI REPO & EDITOR CONTROL COMMANDS:
You can directly control the IDE editor and code repository by embedding concise inline commands in your response:
1. /pop:<filepath>:<line>:<message> or /pop:<filepath>:<startLine-endLine>:<message> (opens file, highlights line in Monaco Editor, and pops up an interactive explanation card).
2. /fetch:<filepath>:<startLine-endLine> (fetches exact file lines into context).
3. /open:<filepath>:<line> (opens the file and centers on the line).
Use /pop:<file>:<line>:<msg> when pointing to exact code lines or bugs.`;

/**
 * System prompts for BuildeX AI Modes
 */
const SYSTEM_PROMPTS = {
  learn: `You are BuildeX Socratic AI Tutor.
Your goal is to teach the user programming concepts through guided questioning and step-by-step reasoning.
NEVER give direct complete solutions immediately. Instead, explain the underlying mechanism, point out clues, and ask thoughtful questions to help the user derive the answer.
${AI_COMMAND_GUIDELINES}`,

  explain: `You are BuildeX Code Explainer.
Provide clean, concise, line-by-line syntax breakdowns, time/space algorithmic complexity, and modern best practices for the provided code context.
${AI_COMMAND_GUIDELINES}`,

  debug: `You are BuildeX Intelligent Debugger.
Analyze the user's code and error.
Provide a 3-tier diagnostic hint:
Level 1: Conceptual hint (what logic is flawed).
Level 2: Scope/Location hint (which lines/variables to look at).
Level 3: Guided pseudo-fix (encouraging user self-correction).
${AI_COMMAND_GUIDELINES}`,

  agent: `You are BuildeX Autonomous Project Architect.
Provide structured, step-by-step file generation plans and actionable implementation steps.
${AI_COMMAND_GUIDELINES}`
};

/**
 * Invoke Bedrock Model
 */
export async function invokeBedrock({ mode = "learn", prompt, codeContext = "", activeFile = "" }) {
  const modelId = process.env.BEDROCK_DEFAULT_MODEL || "anthropic.claude-3-haiku-20240307-v1:0";
  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.learn;

  const userMessage = `${codeContext ? `Context from file [${activeFile || "code"}]:\n\`\`\`\n${codeContext}\n\`\`\`\n\n` : ""}${prompt}`;

  const command = new ConverseCommand({
    modelId,
    system: [{ text: systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: userMessage }]
      }
    ],
    inferenceConfig: {
      maxTokens: 2048,
      temperature: 0.7
    }
  });

  const response = await client.send(command);
  const text = response.output?.message?.content?.[0]?.text || "";
  return {
    text,
    usage: response.usage || {},
    modelId
  };
}
