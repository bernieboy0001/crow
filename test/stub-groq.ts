import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface GroqStub {
  start(): Promise<string>;
  stop(): Promise<void>;
  listHits(): number;
  chatHits(): number;
  readonly deadModel: string;
}

export async function startGroqStub(deadModel: string): Promise<GroqStub> {
  let listHits = 0;
  let chatHits = 0;
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: string) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(body);
    };
    if (req.method === "GET" && req.url === "/models") {
      listHits += 1;
      send(
        200,
        JSON.stringify({
          data: [
            { id: "whisper-large-v3" },
            { id: "meta-llama/llama-prompt-guard-2-86m" },
            { id: "openai/gpt-oss-120b" }
          ]
        })
      );
      return;
    }
    if (req.method === "POST" && req.url === "/chat/completions") {
      chatHits += 1;
      let model = "";
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          model = (JSON.parse(Buffer.concat(chunks).toString()) as { model?: string }).model ?? "";
        } catch {
          model = "";
        }
        if (model === deadModel) {
          send(404, `{"error":{"message":"Model not found"}}`);
        } else {
          send(
            200,
            JSON.stringify({ choices: [{ message: { role: "assistant", content: "caw, master" } }] })
          );
        }
      });
      return;
    }
    send(404, "{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    start: async () => port,
    stop: async () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve()))
      ),
    listHits: () => listHits,
    chatHits: () => chatHits,
    deadModel
  };
}