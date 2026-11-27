export function filterDeveloperReference(entries, query) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = [
      entry.title,
      entry.slug,
      entry.path,
      entry.methods?.join(" "),
      entry.request,
      entry.behavior,
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
