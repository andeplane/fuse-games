/** Stable game-owned bot identity, shared by the room and its server registration. */
export const isFrontBot = (id: string) => /^bot:[0-5]$/.test(id);
