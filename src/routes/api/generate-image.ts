import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  getCallerTier,
  requireVerifiedUser,
} from "@/lib/api-auth.server";
import { DAILY_IMAGE_LIMIT_BY_TIER } from "@/lib/modes";
import {
  AiProviderError,
  imageGenerations,
  imageEdits,
  missingAiProviderResponse,
  providerErrorFromResponse,
  providerErrorResponse,
} from "@/lib/ai/provider.server";
import {
  imageProviderPayload,
  imageEditProviderPayload,
  imageResultMetadata,
  normalizeImageSettings,
  imageEditingEnabled,
} from "@/lib/multimodal/image-workflows.server";
import { ImageInputError } from "@/lib/multimodal/image-request-policy.mjs";
import { validateImageResult } from "@/lib/multimodal/image-bytes.mjs";
import {
  assertImagePrincipal,
  loadOwnedImageSource,
} from "@/lib/multimodal/image-source.server.mjs";
import { BodyReadError, readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "@/lib/ai/provider-transport.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const deadline = createRequestDeadline(request.signal, 10_000, "image_options");
        try {
          const auth = await waitForPromiseWithSignal(
            requireVerifiedUser(request),
            deadline.signal,
          );
          if (auth instanceof Response) return auth;
          const limit = await waitForPromiseWithSignal(
            consumeApplicationRateLimit({
              identity: `user:${auth.userId}`,
              action: "image_options",
              limit: 60,
              windowSeconds: 60,
            }),
            deadline.signal,
          );
          if (!limit.allowed)
            return json(
              { error: "Image options are temporarily unavailable. Please retry shortly." },
              limit.status === "unavailable" ? 503 : 429,
            );
          const result = {
            editingEnabled: imageEditingEnabled(),
            variationEnabled: false,
            aspectRatios: ["1:1", "2:3", "3:2"],
          };
          const url = new URL(request.url);
          if (!url.searchParams.has("sources") || !result.editingEnabled) return json(result);
          await assertImagePrincipal(auth, deadline.signal);
          const before = url.searchParams.get("before"),
            beforeId = url.searchParams.get("id");
          let query = auth.supabaseUser
            .from("user_library_items")
            .select("id,title,file_type,file_size,created_at")
            .eq("user_id", auth.userId)
            .eq("item_type", "image")
            .in("file_type", ["image/png", "image/jpeg", "image/webp"])
            .order("created_at", { ascending: false })
            .order("id", { ascending: false });
          if (before || beforeId) {
            if (
              !before ||
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(before) ||
              !Number.isFinite(Date.parse(before)) ||
              !/^[0-9a-f-]{36}$/iu.test(beforeId ?? "")
            )
              return json({ error: "Invalid image page." }, 400);
            query = query.or(
              `created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`,
            );
          }
          const page = await query.limit(51).abortSignal(deadline.signal);
          if (page.error) throw new Error("source_list_failed");
          await assertImagePrincipal(auth, deadline.signal);
          const rows = (page.data ?? []).slice(0, 50),
            last = rows.at(-1);
          return json({
            ...result,
            images: rows,
            nextCursor:
              page.data && page.data.length > 50 && last
                ? `&before=${encodeURIComponent(last.created_at)}&id=${last.id}`
                : null,
          });
        } catch {
          return json({ error: "Image options could not be loaded. Please retry." }, 503);
        } finally {
          deadline.cleanup();
        }
      },
      POST: async ({ request }) => {
        const deadline = createRequestDeadline(request.signal, 45_000, "image_request");
        try {
          const auth = await waitForPromiseWithSignal(
            requireVerifiedUser(request),
            deadline.signal,
          );
          if (auth instanceof Response) return auth;
          const rate = await waitForPromiseWithSignal(
            consumeApplicationRateLimit({
              identity: `user:${auth.userId}`,
              action: "image_request",
              limit: 10,
              windowSeconds: 60,
            }),
            deadline.signal,
          );
          if (!rate.allowed)
            return json(
              { error: "Please wait before another image request." },
              rate.status === "unavailable" ? 503 : 429,
            );
          const bytes = await readResponseBytesBounded(
            new Response(request.body, { headers: request.headers }),
            16 * 1024,
            { signal: deadline.signal, timeoutMs: 5000 },
          );
          let parsed: unknown;
          try {
            parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          } catch {
            throw new ImageInputError("Invalid image request JSON.");
          }
          const settings = normalizeImageSettings(parsed);
          const unavailable = missingAiProviderResponse();
          if (unavailable) return unavailable;
          const banned = await waitForPromiseWithSignal(assertNotBanned(auth), deadline.signal);
          if (banned) return banned;
          const disabled = await waitForPromiseWithSignal(
            assertFeatureEnabled(auth, "images"),
            deadline.signal,
          );
          if (disabled) return disabled;
          await assertImagePrincipal(auth, deadline.signal);
          const source =
            settings.operation === "edit"
              ? await loadOwnedImageSource(auth, settings.parentImageId!, {
                  supabaseUrl: runtimeEnv("SUPABASE_URL") ?? "",
                  signal: deadline.signal,
                })
              : undefined;
          const mask = settings.maskAssetId
            ? await loadOwnedImageSource(auth, settings.maskAssetId, {
                supabaseUrl: runtimeEnv("SUPABASE_URL") ?? "",
                mask: true,
                signal: deadline.signal,
              })
            : undefined;
          if (
            mask &&
            (!source ||
              source.info.width !== mask.info.width ||
              source.info.height !== mask.info.height)
          )
            throw new ImageInputError("The mask dimensions must match the original image.");
          const tier = await waitForPromiseWithSignal(getCallerTier(auth), deadline.signal);
          const quota = await waitForPromiseWithSignal(
            enforceQuota(auth, "images", DAILY_IMAGE_LIMIT_BY_TIER[tier]),
            deadline.signal,
          );
          if (quota) return quota;
          await assertImagePrincipal(auth, deadline.signal);
          await Promise.all([source?.recheck(), mask?.recheck()]);
          deadline.signal.throwIfAborted();
          const payload = source
            ? imageEditProviderPayload(settings)
            : imageProviderPayload(settings);
          const upstream = source
            ? await imageEdits(
                payload,
                { image: source, ...(mask ? { mask } : {}) },
                { signal: deadline.signal },
              )
            : await imageGenerations(payload, { signal: deadline.signal });
          if (!upstream.ok) return providerErrorResponse(await providerErrorFromResponse(upstream));
          const responseBytes = await readResponseBytesBounded(upstream, 12 * 1024 * 1024, {
            signal: deadline.signal,
            timeoutMs: 10000,
          });
          let result;
          try {
            result = validateImageResult(
              JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(responseBytes)),
              settings,
            );
          } catch {
            throw new AiProviderError({
              error: "The image provider returned an invalid image. Please try again.",
              code: "provider_bad_response",
              retryable: false,
              status: 502,
            });
          }
          await assertImagePrincipal(auth, deadline.signal);
          await Promise.all([source?.recheck(), mask?.recheck()]);
          deadline.signal.throwIfAborted();
          const sourceHash = source
            ? Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", source.bytes as BufferSource)),
                (byte) => byte.toString(16).padStart(2, "0"),
              ).join("")
            : undefined;
          return json({
            imageUrl: result.imageUrl,
            model: payload.model,
            metadata: {
              ...imageResultMetadata(settings),
              ...(sourceHash ? { sourceSha256: sourceHash } : {}),
            },
          });
        } catch (error) {
          if (error instanceof ImageInputError) return json({ error: error.message }, error.status);
          if (error instanceof AiProviderError) return providerErrorResponse(error);
          if (error instanceof BodyReadError)
            return json(
              {
                error:
                  error.status === 413
                    ? "Image request is too large."
                    : "The image request could not be read.",
              },
              error.status === 413 ? 413 : 400,
            );
          if (deadline.signal.aborted)
            return json({ error: "The image request was cancelled or timed out." }, 504);
          return json(
            { error: "Image generation is temporarily unavailable. Please try again." },
            503,
          );
        } finally {
          deadline.cleanup();
        }
      },
    },
  },
});
