import { createDialog } from "fuse-ui";
import type { BattleState, BattleSample } from "../game/simulation.js";
import { TEAM_COLORS } from "./arena.js";
import "./charts.css";

const color = (team: number) => TEAM_COLORS[team] ?? TEAM_COLORS[0];
const STRATEGIES = ["Balanced", "Rush", "Economy", "Fortress", "Glass", "Tank"];
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
type Player = BattleSample["players"][number];
type Metric = {
  name: string;
  unit: string;
  values: (number | null)[][];
  step?: boolean;
  note?: string;
};
type Profile = { name: string; team: number; affinity: number[] };
type Chart = Metric | Profile;
const isProfile = (chart: Chart): chart is Profile => "affinity" in chart;

/** Build charts from the recorded match samples, never from preview data. */
export function createBattleCharts(
  battle: BattleState,
  names: readonly string[],
): HTMLElement {
  const root = document.createElement("section");
  root.className = "particle-charts";
  const samples = battle.samples;
  const firstSample = samples[0];
  if (!firstSample) {
    root.textContent = "No match timeline is available.";
    return root;
  }
  const players = Math.min(4, firstSample.players.length);
  const defs: [string, string, keyof Player, boolean?, string?][] = [
    ["Army Size", "Units", "army"],
    ["Military Power", "Power", "power"],
    [
      "Kills / Min",
      "Kills per minute",
      "kpm",
      false,
      "30-second rolling window",
    ],
    ["Base HP", "HP", "hp"],
    ["Gold (Unspent)", "Gold", "gold"],
    ["Total Gold Produced", "Gold", "produced"],
    ["Total Upgrade Levels", "Levels", "totalUpgrades", true],
    ["Population Cap Pressure", "% of cap", "capPressure"],
    ["Damage / Second", "Damage per second", "dps"],
    ["Frontline Position", "Cells from home", "frontline"],
    ["Tower Count", "Towers", "towers", true],
    ["Tower Kills (Cumulative)", "Kills", "towerKills", true],
  ];
  const metric = (
    name: string,
    unit: string,
    get: (p: Player) => number | null,
    step = false,
    note?: string,
  ): Metric => ({
    name,
    unit,
    step,
    note,
    values: samples.map((s) => s.players.slice(0, players).map(get)),
  });
  const timeline = defs.map(([name, unit, key, step, note]) =>
    metric(
      name,
      unit,
      (p) => {
        const value = p[key];
        return typeof value === "number" && Number.isFinite(value)
          ? key === "capPressure"
            ? 100 * value
            : value
          : null;
      },
      step,
      note,
    ),
  );
  timeline.push(metric("Territory", "Owned cells", (p) => p.territory));
  const upgradeDefs = [
    ["Health", "health"],
    ["Attack", "attack"],
    ["Radius", "radius"],
    ["Spawn Rate", "spawnRate"],
    ["Speed", "speed"],
    ["Max Particles", "maxParticles"],
    ["Defense", "defense"],
    ["Interest Rate", "interestRate"],
  ] as const;
  const upgrades = upgradeDefs.map(([name, id]) =>
    metric(`${name} Level`, "Level", (p) => p.upgrades[id], true),
  );
  const profiles: Profile[] = battle.affinities
    .slice(0, players)
    .map((affinity, team) => ({
      name: `Strategy Profile — ${names[team] ?? `Player ${team + 1}`}`,
      team,
      affinity,
    }));
  const cards: { canvas: HTMLCanvasElement; chart: Chart }[] = [];
  const shell = createDialog({ title: "Match chart" });
  shell.dialog.classList.add("particle-chart-dialog");
  root.append(shell.dialog);
  let cursor = samples.length - 1;
  let active: Chart | undefined;
  let origin: HTMLButtonElement | undefined;
  let keyboard = false;
  const canvas = document.createElement("canvas");
  canvas.className = "particle-chart-detail-plot";
  const note = document.createElement("p");
  const readout = document.createElement("div");
  readout.className = "particle-chart-readout";
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = String(samples.length - 1);
  range.setAttribute("aria-label", "Match time");
  const profileValues = document.createElement("ul");
  const legend = document.createElement("div");
  legend.className = "particle-chart-legend";
  for (let i = 0; i < players; i++) {
    const item = document.createElement("span");
    item.style.color = color(i);
    item.textContent = names[i] ?? `Player ${i + 1}`;
    legend.append(item);
  }
  root.append(legend);
  const addSection = (title: string, charts: Chart[], profile = false) => {
    const heading = document.createElement("h3");
    heading.textContent = title;
    root.append(heading);
    const grid = document.createElement("div");
    grid.className = `particle-chart-grid${profile ? " particle-chart-profiles" : ""}`;
    for (const chart of charts) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "particle-chart-tile";
      button.setAttribute("aria-label", `Enlarge ${chart.name}`);
      const label = document.createElement("span");
      label.textContent = chart.name;
      const hint = document.createElement("small");
      hint.textContent = "Enlarge";
      const plot = document.createElement("canvas");
      plot.setAttribute("aria-hidden", "true");
      button.append(label, hint, plot);
      grid.append(button);
      cards.push({ canvas: plot, chart });
      button.addEventListener("click", (event) => {
        active = chart;
        origin = button;
        keyboard = event.detail === 0;
        note.textContent = isProfile(chart)
          ? "Relative affinity by strategy"
          : [chart.unit, chart.note].filter(Boolean).join(" · ");
        range.hidden = isProfile(chart);
        readout.hidden = isProfile(chart);
        profileValues.hidden = !isProfile(chart);
        profileValues.replaceChildren();
        if (isProfile(chart))
          chart.affinity.forEach((v, i) => {
            const li = document.createElement("li");
            li.textContent = `${STRATEGIES[i]} ${number.format(v)}%`;
            profileValues.append(li);
          });
        shell.show({
          title: chart.name,
          content: [note, canvas, range, readout, profileValues],
        });
        update();
      });
    }
    root.append(grid);
  };
  addSection("Match timeline", timeline);
  addSection("Upgrades", upgrades);
  addSection("Strategy profiles", profiles, true);
  shell.dialog.addEventListener("close", () => {
    active = undefined;
    if (keyboard) origin?.focus({ preventScroll: true });
    else origin?.blur();
  });
  function update() {
    if (!active) return;
    if (!isProfile(active)) {
      const labels = [
        clock(samples[cursor]?.timeSec ?? 0),
        ...(active.values[cursor] ?? []).map(
          (value, i) =>
            `${names[i] ?? `Player ${i + 1}`}: ${value === null ? "—" : number.format(value)}`,
        ),
      ];
      readout.replaceChildren(
        ...labels.map((label, i) => {
          const span = document.createElement("span");
          span.textContent = label;
          if (i) span.style.color = color(i - 1);
          return span;
        }),
      );
      range.value = String(cursor);
      range.setAttribute("aria-valuetext", labels.join(", "));
    }
    draw(canvas, active, true);
  }
  range.addEventListener("input", () => {
    cursor = Number(range.value);
    update();
  });
  const pointer = (event: PointerEvent) => {
    if (!active || isProfile(active)) return;
    const rect = canvas.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (event.clientX - rect.left - 47) / Math.max(1, rect.width - 63),
      ),
    );
    cursor = Math.round(fraction * (samples.length - 1));
    update();
  };
  canvas.addEventListener("pointerdown", pointer);
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || event.buttons) pointer(event);
  });
  function draw(plot: HTMLCanvasElement, chart: Chart, detail = false) {
    const width = plot.clientWidth,
      height = plot.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    plot.width = Math.ceil(width * ratio);
    plot.height = Math.ceil(height * ratio);
    const ctx = plot.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.font = "11px ui-monospace, monospace";
    const left = detail ? 47 : 32,
      right = width - 16,
      top = 13,
      bottom = height - 22;
    const rule = (
      x: number,
      y: number,
      x2: number,
      y2: number,
      color = "#2a3a48",
    ) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    ctx.textAlign = "right";
    if (isProfile(chart)) {
      for (const pct of [0, 50, 100]) {
        const y = bottom - (pct * (bottom - top)) / 100;
        rule(left, y, right, y);
        ctx.fillStyle = "#a7b6c3";
        ctx.fillText(`${pct}%`, left - 4, y + 4);
      }
      const slot = (right - left) / STRATEGIES.length;
      ctx.textAlign = "center";
      STRATEGIES.forEach((label, i) => {
        const value = Math.max(0, Math.min(100, chart.affinity[i] ?? 0));
        const x = left + slot * (i + 0.5),
          y = bottom - (value * (bottom - top)) / 100;
        ctx.fillStyle = color(chart.team);
        ctx.globalAlpha = 0.72;
        ctx.fillRect(x - slot * 0.25, y, slot * 0.5, bottom - y);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#c8d6dd";
        ctx.fillText(slot < 49 ? label.slice(0, 4) : label, x, height - 5);
        if (detail)
          ctx.fillText(
            `${number.format(value)}%`,
            x,
            y > top + 12 ? y - 4 : y + 13,
          );
      });
      return;
    }
    const observed = chart.values
      .flat()
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const largest = Math.max(1, ...observed);
    const magnitude = 10 ** Math.floor(Math.log10(largest));
    const max = Math.ceil(largest / magnitude) * magnitude;
    const toX = (i: number) =>
      left + ((right - left) * i) / Math.max(1, samples.length - 1);
    const toY = (v: number) => bottom - ((bottom - top) * Math.max(0, v)) / max;
    const steps = detail ? 4 : 2;
    for (let i = 0; i <= steps; i++) {
      const y = toY((max * i) / steps);
      ctx.fillStyle = "#a7b6c3";
      ctx.textAlign = "right";
      ctx.fillText(compact.format((max * i) / steps), left - 5, y + 3);
      rule(left, y, right, y);
      const sample = Math.round(((samples.length - 1) * i) / steps);
      ctx.textAlign = i === 0 ? "left" : i === steps ? "right" : "center";
      ctx.fillText(
        clock(samples[sample]?.timeSec ?? 0),
        toX(sample),
        height - 5,
      );
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(left - 2, top - 3, right - left + 4, bottom - top + 6);
    ctx.clip();
    for (let team = 0; team < players; team++) {
      ctx.beginPath();
      ctx.strokeStyle = color(team);
      ctx.lineWidth = detail ? 2 : 1.35;
      ctx.setLineDash(
        team === 0
          ? []
          : team === 1
            ? [5, 3]
            : team === 2
              ? [2, 3]
              : [8, 3, 2, 3],
      );
      let previous: number | null = null;
      chart.values.forEach((values, i) => {
        const value = values[team];
        if (value == null || !Number.isFinite(value)) {
          previous = null;
          return;
        }
        const x = toX(i),
          y = toY(value);
        if (previous === null) ctx.moveTo(x, y);
        else {
          if (chart.step) ctx.lineTo(x, previous);
          ctx.lineTo(x, y);
        }
        previous = y;
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (detail) {
      const x = toX(cursor);
      rule(x, top, x, bottom, "#a7b6c3");
      (chart.values[cursor] ?? []).forEach((v, team) => {
        if (v === null || !Number.isFinite(v)) return;
        ctx.fillStyle = color(team);
        ctx.beginPath();
        ctx.arc(x, toY(v), 3.5, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
    ctx.restore();
  }
  // Observing each canvas draws when the results screen becomes visible and when its layout changes.
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const card = cards.find((item) => item.canvas === entry.target);
      if (card) draw(card.canvas, card.chart);
      else if (entry.target === canvas && active) update();
    }
  });
  cards.forEach((card) => observer.observe(card.canvas));
  observer.observe(canvas);
  return root;
}
