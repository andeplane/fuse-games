/////////////////////////////////////////
//
//                  OpenLieroX
//
// code under LGPL, based on JasonBs work,
// enhanced by Dark Charlie and Albert Zeyer
//
//
/////////////////////////////////////////

// Game script class
// Created 7/2/02
// Jason Boettcher
//
// ALTERED SOURCE: TypeScript translation of the v7 binary-reading paths in
// CGameScript.cpp at 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
// This extracts immutable Classic data; it does not implement the original engine.
// See games/fusero/upstream/SOURCE.md and the preserved upstream license notices.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import type {
  ClassicAction,
  ClassicBeam,
  ClassicBitmap,
  ClassicCatalogData,
  ClassicFlag,
  ClassicProjectile,
  ClassicSpawn,
  ClassicTrail,
  ClassicWeapon,
} from "../games/fusero/src/engine/classic/catalog-types.js";

export const CLASSIC_SCRIPT_SHA256 =
  "ed0ab6247796c975cfea0e58c88ed2c2f8d930f58f88078b20cc476fa4e04d6d";
const fixture = new URL(
  "../games/fusero/upstream/classic-script.lgs",
  import.meta.url,
);
const output = new URL(
  "../games/fusero/src/engine/classic/classic-data.ts",
  import.meta.url,
);
const animationSources = [
  {
    name: "Flame.png",
    path: "share/gamedir/Classic/gfx/Flame.png",
    sha256: "ff51c511a2ef73be6b2c8559266991ef792f0169966ac0385f23a043fcb473c8",
  },
  {
    name: "FloatMine.png",
    path: "share/gamedir/Classic/gfx/FloatMine.png",
    sha256: "2fe5fd723e7d5abb3b5531da83e839df9f7c738caa8dc2c131076b78352107fd",
  },
  {
    name: "None.png",
    path: "share/gamedir/data/gfx/None.png",
    sha256: "e9523af044fc775246c7b481cc4b6307bf32e98f1041eadd2901bc6fad4efb2d",
  },
  {
    name: "ZimmFlash.png",
    path: "share/gamedir/data/gfx/ZimmFlash.png",
    sha256: "a3d7531133d4622d51673e9677bdc91b876de901a6be0cef8ec41cc4ff050330",
  },
] as const;
function bitmapGeometry(): ReadonlyMap<string, ClassicBitmap> {
  return new Map(
    animationSources.map((source) => {
      const bytes = readFileSync(
        new URL(
          `../games/fusero/upstream/animation/${source.name}`,
          import.meta.url,
        ),
      );
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      if (sourceSha256 !== source.sha256)
        throw new Error(
          `Classic bitmap source digest mismatch: ${source.name}`,
        );
      if (
        bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
        bytes.toString("ascii", 12, 16) !== "IHDR"
      )
        throw new Error(`Invalid Classic PNG: ${source.name}`);
      const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20);
      if (height === 0 || width % height !== 0)
        throw new Error(`Invalid Classic animation geometry: ${source.name}`);
      return [
        source.name,
        {
          sourcePath: source.path,
          sourceSha256,
          width,
          height,
          frameCount: width / height,
        },
      ];
    }),
  );
}

