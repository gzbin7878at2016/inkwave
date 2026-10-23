// 手机通用战斗准备的确定性检查：长期真实池、武器懒材质、空池首绘与副作用/异常恢复。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G, on } from '../src/core/ctx.js';
import { Character } from '../src/game/character.js';
import { Projectiles } from '../src/game/weapons.js';
import { BladeFX } from '../src/game/kits/blade-fx.js';
import '../src/game/kits/index.js';
import { FX } from '../src/fx/fx.js';
import { prepareMobileCombat } from '../src/platform/mobileCombatPreparation.js';

let effects = 0;
G.time = 123.25; G.audio = { play() { effects++; throw new Error('加载不得播放音效'); } };
G.paint = { splat() { effects++; throw new Error('加载不得涂墨'); } };
const unsubscribe = on('weapon:fire', () => { effects++; });
const owner = Object.create(Character.prototype); owner.weapons = {}; owner.color = new THREE.Color('#ff8a14'); owner.t = 4; owner._ownMats = [];
for (const kind of ['mitts', 'blade', 'brolly', 'bow', 'shooter']) {
  const root = owner._getWeapon(kind);
  let hand = 0;
  for (let weapon = root; weapon; weapon = weapon.left) {
    const before = [];
    weapon.pivot.traverse(object => before.push([object, object.position.clone(), object.quaternion.clone(), object.scale.clone(), object.visible]));
    owner._prepareMobileWeaponMaterials(weapon, hand++);
    assert.equal(weapon._mobileMaterialsReady, true);
    for (const [object, position, quaternion, scale, visible] of before) {
      assert.ok(object.position.equals(position)); assert.ok(object.quaternion.equals(quaternion)); assert.ok(object.scale.equals(scale)); assert.equal(object.visible, visible);
    }
    if (kind === 'mitts') { assert.equal(weapon.sponge.name, 'iw-sponge'); assert.equal(weapon.parts.pad.userData.mesh.material, weapon.sponge); }
    if (kind === 'blade') { assert.equal(weapon.bl.edge.parent, weapon.off); assert.equal(weapon.bl.aura.parent, weapon.off); }
    if (kind === 'brolly') assert.ok(weapon.bs.gores.every(gore => !gore.g.matrixAutoUpdate), '保留伞布首次初始化的手工矩阵驱动配置');
    const material = weapon.sponge || weapon.bl?.em || weapon.bs?.inkMat;
    owner._prepareMobileWeaponMaterials(weapon, hand - 1);
    assert.equal(weapon.sponge || weapon.bl?.em || weapon.bs?.inkMat, material);
  }
}
assert.equal(effects, 0); assert.equal(G.time, 123.25); unsubscribe();
console.log('通过：拳套/刀/伞/弓/射手dt0初始化真实长期材质，无音效/涂墨/开火/时间推进并恢复原姿态');

