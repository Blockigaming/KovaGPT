# Additional required-width review — 2026-10-17

> **Historical and superseded (2026-10-17):** These are dated receipts for the identified prior candidates. Current source changes require their own affected acceptance; this record does not certify the latest candidate.

Application tested: 5d45fabbc7b4441cd36e8fef0bbd61bf168bc11b. Private review controls: c63851f128c0a2533daa51742052667616b1b3d0. Cloud Chromium ordinary viewport 1180×757; CSS review frames only. No physical-device or cross-browser certification.

| CSS frame | Representative inspection                                         | Result                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 320×700   | Existing assistant, tasks error, auth, Library and Project sheets | Reused exact-revision dated evidence                                                                                                                                                        |
| 375×700   | Dark chat, drawer, Settings General                               | Readable layouts; phone-only clipped captures saved                                                                                                                                         |
| 390×844   | Existing Library, Projects, Images and task history               | Reused exact-revision dated evidence                                                                                                                                                        |
| 430×800   | Light Project directory                                           | Content width equals document scroll width; controls/cards fit                                                                                                                              |
| 768×1024  | Light conversation and open drawer                                | Keyboard activation and focus pass; backdrop corner defect found                                                                                                                            |
| 820×1180  | Light drawer                                                      | Activation works; same backdrop defect confirmed                                                                                                                                            |
| 1024×768  | Light expanded chat navigation and Settings General               | Readable columns, controls and composer; no visible overlap                                                                                                                                 |
| 1440×900  | Light pricing cards                                               | Four cards share top y369, width261, height925; each scrollWidth259 equals clientWidth259. Partial visual capture only                                                                      |
| 1920×1080 | Light Projects and pricing                                        | Project document width1920 equals scrollWidth1920. Pricing cards share top y369,width261,height925 and no card overflow. Rightmost area outside cloud viewport not fully visually certified |
| 844×390   | Light conversation and Settings General                           | Composer stays reachable; settings uses independently scrollable navigation/content and reachable close                                                                                     |

## Concrete defect and fix

The tablet drawer scrim computed border-radius999px, leaving uncovered curved corners. The broad owner-rounded-control selector had greater specificity than the later zero-radius exception. Source e24bda1b97c025305c0af2c7c26dd4d8366f90e1 excludes only .kova-sidebar-scrim from the broad selector, preserving rounded buttons/sidebar. Focused exclusion/regression tests passed. Local compilation and affected rendered retest are pending explicit build approval after the execution reviewer rejected monitoring under an older bounded no-build handoff instruction. Do not deliver the known old runtime as a final reviewed candidate.

A separate apparent768px pointer failure was isolated to the outer review frame scrolled above the browser viewport (y=-134). Enter activated the actual Open menu handler, moved focus to Close sidebar and exposed the drawer. No product breakpoint rewrite was justified. Tests cover callback idempotence and the shared1024px boundary.

## Evidence

New captures retain the 5d45fab prefix. The self-contained visual index has25 representative captures with original build labels plus all52 checklist navigation entries. It is an index, not52 separate screenshot passes. Full-page capture does not expose all horizontal pixels of a frame wider than the cloud viewport; those limits are reported rather than claimed as complete visual acceptance.

## Approved compilation and affected retest — 21:00 UTC

Owner explicitly approved the local build and inspection at20:53. The first compilation passed but omitted KOVA_BUILD_SHA; the private adapter rejected the resulting sha=unknown, so that temporary package is marked NOT-DELIVERABLE. Corrected command: `KOVA_BUILD_SHA=41530f7fbc0078ac3977ab873a04afb0dc0e1069 npm run build:azure`. Exit0; built zero-Lovable audit passed. `/api/version` independently returned sha41530f7fbc0078ac3977ab873a04afb0dc0e1069, builtAt2026-10-17T20:56:31.238Z. Private adapter source/build check passed.

Affected cloud rendered retests:768×1024 and820×1180 light drawers, plus375×700 dark drawer. All three backdrops compute radius0px and exact frame width/height; screenshots inspected after the restrained drawer transition settled. Sidebar and normal controls retain their rounded design. Phone Escape dismisses the drawer and restores Open menu focus. No remaining known defect from this bounded width pass is open.

The25-image visual index was rendered through the existing private HTTP static route and its large-image navigation checked. Final index adds current drawer/phone evidence while keeping all earlier build labels. Wide-frame/physical-device/live-service limits above remain unchanged.
