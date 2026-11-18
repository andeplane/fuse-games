/** All dimensions describe the workshop drawing and its contact geometry in pixels. */
function part(name: string, width: number, height: number, hint: string) {
  return { name, width, height, hint };
}

export const PARTS = {
  ball: part(
    "Steel marble",
    18,
    18,
    "Rolls down slopes and responds to magnets.",
  ),
  bowling: part("Bowling ball", 32, 32, "Heavy, magnetic and slow to rebound."),
  basketball: part(
    "Basketball",
    32,
    32,
    "A lively rebound carries it over obstacles.",
  ),
  baseball: part("Baseball", 22, 22, "A small, dense ball with a low rebound."),
  tennis: part("Tennis ball", 18, 18, "Light and bouncy; wind can steer it."),
  balloon: part("Balloon", 30, 44, "Floats upward. A fan blows it sideways."),
  heart: part("Heart balloon", 34, 42, "Floats upward and can pull a cord."),
  crate: part(
    "Parcel",
    28,
    28,
    "Falls, slides, presses plates and rides conveyors.",
  ),
  ramp: part(
    "Incline",
    112,
    44,
    "Turns a fall into a roll. Flip to reverse the slope.",
  ),
  shelf: part("Work shelf", 100, 12, "A level landing surface."),
  wall: part("Brick wall", 76, 24, "Provides a firm rebound."),
  timber: part("Timber beam", 82, 16, "A wooden landing or obstacle."),
  spring: part("Trampoline", 58, 18, "Launches falling objects back upward."),
  belt: part(
    "Conveyor",
    100,
    20,
    "Carries objects along its top. Flip to reverse.",
  ),
  fan: part("Desk fan", 44, 48, "Blows to the right. Flip it to face left."),
  magnet: part(
    "Horseshoe magnet",
    42,
    38,
    "Attracts nearby steel marbles and bowling balls.",
  ),
  switch: part(
    "Pressure switch",
    42,
    14,
    "Press to power the circuit and raise its shutters.",
  ),
  gate: part("Shutter", 18, 80, "Blocks objects until the circuit is powered."),
  gear: part(
    "Cogwheel",
    32,
    32,
    "Touching cogs transmit rotation from a driver.",
  ),
  basket: part(
    "Catch basket",
    68,
    38,
    "Catches an object that drops through its mouth.",
  ),
  bell: part(
    "Service bell",
    44,
    28,
    "Rings when struck or when its cord is pulled.",
  ),
  domino: part(
    "Domino",
    12,
    44,
    "Tips toward its neighbor. Flip to topple left.",
  ),
  seesaw: part(
    "Rocker",
    96,
    24,
    "The falling weight tips the rocker and kicks its other end.",
  ),
  mouseWheel: part(
    "Mouse wheel",
    56,
    52,
    "A nearby mouse powers this mechanical driver.",
  ),
  pulley: part("Pulley", 28, 28, "Links two lengths of cord."),
  rope: part(
    "Pull cord",
    12,
    84,
    "A vertical link. Couple its tips to parts or pulleys.",
  ),
  driveBelt: part(
    "Drive belt",
    82,
    16,
    "Couples two mechanical parts across a horizontal gap.",
  ),
  cage: part(
    "Pet carrier",
    58,
    54,
    "Catches a mouse or cat arriving from the side.",
  ),
  cat: part(
    "Workshop cat",
    54,
    32,
    "Walks toward nearby mice and fish. Flip its starting direction.",
  ),
  jack: part("Jack box", 38, 46, "Contact releases an upward kick."),
  fish: part(
    "Fishbowl",
    40,
    42,
    "Attracts cats. Rings when a moving object touches it.",
  ),
  bellows: part(
    "Bellows",
    50,
    30,
    "Press or pull to start a horizontal air stream.",
  ),
  popper: part(
    "Ball dispenser",
    54,
    38,
    "Press or pull to release a rubber ball.",
  ),
  spark: part(
    "Confetti drum",
    30,
    36,
    "Passes a contact pulse to nearby props.",
  ),
  outlet: part(
    "Outlet switch",
    46,
    26,
    "Contact energizes lamps, motors and shutters.",
  ),
  plunger: part("Push button", 34, 28, "Press to start the circuit."),
  eyelet: part("Cord eyelet", 16, 16, "Guides a pull cord around a corner."),
  lamp: part(
    "Work light",
    42,
    30,
    "On contact or power, shines toward a solar cell or lens.",
  ),
  generator: part(
    "Dynamo",
    48,
    42,
    "Converts a turning gear or belt into circuit power.",
  ),
  bulb: part("Pilot light", 28, 42, "Lights when the circuit is powered."),
  lens: part("Glass lens", 36, 42, "Focuses a nearby beam to light a candle."),
  monkey: part(
    "Clockwork ape",
    46,
    56,
    "Winds a coupled drive when it is nudged.",
  ),
  pumpkin: part("Pumpkin", 36, 34, "Rolls with a muted rebound."),
  tree: part("Fir tree", 44, 64, "A fixed obstacle to bank objects around."),
  glove: part(
    "Spring mitt",
    44,
    30,
    "Contact or a pull gives nearby objects a horizontal shove.",
  ),
  rocket: part(
    "Air rocket",
    28,
    50,
    "Lifts off when touched or when a nearby candle lights.",
  ),
  scissors: part(
    "Shears",
    40,
    26,
    "When nudged, interrupt transfer through neighboring cords.",
  ),
  solar: part("Solar cell", 48, 28, "A directed beam powers the circuit."),
  windmill: part("Pinwheel", 54, 64, "An air stream turns its shaft."),
  mouse: part("Wind-up mouse", 34, 20, "Walks ahead and runs away from cats."),
  candle: part(
    "Birthday candle",
    16,
    42,
    "A focused beam lights its wick and triggers nearby props.",
  ),
  pipe: part(
    "Drop tube",
    38,
    64,
    "Guides a falling object vertically through its bore.",
  ),
  elbow: part(
    "Curved chute",
    52,
    50,
    "Sends an incoming object sideways. Flip to reverse.",
  ),
  motor: part(
    "Electric motor",
    48,
    36,
    "Circuit power turns an adjacent gear or drive belt.",
  ),
} as const;
export type PartKind = keyof typeof PARTS;
export const PART_KINDS = Object.keys(PARTS) as PartKind[];
export const isPartKind = (kind: unknown): kind is PartKind =>
  typeof kind === "string" && Object.hasOwn(PARTS, kind);

