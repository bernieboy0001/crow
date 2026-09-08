import { describe, expect, it } from "vitest";
import { parseWatch } from "../src/rules";
import type { WatchRule } from "../src/rules";
import { soccerAlertCard, predictCard, type CardImage } from "../src/cards";
import type { FormRow } from "../src/soccer";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function dimsOf(png: Buffer): { w: number; h: number } {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  return { w, h };
}

function form(...letters: FormRow["letter"][]): FormRow[] {
  return letters.map((letter, i) => ({ letter, score: `${letter === "W" ? "2" : "1"}-0`, date: i }));
}

describe("soccer alert card", () => {
  it("renders a PNG scoreboard", () => {
    const rule = parseWatch({ chat: "t", text: "when arsenal scores" }) as WatchRule;
    const card: CardImage = soccerAlertCard(rule, {
      home: "Arsenal",
      matchOpp: "Chelsea",
      score: "2-1",
      state: 1
    });
    expect(card.png.length).toBeGreaterThan(100);
    expect(PNG_SIG.every((b, i) => card.png[i] === b)).toBe(true);
    expect(dimsOf(card.png)).toEqual({ w: 1200, h: 640 });
    expect(card.name).toBe("crows-scorecard.png");
  });
});

describe("predict card", () => {
  it("renders a call card with form sparklines", () => {
    const card: CardImage = predictCard({
      home: { id: "42", name: "Arsenal", short: "ARS", score: "0" },
      away: { id: "77", name: "Chelsea", short: "CHE", score: "0" },
      homeForm: form("W", "W", "D", "W", "L"),
      awayForm: form("L", "D", "W", "L", "W"),
      state: "pre",
      predictedScore: "2-1"
    });
    expect(card.png.length).toBeGreaterThan(100);
    expect(PNG_SIG.every((b, i) => card.png[i] === b)).toBe(true);
    expect(dimsOf(card.png)).toEqual({ w: 1200, h: 720 });
    expect(card.name).toBe("crows-call.png");
  });
});