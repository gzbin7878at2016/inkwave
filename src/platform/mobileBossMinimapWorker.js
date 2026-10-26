import { G } from '../core/ctx.js';
import { computeMinimapInkBand } from './minimapInkKernel.js';
import { createMinimapBandWorker, applyMinimapBand } from './minimapBandWorker.js';

const entries = new WeakMap(), matches = new WeakMap(), history = new WeakMap();
const refNames = ['pixCell', 'pixFx', 'pixFy', 'pixSx', 'pixSy', 'owner', 'inkImg', 'flashImg', '_alpha', '_tm', '_tt'];
const references = m => [...refNames.map(name => m[name]), m.paint.grid];
const owns = c => entries.get(c.map) === c && matches.get(c.match) === c;
const realBoss = match => !!globalThis.inkwaveMobile && !!match?.boss && !match.attract && G.match === match;
const snapshot = c => ({ ready: c.ready, active: owns(c) && realBoss(c.match) && G.mode === 'match' && c.match.state === 'playing',
  width: c.map.w, height: c.map.h, stateBytes: c.worker?.bytes || c.bytes || 0, ...c.worker?.poolInfo(), ...c.stats });

// 终止后不重试创建，避免在战斗中分配数MiB数组。旧准备/消息不能释放或写入新局。
function release(c, reason, fallback = false) {
  if (!owns(c)) { c.worker?.dispose(); return; }
  c.stats.reason = reason; c.stats.fallbacks += fallback ? 1 : 0;
  c.ready = false; c.worker?.dispose(); c.jobs.length = 0;
  entries.delete(c.map); matches.delete(c.match);
  history.set(c.map, { ...snapshot(c), active: false });
  globalThis.inkwaveDiagnostics?.record('mobile-boss-minimap-worker-release', { reason, fallback, submitted: c.stats.submitted, applied: c.stats.applied });
}

export function clearMobileBossMinimapWorkerForMatch(match, reason = 'leave') {
  const c = match && matches.get(match);
  if (c) {
    release(c, reason);
    if (reason === 'paused' || reason === 'suspend') { c.map.version = -1; c.map.timer = 0; c.map._band = 0; }
  }
}

export function mobileBossMinimapWorkerInfo(map) {
  const c = entries.get(map); return c ? snapshot(c) : history.get(map) || null;
}

// 必须在最终setViewerTeam之后、加载遮罩内调用，避免翻图/重建使已复制的数组失效。
export async function prepareMobileBossMinimapWorker(game, match, { isCurrent = () => true } = {}) {
  const map = game?.minimap;
  if (!map || !realBoss(match) || game.match !== match || !isCurrent()) return { skipped: true };
  clearMobileBossMinimapWorkerForMatch(match, 'reprepare');
  const previous = entries.get(map); if (previous) release(previous, 'new-owner'); history.delete(map);
  const c = { map, match, game, ready: false, jobs: [], frame: 0, worker: null, error: null, refs: null,
    stats: { submitted: 0, applied: 0, frames: 0, maxPending: 0, maxAgeFrames: 0, maxAgeMs: 0, fallbackFullDraws: 0, fallbacks: 0, reason: 'preparing' } };
  entries.set(map, c); matches.set(match, c);
  try {
    // 同步完成原首次图/配色/owner，再复制一次；实战不首次创建Worker或工作大数组。
    map.ensure();
    if (!Number.isSafeInteger(map.w * map.h) || map.w * map.h <= 0 || map.w * map.h > 500000) throw Error('小地图Worker像素预算超限');
    map._band = 0; map.update(0, true);
    c.refs = references(map); c.w = map.w; c.h = map.h;
    c.worker = createMinimapBandWorker({ w: map.w, h: map.h, grid: map.paint.grid,
      pixCell: map.pixCell, pixFx: map.pixFx, pixFy: map.pixFy, pixSx: map.pixSx, pixSy: map.pixSy,
      owner: map.owner, ink: map.inkImg.data, flash: map.flashImg.data, _alpha: map._alpha, _tm: map._tm, _tt: map._tt },
    computeMinimapInkBand, { maxPending: 3 });
    c.bytes = c.worker.bytes;
    await c.worker.ready;
    if (!owns(c) || !isCurrent() || !realBoss(match) || game.match !== match || game.minimap !== map) { release(c, 'cancelled'); return { cancelled: true }; }
    c.ready = true; c.stats.reason = 'ready';
    globalThis.inkwaveDiagnostics?.record('mobile-boss-minimap-worker-ready', snapshot(c));
    return { prepared: true, width: map.w, height: map.h, bytes: c.bytes };
  } catch (error) {
    const reason = String(error).slice(0, 180); release(c, reason, true);
    return { fallback: true, reason };
  }
}

