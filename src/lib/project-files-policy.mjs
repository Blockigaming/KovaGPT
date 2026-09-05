export const MAX_PROJECT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_FILE_NAME_CHARS = 180;

const IMAGE_SIGNATURES = Object.freeze([
  {
    mimeType: "image/png",
    extension: "png",
    matches: (bytes) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    mimeType: "image/jpeg",
    extension: "jpg",
    matches: (bytes) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mimeType: "image/gif",
    extension: "gif",
    matches: (bytes) => {
      if (bytes.length < 6) return false;
      const header = String.fromCharCode(...bytes.subarray(0, 6));
      return header === "GIF87a" || header === "GIF89a";
    },
  },
  {
    mimeType: "image/webp",
    extension: "webp",
    matches: (bytes) =>
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP",
  },
]);

const TEXT_EXTENSIONS = new Map([
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["csv", "text/csv"],
  ["tsv", "text/tab-separated-values"],
  ["json", "application/json"],
  ["yaml", "text/plain"],
  ["yml", "text/plain"],
  ["xml", "text/plain"],
  ["log", "text/plain"],
  ["ini", "text/plain"],
  ["conf", "text/plain"],
  ["cfg", "text/plain"],
  ["toml", "text/plain"],
  ["sql", "text/plain"],
  ["html", "text/plain"],
  ["htm", "text/plain"],
  ["css", "text/plain"],
  ["js", "text/plain"],
  ["jsx", "text/plain"],
  ["ts", "text/plain"],
  ["tsx", "text/plain"],
  ["py", "text/plain"],
  ["rb", "text/plain"],
  ["go", "text/plain"],
  ["rs", "text/plain"],
  ["java", "text/plain"],
  ["kt", "text/plain"],
  ["swift", "text/plain"],
  ["php", "text/plain"],
  ["sh", "text/plain"],
  ["c", "text/plain"],
  ["cpp", "text/plain"],
  ["h", "text/plain"],
  ["hpp", "text/plain"],
  ["cs", "text/plain"],
  ["vue", "text/plain"],
  ["svelte", "text/plain"],
  ["r", "text/plain"],
]);

export class ProjectFileInputError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "ProjectFileInputError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeProjectFileIdentity(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ProjectFileInputError(400, "invalid_project_file_identity");
  }
  return value.toLowerCase();
}

export function normalizeProjectFileName(value) {
  if (typeof value !== "string") throw new ProjectFileInputError(400, "invalid_file_name");
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const chars = Array.from(normalized);
  if (!chars.length || chars.length > MAX_PROJECT_FILE_NAME_CHARS) {
    throw new ProjectFileInputError(400, "invalid_file_name");
  }
  return chars.join("");
}

function extensionOf(name) {
  const position = name.lastIndexOf(".");
  return position > 0 && position < name.length - 1 ? name.slice(position + 1).toLowerCase() : "";
}

function hasPdfSignature(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

function decodeText(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) throw new Error("nul");
    return text;
  } catch {
    throw new ProjectFileInputError(415, "file_content_does_not_match_type");
  }
}

export function inspectProjectFile({ bytes, fileName, requestedKind }) {
  if (!(bytes instanceof Uint8Array)) {
    throw new ProjectFileInputError(400, "invalid_file_body");
  }
  if (bytes.byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileInputError(413, "file_too_large");
  }
  const name = normalizeProjectFileName(fileName);
  const image = IMAGE_SIGNATURES.find((candidate) => candidate.matches(bytes));
  if (image) {
    if (requestedKind !== "image") {
      throw new ProjectFileInputError(415, "file_kind_does_not_match_content");
    }
    return { name, kind: "image", mimeType: image.mimeType, extension: image.extension };
  }
  if (requestedKind === "image") {
    throw new ProjectFileInputError(415, "image_signature_required");
  }

  const extension = extensionOf(name);
  if (extension === "pdf") {
    if (!hasPdfSignature(bytes)) {
      throw new ProjectFileInputError(415, "file_content_does_not_match_type");
    }
    return { name, kind: "file", mimeType: "application/pdf", extension: "pdf" };
  }

  const mimeType = TEXT_EXTENSIONS.get(extension);
  if (!mimeType) throw new ProjectFileInputError(415, "unsupported_file_type");
  const text = decodeText(bytes);
  if (mimeType === "application/json") {
    try {
      JSON.parse(text);
    } catch {
      throw new ProjectFileInputError(415, "invalid_json_file");
    }
  }
  return { name, kind: "file", mimeType, extension };
}

export async function readProjectFileBody(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^(0|[1-9]\d*)$/.test(declared)) {
      throw new ProjectFileInputError(400, "invalid_content_length");
    }
    const size = Number(declared);
    if (!Number.isSafeInteger(size)) {
      throw new ProjectFileInputError(400, "invalid_content_length");
    }
    if (size > MAX_PROJECT_FILE_BYTES) {
      throw new ProjectFileInputError(413, "file_too_large");
    }
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new ProjectFileInputError(400, "invalid_file_body");
      }
      if (value.byteLength > MAX_PROJECT_FILE_BYTES - size) {
        await reader.cancel("file_too_large").catch(() => undefined);
        throw new ProjectFileInputError(413, "file_too_large");
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
