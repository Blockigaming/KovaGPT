/** Line-preserving review hunks. No model operation occurs in this helper. */
export function resultRevisionDiff(before, after) {
  const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = lines(before),
    b = lines(after);
  if (a.length * b.length > 250_000) return [{ kind: "change", before, after }];
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const chunks = [];
  const append = (kind, oldText, newText) => {
    const last = chunks[chunks.length - 1];
    if (last?.kind === kind) {
      last.before += oldText;
      last.after += newText;
    } else chunks.push({ kind, before: oldText, after: newText });
  };
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      append("unchanged", a[i++], b[j++]);
    } else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1]))
      append("change", a[i++], "");
    else append("change", "", b[j++]);
  }
  return chunks;
}
export function applyReviewedDiff(chunks, rejected = []) {
  return chunks
    .map((chunk, index) => (rejected.includes(index) ? chunk.before : chunk.after))
    .join("");
}
