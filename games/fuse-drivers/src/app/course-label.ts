// Course titles in the DOS stadium signs; the stable course id travels in the room log.
const TITLES = [
  "Blaster",
  "Big Dukes",
  "Cliffhanger",
  "Sidewinder",
  "Fandango",
  "Hurricane Gulch",
  "Wipeout",
  "Huevos Grande",
] as const;

export function courseLabel(id: string): string {
  const match = /^offroad-([1-8])(-reverse)?$/.exec(id);
  if (!match) return id;
  return TITLES[Number(match[1]) - 1] + (match[2] ? " (reverse)" : "");
}
