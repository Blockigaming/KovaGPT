import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fromJSON } from "seroval";

// Review-only interception. Install after coreFixture. Never import into production.
export const IMAGE_REVIEW_SCENARIOS = Object.freeze([
  "image-sample-success",
  "image-sample-failure",
]);
export const IMAGE_REVIEW_DISCLOSURE =
  "Local image review: results use a bundled sample, edits return that same sample, and Library saves exist only in this review session. No image provider, paid generation or account storage is used.";
export const IMAGE_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const IMAGE_REVIEW_SOURCE_ID = "88888888-8888-4888-8888-888888888888";
const origin = "http://127.0.0.1:4189";
const packagedSample = new URL("./review/image-review-sample.jpg", import.meta.url);
const sampleBytes = readFileSync(
  existsSync(packagedSample)
    ? packagedSample
    : new URL("../src/assets/image-presets/origami.jpg", import.meta.url),
);
export const IMAGE_REVIEW_DATA_URL = `data:image/jpeg;base64,${sampleBytes.toString("base64")}`;

function readFunctionNames(directory = ".nitro/vite/services/ssr/assets") {
  const names = new Map();
  for (const file of readdirSync(directory).filter((name) => name.startsWith("vendor-tanstack"))) {
    const source = readFileSync(join(directory, file), "utf8");
    for (const match of source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName: "([^"]+)"/g))
      names.set(match[1], match[2]);
  }
  for (const required of ["saveImageToLibrary", "getLibraryImageUrl"])
    if (![...names.values()].some((name) => name.split("_")[0] === required))
      throw new Error(`Image review function manifest is missing ${required}`);
  return names;
}
function sampleItem(id, title, prompt = "Bundled origami sample for local review") {
  return {
    id,
    user_id: IMAGE_REVIEW_OWNER,
    title,
    item_type: "image",
    source: "images",
    content_text: prompt,
    content_excerpt: prompt,
    content_generation: id,
    content_revision: 1,
    file_name: "local-review-sample.jpg",
    file_type: "image/jpeg",
    file_url: IMAGE_REVIEW_DATA_URL,
    file_size: sampleBytes.length,
    folder_id: null,
    metadata: { reviewOnly: true, sample: true, prompt },
    created_at: "2026-10-17T12:00:00.000Z",
  };
}

export function createImageReviewHandler(scenario, functionNames = new Map()) {
  if (!IMAGE_REVIEW_SCENARIOS.includes(scenario)) throw new Error("Unknown image review scenario");
  const requests = [];
  const items = [sampleItem(IMAGE_REVIEW_SOURCE_ID, "Sample origami · local review")];
  let sequence = 0;
  const handler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const name = url.pathname.startsWith("/_serverFn/")
      ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    const isFunction = ["saveImageToLibrary", "getLibraryImageUrl"].includes(name);
    if (!isFunction && !["/api/generate-image", "/api/library/items"].includes(url.pathname))
      return route.fallback();
    const method = request.method();
    const raw = request.postData() ?? null;
    let data = null;
    try {
      data = raw ? (isFunction ? fromJSON(JSON.parse(raw))?.data : JSON.parse(raw)) : null;
    } catch {
      return route.fulfill({ status: 400, json: { error: "Invalid local review request" } });
    }
    requests.push({
      method,
      path: url.pathname,
      query: url.search,
      functionName: name || null,
      raw,
      data: structuredClone(data),
    });
    const reply = (json, status = 200) =>
      route.fulfill({ status, headers: { "Cache-Control": "no-store" }, json });
    const functionReply = (result) => reply({ result, context: {} });
    if (url.pathname === "/api/generate-image") {
      if (method === "GET")
        return reply({
          editingEnabled: true,
          variationEnabled: false,
          aspectRatios: ["1:1", "2:3", "3:2"],
          ...(url.searchParams.has("sources")
            ? {
                images: items.map(({ id, title, file_type, file_size, created_at }) => ({
                  id,
                  title,
                  file_type,
                  file_size,
                  created_at,
                })),
                nextCursor: null,
              }
            : {}),
        });
      if (method !== "POST")
        return reply({ error: "Method not supported in local image review" }, 405);
      if (
        !data ||
        typeof data.prompt !== "string" ||
        !data.prompt.trim() ||
        data.prompt.length > 4000 ||
        !["1:1", "2:3", "3:2"].includes(data.aspectRatio)
      )
        return reply({ error: "Enter a prompt and supported aspect ratio." }, 400);
      if (data.operation && data.operation !== "edit")
        return reply({ error: "Unsupported sample operation." }, 400);
      if (
        data.operation === "edit" &&
        (!items.some((item) => item.id === data.parentImageId) || data.maskAssetId)
      )
        return reply(
          { error: "Choose a local sample image; masks are unavailable in this review." },
          400,
        );
      if (scenario === "image-sample-failure")
        return reply(
          { error: "Simulated image failure. Your prompt is kept; no provider was called." },
          503,
        );
      return reply({
        imageUrl: IMAGE_REVIEW_DATA_URL,
        model: "local-review-sample",
        metadata: {
          reviewOnly: true,
          sample: true,
          operation: data.operation ?? "generate",
          aspectRatio: data.aspectRatio,
          disclosure: IMAGE_REVIEW_DISCLOSURE,
        },
      });
    }
    if (isFunction) {
      if (method !== "POST") return reply({ error: "Expected POST" }, 405);
      if (name === "getLibraryImageUrl") {
        if (!items.some((item) => item.id === data?.id))
          return reply({ error: "Local sample not found" }, 404);
        return functionReply({ url: IMAGE_REVIEW_DATA_URL });
      }
      if (
        data?.expectedOwnerId !== IMAGE_REVIEW_OWNER ||
        data.imageUrl !== IMAGE_REVIEW_DATA_URL ||
        typeof data.title !== "string" ||
        typeof data.prompt !== "string"
      )
        return reply({ error: "Only this review owner's local sample can be saved." }, 400);
      if (items.length >= 50)
        return reply(
          { error: "Local sample Library is full; restart the review to reset it." },
          409,
        );
      const id = `99999999-9999-4999-8999-${String(++sequence).padStart(12, "0")}`;
      items.unshift(sampleItem(id, `Sample · ${data.title.slice(0, 100)}`, data.prompt));
      return functionReply({ id });
    }
    if (method === "GET") {
      const item = items.find((candidate) => candidate.id === url.searchParams.get("id"));
      return reply(item ?? { error: "Local sample not found" }, item ? 200 : 404);
    }
    if (method === "POST" && data?.operation === "list") {
      const query = String(data.query ?? "").toLowerCase();
      const favorites = String(data.favorites ?? "").split(",");
      const filtered = items.filter(
        (item) =>
          item.title.toLowerCase().includes(query) &&
          (!data.folder || ["all", "unfiled"].includes(data.folder)) &&
          (!data.filter ||
            ["all", "images"].includes(data.filter) ||
            (data.filter === "favorites" && favorites.includes(item.id))),
      );
      return reply({ items: filtered, cursor: null, hasMore: false });
    }
    return reply({ error: "This mutation is unavailable in local image review." }, 503);
  };
  return {
    handler,
    requests,
    getItems: () => structuredClone(items),
    disclosure: IMAGE_REVIEW_DISCLOSURE,
  };
}

export async function installImageReview(page, scenario, options = {}) {
  const review = createImageReviewHandler(scenario, options.functionNames ?? readFunctionNames());
  await page.route("**/*", review.handler);
  return review;
}
