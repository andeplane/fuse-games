import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import type { SongBoard } from "../games/fusemania/src/song-scores.js";

/** Real menu and composed page. HTTP fixtures exercise populated/error states without submitting scores. */
const base = process.env.ONLINE_URL ?? "http://127.0.0.1:5237/";
const browser = await launchSelected("chrome", {
  headless: true,
  args: ["--mute-audio"],
});
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("fusemania/?mute", base).href);
  await page
    .getByRole("button", { name: "Song highscores", exact: true })
    .click();
  await page.locator("tr[data-song]").first().waitFor();
  assert.equal(await page.locator(".fm-score-more-charts").count(), 0);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 360, height: 800 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `no page overflow at ${viewport.width}`,
    );
    const top = await page.locator(".fm-score-toolbar").boundingBox();
    assert.ok(top && top.width <= viewport.width);
  }
  await page.getByLabel("Search songs or packs").fill("Cold Pizza");
  await page
    .getByRole("button", { name: "Cold Pizza: open leaderboard", exact: true })
    .click();
  await page
    .getByText("No scores yet. Set the first one.", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".fm-score-tab").count(), 4);
  assert.equal(await page.locator(".fm-score-browse").isVisible(), false);
  const play = new URL(
    (await page
      .getByRole("link", { name: "Play this chart" })
      .getAttribute("href"))!,
    base,
  );
  assert.equal(play.searchParams.get("solo"), "1");
  assert.ok(play.searchParams.has("chart"));
  assert.ok(play.searchParams.has("mute"));
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByLabel("Search songs or packs").inputValue(),
    "Cold Pizza",
  );
  assert.equal(await page.locator("tr[data-song]").count(), 1);

  const fixtures: SongBoard[] = [
    {
      song: "fixture-a",
      title: "Alpha",
      plays: 4,
      charts: [
        {
          chart: 7,
          difficulty: "Edit",
          meter: 12,
          version: "v1",
          top: { name: "Ada", rating: 999_999, endedAt: 10 },
        },
      ],
    },
    {
      song: "fixture-b",
      title: "Beta",
      plays: 20,
      charts: [
        {
          chart: 3,
          difficulty: "Challenge",
          meter: 9,
          version: "v1",
          top: { name: "Bo", rating: 800_000, endedAt: 10 },
        },
      ],
    },
  ];
  let failCatalog = true,
    failBoard = true,
    boardRequests = 0;
  await page.route("**/api/games/fusemania/song-scores*", async (route) => {
    const url = new URL(route.request().url());
    const isBoard = url.searchParams.has("song");
    if (isBoard) boardRequests++;
    const failed = isBoard ? failBoard : failCatalog;
    await route.fulfill({
      status: failed ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        failed
          ? { error: "Unavailable" }
          : isBoard
            ? { players: [{ name: "Ada", rating: 999_999, endedAt: 10 }] }
            : { songs: fixtures },
      ),
    });
  });
  await page.goto(new URL("fusemania/?highscores&mute", base).href);
  await page
    .getByText("Could not load song scores. Try again.", { exact: true })
    .waitFor();
  failCatalog = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.locator('[data-song="fixture-a"]').waitFor();
  await page.getByLabel("Sort by", { exact: true }).selectOption("plays:desc");
  assert.equal(
    await page.locator("tr[data-song]").first().getAttribute("data-song"),
    "fixture-b",
  );
  await page
    .getByLabel("Sort by", { exact: true })
    .selectOption("Challenge:desc");
  assert.equal(
    await page.locator("tr[data-song]").first().getAttribute("data-song"),
    "fixture-a",
  );
  await page
    .getByRole("button", { name: "Alpha: open leaderboard", exact: true })
    .click();
  await page
    .getByText("Could not load this leaderboard.", { exact: true })
    .waitFor();
  failBoard = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("cell", { name: "99.99%", exact: true }).waitFor();
  assert.equal(boardRequests, 2, "no effect-driven refetch loop");
  assert.equal(
    await page.getByRole("cell", { name: "Ada", exact: true }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Scores smoke passed: menu, three viewports, song navigation, Escape, chart ID, search, sorting, errors, retry and populated leaderboard.",
  );
} finally {
  await browser.close();
}
