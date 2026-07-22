# KovaGPT Observable Reference Notes

Scope: short, public-observable product notes for the Projects, Project detail, Library, and file-reuse surfaces. These notes are implementation guidance only; KovaGPT uses original code, branding, assets, and provider integrations.

## Measurements and interaction targets

- Desktop content width: keep project/library workspaces centered at roughly 1040–1180px, with chat composer/content max widths near 760–820px.
- Page padding: 16px on phones, 24px on small tablets, 32–40px on desktop. Avoid page gutters smaller than 16px.
- Heading sizes: primary page headings 24–28px desktop and 22–24px mobile; section headings 14–16px with strong weight.
- Toolbar dimensions: controls should align to 40px desktop height and 44px mobile touch height. Toolbars wrap rather than overflow.
- Card radius: cards use 14–16px corners; large panels/sheets should stay at or under 20px radius.
- Input/menu radius: compact inputs and menu items use 10–12px corners; icon buttons remain circular or 10–12px rounded.
- Tab treatment: compact pill/list tabs with clear active state, horizontal scroll on mobile, keyboard-reachable triggers.
- Empty-state structure: small icon, short heading, one-line explanation, one primary action only; no marketing hero in productivity workspaces.
- Sidebar-to-page relationship: sidebar remains visually quieter than the workspace; workspace surfaces should not fight the chat composer hierarchy.
- Project card density: show icon/color, title, one/two-line description or instructions preview, counts, role, and last activity in a compact card/row.
- File-row density: 48–56px minimum rows with filename, type/size/date, processing/indexing state, and overflow/download/remove actions.
- Mobile header/tabs: header stacks title/actions; tabs become horizontal scroll rails with 44px targets and no clipped overflow.
- Modal/sheet width: create/edit dialogs max around 520–640px desktop and full-width sheet-like behavior on mobile.
- Animation ranges: hover/press 120–160ms; standard surface transitions 160–200ms; menus/sheets 180–240ms; large reveals max 300ms.
- Light/dark contrast: use subdued neutral backgrounds, slightly raised cards, visible borders, and non-color-only status labels.

## Checkpoint decisions

- Projects overview should prefer real metadata and never show member or file indicators unless backed by actual fields.
- Project instructions are treated as durable context for project chats and need saving/failure states, not decorative text.
- Project files must expose truthful indexed/unsupported/failed states; unsupported binary files must not be labeled as indexed.
- Library must unify saved content with search/filter/sort/grid/list behavior and avoid permanent public URLs for private assets.
- Composer file reuse should attach authorized library records by ID and metadata, preserving draft text and avoiding duplicate uploads.
