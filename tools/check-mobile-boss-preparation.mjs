// 无GPU/公网的Boss准备回归：验证真实资源身份、粒子恢复、无音频播放、DOM复用与小怪池；帧率仍需真机。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/ctx.js';
import { BossFX } from '../src/boss/bossModelFx.js';
import { Crablet, MobileCrabletPool } from '../src/boss/bossModel.js';
import { Boss } from '../src/boss/boss.js';
import { BossHazards } from '../src/boss/bossHazards.js';
import { AudioEngine } from '../src/audio/audio.js';
import { BOSS_INTRO_SOUNDS } from '../src/audio/bossAudio.js';
import { BossHud } from '../src/ui/hud-boss.js';
import { prepareMobileBoss } from '../src/platform/mobileBossPreparation.js';
import { prepareMobileMesh } from '../src/platform/mobileWarmup.js';

const color = new THREE.Color('#2f5bff'), options = { quality: 'low', ink: color, weak: new THREE.Color('#ff8a14') };
const snapshotFX = fx => ({
  arrays: [...Object.values(fx.I), ...Object.values(fx.S), fx.sp, fx.ssz, fx.sal, fx.sseed, fx.inkMesh.instanceMatrix.array].map(array => [...array]),
  counts: [fx.ni, fx.ns, fx.inkMesh.count, fx.inkMesh.visible, fx.steam.visible, fx.steam.geometry.drawRange.start, fx.steam.geometry.drawRange.count],
  state: [fx.geyserT, fx.geyserDur, fx.accS, fx.accG, ...fx.geyserPos.toArray()], rnd: fx.rnd,
});
const fx = new BossFX(options);
fx.ink(new THREE.Vector3(1, 2, 3), 4, new THREE.Vector3(0, 1, 0), 2); fx.steamPuff(new THREE.Vector3(), 3, new THREE.Vector3(0, 1, 0), 1); fx.update(0.1);
const fxBefore = snapshotFX(fx), matrix = fx.inkMesh.instanceMatrix, steamPosition = fx.steam.geometry.attributes.position;
for (const kind of ['burst', 'landing', 'steam']) {
  await fx.withPreparationFrame(kind, async meshes => {
    assert.ok(meshes.length && meshes.every(mesh => mesh.visible));
    assert.equal(fx.inkMesh.instanceMatrix, matrix); assert.equal(fx.steam.geometry.attributes.position, steamPosition);
    await Promise.resolve();
  });
  assert.deepEqual(snapshotFX(fx), fxBefore);
}
await assert.rejects(fx.withPreparationFrame('burst', () => { throw new Error('draw-test'); }), /draw-test/);
assert.deepEqual(snapshotFX(fx), fxBefore); assert.equal(fx._preparing, false); fx.dispose();
console.log('通过：真实Boss墨水/蒸汽缓冲身份保持，三种演出及异常后粒子/可见性/RNG逐项恢复');

