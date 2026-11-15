/* Altered TypeScript port of CWormBotInputHandler::initWeaponSelection,
 * OpenLieroX 0a20c6d0a10ed63b28a15f05c771913c294efbf6, CWormBot.cpp:4129–4192.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors; LGPL.
 */
import { CLASSIC_WEAPONS } from "./catalog.js";
import { allowedWeaponIds, randomLoadout } from "./match.js";
import type {
  ClassicLoadout,
  ClassicSettings,
  MatchRandom,
} from "./match-types.js";

export type BotGameType = "rifles" | "100lt" | "other";

/** Classic-specific source branches; the Modern Warfare preset belongs to another mod. */
export function nativeBotArsenal(
  settings: ClassicSettings,
  random: MatchRandom,
): { gameType: BotGameType; loadout: ClassicLoadout } {
  const enabled = new Set(allowedWeaponIds(settings));
  const weapon = (name: string): number =>
    CLASSIC_WEAPONS.find((entry) => entry.name === name)!.id;
  const loadingTime = Math.trunc(settings.loadingTime);
  if (loadingTime > 15 && loadingTime < 26) {
    const rifle = weapon("Rifle");
    if (enabled.has(rifle))
      return {
        gameType: "rifles",
        loadout: [rifle, rifle, rifle, rifle, rifle],
      };
  } else if (loadingTime === 100) {
    const loadout: ClassicLoadout = [
      weapon("Super Shotgun"),
      weapon("Napalm"),
      weapon("Cannon"),
      weapon("Doomsday"),
      weapon("Chaingun"),
    ];
    if (loadout.every((id) => enabled.has(id)))
      return { gameType: "100lt", loadout };
  }
  return { gameType: "other", loadout: randomLoadout(settings, random) };
}
