// 执行真实render入口，验证空展台无窗口读取，活动展台/后巷/退出过渡与肖像队列不被跳过。
import assert from 'node:assert/strict';
import { Showcase } from '../src/game/showcase.js';
import { G } from '../src/core/ctx.js';
const old = { mobile: globalThis.inkwaveMobile, match: G.match, mode: G.mode,
  width: Object.getOwnPropertyDescriptor(globalThis, 'innerWidth'), height: Object.getOwnPropertyDescriptor(globalThis, 'innerHeight') };
let reads = 0, portrait = 0, rendered = 0;
const DRAW = new Error('已进入原绘制路径');
Object.defineProperty(globalThis, 'innerWidth', { configurable: true, get() { reads++; return 778; } });
Object.defineProperty(globalThis, 'innerHeight', { configurable: true, get() { reads++; return 370; } });
const fixture = overrides => ({ _pq: [], _portraitStep() { portrait++; }, lob: null, mode: null, _out: 0, chars: [],
  r: { getRenderTarget() { rendered++; throw DRAW; } }, ...overrides });
const cases = [];
try {
  for (const mobile of [false, true]) for (const boss of [false, true]) for (const mode of ['menu', 'match']) {
    globalThis.inkwaveMobile = mobile; G.match = { boss: boss ? {} : null }; G.mode = mode;
    const before = reads, show = fixture();
    for (let i = 0; i < 10; i++) Showcase.prototype.render.call(show);
    assert.equal(reads - before, mobile && boss && mode === 'match' ? 0 : 20);
    assert.equal(show._fdt, 1 / 60); cases.push({ mobile, boss, mode, reads: reads - before });
  }
  globalThis.inkwaveMobile = true; G.match = { boss: {} }; G.mode = 'match';
  for (const overrides of [
    { mode: 'loadout', chars: [{}] },
    { mode: 'results', chars: [{}] },
    { _out: 0.1, _lastMode: 'locker', chars: [{}] },
    { lob: { ready: true, set: {}, k: 0.5 } },
  ]) {
    const before = reads;
    assert.throws(() => Showcase.prototype.render.call(fixture(overrides)), e => e === DRAW);
    assert.equal(reads - before, 2, '活动内容应读取真实窗口并进入原绘制路径');
  }
  const before = reads;
  Showcase.prototype.render.call(fixture({ _pq: [{}] }));
  assert.equal(portrait, 1); assert.equal(reads - before, 0); assert.equal(rendered, 4);
  console.log(JSON.stringify({ cases, activeDrawPaths: rendered, portraitSteps: portrait, passed: true }));
} finally {
  globalThis.inkwaveMobile = old.mobile; G.match = old.match; G.mode = old.mode;
  for (const [key, descriptor] of [['innerWidth', old.width], ['innerHeight', old.height]]) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
