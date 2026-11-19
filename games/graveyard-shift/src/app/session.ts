export {
  type Session,
  type Store,
  safeStore,
  keys,
  NOT_OPEN,
  roomFailure,
  sessionFor,
} from "fuse-ui/room-session";

/** A remembered name may restore a seat once; editing a fresh name never submits it. */
export function createSeatAdmission(
  rememberedName: string | null,
  join: (name: string) => void,
): { observe(seated: boolean): void; submit(name: string): void } {
  let requested = false;
  const submit = (name: string) => {
    requested = true;
    join(name);
  };
  return {
    submit,
    observe(seated) {
      if (!seated && !requested && rememberedName) submit(rememberedName);
    },
  };
}
