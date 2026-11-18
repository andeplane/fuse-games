/** 0434:063e stores the remainder as the next seed and returns that word minus one. */
export function nextOffroadSeed(seed: number): number {
  return (((seed + 1) & 65535) * 171) % 30323;
}
