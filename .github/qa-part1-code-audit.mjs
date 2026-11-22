import assert from 'node:assert/strict';
import { chromium, webkit, devices } from '../node_modules/playwright/index.mjs';
import { expect } from '../node_modules/@playwright/test/index.mjs';
import { resolveFixtureFunctionName } from '../tests/e2e/server-function-fixture.ts';

const root = 'http://127.0.0.1:4189';
const version = await (await fetch(root + '/api/version')).json();
assert.equal(version.sha, process.env.KOVA_CODE_AUDIT_HEAD);
const owner = '22222222-2222-4222-8222-222222222222';
const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const epoch = '44444444-4444-4444-8444-444444444444';
const prompt = 'Physical device QA fixture';
const draft = 'Keep this signed-in draft during layout changes.';
const multilingual = 'مرحبا بالعالم · שלום · 日本語 · 👩🏽‍💻';
const timestamp = Date.now();
const session = {
  accountId: owner, sessionId: '33333333-3333-4333-8333-333333333333',
  email: 'device-qa@example.invalid', emailVerified: true, displayName: 'Device QA',
  assuranceLevel: 'aal1', expiresAt: new Date(timestamp + 3600000).toISOString(),
};
const chat = {
  id: chatId, revision: 1, sync_version: 1, mutation_id: '55555555-5555-4555-8555-555555555555',
  archived: false, deleted_at: null,
  payload: {
    id: chatId, title: 'Device verification', mode: 'instant',
    updatedAt: timestamp, createdAt: timestamp,
    messages: [
      { id: 'prompt-a', role: 'user', content: prompt },
      { id: 'answer-a', role: 'assistant', content: multilingual },
    ],
  },
};
const cases = [
  { engine: 'chromium', name: 'Phone Chrome', device: 'Galaxy S9+', sizes: [[360,740],[360,788],[360,740],[740,360],[360,740]] },
  { engine: 'chromium', name: 'Foldable Chrome', device: 'Galaxy S9+', sizes: [[360,820],[768,880],[576,880],[884,768],[360,820]] },
  { engine: 'webkit', name: 'iPhone WebKit', device: 'iPhone 14', sizes: [[390,844],[390,892],[390,844],[844,390],[390,844]] },
  { engine: 'webkit', name: 'iPad WebKit', device: 'iPad Pro 11', sizes: [[834,1194],[507,1194],[320,1194],[1194,834],[834,1194]] },
].filter(item => !process.env.KOVA_CODE_AUDIT_ENGINE || item.engine === process.env.KOVA_CODE_AUDIT_ENGINE);

async function simulateDevice(browser, options) {
  const { defaultBrowserType, ...descriptor } = devices[options.device];
  const [width, height] = options.sizes[0];
  const context = await browser.newContext({ ...descriptor, viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('kova-theme-mode', 'dark'));
    const activity = { history: 0 };
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== root) return route.abort('blockedbyclient');
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { session } });
      if (url.pathname === '/api/auth/token') return route.fulfill({ json: { session, accessToken: 'test-only', expiresIn: 3600 } });
      if (url.pathname === '/api/chat/history') {
        activity.history += 1;
        return route.fulfill({
          json: {
            ownerId: owner, epoch,
            records: Number(url.searchParams.get('cursor')) < 1 ? [chat] : [],
            nextCursor: 1, currentVersion: 1, hasMore: false,
          },
        });
      }
      if (url.pathname.startsWith('/_serverFn/')) {
        const name = resolveFixtureFunctionName(url.pathname.split('/').at(-1)) ?? '';
        let result = [];
        if (name.startsWith('getMyPlanTier_')) result = { ownerId: owner, tier: 'free' };
        if (name.startsWith('getMyDailyUsage_')) result = { chats: 0, images: 0, uploads: 0 };
        return route.fulfill({ json: { result, context: {} } });
      }
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/version')
        return route.fulfill({ json: {} });
      return route.continue();
    });
    await page.goto(root, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-kova-hydration','ready',{timeout:25000});
    await expect.poll(() => activity.history, {timeout:10000}).toBeGreaterThan(0);
    const open = page.getByRole('button',{name:'Open menu',exact:true});
    if (await open.isVisible()) await open.click();
    await page.getByRole('button',{name:'Device verification',exact:true}).click();
    await expect(page.getByText(multilingual,{exact:true})).toBeVisible();
    const input = page.getByRole('textbox',{name:'Message KovaGPT'});
    await input.fill(draft);
    await input.blur();
    const send = page.getByRole('button',{name:'Send message'});
    const shell = page.locator('.kova-assistant[data-ui="modern"]');
    const sizes = [];
    for (const [w,h] of options.sizes) {
      await page.setViewportSize({width:w,height:h});
      await expect.poll(async () => Math.round((await shell.boundingBox())?.height ?? 0)).toBe(h);
      await expect(input).toHaveValue(draft);
      await expect(send).toBeInViewport({ratio:1});
      const computed = await page.locator('html').evaluate(node => ({
        viewport: node.clientWidth, scroll: node.scrollWidth,
      }));
      assert.equal(computed.scroll,computed.viewport,options.name + ' overflow');
      sizes.push(w+'×'+h);
    }
    await page.setViewportSize({width:320,height:568});
    for (const size of [16,24,32]) {
      await page.locator('html').evaluate((node,n)=>node.style.setProperty('--kova-native-font-size', n+'px'),size);
      await expect(input).toHaveCSS('font-size',size+'px');
      await expect(input).toHaveValue(draft);
      await expect(send).toBeInViewport({ratio:1});
    }
    if (options.engine === 'webkit') {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('data-kova-hydration','ready',{timeout:25000});
      await expect(page.getByText(multilingual,{exact:true})).toBeVisible();
      await expect(input).toHaveValue(draft);
      await expect(page.getByText('Chat history could not be saved on this device.',{exact:false})).toHaveCount(0);
      const idbSaved = await page.evaluate(async (id) => {
        const request = indexedDB.open('kovagpt-chat-history-v1', 1);
        const db = await new Promise((resolve,reject) => {
          request.onsuccess=()=>resolve(request.result);
          request.onerror=()=>reject(request.error);
        });
        try {
          const tx = db.transaction('records','readonly');
          return await new Promise((resolve,reject)=>{
            const rec=tx.objectStore('records').get(id);
            rec.onsuccess=()=>resolve(Boolean(rec.result));
            rec.onerror=()=>reject(rec.error);
          });
        } finally { db.close(); }
      }, [owner,chatId]);
      assert.equal(idbSaved,true,'Actual WebKit IndexedDB should contain the downloaded chat');
    }
    console.log('PASS',options.name,sizes.join(' → '),'draft, Send, no overflow, multilingual thread, 16/24/32px',options.engine==='webkit'?'and WebKit IndexedDB after reload':'');
  } finally {
    await context.close();
  }
}
const failed = [];
for (const engine of [...new Set(cases.map(item=>item.engine))]) {
  try {
    const browser = engine === 'chromium'
      ? await chromium.launch()
      : await webkit.launch();
    try {
      for (const options of cases.filter(item=>item.engine===engine)) {
        try { await simulateDevice(browser,options); }
        catch(error) { failed.push(options.name); console.error('FAIL',options.name,error); }
      }
    } finally { await browser.close(); }
  } catch(error) { failed.push(engine); console.error('FAIL',engine,error); }
}
assert.equal(failed.length,0,failed.join(', '));
console.log('Exact PR build:',version.sha);
