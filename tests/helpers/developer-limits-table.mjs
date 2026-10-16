export function readableLimitsTable(source) {
  const start = source.indexOf(
    '<section className="space-y-3 rounded-xl border p-5">\n            <h2 className="text-lg font-semibold">Stored spending limits</h2>',
  );
  const end = source.indexOf("</table>", start) + "</table>".length;
  if (start < 0 || end < start) throw new Error("Missing spending limits table");
  let table = source
    .slice(start, end)
    .replace(
      'className="space-y-3 rounded-xl border p-5"',
      'className="min-w-0 space-y-3 rounded-xl border p-5"',
    )
    .replace('className="w-full text-left"', 'className="w-full min-w-[44rem] text-left"')
    .replaceAll("<th>", '<th className="whitespace-nowrap p-2">')
    .replaceAll("<td>", '<td className="whitespace-nowrap p-2 align-top">')
    .replace(
      '<td className="whitespace-nowrap p-2 align-top">{data.accounts',
      '<td className="max-w-48 whitespace-normal [overflow-wrap:anywhere] p-2 align-top">{data.accounts',
    );
  return source.slice(0, start) + table + source.slice(end);
}
