import {
  createWorkHostPower,
  parseWorkHostPowerConfiguration,
} from "../src/lib/work-host-power.mjs";

// System-assigned VM identity; only the fixed Azure IMDS audience is requested.
// The token is never persisted, printed, or sent to the app or a sandbox.
export function configuredHostPower(env, fetcher = fetch) {
  const configuration = parseWorkHostPowerConfiguration((key) => env[key]);
  if (!configuration) return null;
  return createWorkHostPower({
    ...configuration,
    fetcher,
    getToken: async () => {
      const response = await fetcher(
        "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmanagement.azure.com%2F",
        { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Metadata: "true" } },
      );
      if (!response.ok || response.redirected) throw new Error("work_host_identity_unavailable");
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 16384) throw new Error("work_host_identity_unavailable");
      const value = JSON.parse(raw);
      if (typeof value.access_token !== "string" || !value.access_token)
        throw new Error("work_host_identity_unavailable");
      return value.access_token;
    },
  });
}
