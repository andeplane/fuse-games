import { RoomError, type HttpExtension } from "fuse-network-be";
import {
  requireDeveloper,
  type DeveloperVerifier,
} from "./developer-access.js";
import { readTelemetryBody } from "./metrics-http.js";
import { record, type TelemetryDatabase } from "./metrics-database.js";
import type { TelemetryQuota } from "./limits.js";
import { EventExplorer, EXPLORER_SCAN_LIMIT } from "./explorer.js";
import { WorkspaceAssistant } from "./workspace-assistant.js";
import { WorkspaceGithub } from "./workspace-github.js";
import type { ActionService } from "./action-service.js";

/** Mounted behind the same durable developer policy and audit boundary as the original workspace. */
export function createWorkspaceHttp(options: {
  database: TelemetryDatabase;
  games: ReadonlySet<string>;
  developer: DeveloperVerifier;
  quota: TelemetryQuota;
  secret: string;
  apiKey?: string;
  request: typeof fetch;
  now(): number;
  actions: ActionService;
}): HttpExtension {
  const explorer = new EventExplorer(
    options.database,
    options.games,
    options.now,
  );
  const assistant = new WorkspaceAssistant({
    apiKey: options.apiKey,
    request: options.request,
    quota: options.quota,
    database: options.database,
    now: options.now,
  });
  const github = new WorkspaceGithub({
    database: options.database,
    secret: options.secret,
    request: options.request,
    quota: options.quota,
    now: options.now,
  });
  return {
    methods: ["POST", "DELETE"],
    headers: ["Authorization"],
    async handle(req, res) {
      const path = new URL(req.url ?? "/", "http://telemetry").pathname;
      if (
        ![
          "/api/dev/events",
          "/api/dev/catalog",
          "/api/dev/assistant",
          "/api/dev/github",
          "/api/dev/github/issues",
        ].includes(path)
      )
        return false;
      const principal = await requireDeveloper(req, options.developer);
      res.setHeader("Cache-Control", "no-store");
      let value: unknown;
      if (path === "/api/dev/catalog" && req.method === "GET")
        value = {
          gameIds: [...options.games].sort(),
          assistant: Boolean(options.apiKey),
        };
      else if (path === "/api/dev/events" && req.method === "POST") {
        const body = await readTelemetryBody(req);
        await options.quota.consume([
          {
            dimension: "explorer-user-day",
            identity: principal.uid,
            cost: EXPLORER_SCAN_LIMIT + 1,
            limit: 400_000,
            windowMs: 86400_000,
          },
          {
            dimension: "explorer-global-day",
            identity: "global",
            cost: EXPLORER_SCAN_LIMIT + 1,
            limit: 2_000_000,
            windowMs: 86400_000,
          },
        ]);
        value = await explorer.query(body);
      } else if (path === "/api/dev/assistant" && req.method === "POST")
        value = await assistant.step(
          principal.uid,
          await readTelemetryBody(req),
        );
      else if (path === "/api/dev/github" && req.method === "GET")
        value = await github.status(principal.uid);
      else if (path === "/api/dev/github" && req.method === "DELETE")
        value = await github.disconnect(principal.uid);
      else if (path === "/api/dev/github" && req.method === "POST") {
        const body = record(await readTelemetryBody(req));
        value = await github.connect(principal.uid, body?.token);
      } else if (path === "/api/dev/github/issues" && req.method === "POST") {
        const body = record(await readTelemetryBody(req));
        if (
          !body ||
          typeof body.recordingId !== "string" ||
          typeof body.actionId !== "string" ||
          typeof body.title !== "string" ||
          typeof body.body !== "string"
        )
          throw new RoomError(400, "Invalid proposal issue draft");
        const page = await options.actions.list(
          { recordingId: body.recordingId, limit: 100 },
          principal,
        );
        let action = page.actions.find((action) => action.id === body.actionId);
        if (!action && page.nextCursor) {
          const next = await options.actions.list(
            {
              recordingId: body.recordingId,
              limit: 100,
              cursor: page.nextCursor,
            },
            principal,
          );
          action = next.actions.find((action) => action.id === body.actionId);
        }
        if (
          !action ||
          action.revision !== body.revision ||
          action.status === "retracted" ||
          action.status === "dismissed"
        )
          throw new RoomError(
            409,
            "Proposal changed or was retracted. Reload it before publishing",
          );
        if (
          body.existingIssue !== undefined &&
          typeof body.existingIssue !== "number"
        )
          throw new RoomError(400, "Invalid existing issue number");
        value = await github.publish(principal.uid, {
          actionId: action.id,
          revision: action.revision,
          title: body.title,
          body: body.body,
          existingIssue: body.existingIssue,
        });
      } else throw new RoomError(405, "Method not allowed");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
      return true;
    },
  };
}
