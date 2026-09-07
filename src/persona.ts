import type { CheckResult } from "./sources";
import type { WatchRule } from "./rules";

const OPENERS = [
  "I am watching",
  "A crow has landed",
  "I see it",
  "One of my eyes just opened",
  "It changed while you slept"
];

function pick(who: string): string {
  const i = (Date.now() % OPENERS.length);
  return `${OPENERS[i]} — ${who}.`;
}

export function alertFor(rule: WatchRule, res: CheckResult): string {
  const what = rule.label;
  switch (rule.condition.comparator) {
    case "absent":
      return pick(`${what} — it's DOWN, so I'm watching the dark`);
    case "present":
      return pick(`${what} — it's back`);
    case "gte":
      return pick(`${what} has been reached`);
    case "lt":
      return pick(`${what} has fallen below threshold`);
    case "contains":
      return pick(`${what} — it's there, like you asked`);
    case "changed":
    default:
      return pick(`${what} — something moved`);
  }
}

export function checkInMessage(rule: WatchRule, res: CheckResult): string {
  const emoji = res.present ? "" : " (quiet)";
  return `Still watching${emoji}: ${rule.label}.`;
}