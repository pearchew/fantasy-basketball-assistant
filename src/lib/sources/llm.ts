// Any OpenAI-compatible chat endpoint. Both free-tier candidates speak it:
//   Gemini: LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
//   Groq:   LLM_BASE_URL=https://api.groq.com/openai/v1
// Swapping provider is an env change, not a code change.
import { fetchWithTimeout } from "./http";

export type LlmConfig = { baseUrl: string; apiKey: string; model: string };

/** Free-tier replies usually take about a second but can take 30-45 s when the API is busy. */
export const LLM_TIMEOUT_MS = 50_000;

export function llmConfigFromEnv(): LlmConfig | null {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = process.env;
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) return null;
  return { baseUrl: LLM_BASE_URL.replace(/\/$/, ""), apiKey: LLM_API_KEY, model: LLM_MODEL };
}

type ChatResponse = { choices: { message: { content: string } }[] };

/** One chat call that must return a JSON object. */
export async function chatJson<T>(config: LlmConfig, system: string, user: string): Promise<T> {
  const res = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    timeoutMs: LLM_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} from LLM: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as ChatResponse;
  return JSON.parse(body.choices[0].message.content) as T;
}
