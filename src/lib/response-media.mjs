/**
 * Optional media details carried in a Markdown link title:
 *   [Demo](https://x/demo.mp4 "captions: https://x/demo.vtt; chapters: 0:00 Intro, 1:30 Setup")
 * Only https caption files are accepted; chapter times are m:ss or h:mm:ss.
 */
export function parseMediaTitle(title) {
  const result = { captions: null, chapters: [] };
  if (typeof title !== "string" || title.length > 2_000) return result;
  for (const part of title.split(";")) {
    const [rawKey, ...rest] = part.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "captions" && /^https:\/\/[^\s"'<>]+\.vtt(?:[?#][^\s"'<>]*)?$/iu.test(value))
      result.captions = value;
    if (key === "chapters")
      for (const entry of value.split(",")) {
        const match = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.{1,80}?)\s*$/u.exec(entry);
        if (!match) continue;
        const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        result.chapters.push({ seconds, label: match[4] });
      }
  }
  result.chapters.sort((a, b) => a.seconds - b.seconds);
  result.chapters = result.chapters.slice(0, 50);
  return result;
}

export function formatMediaTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
