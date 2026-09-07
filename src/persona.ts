import type { CheckResult } from "./sources";
import type { WatchRule } from "./rules";

const FLIGHTS = [
  "I see it, master",
  "A crow alights with news",
  "Swift wings bear word",
  "My beady eye has caught it",
  "The roost stirs"
] as const;

function flight(): string {
  const i = (FLIGHTS.length + Date.now()) % FLIGHTS.length;
  return FLIGHTS[i] ?? FLIGHTS[0];
}

/** A full ack or $trigger fired. */
export function ackWatch(rule: WatchRule): string {
  return `Your wish is my flight-path, master. Watching ${rule.label}.`;
}

export function welcome(): string {
  return 'At your service, master. Say "help" and I shall teach you my tricks.';
}

export function help(): string {
  return `I am the Crows, master — your eye in the sky. Command me:
  "watch when @user posts"
  "text me when <url> goes down" (or "comes back")
  "when <url> contains "in stock""
  "watch rss <url>"
  "when the base block passes 123456789"
  "watch soccer arsenal" (or "when arsenal kick off" / "score" / "goes full time")
  "predict <team> vs <team>" for my call on the result
  "map" for my watchlist, "cancel 2" to end a watch, "stats" for my roster
  Or just ask me anything — I hold a mind, and I can fetch a page you name.`;
}

export function cancelOk(): string {
  return "The watch is ended, master. I fold my wings.";
}

export function cancelMiss(token: string): string {
  return `No watch bears that mark, master ("${token}").`;
}

export function mapEmpty(): string {
  return "Nothing in my sights yet, master. Give me a watch.";
}

export function statsEmpty(): string {
  return "My days are idle, master — no watches yet.";
}

export function statsIntro(n: number, m: number): string {
  return `My roster, master — ${n} watch(es) across ${m} chat(s):`;
}

export function alertFor(rule: WatchRule, res: CheckResult): string {
  if (rule.source === "soccer") {
    const meta = res.meta ?? {};
    const score = typeof meta.score === "string" ? meta.score : "";
    const home = typeof meta.home === "string" ? meta.home : rule.target;
    const away = typeof meta.matchOpp === "string" ? meta.matchOpp : "";
    switch (rule.condition.comparator) {
      case "gte":
        return `${flight()} — ${rule.label}, master. ${home} ${score} ${away}. The fever begins.`;
      case "changed":
        return `${flight()} — goal news, master. ${home} ${score} ${away}.`;
      default:
        return `${flight()} — ${rule.label}, master. Full whistle: ${home} ${score} ${away}.`;
    }
  }
  const what = rule.label;
  switch (rule.condition.comparator) {
    case "absent":
      return `${flight()} — ${what} has fallen dark, master. I watch the shadows for its return.`;
    case "present":
      return `${flight()} — ${what} breathes again, master.`;
    case "gte":
      return `${flight()} — ${what} has been reached, master.`;
    case "lt":
      return `${flight()} — ${what} has dipped low, master.`;
    case "contains":
      return `${flight()} — ${what}, master. Just as you asked.`;
    case "changed":
    default:
      return `${flight()} — ${what} has moved, master.`;
  }
}

export function checkInMessage(rule: WatchRule, res: CheckResult): string {
  const state = res.present ? "all quiet" : "the place lies dark";
  return `Perched, master. Still watching ${rule.label} — ${state}.`;
}

export function alreadyTrue(rule: WatchRule): string {
  const closing = rule.mode === "once" ? " I fold my wings and withdraw." : "";
  return `${rule.label} is already true, master. I hold a baseline regardless${closing}`;
}