/** Real Messenger UI and HTTP storage with two isolated browser accounts. Auth is an explicit typed fake; no production accounts/data. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";
import { createDevRoomService } from "../service/dev.js";
import type { FriendsView } from "fuse-platform/friends-api";

const vite = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await vite.listen();
const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
const service = createDevRoomService({
  allowedOrigins: [origin],
  identity: async (token) =>
    token.startsWith("messenger-smoke:") ? token.slice(16) : undefined,
});
await new Promise<void>((resolve) =>
  service.server.listen(0, "127.0.0.1", resolve),
);
const api = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({ headless: true });

async function mountMessenger(page: Page, user: string, name: string) {
  await page.addInitScript("window.__name = value => value");
  // Select the Windows desktop at boot, then exercise Messenger at the requested
  // width. A fresh narrow site visit intentionally selects the separate phone launcher.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?mute`);
  await page.locator('[data-testid="display-surface"]').waitFor();
  if (viewport) await page.setViewportSize(viewport);
  await page.evaluate(
    async ({ api, user, name }) => {
      const reactPath = "/node_modules/.vite/deps/react.js";
      const domPath = "/node_modules/.vite/deps/react-dom_client.js";
      const friendsPath = "/packages/fuseos/src/friends/FriendsWindow.tsx";
      const presencePath = "/packages/fuseos/src/friends/presenceService.ts";
      const realPath = "/packages/fuseos/src/friends/realPresenceService.ts";
      const chatPath = "/packages/fuseos/src/friends/MessengerChatContext.ts";
      const clientPath = "/packages/fuse-ui/src/messenger-client.ts";
      const depsPath = "/packages/fuseos/src/friends/friendsDepsContext.ts";
      const { createElement: h } = (
        (await import(reactPath)) as { default: typeof import("react") }
      ).default;
      const { createRoot } = (
        (await import(domPath)) as {
          default: typeof import("react-dom/client");
        }
      ).default;
      const { FriendsWindow } = (await import(
        friendsPath
      )) as typeof import("../packages/fuseos/src/friends/FriendsWindow.js");
      const { PresenceServiceContext } = (await import(
        presencePath
      )) as typeof import("../packages/fuseos/src/friends/presenceService.js");
      const { createRealPresenceService } = (await import(
        realPath
      )) as typeof import("../packages/fuseos/src/friends/realPresenceService.js");
      const { MessengerChatContext } = (await import(
        chatPath
      )) as typeof import("../packages/fuseos/src/friends/MessengerChatContext.js");
      const { createMessengerClient } = (await import(
        clientPath
      )) as typeof import("../packages/fuse-ui/src/messenger-client.js");
      const { FriendsDepsContext, defaultFriendsDeps } = (await import(
        depsPath
      )) as typeof import("../packages/fuseos/src/friends/friendsDepsContext.js");
      const token = async () => `messenger-smoke:${user}`;
      const presence = createRealPresenceService({
        fetch: window.fetch.bind(window),
        apiUrl: (path) => api + path,
        pollMs: 200,
        auth: {
          watch: (listener) => {
            listener({ name });
            return () => {};
          },
          token,
          remembers: () => true,
          warm: () => {},
          ready: async () => {},
          signIn: async () => {},
          signOut: async () => {},
          failure: () => "Sign-in failed",
        },
      });
      const container = document.createElement("div");
      container.id = "messenger-smoke";
      container.className = "win98";
      container.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#c0c0c0;display:flex;flex-direction:column;padding:8px";
      document.body.append(container);
      createRoot(container).render(
        h(
          PresenceServiceContext.Provider,
          { value: presence },
          h(
            FriendsDepsContext.Provider,
            {
              value: {
                ...defaultFriendsDeps,
                schedule: (run: () => void) => {
                  const id = window.setTimeout(run, 200);
                  return () => window.clearTimeout(id);
                },
              },
            },
            h(
              MessengerChatContext.Provider,
              {
                value: {
                  client: createMessengerClient({
                    fetch: window.fetch.bind(window),
                    token,
                    apiUrl: (path) => api + path,
                  }),
                  messageId: () => crypto.randomUUID().replaceAll("-", ""),
                },
              },
              h(FriendsWindow, { windowId: "friends" }),
            ),
          ),
        ),
      );
    },
    { api, user, name },
  );
  await page.locator("#messenger-smoke [data-testid=my-public-id]").waitFor();
}

try {
  const alice = await browser.newPage({
    viewport: { width: 360, height: 780 },
  });
  const bob = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors: string[] = [];
  for (const page of [alice, bob])
    page.on("pageerror", (error) => errors.push(error.message));
  await mountMessenger(alice, "alice", "Alice");
  await mountMessenger(bob, "bob", "Bob");
  const sync = async (user: string) =>
    (await (
      await fetch(`${api}/api/friends/sync`, {
        method: "POST",
        headers: {
          Origin: origin,
          Authorization: `Bearer messenger-smoke:${user}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).json()) as FriendsView;
  const aliceCard = (await sync("alice")).me,
    bobCard = (await sync("bob")).me;
  const aliceName = aliceCard.name,
    bobName = bobCard.name,
    bobId = bobCard.publicId;
  const aliceApp = alice.locator("#messenger-smoke"),
    bobApp = bob.locator("#messenger-smoke");
  await aliceApp.getByLabel("Add:", { exact: true }).fill(bobId);
  await aliceApp.getByRole("button", { name: "Add", exact: true }).click();
  await bobApp.getByRole("button", { name: `Accept ${aliceName}` }).click();
  await aliceApp.getByRole("button", { name: `Chat with ${bobName}` }).click();
  await bobApp.getByRole("button", { name: `Chat with ${aliceName}` }).click();
  const aliceInput = aliceApp.getByLabel(`Message to ${bobName}`),
    bobInput = bobApp.getByLabel(`Message to ${aliceName}`);
  await aliceInput.fill("Hello Bob, ready to play?");
  await aliceApp.getByRole("button", { name: "Send", exact: true }).click();
  await bobApp
    .getByText("Hello Bob, ready to play?", { exact: true })
    .waitFor();
  await bobInput.fill("Yes! <script>plain text</script>");
  await bobInput.press("Enter");
  await aliceApp
    .getByText("Yes! <script>plain text</script>", { exact: true })
    .waitFor();
  assert.equal(await aliceApp.locator(".msn-message").count(), 2);
  assert.equal(await aliceApp.locator(".msn-transcript script").count(), 0);
  assert.equal(
    await aliceApp.getByRole("button", { name: "Invite to game" }).isDisabled(),
    true,
  );
  await alice.reload();
  await mountMessenger(alice, "alice", "Alice");
  await alice
    .locator("#messenger-smoke")
    .getByRole("button", { name: `Chat with ${bobName}` })
    .click();
  await alice
    .locator("#messenger-smoke")
    .getByText("Hello Bob, ready to play?", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two-account MSN contact request/accept, bidirectional plain-text chat, persisted history after reopen, no-room invite state; headless 360px/900px browsers, injected auth.",
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    service.server.close((error) => (error ? reject(error) : resolve())),
  );
  await vite.close();
}
