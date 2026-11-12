import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (path) => readFileSync(path, "utf8");

test("Finances has no Kova tier restriction while retaining authenticated provider flows", () => {
  for (const file of ["link-token", "exchange", "manage"]) {
    const source = src("src/routes/api/finances/" + file + ".ts");
    assert.match(source, /requireUser\(request\)/);
    assert.doesNotMatch(source, /getCallerTier|finance_plan_required/);
  }
  assert.match(src("src/routes/api/finances/manage.ts"), /planEligible: true/);
  assert.match(src("src/routes/api/finances/exchange.ts"), /exchangeFinanceToken\(auth,/);
});

test("Gmail requires a server-verified paid plan, not only a disabled UI button", () => {
  assert.match(
    src("src/routes/api/google/auth.ts"),
    /connector === "gmail" && \(await getCallerTier\(auth\)\) === "free"/,
  );
  assert.match(src("src/routes/api/google/gmail.ts"), /\(await getCallerTier\(auth\)\) === "free"/);
  const tools = src("src/lib/google-tools.server.ts");
  assert.match(tools, /resolveEffectiveBillingTier/);
  assert.match(tools, /paid \|\| !tool.function.name.startsWith\("gmail_"\)/);
  assert.match(tools, /tool.startsWith\("gmail_"\)/);
  assert.match(tools, /pendingRow.tool.startsWith\("gmail_"\)/);
  assert.match(src("src/routes/apps.tsx"), /visibleSelectedApp.id === "gmail"/);
});

test("Removed Project Templates are not mounted or reachable from the Projects page", () => {
  const projects = src("src/routes/projects.tsx");
  assert.doesNotMatch(projects, /ProjectTemplatesDialog|kova-project-templates|templatesOpen/);
  assert.match(projects, /kova-project-create-dialog/);
});

test("Task access retains verified-user admission and retries transient failures", () => {
  assert.match(src("src/lib/scheduled-tasks.functions.ts"), /scheduled_task_account_available/);
  const page = src("src/routes/scheduled-tasks.tsx");
  assert.match(page, /attempt < 3 && isCurrent\(\)/);
  assert.match(page, /setAccessState\(result.eligible \? "eligible" : "error"\)/);
});

test("Public developer API content shows a forthcoming status without claiming a launch", () => {
  const catalog = src("src/lib/public-website-catalog.mjs");
  assert.match(catalog, /availability: "Coming later this year"/);
  assert.match(catalog, /Preview documentation/);
});
