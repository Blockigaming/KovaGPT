const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const invalid = () => {
  throw new Error("developer_decision_invalid");
};
const exact = (value, fields) => {
  if (!object(value) || Object.keys(value).some((key) => !fields.includes(key))) invalid();
};
const text = (value, max) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > max
  )
    invalid();
  return value;
};
const probability = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const integer = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;

export function developerDecisionFields(input) {
  exact(input, ["model", "input", "questions"]);
  const evidence = text(input.input, 16000);
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 16)
    invalid();
  const names = new Set();
  const questions = input.questions.map((question) => {
    const type = question?.type;
    if (!["predicate", "choice", "score"].includes(type)) invalid();
    exact(question, [
      "type",
      "name",
      "instructions",
      ...(type === "choice" ? ["choices"] : type === "score" ? ["levels"] : []),
    ]);
    if (
      typeof question.name !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(question.name) ||
      names.has(question.name)
    )
      invalid();
    names.add(question.name);
    const normalized = {
      type,
      name: question.name,
      instructions: text(question.instructions, 2000),
    };
    if (type !== "predicate") {
      const key = type === "choice" ? "choices" : "levels";
      const valueKey = type === "choice" ? "value" : "label";
      if (!Array.isArray(question[key]) || question[key].length < 2 || question[key].length > 10)
        invalid();
      const values = new Set();
      normalized[key] = question[key].map((option) => {
        exact(option, [valueKey, "description"]);
        const value =
          type === "choice" && typeof option[valueKey] === "boolean"
            ? option[valueKey]
            : text(option[valueKey], 160);
        if (values.has(value)) invalid();
        values.add(value);
        return {
          [valueKey]: value,
          ...(option.description === undefined
            ? {}
            : { description: text(option.description, 500) }),
        };
      });
    }
    return normalized;
  });
  return { input: evidence, questions, prompt_cache_options: { mode: "explicit" } };
}

export function validDeveloperDecisionRequest(body) {
  try {
    if (body.model !== "gpt-6-luna") return false;
    const { prompt_cache_options, ...input } = body;
    exact(prompt_cache_options, ["mode"]);
    if (prompt_cache_options.mode !== "explicit") return false;
    const normalized = developerDecisionFields(input);
    return (
      JSON.stringify(normalized.input) === JSON.stringify(body.input) &&
      JSON.stringify(normalized.questions) === JSON.stringify(body.questions)
    );
  } catch {
    return false;
  }
}

export function developerDecisionUsage(usage) {
  if (
    !object(usage) ||
    ![
      usage.input_tokens,
      usage.output_tokens,
      usage.total_tokens,
      usage.output_tokens_details?.reasoning_tokens,
    ].every(integer) ||
    usage.input_tokens < 1 ||
    usage.input_tokens + usage.output_tokens !== usage.total_tokens ||
    usage.output_tokens_details.reasoning_tokens > usage.output_tokens ||
    usage.input_tokens_details?.cached_tokens !== 0 ||
    usage.input_tokens_details?.cache_write_tokens !== 0
  )
    return null;
  return { decision_input_tokens: usage.input_tokens };
}

export function validateDeveloperDecisionResult(value, questions, expectedModels, publicModel) {
  const fail = () => {
    throw new Error("developer_provider_unavailable");
  };
  if (
    !object(value) ||
    !Array.isArray(expectedModels) ||
    !expectedModels.includes(value.model) ||
    !developerDecisionUsage(value.usage) ||
    !Array.isArray(value.answers) ||
    value.answers.length !== questions.length
  )
    fail();
  const answers = value.answers.map((answer, index) => {
    const question = questions[index];
    if (!object(answer) || answer.name !== question.name) fail();
    if (answer.type === "refusal") return { type: "refusal", name: answer.name };
    if (answer.type !== question.type) fail();
    if (answer.type === "predicate") {
      if (!probability(answer.probability)) fail();
      return { type: answer.type, name: answer.name, probability: answer.probability };
    }
    const expected = question.type === "choice" ? question.choices : question.levels;
    if (
      !probability(answer.confidence) ||
      !Array.isArray(answer.probabilities) ||
      answer.probabilities.length !== expected.length
    )
      fail();
    const seen = new Set();
    const probabilities = answer.probabilities.map((part) => {
      if (!object(part) || !probability(part.probability)) fail();
      const index =
        question.type === "choice"
          ? expected.findIndex((option) => option.value === part.value)
          : part.value;
      if (!Number.isSafeInteger(index) || index < 0 || index >= expected.length || seen.has(index))
        fail();
      seen.add(index);
      if (question.type === "score" && part.label !== expected[index].label) fail();
      return {
        value: part.value,
        probability: part.probability,
        ...(question.type === "score" ? { label: part.label } : {}),
      };
    });
    if (Math.abs(probabilities.reduce((sum, part) => sum + part.probability, 0) - 1) > 0.01) fail();
    const result = {
      type: answer.type,
      name: answer.name,
      confidence: answer.confidence,
      probabilities,
    };
    if (question.type === "choice") {
      if (!expected.some((option) => option.value === answer.choice)) fail();
      return { ...result, choice: answer.choice };
    }
    const weighted = probabilities.reduce((sum, part) => sum + part.value * part.probability, 0);
    if (
      !Number.isFinite(answer.score) ||
      answer.score < 0 ||
      answer.score > expected.length - 1 ||
      Math.abs(answer.score - weighted) > 0.05
    )
      fail();
    return { ...result, score: answer.score };
  });
  return {
    model: publicModel,
    answers,
    usage: {
      input_tokens: value.usage.input_tokens,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: value.usage.output_tokens,
      output_tokens_details: {
        reasoning_tokens: value.usage.output_tokens_details.reasoning_tokens,
      },
      total_tokens: value.usage.total_tokens,
    },
  };
}

export async function readDeveloperDecisionResponse(
  response,
  questions,
  expectedModels,
  publicModel,
) {
  if (
    !response.ok ||
    !response.body ||
    (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !==
      "application/json"
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error("developer_provider_unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    body = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 262144) throw new Error("developer_provider_unavailable");
      body += decoder.decode(part.value, { stream: true });
    }
    return validateDeveloperDecisionResult(
      JSON.parse(body + decoder.decode()),
      questions,
      expectedModels,
      publicModel,
    );
  } catch {
    throw new Error("developer_provider_unavailable");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
