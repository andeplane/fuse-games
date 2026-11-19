/** C-Dogs' five AI presets and eight density/health stops from MAINMENU.C. */
export const DIFFICULTIES = [
  "very easy",
  "easy",
  "normal",
  "hard",
  "very hard",
] as const;
export const PERCENTAGES = [25, 50, 75, 100, 125, 150, 175, 200] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface GameplayOptions {
  difficulty: Difficulty;
  density: number;
  npcHp: number;
  playerHp: number;
  friendlyFire: boolean;
}

export const DEFAULT_GAMEPLAY: Readonly<GameplayOptions> = Object.freeze({
  difficulty: "normal",
  density: 100,
  npcHp: 100,
  playerHp: 100,
  friendlyFire: false,
});

export function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.some((d) => d === value);
}
export function isPercentage(value: unknown): value is number {
  return (
    typeof value === "number" && value >= 25 && value <= 200 && value % 25 === 0
  );
}

/** Room settings may omit the entire record. A supplied but corrupt record must reject the message. */
export function parseGameplayOptions(
  value: unknown,
): GameplayOptions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).length !== 5 ||
    !Object.keys(DEFAULT_GAMEPLAY).every((k) => Object.hasOwn(raw, k))
  )
    return;
  const { difficulty, density, npcHp, playerHp, friendlyFire } = raw;
  if (
    !isDifficulty(difficulty) ||
    !isPercentage(density) ||
    !isPercentage(npcHp) ||
    !isPercentage(playerHp) ||
    typeof friendlyFire !== "boolean"
  )
    return;
  return { difficulty, density, npcHp, playerHp, friendlyFire };
}

/** Ordinary NPC population and hit points both use truncating integer multiplication. */
export const enemyCount = (base: number, percentage: number) =>
  Math.max(1, Math.floor((base * percentage) / 100));
export const scaledHp = (base: number, percentage: number) =>
  Math.max(1, Math.floor((base * percentage) / 100));

/** The solo landing page navigates to a fresh game page. Keep default choices out of its URL. */
export function encodeGameplayQuery(
  options?: GameplayOptions,
): URLSearchParams {
  const result = new URLSearchParams();
  if (!options) return result;
  for (const key of Object.keys(DEFAULT_GAMEPLAY) as Array<
    keyof GameplayOptions
  >) {
    if (options[key] !== DEFAULT_GAMEPLAY[key])
      result.set(key, String(options[key]));
  }
  return result;
}

export function decodeGameplayQuery(
  query: URLSearchParams,
): GameplayOptions | undefined {
  const value: Record<string, unknown> = { ...DEFAULT_GAMEPLAY };
  let present = false;
  for (const key of Object.keys(DEFAULT_GAMEPLAY) as Array<
    keyof GameplayOptions
  >) {
    const values = query.getAll(key);
    if (!values.length) continue;
    if (values.length !== 1) return;
    present = true;
    const input = values[0]!;
    if (key === "friendlyFire") {
      if (input !== "true" && input !== "false") return;
      value[key] = input === "true";
    } else if (key === "difficulty") value[key] = input;
    else {
      if (!/^\d{2,3}$/.test(input)) return;
      value[key] = Number(input);
    }
  }
  return present ? parseGameplayOptions(value) : undefined;
}
