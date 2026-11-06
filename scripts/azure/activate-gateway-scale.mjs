/** The live gateway activation profile; frozen migration Bicep is not a live-app template. */
export function withAlwaysOnGatewayScale(observed) {
  const scale = observed?.scale;
  if (
    !Array.isArray(observed?.containers) ||
    observed.containers.length !== 1 ||
    observed.containers[0]?.name !== "web" ||
    !scale ||
    !Number.isSafeInteger(scale.minReplicas) ||
    !Number.isSafeInteger(scale.maxReplicas) ||
    scale.minReplicas < 0 ||
    scale.minReplicas > scale.maxReplicas ||
    scale.maxReplicas < 1 ||
    scale.maxReplicas > 4 ||
    !Array.isArray(scale.rules) ||
    scale.rules.filter((rule) => rule?.http).length > 1
  )
    throw new Error("live_gateway_scale_requires_review");

  const template = structuredClone(observed);
  template.scale.minReplicas = Math.max(1, scale.minReplicas);
  template.scale.maxReplicas = 4;
  const http = template.scale.rules.find((rule) => rule.http);
  if (http) {
    http.http.metadata = { ...http.http.metadata, concurrentRequests: "20" };
  } else {
    if (template.scale.rules.some((rule) => rule.name === "http-requests"))
      throw new Error("live_gateway_scale_requires_review");
    template.scale.rules.push({
      name: "http-requests",
      http: { metadata: { concurrentRequests: "20" } },
    });
  }
  return template;
}
