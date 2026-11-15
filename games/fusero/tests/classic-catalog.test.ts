import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLASSIC_PHYSICS,
  CLASSIC_PROJECTILES,
  CLASSIC_WEAPONS,
  weaponById,
  type ClassicProjectile,
  type ClassicWeapon,
} from "../src/engine/classic/catalog.js";
import { CLASSIC_DATA } from "../src/engine/classic/classic-data.js";
import {
  decodeClassicScript,
  generateClassicCatalog,
} from "../../../scripts/fusero-decode-classic.js";

const fixture = readFileSync(
  new URL("../upstream/classic-script.lgs", import.meta.url),
);
const names = [
  "Bazooka",
  "Big Nuke",
  "Blaster",
  "Booby Trap",
  "Bouncy Larpa",
  "Bouncy Mine",
  "Cannon",
  "Chaingun",
  "Chiquita Bomb",
  "Cluster bomb",
  "Crackler",
  "Dart",
  "Dirt Ball",
  "Doomsday",
  "Explosives",
  "Flamer",
  "Float Mine",
  "Gauss Gun",
  "Greenball",
  "Grasshopper",
  "Grenade",
  "Handgun",
  "Hellraider",
  "Larpa",
  "Laser",
  "Mine",
  "Minigun",
  "Mini Nuke",
  "Mini Rockets",
  "Napalm",
  "RB Rampage",
  "Rifle",
  "Shotgun",
  "Spikeballs",
  "Super Shotgun",
  "Uzi",
  "Winchester",
  "Zimm",
];
const weapon = (name: string): ClassicWeapon => {
  const value = CLASSIC_WEAPONS.find((value) => value.name === name);
  assert.ok(value, `missing native weapon ${name}`);
  return value;
};
const projectile = (name: string): ClassicProjectile => {
  const value = weapon(name);
  assert.equal(value.type, "projectile");
  assert.ok(value.type === "projectile");
  const result = CLASSIC_PROJECTILES[value.projectileId];
  assert.ok(result);
  return result;
};

test("the source is the pinned packaged Classic binary, including its native header and all bytes", () => {
  assert.equal(fixture.length, 12_004);
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    "ed0ab6247796c975cfea0e58c88ed2c2f8d930f58f88078b20cc476fa4e04d6d",
  );
  assert.equal(fixture.toString("ascii", 0, 17), "Liero Game Script");
  assert.equal(fixture.readInt32LE(20), 7);
  assert.equal(fixture.toString("ascii", 24, 34), "Liero v1.0");
  assert.equal(fixture.readInt32LE(88), 38);
  assert.equal(CLASSIC_DATA.decodedBytes, fixture.length);
  assert.equal(CLASSIC_DATA.modName, "Liero v1.0");
});

test("all 38 native weapon names and ids retain file order, including Booby Trap", () => {
  assert.deepEqual(
    CLASSIC_WEAPONS.map((value) => value.name),
    names,
  );
  assert.deepEqual(
    CLASSIC_WEAPONS.map((value) => value.id),
    Array.from({ length: 38 }, (_, id) => id),
  );
  for (const value of CLASSIC_WEAPONS)
    assert.equal(weaponById(value.id), value);
  for (const id of [-1, 38, NaN, Infinity, 0.5])
    assert.equal(weaponById(id), undefined);
});

test("Bazooka tuning comes from packaged data, not the outdated 37-weapon compiler example", () => {
  const bazooka = weapon("Bazooka");
  assert.equal(bazooka.sourceOffset, 92);
  assert.equal(bazooka.recoil, 15); // Example text says 10.
  assert.equal(fixture.readInt32LE(108), 15);
  assert.equal(bazooka.recharge, 1.7100000381469727);
  assert.equal(fixture.readFloatLE(112), bazooka.recharge);
  assert.equal(bazooka.drain, 33.33399963378906);
  assert.equal(bazooka.rofMs, 1071);
  assert.ok(bazooka.type === "projectile");
  assert.equal(bazooka.speed, 140); // Example text says 250.
  const missile = projectile("Bazooka");
  assert.equal(missile.sourceOffset, 160);
  assert.equal(missile.dampening, 1.0010000467300415);
  assert.equal(missile.gravity, 0);
  assert.equal(missile.hit.name, "explode");
  assert.equal(missile.hit.type === 1 && missile.hit.damage, 4);
  assert.equal(missile.playerHit.type === 1 && missile.playerHit.damage, 27);
  assert.equal(missile.spawn?.amount, 12);
});

test("all 69 projectile descriptors preserve native offsets and every nested reference resolves", () => {
  assert.equal(CLASSIC_PROJECTILES.length, 69);
  assert.equal(
    new Set(CLASSIC_PROJECTILES.map((value) => value.sourceOffset)).size,
    69,
  );
  let previous = -1;
  for (const [id, value] of CLASSIC_PROJECTILES.entries()) {
    assert.equal(value.id, id);
    assert.ok(value.sourceOffset > previous && value.sourceOffset < 11_964);
    previous = value.sourceOffset;
    assert.equal(fixture.readInt32LE(value.sourceOffset), value.rawType);
    assert.equal(value.width, value.type === "pixel" ? 2 : 4);
    assert.equal(value.height, value.width);
    for (const reference of [value.spawn, value.trail])
      if (reference) {
        const child = CLASSIC_PROJECTILES[reference.projectileId];
        assert.ok(
          child && child.id > id,
          "v7 embedded children follow their parent",
        );
      }
  }
  for (const value of CLASSIC_WEAPONS)
    if (value.type === "projectile")
      assert.ok(CLASSIC_PROJECTILES[value.projectileId]);
});

