import { phoneHomeEdge } from "./phoneOrientation";

it.each([
  [0, "bottom"],
  [90, "right"],
  [180, "top"],
  [270, "left"],
  [-90, "left"],
  [undefined, "bottom"],
] as const)(
  "keeps the Home button on its physical edge at %s degrees",
  (angle, edge) => {
    expect(phoneHomeEdge(angle)).toBe(edge);
  },
);
