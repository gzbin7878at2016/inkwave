// 确定性验证手机准备流程：直接执行真实Game方法，隔离浏览器/GPU副作用，不模拟真机帧率。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import * as config from '../src/config.js';
import { prepareMobileMaterialPrograms } from '../src/platform/mobileWarmup.js';

const noop = () => {};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const classStart = mainSource.indexOf('class Game {');
const classEnd = mainSource.lastIndexOf('// 【发动机点火】');
assert.ok(classStart >= 0 && classEnd > classStart, '主控模块保留可隔离执行的Game类');

let clock = 100, timerId = 0;
const memory = new Map();
const fakeDocument = {
  hidden: false, visibilityState: 'visible',
  addEventListener: noop,
  createElement: () => ({ dataset: {}, style: {}, append: noop, remove: noop }),
  getElementById: () => null, body: { append: noop },
};
const sandbox = {
  ...config, THREE, console: { log: noop, warn: noop, error: noop },
  performance: { now: () => clock },
  document: fakeDocument, navigator: { userAgent: 'deterministic-preparation-check' },
  location: { search: '', href: 'http://test.invalid/' }, URL, URLSearchParams,
  localStorage: { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) },
  setTimeout: () => ++timerId, clearTimeout: noop, setInterval: () => ++timerId,
  requestAnimationFrame: noop, innerWidth: 1000, innerHeight: 464, devicePixelRatio: 2,
  inkwaveMobile: true, fetch: async () => ({ ok: true }), addEventListener: noop,
  params: new URLSearchParams(), DEV_STAGE: false,
  BOSS_MODE: { duration: 180 }, nextMobileFrame: async () => {},
  prepareMobileMaterialPrograms,
};
sandbox.window = sandbox;
sandbox.G = {};
const context = vm.createContext(sandbox);
const diagnosticsSource = await readFile(new URL('../src/platform/diagnostics.js', import.meta.url), 'utf8');
vm.runInContext(diagnosticsSource.replace(/^export /gm, '') + '\ninstallDiagnostics(null);', context);
const diagnostics = sandbox.inkwaveDiagnostics;

// 假时钟使容量/阈值验证不需要在机器上真的阻塞多秒。
for (let i = 0; i < 280; i++) {
  const finish = diagnostics.beginStage(`bounded-startup-${i}`);
  clock++; finish();
}
assert.equal(diagnostics.report().current.startup.stages.length, 256);
assert.equal(diagnostics.report().current.startup.stages[0].name, 'bounded-startup-24');
diagnostics.finishStartup();
const operation = (name, duration) => { const done = diagnostics.beginStage(name); clock += duration; done(); };
operation('below-threshold', 199);
operation('at-threshold', 200);
assert.deepEqual(Array.from(diagnostics.report().current.responsiveness.slowOperations, row => row.name), ['at-threshold']);
for (let i = 0; i < 25; i++) operation(`slow-${i}`, 201 + i);
for (let i = 0; i < 55; i++) operation(`cached-${i}`, 1);
const response = diagnostics.report().current.responsiveness;
assert.equal(response.operationCount, 82);
assert.equal(response.operations.length, 40);
assert.equal(response.operations[0].name, 'cached-15');
assert.equal(response.slowOperations.length, 20);
assert.deepEqual(Array.from(response.slowOperations, row => row.durationMs), Array.from({ length: 20 }, (_, i) => 225 - i));
assert.equal(response.slowOperations[0].name, 'slow-24', '快速命中不能挤掉先前最慢操作');
assert.ok(!response.slowOperations.some(row => row.name === 'below-threshold'));
console.log('通过：启动256条、近期操作40条、最慢操作20条、200ms阈值及总计数');

const Game = vm.runInContext(mainSource.slice(classStart, classEnd) + '\nGame;', context);
const stages = [];
sandbox.inkwaveDiagnostics = { beginStage: name => { const stage = { name, closed: false }; stages.push(stage); return () => { stage.closed = true; }; } };

