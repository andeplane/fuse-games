export const ACCOUNT_REMEMBER_KEY = "fuse-riders-signed-in";
/** A game that booted as a guest must load auth when Messenger signs in later. Firebase then owns cross-frame auth synchronization. */
export function watchRememberedAccount(
  surface: {
    subscribe(
      listener: (event: {
        key: string | null;
        storageArea?: Storage | null;
      }) => void,
    ): () => void;
    storage(): Storage | undefined;
  },
  warm: () => void,
): () => void {
  return surface.subscribe((event) => {
    if (event.key !== null && event.key !== ACCOUNT_REMEMBER_KEY) return;
    if (event.storageArea && event.storageArea !== surface.storage()) return;
    warm();
  });
}
