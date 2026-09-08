import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseWatch } from "../src/rules";
import { soccerAlertCard, predictCard } from "../src/cards";
import type { FormRow } from "../src/soccer";

const out = join(process.cwd(), "data", "cards");
mkdirSync(out, { recursive: true });

const rule = parseWatch({ chat: "preview", text: "when arsenal scores" });
if ("error" in rule) throw new Error("watch parse failed");

const forms: Record<string, FormRow[]> = {
  hot: [
    { letter: "W", score: "2-0", date: 1 },
    { letter: "W", score: "3-1", date: 2 },
    { letter: "W", score: "1-0", date: 3 },
    { letter: "D", score: "1-1", date: 4 },
    { letter: "W", score: "2-1", date: 5 }
  ],
  cold: [
    { letter: "L", score: "0-2", date: 1 },
    { letter: "D", score: "1-1", date: 2 },
    { letter: "L", score: "0-1", date: 3 },
    { letter: "W", score: "2-0", date: 4 },
    { letter: "L", score: "1-2", date: 5 }
  ]
};

const alert = soccerAlertCard(rule, { home: "Arsenal", matchOpp: "Chelsea", score: "2-1", state: 1 });
writeFileSync(join(out, alert.name), alert.png);

const predict = predictCard({
  home: { id: "42", name: "Arsenal", short: "ARS", score: "0" },
  away: { id: "77", name: "Chelsea", short: "CHE", score: "0" },
  homeForm: forms.hot,
  awayForm: forms.cold,
  state: "pre",
  predictedScore: "2-1",
  confidence: 0.73
});
writeFileSync(join(out, predict.name), predict.png);

console.log(`wrote ${alert.name} (${alert.png.length}B) and ${predict.name} (${predict.png.length}B) to ${out}`);