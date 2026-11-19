import { machineTimeMs, type Machine } from "../game/machine.js";

/** Draw behind the room clock by one room update plus one physics step so both endpoints are known. */
const delayMs = 50 + machineTimeMs(1);

export class BodyPlayback {
  private samples: Machine[] = [];
  private origin = 0;
  private puzzle = -1;

  update(machine: Machine, now: number) {
    if (machine.mode === "build" || machine.puzzle !== this.puzzle)
      this.samples = [];
    this.puzzle = machine.puzzle;
    if (
      machine.mode === "build" ||
      (!this.samples.length && machine.mode !== "running")
    )
      return;
    const last = this.samples.at(-1);
    if (
      last?.tick === machine.tick &&
      last.mode === machine.mode &&
      last.active.length === machine.active.length &&
      last.active.every((id, i) => id === machine.active[i]) &&
      last.broken.length === machine.broken.length &&
      last.broken.every((id, i) => id === machine.broken[i]) &&
      last.bodies.length === machine.bodies.length &&
      last.bodies.every((b, i) => {
        const n = machine.bodies[i]!;
        return (
          b.id === n.id &&
          b.x === n.x &&
          b.y === n.y &&
          b.vx === n.vx &&
          b.vy === n.vy
        );
      })
    )
      return;
    if (last && (machine.tick <= last.tick || machine.tick - last.tick > 2))
      this.samples = [];
    this.samples.push({
      ...machine,
      active: [...machine.active],
      broken: [...machine.broken],
      bodies: machine.bodies.map((b) => ({ ...b })),
    });
    if (this.samples.length > 5) this.samples.shift();
    const measured = now - machineTimeMs(machine.tick, machine.phase);
    const drift = measured - this.origin;
    if (this.samples.length === 1 || Math.abs(drift) > delayMs)
      this.origin = measured;
    else this.origin += Math.max(-1, Math.min(1, drift));
  }

  pending(now: number) {
    const end = this.samples.at(-1);
    return !!end && now < this.origin + delayMs + machineTimeMs(end.tick);
  }

  sample(machine: Machine, now: number): Machine {
    if (!this.samples.length) return machine;
    const time = now - this.origin - delayMs;
    const i = this.samples.findIndex((s) => machineTimeMs(s.tick) >= time);
    if (i < 0) return this.samples.at(-1)!;
    const end = this.samples[i]!;
    if (i === 0 || time >= machineTimeMs(end.tick)) return end;
    const start = this.samples[i - 1]!;
    const fraction =
      (time - machineTimeMs(start.tick)) / machineTimeMs(end.tick - start.tick);
    const destinations = new Map(end.bodies.map((b) => [b.id, b]));
    const bodies = start.bodies.map((p) => {
      const b = destinations.get(p.id);
      return b
        ? {
            ...p,
            x: p.x + (b.x - p.x) * fraction,
            y: p.y + (b.y - p.y) * fraction,
          }
        : p;
    });
    return {
      ...start,
      tick: start.tick + fraction * (end.tick - start.tick),
      bodies,
    };
  }
}
