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
