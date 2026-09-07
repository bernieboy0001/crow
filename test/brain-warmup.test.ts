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

describe("brain boot warmup", () => {
  it("fingerprints the provider at boot and answers without any 404", async () => {
    const { askBrain, warmupBrain } = await import("../src/brain");
    await warmupBrain();
    const out = await askBrain("ping", { chatRules: [] });
    expect(out).toBe("caw, master");
    // Resolved at boot → the answer itself never 404s.
    expect(stub.chatHits()).toBe(1);
    expect(stub.listHits()).toBe(1);
  }, 20_000);
});