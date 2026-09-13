/** Validate literal CSV cells without rewriting numeric analysis results. */
export function validateWorkCsv(content) {
  if (
    typeof content !== "string" ||
    new TextEncoder().encode(content).length > 6 * 1024 * 1024 ||
    content.includes("\u0000")
  )
    throw new Error("work_csv_invalid");
  let cell = "",
    quoted = false,
    afterQuote = false,
    atStart = true;
  const check = () => {
    const value = cell.trim();
    if (
      /^[=+@]/u.test(value) ||
      (value.startsWith("-") && !/^-(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value))
    )
      throw new Error("work_csv_formula_unsupported");
    cell = "";
    atStart = true;
    afterQuote = false;
  };
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else cell += character;
      continue;
    }
    if ([",", ";", "\t", "\r", "\n"].includes(character)) {
      check();
      continue;
    }
    if (afterQuote) {
      if (character !== " ") throw new Error("work_csv_invalid");
      continue;
    }
    if (atStart && character === '"') {
      quoted = true;
      atStart = false;
      continue;
    }
    if (character === '"') throw new Error("work_csv_invalid");
    cell += character;
    atStart = false;
  }
  if (quoted) throw new Error("work_csv_invalid");
  check();
  return content;
}