// 一次真实_frame必须以同一前缀记录完整阶段并全部闭合；常规帧不做逐段诊断。
const frameGame = Object.create(Game.prototype);
const vectorUniform = () => ({ value: new THREE.Vector3() });
frameGame.input = { pollPad: noop, endFrame: noop };
frameGame._padMenus = noop;
frameGame.decor = { update: noop };
frameGame.rig = { setMap: noop, update: noop };
frameGame._dioFog = noop;
frameGame.levelMat = { userData: { uniforms: { uTime: { value: 0 }, uSeeOn: { value: 0 }, uSeeA: vectorUniform(), uSeeB: vectorUniform() } } };
frameGame.showcase = { update: noop, render: noop };
frameGame._updateLocalLoops = noop;
frameGame._updateAmbience = noop;
frameGame.R = { grade: { uniforms: { uHurt: { value: 0 } } }, render: noop };
frameGame.settings = { quality: 'low' };
sandbox.damp = (_value, target) => target;
sandbox.G = {
  time: 0, renderer: { info: { reset: noop, render: { calls: 0, triangles: 0 } }, shadowMap: {} },
  fx: { update: noop }, env: {}, camera: { position: new THREE.Vector3() },
  projectiles: { updateArc: noop }, paint: { flush: noop },
};
frameGame._frame(1 / 60, 'startup-frame');
assert.deepEqual(stages.map(stage => stage.name), ['input', 'simulation', 'effects', 'environment', 'camera', 'paint', 'prepare', 'draw', 'ui'].map(name => `startup-frame-${name}`));
assert.ok(stages.every(stage => stage.closed));
const tracedCount = stages.length;
frameGame._frame(1 / 60);
assert.equal(stages.length, tracedCount);
console.log('通过：真实首帧9段顺序/闭合，常规帧不新增逐段诊断');

let heartbeat = 0, endFrames = 0, frames = 0, dynamic = 0;
sandbox.G.net = { update: () => { heartbeat++; } };
const loopGame = Object.create(Game.prototype);
Object.assign(loopGame, {
  _mobilePreparation: {}, settings: { fpsCap: 0 },
  timer: { update: noop, getDelta: () => 0.016 },
  input: { endFrame: () => { endFrames++; } },
  _trackVsync: noop, _frame: () => { frames++; }, _dynRes: () => { dynamic++; },
  fpsAcc: 0, fpsN: 0,
});
loopGame._loop(1000);
assert.equal(heartbeat, 1); assert.equal(endFrames, 1);
assert.equal(frames, 0); assert.equal(dynamic, 0);
loopGame._mobilePreparation = null;
loopGame._loop(1016);
assert.equal(frames, 1); assert.equal(dynamic, 1);
console.log('通过：准备期保留心跳和帧末输入清理，暂停模拟/绘制与动态分辨率');

// 开局入口检查放在下方：通过可控Promise观察重复请求、过期回调与异常收尾。
function gameFixture({ fade, world, warm } = {}) {
  const calls = { fade: [], world: 0, setup: 0, start: 0, warm: 0, bind: 0, touch: [], dispose: 0 };
  const game = Object.create(Game.prototype);
  sandbox.G = {
    audio: { init: noop, duck: noop }, music: { stop: noop, preload: noop },
    projectiles: { clear: noop }, subs: { clear: noop }, specials: { clear: noop }, fx: { clear: noop }, paint: { clear: noop },
    env: {}, scene: {}, net: { myId: 'local', isHost: true },
  };
  sandbox.Match = class {
    constructor(opts) { this.options = opts; this.actors = []; this.state = 'init'; }
    setup() { calls.setup++; }
    start() { calls.start++; this.state = 'playing'; }
    dispose() { calls.dispose++; }
  };
  const map = config.OFFLINE_MAPS[0];
  Object.assign(game, {
    settings: { difficulty: 'normal' }, profile: {}, mapDef: map, time: 'day', theme: config.mapTheme(map, 'day'),
    input: { requestLock: noop, touch: { setEnabled: enabled => calls.touch.push(enabled), clear: noop } },
    menus: { show: noop, toast: noop }, showcase: { hide: noop },
    rig: { follow: noop }, hud: { setVisible: noop, setPractice: noop }, minimap: { setViewerTeam: noop },
    _clearDeathMarks: noop, _applyNight: noop, _setPalette: noop, _pickPalette: () => [],
    _subFor: () => 'bomb', _specialFor: () => 'zooka',
    _fade: (opacity, duration) => { calls.fade.push({ opacity, duration }); return opacity === 1 && fade ? fade.promise : Promise.resolve(); },
    _buildWorld: () => { calls.world++; return world ? world.promise : Promise.resolve(); },
    _warmCharacters: () => { calls.warm++; return warm ? warm.promise : Promise.resolve(); },
  });
  const network = { bind: () => { calls.bind++; } };
  sandbox.G.net.match = network;
  const cfg = { map: map.id, time: 'day', mode: 'turf', palette: 0, roster: [] };
  return { game, calls, network, cfg, opts: { mapId: map.id } };
}

