import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGroqStub, type GroqStub } from "./stub-groq";

let stub!: GroqStub;

beforeAll(async () => {
  stub = await startGroqStub("llama-dead", { rejectTools: true });
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${await stub.start()}`;
  process.env.LLM_MODEL = "openai/gpt-oss-120b";
});

afterAll(async () => {
  await stub.stop();
});

describe("brain without function calling", () => {
  it("drops the tools array and still answers when the model rejects tools with 400", async () => {
    const { askBrain } = await import("../src/brain");
    const out = await askBrain("what is 2+2", { chatRules: [] });
    expect(out).toBe("caw, master");
    // Tools attempt (400) + retry without tools (200).
    expect(stub.chatHits()).toBe(2);
  }, 20_000);
});