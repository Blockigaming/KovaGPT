import { defineConfig, devices } from "@playwright/test";
const phone = devices["Galaxy S9+"];
const safari = devices["iPhone 14"];
const tablet = devices["iPad Pro 11"];
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "qa-part1-proof.spec.ts",
  timeout: 45000,
  workers: 2,
  use: { baseURL:"http://127.0.0.1:4189", serviceWorkers:"block", reducedMotion:"reduce" },
  webServer: {
    command:"node scripts/azure/local-preview.mjs --duration-ms=240000",
    url:"http://127.0.0.1:4189/api/health",
    timeout:20000,
  },
  projects: [
    {name:"chrome-phone",use:{...phone,browserName:"chromium"}},
    {name:"chrome-foldable",use:{...phone,browserName:"chromium"}},
    {name:"webkit-phone",use:{...safari,browserName:"webkit"}},
    {name:"webkit-tablet",use:{...tablet,browserName:"webkit"}},
  ],
});
