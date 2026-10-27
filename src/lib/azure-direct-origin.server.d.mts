/** Returns one canonical HTTPS origin after validating the configured Azure app FQDN.
 * An explicitly configured production custom origin replaces the app authority. */
export function parseAzureDirectPublicOrigin(
  environment: Record<string, string | undefined>,
): string | null;
