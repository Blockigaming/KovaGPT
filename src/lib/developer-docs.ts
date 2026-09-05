export const DEVELOPER_DOCS = [
  [
    "quickstart",
    "API quickstart",
    "Understand the authenticated application request boundary before building against KovaGPT.",
  ],
  [
    "authentication",
    "Authentication",
    "Versioned API routes require a scoped developer key. Console routes use your verified signed-in session.",
  ],
  [
    "api-reference",
    "API reference",
    "Use the versioned quote, model, Responses, image, and embedding endpoints described here.",
  ],
  [
    "models",
    "Models",
    "Use capability names from the server catalog rather than assuming an upstream model is available.",
  ],
  [
    "pricing",
    "API pricing",
    "Authoritative quotes require approved upstream pricing and preserve the configured minimum gross margin.",
  ],
  [
    "usage-billing",
    "Usage and billing",
    "Track accepted quotes, reservations, settlements, and retryable uncertain outcomes.",
  ],
  [
    "api-keys",
    "API keys",
    "Create, rotate, scope, and revoke credentials without placing them in source control.",
  ],
  [
    "rate-limits",
    "Rate limits",
    "Handle 429 responses, Retry-After, bounded concurrency, and account-level budgets.",
  ],
  [
    "errors",
    "Errors",
    "Use stable error codes while keeping provider secrets and internal details out of responses.",
  ],
  [
    "streaming",
    "Streaming",
    "Consume incremental events, support abort, and retain partial output only when your product permits it.",
  ],
  [
    "tool-calling",
    "Tool calling",
    "Declare allowed tools server-side and confirm consequential external actions.",
  ],
  [
    "image-generation",
    "Image generation",
    "Generate images through authenticated, quota-enforced server routes.",
  ],
  [
    "files",
    "Files",
    "Validate type, size, ownership, and extraction state before using uploaded files.",
  ],
  [
    "safety",
    "Developer safety",
    "Layer input validation, authorization, moderation, output review, and incident response.",
  ],
  [
    "sdks",
    "SDKs",
    "No KovaGPT SDK is represented as officially supported until it is published and versioned.",
  ],
  [
    "examples",
    "Examples",
    "Use minimal patterns that keep credentials on the server and failures recoverable.",
  ],
  [
    "migration-guides",
    "Migration guides",
    "Adopt versioned interfaces and test billing, streaming, and error semantics before cutover.",
  ],
  [
    "changelog",
    "Developer changelog",
    "Review documented developer-facing changes before updating a production integration.",
  ],
  [
    "status",
    "API status",
    "Check current operational status without treating historical availability as a guarantee.",
  ],
] as const;
export const DEVELOPER_DOC_BY_SLUG: ReadonlyMap<
  string,
  { slug: string; title: string; description: string }
> = new Map(
  DEVELOPER_DOCS.map(([slug, title, description]) => [slug, { slug, title, description }]),
);

/** Topics retained for transparent planning, but excluded from search until the described
 * public product exists and its contract is versioned. */
export const NON_INDEXABLE_DEVELOPER_DOCS = new Set(DEVELOPER_DOCS.map(([slug]) => slug));
