// MAN-09 requires an explicit owner/provider/legal/privacy approval before Maps
// may issue geolocation, tile, or search-provider requests in a release build.
// Keep this fail-closed until that evidence is recorded in the release handoff.
export const MAPS_RELEASE_APPROVED = false;

export const MAPS_RELEASE_UNAVAILABLE_MESSAGE =
  "Maps is unavailable while provider, legal, privacy, capacity, and cost approval is pending.";
