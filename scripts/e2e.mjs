// End-to-end check in a real browser: loads the built app from a running server, reads all
// four samples, checks the extracted fields, exports, and records every network request to
// prove nothing leaves the origin. Uses an installed Chromium (Edge or Chrome) through
// playwright-core — no browser download.
//
//   PORT=3101 node build/server/index.js &
//   node scripts/e2e.mjs [http://127.0.0.1:3101/demo/ocr/]
//
// BROWSER_PATH overrides the browser executable.

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:3101/demo/ocr/';
const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chromium-family browser found; set BROWSER_PATH');

mkdirSync('test-results', { recursive: true });
const origin = new URL(URL_).origin;

const EXPECT = {
  'lv-veikals.png': { merchant: /Daugavas Bode/, date: '2026-09-28', total: '12.46', items: 7 },
  'invoice-en.pdf': { merchant: /Northwind Studio SIA/, date: '2026-09-12', total: '3061.30', items: 4 },
  'kafejnica-photo.jpg': { merchant: /ZIEDONIS/i, date: '2026-09-27', total: '21.60', items: 5 },
  'rekins-scan.pdf': { merchant: /Kurzemes Koks/, date: '2026-09-03', total: '211.02', items: 3 },
};

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();

const offOrigin = [];
const consoleErrors = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) offOrigin.push(u);
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
});

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'test-results/01-landing.png' });

let failures = 0;
const results = {};
for (const [i, name] of Object.keys(EXPECT).entries()) {
  const t0 = Date.now();
  await page.click(`[data-sample="${i}"]`);
  const tab = page.locator('.tab', { hasText: name });
  await tab.waitFor();
  await page.waitForFunction(
    (n) => {
      const t = [...document.querySelectorAll('.tab')].find((el) => el.textContent.includes(n));
      return t && !t.querySelector('.dot.is-busy');
    },
    name,
    { timeout: 180_000 },
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const got = await page.evaluate(() => {
    const v = (k) => document.getElementById(`f-${k}`)?.value ?? null;
    return {
      merchant: v('merchant'),
      date: v('date'),
      currency: v('currency'),
      subtotal: v('subtotal'),
      vatRate: v('vatRate'),
      vatAmount: v('vatAmount'),
      total: v('total'),
      items: [...document.querySelectorAll('#rows tr[data-row]')].map((tr) =>
        [...tr.querySelectorAll('input')].map((i) => i.value).join(' | '),
      ),
      checks: [...document.querySelectorAll('#checks li')].map((li) => `${li.className.replace('check ', '')}: ${li.textContent.trim()}`),
      error: document.querySelector('.error-box')?.textContent?.trim() ?? null,
      badges: document.querySelector('.source-badges')?.textContent?.trim(),
      raw: document.querySelector('.raw pre')?.textContent ?? '',
    };
  });
  const exp = EXPECT[name];
  const problems = [];
  if (got.error) problems.push(`error: ${got.error}`);
  if (!exp.merchant.test(got.merchant ?? '')) problems.push(`merchant ${got.merchant}`);
  if (got.date !== exp.date) problems.push(`date ${got.date}`);
  if (got.total !== exp.total) problems.push(`total ${got.total}`);
  if (got.items.length !== exp.items) problems.push(`items ${got.items.length}`);
  results[name] = { secs, ...got, problems };
  console.log(`\n=== ${name} (${secs}s) ${problems.length ? 'MISMATCH: ' + problems.join('; ') : 'OK'}`);
  console.log(`  ${got.badges}`);
  console.log(`  merchant=${got.merchant} date=${got.date} cur=${got.currency} sub=${got.subtotal} vat%=${got.vatRate} vat=${got.vatAmount} total=${got.total}`);
  for (const it of got.items) console.log(`  - ${it}`);
  for (const c of got.checks) console.log(`  ${c}`);
  if (problems.length) failures++;
  if (problems.length || process.env.RAW) {
    console.log('  --- raw ---\n' + got.raw.split('\n').map((l) => '  | ' + l).join('\n'));
  }
  await page.screenshot({ path: `test-results/02-${name}.png`, fullPage: false });
}

// hover a row: the source highlight appears
await page.hover('#rows tr[data-row="0"] input[data-cell="description"]');
const hl = await page.locator('.hl.on').count();
console.log(`\nhighlight on hover: ${hl ? 'yes' : 'NO'}`);
if (!hl) failures++;

// edit a cell and watch the check react
await page.click('[data-sample="0"]');
await page.waitForSelector('#rows tr[data-row="3"]');
const cellSel = '#rows tr[data-row="3"] input[data-cell="total"]';
await page.fill(cellSel, '4,39');
const warn = await page.locator('#checks .check.warn').first().textContent();
console.log(`after editing a line total: ${warn?.trim()}`);
await page.fill(cellSel, '4,59');
await page.locator(cellSel).blur();
const okAgain = await page.locator('#checks .check.ok').first().textContent();
console.log(`after restoring it: ${okAgain?.trim()}`);
await page.screenshot({ path: 'test-results/03-edited.png' });

// exports
for (const kind of ['csv', 'json', 'xlsx']) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-export="${kind}"]`)]);
  const path = `test-results/export.${kind}`;
  await dl.saveAs(path);
  const buf = readFileSync(path);
  console.log(`export ${kind}: ${dl.suggestedFilename()} ${buf.length} bytes`);
  if (kind === 'csv') console.log('  ' + buf.toString('utf8').split('\r\n').slice(0, 3).join('\n  '));
  if (kind === 'xlsx' && buf.readUInt32LE(0) !== 0x04034b50) {
    console.log('  xlsx is not a zip!');
    failures++;
  }
}

// error state: a file that is not a document
await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
await page.waitForSelector('.error-box');
console.log(`error state: ${(await page.locator('.error-box').textContent()).trim().replace(/\s+/g, ' ')}`);

// mobile layout
await page.setViewportSize({ width: 375, height: 812 });
await page.click('[data-sample="0"]');
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: 'test-results/04-mobile-top.png' });
await page.screenshot({ path: 'test-results/05-mobile-full.png', fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(`mobile horizontal overflow: ${overflow}px`);
if (overflow > 0) failures++;

console.log(`\noff-origin requests: ${offOrigin.length ? offOrigin.join(', ') : 'none'}`);
console.log(`console errors: ${consoleErrors.length ? '\n  ' + consoleErrors.join('\n  ') : 'none'}`);
if (offOrigin.length) failures++;

await browser.close();
console.log(failures ? `\n${failures} problem(s)` : '\nall good');
process.exit(failures ? 1 : 0);
