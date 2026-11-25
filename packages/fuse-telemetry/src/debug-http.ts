import type { IncomingMessage, ServerResponse } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";
import {
  requireDeveloper,
  type DeveloperPrincipal,
  type DeveloperVerifier,
} from "./developer-access.js";
import { DEBUG_LIMITS } from "./debug-contracts.js";
import { DebugService, debugAssert, debugUuid } from "./debug-service.js";
import { readDebugBody } from "./worker.js";
import {
  auditDeveloper,
  authorizeDeveloper,
  type DeveloperSecurityStore,
} from "./developer-security.js";

export interface DebugHttpOptions {
  service: DebugService;
  verifier: DeveloperVerifier;
  identity?: (token: string) => Promise<string | undefined>;
  recordingEnabled?: boolean;
  security?: DeveloperSecurityStore;
  now?: () => number;
  /** HMAC-derived identity; never raw IP. */ reportIdentity: (
    req: IncomingMessage,
    address: string,
  ) => string;
}
const send = (res: ServerResponse, value: unknown) => {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function json(req: IncomingMessage, max = 16_384): Promise<unknown> {
  debugAssert(
    req.headers["content-type"]?.split(";")[0] === "application/json",
    415,
    "JSON required",
  );
  try {
    return JSON.parse((await readDebugBody(req, max)).toString());
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError(400, "Invalid JSON");
  }
}
export function createDebugHttpExtension(
  options: DebugHttpOptions,
): HttpExtension {
  const { service, verifier } = options;
  const recordGeneration = async (
    principal: DeveloperPrincipal,
    stepUp = false,
  ) =>
    options.security
      ? (
          await authorizeDeveloper(
            options.security,
            principal,
            "record",
            (options.now ?? Date.now)(),
            stepUp,
          )
        ).recordingGeneration
      : 0;
  return {
    methods: ["GET", "POST", "PUT"],
    headers: [
      "Authorization",
      "Content-Type",
      "X-Recording-Start-Ms",
      "X-Recording-Game-Id",
    ],
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://telemetry"),
        path = url.pathname,
        method = req.method;
      if (method === "POST" && path === "/api/telemetry/reports") {
        const input = await json(req, 3 * 1024 * 1024);
        let owner: string | undefined;
        let ownerGeneration = 0;
        if (input && typeof input === "object" && "recordingId" in input) {
          const principal = await requireDeveloper(req, verifier);
          if (options.security) {
            ownerGeneration = await recordGeneration(principal);
            await auditDeveloper(
              options.security,
              principal,
              "report.attach",
              "/api/telemetry/reports",
              (options.now ?? Date.now)(),
            );
          }
          owner = principal.uid;
        }
        const token =
          req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
        const trusted = Boolean(
          owner ||
          (token && options.identity && (await options.identity(token))),
        );
        send(
          res,
          await service.submitReport(
            options.reportIdentity(req, address),
            owner,
            input,
            ownerGeneration,
            trusted,
          ),
        );
        return true;
      }
      if (method === "POST" && path === "/api/telemetry/recordings") {
        const principal = await requireDeveloper(req, verifier);
        const generation = await recordGeneration(principal, true);
        debugAssert(
          options.recordingEnabled !== false,
          503,
          "Recording is not configured",
        );
        const input = await json(req);
        debugAssert(
          (await recordGeneration(principal, true)) === generation,
          412,
          "Recording access changed",
        );
        send(res, {
          recording: await service.createRecording(
            principal.uid,
            input,
            generation,
          ),
        });
        return true;
      }
      const upload =
        /^\/api\/telemetry\/recordings\/([^/]+)\/segments\/(\d+)$/.exec(path);
      if (method === "PUT" && upload) {
        const principal = await requireDeveloper(req, verifier);
        const generation = await recordGeneration(principal);
        debugAssert(
          options.recordingEnabled !== false,
          503,
          "Recording is not configured",
        );
        debugAssert(
          req.headers["content-type"]?.split(";")[0] === "audio/wav",
          415,
          "PCM WAV required",
        );
        const offset = req.headers["x-recording-start-ms"];
        debugAssert(typeof offset === "string" && /^\d{1,8}$/.test(offset));
        const bytes = await readDebugBody(req, DEBUG_LIMITS.segmentBytes);
        debugAssert(
          (await recordGeneration(principal)) === generation,
          412,
          "Recording access changed",
        );
        send(
          res,
          await service.upload(
            principal.uid,
            upload[1]!,
            Number(upload[2]),
            Number(offset),
            bytes,
            typeof req.headers["x-recording-game-id"] === "string"
              ? req.headers["x-recording-game-id"]
              : undefined,
            generation,
          ),
        );
        return true;
      }
      const finish = /^\/api\/telemetry\/recordings\/([^/]+)\/finish$/.exec(
        path,
      );
      if (method === "POST" && finish) {
        const principal = await requireDeveloper(req, verifier);
        const generation = await recordGeneration(principal);
        send(res, {
          recording: await service.finish(
            principal.uid,
            finish[1]!,
            generation,
          ),
        });
        return true;
      }
      if (!path.startsWith("/api/dev/")) return false;
      const review = /^\/api\/dev\/(reports|recordings)\/([^/]+)\/review$/.exec(
        path,
      );
      if (review) {
        debugAssert(method === "POST", 405);
        const principal = await requireDeveloper(req, verifier);
        debugAssert(debugUuid(review[2]));
        debugAssert(
          options.security,
          403,
          "Playtest review access is unavailable",
        );
        const input = await json(req, 128);
        debugAssert(
          input &&
            typeof input === "object" &&
            "handled" in input &&
            typeof input.handled === "boolean" &&
            Object.keys(input).length === 1,
        );
        const at = (options.now ?? Date.now)();
        await authorizeDeveloper(options.security, principal, "token", at);
        await auditDeveloper(
          options.security,
          principal,
          input.handled ? "playtest.handled" : "playtest.reopened",
          path,
          at,
        );
        send(
          res,
          await service.setHandled(
            review[1] === "reports" ? "report" : "recording",
            review[2],
            input.handled,
          ),
        );
        return true;
      }
      if (
        !["/api/dev/reports", "/api/dev/recordings"].includes(path) &&
        !/^\/api\/dev\/(reports|recordings)\/[^/]+(?:\/screenshot|\/segments\/\d+\/audio)?$/.test(
          path,
        )
      )
        return false;
      const developer = await requireDeveloper(req, verifier);
      const auditResults = async (kind: string, ids: string[]) => {
        if (options.security && ids.length)
          await auditDeveloper(
            options.security,
            developer,
            kind,
            ids.join(","),
            (options.now ?? Date.now)(),
          );
      };
      debugAssert(method === "GET", 405);
      const cursor = url.searchParams.get("cursor") ?? undefined,
        limit = Number(url.searchParams.get("limit") ?? 25);
      if (path === "/api/dev/reports") {
        const page = await service.listReports(
          limit,
          cursor,
          url.searchParams.get("recordingId") ?? undefined,
        );
        await auditResults(
          "reports.read",
          page.reports.map((report) => report.id),
        );
        send(res, page);
        return true;
      }
      if (path === "/api/dev/recordings") {
        const page = await service.listRecordings(limit, cursor);
        await auditResults(
          "recordings.read",
          page.recordings.map((recording) => recording.id),
        );
        send(res, page);
        return true;
      }
      const detail = /^\/api\/dev\/recordings\/([^/]+)$/.exec(path);
      const reportDetail = /^\/api\/dev\/reports\/([^/]+)$/.exec(path);
      if (reportDetail) {
        send(res, { report: await service.report(reportDetail[1]!) });
        return true;
      }
      if (detail) {
        const result = await service.detail(detail[1]!);
        await auditResults(
          "reports.read",
          result.reports.map((report) => report.id),
        );
        send(res, result);
        return true;
      }
      const audio =
          /^\/api\/dev\/recordings\/([^/]+)\/segments\/(\d+)\/audio$/.exec(
            path,
          ),
        screenshot = /^\/api\/dev\/reports\/([^/]+)\/screenshot$/.exec(path);
      if (audio || screenshot) {
        const object = audio
          ? await service.audio(audio[1]!, Number(audio[2]))
          : await service.screenshot(screenshot![1]!);
        debugAssert(object, 404, "Attachment not found");
        res.writeHead(200, {
          "Content-Type": object.mime,
          "Content-Length": object.bytes.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        });
        res.end(object.bytes);
        return true;
      }
      return false;
    },
  };
}
