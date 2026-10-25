import { resolveBackendUrl } from "@/lib/backend-url";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { consumeOpenAiAdmission } from "./openai-admission.server.mjs";

export function consumeOpenAiApplicationAdmission(input: {
  identity: string;
  action: string;
  limit: number;
  windowSeconds: number;
}) {
  return consumeOpenAiAdmission({
    ...input,
    backendUrl: resolveBackendUrl(),
    serviceRoleKey: runtimeEnv("SUPABASE_SERVICE_ROLE_KEY"),
    hashSecret: runtimeEnv("KOVA_IP_HASH_SECRET"),
  });
}
