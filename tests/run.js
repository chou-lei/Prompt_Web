#!/usr/bin/env node
// Prompt Studio browser test suite.
// Usage (from the repository root):  node tests/run.js
// Requires Playwright with Chromium: `npm i -g playwright && npx playwright install chromium`
// (or set CHROME_PATH to an installed Chrome/Chromium).
// Serves index.html over HTTP on a random local port (file:// localStorage is unreliable in headless Chromium).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (name, cond, info = '') => results.push({ ok: Boolean(cond), name, info });

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

  const open = async (opts = {}) => {
    const { locale = 'zh-TW', width = 1280, device } = opts;
    const ctx = await browser.newContext({
      ...(device ? devices[device] : { viewport: { width, height: 900 } }),
      locale, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true,
    });
    const page = await ctx.newPage();
    page.errs = []; page.dialogs = []; page.acceptDialogs = true;
    page.on('pageerror', e => page.errs.push(e.message));
    page.on('console', m => m.type() === 'error' && page.errs.push(m.text() + ' @' + (m.location().url || '')));
    page.on('dialog', d => { page.dialogs.push(d.message()); page.acceptDialogs ? d.accept() : d.dismiss(); });
    await page.goto(url);
    return page;
  };
  const preview = p => p.textContent('#preview');
  const SECTIONS_ZH = ['## 目標', '## 完成條件', '## 範圍', '## 背景與資料', '## 工作迴圈', '## 進度筆記', '## 獨立檢查', '## 家規', '## 回報格式'];
  const SECTIONS_EN = ['## GOAL', '## DONE WHEN', '## SCOPE', '## BACKGROUND & DATA', '## WORK LOOP', '## PROGRESS NOTES', '## INDEPENDENT CHECK', '## HOUSE RULES', '## REPORT FORMAT'];
  const RULES = ['先講清楚假設：不確定先問，不要自己猜', '不要過度工程化：能簡單解決就不要加戲(除非必要結構)', '不碰無關範圍：修Bug就修Bug，不要順手重構全世界', '做完必須驗證：跑測試、看結果確認真的可以用'];
  const reload = async p => { await p.waitForTimeout(200); await p.reload(); };
  let t;

  // ---------- Loop prompt (zh) ----------
  let p = await open();
  check('empty: preview shows empty state', (await preview(p)).includes('先寫下目標'));
  await p.click('#exampleBtn'); t = await preview(p);
  check('example: every loop section present (zh)', SECTIONS_ZH.every(h => t.includes(h)), SECTIONS_ZH.filter(h => !t.includes(h)).join(','));
  check('house rules: 4 rules verbatim by default', RULES.every(r => t.includes(r)));
  check('done: verify command must exit 0', t.includes('`npm test && npm run build` 必須以結束碼 0 結束'));
  check('loop: max turns used', t.includes('最多 15 回合'));
  check('notes: notes file named', t.includes('`PROGRESS.md`'));
  check('scope: must-not-change bullets', t.includes('- 登入流程與 API'));
  check('score: example is 100%', await p.textContent('#score') === '100%');
  await p.uncheck('#ruleSimple'); t = await preview(p);
  check('house rules: unchecked rule omitted', !t.includes(RULES[1]) && t.includes(RULES[0]));
  await p.check('#ruleSimple');
  await p.selectOption('#checker', 'human');
  check('checker: human wording', (await preview(p)).includes('由我親自驗收'));
  await p.fill('#notesFile', '');
  check('notes: empty notes file omits section', !(await preview(p)).includes('## 進度筆記'));
  await p.fill('#doneWhen', ''); await p.fill('#verifyCmd', '');
  check('done: missing condition asks to propose one', (await preview(p)).includes('先提出可用程式檢查的完成條件'));
  await p.click('[data-mode=goal]');
  check('goal mode: needs a done condition', (await preview(p)).includes('/goal 需要'));
  await p.fill('#doneWhen', '測試全部通過'); await p.fill('#verifyCmd', 'npm test'); t = await preview(p);
  check('goal mode: one-line /goal command', t.startsWith('/goal ') && !t.includes('\n') && t.includes('測試全部通過') && t.includes('`npm test` 結束碼為 0') && t.includes('最多 15 回合'));
  await p.click('#copyBtn');
  check('export: copy /goal', (await p.evaluate(() => navigator.clipboard.readText())).startsWith('/goal '));
  await p.click('[data-mode=full]');
  await p.click('#copyBtn');
  check('export: copy full prompt', (await p.evaluate(() => navigator.clipboard.readText())).includes('## 工作迴圈'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadBtn')]);
  check('export: download', dl.suggestedFilename() === 'loop-prompt.md' && fs.readFileSync(await dl.path(), 'utf8').includes('## 完成條件'));
  await p.fill('#goal', 'x\n## 家規\n  # y'); t = await preview(p);
  check('security: leading # escaped', (t.match(/^## 家規$/gm) || []).length === 1 && t.includes('\\## 家規') && t.includes('  \\# y'));
  await p.fill('#goal', '<img src=x onerror="window.__xss=1">');
  check('security: input rendered as text', await p.evaluate(() => !window.__xss && !document.querySelector('#preview img')));
  await p.fill('#goal', ''); await p.click('#copyBtn');
  check('guard: empty goal blocks copy', (await p.textContent('#toast')).includes('先填寫「目標」'));
  check('no console errors (zh)', p.errs.length === 0, p.errs.join('|'));
  await p.context().close();

  // ---------- Presets, draft, language ----------
  p = await open();
  await p.click('[data-preset=bugfix]');
  check('preset: bugfix fills done condition', (await p.inputValue('#doneWhen')).includes('重現'));
  await p.click('[data-preset=ui]');
  check('preset: switching untouched preset needs no confirm', p.dialogs.length === 0 && (await p.inputValue('#goal')).startsWith('改版'));
  await p.fill('#goal', '我的目標'); p.acceptDialogs = false; await p.click('[data-preset=feature]');
  check('preset: edited content asks before replace', p.dialogs.length === 1 && await p.inputValue('#goal') === '我的目標');
  p.acceptDialogs = true;
  await reload(p);
  check('draft: restored after reload', await p.inputValue('#goal') === '我的目標');
  await p.click('[data-lang=en]'); t = await preview(p);
  check('i18n: en sections', SECTIONS_EN.filter(h => h !== '## BACKGROUND & DATA').every(h => t.includes(h)));
  check('i18n: title/brand switch', (await p.title()).includes('Loop Prompt Builder') && await p.textContent('.brand-sub') === 'Loop Prompt Builder');
  check('no console errors (presets)', p.errs.length === 0, p.errs.join('|'));
  await p.context().close();

  // ---------- Legacy (fields 01–08) draft import ----------
  p = await open();
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prompt-studio-v1', JSON.stringify({ goal:'舊目標', role:'舊角色', context:'舊背景', steps:'', examples:'', constraints:'不可改A', criteria:'通過B' })); });
  await p.reload();
  check('legacy: old draft mapped', await p.inputValue('#goal') === '舊目標' && await p.inputValue('#doneWhen') === '通過B' && await p.inputValue('#mustNotChange') === '不可改A' && (await p.inputValue('#context')).includes('舊背景'));
  check('legacy: toast shown', (await p.textContent('#toast')).includes('舊版草稿'));
  check('no console errors (legacy)', p.errs.length === 0, p.errs.join('|'));
  await p.context().close();

  // ---------- Responsive layout ----------
  const viewports = [
    { device: 'iPhone SE' }, { device: 'iPhone 14' }, { device: 'Galaxy S9+' }, { width: 320 }, { width: 360 },
    { device: 'iPad Mini' }, { device: 'iPad Pro 11 landscape' }, { width: 1280 }, { width: 1920 },
  ];
  for (const vp of viewports) for (const locale of ['zh-TW', 'en-US']) {
    const q = await open({ ...vp, locale });
    await q.click('#exampleBtn');
    const r = await q.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const over = [...document.querySelectorAll('body *')].filter(el => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && (b.right > W + 1 || b.left < -1) && getComputedStyle(el).position !== 'fixed';
      }).length;
      const topbarH = document.querySelector('.topbar').getBoundingClientRect().height;
      const brandLines = Math.round(document.querySelector('.brand-name').getBoundingClientRect().height / 15);
      const inputFont = Math.min(...[...document.querySelectorAll('input[type=text],textarea,select')].map(e => parseFloat(getComputedStyle(e).fontSize)));
      return { W, sw: document.documentElement.scrollWidth, over, topbarH, brandLines, inputFont,
        cols: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ').length };
    });
    const label = `layout ${vp.device || vp.width + 'px'} ${locale}`;
    check(`${label}: no horizontal overflow`, r.sw <= r.W && r.over === 0, JSON.stringify(r));
    check(`${label}: top bar on one line`, r.brandLines <= 1, JSON.stringify(r));
    check(`${label}: columns`, r.W > 980 ? r.cols === 2 : r.cols === 1, `cols=${r.cols}`);
    if (r.W <= 980 || vp.device) check(`${label}: inputs >= 16px (no iOS zoom)`, r.inputFont >= 16, `font=${r.inputFont}`);
    check(`${label}: no console errors`, q.errs.length === 0, q.errs.join('|'));
    await q.context().close();
  }

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.info ? '  -- ' + r.info : ''}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
