// 使用真实HUD/BossHud DOM和CSS，检查装饰选择、关键信息、PC隔离与启停；桌面CPU值不是手机FPS。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-decor-test.html', '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><link rel="stylesheet" href="/styles/ui.css"><link rel="stylesheet" href="/styles/mobile.css"><style>body{margin:0;background:#66704a}#ui-root{position:fixed;inset:0}</style><div id="ui-root"></div>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8490/releases/investigation/boss-decor-test.html');
  const report = await page.evaluate(async () => {
    const { HUD } = await import('/src/ui/hud.js');
    const { createMobileBossHudDecorations: create } = await import('/src/platform/mobileBossHudDecorations.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    globalThis.inkwaveMobile = {}; document.documentElement.classList.add('iw-mobile');
    const hud = new HUD(document.querySelector('#ui-root')); hud.el.classList.remove('is-hidden'); hud.boss.setMode(true);
    const match = { boss: {}, state: 'playing', paused: false }, profile = create();
    hud._updSquads([0, 1].map(team => ({ players: [0, 1, 2, 3].map(i => ({ alive: true, isSelf: team === 0 && i === 0, specialReady: true, weapon: 'shooter' })) })));
    hud.sp.classList.add('is-ready', 'is-active', 'is-gain', 'is-flare');
    hud.boss.bar.classList.add('is-open', 'is-hit', 'is-weak');
    hud.timer.classList.add('is-final'); hud.tank.classList.add('is-low'); hud.shield.classList.add('is-up');
    hud.hitEl.classList.add('is-on'); hud.ret.classList.add('is-hitflash');
    hud.sp.querySelector('.iw-sp__pct').textContent = '100%'; hud.timerTxt.textContent = '0:20';
    await document.fonts.ready; await new Promise(r => setTimeout(r, 500)); await new Promise(requestAnimationFrame);
    const q = selector => { const element = hud.el.querySelector(selector); check(!!element, '真实HUD缺少：' + selector); return element; };
    const decorations = ['.iw-sq:not(.is-self) .iw-sq__you', '.iw-timer__drip', '.iw-sp__wave', '.iw-sp__wave2', '.iw-sp__bub', '.iw-sp.is-ready .iw-sp__orb', '.iw-sp.is-ready .iw-sp__icon', '.iw-bb__embsplat', '.iw-bb__stripes'];
    const critical = ['.iw-sq.is-self .iw-sq__you', '.iw-sq.is-ready .iw-sq__spark', '.iw-sp__ready', '.iw-sp__spin', '.iw-sp__rim', '.iw-sp__ring', '.iw-timer__blob', '.iw-bb__stars i', '.iw-bb__clip', '.iw-shield svg', '.iw-tank__low', '.iw-hit i', '.iw-ret'];
    const anim = el => { const s = getComputedStyle(el); return { name: s.animationName, duration: s.animationDuration, iterations: s.animationIterationCount, easing: s.animationTimingFunction, display: s.display, visibility: s.visibility }; };
    const before = critical.map(selector => ({ selector, ...anim(q(selector)) }));
    check(before.every(x => x.name !== 'none'), '关键信号基线动画未真正启用');
    const decorBefore = decorations.flatMap(selector => [...hud.el.querySelectorAll(selector)].map(el => ({ selector, ...anim(el) })));
    check(decorBefore.length === 17 && decorBefore.every(x => x.name !== 'none'), '预期17个真实装饰动画未覆盖');
    const stateText = hud.el.textContent;
    const observer = new MutationObserver(() => {}); observer.observe(hud.el, { attributes: true, attributeFilter: ['class'] });
    for (let i = 0; i < 120; i++) profile.update(hud.el, match, 'match', false);
    check(observer.takeRecords().length === 1, '稳定状态仍逐帧写类'); observer.disconnect();
    const after = critical.map(selector => ({ selector, ...anim(q(selector)) }));
    check(JSON.stringify(before) === JSON.stringify(after), '关键告警/命中动画、时长或曲线变化');
    check(decorations.every(selector => [...hud.el.querySelectorAll(selector)].every(el => getComputedStyle(el).animationName === 'none')), '装饰仍在无限播放');
    check(hud.el.textContent === stateText && getComputedStyle(q('.iw-sp__ready')).opacity === '1', '信息文本或就绪标记丢失');
    // 液面高度/数字依旧跟随状态，停止波纹不能冻结充能显示。
    const charges = [];
    for (const charge of [0, .5, 1]) {
      hud.sp.querySelector('.iw-sp__liquid').style.transition = 'none';
      hud.sp.querySelector('.iw-sp__liquid').style.transform = `translateY(${96 * (1 - charge)}px)`;
      hud.sp.querySelector('.iw-sp__pct').textContent = `${charge * 100}%`;
      charges.push(getComputedStyle(q('.iw-sp__liquid')).transform);
    }
    check(new Set(charges).size === 3, '液面高度被静态化');
    const released = [];
    for (const state of ['paused', 'suspended', 'menu', 'ordinary', 'attract', 'PC', 'finish']) {
      profile.update(hud.el, match, 'match', false);
      const m = { ...match, paused: state === 'paused', attract: state === 'attract', boss: state === 'ordinary' ? null : {}, state: state === 'finish' ? 'finish' : 'playing' };
      globalThis.inkwaveMobile = state !== 'PC'; profile.update(hud.el, m, state === 'menu' ? 'menu' : 'match', state === 'suspended');
      check(!hud.el.classList.contains('iw-mobile-boss-decor'), '场景隔离失败：' + state);
      check(getComputedStyle(q('.iw-sp__wave')).animationName === 'iw-wave', '未恢复原动画：' + state); released.push(state);
      globalThis.inkwaveMobile = {};
    }
    profile.update(hud.el, match, 'match', false);
    const replacement = document.createElement('div'); profile.update(replacement, match, 'match', false);
    check(!hud.el.classList.contains('iw-mobile-boss-decor') && replacement.classList.contains('iw-mobile-boss-decor'), 'HUD替换未释放旧根'); profile.clear();
    check(!replacement.classList.contains('iw-mobile-boss-decor'), '主动退出未释放');
    profile.update(hud.el, match, 'match', false);
    globalThis.decorFixture = { hud, profile, match };
    return { decorations: decorBefore.length, critical: before, charges, released, info: profile.info(), checks: '真实HUD17装饰停止，13组关键动画/数字/液面/文本保持，脏类写入/暂停/背景/普通演示/PC/退出/替换通过' };
  });
  const client = await page.createCDPSession(); await client.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  report.styles = [];
  // 固定DOM与状态做ABBA，避免世界/阵容变动掩盖本地CSS CPU；不替代真机正式帧率。
  for (const active of [false, true, true, false]) {
    await page.evaluate(async enabled => { const f = decorFixture; if (enabled) f.profile.update(f.hud.el, f.match, 'match', false); else f.profile.clear(); await new Promise(r => setTimeout(r, 100)); }, active);
    const a = await metrics();
    await page.evaluate(async () => { for (let i = 0; i < 90; i++) await new Promise(requestAnimationFrame); });
    const b = await metrics();
    report.styles.push({ active, seconds: b.Timestamp - a.Timestamp, styleCpuMs: (b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000, layouts: b.LayoutCount - a.LayoutCount, styleCount: b.RecalcStyleCount - a.RecalcStyleCount, taskCpuMs: (b.TaskDuration - a.TaskDuration) * 1000 });
  }
  await writeFile('releases/investigation/mobile-boss-hud-decorations-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