const pool = new MobileCrabletPool(options);
const capacity = pool.capacity; assert.equal(capacity, 12);
for (let i = 0; i < capacity; i++) { assert.ok(pool.prepareNext()); assert.equal(pool.models.size, i + 1); }
assert.equal(pool.prepareNext(), null); assert.equal(pool.free.length, capacity);
const borrowed = Array.from({ length: capacity }, () => pool.acquire());
assert.equal(new Set(borrowed).size, capacity); assert.equal(pool.acquire(), null, '池耗尽由调用方走原factory，不能偷走在场实例');
const first = borrowed[0], geometry = first.mesh.geometry, skeleton = first.skel, popFX = first.fx;
first.root.position.set(4, 5, 6); first.hit(); first.pop(); first.update(0.2, { dead: true });
assert.equal(first.fx, popFX, '真正pop复用加载时的FX，不现场new池'); assert.equal(first.mesh.visible, false);
assert.ok(pool.release(first)); assert.ok(pool.release(first)); assert.equal(pool.free.length, 1, '重复归还不能双占空槽');
const reused = pool.acquire(); assert.equal(reused, first); assert.equal(reused.mesh.geometry, geometry); assert.equal(reused.skel, skeleton);
assert.equal(reused.fx, popFX); assert.equal(reused.t, 0); assert.equal(reused.popT, -1); assert.equal(reused.popped, false);
assert.equal(reused.U.uFlash.value, 0); assert.equal(reused.mesh.visible, true); assert.deepEqual(reused.mesh.scale.toArray(), [1, 1, 1]);
assert.deepEqual(reused.root.position.toArray(), [0, 0, 0]); assert.equal(reused.fx.ni, 0); assert.equal(reused.fx.ns, 0);
let disposed = 0; for (const model of pool.models) model.mesh.geometry.addEventListener('dispose', () => disposed++);
pool.dispose(); pool.dispose(); assert.equal(disposed, capacity, 'free/borrowed统一去重释放'); assert.equal(pool.acquire(), null);
const failPool = new MobileCrabletPool(options, { factory: () => ({ preparePopEffect() { throw new Error('factory-test'); }, dispose() { disposed++; } }) });
assert.throws(() => failPool.prepareNext(), /factory-test/); assert.equal(failPool.models.size, 0); assert.equal(disposed, capacity + 1);
console.log('通过：12个真实小怪及PopFX逐只预建，耗尽保护、完整复位复用、工厂异常和free/borrowed去重销毁');

// 执行真实Boss回收方法：保持死亡后1.2秒演出，归还池实例；PC没有池仍走原dispose。
for (const mobile of [false, true]) {
  const visualPool = mobile ? new MobileCrabletPool(options, { capacity: 1 }) : null; visualPool?.prepareNext();
  const crab = visualPool?.acquire() || new Crablet(options);
  let kills = 0; crab.mesh.geometry.addEventListener('dispose', () => kills++);
  const boss = Object.create(Boss.prototype); boss.crabletPool = visualPool;
  boss.crabs = new Map([[1, { id: 1, model: crab, dead: true, popT: 1, x: 1, y: 0, z: 2, yaw: 0 }]]);
  boss._crabVisuals(0.1); assert.equal(boss.crabs.size, 1);
  boss._crabVisuals(0.2); assert.equal(boss.crabs.size, 0); assert.equal(kills, mobile ? 0 : 1);
  if (mobile) { assert.equal(visualPool.free[0], crab); visualPool.dispose(); assert.equal(kills, 1); }
}
console.log('通过：真实Boss死亡回收保留1.2秒，手机归池、PC原释放路径保留');

const oldMobile = globalThis.inkwaveMobile;
for (const mobile of [false, true]) {
  globalThis.inkwaveMobile = mobile; G.scene = new THREE.Scene();
  const hazard = new BossHazards({}), group = hazard.fx.warm();
  const reserve = mobile ? Object.values(hazard.fx._warmKeepers) : [...hazard.fx._per.values()];
  let materialsDisposed = 0; reserve.forEach(mesh => mesh.material.addEventListener('dispose', () => materialsDisposed++));
  if (mobile) { assert.equal(hazard.fx._per.size, 0); assert.ok(reserve.every(mesh => mesh.visible === false && mesh.parent === group)); }
  hazard.fx.draw(hazard, 0, 1 / 30, false);
  assert.equal(materialsDisposed, mobile ? 0 : 2); assert.equal(hazard.moves.length, 0); assert.equal(hazard.hits.size, 0);
  if (mobile) { const same = hazard.fx._warmKeepers; hazard.fx.warm(); assert.equal(hazard.fx._warmKeepers, same); assert.ok(reserve.every(mesh => !mesh.visible)); }
  hazard.dispose(); assert.equal(materialsDisposed, 2);
}
globalThis.inkwaveMobile = oldMobile;
console.log('通过：手机环/扇预备模板不进入招式缓存/命中，首个正常帧不释放且重复准备复用；结束释放，PC原回收保留');

