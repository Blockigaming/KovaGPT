export const containmentEdits = [
  [
    "kova-workspace-controls mx-auto w-full max-w-5xl",
    "kova-workspace-controls mx-auto min-w-0 w-full max-w-5xl",
  ],
  [
    "mt-6 grid gap-6 lg:grid-cols-[1.15fr_.85fr]",
    "mt-6 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]",
  ],
  [
    '<section className="rounded-2xl border p-4">',
    '<section className="min-w-0 rounded-2xl border p-4">',
  ],
  [
    '<section>\n              <h2 className="font-semibold">Saved packs',
    '<section className="min-w-0">\n              <h2 className="font-semibold">Saved packs',
  ],
  [
    'className="h-11 rounded-xl border bg-background px-3"',
    'className="min-w-0 w-full h-11 rounded-xl border bg-background px-3"',
  ],
  [
    'className="min-h-20 rounded-xl border bg-background p-3"',
    'className="min-w-0 w-full min-h-20 rounded-xl border bg-background p-3"',
  ],
  [
    'type="checkbox"\n                            checked=',
    'type="checkbox"\n                            className="shrink-0"\n                            checked=',
  ],
  ['<span className="min-w-0">', '<span className="min-w-0 flex-1">'],
  [
    'className="block truncate text-sm font-medium"',
    'className="block whitespace-normal [overflow-wrap:anywhere] text-sm font-medium"',
  ],
  [
    'className="ml-2 rounded border px-2 py-1"',
    'className="ml-2 max-w-full whitespace-normal [overflow-wrap:anywhere] rounded border px-2 py-1"',
  ],
  [
    '<h3 className="font-medium">{pack.name}</h3>',
    '<h3 className="[overflow-wrap:anywhere] font-medium">{pack.name}</h3>',
  ],
  [
    '<p className="mt-1 text-sm text-muted-foreground">\n                        {pack.description',
    '<p className="mt-1 [overflow-wrap:anywhere] text-sm text-muted-foreground">\n                        {pack.description',
  ],
];
export function contextPackContainment(source) {
  for (const [before, after] of containmentEdits) {
    if (source.split(before).length !== 2) throw new Error(`Unexpected context layout: ${before}`);
    source = source.replace(before, after);
  }
  return source;
}

export function timelineContainment(source) {
  return source
    .replace(
      "kova-workspace-controls mx-auto w-full max-w-7xl",
      "kova-workspace-controls mx-auto min-w-0 w-full max-w-7xl",
    )
    .replace(
      "grid gap-4 lg:grid-cols-[1fr_18rem]",
      "grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]",
    )
    .replace(
      'className="divide-y rounded-2xl border bg-card/30"',
      'className="min-w-0 divide-y rounded-2xl border bg-card/30"',
    )
    .replace(
      "kova-graph-resource truncate font-medium hover:underline",
      "kova-graph-resource block whitespace-normal [overflow-wrap:anywhere] font-medium hover:underline",
    )
    .replace(
      '<aside className="rounded-2xl border p-4">',
      '<aside className="min-w-0 rounded-2xl border p-4">',
    )
    .replace(
      "kova-graph-resource text-sm font-medium hover:underline",
      "kova-graph-resource block whitespace-normal [overflow-wrap:anywhere] text-sm font-medium hover:underline",
    );
}
