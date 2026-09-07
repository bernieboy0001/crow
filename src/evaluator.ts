import type { CheckResult } from "./sources";
import type { WatchRule } from "./rules";

export interface EvaluateOutcome {
  fired: boolean;
  changed: boolean;
  matched: boolean;
}

export function evaluate(rule: WatchRule, res: CheckResult): EvaluateOutcome {
  const prev = rule.lastValue;
  const now = res.value;
  // No baseline yet => this check only establishes one; never a *change*.
  const changed = res.present && now !== null && prev !== undefined && now !== prev;

  let matched: boolean;
  switch (rule.condition.comparator) {
    case "changed":
      matched = changed;
      break;
    case "contains":
      matched = res.present && now !== null;
      break;
    case "present":
      matched = res.present;
      break;
    case "absent":
      matched = !res.present;
      break;
    case "gte":
      matched = res.present && typeof now === "number" && now >= Number(rule.condition.value);
      break;
    case "lt":
      matched = res.present && typeof now === "number" && now < Number(rule.condition.value);
      break;
    case "eq":
      matched = res.present && now !== null && String(now) === String(rule.condition.value);
      break;
  }

  // Steady-state comparators (gte/lt/eq/present/absent/contains) must fire on
  // the *rising edge* only, otherwise they'd alert every tick while true.
  const steady = rule.condition.comparator !== "changed";
  const edge = matched && (!steady || rule.matchedState !== true);
  const alreadyFiredOnce = rule.mode === "once" && rule.fired;
  const fired = edge && !alreadyFiredOnce;

  return { fired, changed, matched };
}