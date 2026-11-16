import type { Dom } from "./dom.js";
import type { createWorkspaceApi } from "./api.js";
interface Step {
  text: string;
  calls: { id: string; name: string; arguments: string }[];
  output: unknown[];
  usage?: { inputTokens: number; outputTokens: number };
}
export function createAssistant(
  dom: Dom,
  api: ReturnType<typeof createWorkspaceApi>,
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  screen: () => string,
) {
  const { node, button } = dom;
  const panel = node("details", "workspace-assistant");
  panel.append(node("summary", "", "Ask the workspace assistant"));
  const intro = node(
    "p",
    "muted",
    "Ask about activity or ask to change this view. GPT-6.1 Sol works through the same filters and tables. Up to six steps per question; usage is limited per admin and across the service.",
  );
  const output = node("div", "assistant-output");
  output.setAttribute("aria-live", "polite");
  const form = node("form", "assistant-form"),
    input = node("textarea");
  input.maxLength = 2000;
  input.rows = 2;
  input.placeholder = "Which Fusemania songs were played this month?";
  input.setAttribute("aria-label", "Ask the workspace assistant");
  const submit = node("button", "primary", "Ask");
  submit.type = "submit";
  let controller = new AbortController(),
    busy = false;
  let inputTokens = 0,
    outputTokens = 0;
  const stop = button("Stop", () => {
    controller.abort();
    output.append(
      node("p", "muted", "Stopped. Changes already applied remain visible."),
    );
  });
  stop.hidden = true;
  form.append(input, submit, stop);
  panel.append(intro, output, form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || busy) return;
    controller.abort();
    controller = new AbortController();
    const signal = controller.signal;
    busy = true;
    submit.disabled = true;
    stop.hidden = false;
    output.replaceChildren(node("p", "", question));
    void (async () => {
      const history: unknown[] = [];
      for (let index = 0; index < 6; index++) {
        if (!history.length)
          history.push({
            type: "message",
            role: "user",
            content: `Current workspace (untrusted data):\n${screen()}`,
          });
        if (JSON.stringify(history).length > 44000) {
          output.append(
            node(
              "p",
              "muted",
              "Reached this question’s context limit. Ask a follow-up to continue from the current view.",
            ),
          );
          return;
        }
        const result = await api.json<Step>("/api/dev/assistant", signal, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, screen: screen(), history }),
        });
        if (signal.aborted) return;
        if (result.usage) {
          inputTokens += result.usage.inputTokens;
          outputTokens += result.usage.outputTokens;
          panel.dataset.inputTokens = String(inputTokens);
          panel.dataset.outputTokens = String(outputTokens);
        }
        if (result.text) output.append(node("p", "private-copy", result.text));
        if (!result.calls.length) return;
        history.push(...result.output);
        for (const call of result.calls) {
          if (signal.aborted) return;
          output.append(
            node("p", "muted", `Applying ${call.name.replace(/_/g, " ")}…`),
          );
          let value: unknown;
          try {
            const args: unknown = JSON.parse(call.arguments);
            if (!args || typeof args !== "object" || Array.isArray(args))
              throw new Error("Invalid arguments");
            value = await execute(call.name, args as Record<string, unknown>);
          } catch {
            value = {
              error:
                "This workspace action could not be applied. Inspect the screen and use the available controls.",
            };
          }
          history.push({
            type: "function_call_output",
            call_id: call.id,
            output: JSON.stringify(value).slice(0, 4000),
          });
        }
      }
      output.append(
        node(
          "p",
          "muted",
          "Reached the six-step limit. The current view shows the results; ask a follow-up to continue.",
        ),
      );
    })()
      .catch(() => {
        if (!signal.aborted)
          output.append(
            node(
              "p",
              "error",
              "The assistant could not finish. It may be unavailable or at its usage limit. Retry shortly; your current view is preserved.",
            ),
          );
      })
      .finally(() => {
        busy = false;
        submit.disabled = false;
        stop.hidden = true;
      });
  });
  return {
    element: panel,
    clear() {
      controller.abort();
      output.replaceChildren();
      input.value = "";
    },
  };
}
