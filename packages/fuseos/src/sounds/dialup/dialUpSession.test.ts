import { createMemoryStorage } from "fuse-ui/safe-storage";
import { LocalStorageDialUpSession } from "./dialUpSession";
describe("remembered dial-up", () => {
  it("remembers a completed handshake after reload, while Cancel only skips this session", () => {
    const storage = createMemoryStorage();
    const first = new LocalStorageDialUpSession(storage);
    expect(first.connected).toBe(false);
    first.markConnected(false);
    expect(first.connected).toBe(true);
    const reload = new LocalStorageDialUpSession(storage);
    expect(reload.connected).toBe(false);
    reload.markConnected();
    expect(new LocalStorageDialUpSession(storage).connected).toBe(true);
  });
});
