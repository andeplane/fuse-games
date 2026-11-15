/** Stable game-owned bot identity, shared by the room and its server registration. */
export const isHunterBot = (id: string) => /^bot:[0-9]+$/.test(id);
