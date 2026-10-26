// 复制真实地图后比较；可toString交给手机，只引用参数与浏览器API，不改真实比赛。
export async function benchmarkMinimapWorker(map, kernel, create, apply, scenarios = ['empty', 'snapshot', 'sparse', 'dense']) {
  const clone = () => {
    const m = Object.assign(Object.create(Object.getPrototypeOf(map)), map);
    m.paint = { ...map.paint, grid: map.paint.grid.slice() }; m._bossInkCache = null; m._quiet = false;
    for (const key of ['owner', '_alpha', '_tm', '_tt']) m[key] = map[key]?.slice() || (key === '_alpha' ? new Float32Array(map.w * map.h) : new Uint8Array(map.w * map.h));
    for (const [image, context] of [['inkImg', 'ictx'], ['flashImg', 'fctx']]) {
      const canvas = document.createElement('canvas'); canvas.width = map.w; canvas.height = map.h;
      m[context] = canvas.getContext('2d'); m[image] = m[context].createImageData(map.w, map.h);
      m[image].data.set(map[image].data); m[context].putImageData(m[image], 0, 0);
    }
    return m;
  };
  const results = [];
  for (const scenario of scenarios) {
    const a = clone(), b = clone();
    if (scenario === 'empty') { a.paint.grid.fill(0); b.paint.grid.fill(0); }
    const state = { ...b, grid: b.paint.grid, ink: b.inkImg.data, flash: b.flashImg.data };
    const worker = create(state, kernel), values = [];
    let seed = 719;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    await worker.ready;
    try {
      for (let step = 0; step < 66; step++) {
        if (scenario === 'sparse' || scenario === 'dense') for (let k = 0; k < (scenario === 'sparse' ? 4 : a.paint.grid.length); k++) {
          const i = scenario === 'sparse' ? Math.floor(random() * a.paint.grid.length) : k;
          a.paint.grid[i] = b.paint.grid[i] = Math.floor(random() * 3);
        }
        const y0 = Math.floor(a.h * (step % 3) / 3), y1 = Math.floor(a.h * (step % 3 + 1) / 3);
        let originalMs, result, applyMs;
        const original = () => { const t = performance.now(); a._drawInk(y0, y1); originalMs = performance.now() - t; };
        const parallel = async () => {
          // 颜色只在首段刷新，与原入口一致；第二/三段沿用首段快照。
          if (y0 === 0) b._rgb = b._teamRGB();
          result = await worker.draw(b.paint.grid, y0, y1, b._rgb || b._teamRGB());
          const t = performance.now(); apply(b, result); worker.recycle(result); applyMs = performance.now() - t;
        };
        if (step % 2) { await parallel(); original(); } else { original(); await parallel(); }
        if (!a.inkImg.data.every((v, i) => v === b.inkImg.data[i]) || !a.flashImg.data.every((v, i) => v === b.flashImg.data[i]) || !a.owner.every((v, i) => v === b.owner[i])) throw Error('基准像素不一致');
        if (step >= 12) values.push({ originalMs, mainMs: result.enqueueMs + result.callbackMs + applyMs, enqueueMs: result.enqueueMs, callbackMs: result.callbackMs, applyMs, workerMs: result.workerMs, roundtripMs: result.roundtripMs });
      }
      const sum = key => values.reduce((s, x) => s + x[key], 0);
      const percentile = (key, p) => values.map(x => x[key]).sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
      for (const key of ['ictx', 'fctx']) {
        const x = a[key].getImageData(0, 0, a.w, a.h).data, y = b[key].getImageData(0, 0, b.w, b.h).data;
        if (!x.every((v, i) => v === y[i])) throw Error('实际Canvas基准不一致');
      }
      results.push({ scenario, width: map.w, height: map.h, count: values.length, stateBytes: worker.bytes,
        originalMs: sum('originalMs'), mainMs: sum('mainMs'), enqueueMs: sum('enqueueMs'), callbackMs: sum('callbackMs'), applyMs: sum('applyMs'), workerMs: sum('workerMs'),
        roundtripP50: percentile('roundtripMs', .5), roundtripP95: percentile('roundtripMs', .95), mainRatio: sum('mainMs') / Math.max(.001, sum('originalMs')) });
    } finally { worker.dispose(); }
  }
  return results;
}
