#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  DEFAULT_MODELS,
  MODEL_COST_PER_MTOK,
  MODEL_ROLES,
  ROLE_ENV_KEYS,
  resolveRoleModel,
} from "../../src/lib/ai/model-config.mjs";
import { print, result } from "./lib.mjs";

const source = readFileSync("src/lib/ai/model-catalog.server.ts", "utf8");
const catalogIds = new Set(
  [...source.matchAll(/\bid:\s*"([a-z0-9._-]+)"/giu)].map((match) => match[1]),
);
const checks = [];
for (const role of MODEL_ROLES) {
  const resolved = resolveRoleModel(role, process.env);
  if (["IMAGE_GENERATION", "EMBEDDING"].includes(role)) continue;
  checks.push({
    status: catalogIds.has(resolved.modelId) ? "PASS" : "BLOCKER",
    code: "configured_model_registered",
    role,
    modelId: resolved.modelId,
    source: resolved.source,
  });
  checks.push({
    status: MODEL_COST_PER_MTOK[resolved.modelId] ? "PASS" : "BLOCKER",
    code: "billing_dimension_registered",
    role,
    modelId: resolved.modelId,
  });
}
checks.push({
  status:
    DEFAULT_MODELS.PREMIUM_REASONING === "gpt-5.6-sol" && catalogIds.has("gpt-5.6-sol")
      ? "PASS"
      : "BLOCKER",
  code: "sol_catalog_contract",
});
checks.push({
  status: ROLE_ENV_KEYS.PREMIUM_REASONING === "KOVA_MODEL_PREMIUM_REASONING" ? "PASS" : "BLOCKER",
  code: "sol_provider_override",
});
print(
  result("model-catalog", checks, {
    liveAvailability: "NOT EXECUTED — PROVIDER CREDENTIAL REQUIRED",
    failClosedAtRuntime: /unsupported_ai_model/u.test(source),
  }),
);