// 令牌在第一个await前已生效，任一入口在准备阶段都只能保留一个请求。
for (const online of [false, true]) {
  const fade = deferred(), warm = deferred();
  const fixture = gameFixture({ fade, warm });
  const { game, calls, cfg, network, opts } = fixture;
  const request = online ? game.startNetMatch(cfg, network) : game.startMatch(opts);
  const token = game._mobilePreparation;
  assert.ok(token && token.done && calls.touch[0] === false, '淡出前必须锁定准备期并关闭触摸');
  assert.equal(await game.startMatch(opts), false);
  assert.equal(await game.startNetMatch(cfg, network), false);
  assert.equal(calls.fade.length, 1, '重复请求不得先淡出或更换场景');
  assert.equal(calls.world, 0);
  fade.resolve(); await flush();
  assert.equal(calls.world, 1); assert.equal(calls.setup, 1); assert.equal(calls.warm, 1);
  assert.equal(calls.start, 0); assert.equal(calls.bind, 0);
  assert.equal(await game.startMatch(opts), false);
  assert.equal(await game.startNetMatch(cfg, network), false);
  warm.resolve();
  assert.equal(await request, true);
  await token.done;
  assert.equal(game._mobilePreparation, null);
  assert.equal(calls.start, online ? 0 : 1); assert.equal(calls.bind, online ? 1 : 0);
}
console.log('通过：单机/联机入口均在淡出前加锁，同/异入口重复请求不建世界、不提前开始/绑定');

// 对每个异步边界取消，旧回调都不能继续设置场景或启动对局。
for (const online of [false, true]) for (const phase of ['fade', 'world', 'warm']) {
  const hold = deferred();
  const { game, calls, cfg, network, opts } = gameFixture({ [phase]: hold });
  const request = online ? game.startNetMatch(cfg, network) : game.startMatch(opts);
  const token = game._mobilePreparation;
  await flush();
  token.cancelled = true;
  hold.resolve();
  assert.equal(await request, false, `${online ? '联机' : '单机'}${phase}取消不得成功开局`);
  await token.done;
  assert.equal(game._mobilePreparation, null);
  assert.equal(calls.world, phase === 'fade' ? 0 : 1);
  assert.equal(calls.setup, phase === 'warm' ? 1 : 0);
  assert.equal(calls.start, 0); assert.equal(calls.bind, 0);
}
console.log('通过：单机/联机淡出、世界准备、角色预热三个await边界取消后均停止后续开局');

// 真实session离房会直接清空net.match；没有主动cancel的令牌也必须过期。
for (const phase of ['fade', 'world', 'warm']) {
  const hold = deferred();
  const { game, calls, cfg, network } = gameFixture({ [phase]: hold });
  const request = game.startNetMatch(cfg, network);
  const token = game._mobilePreparation;
  await flush();
  assert.equal(token.networkMatch, network);
  assert.equal(token.cancelled, false);
  sandbox.G.net.match = null;
  assert.equal(token.cancelled, false, '检验session身份失效，不能借助主动取消通过');
  hold.resolve();
  assert.equal(await request, false, `联机${phase}离房后不得复活旧对局`);
  await token.done;
  assert.equal(game._mobilePreparation, null);
  assert.equal(calls.world, phase === 'fade' ? 0 : 1);
  assert.equal(calls.setup, phase === 'warm' ? 1 : 0);
  assert.equal(calls.bind, 0); assert.equal(calls.start, 0);
}
console.log('通过：淡出、世界准备、角色预热期间session.match清空后，即使令牌未cancel也不再bind旧联机对局');

for (const online of [false, true]) {
  const world = deferred();
  const { game, cfg, network, opts } = gameFixture({ world });
  const request = online ? game.startNetMatch(cfg, network) : game.startMatch(opts);
  const token = game._mobilePreparation;
  await flush(); world.reject(new Error('world-preparation-test'));
  await assert.rejects(request, /world-preparation-test/);
  await token.done;
  assert.equal(game._mobilePreparation, null, '准备异常必须释放令牌');
}
const { game: tokenGame } = gameFixture();
const oldToken = tokenGame._beginMobilePreparation();
oldToken.cancelled = true;
assert.equal(tokenGame._isMobilePreparationCurrent(oldToken), false);
tokenGame._finishMobilePreparation(oldToken); await oldToken.done;
const newToken = tokenGame._beginMobilePreparation();
tokenGame._finishMobilePreparation(oldToken);
assert.equal(tokenGame._mobilePreparation, newToken, '旧任务收尾不能释放新任务令牌');
assert.equal(tokenGame._isMobilePreparationCurrent(newToken), true);
tokenGame._finishMobilePreparation(newToken); await newToken.done;
assert.equal(tokenGame._mobilePreparation, null);
sandbox.inkwaveMobile = false;
assert.equal(tokenGame._beginMobilePreparation(), null, 'PC不创建手机准备令牌');
console.log('通过：准备失败释放、取消令牌判定、过期finally不覆盖新令牌、PC不加手机锁');

