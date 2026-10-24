# Checkpoint 1b shared visual system

Review-draft source changes only. The owner’s full-pill reference supersedes the attachment’s 14px action-button and 12px mobile-footer values. Existing palette and IBM Plex families are retained.

## Authoritative geometry

`src/styles/visual-tokens.css` is imported by the application source stylesheet. The private review builder compiles that same stylesheet and imports actual shared components; it does not maintain a second geometry palette.

| Semantic token                   | Value                                         |
| -------------------------------- | --------------------------------------------- |
| button                           | 9999px (square action targets become circles) |
| input / control / sidebar row    | 14px                                          |
| compact menu item                | 10px                                          |
| card                             | 20px                                          |
| menu / popover                   | 18px                                          |
| panel / dialog                   | 24px                                          |
| composer                         | 28px                                          |
| user message                     | 20px                                          |
| code / document / browser output | 16px                                          |

The competing `:root:root` definitions, legacy parity radius declarations, broad compact-radius `!important` rule, and intermediary per-control radius-variable scheme are absent. Owned component radius declarations consume semantic tokens without `!important`. Structural zero-radius seams, range middles, scrollbar/illustration details, avatars and other small native widgets retain their distinct geometry.

Sidebar widths now live in `sidebar-core.css`: 256px expanded, 72px rail, and `min(320px, viewport minus 24px)` phone drawer. Closed desktop navigation retains zero width. Navigation rows use 14px; New chat and rail customization are actions and use the pill token. Navigation icons are 22px, creation/customization actions 20px. Sidebar gutters are 16px and ordinary row gaps 4px.

One `--kova-reading-width` token aligns conversation, composer and output actions. Existing saved choices 680/760/900 remain accepted; preference storage identity and behavior are unchanged. Numeric interface weights are normalized to supplied Plex 400/500/600.

## Action coverage and intentional exceptions

`control-geometry.css` covers ordinary native buttons, anchors with button semantics, shared Button/asChild output, explicitly marked `.kova-button` action links, public actions/primary CTAs, billing plan-action links and review toolbar/action links. Named high-specificity consumers were changed at their existing declarations, including assistant response icons, output/image actions, billing, account deletion, composer actions, public CTAs and dialog Close.

The shared Button uses44px standard/small/large targets,16px horizontal padding and8px icon gap; icon size remains44×44. A separate `prominent` variant uses48px height and20px horizontal padding. Shared Select and Tabs targets now have44px minimum geometry.

Preserved exceptions:

- Menus, options, listboxes and compact inspection rows use their own10px item geometry.
- Navigation rows use14px. Account/title rows and selected-chat surfaces remain coherent rather than gaining a second action pill.
- Tabs, segmented controls, switches, checkboxes, radios and calendar dates remain widgets. Calendar range middles stay square.
- Browser previews, sidebar scrims and whole cards are not action silhouettes. Explicit `data-kova-button-shape="preserve"` markers cover agent templates, outline navigation, recent Library choices, project choices/templates, all three onboarding card steps, Sites choices, FAQ disclosures, image presets, Kova cards, summary chat/card rows and Work run/tab surfaces.
- Explicit action-link classes cover export download, workspace/upgrade links, public CTAs, return/connect/status actions, image downloads, project back action and the bounded route inventory. Prose links and whole linked cards are unchanged.

The marker-only proof covers35 files. SettingsDialog and project-chat are deliberately excluded from that normalization proof because the lead also changed their behavior in this candidate.

## Outputs and focus

Output containers use16px corners. Phone Copy/Download actions sit in a wrapping row with8px inset and8px gap, using pill corners. Inner code content retains flat nested corners and independent horizontal scrolling. The label-reserve grid works with the lead’s actual Copy/Copying/Copied/error label stack to prevent feedback from moving controls. Table overflow hints are normal-flow13px muted text with8px padding outside the scroll region.

Broad input-modality pointer focus suppression is removed. Inputs retain a deliberate focused border and keyboard outline; composer typing surfaces retain their component-owned outer focus treatment. Settings modal Close is44px in the existing winning desktop and phone declarations.

## Interactive control sheet

Choose **Control sheet** in the private core review. Its same-origin child document exercises actual media queries and Radix portals at320/390/768/1024/1440px, with light/dark controls. It imports actual Button, Input, Textarea, Select, Checkbox, Switch, RadioGroup, Tabs, Calendar, DropdownMenu, Dialog, ResponseContentBox and ResponseMarkdown.

It includes every Button variant, enabled/disabled/loading controls, circular actions, a prominent submit, native and link actions, long labels and filenames, nested dialogs, calendar ranges, semantic whole surfaces, and delayed success/failure copy states. Copy uses an in-memory simulated writer and leaves the clipboard unchanged. Download creates only the labeled sample file. No provider/account/payment request or stored preference change is made.

## Verification boundary

Fresh recovered-source results:

- Focused source/behavior suite:156 passing,0 failing.
- Dedicated ControlSheet TypeScript check:passed.
- Shared primitives/ControlSheet ESLint:passed.
- Marker-only normalization proof:35 files passed.

These are source/behavior checks, not fresh rendered geometry evidence. The existing `core-preview-styles.test.mjs` now checks HTTP presence of both emitted stylesheets and current semantic tokens; it must run against the exact built candidate. Build, stylesheet HTTP verification, browser/theme/viewport review and physical-device behavior remain the lead’s coordinated next checks. No service acceptance or release approval is implied.
