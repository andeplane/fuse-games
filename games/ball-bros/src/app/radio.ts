import { ALL_SONGS, MusicPlayer as createMusicPlayer } from "fuse-ui/music";
import type { MusicPlayer } from "fuse-ui/radio";
export type { MusicPlayer } from "fuse-ui/radio";
export interface Radio {
  element: HTMLElement;
  enable(value: boolean): void;
  setMuted(muted: boolean): void;
  unlock(): void;
  destroy(): void;
}
/** Game-specific controls over the common music player and full default catalogue. */
export function createRadio(
  document: Document,
  baseUrl: string,
  media: MusicPlayer,
  options: {
    store?: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    };
    preview?: boolean;
    playOnUnlock?: boolean;
  } = {},
) {
  const element = document.createElement("div"),
    button = document.createElement("button"),
    next = document.createElement("button"),
    title = document.createElement("span");
  element.className = "radio";
  button.className = next.className = "quiet-button";
  button.type = next.type = "button";
  next.textContent = "NEXT ♫";
  next.setAttribute("aria-label", "Next radio track");
  title.setAttribute("aria-live", "polite");
  element.append(button, title, next);
  const pausedKey = "ball-bros-radio-paused";
  const player = createMusicPlayer(ALL_SONGS, {
    base: baseUrl,
    muted: options.preview,
    playOnUnlock:
      options.playOnUnlock && options.store?.getItem(pausedKey) !== "true",
    retryOnGesture: options.playOnUnlock,
    createMedia: () => media,
  });
  const volumeControl = document.createElement("label");
  const volume = document.createElement("input");
  const key = "ball-bros-radio-volume";
  const saved = options.store?.getItem(key);
  const level = saved == null ? player.volume : Number(saved);
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = String(
    Math.round(
      100 *
        (Number.isFinite(level)
          ? Math.max(0, Math.min(1, level))
          : player.volume),
    ),
  );
  volume.setAttribute("aria-label", "Radio volume");
  volumeControl.textContent = "Radio volume";
  volumeControl.append(volume);
  player.setVolume(Number(volume.value) / 100);
  volume.oninput = () => {
    if (options.preview) return;
    const nextLevel = Number(volume.value) / 100;
    player.setVolume(nextLevel);
    options.store?.setItem(key, String(nextLevel));
  };
  let enabled = true;
  let masterMuted = false;
  const applyMute = () => player.setMuted(!enabled || masterMuted);
  volume.disabled = button.disabled = next.disabled = Boolean(options.preview);
  const render = () => {
    button.textContent = enabled && player.playing ? "RADIO ON" : "RADIO OFF";
    title.textContent = enabled
      ? player.error || player.song?.title || ""
      : "Use the radio on the shared TV.";
    button.hidden = next.hidden = !enabled;
  };
  const unsubscribe = player.subscribe(render);
  button.onclick = () => {
    if (enabled && !options.preview) {
      if (player.playing) player.pause();
      else player.play();
      options.store?.setItem(pausedKey, String(!player.playing));
    }
  };
  next.onclick = () => {
    if (!enabled || options.preview) return;
    const index = ALL_SONGS.findIndex((song) => song.id === player.song?.id);
    player.select(ALL_SONGS[(index + 1) % ALL_SONGS.length]!.id);
  };
  render();
  return {
    element,
    volumeControl,
    unlock() {
      if (enabled) player.unlock();
    },
    setMuted(value: boolean) {
      masterMuted = value;
      applyMute();
    },
    enable(value: boolean) {
      enabled = value;
      button.disabled = next.disabled = !value || Boolean(options.preview);
      volumeControl.hidden = !value;
      applyMute();
      render();
    },
    destroy() {
      unsubscribe();
      player.destroy();
      button.onclick = next.onclick = null;
    },
  };
}
