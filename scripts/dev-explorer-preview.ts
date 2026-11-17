/** Local-only preview: the real workspace/API with explicitly synthetic, in-memory activity. */
import { createServer } from "vite";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "fuse-telemetry/debug-memory";
import { MemoryActionDatabase } from "fuse-telemetry/action-adapters";
import { MemoryDeveloperSecurityStore } from "fuse-telemetry/developer-security";
import { createTelemetryServices } from "../service/telemetry.js";
import { freePort } from "./lib/server.js";
const baseline = process.argv.includes("--baseline"),
  root = fileURLToPath(new URL("../", import.meta.url));
const now = Date.now(),
  security = new MemoryDeveloperSecurityStore(() => now - 5000);
await security.setPolicy("preview", ["read", "token", "record"]);
const actionDatabase = new MemoryActionDatabase(),
  recordingId = randomUUID();
await actionDatabase.transact(recordingId, () => ({
  state: {
    recordingId,
    gameId: "fusemania",
    items: [
      {
        id: `${recordingId}_1234567890abcdef`,
        recordingId,
        gameId: "fusemania",
        title: "Keep the results header visible on phones",
        detail:
          "Synthetic preview proposal: the results header should stay visible when the score list scrolls.",
        evidence: [
          {
            sequence: 0,
            startMs: 1000,
            endMs: 2000,
            quote: "Synthetic preview: fix the results header.",
            reportIds: [],
          },
        ],
        status: "proposed",
        createdAt: now,
        updatedAt: now,
        revision: 1,
        lease: null,
        resolution: null,
        retraction: null,
        correction: null,
      },
    ],
    processed: {},
    leaseSecrets: {},
    extractionLease: null,
    expiresAt: now + 86400_000,
  },
  result: undefined,
}));
const services = createTelemetryServices({
  gameIds: ["fusemania", "fuse-riders", "dice", "fuseball"],
  developer: async (token) =>
    token === "synthetic-preview"
      ? { uid: "preview", email: "andersullnass@gmail.com", authTime: now }
      : undefined,
  metricsDatabase: new MemoryTelemetryDatabase(),
  debugDatabase: new MemoryDebugDatabase(),
  actionDatabase,
  objects: new MemoryPrivateObjectStorage(),
  rateLimitKey: "synthetic-local-preview-not-a-production-key",
  security,
  now: Date.now,
  assistantKey: process.env.OPENAI_API_KEY,
  extractor: {
    async extract() {
      return [];
    },
  },
});
const players = Array.from({ length: 8 }, () => randomUUID());
for (let day = 13; day >= 0; day--)
  for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
    if ((playerIndex + day) % 3 === 0) continue;
    const userId = players[playerIndex]!,
      sessionId = randomUUID(),
      gameId = ["fusemania", "fuse-riders", "fuseball"][playerIndex % 3]!;
    const at = now - day * 86400_000 - (playerIndex + 1) * 60000;
    const properties = {
      mode: playerIndex % 2 ? "online" : "solo",
      played: true,
      playerCount: playerIndex % 2 ? 3 : 1,
      ...(gameId === "fusemania"
        ? {
            song: ["Autumn Leaves", "Blue Train", "Take Five"][day % 3]!,
            chart: day % 3,
          }
        : {}),
    };
    await services.metrics.ingest(
      {
        events: [
          "App Opened",
          "Match Started",
          "Round Started",
          "Round Ended",
          "Match Ended",
        ].map((name, index) => ({
          v: 1,
          id: randomUUID(),
          gameId,
          userId,
          ...(process.argv.includes("--accounts") && playerIndex < 3
            ? { accountUid: `preview-player-${playerIndex}` }
            : {}),
          sessionId,
          name: `fuse.${name}`,
          occurredAt: at + index * 1000,
          properties,
        })),
      },
      `preview-${day}-${playerIndex}`,
      process.argv.includes("--accounts") && playerIndex < 3
        ? {
            uid: `preview-player-${playerIndex}`,
            name: ["Preview Alex", "Preview Morgan", "Preview Sam"][
              playerIndex
            ]!,
          }
        : undefined,
    );
  }
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: await freePort() },
  plugins: [
    {
      name: "developer-explorer-preview",
      enforce: "pre",
      load(id) {
        if (id === `${root}dev/main.ts`)
          return `import "@fontsource/press-start-2p/latin.css";import "fuse-ui/tokens.css";import "/dev/styles.css";import {mountWorkspace} from "/dev/workspace.ts";mountWorkspace(document.getElementById("app"),{document,now:()=>new Date(${now}),gamesUrl:"/",account:{ready:async()=>{},watch(fn){fn({name:"Preview · synthetic data"});return()=>{};},signIn:async()=>{},signOut:async()=>{},failure:()=>"Preview sign-in error"},transport:{origin:location.origin,token:async()=>"synthetic-preview",request:(input,init)=>fetch(input,init)}});`;
        if (baseline && id.startsWith(`${root}dev/`) && /\.(ts|css)$/.test(id))
          return execFileSync(
            "git",
            ["show", `origin/main:${id.slice(root.length)}`],
            { cwd: root, encoding: "utf8" },
          );
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/api/")) {
            next();
            return;
          }
          void services.http
            .handle(req, res, "127.0.0.1")
            .then((handled) => {
              if (!handled) next();
            })
            .catch((error: unknown) => {
              const status =
                error &&
                typeof error === "object" &&
                "status" in error &&
                typeof error.status === "number"
                  ? error.status
                  : 500;
              res.writeHead(status, {
                "content-type": "application/json",
                "cache-control": "no-store",
              });
              res.end(
                JSON.stringify({
                  error:
                    status === 500 ? "Preview request failed" : String(error),
                }),
              );
            });
        });
      },
    },
  ],
});
await server.listen();
console.log(
  `Developer preview (${baseline ? "before" : "after"}; synthetic data): ${server.resolvedUrls?.local[0]}dev/?mute`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit());
  });
