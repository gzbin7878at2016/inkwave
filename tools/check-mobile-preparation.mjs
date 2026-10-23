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
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
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
  prepareMobileCombat: async (_game, _match, { isCurrent, onProgress }) => {
    if (!isCurrent()) return { cancelled: true };
    onProgress?.({ completed: 1, total: 1, label: '准备战斗效果' }); return {};
  },
};
sandbox.window = sandbox;
sandbox.G = {};
const context = vm.createContext(sandbox);
const frameReadySource = await readFile(new URL('../src/platform/mobileFrameReady.js', import.meta.url), 'utf8');
vm.runInContext(frameReadySource.replace(/^export /gm, ''), context);
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
sandbox.inkwaveDiagnostics = { record: noop, beginStage: name => { const stage = { name, closed: false }; stages.push(stage); return () => { stage.closed = true; }; } };

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
loopGame._mobilePreparationError = true;
loopGame._loop(1016);
assert.equal(frames, 0); assert.equal(dynamic, 0); assert.equal(heartbeat, 2);
loopGame._mobilePreparationError = false;
loopGame._loop(1016);
assert.equal(frames, 1); assert.equal(dynamic, 1);
console.log('通过：准备中/准备失败保留心跳和帧末输入清理，暂停模拟/绘制与动态分辨率');

