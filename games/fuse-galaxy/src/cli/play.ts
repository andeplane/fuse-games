/**
 * One seat played from a terminal against bots. The match waits for the player: commands are typed, held for the
 * next tick, and `next` plays ticks. The player is shown their view and nothing else, as any client would be.
 */
import {
  commandProblemFor,
  createEnv,
  legalCommands,
  type Command,
  type MatchSetup,
  type Policy,
  type Rules,
  type World,
} from "../engine/index.js";
import { HELP, parseInput } from "./input.js";
import {
  eventLine,
  renderLegal,
  renderStandings,
  renderView,
} from "./render.js";

export interface Terminal {
  /** The next line the player types, or undefined when there is no more input. */
  readLine(prompt: string): Promise<string | undefined>;
  write(text: string): void;
}

export interface PlayOptions {
  readonly seed: number;
  readonly setup: MatchSetup;
  readonly rules: Rules;
  /** The seat the player takes. */
  readonly seat: number;
  /** What plays every other planet. */
  readonly policy: Policy;
  readonly terminal: Terminal;
}

/** Plays until the match ends or the player leaves; returns the world it stopped in. */
export async function playSession(options: PlayOptions): Promise<World> {
  const { seed, setup, rules, seat, policy, terminal } = options;
  const env = createEnv({ rules, neutralPolicy: policy });
  let step = env.reset(seed, setup);
  let queued: Command[] = [];
  const mine = () => step.views[seat]!;

  terminal.write(HELP);
  terminal.write(renderView(mine(), rules));
  while (!step.done) {
    const line = await terminal.readLine(`tick ${step.tick}> `);
    if (line === undefined) break;
    const input = parseInput(line);
    if (input.kind === "quit") break;
    switch (input.kind) {
      case "nothing":
        break;
      case "help":
        terminal.write(HELP);
        break;
      case "view":
        terminal.write(renderView(mine(), rules));
        break;
      case "legal":
        terminal.write(renderLegal(legalCommands(mine(), rules)));
        break;
      case "error":
        terminal.write(`Not understood: ${input.message}`);
        break;
      case "command": {
        const problem = commandProblemFor(mine(), input.command, rules);
        if (problem) terminal.write(`Cannot do that: ${problem}`);
        else {
          queued.push(input.command);
          terminal.write(`Queued for the next tick: ${input.command.type}`);
        }
        break;
      }
      case "next": {
        // What the player was told on the ticks that pass without a view being shown.
        const missed: string[] = [];
        for (let played = 0; played < input.ticks && !step.done; played++) {
          for (const event of played > 0 ? mine().events : [])
            missed.push(`Tick ${step.tick}: ${eventLine(event)}`);
          const commands = new Map<number, readonly Command[]>();
          for (const view of step.views)
            commands.set(
              view.self,
              view.self === seat ? queued : policy(view, rules),
            );
          queued = [];
          step = env.step(commands);
        }
        if (missed.length > 0) terminal.write(missed.join("\n"));
        terminal.write(renderView(mine(), rules));
        break;
      }
    }
  }
  terminal.write(renderStandings(env.world(), rules));
  return env.world();
}
