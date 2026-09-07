import { describe, expect, it } from "vitest";
import { parseWatch, type WatchRule } from "../src/rules";
import { evaluate } from "../src/evaluator";
import { hashText } from "../src/sources";
import { alertFor, checkInMessage } from "../src/persona";
import { MemoryStore } from "../src/store";
import { tick } from "../src/poller";
import { handleMessage } from "../src/index";

const chat = "test-chat";

function baseRule(over: Partial<WatchRule> = {}): WatchRule {
  return {
    id: "abc12345",
    chat,
    source: "url",
    target: "https://example.com",
    label: "a page",
    condition: { comparator: "changed" },
    mode: "keep",
    fired: false,
    createdAt: Date.now(),
    lastCheckedAt: 0,
    ...over
  };
}

describe("parseWatch", () => {
  it("parses an x handle watch", () => {
    const r = parseWatch({ chat, text: "watch when @vitalik posts" });
    expect("error" in r).toBe(false);
    const w = r as WatchRule;
    expect(w.source).toBe("x");
    expect(w.target).toBe("vitalik");
    expect(w.condition.comparator).toBe("changed");
  });

  it("parses an rss watch", () => {
    const r = parseWatch({ chat, text: "watch rss https://example.com/feed when it publishes" });
    expect(r.source).toBe("rss");
  });

  it("parses a contains watch", () => {
    const r = parseWatch({ chat, text: "text me when https://shop.dev/product contains \"in stock\"" });
    expect(r.source).toBe("url");
    expect(r.condition).toMatchObject({ comparator: "contains", value: "in stock" });
  });

  it("parses a down watch", () => {
    const r = parseWatch({ chat, text: "watch when https://example.com goes down" });
    expect(r.source).toBe("status");
    expect(r.condition.comparator).toBe("absent");
  });

  it("honors once mode", () => {
    const r = parseWatch({ chat, text: "watch when @vitalik posts once" });
    expect(r.mode).toBe("once");
  });

  it("parses a base block watch", () => {
    const r = parseWatch({ chat, text: "when the base block passes 12345678" });
    expect(r.source).toBe("base-block");
    expect(r.condition).toMatchObject({ comparator: "gte", value: 12345678 });
  });
});

describe("evaluate", () => {
  it("fires on change once a baseline exists", () => {
    const r = baseRule();
    expect(evaluate(r, { value: "aaa", present: true }).changed).toBe(false);
    r.lastValue = "aaa";
    const res = evaluate(r, { value: "bbb", present: true });
    expect(res.changed).toBe(true);
    expect(res.fired).toBe(true);
  });

  it("fires gte only once in once-mode", () => {
    const r = baseRule({ condition: { comparator: "gte", value: 100 }, mode: "once" });
    expect(evaluate(r, { value: 101, present: true }).fired).toBe(true);
    r.fired = true;
    expect(evaluate(r, { value: 102, present: true }).fired).toBe(false);
  });

  it("fires absent on failure", () => {
    const r = baseRule({ condition: { comparator: "absent" } });
    expect(evaluate(r, { value: 0, present: false }).fired).toBe(true);
    expect(evaluate(r, { value: 1, present: true }).fired).toBe(false);
  });
});

describe("poller", () => {
  it("fires, notifies, and marks once-rules done", async () => {
    const r = baseRule({ source: "base-block", condition: { comparator: "gte", value: 100 }, mode: "once" });
    const sent: string[] = [];
    const store = new MemoryStore();
    let block = 50;
    const worker = async () => ({ value: block, present: true });

    await tick([r], store, { send: async (_c, t) => sent.push(t) }, worker, 60_000);
    expect(sent).toHaveLength(0);

    block = 150;
    await tick([r], store, { send: async (_c, t) => sent.push(t) }, worker, 60_000);
    expect(sent).toHaveLength(1);
    expect(r.fired).toBe(true);

    await tick([r], store, { send: async (_c, t) => sent.push(t) }, worker, 60_000);
    expect(sent).toHaveLength(1);
  });

  it("sends a check-in after the quiet window", async () => {
    const r = baseRule({ createdAt: Date.now() - 100_000, lastNotifiedAt: undefined });
    const sent: string[] = [];
    await tick([r], new MemoryStore(), { send: async (_c, t) => sent.push(t) }, async () => ({ value: "same", present: true }), 10_000);
    expect(sent.some((t) => t.startsWith("Still watching"))).toBe(true);
  });
});

describe("sources", () => {
  it("hashText is stable", () => {
    expect(hashText("hello")).toBe(hashText("hello"));
  });
});

describe("persona", () => {
  it("produces an alert and a check-in", () => {
    expect(alertFor(baseRule(), { value: "x", present: true })).toMatch(/—/);
    expect(checkInMessage(baseRule(), { value: "x", present: true })).toMatch(/Still watching/);
  });
});

describe("store", () => {
  it("memory store round-trips", async () => {
    const s = new MemoryStore();
    await s.save([baseRule()]);
    expect(await s.load()).toHaveLength(1);
  });
});

describe("handleMessage", () => {
  it("acknowledges a watch and maps it", () => {
    const reply = handleMessage("watch when @vitalik posts once", chat);
    expect(reply).toMatch(/Watching: vitalik posting/);
    expect(handleMessage("map", chat)).toMatch(/vitalik posting/);
  });
});