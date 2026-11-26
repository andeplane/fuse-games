export interface RoadSample {
  heading: number;
  height: number;
}
export type SampleRoad = (absoluteMetres: number) => RoadSample;

// The DOS renderer compares the driver's base row with its next fourteen
// 64-position segments. The quarter mile is 5,120 positions.
const step = (64 * 402.336) / 5120;
export function roadProfile(
  distance: number,
  sample: SampleRoad,
  width: number,
  height: number,
) {
  const first = Math.floor(distance / step),
    phase = distance / step - first;
  const rows = Array.from({ length: 16 }, (_, i) =>
    sample((first + i + 0.001) * step),
  );
  function value(at: number, axis: keyof RoadSample) {
    const i = Math.min(14, Math.floor(at)),
      t = at - i;
    return rows[i]![axis] * (1 - t) + rows[i + 1]![axis] * t;
  }
  const heading = value(phase, "heading"),
    elevation = value(phase, "height");
  return {
    x(z: number) {
      return (
        ((heading -
          value(phase + Math.min(14, Math.max(0, z / step)), "heading")) *
          width) /
        320
      );
    },
    y(z: number) {
      return (
        ((elevation -
          value(phase + Math.min(14, Math.max(0, z / step)), "height")) *
          height) /
        100
      );
    },
  };
}
