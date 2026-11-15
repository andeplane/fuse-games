import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { RoomError } from "fuse-network-be";
import { record, type TelemetryDatabase } from "./metrics-database.js";
import { boundedResponse } from "./workspace-assistant.js";
import type { TelemetryQuota } from "./limits.js";
class GithubRejected extends RoomError {}

/** Credentials are scoped to the verified Firebase UID, encrypted at rest and never returned. */
export class WorkspaceGithub {
  private key: Buffer;
  constructor(
    private options: {
      database: TelemetryDatabase;
      secret: string;
      request: typeof fetch;
      quota: TelemetryQuota;
      now(): number;
    },
  ) {
    this.key = createHmac("sha256", options.secret)
      .update("fuse-workspace-github-token-v1")
      .digest();
  }
  private keyFor(uid: string) {
    return `telemetry-github/${createHash("sha256").update(uid).digest("hex")}`;
  }
  private async api(token: string, path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await this.options.request(`https://api.github.com${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "Content-Type": "application/json",
        },
      });
    } catch {
      throw new RoomError(
        502,
        "GitHub unavailable; check the issue list before retrying",
      );
    }
    if (!response.ok) {
      const Failure = [400, 401, 403, 404, 405, 410, 422, 429].includes(
        response.status,
      )
        ? GithubRejected
        : RoomError;
      throw new Failure(
        response.status === 401 ? 401 : 502,
        "GitHub rejected the request; reconnect or retry later",
      );
    }
    return JSON.parse(await boundedResponse(response, 512000)) as unknown;
  }
  async status(uid: string) {
    const data = record(
      (await this.options.database.readMany([this.keyFor(uid)]))[0],
    );
    return {
      connected: typeof data?.encrypted === "string",
      login: typeof data?.login === "string" ? data.login : null,
    };
  }
  async connect(uid: string, token: unknown) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_]{20,300}$/.test(token))
      throw new RoomError(400, "Invalid GitHub credential");
    const user = record(await this.api(token, "/user"));
    if (
      typeof user?.login !== "string" ||
      !/^[A-Za-z0-9-]{1,39}$/.test(user.login)
    )
      throw new RoomError(502, "Invalid GitHub identity");
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(uid));
    const encrypted = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    await this.options.database.transact(async (tx) => {
      tx.set(this.keyFor(uid), {
        login: user.login,
        encrypted: encrypted.toString("base64url"),
        nonce: nonce.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        connectedAt: this.options.now(),
      });
    });
    return this.status(uid);
  }
  async disconnect(uid: string) {
    await this.options.database.transact(async (tx) => {
      tx.set(this.keyFor(uid), { disconnectedAt: this.options.now() });
    });
    return { connected: false, login: null };
  }
  async publish(
    uid: string,
    input: {
      actionId: string;
      revision: number;
      title: string;
      body: string;
      existingIssue?: number;
    },
  ) {
    if (
      !/^[A-Za-z0-9_-]{1,160}$/.test(input.actionId) ||
      !Number.isSafeInteger(input.revision) ||
      !input.title.trim() ||
      input.title.length > 140 ||
      !input.body.trim() ||
      input.body.length > 6000
    )
      throw new RoomError(400, "Invalid issue draft");
    await this.options.quota.consume([
      {
        dimension: "github-issues-user",
        identity: uid,
        cost: 1,
        limit: 10,
        windowMs: 86400_000,
      },
      {
        dimension: "github-issues-global",
        identity: "global",
        cost: 1,
        limit: 30,
        windowMs: 86400_000,
      },
    ]);
    const data = record(
      (await this.options.database.readMany([this.keyFor(uid)]))[0],
    );
    if (
      typeof data?.encrypted !== "string" ||
      typeof data.nonce !== "string" ||
      typeof data.tag !== "string"
    )
      throw new RoomError(409, "Connect GitHub first");
    let token: string;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(data.nonce, "base64url"),
      );
      decipher.setAAD(Buffer.from(uid));
      decipher.setAuthTag(Buffer.from(data.tag, "base64url"));
      token = Buffer.concat([
        decipher.update(Buffer.from(data.encrypted, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new RoomError(409, "Reconnect GitHub after the server key changed");
    }
    const marker = createHash("sha256")
      .update(`${input.actionId}:${input.revision}`)
      .digest("hex");
    const issueKey = `telemetry-issues/${marker}`;
    const attach = async (number: number) => {
      if (!Number.isSafeInteger(number) || number < 1 || number > 1_000_000_000)
        throw new RoomError(400, "Invalid existing issue number");
      const issue = record(
        await this.api(token, `/repos/andeplane/fuse-games/issues/${number}`),
      );
      if (
        typeof issue?.body !== "string" ||
        !issue.body.includes(`<!-- fuse-proposal:${marker} -->`) ||
        typeof issue.html_url !== "string" ||
        !/^https:\/\/github.com\/andeplane\/fuse-games\/issues\/\d+$/.test(
          issue.html_url,
        )
      )
        throw new RoomError(
          409,
          "That issue does not match this proposal revision",
        );
      await this.options.database.transact(async (tx) => {
        tx.set(issueKey, { status: "created", url: issue.html_url, uid });
      });
      return { url: issue.html_url, existing: true };
    };
    if (input.existingIssue !== undefined) return attach(input.existingIssue);
    const existing = await this.options.database.transact(async (tx) => {
      const previous = record((await tx.getMany([issueKey]))[0]);
      if (previous && previous.status !== "rejected") return previous;
      tx.set(issueKey, { status: "pending", uid, at: this.options.now() });
      return undefined;
    });
    if (typeof existing?.url === "string")
      return { url: existing.url, existing: true };
    if (existing) {
      // Reconcile an uncertain POST outcome; never issue a second POST for the same proposal revision.
      const issues = await this.api(
        token,
        "/repos/andeplane/fuse-games/issues?state=all&sort=created&direction=desc&per_page=100",
      );
      const found = Array.isArray(issues)
        ? issues
            .map(record)
            .find(
              (issue) =>
                typeof issue?.body === "string" &&
                issue.body.includes(`<!-- fuse-proposal:${marker} -->`),
            )
        : undefined;
      if (
        typeof found?.html_url === "string" &&
        /^https:\/\/github.com\/andeplane\/fuse-games\/issues\/\d+$/.test(
          found.html_url,
        )
      ) {
        await this.options.database.transact(async (tx) => {
          tx.set(issueKey, { status: "created", url: found.html_url, uid });
        });
        return { url: found.html_url, existing: true };
      }
      throw new RoomError(
        409,
        "Issue publication has an uncertain result. Check GitHub before retrying; no duplicate was sent",
      );
    }
    let result: Record<string, unknown> | undefined;
    try {
      result = record(
        await this.api(token, "/repos/andeplane/fuse-games/issues", {
          method: "POST",
          body: JSON.stringify({
            title: input.title,
            body: `${input.body}\n\n<!-- fuse-proposal:${marker} -->`,
          }),
        }),
      );
    } catch (error) {
      if (error instanceof GithubRejected)
        await this.options.database.transact(async (tx) => {
          tx.set(issueKey, { status: "rejected", uid, at: this.options.now() });
        });
      throw error;
    }
    if (
      typeof result?.html_url !== "string" ||
      !/^https:\/\/github.com\/andeplane\/fuse-games\/issues\/\d+$/.test(
        result.html_url,
      )
    )
      throw new RoomError(502, "Check GitHub for the publication result");
    await this.options.database.transact(async (tx) => {
      tx.set(issueKey, { status: "created", url: result.html_url, uid });
    });
    return { url: result.html_url, existing: false };
  }
}
