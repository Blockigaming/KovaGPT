// Only server-discovered contracts are eligible; never infer availability from consumer labels.
export function developerCatalogRows(value) {
  if (
    value?.object !== "list" ||
    !Array.isArray(value.data) ||
    value.data.length > 1000 ||
    typeof value.pricingVersion !== "string" ||
    !value.pricingVersion ||
    value.pricingVersion.length > 160
  )
    throw new Error("Invalid model catalog response.");
  const seen = new Set();
  const rows = value.data.map((row) => {
    if (
      !row ||
      typeof row.id !== "string" ||
      !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/.test(row.id) ||
      row.id.length > 80 ||
      typeof row.capability !== "string" ||
      !/^[a-z_]{1,80}$/.test(row.capability) ||
      !Array.isArray(row.reasoning_efforts) ||
      row.reasoning_efforts.some(
        (e) => !["none", "minimal", "low", "medium", "high", "xhigh"].includes(e),
      ) ||
      ["web_search", "inline_image_input", "image_edits"].some((k) => typeof row[k] !== "boolean")
    )
      throw new Error("Invalid model catalog response.");
    const key = row.id + ":" + row.capability;
    if (seen.has(key)) throw new Error("Duplicate model contract.");
    seen.add(key);
    return {
      id: row.id,
      capability: row.capability,
      reasoning_efforts: [...row.reasoning_efforts],
      web_search: row.web_search,
      inline_image_input: row.inline_image_input,
      image_edits: row.image_edits,
    };
  });
  return { pricingVersion: value.pricingVersion, rows };
}
export function filterDeveloperCatalog(rows, query, capability) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (row) =>
      (!capability || row.capability === capability) &&
      terms.every((term) => (row.id + " " + row.capability).toLowerCase().includes(term)),
  );
}
