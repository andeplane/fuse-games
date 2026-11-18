import { createPicker, el } from "fuse-ui";
import {
  DEFAULT_SETTINGS,
  trackNames,
  type FuseDriversSettings,
} from "../game/rules.js";
import { courseLabel } from "./course-label.js";

/** The host picks the opening circuit; subsequent races follow the DOS calendar. */
export function createRaceOptions(
  change: (track: string, races: number) => void,
) {
  const element = el("section", "", "fd-race-options");
  const courses = createPicker({
    legend: "Opening course",
    choices: trackNames()
      .filter((id) => !id.endsWith("-reverse"))
      .map((id) => ({ id, label: courseLabel(id) })),
    selected: DEFAULT_SETTINGS.track,
    art(id) {
      const thumbnail = el("img");
      thumbnail.alt = "";
      thumbnail.src = new URL(
        `./course-previews/${id}.webp`,
        import.meta.url,
      ).href;
      return thumbnail;
    },
    onPick: send,
  });
  function select(label: string, choices: [string, string][]) {
    const field = el("label", label);
    const control = el("select");
    control.setAttribute("aria-label", label);
    for (const [value, text] of choices) {
      const option = el("option", text);
      option.value = value;
      control.append(option);
    }
    control.onchange = send;
    field.append(control);
    return { field, control };
  }
  const direction = select("Direction", [
    ["", "Forward"],
    ["-reverse", "Reverse"],
  ]);
  const lengths: [string, string][] = [
    ...Array.from({ length: 8 }, (_, i): [string, string] => [
      String(i + 1),
      String(i + 1),
    ]),
    ["0", "Continuous"],
  ];
  const length = select("Races", lengths);
  const settingsLength = select("Series length", lengths);
  settingsLength.control.onchange = () =>
    change(selectedTrack(), Number(settingsLength.control.value));
  const fields = el("div", "", "fd-series-options");
  fields.append(direction.field, length.field);
  const hint = el("p", "", "fd-series-hint");
  element.append(courses.element, fields, hint);
  function selectedTrack() {
    return courses.selected() + direction.control.value;
  }
  function send() {
    change(selectedTrack(), Number(length.control.value));
  }
  return {
    element,
    settingsField: settingsLength.field,
    update(settings: FuseDriversSettings, canEdit: boolean) {
      courses.sync(settings.track.replace(/-reverse$/, ""));
      direction.control.value = settings.track.endsWith("-reverse")
        ? "-reverse"
        : "";
      length.control.value = String(settings.races);
      settingsLength.control.value = length.control.value;
      courses.element.disabled =
        direction.control.disabled =
        length.control.disabled =
        settingsLength.control.disabled =
          !canEdit;
      const text =
        settings.races === 1
          ? "One four-lap race."
          : "Four laps per race. Spend your winnings between races as the series moves to the next course.";
      if (hint.textContent !== text) hint.textContent = text;
    },
  };
}
