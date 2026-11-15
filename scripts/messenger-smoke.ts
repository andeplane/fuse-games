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
      const load = async <T>(path: string): Promise<T> =>
        (await import(path)) as T;
      const { createElement: h } = (
        await load<{ default: typeof import("react") }>(
          "/node_modules/.vite/deps/react.js",
        )
      ).default;
      const { createRoot } = (
        await load<{ default: typeof import("react-dom/client") }>(
          "/node_modules/.vite/deps/react-dom_client.js",
        )
      ).default;
      const { App } = await load<
        typeof import("../packages/fuseos/src/App.js")
      >("/packages/fuseos/src/App.tsx");
      const { MemoryStateStore } = await load<
        typeof import("../packages/fuseos/src/state/stateStore.js")
      >("/packages/fuseos/src/state/stateStore.ts");
      const { PresenceServiceContext } = await load<
        typeof import("../packages/fuseos/src/friends/presenceService.js")
      >("/packages/fuseos/src/friends/presenceService.ts");
      const { createRealPresenceService } = await load<
        typeof import("../packages/fuseos/src/friends/realPresenceService.js")
      >("/packages/fuseos/src/friends/realPresenceService.ts");
      const { MessengerChatContext } = await load<
        typeof import("../packages/fuseos/src/friends/MessengerChatContext.js")
      >("/packages/fuseos/src/friends/MessengerChatContext.ts");
      const { createMessengerClient } = await load<
        typeof import("../packages/fuse-ui/src/messenger-client.js")
      >("/packages/fuse-ui/src/messenger-client.ts");
      const { FriendsDepsContext, defaultFriendsDeps } = await load<
        typeof import("../packages/fuseos/src/friends/friendsDepsContext.js")
      >("/packages/fuseos/src/friends/friendsDepsContext.ts");
      const { DialUpSessionContext, MemoryDialUpSession } = await load<
        typeof import("../packages/fuseos/src/sounds/dialup/dialUpSession.js")
      >("/packages/fuseos/src/sounds/dialup/dialUpSession.ts");
      const token = async () => `messenger-smoke:${user}`;
      const presence = createRealPresenceService({
        fetch: window.fetch.bind(window),
        apiUrl: (path) => api + path,
        pollMs: 300,
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
      const store = new MemoryStateStore({
        version: 1,
        windows: [
          {
            id: "friends",
            kind: "friends",
            minimized: false,
            maximized: false,
          },
        ],
      });
      const container = document.createElement("div");
      container.id = "messenger-smoke";
      container.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex";
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
                // Every wait is short here: the conversation and its poll run in a fraction of a second.
                schedule: (run: () => void) => {
                  const id = window.setTimeout(run, 300);
                  return () => window.clearTimeout(id);
                },
              },
            },
            h(
              DialUpSessionContext.Provider,
              {
                value: (() => {
                  const session = new MemoryDialUpSession();
                  session.markConnected();
                  return session;
                })(),
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
                h(App, { store, initialOpen: [] }),
              ),
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
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: process.env.MESSENGER_SHOTS ? 2 : 1,
  });
  const bob = await browser.newPage({
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: process.env.MESSENGER_SHOTS ? 2 : 1,
  });
  const errors: string[] = [];
  for (const page of [alice, bob])
    page.on("pageerror", (error) => errors.push(error.message));
  const sync = async (user: string, body: object = {}) =>
    (await (
      await fetch(`${api}/api/friends/sync`, {
        method: "POST",
        headers: {
          Origin: origin,
          Authorization: `Bearer messenger-smoke:${user}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    ).json()) as FriendsView;
  // The names friends see; the desktop's own polls never send one.
  await sync("alice", { name: "Alice" });
  await sync("bob", { name: "Bob" });
  await mountMessenger(alice, "alice", "Alice");
  await mountMessenger(bob, "bob", "Bob");
  const aliceCard = (await sync("alice")).me,
    bobCard = (await sync("bob")).me;
  const aliceName = aliceCard.name,
    bobName = bobCard.name,
    bobId = bobCard.publicId;
  const aliceApp = alice.locator("#messenger-smoke"),
    bobApp = bob.locator("#messenger-smoke");
  const shots = process.env.MESSENGER_SHOTS;
  // Add a Contact from the big toolbar, accept on the other side.
  await aliceApp.getByRole("button", { name: "Add", exact: true }).click();
  await aliceApp.getByLabel("Add a Contact by player id:").fill(bobId);
  await aliceApp
    .getByRole("form", { name: "Add a Contact" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await bobApp.getByRole("button", { name: `Accept ${aliceName}` }).click();
  // Double-click the buddy: an Instant Message window of its own.
  const buddyRow = aliceApp.getByTestId(`buddy-${bobId}`);
  await buddyRow.waitFor();
  if (shots)
    await aliceApp
      .getByRole("dialog", { name: "Fuse Messenger", exact: true })
      .screenshot({ path: `${shots}/buddy-list-live.png` });
  await buddyRow.dblclick();
  const aliceIm = aliceApp.getByRole("dialog", {
    name: `${bobName} - Instant Message`,
  });
  await aliceIm
    .getByLabel(`Message to ${bobName}`)
    .fill("Hello Bob, ready to play?");
  await aliceIm.getByRole("button", { name: "Send", exact: true }).click();
  // Bob never opened the chat: it pops up when the message arrives.
  const bobIm = bobApp.getByRole("dialog", {
    name: `${aliceName} - Instant Message`,
  });
  await bobIm.getByText("Hello Bob, ready to play?", { exact: true }).waitFor();
  const bobInput = bobIm.getByLabel(`Message to ${aliceName}`);
  await bobInput.fill("Yes! <script>plain text</script>");
  await bobInput.press("Enter");
  await aliceIm
    .getByText("Yes! <script>plain text</script>", { exact: true })
    .waitFor();
  assert.equal(await aliceIm.locator(".msn-message").count(), 2);
  assert.equal(await aliceIm.locator(".msn-transcript script").count(), 0);
  await aliceIm
    .getByTestId("im-status")
    .getByText(/Last message received at/)
    .waitFor();
  if (shots) {
    await alice.screenshot({ path: `${shots}/im-desktop-alice.png` });
    await bob.screenshot({ path: `${shots}/im-desktop-bob.png` });
    for (const [label, size] of [
      ["phone-portrait", { width: 360, height: 780 }],
      ["phone-landscape", { width: 844, height: 390 }],
    ] as const) {
      await bob.setViewportSize(size);
      await bob.waitForTimeout(400);
      await bob.screenshot({ path: `${shots}/im-${label}.png` });
    }
    await bob.setViewportSize({ width: 1000, height: 700 });
  }
  await alice.reload();
  await mountMessenger(alice, "alice", "Alice");
  await alice
    .locator("#messenger-smoke")
    .getByTestId(`buddy-${bobId}`)
    .dblclick();
  await alice
    .locator("#messenger-smoke")
    .getByText("Hello Bob, ready to play?", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two-account Fuse Messenger contact request/accept, Instant Message windows both ways (the reply pops up unopened), plain text, history after reopen; headless browsers, injected auth.",
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    service.server.close((error) => (error ? reject(error) : resolve())),
  );
  await vite.close();
}
