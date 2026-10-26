// 真实浏览器验证CSS关键帧等价、同帧重启合并、零offsetWidth读取及PC/普通对局回退。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-animation-test.html', `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<link rel="stylesheet" href="/styles/hud.css"><link rel="stylesheet" href="/styles/mobile.css">
<style>:root{--u:8px;--gold:#fd0;--k:#000;--weak:#f60;--spring2:cubic-bezier(.2,1.5,.5,1)}</style><body></body>`);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8490/releases/investigation/boss-animation-test.html');
  const report = await page.evaluate(async () => {
    const { G } = await import('/src/core/ctx.js');
    const { HUD } = await import('/src/ui/hud.js');
    const { BossHud } = await import('/src/ui/hud-boss.js');
    const { restartMobileBossAnimation } = await import('/src/ui/mobileBossAnimation.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const keyframes = new Map();
    for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule.type === CSSRule.KEYFRAMES_RULE) keyframes.set(rule.name, [...rule.cssRules].map(r => r.cssText).join(''));
    const aliases = [...keyframes.keys()].filter(n => n.endsWith('-repeat'));
    check(aliases.length === 8, '关键帧副本数不符');
    for (const name of aliases) check(keyframes.get(name) === keyframes.get(name.slice(0, -7)), `关键帧不等价：${name}`);
    globalThis.inkwaveMobile = true; G.match = { boss: {} }; G.mode = 'match'; document.documentElement.classList.add('iw-mobile');
    const configs = [
      ['iw-bb', 'is-hit', '<i class="iw-bb__flash"></i><b class="iw-bb__pct"></b>', '.iw-bb__pct'],
      ['iw-bb', 'is-weak', '<i class="iw-bb__flash"></i><i class="iw-bb__clip"></i>', '.iw-bb__flash'],
      ['iw-bb__emb', 'is-weak', '<i class="iw-bb__embart"></i>', '.iw-bb__embart'],
      ['iw-bnum', 'is-bump', '<b>123</b>', 'b'],
      ['iw-hit is-heavy', 'is-on', '<i></i>', 'i'],
      ['iw-hit is-weak', 'is-on', '<i></i>', 'i'],
      ['iw-ret', 'is-hitflash', '', null],
    ];
    let reads = 0; const cases = [];
    for (const [base, cls, html, selector] of configs) {
      const el = document.createElement('div'); el.className = base; el.innerHTML = html; document.body.appendChild(el);
      Object.defineProperty(el, 'offsetWidth', { configurable: true, get() { reads++; return 100; } });
      const target = selector ? el.querySelector(selector) : el;
      el.classList.add(cls); await raf();
      const original = getComputedStyle(target), duration = original.animationDuration, easing = original.animationTimingFunction;
      HUD.prototype._restart.call({}, el, cls); await raf();
      const first = getComputedStyle(target).animationName;
      check(first.endsWith('-repeat'), `第一次未切换：${base}`);
      await new Promise(r => setTimeout(r, 85));
      const attr = `data-iw-repeat-${cls.slice(3)}`;
      HUD.prototype._restart.call({}, el, cls); HUD.prototype._restart.call({}, el, cls);
      await raf();
      const style = getComputedStyle(target), times = el.getAnimations({ subtree: true }).filter(a => a.animationName === style.animationName).map(a => a.currentTime);
      check(el.getAttribute(attr) === 'a' && style.animationName !== first, `同帧多次命中没有合并：${base}`);
      check(style.animationDuration === duration && style.animationTimingFunction === easing, '时长或曲线变化');
      check(times.length > 0 && times.every(t => t <= 50), '动画没有从头重播');
      if (base.startsWith('iw-hit')) check(['0.22s', '0.26s'].includes(getComputedStyle(el, '::after').animationDuration), '命中环时长改变');
      cases.push({ base, cls, duration, easing, first, second: style.animationName, times }); el.remove();
    }
    check(reads === 0, '手机Boss读取了offsetWidth');
    const bar = document.createElement('div'); bar.className = 'iw-bb'; bar.innerHTML = '<i class="iw-bb__flash"></i><b class="iw-bb__pct"></b>'; document.body.appendChild(bar);
    Object.defineProperty(bar, 'offsetWidth', { get() { reads++; return 100; } });
    for (const [mobile, boss] of [[false, true], [true, false], [true, true]]) {
      globalThis.inkwaveMobile = mobile; G.match = { boss: boss ? {} : null };
      const before = reads;
      const obj = { on: true, S: { max: 100, hp: 1, shown: 1, chip: 1, hitT: -9, dead: false }, bar, notches: [], _t: () => 1 };
      BossHud.prototype._hp.call(obj, { hp: 90, max: 100 }); await Promise.resolve();
      check(reads - before === (mobile && boss ? 0 : 1), '实际Boss血量方法隔离失败');
    }
    check(!restartMobileBossAnimation(bar, 'is-intro'), '低频/未经映射动画不应替换');
    return { aliases, cases, mobileOffsetReads: 0, originalFallbackReads: reads, checks: '8份关键帧逐项等价、7组重播及同帧合并、时长曲线/重击环保持、实际Boss hp与PC/普通路径隔离通过' };
  });
  await writeFile('releases/investigation/mobile-boss-animation-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
