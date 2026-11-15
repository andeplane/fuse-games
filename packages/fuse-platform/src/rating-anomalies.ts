import { opaqueOpponent } from "./settlement.js";
import { parseRatingGuard, type RatingGuard } from "./rating-guard.js";

/** Private, pseudonymous daily report; never return this from a public HTTP route. */
export function ratingAnomalies(
  rows: readonly { uid: string; guard: unknown }[],
  day: number,
) {
  const accounts = new Map<string, RatingGuard>();
  let invalid = 0;
  for (const row of rows) {
    if (row.guard === undefined) continue;
    const guard = parseRatingGuard(row.guard);
    if (!guard) {
      invalid++;
      continue;
    }
    if (guard.day === day) accounts.set(opaqueOpponent(row.uid), guard);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of accounts.keys()) {
    if (seen.has(id)) continue;
    const component: string[] = [],
      queue = [id];
    seen.add(id);
    while (queue.length) {
      const current = queue.pop()!;
      component.push(current);
      for (const other of Object.keys(accounts.get(current)!.opponents))
        if (accounts.has(other) && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
    }
    components.push(component.sort());
  }
  components.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  const velocity = [...accounts]
    .map(([account, guard]) => ({ account, movement: guard.movement }))
    .sort(
      (a, b) => b.movement - a.movement || a.account.localeCompare(b.account),
    );
  const pairs = [...accounts]
    .flatMap(([account, guard]) =>
      Object.entries(guard.opponents)
        .filter(([other]) => account < other)
        .map(([other, value]) => ({ accounts: [account, other], ...value })),
    )
    .sort((a, b) => b.rounds - a.rounds || b.movement - a.movement);
  const opponentSets = [...accounts].map(([account, guard]) => ({
    account,
    opponents: Object.entries(guard.opponents)
      .sort((a, b) => b[1].rounds - a[1].rounds)
      .map(([id, pair]) => ({ id, rounds: pair.rounds })),
  }));
  return {
    day,
    invalid,
    accounts: accounts.size,
    velocity,
    pairs,
    opponentSets,
    disjointComponents: components.slice(1),
  };
}
