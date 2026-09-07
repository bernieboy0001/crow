import type { WatchRule } from "./rules";

const TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;

/** Global club competitions, no credentials needed (ESPN public feeds). */
export const SOCCER_LEAGUES = [
  "eng.1",
  "esp.1",
  "ita.1",
  "ger.1",
  "fra.1",
  "usa.1",
  "bra.1",
  "ned.1",
  "por.1",
  "uefa.champions"
] as const;

export type SocState = "pre" | "in" | "post";

export interface SocTeam {
  id: string;
  name: string;
  short: string;
  score: string;
}

export interface SocMatch {
  id: string;
  league: string;
  season: "2026";
  state: SocState;
  detail: string;
  teams: SocTeam[];
}

interface CacheEntry {
  at: number;
  matches: SocMatch[];
}

const boardCache = new Map<string, CacheEntry>();

/** Test hook: drop the scoreboard cache (e.g. when a stubbed feed changes state). */
export function clearBoardCache(): void {
  boardCache.clear();
}

async function getJson(base: string): Promise<Record<string, unknown> | undefined> {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${base}`, {
    headers: { "user-agent": "TheCrows/0.1 (+watchdog)" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

function parseTeam(t: unknown): SocTeam | undefined {
  const team = (t as { team?: Record<string, unknown> } | undefined)?.team;
  if (!team) return undefined;
  const name = typeof team.displayName === "string" ? team.displayName : "";
  const short = typeof team.shortDisplayName === "string" ? team.shortDisplayName : "";
  const id = typeof team.id === "string" ? team.id : "";
  if (!name) return undefined;
  return { id, name, short, score: String(team.score ?? "0") };
}

function parseMatch(ev: unknown, league: string): SocMatch | undefined {
  const e = ev as { id?: string; competitions?: unknown[]; status?: Record<string, unknown> } | undefined;
  const comp = e?.competitions?.[0] as { competitors?: unknown[] } | undefined;
  const st = e?.status?.type as { name?: string; detail?: string } | undefined;
  const state = st?.name === "in" ? "in" : st?.name === "post" ? "post" : "pre";
  const teams = (comp?.competitors ?? [])
    .map(parseTeam)
    .filter((t): t is SocTeam => t !== undefined);
  if (teams.length < 2) return undefined;
  return { id: e?.id ?? "", league, season: "2026", state, detail: st?.detail ?? "", teams };
}

export async function scoreboard(league: string): Promise<SocMatch[]> {
  const cached = boardCache.get(league);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.matches;
  const j = await getJson(`${league}/scoreboard`);
  const evs = (j?.events ?? []) as unknown[];
  const matches = evs.map((e) => parseMatch(e, league)).filter((m): m is SocMatch => m !== undefined);
  boardCache.set(league, { at: Date.now(), matches });
  return matches;
}

/** All current matches across leagues, best-effort per league. */
export async function allMatches(): Promise<SocMatch[]> {
  const out: SocMatch[] = [];
  for (const league of SOCCER_LEAGUES) {
    try {
      out.push(...(await scoreboard(league)));
    } catch {
      /* skip a quiet league */
    }
  }
  return out;
}

/** Case- and accent-tolerant rought match of a team name to a board team. */
function fuzzyName(teamText: string): (name: string) => boolean {
  const want = teamText.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  return (name) => {
    if (norm(name) === want) return true;
    if (name.length >= 5 && (norm(name).includes(want) || want.includes(norm(name)))) return true;
    return false;
  };
}

export interface FoundTeam {
  match: SocMatch;
  team: SocTeam;
}

/** Find a team's current fixture by an informal name, across all leagues. */
export async function findTeam(teamText: string): Promise<FoundTeam | undefined> {
  const is = fuzzyName(teamText);
  for (const match of await allMatches()) {
    const hit = match.teams.find((t) => is(t.name) || is(t.short));
    if (hit) return { match, team: hit };
  }
  return undefined;
}

export interface FormRow {
  letter: "W" | "D" | "L";
  score: string;
  date: number;
}

export async function formOf(league: string, teamId: string, limit = 5): Promise<FormRow[]> {
  const j = await getJson(`${league}/teams/${teamId}/schedule`);
  const evs = (j?.events ?? []) as {
    date?: string;
    competitions?: { competitors?: { team?: { id?: string }; score?: string; homeAway?: string }[] }[];
    status?: { type?: { name?: string } };
  }[];
  const rows: FormRow[] = [];
  for (const ev of evs) {
    if (ev.status?.type?.name !== "post") continue;
    const mine = ev.competitions?.[0]?.competitors?.filter((c) => c.team?.id === teamId)[0];
    const theirs = ev.competitions?.[0]?.competitors?.filter((c) => c.team?.id !== teamId)[0];
    if (!mine || !theirs) continue;
    const g = Number(mine.score ?? 0);
    const t = Number(theirs.score ?? 0);
    rows.push({
      letter: g > t ? "W" : g === t ? "D" : "L",
      score: `${g}-${t}`,
      date: Date.parse(ev.date ?? "") || 0
    });
  }
  return rows.sort((a, b) => b.date - a.date).slice(0, limit);
}

export interface Standing {
  teamId: string;
  position: number;
  name: string;
}

export async function standings(league: string): Promise<Standing[]> {
  const j = await getJson(`${league}/standings`);
  const entries = (
    j?.standings as {
      entries?: { team?: { id?: string; displayName?: string; abbreviation?: string }; stats?: { name?: string; value?: string }[] }[];
    }[]
  )?.[0]?.entries;
  return (entries ?? [])
    .map((e, i) => {
      const pos = Number(e.stats?.find((s) => s.name === "rank")?.value ?? i + 1);
      return {
        teamId: e.team?.id ?? "",
        position: pos,
        name: e.team?.displayName ?? e.team?.abbreviation ?? ""
      };
    })
    .filter((s) => s.teamId);
}

/** One-line current picture for a team, so the brain can sound informed. */
export async function teamBrief(found: FoundTeam): Promise<string> {
  const { match, team } = found;
  const opp = match.teams.find((t) => t.id !== team.id);
  const form = await formOf(match.league, team.id);
  let pos = "";
  try {
    const table = await standings(match.league);
    pos = table.find((s) => s.teamId === team.id)?.position
      ? ` (${table.find((s) => s.teamId === team.id)?.position}th in their league)`
      : "";
  } catch {
    /* standings not always served; form still tells the story */
  }
  const state =
    match.state === "pre"
      ? "kickoff still to come"
      : match.state === "in"
        ? `in play (${match.detail})`
        : "finished";
  const score = match.state !== "pre" ? ` — score ${team.score}-${opp?.score ?? "?"}` : "";
  const formLine = form.length
    ? `, last 5: ${form.map((f) => f.letter).join("")} (${form.map((f) => f.score).join(", ")})`
    : "";
  return `${team.name}${pos} host/face ${opp?.name ?? "the opposition"} (${state}${score}${formLine}).`;
}

/** Current state of the matches being watched by a chat, for brain grounding. */
export async function soccerContext(rules: WatchRule[]): Promise<string[]> {
  const lines: string[] = [];
  for (const rule of rules) {
    if (rule.source !== "soccer") continue;
    const found = await findTeam(rule.target);
    if (!found) {
      lines.push(`${rule.target}: no live fixture right now.`);
      continue;
    }
    const opp = found.match.teams.find((t) => t.id !== found.team.id);
    lines.push(
      `${found.team.name} vs ${opp?.name}: ${found.match.state}${
        found.match.state !== "pre" ? ` (${found.team.score}-${opp?.score})` : ""
      } — ${found.match.detail || "upcoming"}`
    );
  }
  return lines;
}

/** Friendly alert content for a soccer watch that fired. */
export function matchLine(match: SocMatch, targetTeam: string): string {
  const home = match.teams[0];
  const away = match.teams[1];
  if (!home || !away) return "";
  const label = (t: SocTeam) => (targetTeam && fuzzyName(targetTeam)(t.name) ? `${t.name} (my team)` : t.name);
  return `${label(home)} ${home.score}-${away.score} ${label(away)}`;
}