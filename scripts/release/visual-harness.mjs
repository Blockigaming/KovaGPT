const dry = process.argv.includes("--dry-run");
if (dry) {
  console.log(
    "Authenticated visual harness dry run: no credentials loaded and no screenshots fabricated.",
  );
  process.exit(0);
}
for (const key of [
  "KOVA_STAGING_BASE_URL",
  "KOVA_STAGING_ALLOWED_HOST",
  "KOVA_STAGING_STORAGE_STATE",
])
  if (!process.env[key]) throw new Error(`Missing protected visual requirement: ${key}`);
const url = new URL(process.env.KOVA_STAGING_BASE_URL);
if (
  url.protocol !== "https:" ||
  url.hostname !== process.env.KOVA_STAGING_ALLOWED_HOST ||
  /prod/i.test(url.hostname)
)
  throw new Error("Refusing non-staging visual target");
console.log(
  "Protected authenticated visual configuration accepted; run the staging Playwright visual project.",
);