function changed(c) {
  const m = c.map;
  if (m.w !== c.w || m.h !== c.h || c.game.minimap !== m || m.paint.grid !== c.refs[refNames.length]) return true;
  for (let i = 0; i < refNames.length; i++) if (m[refNames[i]] !== c.refs[i]) return true;
  return false;
}

// 回退时先丢弃队列再完整执行原算法，填上尚未应用的段，禁止迟到结果覆盖同步结果。
function syncFallback(c, reason, fallback = true) {
  release(c, reason, fallback);
  c.stats.fallbackFullDraws++;
  history.set(c.map, { ...snapshot(c), active: false });
  c.map._band = 0;
}

// 每次原update调用一次；仅这里上传Canvas。回调只填job，不新增rAF或布局读取。
export function consumeMobileBossMinimapWorker(map, force = false) {
  const c = entries.get(map); if (!c || !c.ready) return;
  c.frame++; c.stats.frames++;
  if (!realBoss(c.match) || G.mode !== 'match' || c.match.paused || !['init', 'intro', 'playing'].includes(c.match.state)) {
    syncFallback(c, 'inactive', false); return true;
  }
  if (changed(c)) { syncFallback(c, 'rebuilt'); return true; }
  if (force || map.version === -1) { syncFallback(c, 'force-or-palette'); return true; }
  const now = performance.now();
  const oldest = c.jobs[0];
  if (oldest) {
    c.stats.maxAgeFrames = Math.max(c.stats.maxAgeFrames, c.frame - oldest.frame);
    c.stats.maxAgeMs = Math.max(c.stats.maxAgeMs, now - oldest.start);
  }
  if (c.error || oldest && (c.frame - oldest.frame > 3 || now - oldest.start > 250)) {
    syncFallback(c, c.error || 'result-age'); return true;
  }
  while (c.jobs[0]?.result) {
    const job = c.jobs.shift(), age = performance.now() - job.start;
    c.stats.maxAgeFrames = Math.max(c.stats.maxAgeFrames, c.frame - job.frame);
    c.stats.maxAgeMs = Math.max(c.stats.maxAgeMs, age);
    try { applyMinimapBand(map, job.result, job.quiet); c.worker.recycle(job.result); c.stats.applied++; }
    catch (error) { syncFallback(c, String(error).slice(0, 180)); return true; }
  }
}

export function queueMobileBossMinimapWorker(map, y0, y1) {
  const c = entries.get(map);
  if (!c?.ready) return false;
  if (!realBoss(c.match) || G.mode !== 'match' || c.match.paused || !['init', 'intro', 'playing'].includes(c.match.state)) {
    release(c, 'inactive-draw'); return false;
  }
  if (changed(c) || y0 === 0 && y1 === map.h) { release(c, 'synchronous-draw'); return false; }
  if (c.jobs.length >= 3) { syncFallback(c, 'queue-limit'); map._drawInk(0, map.h); return true; }
  if (y0 === 0) map._rgb = map._teamRGB();
  const job = { frame: c.frame, start: performance.now(), quiet: !!map._quiet, result: null };
  c.jobs.push(job); c.stats.submitted++; c.stats.maxPending = Math.max(c.stats.maxPending, c.jobs.length);
  c.worker.draw(map.paint.grid, y0, y1, map._rgb || map._teamRGB())
    .then(result => { if (owns(c)) job.result = result; }, error => { if (owns(c)) c.error = String(error).slice(0, 180); });
  return true;
}
