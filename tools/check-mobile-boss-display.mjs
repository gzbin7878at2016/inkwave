// 检查实际平台调度器：Boss边界、桥调用串行与快速暂停时的最终恢复；非手机无调用。
import assert from 'node:assert/strict';
import { createMobileBossDisplay } from '../src/platform/mobileBossDisplay.js';
const game = () => ({ settings: { fpsCap: 30 }, match: { boss: {}, state: 'playing', attract: false, paused: false } });
for (const [label, change, mode, suspended, expected] of [
  ['手机Boss30', () => {}, 'match', false, true],
  ['手机Boss60', g => g.settings.fpsCap = 60, 'match', false, true],
  ['不限速', g => g.settings.fpsCap = 0, 'match', false, false],
  ['更高帧率', g => g.settings.fpsCap = 120, 'match', false, false],
  ['普通对局', g => g.match.boss = null, 'match', false, false],
  ['大厅演示', g => g.match.attract = true, 'match', false, false],
  ['菜单', () => {}, 'menu', false, false],
  ['加载', g => g.match.state = 'init', 'match', false, false],
  ['加载预检', g => {g.match.state = 'init'; g._mobilePreparation = {};}, 'menu', false, true],
  ['失败加载', g => {g.match.state = 'init'; g._mobilePreparation = {}; g._mobilePreparationError = true;}, 'menu', false, false],
  ['开场', g => g.match.state = 'intro', 'match', false, true],
  ['结算', g => g.match.state = 'finish', 'match', false, false],
  ['暂停', g => g.match.paused = true, 'match', false, false],
  ['后台', () => {}, 'match', true, false],
  ['无对局', g => g.match = null, 'match', false, false],
]) {
  const calls = [], g = game(); change(g);
  const controller = createMobileBossDisplay({ async setBossActive(v) { calls.push(v.active); return v; } });
  await controller.update(g, mode, suspended);
  for (let i = 0; i < 300; i++) await controller.update(g, mode, suspended);
  assert.deepEqual(calls, [expected], label + '范围或逐帧调用错误');
  if (expected) { g.match.state = 'finish'; await controller.update(g, mode, suspended); assert.deepEqual(calls, [true, false]); }
}
const calls = [], release = [], g = game(); let concurrent = 0, peak = 0;
const early=game(),earlyCalls=[];early.match.state='init';early._mobilePreparation={};
const earlyController=createMobileBossDisplay({async setBossActive(v){earlyCalls.push(v.active);return v;}});
await earlyController.update(early,'menu',false);
early.match.state='intro';early._mobilePreparation=null;await earlyController.update(early,'match',false);
early.match.state='playing';await earlyController.update(early,'match',false);
assert.deepEqual(earlyCalls,[true],'加载到实战重复申请');
early.match=null;await earlyController.update(early,'menu',false);assert.deepEqual(earlyCalls,[true,false],'取消/返回菜单未恢复');
const c = createMobileBossDisplay({ setBossActive(v) { calls.push(v.active); peak = Math.max(peak, ++concurrent);
  return new Promise(resolve => release.push(() => { concurrent--; resolve(v); })); } });
const pending = c.update(g, 'match', false);
await c.suspend(); assert.deepEqual(calls, [true]);
release.shift()(); await new Promise(r => setTimeout(r, 0)); assert.deepEqual(calls, [true, false]);
release.shift()(); await pending; assert.equal(peak, 1);
let failures = 0; const events = [];
const failing = createMobileBossDisplay({ async setBossActive() { failures++; throw Error('不支持'); } }, (n, d) => events.push([n, d]));
for (let i = 0; i < 300; i++) await failing.update(g, 'match', false);
assert.equal(failures, 1); assert.equal(events[0][0], 'mobile-boss-display-failed');
await failing.suspend(); assert.equal(failures, 2);
await createMobileBossDisplay(null).update(g, 'match', false);
console.log('通过：15个实际场景边界、加载预检/开场提前申请、每帧去重、桥串行/暂停恢复、失败不刷屏及非原生隔离；原生是否采纳需真机验证');
