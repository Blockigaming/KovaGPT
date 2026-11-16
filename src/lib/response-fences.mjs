// Follow top-level Markdown fence boundaries, including longer closing fences.
export function* responseFences(content) {
  let open;
  let offset = 0;
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/.exec(line);
    if (marker) {
      const [, run, suffix] = marker;
      const character = run[0];
      const info = suffix.trim();
      if (!open && (character !== "`" || !info.includes("`"))) {
        open = {
          character,
          length: run.length,
          info,
          start: offset,
          bodyStart: offset + line.length,
        };
      } else if (open && !info && open.character === character && run.length >= open.length) {
        yield {
          info: open.info,
          start: open.start,
          body: content.slice(open.bodyStart, offset),
          end: offset + line.length,
        };
        open = undefined;
      }
    }
    offset += line.length;
  }
}
