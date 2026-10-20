// 【中文导读】批量Boss实验台截帧：一个浏览器顺序处理多份job，输出单图和按固定步进拼接的序列图。
// job.go是实验台参数，eval为可信页面脚本；shot与film生成不同产物，frame步进单位以job契约为准。
// 输出目录会创建并写图；失败、信号或正常完成都应关闭浏览器，避免后台仍持续渲染。
// 当前默认Chrome路径面向macOS，工具语法通过不代表已经在Windows完成实际截帧。
// Boss-lab capture: ONE headless Chrome, a list of jobs → stills + filmstrips. Always closes the browser.
// usage: node tools/boss-lab.film.mjs <jobs.json | inline-json> [--out /private/tmp/boss/art] [--w 1600 --h 900]
// job: { name, go: {preset, t, cam, phase, light, q, ...}, shot?: true, film?: {n, dt, cols, w, h}, eval?: "js" }
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const raw = args[0];
const jobs = JSON.parse(existsSync(raw) ? readFileSync(raw, 'utf8') : raw);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/private/tmp/boss/art'), W = +opt('w', 1600), H = +opt('h', 900);
const URL = opt('url', 'http://localhost:8490/tools/boss-lab.html?ui=0');
mkdirSync(OUT, { recursive: true });

let browser = null;
const kill = async () => { try { if (browser) await browser.close(); } catch {} browser = null; };
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, async () => { await kill(); process.exit(1); });
process.on('uncaughtException', async (e) => { console.error(e); await kill(); process.exit(1); });

try {
  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warn' || t === 'warning' || process.env.ALLLOGS) logs.push(`[${t}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));
  await page.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.lab && window.lab.ready', { timeout: 180000, polling: 200 });
  await page.evaluate('window.lab.boss.ready');
  for (const j of jobs) {
    const t0 = Date.now();
    if (j.go) { const info = await page.evaluate((g) => window.lab.go(g), j.go); console.log(j.name, JSON.stringify(info)); }
    if (j.eval) { const r = await page.evaluate(j.eval); if (r !== undefined) console.log(j.name, 'eval ->', typeof r === 'string' ? r.slice(0, 2000) : JSON.stringify(r)); }
    if (j.shot) { await page.screenshot({ path: `${OUT}/${j.name}.png` }); console.log('shot', `${OUT}/${j.name}.png`); }
    if (j.film) {
      const url = await page.evaluate((f, label) => window.lab.film({ ...f, label }), j.film, j.name);
      writeFileSync(`${OUT}/${j.name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
      console.log('film', `${OUT}/${j.name}.jpg`, ((Date.now() - t0) / 1000).toFixed(1) + 's');
    }
  }
  if (logs.length) console.log(logs.filter((l) => !/404|preload/.test(l)).slice(0, 40).join('\n'));
} finally {
  await kill();
}
