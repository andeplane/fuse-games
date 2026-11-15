import type { AgentTool } from "../../agenttools/agentTool";
import { runAgentLoop } from "../../llm/agentLoop";
import type { ChatEngine } from "../../llm/llmChat";

import { fallbackLine } from "./ddrPlayers";
import type { Regular } from "./regulars";
import { findRegular, isAutomaticGuest, systemPromptFor } from "./regulars";

export type ChatTurn = { nick: string; text: string };

export type BrainRequest = {
  regular: Regular;
  channel: string;
  userNick: string;
  /** The channel's recent lines, oldest first; the one being answered last. */
  history: readonly ChatTurn[];
  /** The other people in the current model conversation, when this line is part of one. */
  company?: readonly string[];
  /** What this one line is for, such as "Say hei to Abra." */
  hint?: string;
};

/** What decides a regular's next line: the shared language model, or their canned lines. */
export interface RegularsBrain {
  /** Who is thinking, for the Status window ("the regulars are AI" or "canned"). */
  describe(): string;
  /** True when a language model will answer. It may still be loading. */
  usesModel(): boolean;
  /** Loads the model. Resolves false when this brain has no model or the load fails. */
  prepare(signal: AbortSignal): Promise<boolean>;
  reply(
    request: BrainRequest,
    signal: AbortSignal,
  ): Promise<string | undefined>;
  dispose(): void;
}

/** Picks one of the regular's own lines; `random` makes it deterministic in tests. */
export function cannedLine(
  regular: Regular,
  random: () => number,
): string | undefined {
  if (regular.lines.length === 0) return undefined;
  return (
    regular.lines[Math.floor(random() * regular.lines.length)] ??
    regular.lines[0]
  );
}

function spokenLine(
  regular: Regular,
  random: () => number,
): string | undefined {
  return cannedLine(regular, random) ?? fallbackLine(regular.nick);
}

export function cannedBrain(random: () => number): RegularsBrain {
  return {
    describe: () => "canned lines (no language model in this browser)",
    usesModel: () => false,
    prepare: () => Promise.resolve(false),
    reply: (request) => Promise.resolve(spokenLine(request.regular, random)),
    dispose: () => undefined,
  };
}

