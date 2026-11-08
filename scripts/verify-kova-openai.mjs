/** Explicit paid acceptance check for the exact application transport. No key output or files. */
import { execFileSync } from "node:child_process";
import { requestHostedEffort } from "../src/lib/ai/hosted-effort.server.mjs";
import {
  requestKovaHostedChat,
  HOSTED_MODEL_MAP,
} from "../src/lib/ai/kova-hosted-inference.server.mjs";
import { CONSUMER_EFFORTS, hostedEffortProfile } from "../src/lib/consumer-effort-policy.mjs";
import { KOVA_ASSISTANT_IDENTITY } from "../src/lib/ai/kova-identity-policy.mjs";

if (!process.argv.includes("--execute")) {
  console.log(
    "Dry run: 18 mode generations (48 provider requests including 30 reviews), plus 6 tool-roundtrip requests. Use --execute with OPENAI_API_KEY, or --azure-existing-key to reuse the production app secret in memory. This does not deploy or change key limits.",
  );
  process.exit(0);
}
let token = process.env.OPENAI_API_KEY;
if (process.argv.includes("--azure-existing-key")) {
  const secrets = JSON.parse(
    execFileSync(
      "az",
      [
        "containerapp",
        "secret",
        "list",
        "-g",
        "rg-kovagpt-prod",
        "-n",
        "kovagpt-prod-web",
        "--show-values",
        "-o",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  token = secrets.find((s) => s.name === "openai-api-key")?.value;
}
if (!token) throw new Error("openai_key_unavailable");
let failures = 0;
for (const [model, foundation] of Object.entries(HOSTED_MODEL_MAP)) {
  for (const mode of CONSUMER_EFFORTS) {
    let calls = 0;
    const reviews = [];
    try {
      const response = await requestHostedEffort({
        request: {
          model,
          stream: true,
          max_completion_tokens: hostedEffortProfile(model, mode.id).outputTokens,
          messages: [
            {
              role: "user",
              content:
                "State your Kova product name and calculate 19 times 23. One short sentence.",
            },
          ],
        },
        mode: mode.id,
        token,
        beforeSend: async () => {
          calls++;
        },
        onUsage: (u) => reviews.push(u),
      });
      const stream = await response.text();
      let text = "",
        usage;
      for (const frame of stream.split("\n\n")) {
        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.slice(5)
          .trim();
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        text += event.choices?.[0]?.delta?.content ?? "";
        if (event.usage) usage = event.usage;
      }
      const profile = hostedEffortProfile(model, mode.id);
      if (
        !stream.includes("[DONE]") ||
        !text.includes(KOVA_ASSISTANT_IDENTITY[model]) ||
        !text.includes("437") ||
        !usage ||
        reviews.length !== profile.reviews ||
        calls !== profile.reviews + 1
      )
        throw new Error("acceptance_assertion_failed");
      console.log(
        JSON.stringify({
          model,
          foundation,
          mode: mode.label,
          status: "PASS",
          calls,
          reviewReceipts: reviews.length,
          reply: text,
          usage,
        }),
      );
    } catch (error) {
      failures++;
      console.log(
        JSON.stringify({
          model,
          foundation,
          mode: mode.label,
          status: "FAIL",
          calls,
          reviewReceipts: reviews.length,
          error: error.code ?? error.message,
        }),
      );
    }
  }
  try {
    const tools = [
      {
        type: "function",
        function: {
          name: "calculate",
          description: "Multiply two integers",
          parameters: {
            type: "object",
            properties: { a: { type: "integer" }, b: { type: "integer" } },
            required: ["a", "b"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    ];
    const messages = [
      { role: "user", content: "Use calculate to multiply 19 by 23, then report the result." },
    ];
    const planned = await (
      await requestKovaHostedChat({
        request: {
          model,
          messages,
          tools,
          tool_choice: { type: "function", function: { name: "calculate" } },
          max_completion_tokens: 2048,
        },
        token,
        effort: "low",
      })
    ).json();
    const assistant = planned.choices?.[0]?.message;
    const call = assistant?.tool_calls?.[0];
    const args = JSON.parse(call?.function?.arguments ?? "null");
    if (call?.function?.name !== "calculate" || args?.a !== 19 || args?.b !== 23)
      throw new Error("tool_plan_invalid");
    messages.push(assistant, {
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify({ result: args.a * args.b }),
    });
    const final = await (
      await requestKovaHostedChat({
        request: { model, messages, tools, tool_choice: "none", max_completion_tokens: 2048 },
        token,
        effort: "low",
      })
    ).json();
    if (!final.choices?.[0]?.message?.content?.includes("437") || !planned.usage || !final.usage)
      throw new Error("tool_result_invalid");
    console.log(
      JSON.stringify({ model, foundation, check: "tool-roundtrip", status: "PASS", calls: 2 }),
    );
  } catch (error) {
    failures++;
    console.log(
      JSON.stringify({
        model,
        foundation,
        check: "tool-roundtrip",
        status: "FAIL",
        error: error.code ?? error.message,
      }),
    );
  }
}
console.log(JSON.stringify({ check: "summary", failures, status: failures ? "FAIL" : "PASS" }));
process.exitCode = failures ? 1 : 0;
