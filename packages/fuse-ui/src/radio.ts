import {
  ALL_SONGS,
  MusicPlayer as createMusicPlayer,
  type Song,
  type MusicMedia,
} from "fuse-music";
export type MusicPlayer = MusicMedia;
import type { SafeStorage } from "./safe-storage.js";
const RADIO_VOLUME = "fuse-radio-volume";
/** Shared radio controls; the music library owns playback, games choose the catalogue. */
export function createRadio(
  document: Document,
  baseUrl: string,
  media: MusicMedia | (() => MusicMedia),
  muted = false,
  songs: readonly Song[] = ALL_SONGS,
  storage?: Pick<SafeStorage, "getItem" | "setItem">,
) {
  const player = createMusicPlayer(songs, {
    base: baseUrl,
    muted,
    createMedia: typeof media === "function" ? media : () => media,
  });
  const element = document.createElement("div"),
    button = document.createElement("button"),
    next = document.createElement("button"),
    title = document.createElement("span"),
    volume = document.createElement("input"),
    label = document.createElement("label"),
    select = document.createElement("select");
  element.className = "controls radio fui-radio";
  button.type = next.type = "button";
  next.textContent = "Next track";
  select.setAttribute("aria-label", "Radio song");
  for (const song of songs) {
    const option = document.createElement("option");
    option.value = song.id;
    option.textContent = song.title;
    select.append(option);
  }
  title.setAttribute("aria-live", "polite");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  const stored = storage?.getItem(RADIO_VOLUME);
  if (stored && /^\d{1,3}$/.test(stored) && Number(stored) <= 100)
    player.setVolume(Number(stored) / 100);
  volume.value = String(Math.round(player.volume * 100));
  volume.setAttribute("aria-label", "Radio volume");
  label.textContent = "Radio volume ";
  label.className = "fui-radio-volume";
  label.append(volume);
  element.append(button, next, title, select, label);
  const render = () => {
    button.textContent = player.playing ? "Pause radio" : "Play radio";
    button.setAttribute("aria-pressed", String(player.playing));
    title.textContent = muted
      ? "Audio muted by preview URL"
      : player.error || (player.song ? "" : "No songs available");
    title.hidden = !title.textContent;
    for (const option of select.querySelectorAll("option"))
      option.selected = option.value === player.song?.id;
  };
  button.onclick = () => (player.playing ? player.pause() : player.play());
  next.onclick = () => {
    if (!songs.length) return;
    const index = songs.findIndex((song) => song.id === player.song?.id);
    player.select(songs[(index + 1) % songs.length]!.id);
  };
  select.onchange = () => player.select(select.value);
  volume.oninput = () => {
    player.setVolume(Number(volume.value) / 100);
    if (!muted) storage?.setItem(RADIO_VOLUME, volume.value);
  };
  for (const control of [button, next, select, volume])
    control.disabled = muted || songs.length === 0;
  const unsubscribe = player.subscribe(render);
  render();
  return {
    element,
    volumeControl: label,
    player,
    pause: () => player.pause(),
    setMuted: (value: boolean) => player.setMuted(value),
    destroy() {
      unsubscribe();
      player.destroy();
      button.onclick = next.onclick = volume.oninput = select.onchange = null;
    },
  };
}
