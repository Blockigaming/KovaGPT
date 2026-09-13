// PostgreSQL jsonb/text rejects unpaired surrogates. Preserve complete Unicode
// characters while enforcing the storage/provider UTF-16 length bound.
export function boundedSummaryText(value, maxLength) {
  let result = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    const safe = character.length === 1 && code >= 0xd800 && code <= 0xdfff ? "\ufffd" : character;
    if (result.length + safe.length > maxLength) break;
    result += safe;
  }
  return result;
}
