import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGroqStub, type GroqStub } from "./stub-groq";

let stub!: GroqStub;

beforeAll(async () => {
  stub = await startGroqStub("llama-retired-model");
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${await stub.start()}`;
  process.env.LLM_MODEL = "llama-retired-model";
});

afterAll(async () => {
  await stub.stop();
});

describe("brain self-heal at runtime", () => {
  it("recovers on its own when the first answer hits a dead model", async () => {
    const { askBrain } = await import("../src/brain");
    const out = await askBrain("ping", { chatRules: [] });
    expect(out).toBe("caw, master");
    // Dead attempt (404) + retry with the resolved live model.
    expect(stub.chatHits()).toBe(2);
    expect(stub.listHits()).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it("keeps the healed model for later answers", async () => {
    const { askBrain } = await import("../src/brain");
    const before = stub.chatHits();
    const out = await askBrain("once more", { chatRules: [] });
    expect(out).toBe("caw, master");
    expect(stub.chatHits()).toBe(before + 1);
    expect(stub.listHits()).toBeGreaterThanOrEqual(1);
  }, 20_000);
});