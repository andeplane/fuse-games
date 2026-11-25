export {
  seatPlayerName as seatName,
  validPlayerName as validName,
  MAX_PLAYER_NAME as MAX_NAME,
} from "fuse-platform/player-name";

export const CAPACITY = 5;
export const MAX_WATCHERS = 8;
const avatars = [
  "robot",
  "cat",
  "fox",
  "alien",
  "astronaut",
  "skull",
  "octopus",
  "dragon",
  "owl",
  "slime",
];
export const isAvatar = (raw: unknown): raw is string =>
  typeof raw === "string" && avatars.includes(raw);
