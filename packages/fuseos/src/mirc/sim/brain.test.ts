import type { AgentCompletionRequest } from "../../llm/agentLoop";
import type { ChatEngine, ReplyRequest } from "../../llm/llmChat";

import { cannedBrain, cannedLine, engineBrain, toIrcLine } from "./brain";
import type { Regular } from "./regulars";
import {
  findRegular,
  isAutomaticGuest,
  regularsIn,
  scrubGuestNick,
  systemPromptFor,
} from "./regulars";

function regular(nick: string): Regular {
  const found = findRegular(nick);
  if (!found) throw new Error(nick);
  return found;
}

class FakeEngine implements ChatEngine {
  readonly requests: ReplyRequest[] = [];
  disposed = false;
  constructor(
    private readonly answer: string | Error,
    private readonly kind: "model" | "rules" = "model",
  ) {}
  backend() {
    return this.kind === "model"
      ? ({ kind: "model", modelId: "m", label: "Tiny Model" } as const)
      : ({ kind: "rules", reason: "x" } as const);
  }
  async *reply(request: ReplyRequest) {
    this.requests.push(request);
    if (this.answer instanceof Error) throw this.answer;
    for (const piece of this.answer.match(/.{1,5}/gs) ?? []) yield piece;
  }
  loads = 0;
  ready() {
    this.loads += 1;
    return Promise.resolve();
  }
  dispose() {
    this.disposed = true;
  }
}

const signal = new AbortController().signal;
const request = (nick: string) => ({
  regular: regular(nick),
  channel: "#ddrnorway",
  userNick: "Guest1",
  history: [
    { nick: "Guest1", text: "hei RiChY" },
    { nick: "RiChY", text: "hei" },
  ],
});

describe("regulars", () => {
  it("seats the AI-voiced real regulars and fictional ones in #ddrnorway", () => {
    const nicks = regularsIn("#DDRnorway").map((r) => r.nick);
    expect(nicks).toEqual(
      expect.arrayContaining([
        "RiChY",
        "Andeplane",
        "Zredna",
        "CCBSbot",
        "stepzilla",
      ]),
    );
    expect(regular("richy").ai).toBe(true);
    expect(regular("FootieFox").ai).toBe(false);
  });

  it("tells the model who it is, its CCBS record, and not to speak for others", () => {
    const prompt = systemPromptFor(
      regular("Andeplane"),
      "#ddrnorway",
      "Guest1",
    );
    expect(prompt).toContain("You are Andeplane");
    expect(prompt).toContain("ranked tournaments");
    expect(prompt).toContain(
      "Never speak for, quote or pretend to be anyone else",
    );
    expect(prompt).not.toContain("with Guest1");
    expect(prompt).toContain("Never greet or address a nick that is Guest");
    expect(
      systemPromptFor(regular("Andeplane"), "#ddrnorway", "Acid_Burn"),
    ).toContain("with Acid_Burn");
    expect(isAutomaticGuest("Guest1540")).toBe(true);
    expect(isAutomaticGuest("Guest")).toBe(false);
    expect(scrubGuestNick("hei Guest1540 :)", "Guest1540")).toBe("hei :)");
    expect(scrubGuestNick("Guest1", "Guest1")).toBeUndefined();
    expect(scrubGuestNick("hei Abra", "Guest1")).toBe("hei Abra");
  });
});

