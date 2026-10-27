// 真实浏览器验证并行核心余量调查：阶段边界、只在15～45秒派发、上一份未完成不排队、负载与请求成比例、主线程派发开销、释放无泄漏。
// 运行前启动 python tools/serve.py 8490；可用 EDGE_PATH 指定浏览器。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-worker-load-probe.html', '<!doctype html><meta charset="utf-8"><body></body>');
const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8490/releases/investigation/boss-worker-load-probe.html');
  const report = await page.evaluate(async () => {
    const { createBossWorkerLoadProbe: create } = await import('/tools/boss-worker-load-probe.mjs');
    const check = (ok, why) => { if (!ok) throw Error(why); };
    const frame = () => new Promise(r => setTimeout(r, 33));
    const NativeWorker = Worker, workers = new Set(), urls = new Set(), createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
    globalThis.Worker = class extends NativeWorker { constructor(...a) { super(...a); workers.add(this); } terminate() { workers.delete(this); super.terminate(); } };
    URL.createObjectURL = b => { const u = createURL(b); urls.add(u); return u; };
    URL.revokeObjectURL = u => { urls.delete(u); revokeURL(u); };
    for (const bad of [0, 31, 2.5, NaN]) { let threw = false; try { create(bad); } catch { threw = true; } check(threw, '非法负载未拒绝：' + bad); }
    const match = { boss: {}, attract: false, state: 'playing', paused: false };
    const run = async loadMs => {
      const probe = create(loadMs), main = [];
      for (const [ms, frames] of [[0, 10], [15000, 60], [45000, 10]]) {
        for (let i = 0; i < frames; i++) { const t = performance.now(); probe.update(match, 'match', ms + i); main.push(performance.now() - t); await frame(); }
      }
      const pausedSent = probe.info().sent; match.paused = true; for (let i = 0; i < 5; i++) { probe.update(match, 'match', 20000); await frame(); } match.paused = false;
      check(probe.info().sent === pausedSent && probe.phaseNow() === 'inactive', '暂停时仍派发');
      for (let i = 0; i < 20 && probe.info().outstanding; i++) await frame();
      const info = probe.info(); probe.dispose();
      check(['baseline', 'loaded', 'restored', 'inactive'].every(p => info.transitions.some(t => t.phase === p)), '阶段不完整');
      check(info.transitions.find(t => t.phase === 'loaded').sent === 0 && info.transitions.find(t => t.phase === 'restored').sent === info.sent, '派发超出15～45秒');
      check(info.sent > 30 && info.done === info.sent && !info.error && info.outstanding === 0, '负载未完成');
      check(info.sent + info.skipped === 60, '跳过计数不守恒');
      main.sort((a, b) => a - b);
      return { loadMs, itersPerMs: info.itersPerMs, sent: info.sent, skipped: info.skipped, workerP50: info.workerMs.p50, speedRatio: info.speedRatio, mainUpdateP95Ms: +main[Math.floor(main.length * .95)].toFixed(3) };
    };
    const light = await run(4), heavy = await run(20);
    // 固定工作量：同机Worker耗时应与请求毫秒同量级、重负载明显更久；低占空比时核心降频会让轻负载偏慢，只作机制检查。
    check(light.speedRatio > .3 && light.speedRatio < 3 && heavy.speedRatio > .3 && heavy.speedRatio < 3, '工作量换算偏离请求：' + JSON.stringify({ light, heavy }));
    check(heavy.workerP50 / light.workerP50 > 1.5, '负载未随请求增加：' + JSON.stringify({ light, heavy }));
    check(light.mainUpdateP95Ms < .5 && heavy.mainUpdateP95Ms < .5, '主线程派发开销过大');
    check(workers.size === 0 && urls.size === 0, 'Worker或URL泄漏');
    return { light, heavy, scope: '阶段/暂停/不排队/比例负载/主线程派发开销/释放无泄漏通过' };
  });
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
