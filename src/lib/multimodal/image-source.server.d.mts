import type { AuthedCaller } from "../api-auth.server";
import type { ProviderImageInput } from "../ai/provider.server";
import type { ImageInfo } from "./image-bytes.mjs";
export function assertImagePrincipal(auth: AuthedCaller, signal?: AbortSignal): Promise<void>;
export function loadOwnedImageSource(
  auth: AuthedCaller,
  id: string,
  options: { supabaseUrl: string; signal?: AbortSignal; mask?: boolean; fetchImpl?: typeof fetch },
): Promise<ProviderImageInput & { info: ImageInfo; recheck(): Promise<void> }>;
