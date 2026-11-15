/** On-demand detection, kept off the playback/rendering thread. Each request owns a disposable worker. */
import { type RhythmOptions, type RhythmResult } from "./rhythm.js";
import { detectRhythmLayers } from "./rhythm-layers.js";
import type { Spectra } from "./spectrum.js";

export interface RhythmRequest {
  spectra: Pick<Spectra, "frames" | "detail" | "detailBins">;
  options: RhythmOptions;
}
export type RhythmReply =
  { kind: "done"; result: RhythmResult } | { kind: "error"; message: string };
interface WorkerScope {
  onmessage: ((event: MessageEvent<RhythmRequest>) => void) | null;
  postMessage(message: RhythmReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
scope.onmessage = ({ data }) => {
  try {
    const result = detectRhythmLayers(data.spectra, data.options);
    scope.postMessage({ kind: "done", result }, [
      result.pitch.buffer,
      result.novelty.buffer,
    ]);
  } catch (error) {
    scope.postMessage({
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : "Detection failed. Try another span.",
    });
  }
};
