import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createAssistant } from "../dev/assistant.js";
import { createWorkspaceApi } from "../dev/api.js";
import { createDom } from "../dev/dom.js";
test("assistant preserves initial context, applies tools and returns updated page evidence without duplicating screens", async () => {
  const window = new Window(),
    document = window.document as unknown as Document;
  let page = "Overview",
    calls = 0;
  const requests: { history: unknown[]; screen: string }[] = [];
  const api = createWorkspaceApi({
    origin: "https://test.example",
    token: async () => "test",
    request: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      calls++;
      if (calls === 1)
        return Response.json({
          text: "",
          calls: [
            {
              id: "navigate-1",
              name: "navigate",
              arguments: '{"view":"events"}',
            },
          ],
          output: [
            {
              type: "function_call",
              call_id: "navigate-1",
              name: "navigate",
              arguments: '{"view":"events"}',
            },
          ],
        });
      return Response.json({
        text: "54 matching events are loaded.",
        calls: [],
        output: [],
      });
    },
  });
  const assistant = createAssistant(
    createDom(document),
    api,
    async (name, args) => {
      assert.equal(name, "navigate");
      assert.equal(args.view, "events");
      page = "Raw Events; 54 matching events";
      return { page };
    },
    () => page,
  );
  document.body.append(assistant.element);
  assistant.element.open = true;
  assistant.element.querySelector("textarea")!.value = "Show events";
  assistant.element.querySelector("form")!.requestSubmit();
  for (
    let index = 0;
    index < 300 &&
    assistant.element.querySelector<HTMLButtonElement>(".primary")?.disabled;
    index++
  )
    await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(page, "Raw Events; 54 matching events");
  assert.ok(
    assistant.element.textContent?.includes("54 matching events are loaded"),
  );
  assert.deepEqual(requests[1]?.history[0], requests[0]?.history[0]);
  assert.equal(
    requests[1]?.history.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "role" in item &&
        item.role === "user",
    ).length,
    1,
  );
  assert.ok(
    JSON.stringify(requests[1]?.history).includes(
      "Raw Events; 54 matching events",
    ),
  );
  assistant.clear();
  await window.happyDOM.close();
});
