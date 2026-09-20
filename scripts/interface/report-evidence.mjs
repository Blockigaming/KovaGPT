const humanizeEvidenceValue = (value) => String(value).replaceAll("_", " ").toLowerCase();

export const formatEvidenceLevel = (page) =>
  [
    "Text reviewed",
    `source screenshots: ${humanizeEvidenceValue(page.source_screenshot_status)}`,
    `candidate screenshots: ${humanizeEvidenceValue(page.candidate_screenshot_status)}`,
    `controls: ${page.full_page_and_controls_reviewed === "True" ? "reviewed" : "pending"}`,
    `visual acceptance: ${page.visual_accepted === "True" ? "accepted" : "pending"}`,
  ].join(" · ");
