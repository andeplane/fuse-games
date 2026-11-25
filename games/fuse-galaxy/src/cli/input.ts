/**
 * What a player types in the terminal client, read into a command for the engine or an instruction for the client.
 * The words are turned into the command's fields and handed to the engine's own `parseCommand`, so the terminal
 * accepts exactly the commands the engine does.
 */
import { NONE, parseCommand, type Command } from "../engine/index.js";

export type Input =
  | { readonly kind: "command"; readonly command: Command }
  /** Play this many ticks. */
  | { readonly kind: "next"; readonly ticks: number }
  | { readonly kind: "view" | "legal" | "help" | "quit" | "nothing" }
  | { readonly kind: "error"; readonly message: string };

export const HELP = `Commands (each waits for the next tick)
  roid <metal|crystal|eonium>              mine one more asteroid
  build <structure>                        metalRefinery crystalRefinery eoniumRefinery researchLab shipyard
  research <branch>                        travel hulls sensors mining jamming
  ships <class> <count>                    probe fighter corvette frigate destroyer cruiser battleship pod
  launch <attack|defend|observe|orbit> <planet> <class>=<count> ...
                                           attack an enemy or a neutral planet, defend a teammate;
                                           probes observe (fly past once) or orbit (stay and report)
  recall <fleet>                           also retreats a fleet from a battle, at a loss
  formation <home|fleet> <name>            draw a fleet up as line, wall, column or wings
  formation <home|fleet> <class>=<cell> ...
                                           or place classes yourself: cells 0-2 are the front line,
                                           3-5 the middle, 6-8 the rear, each left to right
  shelter <on|off>                         keep the home fleet out of battles at your planet
  vote <planet>                            vote for your team's commander
  tax <percent>                            commander only
  grant <planet> <resource>=<amount> ...   commander only, from the team's fund
  priority <planet|none>                   commander only: flag a planet for defence
  donate <resource>=<amount> ...           give to the team's fund
Client
  next [n]   play n ticks (default 1)      view    show your view again
  legal      list what you can do now      help    show this
  quit       leave the match`;

/** A word as the engine wants it: a number when it is written as one. */
const value = (word: string | undefined): string | number | undefined =>
  word !== undefined && /^-?\d{1,15}$/.test(word) ? Number(word) : word;

/** `name=amount` pairs as a record, or undefined when a word is not one. */
function pairs(
  words: readonly string[],
): Record<string, string | number> | undefined {
  const read: Record<string, string | number> = {};
  for (const word of words) {
    const [name, amount, ...more] = word.split("=");
    if (!name || amount === undefined || more.length > 0) return undefined;
    read[name] = value(amount)!;
  }
  return read;
}

/** The fields of the command a line asks for, unchecked, or undefined when the first word is not a command. */
function fields(
  verb: string,
  words: readonly string[],
): Record<string, unknown> | undefined {
  const [first, second] = words;
  switch (verb) {
    case "roid":
      return { type: "initiateAsteroid", resource: first };
    case "build":
      return { type: "buildStructure", structure: first };
    case "research":
      return { type: "startResearch", branch: first };
    case "ships":
      return { type: "produceShips", shipClass: first, count: value(second) };
    case "launch":
      return {
        type: "launchFleet",
        mission: first,
        target: value(second),
        ships: pairs(words.slice(2)),
      };
    case "recall":
      return { type: "recallFleet", fleet: value(first) };
    case "formation": {
      const places = words.slice(1);
      return {
        type: "setFormation",
        fleet: first === "home" ? NONE : value(first),
        // One bare word is a formation's name; anything else has to be `class=cell` pairs.
        arrangement:
          places.length === 1 && !places[0]!.includes("=")
            ? places[0]
            : places.length > 0
              ? pairs(places)
              : undefined,
      };
    }
    case "shelter":
      return {
        type: "setShelter",
        sheltered: first === "on" ? true : first === "off" ? false : first,
      };
    case "vote":
      return { type: "voteCommander", candidate: value(first) };
    case "tax":
      return { type: "setTax", percent: value(first) };
    case "grant":
      return {
        type: "grant",
        to: value(first),
        resources: pairs(words.slice(1)),
      };
    case "priority":
      return {
        type: "setDefencePriority",
        planet: first === "none" ? NONE : value(first),
      };
    case "donate":
      return { type: "donate", resources: pairs(words) };
    default:
      return undefined;
  }
}

export function parseInput(line: string): Input {
  const [verb, ...words] = line.trim().split(/\s+/);
  if (!verb) return { kind: "nothing" };
  if (verb === "view" || verb === "legal" || verb === "help" || verb === "quit")
    return { kind: verb };
  if (verb === "next") {
    const ticks = value(words[0] ?? "1");
    return typeof ticks === "number" && ticks >= 1
      ? { kind: "next", ticks }
      : { kind: "error", message: "next takes a number of ticks, 1 or more" };
  }
  const command = fields(verb, words);
  if (!command)
    return {
      kind: "error",
      message: `"${verb}" is not a command; type help for the list`,
    };
  const parsed = parseCommand(command);
  return parsed.ok
    ? { kind: "command", command: parsed.command }
    : { kind: "error", message: parsed.reason };
}
