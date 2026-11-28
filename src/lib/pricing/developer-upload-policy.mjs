import { developerFileUpload } from "./developer-file-policy.mjs";
import { developerUuid } from "./developer-platform-policy.mjs";

const fail = () => {
  throw new Error("developer_upload_invalid");
};
export function parseDeveloperUploadRequest(method, params, body) {
  for (const key of params.keys()) if (key !== "id" || params.getAll(key).length !== 1) fail();
  if (method === "GET")
    return params.has("id")
      ? { operation: "get", input: { id: developerUuid(params.get("id")) } }
      : { operation: "list", input: {} };
  if (method !== "POST" || params.size || !body || typeof body !== "object" || Array.isArray(body))
    fail();
  const { operation, ...input } = body;
  const fields = {
    create: ["id", "filename", "mime_type", "total_bytes", "sha256"],
    append: ["id", "offset", "data"],
    complete: ["id"],
    cancel: ["id"],
  };
  if (
    !Object.hasOwn(fields, operation) ||
    Object.keys(input).length !== fields[operation].length ||
    fields[operation].some((key) => !Object.hasOwn(input, key))
  )
    fail();
  input.id = developerUuid(input.id);
  if (operation === "create") {
    developerFileUpload({
      filename: input.filename,
      mimeType: input.mime_type,
      text: input.mime_type === "application/json" ? "{}" : "x",
    });
    if (
      !Number.isSafeInteger(input.total_bytes) ||
      input.total_bytes < 1 ||
      input.total_bytes > 32768 ||
      typeof input.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.sha256)
    )
      fail();
  }
  if (operation === "append") {
    if (
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      input.offset > 32767 ||
      typeof input.data !== "string" ||
      input.data.length > 10924
    )
      fail();
    let bytes;
    try {
      bytes = atob(input.data);
    } catch {
      fail();
    }
    if (!bytes.length || bytes.length > 8192 || btoa(bytes) !== input.data) fail();
  }
  return { operation, input };
}
