/**
 * A source emitter is not a passed end-to-end test.
 * Only successful Playwright results from real-trigger browser scenarios on
 * both supported viewport projects may certify an event here.
 */
export const NOTIFICATION_ACCEPTANCE_PROJECTS = Object.freeze([
  "desktop-1440x900",
  "phone-390x844",
]);

// These specs drive actual browser controls or browser state. The fixture-only
// renderer spec intentionally cannot qualify a source-triggered event.
const ACCEPTANCE_FILES = new Set([
  "notification-real-triggers.spec.ts",
  "recovery-crud.spec.ts",
  "composer-requested-layout.spec.ts",
  "core-app-review.spec.ts",
]);

export function verifiedEndToEndIds(
  report,
  catalogIds,
  requiredProjects = NOTIFICATION_ACCEPTANCE_PROJECTS,
) {
  const validIds = new Set(catalogIds);
  const required = new Set(requiredProjects);
  const cases = new Map();
  const visit = (suites) => {
    for (const suite of Array.isArray(suites) ? suites : []) {
      for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
        const file = String(spec.file ?? suite.file ?? "").replaceAll("\\", "/");
        if (!ACCEPTANCE_FILES.has(file.split("/").at(-1))) continue;
        const title = String(spec.title ?? "");
        const ids = [...title.matchAll(/\[notice:([a-z0-9_]+)\]/g)]
          .map((match) => match[1])
          .filter((id) => validIds.has(id));
        if (!ids.length) continue;
        const key = JSON.stringify([file, spec.line, spec.column, title]);
        if (!cases.has(key)) cases.set(key, { ids, projects: new Map() });
        const { projects } = cases.get(key);
        for (const run of Array.isArray(spec.tests) ? spec.tests : []) {
          if (!required.has(run.projectName)) continue;
          const results = Array.isArray(run.results) ? run.results : [];
          const passed = run.status === "expected" && results.at(-1)?.status === "passed";
          projects.set(run.projectName, projects.get(run.projectName) !== false && passed);
        }
      }
      visit(suite.suites);
    }
  };
  visit(report?.suites);
  const passedIds = new Set();
  const incompleteIds = new Set();
  for (const { ids, projects } of cases.values()) {
    const complete = required.size > 0 && [...required].every((project) => projects.get(project));
    for (const id of ids) (complete ? passedIds : incompleteIds).add(id);
  }
  return new Set([...passedIds].filter((id) => !incompleteIds.has(id)));
}
