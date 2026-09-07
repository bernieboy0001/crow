import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWatch } from "../src/rules";
import type { WatchRule } from "../src/rules";
import { check } from "../src/sources";
import { handleMessage } from "../src/index";
import { findTeam, formOf, clearBoardCache } from "../src/soccer";
import { predictReply } from "../src/index";

const armory = {
  Arsenal: { id: "42", displayName: "Arsenal", shortDisplayName: "ARS" },
  Chelsea: { id: "77", displayName: "Chelsea", shortDisplayName: "CHE" }
};

function scoreboardJson(state: "pre" | "in" | "post", homeScore = "0", awayScore = "0") {
  return {
    events: [
      {
        id: "m1",
        date: "2026-09-07T13:00:00Z",
        status: { type: { name: state, detail: state === "pre" ? "19:45" : "74'" } },
        competitions: [
          {
            competitors: [
              { team: armory.Arsenal, score: homeScore, homeAway: "home" },
              { team: armory.Chelsea, score: awayScore, homeAway: "away" }
            ]
          }
        ]
      }
    ]
  };
}

const standingsJson = {
  standings: [
    {
      entries: [
        { team: armory.Arsenal, stats: [{ name: "rank", value: "3" }] },
        { team: armory.Chelsea, stats: [{ name: "rank", value: "11" }] }
      ]
    }
  ]
};

const scheduleJson = {
  events: [
    {
      id: "historic",
      date: "2026-08-30T13:00:00Z",
      status: { type: { name: "post" } },
      competitions: [
        {
          competitors: [
            { team: armory.Arsenal, score: "2", homeAway: "home" },
            { team: armory.Chelsea, score: "1", homeAway: "away" }
          ]
        }
      ]
    }
  ]
};

const originalFetch = globalThis.fetch;

function fakeEspn(state: "pre" | "in" | "post") {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const p = url.pathname;
    const league = p.match(/\/soccer\/([\w.]+)\//)?.[1];
    const teamId = p.match(/\/teams\/(\d+)\/schedule/)?.[1];
    const ok = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
    if (league && p.endsWith("/scoreboard")) {
      return ok(league === "eng.1" ? scoreboardJson(state) : { events: [] });
    }
    if (league && p.endsWith("/standings")) {
      return ok(league === "eng.1" ? standingsJson : { standings: [{ entries: [] }] });
    }
    if (league && teamId) {
      return ok(teamId === "42" ? scheduleJson : { events: [] });
    }
    return ok({});
  }) as typeof fetch;
}

beforeAll(() => {
  fakeEspn("pre");
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("soccer watch parsing", () => {
  it("parses a kickoff watch", () => {
    const r = parseWatch({ chat: "t", text: "when arsenal kick off" }) as WatchRule;
    expect(r.source).toBe("soccer");
    expect(r.target.toLowerCase()).toContain("arsenal");
    expect(r.condition).toEqual({ comparator: "gte", value: 1 });
  });

  it("parses a score watch", () => {
    const r = parseWatch({ chat: "t", text: "when liverpool scores" }) as WatchRule;
    expect(r.source).toBe("soccer");
    expect(r.condition.comparator).toBe("changed");
  });

  it("parses a full-time watch", () => {
    const r = parseWatch({ chat: "t", text: "when man city goes full time" }) as WatchRule;
    expect(r.source).toBe("soccer");
    expect(r.condition).toEqual({ comparator: "eq", value: 2 });
  });
});

describe("predict routing", () => {
  it("routes 'predict X vs Y' to the predictor", () => {
    const r = handleMessage("predict Arsenal vs Chelsea", "t");
    expect(r.predict?.teamA?.toLowerCase()).toBe("arsenal");
    expect(r.predict?.teamB?.toLowerCase()).toBe("chelsea");
    expect(r.brain).toBeUndefined();
  });

  it("predictReply reads form even without an oracle", async () => {
    const out = await predictReply("arsenal", "chelsea", "t");
    expect(out).toContain("oracle is veiled");
    expect(out).toContain("Arsenal");
  }, 20_000);

  it("predictReply admits when a fixture is unknown", async () => {
    const out = await predictReply("nonexistent fc", "also unknown fc", "t");
    expect(out).toContain("No fixture");
  }, 20_000);
});

describe("soccer source", () => {
  it("returns 0 (pre) for an upcoming kickoff watch", async () => {
    const rule = parseWatch({ chat: "t", text: "when arsenal kick off" }) as WatchRule;
    const res = await check(rule);
    expect(res.present).toBe(true);
    expect(res.value).toBe(0);
  });

  it("returns score text for a score watch", async () => {
    clearBoardCache();
    fakeEspn("in");
    const rule = parseWatch({ chat: "t", text: "when arsenal scores" }) as WatchRule;
    const res = await check(rule);
    expect(res.value).toBe("0-0");
    expect(res.meta?.home).toBe("Arsenal");
  });

  it("returns 2 (post) once full time", async () => {
    clearBoardCache();
    fakeEspn("post");
    const rule = parseWatch({ chat: "t", text: "when arsenal goes full time" }) as WatchRule;
    const res = await check(rule);
    expect(res.value).toBe(2);
  });
});

describe("soccer data", () => {
  it("finds a team by name across leagues", async () => {
    clearBoardCache();
    fakeEspn("pre");
    const found = await findTeam("arsenal fc");
    expect(found?.team.name).toBe("Arsenal");
  });

  it("builds recent form letters", async () => {
    clearBoardCache();
    fakeEspn("pre");
    const found = await findTeam("arsenal");
    const form = await formOf("eng.1", "42");
    expect(form[0]?.letter).toBe("W");
    expect(form[0]?.score).toBe("2-1");
  });
});