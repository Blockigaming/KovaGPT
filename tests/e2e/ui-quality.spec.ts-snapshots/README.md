# Core shell screenshot environment

Linux baselines use Playwright 1.56.0's Chromium and its Linux system dependencies.
The unavailable-DM-Sans cases exercise the application's `Arial, sans-serif`
fallback, which resolves to **Liberation Sans** with Ubuntu's
`fonts-liberation` 2.1.5-3 package installed (as in hosted CI).
Install the matching browser dependencies before comparing or regenerating
these baselines. A Linux environment without Liberation Sans can select DejaVu
Sans instead; the `-linux` snapshot suffix alone does not identify the font set.

The four fallback baselines were corrected after run `37696910108` at
`da7392e368da78ca033158f0ac8a787ef1e55ca8`:

- The unchanged app passed all eight font/theme/viewport snapshots with DejaVu
  Sans. Adding only the CI Liberation Sans font set reproduced all four fallback
  failures, while all four DM Sans cases still passed.
- Each reproduced fallback image was pixel-identical to the corresponding
  hosted failure artifact (`11515834037`). The corrected baselines use those
  independently reproduced images.
- Application rendering, font loading, DM Sans baselines, screenshot tolerances
  and viewport exclusions are unchanged. Snapshot maintenance is not owner
  visual approval, merge approval or deployment approval.

## Core UI refresh, October 9, 2026

The eight DM Sans/fallback × light/dark × phone/desktop baselines were refreshed
after inspecting each actual render of the updated assistant, sidebar, and composer.
The update captures the intentional compact single-line composer, circular controls,
clean monochrome navigation, and rounded account actions. Existing logo, font-loaded,
semantic-heading, hydration, and screenshot-tolerance checks remain in place.

The local run used Chromium 1194 (Playwright 1.56.0) and bundled Liberation Sans
2.1.5 through an isolated fontconfig configuration. Each test ran in a fresh browser
process because this sandbox's single-process Chromium cannot safely reuse contexts.
This is test-baseline maintenance, not owner visual approval or production deployment.
