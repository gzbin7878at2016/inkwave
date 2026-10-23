// 确定性检查手机角色预热：真正隔离compile输入、让帧、共享串行队列和销毁取消；不使用GPU模拟帧率。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/ctx.js';
import { Character } from '../src/game/character.js';
import { createMobileWarmQueue, prepareMobileMaterialPrograms } from '../src/platform/mobileWarmup.js';

const readyCalls = [], sharedProgram = { getUniforms: () => readyCalls.push('uniforms'), getAttributes: () => readyCalls.push('attributes') };
const materialA = {}, materialB = {}, materialEmpty = {}, materialBroken = {};
const brokenProgram = { getUniforms() { throw new Error('link-test'); }, getAttributes() { throw new Error('不能访问失败程序属性'); } };
const ignoredProgram = { getUniforms() { throw new Error('不能扫描其他程序'); }, getAttributes() { throw new Error('不能扫描其他程序'); } };
const materialProperties = new Map([[materialA, { currentProgram: sharedProgram, programs: new Map([['unused', ignoredProgram]]) }],
  [materialB, { currentProgram: sharedProgram }], [materialEmpty, {}], [materialBroken, { currentProgram: brokenProgram }]]);
const readyRenderer = { properties: materialProperties, debug: { checkShaderErrors: true } };
assert.equal(prepareMobileMaterialPrograms(readyRenderer, [materialA, materialA, materialB, materialEmpty, null]), 1);
assert.deepEqual(readyCalls, ['uniforms', 'attributes']);
assert.equal(prepareMobileMaterialPrograms(readyRenderer, materialEmpty), 0);
assert.equal(prepareMobileMaterialPrograms(readyRenderer, undefined), 0);
assert.throws(() => prepareMobileMaterialPrograms(readyRenderer, materialBroken), /link-test/);
assert.equal(readyRenderer.debug.checkShaderErrors, true);
console.log('通过：共用程序准备helper处理材质数组、程序去重、缺失程序、链接错误传播且保持shader检查');

const ticks = [];
globalThis.requestAnimationFrame = callback => setImmediate(() => { ticks.push('frame'); callback(performance.now()); });
globalThis.inkwaveMobile = true;
G.settings = { quality: 'low' }; G.scene = new THREE.Scene(); G.match = { attract: false };
G.post = { composer: { readBuffer: { name: 'hdr' } } };
const events = [], stages = [];
globalThis.inkwaveDiagnostics = { record: (name, detail) => events.push({ name, ...detail }), beginStage: (name, detail) => () => stages.push({ name, ...detail }) };

function character() {
  const kid = Object.create(Character.prototype);
  kid.root = new THREE.Group(); kid.kid = new THREE.Group(); kid.root.add(kid.kid); G.scene.add(kid.root);
  kid.weaponKind = 'test'; kid.weapons = {}; kid.lodSets = [null, null, null]; kid.builds = [];
  kid.skeleton = new THREE.Skeleton([new THREE.Bone()]);
  kid.baseMaterial = new THREE.MeshBasicMaterial(); kid._matFor = () => kid.baseMaterial;
  kid._tierSet = tier => {
    kid.builds.push(tier);
    if (kid.lodSets[tier]) return kid.lodSets[tier];
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), kid.baseMaterial); mesh.bind(kid.skeleton, new THREE.Matrix4());
    mesh.name = `kid:body:${tier}`; mesh.userData.iwMat = 'skin'; mesh.visible = tier === 1; mesh.castShadow = true;
    kid.kid.add(mesh); return kid.lodSets[tier] = { list: [mesh] };
  };
  kid._ditherMat = (_key, side) => kid.dither[side];
  kid.dither = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  return kid;
}

