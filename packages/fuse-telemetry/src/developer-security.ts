import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Firestore } from "@google-cloud/firestore";
import { RoomError } from "fuse-network-be";
import type { DeveloperPrincipal } from "./developer-access.js";
import { recordingKey, type DebugDatabase } from "./debug-store.js";

export type DeveloperCapability = "read" | "record" | "token";
export const ALL_CAPABILITIES: readonly DeveloperCapability[] = [
  "read",
  "record",
  "token",
];
export interface DeveloperPolicy {
  capabilities: DeveloperCapability[];
  generation: number;
  recordingGeneration: number;
  notBefore: number;
  capabilityNotBefore: Record<DeveloperCapability, number>;
}
export interface DeveloperAudit {
  uid: string;
  email: string;
  at: number;
  operation: string;
  resource: string;
}
export interface DeveloperSecurityStore {
  policy(uid: string): Promise<DeveloperPolicy>;
  /** Replace capabilities and increment generation, invalidating all older agent credentials. */
  setPolicy(
    uid: string,
    capabilities: DeveloperCapability[],
  ): Promise<DeveloperPolicy>;
  append(event: DeveloperAudit): Promise<void>;
}
const initial = (): DeveloperPolicy => ({
  // An allowlisted email alone is not a grant: accounts can be recreated with a new UID.
  capabilities: [],
  generation: 0,
  recordingGeneration: 0,
  notBefore: 0,
  capabilityNotBefore: { read: 0, record: 0, token: 0 },
});
export function validUid(uid: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) && !/^__.*__$/.test(uid);
}
function validatePolicy(value: unknown): DeveloperPolicy {
  if (!value || typeof value !== "object")
    throw new Error("Invalid developer policy");
  const policy = value as DeveloperPolicy;
  if (
    !Array.isArray(policy.capabilities) ||
    !policy.capabilities.every((v) => ALL_CAPABILITIES.includes(v)) ||
    new Set(policy.capabilities).size !== policy.capabilities.length ||
    !Number.isSafeInteger(policy.generation) ||
    policy.generation < 0 ||
    !Number.isSafeInteger(policy.recordingGeneration) ||
    policy.recordingGeneration < 0 ||
    !Number.isSafeInteger(policy.notBefore) ||
    policy.notBefore < 0 ||
    !policy.capabilityNotBefore ||
    !ALL_CAPABILITIES.every(
      (capability) =>
        Number.isSafeInteger(policy.capabilityNotBefore[capability]) &&
        policy.capabilityNotBefore[capability] >= 0,
    )
  )
    throw new Error("Invalid developer policy");
  return {
    capabilities: [...policy.capabilities],
    generation: policy.generation,
    recordingGeneration: policy.recordingGeneration,
    notBefore: policy.notBefore,
    capabilityNotBefore: { ...policy.capabilityNotBefore },
  };
}
function checked(uid: string, capabilities: DeveloperCapability[]) {
  if (
    !validUid(uid) ||
    !Array.isArray(capabilities) ||
    capabilities.some((c) => !ALL_CAPABILITIES.includes(c)) ||
    new Set(capabilities).size !== capabilities.length
  )
    throw new Error("Invalid developer policy update");
}
function nextPolicy(
  old: DeveloperPolicy,
  capabilities: DeveloperCapability[],
  now: number,
): DeveloperPolicy {
  const after = (Math.floor(now / 1000) + 1) * 1000;
  const capabilityNotBefore = { ...old.capabilityNotBefore };
  for (const capability of ALL_CAPABILITIES)
    if (
      !old.capabilities.includes(capability) &&
      capabilities.includes(capability)
    )
      capabilityNotBefore[capability] = after;
  return {
    capabilities: [...capabilities],
    generation: old.generation + 1,
    recordingGeneration:
      old.recordingGeneration +
      (old.capabilities.includes("record") && !capabilities.includes("record")
        ? 1
        : 0),
    notBefore:
      !old.capabilities.length || !capabilities.length ? after : old.notBefore,
    capabilityNotBefore,
  };
}
export class MemoryDeveloperSecurityStore implements DeveloperSecurityStore {
  constructor(protected now: () => number = Date.now) {}
  protected policies = new Map<string, DeveloperPolicy>();
  readonly events: DeveloperAudit[] = [];
  async policy(uid: string) {
    if (!validUid(uid)) throw new Error("Invalid developer uid");
    return validatePolicy(this.policies.get(uid) ?? initial());
  }
  async setPolicy(uid: string, capabilities: DeveloperCapability[]) {
    checked(uid, capabilities);
    const old = validatePolicy(this.policies.get(uid) ?? initial());
    const next = nextPolicy(old, capabilities, this.now());
    this.policies.set(uid, next);
    return validatePolicy(next);
  }
  async append(event: DeveloperAudit) {
    this.events.push(structuredClone(event));
  }
}
/** Local development is single-process; production uses the transactional Firestore adapter. */
export class FileDeveloperSecurityStore extends MemoryDeveloperSecurityStore {
  private constructor(private directory: string) {
    super();
  }
  static async open(directory: string) {
    const store = new FileDeveloperSecurityStore(directory);
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(directory, "policies.json"), "utf8"),
      );
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Invalid developer policies");
      for (const [uid, policy] of Object.entries(raw)) {
        if (!validUid(uid)) throw new Error("Invalid developer uid");
        store.policies.set(uid, validatePolicy(policy));
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    return store;
  }
  override async setPolicy(uid: string, capabilities: DeveloperCapability[]) {
    const next = await super.setPolicy(uid, capabilities);
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, "policies.json"),
      tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(this.policies)), {
      mode: 0o600,
      flush: true,
    });
    await rename(tmp, path);
    return next;
  }
  override async append(event: DeveloperAudit) {
    await mkdir(this.directory, { recursive: true });
    await appendFile(
      join(this.directory, "audit.jsonl"),
      `${JSON.stringify(event)}\n`,
      { mode: 0o600, flush: true },
    );
  }
}
export class FirestoreDeveloperSecurityStore implements DeveloperSecurityStore {
  constructor(
    private db: Firestore,
    private prefix = "",
  ) {
    if (!/^[A-Za-z0-9_-]{0,80}$/.test(prefix))
      throw new Error("Invalid developer collection prefix");
  }
  private collection(name: string) {
    return this.db.collection(
      `${this.prefix ? `${this.prefix}-` : ""}developer-${name}`,
    );
  }
  async policy(uid: string) {
    if (!validUid(uid)) throw new Error("Invalid developer uid");
    const doc = await this.collection("policies").doc(uid).get();
    return doc.exists ? validatePolicy(doc.data()) : initial();
  }
  async setPolicy(uid: string, capabilities: DeveloperCapability[]) {
    checked(uid, capabilities);
    return this.db.runTransaction(async (tx) => {
      const ref = this.collection("policies").doc(uid),
        doc = await tx.get(ref),
        old = doc.exists ? validatePolicy(doc.data()) : initial();
      const next = nextPolicy(old, capabilities, Date.now());
      tx.set(ref, next);
      return next;
    });
  }
  async append(event: DeveloperAudit) {
    await this.collection("audit").doc(randomUUID()).create(event);
  }
}
export const STEP_UP_MS = 15 * 60_000;
export async function authorizeDeveloper(
  store: DeveloperSecurityStore,
  principal: DeveloperPrincipal,
  capability: DeveloperCapability,
  now: number,
  stepUp = false,
) {
  const policy = await store.policy(principal.uid);
  if (!policy.capabilities.includes(capability))
    throw new RoomError(403, "Developer capability required");
  if (
    policy.notBefore &&
    (principal.authTime === undefined || principal.authTime < policy.notBefore)
  )
    throw new RoomError(401, "Sign in again after your access changed");
  if (
    policy.capabilityNotBefore[capability] &&
    (principal.authTime === undefined ||
      principal.authTime < policy.capabilityNotBefore[capability])
  )
    throw new RoomError(401, "Sign in again after your access changed");
  if (
    stepUp &&
    (principal.authTime === undefined ||
      principal.authTime > now + 5000 ||
      now - principal.authTime > STEP_UP_MS)
  )
    throw new RoomError(
      401,
      "Recent sign-in required; sign in again and retry",
    );
  return policy;
}
export async function auditDeveloper(
  store: DeveloperSecurityStore,
  principal: DeveloperPrincipal,
  operation: string,
  resource: string,
  now: number,
) {
  await store.append({
    uid: principal.uid,
    email: principal.email,
    at: now,
    operation,
    resource,
  });
}
/** Run after revoking access; repeat safely if a previous scan failed. */
export async function finishOwnedRecordings(
  database: DebugDatabase,
  uid: string,
  beforeGeneration: number,
): Promise<number> {
  if (
    !validUid(uid) ||
    !Number.isSafeInteger(beforeGeneration) ||
    beforeGeneration < 0
  )
    throw new Error("Invalid developer uid or generation");
  let cursor: string | undefined,
    finished = 0;
  do {
    const page = await database.list("recording", "recording:", cursor, 100);
    for (const row of page) {
      if (
        row.value.kind !== "recording" ||
        row.value.owner !== uid ||
        (row.value.ownerGeneration ?? 0) >= beforeGeneration ||
        row.value.status !== "recording"
      )
        continue;
      const key = recordingKey(row.value.id);
      if (
        await database.transact([key], (records) => {
          const record = records.get(key);
          if (
            !record ||
            record.kind !== "recording" ||
            record.owner !== uid ||
            (record.ownerGeneration ?? 0) >= beforeGeneration ||
            record.status !== "recording"
          )
            return { result: false };
          return {
            writes: new Map([
              [key, { ...record, status: "finished" as const }],
            ]),
            result: true,
          };
        })
      )
        finished++;
    }
    cursor = page.length === 100 ? page.at(-1)?.key : undefined;
  } while (cursor);
  return finished;
}
