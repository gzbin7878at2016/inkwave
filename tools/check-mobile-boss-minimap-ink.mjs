// 真实Canvas原入口作参考；随机墨迹/配色/闪光/翻转逐字节比较，并测稀疏和整幅变化耗时。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-minimap-ink-test.html', '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8490/releases/investigation/boss-minimap-ink-test.html');
  const report = await page.evaluate(async () => {
    const { G } = await import('/src/core/ctx.js'), { Minimap } = await import('/src/game/minimap.js');
    const { prepareMobileBossMinimapInk: prepare, mobileBossMinimapInkInfo: info, clearMobileBossMinimapInkForMatch: clear } = await import('/src/platform/mobileBossMinimapInk.js');
    const { BossMode } = await import('/src/boss/bossMode.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const rng = value => () => { value = (Math.imul(value, 1664525) + 1013904223) | 0; return (value >>> 0) / 4294967296; };
    const match = { boss: {}, state: 'playing' }; globalThis.inkwaveMobile = {}; G.mode = 'match'; G.match = match;
    G.teamColors = [{ r: 0.1, g: 0.7, b: 0.2 }, { r: 0.8, g: 0.1, b: 0.4 }]; G.teamHex = ['#1f5', '#f18']; G.game = { theme: 'day' };
    const make = (w = 47, h = 35, gw = 16, gh = 16) => {
      const map = Object.create(Minimap.prototype), random = rng(17), n = w * h;
      Object.assign(map, { w, h, _built: true, paint: { grid: new Uint8Array(gw * gh), version: 0 }, owner: new Uint8Array(n),
        pixCell: new Int32Array(n), pixFx: new Uint8Array(n), pixFy: new Uint8Array(n), pixSx: new Int32Array(n), pixSy: new Int32Array(n),
        _quiet: false, flashT: 9, time: 0, timer: 0, version: -1, _band: 0, uploads: { ink: 0, flash: 0 }, ranges: [] });
      for (let i = 0; i < n; i++) {
        const x = 1 + Math.floor(random() * (gw - 2)), y = 1 + Math.floor(random() * (gh - 2));
        map.pixCell[i] = random() < 0.06 ? -1 : y * gw + x;
        map.pixFx[i] = random() * 256; map.pixFy[i] = random() * 256; map.pixSx[i] = random() < 0.5 ? -1 : 1; map.pixSy[i] = random() < 0.5 ? -gw : gw;
      }
      for (const [canvasKey, ctxKey, imgKey, countKey] of [['inkC', 'ictx', 'inkImg', 'ink'], ['flashC', 'fctx', 'flashImg', 'flash']]) {
        const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'), put = ctx.putImageData;
        ctx.putImageData = function(...args) { map.uploads[countKey]++; return put.apply(this, args); };
        map[canvasKey] = c; map[ctxKey] = ctx; map[imgKey] = ctx.createImageData(w, h);
      }
      const draw = Minimap.prototype._drawInk;
      map._drawInk = function(y0 = 0, y1 = this.h) { this.ranges.push([y0, y1]); return draw.call(this, y0, y1); };
      map._compose = () => {}; return map;
    };
    let pairs = 0;
    const equal = (a, b, canvas = true) => {
      for (const k of ['owner', '_alpha', '_tm', '_tt']) check(a[k].length === b[k].length && a[k].every((v, i) => v === b[k][i]), k + '不一致');
      for (const k of ['inkImg', 'flashImg']) check(a[k].data.every((v, i) => v === b[k].data[i]), k + '原像素不一致');
      check(a.flashT === b.flashT, '闪光时钟不一致');
      if (canvas) for (const k of ['ictx', 'fctx']) { const x = a[k].getImageData(0, 0, a.w, a.h).data, y = b[k].getImageData(0, 0, b.w, b.h).data;
        check(x.every((v, i) => v === y[i]), k + '实际Canvas不一致'); }
      pairs++;
    };
    const a = make(), b = make(), random = rng(991);
    G.mode = 'menu'; check(prepare(b, match).prepared, '实际加载菜单阶段准备失败');
    check(info(b) && !info(b).active, '加载阶段错误激活'); G.mode = 'match';
    check(info(b).active, '切换实际对局后未激活');
    a.paint.grid.fill(1); b.paint.grid.fill(1);
    a._drawInk(Math.floor(a.h / 3), Math.floor(a.h * 2 / 3)); b._drawInk(Math.floor(b.h / 3), Math.floor(b.h * 2 / 3)); equal(a, b);
    for (let n = 0; n < 360; n++) {
      if (n % 7 === 0) { a.paint.grid.fill(0); b.paint.grid.fill(0); }
      for (let k = 0; k < (n % 3 ? 3 : 160); k++) { const i = Math.floor(random() * a.paint.grid.length), v = Math.floor(random() * 3); a.paint.grid[i] = b.paint.grid[i] = v; }
      if (n % 11 === 0) { a.owner.fill(0); b.owner.fill(0); }
      if (n % 5 === 0) G.teamColors = [{ r: random(), g: random(), b: random() }, { r: random(), g: random(), b: random() }];
      const band = n % 3, y0 = n % 17 ? Math.floor(a.h * band / 3) : 0, y1 = n % 17 ? Math.floor(a.h * (band + 1) / 3) : a.h;
      a._quiet = b._quiet = n % 9 === 0; a.flashT += 0.033; b.flashT += 0.033;
      a._drawInk(y0, y1); b._drawInk(y0, y1); equal(a, b);
    }
    // 连续换色越过epoch回绕，及先清除再恢复相同输入/外部重置owner。
    for (let n = 0; n < 270; n++) { G.teamColors[0].r = n / 269; a._drawInk(); b._drawInk(); equal(a, b, n % 20 === 0); }
    const saved = a.paint.grid.slice(); a.paint.grid.fill(0); b.paint.grid.fill(0); a._drawInk(); b._drawInk(); equal(a, b);
    a.paint.grid.set(saved); b.paint.grid.set(saved); a._drawInk(); b._drawInk(); equal(a, b);
    // 公共update入口的0.15秒节流/3段/force与图像时序保持。
    a.ranges.length = b.ranges.length = 0;
    for (let n = 0; n < 60; n++) {
      a.paint.version++; b.paint.version++; a.update(n % 2 ? 1 / 30 : 1 / 60, n % 13 === 0); b.update(n % 2 ? 1 / 30 : 1 / 60, n % 13 === 0); equal(a, b);
      check(a._band === b._band && a.timer === b.timer && a.version === b.version && JSON.stringify(a.ranges) === JSON.stringify(b.ranges), '刷新时序改变');
    }
    const before = { ...b.uploads };
    for (let i = 0; i < 12; i++) { a._drawInk(); b._drawInk(); equal(a, b); }
    check(b.uploads.ink === before.ink && b.uploads.flash <= before.flash + 1, '未变化画布仍重复上传');
    for (const m of [a, b]) { m.pixCell = m.pixCell.slice().reverse(); m.pixFx = m.pixFx.slice().reverse(); m.owner = new Uint8Array(m.owner.length); }
    a._drawInk(); b._drawInk(); equal(a, b); check(info(b) === null, '重建后未回退');
    prepare(b, match); a.paint.grid = a.paint.grid.slice(); b.paint.grid = b.paint.grid.slice();
    a._drawInk(); b._drawInk(); equal(a, b); check(info(b) === null, '网格对象更换后未回退');
    prepare(b, match); G.mode = 'menu'; a._drawInk(); b._drawInk(); equal(a, b); check(!info(b), '菜单仍用Boss缓存'); G.mode = 'match';
    globalThis.inkwaveMobile = false; check(prepare(b, match).skipped, 'PC错误准备'); globalThis.inkwaveMobile = {};
    G.match = { boss: null }; check(prepare(b, G.match).skipped, '普通对局错误准备'); G.match = match;
    check(prepare({ w: 2000000, h: 2, ensure() {} }, match).reason === 'cache-budget', '容量未限制');
    prepare(b, match); a.paint.grid.fill(7); b.paint.grid.fill(7); a._drawInk(); b._drawInk(); equal(a, b); check(!info(b), '异常格值未保守回退');
    const newer = { boss: {} }; G.match = newer; prepare(b, newer); clear(match);
    check(info(b)?.active, '旧局清理误清新局');
    const mode = Object.create(BossMode.prototype); mode.match = newer; let disposed = 0;
    mode.boss = { dispose() { disposed++; } }; G.boss = mode.boss; mode.dispose();
    check(disposed === 1 && G.boss === null && !info(b), '实际Boss释放未清缓存或改变原释放'); G.match = match;
    const benches = [];
    for (const scenario of ['stable', 'sparse', 'worst']) {
      const times = [];
      for (let repeat = 0; repeat < 3; repeat++) for (const cached of [repeat % 2 === 0, repeat % 2 !== 0]) {
        const m = make(384, 576, 64, 96), rnd = rng(123); m.ranges = { push() {} };
        for (let y = 0; y < 96; y++) for (let x = 0; x < 64; x++) m.paint.grid[y * 64 + x] = (Math.floor(x / 8) + Math.floor(y / 8)) % 3;
        if (cached) prepare(m, match); let elapsed = 0;
        for (let n = 0; n < 180; n++) {
          if (scenario === 'sparse') for (let k = 0; k < 4; k++) m.paint.grid[Math.floor(rnd() * m.paint.grid.length)] = rnd() * 3;
          if (scenario === 'worst') for (let k = 0; k < m.paint.grid.length; k++) m.paint.grid[k] = rnd() * 3;
          const y0 = Math.floor(m.h * (n % 3) / 3), y1 = Math.floor(m.h * (n % 3 + 1) / 3), t = performance.now(); m._drawInk(y0, y1);
          if (n >= 60) elapsed += performance.now() - t;
        }
        times.push({ cached, ms: elapsed, uploads: m.uploads, cache: info(m) });
      }
      const median = values => values.sort((x, y) => x - y)[1]; const originalMs = median(times.filter(t => !t.cached).map(t => t.ms)), cachedMs = median(times.filter(t => t.cached).map(t => t.ms));
      benches.push({ scenario, originalMs, cachedMs, ratio: cachedMs / originalMs, times });
    }
    return { pairs, benches, checks: '原入口/真实Canvas/墨迹闪光owner中间数组逐字节、换色回绕/清除恢复/force与3段时序/重建/隔离/容量通过；性能值仅桌面' };
  });
  await writeFile('releases/investigation/mobile-boss-minimap-ink-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pairs: report.pairs, benches: report.benches.map(({ times, ...summary }) => summary), checks: report.checks }, null, 2));
} finally { await browser.close(); }