// 用真实音效配方+可观察音频节点验证，准备不能start任何音源、不能连总线、不能改限额或随机序列。
class Param { constructor() { this.value = 0; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} setTargetAtTime() {} cancelScheduledValues() {} }
const audioNodes = []; let starts = 0, buffers = 0, randoms = 0;
function audioNode() {
  const node = { connections: [], connect(to) { this.connections.push(to); }, disconnect() { this.connections.length = 0; }, start() { starts++; }, stop() {}, setPeriodicWave() {} };
  for (const key of ['gain', 'frequency', 'Q', 'detune', 'playbackRate', 'pan']) node[key] = new Param();
  audioNodes.push(node); return node;
}
const ctx = { currentTime: 1, sampleRate: 8000,
  createGain: audioNode, createOscillator: audioNode, createBufferSource: audioNode, createBiquadFilter: audioNode, createWaveShaper: audioNode,
  createStereoPanner: audioNode, createDelay: audioNode, createPeriodicWave: () => ({}),
  createBuffer(_channels, length, sampleRate) { buffers++; const data = new Float32Array(length); return { duration: length / sampleRate, getChannelData: () => data }; },
};
const audio = new AudioEngine({ music: false }); audio.ctx = ctx; audio.rng = () => { randoms++; return 0.5; };
for (const sound of BOSS_INTRO_SOUNDS) assert.ok(audio.prepare(sound.name, sound).nodes > 0);
assert.equal(starts, 0); assert.equal(randoms, 0); assert.equal(audio.voices.length, 0); assert.equal(audio.byName.size, 0); assert.equal(audio.last.size, 0);
assert.deepEqual(audio.counts, { played: 0, dropped: 0, stolen: 0 }); assert.ok(audioNodes.every(node => !node.connections.length));
const preparedBuffers = buffers;
audio.sfxIn = audioNode(); audio.revSend = audioNode();
for (const sound of BOSS_INTRO_SOUNDS) assert.ok(audio.play(sound.name, sound));
assert.ok(starts > 0); assert.equal(buffers, preparedBuffers, '真正登场复用同一ctx的噪声Buffer');
for (const voice of audio.voices) voice.v.dispose();
console.log('通过：真实五种登场音效准备无start/总线/播放统计/RNG副作用，实际播放不再创建大噪声Buffer');

