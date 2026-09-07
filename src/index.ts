import { createInterface } from "node:readline";
import { Spectrum, type Space } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { config } from "./config";
import { parseWatch, type WatchRule } from "./rules";
import { check } from "./sources";
import { tick } from "./poller";
import { createStore, type WatchStore } from "./store";
import { DebugSender } from "./debug-sender";

const HELP = [
  'The Crows — event watcher. Say:',
  '  "watch when @user posts"',
  '  "text me when <url> goes down" / "... comes back"',
  '  "when <url> contains \\"in stock\\""',
  '  "watch rss <url>"',
  '  "when the base block passes 12345678"',
  '  "map" to list watches, "cancel <n>" to stop one'
].join("\n");

let rules: WatchRule[] = [];

export function handleMessage(text: string, chatId: string): string {
  const t = text.trim();
  if (/^(hi|hello|hey|caw|crow)\b/i.test(t) && !/(watch|when)/i.test(t)) return HELP;
  if (/^map\b/i.test(t)) return mapOf(chatId);
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
      if (!targetId && r.id.toLowerCase().startsWith(idx)) return false;
      return true;
    });
    return before === rules.length ? `No watch matches "${token}".` : "Stopped that one.";
  }
  if (/^(help|what can you do)\b/i.test(t)) return HELP;

  const parsed = parseWatch({ chat: chatId, text: t });
  if ("error" in parsed) return parsed.error;
  rules.push(parsed);
  return `Watching: ${parsed.label}. I'll be in touch. — Crows`;
}

function mapOf(chatId: string): string {
  const mine = rules.filter((r) => r.chat === chatId);
  if (mine.length === 0) return "Nothing in my sights. Give me a watch.";
  const lines = mine.map((r, i) => {
    const state = r.mode === "once" && r.fired ? " (done)" : "";
    return `${i + 1}. ${r.label}${state}`;
  });
  return lines.join("\n");
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
      console.log(`[response] ${reply}`);
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
    await space.send(reply);
  }

  clearInterval(timer);
}

void main();