import { Firestore } from "@google-cloud/firestore";
import { FirestoreDebugDatabase } from "fuse-telemetry/debug-firestore";
import {
  ALL_CAPABILITIES,
  finishOwnedRecordings,
  FirestoreDeveloperSecurityStore,
  validUid,
  type DeveloperCapability,
} from "fuse-telemetry/developer-security";

// This operator tool uses Application Default Credentials; it never accepts a browser token.
async function main() {
  const [operation, project, databaseId, prefix, uid, ...rest] =
    process.argv.slice(2);
  if (
    !operation ||
    !project ||
    !/^[a-z][a-z0-9-]{4,29}$/.test(project) ||
    !databaseId ||
    !/^(\(default\)|[a-z][a-z0-9-]{1,62})$/.test(databaseId) ||
    !prefix ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(prefix) ||
    !uid ||
    !validUid(uid)
  )
    throw new Error(
      "Usage: developer-access.ts <show|set|revoke> <project> <database> <prefix> <uid> [read,record,token]",
    );
  const db = new Firestore({ projectId: project, databaseId });
  const security = new FirestoreDeveloperSecurityStore(db, prefix);
  if (operation === "show") {
    console.log(JSON.stringify(await security.policy(uid)));
    return;
  }
  if (operation !== "set" && operation !== "revoke")
    throw new Error("Unknown operation");
  const capabilities =
    operation === "revoke" ? [] : rest[0] ? rest[0].split(",") : [];
  if (
    (operation === "set" && rest.length !== 1) ||
    (operation === "revoke" && rest.length) ||
    capabilities.some(
      (capability) =>
        !ALL_CAPABILITIES.includes(capability as DeveloperCapability),
    ) ||
    new Set(capabilities).size !== capabilities.length
  )
    throw new Error("Invalid capabilities");
  // Append an operator action before changing access. The target is identified here;
  // the GCP audit trail supplies the IAM caller, not this unverified local process.
  await security.append({
    uid,
    email: "",
    at: Date.now(),
    operation: `operator.${operation}.attempt`,
    resource: capabilities.join(","),
  });
  await security.setPolicy(uid, capabilities as DeveloperCapability[]);
  const finished = capabilities.includes("record")
    ? 0
    : await finishOwnedRecordings(new FirestoreDebugDatabase(db, prefix), uid);
  await security.append({
    uid,
    email: "",
    at: Date.now(),
    operation: `operator.${operation}.complete`,
    resource: `${capabilities.join(",")};finished=${finished}`,
  });
  console.log(JSON.stringify({ uid, capabilities, finished }));
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Access operation failed",
  );
  process.exitCode = 1;
});
