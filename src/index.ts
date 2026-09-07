import { createInterface } from "node:readline";
import { Spectrum, type Space } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { config } from "./config";
import { parseWatch, type WatchRule } from "./rules";
import { check } from "./sources";
import { tick } from "./poller";
import { createStore, type WatchStore } from "./store";
import { DebugSender } from "./debug-sender";
import { askBrain, baseBlockHeight } from "./brain";
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
    const answer = await askBrain(text, { chatRules: list, baseBlock: block, recent: mem.lines() });
    out = answer ?? "My mind is veiled, master — no oracle is linked. Set LLM_API_KEY and I shall speak freely.";
  } catch (e) {
    console.error("[brain] failed:", e instanceof Error ? e.message : e);
    out = "Fog has taken my mind for a moment, master. Try me again.";
  }
  mem.add("assistant", out);
  chatters.set(chatId, mem);
  return out;
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
      }
    };
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const reply = handleMessage(line, "stdin");
      if (reply.brain) {
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
    const out = reply.brain ? await brainReply(message.content.text, space.id) : reply.text;
    await space.send(out);
  }

  clearInterval(timer);
}

void main();