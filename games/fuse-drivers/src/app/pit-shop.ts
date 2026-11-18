import { button, el } from "fuse-ui";
import {
  buyOffroadUpgrade,
  OFFROAD_SHOP,
  type OffroadDriver,
  type OffroadPurchase,
} from "../game/offroad/campaign.js";

const PRODUCTS: readonly [OffroadPurchase, string][] = [
  ["nitros", "Nitro"],
  ["shocks", "Shocks"],
  ["tires", "Tires"],
  ["acceleration", "Acceleration"],
  ["topSpeed", "Top speed"],
];
const cash = (units: number) => "$" + (units * 10_000).toLocaleString("en-US");

/** The controls survive wallet changes, so buying twice keeps the same scroll position and focus. */
export function createPitShop(
  doc: Document,
  buy: (kind: OffroadPurchase) => boolean,
) {
  const element = el("div", "", "fd-shop", doc);
  const balance = el("p", "", "fd-shop-balance", doc);
  balance.setAttribute("role", "status");
  const list = el("div", "", "fd-shop-list", doc);
  const credit = el(
    "p",
    "You start with 25 nitros and 2 credits. When a purchase costs more than your cash, 1 credit adds $200,000 before payment.",
    "fd-shop-credit",
    doc,
  );
  const status = el("p", "", "fd-shop-status", doc);
  status.setAttribute("role", "status");
  element.append(balance, list, credit, status);
  const offers = PRODUCTS.map(([kind, name]) => {
    const control = button("", "fd-shop-offer", doc);
    const label = el("strong", name, "", doc);
    const owned = el("small", "", "", doc);
    const price = el("span", "", "fd-shop-price", doc);
    control.append(label, owned, price);
    control.onclick = () => {
      status.textContent = buy(kind)
        ? ""
        : "Purchase unavailable. Check your current balance.";
    };
    list.append(control);
    return { kind, control, owned, price };
  });
  return {
    element,
    focus() {
      element.scrollIntoView({ block: "nearest" });
      offers
        .find(({ control }) => !control.disabled)
        ?.control.focus({ preventScroll: true });
    },
    update(driver: OffroadDriver) {
      const summary = `${cash(driver.cash)} · ${driver.credits} ${driver.credits === 1 ? "credit" : "credits"}`;
      if (balance.textContent !== summary) balance.textContent = summary;
      for (const { kind, control, owned, price } of offers) {
        const { cost, cap } = OFFROAD_SHOP[kind];
        const n = driver[kind];
        const full = n >= cap;
        const description =
          kind === "nitros" ? `${n}/${cap} bottles` : `Level ${n}/${cap}`;
        const quote = full
          ? "Full"
          : cash(cost) +
            (driver.cash < cost
              ? driver.credits
                ? " · uses 1 credit"
                : " · insufficient funds"
              : "");
        if (owned.textContent !== description) owned.textContent = description;
        if (price.textContent !== quote) price.textContent = quote;
        control.disabled = buyOffroadUpgrade(driver, kind) === null;
      }
    },
  };
}
