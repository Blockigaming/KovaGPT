/** Fixed data-processing commands run inside the existing networkless runsc job,
 * never in a host shell. All paths come from the validated job file inventory. */
export const TERMINAL_COMMANDS = Object.freeze([
  { command: "wc", options: { metric: "lines|words|bytes" } },
  { command: "sort", options: { numeric: "boolean", reverse: "boolean", unique: "boolean" } },
  { command: "uniq", options: { counts: "boolean" } },
  { command: "head", options: { lines: "integer 1..10000" } },
  { command: "tail", options: { lines: "integer 1..10000" } },
  {
    command: "cut",
    options: { delimiter: "one printable ASCII character", fields: "1..10 column numbers" },
  },
  { command: "sha256sum", options: {} },
]);
const fail = () => {
  throw new Error("work_terminal_plan_invalid");
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const name = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) &&
  value !== "." &&
  value !== "..";
function options(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail();
  return value;
}
function flag(value) {
  if (value !== undefined && typeof value !== "boolean") fail();
  return value === true;
}
export function compileTerminalPlan(commands, inputNames) {
  if (
    !Array.isArray(commands) ||
    !commands.length ||
    commands.length > 8 ||
    !Array.isArray(inputNames) ||
    inputNames.length > 16 ||
    inputNames.some((item) => !name(item))
  )
    fail();
  const files = new Map(
    inputNames.map((item) => [item.toLowerCase(), { name: item, directory: "input" }]),
  );
  if (files.size !== inputNames.length) fail();
  const steps = commands.map((step) => {
    if (
      !object(step) ||
      Object.keys(step).some(
        (key) => !["command", "options", "inputFile", "outputFile"].includes(key),
      ) ||
      !name(step.inputFile) ||
      !name(step.outputFile)
    )
      fail();
    const source = files.get(step.inputFile.toLowerCase());
    if (!source || files.has(step.outputFile.toLowerCase())) fail();
    const value = step.options ?? {};
    let argv;
    switch (step.command) {
      case "wc": {
        options(value, ["metric"]);
        const metric = value.metric ?? "lines";
        if (!["lines", "words", "bytes"].includes(metric)) fail();
        argv = ["/usr/bin/wc", { lines: "-l", words: "-w", bytes: "-c" }[metric]];
        break;
      }
      case "sort":
        options(value, ["numeric", "reverse", "unique"]);
        argv = [
          "/usr/bin/sort",
          ...(flag(value.numeric) ? ["-n"] : []),
          ...(flag(value.reverse) ? ["-r"] : []),
          ...(flag(value.unique) ? ["-u"] : []),
        ];
        break;
      case "uniq":
        options(value, ["counts"]);
        argv = ["/usr/bin/uniq", ...(flag(value.counts) ? ["-c"] : [])];
        break;
      case "head":
      case "tail": {
        options(value, ["lines"]);
        const lines = value.lines ?? 10;
        if (!Number.isSafeInteger(lines) || lines < 1 || lines > 10000) fail();
        argv = [`/usr/bin/${step.command}`, "-n", String(lines)];
        break;
      }
      case "cut":
        options(value, ["delimiter", "fields"]);
        if (
          typeof value.delimiter !== "string" ||
          !/^[\x20-\x7e]$/u.test(value.delimiter) ||
          !Array.isArray(value.fields) ||
          !value.fields.length ||
          value.fields.length > 10 ||
          value.fields.some((field) => !Number.isSafeInteger(field) || field < 1 || field > 1000)
        )
          fail();
        argv = ["/usr/bin/cut", "-d", value.delimiter, "-f", value.fields.join(",")];
        break;
      case "sha256sum":
        options(value, []);
        argv = ["/usr/bin/sha256sum"];
        break;
      default:
        fail();
    }
    files.set(step.outputFile.toLowerCase(), { name: step.outputFile, directory: "output" });
    return { argv, source, output: step.outputFile };
  });
  const payload = Buffer.from(JSON.stringify(steps), "utf8").toString("base64");
  return `import base64,json,os,pathlib,stat,subprocess,time
steps=json.loads(base64.b64decode("${payload}"))
roots={"input":pathlib.Path(os.environ["KOVA_INPUT_DIR"]),"output":pathlib.Path(os.environ["KOVA_OUTPUT_DIR"])}
deadline=time.monotonic()+20
for step in steps:
    source=roots[step["source"]["directory"]]/step["source"]["name"]
    if source.is_symlink() or not stat.S_ISREG(source.stat().st_mode): raise ValueError("terminal_input_invalid")
    destination=roots["output"]/step["output"]
    remaining=deadline-time.monotonic()
    if remaining<=0: raise TimeoutError("terminal_timeout")
    with source.open("rb") as incoming, destination.open("xb") as outgoing:
        result=subprocess.run(step["argv"],stdin=incoming,stdout=outgoing,stderr=subprocess.DEVNULL,shell=False,timeout=min(remaining,10),env={"PATH":"/usr/bin:/bin","LANG":"C.UTF-8","LC_ALL":"C.UTF-8","TMPDIR":"/tmp"})
    print(json.dumps({"command":pathlib.Path(step["argv"][0]).name,"output":step["output"],"exitCode":result.returncode}))
    if result.returncode!=0: raise RuntimeError("terminal_command_failed")
`;
}
