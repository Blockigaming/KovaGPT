export function formatResponseTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${total % 60}s`]
    .filter(Boolean)
    .join(" ");
}

/** The same indicator is used for transcript loading and the first response. */
export function ChatLoadingIndicator({
  label = "Loading conversation",
  transcript = false,
}: {
  label?: string;
  transcript?: boolean;
}) {
  return (
    <div
      className="kova-chat-loading"
      data-chat-loading=""
      data-chat-transcript-loading={transcript || undefined}
      role="status"
    >
      <span className="sr-only">{label}</span>
      <span className="kova-chat-loading-lines" aria-hidden="true" />
    </div>
  );
}