class Reader {
  offset = 0;
  private readonly bytes: Buffer;
  constructor(bytes: Uint8Array) {
    this.bytes = Buffer.from(bytes);
  }
  take(count: number): Buffer {
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      this.offset + count > this.bytes.length
    )
      throw new Error(
        `Truncated Classic script at byte ${this.offset} (need ${count})`,
      );
    const part = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return part;
  }
  i32(): number {
    return this.take(4).readInt32LE();
  }
  f32(): number {
    const value = this.take(4).readFloatLE();
    if (!Number.isFinite(value))
      throw new Error(`Non-finite Classic float at byte ${this.offset - 4}`);
    return value;
  }
  flag(): ClassicFlag {
    const value = this.i32();
    if (value !== 0 && value !== 1)
      throw new Error(`Invalid Classic flag at byte ${this.offset - 4}`);
    return value;
  }
  string(): string {
    return this.take(this.take(1)[0]!).toString("utf8");
  }
  fixedString(length: number): string {
    return this.take(length).toString("utf8").replace(/\0.*$/s, "");
  }
  count(max: number): number {
    const value = this.i32();
    if (value < 0 || value > max)
      throw new Error(
        `Invalid Classic count ${value} at byte ${this.offset - 4}`,
      );
    return value;
  }
}
interface ActionFields {
  damage?: number;
  projectiles?: ClassicFlag;
  useSound?: ClassicFlag;
  sound?: string;
  shake?: number;
  bounceCoeff?: number;
  bounceExplode?: number;
}
function required(field: string, value: number | undefined): number {
  if (value === undefined) throw new Error(`Missing Classic action ${field}`);
  return value;
}
function action(type: number, fields: ActionFields): ClassicAction {
  switch (type) {
    case 0:
      return {
        ...fields,
        type,
        name: "bounce",
        bounceCoeff: required("bounceCoeff", fields.bounceCoeff),
      };
    case 1:
      return {
        ...fields,
        type,
        name: "explode",
        damage: required("damage", fields.damage),
      };
    case 2:
      return {
        ...fields,
        type,
        name: "injure",
        damage: required("damage", fields.damage),
      };
    case 4:
      return {
        ...fields,
        type,
        name: "carve",
        damage: required("damage", fields.damage),
      };
    case 5:
      return { ...fields, type, name: "dirt" };
    case 6:
      return { ...fields, type, name: "greendirt" };
    case 7:
      return { ...fields, type, name: "disappear" };
    case 8:
      return { ...fields, type, name: "nothing" };
    case 9:
      return { ...fields, type, name: "disappear2" };
    case 10:
      return { ...fields, type, name: "gothrough" };
    default:
      throw new Error(`Unsupported v7 Classic action ${type}`);
  }
}

