/**
 * Source-level notification trigger audit.
 *
 * Coverage is not inferred from a catalog entry or a passing mock. A candidate
 * must be emitted from app source, and end-to-end confirmation remains separate.
 * Run: node scripts/audit-notification-coverage.mjs [--require-complete]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTIFICATION_IDS, NOTIFICATION_GROUPS } from "../src/lib/notification-catalog.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
function walk(dir){
  let results=[];
  for (const entry of readdirSync(dir,{withFileTypes:true})){
    if(entry.isDirectory()) results.push(...walk(join(dir,entry.name)));
    else if (/\.(tsx|ts|mjs|jsx|js)$/.test(entry.name)) results.push(join(dir,entry.name));
  }
  return results;
}
const origins=walk(join(root,"src")).filter(p=>!p.includes("notification-catalog.")&&!p.includes("KovaNotificationSurface."));
const emitters=new Map(NOTIFICATION_IDS.map(id=>[id,[]]));
for(const path of origins){
  const contents=readFileSync(path,"utf8");
  // Do not count string references, test fixtures, or the global dispatcher:
  // only direct publish calls with a static, auditable event identifier.
  const pattern=/publishKovaNotice\s*\(\s*\{\s*id\s*:\s*["']([a-z0-9_]+)["']/g;
  for(const match of contents.matchAll(pattern)){
    const id=match[1];
    if(emitters.has(id)) emitters.get(id).push(relative(root,path));
  }
}
const rows=NOTIFICATION_IDS.map(id=>({
  id,
  group:Object.entries(NOTIFICATION_GROUPS).find(([,items])=>items.includes(id))?.[0],
  sourceEmitters:[...new Set(emitters.get(id))],
  sourceConnected:emitters.get(id).length>0,
  // Source presence is not runtime or CI verification. This flag is always
  // false until genuine feature+backend+browser acceptance evidence exists.
  verifiedEndToEnd:false,
}));
const connected=rows.filter(row=>row.sourceConnected);
const absent=rows.filter(row=>!row.sourceConnected);
const summary={total:rows.length,sourceConnected:connected.length,missingSourceEmitter:absent.length,verifiedEndToEnd:0};
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  process.stdout.write(JSON.stringify({summary,rows},null,2)+"\n");
  if(process.argv.includes("--require-complete")&&absent.length)process.exitCode=1;
}
export {rows,summary};
