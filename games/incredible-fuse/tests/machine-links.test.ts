import assert from "node:assert/strict";
import test from "node:test";
import {
  canLink,
  canonicalLink,
  compareLinks,
  connectedNeighbors,
  linkedParts,
  socketPosition,
  socketsFor,
  validLinks,
  type MachineLink,
} from "../src/game/machine-links.js";

const parts = [
  "outlet",
  "motor",
  "belt",
  "generator",
  "bulb",
  "pulley",
  "seesaw",
  "balloon",
  "eyelet",
].map((kind, i) => ({ id: i + 1, kind, x: 100 + i * 20, y: 100, flip: false }));

test("a switch plugs into a motor and its belt drives one conveyor", () => {
  const wire = canonicalLink("wire", 2, 1);
  const belt = canonicalLink("belt", 2, 3);
  const other = canonicalLink("wire", 4, 5);
  const links = [wire, belt, other].sort(compareLinks);
  assert.ok(validLinks(parts, links));
  assert.deepEqual(linkedParts(links, "wire", 1), [1, 2]);
  assert.deepEqual(linkedParts(links, "belt", 2), [2, 3]);
  assert.deepEqual(linkedParts(links, "wire", 4), [4, 5]);
  assert.equal(canLink(parts, links, canonicalLink("wire", 4, 2)), false);
  assert.equal(canLink(parts, [], canonicalLink("wire", 1, 3)), false);
  assert.deepEqual(socketsFor("motor"), ["wire", "belt"]);
});

test("a cord follows moving bodies and passes through its connected pulley", () => {
  const links = [canonicalLink("rope", 6, 7), canonicalLink("rope", 6, 8)].sort(
    compareLinks,
  );
  assert.ok(validLinks(parts, links));
  assert.deepEqual(connectedNeighbors(links, "rope", 6), [7, 8]);
  assert.deepEqual(linkedParts(links, "rope", 8), [6, 7, 8]);
  assert.deepEqual(linkedParts(links, "rope", 9), [9]);
  assert.equal(canLink(parts, links, canonicalLink("rope", 6, 9)), false);
  assert.deepEqual(socketPosition(parts[7]!, "rope", { x: 11, y: 20 }), {
    x: 11,
    y: 36,
  });
  assert.deepEqual(
    socketPosition(parts[6]!, "rope", { x: 100, y: 90 }, { x: 45, y: 10 }),
    { x: 62, y: 87 },
  );
  assert.deepEqual(
    socketPosition(parts[6]!, "rope", { x: 100, y: 90 }, { x: 120, y: 10 }),
    { x: 138, y: 87 },
  );
});

test("checkpoints reject dangling, reversed, oversubscribed and duplicate connections", () => {
  const first = canonicalLink("wire", 1, 2),
    other = canonicalLink("wire", 4, 5);
  for (const edges of [
    [first, first],
    [other, first],
    [{ ...first, a: 2, b: 1 }],
    [first, { kind: "wire", a: 2, b: 4 }],
    [{ ...first, b: 99 }],
    [{ ...first, a: 1.4 }],
    [{ ...first, extra: 1 }],
    [null],
    [{}],
  ])
    assert.equal(validLinks(parts, edges), false);
  assert.equal(validLinks(parts.slice(1), [first]), false);
  assert.deepEqual(linkedParts([first, other].reverse(), "wire", 1), [1, 2]);
});

test("a cord circuit can be closed without looping during traversal", () => {
  const pulleys = [1, 2, 3].map((id) => ({ id, kind: "pulley" }));
  const loop: MachineLink[] = [
    canonicalLink("rope", 1, 2),
    canonicalLink("rope", 2, 3),
    canonicalLink("rope", 3, 1),
  ].sort(compareLinks);
  assert.ok(validLinks(pulleys, loop));
  assert.deepEqual(linkedParts(loop, "rope", 3), [1, 2, 3]);
});
