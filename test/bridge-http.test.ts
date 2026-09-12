import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBridge } from "../src/bridge";

const originalPort = process.env.CROWS_BRIDGE_PORT;
const originalToken = process.env.CROWS_BRIDGE_TOKEN;

const state = {
  startedAt: Date.now(),
  lastTickAt: Date.now(),
  dryRun: false,
  projectId: "photon-abc123def456",
  operatorPhone: "+15551234567",
  llmConfigured: true,
  pollIntervalMs: 15000,
  rulesCount: 2,
  chats: ["chat-a"],
  recent: [],
};

const PORT = 8793;
const TOKEN = "s3cret-test-token";
const base = `http://127.0.0.1:${PORT}`;

describe("startBridge HTTP", () => {
  let bridge: ReturnType<typeof startBridge>;

  beforeAll(() => {
    process.env.CROWS_BRIDGE_PORT = String(PORT);
    process.env.CROWS_BRIDGE_TOKEN = TOKEN;
    delete process.env.PORT;
    bridge = startBridge(state);
  });
  afterAll(async () => {
    await bridge.close();
    if (originalPort === undefined) delete process.env.CROWS_BRIDGE_PORT;
    else process.env.CROWS_BRIDGE_PORT = originalPort;
    if (originalToken === undefined) delete process.env.CROWS_BRIDGE_TOKEN;
    else process.env.CROWS_BRIDGE_TOKEN = originalToken;
  });

  it("returns 401 on /status without the token", async () => {
    const res = await fetch(`${base}/status`);
    expect(res.status).toBe(401);
  });

  it("returns the payload with the bearer token", async () => {
    const res = await fetch(`${base}/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rulesCount).toBe(2);
  });

  it("accepts the token as a query param as well", async () => {
    const res = await fetch(`${base}/status?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("allows /health without a token", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});