import { readFileSync, writeFileSync } from "node:fs";
import { formatEvidenceLevel } from "./report-evidence.mjs";
const root = new URL("../../docs/interface-2026-09-19/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
const report = read("phase-a-progress.json"),
  history = read("phase-a-history.json"),
  observations = read("source-observations.json"),
  register = read("page-register.json");
const excludedStatuses = new Set(["MERGED_REFERENCE", "EXCLUDED_PROVIDER", "EXCLUDED_CODEX"]),
  activePages = register.pages.filter((page) => !excludedStatuses.has(page.completion_status)),
  benchmarkPages = activePages.filter((page) => page.batch === "B01 Benchmarks"),
  benchmarkDrafts = benchmarkPages.filter(
    (page) => page.completion_status === "DRAFT_CODE_UNVERIFIED",
  ).length,
  benchmarkAccepted = benchmarkPages.filter((page) => page.visual_accepted === "True").length,
  completedPages = activePages.filter((page) => page.completion_status === "COMPLETE").length,
  phaseCPercentage = activePages.length ? (completedPages / activePages.length) * 100 : 0,
  formattedPhaseCPercentage = `${phaseCPercentage.toFixed(2).replace(/\.00$/, "")}%`;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const registerPagesById = new Map(register.pages.map((page) => [page.page_id, page]));
const rows = report.historical.categories
  .map(
    (c) =>
      `<tr><th scope="row">${escape(c.name)}</th><td>${c.weight}%</td><td>${c.completed} / ${c.required}</td><td>${c.earned_points.toFixed(6)}</td></tr>`,
  )
  .join("");
const steps = history
  .map(
    (s) =>
      `<tr><th scope="row">${s.step}</th><td>${escape(s.label)}</td><td>${s.report.current.active_targets}</td><td>${s.report.current.unresolved_public_candidates}</td><td>${s.report.current.unresolved_app_definitions}</td><td>${s.report.current.newly_documented_source_pages}</td><td>${s.historical_point_delta}</td></tr>`,
  )
  .join("");
const sourceRows = observations.pages
  .map((p) => {
    const registerPage = registerPagesById.get(p.page_id);
    if (!registerPage) throw new Error(`Missing register entry for observation ${p.page_id}`);
    return `<tr><th scope="row">${escape(p.page_id)}</th><td><a href="${escape(p.source_url)}" target="_blank" rel="noopener noreferrer">${escape(new URL(p.source_url).pathname)}</a></td><td>${escape(p.observed_purpose)}</td><td>${escape(formatEvidenceLevel(registerPage))}</td></tr>`;
  })
  .join("");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KovaGPT · Phase A progress</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fb;color:#172333;font:15px/1.6 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:48px 24px}h1{font-size:clamp(34px,5vw,60px);font-weight:550;line-height:1.08;letter-spacing:-.045em;margin:18px 0}h2{font-size:26px;font-weight:550;letter-spacing:-.02em;margin:0 0 16px}p{max-width:850px}.eyebrow{color:#275ba0;text-transform:uppercase;font-size:12px;font-weight:650;letter-spacing:.12em}.muted{color:#596b80}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:30px 0}.card,section{background:white;border:1px solid #dce3ed;border-radius:18px;padding:24px}.card strong{display:block;font-size:34px;line-height:1.3;font-weight:550;letter-spacing:-.035em}.card span{color:#52657b;font-size:13px}.accent{background:#eaf2ff;border-color:#c9dcf8}section{margin:24px 0}.table{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th,td{padding:13px 12px;border-bottom:1px solid #e5eaf0;vertical-align:top}thead th{color:#566b83;font-size:12px}tbody th{font-weight:550}a{color:#225b9f;text-underline-offset:3px}input{width:100%;max-width:550px;min-height:44px;padding:10px 14px;border:1px solid #b6c6da;border-radius:9px;font:inherit;margin:10px 0 18px}:focus-visible{outline:3px solid #79a9ef;outline-offset:3px}.note{padding-left:16px;border-left:3px solid #6093dd}li{margin:9px 0}footer{padding:10px 0 30px;color:#5b6d82;font-size:13px}@media(max-width:600px){main{padding:28px 16px}section,.card{padding:18px}th,td{padding:10px 8px}}
</style></head><body><main><div class="eyebrow">KovaGPT Interface / Phase A / 19 September 2026</div><h1>Progress you can trace.</h1><p class="muted">Every completed work step has a recorded calculation. Source discovery, text specifications and visual acceptance remain separate evidence levels.</p><p><a href="page-register.json">Open numbered page register</a> · <a href="writing-family-spec.md">Writing specification</a> · <a href="news-family-spec.md">News specification</a></p>
<div class="grid"><div class="card accent"><span>Current Phase A percentage</span><strong>Not yet scorable</strong><span>Expanded denominators and carried credits need reconciliation.</span></div><div class="card"><span>Historical Phase A · 212-page scope</span><strong>${report.historical.percentage.toFixed(7)}%</strong><span>Exact fraction ${report.historical.fraction}; not current completion.</span></div><div class="card"><span>Phase B</span><strong>${benchmarkDrafts} ${benchmarkDrafts === 1 ? "draft" : "drafts"}</strong><span>${benchmarkPages.length} benchmark pages; ${benchmarkAccepted} visually accepted.</span></div><div class="card"><span>Phase C</span><strong>${formattedPhaseCPercentage}</strong><span>${completedPages} of ${activePages.length} active pages have final production acceptance.</span></div></div>
<div class="grid"><div class="card"><strong>${report.current.active_targets}</strong><span>Provisional active targets / ${report.current.tracked_records} stable records</span></div><div class="card"><strong>${report.current.unresolved_public_candidates}</strong><span>Public candidates needing eligibility review</span></div><div class="card"><strong>${report.current.unresolved_app_definitions}</strong><span>App definitions awaiting disposition</span></div><div class="card"><strong>${report.current.newly_documented_source_pages}</strong><span>Active pages with new text observations, plus one retained alias</span></div></div>
<section><h2>Step-by-step ledger</h2><p class="muted">The points column reports change to the historical score, which remains frozen. Current readiness points cannot be calculated from text-review counts. Lower pending counts describe scope work, not completed pages.</p><div class="table"><table><thead><tr><th>Step</th><th>Completed work</th><th>Targets</th><th>Public pending</th><th>App pending</th><th>Active text reviews</th><th>Historical Δ</th></tr></thead><tbody>${steps}</tbody></table></div></section>
<section><h2>Original nine-part calculation</h2><p class="note">Historical evidence is preserved for audit. The 44 capture credits are not 44 newly inspected or newly accepted images. They must be reconciled with the current register before reuse.</p><div class="table"><table><thead><tr><th>Category</th><th>Weight</th><th>Historical credit / total</th><th>Earned points</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section><h2>What prevents a current percentage?</h2><ul>${report.current.blockers.map((x) => `<li>${escape(x)}</li>`).join("")}</ul><p class="note">The browser connection timed out while setting up source capture and again on one retry. This pass produced no new screenshots. The overview preview has a new composition; visual acceptance remains pending.</p></section>
<section><h2>Source observations</h2><label for="filter">Find a page by ID, path or purpose</label><br><input id="filter" type="search" placeholder="Try writing, education, or KOVA-0537"><p id="result-count" class="muted" aria-live="polite">${observations.pages.length} records</p><div class="table"><table><thead><tr><th>Stable ID</th><th>Primary source</th><th>Purpose</th><th>Evidence level</th></tr></thead><tbody id="source-rows">${sourceRows}</tbody></table></div></section>
<footer>Nothing in this report approves a student offer, voice capability, new provider or publication of source company claims. The overview composition and example entry points were updated separately; no merge or deployment occurred.</footer></main><script>const filter=document.getElementById('filter'),rows=[...document.querySelectorAll('#source-rows tr')];filter.addEventListener('input',()=>{const q=filter.value.trim().toLowerCase();let visible=0;for(const row of rows){row.hidden=!row.textContent.toLowerCase().includes(q);if(!row.hidden)visible++}document.getElementById('result-count').textContent=visible+' of '+rows.length+' records'});</script></body></html>`;
writeFileSync(new URL("phase-a-progress.html", root), page);
console.log("Rendered offline Phase A report");
