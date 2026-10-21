/** Use the established custom-instructions field; never add a provider-specific option. */
export function withResponsePresentation(profile, settings) {
  const original = typeof profile.customInstructions === "string" ? profile.customInstructions : "";
  const tone = {
    direct: "Use clear, direct language.",
    formal: "Use polished, professional language.",
    conversational: "Use a natural, conversational style.",
  }[settings.responseTone];
  const format = {
    automatic: "Choose the format that best fits the request.",
    plain: "Prefer plain text when no format is requested.",
    markdown: "Prefer Markdown when no format is requested.",
  }[settings.responseFormat];
  const preferences = [tone, format].filter(Boolean);
  if (!preferences.length) return profile;
  const guidance =
    "Saved presentation preferences are defaults only. Explicit instructions in the current message, including its requested length, tone, and format, take priority. Do not shorten an explicitly detailed request to fit a default. " +
    preferences.join(" ");
  const combined = [original, guidance].filter(Boolean).join("\n\n");
  // The ingress contract permits 8,000 characters. Never truncate the owner's instructions.
  if (combined.length > 8_000) return profile;
  return { ...profile, customInstructions: combined };
}
