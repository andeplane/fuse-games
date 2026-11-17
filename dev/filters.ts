import type {
  EventConstraint,
  EventFilters,
} from "fuse-telemetry/explorer-contracts";
import type { Dom } from "./dom.js";

export const fieldLabel = (field: string) =>
  ({
    occurredAt: "Time · UTC",
    name: "Event",
    kind: "Event type",
    gameId: "Game",
    userId: "Player",
    sessionId: "Session",
    accountId: "Account ID",
    accountName: "Username",
  })[field] ?? field.replace(/^properties\./, "");
let comboId = 0;
export function gameAutocomplete(
  dom: Dom,
  games: readonly string[],
  value: string,
  changed?: (value: string) => void,
): { element: HTMLElement; input: HTMLInputElement } {
  const { node, button } = dom;
  const element = node("div", "game-combobox");
  const input = node("input");
  input.type = "text";
  input.value = value;
  input.placeholder = "All games";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  const list = node("div", "game-options");
  list.id = `game-options-${++comboId}`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.setAttribute("aria-controls", list.id);
  let active = -1;
  const hide = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const draw = (query: string) => {
    active = -1;
    list.replaceChildren();
    const options = [["", "All games"], ...games.map((id) => [id, id])].filter(
      ([, label]) => label!.toLowerCase().includes(query.toLowerCase()),
    );
    for (const [index, [id, label]] of options.entries()) {
      const option = button(
        label!,
        () => {
          input.value = id!;
          changed?.(input.value);
          hide();
          input.focus({ preventScroll: true });
        },
        "game-option",
      );
      option.id = `${list.id}-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      // Keep focus inside the textbox, preserving its keyboard interaction model.
      option.addEventListener("mousedown", (event) => event.preventDefault());
      list.append(option);
    }
    if (!options.length) list.append(node("p", "muted", "No matching games"));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("focus", () => draw(""));
  input.addEventListener("click", () => draw(""));
  input.addEventListener("input", () => {
    changed?.(input.value);
    draw(input.value);
  });
  element.addEventListener("focusout", (event) => {
    if (!element.contains(event.relatedTarget as Node | null)) hide();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
      return;
    }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) draw("");
      const options = [...list.querySelectorAll<HTMLButtonElement>("button")];
      active = Math.max(
        0,
        Math.min(
          options.length - 1,
          active + (event.key === "ArrowDown" ? 1 : -1),
        ),
      );
      options.forEach((option, index) =>
        option.setAttribute("aria-selected", String(index === active)),
      );
      const selected = options[active];
      if (selected) {
        input.setAttribute("aria-activedescendant", selected.id);
        selected.scrollIntoView?.({ block: "nearest" });
      }
    } else if (event.key === "Enter" && !list.hidden && active >= 0) {
      event.preventDefault();
      list.querySelectorAll<HTMLButtonElement>("button")[active]?.click();
    }
  });
  element.append(input, list);
  return { element, input };
}
export function constrain(
  filters: EventFilters,
  rule: EventConstraint,
): EventFilters {
  return {
    groups: (filters.groups.length ? filters.groups : [[]]).map((group) => [
      ...group.filter(
        (item) =>
          !(
            item.field === rule.field &&
            item.operator === rule.operator &&
            item.value === rule.value
          ),
      ),
      rule,
    ]),
  };
}
export function filterEditor(
  dom: Dom,
  filters: EventFilters,
  fields: readonly string[],
  change: (filters: EventFilters, rebuild?: boolean, focusKey?: string) => void,
): HTMLElement {
  const { node, select, field, button } = dom;
  const section = node("details", "filter-builder");
  section.open = filters.groups.length > 0;
  const count = filters.groups.reduce((sum, group) => sum + group.length, 0);
  const summary = node(
    "summary",
    "",
    count ? `Filters · ${count} constraints` : "Add filters",
  );
  summary.dataset.focusKey = "filters-summary";
  section.append(summary);
  const body = node("div", "filter-groups");
  const update = (
    edit: (next: EventFilters) => void,
    rebuild = true,
    focusKey = "filters-summary",
  ) => {
    const next = structuredClone(filters);
    edit(next);
    filters = next;
    change(next, rebuild, focusKey);
  };
  const operators = [
    ["eq", "is"],
    ["neq", "is not"],
    ["contains", "contains"],
    ["gt", ">"],
    ["gte", "≥"],
    ["lt", "<"],
    ["lte", "≤"],
    ["exists", "exists"],
  ] as const;
  filters.groups.forEach((group, groupIndex) => {
    if (groupIndex) body.append(node("p", "filter-join", "OR"));
    const block = node("div", "filter-group");
    group.forEach((rule, index) => {
      const row = node("div", "constraint");
      const property = select(
        [...new Set([...fields, rule.field])].map((key) => [
          key,
          fieldLabel(key),
        ]),
        rule.field,
      );
      const operator = select(operators, rule.operator);
      const value = node("input");
      value.value = rule.value === null ? "null" : String(rule.value);
      value.maxLength = 200;
      const valueType = select(
        [
          ["string", "Text"],
          ["number", "Number"],
          ["boolean", "Boolean"],
          ["null", "Null"],
        ],
        rule.value === null ? "null" : typeof rule.value,
      );
      value.disabled = valueType.value === "null";
      property.dataset.eventField = "true";
      for (const [name, control] of [
        ["property", property],
        ["operator", operator],
        ["type", valueType],
        ["value", value],
      ] as const)
        control.dataset.focusKey = `filter-${groupIndex}-${index}-${name}`;
      const save = () => {
        value.disabled = valueType.value === "null";
        update((next) => {
          const text = value.value;
          const parsed =
            valueType.value === "null"
              ? null
              : valueType.value === "boolean"
                ? text.toLowerCase() === "true"
                : valueType.value === "number"
                  ? Number(text)
                  : text;
          if (typeof parsed === "number" && !Number.isFinite(parsed)) return;
          next.groups[groupIndex]![index] = {
            field: property.value,
            operator: operator.value as EventConstraint["operator"],
            value: parsed,
          };
        }, false);
      };
      property.addEventListener("change", save);
      operator.addEventListener("change", save);
      value.addEventListener("change", save);
      valueType.addEventListener("change", save);
      row.append(
        node("span", "filter-join", index ? "AND" : "Where"),
        field("Property", property),
        field("Condition", operator),
        field("Type", valueType),
        field("Value", value),
        button(
          "Remove",
          () =>
            update(
              (next) => {
                next.groups[groupIndex]!.splice(index, 1);
                next.groups = next.groups.filter((group) => group.length);
              },
              true,
              "filters-summary",
            ),
          "quiet",
        ),
      );
      block.append(row);
    });
    if (group.length < 8)
      block.append(
        button(
          "Add AND constraint",
          () =>
            update(
              (next) => {
                next.groups[groupIndex]!.push({
                  field: "kind",
                  operator: "eq",
                  value: "round",
                });
              },
              true,
              `filter-${groupIndex}-${group.length}-property`,
            ),
          "quiet",
        ),
      );
    body.append(block);
  });
  if (filters.groups.length < 8)
    body.append(
      button(
        filters.groups.length ? "Add OR group" : "Add constraint",
        () =>
          update(
            (next) => {
              next.groups.push([
                { field: "kind", operator: "eq", value: "round" },
              ]);
            },
            true,
            `filter-${filters.groups.length}-0-property`,
          ),
        "quiet",
      ),
    );
  if (count)
    body.append(
      button("Clear constraints", () => change({ groups: [] }), "quiet"),
    );
  body.append(
    node(
      "p",
      "muted",
      "Every row in a group must match (AND). Any group can match (OR). Click a value in a table to narrow every group.",
    ),
  );
  section.append(body);
  return section;
}
