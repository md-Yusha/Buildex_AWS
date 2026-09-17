/* ============================================================
 * Pollinations AI client (main process)
 *
 * Thin wrapper around Pollinations' OpenAI-compatible
 *   POST {baseUrl}/v1/chat/completions
 * endpoint with Server-Sent Events (SSE) streaming.
 *
 * Public API:
 *   chatStream({ messages, model, temperature, signal,
 *                onChunk, onDone, onError, apiKey, baseUrl })
 *
 * Designed to plug into Electron IPC: the caller in main.js
 * forwards onChunk/onDone/onError back to the renderer.
 * ============================================================ */

async function chatStream({
  messages,
  model = "openai",
  temperature = 0.6,
  signal,
  onChunk,
  onDone,
  onError,
  apiKey,
  baseUrl = "https://gen.pollinations.ai",
  responseFormat,
}) {
  if (model === "default") model = "openai";
  baseUrl = "https://gen.pollinations.ai";
  let url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
  let isCustomAsk = false;

  // Detect custom CodeMentor /ask endpoint
  if (baseUrl.endsWith("/ask")) {
    url = baseUrl;
    isCustomAsk = true;
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  // Also pass ngrok-skip-browser-warning in case it hits an ngrok intercept page
  headers["ngrok-skip-browser-warning"] = "true";

  let payload;
  if (isCustomAsk) {
    const systemInstruction = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const history = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    payload = {
      instruction: systemInstruction || "You are an AI coding assistant.",
      input: history,
    };
  } else {
    payload = {
      model,
      messages,
      stream: true,
      temperature,
    };
    if (responseFormat) payload.response_format = responseFormat;
  }

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      onDone && onDone({ aborted: true });
      return;
    }
    onError &&
      onError({ message: err && err.message ? err.message : String(err) });
    return;
  }

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch (_) {}
    onError &&
      onError({
        message: `Pollinations error ${res.status}: ${body.slice(0, 400) || res.statusText}`,
        status: res.status,
      });
    return;
  }

  if (!res.body) {
    onError && onError({ message: "Pollinations returned no body." });
    return;
  }

  // TWO-STEP PIPELINE: Handle simple JSON responses for Custom Ask endpoints
  if (isCustomAsk) {
    try {
      const bodyText = await res.text();
      let answer = bodyText;
      try {
        const json = JSON.parse(bodyText);
        answer = json.output || json.response || json.answer || bodyText;
      } catch (_) {
        // If it's not JSON, assume the custom model returned a plain text string
      }

      // Step 2: Send the raw answer to Pollinations for formatting!
      const formatPayload = {
        model: "openai", // Default Pollinations model
        messages: [
          ...messages.filter((m) => m.role === "system"),
          {
            role: "user",
            content: `A custom AI generated the following technical response. Your task is strictly to FORMAT this response into proper \`\`\`buildex-step blocks according to your system instructions.
            
CRITICAL: You MUST map the AI's suggested code changes to the EXACT line numbers in the "Active file" (provided in your system context). 
- Use \`lineRanges\` with the correct \`from\` and \`to\` line numbers.
- Set \`kind\` to "remove" or "modify" so the IDE can highlight what is being deleted/changed.
- DO NOT just use \`insertionLocation: { afterLine: X }\` unless it is a pure addition. If code is being replaced or changed, you MUST use \`lineRanges\` to highlight the old code.
- DO NOT add conversational filler. Just output the formatted \`\`\`buildex-step blocks.

RAW RESPONSE TO FORMAT:
${answer}`,
          },
        ],
        stream: true,
        temperature: 0.1,
      };

      const formatHeaders = { "Content-Type": "application/json" };
      if (apiKey) formatHeaders["Authorization"] = `Bearer ${apiKey}`;

      const formatRes = await fetch(
        "https://gen.pollinations.ai/v1/chat/completions",
        {
          method: "POST",
          headers: formatHeaders,
          body: JSON.stringify(formatPayload),
          signal,
        },
      );

      if (!formatRes.ok) {
        let errBody = "";
        try {
          errBody = await formatRes.text();
        } catch (_) {}
        throw new Error(
          `Formatting failed (${formatRes.status}): ${errBody.slice(0, 200)}`,
        );
      }

      // Override res with the Pollinations stream so the existing parser handles it
      res = formatRes;
    } catch (e) {
      onError &&
        onError({ message: "Failed to process custom model response." });
      return;
    }
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let totalText = "";
  let aborted = false;

  try {
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
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            onDone && onDone({ text: totalText, aborted: false });
            return;
          }
          let json;
          try {
            json = JSON.parse(data);
          } catch (_) {
            continue;
          }
          // OpenAI-compatible delta
          const choice = json.choices && json.choices[0];
          if (!choice) continue;
          const delta =
            (choice.delta && choice.delta.content) || choice.text || "";
          if (delta) {
            totalText += delta;
            onChunk && onChunk({ delta, total: totalText });
          }
          if (choice.finish_reason) {
            onDone &&
              onDone({
                text: totalText,
                aborted: false,
                finishReason: choice.finish_reason,
              });
            return;
          }
        }
      }
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      aborted = true;
    } else {
      onError &&
        onError({ message: err && err.message ? err.message : String(err) });
      return;
    }
  }

  onDone && onDone({ text: totalText, aborted });
}

/* Map a UI-friendly model id to a Pollinations model id.
 * The UI advertises Claude / GPT / Gemini brands; internally we
 * route everything to Pollinations text models that match the
 * intended capability tier.
 */
function resolveModel(uiModel) {
  if (!uiModel) return "openai";
  const m = String(uiModel).toLowerCase();

  // Default IDE local brand → code-focused route
  if (m === "codementor" || m.includes("codementor")) return "openai";

  // Frontier reasoning
  if (
    m.includes("3.5-sonnet") ||
    m.includes("sonnet-3.5") ||
    m.includes("claude-3-5")
  )
    return "openai-large";
  if (m.includes("opus") || m.includes("gpt-5") || m === "gpt5")
    return "openai-large";
  if (m.includes("gpt-4o") && !m.includes("mini")) return "openai-large";

  // Balanced default
  if (m.includes("sonnet") || m.includes("gpt-4")) return "openai-large";
  if (
    m.includes("gpt-4-mini") ||
    m.includes("gpt-4o-mini") ||
    m.includes("mini")
  )
    return "openai";

  // Fast / cheap
  if (m.includes("haiku") || m.includes("fast")) return "openai-fast";

  // Gemini family
  if (m.includes("gemini") && m.includes("flash-lite"))
    return "gemini-flash-lite-3.1";
  if (m.includes("gemini") && m.includes("flash")) return "gemini-fast";
  if (m.includes("gemini")) return "gemini";

  // Coder
  if (m.includes("coder") || m.includes("openai")) return "openai";
  if (m.includes("mistral")) return "mistral";

  // Default
  return "openai";
}

module.exports = { chatStream, resolveModel };
