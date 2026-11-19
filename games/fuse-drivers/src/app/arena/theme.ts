import type { Store } from "fuse-ui/room-session";

export type StadiumTheme = "classic" | "fuse";
const KEY = "fuse-drivers-stadium-theme";

export function coursePreviewUrl(
  courseId: string,
  theme: StadiumTheme,
): string {
  const id = courseId.replace(/-reverse$/, "");
  return theme === "fuse"
    ? new URL(`../course-previews/fuse/${id}.webp`, import.meta.url).href
    : new URL(`../course-previews/${id}.webp`, import.meta.url).href;
}

export function readStadiumTheme(
  store: Pick<Store, "getItem">,
  referencePreview = import.meta.env?.DEV &&
    import.meta.env.VITE_OFFROAD_REFERENCE === "1",
): StadiumTheme {
  const value = store.getItem(KEY);
  return value === "fuse" || value === "classic"
    ? value
    : referencePreview
      ? "classic"
      : "fuse";
}

export function storeStadiumTheme(
  store: Pick<Store, "setItem">,
  theme: StadiumTheme,
): void {
  store.setItem(KEY, theme);
}