globalThis.inkwaveMobile = true;
globalThis.requestAnimationFrame = callback => setImmediate(() => callback(performance.now()));
G.scene = new THREE.Scene(); G.camera = new THREE.PerspectiveCamera(); G.teamColors = [new THREE.Color('#ff8a14'), new THREE.Color('#2f5bff')];
G.projectiles = new Projectiles(G.scene); G.fx = new FX(G.scene, { quality: 'low' });
const actors = [{ weapon: { kind: 'charger' }, weaponId: 'charger' }, { weapon: { kind: 'blade' }, weaponId: 'blade' }];
const match = { actors };
const source = G.projectiles, sourceFx = G.fx;
const originalCounts = { list: source.list.length, beams: source.beams.length, bombs: source.bombs.length, blobs: source.blobs.count, scheduled: sourceFx._sqN };
let paintActions = 0;
G.paint = { mobilePreparationSteps() { return ['splat', 'dry', 'flood', 'wipe'].map(kind => ({ kind, label: kind, action() { paintActions++; return { draws: 1, programsAdded: 0 }; } })); } };
const properties = new Map(), programs = [], rendered = [], events = [], progress = [];
let target = null, viewport = new THREE.Vector4(2, 3, 770, 376), scissor = new THREE.Vector4(4, 5, 700, 340), scissorTest = true;
const renderer = {
  info: { programs }, properties, autoClear: false, shadowMap: { enabled: false, autoUpdate: true, needsUpdate: true },
  getRenderTarget: () => target, setRenderTarget: value => { target = value; },
  getViewport: value => value.copy(viewport), getScissor: value => value.copy(scissor), getScissorTest: () => scissorTest,
  setViewport(...args) { viewport = args[0]?.isVector4 ? args[0].clone() : new THREE.Vector4(...args); },
  setScissor(...args) { scissor = args[0]?.isVector4 ? args[0].clone() : new THREE.Vector4(...args); }, setScissorTest: value => { scissorTest = value; },
  compile(proxy) {
    let program = properties.get(proxy.material)?.currentProgram;
    if (!program) { program = { getUniforms() {}, getAttributes() {} }; properties.set(proxy.material, { currentProgram: program }); programs.push(program); }
    return new Set([proxy.material]);
  },
  compileAsync() { throw new Error('手机路径不应使用compileAsync'); },
  render(scene) {
    assert.notEqual(scene, G.scene); assert.equal(target.width, 4); assert.equal(this.shadowMap.needsUpdate, false);
    scene.traverseVisible(mesh => {
      if (!mesh.isMesh && !mesh.isPoints && !mesh.isLine) return;
      rendered.push({ geometry: mesh.geometry, material: mesh.material, matrix: mesh.instanceMatrix, count: mesh.count });
      if (mesh.isInstancedMesh) assert.ok(mesh.count > 0, '空闲真实池须提交至少一个实例');
      if (mesh.geometry.isInstancedBufferGeometry) assert.ok(mesh.geometry.instanceCount > 0, '空闲InstancedBufferGeometry须提交真实draw');
      assert.ok(mesh.geometry.drawRange.count > 0);
    });
  },
};
G.renderer = renderer;
const game = { R: { composer: { readBuffer: new THREE.WebGLRenderTarget(1540, 752, { type: THREE.HalfFloatType }) } } };
const diagnostics = { record: (name, detail) => events.push({ name, detail }), beginStage: () => () => {} };
assert.equal(await prepareMobileCombat(game, match, { diagnostics, onProgress: p => progress.push(p) }), true);
assert.equal(paintActions, 4); assert.ok(progress.length > 0);
assert.ok(progress.every(p => p.total === progress[0].total)); assert.equal(progress.at(-1).completed, progress[0].total);
assert.ok(progress.every((p, index) => !index || p.completed >= progress[index - 1].completed));
assert.equal(events.at(-1).name, 'mobile-combat-warm-summary'); assert.equal(events.at(-1).detail.failed, false);
assert.deepEqual({ list: source.list.length, beams: source.beams.length, bombs: source.bombs.length, blobs: source.blobs.count, scheduled: sourceFx._sqN }, originalCounts);
assert.equal(source.beamPool.length, 1); assert.equal(source.beamPool[0].visible, false);
assert.equal(source.sights.size, 1); assert.equal(source.sights.get(actors[0]).visible, false);
assert.equal(BladeFX.live.length, 0); assert.ok(BladeFX.arcs.every(slot => !slot.busy && !slot.grp.visible)); assert.ok(BladeFX.waves.every(slot => !slot.busy && !slot.mesh.visible));
assert.ok(rendered.some(item => item.material === source.beamPool[0].material && item.geometry === source.ribbonGeo));
assert.ok(rendered.some(item => item.geometry === BladeFX._geoV)); assert.ok(rendered.some(item => item.material === BladeFX.arcs[0].mesh.material));
assert.ok(rendered.some(item => item.material === source.blobs.material && item.matrix === source.blobs.instanceMatrix));
assert.ok(source.arcGeo.getAttribute('lineDistance'));
assert.equal(target, null); assert.deepEqual(viewport.toArray(), [2, 3, 770, 376]); assert.deepEqual(scissor.toArray(), [4, 5, 700, 340]); assert.equal(scissorTest, true);
assert.equal(renderer.autoClear, false); assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.shadowMap.needsUpdate, true);
console.log('通过：射击条带/瞄准线/刀光/月牙/通用FX/paint逐任务首绘，真实池保留且空闲计数/业务状态不变');

const beam = source.beamPool[0], arcCount = BladeFX.arcs.length, waveCount = BladeFX.waves.length;
assert.equal(await prepareMobileCombat(game, match, { diagnostics }), true);
assert.equal(source.beamPool[0], beam); assert.equal(source.beamPool.length, 1); assert.equal(BladeFX.arcs.length, arcCount); assert.equal(BladeFX.waves.length, waveCount);
assert.equal(await prepareMobileCombat(game, match, { isCurrent: () => false }), false);
const goodRender = renderer.render; renderer.render = () => { target = 'bad-target'; throw new Error('combat-draw-test'); };
await assert.rejects(prepareMobileCombat(game, match, { diagnostics }), /combat-draw-test/);
renderer.render = goodRender;
assert.equal(target, null); assert.deepEqual(viewport.toArray(), [2, 3, 770, 376]); assert.equal(source.blobs.count, 0);
assert.equal(source.beamPool[0], beam); assert.equal(BladeFX.live.length, 0); assert.equal(events.at(-1).detail.failed, true);
assert.equal(G.time, 123.25); assert.equal(effects, 0);
console.log('通过：重入复用长期池、取消不启动、异常恢复渲染器/源count且无开火或时间副作用');