let activeCompiles = 0, maxCompiles = 0, target = 'screen', compileCount = 0, uniformQueries = 0, attributeQueries = 0;
const programs = [];
const properties = new Map();
const renderer = {
  info: { programs }, properties,
  shadowMap: { enabled: false }, getRenderTarget: () => target, setRenderTarget: value => { target = value; },
  compileAsync(proxy, _camera, scene) {
    compileCount++; activeCompiles++; maxCompiles = Math.max(maxCompiles, activeCompiles);
    assert.equal(scene, G.scene); assert.equal(target, G.post.composer.readBuffer);
    assert.ok(proxy.isMesh, '不能依靠visible过滤compile原树'); assert.equal(proxy.parent, null);
    assert.equal(proxy.visible, true); assert.equal(proxy.frustumCulled, false);
    assert.ok(proxy.isSkinnedMesh && proxy.skeleton, '独立替身保留蒙皮程序变体和骨架');
    const program = { getUniforms() { uniformQueries++; }, getAttributes() { attributeQueries++; } };
    programs.push(program); properties.set(proxy.material, { currentProgram: program });
    return new Promise(resolve => setImmediate(() => { activeCompiles--; resolve(proxy); }));
  },
};
const camera = new THREE.PerspectiveCamera();
const actors = Array.from({ length: 8 }, character);
const jobs = actors.map(actor => actor.warmAll(renderer, camera, G.scene));
assert.ok(actors.every(actor => actor._warmed && actor._mobileWarmPending));
assert.ok(actors.every(actor => actor.builds.length === 0), 'warmAll同步部分只入队');
assert.equal(compileCount, 0);
assert.deepEqual(await Promise.all(jobs), Array(8).fill('low'));
assert.equal(maxCompiles, 1, '全部角色共享串行队列');
assert.equal(compileCount, 8 * 9, '每个角色3档×普通/淡出/淡入均编译');
assert.equal(uniformQueries, compileCount, '每步必须主动完成首次链接/uniform准备');
assert.equal(attributeQueries, compileCount, '每步必须主动完成attribute准备');
assert.ok(ticks.length >= 8 * (3 + 9 + 1));
assert.equal(target, 'screen'); assert.ok(actors.every(actor => !actor._mobileWarmPending));
for (const actor of actors) {
  assert.deepEqual(actor.builds, [0, 1, 2]);
  assert.deepEqual(actor.lodSets.map(set => set.list[0].visible), [false, true, false]);
  assert.ok(actor.lodSets.every(set => set.list[0].parent === actor.kid));
}
assert.equal(events.length, 8); assert.ok(events.every(event => event.steps === 12 && !event.cancelled && event.phases.length === 2));
assert.ok(events.every(event => event.programsAdded === 9));
assert.ok(stages.filter(stage => stage.name === 'mobile-character-material-compile').every(stage => stage.programsAdded === 1 && stage.programsPrepared === 1));
console.log('通过：首任务前让帧、8角色串行、3档全部材质变体覆盖、原树/渲染目标保持、分段及汇总记录');

const disposed = character(), detached = character();
const disposedJob = disposed.warmAll(renderer, camera, G.scene), detachedJob = detached.warmAll(renderer, camera, G.scene);
disposed._disposed = true; G.scene.remove(detached.root);
assert.deepEqual(await Promise.all([disposedJob, detachedJob]), [false, false]);
assert.equal(disposed.builds.length, 0); assert.equal(detached.builds.length, 0);
assert.equal(detached._warmed, null); assert.ok(events.slice(-2).every(event => event.cancelled));

let rejectNext = true;
const failRenderer = { ...renderer, compileAsync() { if (rejectNext) { rejectNext = false; throw new Error('driver-test'); } return Promise.resolve(); } };
await assert.rejects(character().warmAll(failRenderer, camera, G.scene), /driver-test/);
assert.equal(target, 'screen');
assert.equal(await character().warmAll(renderer, camera, G.scene), 'low', '单个驱动异常不污染队列');
console.log('通过：已销毁/已离场角色跳过，异常恢复渲染目标，后续角色仍可执行');

const interrupted = character(), queriesBeforeInterrupt = uniformQueries;
let interruptedCompiles = 0;
const interruptRenderer = { ...renderer, compileAsync() {
  interruptedCompiles++;
  return new Promise(resolve => setImmediate(() => { interrupted._disposed = true; resolve(); }));
} };
assert.equal(await interrupted.warmAll(interruptRenderer, camera, G.scene), false);
assert.equal(interruptedCompiles, 1); assert.equal(uniformQueries, queriesBeforeInterrupt, '异步链接期间销毁后不可再访问已释放材质');
assert.equal(target, 'screen');

const light = new THREE.DirectionalLight(); light.castShadow = true; light.shadow.needsUpdate = false; G.scene.add(light);
let shadowCalls = 0;
const shadowRenderer = { ...renderer, shadowMap: { enabled: true, needsUpdate: false, render(lights, proxy) {
  shadowCalls++; assert.deepEqual(lights, [light]); assert.ok(proxy.isMesh && !proxy.parent && proxy.visible && !proxy.frustumCulled);
  assert.equal(this.needsUpdate, true); assert.equal(light.shadow.needsUpdate, true);
  target = 'shadow'; light.shadow.needsUpdate = false;
} } };
assert.equal(await character().warmAll(shadowRenderer, camera, G.scene), 'low');
assert.equal(shadowCalls, 3); assert.equal(shadowRenderer.shadowMap.needsUpdate, false); assert.equal(light.shadow.needsUpdate, false); assert.equal(target, 'screen');
shadowRenderer.shadowMap.render = () => { target = 'shadow'; throw new Error('shadow-test'); };
await assert.rejects(character().warmAll(shadowRenderer, camera, G.scene), /shadow-test/);
assert.equal(shadowRenderer.shadowMap.needsUpdate, false); assert.equal(light.shadow.needsUpdate, false); assert.equal(target, 'screen');
G.scene.remove(light);
console.log('通过：预热中途销毁后不再查询材质；逐网格阴影预热及异常后恢复目标/更新标志');

