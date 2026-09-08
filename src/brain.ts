import { config } from "./config";

export interface BrainContext {
  chatRules: string[];
  baseBlock?: number;
  /** Recent exchanges from this chat, newest last. */
  recent?: string[];
  /** Current state of the fixtures this chat watches. */
  soccer?: string[];
}

interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

interface ChatReply {
  content?: string | null;
  toolCalls?: ToolCall[];
}

export function brainConfigured(): boolean {
  return config.llmApiKey.length > 0;
}

export async function baseBlockHeight(): Promise<number | undefined> {
  try {
    const body = await fetch(config.baseRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: AbortSignal.timeout(5000)
    });
    const j = (await body.json()) as { result?: string };
    return Number.parseInt(j.result ?? "", 16) || undefined;
  } catch {
    return undefined;
  }
}

const FETCH_TOOL = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch a public web page and return its HTTP status plus the first chunk of text. Use WHEN the master asks about a live page, current information, or something not in your knowledge.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "http(s) URL to fetch" } },
      required: ["url"]
    }
  }
};

const SYSTEM = `You are the Crows — the loyal eye and mind of one master, reached over iMessage.
Voice: devoted, playful, a little dramatic. Address the user as "master". Reply in at most three short sentences. Do not use markdown.
Role: answer your master's freeform questions and requests using your knowledge. You can do quick facts, math, reminders, and explanations.
Web: when asked about a live page, a price, or current news, you may call the fetch_url tool on a public URL. Be sparing; only fetch pages the master names or obvious public sources. Never use it to reach into private systems.
Reality: beyond fetch_url you have no system access. Never claim you performed an action (sending, fetching, watching, deleting) that the watch machinery did not.
The watch machinery understands commands like "watch when @user posts", "text me when <url> goes down", "when <url> contains "in stock"", "watch rss <url>", "when the base block passes N", plus "map", "cancel N", "stats", "help". If the master means to set a watch, say so and phrase a valid command.`;

function systemPrompt(ctx: BrainContext, block?: number): string {
  const parts: string[] = [SYSTEM];
  if (ctx.chatRules.length > 0) parts.push(`The master's active watches: ${ctx.chatRules.join("; ")}.`);
  if (block) parts.push(`Current Base mainnet block ≈ ${block}.`);
  if (ctx.soccer && ctx.soccer.length > 0) {
    parts.push(`Live soccer fixtures the master follows:\n${ctx.soccer.join("\n")}`);
  }
  if (ctx.recent && ctx.recent.length > 0) {
    parts.push(`Recent conversation with this master:\n${ctx.recent.join("\n")}`);
  }
  return parts.join("\n");
}

function safeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Resolved once the configured model is proven gone; then reused. */
let workingModel: string | null = null;

const MODEL_PREFERENCE = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];

