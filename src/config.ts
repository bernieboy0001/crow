import "dotenv/config";

const num = (v: string | undefined, d: number) => {
  if (v === undefined) return d;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  projectId: process.env.PROJECT_ID ?? process.env.SPECTRUM_PROJECT_ID ?? "",
  projectSecret: process.env.PROJECT_SECRET ?? process.env.SPECTRUM_PROJECT_SECRET ?? "",

  /** Official X API bearer token (free tier). Empty = x-rules report "not configured". */
  xBearerToken: process.env.X_BEARER_TOKEN ?? "",

  /** JSON-RPC endpoint for the base-block watcher. */
  baseRpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",

  /** Where rules persist between restarts. */
  storePath: process.env.CROWS_STORE ?? "data/crows.json",

  /** Base poll tick for the watcher loop. */
  pollIntervalMs: num(process.env.CROWS_POLL_INTERVAL_MS, 15000),

  /** How long a quiet watch can go before the crows send a check-in. */
  checkInMs: num(process.env.CROWS_CHECKIN_MS, 4 * 60 * 60 * 1000),

  /** CROWS_DRY=1 runs the stdin harness instead of connecting to Spectrum. */
  dryRun: process.env.CROWS_DRY === "1",

  /** iMessage address (phone or Apple ID email) to ping on startup. */
  operatorPhone: process.env.OPERATOR_PHONE ?? ""
};

export type WatchSource =
  | "x"
  | "rss"
  | "url"
  | "status"
  | "base-block";