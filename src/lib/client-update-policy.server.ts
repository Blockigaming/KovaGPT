import { runtimeEnv } from "@/lib/runtime-env.server";

const FULL_BUILD_SHA = /^[a-f0-9]{40}$/;

export function requiresClientUpdate(
  clientSha: string | null,
  servingSha: string,
  retiredBuilds = runtimeEnv("KOVA_RETIRED_CLIENT_BUILDS"),
): boolean {
  if (!clientSha || !FULL_BUILD_SHA.test(clientSha) || !FULL_BUILD_SHA.test(servingSha))
    return false;
  // A rolled-back revision must never ask clients on its own build to reload.
  return (
    clientSha !== servingSha &&
    (retiredBuilds?.split(",").some((build) => build.trim() === clientSha) ?? false)
  );
}