describe("brains", () => {
  it("picks canned lines deterministically", async () => {
    expect(cannedLine(regular("Zredna"), () => 0)).toBe("hehe");
    expect(cannedLine(regular("CCBSbot"), () => 0)).toBeUndefined();
    const brain = cannedBrain(() => 0);
    expect(brain.describe()).toContain("canned");
    expect(await brain.reply(request("Zredna"), signal)).toBe("hehe");
    brain.dispose();
  });

  it("cleans a model reply down to one IRC line", () => {
    expect(toIrcLine('<RiChY>: "hei på deg!"\nsecond line', "RiChY")).toBe(
      "hei på deg!",
    );
    expect(toIrcLine("RiChY: ok", "RiChY")).toBe("ok");
    expect(toIrcLine("  \n ", "RiChY")).toBeUndefined();
    expect(toIrcLine('""', "RiChY")).toBeUndefined();
    expect(toIrcLine("x".repeat(400), "RiChY")).toHaveLength(300);
  });

  it("asks the shared engine for AI regulars, with the channel as the conversation", async () => {
    const engine = new FakeEngine("<RiChY> klart, søndag!");
    const brain = engineBrain(engine, () => 0);
    expect(brain.describe()).toBe("Tiny Model, running in this browser");
    expect(await brain.reply(request("RiChY"), signal)).toBe("klart, søndag!");
    const sent = engine.requests[0];
    expect(sent?.system).toContain("You are RiChY");
    expect(sent?.messages).toEqual([
      { role: "user", content: "<Guest1> hei RiChY" },
      { role: "assistant", content: "hei" },
    ]);
    sent?.onProgress("loading");
    brain.dispose();
    expect(engine.disposed).toBe(true);
    expect(brain.usesModel()).toBe(true);
    expect(await brain.prepare(signal)).toBe(true);
    expect(engine.loads).toBe(1);
    const snuteEngine = new FakeEngine("ok");
    const snute = engineBrain(snuteEngine, () => 0);
    expect(
      await snute.reply(
        { ...request("Snute"), company: ["Abra", "Al"] },
        signal,
      ),
    ).toBe("ok");
    expect(snuteEngine.requests.at(-1)?.system).toContain(
      "conversation with Abra, Al",
    );
    expect(snuteEngine.requests.at(-1)?.system).toContain("36 tournaments");
    const rules = engineBrain(new FakeEngine("", "rules"), () => 0);
    expect(rules.usesModel()).toBe(false);
    expect(await rules.prepare(signal)).toBe(false);
    expect(
      await cannedBrain(() => 0).reply(request("Snute"), signal),
    ).toContain("36 turneringer");
  });

  it("uses canned lines for non-AI regulars, failures and empty answers", async () => {
    const quiet = engineBrain(new FakeEngine("", "rules"), () => 0);
    expect(quiet.describe()).toBe("canned lines");
    expect(await quiet.reply(request("RiChY"), signal)).toBe(
      regular("RiChY").lines[0],
    );
    expect(await quiet.reply(request("FootieFox"), signal)).toBe("*gjesp*");
    const failing = engineBrain(new FakeEngine(new Error("no gpu")), () => 0);
    expect(await failing.reply(request("Zredna"), signal)).toBe("hehe");
    const empty = engineBrain(new FakeEngine(""), () => 0);
    expect(await empty.reply(request("Snute"), signal)).toContain(
      "36 turneringer",
    );
    const slow = engineBrain(new FakeEngine("x".repeat(700)), () => 0);
    expect((await slow.reply(request("RiChY"), signal))?.length).toBe(300);
  });

  it("looks a player up with a tool call before the line, and never for a guest nick", async () => {
    const engine = new ToolEngine();
    const brain = engineBrain(engine, () => 0);
    const line = await brain.reply(
      {
        ...request("RiChY"),
        hint: "Say hei to Abra. One short line.",
        company: ["Abra"],
      },
      signal,
    );
    expect(line).toBe("hei Abra");
    expect(engine.calls).toContain("player_facts");
    const guest = await brain.reply(
      { ...request("RiChY"), hint: "Say hei to Guest1." },
      signal,
    );
    expect(guest).toBe("hei Abra");
    const refused = engine.facts.find((fact) => fact.includes("guest"));
    expect(refused).toContain("Do not greet");
  });

  it("lets a second AI reply wait for the model instead of the tournament count", async () => {
    const engine = new HoldingEngine();
    const brain = engineBrain(engine, () => 0);
    const first = brain.reply(request("RiChY"), signal);
    await tick();
    expect(engine.requests).toHaveLength(1);
    const snute = brain.reply(request("Snute"), signal);
    expect(await brain.reply(request("FootieFox"), signal)).toBe("*gjesp*");
    expect(engine.requests).toHaveLength(1);
    let snuteDone = false;
    void snute.then(() => {
      snuteDone = true;
    });
    await tick();
    expect(snuteDone).toBe(false);
    engine.open();
    expect(await first).toBe("linje");
    expect(await snute).toBe("linje");
    expect(engine.requests).toHaveLength(2);
    expect(snuteDone).toBe(true);
  });
});

/** A model that does not answer until `open`, so a second reply can be observed waiting. */
class HoldingEngine implements ChatEngine {
  readonly requests: ReplyRequest[] = [];
  private release: () => void = () => undefined;
  private readonly opened = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  open() {
    this.release();
  }
  backend() {
    return { kind: "model" as const, modelId: "m", label: "Hold" };
  }
  async *reply(request: ReplyRequest) {
    this.requests.push(request);
    await this.opened;
    yield "linje";
  }
  dispose() {}
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A model that calls player_facts for the nick in the hint, then answers. */
class ToolEngine extends FakeEngine {
  readonly calls: string[] = [];
  readonly facts: string[] = [];
  constructor() {
    super("unused");
  }
  loopStyle() {
    return "json" as const;
  }
  async complete(
    step: AgentCompletionRequest & { onProgress: (text: string) => void },
  ) {
    const last = step.messages.at(-1)?.content ?? "";
    if (last.startsWith("Result of ")) {
      this.facts.push(last);
      return { text: '{"tool":"answer","args":{"text":"hei Abra"}}' };
    }
    const nick =
      /Say hei to ([A-Za-z0-9[\]\\`_^{|}-]+)/.exec(last)?.[1] ?? "Abra";
    this.calls.push("player_facts");
    return {
      text: JSON.stringify({ tool: "player_facts", args: { nick } }),
    };
  }
}
