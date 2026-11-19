/** C-Dogs DOS v1.06 campaign records. Coordinates in a mission are tile coordinates. */
export interface Objective {
  description: string;
  kind: "kill" | "collect" | "destroy" | "rescue" | "investigate";
  /** Index into the mission's special-character, prop, or pickup bank, depending on kind. */
  index: number;
  count: number;
  required: number;
  flags: number;
}

export interface Mission {
  title: string;
  description: string;
  wallStyle: number;
  floorStyle: number;
  roomStyle: number;
  exitStyle: number;
  keyStyle: number;
  doorStyle: number;
  /** Zero selects the full 64-tile extent in the DOS generator. */
  width: number;
  height: number;
  walls: number;
  wallLength: number;
  rooms: number;
  squares: number;
  exit: { left: number; top: number; right: number; bottom: number } | null;
  objectives: Objective[];
  enemies: number[];
  specials: number[];
  items: { index: number; density: number }[];
  enemyDensity: number;
  allowedWeapons: number[];
  song: string;
  map: string;
  wallRange: number;
  floorRange: number;
  roomRange: number;
  altRange: number;
}

export interface Character {
  armedBody: number;
  unarmedBody: number;
  face: number;
  /** 256 units per pixel. */
  speed: number;
  move: number;
  track: number;
  shoot: number;
  delay: number;
  gun: number;
  skin: number;
  arms: number;
  body: number;
  legs: number;
  hair: number;
  hp: number;
  flags: number;
}

export interface Campaign {
  id: string;
  title: string;
  author: string;
  description: string;
  missions: Mission[];
  characters: Character[];
}

export interface OffsetSprite {
  id: number;
  dx: number;
  dy: number;
}

export interface Prop {
  offsetSprite: number;
  wreckOffsetSprite: number;
  halfWidth: number;
  halfHeight: number;
  hp: number;
  flags: number;
  sprite: OffsetSprite;
  wreck: OffsetSprite | null;
}
