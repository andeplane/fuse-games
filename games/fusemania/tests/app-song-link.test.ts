import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  createSongLinkButton,
  SAID_MS,
  songLink,
  songQuery,
} from "../src/app/song-link.js";

const appUrl = (query: string) => `https://fusegames.ai/fusemania/${query}`;

test("a song's link names the song and the level, and nothing of this page's own flags", () => {
  assert.equal(songQuery("final-chase", 2), "?song=final-chase&chart=2");
  assert.equal(
    songLink(appUrl, "final-chase", 2),
    "https://fusegames.ai/fusemania/?song=final-chase&chart=2",
  );
  // An id is data: one with a separator in it cannot add a parameter of its own.
  const query = new URLSearchParams(songQuery("a&room=X", 0));
  assert.equal(query.get("song"), "a&room=X");
  assert.equal(query.has("room"), false);
});

function setup(copies: boolean | "throws" = true) {
  const { document } = parseHTML("<html><body></body></html>");
  const copied: string[] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  let link: string | undefined = appUrl("?song=final-chase&chart=2");
  const share = createSongLinkButton({
    document,
    link: () => link,
    copy: async (text) => {
      if (copies === "throws") throw new Error("denied");
      copied.push(text);
      return copies;
    },
    later(run, ms) {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  document.body.append(share.element);
  const press = async () => {
    share.element.click();
    // The copy is asynchronous: let its promise settle.
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    share,
    copied,
    timers,
    press,
    setLink: (next: string | undefined) => {
      link = next;
    },
  };
}

test("SHARE copies the link for what is selected when it is pressed, and says so for a moment", async () => {
  const { share, copied, timers, press, setLink } = setup();
  assert.equal(share.element.textContent, "SHARE");
  assert.equal(share.element.type, "button");
  await press();
  assert.deepEqual(copied, [appUrl("?song=final-chase&chart=2")]);
  assert.equal(share.element.textContent, "COPIED");
  assert.equal(timers.at(-1)?.ms, SAID_MS);
  timers.at(-1)?.run();
  assert.equal(share.element.textContent, "SHARE");

  // The link is read at the press, not when the button was made.
  setLink(appUrl("?song=midnight-run&chart=0"));
  await press();
  assert.equal(copied.at(-1), appUrl("?song=midnight-run&chart=0"));
});

test("a second press restarts the moment rather than letting the first cut it short", async () => {
  const { share, timers, press } = setup();
  await press();
  await press();
  assert.equal(timers.length, 2);
  assert.equal(timers[0]?.cancelled, true);
  assert.equal(timers[1]?.cancelled, false);
  assert.equal(share.element.textContent, "COPIED");
});

test("a copy the browser refuses is said, not passed off as copied", async () => {
  for (const failure of [false, "throws"] as const) {
    const { share, press } = setup(failure);
    await press();
    assert.equal(share.element.textContent, "NO COPY");
  }
});

test("a song with no link copies nothing, and a disposed button drops its timer", async () => {
  const { share, copied, timers, press, setLink } = setup();
  setLink(undefined);
  await press();
  assert.deepEqual(copied, []);
  assert.equal(share.element.textContent, "SHARE");

  setLink(appUrl("?song=final-chase&chart=1"));
  await press();
  share.dispose();
  assert.equal(timers.at(-1)?.cancelled, true);
});
