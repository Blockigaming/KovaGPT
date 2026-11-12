/**
 * Translate *real server error codes* into Kova notifications.
 * No matching of marketing copy to infer limits, paid access or entitlement.
 * The final UI remains a contextual notice rather than a fabricated upgrade.
 */
export function chatFailureNoticeId(error, { signedIn = false, networkFailure = false } = {}) {
  if (!error || typeof error !== "object") return "generic_failure";
  const code = typeof error.code === "string" ? error.code : "";
  const category = typeof error.category === "string" ? error.category : "";
  const status = Number.isInteger(error.status) ? error.status : null;
  if (code === "authentication_required" || status === 401)
    return signedIn ? "session_expired" : "sign_in_required";
  if (code === "analysis_sign_in_required") return "sign_in_required";
  if (code === "analysis_limit") return "analysis_limit";
  if (code === "analysis_failed") return "analysis_failed";
  if (code === "tool_limit") return "tool_limit";
  if (code === "account_restricted") return "account_restricted";
  if (code === "kova_model_not_entitled" || code === "mode_not_entitled")
    return "reasoning_restricted";
  if (code === "kova_model_runtime_unverified") return "model_unavailable";
  if (code === "kova_model_vision_unavailable") return "unsupported_content";
  if (code === "message_too_large") return "message_too_long";
  if (code === "too_many_messages") return "conversation_full";
  if (code === "file_upload_limit") return "upload_limit";
  if (code === "image_generation_limit") return "image_limit";
  if (code === "web_search_no_results") return "search_no_results";
  if (code === "web_search_unavailable") return "search_failed";
  if (code === "hosted_tools_unavailable") return "source_unavailable";
  if (code === "message_quota_unavailable") return "source_unavailable";
  if (code === "message_window_limit") {
    return error.usageKind === "thinking" ? "thinking_limit" : "assistant_limit";
  }
  if (category === "quota_exceeded" && (status === 429 || status === 402)) return "assistant_limit";
  if (category === "rate_limit" || (status === 429 && code !== "message_window_limit"))
    return "rate_limited";
  if (category === "model_timeout" || status === 408) return "request_timeout";
  if (category === "model_provider_failure") return "model_unavailable";
  if (status === 403) return "permission_denied";
  if (networkFailure || category === "network_failure") return "network_offline";
  return "generic_failure";
}