/** CGameScript::Load/LoadProjectile and Wpn_Beam::read, restricted to packaged Classic v7. */
export function decodeClassicScript(bytes: Uint8Array): ClassicCatalogData {
  const r = new Reader(bytes);
  const bitmaps = bitmapGeometry();
  const scriptId = r.fixedString(18);
  r.take(2); // Native gs_header_t alignment padding before Version.
  if (scriptId !== "Liero Game Script")
    throw new Error("Invalid Classic script id");
  const version = r.i32();
  if (version !== 7) throw new Error(`Expected Classic v7, got ${version}`);
  const modName = r.fixedString(64);
  const count = r.count(4096);
  const projectiles: (ClassicProjectile | undefined)[] = [];

  function projectile(depth: number): number {
    if (depth > 128) throw new Error("Classic projectile nesting exceeds 128");
    const sourceOffset = r.offset,
      id = projectiles.length;
    projectiles.push(undefined); // Reserve preorder id before reading nested descriptors.
    const rawType = r.i32(),
      timerTime = r.f32(),
      timerVar = r.f32();
    const trailType = r.i32();
    if (trailType < 0 || trailType > 5)
      throw new Error(`Invalid Classic trail ${trailType}`);
    const customGravity = r.flag();
    const gravity = customGravity ? { gravity: r.i32() } : {};
    // Upstream uses sizeof(int) but reads directly into a float: preserve its IEEE754 bytes.
    const dampening = r.f32();
    let graphic:
      | {
          type: "pixel";
          rawType: 0;
          colors: (readonly [number, number, number])[];
        }
      | {
          type: "image";
          rawType: 1;
          image: string;
          rotating: ClassicFlag;
          rotIncrement: number;
          rotSpeed: number;
          useAngle: ClassicFlag;
          useSpecAngle: ClassicFlag;
          angleImages?: number;
          animating: ClassicFlag;
          animRate?: number;
          animType?: number;
          bitmap?: ClassicBitmap;
        };
    if (rawType === 0) {
      const colors = Array.from(
        { length: r.count(4096) },
        () => [r.i32(), r.i32(), r.i32()] as const,
      );
      graphic = { type: "pixel", rawType, colors };
    } else if (rawType === 1) {
      const image = r.string(),
        rotating = r.flag(),
        rotIncrement = r.i32(),
        rotSpeed = r.i32();
      const useAngle = r.flag(),
        useSpecAngle = r.flag();
      const angles = useAngle || useSpecAngle ? { angleImages: r.i32() } : {};
      const animating = r.flag();
      const animation = animating
        ? { animRate: r.f32(), animType: r.i32() }
        : {};
      const bitmap = animating ? bitmaps.get(image) : undefined;
      if (animating && !bitmap)
        throw new Error(`Missing Classic animation geometry for ${image}`);
      graphic = {
        type: "image",
        rawType,
        image,
        rotating,
        rotIncrement,
        rotSpeed,
        useAngle,
        useSpecAngle,
        ...angles,
        animating,
        ...animation,
        ...(bitmap ? { bitmap } : {}),
      };
    } else
      throw new Error(
        `Unsupported Classic projectile type ${rawType} at byte ${sourceOffset}`,
      );

    const hitType = r.i32();
    let hitFields: ActionFields = {};
    if (hitType === 1) {
      const damage = r.i32(),
        projectiles = r.flag(),
        useSound = r.flag(),
        shake = r.i32();
      hitFields = {
        damage,
        projectiles,
        useSound,
        shake,
        ...(useSound ? { sound: r.string() } : {}),
      };
    } else if (hitType === 0)
      hitFields = { bounceCoeff: r.f32(), bounceExplode: r.i32() };
    else if (hitType === 4) hitFields = { damage: r.i32() };
    const hit = action(hitType, hitFields);

    let timer: ClassicAction | undefined;
    if (timerTime > 0) {
      const timerType = r.i32();
      timer = action(
        timerType,
        timerType === 1
          ? { damage: r.i32(), projectiles: r.flag(), shake: r.i32() }
          : {},
      );
    }
    const playerType = r.i32();
    const playerFields =
      playerType === 1 || playerType === 2
        ? { damage: r.i32(), projectiles: r.flag() }
        : playerType === 0
          ? { bounceCoeff: r.f32() }
          : {};
    const playerHit = action(playerType, playerFields);
    const obsoleteAction = (): ClassicAction => {
      const type = r.i32(),
        damage = r.i32(),
        projectiles = r.flag(),
        useSound = r.flag();
      return action(type, {
        damage,
        projectiles,
        useSound,
        ...(useSound ? { sound: r.string() } : {}),
      });
    };
    const explode = obsoleteAction(),
      touch = obsoleteAction();
    let spawn: ClassicSpawn | undefined;
    if (
      [hit, timer, playerHit, explode, touch].some(
        (value) => value?.projectiles,
      )
    ) {
      const useAngle = r.flag(),
        angle = r.i32(),
        amount = r.count(4096),
        spread = r.f32(),
        speed = r.i32(),
        speedVar = r.f32();
      spawn = {
        useAngle,
        angle,
        amount,
        spread,
        speed,
        speedVar,
        projectileId: projectile(depth + 1),
      };
    }
    let trail: ClassicTrail | undefined;
    if (trailType === 3) {
      const useParentVelocityForSpread = r.flag(),
        delayMs = r.f32(),
        amount = r.count(4096),
        speed = r.i32(),
        speedVar = r.f32(),
        spread = r.f32();
      trail = {
        useParentVelocityForSpread,
        delayMs,
        amount,
        speed,
        speedVar,
        spread,
        projectileId: projectile(depth + 1),
      };
    }
    projectiles[id] = {
      id,
      sourceOffset,
      ...graphic,
      timerTime,
      timerVar,
      trailType: trailType as ClassicProjectile["trailType"],
      customGravity,
      ...gravity,
      dampening,
      width: rawType === 0 ? 2 : 4,
      height: rawType === 0 ? 2 : 4,
      hit,
      ...(timer ? { timer } : {}),
      playerHit,
      explode,
      touch,
      ...(spawn ? { spawn } : {}),
      ...(trail ? { trail } : {}),
    };
    return id;
  }

  const weapons: ClassicWeapon[] = [];
  for (let id = 0; id < count; id++) {
    const sourceOffset = r.offset,
      name = r.string(),
      rawType = r.i32();
    if (rawType === 0) {
      const weaponClass = r.i32(),
        recoil = r.i32(),
        recharge = r.f32(),
        drain = r.f32(),
        rofMs = r.f32();
      const speed = r.i32(),
        speedVar = r.f32(),
        spread = r.f32(),
        amount = r.count(4096),
        laser = r.flag(),
        useSound = r.flag();
      const sound = useSound ? { sound: r.string() } : {};
      weapons.push({
        id,
        sourceOffset,
        name,
        type: "projectile",
        rawType,
        class: weaponClass,
        recoil,
        recharge,
        drain,
        rofMs,
        speed,
        speedVar,
        spread,
        amount,
        laser,
        useSound,
        ...sound,
        projectileId: projectile(0),
      });
    } else if (rawType === 2) {
      const recoil = r.i32(),
        recharge = r.f32(),
        drain = r.f32(),
        rofMs = r.f32(),
        laser = r.flag();
      const beam: ClassicBeam = {
        color: [r.i32(), r.i32(), r.i32()],
        damage: r.i32(),
        playerDamage: r.i32(),
        length: r.i32(),
      };
      weapons.push({
        id,
        sourceOffset,
        name,
        type: "beam",
        rawType,
        recoil,
        recharge,
        drain,
        rofMs,
        laser,
        beam,
      });
    } else
      throw new Error(
        `Unsupported Classic weapon type ${rawType} at byte ${sourceOffset}`,
      );
  }
  const rope = { length: r.i32(), rest: r.i32(), strength: r.f32() };
  const worm = {
    angleSpeed: r.f32(),
    groundSpeed: r.f32(),
    airSpeed: r.f32(),
    gravity: r.f32(),
    jumpForce: r.f32(),
    airFriction: r.f32(),
    groundFriction: r.f32(),
  };
  if (r.offset !== bytes.length)
    throw new Error(
      `Classic script has ${bytes.length - r.offset} trailing bytes at byte ${r.offset}`,
    );
  return {
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    scriptId,
    version,
    modName,
    decodedBytes: r.offset,
    weapons,
    projectiles: projectiles.map((value, id) => {
      if (!value) throw new Error(`Unresolved Classic projectile ${id}`);
      return value;
    }),
    physics: { rope, worm },
  };
}

