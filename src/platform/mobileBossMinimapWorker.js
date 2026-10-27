import { G } from '../core/ctx.js';
import { computeMinimapInkBand } from './minimapInkKernel.js';
import { createMinimapBandWorker, applyMinimapBand } from './minimapBandWorker.js';

const entries = new WeakMap(), matches = new WeakMap(), history = new WeakMap();
const refNames = ['pixCell', 'pixFx', 'pixFy', 'pixSx', 'pixSy', 'owner', 'inkImg', 'flashImg', '_alpha', '_tm', '_tt'];
const references = m => [...refNames.map(name => m[name]), m.paint.grid];
const owns = c => entries.get(c.map) === c && matches.get(c.match) === c;
const realBoss = match => !!globalThis.inkwaveMobile && !!match?.boss && !match.attract && G.match === match;
const snapshot = c => ({ ready: c.ready, parked: !!c.parked, active: owns(c) && realBoss(c.match) && G.mode === 'match' && c.match.state === 'playing',
  width: c.map.w, height: c.map.h, stateBytes: c.worker?.bytes || c.bytes || 0, ...c.worker?.poolInfo(), ...c.stats });

// 终止后不重试创建，避免在战斗中分配数MiB数组。旧准备/消息不能释放或写入新局。
// 只有异常、重建、配色/force、离局或新局才终止；超龄/队列满/暂停只停用（park）。
function release(c, reason, fallback = false) {
  if (!owns(c)) { c.worker?.dispose(); return; }
  c.stats.reason = reason; c.stats.fallbacks += fallback ? 1 : 0;
  c.ready = false; c.worker?.dispose(); c.jobs.length = 0;
  entries.delete(c.map); matches.delete(c.match);
  history.set(c.map, { ...snapshot(c), active: false });
  globalThis.inkwaveDiagnostics?.record('mobile-boss-minimap-worker-release', { reason, fallback, submitted: c.stats.submitted, applied: c.stats.applied });
}

// 失效或暂停时保留Worker：在途段作废（迟到结果只回收不写入），由主线程原算法补画；排空后下一段携带主线程像素/owner重新同步。
function park(c, reason) {
  c.parked = true; c.stats.parks++; c.stats.reason = reason;
  for (const job of c.jobs) job.dropped = true;
  globalThis.inkwaveDiagnostics?.record('mobile-boss-minimap-worker-park', { reason, pending: c.jobs.length, parks: c.stats.parks });
}

export function clearMobileBossMinimapWorkerForMatch(match, reason = 'leave') {
  const c = match && matches.get(match);
  if (!c) return;
  const pause = reason === 'paused' || reason === 'suspend';
  // 已就绪的暂停/后台只停用并整图重画；准备中、离局和新局仍终止。
  if (pause && c.ready && owns(c)) {
    if (!c.parked) { park(c, reason); c.map.version = -1; c.map.timer = 0; c.map._band = 0; }
    return;
  }
  release(c, reason);
  if (pause) { c.map.version = -1; c.map.timer = 0; c.map._band = 0; }
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
    stats: { submitted: 0, applied: 0, frames: 0, maxPending: 0, maxAgeFrames: 0, maxAgeMs: 0, fallbackFullDraws: 0, fallbacks: 0, parks: 0, resyncs: 0, dropped: 0, reason: 'preparing' } };
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

// 按提交顺序消费已返回的段；作废段只回收缓冲，不写入地图。
function drain(c, map) {
  while (c.jobs[0]?.result) {
    const job = c.jobs.shift(), age = performance.now() - job.start;
    try {
      if (job.dropped) { c.worker.recycle(job.result); c.stats.dropped++; continue; }
      c.stats.maxAgeFrames = Math.max(c.stats.maxAgeFrames, c.frame - job.frame);
      c.stats.maxAgeMs = Math.max(c.stats.maxAgeMs, age);
      applyMinimapBand(map, job.result, job.quiet); c.worker.recycle(job.result); c.stats.applied++;
    } catch (error) { syncFallback(c, String(error).slice(0, 180)); return true; }
  }
}

// 每次原update调用一次；仅这里上传Canvas。回调只填job，不新增rAF或布局读取。
export function consumeMobileBossMinimapWorker(map, force = false) {
  const c = entries.get(map); if (!c || !c.ready) return;
  c.frame++; c.stats.frames++;
  if (!realBoss(c.match) || G.mode !== 'match' || !['init', 'intro', 'playing'].includes(c.match.state)) {
    syncFallback(c, 'inactive', false); return true;
  }
  if (changed(c)) { syncFallback(c, 'rebuilt'); return true; }
  if (c.error) { syncFallback(c, c.error); return true; }
  if (c.match.paused && !c.parked) { park(c, 'paused'); map._band = 0; return true; }
  // 停用期间走原同步路径；作废段排空、整图已重画且未暂停后才恢复Worker。
  if (c.parked) {
    if (drain(c, map)) return true;
    if (c.match.paused || map.version === -1 || c.jobs.length) return;
    c.parked = false; c.resync = true; c.stats.resyncs++; c.stats.reason = 'ready';
  }
  if (force || map.version === -1) { syncFallback(c, 'force-or-palette'); return true; }
  const now = performance.now();
  const oldest = c.jobs[0];
  if (oldest) {
    c.stats.maxAgeFrames = Math.max(c.stats.maxAgeFrames, c.frame - oldest.frame);
    c.stats.maxAgeMs = Math.max(c.stats.maxAgeMs, now - oldest.start);
  }
  // 3帧/250ms保护不变：本帧立即回原整图；一次GC或长帧不再让本局永久失去Worker。
  if (oldest && (c.frame - oldest.frame > 3 || now - oldest.start > 250)) {
    park(c, 'result-age'); c.stats.fallbackFullDraws++; map._band = 0; return true;
  }
  return drain(c, map);
}

export function queueMobileBossMinimapWorker(map, y0, y1) {
  const c = entries.get(map);
  if (!c?.ready || c.parked) return false;
  if (!realBoss(c.match) || G.mode !== 'match' || !['init', 'intro', 'playing'].includes(c.match.state)) {
    release(c, 'inactive-draw'); return false;
  }
  if (c.match.paused) { park(c, 'paused'); return false; }
  if (changed(c) || y0 === 0 && y1 === map.h) { release(c, 'synchronous-draw'); return false; }
  if (c.jobs.length >= 3) { park(c, 'queue-limit'); c.stats.fallbackFullDraws++; map._drawInk(0, map.h); return true; }
  if (y0 === 0) map._rgb = map._teamRGB();
  const job = { frame: c.frame, start: performance.now(), quiet: !!map._quiet, result: null, dropped: false };
  c.jobs.push(job); c.stats.submitted++; c.stats.maxPending = Math.max(c.stats.maxPending, c.jobs.length);
  // 恢复后的首段先把主线程owner/墨迹/闪光交给Worker，闪光判断与透明像素残值都与原同步路径一致。
  const sync = c.resync ? { owner: map.owner, ink: map.inkImg.data, flash: map.flashImg.data } : null; c.resync = false;
  c.worker.draw(map.paint.grid, y0, y1, map._rgb || map._teamRGB(), { sync })
    .then(result => { if (owns(c)) job.result = result; }, error => { if (owns(c)) c.error = String(error).slice(0, 180); });
  return true;
}
