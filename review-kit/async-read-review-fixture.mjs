/** Narrow read/pending overlays for existing image, usage and billing contracts. */
import { fromJSON } from "seroval";
const owner = "22222222-2222-4222-8222-222222222222";
const origin = "http://127.0.0.1:4189";
const plainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const emptyObject = (value) => plainObject(value) && Object.keys(value).length === 0;
const signedIn = Object.freeze(["free", "plus", "pro"]);
export const ASYNC_READ_REVIEW_OPTIONS = Object.freeze(
  [
    { id: "image-generation-pending", accounts: signedIn, path: "/images" },
    { id: "usage-read-pending", accounts: signedIn, path: "/settings/usage" },
    { id: "usage-read-error", accounts: signedIn, path: "/settings/usage" },
    {
      id: "usage-large-counts",
      label: "usage-large-counts · test-only oversized counters",
      accounts: signedIn,
      path: "/settings/usage",
    },
    { id: "subscription-read-pending", accounts: signedIn, path: "/settings/billing" },
  ].map(Object.freeze),
);
export const ASYNC_READ_REVIEW_SCENARIOS = Object.freeze(
  ASYNC_READ_REVIEW_OPTIONS.map((x) => x.id),
);
export const ASYNC_READ_REVIEW_DISCLOSURE =
  "Image pending keeps the existing bundled sample for edit-source selection and holds only valid generation/edit requests, then fails locally without creating an image. Usage and subscription pending hold only the named read; usage error is a fixed local failure. Use existing billing-unavailable for subscription errors. Holds expire locally or end on reset/sign-out/request cancellation; no provider, billing or storage operation runs.";
export const REVIEW_LARGE_USAGE_COUNTS = Object.freeze({
  chats: 987_654_321,
  images: 123_456_789,
  uploads: 98_765_432,
});
export const USAGE_LARGE_COUNTS_REVIEW_DISCLOSURE =
  "usage-large-counts is a test-only layout stress state: 987,654,321 messages, 123,456,789 images and 98,765,432 uploads. These deliberately oversized synthetic counters are not real activity or available allowances. Existing plan limits stay unchanged, including Free's 3 images and 2 uploads per day; the application's existing remaining-count clamp should display 0. Accounting still resets at the next UTC midnight. No usage, price, invoice or charge is created. Reset to default restores 3 messages, 0 images and 0 uploads.";

export function createAsyncReadReviewHandler(
  scenario,
  functionNames,
  { isActive, wait, imageReview, dailyUsage } = {},
) {
  if (
    !ASYNC_READ_REVIEW_SCENARIOS.includes(scenario) ||
    typeof isActive !== "function" ||
    typeof wait !== "function"
  )
    throw new Error("Known async review scenario and bounded session hold required.");
  if (scenario === "image-generation-pending" && typeof imageReview?.handler !== "function")
    throw new Error("Existing image sample fixture required.");
  if (scenario === "usage-large-counts" && typeof dailyUsage !== "function")
    throw new Error("Existing UTC daily usage fixture required.");
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const name = url.pathname.startsWith("/_serverFn/")
      ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    const image = scenario === "image-generation-pending";
    const target = scenario.startsWith("usage-") ? "getMyDailyUsage" : "getSubscriptionSummary";
    if (
      image
        ? !["/api/generate-image", "/api/library/items"].includes(url.pathname) &&
          !["getLibraryImageUrl", "saveImageToLibrary"].includes(name)
        : name !== target
    )
      return route.fallback();
    const reply = (status, error) =>
      route.fulfill({ status, json: { error }, headers: { "Cache-Control": "no-store" } });
    const headers = request.headers();
    if (
      !isActive() ||
      (Object.hasOwn(headers, "x-kova-owner") && headers["x-kova-owner"] !== owner) ||
      (image && !name && headers["x-kova-owner"] !== owner)
    )
      return reply(401, "Synthetic inspection account changed or does not match.");
    if (image) {
      if (name === "saveImageToLibrary")
        return reply(503, "Saving is disconnected in the pending-only image sample.");
      if (url.pathname === "/api/generate-image" && request.method() === "POST") {
        try {
          const raw = request.postData();
          if (url.search || typeof raw !== "string" || Buffer.byteLength(raw) > 16384)
            throw new Error();
          const body = JSON.parse(raw);
          // Exactly the current Images composer shape, not arbitrary provider settings.
          if (
            !plainObject(body) ||
            Object.keys(body).some(
              (key) =>
                !["prompt", "aspectRatio", "operation", "parentImageId", "maskAssetId"].includes(
                  key,
                ),
            ) ||
            typeof body.prompt !== "string" ||
            body.prompt.length > 2000 ||
            (!body.operation && body.parentImageId !== undefined)
          )
            throw new Error();
        } catch {
          return reply(400, "Use the bounded synthetic Images composer request.");
        }
      }
      let output;
      try {
        await imageReview.handler({
          ...route,
          fulfill: async (value) => {
            output = value;
          },
        });
      } finally {
        // The reusable image fixture captures request evidence for its own tests;
        // this pending overlay does not retain authored prompt/body data.
        imageReview.requests.length = 0;
      }
      if (!output) return reply(503, "Unsupported synthetic image read.");
      if (
        url.pathname !== "/api/generate-image" ||
        request.method() !== "POST" ||
        output.status !== 503
      )
        return route.fulfill(output);
    } else {
      if (request.method() !== "GET")
        return reply(405, "Synthetic usage/subscription inspection is read-only.");
      const raw = url.searchParams.get("payload");
      try {
        if (
          [...url.searchParams.keys()].some((key) => key !== "payload") ||
          request.postData() ||
          url.searchParams.getAll("payload").length > 1 ||
          (raw && Buffer.byteLength(raw) > 8192)
        )
          throw new Error();
        const value = raw ? fromJSON(JSON.parse(raw)) : null;
        if (
          raw &&
          (!plainObject(value) ||
            Object.keys(value).some((key) => !["data", "context"].includes(key)) ||
            (value.context !== undefined && !emptyObject(value.context)))
        )
          throw new Error();
        if (
          target === "getSubscriptionSummary" &&
          (!value?.data ||
            !["live", "sandbox"].includes(value.data.environment) ||
            Object.keys(value.data).some((k) => k !== "environment"))
        )
          throw new Error();
        if (target === "getMyDailyUsage" && value?.data !== undefined && !emptyObject(value?.data))
          throw new Error();
      } catch {
        return reply(400, "Malformed bounded synthetic read request.");
      }
      if (scenario === "usage-read-error")
        return reply(503, "Synthetic usage read failed. No usage service was contacted.");
      if (scenario === "usage-large-counts")
        return route.fulfill({
          status: 200,
          json: { result: { ...dailyUsage(), ...REVIEW_LARGE_USAGE_COUNTS }, context: {} },
          headers: { "Cache-Control": "no-store" },
        });
    }
    const reason = await wait(request.signal?.());
    if (!isActive()) return reply(401, "Synthetic inspection session ended.");
    return reply(
      reason === "aborted" || reason === "reset" ? 499 : 503,
      `Synthetic ${image ? "image generation/edit" : target === "getMyDailyUsage" ? "usage read" : "subscription read"} hold ${reason}. No service was contacted; reset to inspect again.`,
    );
  };
}
