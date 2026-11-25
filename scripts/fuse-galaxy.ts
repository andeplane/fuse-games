/**
 * Fuse Galaxy's terminal client: `pnpm galaxy bots` plays a match between bots and prints a summary with its speed;
 * `pnpm galaxy play` lets you play one seat against them. This file only supplies the real terminal and clock; the
 * client is `games/fuse-galaxy/src/cli/main.ts`.
 */
import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline";
import { main } from "../games/fuse-galaxy/src/cli/main.js";

let reader: Interface | undefined;
let lines: AsyncIterator<string> | undefined;

process.exitCode = await main(process.argv.slice(2), {
  clock: { now: () => performance.now() },
  terminal: {
    async readLine(prompt) {
      // Opened on first use, so a bot match never waits on the keyboard.
      reader ??= createInterface({ input: stdin, crlfDelay: Infinity });
      lines ??= reader[Symbol.asyncIterator]();
      stdout.write(prompt);
      const line = await lines.next();
      return line.done ? undefined : line.value;
    },
    write(text) {
      stdout.write(`${text}\n`);
    },
  },
});
reader?.close();
