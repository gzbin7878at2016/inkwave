// 实际Minimap.update/_drawInk与真实Worker集成；原同步入口独立记录每段应有的像素和owner。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-map-worker-integration.html', '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8490/releases/investigation/boss-map-worker-integration.html');
  const built = process.env.WORKER_INTEGRATION_BUILD === '1';
  const report = await page.evaluate(async prefix => {
    const { G } = await import(prefix + '/src/core/ctx.js'), { Minimap } = await import(prefix + '/src/game/minimap.js');
    const { prepareMobileBossMinimapWorker: prepare, clearMobileBossMinimapWorkerForMatch: clear } = await import(prefix + '/src/platform/mobileBossMinimapWorker.js');
    const check = (ok, why) => { if (!ok) throw Error(why); };
    const same = (a, b, why) => check(a.length === b.length && a.every((v, i) => v === b[i]), why);
    const sleep = () => new Promise(requestAnimationFrame);
    const NativeWorker = Worker, workers = new Set(), urls = new Set(), createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
    globalThis.Worker = class extends NativeWorker { constructor(...args) { super(...args); workers.add(this); } terminate() { workers.delete(this); super.terminate(); } };
    URL.createObjectURL = blob => { const url = createURL(blob); urls.add(url); return url; };
    URL.revokeObjectURL = url => { urls.delete(url); revokeURL(url); };
    globalThis.inkwaveMobile = {}; G.teamColors = [{ r: .1, g: .7, b: .2 }, { r: .8, g: .1, b: .4 }]; G.teamHex = ['#1a2', '#ed1']; G.game = { theme: 'day' };
    let seed = 17;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    const make = () => {
      const m = Object.create(Minimap.prototype), w = 47, h = 35, n = w * h;
      Object.assign(m, { w, h, _built: true, paint: { grid: new Uint8Array(256), version: 0 }, owner: new Uint8Array(n), pixCell: new Int32Array(n),
        pixFx: new Uint8Array(n), pixFy: new Uint8Array(n), pixSx: new Int8Array(n), pixSy: new Int32Array(n),
        time: 0, timer: 0, flashT: 9, version: -1, _band: 0, _quiet: false, composeCalls: 0 });
      for (let i = 0; i < n; i++) { m.pixCell[i] = 17 + (i % 13) + 16 * (Math.floor(i / 13) % 13); m.pixFx[i] = i * 17; m.pixFy[i] = i * 71; m.pixSx[i] = 1; m.pixSy[i] = 16; }
      for (const [ctx, img] of [['ictx', 'inkImg'], ['fctx', 'flashImg']]) { const c = document.createElement('canvas'); c.width = w; c.height = h; m[ctx] = c.getContext('2d'); m[img] = m[ctx].createImageData(w, h); }
      m._compose = () => { m.composeCalls++; }; return m;
    };
    const setup = async () => {
      const map = make(), match = { boss: {}, state: 'init', paused: false }, game = { minimap: map, match };
      G.mode = 'menu'; G.match = match;
      check((await prepare(game, match)).prepared, '加载准备未完成'); G.mode = 'match'; match.state = 'playing';
      return { map, match, game };
    };
    let checkedRows = 0;
    const live = await setup(), b = live.map, a = make(); a.update(0, true);
    const expected = [], originalDraw = a._drawInk;
    a._drawInk = function(y0, y1) {
      originalDraw.call(this, y0, y1);
      const lo = y0 * a.w, hi = y1 * a.w;
      expected.push({ y0, y1, ink: a.inkImg.data.slice(lo * 4, hi * 4), flash: a.flashImg.data.slice(lo * 4, hi * 4), owner: a.owner.slice(lo, hi) });
    };
    const put = b.ictx.putImageData;
    b.ictx.putImageData = function(...args) {
      const row = expected.shift(); check(!!row, '出现未请求的额外Canvas上传');
      const y0 = args[4], y1 = y0 + args[6], lo = y0 * b.w, hi = y1 * b.w;
      check(y0 === row.y0 && y1 === row.y1, '更新段顺序改变：' + [y0, y1, row.y0, row.y1].join('/') + JSON.stringify(b.bossWorkerInfo()));
      same(b.inkImg.data.subarray(lo * 4, hi * 4), row.ink, '集成墨迹');
      same(b.flashImg.data.subarray(lo * 4, hi * 4), row.flash, '集成闪光'); same(b.owner.subarray(lo, hi), row.owner, '集成owner');
      checkedRows++; return put.apply(this, args);
    };
    // 实战中途注入一次超龄（时钟+300ms）和一次暂停/恢复；参照按原同步路径做同样的整图刷新，之后逐段仍须字节一致。
    // 作废段从不写入地图（原回退同样如此），事件帧前参照采用实机当前像素/owner，并清掉这些段的期望上传。
    const clock = performance.now.bind(performance);
    const adopt = () => { expected.length = 0; a.owner.set(b.owner); a.inkImg.data.set(b.inkImg.data); a.flashImg.data.set(b.flashImg.data); };
    let staled = false;
    for (let step = 0; step < 140; step++) {
      const pausing = step >= 90 && step < 94;
      if (!pausing) {
        for (let k = 0; k < 4; k++) { const i = Math.floor(random() * 256), v = Math.floor(random() * 3); a.paint.grid[i] = b.paint.grid[i] = v; }
        a.paint.version++; b.paint.version++;
      }
      if (step === 90) { live.match.paused = true; clear(live.match, 'paused'); adopt(); a.version = -1; a.timer = 0; a._band = 0; }
      if (step === 94) live.match.paused = false;
      const pending = b.bossWorkerInfo(), late = !staled && step >= 40 && pending.submitted > pending.applied + pending.dropped;
      if (late) {
        staled = true; adopt(); a._band = 0; a.update(1 / 30, true);
        performance.now = () => clock() + 300;
        try { b.update(1 / 30); } finally { performance.now = clock; }
        check(b.bossWorkerInfo().parked && b.bossWorkerInfo().ready, '超龄后未保留Worker');
      } else { a.update(1 / 30); b.update(1 / 30); }
      check(a._band === b._band && a.timer === b.timer && a.version === b.version, '原三段/0.15秒节奏改变');
      await sleep();
    }
    for (let i = 0; i < 20 && (expected.length || b._band); i++) { a.update(0); b.update(0); await sleep(); }
    const recovered = b.bossWorkerInfo();
    check(staled && !expected.length && recovered.applied + recovered.dropped === recovered.submitted && !recovered.fallbacks, '未完整应用或提前回退');
    check(recovered.ready && !recovered.parked && recovered.parks === 2 && recovered.resyncs === 2 && recovered.dropped > 0 && recovered.applied > 60, '超龄/暂停后未恢复Worker' + JSON.stringify(recovered));
    same(a.inkImg.data, b.inkImg.data, '集成最终原像素'); same(a.flashImg.data, b.flashImg.data, '最终闪光'); same(a.owner, b.owner, '最终owner');
    const info = b.bossWorkerInfo(); b.ictx.putImageData = put; clear(live.match);
    check(info.gridAllocations <= 3 && info.rowAllocations <= 3 && info.recycled === info.applied + info.dropped, '未复用网格/行缓冲');
    const reasons = [];
    // 每种失效独立创建真Worker，检查终止或停用、同步整图及迟到结果不会覆盖；停用的还须排空后恢复。
    const kept = ['age', 'frame-age', 'queue-limit', 'pause', 'suspend'];
    for (const action of ['force', 'palette', 'array', 'age', 'frame-age', 'queue-limit', 'worker-error', 'pause', 'suspend', 'finish']) {
      const { map, match } = await setup();
      map.paint.grid.fill(1); map.paint.version++; map.timer = 0; map.update(1 / 30);
      let restoreClock;
      if (action === 'age') { const clock = performance.now.bind(performance); performance.now = () => clock() + 300; restoreClock = () => { performance.now = clock; }; }
      if (action === 'array') map.pixCell = map.pixCell.slice();
      if (action === 'palette') { G.teamHex = G.teamHex.slice().reverse(); G.teamColors = G.teamColors.slice().reverse(); }
      if (action === 'worker-error') { [...workers][0].onerror({ preventDefault() {}, message: '集成测试异常' }); await new Promise(r => setTimeout(r, 0)); }
      if (action === 'pause' || action === 'suspend') clear(match, action === 'pause' ? 'paused' : 'suspend');
      if (action === 'finish') match.state = 'finish';
      const oracle = Object.assign(Object.create(Minimap.prototype), map);
      for (const key of ['owner', '_alpha', '_tm', '_tt']) oracle[key] = map[key].slice();
      for (const [image, ctx] of [['inkImg', 'ictx'], ['flashImg', 'fctx']]) {
        const canvas = document.createElement('canvas'); canvas.width = map.w; canvas.height = map.h;
        oracle[ctx] = canvas.getContext('2d'); oracle[image] = oracle[ctx].createImageData(map.w, map.h); oracle[image].data.set(map[image].data);
      }
      oracle._drawInk(0, oracle.h);
      if (action === 'frame-age') for (let i = 0; i < 5; i++) map.update(0);
      else if (action === 'queue-limit') { map.update(0); map.update(0); map.timer = -1; map.paint.version++; map.update(0); }
      else map.update(0, action === 'force');
      restoreClock?.();
      if (action === 'finish') {
        for (let i = 0; i < 4 && map.bossWorkerInfo().ready; i++) { await sleep(); map.update(0); }
        check(map.bossWorkerInfo().settlementApplied === true && map.bossWorkerInfo().fallbackFullDraws === 0, '正常结算未异步完成整图');
      }
      const state = map.bossWorkerInfo();
      if (kept.includes(action)) check(state?.ready && state.parked && !state.fallbacks, '应停用并保留Worker：' + action);
      else check(state && !state.ready && !state.active, '失效未释放：' + action);
      check(map.inkImg.data.some(v => v !== 0), '未恢复原像素：' + action);
      same(map.inkImg.data, oracle.inkImg.data, '回退原算法墨迹：' + action);
      same(map.flashImg.data, oracle.flashImg.data, '回退原算法闪光：' + action); same(map.owner, oracle.owner, '回退原算法归属：' + action);
      if (action === 'finish') {
        same(map.ictx.getImageData(0, 0, map.w, map.h).data, oracle.ictx.getImageData(0, 0, map.w, map.h).data, '结算Canvas最终像素');
        check(state.recycled === state.applied + state.dropped, '结算整图缓冲未完整回收');
      }
      const pixels = map.inkImg.data.slice(); await sleep(); same(map.inkImg.data, pixels, '迟到覆盖：' + action);
      if (kept.includes(action)) {
        const busy = () => { const i = map.bossWorkerInfo(); return i.parked || i.applied + i.dropped < i.submitted; };
        for (let i = 0; i < 20 && busy(); i++) { map.update(0); await sleep(); }
        const resumed = map.bossWorkerInfo();
        check(resumed.ready && !resumed.parked && resumed.resyncs === 1 && resumed.dropped > 0 && resumed.dropped + resumed.applied === resumed.submitted, '排空后未恢复Worker：' + action);
        same(map.inkImg.data, pixels, '作废段写入地图：' + action); clear(match);
      }
      check(workers.size === 0 && urls.size === 0, '资源泄漏：' + action); reasons.push({ action, reason: state.reason });
    }
    // 结算等待中的取消/force/配色/版本变化必须保持原最终图，迟到消息不得覆盖。
    for (const action of ['leave', 'force', 'palette', 'version', 'deadline']) {
      const { map, match } = await setup(); map.paint.grid.fill(2); map.paint.version++;
      match.state = 'finish'; map.update(0);
      check(map.bossWorkerInfo().reason === 'settling', '未进入结算等待');
      if (action === 'leave') { const before = map.inkImg.data.slice(); clear(match); await sleep(); same(map.inkImg.data, before, '离局后迟到写入'); }
      else {
        if (action === 'palette') { G.teamHex = G.teamHex.slice().reverse(); G.teamColors = G.teamColors.slice().reverse(); }
        if (action === 'version') { map.paint.grid.fill(1); map.paint.version++; }
        if (action === 'deadline') { const t = performance.now.bind(performance); performance.now = () => t() + 300; map.update(0); performance.now = t; }
        else map.update(0, action === 'force');
        check(!map.bossWorkerInfo().ready && map.bossWorkerInfo().fallbackFullDraws === 1, '结算失效未同步回退：' + action);
        const snapshot = map.inkImg.data.slice(); await sleep(); same(map.inkImg.data, snapshot, '结算回退后迟到写入');
      }
      check(workers.size === 0 && urls.size === 0, '结算资源泄漏：' + action);
    }
    // 取消和重叠准备；原准备的catch不能覆盖新实例的ready/归属。
    const map = make(), old = { boss: {}, state: 'init' }, newer = { boss: {}, state: 'init' }, game = { minimap: map, match: old };
    G.mode = 'menu'; G.match = old;
    const p1 = prepare(game, old); game.match = G.match = newer;
    const p2 = prepare(game, newer); await Promise.all([p1, p2]); clear(old);
    check(map.bossWorkerInfo()?.ready, '旧准备取消影响新局'); clear(newer);
    const cancelled = { boss: {}, state: 'init' }; game.match = G.match = cancelled;
    const p3 = prepare(game, cancelled); clear(cancelled); await p3;
    check(!map.bossWorkerInfo()?.ready, '取消后被复活');
    // PC/普通/演示不创建Worker；平台不支持或CSP拒绝只同步降级。
    globalThis.inkwaveMobile = false; check((await prepare(game, cancelled)).skipped, 'PC未隔离'); globalThis.inkwaveMobile = {};
    for (const match of [{ boss: null }, { boss: {}, attract: true }]) { game.match = G.match = match; check((await prepare(game, match)).skipped, '非真实Boss未隔离'); }
    game.match = G.match = cancelled;
    const WrappedWorker = Worker; globalThis.Worker = function() { throw Error('模拟CSP或不支持Worker'); };
    check((await prepare(game, cancelled)).fallback && !map.bossWorkerInfo().ready, '拒绝创建未降级'); globalThis.Worker = WrappedWorker;
    check(workers.size === 0 && urls.size === 0, '结束仍有资源泄漏');
    return { checkedRows, info, reasons, scope: 'PC/普通/演示隔离；超龄/帧龄/队列满/暂停/后台停用后排空恢复且逐段字节一致；重建/配色/force/异常/收尾终止；取消/新旧局/资源释放通过' };
  }, built ? '/dist-mobile' : '');
  await writeFile(`releases/investigation/mobile-boss-minimap-worker-${built ? 'built' : 'browser'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