// 轻量DOM只隔离浏览器布局，执行真实_makeTitleCard/prepareIntro/_titleCard，验证创建与登场复用同一节点。
const domOriginal = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, setTimeout };
let allocations = 0, fontLoads = 0, titleSounds = 0; const titleTimers = [];
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this.className = ''; this.attrs = new Map(); this.style = { setProperty(key, value) { this[key] = String(value); } };
  }
  appendChild(child) { child.remove?.(); this.children.push(child); child.parentNode = this; return child; }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; } }
  setAttribute(key, value) {
    if (key === 'style') { for (const name of Object.keys(this.style)) if (typeof this.style[name] !== 'function') delete this.style[name]; for (const pair of value.split(';')) { const split = pair.indexOf(':'); if (split >= 0) this.style[pair.slice(0, split).trim()] = pair.slice(split + 1).trim(); } }
    else this.attrs.set(key, value);
  }
  getAttribute(key) { if (key !== 'style') return this.attrs.get(key) ?? null; const rows = Object.entries(this.style).filter(([, value]) => typeof value !== 'function'); return rows.length ? rows.map(([name, value]) => `${name}:${value}`).join(';') : null; }
  removeAttribute(key) { if (key === 'style') for (const name of Object.keys(this.style)) { if (typeof this.style[name] !== 'function') delete this.style[name]; } else this.attrs.delete(key); }
  addEventListener(type, action, options) { this.events ??= new Map(); const entries = this.events.get(type) || []; entries.push({ action, once: !!options?.once }); this.events.set(type, entries); }
  dispatchEvent(event) {
    event.target ??= this; const parent = this.parentNode;
    for (const entry of [...(this.events?.get(event.type) || [])]) { entry.action(event); if (entry.once) this.events.set(event.type, this.events.get(event.type).filter(item => item !== entry)); }
    if (event.bubbles && parent) parent.dispatchEvent(event);
  }
  querySelectorAll(selector) { const result = []; for (const child of this.children) { if (selector === '*' || child.className.split(' ').includes(selector.slice(1))) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { width: 900, height: 170 }; }
  get isConnected() { return !!this.parentNode; }
}
try {
  globalThis.document = { createElement(tag) { allocations++; return new Element(tag); }, createTextNode(text) { const node = new Element('#text'); node.textContent = text; return node; }, fonts: { async load() { fontLoads++; return []; } } };
  globalThis.getComputedStyle = () => ({ font: '900 50px sans-serif' });
  globalThis.setTimeout = (action, delay) => { titleTimers.push({ action, delay }); return titleTimers.length; };
  const hud = Object.create(BossHud.prototype); hud.over = new Element('div'); hud.hud = { _snd: () => titleSounds++ };
  const result = await hud.prepareIntro(); const title = hud._preparedTitle, created = allocations;
  assert.equal(result.titlePrepared, true); assert.ok(fontLoads > 0); assert.equal(title.parentNode, null); assert.equal(title.style.visibility, undefined);
  assert.equal(titleTimers.length, 0); assert.equal(titleSounds, 0);
  hud._titleCard(); assert.equal(hud.over.children[0], title); assert.equal(allocations, created); assert.equal(hud._preparedTitle, null);
  assert.deepEqual(titleTimers.map(timer => timer.delay), [3200, 80]); assert.equal(titleSounds, 0);
  titleTimers.find(timer => timer.delay === 80).action(); assert.equal(titleSounds, 1);
  const letter = title.querySelector('.iw-btc__name').children[0];
  letter.dispatchEvent({ type: 'animationend', bubbles: true }); assert.equal(title.parentNode, hud.over, '子字母动画冒泡不能移除整张卡片或耗掉父监听');
  title.dispatchEvent({ type: 'animationend', bubbles: true }); assert.equal(title.parentNode, null, '卡片自身动画结束应正常移除，不依赖3.2秒兜底');
  const cancelHud = Object.create(BossHud.prototype); cancelHud.over = new Element('div');
  let current = true; globalThis.document.fonts.load = async () => { current = false; };
  assert.equal((await cancelHud.prepareIntro({ isCurrent: () => current })).cancelled, true); assert.equal(cancelHud._preparedTitle, null); assert.equal(cancelHud.over.children.length, 0);
} finally { globalThis.document = domOriginal.document; globalThis.getComputedStyle = domOriginal.getComputedStyle; globalThis.setTimeout = domOriginal.setTimeout; }
console.log('通过：真实标题方法准备无声音/计时器、复用DOM；子动画冒泡保留父监听、父动画移除卡片，取消无残留');

