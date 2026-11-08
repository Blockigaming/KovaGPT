import { createServerFn } from "@tanstack/react-start";
import { runtimeEnv } from "@/lib/runtime-env.server";

// Enable only after AdSense site approval and the certified CMP are configured.
export const getAdSenseConfiguration = createServerFn({ method: "GET" }).handler(() => ({
  enabled: runtimeEnv("KOVA_ADSENSE_ENABLED") === "true",
}));
