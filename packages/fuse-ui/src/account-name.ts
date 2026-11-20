import { MAX_PLAYER_NAME as MAX_ACCOUNT_NAME } from "fuse-platform/player-name";

export { MAX_ACCOUNT_NAME };
export { validPlayerName as validAccountName } from "fuse-platform/player-name";

export const suggestAccountName = (name: string): string =>
  Array.from(
    name
      .replace(/[\u0000-\u001f\u007f]|\p{Cs}/gu, "")
      .trim()
      .split(/\s+/)[0] ?? "",
  )
    .slice(0, MAX_ACCOUNT_NAME)
    .join("");
