import { createHash } from "node:crypto";

export const PUBLIC_ORIGIN = "https://kovagpt.com";
export const REQUIRED_EVIDENCE = Object.freeze([
  "render",
  "responsive",
  "accessibility",
  "editorial",
]);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const placeholder =
  /\b(?:TODO|FIXME|lorem ipsum|insert (?:title|description)|replace this (?:copy|text))\b/iu;
const utc = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

export function recordFingerprint(record, dependencyFingerprint) {
  return sha256(JSON.stringify({ record, dependencyFingerprint }));
}

export function normalizedPath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s?#]/u.test(value)
  )
    return null;
  const url = new URL(value, PUBLIC_ORIGIN);
  if (url.origin !== PUBLIC_ORIGIN || url.pathname !== value) return null;
  return value === "/" ? "/" : value.replace(/\/+$/u, "");
}

function actionError(action, routes) {
  if (!action || !text(action.label) || !text(action.to)) return "missing-label-or-destination";
  if (action.to.startsWith("/")) {
    const path = normalizedPath(action.to.split(/[?#]/u)[0]);
    if (!path || path.startsWith("/api/") || !routes.has(path))
      return "unknown-internal-destination";
    return null;
  }
  // Remote and mail actions need a separately reviewed link declaration. A
  // javascript/data URL, bare hash, or protocol-relative URL is never allowed.
  if (action.external === true && /^https:\/\//u.test(action.to)) {
    try {
      const url = new URL(action.to);
      return url.username || url.password ? "embedded-credentials" : null;
    } catch {
      return "invalid-url";
    }
  }
  return "unapproved-destination";
}

export function validateRecord(record, { routes, capabilityById = new Map() }) {
  const errors = [];
  if (!object(record)) return ["record-missing"];
  if (!normalizedPath(record.path)) errors.push("invalid-path");
  if (!["landing", "detail"].includes(record.template)) errors.push("unknown-template");
  if (!routes.has(record.path)) errors.push("missing-route-implementation");
  for (const key of ["title", "description", "summary", "eyebrow"]) {
    if (!text(record[key])) errors.push(`missing-${key}`);
  }
  if (text(record.description) && record.description.trim().length < 30)
    errors.push("description-too-short");
  const content = JSON.stringify([
    record.title,
    record.description,
    record.summary,
    record.sections,
    record.faq,
  ]);
  if (placeholder.test(content)) errors.push("placeholder-content");
  if (!Array.isArray(record.sections) || record.sections.length < 2)
    errors.push("missing-content-sections");
  else
    for (const [index, section] of record.sections.entries()) {
      if (!object(section)) {
        errors.push(`incomplete-section:${index}`);
        continue;
      }
      if (!text(section.title) || !text(section.body)) errors.push(`incomplete-section:${index}`);
      if (
        section.points !== undefined &&
        (!Array.isArray(section.points) || section.points.some((point) => !text(point)))
      )
        errors.push(`invalid-points:${index}`);
    }
  if (record.template === "detail") {
    if (
      !Array.isArray(record.highlights) ||
      record.highlights.length === 0 ||
      record.highlights.some((value) => !text(value))
    )
      errors.push("missing-highlights");
  }
  if (record.template === "detail" || record.primaryAction !== undefined) {
    const error = actionError(record.primaryAction, routes);
    if (error) errors.push(`primary-action:${error}`);
  }
  if (record.secondaryAction) {
    const error = actionError(record.secondaryAction, routes);
    if (error) errors.push(`secondary-action:${error}`);
  }
  for (const key of ["relatedPages", "faq", "capabilityClaims"]) {
    if (record[key] !== undefined && !Array.isArray(record[key])) errors.push(`invalid-${key}`);
  }
  for (const [index, item] of list(record.relatedPages).entries()) {
    const error = actionError({ label: item?.title, to: item?.to }, routes);
    if (error) errors.push(`related-link:${index}:${error}`);
  }
  for (const [index, item] of list(record.faq).entries()) {
    if (!text(item?.q) || !text(item?.a)) errors.push(`incomplete-faq:${index}`);
  }
  for (const claim of list(record.capabilityClaims)) {
    if (!object(claim) || !text(claim.id)) {
      errors.push("malformed-capability-claim");
      continue;
    }
    const entry = capabilityById.get(claim.id);
    if (!entry) errors.push(`unknown-capability:${claim.id}`);
    else if (!["limitation", "conditional", "live"].includes(claim.kind))
      errors.push(`invalid-claim:${claim.id}`);
    else if (
      claim.kind === "live" &&
      (!entry.productionVerified || entry.publicStatus !== "live-verified")
    )
      errors.push(`unverified-live-claim:${claim.id}`);
    else if (
      claim.kind === "conditional" &&
      !["source-implemented", "limited", "configuration-dependent", "live-verified"].includes(
        entry.publicStatus,
      )
    )
      errors.push(`blocked-capability-claim:${claim.id}`);
  }
  return errors;
}

export function validateRenderedFacts(facts, expected) {
  if (!object(facts)) return ["render-facts-missing"];
  const errors = [];
  if (facts.status !== 200) errors.push("http-not-200");
  if (facts.mainCount !== 1 || facts.h1Count !== 1 || !text(facts.h1))
    errors.push("invalid-main-or-h1");
  if (!text(facts.title) || !text(facts.description)) errors.push("missing-rendered-metadata");
  if (facts.canonicalCount !== 1 || facts.canonical !== `${PUBLIC_ORIGIN}${expected.path}`)
    errors.push("incorrect-canonical");
  if (facts.navigation !== true || facts.footer !== true)
    errors.push("missing-navigation-or-footer");
  if (facts.h1 !== expected.title) errors.push("heading-content-mismatch");
  if (facts.description !== expected.description) errors.push("metadata-content-mismatch");
  if (!Array.isArray(facts.brokenLinks) || facts.brokenLinks.length)
    errors.push("broken-or-unchecked-links");
  if (!Array.isArray(facts.brokenImages) || facts.brokenImages.length)
    errors.push("broken-or-unchecked-images");
  if (!Array.isArray(facts.runtimeErrors) || facts.runtimeErrors.length)
    errors.push("runtime-errors-unchecked-or-present");
  if (!Number.isFinite(facts.overflowPx) || facts.overflowPx > 1)
    errors.push("horizontal-overflow");
  if (
    facts.structuredDataChecked !== true ||
    !Array.isArray(facts.structuredDataErrors) ||
    facts.structuredDataErrors.length
  )
    errors.push("structured-data-unchecked-or-invalid");
  return errors;
}

export function validateEvidence(evidence, fingerprint, now = Date.now(), maxAgeDays = 14) {
  const failures = [];
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0)
    return ["invalid-evidence-clock"];
  for (const kind of REQUIRED_EVIDENCE) {
    const item = evidence?.[kind];
    if (
      !item ||
      item.status !== "pass" ||
      item.fingerprint !== fingerprint ||
      !text(item.reference) ||
      !utc(item.checkedAt)
    ) {
      failures.push(`missing-or-stale-${kind}-evidence`);
      continue;
    }
    const age = now - Date.parse(item.checkedAt);
    if (age < 0 || age > maxAgeDays * 86_400_000) failures.push(`expired-${kind}-evidence`);
    if (kind === "editorial" && (!text(item.reviewer) || item.capabilityClaimsReviewed !== true))
      failures.push("editorial-claims-not-reviewed");
    if (kind === "responsive") {
      const requiredWidths = [320, 390, 768, 1024, 1280, 1440, 1728];
      if (list(item.cases).some((row) => !object(row) || row.status !== "pass"))
        failures.push("failed-or-malformed-responsive-evidence");
      const cases = new Set(
        list(item.cases)
          .filter((row) => row?.status === "pass")
          .map((row) => `${row.width}:${row.theme}:${row.textScale}`),
      );
      for (const width of requiredWidths)
        for (const theme of ["light", "dark"])
          for (const scale of [1, 2]) {
            if (!cases.has(`${width}:${theme}:${scale}`))
              failures.push(`responsive-case-missing:${width}:${theme}:${scale}`);
          }
    }
    if (
      kind === "accessibility" &&
      !["keyboard", "focus", "semantics", "contrast", "reduced-motion"].every(
        (name) => item.checks?.[name] === "pass",
      )
    )
      failures.push("incomplete-accessibility-evidence");
  }
  return failures;
}

export function auditCatalog({
  records,
  reviewPaths,
  sitemapPaths,
  routes,
  capabilityById,
  dependencyFingerprint,
  evidence = {},
  now,
}) {
  if (!Array.isArray(records) || records.some((record) => !object(record)))
    throw new Error("Malformed content record collection");
  if (
    !Array.isArray(reviewPaths) ||
    !reviewPaths.length ||
    reviewPaths.some((path) => !normalizedPath(path))
  )
    throw new Error("Empty or malformed route inventory");
  if (!object(evidence)) throw new Error("Publication evidence must be a route-keyed object");
  const groups = new Map();
  for (const record of records) {
    const group = groups.get(record.path) ?? [];
    group.push(record);
    groups.set(record.path, group);
  }
  const summaries = new Map();
  for (const record of records) {
    const signature = sha256(JSON.stringify([record.summary, record.sections]));
    const group = summaries.get(signature) ?? new Set();
    group.add(record.path);
    summaries.set(signature, group);
  }
  const results = [...new Set(reviewPaths)].sort().map((path) => {
    const group = groups.get(path) ?? [];
    const record = group[0];
    const fingerprint = record ? recordFingerprint(record, dependencyFingerprint) : null;
    const errors = record
      ? validateRecord(record, { routes, capabilityById })
      : ["no-content-adapter"];
    if (group.length > 1) errors.push("ambiguous-content-records");
    if (record && summaries.get(sha256(JSON.stringify([record.summary, record.sections]))).size > 1)
      errors.push("duplicate-page-content");
    if (/^\/codex(?:\/|$)/u.test(path)) errors.push("excluded-product-surface");
    if (record?.indexable === true && !sitemapPaths.includes(path))
      errors.push("missing-sitemap-entry");
    if (record?.review) errors.push(`${record.review}-approval-required`);
    const evidenceErrors = record
      ? validateEvidence(evidence[path], fingerprint, now)
      : ["publication-evidence-missing"];
    if (record && evidence[path]?.render?.facts)
      errors.push(...validateRenderedFacts(evidence[path].render.facts, { ...record, path }));
    else evidenceErrors.push("render-observations-missing");
    return {
      path,
      title: record?.title ?? null,
      source: record?.source ?? null,
      fingerprint,
      indexable: sitemapPaths.includes(path),
      sourceContractPassed: errors.length === 0,
      publishReady: errors.length === 0 && evidenceErrors.length === 0,
      errors,
      evidenceErrors,
    };
  });
  return {
    schemaVersion: 1,
    scope:
      "Current Kova source inventory, not the external OpenAI/ChatGPT discovery inventory. Unknown adapters and absent evidence are blockers, never passes.",
    dependencyFingerprint,
    counts: {
      routes: results.length,
      contentRecords: records.length,
      adapted: results.filter((r) => r.source).length,
      sourceContractPassed: results.filter((r) => r.sourceContractPassed).length,
      publishReady: results.filter((r) => r.publishReady).length,
      blocked: results.filter((r) => !r.publishReady).length,
    },
    unservedContentRecords: records
      .filter((record) => !reviewPaths.includes(record.path))
      .map((record) => record.path)
      .sort(),
    results,
  };
}
