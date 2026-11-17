import type { DeliveryEnvironment } from "./analytics-client.js";
import type { SafeStorage } from "./safe-storage.js";
import { createEndpoints } from "fuse-network-fe";

export const ANALYTICS_ADMISSION_KEY = "fuse-metrics-admission";
export interface TelemetryTransport {
  storage: SafeStorage;
  now(): number;
  origin: string;
  apiOrigin?: string;
  request(
    url: string,
    init: RequestInit,
  ): Promise<Pick<Response, "ok" | "status" | "json">>;
  identity(): Promise<{ token: string } | undefined>;
}

/** Credentials live in request headers only; the durable outbox contains event claims. */
export function createTelemetrySender(
  environment: TelemetryTransport,
): DeliveryEnvironment["send"] {
  const { storage } = environment;
  return async (events, enabled) => {
    // Validate configuration only on delivery, so telemetry cannot break game startup.
    const endpoints = createEndpoints(
      { basePath: "/", apiOrigin: environment.apiOrigin },
      environment.origin,
    );
    let session = storage.getItem(ANALYTICS_ADMISSION_KEY) ?? undefined;
    const expires = Number(session?.split(".")[0]);
    if (
      !session ||
      !Number.isSafeInteger(expires) ||
      expires <= environment.now() ||
      expires > environment.now() + 3900_000
    ) {
      const admission = await environment.request(
        endpoints.apiUrl("/api/telemetry/session"),
        { method: "POST" },
      );
      if (admission.status === 404) return events.map((event) => event.id);
      if (!admission.ok) throw new Error("Metrics admission unavailable");
      const body: unknown = await admission.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("token" in body) ||
        typeof body.token !== "string"
      )
        throw new Error("Invalid metrics admission");
      session = body.token;
      if (!enabled()) return [];
      storage.setItem(ANALYTICS_ADMISSION_KEY, session);
    }
    if (!enabled()) return [];
    // Refresh failures retain the batch for retry. Guests/sign-out resolve undefined.
    const account = await environment.identity();
    if (!enabled()) return [];
    const response = await environment.request(
      endpoints.apiUrl("/api/telemetry/events"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session}`,
          ...(account ? { "X-Fuse-Identity": account.token } : {}),
        },
        body: JSON.stringify({ events }),
        keepalive: true,
      },
    );
    if (response.status === 401) {
      storage.removeItem(ANALYTICS_ADMISSION_KEY);
      throw new Error("Metrics session expired");
    }
    // Permanent refusals must not block every subsequent game on this origin.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    )
      return events.map((event) => event.id);
    if (!response.ok) throw new Error("Metrics unavailable");
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("acknowledgedIds" in body) ||
      !Array.isArray(body.acknowledgedIds)
    )
      throw new Error("Invalid metrics acknowledgement");
    return body.acknowledgedIds.filter(
      (id): id is string => typeof id === "string",
    );
  };
}
