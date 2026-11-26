import type { BallView } from "../engine/view.js";

/** One line of the final standings. */
export interface ResultRow {
  id: string;
  slot: number;
  name: string;
  you: boolean;
  bot: boolean;
  /** 1 for whoever still stands; ties share a place. */
  place: number;
  alive: boolean;
  saves: number;
  /** Enemy blocks broken. */
  broken: number;
  /** Own blocks left. */
  armor: number;
}
export type Model = NonNullable<ReturnType<typeof present>>;

/** The HUD is derived from the latest view, including corrected rollback outcomes. */
export function present(
  v: BallView,
  playerId?: string,
  host = false,
  touch = false,
) {
  const s = v.arena;
  if (!s) return undefined;
  const launchHint = touch ? "TAP LAUNCH" : "SPACE TO LAUNCH";
  const solo = playerId === undefined;
  const you = s.bases.find((b) => (solo ? !b.bot : b.id === playerId));
  const effects = (b: (typeof s.bases)[number]) => {
    if (!b.alive) return "";
    const seconds = (until: number) => `${Math.ceil((until - s.tick) / 20)}s`;
    return [
      b.stunUntil > s.tick ? `STUN ${seconds(b.stunUntil)}` : "",
      b.shrink.length
        ? `SHRINK ×${b.shrink.length} ${seconds(b.shrink[0]!)}`
        : "",
      b.stickyUntil > s.tick ? `STICKY ${seconds(b.stickyUntil)}` : "",
      b.thiefUntil > s.tick ? `THIEF ${seconds(b.thiefUntil)}` : "",
      s.balls.some((ball) => ball.owner === b.id && ball.bomb)
        ? "BOMB BALL"
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const seconds = Math.floor(
    Math.max(0, v.rules.limit - Math.max(0, s.tick - v.rules.countdown)) / 20,
  );
  return {
    map: v.rules.maps[s.mapId].label,
    effects: [
      s.tick >= v.rules.frenzy ? `FUSE FRENZY · ${s.balls.length} BALLS` : "",
      you ? effects(you) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    cards: s.bases.map((b) => ({
      slot: b.slot,
      name: `P${b.slot + 1} ${b.name.toUpperCase()}`,
      alive: b.alive,
      armor: b.alive
        ? `${b.blocks.filter((k) => k.alive).length} / ${b.blocks.length}`
        : "CORE LOST",
      label: b.alive ? effects(b) || "ARMOR BLOCKS" : "SPECTATING",
    })),
    time: `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`,
    toast:
      s.phase === "countdown"
        ? `GET READY · ${Math.ceil((v.rules.countdown - s.tick) / 20)}`
        : s.phase === "over"
          ? ""
          : you && !you.alive
            ? "CORE LOST · WATCH THE FINISH"
            : you && s.balls.some((b) => b.held === you.id)
              ? launchHint
              : s.tick >= v.rules.frenzy - v.rules.frenzyWarning &&
                  s.tick < v.rules.frenzy
                ? `FUSE FRENZY IN ${Math.ceil((v.rules.frenzy - s.tick) / 20)}`
                : s.tick >= v.rules.frenzy && s.tick < v.rules.frenzy + 60
                  ? "FUSE FRENZY · BASES ON THE MOVE"
                  : "",
    result: s.phase === "over" ? result(v, s, you?.id, solo, host) : undefined,
  };
}

function result(
  v: BallView,
  s: NonNullable<BallView["arena"]>,
  me: string | undefined,
  solo: boolean,
  host: boolean,
) {
  const winner = s.bases.find((b) => b.id === s.winner);
  // The arena keeps no order of elimination: whoever still stands shares first, the rest share what follows.
  const standing = s.bases.filter((b) => b.alive).length;
  const rows: ResultRow[] = s.bases
    .map((b) => ({
      id: b.id,
      slot: b.slot,
      name: b.name,
      you: b.id === me,
      bot: b.bot,
      place: b.alive || !standing ? 1 : standing + 1,
      alive: b.alive,
      saves: b.saves,
      broken: b.broken,
      armor: b.blocks.filter((k) => k.alive).length,
    }))
    .sort(
      (a, b) =>
        a.place - b.place ||
        b.broken - a.broken ||
        b.saves - a.saves ||
        a.slot - b.slot,
    );
  return {
    title: winner ? `${winner.name.toUpperCase()} WINS` : "ROUND DRAW",
    map: v.rules.maps[s.mapId].label,
    rows,
    /** -1 for a draw. */
    winnerSlot: winner?.slot ?? -1,
    solo,
    /** This device may start the next round. */
    host: solo || host,
    waiting: solo || host ? "" : "Waiting for the host",
  };
}
