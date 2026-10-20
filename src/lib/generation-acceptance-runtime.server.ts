import {
  createGenerationAcceptanceGuard,
  type AcceptanceConfig,
} from "./generation-acceptance.server.mjs";
import { consumeApplicationRateLimit } from "./distributed-rate-limit.server";
import { runtimeEnv } from "./runtime-env.server";
import { BUILD_IDENTITY } from "./build-identity";

function configuration(): AcceptanceConfig {
  const enabled = runtimeEnv("KOVA_GENERATION_ACCEPTANCE_ENABLED");
  if (!enabled || enabled === "false") return { enabled: false };
  try {
    if (enabled !== "true") throw new Error();
    const plan = JSON.parse(runtimeEnv("KOVA_GENERATION_ACCEPTANCE_PLAN") ?? "");
    const approvalReceipt = JSON.parse(runtimeEnv("KOVA_GENERATION_ACCEPTANCE_APPROVAL") ?? "");
    if (
      runtimeEnv("AZURE_ENVIRONMENT") !== "staging" ||
      runtimeEnv("KOVA_DEPLOYMENT_TARGET") !== "ca-kovagpt-staging" ||
      plan.target.commit !== BUILD_IDENTITY.sha ||
      plan.target.tree !== runtimeEnv("KOVA_SOURCE_TREE") ||
      plan.target.imageDigest !== runtimeEnv("KOVA_IMAGE_DIGEST") ||
      plan.target.revision !== runtimeEnv("CONTAINER_APP_REVISION")
    )
      throw new Error();
    return {
      enabled: true,
      plan,
      approvalReceipt,
      expectedPlanSha256: runtimeEnv("KOVA_GENERATION_ACCEPTANCE_PLAN_SHA256") ?? "",
      expectedApprovalReceiptSha256: runtimeEnv("KOVA_GENERATION_ACCEPTANCE_APPROVAL_SHA256") ?? "",
    };
  } catch {
    throw new Error("generation_acceptance_denied");
  }
}

const makeGuard = () =>
  createGenerationAcceptanceGuard({
    getConfig: configuration,
    claim: consumeApplicationRateLimit,
  });
const KEY = Symbol.for("kovagpt.generation-acceptance-guard.v1");
const shared = globalThis as typeof globalThis & { [KEY]?: ReturnType<typeof makeGuard> };
// Vite may put request routes and provider code in separate server chunks.
// Reuse one context store, as the existing runtime-binding module does.
export const generationAcceptance = shared[KEY] ?? (shared[KEY] = makeGuard());
