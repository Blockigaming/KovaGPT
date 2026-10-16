// Scope the compact-layout correction to the limits pager and API calls table.
export function compactDeveloperConsole(source) {
  const once = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Unexpected console layout: ${before}`);
    source = source.replace(before, after);
  };
  once(
    '<div className="flex items-center gap-3">\n              <Button\n                variant="outline"\n                disabled={limitsPage === 0 || busy}',
    '<div className="flex flex-wrap items-center gap-3">\n              <Button\n                variant="outline"\n                disabled={limitsPage === 0 || busy}',
  );
  once(
    "<span>Page {limitsPage + 1}</span>",
    '<span className="shrink-0 whitespace-nowrap">Page {limitsPage + 1}</span>',
  );
  once(
    '<section className="rounded-xl border p-5">\n            <h2 className="text-lg font-semibold">Latest 100 API calls</h2>',
    '<section className="min-w-0 rounded-xl border p-5">\n            <h2 className="text-lg font-semibold">Latest 100 API calls</h2>',
  );
  const start = source.indexOf("Latest 100 API calls</h2>");
  const end = source.indexOf("</table>", start) + "</table>".length;
  if (start < 0 || end < start) throw new Error("Missing API calls table");
  const table = source.slice(start, end);
  if (!table.includes('<table className="w-full text-left">'))
    throw new Error("Unexpected API calls table class");
  if ((table.match(/<th className="p-2">/g) || []).length !== 3)
    throw new Error("Unexpected API calls table headers");
  return (
    source.slice(0, start) +
    table
      .replace(
        '<table className="w-full text-left">',
        '<table className="w-full min-w-[28rem] text-left">',
      )
      .replaceAll('<th className="p-2">', '<th className="whitespace-nowrap p-2">') +
    source.slice(end)
  );
}