sandbox.inkwaveMobile = true;
const worldHold = deferred();
const { game: quitGame, calls: quitCalls, opts: quitOpts } = gameFixture({ world: worldHold });
let attractStarts = 0;
quitGame.input.exitLock = noop;
quitGame._playMusic = noop;
quitGame._startAttract = () => { attractStarts++; quitGame.match = { attract: true }; };
sandbox.G.net.state = 'offline';
const preparing = quitGame.startMatch(quitOpts);
await flush();
assert.equal(quitCalls.world, 1);
const quitting = quitGame.quitToMenu();
await flush();
assert.equal(quitGame._mobilePreparation.cancelled, true);
assert.equal(attractStarts, 0, '取消后必须等待旧建造完成，不能并发重建演示世界');
assert.equal(await quitGame.startMatch(quitOpts), false);
worldHold.resolve();
assert.equal(await preparing, false);
await quitting;
assert.equal(quitGame._mobilePreparation, null);
assert.equal(attractStarts, 1); assert.equal(quitCalls.setup, 0); assert.equal(quitCalls.start, 0);
console.log('通过：退出取消会等旧世界安全结束，随后恢复演示世界且无令牌done死锁');

const actorHold = deferred();
const { game: actorGame, network: actorNetwork } = gameFixture();
let firstActor = 0, secondActor = 0;
const actorMatch = { actors: [
  { character: { warmAll() { firstActor++; return actorHold.promise; } } },
  { character: { warmAll() { secondActor++; return Promise.resolve(); } } },
] };
actorGame.match = actorMatch;
const actorToken = actorGame._beginMobilePreparation(); actorToken.networkMatch = actorNetwork;
const actorWarm = Game.prototype._warmCharacters.call(actorGame, actorMatch);
await flush();
assert.equal(firstActor, 1); assert.equal(secondActor, 0);
sandbox.G.net.match = null;
actorHold.resolve(); await actorWarm;
assert.equal(actorToken.cancelled, false); assert.equal(secondActor, 0);
actorGame._finishMobilePreparation(actorToken);
console.log('通过：单角色预热等待期间session失效后，主控不再启动后续角色预热');

// Boss也须逐网格隔离编译；异步链接期间取消时，不再准备接口或进入下一网格。
for (const cancelMode of [null, 'token', 'network']) {
  const cancel = cancelMode !== null;
  const { game, network } = gameFixture();
  const meshRoot = new THREE.Group();
  const one = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); one.name = 'boss-one';
  const two = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); two.name = 'boss-two'; two.visible = false;
  one.add(two); meshRoot.add(one);
  const hold = deferred();
  let target = 'screen', compiles = 0, uniforms = 0, attributes = 0, yields = 0;
  const program = { getUniforms: () => { uniforms++; }, getAttributes: () => { attributes++; } };
  const renderer = {
    info: { programs: [] }, properties: { get: () => ({ currentProgram: program }) },
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    compileAsync(proxy) {
      compiles++;
      assert.ok(proxy.isMesh && proxy.parent === null && proxy.children.length === 0);
      assert.equal(proxy.visible, true); assert.equal(proxy.frustumCulled, false);
      assert.equal(target, 'hdr');
      return cancel ? hold.promise : Promise.resolve();
    },
  };
  game.R = { composer: { readBuffer: 'hdr' } };
  sandbox.G.renderer = renderer; sandbox.G.camera = new THREE.PerspectiveCamera();
  sandbox.nextMobileFrame = async () => { yields++; };
  const match = { actors: [], boss: { model: { ready: Promise.resolve() }, warm: () => [meshRoot] } };
  game.match = match;
  const token = game._beginMobilePreparation();
  if (cancelMode === 'network') token.networkMatch = network;
  const warming = Game.prototype._warmCharacters.call(game, match);
  await flush();
  if (cancel) {
    if (cancelMode === 'network') sandbox.G.net.match = null;
    else token.cancelled = true;
    hold.resolve();
  }
  await warming;
  assert.equal(target, 'screen');
  assert.equal(compiles, cancel ? 1 : 2);
  assert.equal(uniforms, cancel ? 0 : 2); assert.equal(attributes, cancel ? 0 : 2);
  assert.equal(yields, cancel ? 0 : 2);
  if (cancelMode === 'network') assert.equal(token.cancelled, false);
  assert.equal(one.parent, meshRoot); assert.equal(two.parent, one); assert.equal(two.visible, false);
  game._finishMobilePreparation(token);
}
console.log('通过：Boss预热逐网格使用HDR目标、主动完成程序接口、每步让帧，主动取消/session失效后不查询或编译后续网格');
