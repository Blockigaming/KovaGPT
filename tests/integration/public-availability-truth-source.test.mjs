import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("external assistant and developer surfaces do not publish unfinished integrations", () => {
  const connect = read("src/routes/connect.tsx");
  const mcp = read("src/routes/mcp.ts");
  const oauthResource = read("src/routes/[.well-known]/oauth-protected-resource.ts");
  const developers = read("src/routes/developers.index.tsx");
  const developerDoc = read("src/routes/developers.$docSlug.tsx");

  assert.match(connect, /Assistant connections are not available yet/);
  assert.match(connect, /not\s+an installable MCP server/);
  assert.doesNotMatch(connect, /claude mcp add|create-connector=true|New plugin dialog/);

  assert.match(mcp, /status: 501/);
  assert.match(mcp, /POST: async \(\) => unavailableResponse\(\)/);
  assert.match(mcp, /Cache-Control.*no-store/);
  assert.doesNotMatch(mcp, /listTools/);

  assert.match(oauthResource, /status: 404/);
  assert.match(oauthResource, /does not currently expose an OAuth-protected MCP resource/);
  assert.doesNotMatch(oauthResource, /authorization_servers|resolveBackendUrl/);

  assert.match(developers, /A public developer platform is not available yet/);
  assert.match(developers, /does not currently issue public API keys/);
  assert.match(developers, /noindex, nofollow/);
  assert.match(developerDoc, /throw notFound\(\)/);
  assert.doesNotMatch(developerDoc, /DEVELOPER_DOC_BY_SLUG|Production checklist/);
});

test("draft review pages cannot be returned through the generic public route", () => {
  const route = read("src/routes/$slug.tsx");
  const reviewGuard = route.indexOf("if (item?.review) throw notFound()");
  const publicReturn = route.indexOf('if (item) return { kind: "page" as const, item }');

  assert.ok(reviewGuard >= 0, "review content must have an explicit not-found guard");
  assert.ok(
    publicReturn > reviewGuard,
    "the review guard must run before returning public content",
  );
});

test("public capability copy excludes retired or unsupported claims", () => {
  const llms = read("public/llms.txt");
  const writer = read("src/routes/ai-writer.tsx");

  assert.match(llms, /current response modes are Instant, Medium, and Thinking/);
  assert.match(llms, /Voice input is not currently part of the supported web product/);
  assert.match(llms, /Scheduled background work and image editing are not currently available/);
  assert.doesNotMatch(llms, /Creative, Precise, Code, Study|use voice/);

  assert.match(writer, /exact voice match is not guaranteed/);
  assert.match(writer, /check the result before sending or publishing it/);
  assert.doesNotMatch(writer, /learns your voice|publishable prose in seconds|preserving voice/);
});

test("install metadata is complete and support identity is consistent", () => {
  const rootRoute = read("src/routes/__root.tsx");
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  const help = read("src/routes/help.tsx");
  const unsubscribe = read("src/routes/unsubscribe.tsx");
  const helpNotification = read("src/lib/email-templates/help-contact-notification.tsx");

  assert.match(rootRoute, /rel: "manifest", href: "\/manifest\.webmanifest"/);
  assert.equal(manifest.name, "KovaGPT");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.length >= 2);
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith("/") && icon.type === "image/png"));

  for (const source of [help, unsubscribe, helpNotification]) {
    assert.doesNotMatch(source, /help@kovagpt\.com/);
    assert.match(source, /support@kovagpt\.com/);
  }
  assert.doesNotMatch(help, /Settings → Billing/);
  assert.match(help, /Settings → Subscription/);
});

test("enterprise inquiry form is labeled and describes the email handoff truthfully", () => {
  const dialog = read("src/components/EnterpriseContactDialog.tsx");
  const submit = dialog.slice(dialog.indexOf("const submit"), dialog.indexOf("return ("));

  for (const id of [
    "enterprise-name",
    "enterprise-email",
    "enterprise-company",
    "enterprise-team-size",
    "enterprise-needs",
  ]) {
    assert.match(dialog, new RegExp(`htmlFor="${id}"`));
    assert.match(dialog, new RegExp(`id="${id}"`));
  }
  assert.match(dialog, /Nothing is sent until you review/);
  assert.match(dialog, /Nothing has been sent by KovaGPT/);
  assert.match(dialog, /grid-cols-1.*sm:grid-cols-2/);
  assert.doesNotMatch(submit, /onOpenChange\(false\)/);
});
