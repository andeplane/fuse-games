// Independent of the production registration: losing an adapter must fail the browser check.
type PreferenceRole = "button" | "checkbox" | "combobox" | "slider";
interface GameMenu {
  radio: boolean;
  controls: readonly [PreferenceRole, RegExp][];
}
const sharedRadio: GameMenu = {
  radio: true,
  controls: [["slider", /^radio volume$/i]],
};
const radioAndEffects: GameMenu = {
  radio: true,
  controls: [...sharedRadio.controls, ["slider", /effects/i]],
};
export const gameMenus: Readonly<Record<string, GameMenu>> = {
  "ball-bros": { radio: true, controls: [["slider", /^music volume$/i]] },
  dice: sharedRadio,
  "elasto-fuse": radioAndEffects,
  "fuse-axe": sharedRadio,
  "fuse-birds": sharedRadio,
  "fuse-bombers": sharedRadio,
  "fuse-choppers": { radio: true, controls: [["slider", /music volume/i]] },
  "fuse-craft": {
    radio: true,
    controls: [
      ...sharedRadio.controls,
      ["checkbox", /reduced motion/i],
      ["checkbox", /edge scrolling/i],
      ["slider", /effects volume/i],
    ],
  },
  "fuse-drivers": sharedRadio,
  "fuse-freight": sharedRadio,
  "fuse-front": sharedRadio,
  "fuse-lane": sharedRadio,
  "fuse-riders": {
    radio: true,
    controls: [
      ["button", /^analytics (on|off)$/i],
      ["slider", /music volume/i],
      ["slider", /effects volume/i],
    ],
  },
  "fuse-surge": {
    radio: true,
    controls: [
      ...radioAndEffects.controls,
      ["slider", /music/i],
      ["button", /^reactor$/i],
    ],
  },
  "fuse-volley": radioAndEffects,
  fuseball: radioAndEffects,
  fusemania: {
    radio: false,
    controls: [
      ["slider", /effects/i],
      ["slider", /music/i],
      ["button", /^reset keys$/i],
      ["slider", /speed/i],
      ["slider", /input offset/i],
      ["slider", /audio offset/i],
      ["slider", /visual offset/i],
    ],
  },
  fusero: {
    radio: true,
    controls: [...sharedRadio.controls, ["combobox", /keyboard preset/i]],
  },
  "graveyard-shift": sharedRadio,
  "hook-havok": {
    radio: true,
    controls: [
      ["checkbox", /atmosphere/i],
      ["checkbox", /touch controls/i],
      ["combobox", /your controls/i],
      ...sharedRadio.controls,
      ["checkbox", /follow keepers/i],
      ["slider", /effects volume/i],
    ],
  },
  "killer-fuse": {
    radio: true,
    controls: [
      ...sharedRadio.controls,
      ["checkbox", /hold to flap/i],
      ["checkbox", /sound effects/i],
    ],
  },
};