function rendererFixture() {
  let target = null, viewport = new THREE.Vector4(1, 2, 700, 400), scissor = new THREE.Vector4(3, 4, 600, 300), test = true;
  const programs = [], materialProps = new WeakMap(), compiled = new Map(), draws = [];
  const renderer = {
    info: { programs }, properties: { get: mat => materialProps.get(mat) || {} }, autoClear: false,
    shadowMap: { autoUpdate: true, needsUpdate: true },
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    getViewport: out => out.copy(viewport), setViewport: (...v) => { viewport = v[0]?.isVector4 ? v[0].clone() : new THREE.Vector4(...v); },
    getScissor: out => out.copy(scissor), setScissor: (...v) => { scissor = v[0]?.isVector4 ? v[0].clone() : new THREE.Vector4(...v); },
    getScissorTest: () => test, setScissorTest: value => { test = value; },
    compile(mesh) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const key = `${material.customProgramCacheKey()}:${material.vertexShader || ''}:${material.fragmentShader || ''}:${!!mesh.isSkinnedMesh}:${!!mesh.isInstancedMesh}`;
        let program = compiled.get(key);
        if (!program) { program = { getUniforms() {}, getAttributes() {} }; compiled.set(key, program); programs.push(program); }
        materialProps.set(material, { currentProgram: program });
      }
    },
    render(scene) {
      assert.equal(target.width, 4); assert.equal(target.height, 4); assert.equal(renderer.shadowMap.autoUpdate, false);
      scene.traverse(object => {
        if (!object.isMesh && !object.isPoints && !object.isLine) return;
        if (object.isSkinnedMesh && !object.skeleton.boneTexture) object.skeleton.computeBoneTexture();
        draws.push({ geometry: object.geometry, matrix: object.instanceMatrix, skeleton: object.skeleton });
      });
      renderer.fail?.();
    },
    snapshot: () => ({ target, viewport: viewport.toArray(), scissor: scissor.toArray(), test, auto: renderer.autoClear, shadow: { ...renderer.shadowMap } }), draws,
  };
  return renderer;
}
function fixture() {
  const scene = new THREE.Scene(), root = new THREE.Group(), fx = new BossFX(options);
  const skeleton = new THREE.Skeleton([new THREE.Bone()]);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial()); mesh.bind(skeleton); mesh.name = 'test-boss';
  root.add(mesh, fx.group); root.visible = false; scene.add(root);
  const model = { root, fx, meshes: [mesh], ready: Promise.resolve(), _disposed: false };
  const hazard = new THREE.Group(); hazard.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
  const boss = { model, crabletPool: new MobileCrabletPool(options), hz: { fx: { warm: () => hazard } }, bt: 0, hp: 100 };
  const match = { boss, state: 'init', time: 0 };
  let audioPrepares = 0, titlePrepares = 0;
  G.scene = scene; G.camera = new THREE.PerspectiveCamera(); G.renderer = rendererFixture(); G.audio = { prepare() { audioPrepares++; return {}; } };
  const game = { match, R: { composer: { readBuffer: new THREE.WebGLRenderTarget(64, 32, { type: THREE.HalfFloatType }) } }, hud: { boss: { prepareIntro() { titlePrepares++; return {}; } } } };
  return { game, match, model, boss, renderer: G.renderer, counters: () => ({ audioPrepares, titlePrepares }), dispose() {
    model._disposed = true; boss.crabletPool.dispose(); fx.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); skeleton.dispose();
    for (const obj of hazard.children) { obj.geometry.dispose(); obj.material.dispose(); } game.R.composer.readBuffer.dispose();
  } };
}
const full = fixture(), stateBefore = full.renderer.snapshot(), fxStateBefore = snapshotFX(full.model.fx), progress = [], records = [];
const summary = await prepareMobileBoss(full.game, full.match, { yieldTurn: async () => {}, onProgress: step => progress.push(step), diagnostics: { beginStage: () => () => {}, record: (category, detail) => records.push({ category, detail }) } });
assert.equal(summary.cancelled, false); assert.equal(summary.failed, false); assert.equal(progress.at(-1).completed, progress.at(-1).total);
assert.ok(progress.every(row => row.total === progress[0].total)); assert.ok(progress.every((row, index) => !index || row.completed >= progress[index - 1].completed));
assert.ok(progress.every(row => !/test-boss|burst|landing|steam|boss_title/.test(row.label)));
assert.deepEqual(full.renderer.snapshot(), stateBefore); assert.deepEqual(snapshotFX(full.model.fx), fxStateBefore);
assert.equal(full.boss.bt, 0); assert.equal(full.boss.hp, 100); assert.equal(full.match.time, 0); assert.equal(full.match.state, 'init');
assert.deepEqual(full.counters(), { audioPrepares: 5, titlePrepares: 1 }); assert.equal(full.boss.crabletPool.models.size, full.boss.crabletPool.capacity);
assert.equal(records.at(-1).category, 'mobile-boss-preparation-summary');
const programCount = full.renderer.info.programs.length;
const prepared = [...full.boss.crabletPool.models];
for (const crab of prepared) {
  assert.ok(full.renderer.draws.some(draw => draw.geometry === crab.mesh.geometry && draw.skeleton === crab.skel));
  assert.ok(full.renderer.draws.some(draw => draw.matrix === crab.fx.inkMesh.instanceMatrix));
  assert.ok(full.renderer.draws.some(draw => draw.geometry === crab.fx.steam.geometry));
}
for (let i = 0; i < full.boss.crabletPool.capacity; i++) {
  const crab = full.boss.crabletPool.acquire(); crab.pop(); crab.update(0.2, { dead: true });
  for (const object of [crab.mesh, crab.fx.inkMesh, crab.fx.steam]) await prepareMobileMesh(full.renderer, object, G.camera, G.scene, { beforeFirstUse: async () => {}, renderTarget: full.game.R.composer.readBuffer });
}
assert.equal(full.renderer.info.programs.length, programCount, '预建小怪及pop实际使用不再新增程序'); full.dispose();
console.log('通过：完整Boss准备总步骤稳定、进度单调、实际共享模型/骨骼/12个实例buffer、无比赛推进、GL状态恢复及小怪复用无新程序');

