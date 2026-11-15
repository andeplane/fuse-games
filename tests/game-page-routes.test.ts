import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "vite";
import { gamePagePath } from "../packages/fuse-ui/src/game-path.js";

const games = readdirSync(new URL("../games/", import.meta.url)).filter((id) =>
  existsSync(new URL(`../games/${id}/index.html`, import.meta.url)),
);

test("every game has a unique dashless public path", () => {
  assert.equal(new Set(games.map(gamePagePath)).size, games.length);
  for (const id of games) assert.match(gamePagePath(id), /^[a-z0-9]+\/$/);
  assert.equal(gamePagePath("ball-bros"), "ballbros/");
  assert.equal(gamePagePath("hook-havok"), "hookhavok/");
});

test("source server serves canonical pages and preserves legacy invite queries under a base", async () => {
  const server = await createServer({
    base: "/arcade/",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const id of games) {
      const page = await fetch(`${origin}/arcade/${gamePagePath(id)}?mute`);
      assert.equal(page.status, 200, id);
      const source = readFileSync(
        new URL(`../games/${id}/index.html`, import.meta.url),
        "utf8",
      );
      const title = source.match(/<title>(.*?)<\/title>/)?.[0];
      assert.ok(title, id);
      assert.ok((await page.text()).includes(title), id);
      if (!id.includes("-")) continue;
      for (const suffix of ["", "/", "/index.html"]) {
        const legacy = await fetch(
          `${origin}/arcade/${id}${suffix}?room=ABC123&display=1&mute`,
          { redirect: "manual" },
        );
        assert.equal(legacy.status, 302, id);
        assert.equal(
          legacy.headers.get("location"),
          `/arcade/${gamePagePath(id)}?room=ABC123&display=1&mute`,
        );
      }
    }
    const asset = await fetch(`${origin}/arcade/killer-fuse/art/snail.png`, {
      redirect: "manual",
    });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /image\/png/);
    assert.deepEqual(
      Buffer.from(await asset.arrayBuffer()),
      readFileSync(
        new URL(
          "../games/killer-fuse/public/killer-fuse/art/snail.png",
          import.meta.url,
        ),
      ),
    );
  } finally {
    await server.close();
  }
});
