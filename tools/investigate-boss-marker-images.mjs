// 固定真实HUD对照：仅把名牌内静态武器SVG转为隔离SVG图像；检查像素/布局与样式成本，不修改产品。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-marker-images.html', '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/jsm/"}}</script><link rel="stylesheet" href="/styles/ui.css"><link rel="stylesheet" href="/styles/mobile.css"><div id="ui-root"></div>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 778, height: 370, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:8490/releases/investigation/boss-marker-images.html');
  const setup = await page.evaluate(async () => {
    const { HUD } = await import('/src/ui/hud.js'), { G } = await import('/src/core/ctx.js');
    const ids = ['shooter', 'twins', 'spinner', 'charger', 'roller', 'brush', 'bucket', 'blaster'];
    globalThis.inkwaveMobile = {}; G.mode = 'match';
    const actors = ids.map((weaponId, i) => ({ name: `Peer${i}`, weaponId, specialReady: () => i % 2 === 0 }));
    G.match = { boss: {}, actors, state: 'playing', attract: false };
    const hud = new HUD(document.getElementById('ui-root')); hud.setVisible(true); hud.el.classList.add('is-boss');
    const frame = n => {
      hud._updMarkers(actors.map((a, i) => ({ name: a.name, weapon: a.weaponId, color: '#aa55ee', x: 45 + i * 90 + n % 13, y: 280 + i % 2 * 45, dist: 16 + n % 17, onScreen: true, tracked: false })));
      return hud.markers.map(el => { const icon = el.querySelector('.iw-mk__w'); const r = icon.getBoundingClientRect(); return [getComputedStyle(el).opacity, getComputedStyle(el).transform, r.x, r.y, r.width, r.height]; });
    };
    frame(0); await document.fonts.ready;
    const freeze = () => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 1000; } };
    freeze();
    const { createBossMarkerImages } = await import('/tools/boss-marker-image-candidate.mjs');
    const candidate = await createBossMarkerImages(hud.el);
    window.__imageProbe = {
      frame, toggle(on) { candidate.toggle(on); freeze(); return frame(0); },
      bench(n) { const start = performance.now(); for (let i = 0; i < n; i++) frame(i); return performance.now() - start; },
    };
    return candidate.setup;
  });
  const baselineState = await page.evaluate(() => __imageProbe.toggle(false));
  await page.screenshot({ path: 'releases/investigation/marker-images-original.png' });
  const candidateState = await page.evaluate(() => __imageProbe.toggle(true));
  await page.screenshot({ path: 'releases/investigation/marker-images-candidate.png' });
  const sameState = JSON.stringify(baselineState) === JSON.stringify(candidateState);
  const client = await page.createCDPSession(); await client.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const rows = [];
  try {
    for (const images of [false, true, true, false, true, false, false, true]) {
      await page.evaluate(on => { __imageProbe.toggle(on); __imageProbe.bench(30); }, images);
      const before = await metrics(), elapsedMs = await page.evaluate(() => __imageProbe.bench(240)), after = await metrics();
      const delta = key => { if (!Number.isFinite(before[key]) || !Number.isFinite(after[key])) throw Error('缺少性能字段' + key); return after[key] - before[key]; };
      rows.push({ images, frames: 240, elapsedMs, styleMs: delta('RecalcStyleDuration') * 1000, styleCount: delta('RecalcStyleCount'), layoutMs: delta('LayoutDuration') * 1000 });
    }
  } finally { await page.evaluate(() => __imageProbe.toggle(false)); }
  await page.screenshot({ path: 'releases/investigation/marker-images-restored.png' });
  const report = { methodOnly: true, phonePerformance: false, browserVersion: await browser.version(), setup, sameState, rows };
  await writeFile('releases/investigation/marker-images.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
