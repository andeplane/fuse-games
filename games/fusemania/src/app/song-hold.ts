import { holdText } from "./presenter.js";
import type { SongLoadProgress } from "./song-load.js";

const bytes = (value: number): string =>
  value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(value / 1024)} KB`;

/** Audio readiness over the live field; percentages only describe bytes actually received. */
export function createSongHold(document: Document) {
  const element = document.createElement("div");
  element.className = "fm-unlock fm-hold";
  const label = document.createElement("p");
  label.className = "fm-hold-label";
  label.setAttribute("role", "status");
  const bar = document.createElement("progress");
  bar.className = "fm-hold-progress";
  bar.max = 1;
  bar.setAttribute("aria-label", "Song download");
  const detail = document.createElement("p");
  detail.className = "fm-hold-detail";
  element.append(label, bar, detail);
  let before = "";
  let rendered = "";
  return {
    element,
    update(
      waiting: readonly string[],
      settled: boolean,
      progress?: SongLoadProgress,
    ) {
      const text = settled
        ? holdText(waiting, true)
        : progress?.phase === "decoding"
          ? "PREPARING AUDIO…"
          : progress?.phase === "retrying"
            ? "RETRYING DOWNLOAD…"
            : holdText(waiting, false);
      const state = `${text}|${progress?.phase}|${progress?.received}|${progress?.total}`;
      if (rendered === state) return;
      rendered = state;
      if (label.textContent !== text) label.textContent = text;
      bar.hidden = detail.hidden = settled;
      if (settled) return;
      const total = progress?.total;
      const known =
        progress?.phase === "downloading" && total !== undefined && total > 0;
      if (known) {
        const received = Math.min(progress.received, total);
        bar.value = received / total;
        bar.setAttribute(
          "aria-valuetext",
          `${Math.floor((received / total) * 100)} percent downloaded`,
        );
      } else {
        bar.removeAttribute("value");
        bar.removeAttribute("aria-valuetext");
      }
      const next =
        progress?.phase === "decoding"
          ? "Download complete · decoding audio"
          : progress?.phase === "retrying"
            ? "The download will retry shortly"
            : known
              ? `${Math.floor((progress.received / total) * 100)}% · ${bytes(progress.received)} / ${bytes(total)}`
              : progress?.received
                ? `${bytes(progress.received)} received`
                : "Waiting for song data";
      if (next !== before) detail.textContent = before = next;
    },
  };
}
