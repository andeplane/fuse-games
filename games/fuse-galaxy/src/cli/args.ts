/** Reading the terminal client's command line. */
import { ROSTERS, isRoster, type Roster } from "../bots/roster.js";
import {
  SETUP_2V2,
  SETUP_2V2V2,
  SETUP_3V3,
  setupProblem,
  type MatchSetup,
  type Rules,
} from "../engine/index.js";

export interface MatchArgs {
  readonly seed: number;
  readonly setup: MatchSetup;
  /** The rules to play under: the defaults, or the defaults with another tick limit. */
  readonly rules: Rules;
  /** Which bots play the planets nobody sits at. */
  readonly bots: Roster;
}

const MODES: Readonly<Record<string, MatchSetup>> = {
  "2v2": SETUP_2V2,
  "3v3": SETUP_3V3,
  "2v2v2": SETUP_2V2V2,
};

export type Args =
  | ({ readonly mode: "bots"; readonly matches: number } & MatchArgs)
  | ({ readonly mode: "play"; readonly seat: number } & MatchArgs)
  | { readonly mode: "help" }
  | { readonly mode: "error"; readonly message: string };

export const USAGE = `Fuse Galaxy terminal client

  pnpm galaxy bots [options]   play a match between bots at full speed and print a summary
  pnpm galaxy play [options]   play one seat against bots, a tick at a time
  pnpm galaxy help             show this

Options
  --seed N       the match's seed (default 1)
  --mode M       2v2, 3v3 or 2v2v2 (default 2v2)
  --bots B       economy (nobody attacks), raider (every seat attacks) or mixed (default mixed)
  --neutrals N   bot-run neutral planets (default 6)
  --ticks N      end the match after N ticks instead of the rules' limit
  --matches N    bots only: play N matches, on seeds from --seed up (default 1)
  --seat N       play only: the seat you take (default 0)`;

const FLAGS = [
  "seed",
  "mode",
  "bots",
  "neutrals",
  "ticks",
  "matches",
  "seat",
] as const;
type Flag = (typeof FLAGS)[number];

/** The flags whose value is a word; the others take a number. */
const WORDS: readonly Flag[] = ["mode", "bots"];

const isFlag = (name: string): name is Flag =>
  FLAGS.some((flag) => flag === name);

const error = (message: string): Args => ({ mode: "error", message });

/** A whole number of 0 or more written in digits, or undefined. */
export const wholeNumber = (text: string): number | undefined =>
  /^\d{1,15}$/.test(text) ? Number(text) : undefined;

export function parseArgs(argv: readonly string[], defaults: Rules): Args {
  const [mode = "help", ...rest] = argv;
  // Asking for help anywhere on the line gets it, as `bots --help` should.
  if (mode === "help" || argv.includes("--help") || argv.includes("-h"))
    return { mode: "help" };
  if (mode !== "bots" && mode !== "play")
    return error(`unknown mode "${mode}"`);

  const given = new Map<Flag, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]!.replace(/^--/, "");
    const value = rest[index + 1];
    if (!rest[index]!.startsWith("--") || !isFlag(name))
      return error(`unknown option "${rest[index]}"`);
    if (value === undefined) return error(`--${name} needs a value`);
    given.set(name, value);
  }
  const numbers = new Map<Flag, number>();
  for (const [name, value] of given) {
    if (WORDS.includes(name)) continue;
    const number = wholeNumber(value);
    if (number === undefined)
      return error(`--${name} must be a whole number of 0 or more`);
    numbers.set(name, number);
  }

  const size = given.get("mode") ?? "2v2";
  const base = Object.keys(MODES).includes(size) ? MODES[size] : undefined;
  if (!base) return error(`--mode must be 2v2, 3v3 or 2v2v2`);
  const setup = { ...base, neutrals: numbers.get("neutrals") ?? base.neutrals };
  const problem = setupProblem(setup, defaults);
  if (problem) return error(problem);
  const bots = given.get("bots") ?? "mixed";
  if (!isRoster(bots))
    return error(`--bots must be one of ${ROSTERS.join(", ")}`);

  const ticks = numbers.get("ticks");
  if (ticks === 0) return error("--ticks must be at least 1");
  const rules =
    ticks === undefined
      ? defaults
      : { ...defaults, match: { ...defaults.match, tickLimit: ticks } };
  const match = { seed: numbers.get("seed") ?? 1, setup, rules, bots };

  if (mode === "bots") {
    if (given.has("seat")) return error("--seat is for play");
    const matches = numbers.get("matches") ?? 1;
    return matches < 1
      ? error("--matches must be at least 1")
      : { mode, matches, ...match };
  }
  if (given.has("matches")) return error("--matches is for bots");
  const seat = numbers.get("seat") ?? 0;
  return seat >= setup.teams * setup.teamSize
    ? error(`--seat must be below ${setup.teams * setup.teamSize}`)
    : { mode, seat, ...match };
}
