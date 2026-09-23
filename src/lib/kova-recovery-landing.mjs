import { readKovaRecoveryLink } from "./kova-recovery-link.mjs";

// One parser defines both the fragment-only credential and mode boundary.
// The landing adapter retains its public shape for the cancellation-safe form.
export function readKovaRecoveryLanding(href, mode = "dual") {
  const { owned, token, cleanPath } = readKovaRecoveryLink(href, mode);
  return { owned, token, cleanUrl: cleanPath };
}
