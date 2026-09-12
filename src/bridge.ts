import { createServer, type Server } from "node:http";

/**
 * Short-lived HTTP bridge so the KRATOS dashboard can read live runtime state.
 * Exposes no secrets (project id is masked). Hosts inject PORT and get the
 * bridge on 0.0.0.0 (public — protect with CROWS_BRIDGE_TOKEN); local dev uses
 * CROWS_BRIDGE_PORT on loopback. Dashboard polls GET /status.
 */

export type CrowsRecentMessage = {
  at: number;
  chat: string;
  direction: "in" | "out";
  text: string;
};

export interface BridgeState {
  startedAt: number;
  lastTickAt: number;
  dryRun: boolean;
  projectId: string;
  operatorPhone: string;
  llmConfigured: boolean;
  pollIntervalMs: number;
  rulesCount: number;
  chats: string[];
  recent: CrowsRecentMessage[];
}

const RECENT_CAP = 20;
const TEXT_CAP = 200;

export function maskProjectId(id: string): string {
  if (!id) return "";
  if (id.length <= 6) return "****";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}

export function truncate(text: string, cap = TEXT_CAP): string {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > cap ? `${t.slice(0, cap)}…` : t;
}

export function crowsStatusPayload(state: BridgeState) {
  return {
    ok: true,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    lastMessageAt: state.recent[0]?.at ?? 0,
    uptimeSeconds: Math.max(0, Math.round((Date.now() - state.startedAt) / 1000)),
    dryRun: state.dryRun,
    projectId: maskProjectId(state.projectId),
    operatorPhone: state.operatorPhone,
    llmConfigured: state.llmConfigured,
    pollIntervalMs: state.pollIntervalMs,
    rulesCount: state.rulesCount,
    chats: [...state.chats],
    recent: state.recent.map((m) => ({
      ...m,
      text: truncate(m.text),
      chat: truncate(m.chat, 40),
    })),
  };
}

export interface BridgeHandle {
  /** Record an inbound or outbound message (ring-buffered for the dashboard). */
  noteMessage(chat: string, direction: "in" | "out", text: string): void;
  /** Call after each poller pass. */
  noteTick(): void;
  setRuleCount(n: number): void;
  close(): Promise<void>;
}

export function startBridge(initial: BridgeState): BridgeHandle {
  let current: BridgeState = {
    ...initial,
    chats: [...initial.chats],
    recent: [...initial.recent],
  };
  // Hosts inject the port as PORT (Vercel/Render) or SERVER_PORT (Pterodactyl
  // panels like Waifly) and expect the app to listen on 0.0.0.0; local dev sets
  // CROWS_BRIDGE_PORT and we stay loopback-only for safety.
  const useHostPort = Boolean(process.env.PORT || process.env.SERVER_PORT);
  let port = 0;
  try {
    port = Number.parseInt(
      (process.env.PORT ?? process.env.SERVER_PORT ?? process.env.CROWS_BRIDGE_PORT) ?? "",
      10,
    );
  } catch {
    port = 0;
  }
  if (!Number.isFinite(port) || port <= 0) {
    // Bridge disabled: return a no-op handle so call sites stay branch-free.
    return {
      noteMessage() {},
      noteTick() {},
      setRuleCount() {},
      async close() {},
    };
  }

  const host = useHostPort ? "0.0.0.0" : "127.0.0.1";
  const token = process.env.CROWS_BRIDGE_TOKEN?.trim() || "";
  const pathname = (req: import("node:http").IncomingMessage): string =>
    new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
  const authorized = (req: import("node:http").IncomingMessage): boolean => {
    if (!token) return true;
    const header = req.headers.authorization ?? "";
    if (header === `Bearer ${token}`) return true;
    return new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`).searchParams.get("token") === token;
  };

  let server: Server | undefined;
  try {
    server = createServer((req, res) => {
      const path = pathname(req);
      if (path === "/status" && req.method === "GET") {
        if (!authorized(req)) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("unauthorized");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(crowsStatusPayload(current)));
        return;
      }
      if (path === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, host);
  } catch (err) {
    console.error("[bridge] could not start:", err);
  }

  return {
    noteMessage(chat, direction, text) {
      const entry: CrowsRecentMessage = {
        at: Date.now(),
        chat,
        direction,
        text: truncate(String(text ?? "")),
      };
      current = {
        ...current,
        chats: [...new Set([...current.chats, chat])],
        recent: [entry, ...current.recent].slice(0, RECENT_CAP),
      };
    },
    noteTick() {
      current = { ...current, lastTickAt: Date.now() };
    },
    setRuleCount(n) {
      current = { ...current, rulesCount: n };
    },
    close() {
      return new Promise<void>((resolve) => {
        if (!server || !server.listening) return resolve();
        server.close(() => resolve());
      });
    },
  };
}