for (const mode of ['cancel', 'error']) {
  const item = fixture(), before = item.renderer.snapshot(), beforeFX = snapshotFX(item.model.fx);
  let current = true;
  item.renderer.fail = () => { if (mode === 'error') throw new Error('render-test'); current = false; };
  const promise = prepareMobileBoss(item.game, item.match, { isCurrent: () => current, yieldTurn: async () => {} });
  if (mode === 'error') await assert.rejects(promise, /render-test/);
  else assert.equal((await promise).cancelled, true);
  assert.deepEqual(item.renderer.snapshot(), before); assert.deepEqual(snapshotFX(item.model.fx), beforeFX);
  assert.equal(item.boss.crabletPool.disposed, true); assert.equal(item.boss.crabletPool.models.size, 0); item.dispose();
}
console.log('通过：准备取消/绘制异常恢复GL和特效，释放已准备小怪池，不虚报完成');

// 可选真实浏览器DOM验证：沿同源直接import生产BossHud，不加载游戏或另开GPU对局。
if (process.argv.includes('--browser')) {
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); await page.setCacheEnabled(false);
    await page.goto(process.env.BOSS_SOURCE_URL || 'http://localhost:8490/src/ui/hud-boss.js', { waitUntil: 'domcontentloaded' });
    await page.setContent('<!doctype html><html><body><div id="boss-test"></div></body></html>');
    const result = await page.evaluate(async () => {
      const { BossHud } = await import('/src/ui/hud-boss.js');
      const hud = Object.create(BossHud.prototype); hud.over = document.getElementById('boss-test'); hud.hud = { _snd() {} };
      await hud.prepareIntro(); const prepared = hud._preparedTitle; hud._titleCard();
      const reused = hud.over.firstElementChild === prepared;
      prepared.querySelector('.iw-btc__name span').dispatchEvent(new AnimationEvent('animationend', { bubbles: true }));
      const childKeepsCard = prepared.isConnected;
      prepared.dispatchEvent(new AnimationEvent('animationend', { bubbles: true }));
      return { reused, childKeepsCard, parentRemovesCard: !prepared.isConnected };
    });
    assert.deepEqual(result, { reused: true, childKeepsCard: true, parentRemovesCard: true });
    console.log('通过：Edge真实DOM生产BossHud预备节点复用，子span动画冒泡后父监听仍有效，父animationend立即移除');
  } finally { await browser.close(); }
}
