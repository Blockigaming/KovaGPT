import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContentLoader } from "./source-loader.mjs";

const sourceStatus = {
  available: "source-implemented",
  limited: "limited",
  "provider-dependent": "configuration-dependent",
  unavailable: "unavailable",
  excluded: "excluded",
};

// Product-scope decisions, not runtime feature switches. None grants access,
// changes plans, enables a provider, or asserts production verification.
export const PUBLIC_SCOPE = Object.freeze({
  deepResearch: {
    status: "excluded",
    reason: "Intentionally retired from the public product scope; ordinary web search is separate.",
  },
  codex: { status: "excluded", reason: "Kova has no approved Codex-equivalent product." },
  health: {
    status: "unavailable",
    reason: "No connected-health capability has verified public release evidence in this audit.",
  },
  finances: {
    status: "unavailable",
    reason: "No connected-finances capability has verified public release evidence in this audit.",
  },
});

export function publicClaimDecision(entry, claim) {
  if (!entry || !["describe", "use-now"].includes(claim)) return false;
  if (claim === "describe") return true; // Limitations may always be described accurately.
  // A code registry, screenshot, plan, or successful build is not live evidence.
  return entry.productionVerified === true && entry.publicStatus === "live-verified";
}

export function buildCapabilityTruth(root = process.cwd()) {
  const { load, sources } = createContentLoader(root);
  const registry = load("src/lib/capability-registry.ts").CAPABILITY_REGISTRY;
  const entries = Object.entries(registry.features).map(([id, item]) => {
    if (!(item.availability in sourceStatus)) throw new Error(`Unknown capability status: ${id}`);
    const scope = PUBLIC_SCOPE[id];
    return {
      id,
      label: item.label,
      sourceAvailability: item.availability,
      publicStatus: scope?.status ?? sourceStatus[item.availability],
      minimumTier: item.minimumTier ?? null,
      summary: scope?.reason ?? item.summary,
      sourceSummary: item.summary,
      limitation: item.limitation ?? null,
      productionVerified: false,
      deploymentEvidence: null,
      requires: [
        "Confirm the deployed source and account entitlement",
        "Verify the live runtime, provider, permissions and storage where applicable",
      ],
      evidence: ["src/lib/capability-registry.ts"],
    };
  });
  for (const [id, scope] of Object.entries(PUBLIC_SCOPE)) {
    if (!entries.some((entry) => entry.id === id)) {
      entries.push({
        id,
        label: id[0].toUpperCase() + id.slice(1),
        sourceAvailability: "not-in-published-registry",
        publicStatus: scope.status,
        minimumTier: null,
        summary: scope.reason,
        sourceSummary: null,
        limitation: null,
        productionVerified: false,
        deploymentEvidence: null,
        requires: ["Explicit approved release and runtime evidence"],
        evidence: ["src/lib/capability-registry.ts", "scripts/publication/capabilities.mjs"],
      });
    }
  }
  entries.push({
    id: "chat",
    label: "Chat",
    sourceAvailability: "provider-dependent",
    publicStatus: "configuration-dependent",
    minimumTier: "free",
    summary:
      "Chat needs a configured and permitted AI provider. A visible composer does not prove generation works in production.",
    sourceSummary: null,
    limitation: "Respect server-owned plan, policy and generation gates.",
    productionVerified: false,
    deploymentEvidence: null,
    requires: [
      "Configured AI provider",
      "Generation enabled through existing approved controls",
      "Authenticated/guest allowances and safety policy",
    ],
    evidence: ["src/routes/api/chat.ts", "src/lib/modes.ts"],
  });
  const gatePath = "src/lib/maps-release-gate.ts";
  const gateExists = existsSync(resolve(root, gatePath));
  // Read the exported boolean through the same content loader; never infer it
  // from comments, a PR title, or a regular-expression match.
  const mapsApproved = gateExists ? load(gatePath).MAPS_RELEASE_APPROVED === true : false;
  entries.push({
    id: "maps",
    label: "Maps",
    sourceAvailability: gateExists ? "release-controlled" : "not-approved-in-this-source-tree",
    publicStatus: mapsApproved ? "configuration-dependent" : "release-gated",
    minimumTier: null,
    summary: gateExists
      ? "The provider-backed Maps implementation remains subject to its explicit release approval, account policy and provider availability."
      : "This source tree has not established approval for provider-backed Maps. Do not equate the local-discovery page with released 3D Maps.",
    sourceSummary: null,
    limitation: "Do not enable or bypass the Maps approval gate.",
    productionVerified: false,
    deploymentEvidence: null,
    requires: [
      "Maps release approval",
      "Account and Lockdown checks",
      "Providers and required migrations",
      "Live acceptance evidence",
    ],
    evidence: ["src/routes/maps.tsx", ...(gateExists ? [gatePath] : [])],
  });
  for (const app of registry.workingApps) {
    entries.push({
      id: `app:${app.toLowerCase().replaceAll(" ", "-")}`,
      label: app,
      sourceAvailability: "listed-connector",
      publicStatus: "configuration-dependent",
      minimumTier: "free",
      summary: `${app} is listed as a supported connection; live connection and each action require configured credentials, granted scopes, account authorization and provider availability.`,
      sourceSummary: null,
      limitation: "A catalog listing is not evidence of granted access or a successful action.",
      productionVerified: false,
      deploymentEvidence: null,
      requires: [
        "Configured credentials",
        "User consent",
        "Correct scopes",
        "Per-action authorization",
        "Live verification",
      ],
      evidence: ["src/lib/capability-registry.ts"],
    });
  }
  const platformFile = "src/platform/capabilities.ts";
  // Keep the broader platform catalog visible as unverified declarations rather
  // than silently treating definitions or marketing routes as working features.
  const declarations = Array.from(load(platformFile).CAPABILITIES, (entry) => ({
    id: entry.id,
    label: entry.label,
    route: entry.route,
    permission: entry.permission,
    requiredPlan: entry.requiredPlan,
    providers: Array.from(entry.providers),
    flags: Array.from(entry.flags),
    dependencies: Array.from(entry.dependencies),
  }));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error("Duplicate capability ID");
  if (new Set(declarations.map((entry) => entry.id)).size !== declarations.length)
    throw new Error("Duplicate platform capability ID");
  for (const path of new Set([...entries.flatMap((entry) => entry.evidence), platformFile])) {
    if (!existsSync(resolve(root, path))) throw new Error(`Capability evidence missing: ${path}`);
    sources.set(
      path,
      createHash("sha256")
        .update(readFileSync(resolve(root, path)))
        .digest("hex"),
    );
  }
  const evidence = Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b)));
  return {
    schemaVersion: 1,
    scope: "Source-level publication policy. No live service was probed, modified, or certified.",
    sourceFingerprint: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    productionVerifiedCount: 0,
    capabilities: entries.sort((a, b) => a.id.localeCompare(b.id)),
    platformDeclarations: declarations.map((entry) => ({
      ...entry,
      status: "catalog-declaration-only",
      evidence: platformFile,
    })),
    plans: Object.values(registry.plans).map((plan) => ({
      tier: plan.tier,
      sourceMonthlyPriceUsd: plan.monthlyPriceUsd,
      sourceModeIds: Array.from(registry.modesByTier[plan.tier], (mode) => mode.id),
      liveCheckoutVerified: false,
    })),
    evidence,
  };
}