/** The model's reply cut down to one IRC line: first line, no `nick:` prefix or quotes, at most 300 chars. */
export function toIrcLine(text: string, nick: string): string | undefined {
  const first = text
    .trim()
    .split(/\r?\n/)
    .find((part) => part.trim().length > 0);
  if (!first) return undefined;
  const cleaned = first
    .trim()
    .replace(
      new RegExp(`^<?${nick.replace(/[^A-Za-z0-9]/g, ".")}>?:?\\s*`, "i"),
      "",
    )
    .replace(/^["“']|["”']$/g, "")
    .replace(/[\x00-\x1f]/g, "")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, 300);
}

/**
 * The regulars over the shared FuseOS chat engine (Clippy's model through web-llm). AI regulars ask the model;
 * the others, and everyone when the model fails or says nothing usable, use their canned lines. One reply is
 * generated at a time. A second AI reply waits for the one in flight instead of answering with a canned line.
 * The engine itself loads lazily on the first request.
 */
export function engineBrain(
  engine: ChatEngine,
  random: () => number,
): RegularsBrain {
  let tail: Promise<void> = Promise.resolve();
  return {
    describe: () => {
      const backend = engine.backend();
      return backend.kind === "model"
        ? `${backend.label}, running in this browser`
        : "canned lines";
    },
    usesModel: () => engine.backend().kind === "model",
    async prepare(signal) {
      if (signal.aborted || engine.backend().kind !== "model") return false;
      try {
        await engine.ready?.(() => undefined);
      } catch {
        return false;
      }
      return !signal.aborted && engine.backend().kind === "model";
    },
    reply(request, signal) {
      if (!request.regular.ai || engine.backend().kind !== "model")
        return Promise.resolve(spokenLine(request.regular, random));
      const turn = tail.then(() =>
        engine.complete
          ? speakWithTools(engine, request, random, signal)
          : speak(engine, request, random, signal),
      );
      tail = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
    dispose: () => engine.dispose(),
  };
}

/**
 * One line via the model's tool loop, and only from a caller that already has mIRC's engine.
 * The model may call `player_facts` before it answers. A plain sentence is still accepted.
 * A failure or an empty answer falls back; an abort stays silent.
 */
async function speakWithTools(
  engine: ChatEngine,
  request: BrainRequest,
  random: () => number,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (!engine.complete || signal.aborted) return undefined;
  const style = engine.loopStyle?.() === "native" ? "native" : "json";
  try {
    const outcome = await runAgentLoop({
      style,
      complete: (step) =>
        engine.complete?.({ ...step, onProgress: () => undefined }) ??
        Promise.resolve({ text: "" }),
      tools: [playerFactsTool()],
      system: systemPromptFor(
        request.regular,
        request.channel,
        request.userNick,
        request.company,
      ),
      messages: [
        ...historyMessages(request),
        {
          role: "user",
          content:
            request.hint ??
            "Say one short line to the people you are talking with.",
        },
      ],
      signal,
      onStep: () => undefined,
      onProgress: () => undefined,
      timers: {
        setTimeout: (callback, ms) =>
          setTimeout(callback, ms) as unknown as number,
        clearTimeout: (handle) => clearTimeout(handle),
      },
      maxSteps: 4,
    });
    if (signal.aborted || outcome.stopped === "cancelled") return undefined;
    return (
      toIrcLine(outcome.text, request.regular.nick) ??
      spokenLine(request.regular, random)
    );
  } catch {
    if (signal.aborted) return undefined;
    return spokenLine(request.regular, random);
  }
}

/** CCBS facts for one nick. Guest nicks are refused so the model is told not to talk to them. */
function playerFactsTool(): AgentTool {
  return {
    name: "player_facts",
    description:
      "Look up one person in the channel: their club and CCBS results. Call this before you speak about them.",
    parameters: [
      {
        name: "nick",
        type: "string",
        description: "Their IRC nick.",
        required: true,
      },
    ],
    sentence: (args) => `Looking up ${String(args.nick)}`,
    run: (args) => {
      const nick = String(args.nick);
      if (isAutomaticGuest(nick)) {
        return {
          ok: false,
          sentence: `${nick} is an automatic guest nick`,
          observation: `${nick} is an automatic guest nick. Do not greet or address them.`,
        };
      }
      const regular = findRegular(nick);
      if (!regular) {
        return {
          ok: false,
          sentence: `No such nick ${nick}`,
          observation: `Nobody called ${nick} is in the channel.`,
        };
      }
      return {
        ok: true,
        sentence: `Facts for ${regular.nick}`,
        observation: regular.persona || `${regular.nick} is here.`,
      };
    },
  };
}

function historyMessages(request: BrainRequest) {
  return request.history.map((turn) => ({
    role:
      turn.nick === request.regular.nick
        ? ("assistant" as const)
        : ("user" as const),
    content:
      turn.nick === request.regular.nick
        ? turn.text
        : `<${turn.nick}> ${turn.text}`,
  }));
}

/** One model reply. A failure or an empty answer falls back; an abort stays silent. */
async function speak(
  engine: ChatEngine,
  request: BrainRequest,
  random: () => number,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (signal.aborted) return undefined;
  if (engine.backend().kind !== "model")
    return spokenLine(request.regular, random);
  try {
    let text = "";
    for await (const piece of engine.reply({
      system: systemPromptFor(
        request.regular,
        request.channel,
        request.userNick,
        request.company,
      ),
      messages: [
        ...historyMessages(request),
        ...(request.hint
          ? [{ role: "user" as const, content: request.hint }]
          : []),
      ],
      signal,
      onProgress: () => undefined,
    })) {
      text += piece;
      if (text.length > 600) break;
    }
    return (
      toIrcLine(text, request.regular.nick) ??
      spokenLine(request.regular, random)
    );
  } catch {
    if (signal.aborted) return undefined;
    return spokenLine(request.regular, random);
  }
}
