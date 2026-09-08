import type { WatchRule } from "./rules";
import type { CheckResult } from "./sources";
import { evaluate } from "./evaluator";
import { alertFor, alreadyTrue, checkInMessage } from "./persona";
import type { WatchStore } from "./store";
import { soccerAlertCard } from "./cards";

export interface PollHooks {
  /** Deliver a message back to a chat by its Space id. */
  send(chatId: string, text: string): Promise<void>;
  /** Optional: deliver a PNG scoreboard attachment alongside the alert. */
  sendCard?(chatId: string, png: Buffer, name: string): Promise<void>;
}

/**
 * One pass of the crows: check every open rule, fire an alert on a match,
 * send a quiet check-in to long-silent watches, then persist state.
 */
export async function tick(
  rules: WatchRule[],
  store: WatchStore,
  hooks: PollHooks,
  worker: (rule: WatchRule) => Promise<CheckResult>,
  checkInMs: number
): Promise<WatchRule[]> {
  const now = Date.now();
  for (const rule of rules) {
    const neverChecked = rule.lastCheckedAt === 0;
    const res = await worker(rule);
    rule.lastCheckedAt = now;
    if (res.value !== null && res.value !== undefined) rule.lastValue = res.value;

    const outcome = evaluate(rule, res);
    rule.matchedState = outcome.matched;

    if (!outcome.fired) {
      const due = now - (rule.lastNotifiedAt ?? rule.createdAt);
      if (due >= checkInMs) {
        rule.lastNotifiedAt = now;
        await hooks.send(rule.chat, checkInMessage(rule, res));
      }
      continue;
    }

    rule.fired = true;
    rule.lastNotifiedAt = now;
    if (neverChecked && outcome.matched && rule.condition.comparator !== "changed") {
      // Hit on the very first observation: warn, don't fake an event.
      await hooks.send(rule.chat, alreadyTrue(rule));
    } else {
      await hooks.send(rule.chat, alertFor(rule, res));
      if (rule.source === "soccer" && hooks.sendCard) {
        const card = soccerAlertCard(rule, res.meta);
        await hooks.sendCard(rule.chat, card.png, card.name);
      }
    }
  }
  await store.save(rules);
  return rules;
}