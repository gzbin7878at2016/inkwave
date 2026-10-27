// 桌面固定HUD方法实验：仅在临时页面CSSOM移除菜单属性选择器，再原位恢复；不修改产品CSS。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-style-selector.html', '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/jsm/"}}</script><link rel="stylesheet" href="/styles/ui.css"><link rel="stylesheet" href="/styles/mobile.css"><div id="ui-root"></div>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 778, height: 370, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:8490/releases/investigation/boss-style-selector.html');
  const setup = await page.evaluate(async () => {
    const { HUD } = await import('/src/ui/hud.js'), { G } = await import('/src/core/ctx.js');
    globalThis.inkwaveMobile = {}; G.mode = 'match';
    const actors = Array.from({ length: 8 }, (_, i) => ({ name: `Peer${i}`, weaponId: 'shooter', specialReady: () => i % 2 === 0 }));
    G.match = { boss: {}, actors, state: 'playing', attract: false };
    const hud = new HUD(document.getElementById('ui-root')); hud.setVisible(true); hud.el.classList.add('is-boss');
    const entries = [];
    for (const sheet of document.styleSheets) for (let index = 0; index < sheet.cssRules.length; index++) {
      const rule = sheet.cssRules[index];
      if (rule.selectorText?.includes('.iw-lstage__img.is-slide[style*=')) entries.push({ sheet, index, text: rule.cssText, selector: rule.selectorText });
    }
    if (entries.length !== 1) throw Error(`属性选择器应唯一，实际${entries.length}`);
    const saved = entries[0]; let removed = false;
    const frame = n => {
      hud._updMarkers(actors.map((a, i) => ({ name: a.name, weapon: 'shooter', color: '#aa55ee', x: 45 + i * 90 + n % 13, y: 110 + i % 2 * 45, dist: 16 + n % 17, onScreen: true, tracked: false })));
      // 明确强制样式/布局结算，不能把延后到下帧的工作误判为省掉。
      return hud.markers.map(el => [getComputedStyle(el).opacity, getComputedStyle(el).transform, el.getBoundingClientRect().width]);
    };
    const freeze = () => { for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 1000; } };
    window.__styleProbe = {
      frame, freeze,
      toggle(on) {
        if (on && !removed) { saved.sheet.deleteRule(saved.index); removed = true; }
        if (!on && removed) { saved.sheet.insertRule(saved.text, saved.index); removed = false; }
        freeze(); frame(0);
      },
      verify() { return { restored: !removed && saved.sheet.cssRules[saved.index]?.cssText === saved.text, matches: document.querySelectorAll(saved.selector).length, state: frame(0) }; },
      bench(count) { const start = performance.now(); for (let n = 0; n < count; n++) frame(n); return performance.now() - start; },
    };
    frame(0); freeze(); await document.fonts.ready;
    return { selector: saved.selector, matches: document.querySelectorAll(saved.selector).length, markers: hud.markers.length };
  });
  if (setup.matches) throw Error('Boss固定HUD有匹配对象，不可直接隔离此规则');
  const client = await page.createCDPSession(); await client.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const baselineState = await page.evaluate(() => __styleProbe.verify());
  const baseline = await page.screenshot();
  await page.evaluate(() => __styleProbe.toggle(true));
  const candidateState = await page.evaluate(() => __styleProbe.verify());
  const candidate = await page.screenshot();
  await page.evaluate(() => __styleProbe.toggle(false));
  if (!baseline.equals(candidate) || JSON.stringify(baselineState.state) !== JSON.stringify(candidateState.state)) throw Error('固定HUD像素或状态发生变化');
  const rows = [];
  try {
    for (const removed of [false, true, true, false, true, false, false, true]) {
      await page.evaluate(removed => { __styleProbe.toggle(removed); __styleProbe.bench(30); }, removed);
      const before = await metrics(), elapsedMs = await page.evaluate(() => __styleProbe.bench(240)), after = await metrics();
      const delta = name => { if (!Number.isFinite(after[name]) || !Number.isFinite(before[name])) throw Error('缺少实际性能字段' + name); return after[name] - before[name]; };
      rows.push({ removed, frames: 240, elapsedMs, styleMs: delta('RecalcStyleDuration') * 1000, styleCount: delta('RecalcStyleCount'), layoutMs: delta('LayoutDuration') * 1000, layoutCount: delta('LayoutCount') });
    }
  } finally { await page.evaluate(() => __styleProbe.toggle(false)); }
  const finalState = await page.evaluate(() => __styleProbe.verify());
  if (!finalState.restored) throw Error('规则未原位恢复');
  const restored = await page.screenshot();
  if (!baseline.equals(restored)) throw Error('恢复后像素不一致');
  const result = { methodOnly: true, phonePerformance: false, browserVersion: await browser.version(), setup, exactPngEqual: true, restored: finalState.restored, rows };
  await writeFile('releases/investigation/boss-style-selector.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