function lifecycleOwner(local = false) {
  const actor = Object.create(Character.prototype);
  actor.root = new THREE.Group(); actor.kid = new THREE.Group(); actor.root.add(actor.kid); G.scene.add(actor.root);
  actor.color = new THREE.Color('#ff8a14'); actor.t = 0; actor.weapons = {}; actor.isLocal = local; actor._ownMats = [];
  actor.lodSets = [null, null, null]; actor._tierSet = tier => actor.lodSets[tier] ||= { list: [] };
  actor.mats = Object.fromEntries(['skin', 'cloth', 'hair', 'eye', 'fill', 'squid', 'squidGhost', 'glow'].map(key => [key, new THREE.MeshBasicMaterial()]));
  actor.matsD = [{}, {}]; actor.skeleton = new THREE.Skeleton([new THREE.Bone()]);
  for (const kind of ['mitts', 'blade', 'brolly']) for (let weapon = actor._getWeapon(kind); weapon; weapon = weapon.left) actor.kid.add(weapon.pivot);
  return actor;
}
function privateMats(actor) {
  const result = new Set();
  for (const root of Object.values(actor.weapons)) for (let weapon = root; weapon; weapon = weapon.left) {
    for (const mat of [weapon.sponge, weapon.bl?.em, weapon.bl?.am, weapon.bs?.inkMat, weapon.bs?.creamMat]) if (mat) result.add(mat);
  }
  return result;
}
const successful = lifecycleOwner(true), survivor = lifecycleOwner(false);
const plastic = successful.weapons.mitts.body.material, ink = successful.weapons.mitts.ink.material;
assert.equal(plastic, survivor.weapons.mitts.body.material); assert.equal(ink, survivor.weapons.mitts.ink.material);
let sharedDisposals = 0; plastic.addEventListener('dispose', () => { sharedDisposals++; }); ink.addEventListener('dispose', () => { sharedDisposals++; });
assert.equal(await successful.warmAll(renderer, G.camera, G.scene), 'high');
const successfulMats = privateMats(successful), privateCounts = new Map();
assert.equal(successfulMats.size, 6, '双拳套2+刀2+伞2均为实例专属材质');
assert.deepEqual(new Set(successful._ownMats), successfulMats); assert.equal(successful._ownMats.length, successfulMats.size);
assert.equal(successful.weapons.brolly.bs.local, true); assert.equal(successful.weapons.brolly.bs.inkMat.transparent, true); assert.equal(successful.weapons.brolly.bs.creamMat.transparent, true);
assert.ok(successful.weapons.brolly.bs.gores.every(gore => !gore.g.matrixAutoUpdate));
for (const mat of successfulMats) { privateCounts.set(mat, 0); mat.addEventListener('dispose', () => privateCounts.set(mat, privateCounts.get(mat) + 1)); }
successful.dispose(); successful.dispose();
assert.ok([...privateCounts.values()].every(count => count === 1)); assert.equal(sharedDisposals, 0);
assert.equal(survivor._disposed, undefined); assert.equal(survivor.weapons.mitts.ink.material, ink);

const cancellation = { cancelled: false }; G.game = { _mobilePreparation: cancellation };
const cancelledOwner = lifecycleOwner();
const originalInitialize = cancelledOwner._prepareMobileWeaponMaterials;
cancelledOwner._prepareMobileWeaponMaterials = function (...args) { const result = originalInitialize.apply(this, args); cancellation.cancelled = true; return result; };
assert.equal(await cancelledOwner.warmAll(renderer, G.camera, G.scene), false);
assert.equal(cancelledOwner._mobileWarmPending, false);
const cancelledMats = privateMats(cancelledOwner), cancelledCounts = new Map();
assert.equal(cancelledMats.size, 1, '首个拳套完成同步材质建立后取消，后续武器不执行');
assert.deepEqual(new Set(cancelledOwner._ownMats), cancelledMats);
for (const mat of cancelledMats) { cancelledCounts.set(mat, 0); mat.addEventListener('dispose', () => cancelledCounts.set(mat, cancelledCounts.get(mat) + 1)); }
cancelledOwner.dispose(); cancelledOwner.dispose();
assert.ok([...cancelledCounts.values()].every(count => count === 1)); assert.equal(sharedDisposals, 0);
delete G.game;
for (const root of Object.values(survivor.weapons)) for (let weapon = root, hand = 0; weapon; weapon = weapon.left) survivor._prepareMobileWeaponMaterials(weapon, hand++);
assert.equal(survivor.weapons.brolly.bs.local, false); assert.equal(survivor.weapons.brolly.bs.inkMat.transparent, false);
survivor.dispose(); assert.equal(sharedDisposals, 0);
console.log('通过：成功/取消加载真实私有材质各dispose一次，不释放其他角色共享塑料/墨水，保留本地伞布透明变体');