/** The replica and renderer share these immutable drawing dimensions. */
export const WIDTH = 640;
export const HEIGHT = 400;
export interface Part {
  id: number;
  kind: PartKind;
  x: number;
  y: number;
  flip: boolean;
  fixed: boolean;
  width?: number;
  height?: number;
  rotation?: 0 | 1;
}
export const canRotate = (kind: PartKind): boolean =>
  ["shelf", "timber", "wall", "pipe", "driveBelt", "rope"].includes(kind);
export function partSize(p: Part): { width: number; height: number } {
  const width = p.width ?? PARTS[p.kind].width,
    height = p.height ?? PARTS[p.kind].height;
  return p.rotation ? { width: height, height: width } : { width, height };
}
export interface Body {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface Puzzle {
  title: string;
  goal: string;
  parts: Part[];
  stock: Partial<Record<PartKind, number>>;
  /** All of these fixed parts must have activated. */
  targets: number[];
}

const WORKSHOP: Puzzle = {
  title: "Free workshop",
  goal: "Build a machine from the parts tray, connect it and press Run.",
  parts: [],
  stock: Object.fromEntries(PART_KINDS.map((kind) => [kind, 20])),
  targets: [],
};
export function getPuzzle(index: number): Puzzle {
  if (index === FREE_WORKSHOP) return WORKSHOP;
  const result = PUZZLES[index];
  if (!result) throw new RangeError("Unknown workshop puzzle");
  return result;
}

type Placement = [kind: PartKind, x: number, y: number, flip?: boolean];
function puzzle(
  title: string,
  goal: string,
  placements: Placement[],
  stock: Puzzle["stock"],
  targets: number[],
): Puzzle {
  return {
    title,
    goal,
    stock,
    targets,
    parts: placements.map(([kind, x, y, flip = false], index) => ({
      kind,
      x,
      y,
      flip,
      fixed: true,
      id: index + 1,
    })),
  };
}

export const PUZZLES: readonly Puzzle[] = [
  puzzle(
    "Special delivery",
    "Guide the steel marble into the woven basket.",
    [
      ["ball", 160, 60],
      ["basket", 306, 288],
    ],
    { ramp: 1 },
    [2],
  ),
  puzzle(
    "Return to sender",
    "Send the tennis ball left into the delivery basket.",
    [
      ["tennis", 450, 60],
      ["basket", 304, 288],
    ],
    { ramp: 1, shelf: 1 },
    [2],
  ),
  puzzle(
    "Conveyor crossing",
    "Bridge the loading bay and catch the parcel.",
    [
      ["crate", 180, 64],
      ["basket", 386, 308],
      ["belt", 264, 220],
    ],
    { belt: 1, ramp: 1 },
    [2],
  ),
  puzzle(
    "A little draft",
    "Blow the rising balloon across to the service bell.",
    [
      ["balloon", 150, 330],
      ["bell", 240, 175],
    ],
    { fan: 1, shelf: 1 },
    [2],
  ),
  puzzle(
    "Night shift",
    "Press the outlet switch with the baseball to light the pilot lamp.",
    [
      ["baseball", 340, 58],
      ["outlet", 486, 280],
      ["bulb", 510, 116],
    ],
    { ramp: 1, belt: 1 },
    [2, 3],
  ),
  puzzle(
    "The last domino",
    "Tip the domino line and ring the bell at the far end.",
    [
      ["bowling", 160, 58],
      ["domino", 304, 292],
      ["domino", 350, 292],
      ["bell", 398, 306],
    ],
    { ramp: 1, domino: 2 },
    [2, 3, 4],
  ),
  puzzle(
    "Wind-up radio",
    "Spin the pinwheel and use the dynamo to light the bulb.",
    [
      ["fan", 104, 216],
      ["windmill", 235, 216],
      ["generator", 380, 216],
      ["bulb", 480, 140],
    ],
    { gear: 2, driveBelt: 1 },
    [2, 3, 4],
  ),
  puzzle(
    "Workshop sunrise",
    "Press the work light and focus its beam onto the candle.",
    [
      ["bowling", 112, 58],
      ["lamp", 112, 242],
      ["candle", 330, 242],
    ],
    { lens: 1, eyelet: 1 },
    [2, 3],
  ),
  puzzle(
    "Cat and courier",
    "Return the wind-up mouse to the pet carrier.",
    [
      ["mouse", 120, 170],
      ["shelf", 118, 216],
      ["cage", 310, 220],
      ["cat", 56, 164],
    ],
    { belt: 2, ramp: 1 },
    [3],
  ),
  puzzle(
    "Around the bend",
    "Guide the basketball through the curved chute and into the basket.",
    [
      ["basketball", 160, 55],
      ["basket", 288, 294],
    ],
    { pipe: 1, elbow: 1, ramp: 1 },
    [2],
  ),
  puzzle(
    "Pull to ring",
    "The balloon pulls a cord. Connect the guides to ring the service bell.",
    [
      ["heart", 220, 315],
      ["pulley", 220, 185],
      ["bell", 288, 108],
    ],
    { rope: 2, eyelet: 1, driveBelt: 1 },
    [3],
  ),
  puzzle(
    "Morning rounds",
    "Close the switch, lift the shutter and deliver the bowling ball.",
    [
      ["baseball", 110, 64],
      ["switch", 110, 260],
      ["gate", 318, 198],
      ["bowling", 245, 56],
      ["basket", 398, 296],
    ],
    { ramp: 1, belt: 1, shelf: 1 },
    [2, 5],
  ),
];
export const FREE_WORKSHOP = PUZZLES.length;
