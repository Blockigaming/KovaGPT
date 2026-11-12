export type LinkPreviewData = { url: string; title: string; site: string; faviconUrl: string };
export function isPublicPreviewIpv4(address: string): boolean;
export function safePreviewTarget(value: unknown): URL | null;
export function extractHtmlLinkPreview(html: string, page: URL): {title: string; faviconUrl: string} | null;
export function resolveLinkPreview(rawUrl: unknown): Promise<LinkPreviewData | null>;
