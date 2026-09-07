import { config } from "./config";

export interface BrainContext {
  chatRules: string[];
  baseBlock?: number;
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

const SYSTEM = `You are the Crows — the loyal eye and mind of one master, reached over iMessage.
Voice: devoted, playful, a little dramatic. Address the user as "master". Reply in at most three short sentences. Do not use markdown.
Role: answer your master's freeform questions and requests using your own knowledge. You can do quick facts, math, reminders, and explanations.
Reality: you have no web access and no system access. Never claim you performed an action (sending, fetching, watching) — that is done by separate machinery.
The watch machinery understands commands like "watch when @user posts", "text me when <url> goes down", "when <url> contains "in stock"", "watch rss <url>", "when the base block passes N", plus "map", "cancel N", "stats", "help". If the master means to set a watch, say so and phrase a valid command.`;

function currentBlockLine(block?: number): string {
  return block ? `Current Base mainnet block ≈ ${block}.` : "";
}

export async function askBrain(question: string, ctx: BrainContext): Promise<string | null> {
  if (!brainConfigured()) return null;
  const context: string[] = [SYSTEM];
  if (ctx.chatRules.length > 0) {
    context.push(`The master's active watches: ${ctx.chatRules.join("; ")}.`);
  }
  const block = ctx.baseBlock ?? (await baseBlockHeight());
  context.push(currentBlockLine(block));

  const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.llmApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        { role: "system", content: context.join("\n") },
        { role: "user", content: question }
      ],
      max_tokens: 200,
      temperature: 0.8
    }),
    signal: AbortSignal.timeout(25_000)
  });
  if (!res.ok) throw new Error(`brain ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content?.trim() ?? null;
}