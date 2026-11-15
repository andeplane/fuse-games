import type { ActionItem } from "fuse-telemetry/contracts";
import type { Dom } from "./dom.js";
import type { createWorkspaceApi } from "./api.js";
export function githubConnection(
  dom: Dom,
  api: ReturnType<typeof createWorkspaceApi>,
  signal: AbortSignal,
  connect: (() => Promise<string>) | undefined,
): HTMLElement {
  const { node, button } = dom;
  const area = node("div", "github-connection");
  const draw = (status: { connected: boolean; login: string | null }) => {
    if (signal.aborted) return;
    area.replaceChildren(
      node(
        "p",
        "muted",
        status.connected
          ? `GitHub connected as ${status.login}`
          : "Connect GitHub to publish a reviewed proposal as an issue.",
      ),
    );
    const action = button(
      status.connected ? "Disconnect GitHub" : "Connect GitHub",
      () => {
        action.disabled = true;
        void (async () => {
          if (status.connected)
            return api.json<{ connected: boolean; login: string | null }>(
              "/api/dev/github",
              signal,
              { method: "DELETE" },
            );
          if (!connect) throw new Error();
          const token = await connect();
          return api.json<{ connected: boolean; login: string | null }>(
            "/api/dev/github",
            signal,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            },
          );
        })()
          .then(draw)
          .catch(() => {
            if (!signal.aborted) {
              action.disabled = false;
              area.append(
                node(
                  "p",
                  "error",
                  "GitHub connection failed. Confirm your Google sign-in and retry. GitHub must be enabled in Firebase Authentication.",
                ),
              );
            }
          });
      },
      "quiet",
    );
    action.disabled = !connect && !status.connected;
    area.append(action);
  };
  area.append(node("p", "muted", "Checking GitHub connection…"));
  void api
    .json<{ connected: boolean; login: string | null }>(
      "/api/dev/github",
      signal,
    )
    .then(draw)
    .catch(() => {
      if (!signal.aborted)
        area.replaceChildren(
          button(
            "Retry GitHub connection",
            () => {
              void api
                .json<{ connected: boolean; login: string | null }>(
                  "/api/dev/github",
                  signal,
                )
                .then(draw)
                .catch(() => draw({ connected: false, login: null }));
            },
            "quiet",
          ),
        );
    });
  return area;
}
export function issueComposer(
  dom: Dom,
  api: ReturnType<typeof createWorkspaceApi>,
  signal: AbortSignal,
  item: ActionItem,
  close: () => void,
  draft?: { title: string; body: string },
): HTMLElement {
  const { node, field, button } = dom;
  const area = node("section", "issue-composer");
  area.tabIndex = -1;
  const form = node("form"),
    title = node("input"),
    body = node("textarea");
  title.value = item.title;
  title.required = true;
  title.maxLength = 140;
  body.rows = 8;
  body.maxLength = 6000;
  body.required = true;
  body.value = `Game: ${item.gameId}\n\nDescribe the reproducible behavior and expected outcome here.\n\nPrivate proposal reference: ${item.id} (revision ${item.revision}).`;
  if (draft) {
    title.value = draft.title;
    body.value = draft.body;
  }
  const publish = node(
    "button",
    "primary",
    "Publish issue to andeplane/fuse-games",
  );
  publish.type = "submit";
  const result = node("div");
  result.setAttribute("aria-live", "polite");
  const existing = node("input");
  existing.type = "number";
  existing.min = "1";
  existing.max = "1000000000";
  existing.placeholder = "Optional: existing issue number";
  form.append(
    field("Issue title", title),
    field("Public issue body", body),
    field("After an uncertain result, link the existing issue", existing),
    publish,
    button("Cancel", close, "quiet"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    publish.disabled = true;
    result.replaceChildren(node("p", "muted", "Publishing issue…"));
    void api
      .json<{ url: string }>("/api/dev/github/issues", signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: item.recordingId,
          actionId: item.id,
          revision: item.revision,
          title: title.value,
          body: body.value,
          ...(existing.value ? { existingIssue: Number(existing.value) } : {}),
        }),
      })
      .then((data) => {
        if (signal.aborted) return;
        const link = node("a", "", "Open GitHub issue");
        link.href = data.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        result.replaceChildren(link);
      })
      .catch(() => {
        if (!signal.aborted) {
          publish.disabled = false;
          result.replaceChildren(
            node(
              "p",
              "error",
              "Publication was not confirmed. Check GitHub before retrying. Reconnect GitHub if needed; reloading the proposal picks up corrections or retractions. If an issue exists, enter its number above to reconcile it without another publication.",
            ),
          );
        }
      });
  });
  area.append(
    node("h2", "", "Review public GitHub issue"),
    node(
      "p",
      "muted",
      "This issue will be public. Write a minimal reproduction. Private quotes, screenshots, recordings and transcripts are excluded from this draft.",
    ),
    form,
    result,
  );
  return area;
}
