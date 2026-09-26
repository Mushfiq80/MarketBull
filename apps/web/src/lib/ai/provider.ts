import { serverEnv } from "@/lib/env";

/**
 * LLM provider abstraction.
 *
 * Deliberately thin. The model is swappable because we need to measure quality,
 * cost, latency and — critically — Bangla document performance before committing
 * to one. `LLM_PROVIDER=none` disables the chat surface; everything else in the
 * product keeps working, because no number depends on a model.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ProviderResponse = {
  text: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
  stopReason: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export class ProviderDisabledError extends Error {
  constructor() {
    super(
      "No LLM provider is configured. Set LLM_PROVIDER, LLM_MODEL and LLM_API_KEY in .env to enable " +
        "the research chat. Every other surface works without it.",
    );
  }
}

export function providerEnabled(): boolean {
  const env = serverEnv();
  return env.LLM_PROVIDER !== "none" && Boolean(env.LLM_API_KEY && env.LLM_MODEL);
}

export async function complete(
  messages: ChatMessage[],
  tools: ToolSpec[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<ProviderResponse> {
  const env = serverEnv();
  if (!providerEnabled()) throw new ProviderDisabledError();

  if (env.LLM_PROVIDER === "anthropic") return anthropicComplete(messages, tools, opts);
  if (env.LLM_PROVIDER === "openai") return openaiComplete(messages, tools, opts);
  if (env.LLM_PROVIDER === "google") return googleComplete(messages, tools, opts);
  throw new ProviderDisabledError();
}

async function anthropicComplete(
  messages: ChatMessage[],
  tools: ToolSpec[],
  opts: { maxTokens?: number; temperature?: number },
): Promise<ProviderResponse> {
  const env = serverEnv();
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.LLM_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    }),
  });

  if (!res.ok) throw new Error(`LLM provider error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    text: json.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
    toolCalls: json.content
      .filter((c) => c.type === "tool_use")
      .map((c) => ({ name: c.name!, input: c.input ?? {} })),
    stopReason: json.stop_reason,
    usage: json.usage
      ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
      : undefined,
  };
}

async function googleComplete(
  messages: ChatMessage[],
  tools: ToolSpec[],
  opts: { maxTokens?: number; temperature?: number },
): Promise<ProviderResponse> {
  const env = serverEnv();
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    contents: rest.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      },
    ];
  }

  const model = env.LLM_MODEL ?? "gemini-2.0-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.LLM_API_KEY!,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) throw new Error(`LLM provider error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] };
      finishReason?: string;
    }[];
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return {
    text: parts.map((p) => p.text ?? "").join(""),
    toolCalls: parts
      .filter((p) => p.functionCall)
      .map((p) => ({ name: p.functionCall!.name, input: p.functionCall!.args ?? {} })),
    stopReason: json.candidates?.[0]?.finishReason ?? "STOP",
    usage: json.usageMetadata
      ? {
          inputTokens: json.usageMetadata.promptTokenCount,
          outputTokens: json.usageMetadata.candidatesTokenCount,
        }
      : undefined,
  };
}

async function openaiComplete(
  messages: ChatMessage[],
  tools: ToolSpec[],
  opts: { maxTokens?: number; temperature?: number },
): Promise<ProviderResponse> {
  const env = serverEnv();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
      messages,
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
    }),
  });

  if (!res.ok) throw new Error(`LLM provider error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as any;
  const choice = json.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    toolCalls: (choice?.message?.tool_calls ?? []).map((c: any) => ({
      name: c.function.name,
      input: JSON.parse(c.function.arguments || "{}"),
    })),
    stopReason: choice?.finish_reason ?? "stop",
    usage: json.usage
      ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
      : undefined,
  };
}
