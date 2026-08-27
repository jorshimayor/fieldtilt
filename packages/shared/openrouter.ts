import OpenAI from "openai";
import { env } from "./env";

type Model = { id: string; maxOutputTokens: number; priceRank: number };

export const models: Model[] = [
  // Haiku 4.5 first: best JSON/tool-call discipline per dollar for the
  // agent's plan/design nodes. Chain degrades by price, ending free.
  { id: "anthropic/claude-haiku-4-5", maxOutputTokens: 1200, priceRank: 1 },
  { id: "x-ai/grok-4.3", maxOutputTokens: 1200, priceRank: 2 },
  { id: "deepseek/deepseek-chat", maxOutputTokens: 1200, priceRank: 3 },
  { id: "meta-llama/llama-3.3-70b-instruct:free", maxOutputTokens: 1200, priceRank: 4 }
];

export type ChatInput = { messages: { role: string; content: string }[] };
export type ChatOutput = { id: string; model: string; content: string };

// Lazy client: only constructed on first use so modules that import this file
// (e.g. via observability) don't force an env check at module load.
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: env.OPENROUTER_API_KEY });
  return _client;
}

/** Cost lever: pin any OpenRouter model (e.g. a :free variant) via env. */
function pickModel(): Model {
  const override = (globalThis as any).process?.env?.OPENROUTER_MODEL;
  if (override) return { id: override, maxOutputTokens: 1200, priceRank: 0 };
  return models[0];
}

export async function routeAndChat(input: ChatInput): Promise<ChatOutput> {
  const model = pickModel();
  const res = await getClient().chat.completions.create({ model: model.id, messages: input.messages as OpenAI.ChatCompletionMessageParam[], max_tokens: model.maxOutputTokens });
  const content = res.choices?.[0]?.message?.content || "";
  return { id: res.id || "", model: model.id, content };
}

/**
 * One agent step with function-calling. Returns the raw assistant message —
 * the caller inspects `message.tool_calls`, executes them, appends `tool`
 * results, and calls again (see api/chat.ts for the loop).
 */
export async function chatWithTools(input: {
  messages: any[];
  tools: any[];
}): Promise<{ message: any; model: string }> {
  const model = pickModel();
  const res = await getClient().chat.completions.create({
    model: model.id,
    messages: input.messages as OpenAI.ChatCompletionMessageParam[],
    tools: input.tools as OpenAI.ChatCompletionTool[],
    max_tokens: model.maxOutputTokens,
  });
  return { message: res.choices?.[0]?.message ?? null, model: model.id };
}

export async function routeAndStream(input: ChatInput): Promise<{ stream: ReadableStream<Uint8Array>; usage: Promise<number> }> {
  const model = pickModel();
  const enc = new TextEncoder();
  const res = await getClient().chat.completions.create({ model: model.id, messages: input.messages as OpenAI.ChatCompletionMessageParam[], max_tokens: model.maxOutputTokens, stream: true });
  const it = res as any;
  let totalTokens = 0;
  const usagePromise = (async () => totalTokens)();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const ev of it) {
        const delta = ev?.choices?.[0]?.delta?.content || ev?.choices?.[0]?.message?.content || "";
        if (ev?.usage?.total_tokens) totalTokens = ev.usage.total_tokens;
        if (delta) controller.enqueue(enc.encode(delta));
      }
      controller.close();
    }
  });
  return { stream, usage: usagePromise };
}

export async function generateImage(input: { prompt: string; size?: string; modelId?: string }): Promise<{ url: string; model: string }> {
  const model = input.modelId || "black-forest-labs/flux-pro";
  const size = input.size || "1024x1024";
  const res = await (getClient() as any).images.generate({ model, prompt: input.prompt, size });
  const first = res?.data?.[0] || {};
  const url = first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : "");
  return { url, model };
}