test("grenade fragments, Larpa trails and Grasshopper generations retain separate source rules", () => {
  const grenade = projectile("Grenade");
  assert.equal(grenade.sourceOffset, 7024);
  assert.equal(grenade.timerTime, 1.6430000066757202);
  assert.equal(grenade.timerVar, 0.14300000667572021);
  assert.equal(
    grenade.hit.type === 0 && grenade.hit.bounceCoeff,
    0.4000000059604645,
  );
  assert.equal(grenade.playerHit.name, "nothing");
  assert.equal(grenade.spawn?.amount, 50);
  assert.ok(grenade.spawn);
  const fragment = CLASSIC_PROJECTILES[grenade.spawn.projectileId]!;
  assert.equal(fragment.playerHit.type === 2 && fragment.playerHit.damage, 4);
  const larpa = projectile("Larpa");
  assert.equal(larpa.trail?.delayMs, 30);
  assert.equal(larpa.trail?.useParentVelocityForSpread, 1);
  let grasshopper = projectile("Grasshopper"),
    generations = 1;
  while (grasshopper.spawn) {
    grasshopper = CLASSIC_PROJECTILES[grasshopper.spawn.projectileId]!;
    generations++;
  }
  assert.equal(generations, 7);
  assert.equal(projectile("Dirt Ball").playerHit.name, "dirt");
  assert.equal(projectile("Greenball").hit.name, "greendirt");
  assert.equal(projectile("Flamer").hit.name, "carve");
});

test("beam fields and mod-specific worm/rope data survive without substituting global defaults", () => {
  const laser = weapon("Laser");
  assert.ok(laser.type === "beam");
  assert.deepEqual(laser.beam, {
    color: [255, 0, 0],
    damage: 0,
    playerDamage: 1,
    length: 999999,
  });
  assert.equal(laser.drain, 1.25);
  assert.equal(laser.rofMs, 9);
  assert.deepEqual(CLASSIC_PHYSICS.rope, {
    length: 300,
    rest: 27,
    strength: 4.5,
  });
  assert.deepEqual(CLASSIC_PHYSICS.worm, {
    angleSpeed: 150,
    groundSpeed: 8,
    airSpeed: 4,
    gravity: 100,
    jumpForce: -65,
    airFriction: 0,
    groundFriction: 0.4000000059604645,
  });
});

test("native animation geometry is preserved separately from logical hitboxes", () => {
  const expected = new Map([
    ["Flame.png", [96, 16, 6]],
    ["FloatMine.png", [32, 8, 4]],
    ["None.png", [1, 1, 1]],
    ["ZimmFlash.png", [88, 22, 4]],
  ]);
  const found = new Set<string>();
  for (const value of CLASSIC_PROJECTILES)
    if (value.type === "image" && value.animating) {
      assert.ok(value.bitmap, `native animation geometry for ${value.image}`);
      assert.deepEqual(
        [value.bitmap.width, value.bitmap.height, value.bitmap.frameCount],
        expected.get(value.image),
      );
      assert.equal(
        value.width,
        4,
        "sprite dimensions do not expand the native v7 hitbox",
      );
      const image = readFileSync(
        new URL(`../upstream/animation/${value.image}`, import.meta.url),
      );
      assert.equal(
        createHash("sha256").update(image).digest("hex"),
        value.bitmap.sourceSha256,
      );
      found.add(value.image);
    }
  assert.deepEqual([...found].sort(), [...expected.keys()].sort());
});

test("catalog arrays, descriptors, graphics and child spawn data are immutable", () => {
  assert.ok(Object.isFrozen(CLASSIC_WEAPONS));
  assert.ok(Object.isFrozen(CLASSIC_PROJECTILES));
  const bazooka = weapon("Bazooka"),
    missile = projectile("Bazooka");
  assert.equal(Reflect.set(bazooka, "recoil", 900), false);
  assert.equal(Reflect.set(missile.hit, "damage", 900), false);
  assert.ok(Object.isFrozen(missile.spawn));
  assert.ok(Object.isFrozen(CLASSIC_PHYSICS.rope));
  const laser = weapon("Laser");
  assert.ok(laser.type === "beam" && Object.isFrozen(laser.beam.color));
  assert.equal(bazooka.recoil, 15);
});

test("decoder rejects incomplete, mismatched and trailing input instead of emitting a partial catalog", () => {
  assert.throws(
    () => decodeClassicScript(fixture.subarray(0, 200)),
    /Truncated/,
  );
  const badId = Buffer.from(fixture);
  badId[0] = 0;
  assert.throws(() => decodeClassicScript(badId), /script id/);
  const badVersion = Buffer.from(fixture);
  badVersion.writeInt32LE(8, 20);
  assert.throws(() => decodeClassicScript(badVersion), /Expected Classic v7/);
  assert.throws(
    () => decodeClassicScript(Buffer.concat([fixture, Buffer.from([0])])),
    /trailing bytes/,
  );
});

test("the committed typed catalog regenerates exactly from the digest-verified native binary", async () => {
  await generateClassicCatalog(true);
});
