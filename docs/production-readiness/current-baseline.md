# Current local release baseline

Revalidated 2026-08-12 on branch `work`. The checkout began at squashed aggregate `8818118aa148d368a8c9ac35b3e3c2f8c373feea`; it contains the prior production-readiness work although standalone `f6e959e...` is not present in this rewritten history. Executable staging tooling commit: `1eca5d8bceacded4e2b4840004b5c990f0854502`.

| Gate                    |     Baseline |
| ----------------------- | -----------: |
| Unit                    |      301/301 |
| API                     |          9/9 |
| Integration, twice      | 285/285 each |
| Browser runtime         |          5/5 |
| Accessibility           |          1/1 |
| Visual unit             |          1/1 |
| Runtime routes          |      119/119 |
| Public screenshots      |        12/12 |
| Application screenshots |        16/16 |
| Exact parity subset     |        27/27 |
| Staging validators      |        10/10 |
| Production contracts    |          4/4 |
| Sitemap entries         |           24 |
| Inventory dispositions  |          132 |

Both builds, typecheck, lint (0 errors/0 warnings), changed-file formatting, diff checks, and `npm audit --omit=dev` (0 vulnerabilities) passed. Runtime QA used the generation-disabled local server. Browser installation initially lacked the current Playwright binary/system libraries; installing Chromium through the repository Playwright workflow resolved the environment limitation and the 5/5 browser suite then passed.

Deterministic staging orchestration executed 6 local phases (environment contract, artifact, model catalog, environment diff, callback/domain, Azure fixture preflight) with no blockers. Six credential-backed orchestration phases were correctly reported `NOT EXECUTED — EXTERNAL CREDENTIAL REQUIRED`; no live staging or production validation is claimed.
