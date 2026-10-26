// 原Minimap._drawInk独立参考，不用提取后的内核与自己比较；实验不改变产品。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/minimap-worker-test.html', '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8490/releases/investigation/minimap-worker-test.html');
  const report = await page.evaluate(async () => {
    const { G } = await import('/src/core/ctx.js'), { Minimap } = await import('/src/game/minimap.js');
    const { computeMinimapInkBand: kernel } = await import('/tools/minimap-band-kernel.mjs');
    const { createMinimapBandWorker: create, applyMinimapBand: apply } = await import('/tools/minimap-band-worker.mjs');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const rng = value => () => { value = Math.imul(value, 1664525) + 1013904223 | 0; return (value >>> 0) / 4294967296; };
    G.teamColors = [{ r: .1, g: .7, b: .2 }, { r: .8, g: .1, b: .4 }];
    const make = (w = 47, h = 35, gw = 16, gh = 16) => {
      const m = Object.create(Minimap.prototype), n = w * h, rnd = rng(17);
      Object.assign(m, { w, h, paint: { grid: new Uint8Array(gw * gh) }, owner: new Uint8Array(n),
        pixCell: new Int32Array(n), pixFx: new Uint8Array(n), pixFy: new Uint8Array(n), pixSx: new Int8Array(n), pixSy: new Int32Array(n),
        _alpha: new Float32Array(n), _tm: new Uint8Array(n), _tt: new Uint8Array(n), flashT: 9 });
      for (let i = 0; i < n; i++) {
        const x = 1 + Math.floor(rnd() * (gw - 2)), y = 1 + Math.floor(rnd() * (gh - 2));
        m.pixCell[i] = rnd() < .06 ? -1 : y * gw + x;
        m.pixFx[i] = rnd() * 256; m.pixFy[i] = rnd() * 256; m.pixSx[i] = rnd() < .5 ? -1 : 1; m.pixSy[i] = rnd() < .5 ? -gw : gw;
      }
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) m.paint.grid[y * gw + x] = (Math.floor(x / 8) + Math.floor(y / 8)) % 3;
      for (const [ctxKey, imgKey] of [['ictx', 'inkImg'], ['fctx', 'flashImg']]) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        m[ctxKey] = c.getContext('2d'); m[imgKey] = m[ctxKey].createImageData(w, h);
      }
      return m;
    };
    const state = m => ({ ...m, grid: m.paint.grid, ink: m.inkImg.data, flash: m.flashImg.data });
    const same = (a, b, label) => check(a.length === b.length && a.every((v, i) => Object.is(v, b[i])), label);
    const a = make(), b = make(), worker = create(state(b), kernel), random = rng(991);
    await worker.ready;
    let comparisons = 0;
    try {
      for (let step = 0; step < 420; step++) {
        if (step % 7 === 0) a.paint.grid.fill(0);
        for (let k = 0; k < (step % 3 ? 3 : 160); k++) a.paint.grid[Math.floor(random() * a.paint.grid.length)] = Math.floor(random() * 3);
        if (step % 5 === 0) G.teamColors = [{ r: random(), g: random(), b: random() }, { r: random(), g: random(), b: random() }];
        const resetOwner = step % 11 === 0;
        if (resetOwner) { a.owner.fill(0); b.owner.fill(0); }
        const y0 = step % 17 ? Math.floor(a.h * (step % 3) / 3) : 0;
        const y1 = step % 17 ? Math.floor(a.h * (step % 3 + 1) / 3) : a.h;
        a._quiet = step % 9 === 0; a.flashT += .033; b.flashT += .033;
        a._drawInk(y0, y1);
        const result = await worker.draw(a.paint.grid, y0, y1, a._rgb, { inspect: true, resetOwner });
        apply(b, result, a._quiet);
        same(a.owner, b.owner, 'owner'); same(a.inkImg.data, b.inkImg.data, '墨迹像素'); same(a.flashImg.data, b.flashImg.data, '闪光像素');
        same(a._alpha, result.alpha, 'halo透明度'); same(a._tm, result.tm, '队伍'); same(a._tt, result.tt, '浮雕颜色');
        check(a.flashT === b.flashT, '闪光时钟');
        for (const key of ['ictx', 'fctx']) same(a[key].getImageData(0, 0, a.w, a.h).data, b[key].getImageData(0, 0, b.w, b.h).data, '实际Canvas');
        worker.recycle(result);
        comparisons++;
      }
      // 一个在途请求、无效范围、取消、超时与内核异常均不得挂起。
      const pending = worker.draw(a.paint.grid, 0, a.h, a._rgb);
      check(await worker.draw(a.paint.grid, 0, a.h, a._rgb).then(() => false, () => true), '在途上限'); await pending;
      check(await worker.draw(a.paint.grid, -1, a.h, a._rgb).then(() => false, () => true), '范围');
    } finally { worker.dispose(); }
    // 视角/尺寸等静态映射变化必须重建实例；确认新实例使用新映射及既有像素状态。
    for (const m of [a, b]) m.pixCell.reverse();
    const rebuilt = create(state(b), kernel); await rebuilt.ready;
    try {
      a._quiet = false; a._drawInk();
      apply(b, await rebuilt.draw(a.paint.grid, 0, a.h, a._rgb));
      same(a.inkImg.data, b.inkImg.data, '重建墨迹'); same(a.owner, b.owner, '重建归属');
    } finally { rebuilt.dispose(); }
    const cancelled = create(state(b), kernel); await cancelled.ready;
    const p = cancelled.draw(a.paint.grid, 0, a.h, a._rgb); cancelled.dispose();
    check(await p.then(() => false, () => true), '取消未拒绝');
    const bad = create(state(b), function () { throw Error('故意测试异常'); }); await bad.ready;
    check(await bad.draw(a.paint.grid, 0, a.h, a._rgb).then(() => false, () => true), '异常未拒绝'); bad.dispose();
    const timed = create(state(b), function () { while (true) { /* 由宿主超时终止 */ } }, { timeoutMs: 1000 }); await timed.ready;
    check(await timed.draw(a.paint.grid, 0, a.h, a._rgb).then(() => false, () => true), '超时未拒绝'); timed.dispose();
    check((() => { try { create(state(b), kernel, { maxBytes: 1 }); return false; } catch { return true; } })(), '预算');
    const triple = create(state(b), kernel, { maxPending: 3 }); await triple.ready;
    try {
      const jobs = [0, 1, 2].map(band => triple.draw(a.paint.grid, Math.floor(a.h * band / 3), Math.floor(a.h * (band + 1) / 3), a._rgb));
      check(await triple.draw(a.paint.grid, 0, a.h, a._rgb).then(() => false, () => true), '三个在途上限');
      const rows = await Promise.all(jobs);
      check(rows.every((row, i) => !i || row.id > rows[i - 1].id), '三请求乱序');
      const cancelJobs = [0, 1, 2].map(band => triple.draw(a.paint.grid, Math.floor(a.h * band / 3), Math.floor(a.h * (band + 1) / 3), a._rgb));
      const settled = Promise.allSettled(cancelJobs); triple.dispose();
      check((await settled).every(x => x.status === 'rejected'), '取消未拒绝全部请求');
    } finally { triple.dispose(); }
    const { benchmarkMinimapWorker: benchmark } = await import('/tools/minimap-worker-benchmark.mjs');
    const benches = await benchmark(make(392, 658, 64, 96), kernel, create, apply);
    const { benchmarkMinimapWorkerPipeline: pipeline } = await import('/tools/minimap-worker-pipeline.mjs');
    const pipe = await pipeline(make(392, 658, 64, 96), kernel, create, apply);
    return { comparisons, checks: '原入口/Canvas/halo/owner/闪光/换色/清除/在途/取消/异常/超时/预算通过', benches, pipeline: pipe };
  });
  await writeFile('releases/investigation/minimap-worker-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
