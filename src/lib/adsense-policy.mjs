export function canDisplayResponseAd({
  tier,
  status,
  isLastAssistant,
  temporary,
  streaming,
  content,
  generationStatus,
}) {
  return (
    tier === "free" &&
    status === "ready" &&
    isLastAssistant === true &&
    !temporary &&
    !streaming &&
    typeof content === "string" &&
    content.trim().length > 0 &&
    !generationStatus
  );
}

export function hasAdSenseConsent(data, success) {
  return (
    success === true &&
    data?.cmpStatus === "loaded" &&
    ["tcloaded", "useractioncomplete"].includes(data.eventStatus) &&
    data.purpose?.consents?.["1"] === true &&
    data.vendor?.consents?.["755"] === true
  );
}
