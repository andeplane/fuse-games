import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { createDevRoomService } from "../service/dev.js";
import { listenFree } from "../service/listen-free.js";

const path = process.argv[2];
if (!path)
  throw new Error(
    "Pass the private JSON produced by fuse-drivers-reference.py.",
  );
const pack = await readFile(path);
const rooms = createDevRoomService();
const roomPort = await listenFree(rooms.server, 0, "127.0.0.1");
const app = await createServer({
  define: { "import.meta.env.VITE_OFFROAD_REFERENCE": JSON.stringify("1") },
  server: {
    host: "127.0.0.1",
    open: process.argv.includes("--open") ? "/fusedrivers/" : false,
    port: Number(process.env.PORT ?? 8787),
    proxy: { "/api": { target: `http://127.0.0.1:${roomPort}`, ws: true } },
  },
  plugins: [
    {
      name: "fuse-drivers-local-art",
      configureServer(server) {
        server.middlewares.use(
          "/__offroad-reference.json",
          (_request, response) => {
            response.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
            response.end(pack);
          },
        );
      },
    },
  ],
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([app.close(), rooms.close()]);
  });
}
try {
  await app.listen();
  const address = app.httpServer?.address();
  if (address && typeof address === "object") {
    console.log(
      `Native Fuse Drivers with local reference art: http://127.0.0.1:${address.port}/fusedrivers/`,
    );
  }
} catch (error) {
  await Promise.all([app.close(), rooms.close()]);
  throw error;
}