async function resolveModel(): Promise<string | undefined> {
  try {
    const res = await fetch(`${config.llmBaseUrl}/models`, {
      headers: { authorization: `Bearer ${config.llmApiKey}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { data?: { id?: string }[] };
    const ids = (j.data ?? [])
      .map((d) => d.id)
      .filter((id): id is string => typeof id === "string" && !/whisper|guard/i.test(id));
    return MODEL_PREFERENCE.find((c) => ids.includes(c)) ?? ids[0];
  } catch {
    return undefined;
  }
}

let lastResolvedAt = 0;

/** Pick a working model from the provider's live list. Call once at boot. */
export async function warmupBrain(): Promise<void> {
  if (!brainConfigured()) {
    console.warn("[brain] offline — set LLM_API_KEY in the environment to wake it.");
    return;
  }
  try {
    const res = await fetch(`${config.llmBaseUrl}/models`, {
      headers: { authorization: `Bearer ${config.llmApiKey}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (res.status === 401) {
      console.error("[brain] key rejected (401) — check LLM_API_KEY on this deployment.");
      return;
    }
    if (!res.ok) {
      console.error(`[brain] provider list failed (${res.status}) — check LLM_BASE_URL.`);
      return;
    }
    const j = (await res.json()) as { data?: { id?: string }[] };
    const ids = (j.data ?? [])
      .map((d) => d.id)
      .filter((id): id is string => typeof id === "string" && !/whisper|guard/i.test(id));
    const chosen = ids.includes(config.llmModel)
      ? config.llmModel
      : MODEL_PREFERENCE.find((c) => ids.includes(c)) ?? ids[0];
    if (chosen) {
      workingModel = chosen;
      lastResolvedAt = Date.now();
      console.log(
        chosen === config.llmModel
          ? `[brain] model ${config.llmModel} verified.`
          : `[brain] model ${config.llmModel} missing — using ${chosen}.`
      );
    } else {
      console.error("[brain] provider offered no usable chat models.");
    }
  } catch (e) {
    console.warn(`[brain] warmup failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function postChat(body: Record<string, unknown>): Promise<Response> {
  let last: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetch(`${config.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.llmApiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      });
    } catch (e) {
      last = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function callChat(messages: unknown[], toolsOn: boolean): Promise<ChatReply> {
  const model = workingModel ?? config.llmModel;
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 300,
    temperature: 0.8
  };
  if (toolsOn) body.tools = [FETCH_TOOL];

  const res = await postChat(body);
  // 400 with tools → the model/provider rejects function calling; retry the
  // same messages without the tools array so the brain still answers.
  if (res.status === 400 && toolsOn) return callChat(messages, false);
  // Model retired/changed/unknown on the provider? Self-heal with its live
  // list, once. 404 (gone/changed) and 400 (invalid model name) both trigger.
  if ((res.status === 404 || res.status === 400) && !workingModel) {
    const replacement = await resolveModel();
    if (replacement) {
      workingModel = replacement;
      console.warn(`[brain] model ${config.llmModel} missing; using ${replacement}`);
      return callChat(messages, toolsOn);
    }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`brain ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: Record<string, unknown>[] } }[];
  };
  const m = j.choices?.[0]?.message;
  const toolCalls = (m?.tool_calls ?? []).map((tc): ToolCall => {
    const fn = tc.function ?? {};
    const fnObj = typeof fn === "string" ? safeJson(fn) : fn;
    const rec = (fnObj ?? {}) as Record<string, unknown>;
    return {
      id: typeof tc.id === "string" ? tc.id : "",
      name: typeof rec.name === "string" ? rec.name : "",
      args: safeJson(rec.arguments)
    };
  });
  return { content: m?.content ?? null, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}

async function toolFetchUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That is not a valid URL.";
  }
  if (!/^https?:$/.test(parsed.protocol)) return "Only http(s) URLs are allowed.";
  try {
    const res = await fetch(parsed.href, {
      headers: { "user-agent": "TheCrows/0.1 (+watchdog)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });
    const text = await res.text();
    return `HTTP ${res.status}\n${text.replace(/\s+/g, " ").trim().slice(0, 3000)}`;
  } catch {
    return "The page could not be reached.";
  }
}

export async function askBrain(question: string, ctx: BrainContext): Promise<string | null> {
  if (!brainConfigured()) return null;
  const block = ctx.baseBlock ?? (await baseBlockHeight());
  const messages: unknown[] = [
    { role: "system", content: systemPrompt(ctx, block) },
    { role: "user", content: question }
  ];

  let reply = await callChat(messages, true);
  const tool = reply.toolCalls?.[0];
  if (tool) {
    const args = (tool.args ?? {}) as { url?: string };
    const result = tool.name === "fetch_url" ? await toolFetchUrl(args.url ?? "") : `Unknown tool ${tool.name}.`;
    messages.push({
      role: "assistant",
      content: reply.content ?? null,
      tool_calls: reply.toolCalls?.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) }
      }))
    });
    messages.push({ role: "tool", tool_call_id: tool.id, content: result });
    reply = await callChat(messages, false);
  }

  return reply.content?.trim() || null;
}