import type { useCollectionPager } from "@/lib/use-collection-pager";
export function CollectionPageControls({
  label,
  pager,
  disabled = false,
}: {
  label: string;
  pager: ReturnType<typeof useCollectionPager>;
  disabled?: boolean;
}) {
  return (
    <div className="my-3 space-y-2 text-sm" aria-label={`${label} pages`}>
      <p className="text-muted-foreground">
        {label}: page {pager.page}. Search, filters and ordering apply to this loaded page. More
        records may be on other pages.
      </p>
      {pager.error && <p role="alert">{pager.error} The last loaded page is retained.</p>}
      {pager.atHistoryLimit && (
        <p role="status">
          Earlier page history is no longer retained. Refresh to start from the first page.
        </p>
      )}
      <div className="flex gap-3">
        <button
          className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
          type="button"
          disabled={disabled || pager.busy || !pager.hasPrevious}
          onClick={pager.previous}
        >
          Previous page
        </button>
        <button
          className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
          type="button"
          disabled={disabled || pager.busy || !pager.hasNext}
          onClick={pager.next}
        >
          Next page
        </button>
        {pager.error && (
          <button
            className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
            type="button"
            disabled={disabled || pager.busy}
            onClick={pager.retry}
          >
            Retry page
          </button>
        )}
        {pager.busy && <span role="status">Loading page…</span>}
      </div>
    </div>
  );
}
