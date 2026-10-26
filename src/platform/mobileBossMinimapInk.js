import { G } from '../core/ctx.js';

const MAX_BYTES = 8 * 1024 * 1024, UNKNOWN = 0xffffffff, SAMPLES = 96;
const preparedMaps = new WeakMap();
const inBoss = match => !!globalThis.inkwaveMobile && !!match?.boss && !match.attract && G.mode === 'match' && G.match === match;
const refs = map => [map.pixCell, map.pixFx, map.pixFy, map.pixSx, map.pixSy, map.inkImg, map.flashImg, map.owner, map._alpha, map._tm, map._tt, map.paint.grid];

// 只在Boss加载期分配；每像素6字节、每行1字节和96个采样码。实战不首次分配大数组。
export function prepareMobileBossMinimapInk(map, match) {
  // 实际加载时G.mode仍是menu，准备完成后才切match；这里只核对当前正式Boss身份。
  if (!map || !globalThis.inkwaveMobile || !match?.boss || match.attract || G.match !== match) return { skipped: true };
  clearMobileBossMinimapInk(map);
  map.ensure();
  const n = map.w * map.h, bytes = n * 6 + map.h + SAMPLES * 2;
  if (!Number.isSafeInteger(n) || n <= 0 || bytes > MAX_BYTES) return { skipped: true, reason: 'cache-budget', bytes };
  try {
    map._alpha ||= new Float32Array(n); map._tm ||= new Uint8Array(n); map._tt ||= new Uint8Array(n);
    const c = { match, w: map.w, h: map.h, bytes, patterns: new Uint16Array(n).fill(65535), signatures: new Uint32Array(n).fill(UNKNOWN),
      initialRows: new Uint8Array(map.h).fill(1), epoch: 0, palette: [null, null, null, null, null, null],
      samples: new Uint16Array(SAMPLES), sampleReady: false, bypassing: false,
      stats: { calls: 0, alphaHits: 0, alphaComputed: 0, rgbHits: 0, rgbComputed: 0, originalBands: 0, directBands: 0, inkUploads: 0, flashUploads: 0 } };
    c.refs = refs(map); map._bossInkCache = c; preparedMaps.set(match, map);
    return { prepared: true, bytes, width: map.w, height: map.h };
  } catch (error) { map._bossInkCache = null; return { fallback: true, reason: String(error) }; }
}

export function clearMobileBossMinimapInk(map, match) {
  if (map?._bossInkCache && (!match || map._bossInkCache.match === match)) {
    preparedMaps.delete(map._bossInkCache.match); map._bossInkCache = null;
  }
}

export function clearMobileBossMinimapInkForMatch(match) {
  const map = preparedMaps.get(match); clearMobileBossMinimapInk(map, match); preparedMaps.delete(match);
}

export function mobileBossMinimapInkInfo(map) {
  const c = map?._bossInkCache;
  return c ? { active: inBoss(c.match), bypassing: c.bypassing, bytes: c.bytes, width: c.w, height: c.h, ...c.stats } : null;
}

