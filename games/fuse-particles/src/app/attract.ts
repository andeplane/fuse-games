import type { AttractDriver } from "fuse-ui";
import { createBattle, tickBattle } from "../game/simulation.js";
import { createArena } from "./arena.js";

export function createAttract(host: HTMLElement): AttractDriver {
  const arena = createArena();
  arena.element.classList.add("fp-attract");
  host.append(arena.element);
  let battle = createBattle(1729, "random", [true, true]);
  for (let tick = 0; tick < 700; tick++) tickBattle(battle);
  return {
    advance() {
      if (battle.winner !== null)
        battle = createBattle(1729, "random", [true, true]);
      tickBattle(battle);
    },
    render() {
      arena.render(battle, ["Cyan", "Coral"]);
    },
    tick() {
      return battle.tick;
    },
    dispose() {
      arena.element.remove();
    },
  };
}
