import { config } from "./config";
import type { WatchRule } from "./rules";

const TIMEOUT_MS = 10_000;

export interface CheckResult {
  value: string | number | null;
  present: boolean;
  meta?: Record<string, string | number>;
  error?: string;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": "TheCrows/0.1 (+watchdog)", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// djb2 — stable, no deps, fine for a change detector.
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const rssTitles = (xml: string): string[] =>
  [...xml.matchAll(/<item[\s>][\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) =>
    m[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? ""
  );

let xUserCache = new Map<string, string>();

async function xUserId(handle: string): Promise<string> {
  const cached = xUserCache.get(handle.toLowerCase());
  if (cached) return cached;
  const res = await fetch(`https://api.twitter.com/2/users/by/username/${handle}`, {
    headers: { authorization: `Bearer ${config.xBearerToken}` }
  });
  if (!res.ok) throw new Error(`X lookup failed (${res.status})`);
  const j = (await res.json()) as { data?: { id: string } };
  if (!j?.data?.id) throw new Error("X handle not found");
  xUserCache.set(handle.toLowerCase(), j.data.id);
  return j.data.id;
}

export async function check(rule: WatchRule): Promise<CheckResult> {
  try {
    switch (rule.source) {
      case "rss": {
        const body = await fetchText(rule.target, {
          headers: { accept: "application/rss+xml, application/xml, text/xml, */*" }
        });
        const titles = rssTitles(body);
        return { value: titles[0] ?? null, present: true, meta: { count: titles.length } };
      }
      case "url": {
        const body = await fetchText(rule.target);
        if (rule.condition.comparator === "contains") {
          const needle = String(rule.condition.value ?? "");
          const hit = body.includes(needle);
          return { value: hit ? needle : null, present: true, meta: { needle } };
        }
        return { value: hashText(body), present: true };
      }
      case "status": {
        try {
          const res = await fetch(rule.target, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
          return { value: res.status, present: res.ok, meta: { status: res.status } };
        } catch {
          return { value: 0, present: false, meta: { status: 0 } };
        }
      }
      case "x": {
        if (!config.xBearerToken) return { value: null, present: false, error: "X is not configured (set X_BEARER_TOKEN)" };
        const id = await xUserId(rule.target);
        const res = await fetch(`https://api.twitter.com/2/users/${id}/tweets?max_results=5&tweet.fields=id`, {
          headers: { authorization: `Bearer ${config.xBearerToken}` }
        });
        if (!res.ok) throw new Error(`X tweets failed (${res.status})`);
        const j = (await res.json()) as { data?: { id: string }[] };
        const latest = j.data?.[0]?.id;
        return { value: latest ?? null, present: true, meta: { handle: rule.target } };
      }
      case "base-block": {
        const body = await fetch(config.baseRpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
        });
        const j = (await body.json()) as { result?: string };
        return { value: parseInt(j.result ?? "0x0", 16), present: true };
      }
    }
  } catch (e) {
    return { value: null, present: false, error: e instanceof Error ? e.message : String(e) };
  }
}