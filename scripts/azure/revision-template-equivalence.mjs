import { isDeepStrictEqual } from "node:util";

export const TEMPLATE_COMPARISON_POLICY = "azure-containerapps-2025-01-01";
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const unset = (v) => v === null || v === undefined;
const emptySuffix = (v) => unset(v) || v === "";
const require = (ok) => {
  if (!ok) throw new Error("revision_preservation_template_evidence_invalid");
};

// Comparison only: never rewrite either capture or a deployment document.
// Rules are limited to the pinned Microsoft.App 2025-01-01 response contract.
// This establishes effective *writable template* equality, not live health,
// secret contents/versions, origin behavior, provenance or release acceptance.
export function compareRevisionTemplates({ baseline, previousRevision, apiVersion }) {
  require(apiVersion === "2025-01-01");
  const name = baseline?.name;
  const revision = previousRevision?.name;
  require(typeof name === "string" && /^[a-z][a-z0-9-]+$/u.test(name));
  require(typeof revision === "string" && revision.startsWith(`${name}--`));
  const suffix = revision.slice(name.length + 2);
  require(/^[a-z][a-z0-9-]{0,62}$/u.test(suffix) && !suffix.endsWith("-"));
  require(
    typeof baseline.id === "string" &&
      previousRevision.id?.toLowerCase() === `${baseline.id}/revisions/${revision}`.toLowerCase() &&
      baseline.properties?.latestReadyRevisionName === revision,
  );
  const a = structuredClone(baseline.properties.template);
  const b = structuredClone(previousRevision.properties?.template);
  require(object(a) && object(b));
  const normalizedPaths = [];
  const normalize = (left, right, key, path, value) => {
    if (
      !isDeepStrictEqual(left[key], right[key]) ||
      Object.hasOwn(left, key) !== Object.hasOwn(right, key)
    ) {
      left[key] = value;
      right[key] = value;
      normalizedPaths.push(path);
    }
  };

  // Empty optional naming hints do not replace the already-bound revision ID.
  // Never ignore a nonempty suffix that names a different revision.
  for (const t of [a, b]) require(emptySuffix(t.revisionSuffix) || t.revisionSuffix === suffix);
  if (emptySuffix(a.revisionSuffix) && emptySuffix(b.revisionSuffix))
    normalize(a, b, "revisionSuffix", "properties.template.revisionSuffix", null);

  for (const kind of ["containers", "initContainers"]) {
    if (!Array.isArray(a[kind]) || !Array.isArray(b[kind])) continue;
    for (let i = 0; i < Math.min(a[kind].length, b[kind].length); i += 1) {
      const left = a[kind][i];
      const right = b[kind][i];
      require(object(left) && object(right));
      if (left.name !== right.name) continue;
      const prefix = `properties.template.${kind}[${i}]`;
      if (object(left.resources) && object(right.resources)) {
        const l = left.resources.ephemeralStorage;
        const r = right.resources.ephemeralStorage;
        // Response-only capacity may be absent from a revision GET. Two
        // conflicting observed capacities are NOT accepted as equivalent.
        if (
          (l === undefined && typeof r === "string") ||
          (r === undefined && typeof l === "string")
        )
          normalize(
            left.resources,
            right.resources,
            "ephemeralStorage",
            `${prefix}.resources.ephemeralStorage`,
            null,
          );
      }
      if (!Array.isArray(left.env) || !Array.isArray(right.env)) continue;
      for (const container of [left, right])
        require(new Set(container.env.map((e) => e?.name)).size === container.env.length);
      for (let j = 0; j < Math.min(left.env.length, right.env.length); j += 1) {
        const l = left.env[j];
        const r = right.env[j];
        require(object(l) && object(r));
        if (
          l.name === r.name &&
          typeof l.secretRef === "string" &&
          /^[a-z0-9-]+$/u.test(l.secretRef) &&
          l.secretRef === r.secretRef &&
          ["", undefined].includes(l.value) &&
          ["", undefined].includes(r.value)
        )
          normalize(l, r, "value", `${prefix}.env[${j}].value`, "");
      }
    }
  }
  if (object(a.scale) && object(b.scale)) {
    for (const [key, value] of [
      ["cooldownPeriod", 300],
      ["pollingInterval", 30],
    ]) {
      if (
        (unset(a.scale[key]) || a.scale[key] === value) &&
        (unset(b.scale[key]) || b.scale[key] === value)
      )
        normalize(a.scale, b.scale, key, `properties.template.scale.${key}`, value);
    }
  }
  return {
    result: isDeepStrictEqual(a, b) ? "PASS" : "FAIL",
    policy: TEMPLATE_COMPARISON_POLICY,
    normalizedPaths,
    rawCapturesModified: false,
    effectiveWritableTemplateOnly: true,
    liveAcceptanceEstablished: false,
  };
}
