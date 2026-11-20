import type { IncomingMessage } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";
import {
  requireDeveloper,
  type DeveloperPrincipal,
  type DeveloperVerifier,
} from "./developer-access.js";
import { readTelemetryBody } from "./metrics-http.js";
import { record, type TelemetryDatabase } from "./metrics-database.js";
import type { TelemetryQuota } from "./limits.js";
import { EventExplorer, EXPLORER_SCAN_LIMIT } from "./explorer.js";
import { WorkspaceAssistant } from "./workspace-assistant.js";
import { WorkspaceGithub } from "./workspace-github.js";
import type { ActionService } from "./action-service.js";

type WorkspaceHandler = (
  req: IncomingMessage,
  principal: DeveloperPrincipal,
) => unknown;

type WorkspaceRoute = Partial<
  Record<"GET" | "POST" | "DELETE", WorkspaceHandler>
>;

const ISSUE_LOOKUP_PAGE_SIZE = 100;

async function publishIssue(
  req: IncomingMessage,
  principal: DeveloperPrincipal,
  actions: ActionService,
  github: WorkspaceGithub,
) {
  const body = record(await readTelemetryBody(req));
  if (
    !body ||
    typeof body.recordingId !== "string" ||
    typeof body.actionId !== "string" ||
    typeof body.title !== "string" ||
    typeof body.body !== "string"
  )
    throw new RoomError(400, "Invalid proposal issue draft");

  const lookup = {
    recordingId: body.recordingId,
    limit: ISSUE_LOOKUP_PAGE_SIZE,
  };
  const page = await actions.list(lookup, principal);
  let action = page.actions.find((item) => item.id === body.actionId);
  if (!action && page.nextCursor) {
    const next = await actions.list(
      { ...lookup, cursor: page.nextCursor },
      principal,
    );
    action = next.actions.find((item) => item.id === body.actionId);
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

  return github.publish(principal.uid, {
    actionId: action.id,
    revision: action.revision,
    title: body.title,
    body: body.body,
    existingIssue: body.existingIssue,
  });
}

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
  const routes = new Map<string, WorkspaceRoute>([
    [
      "/api/dev/catalog",
      {
        GET: () => ({
          gameIds: [...options.games].sort(),
          assistant: Boolean(options.apiKey),
        }),
      },
    ],
    [
      "/api/dev/events",
      {
        POST: async (req, principal) => {
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
          return explorer.query(body);
        },
      },
    ],
    [
      "/api/dev/assistant",
      {
        POST: async (req, principal) =>
          assistant.step(principal.uid, await readTelemetryBody(req)),
      },
    ],
    [
      "/api/dev/github",
      {
        GET: (_req, principal) => github.status(principal.uid),
        DELETE: (_req, principal) => github.disconnect(principal.uid),
        POST: async (req, principal) => {
          const body = record(await readTelemetryBody(req));
          return github.connect(principal.uid, body?.token);
        },
      },
    ],
    [
      "/api/dev/github/issues",
      {
        POST: (req, principal) =>
          publishIssue(req, principal, options.actions, github),
      },
    ],
  ]);
  return {
    methods: ["POST", "DELETE"],
    headers: ["Authorization"],
    async handle(req, res) {
      const path = new URL(req.url ?? "/", "http://telemetry").pathname;
      const route = routes.get(path);
      if (!route) return false;
      const principal = await requireDeveloper(req, options.developer);
      res.setHeader("Cache-Control", "no-store");
      const method = req.method;
      const handler =
        method === "GET" || method === "POST" || method === "DELETE"
          ? route[method]
          : undefined;
      if (!handler) throw new RoomError(405, "Method not allowed");
      const value = await handler(req, principal);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
      return true;
    },
  };
}
