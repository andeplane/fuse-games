import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_REMEMBER_KEY,
  watchRememberedAccount,
} from "../src/account-sync.js";
test("a guest frame warms shared auth after Messenger sign-in or sign-out, then unsubscribes", () => {
  let listener: ((event: { key: string | null }) => void) | undefined;
  let warmed = 0;
  const stop = watchRememberedAccount(
    {
      subscribe(onChange) {
        listener = onChange;
        return () => {
          listener = undefined;
        };
      },
      storage: () => undefined,
    },
    () => {
      warmed++;
    },
  );
  listener?.({ key: "some-game-option" });
  assert.equal(warmed, 0);
  listener?.({ key: ACCOUNT_REMEMBER_KEY });
  listener?.({ key: null });
  assert.equal(warmed, 2);
  stop();
  assert.equal(listener, undefined);
});
