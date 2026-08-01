export type PublicSitemapEntry = Readonly<{
  path: string;
  changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: string;
}>;

export declare const PUBLIC_SITEMAP_ENTRIES: readonly PublicSitemapEntry[];

export declare function normalizePathname(pathname: string): string;

export declare function isPublicIndexableRoute(
  pathname: string,
  statuses?: readonly string[],
): boolean;

export declare function robotsDirectiveForRoute(
  pathname: string,
  statuses?: readonly string[],
): "index, follow" | "noindex, nofollow";
