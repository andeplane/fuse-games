import { SCORE_DIFFICULTIES } from "./song-scores.js";

export interface SelectableChart {
  chart: number;
  difficulty: string;
  meter?: number;
}

/** Presentation only: retain the replay/storage index when choosing the four hardest charts. */
export function chartSlots<T extends SelectableChart>(charts: readonly T[]) {
  const rank = (name: string) =>
    ["beginner", "easy", "medium", "hard", "challenge", "edit"].indexOf(
      name.toLowerCase(),
    );
  const selected = [...charts]
    .sort(
      (a, b) =>
        (a.meter ?? 0) - (b.meter ?? 0) ||
        rank(a.difficulty) - rank(b.difficulty) ||
        a.chart - b.chart,
    )
    .slice(-4);
  // Preserve unambiguous standard labels for sparse songs. Imported Edit/duplicate
  // labels and larger sets use the four ordered slots, with the hardest at Challenge.
  const standard =
    charts.length <= 4 &&
    selected.every((chart) =>
      SCORE_DIFFICULTIES.some(
        (name) => name.toLowerCase() === chart.difficulty.toLowerCase(),
      ),
    ) &&
    new Set(selected.map((chart) => chart.difficulty.toLowerCase())).size ===
      selected.length;
  return selected.map((chart, index) => ({
    ...chart,
    slot: standard
      ? SCORE_DIFFICULTIES.find(
          (name) => name.toLowerCase() === chart.difficulty.toLowerCase(),
        )!
      : SCORE_DIFFICULTIES[4 - selected.length + index]!,
  }));
}