// 返回true表示本段已按原公式完成；其他场景/重建后立即丢弃缓存，由原_drawInk计算。
export function drawMobileBossMinimapInk(map, y0, y1) {
  const c = map._bossInkCache;
  if (!c) return false;
  const current = refs(map);
  if (!inBoss(c.match) || c.w !== map.w || c.h !== map.h || current.some((value, i) => value !== c.refs[i])) {
    clearMobileBossMinimapInk(map); return false;
  }
  const W = map.w, H = map.h, grid = map.paint.grid, cell = map.pixCell, fx = map.pixFx, fy = map.pixFy, sx = map.pixSx, sy = map.pixSy;
  const al = map._alpha, tm = map._tm, tt = map._tt, pattern = c.patterns, signatures = c.signatures;
  const d = map.inkImg.data, fd = map.flashImg.data, own = map.owner;
  // 固定少量有效像素探测“整幅都在变化”。此时直接交原入口，避免逐像素缓存检测放大重负载。
  let sampleCount = 0, sampleChanges = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const i = Math.floor((s + 0.5) * cell.length / SAMPLES), k = cell[i]; if (k < 0) continue;
    const g00 = grid[k], g10 = grid[k + sx[i]], g01 = grid[k + sy[i]], g11 = grid[k + sx[i] + sy[i]];
    if ((g00 | g10 | g01 | g11) > 3) { clearMobileBossMinimapInk(map); return false; }
    const key = g00 | (g10 << 2) | (g01 << 4) | (g11 << 6);
    sampleCount++; if (c.samples[s] !== key) sampleChanges++; c.samples[s] = key;
  }
  if (c.sampleReady && sampleCount && sampleChanges > sampleCount * 0.5) {
    if (!c.bypassing) { pattern.fill(65535); signatures.fill(UNKNOWN); }
    c.bypassing = true; c.stats.calls++; c.stats.originalBands++; return false;
  }
  c.sampleReady = true; c.bypassing = false;
  if (y0 === 0) map._rgb = map._teamRGB();
  const [A, B] = map._rgb || map._teamRGB(), p = c.palette;
  if (p[0] !== A[0] || p[1] !== A[1] || p[2] !== A[2] || p[3] !== B[0] || p[4] !== B[1] || p[5] !== B[2]) {
    p[0] = A[0]; p[1] = A[1]; p[2] = A[2]; p[3] = B[0]; p[4] = B[1]; p[5] = B[2];
    // 255保留给未初始化标记；代数回绕时清空，避免旧配色签名意外命中。
    c.epoch = (c.epoch + 1) % 255; if (c.epoch === 0) signatures.fill(UNKNOWN);
  }
  let alphaHits = 0, alphaComputed = 0, rgbHits = 0, rgbComputed = 0;
  const a0 = Math.max(0, y0 - 1) * W, a1 = Math.min(H, y1 + 1) * W;
  for (let i = a0; i < a1; i++) {
    const k = cell[i];
    if (k < 0) { al[i] = 0; pattern[i] = 0; continue; }
    const g00 = grid[k], g10 = grid[k + sx[i]], g01 = grid[k + sy[i]], g11 = grid[k + sx[i] + sy[i]];
    if ((g00 | g10 | g01 | g11) > 3) { clearMobileBossMinimapInk(map); return false; }
    const key = g00 | (g10 << 2) | (g01 << 4) | (g11 << 6);
    if (pattern[i] === key) { alphaHits++; continue; }
    pattern[i] = key; alphaComputed++;
    if (g00 === g10 && g00 === g01 && g00 === g11) { al[i] = g00 ? 1 : 0; tm[i] = g00; tt[i] = g00 || 1; continue; }
    const tx = fx[i] * (1 / 255), ty = fy[i] * (1 / 255);
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    const fa = (g00 === 1 ? w00 : 0) + (g10 === 1 ? w10 : 0) + (g01 === 1 ? w01 : 0) + (g11 === 1 ? w11 : 0);
    const fb = (g00 === 2 ? w00 : 0) + (g10 === 2 ? w10 : 0) + (g01 === 2 ? w01 : 0) + (g11 === 2 ? w11 : 0);
    const team = fa >= fb ? 1 : 2, f = team === 1 ? fa : fb;
    const t = Math.min(1, Math.max(0, (f - 0.34) / (0.62 - 0.34))), a = t * t * (3 - 2 * t);
    al[i] = a; tm[i] = a > 0.5 ? team : 0; tt[i] = team;
  }
  // 整幅快速变化时不做RGB签名比较，直接走原颜色公式；本段签名作废，避免之后误用旧结果。
  const cacheRGB = alphaHits >= alphaComputed;
  if (!cacheRGB) signatures.fill(UNKNOWN, y0 * W, y1 * W);
  let inkDirty = false, flashDirty = false, flashes = 0;
  for (let py = y0; py < y1; py++) {
    if (c.initialRows[py]) { inkDirty = flashDirty = true; c.initialRows[py] = 0; }
    for (let px = 0; px < W; px++) {
      const i = py * W + px, o = i * 4, a = al[i], oldAlpha = d[o + 3], oldFlash = fd[o + 3];
      if (a <= 0.003) {
        if (oldAlpha) inkDirty = true; if (oldFlash) flashDirty = true;
        d[o + 3] = 0; fd[o + 3] = 0; own[i] = 0; continue;
      }
      const upI = px > 0 && py > 0 ? i - W - 1 : i, dnI = px < W - 1 && py < H - 1 ? i + W + 1 : i;
      const signature = cacheRGB ? (pattern[i] | (pattern[upI] << 8) | (pattern[dnI] << 16) | (c.epoch << 24)) >>> 0 : 0;
      if (!cacheRGB || signatures[i] !== signature) {
        const color = tt[i] === 2 ? B : A, up = al[upI], dn = al[dnI];
        const lit = a - up > 0 ? a - up : 0, dark = a - dn > 0 ? a - dn : 0, k = 0.94 - dark * 0.32, add = lit * 150;
        d[o] = color[0] * k + add; d[o + 1] = color[1] * k + add; d[o + 2] = color[2] * k + add;
        if (cacheRGB) signatures[i] = signature; rgbComputed++; inkDirty = true;
      } else rgbHits++;
      // RGB未变也不能省alpha和owner闪光；清除后重新涂同色、其他像素触发新闪光都保持原字节。
      d[o + 3] = a * 255; if (d[o + 3] !== oldAlpha) inkDirty = true;
      const now = tm[i];
      if (now && own[i] !== now) { fd[o] = fd[o + 1] = fd[o + 2] = 255; fd[o + 3] = 170; flashes++; flashDirty = true; }
      else { fd[o + 3] = 0; if (oldFlash) flashDirty = true; }
      own[i] = now;
    }
  }
  if (inkDirty) map.ictx.putImageData(map.inkImg, 0, 0, 0, y0, W, y1 - y0);
  if (flashDirty) map.fctx.putImageData(map.flashImg, 0, 0, 0, y0, W, y1 - y0);
  if (flashes && !map._quiet) map.flashT = 0;
  const s = c.stats; s.calls++; s.alphaHits += alphaHits; s.alphaComputed += alphaComputed;
  s.directBands += Number(!cacheRGB);
  s.rgbHits += rgbHits; s.rgbComputed += rgbComputed; s.inkUploads += Number(inkDirty); s.flashUploads += Number(flashDirty);
  return true;
}
