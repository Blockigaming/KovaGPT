export function extractEmailFromMessage(raw: string): { subject: string; body: string } | null {
  if (!raw) return null;
  const text = raw.replace(/\r\n/g, "\n").trim();
  const subjectMatch = text.match(/^\s*subject\s*:\s*(.+)$/im);
  if (subjectMatch) {
    const subject = subjectMatch[1].trim().replace(/^["']|["']$/g, "");
    const body = text
      .replace(subjectMatch[0], "")
      .replace(/^\s*(?:to|from|cc|bcc)\s*:.*$/gim, "")
      .replace(/^```(?:email|markdown|text)?\n?/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    if (body.length > 10) return { subject, body };
  }
  const fenced = text.match(/```(?:email|eml)?\s*\n([\s\S]+?)```/i);
  if (fenced) return extractEmailFromMessage(fenced[1].trim());
  const greeting =
    /^(hi|hello|dear|hey|good\s+(morning|afternoon|evening))\b[^\n]{0,60},?\s*\n/i.test(text);
  const signoff =
    /\n\s*(best|thanks|thank you|regards|sincerely|cheers|kind regards|warmly|talk soon)[,\s]/i.test(
      text,
    );
  return greeting && signoff && text.length > 80 ? { subject: "", body: text } : null;
}

export async function openEmailCompose(
  provider: "gmail" | "outlook",
  subject: string,
  body: string,
) {
  try {
    await navigator.clipboard.writeText(body);
  } catch {
    // The compose URL still contains the body when clipboard access is unavailable.
  }
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  const url =
    provider === "gmail"
      ? `https://mail.google.com/mail/?view=cm&fs=1&tf=1&su=${encodedSubject}&body=${encodedBody}`
      : `https://outlook.office.com/mail/deeplink/compose?subject=${encodedSubject}&body=${encodedBody}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
