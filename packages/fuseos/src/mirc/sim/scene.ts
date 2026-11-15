/**
 * The #ddrnorway conversation that runs once the language model is loaded, and only while mIRC is in the channel.
 * A listed player joins, someone already there (more likely the more tournaments they have played) says hei,
 * the joiner replies, and about half the time that grows into a conversation of 3–5 people. The gap until the
 * next line is a random 10–120 seconds. Guest nicks are never part of it.
 */

export const SCENE_SIZE = { min: 3, max: 5 } as const;
export const SCENE_GAP_SECONDS = { min: 10, max: 120 } as const;

export type WeightedPlayer = { nick: string; weight: number };

/** Milliseconds until the next line. `random` in [0, 1] maps onto 10–120 seconds inclusive. */
export function sceneGapMs(random: () => number): number {
  const span = SCENE_GAP_SECONDS.max - SCENE_GAP_SECONDS.min; // 110 steps above the minimum
  const seconds =
    SCENE_GAP_SECONDS.min +
    Math.floor(Math.min(random(), 0.999999) * (span + 1));
  return seconds * 1000;
}

/** Chance that a hello grows into a conversation of 3–5 people. */
export const EXPAND_CHANCE = 0.5;

export type ArrivalPlan = {
  joiner: string;
  greeter: string;
  /** Further people, after the hello and the reply. */
  others: string[];
};

/**
 * Who joins, who says hei, and who else may join in. `absent` and `present` are weighted by tournaments.
 * Returns undefined when nobody is waiting to join or nobody present can greet them.
 */
export function planArrival(
  absent: readonly WeightedPlayer[],
  present: readonly WeightedPlayer[],
  random: () => number,
): ArrivalPlan | undefined {
  const joiner = pickWeightedNick(absent, random);
  const greeter = pickWeightedNick(
    present.filter((player) => player.nick !== joiner),
    random,
  );
  if (!joiner || !greeter) return undefined;
  if (random() >= EXPAND_CHANCE) return { joiner, greeter, others: [] };
  const size = sceneSize(random);
  const pool = present.filter(
    (player) => player.nick !== greeter && player.nick !== joiner,
  );
  const others: string[] = [];
  for (let n = 0; n < size - 2 && pool.length > 0; n += 1) {
    const nick = pickWeightedNick(pool, random);
    if (!nick) break;
    others.push(nick);
    const index = pool.findIndex((player) => player.nick === nick);
    if (index >= 0) pool.splice(index, 1);
  }
  return { joiner, greeter, others };
}

function pickWeightedNick(
  players: readonly WeightedPlayer[],
  random: () => number,
): string | undefined {
  const pool = players.filter((player) => player.weight > 0);
  if (pool.length === 0) return undefined;
  return pool[takeWeighted(pool, random)]?.nick;
}

/** How many people are in the next conversation: 3, 4 or 5. */
export function sceneSize(random: () => number): number {
  const span = SCENE_SIZE.max - SCENE_SIZE.min;
  return SCENE_SIZE.min + Math.floor(Math.min(random(), 0.999999) * (span + 1));
}

/**
 * `count` distinct nicks. Each draw's chance is that player's weight over the weight still in the pool,
 * so someone with more tournaments is more likely to be in the conversation.
 */
export function pickScene(
  players: readonly WeightedPlayer[],
  random: () => number,
): string[] {
  const pool = players
    .filter((player) => player.weight > 0)
    .map((player) => ({ nick: player.nick, weight: player.weight }));
  const count = Math.min(sceneSize(random), pool.length);
  const picked: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const index = takeWeighted(pool, random);
    const player = pool[index];
    if (!player) break;
    picked.push(player.nick);
    pool.splice(index, 1);
  }
  return picked;
}

function takeWeighted(
  pool: readonly WeightedPlayer[],
  random: () => number,
): number {
  const total = pool.reduce((sum, player) => sum + player.weight, 0);
  if (total <= 0) return 0;
  let mark = Math.min(random(), 0.999999) * total;
  for (let index = 0; index < pool.length; index += 1) {
    mark -= pool[index]?.weight ?? 0;
    if (mark < 0) return index;
  }
  return pool.length - 1;
}

/** IRC nick tokens in `text`, lowercased, so "Al" does not match inside "skal" or "Andeplane". */
function nickTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9[\]\\`_^{|}-]+/);
}

/** True when `nick` stands as its own word. */
export function nickMentioned(text: string, nick: string): boolean {
  const wanted = nick.toLowerCase();
  if (wanted.length === 0) return false;
  return nickTokens(text).includes(wanted);
}

/**
 * The nick in `nicks` that appears earliest in `text`. List order does not matter, so "Snute og Al"
 * is Snute even when Al comes first in the nicklist.
 */
export function firstMentioned(
  text: string,
  nicks: readonly string[],
): string | undefined {
  const wanted = new Map<string, string>();
  for (const nick of nicks) {
    const key = nick.toLowerCase();
    if (key.length > 0 && !wanted.has(key)) wanted.set(key, nick);
  }
  for (const token of nickTokens(text)) {
    const nick = wanted.get(token);
    if (nick) return nick;
  }
  return undefined;
}
