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
  const PILLARS_ZH = ['## 一、規則與上下文', '## 二、多步驗證迴圈', '## 三、自動化測試與交付', '## 四、人類設計，AI 執行'];
  const PILLARS_EN = ['## 1. RULES & CONTEXT', '## 2. MULTI-STEP VERIFICATION LOOP', '## 3. AUTOMATED TESTING & DELIVERY', '## 4. HUMANS DESIGN, AI EXECUTES'];
  const RULES = ['先講清楚假設：不確定先問，不要自己猜', '不要過度工程化：能簡單解決就不要加戲(除非必要結構)', '不碰無關範圍：修Bug就修Bug，不要順手重構全世界', '做完必須驗證：跑測試、看結果確認真的可以用'];
  const reload = async p => { await p.waitForTimeout(200); await p.reload(); };
  let t;

  // ---------- Page structure ----------
  let p = await open();
  check('structure: four pillars in the form', (await p.$$eval('.pillar-title', els => els.map(e => e.textContent))).join('|') === '定義規則與上下文|多步驗證迴圈|自動化測試與交付|人類設計，AI 執行');
  check('structure: past vs now comparison', (await p.textContent('.compare')).includes('找最佳 Prompt') && (await p.textContent('.compare')).includes('人類設計，AI 執行'));
  check('copy: plain headline + /goal explained', (await p.textContent('h1')).includes('AI 照著做到完') && (await p.textContent('[data-i18n=goalNote]')).includes('Claude Code 的指令'));
  check('empty: preview shows empty state', (await preview(p)).includes('任務單就會出現在這裡'));

  // ---------- Loop spec (zh) ----------
  await p.click('#exampleBtn'); t = await preview(p);
  check('spec: four pillar sections in order (zh)', PILLARS_ZH.every(h => t.includes(h)) && PILLARS_ZH.map(h => t.indexOf(h)).every((x, i, a) => i === 0 || x > a[i - 1]));
  check('house rules: 4 rules verbatim by default', RULES.every(r => t.includes(r)));
  check('steps: each step has its own check', t.includes('1. 寫一個 390px 寬、鍵盤開啟的測試 — 檢查: 測試先失敗') && t.includes('3. 回歸檢查 — 檢查: npm test 全部通過'));
  check('loop: max turns + failure policy', t.includes('最多 15 回合') && t.includes('連續失敗 2 次就換方法'));
  check('notes: notes file named', t.includes('`PROGRESS.md`'));
  check('verify: command must exit 0', t.includes('`npm test && npm run build` 結束碼為 0'));
  check('delivery: local commit + must pass first', t.includes('在本機分支上 commit，不推送、不部署。') && t.includes('沒通過就不交付'));
  check('human: default approvals listed', ['讓網站上線、正式發布（部署、推送到 main）', '刪除檔案、資料或分支', '花錢、購買、付費服務', '寄信、發訊息、發文'].every(x => t.includes(x)) && !t.includes('安裝新軟體或套件'));
  check('human: escalation rules', t.includes('何時停下來問我'));
  check('score: example is 100%', await p.textContent('#score') === '100%');
  await p.uncheck('#ruleSimple'); t = await preview(p);
  check('house rules: unchecked rule omitted', !t.includes(RULES[1]) && t.includes(RULES[0]));
  await p.check('#ruleSimple');
  await p.check('#askInstall'); await p.fill('#otherApprovals', '改資料庫');
  t = await preview(p);
  check('human: extra approvals', t.includes('安裝新軟體或套件') && t.includes('- 改資料庫'));
  await p.selectOption('#delivery', 'pr'); await p.selectOption('#checker', 'human'); t = await preview(p);
  check('delivery/checker options change text', t.includes('開 PR，不合併') && t.includes('由我親自驗收'));
  await p.fill('#steps', '只有步驟');
  check('steps: missing check asks for one', (await preview(p)).includes('只有步驟 — 檢查: 先說明你會怎麼檢查'));
  await p.fill('#steps', '');
  check('steps: empty asks to split work', (await preview(p)).includes('先把工作拆成 2–5 步'));
  await p.fill('#notesFile', '');
  check('notes: empty notes file omitted', !(await preview(p)).includes('PROGRESS.md'));
  await p.fill('#doneWhen', ''); await p.fill('#verifyCmd', '');
  check('done: missing condition asks to propose one', (await preview(p)).includes('先提出可用程式檢查的完成條件'));
  await p.click('[data-mode=goal]');
  check('goal mode: needs a done condition', (await preview(p)).includes('一行版需要'));
  await p.fill('#verifyCmd', 'npm test'); t = await preview(p);
  check('goal mode: one-line /goal command', t.startsWith('/goal ') && !t.includes('\n') && t.includes('`npm test` 結束碼為 0') && t.includes('最多 15 回合') && t.includes('以下先問我：讓網站上線'));
  await p.click('#copyBtn');
  check('export: copy /goal', (await p.evaluate(() => navigator.clipboard.readText())).startsWith('/goal '));
  await p.click('[data-mode=full]'); await p.click('#copyBtn');
  check('export: copy full spec', (await p.evaluate(() => navigator.clipboard.readText())).includes('## 二、多步驗證迴圈'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadBtn')]);
  check('export: download', dl.suggestedFilename() === 'loop-spec.md' && fs.readFileSync(await dl.path(), 'utf8').includes('## 四、人類設計，AI 執行'));
  await p.fill('#goal', 'x\n## 四、人類設計，AI 執行\n  # y'); t = await preview(p);
  check('security: leading # escaped', (t.match(/^## 四、人類設計，AI 執行$/gm) || []).length === 1 && t.includes('\\## 四') && t.includes('  \\# y'));
  await p.fill('#goal', '<img src=x onerror="window.__xss=1">');
  check('security: input rendered as text', await p.evaluate(() => !window.__xss && !document.querySelector('#preview img')));
  await p.fill('#goal', ''); await p.click('#copyBtn');
  check('guard: empty goal blocks copy', (await p.textContent('#toast')).includes('請先填「要完成什麼？」'));
  check('no console errors (zh)', p.errs.length === 0, p.errs.join('|'));
  await p.context().close();

  // ---------- Presets, draft, language ----------
  p = await open();
  await p.click('[data-preset=bugfix]');
  check('preset: bugfix fills steps with checks', (await p.inputValue('#steps')).includes('| 測試先失敗'));
  await p.click('[data-preset=research]');
  check('preset: untouched switch needs no confirm', p.dialogs.length === 0 && await p.inputValue('#delivery') === 'report');
  await p.fill('#goal', '我的目標'); p.acceptDialogs = false; await p.click('[data-preset=feature]');
  check('preset: edited content asks before replace', p.dialogs.length === 1 && await p.inputValue('#goal') === '我的目標');
  p.acceptDialogs = true;
  await reload(p);
  check('draft: restored after reload', await p.inputValue('#goal') === '我的目標');
  await p.click('[data-lang=en]'); t = await preview(p);
  check('i18n: en pillar sections', PILLARS_EN.every(h => t.includes(h)) && t.includes('State assumptions first'));
  check('i18n: title/brand switch', (await p.title()).includes('Loop Spec Designer') && await p.textContent('.brand-sub') === 'Loop Spec Designer');
  check('no console errors (presets)', p.errs.length === 0, p.errs.join('|'));
  await p.context().close();

  // ---------- Older draft import ----------
  p = await open();
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prompt-studio-loop-v1', JSON.stringify({ goal:'L1目標', doneWhen:'L1完成', verifyCmd:'npm test', mustNotChange:'L1不可改', maxTurns:'9', checker:'fresh', ruleSimple:false })); });
  await p.reload();
  check('import: loop v1 draft mapped', await p.inputValue('#goal') === 'L1目標' && await p.inputValue('#projectRules') === 'L1不可改' && await p.inputValue('#verifyCmd') === 'npm test' && await p.inputValue('#maxTurns') === '9' && await p.inputValue('#checker') === 'fresh' && !(await p.isChecked('#ruleSimple')));
  check('import: toast shown', (await p.textContent('#toast')).includes('舊版填的內容'));
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('prompt-studio-v1', JSON.stringify({ goal:'舊目標', role:'舊角色', context:'舊背景', steps:'步驟A', examples:'', constraints:'不可改A', criteria:'通過B' })); });
  await p.reload();
  check('import: original 01–08 draft mapped', await p.inputValue('#goal') === '舊目標' && await p.inputValue('#doneWhen') === '通過B' && await p.inputValue('#projectRules') === '不可改A' && await p.inputValue('#steps') === '步驟A' && (await p.inputValue('#context')).includes('舊背景'));
  check('no console errors (import)', p.errs.length === 0, p.errs.join('|'));
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
