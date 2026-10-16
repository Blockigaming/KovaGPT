import { ConnectorError } from "./launch-contracts.mjs";
import { readBoundedUtf8 } from "../lib/bounded-json.server.mjs";
const TEXT_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/tab-separated-values",
  "application/json",
]);
export const CONNECTOR_TEXT_BYTE_LIMIT = 65536;
/** Download only a Graph-returned Microsoft URL. Never forward OAuth credentials. */
export async function readGraphText(metadata, { fetchImpl = fetch, signal } = {}) {
  if (
    !metadata?.file ||
    metadata.folder ||
    !TEXT_TYPES.has(metadata.file.mimeType?.toLowerCase()) ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0 ||
    metadata.size > CONNECTOR_TEXT_BYTE_LIMIT ||
    typeof metadata.eTag !== "string" ||
    !metadata.eTag
  )
    throw new ConnectorError("file_text_unsupported_or_too_large", 400);
  let url;
  try {
    url = new URL(metadata["@microsoft.graph.downloadUrl"]);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:sharepoint\.com|files\.1drv\.com)$/.test(url.hostname)
    )
      throw new Error();
  } catch {
    throw new ConnectorError("file_download_origin_unavailable", 502);
  }
  const bounded = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Accept: "text/plain, text/csv, text/markdown, text/tab-separated-values, application/json",
      },
      redirect: "error",
      signal: bounded,
    });
    if (response.status !== 200 || response.headers.has("content-range")) {
      // Best-effort cleanup must not block rejection on a stalled transport.
      void response.body?.cancel().catch(() => {});
      throw new Error();
    }
    const text = await readBoundedUtf8(response, CONNECTOR_TEXT_BYTE_LIMIT, bounded, metadata.size);
    if (text.includes("\0")) throw new Error();
    return text;
  } catch {
    throw new ConnectorError(
      signal?.aborted ? "request_aborted" : "file_content_unavailable",
      signal?.aborted ? 499 : 502,
    );
  }
}
