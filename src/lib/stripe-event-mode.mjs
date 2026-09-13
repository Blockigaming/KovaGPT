export function stripeEventMatchesEnvironment(livemode, environment) {
  if (environment !== "sandbox" && environment !== "live") return false;
  return typeof livemode === "boolean" && livemode === (environment === "live");
}
