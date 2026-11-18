import { createPicker, el } from "fuse-ui";
import {
  DEFAULT_SETTINGS,
  trackNames,
  type FuseDriversSettings,
} from "../game/rules.js";
import { courseLabel } from "./course-label.js";
import { coursePreviewUrl, type StadiumTheme } from "./arena/theme.js";

/** The host picks the opening circuit; subsequent races follow the DOS calendar. */
export function createRaceOptions(
  change: (settings: Partial<FuseDriversSettings>) => void,
  initialTheme: StadiumTheme,
  changeTheme: (theme: StadiumTheme) => void,
) {
  const element = el("section", "", "fd-race-options");
  const previews = new Map<string, HTMLImageElement>();
  const courses = createPicker({
    legend: "Opening course",
    choices: trackNames()
      .filter((id) => !id.endsWith("-reverse"))
      .map((id) => ({ id, label: courseLabel(id) })),
    selected: DEFAULT_SETTINGS.track,
    art(id) {
      const thumbnail = el("img");
      thumbnail.alt = "";
      thumbnail.src = coursePreviewUrl(id, initialTheme);
      previews.set(id, thumbnail);
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
  const mode = select("Rules", [
    ["classic", "Classic"],
    ["battle", "Battle"],
  ]);
  const theme = select("Graphics", [
    ["fuse", "Fuse"],
    ["classic", "Classic"],
  ]);
  theme.control.value = initialTheme;
  theme.control.onchange = () => {
    const selected = theme.control.value === "classic" ? "classic" : "fuse";
    for (const [id, thumbnail] of previews)
      thumbnail.src = coursePreviewUrl(id, selected);
    changeTheme(selected);
  };
  const settingsLength = select("Series length", lengths);
  settingsLength.control.onchange = () =>
    change({ races: Number(settingsLength.control.value) });
  const fields = el("div", "", "fd-series-options");
  fields.append(mode.field, direction.field, length.field, theme.field);
  const hint = el("p", "", "fd-series-hint");
  element.append(courses.element, fields, hint);
  function selectedTrack() {
    return courses.selected() + direction.control.value;
  }
  function send() {
    change({
      track: selectedTrack(),
      races: Number(length.control.value),
      mode: mode.control.value === "battle" ? "battle" : "classic",
    });
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
      mode.control.value = settings.mode;
      mode.control.disabled = !canEdit;
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
      const rules =
        settings.mode === "battle"
          ? "Drop a timed firebomb or use a shield. Drive through crates to refill."
          : "Race with nitro and cash pickups.";
      const description = rules + " " + text;
      if (hint.textContent !== description) hint.textContent = description;
    },
  };
}
