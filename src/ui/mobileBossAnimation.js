import { G } from '../core/ctx.js';

const states = new WeakMap();
// 只替换已核对CSS的高频Boss反馈；其他动画、PC及普通对局继续走原重启方式。
export function restartMobileBossAnimation(el, cls) {
  if (!globalThis.inkwaveMobile || !G.match?.boss || G.mode !== 'match') return false;
  const c = el.classList;
  const supported = (cls === 'is-hit' && c.contains('iw-bb')) ||
    (cls === 'is-weak' && (c.contains('iw-bb') || c.contains('iw-bb__emb'))) ||
    (cls === 'is-bump' && c.contains('iw-bnum')) ||
    (cls === 'is-on' && c.contains('iw-hit')) ||
    (cls === 'is-hitflash' && c.contains('iw-ret'));
  if (!supported) return false;
  let map = states.get(el);
  if (!map) states.set(el, map = new Map());
  let state = map.get(cls);
  if (!state) map.set(cls, state = { phase: false, pending: false });
  el.classList.add(cls);
  if (!state.pending) {
    state.pending = true;
    // 同一战斗帧的多次命中合并成最后一次重启；微任务在本帧绘制前执行，不延迟两帧。
    queueMicrotask(() => {
      state.pending = false; state.phase = !state.phase;
      el.setAttribute(`data-iw-repeat-${cls.slice(3)}`, state.phase ? 'b' : 'a');
    });
  }
  return true;
}
