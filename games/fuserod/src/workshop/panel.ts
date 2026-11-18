import {
  GRADES,
  STATIONS,
  STATION,
  inspectWorkshop,
  stockIndex,
  price,
  resale,
  type Workshop,
  type WorkshopCommand,
  type Station,
  type Grade,
} from "./mechanics.js";
import "./workshop.css";
type ItemArt = (kind: "part", item: string) => Element;
type SceneArt = (
  canvas: HTMLCanvasElement,
  kind: "workshop",
  options: { part: string; progress: number },
) => void;
export const createBenchView = (): { station: Station; grade: Grade } => ({
  station: "carb",
  grade: 0,
});
export function workshopPanel(
  doc: Document,
  workshop: Workshop,
  cash: number,
  run: (cmd: WorkshopCommand) => void,
  drawItem?: ItemArt,
  drawScene?: SceneArt,
  view = createBenchView(),
) {
  const root = doc.createElement("section");
  root.className = "fr-workbench";
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
    const node = doc.createElement(tag);
    node.textContent = text;
    return node;
  };
  const action = (label: string, cmd: WorkshopCommand, disabled = false) => {
    const b = create("button", label);
    b.type = "button";
    b.disabled = disabled;
    b.onclick = () => run(cmd);
    return b;
  };
  const field = (
    label: string,
    options: readonly (readonly [string, string])[],
    selected: string,
    onChange: (v: string) => void,
  ) => {
    const box = create("label", label),
      select = create("select");
    select.setAttribute("aria-label", label);
    for (const [id, name] of options) {
      const opt = create("option", name);
      opt.value = id;
      select.append(opt);
    }
    select.value = selected;
    select.onchange = () => {
      onChange(select.value);
      render();
      root
        .querySelector<HTMLSelectElement>('select[aria-label="' + label + '"]')
        ?.focus();
    };
    box.append(select);
    return box;
  };
  function render() {
    const s = view.station,
      d = STATION[s],
      mount = workshop.mounts[s],
      g = view.grade;
    root.replaceChildren(create("h3", "Mechanic’s bench"));
    const preview = create("div");
    preview.className = "fr-workbench-preview";
    if (drawScene) {
      const canvas = create("canvas");
      canvas.width = 720;
      canvas.height = 300;
      canvas.setAttribute(
        "aria-label",
        d.bay === "under" ? "Under the car" : "Engine bay",
      );
      canvas.setAttribute("role", "img");
      preview.append(canvas);
      doc.defaultView?.requestAnimationFrame(() => {
        if (canvas.isConnected)
          drawScene(canvas, "workshop", {
            part: s,
            progress:
              mount.bolts.reduce((a, b) => a + b, 0) / (3 * mount.bolts.length),
          });
      });
    } else if (drawItem) preview.append(drawItem("part", s));
    const main = create("div");
    main.className = "fr-workbench-fields";
    root.append(preview, main);
    main.append(
      field(
        "Assembly",
        STATIONS.map((k) => [
          k,
          (STATION[k].bay === "under" ? "Under car · " : "Engine bay · ") +
            STATION[k].label,
        ]),
        s,
        (v) => {
          view.station = v as Station;
          view.grade = workshop.mounts[view.station].part ?? 0;
        },
      ),
    );
    main.append(
      create(
        "p",
        mount.part === null
          ? "Mount empty"
          : "Fitted · " + d.models[mount.part],
      ),
    );
    const tools = create("div");
    tools.className = "fr-workbench-actions";
    if (d.bay === "under")
      tools.append(
        action(workshop.jacked ? "Lower jack" : "Raise jack", { type: "jack" }),
      );
    else
      tools.append(
        action(workshop.wired ? "Disconnect ignition" : "Connect ignition", {
          type: "wire",
        }),
      );
    main.append(tools);
    if (mount.part !== null) {
      for (const [index, bolt] of mount.bolts.entries()) {
        const row = create("div");
        row.className = "fr-workbench-fastener";
        row.append(
          create(
            "span",
            d.fasteners[index] +
              " · " +
              ["Out", "Seated", "Snug", "Tight"][bolt],
          ),
          action(
            "Loosen",
            { type: "bolt", station: s, index, delta: -1 },
            bolt === 0,
          ),
          action(
            "Tighten",
            { type: "bolt", station: s, index, delta: 1 },
            bolt === 3,
          ),
        );
        main.append(row);
      }
      main.append(
        action(
          "Remove to shelf",
          { type: "remove", station: s },
          mount.bolts.some((v) => v !== 0),
        ),
      );
    }
    const shelf = create("div");
    shelf.className = "fr-workbench-shelf";
    shelf.append(create("h4", "Parts counter"));
    shelf.append(
      field(
        "Part",
        GRADES.map((i) => [String(i), d.models[i] + " · $" + price(s, i)]),
        String(g),
        (v) => {
          view.grade = Number(v) as Grade;
        },
      ),
    );
    const count = workshop.spares[stockIndex(s, g)]!;
    shelf.append(create("span", count + " on your shelf"));
    const sale = create("div");
    sale.className = "fr-workbench-actions";
    sale.append(
      action(
        "Buy · $" + price(s, g),
        { type: "buy", station: s, grade: g },
        cash < price(s, g),
      ),
      action(
        "Sell · $" + resale(s, g),
        { type: "sell", station: s, grade: g },
        count === 0,
      ),
      action(
        "Fit from shelf",
        { type: "fit", station: s, grade: g },
        count === 0 || mount.part !== null,
      ),
    );
    shelf.append(sale);
    main.append(shelf);
    const timing = create("div");
    timing.className = "fr-workbench-fastener";
    timing.append(
      create(
        "span",
        "Ignition timing · " +
          (workshop.timing > 0 ? "+" : "") +
          workshop.timing,
      ),
      action("Retard", { type: "timing", delta: -1 }, workshop.timing <= -5),
      action("Advance", { type: "timing", delta: 1 }, workshop.timing >= 3),
    );
    main.append(timing);
    const state = inspectWorkshop(workshop);
    const status = create(
      "p",
      state.reason ||
        (state.automatic ? "Automatic" : "Manual") +
          " · " +
          (state.hp >= 0 ? "+" : "") +
          state.hp +
          " hp from bench setup",
    );
    status.setAttribute("role", "status");
    main.append(status);
  }
  render();
  return root;
}
