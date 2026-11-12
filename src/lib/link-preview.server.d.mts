export type LinkPreview = {
  url: string;
  title: string;
  siteName: string;
  iconUrl: string | null;
};
export function resolveLinkPreview(raw: string, signal?: AbortSignal): Promise<LinkPreview | null>;
