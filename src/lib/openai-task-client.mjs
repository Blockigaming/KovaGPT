const operations = new Set(["agent", "browser", "decisions", "moderation"]);

function structuredResult(body, operation) {
  if (operation === "decisions") {
    if (!Array.isArray(body.answers) || body.answers.length !== 1) return null;
    const answer = body.answers[0];
    if (answer?.name !== "question") return null;
    if (answer.type === "refusal") return "The model declined to answer this question.";
    if (
      answer.type !== "predicate" ||
      typeof answer.probability !== "number" ||
      !Number.isFinite(answer.probability) ||
      answer.probability < 0 ||
      answer.probability > 1
    )
      return null;
    return `Estimated probability the answer is yes: ${(answer.probability * 100).toFixed(1)}%.`;
  }
  if (operation === "moderation") {
    if (!Array.isArray(body.results) || body.results.length !== 1) return null;
    const result = body.results[0];
    if (
      typeof result?.flagged !== "boolean" ||
      !result.categories ||
      typeof result.categories !== "object" ||
      Array.isArray(result.categories)
    )
      return null;
    const categories = Object.entries(result.categories);
    if (
      !categories.length ||
      categories.length > 32 ||
      categories.some(([name, flagged]) => name.length > 80 || typeof flagged !== "boolean")
    )
      return null;
    const flagged = categories.filter(([, value]) => value).map(([name]) => name);
    if (result.flagged !== flagged.length > 0) return null;
    return result.flagged
      ? `Content flagged for review.${flagged.length ? `\nFlagged categories: ${flagged.join(", ")}.` : ""}`
      : "No categories flagged. Review the content against your own policy before using it.";
  }
  return typeof body.text === "string" && body.text.trim() ? body.text : null;
}

const messages = {
  account_changed: "Your account changed. Open this task again.",
  email_verification_required: "Verify your email address before running a task.",
  subscription_required: "Kova Plus or Pro is required for this task.",
  browser_domains_not_configured: "Hosted Browser is not configured for public sites yet.",
  service_budget_unavailable: "The task allowance is unavailable or has been reached.",
  request_already_submitted: "This task was already submitted. Start a new task if needed.",
  session_expired: "Your session expired. Sign in again.",
  openai_services_unavailable: "OpenAI tasks are temporarily unavailable.",
};

async function readReply(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The task service returned an unreadable response.");
  }
  if (!response.ok) {
    throw new Error(
      messages[body?.error] ??
        (response.status === 401
          ? "Sign in to use OpenAI tasks."
          : "The task could not be completed. Try a new task later."),
    );
  }
  return body;
}

export async function loadOpenAiTaskAvailability(ownerId, { signal, fetchImpl = fetch } = {}) {
  if (typeof ownerId !== "string" || !ownerId) throw new Error("Sign in to use OpenAI tasks.");
  const body = await readReply(
    await fetchImpl("/api/ai/services", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "x-kova-service-owner": ownerId },
      signal,
    }),
  );
  if (typeof body?.configured !== "boolean" || !Array.isArray(body.operations))
    throw new Error("The task service returned an unreadable response.");
  const available = Object.fromEntries(
    body.operations
      .filter((item) => operations.has(item?.operation) && typeof item.available === "boolean")
      .map((item) => [item.operation, item.available]),
  );
  if (typeof available.agent !== "boolean" || typeof available.browser !== "boolean")
    throw new Error("The task service returned an unreadable response.");
  return {
    configured: body.configured,
    agent: available.agent,
    browser: available.browser,
    decisions: available.decisions === true,
    moderation: available.moderation === true,
  };
}

export async function submitOpenAiTask(
  { ownerId, operation, input, requestId, question },
  { signal, fetchImpl = fetch } = {},
) {
  if (typeof ownerId !== "string" || !ownerId) throw new Error("Sign in to use OpenAI tasks.");
  if (
    !operations.has(operation) ||
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 8000
  )
    throw new Error("Enter a task of up to 8,000 characters.");
  if (typeof requestId !== "string" || !/^[A-Za-z0-9:_-]{8,120}$/.test(requestId))
    throw new Error("The task identifier is invalid.");
  if (
    operation === "decisions" &&
    (typeof question !== "string" || !question.trim() || question.length > 1000)
  )
    throw new Error("Enter a yes/no question of up to 1,000 characters.");
  if (operation !== "decisions" && question !== undefined)
    throw new Error("This task does not accept a decision question.");
  const body = await readReply(
    await fetchImpl("/api/ai/services", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-kova-service-owner": ownerId,
        "idempotency-key": requestId,
      },
      body: JSON.stringify({
        operation,
        input: input.trim(),
        ...(operation === "decisions"
          ? { questions: [{ name: "question", type: "predicate", instructions: question.trim() }] }
          : {}),
      }),
      signal,
    }),
  );
  const text = body?.operation === operation ? structuredResult(body, operation) : null;
  if (!text) throw new Error("The task service returned an unreadable response.");
  return { text, toolCalls: body.toolCalls };
}