export async function generateClassicCatalog(check: boolean): Promise<void> {
  const bytes = readFileSync(fixture);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== CLASSIC_SCRIPT_SHA256)
    throw new Error(`Classic source digest mismatch: ${sha}`);
  const data = decodeClassicScript(bytes);
  const text = await format(
    `// Generated by scripts/fusero-decode-classic.ts; do not hand-edit.\n// Native Classic mod data, OpenLieroX 0a20c6d0a10ed63b28a15f05c771913c294efbf6.\n// See upstream/SOURCE.md and preserved licensing notices.\nimport type { ClassicCatalogData } from "./catalog-types.js";\nexport const CLASSIC_DATA = ${JSON.stringify(data, null, 2)} as const satisfies ClassicCatalogData;\n`,
    { parser: "typescript" },
  );
  if (check) {
    if (readFileSync(output, "utf8") !== text)
      throw new Error(
        "Classic catalog is stale; run pnpm exec tsx scripts/fusero-decode-classic.ts",
      );
  } else writeFileSync(output, text);
  console.log(
    `Classic catalog ${check ? "verified" : "generated"}: ${bytes.length} bytes, ${data.weapons.length} weapons, ${data.projectiles.length} projectiles, SHA-256 ${sha}`,
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateClassicCatalog(process.argv.includes("--check"));
}
