const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const groups = [
  ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
  ["KOVA_PUBLIC_URL", "APP_URL", "SITE_URL"],
];
const missing = [
  ...required.filter((k) => !process.env[k]),
  ...groups.filter((g) => !g.some((k) => process.env[k])).map((g) => g.join("|")),
];
const mode = process.env.KOVA_RELEASE_ENV === "production" ? "production" : "repository";
console.log(
  JSON.stringify(
    { mode, valid: missing.length === 0, missing: missing.map((_, i) => `requirement-${i + 1}`) },
    null,
    2,
  ),
);
if (mode === "production" && missing.length) process.exitCode = 1;
