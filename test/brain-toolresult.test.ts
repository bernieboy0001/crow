import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGroqStub, type GroqStub } from "./stub-groq";

let stub!: GroqStub;

beforeAll(async () => {
  stub = await startGroqStub("llama-dead", { toolThenAnswer: true });
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${await stub.start()}`;
  process.env.LLM_MODEL = "openai/gpt-oss-120b";
});

afterAll(async () => {
  await stub.stop();
});

describe("brain tool result round-trip", () => {
  it("keeps tools declared on the follow-up call so the provider accepts the tool result", async () => {
    const { askBrain, warmupBrain } = await import("../src/brain");
    await warmupBrain();
    const out = await askBrain("what is on this page", { chatRules: [] });
    expect(out).toBe("caw, master");
    // Open ended tool call + follow-up answer.
    expect(stub.chatHits()).toBe(2);
    // Regression: the request carrying the tool result must still declare
    // tools, or Groq 400s with "Tool choice is none, but model called a tool".
    const tracks = stub.chatTracks();
    expect(tracks.map((t) => t.hasTools)).toEqual([true, true]);
  }, 20_000);
});