import { readFileSync } from "node:fs";
const contract = JSON.parse(
  readFileSync("docs/production-readiness/environment-contract.json", "utf8"),
);
const example = readFileSync(".env.example", "utf8");
const names = contract.variables.map((v) => v.name);
if (new Set(names).size !== names.length) throw new Error("duplicate environment contract name");
for (const v of contract.variables) {
  for (const key of [
    "classification",
    "sensitivity",
    "expectedFormat",
    "owningSubsystem",
    "startupBehaviorWhenAbsent",
    "validationFunction",
  ])
    if (!v[key]) throw new Error(`${v.name} missing ${key}`);
  if (v.sensitivity === "secret" && v.classification !== "server-only")
    throw new Error(`${v.name} secret exposed to client`);
  if (
    !new RegExp(`^${v.name}=`, `m`).test(example) &&
    ![
      "KOVA_PUBLIC_URL",
      "KOVA_EDGE_ALLOWED_HOSTS",
      "CRON_SECRET",
      "SCHEDULED_TASK_SECRET",
    ].includes(v.name)
  )
    throw new Error(`.env.example missing ${v.name}`);
}
const assigned = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
const duplicates = assigned.filter((n, i) => assigned.indexOf(n) !== i);
if (duplicates.length) throw new Error(`duplicate .env.example variables: ${duplicates.join(",")}`);
console.log(
  JSON.stringify({
    variables: names.length,
    secrets: contract.variables.filter((v) => v.sensitivity === "secret").length,
    duplicates: 0,
    valid: true,
  }),
);
