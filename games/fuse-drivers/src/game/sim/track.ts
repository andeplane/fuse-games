export interface Point {
  x: number;
  y: number;
}
export interface Segment {
  a: Point;
  b: Point;
}
export interface Checkpoint {
  a: Point;
  b: Point;
  mid: Point;
}
export interface Spawn extends Point {
  heading: number;
}

/** Course metadata and projected screen coordinates used by the race presentation. */
export interface Track {
  name: string;
  cols: number;
  rows: number;
  tile: number;
  checkpoints: Checkpoint[];
  spawns: Spawn[];
  waypoints: Point[];
}