const preparation = { cancelled: false };
G.game = { _mobilePreparation: preparation };
const cancelledPreparation = character(), preparedQueriesBefore = uniformQueries;
let preparationCompiles = 0;
const preparationRenderer = { ...renderer, compileAsync() {
  preparationCompiles++;
  return new Promise(resolve => setImmediate(() => { preparation.cancelled = true; resolve(); }));
} };
assert.equal(await cancelledPreparation.warmAll(preparationRenderer, camera, G.scene), false);
assert.equal(preparationCompiles, 1); assert.equal(uniformQueries, preparedQueriesBefore);
assert.equal(cancelledPreparation._warmed, null); assert.equal(cancelledPreparation._mobileWarmPending, false);
assert.equal(target, 'screen'); assert.equal(cancelledPreparation.root.parent, G.scene, '令牌取消无需先销毁或移出角色');
const replacedPreparation = character(); G.game._mobilePreparation = { cancelled: false };
const replacedJob = replacedPreparation.warmAll(renderer, camera, G.scene);
G.game._mobilePreparation = { cancelled: false };
assert.equal(await replacedJob, false); assert.equal(replacedPreparation.builds.length, 0);
G.game._mobilePreparation = { cancelled: true };
const alreadyCancelled = character();
assert.equal(await alreadyCancelled.warmAll(renderer, camera, G.scene), false); assert.equal(alreadyCancelled.builds.length, 0);
const networkMatch = {};
G.game._mobilePreparation = { cancelled: false, networkMatch }; G.net = { match: networkMatch };
const disconnected = character(), queriesBeforeDisconnect = uniformQueries;
let disconnectedCompiles = 0;
const disconnectedRenderer = { ...renderer, compileAsync() {
  disconnectedCompiles++;
  return new Promise(resolve => setImmediate(() => { G.net.match = null; resolve(); }));
} };
assert.equal(await disconnected.warmAll(disconnectedRenderer, camera, G.scene), false);
assert.equal(disconnectedCompiles, 1); assert.equal(uniformQueries, queriesBeforeDisconnect);
assert.equal(G.game._mobilePreparation.cancelled, false, '后台离房可能不设置cancelled，必须另外检查网络match');
assert.equal(disconnected._warmed, null); assert.equal(disconnected._mobileWarmPending, false); assert.equal(target, 'screen');
delete G.net;
delete G.game;
console.log('通过：准备令牌途中取消/入队前已取消/被替换、网络match清空时及时停止且恢复预热状态');

const serial = [], queue = createMobileWarmQueue(async () => serial.push('yield'));
let current = true;
assert.equal(await queue(async step => {
  await step('first', () => { serial.push('first'); current = false; });
  await step('second', () => serial.push('second'));
}, { isCurrent: () => current }), false);
assert.deepEqual(serial, ['yield', 'first', 'yield']);

// 使用真实LOD选择方法验证attract兜底条件；稳定档位避免触发测试外建模。
const auto = character(); auto.inWorld = true; auto._rendered = true; auto.visible = true;
auto.lod = { tier: 1, to: -1, force: -1, q: 'low' }; auto._screenPx = () => 200;
let autoCalls = 0; auto.warmAll = () => { autoCalls++; return Promise.resolve(); };
G.match = { attract: true }; auto._updateLod(0.016); assert.equal(autoCalls, 0);
G.match = { attract: false }; auto._updateLod(0.016); assert.equal(autoCalls, 1);
globalThis.inkwaveMobile = false; G.match = { attract: true }; auto._updateLod(0.016); assert.equal(autoCalls, 2);
console.log('通过：取消后不执行下一步；手机attract不自动预热、真实对局保留兜底、PC原条件保留');

const pc = character(); let pcCompileCalls = 0;
const pcRenderer = { ...renderer, compileAsync(root) {
  pcCompileCalls++; assert.equal(root, pc.root); let visible = true; root.traverse(object => { visible &&= object.visible; }); assert.ok(visible);
  return Promise.resolve();
} };
const pcJob = pc.warmAll(pcRenderer, camera, G.scene);
assert.equal(pc.builds.length, 3, 'PC保留首次await前同步建模'); assert.equal(pcCompileCalls, 1, 'PC仍一次编译原角色树');
assert.equal(await pcJob, 'low'); assert.equal(target, 'screen');
assert.deepEqual(pc.lodSets.map(set => set.list[0].visible), [false, true, false]);
console.log('通过：PC保持原同步建模/整角色编译流程');
