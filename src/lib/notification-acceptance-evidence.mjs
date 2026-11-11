/**
 * A source emitter is not a passed end-to-end test.
 * Only successful Playwright results from real-trigger browser scenarios on
 * both supported viewport projects may certify an event here.
 */
export const NOTIFICATION_ACCEPTANCE_PROJECTS = Object.freeze([
  "desktop-1440x900",
  "phone-390x844",
]);

export function verifiedEndToEndIds(
  report,
  catalogIds,
  requiredProjects = NOTIFICATION_ACCEPTANCE_PROJECTS,
) {
  const validIds = new Set(catalogIds);
  const passedById = new Map();
  const visit = (suites) => {
    for (const suite of Array.isArray(suites) ? suites : []) {
      for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
        const file = String(spec.file ?? suite.file ?? "").replaceAll("\\", "/");
        if (file.split("/").at(-1) !== "notification-real-triggers.spec.ts") continue;
        const ids = [...String(spec.title ?? "").matchAll(/\[notice:([a-z0-9_]+)\]/g)]
          .map((match) => match[1])
          .filter((id) => validIds.has(id));
        if (!ids.length) continue;
        for (const run of Array.isArray(spec.tests) ? spec.tests : []) {
          const results = Array.isArray(run.results) ? run.results : [];
          if (run.status !== "expected" || results.at(-1)?.status !== "passed") continue;
          if (!requiredProjects.includes(run.projectName)) continue;
          for (const id of ids) {
            if (!passedById.has(id)) passedById.set(id, new Set());
            passedById.get(id).add(run.projectName);
          }
        }
      }
      visit(suite.suites);
    }
  };
  visit(report?.suites);
  return new Set(
    [...passedById]
      .filter(([, projects]) => requiredProjects.every((project) => projects.has(project)))
      .map(([id]) => id),
  );
}
