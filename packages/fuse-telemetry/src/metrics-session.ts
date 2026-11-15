import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { RoomError, rateLimitAddress } from "fuse-network-be";
import type { TelemetryQuota } from "./limits.js";

/** Short-lived bearer for telemetry only. It is a rate-limited admission signal, not identity. */
export class MetricsSessions {
  constructor(
    private secret: string,
    private quota: TelemetryQuota,
    private now: () => number = Date.now,
  ) {}
  private sign(payload: string): string {
    return createHmac("sha256", this.secret)
      .update(`metrics-session:${payload}`)
      .digest("base64url");
  }
  async issue(address: string): Promise<string> {
    await this.quota.consume([
      {
        dimension: "session-issue-ip",
        identity: rateLimitAddress(address),
        cost: 1,
        limit: 50,
        windowMs: 86400_000,
      },
      {
        dimension: "session-issue-global",
        identity: "global",
        cost: 1,
        limit: 10_000,
        windowMs: 86400_000,
      },
    ]);
    const payload = `${this.now() + 3600_000}.${randomBytes(16).toString("base64url")}`;
    return `${payload}.${this.sign(payload)}`;
  }
  verify(header: string | undefined): void {
    const match = /^Bearer (\d{13})\.([\w-]{22})\.([\w-]{43})$/.exec(
      header ?? "",
    );
    if (!match) throw new RoomError(401, "Metrics session required");
    const expires = Number(match[1]);
    const now = this.now();
    const expected = Buffer.from(this.sign(`${match[1]}.${match[2]}`));
    const actual = Buffer.from(match[3]!);
    if (
      expires <= now ||
      expires > now + 3600_000 + 5000 ||
      !timingSafeEqual(expected, actual)
    )
      throw new RoomError(401, "Metrics session expired or invalid");
  }
}
