/*
 * Physical masks extracted without alteration from OpenLieroX Classic data.
 * Upstream: 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Hole colour semantics: black=transparent, pink=removed dirt, brown=placed dirt rim.
 * Retain upstream license notices distributed with this port.
 */
export interface TerrainMask {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
  readonly sha256: string;
}
export const HOLE_1: TerrainMask = {
  width: 5,
  height: 5,
  rows: [".b#b.", "b###b", "#####", "b###b", ".b#b."],
  sha256: "5f3a1a757760b00c4eb89ab0c6a469160c8a086092c721f8466c1b2658a397c9",
};
export const HOLE_2: TerrainMask = {
  width: 7,
  height: 7,
  rows: [
    ".b###b.",
    "b#####b",
    "#######",
    "#######",
    "#######",
    "b#####b",
    ".b###b.",
  ],
  sha256: "946884055fed86c87ba28ec83b875f8e2fd02c68dde8171164ba0a50732c06dc",
};
export const HOLE_3: TerrainMask = {
  width: 9,
  height: 9,
  rows: [
    "...bbb...",
    ".b#####b.",
    ".#######.",
    "b#######b",
    "b#######b",
    "b#######b",
    ".#######.",
    ".b#####b.",
    "...bbb...",
  ],
  sha256: "f81617c32a2bce8226a7e3103cdb546f3af78560ed0fd3b3fa96399988ed99dd",
};
export const HOLE_4: TerrainMask = {
  width: 11,
  height: 11,
  rows: [
    "...b###b...",
    ".b######b..",
    ".########b.",
    ".#########.",
    "b#########b",
    "###########",
    "###########",
    "b#########b",
    ".#########.",
    ".b#######b.",
    "..b####b...",
  ],
  sha256: "b732b46cba6e4ed84de806915236e96fc9d96064e54ecfbcf9aa8beae1306792",
};
export const HOLE_5: TerrainMask = {
  width: 15,
  height: 15,
  rows: [
    "....b####b.....",
    "...b#######b...",
    "..b#########b..",
    ".b###########b.",
    ".#############.",
    "b#############b",
    "###############",
    "###############",
    "###############",
    "b##############",
    ".#############b",
    ".#############.",
    ".b###########b.",
    "..b#########b..",
    "....b#####b....",
  ],
  sha256: "d2bfcb64dbc9824f266b9837b1161e7328edd4032c7707c40c74bf3641b3210d",
};
export const GREEN_DIRT_MASK: TerrainMask = {
  width: 8,
  height: 9,
  rows: [
    "....b...",
    ".b####b.",
    ".######b",
    "b#######",
    "########",
    "#######b",
    "b######.",
    ".b####b.",
    "...bbb..",
  ],
  sha256: "c1c6c2f74b98faccf4b53d4443660dbdd8ba3bbc65a907a9b308b0a30ab1d06c",
};
export const HOLE_MASKS: readonly TerrainMask[] = [
  HOLE_1,
  HOLE_2,
  HOLE_3,
  HOLE_4,
  HOLE_5,
];
