import { randomUUID } from "node:crypto";
import type { WatchSource } from "./config";

export type Comparator = "gte" | "lt" | "eq" | "present" | "absent" | "contains" | "changed";

export interface WatchCondition {
  comparator: Comparator;
  value?: string | number;
}

export interface WatchRule {
  id: string;
  chat: string;
  source: WatchSource;
  target: string;
  label: string;
  condition: WatchCondition;
  mode: "once" | "keep";
  fired: boolean;
  createdAt: number;
  lastCheckedAt: number;
  lastNotifiedAt?: number;
  lastValue?: string | number;
  /** Last observed match state, so steady-state rules fire on the edge only. */
  matchedState?: boolean;
}

export interface NewWatch {
  chat: string;
  text: string;
}

const onceMaybe = (text: string) =>
  /\b(?:once|then stop|just|single)(?:\b|$)/i.test(text) ? "once" : "keep";

export function parseWatch(min: NewWatch): WatchRule | { error: string } {
  const t = min.text.trim();
  const chat = min.chat;

  if (!t) return { error: "say what you want me to watch." };

  // ---- x / twitter ----
  const xHandle = t.match(/@([A-Za-z0-9_]{1,15})/);
  const wantsPosts = /\b(?:posts?|tweets?|says|uploads?|watch(?:ed)?|when)\b/i.test(t);
  if (xHandle && wantsPosts) {
    return {
      id: randomUUID(),
      chat,
      source: "x",
      target: xHandle[1] ?? "",
      label: `${xHandle[1] ?? ""} posting`,
      condition: { comparator: "changed" },
      mode: onceMaybe(t),
      fired: false,
      createdAt: Date.now(),
      lastCheckedAt: 0
    };
  }

  // ---- rss ----
  const rssHit = t.match(/(?:rss|feed)\s+(?:of\s+)?([^\s]+)/i);
  if (rssHit && /(?:publishes?|new|feed|rss)/i.test(t)) {
    return {
      id: randomUUID(),
      chat,
      source: "rss",
      target: rssHit[1] ?? "",
      label: `new entries on ${rssHit[1] ?? ""}`,
      condition: { comparator: "changed" },
      mode: onceMaybe(t),
      fired: false,
      createdAt: Date.now(),
      lastCheckedAt: 0
    };
  }

  // ---- url ----
  const urlHit = t.match(/https?:\/\/[^\s]+/);
  if (urlHit) {
    const u = urlHit[0];
    const contains = t.match(/contains? ["'](.{2,120})["']/i)?.[1];
    if (contains) {
      return {
        id: randomUUID(),
        chat,
        source: "url",
        target: u,
        label: `${u} containing "${contains}"`,
        condition: { comparator: "contains", value: contains },
        mode: onceMaybe(t),
        fired: false,
        createdAt: Date.now(),
        lastCheckedAt: 0
      };
    }
    if (/\b(?:down|offline|unreachable)\b/i.test(t)) {
      return {
        id: randomUUID(),
        chat,
        source: "status",
        target: u,
        label: `${u} going DOWN`,
        condition: { comparator: "absent" },
        mode: onceMaybe(t),
        fired: false,
        createdAt: Date.now(),
        lastCheckedAt: 0
      };
    }
    if (/\b(?:back|up|online|recover(?:ed)?)\b/i.test(t)) {
      return {
        id: randomUUID(),
        chat,
        source: "status",
        target: u,
        label: `${u} coming BACK`,
        condition: { comparator: "present" },
        mode: onceMaybe(t),
        fired: false,
        createdAt: Date.now(),
        lastCheckedAt: 0
      };
    }
    if (/\b(?:chang|update|modified)\b/i.test(t) || /\bwatch\b/i.test(t)) {
      return {
        id: randomUUID(),
        chat,
        source: "url",
        target: u,
        label: `${u} changing`,
        condition: { comparator: "changed" },
        mode: onceMaybe(t),
        fired: false,
        createdAt: Date.now(),
        lastCheckedAt: 0
      };
    }
    return { error: 'tell me WHEN — posts, goes down, comes back, changes, contains "..."' };
  }

  // ---- soccer ----
  const socScore = t.match(/(?:when|if)\s+(.+?)\s+(?:scor(?:es?|ed)|puts one in|nets?)/i);
  const socKickoff = t.match(/(?:when|if)\s+(.+?)\s+(?:kicks?\s?off|kick\s?off|plays?|starts?)\b/i);
  const socFulltime = t.match(
    /(?:when|if)\s+(.+?)\s+(?:finishes?|ends?|go(?:es)?\s+full.?time|gets?\s+the\s+result|result\s+of|final\s+whistle)/i
  );
  const socWatch = t.match(/(?:watch|track|follow)\s+(?:soccer|football)\s+(.+)|(?:soccer|football)\s+watch\s+(.+)/i);
  const soccerTeam =
    socScore?.[1]?.trim() ??
    socKickoff?.[1]?.trim() ??
    socFulltime?.[1]?.trim() ??
    socWatch?.[1]?.trim() ??
    socWatch?.[2]?.trim();
  if (soccerTeam && /(?:soccer|football|match|fixture|kick|score|full.?time|play)/i.test(t)) {
    const comparator = socScore ? "changed" : socKickoff ? "gte" : "eq";
    const value = socScore ? undefined : socKickoff ? 1 : 2;
    return {
      id: randomUUID(),
      chat,
      source: "soccer",
      target: soccerTeam,
      label: `${soccerTeam} ${socScore ? "scoring" : socKickoff ? "kicking off" : "going full time"}`,
      condition: { comparator, value },
      mode: onceMaybe(t),
      fired: false,
      createdAt: Date.now(),
      lastCheckedAt: 0
    };
  }

  // ---- base block ----
  const blockHit = t.match(/\b(base|ethereum|eth)?\s*block\s*(?:passes|reaches|exceeds|crosses)?\s*(\d{5,})/i);
  if (blockHit && blockHit[2] !== undefined) {
    const target = Number.parseInt(blockHit[2], 10);
    return {
      id: randomUUID(),
      chat,
      source: "base-block",
      target: String(target),
      label: `Base block ${target}`,
      condition: { comparator: "gte", value: target },
      mode: onceMaybe(t),
      fired: false,
      createdAt: Date.now(),
      lastCheckedAt: 0
    };
  }

  return {
    error:
      'I couldn\'t read that. Try: "watch when @user posts", "text me when <url> goes down", ' +
      'when <url> contains \\"in stock\\", "watch rss <url>", or "when the base block passes 12345678".'
  };
}