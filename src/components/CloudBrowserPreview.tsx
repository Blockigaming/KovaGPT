import { useCloudBrowserPreview } from "@/hooks/use-cloud-browser-preview";
import type { BrowserActivityMetadata } from "@/lib/browser-activity-contract.mjs";

export function CloudBrowserPreviewImage({ url, hostname }: { url: string; hostname?: string }) {
  return (
    <span className="kova-browser-live-preview">
      <img src={url} alt="Current cloud browser preview" />
      {hostname ? <small>{hostname}</small> : null}
    </span>
  );
}

export function CloudBrowserPreview({
  browser,
  ownerId,
}: {
  browser: BrowserActivityMetadata;
  ownerId: string;
}) {
  const url = useCloudBrowserPreview(browser, ownerId);
  return url ? <CloudBrowserPreviewImage url={url} hostname={browser.hostname} /> : null;
}
