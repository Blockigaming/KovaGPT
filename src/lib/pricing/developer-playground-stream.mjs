export function createDeveloperPlaygroundStream() {
  const maximum = 1048576;
  let pending = "",
    data = [],
    dataSize = 0,
    output = "",
    terminal = null;
  const invalid = () => {
    throw new Error("Stream could not be verified. Check Logs before retrying.");
  };
  const dispatch = () => {
    const frame = data.join("\n");
    data = [];
    dataSize = 0;
    if (!frame || frame === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(frame);
    } catch {
      invalid();
    }
    if (!event || typeof event !== "object" || typeof event.type !== "string") invalid();
    if (
      ["error", "response.failed", "response.cancelled"].includes(event.type) ||
      terminal !== null
    )
      invalid();
    if (event.type === "response.completed" || event.type === "response.incomplete") {
      const expected = event.type === "response.completed" ? "completed" : "incomplete";
      if (event.response?.status !== expected) invalid();
      terminal = expected;
    } else if (
      event.type === "response.output_text.delta" ||
      event.type === "response.refusal.delta"
    ) {
      if (typeof event.delta !== "string" || output.length + event.delta.length > maximum)
        invalid();
      output += event.delta;
    }
  };
  return {
    push(chunk) {
      pending += chunk;
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (line.length > maximum) invalid();
        if (line === "") {
          dispatch();
        } else if (line === "data" || line.startsWith("data:")) {
          const value = line === "data" ? "" : line.slice(5).replace(/^ /, "");
          dataSize += value.length + 1;
          if (dataSize > maximum) invalid();
          data.push(value);
        }
      }
      if (pending.length > maximum) invalid();
      return output;
    },
    finish() {
      if (terminal === null || pending.trim() || data.length) invalid();
      return { output, status: terminal };
    },
  };
}
