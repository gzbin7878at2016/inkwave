// 仅副本方法实验：30Hz调度、三段/五帧周期，有界三请求；不接入真实地图或宣称FPS。
export async function benchmarkMinimapWorkerPipeline(map, kernel, create, apply, frames = 120) {
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
  const a = clone(), b = clone();
  const worker = create({ ...b, grid: b.paint.grid, ink: b.inkImg.data, flash: b.flashImg.data }, kernel, { maxPending: 3 });
  const ready = [], ages = [], elapsed = [], sequence = [], delayed = [], gaps = [];
  let error = null, queued = 0, applied = 0, inFlight = 0, peak = 0, originalMs = 0, mainMs = 0, seed = 719;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
  await worker.ready;
  let last = await tick(), frame = 0;
  try {
    while (frame < frames || inFlight || ready.length) {
      const now = await tick(); if (now - last < 32) continue;
      if (now - last > 100 && gaps.length < 12) gaps.push({ frame, ms: now - last }); last = now;
      if (error) throw error;
      while (ready.length) {
        const row = ready.shift();
        if (row.order !== applied) throw Error('Worker输出顺序改变');
        const start = performance.now(); apply(b, row.result); worker.recycle(row.result); mainMs += performance.now() - start + row.result.enqueueMs + row.result.callbackMs;
        const ageMs = performance.now() - row.start;
        ages.push(frame - row.frame); elapsed.push(ageMs); sequence.push(row.result.id); applied++;
        if (ageMs > 100 && delayed.length < 12) delayed.push({ frame, submitFrame: row.frame, ageMs, roundtripMs: row.result.roundtripMs });
      }
      if (frame < frames && frame % 5 < 3) {
        for (let i = 0; i < 4; i++) a.paint.grid[Math.floor(random() * a.paint.grid.length)] = Math.floor(random() * 3);
        const band = frame % 5, y0 = Math.floor(map.h * band / 3), y1 = Math.floor(map.h * (band + 1) / 3);
        const start = performance.now(); a._drawInk(y0, y1); originalMs += performance.now() - start;
        const row = { order: queued++, frame, start: performance.now() };
        inFlight++; peak = Math.max(peak, inFlight);
        worker.draw(a.paint.grid, y0, y1, a._rgb || a._teamRGB())
          .then(result => { inFlight--; row.result = result; ready.push(row); }, failure => { inFlight--; error = failure; });
      }
      frame++;
      if (frame > frames + 90) throw Error('流水线排空超时');
    }
    if (error) throw error;
    for (const key of ['owner']) if (!a[key].every((v, i) => v === b[key][i])) throw Error('流水线owner不一致');
    for (const key of ['inkImg', 'flashImg']) if (!a[key].data.every((v, i) => v === b[key].data[i])) throw Error('流水线原像素不一致');
    for (const key of ['ictx', 'fctx']) {
      const x = a[key].getImageData(0, 0, a.w, a.h).data, y = b[key].getImageData(0, 0, b.w, b.h).data;
      if (!x.every((v, i) => v === y[i])) throw Error('流水线实际Canvas不一致');
    }
    const percentile = (list, p) => list.slice().sort((a, b) => a - b)[Math.floor((list.length - 1) * p)];
    return { width: map.w, height: map.h, frames, queued, applied, peak, originalMs, mainMs,
      ageFramesP50: percentile(ages, .5), ageFramesP95: percentile(ages, .95), ageFramesMax: Math.max(...ages),
      displayAgeP50: percentile(elapsed, .5), displayAgeP95: percentile(elapsed, .95), displayAgeMax: Math.max(...elapsed),
      over3Frames: ages.filter(x => x > 3).length, over100ms: elapsed.filter(x => x > 100).length,
      ordered: sequence.every((v, i) => !i || v > sequence[i - 1]), pixelEqual: true, gaps, delayed };
  } finally { worker.dispose(); }
}
