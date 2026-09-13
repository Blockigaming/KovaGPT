import { digest } from "./model-eval-contract.mjs";

const TOOLS = [
  {
    type: "function",
    name: "get_project_limit",
    description: "Read the project limit for the supplied plan in this synthetic test.",
    strict: true,
    parameters: {
      type: "object",
      properties: { plan: { type: "string", enum: ["plus"] } },
      required: ["plan"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "count_projects",
    description: "Read the current project count for the supplied synthetic workspace.",
    strict: true,
    parameters: {
      type: "object",
      properties: { workspace: { type: "string", enum: ["fixture-workspace"] } },
      required: ["workspace"],
      additionalProperties: false,
    },
  },
];
const PROMPT =
  "In this synthetic test, the user has the plus plan and workspace fixture-workspace. " +
  "Use both read-only tools to find how many more projects fit. Then return only JSON " +
  "with one integer field, remaining. Do not infer limits or counts from prior knowledge.";

// The model never receives these values until it issues valid calls.
const FIXTURES = new Map([
  ["get_project_limit", { key: "plan", value: "plus", result: { limit: 20 } }],
  ["count_projects", { key: "workspace", value: "fixture-workspace", result: { count: 18 } }],
]);

/** Execute only the two fixed, read-only in-memory tools. There is no live API/connector path. */
export async function runToolProbe(respond, { timeoutMs = 1000 } = {}) {
  if (typeof respond !== "function") throw new Error("A responder function is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error("Invalid probe timeout");
  }
  const controller = new AbortController();
  let timer;
  let active = true;
  const trace = [];
  const seenIds = new Set();
  const called = new Set();
  const returnedModels = new Set();
  let modelIdentityComplete = true;
  let turns = 0;
  const protocolHash = digest({
    version: 1,
    prompt: PROMPT,
    tools: TOOLS,
    fixtures: [...FIXTURES],
  });
  const input = [{ role: "user", content: PROMPT }];
  const fail = (reason) => ({ score: 0, reason });
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      active = false;
      controller.abort();
      resolve(fail("timeout"));
    }, timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      deadline,
      (async () => {
        for (let turn = 0; turn < 3; turn += 1) {
          if (!active) return fail("timeout");
          turns += 1;
          const body = await respond(
            structuredClone({ input, tools: TOOLS, store: false, parallel_tool_calls: false }),
            { signal: controller.signal },
          );
          if (!active) return fail("timeout");
          if (body?.status !== "completed" || !Array.isArray(body.output)) {
            return fail("invalid_response");
          }
          if (typeof body.model === "string" && body.model.trim()) returnedModels.add(body.model);
          else modelIdentityComplete = false;
          if (returnedModels.size > 1) return fail("model_changed");
          const calls = body.output.filter((part) => part?.type === "function_call");
          if (calls.length === 0) {
            if (called.size !== 2) return fail("required_tools_not_called");
            const text = body.output
              .filter((part) => part?.type === "message" && part.role === "assistant")
              .flatMap((part) => (Array.isArray(part.content) ? part.content : []))
              .filter((part) => part?.type === "output_text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("");
            let answer;
            try {
              answer = JSON.parse(text);
            } catch {
              return fail("invalid_final_json");
            }
            if (!answer || Array.isArray(answer) || Object.keys(answer).length !== 1) {
              return fail("invalid_final_schema");
            }
            return answer.remaining === 2
              ? { score: 1, reason: "tools_executed_and_answer_correct" }
              : fail("wrong_final_answer");
          }
          if (calls.length > 2) return fail("tool_call_limit");
          for (const call of calls) {
            const fixture = FIXTURES.get(call.name);
            if (!fixture) return fail("unknown_tool");
            if (typeof call.call_id !== "string" || !call.call_id || seenIds.has(call.call_id)) {
              return fail("invalid_or_duplicate_call_id");
            }
            if (called.has(call.name)) return fail("repeated_tool");
            let args;
            try {
              args = JSON.parse(call.arguments);
            } catch {
              return fail("invalid_tool_json");
            }
            if (
              !args ||
              Array.isArray(args) ||
              Object.keys(args).length !== 1 ||
              args[fixture.key] !== fixture.value
            ) {
              return fail("invalid_tool_arguments");
            }
            seenIds.add(call.call_id);
            called.add(call.name);
            const result = JSON.stringify(fixture.result);
            trace.push({ call_id: call.call_id, name: call.name, arguments: args, result });
            input.push({
              type: "function_call",
              call_id: call.call_id,
              name: call.name,
              arguments: call.arguments,
            });
            input.push({ type: "function_call_output", call_id: call.call_id, output: result });
          }
        }
        return fail("turn_limit");
      })(),
    ]);
    return {
      id: "project-capacity-tool-probe-v1",
      ...outcome,
      turns,
      trace: structuredClone(trace),
      protocol_sha256: protocolHash,
      returned_model: returnedModels.values().next().value ?? null,
      model_identity_complete: modelIdentityComplete && returnedModels.size === 1,
      replacement_eligible: false,
      scope: "One public synthetic tool-conformance probe, not a capability benchmark",
    };
  } catch {
    return {
      id: "project-capacity-tool-probe-v1",
      ...fail("responder_error"),
      turns,
      trace: structuredClone(trace),
      protocol_sha256: protocolHash,
      replacement_eligible: false,
    };
  } finally {
    active = false;
    controller.abort();
    clearTimeout(timer);
  }
}