// 开局入口检查放在下方：通过可控Promise观察重复请求、过期回调与异常收尾。
function gameFixture({ fade, world, warm, preflightFault, completeFade } = {}) {
  const calls = { fade: [], world: 0, setup: 0, start: 0, warm: 0, bind: 0, touch: [], dispose: 0, preflight: 0, order: [], overlays: [], preflightFault,
    gpuStatus: 1, gpuPolls: 0, gpuDeleted: 0, gpuFences: 0, gpuFlushes: 0 };
  const game = Object.create(Game.prototype);
  calls.shaderFailures = 0;
  sandbox.inkwaveDiagnostics.shaderFailureCount = () => calls.shaderFailures;
  sandbox.createMobilePreparationUI = handlers => {
    const ui = { hidden: true, disposed: false, failed: false, updates: [], handlers,
      show() { this.hidden = false; calls.order.push('show'); },
      update(value) { this.updates.push(value); calls.order.push('progress'); },
      complete() { this.completed = true; calls.order.push('complete'); },
      fail() { this.failed = true; calls.order.push('failed'); },
      hide() { this.hidden = true; },
      dispose() { this.disposed = true; this.hidden = true; calls.order.push('dispose'); },
    };
    calls.overlays.push(ui); return ui;
  };
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 5, ALREADY_SIGNALED: 1, CONDITION_SATISFIED: 2, TIMEOUT_EXPIRED: 3, WAIT_FAILED: 4,
    isContextLost: () => calls.preflightFault === 'context-lost',
    fenceSync: () => { calls.gpuFences++; return {}; }, flush: () => { calls.gpuFlushes++; },
    clientWaitSync: (_sync, flags, timeout) => { assert.equal(flags, 0); assert.equal(timeout, 0); calls.gpuPolls++; return calls.gpuStatus; },
    deleteSync: () => { calls.gpuDeleted++; },
  };
  let renderTarget = 'screen';
  sandbox.G = {
    audio: { init: noop, duck: noop }, music: { stop: noop, preload: noop },
    projectiles: { clear: noop }, subs: { clear: noop }, specials: { clear: noop }, fx: { clear: noop }, paint: { clear: noop },
    env: {}, scene: {}, net: { myId: 'local', isHost: true }, renderer: { info: { programs: [] }, getContext: () => gl,
      getRenderTarget: () => renderTarget, setRenderTarget: value => { renderTarget = value; } },
  };
  sandbox.Match = class {
    constructor(opts) { this.options = opts; this.actors = []; this.state = 'init'; }
    setup() { calls.setup++; }
    start() { calls.start++; calls.order.push('start'); this.state = 'playing'; }
    dispose() { calls.dispose++; }
  };
  const map = config.OFFLINE_MAPS[0];
  Object.assign(game, {
    settings: { difficulty: 'normal', fpsCap: 30 }, profile: {}, mapDef: map, time: 'day', theme: config.mapTheme(map, 'day'),
    input: { requestLock: noop, touch: { setEnabled: enabled => calls.touch.push(enabled), clear: noop } },
    menus: { show: noop, toast: noop }, showcase: { hide: noop },
    rig: { follow: noop }, hud: { setVisible: noop, setPractice: noop }, minimap: { setViewerTeam: noop },
    R: { mobileSafety: { state: { fatal: false } } },
    _clearDeathMarks: noop, _applyNight: noop, _setPalette: noop, _pickPalette: () => [],
    _subFor: () => 'bomb', _specialFor: () => 'zooka',
    _fade: (opacity, duration) => { calls.fade.push({ opacity, duration }); calls.order.push(`fade-${opacity}`); return opacity === 1 && fade ? fade.promise : opacity === 0 && completeFade ? completeFade.promise : Promise.resolve(); },
    _buildWorld: () => { calls.world++; return world ? world.promise : Promise.resolve(); },
    _warmCharacters: () => { calls.warm++; return warm ? warm.promise : Promise.resolve(); },
    _frame: (dt, prefix) => {
      calls.preflight++; calls.order.push('preflight'); assert.equal(dt, 0); assert.equal(prefix, 'match-preflight');
      if (calls.preflightFault === 'shader-failed') game.R.mobileSafety.state.fatal = true;
      if (calls.preflightFault === 'shader-link-error') calls.shaderFailures++;
      if (calls.preflightFault === 'suspended') game.mobileSuspended = true;
      if (calls.preflightFault === 'frame-error') throw new Error('preflight-test');
    },
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
  assert.equal(calls.preflight, 1); assert.ok(token.ui.completed && token.ui.disposed);
  assert.ok(calls.order.indexOf('show') < calls.order.indexOf('fade-1'));
  assert.ok(calls.order.indexOf('preflight') < calls.order.indexOf('complete'));
  if (!online) assert.ok(calls.order.indexOf('complete') < calls.order.indexOf('start'));
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
  assert.equal(await request, false);
  await token.done;
  assert.equal(game._mobilePreparation, null, '准备异常必须释放令牌');
  assert.equal(game._mobilePreparationError, true); assert.ok(token.ui.failed && !token.ui.disposed);
  assert.equal(await game.startMatch(opts), false, '失败界面未处理前不得重新开局');
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
quitGame._startAttract = () => { assert.equal(quitCalls.overlays[0].disposed, false); attractStarts++; quitCalls.order.push('attract'); quitGame.match = { attract: true }; };
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
assert.ok(quitCalls.overlays[0].disposed); assert.ok(quitCalls.order.indexOf('attract') < quitCalls.order.indexOf('dispose'));
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

// 主控与Boss准备模块的接口边界；真实实例绘制与状态恢复由Boss专项检查。
for (const cancelMode of [null, 'token', 'network']) {
  const cancel = cancelMode !== null;
  const { game, network } = gameFixture();
  const hold = deferred();
  let bossCalls = 0, afterWaitCurrent;
  sandbox.prepareMobileBoss = async (owner, match, { isCurrent, onProgress }) => {
    assert.equal(owner, game); assert.equal(match, game.match); assert.equal(isCurrent(), true); bossCalls++;
    onProgress({ completed: 3, total: 10, label: '准备登场效果' });
    if (cancel) await hold.promise;
    afterWaitCurrent = isCurrent(); return { cancelled: !afterWaitCurrent };
  };
  const match = { actors: [], boss: { model: { ready: Promise.resolve() } } };
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
  assert.equal(await warming, !cancel);
  assert.equal(bossCalls, 1); assert.equal(afterWaitCurrent, !cancel);
  const bossUpdate = token.ui.updates.find(row => row.label === '准备登场效果');
  assert.ok(bossUpdate && Math.abs(bossUpdate.progress - .789) < .0001);
  if (cancelMode === 'network') assert.equal(token.cancelled, false);
  game._finishMobilePreparation(token);
}
console.log('通过：主控向Boss准备传递取消/session身份检查，按完成步骤映射实际阶段进度');

const originalCombat = sandbox.prepareMobileCombat, originalBoss = sandbox.prepareMobileBoss;
for (const boss of [false, true]) {
  const { game } = gameFixture();
  const match = { actors: Array.from({ length: 2 }, () => ({ character: { warmAll(_renderer, _camera, _scene, { onProgress }) {
    for (const completed of [0, 25, 100]) onProgress({ completed, total: 100 }); return Promise.resolve();
  } } })), ...(boss ? { boss: {} } : {}) };
  sandbox.prepareMobileCombat = async (_game, _match, { onProgress }) => { for (const completed of [0, 1, 2]) onProgress({ completed, total: 2, label: '战斗效果检查' }); };
  sandbox.prepareMobileBoss = async (_game, _match, { onProgress }) => { for (const completed of [0, 1, 2]) onProgress({ completed, total: 2, label: '登场效果检查' }); };
  game.match = match;
  const token = game._beginMobilePreparation();
  assert.equal(await Game.prototype._warmCharacters.call(game, match, token), true);
  const updates = token.ui.updates;
  for (let i = 1; i < updates.length; i++) assert.ok(updates[i].progress >= updates[i - 1].progress, '主控原始阶段进度也须单调，不能仅依赖UI遮掩回退');
  const combat = updates.filter(row => row.label === '战斗效果检查');
  assert.ok(Math.abs(combat[0].progress - (boss ? .62 : .8)) < .0001);
  assert.ok(Math.abs(combat.at(-1).progress - (boss ? .72 : .94)) < .0001);
  assert.ok(Math.abs(updates.at(-1).progress - (boss ? .95 : .94)) < .0001);
  assert.ok(updates.every(row => row.progress < 1));
  game._finishMobilePreparation(token);
}
sandbox.prepareMobileCombat = originalCombat; sandbox.prepareMobileBoss = originalBoss;
console.log('通过：普通/Boss角色、战斗效果、登场效果原始进度区间接续且单调，资源准备不提前100%');

for (const online of [false, true]) for (const preflightFault of ['shader-failed', 'shader-link-error', 'context-lost', 'suspended', 'frame-error']) {
  const { game, calls, cfg, network, opts } = gameFixture({ preflightFault });
  const result = online ? await game.startNetMatch(cfg, network) : await game.startMatch(opts);
  assert.equal(result, false); assert.equal(calls.preflight, 1);
  assert.equal(calls.start, 0); assert.equal(calls.bind, 0);
  assert.equal(game._mobilePreparation, null); assert.equal(game._mobilePreparationError, true);
  assert.ok(calls.overlays[0].failed && !calls.overlays[0].completed && !calls.overlays[0].disposed);
}
console.log('通过：真实首绘检查在shader fatal/上下文丢失/帧异常时阻止开始和联机绑定，保持失败界面');

for (const fault of [false, true]) {
  const { game, calls, opts } = gameFixture();
  let passCalls = 0;
  const pass = { enabled: false, renderToScreen: true, render(renderer) {
    passCalls++; assert.equal(this.renderToScreen, false); renderer.setRenderTarget('temporary-pass');
    if (fault) throw new Error('extra-pass-test');
  } };
  game.R.extraPass = pass; game.R.composer = { readBuffer: {}, writeBuffer: {} };
  assert.equal(await game.startMatch(opts), !fault);
  assert.equal(passCalls, 1); assert.equal(pass.renderToScreen, true); assert.equal(pass.enabled, false);
  assert.equal(sandbox.G.renderer.getRenderTarget(), 'screen');
  assert.equal(calls.preflight, fault ? 0 : 1); assert.equal(calls.start, fault ? 0 : 1);
  assert.equal(!!calls.overlays[0].completed, !fault);
  if (fault) assert.ok(calls.overlays[0].failed && !calls.overlays[0].disposed);
}
console.log('通过：真实主控准备extraPass保留enabled/屏幕输出/渲染目标，Pass异常阻止首绘、100%和开局');

const { game: retryGame, calls: retryCalls, opts: retryOpts } = gameFixture({ preflightFault: 'frame-error' });
retryGame.input.exitLock = noop; retryGame._playMusic = noop;
retryGame._startAttract = () => { retryGame.match = { attract: true, dispose: noop }; };
sandbox.G.net.state = 'offline';
assert.equal(await retryGame.startMatch(retryOpts), false);
const failedOverlay = retryCalls.overlays[0];
assert.ok(failedOverlay.failed && !failedOverlay.disposed && retryGame._mobilePreparationError);
retryCalls.preflightFault = null;
await failedOverlay.handlers.onRetry();
assert.ok(failedOverlay.disposed); assert.equal(retryCalls.preflight, 2); assert.equal(retryCalls.start, 1);
assert.equal(retryGame._mobilePreparation, null); assert.equal(retryGame._mobilePreparationError, false);
assert.equal(retryGame._mobilePreparationOverlay, null); assert.equal(retryCalls.overlays.length, 2);
assert.ok(retryCalls.overlays[1].completed && retryCalls.overlays[1].disposed);
console.log('通过：失败重试先返回菜单释放旧覆盖层/错误锁，再创建新准备并完成首绘后开局');

for (const online of [false, true]) {
  const completeFade = deferred();
  const { game, calls, cfg, network, opts } = gameFixture({ completeFade });
  const request = online ? game.startNetMatch(cfg, network) : game.startMatch(opts);
  await flush();
  const token = game._mobilePreparation;
  assert.ok(token.ui.completed); assert.equal(calls.preflight, 1); assert.equal(calls.start, 0);
  if (online) { game.netMatchGo(); assert.equal(calls.start, 0, '准备覆盖层未退出前，迟到go不得提前开始对局'); }
  completeFade.resolve(); assert.equal(await request, true);
  assert.equal(calls.start, online ? 0 : 1); assert.ok(token.ui.disposed);
}
console.log('通过：100%先给浏览器可见帧，淡入等待完成后才开始，准备期迟到联机go不提前开局');

// 使用真实GPU完成helper和可控WebGL2状态，等待阶段绝不阻塞轮询或提前开始。
for (const outcome of ['ready', 'cancel', 'failed']) {
  const { game, calls, opts } = gameFixture();
  const hold = deferred(), originalTurn = sandbox.nextMobileFrame;
  calls.gpuStatus = 3;
  sandbox.nextMobileFrame = () => calls.gpuPolls ? hold.promise : Promise.resolve();
  try {
    const request = game.startMatch(opts);
    await flush();
    const token = game._mobilePreparation;
    assert.equal(calls.preflight, 1); assert.equal(calls.gpuPolls, 1); assert.equal(calls.gpuDeleted, 0);
    assert.equal(calls.start, 0); assert.ok(!token.ui.completed);
    assert.ok(token.ui.updates.every(row => row.progress < 1));
    if (outcome === 'cancel') token.cancelled = true;
    else calls.gpuStatus = outcome === 'ready' ? 2 : 4;
    hold.resolve();
    assert.equal(await request, outcome === 'ready');
    assert.equal(calls.gpuDeleted, 1); assert.equal(calls.gpuFences, 1); assert.equal(calls.gpuFlushes, 1);
    assert.equal(calls.start, outcome === 'ready' ? 1 : 0);
    assert.equal(!!token.ui.completed, outcome === 'ready');
    if (outcome === 'failed') assert.ok(token.ui.failed && !token.ui.disposed);
  } finally { sandbox.nextMobileFrame = originalTurn; }
}
console.log('通过：首帧GPU fence待完成时不100%/不开局，完成才进入；取消/WAIT_FAILED清理同步点');

for (const outcome of ['ready', 'cancel', 'failed', 'context-lost', 'timeout', 'yield-error']) {
  let polls = 0, deleted = 0, closed = 0, yielded = 0, current = true;
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 5, ALREADY_SIGNALED: 1, CONDITION_SATISFIED: 2, TIMEOUT_EXPIRED: 3, WAIT_FAILED: 4,
    fenceSync: () => ({}), flush: noop, deleteSync: () => { deleted++; },
    isContextLost: () => outcome === 'context-lost',
    clientWaitSync(_sync, flags, timeout) {
      assert.equal(flags, 0); assert.equal(timeout, 0); polls++;
      if (outcome === 'failed') return 4;
      return outcome === 'ready' && polls >= 3 ? 1 : 3;
    },
  };
  const request = sandbox.waitForMobileFrame({ getContext: () => gl }, {
    isCurrent: () => current,
    yieldTurn: async () => {
      yielded++; clock += 60;
      if (outcome === 'cancel') current = false;
      if (outcome === 'yield-error') throw new Error('yield-test');
    },
    diagnostics: { beginStage: () => () => { closed++; } }, timeoutMs: 100,
  });
  if (outcome === 'ready') { assert.equal(await request, true); assert.equal(polls, 3); assert.equal(yielded, 2); }
  else if (outcome === 'cancel') { assert.equal(await request, false); assert.equal(polls, 1); }
  else await assert.rejects(request, outcome === 'timeout' ? /超时/ : outcome === 'context-lost' ? /上下文/ : outcome === 'yield-error' ? /yield-test/ : /同步失败/);
  assert.equal(deleted, 1); assert.equal(closed, 1);
}
console.log('通过：真实fence helper采用0超时轮询，完成/取消/失败/上下文丢失/超时/让帧异常均释放sync并闭合诊断');
