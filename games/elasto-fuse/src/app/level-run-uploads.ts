import type { LevelRun } from "../level-times.js";

/** What sending a run to the level board needs from the page: an account token and the POST. */
export interface LevelRunPorts {
  /** The signed-in account's token, or nothing when signed out. */
  token(): Promise<string | undefined>;
  /** Sends one run; true when it made the level's top list. Throws when it was not saved. */
  post(run: LevelRun, token: string): Promise<boolean>;
}

/** One finished run on its way to its level's board, as the result screen shows it. */
export interface LevelRunUpload {
  /** The race it was ridden in, `matchId:round`. */
  race: string;
  run: LevelRun;
  status: string;
  /** Not saved: a retry may send it again. */
  failed: boolean;
}

/** Runs kept for the result screen and for a sign-in that comes later; one device rides a bounded number. */
const KEEP = 32;
const SIGN_IN = "Sign in to save your time";

/**
 * Sends every run this device finishes, solo or in a room, to its level's board once: the board keeps each account's
 * best, so every finish counts towards it. A run finished signed out waits and is sent once the rider signs in.
 */
export function createLevelRunUploads(
  ports: LevelRunPorts,
  changed: () => void = () => {},
) {
  const uploads: LevelRunUpload[] = [];
  const sending = new Set<LevelRunUpload>();
  /** Finished signed out: sent once the rider signs in. */
  const waiting = new Set<LevelRunUpload>();
  const send = async (upload: LevelRunUpload) => {
    if (sending.has(upload)) return;
    sending.add(upload);
    upload.status = "Verifying time…";
    upload.failed = false;
    changed();
    try {
      const token = await ports.token();
      // Signed in, yet no token now (a refresh in flight): a retry can send it.
      if (!token) throw new Error("No account token");
      upload.status = (await ports.post(upload.run, token))
        ? "Leaderboard time saved"
        : "Verified outside the top 100";
    } catch {
      upload.status = "Could not save leaderboard time";
      upload.failed = true;
    } finally {
      sending.delete(upload);
      changed();
    }
  };
  return {
    /** A finished run: sent now when signed in, otherwise kept until `signedIn`. Each race's run is taken once. */
    offer(race: string, run: LevelRun, signedIn: boolean): void {
      if (uploads.some((upload) => upload.race === race)) return;
      const upload = { race, run, status: SIGN_IN, failed: true };
      uploads.push(upload);
      if (uploads.length > KEEP) waiting.delete(uploads.shift()!);
      if (signedIn) void send(upload);
      else {
        waiting.add(upload);
        changed();
      }
    },
    /** The rider is signed in: send what waited for it. */
    signedIn(): void {
      for (const upload of waiting) {
        waiting.delete(upload);
        if (uploads.includes(upload)) void send(upload);
      }
    },
    /** Send again what this match did not save. */
    retry(match: string): void {
      for (const upload of uploads)
        if (upload.failed && upload.race.startsWith(`${match}:`))
          void send(upload);
    },
    /** What the result screen says about this match's runs: the latest one's status, and whether any can be retried. */
    summary(match: string): { status: string; failed: boolean } | undefined {
      const mine = uploads.filter((upload) =>
        upload.race.startsWith(`${match}:`),
      );
      const latest = mine.at(-1);
      if (!latest) return;
      const failed = mine.some(
        (upload) => upload.failed && upload.status !== SIGN_IN,
      );
      if (mine.length === 1) return { status: latest.status, failed };
      const saved = mine.filter(
        (upload) => !upload.failed && !sending.has(upload),
      ).length;
      return {
        status: `${saved} of ${mine.length} times sent to the level boards`,
        failed,
      };
    },
  };
}
