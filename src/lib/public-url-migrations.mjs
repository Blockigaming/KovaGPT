const migrations = new Map([
  ["/academy/chatgpt-for-education", "/academy/kovagpt-for-education"],
  ["/academy/chatgpt-for-work", "/academy/kovagpt-for-work"],
  ["/academy/chatgpt-sites", "/academy/kovagpt-sites"],
  ["/academy/chatgpt-work", "/academy/kovagpt-work"],
  [
    "/academy/chatgpt-work/how-business-operations-teams-use-codex",
    "/academy/kovagpt-work/how-business-operations-teams-use-codex",
  ],
  [
    "/academy/chatgpt-work/how-data-science-teams-use-codex",
    "/academy/kovagpt-work/how-data-science-teams-use-codex",
  ],
  [
    "/academy/chatgpt-work/how-sales-teams-use-codex",
    "/academy/kovagpt-work/how-sales-teams-use-codex",
  ],
  [
    "/academy/how-to-use-chatgpt-work-for-everyday-tasks",
    "/academy/how-to-use-kovagpt-work-for-everyday-tasks",
  ],
  ["/academy/using-chatgpt", "/academy/using-kovagpt"],
  ["/business/amex-chatgpt-business-credit", "/business/amex-kovagpt-business-credit"],
  [
    "/business/guides-and-resources/chatgpt-business-smb-guide",
    "/business/guides-and-resources/kovagpt-business-smb-guide",
  ],
  [
    "/business/guides-and-resources/chatgpt-usage-and-adoption-patterns-at-work",
    "/business/guides-and-resources/kovagpt-usage-and-adoption-patterns-at-work",
  ],
  [
    "/business/learn/download-the-chatgpt-work-guide-for-sales-teams",
    "/business/learn/download-the-kovagpt-work-guide-for-sales-teams",
  ],
  [
    "/business/learn/how-our-sales-team-uses-chatgpt-work",
    "/business/learn/how-our-sales-team-uses-kovagpt-work",
  ],
  [
    "/business/new-in-chatgpt-for-business-april-updates-2025",
    "/business/new-in-kovagpt-for-business-april-updates-2025",
  ],
  [
    "/business/new-in-chatgpt-for-work-march-updates-2025",
    "/business/new-in-kovagpt-for-work-march-updates-2025",
  ],
  [
    "/business/updates-to-chatgpt-business-plans-livestream-june-2025",
    "/business/updates-to-kovagpt-business-plans-livestream-june-2025",
  ],
  ["/chatgpt-alternative", "/kovagpt-alternative"],
  ["/form/chatgpt-pro-community", "/form/kovagpt-pro-community"],
  ["/global-affairs/college-students-and-chatgpt", "/global-affairs/college-students-and-kovagpt"],
  ["/global-affairs/introducing-chatgpt-gov", "/global-affairs/introducing-kovagpt-gov"],
  ["/import-to-chatgpt", "/import-to-kovagpt"],
  [
    "/policies/chatgpt-sites-data-processing-addendum",
    "/policies/kovagpt-sites-data-processing-addendum",
  ],
  ["/policies/chatgpt-sites-terms", "/policies/kovagpt-sites-terms"],
  [
    "/policies/how-chatgpt-and-our-foundation-models-are-developed",
    "/policies/how-kovagpt-and-our-foundation-models-are-developed",
  ],
  [
    "/policies/using-chatgpt-agent-in-line-with-our-policies",
    "/policies/using-kovagpt-agent-in-line-with-our-policies",
  ],
]);

export function migratedPublicPath(pathname) {
  return migrations.get(pathname) ?? null;
}
