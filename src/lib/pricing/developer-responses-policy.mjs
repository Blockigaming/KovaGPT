const fail = () => {
  throw new Error("developer_responses_invalid");
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const exact = (value, fields) => {
  if (!object(value) || Object.keys(value).some((key) => !fields.includes(key))) fail();
};
const text = (value, max = 32000, empty = false) => {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max ||
    value.includes("\0")
  )
    fail();
  return value;
};
const name = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail();
  return value;
};

// Bounded JSON Schema subset. Remote references are never fetched.
export function developerJsonSchema(schema) {
  let nodes = 0;
  const refs = [];
  function visit(node, depth) {
    if (++nodes > 500 || depth > 10) fail();
    exact(node, [
      "type",
      "description",
      "properties",
      "required",
      "additionalProperties",
      "items",
      "enum",
      "anyOf",
      "$defs",
      "$ref",
    ]);
    if (node.description !== undefined) text(node.description, 2000, true);
    if (node.$defs !== undefined) {
      if (!object(node.$defs) || Object.keys(node.$defs).length > 100) fail();
      for (const [key, child] of Object.entries(node.$defs)) {
        name(key);
        visit(child, depth + 1);
      }
    }
    if (node.$ref !== undefined) {
      if (typeof node.$ref !== "string" || !/^#(?:\/\$defs\/[A-Za-z0-9_-]{1,64})?$/.test(node.$ref))
        fail();
      if (Object.keys(node).some((key) => !["$ref", "description"].includes(key))) fail();
      refs.push(node.$ref);
      return;
    }
    if (node.anyOf !== undefined) {
      if (
        !Array.isArray(node.anyOf) ||
        node.anyOf.length < 2 ||
        node.anyOf.length > 10 ||
        Object.keys(node).some((key) => !["anyOf", "description", "$defs"].includes(key))
      )
        fail();
      for (const child of node.anyOf) visit(child, depth + 1);
      return;
    }
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (
      !types.length ||
      types.length > 2 ||
      new Set(types).size !== types.length ||
      types.some(
        (type) =>
          !["object", "array", "string", "number", "integer", "boolean", "null"].includes(type),
      ) ||
      (types.length === 2 && !types.includes("null"))
    )
      fail();
    if (types.includes("object")) {
      if (
        !object(node.properties) ||
        Object.keys(node.properties).length > 100 ||
        node.additionalProperties !== false ||
        !Array.isArray(node.required) ||
        node.required.some((key) => typeof key !== "string") ||
        new Set(node.required).size !== node.required.length ||
        [...node.required].sort().join("\0") !== Object.keys(node.properties).sort().join("\0")
      )
        fail();
      for (const [key, child] of Object.entries(node.properties)) {
        text(key, 100);
        visit(child, depth + 1);
      }
    } else if (
      node.properties !== undefined ||
      node.required !== undefined ||
      node.additionalProperties !== undefined
    )
      fail();
    if (types.includes("array")) visit(node.items, depth + 1);
    else if (node.items !== undefined) fail();
    if (
      node.enum !== undefined &&
      (!Array.isArray(node.enum) ||
        !node.enum.length ||
        node.enum.length > 100 ||
        node.enum.some(
          (value) => value !== null && !["string", "number", "boolean"].includes(typeof value),
        ) ||
        JSON.stringify(node.enum).length > 8000)
    )
      fail();
  }
  visit(schema, 0);
  if (
    schema.type !== "object" ||
    refs.some((ref) => ref !== "#" && !Object.hasOwn(schema.$defs ?? {}, ref.slice(8)))
  )
    fail();
  return structuredClone(schema);
}

export function developerResponseInput(value) {
  if (typeof value === "string") return text(value);
  if (!Array.isArray(value) || !value.length || value.length > 100) fail();
  const calls = new Map(),
    completed = new Set();
  return value.map((item) => {
    if (item?.type === "function_call") {
      exact(item, ["type", "id", "call_id", "name", "arguments", "status"]);
      const callId = text(item.call_id, 128),
        functionName = name(item.name);
      if (calls.has(callId) || (item.status !== undefined && item.status !== "completed")) fail();
      text(item.arguments, 16000);
      try {
        if (!object(JSON.parse(item.arguments))) fail();
      } catch {
        fail();
      }
      calls.set(callId, functionName);
      return {
        type: "function_call",
        ...(item.id ? { id: text(item.id, 128) } : {}),
        call_id: callId,
        name: functionName,
        arguments: item.arguments,
      };
    }
    if (item?.type === "function_call_output") {
      exact(item, ["type", "call_id", "output"]);
      if (!calls.has(item.call_id) || completed.has(item.call_id)) fail();
      completed.add(item.call_id);
      return {
        type: "function_call_output",
        call_id: item.call_id,
        output: text(item.output, 32000, true),
      };
    }
    if (item?.type === "reasoning") {
      exact(item, ["type", "id", "summary", "encrypted_content", "status"]);
      if (
        !Array.isArray(item.summary) ||
        item.summary.length > 10 ||
        (item.status !== undefined && item.status !== "completed")
      )
        fail();
      return {
        type: "reasoning",
        id: text(item.id, 128),
        encrypted_content: text(item.encrypted_content, 32000),
        summary: item.summary.map((part) => {
          exact(part, ["type", "text"]);
          if (part.type !== "summary_text") fail();
          return { type: "summary_text", text: text(part.text, 8000, true) };
        }),
      };
    }
    exact(item, ["type", "role", "content", "id", "status"]);
    if (
      (item.type !== undefined && item.type !== "message") ||
      !["user", "assistant", "developer", "system"].includes(item.role) ||
      (item.status !== undefined && item.status !== "completed")
    )
      fail();
    let content = item.content;
    if (Array.isArray(content)) {
      if (!content.length || content.length > 32) fail();
      content = content
        .map((part) => {
          exact(part, ["type", "text", "annotations", "logprobs"]);
          if (
            !["input_text", "output_text"].includes(part.type) ||
            (part.type === "output_text" && item.role !== "assistant")
          )
            fail();
          // Output annotations are display metadata, never an authority to fetch URLs.
          return text(part.text, 32000, item.role === "assistant");
        })
        .join("\n");
    }
    return { role: item.role, content: text(content, 32000, item.role === "assistant") };
  });
}

export function developerResponseFeatures(input) {
  const result = {};
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools) || input.tools.length > 32) fail();
    const names = new Set();
    result.tools = input.tools.map((tool) => {
      exact(tool, ["type", "name", "description", "parameters", "strict"]);
      if (tool.type !== "function" || tool.strict !== true || names.has(tool.name)) fail();
      names.add(name(tool.name));
      return {
        type: "function",
        name: tool.name,
        ...(tool.description !== undefined ? { description: text(tool.description, 2000) } : {}),
        parameters: developerJsonSchema(tool.parameters),
        strict: true,
      };
    });
    if (result.tools.length) result.include = ["reasoning.encrypted_content"];
  }
  if (input.tool_choice !== undefined) {
    if (["auto", "none", "required"].includes(input.tool_choice))
      result.tool_choice = input.tool_choice;
    else {
      exact(input.tool_choice, ["type", "name"]);
      if (
        input.tool_choice.type !== "function" ||
        !result.tools?.some((tool) => tool.name === input.tool_choice.name)
      )
        fail();
      result.tool_choice = { type: "function", name: input.tool_choice.name };
    }
    if (input.tool_choice !== "none" && !result.tools?.length) fail();
  }
  if (input.parallel_tool_calls !== undefined) {
    if (typeof input.parallel_tool_calls !== "boolean" || !result.tools?.length) fail();
    result.parallel_tool_calls = input.parallel_tool_calls;
  }
  if (input.text !== undefined) {
    exact(input.text, ["format"]);
    const format = input.text.format;
    exact(format, ["type", "name", "description", "strict", "schema"]);
    if (format.type !== "json_schema" || format.strict !== true) fail();
    result.text = {
      format: {
        type: "json_schema",
        name: name(format.name),
        strict: true,
        schema: developerJsonSchema(format.schema),
        ...(format.description !== undefined
          ? { description: text(format.description, 2000) }
          : {}),
      },
    };
  }
  return result;
}
