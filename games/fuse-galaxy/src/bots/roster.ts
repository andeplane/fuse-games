/** Which bot plays which planet in a match the bots play. */
import type { Policy } from "../engine/index.js";
import { createEconomyBot } from "./economy-bot.js";
import { createRaiderBot } from "./raider-bot.js";

/**
 * `economy`: every planet grows and nobody attacks. `raider`: every seat raids. `mixed`: on each team the seats
 * alternate, an economy bot first, so every team has both. The neutral planets are economy bots in all three.
 */
export const ROSTERS = ["economy", "raider", "mixed"] as const;
export type Roster = (typeof ROSTERS)[number];

export const isRoster = (name: string): name is Roster =>
  ROSTERS.some((roster) => roster === name);

/** One policy that plays every planet of a match, each by the bot the roster gives it. */
export function createRoster(roster: Roster): Policy {
  const economy = createEconomyBot();
  const raider = createRaiderBot();
  return (view, rules) => {
    if (roster === "economy" || !view.team) return economy(view, rules);
    const place = view.team.members.indexOf(view.self);
    return (roster === "raider" || place % 2 === 1 ? raider : economy)(
      view,
      rules,
    );
  };
}
