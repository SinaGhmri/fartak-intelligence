// AI provider abstraction — the ONLY file that talks to an LLM vendor.
// Swap providers by implementing LLMProvider and calling setLLMProvider().

export interface LLMProvider {
  /**
   * Send a prompt and (optionally) a JSON schema the reply must follow.
   * Returns a parsed object when a schema is given, otherwise a string.
   */
  complete(prompt: string, schema?: Record<string, unknown>): Promise<unknown>;
}

// OpenAI-compatible adapter. Works with OpenAI, OpenRouter, Groq, Together,
// Azure OpenAI gateways, vLLM, Ollama's OpenAI endpoint, etc. — anything
// speaking the /v1/chat/completions protocol.
export class OpenAICompatibleProvider implements LLMProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string
  ) {}

  async complete(prompt: string, schema?: Record<string, unknown>): Promise<unknown> {
    const system = schema
      ? `You are a precise assistant. Always respond with a single valid JSON object matching this structure:\n${JSON.stringify(
          schema
        )}`
      : "";
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM provider error (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return safeParse(data.choices?.[0]?.message?.content);
  }
}

// Tolerant JSON parsing: models occasionally wrap JSON in prose or fences.
export function safeParse(value: unknown): Record<string, unknown> | string {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return { reply: "" };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { reply: value };
  } catch {
    const match = value.match(/\{[\s\S]*\}/); // first {...} block
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { reply: value };
      } catch {
        /* fall through */
      }
    }
    return { reply: value };
  }
}

let provider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (!provider) {
    const apiKey = process.env.FARTAK_LLM_API_KEY;
    if (!apiKey) {
      throw new Error("FARTAK_LLM_API_KEY is not set — configure your AI provider.");
    }
    provider = new OpenAICompatibleProvider(
      process.env.FARTAK_LLM_BASE_URL || "https://api.openai.com/v1",
      apiKey,
      process.env.FARTAK_LLM_MODEL || "gpt-4o-mini"
    );
  }
  return provider;
}

// Register a custom provider (e.g. an Anthropic adapter) at startup.
export function setLLMProvider(p: LLMProvider) {
  provider = p;
}