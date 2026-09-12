import { describe, expect, it } from "vitest";
import { crowsStatusPayload, maskProjectId, truncate } from "../src/bridge";

const state = {
  startedAt: 1_000_000,
  lastTickAt: 2_000_000,
  dryRun: false,
  projectId: "photon-abc123def456",
  operatorPhone: "+15551234567",
  llmConfigured: true,
  pollIntervalMs: 15000,
  rulesCount: 3,
  chats: ["chat-a", "chat-b"],
  recent: [{ at: 9_000_000, chat: "chat-a", direction: "out" as const, text: "At your service, master." }],
};

describe("maskProjectId", () => {
  it("masks the middle of a project id", () => {
    expect(maskProjectId("photon-abc123def456")).toBe("pho…456");
  });
  it("masks short ids entirely", () => {
    expect(maskProjectId("short")).toBe("****");
  });
  it("handles empty", () => {
    expect(maskProjectId("")).toBe("");
  });
});

describe("truncate", () => {
  it("collapses whitespace and caps length", () => {
    const long = `x ${"word ".repeat(100)}`;
    expect(truncate(long)).toHaveLength(201);
    const mid = truncate("a\n\n b");
    expect(mid).toBe("a b");
  });
});

describe("crowsStatusPayload", () => {
  it("never leaks the raw project id", () => {
    const payload = crowsStatusPayload(state);
    expect(payload.projectId).not.toContain("abc123def");
    expect(JSON.stringify(payload)).not.toContain("photon-abc123def456");
  });
  it("computes uptime and lastMessageAt from the recent ring", () => {
    const payload = crowsStatusPayload(state);
    expect(payload.ok).toBe(true);
    expect(payload.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(payload.lastMessageAt).toBe(9_000_000);
    expect(payload.rulesCount).toBe(3);
    expect(payload.chats).toEqual(["chat-a", "chat-b"]);
    expect(payload.operatorPhone).toBe("+15551234567");
    expect(payload.llmConfigured).toBe(true);
    expect(payload.recent).toHaveLength(1);
    expect(payload.recent[0]!.direction).toBe("out");
    expect(payload.recent[0]!.text).toBe("At your service, master.");
  });
  it("copies the chats array so callers cannot mutate the source", () => {
    const payload = crowsStatusPayload(state);
    payload.chats.push("chat-c");
    expect(state.chats).toEqual(["chat-a", "chat-b"]);
  });
});