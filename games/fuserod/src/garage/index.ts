import "./garage.css";
import { backOnEscape, createBackLink } from "fuse-ui";
import {
  activeCar,
  bankrupt,
  CHAMPIONSHIP,
  daysToGrudge,
  FINAL_DAY,
  finished,
  GEARS,
  GRUDGE_FEE,
  GRUDGE_PURSE,
  grudgeNight,
  loadCampaign,
  MODELS,
  partPrice,
  purse,
  repairPrice,
  rivalCar,
  RIVALS,
  ROAD_WINS_NEEDED,
  ROUTES,
  setup,
  stakes,
  transact,
  unlockedRank,
  WEEKDAYS,
  type Action,
  type Campaign,
  type Challenge,
  type ModelId,
  type Part,
  type Route,
  type StoragePort,
  type Vehicle,
} from "./campaign.js";

export { loadCampaign, settleRace, motorSetup } from "./campaign.js";
export type { Campaign, Challenge, Setup, StoragePort } from "./campaign.js";

export interface GarageOptions {
  backHref?: string;
  storage: StoragePort;
  onRace: (challenge: Challenge) => void;
  drawCar?: (
    canvas: HTMLCanvasElement,
    appearance: { model: number; paint: string; upgrade: number },
  ) => void;
  drawItem?: (
    kind: "rival" | "part" | "car",
    item: number | string,
    options?: { paint?: string; angle?: "side" | "front" | "quarter" },
  ) => Element;
}
type Tab = "Challenge" | "Workshop" | "Classifieds";
const money = (n: number) => `$${n.toLocaleString("en-US")}`;
export function mountGarage(
  host: HTMLElement,
  options: GarageOptions,
): () => void {
  const doc = host.ownerDocument;
  let tab: Tab = "Challenge",
    route: Route = "strip",
    wager = 0,
    pinkSlip = false,
    rivalRank: number | undefined;
  let disposed = false;
  const root = doc.createElement("section");
  root.className = "fr-garage";
  root.setAttribute("aria-label", "Campaign garage");
  host.append(root);
  const back = options.backHref
    ? createBackLink({ href: options.backHref, document: doc })
    : undefined;
  const stopEscape = back ? backOnEscape(back, { document: doc }) : undefined;
  let artSize: ResizeObserver | undefined;
  function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls = "",
    text = "",
  ): HTMLElementTagNameMap[K] {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function control(
    label: string,
    key: string,
    press: () => void,
    disabled = false,
    primary = false,
  ) {
    const b = node("button", primary ? "frg-primary" : "frg-button", label);
    b.type = "button";
    b.dataset.garageKey = key;
    b.disabled = disabled;
    b.onclick = press;
    return b;
  }
  function field(
    title: string,
    items: readonly { value: string; label: string; disabled?: boolean }[],
    selected: string,
    key: string,
    choose: (v: string) => void,
  ) {
    const lab = node("label", "frg-field");
    lab.append(node("span", "", title));
    const select = node("select");
    select.dataset.garageKey = key;
    for (const item of items) {
      const option = node("option", "", item.label);
      option.value = item.value;
      option.disabled = item.disabled ?? false;
      select.append(option);
    }
    select.value = selected;
    select.onchange = () => choose(select.value);
    lab.append(select);
    return lab;
  }
  function metric(label: string, value: string) {
    const cell = node("div", "frg-metric");
    cell.append(node("dt", "", label), node("dd", "", value));
    return cell;
  }
  function picture(
    row: HTMLElement,
    kind: "rival" | "car" | "part",
    item: string | number,
    paint?: string,
  ) {
    const image = options.drawItem?.(kind, item, { paint, angle: "quarter" });
    if (image) {
      image.classList.add("frg-thumbnail", `frg-${kind}`);
      row.prepend(image);
    }
  }
  function notice(text: string) {
    const n = node("p", "frg-notice", text);
    n.setAttribute("role", "status");
    return n;
  }
  function execute(a: Action, nextTab?: Tab) {
    const result = transact(options.storage, a);
    if (result.ok) {
      if (nextTab) tab = nextTab;
      if ((a.type === "race" || a.type === "grudge") && result.state.pending) {
        options.onRace(result.state.pending);
        return;
      }
    }
    render(result.ok ? "" : result.error);
  }
  function hero(s: Campaign, c: Vehicle | undefined) {
    const selected = c?.model ?? "kestrel",
      model = MODELS[selected];
    const section = node("div", "frg-hero");
    if (options.drawCar) {
      const canvas = node("canvas", "frg-art");
      canvas.setAttribute("aria-label", `${model.title} in the garage`);
      canvas.setAttribute("role", "img");
      section.append(canvas);
      const draw = () => {
        if (disposed || !canvas.isConnected) return;
        const box = canvas.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const scale = Math.min(2, doc.defaultView?.devicePixelRatio ?? 1);
        canvas.width = Math.round(box.width * scale);
        canvas.height = Math.round(box.height * scale);
        options.drawCar?.(canvas, {
          model: model.sprite,
          paint: model.paint,
          upgrade: c?.engine ?? 0,
        });
      };
      const Observer = doc.defaultView?.ResizeObserver;
      if (Observer) {
        artSize = new Observer(draw);
        artSize.observe(canvas);
      } else queueMicrotask(draw);
    }
    const title = node("div", "frg-car-title");
    title.append(
      node("p", "", c ? model.body : "Classifieds"),
      node("h2", "", model.title),
    );
    section.append(title);
    const stats = node("dl", "frg-stats");
    if (c)
      stats.append(
        metric("Power", `${setup(c).power} hp`),
        metric("Tyres", ["Stock", "Sport", "Race"][c.tyres]!),
        metric("Condition", `${c.condition}%`),
      );
    else
      stats.append(
        metric("Price", money(model.price)),
        metric("Power", `${model.hp} hp`),
        metric("Body", model.body),
      );
    section.append(stats);
    return section;
  }
  function classifieds(s: Campaign) {
    const list = node("div", "frg-rows");
    for (const id of Object.keys(MODELS) as ModelId[]) {
      const model = MODELS[id],
        owned = s.fleet.some((c) => c.model === id),
        driving = s.selected === id;
      const row = node("div", "frg-row"),
        info = node("div");
      info.append(
        node("h3", "", model.title),
        node("p", "", `${model.body} · ${model.hp} hp`),
      );
      row.append(
        info,
        control(
          driving
            ? "Selected"
            : owned
              ? "Select"
              : `Buy · ${money(model.price)}`,
          id,
          () =>
            execute({ type: owned ? "select" : "buy", model: id }, "Challenge"),
          driving || (!owned && model.price > s.cash),
          !owned && model.price <= s.cash,
        ),
      );
      picture(row, "car", model.sprite, model.paint);
      list.append(row);
    }
    return list;
  }
  function workshop(s: Campaign, c: Vehicle) {
    const list = node("div", "frg-rows");
    for (const part of ["engine", "tyres"] as const satisfies readonly Part[]) {
      const row = node("div", "frg-row"),
        desc = node("div"),
        grade = c[part],
        cost = partPrice(c, part);
      desc.append(
        node("h3", "", part === "engine" ? "Engine kit" : "Tyres"),
        node(
          "p",
          "",
          part === "engine"
            ? `${setup(c).power} hp${grade < 2 ? " · next kit adds 55 hp" : ""}`
            : `${["Stock compound", "Sport compound", "Race compound"][grade]} · grip under steering`,
        ),
      );
      row.append(
        desc,
        control(
          grade === 2 ? "Fully upgraded" : `Fit · ${money(cost)}`,
          part,
          () => execute({ type: "upgrade", part }),
          grade === 2 || cost > s.cash,
        ),
      );
      picture(row, "part", part);
      list.append(row);
    }
    list.append(
      field(
        "Final drive",
        GEARS.map((value, i) => ({
          value,
          label: [
            "Short · close ratios",
            "Street · stock ratios",
            "Tall · long ratios",
          ][i]!,
        })),
        c.gearing,
        "gears",
        (v) => execute({ type: "gear", gearing: v as Vehicle["gearing"] }),
      ),
    );
    const row = node("div", "frg-row"),
      desc = node("div"),
      cost = repairPrice(c);
    desc.append(
      node("h3", "", "Service"),
      node("p", "", `${c.condition}% condition · wear reduces effective power`),
    );
    row.append(
      desc,
      control(
        cost ? `Repair · ${money(cost)}` : "Serviced",
        "service",
        () => execute({ type: "repair" }),
        !cost || cost > s.cash,
      ),
    );
    picture(row, "part", "repair");
    list.append(row);
    return list;
  }
  function challenge(s: Campaign) {
    const active = s.pending;
    if (active) {
      const card = node("div", "frg-rows");
      const stake =
        active.stakeKind === "bracket"
          ? active.heat === 0
            ? "Grudge Night · set your dial-in"
            : `Grudge Night · heat ${active.heat} of 4 · dial-in ${(active.dialInTicks / 20).toFixed(2)} s`
          : active.stakeKind === "title"
            ? "Car titles at stake"
            : `${money(active.wager)} staked`;
      card.append(
        node(
          "h3",
          "",
          active.variant === "timed"
            ? "Solo qualifying run"
            : `Race against ${active.rivalName}`,
        ),
        node("p", "", `${ROUTES[active.route].name} · ${stake}`),
        control(
          "Resume race",
          "resume",
          () => options.onRace(active),
          false,
          true,
        ),
        control(
          active.stakeKind === "title"
            ? "Forfeit car title"
            : "Retire from race",
          "retire",
          () =>
            execute({ type: "settle", id: active.id, won: false, damage: 0 }),
        ),
      );
      return card;
    }
    const grid = node("div", "frg-race");
    const unlocked = unlockedRank(s),
      rank = Math.min(unlocked, rivalRank ?? unlocked);
    if (wager > s.cash) wager = 0;
    const rival = field(
      "Rival",
      RIVALS.map((label, i) => ({
        value: String(i),
        label: i > unlocked ? `${label} · locked` : label,
        disabled: i > unlocked,
      })),
      String(rank),
      "rival",
      (value) => {
        rivalRank = Number(value);
        render();
      },
    );
    const opponent = node("div", "frg-opponent");
    opponent.append(rival);
    picture(opponent, "rival", rank);
    grid.append(
      opponent,
      field(
        "Course",
        (Object.keys(ROUTES) as Route[]).map((value) => ({
          value,
          label: `${ROUTES[value].name} · ${ROUTES[value].description}`,
        })),
        route,
        "course",
        (v) => {
          route = v as Route;
        },
      ),
      field(
        "Stake",
        [
          ...stakes.map((value) => ({
            value: String(value),
            label: money(value),
            disabled: value > s.cash,
          })),
          { value: "title", label: "Car title", disabled: false },
        ],
        pinkSlip ? "title" : String(wager),
        "wager",
        (value) => {
          pinkSlip = value === "title";
          wager = pinkSlip ? 0 : Number(value);
          render();
        },
      ),
    );
    const offered = MODELS[rivalCar(rank)].title;
    const isFinal = rank === RIVALS.length - 1;
    if (isFinal) {
      grid.replaceChildren(
        opponent,
        node(
          "p",
          "frg-payout",
          `Three races against Redline: ${CHAMPIONSHIP.map((r) => ROUTES[r].name).join(" → ")}. The final leg costs the loser their car.`,
        ),
      );
    }
    const prize = node(
      "p",
      "frg-payout",
      pinkSlip
        ? `Win the ${offered} title or lose your car. Duplicate titles pay half the car price.`
        : `Win ${money(purse(rank) + 2 * wager)} including your stake. Each race takes one day.`,
    );
    if (!isFinal) grid.append(prize);
    grid.append(
      control(
        "Race " + RIVALS[rank],
        "race",
        () =>
          execute({ type: "race", route, wager, rivalRank: rank, pinkSlip }),
        false,
        true,
      ),
    );
    const event = node("div", "frg-event"),
      info = node("div");
    info.append(
      node("h3", "", "Grudge Night"),
      node(
        "p",
        "",
        s.qualified
          ? `Qualified · race again for ${money(GRUDGE_PURSE)}.`
          : `Set a quarter-mile dial-in, then win four heats without going faster to qualify for Redline and earn ${money(GRUDGE_PURSE)}.`,
      ),
    );
    const until = daysToGrudge(s.day),
      available = grudgeNight(s.day);
    const label = available
      ? `Enter · ${money(GRUDGE_FEE)}`
      : s.day + until <= FINAL_DAY
        ? `Wait ${until}d to enter`
        : "Closed for season";
    event.append(
      info,
      control(
        label,
        "grudge",
        () => execute({ type: available ? "grudge" : "wait" }),
        available ? s.cash < GRUDGE_FEE : s.day + until > FINAL_DAY,
      ),
    );
    grid.append(event);
    if (s.rank >= RIVALS.length - 2)
      grid.append(
        node(
          "p",
          "frg-standing",
          `Redline requirements · Summit wins ${s.canyonWins}/${ROAD_WINS_NEEDED} · Spillway wins ${s.aqueductWins}/${ROAD_WINS_NEEDED} · road wins ${s.canyonWins + s.aqueductWins}/${s.roadStarts} (half needed) · Grudge Night ${s.qualified ? "won" : "pending"}.`,
        ),
      );
    return grid;
  }
  function render(error = "") {
    if (disposed) return;
    const focused =
      doc.activeElement instanceof HTMLElement &&
      root.contains(doc.activeElement)
        ? doc.activeElement.dataset.garageKey
        : undefined;
    artSize?.disconnect();
    root.replaceChildren();
    let s: Campaign;
    try {
      s = loadCampaign(options.storage);
    } catch (reason) {
      root.append(
        notice(
          reason instanceof Error ? reason.message : "Garage save unavailable.",
        ),
        control("Retry", "retry", () => render()),
      );
      return;
    }
    const c = activeCar(s);
    const title = node("header", "frg-heading"),
      wallet = node("dl", "frg-wallet");
    title.append(node("h1", "", "Garage"));
    if (back) title.prepend(back);
    const day = Math.min(s.day, FINAL_DAY);
    wallet.append(
      metric("Day", `${WEEKDAYS[(day - 1) % 7]} ${day} / ${FINAL_DAY}`),
      metric("Cash", money(s.cash)),
    );
    title.append(wallet);
    root.append(title, hero(s, c));
    if (error || s.receipt) root.append(notice(error || s.receipt));
    if (finished(s)) {
      const end = node("div", "frg-end");
      end.append(
        node(
          "h2",
          "",
          s.rank === RIVALS.length
            ? "Season champion"
            : bankrupt(s)
              ? "Out of cars"
              : "Season complete",
        ),
        node(
          "p",
          "",
          bankrupt(s)
            ? "Your garage is empty and you cannot cover a replacement."
            : `${s.rank} of ${RIVALS.length} rivals beaten.`,
        ),
        control(
          "Start a new season",
          "restart",
          () => {
            rivalRank = undefined;
            wager = 0;
            pinkSlip = false;
            route = "strip";
            execute({ type: "restart" }, "Classifieds");
          },
          false,
          true,
        ),
      );
      root.append(end);
    } else {
      if (!c) tab = "Classifieds";
      if (s.pending) tab = "Challenge";
      const nav = node("nav", "frg-tabs");
      nav.setAttribute("aria-label", "Garage areas");
      for (const section of ["Challenge", "Workshop", "Classifieds"] as const) {
        const b = control(
          section,
          section,
          () => {
            tab = section;
            render();
          },
          (!c && section !== "Classifieds") ||
            (!!s.pending && section !== "Challenge"),
        );
        b.setAttribute("aria-pressed", String(tab === section));
        nav.append(b);
      }
      const panel = node("section", "frg-panel");
      panel.setAttribute("aria-label", tab);
      panel.append(
        tab === "Challenge"
          ? challenge(s)
          : tab === "Workshop" && c
            ? workshop(s, c)
            : classifieds(s),
      );
      root.append(nav, panel);
    }
    if (focused)
      root
        .querySelector<HTMLElement>(
          `[data-garage-key="${focused}"]:not(:disabled)`,
        )
        ?.focus({ preventScroll: true });
  }
  render();
  return () => {
    stopEscape?.();
    disposed = true;
    artSize?.disconnect();
    root.remove();
  };
}
