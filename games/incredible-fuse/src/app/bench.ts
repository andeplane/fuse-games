import { localPoint } from "fuse-ui";
import { BodyPlayback } from "./body-playback.js";
import {
  PARTS,
  PART_KINDS,
  canRotate,
  FREE_WORKSHOP,
  getPuzzle,
  available,
  partSize,
  placementIssue,
  type Machine,
  type MachineCommand,
  type PartKind,
} from "../game/machine.js";
import {
  canLink,
  canonicalLink,
  socketsFor,
  type LinkKind,
} from "../game/machine-links.js";
import { partIcon } from "./bench-art.js";
import {
  paintMachine,
  paintWorkbenchExtension,
  WIDTH,
  HEIGHT,
  type BoardPoint,
} from "./bench-board.js";
import "./bench.css";
export { paintMachine };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
}
function button(label: string, action: () => void, primary = false) {
  const node = element(
    "button",
    primary ? "fui-button fui-button-primary" : "fui-button",
    label,
  );
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
const statusText = {
  build: "Editing",
  running: "Running",
  failed: "Try again",
  solved: "Solved",
};
const linkNames: Record<LinkKind, string> = {
  wire: "Wire",
  rope: "Rope",
  belt: "Belt",
};

export function createBench(options: {
  frames: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;
  now: () => number;
  onCommand: (command: MachineCommand) => boolean | void;
}) {
  const root = element("section", "if-bench");
  root.setAttribute("aria-label", "Workshop");
  const extension = element("canvas", "if-bench-extension");
  extension.setAttribute("aria-hidden", "true");
  const head = element("header", "if-bench-head");
  const heading = element("div", "if-bench-heading"),
    label = element("span", "if-bench-index"),
    title = element("h2", "if-bench-title"),
    goal = element("p", "if-bench-goal");
  const headingRow = element("div", "if-bench-heading-row");
  headingRow.append(label, title);
  heading.append(headingRow, goal);
  const stateTag = element("span", "if-bench-status");
  const run = button(
    "Run machine",
    () => {
      if (machine && editable)
        send({ type: machine.mode === "build" ? "run" : "rewind" });
    },
    true,
  );
  run.classList.add("if-bench-run");
  const actions = element("div", "if-bench-actions");
  actions.append(stateTag, run);
  head.append(heading, actions);
  const layout = element("div", "if-bench-layout");
  const surface = element("div", "if-bench-surface");
  const canvas = element("canvas", "if-bench-board");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "group");
  canvas.setAttribute("aria-label", "Machine workbench");
  canvas.textContent =
    "Use the workbench arrow keys to move the cursor. Enter selects, places or moves a part.";
  const status = element("p", "if-bench-feedback");
  status.setAttribute("role", "status");
  const foot = element("div", "if-bench-foot");
  const tools = element("div", "if-bench-tools");
  const undo = button("Undo", () => send({ type: "undo" }));
  const rotate = button("Rotate", () => actOnPart("rotate"));
  rotate.title = "Rotate (R)";
  const flip = button("Flip", () => actOnPart("flip"));
  const remove = button("Remove", () => actOnPart("remove"));
  undo.title = "Undo (Cmd/Ctrl+Z)";
  flip.title = "Flip (F)";
  remove.title = "Remove (Delete)";
  tools.append(undo, rotate, flip, remove);
  foot.append(status, tools);
  const connections = element("div", "if-bench-links");
  connections.hidden = true;
  const boardFrame = element("div", "if-board-frame");
  boardFrame.append(canvas);
  surface.append(boardFrame, foot, connections);
  const tray = element("aside", "if-bench-tray");
  tray.setAttribute("aria-label", "Parts tray");
  const trayTitle = element("h3", "if-bench-tray-title", "Parts tray");
  const pieces = element("div", "if-bench-parts");
  const anchors = element("div", "if-bench-anchors");
  tray.append(trayTitle, pieces, anchors);
  layout.append(surface, tray);
  root.append(extension, head, layout);

  let machine: Machine | undefined,
    lastMode: Machine["mode"] | undefined,
    editable = false,
    puzzle = -1;
  let selected: number | undefined,
    tool: PartKind | undefined,
    link: LinkKind | undefined;
  let cursor: BoardPoint = { x: WIDTH / 2, y: HEIGHT / 2 };
  let cursorVisible = false,
    drag:
      | {
          id: number;
          pointer: number;
          start: BoardPoint;
          offset: BoardPoint;
          moved: boolean;
        }
      | undefined;
  let palette = new Map<
    PartKind,
    { button: HTMLButtonElement; count: HTMLElement }
  >();
  let linkKey = "",
    announcement = "",
    lastBuild = "";
  let keyboardMove = false;
  const activePart = () => machine?.parts.find((part) => part.id === selected);
  const building = () => machine?.mode === "build" && editable;
  function send(command: MachineCommand): boolean {
    if (!editable || !machine) return false;
    if (command.type !== "rewind" && machine.mode !== "build") return false;
    if (command.type === "undo" && !machine.undo.length) return false;
    if (command.type === "place" || command.type === "move") {
      const reason = placementIssue(machine, command);
      if (reason) {
        announcement = reason;
        refresh();
        return false;
      }
    }
    announcement = "";
    if (options.onCommand(command) === false) {
      announcement = "The room could not accept this action. Try again.";
      refresh();
      return false;
    }
    return true;
  }
  function actOnPart(type: "flip" | "remove" | "rotate") {
    const part = activePart();
    if (!building() || !part || part.fixed) return;
    send({ type, id: part.id });
  }
  function focusBoard() {
    canvas.focus({ preventScroll: true });
  }
  const playback = new BodyPlayback();
  let frame: number | undefined;
  function animate() {
    frame = undefined;
    if (!machine || !root.getClientRects().length) return;
    redraw();
    if (playback.pending(options.now()))
      frame = options.frames.requestAnimationFrame(animate);
  }
  function redraw() {
    if (!machine) return;
    paintWorkbenchExtension(extension);
    let ghost: { kind: PartKind; flip: boolean } | undefined;
    const part = activePart();
    if (building() && cursorVisible) {
      if (tool) ghost = { kind: tool, flip: false };
      else if (part && !part.fixed && !link && (!drag || drag.moved))
        ghost = { kind: part.kind, flip: part.flip };
    }
    paintMachine(canvas, playback.sample(machine, options.now()), {
      selected: building() ? selected : undefined,
      cursor: building() && cursorVisible ? cursor : undefined,
      ghost,
      link,
    });
  }
  function resetSelection() {
    keyboardMove = false;
    selected = undefined;
    tool = undefined;
    link = undefined;
    drag = undefined;
    announcement = "";
  }
  function choose(kind: PartKind) {
    if (!machine || !building() || !available(machine, kind)) return;
    resetSelection();
    tool = kind;
    cursorVisible = true;
    refresh();
    focusBoard();
  }
  function buildPalette(m: Machine) {
    const next = new Map<
      PartKind,
      { button: HTMLButtonElement; count: HTMLElement }
    >();
    pieces.replaceChildren();
    const stock = getPuzzle(m.puzzle).stock;
    for (const kind of PART_KINDS) {
      if (!stock[kind]) continue;
      const item = button("", () => choose(kind));
      item.className = "if-bench-part";
      item.setAttribute("aria-label", PARTS[kind].name);
      item.title = PARTS[kind].hint;
      const count = element("span", "if-bench-count"),
        name = element("span", "if-bench-part-name", PARTS[kind].name);
      item.append(partIcon(kind), name, count);
      pieces.append(item);
      next.set(kind, { button: item, count });
    }
    palette = next;
    const fixed = m.parts.filter((p) => p.fixed);
    anchors.hidden = !fixed.length || m.puzzle === FREE_WORKSHOP;
    anchors.replaceChildren();
    if (!anchors.hidden) {
      anchors.append(element("h3", "if-bench-tray-title", "Fixed parts"));
      const kinds = new Set(fixed.map((p) => p.kind));
      for (const kind of kinds) {
        const row = element("div", "if-bench-fixed");
        const description = element("div", "if-bench-fixed-copy");
        description.append(
          element("strong", "", PARTS[kind].name),
          element("p", "", PARTS[kind].hint),
        );
        row.append(partIcon(kind), description);
        anchors.append(row);
      }
    }
  }
  function renderLinks(m: Machine) {
    const part = activePart();
    if (!building() || !part) {
      connections.hidden = true;
      linkKey = "";
      return;
    }
    const links = m.links.filter(
      (wire) => wire.a === part.id || wire.b === part.id,
    );
    const key = JSON.stringify([part.id, link, links]);
    if (key === linkKey) return;
    linkKey = key;
    connections.replaceChildren();
    for (const kind of socketsFor(part.kind)) {
      const start = button(
        link === kind
          ? "Cancel " + linkNames[kind]
          : "Attach " + linkNames[kind],
        () => {
          link = link === kind ? undefined : kind;
          announcement = "";
          refresh();
          focusBoard();
        },
      );
      start.setAttribute("aria-pressed", String(link === kind));
      connections.append(start);
    }
    for (const wire of links) {
      const other = m.parts.find(
        (p) => p.id === (wire.a === part.id ? wire.b : wire.a),
      );
      if (other)
        connections.append(
          button(
            "Detach " + linkNames[wire.kind] + " · " + PARTS[other.kind].name,
            () => send({ type: "disconnect", ...wire }),
          ),
        );
    }
    connections.hidden = !connections.childElementCount;
  }
  function refresh() {
    if (!machine) return;
    const part = activePart(),
      isBuild = building(),
      mode = machine.mode;
    if (mode === "solved" && root.dataset.mode !== mode) {
      const targets = getPuzzle(machine.puzzle).targets;
      const target =
        targets.length === 1
          ? machine.parts.find((part) => part.id === targets[0])
          : undefined;
      boardFrame.classList.toggle("if-single-target", Boolean(target));
      boardFrame.style.setProperty(
        "--catch-x",
        ((target?.x ?? WIDTH / 2) / WIDTH) * 100 + "%",
      );
      boardFrame.style.setProperty(
        "--catch-y",
        ((target?.y ?? HEIGHT / 2) / HEIGHT) * 100 + "%",
      );
    }
    root.dataset.mode = mode;
    const nextStatus =
      announcement ||
      (!editable
        ? "Watching the machine."
        : mode === "failed"
          ? "Rewind, adjust the parts and run again."
          : mode === "solved"
            ? "Objective complete."
            : mode === "running"
              ? "Machine in motion."
              : link
                ? "Select a second part to attach the " +
                  linkNames[link].toLowerCase() +
                  "."
                : tool
                  ? PARTS[tool].name +
                    " · " +
                    PARTS[tool].hint +
                    " Tap the board to place."
                  : part
                    ? PARTS[part.kind].name +
                      (part.fixed
                        ? " · Fixed in place."
                        : " · Drag or tap a destination.")
                    : "Choose a part from the tray.");
    if (status.textContent !== nextStatus) status.textContent = nextStatus;
    if (stateTag.textContent !== statusText[mode])
      stateTag.textContent = statusText[mode];
    run.hidden = !editable;
    const runText = mode === "build" ? "Run machine" : "Rewind";
    if (run.textContent !== runText) run.textContent = runText;
    run.disabled = mode === "solved";
    tools.hidden = !editable;
    tray.hidden = !editable;
    undo.disabled = !isBuild || !machine.undo.length;
    flip.disabled = !isBuild || !part || part.fixed;
    remove.disabled = flip.disabled;
    rotate.hidden = !part || !canRotate(part.kind);
    rotate.disabled = flip.disabled;
    for (const [kind, item] of palette) {
      const n = available(machine, kind);
      item.button.disabled = !isBuild || n <= 0;
      item.button.setAttribute("aria-pressed", String(kind === tool));
      const value = String(n);
      if (item.count.textContent !== value) item.count.textContent = value;
    }
    renderLinks(machine);
    if (mode !== "running") redraw();
  }
  function hit(p: BoardPoint) {
    if (!machine) return;
    return [...machine.parts].reverse().find((part) => {
      const def = partSize(part),
        slop = 3;
      return (
        Math.abs(part.x - p.x) <= def.width / 2 + slop &&
        Math.abs(part.y - p.y) <= def.height / 2 + slop
      );
    });
  }
  function interact(p: BoardPoint) {
    if (!machine || !building()) return;
    announcement = "";
    const target = hit(p);
    if (tool) {
      if (send({ type: "place", kind: tool, x: p.x, y: p.y })) tool = undefined;
    } else if (link && selected !== undefined) {
      if (!target || target.id === selected) {
        announcement = "Choose another compatible part.";
      } else {
        const wire = canonicalLink(link, selected, target.id);
        if (canLink(machine.parts, machine.links, wire)) {
          if (send({ type: "connect", ...wire })) link = undefined;
        } else announcement = "Those sockets cannot take this connection.";
      }
    } else if (target) {
      selected = target.id;
    } else if (selected !== undefined && !activePart()?.fixed) {
      send({ type: "move", id: selected, x: p.x, y: p.y });
    } else selected = undefined;
    refresh();
  }
  function boardPoint(e: PointerEvent): BoardPoint {
    // Along the board's own axes: a phone's play screen draws the bench turned when the phone is upright.
    const r = localPoint(canvas, e.clientX, e.clientY);
    return {
      x: Math.max(0, Math.min(WIDTH, Math.round((r.x * WIDTH) / r.width))),
      y: Math.max(0, Math.min(HEIGHT, Math.round((r.y * HEIGHT) / r.height))),
    };
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0 || !building()) return;
    const p = boardPoint(e);
    cursor = p;
    keyboardMove = false;
    cursorVisible = false;
    announcement = "";
    focusBoard();
    const target = hit(p);
    if (!tool && !link && target && !target.fixed) {
      selected = target.id;
      drag = {
        id: target.id,
        pointer: e.pointerId,
        start: p,
        offset: { x: target.x - p.x, y: target.y - p.y },
        moved: false,
      };
    } else drag = undefined;
    canvas.setPointerCapture(e.pointerId);
    refresh();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!e.isPrimary || !building()) return;
    const p = boardPoint(e);
    cursor = p;
    if (drag && e.pointerId === drag.pointer) {
      cursor = { x: p.x + drag.offset.x, y: p.y + drag.offset.y };
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 3)
        drag.moved = true;
      cursorVisible = drag.moved;
    } else cursorVisible = e.pointerType === "mouse" && Boolean(tool || link);
    redraw();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (
      !e.isPrimary ||
      e.button !== 0 ||
      !canvas.hasPointerCapture(e.pointerId)
    )
      return;
    const p = boardPoint(e),
      r = localPoint(canvas, e.clientX, e.clientY),
      inside = r.x >= 0 && r.x <= r.width && r.y >= 0 && r.y <= r.height;
    const held = drag;
    drag = undefined;
    canvas.releasePointerCapture(e.pointerId);
    cursorVisible = false;
    if (!inside || !building()) {
      refresh();
      return;
    }
    if (held?.moved) {
      send({
        type: "move",
        id: held.id,
        x: p.x + held.offset.x,
        y: p.y + held.offset.y,
      });
      refresh();
    } else interact(p);
  });
  canvas.addEventListener("pointercancel", () => {
    drag = undefined;
    cursorVisible = false;
    redraw();
  });
  canvas.addEventListener("pointerleave", () => {
    if (!drag) {
      cursorVisible = false;
      redraw();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (
      !editable ||
      !machine ||
      e.altKey ||
      document.querySelector("dialog[open]")
    )
      return;
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === "z"
    ) {
      e.preventDefault();
      if (!e.repeat) send({ type: "undo" });
      return;
    }
    if (e.target !== canvas || e.ctrlKey || e.metaKey) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat && !run.disabled) run.click();
      return;
    }
    if (!building()) return;
    const step = e.shiftKey ? 1 : 8;
    const deltas: Record<string, BoardPoint> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = deltas[e.key];
    if (delta) {
      e.preventDefault();
      keyboardMove = Boolean(
        activePart() && !activePart()?.fixed && !tool && !link,
      );
      cursor = {
        x: Math.max(0, Math.min(WIDTH, cursor.x + delta.x)),
        y: Math.max(0, Math.min(HEIGHT, cursor.y + delta.y)),
      };
      cursorVisible = true;
      canvas.setAttribute(
        "aria-description",
        "Cursor " + cursor.x + ", " + cursor.y,
      );
      redraw();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!e.repeat) {
        if (keyboardMove && selected !== undefined) {
          if (send({ type: "move", id: selected, ...cursor }))
            keyboardMove = false;
        } else interact(cursor);
      }
    }
    if (e.key.toLowerCase() === "r" && activePart() && !rotate.hidden) {
      e.preventDefault();
      if (!e.repeat) actOnPart("rotate");
    }
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (!e.repeat) actOnPart("flip");
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!e.repeat) actOnPart("remove");
    }
    if (e.key === "Escape" && (selected !== undefined || tool || link)) {
      e.preventDefault();
      e.stopPropagation();
      resetSelection();
      cursorVisible = false;
      refresh();
    }
  });
  const resize =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => redraw());
  resize?.observe(canvas);
  resize?.observe(extension);
  return {
    element: root,
    update(next: Machine, canEdit: boolean) {
      playback.update(next, options.now());
      if (playback.pending(options.now()) && frame === undefined)
        frame = options.frames.requestAnimationFrame(animate);
      if (next.mode === "build" && frame !== undefined) {
        options.frames.cancelAnimationFrame(frame);
        frame = undefined;
      }
      // Room frames also arrive while everyone is studying the same motionless bench.
      // Capture values so this also detects in-place edits and rollback to the same tick.
      const stamp =
        next.mode === "build"
          ? JSON.stringify([
              next.puzzle,
              next.parts,
              next.links,
              next.undo.length,
              next.imported,
              canEdit,
            ])
          : "";
      if (stamp && stamp === lastBuild) {
        machine = next;
        return;
      }
      lastBuild = stamp;
      const changed = next.puzzle !== puzzle;
      if (changed || next.mode !== lastMode || canEdit !== editable) {
        resetSelection();
        cursorVisible = false;
        linkKey = "";
      }
      machine = next;
      lastMode = next.mode;
      editable = canEdit;
      if (changed) {
        puzzle = next.puzzle;
        const spec = getPuzzle(puzzle);
        label.textContent =
          puzzle === FREE_WORKSHOP
            ? "Sandbox"
            : "Puzzle " + String(puzzle + 1).padStart(2, "0");
        title.textContent = spec.title;
        goal.textContent = spec.goal;
        buildPalette(next);
      }
      if (selected !== undefined && !activePart()) resetSelection();
      if (tool && available(next, tool) <= 0) {
        tool = undefined;
        cursorVisible = false;
      }
      refresh();
    },
    /** Drops a drag in progress: the board has just moved under the finger. */
    cancel() {
      drag = undefined;
      cursorVisible = false;
      redraw();
    },
    dispose() {
      if (frame !== undefined) options.frames.cancelAnimationFrame(frame);
      resize?.disconnect();
    },
  };
}
