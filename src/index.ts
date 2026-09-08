import { createInterface } from "node:readline";
import { Spectrum, attachment, type Space } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { config } from "./config";
import { parseWatch, type WatchRule } from "./rules";
import { check } from "./sources";
import { tick } from "./poller";
import { createStore, type WatchStore } from "./store";
import { DebugSender } from "./debug-sender";
import { askBrain, baseBlockHeight, warmupBrain } from "./brain";
import { findTeam, formOf, soccerContext, teamBrief, type FormRow, type FoundTeam } from "./soccer";
import { predictCard, type CardImage } from "./cards";
import { ChatMemory } from "./memory";
import {
  ackWatch,
  cancelMiss,
  cancelOk,
  help,
  mapEmpty,
  statsEmpty,
  statsIntro,
  welcome
} from "./persona";

let rules: WatchRule[] = [];
const chatters = new Map<string, ChatMemory>();

export interface CrowsReply {
  text: string;
  /** Ask the brain when true (message wasn't a command or valid watch). */
  brain?: boolean;
  /** Analyze a named matchup and give the crow's call on it. */
  predict?: { teamA: string; teamB: string };
}

export function handleMessage(text: string, chatId: string): CrowsReply {
  const t = text.trim();
  if (/^(hi|hello|hey|caw|crow)\b/i.test(t) && !/(watch|when)/i.test(t)) return { text: welcome() };
  if (/^stats\b/i.test(t)) return { text: statsOf() };
  if (/^map\b/i.test(t)) return { text: mapOf(chatId) };
  const cancel = t.match(/^cancel\s+(\d+|#?\w{1,8})/i);
  if (cancel) {
    const token = cancel[1]?.toLowerCase() ?? "";
    const mine = rules.filter((r) => r.chat === chatId);
    const idx = token.replace("#", "").toLowerCase();
    const n = Number.parseInt(idx, 10);
    const targetId = Number.isFinite(n) && n >= 1 ? mine[n - 1]?.id : undefined;
    const before = rules.length;
    rules = rules.filter((r) => {
      if (r.chat !== chatId) return true;
      if (targetId && r.id === targetId) return false;
      if (targetId === undefined && r.id.toLowerCase().startsWith(idx)) return false;
      return true;
    });
    return { text: before === rules.length ? cancelMiss(token) : cancelOk() };
  }
  if (/^(help|what can you do)\b/i.test(t)) return { text: help() };

  const predict = t.match(
    /^(?:predict|who\s+(?:will\s+)?wins?|opinion|who\s+do\s+you\s+like)[\s:,]+(\S.*?)\s+(?:vs\.?|v\.?|against)\s+(\S.*?)[\s.,]*$/i
  );
  if (predict) {
    const [teamA, teamB] = [predict[1]?.trim() ?? "", predict[2]?.trim() ?? ""];
    if (teamA && teamB) return { text: "", predict: { teamA, teamB } };
  }

  const parsed = parseWatch({ chat: chatId, text: t });
  if ("error" in parsed) return { text: "", brain: true };
  rules.push(parsed);
  return { text: ackWatch(parsed) };
}

export async function brainReply(text: string, chatId: string): Promise<string> {
  const mem = chatters.get(chatId) ?? new ChatMemory();
  mem.add("user", text);
  const list = rules.filter((r) => r.chat === chatId).map((r) => r.label);
  const block = await baseBlockHeight();
  let out: string;
  try {
    const answer = await askBrain(text, {
      chatRules: list,
      baseBlock: block,
      recent: mem.lines(),
      soccer: await soccerContext(rules.filter((r) => r.chat === chatId))
    });
    out =
      answer ??
      "My mind is veiled, master — no oracle is linked. Set LLM_API_KEY and I shall speak freely. " +
        brainDiag();
  } catch (e) {
    console.error("[brain] failed:", e instanceof Error ? e.message : e);
    out = `Fog has taken my mind for a moment, master. Try me again. ${brainDiag(
      e instanceof Error ? e.message : String(e)
    )}`;
  }
  mem.add("assistant", out);
  chatters.set(chatId, mem);
  return out;
}

function brainDiag(err?: string): string {
  const key = config.llmApiKey;
  const bits = [
    err ? `err=${err}` : "",
    `key=${key.length > 0 ? "set" : "empty"}`,
    `url=${config.llmBaseUrl}`,
    `model=${config.llmModel}`
  ];
  return `[diag ${bits.filter(Boolean).join(" ")}]`;
}

/** The crow's call on an upcoming fixture, grounded in real form + standings. */
export async function predictReply(
  teamA: string,
  teamB: string,
  chatId: string
): Promise<{ text: string; card?: CardImage }> {
  const [a, b] = [await findTeam(teamA), await findTeam(teamB)];
  if (a && b && a.match.id === b.match.id) {
    const briefA = await teamBrief(a);
    const briefB = await teamBrief(b);
    const prompt =
      `The fixture I must call: ${a.match.teams.map((t) => t.name).join(" vs ")} ` +
      `(currently ${a.match.state}).\nForm cards:\n- ${briefA}\n- ${briefB}\n` +
      `Give me your prediction in the crow voice, at most 3 short sentences: pick a winner or a draw, ` +
      `give a scoreline, one line of reasoning tied to the form above, and a confidence percentage.`;
    try {
      const answer = await askBrain(prompt, {
        chatRules: rules.filter((r) => r.chat === chatId).map((r) => r.label)
      });
      if (answer) return { text: answer, card: await callCard(a, b, answer) };
    } catch {
      /* fall through to the numbers-only verdict */
    }
    const fallback = `My eye is on ${a.match.teams.map((t) => t.name).join(" vs ")} — but my oracle is veiled, so I hold no call yet. Link an oracle (LLM_API_KEY) and I shall see the shape of the match.`;
    return { text: fallback, card: await callCard(a, b) };
  }
  try {
    const answer = await askBrain(
      `${teamA} vs ${teamB} — I don't see a live fixture today. Craft a short crow-quip admission and suggest checking the name or a nearer date.`,
      { chatRules: [], recent: [] }
    );
    return { text: answer ?? "No fixture for that today, master — mind the names." };
  } catch {
    return { text: "No fixture for that today, master — mind the names." };
  }
}

/** Predict card for a found fixture: rendered PNG with each side's last-5 form. */
async function callCard(a: FoundTeam, b: FoundTeam, answer?: string): Promise<CardImage | undefined> {
  if (!config.cards) return undefined;
  const [homeForm, awayForm] = await Promise.all([
    formOf(a.match.league, a.team.id),
    formOf(b.match.league, b.team.id)
  ]);
  return predictCard({
    home: a.team,
    away: b.team,
    homeForm,
    awayForm,
    state: a.match.state,
    predictedScore: scorelineOf(answer),
    confidence: answer ? confidenceOf(answer) : undefined,
    reasoning: answer
  });
}

/** Best-effort "2-1"-style scoreline extraction from the crow's prose. */
function scorelineOf(answer?: string): string | undefined {
  if (!answer) return undefined;
  const m = answer.match(/\b(\d)\s*[-–:]\s*(\d)\b/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}`;
}

/** Best-effort confidence percentage ("…75%…" → 0.75). */
function confidenceOf(answer: string): number | undefined {
  const m = answer.match(/(\d{1,3})\s*%/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n === 0 || n > 100) return undefined;
  return n / 100;
}

function mapOf(chatId: string): string {
  const mine = rules.filter((r) => r.chat === chatId);
  if (mine.length === 0) return mapEmpty();
  const lines = mine.map((r, i) => {
    const state = r.mode === "once" && r.fired ? " (done)" : "";
    return `${i + 1}. ${r.label}${state}`;
  });
  return ["Your watchlist, master:", ...lines].join("\n");
}

function statsOf(): string {
  if (rules.length === 0) return statsEmpty();
  const bySource = new Map<string, number>();
  for (const r of rules) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  const chats = new Set(rules.map((r) => r.chat)).size;
  const lines = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `  ${s}: ${n}`);
  return [statsIntro(rules.length, chats), ...lines].join("\n");
}

async function main() {
  if (config.dryRun || !config.projectSecret) {
    // No live connection: local stdin harness + debug replies.
    process.stdout.write("crows (dry-run) — type a watch, or 'map', or 'ctrl-c'.\n");
    const sender = new DebugSender();
    const store: WatchStore = createStore();
    const hooks = {
      send: async (chatId: string, text: string) => {
        await sender.send({ to: chatId, text });
        console.log(`[reply to ${chatId}] ${text}`);
      },
      sendCard: async (chatId: string, png: Buffer, name: string) => {
        sender.sendCard(png, name);
      }
    };
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const reply = handleMessage(line, "stdin");
      if (reply.predict) {
        const p = await predictReply(reply.predict.teamA, reply.predict.teamB, "stdin");
        console.log(`[predict] ${p.text}`);
        if (config.cards && p.card) {
          sender.sendCard(p.card.png, p.card.name);
          console.log(`[predict caption] ${p.card.caption}`);
        }
      } else if (reply.brain) {
        console.log(`[brain] ${await brainReply(line, "stdin")}`);
      } else {
        console.log(`[response] ${reply.text}`);
      }
      await tick(rules, store, hooks, check, config.checkInMs);
      await store.save(rules);
    }
    return;
  }

  const app = await Spectrum({
    projectId: config.projectId,
    projectSecret: config.projectSecret,
    providers: [imessage.config()]
  });

  const spaces = new Map<string, Space>();
  const store: WatchStore = createStore();
  rules = await store.load();

  void warmupBrain();

  // Free/Pro plans route iMessage through a shared pool — there is no number
  // to text. Conversations start with the crows sending the first message.
  if (config.operatorPhone) {
    try {
      const im = imessage(app);
      const operator = await im.user(config.operatorPhone);
      const dm = await im.space.create(operator);
      await dm.send('At your service, master. The Crows are online — say "help" for my tricks.');
      spaces.set(dm.id, dm);
    } catch (e) {
      console.error("startup ping failed:", e);
    }
  }

  const hooks = {
    send: async (chatId: string, text: string) => {
      const space = spaces.get(chatId);
      if (!space) return;
      await space.send(text);
    },
    sendCard: async (chatId: string, png: Buffer, name: string) => {
      const space = spaces.get(chatId);
      if (!space) return;
      await space.send(attachment(png, { mimeType: "image/png", name }));
    }
  };

  const run = async () => {
    try {
      await tick(rules, store, hooks, check, config.checkInMs);
    } catch (e) {
      console.error("tick failed:", e);
    }
  };
  const timer = setInterval(() => void run(), config.pollIntervalMs);

  for await (const [space, message] of app.messages) {
    spaces.set(space.id, space);
    if (message.content.type !== "text") continue;
    const reply = handleMessage(message.content.text, space.id);
    const pred = reply.predict ? await predictReply(reply.predict.teamA, reply.predict.teamB, space.id) : undefined;
    const out = pred
      ? pred.text
      : reply.brain
        ? await brainReply(message.content.text, space.id)
        : reply.text;
    await space.send(out);
    if (pred?.card && config.cards) {
      await space.send(attachment(pred.card.png, { mimeType: "image/png", name: pred.card.name }));
    }
  }

  clearInterval(timer);
}

void main();