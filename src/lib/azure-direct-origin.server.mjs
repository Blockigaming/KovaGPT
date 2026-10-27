// Explicit direct Azure ingress configuration. This never reads request headers.
// The optional production custom domain replaces, rather than expands, the one authority.
export function parseAzureDirectPublicOrigin(environment) {
  const appName = environment.CONTAINER_APP_NAME;
  const value = environment.KOVA_AZURE_PUBLIC_ORIGIN;
  if (
    typeof appName !== "string" ||
    !/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/u.test(appName) ||
    typeof value !== "string"
  )
    return null;
  try {
    const origin = new URL(value);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== value ||
      origin.username ||
      origin.password ||
      origin.port ||
      !origin.hostname.startsWith(`${appName}.`) ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.azurecontainerapps\.io$/u.test(
        origin.hostname.slice(appName.length + 1),
      )
    )
      return null;
    const customOrigin = environment.KOVA_AZURE_CUSTOM_PUBLIC_ORIGIN;
    if (customOrigin === undefined) return origin.origin;
    if (appName !== "kovagpt-prod-web" || customOrigin !== "https://kovagpt.com") return null;
    return customOrigin;
  } catch {
    return null;
  }
}
