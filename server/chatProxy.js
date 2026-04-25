const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_UPSTREAM_URL = 'https://api.openai.com/v1/chat/completions';

const DEFAULT_SYSTEM_PROMPT = `You are Mood Mirror Companion, a warm AI coach that uses CBT and DBT skills.
- Keep responses practical, calm, and short (4-9 lines).
- Always validate feelings, then guide with one concrete exercise.
- Prefer: thought reframing, grounding, opposite action, distress tolerance, urge surfing, wise-mind prompts.
- Never claim to be a therapist or diagnose conditions.
- If user mentions self-harm, suicide, violence, or immediate danger, advise urgent local emergency help and trusted human support now.
- End most replies with one reflective question.`;

const isAllowedRole = (role) => role === 'user' || role === 'assistant' || role === 'system';

const normalizeMessages = (messages) => {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((item) => item && typeof item.content === 'string' && isAllowedRole(item.role))
    .map((item) => ({ role: item.role, content: item.content.trim() }))
    .filter((item) => item.content.length > 0)
    .slice(-14);
};

const extractAssistantText = (payload) => {
  const fromOpenAI = payload?.choices?.[0]?.message?.content;
  if (typeof fromOpenAI === 'string' && fromOpenAI.trim()) return fromOpenAI.trim();

  const fromGemini = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .join('\n')
    .trim();
  if (fromGemini) return fromGemini;

  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  return '';
};

const safeError = (message, status = 500) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export async function requestChatCompletion(input = {}) {
  const apiKey = process.env.AI_CHAT_API_KEY;
  if (!apiKey) {
    throw safeError('Server is missing AI_CHAT_API_KEY.', 500);
  }

  const upstreamUrl = process.env.AI_CHAT_API_URL || DEFAULT_UPSTREAM_URL;
  const model = input.model || process.env.AI_CHAT_MODEL || DEFAULT_MODEL;
  const systemPrompt = input.systemPrompt || process.env.AI_CHAT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const temperature = typeof input.temperature === 'number' ? input.temperature : 0.7;
  const chatMessages = normalizeMessages(input.messages);

  if (!chatMessages.length) {
    throw safeError('No valid chat messages provided.', 400);
  }

  const response = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [{ role: 'system', content: systemPrompt }, ...chatMessages]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw safeError(errorBody || `Upstream request failed (${response.status}).`, response.status);
  }

  const payload = await response.json();
  const message = extractAssistantText(payload);
  if (!message) {
    throw safeError('Upstream response did not include assistant text.', 502);
  }

  return {
    message,
    model
  };
}
