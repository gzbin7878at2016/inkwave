// 离线验证输入生成器；用只读代理禁止它改Actor/Boss状态，不把模拟夹具当手机FPS或真实伤害证明。
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createBossPlaybackDirector } from './boss-playback-director.mjs';
function fixture() {
  const pos = new Vector3(0, 0, -20), shapePos = new Vector3(0, 5, 0), rawStats = { bossDmg: 0, weakHits: 0 };
  const forbidden = object => new Proxy(object, { set() { throw Error('测试工具不得写战斗状态'); } });
  let ink = 100, alive = true;
  const actor = forbidden({ pos: forbidden(pos), get ink() { return ink; }, get alive() { return alive; }, team: 0, groundTeam: 1,
    weapon: Object.freeze({ range: 12.5 }), special: 0, specialCost: () => 1000, stats: forbidden(rawStats) });
  const shape = Object.freeze({ active: true, weak: true, socket: 'eyeL', r: .4, pos: forbidden(shapePos) });
  const boss = forbidden({ pos: forbidden(new Vector3()), yaw: 0, hp: 93600, phase: 1, visible: true, dead: false,
    crabs: new Map(), model: { hitShapes: [shape] }, segHit: () => ({ weak: true }), hz: { threat: () => ({ ringIn: -1, level: 0, beam: false }) } });
  const match = { local: actor, boss, state: 'playing', paused: false };
  const nodes = [{ x: 0, y: 0, z: -20, zone: -1, wet: 0, nb: [{ to: 1, type: 'walk' }] },
    { x: 4, y: 0, z: -20, zone: -1, wet: 0, nb: [{ to: 2, type: 'walk' }] }, { x: 4, y: 0, z: -10, zone: -1, wet: 0, nb: [] }];
  const G = { mode: 'match', physics: { los: () => true }, nav: { nodes, nearest: p => p === actor.pos ? 0 : 2,
    path: () => [0, 1, 2], edge: () => ({ type: 'walk' }) } };
  const game = { match, rig: { yaw: 0, pitch: 0 }, input: { keys: new Set(), mouse: { left: false } } };
  const actions = { move: 0, fire: 0, jump: 0, sub: 0, special: 0, squid: 0 };
  const director = createBossPlaybackDirector(game, G, actions); director.bind(match);
  return { director, game, G, pos, actor, match, rawStats, actions, ink: value => { ink = value; }, alive: value => { alive = value; } };
}
const f = fixture(); f.director.step(0, 1 / 30);
assert(f.game.input.keys.has('KeyA'), '正X导航应转换为相机相对A键');
assert(!f.game.input.mouse.left, '射程外不应空耗墨水');
for (let i = 1; i <= 10; i++) f.director.step(i * 33.34, 1 / 30);
assert(f.game.rig.pitch > .08, '必须根据真实目标高度瞄准');
assert(f.director.info().pathSuccess > 0 && f.director.info().weakAimFrames > 0);
for (let i = 11; i <= 130; i++) f.director.step(i * 33.34, 1 / 30);
assert(f.director.info().stuckRecoveries > 0 && f.director.info().maxStillSeconds > 2, '卡墙恢复/真实静止统计未工作');
assert.equal(f.director.info().distanceTravelled, 0, '输入计数不能冒充真实位移');
const m = fixture();
for (let i = 0; i < 90; i++) { m.director.step(i * 33.34, 1 / 30); m.pos.x += .1; m.rawStats.bossDmg += 10; }
assert(m.director.info().distanceTravelled > 8 && m.director.info().bossDamage > 800, '必须读取真实模拟状态的位移/伤害');
assert(m.director.info().movedFrames > 80);
const r = fixture(); r.pos.z = -8; r.ink(10); r.director.step(0, 1 / 30);
assert(r.game.input.keys.has('ShiftLeft') && !r.game.input.mouse.left, '低墨应使用正常潜墨输入');
r.ink(95); r.director.step(33.34, 1 / 30); assert(!r.game.input.keys.has('ShiftLeft') && r.game.input.mouse.left, '墨量恢复后应继续正常开火');
r.match.paused = true; r.director.step(66.68, 1 / 30); assert.equal(r.game.input.keys.size, 0); assert(!r.game.input.mouse.left);
r.match.paused = false; r.alive(false); r.director.step(100, 1 / 30); assert.equal(r.game.input.keys.size, 0);
r.alive(true); r.G.mode = 'menu'; r.director.step(133, 1 / 30); assert.equal(r.game.input.keys.size, 0);
r.G.mode = 'match'; r.director.dispose(); r.director.step(166, 1 / 30); assert.equal(r.game.input.keys.size, 0);
for (const x of [f, m]) x.director.dispose();
console.log('通过：只读战斗状态、实际射程/目标高度/导航键转换、卡墙恢复、真实位移和伤害读取、低墨恢复及暂停/死亡/菜单/清理；此为离线输入逻辑验证');
