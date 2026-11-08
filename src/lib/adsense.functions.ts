import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { runtimeEnv } from "@/lib/runtime-env.server";

// Enable only after AdSense site approval and the certified CMP are configured.
export const getAdSenseConfiguration = createServerFn({ method: "GET" }).handler(() => {
  setResponseHeader("Cache-Control", "private, no-store");
  return { enabled: runtimeEnv("KOVA_ADSENSE_ENABLED") === "true" };
});
