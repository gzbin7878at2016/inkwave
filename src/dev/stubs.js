// ============================================================================
// 【中文导读】开发用"假实现"桩 —— 真模块加载失败时的兜底替身,保证游戏仍能启动
// ----------------------------------------------------------------------------
// 【模块定位】属于开发辅助层(dev/)。由 main.js 的 loadModule() 在动态 import 失败时
//   `await import('./dev/stubs.js')` 取用(见 src/main.js 的 loadModule / boot 的"第二梯队下载")。
//   它**只**在某个真实模块(character / fx / environment / audio / music)加载失败时登场,
//   正常发行构建里永远不会被加载。目的不是"能玩",而是"能启动、能排查"。
//
// 【核心机制】本文件导出与真模块**同名同形**的最小实现:
//   · Character —— 用一根胶囊当小人,提供与 game/character.js 相同的方法名(update/trigger/
//     setColor/getMuzzle/dispose…),签名对得上,调用方无需改动即可跑通。
//   · FX / Environment —— 空操作的粒子池与一套能发光的简易天空/太阳/水面,避免场景全黑。
//   · audio / music —— 空操作对象,play/loop 等一律静默,loop() 返回可 stop 的假句柄。
//
// 【关键约定】
//   · 桩的方法**可以什么都不做**,但**不能少方法**:调用方按真模块的 API 调用它们,
//     缺一个方法会在运行期抛 TypeError。新增真模块 API 时,记得同步补桩。
//   · 桩只求"形状正确、不报错",不追求视觉/行为还原 —— 这是"降级可启动"而非"降级可玩"。
//   · 依赖 three,因此与真模块共享同一份 vendor/three(见 index.html 的 import map)。
//
// 【配套阅读】docs/BOOT.zh-CN.md(第 5 节"模块下载与容错降级")、docs/ARCHITECTURE.zh-CN.md
//             (模块按作者划分、允许缺席的协作契约);调用点:src/main.js 的 loadModule()。
// ============================================================================
// Minimal stand-ins used only if a real module fails to load (keeps the game bootable during development).
import * as THREE from 'three';

// 【角色桩】真 Game/character.js 缺席时的替身:一个胶囊几何体,外加"幼体/鱿鱼"两态缩放。
// 方法集如实模块命名,供 actor 层无感调用;update 依据 s.form 把胶囊压扁('kid' 站姿 vs 其他蹲姿)。
export class Character {
  constructor({ color }) {
    this.root = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.8, 6, 12), this.mat);
    body.position.y = 0.73; body.castShadow = true;
    this.root.add(body);
    this.body = body;
  }
  setColor(c) { this.mat.color.copy(c); }
  setWeapon() {}
  update(dt, s) { this.body.scale.y = s.form === 'kid' ? 1 : 0.4; this.body.position.y = s.form === 'kid' ? 0.73 : 0.3; }
  trigger() {}
  setDance() {}
  setHurt() {}
  setVisible(v) { this.root.visible = v; }
  getMuzzle(out) { return this.root.localToWorld(out.set(0.2, 1.0, 0.5)); }
  dispose() {}
}

// 【特效桩】全部空操作:不发光、不产生粒子,只是让 G.fx.burst/ring/… 等调用不会因缺方法而抛错。
export class FX {
  constructor() {} setCollider() {} burst() {} drop() {} ring() {} explosion() {} splatted() {} wake() {} muzzle() {} spawnFlash() {} rain() {} update() {} clear() {}
}

// 【环境桩】真 world/environment.js 缺席时的简版天空/太阳/水面:一盏平行光 + 半球光 + 一张蓝色平面,
// 让场景至少能看清(场景背景设为浅蓝)。update/setTheme 为空 —— 桩不做昼夜与光照图。
export class Environment {
  constructor(renderer, scene) {
    scene.background = new THREE.Color('#9fd8f0');
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.sun.position.set(-30, 50, -20); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    Object.assign(this.sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 160 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03; this.sun.shadow.radius = 3;
    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x9a8f7a, 0.9);
    scene.add(this.sun, this.sun.target, this.hemi);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: '#2a8fb8', roughness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -1.6; scene.add(water);
    this.envMap = null;
  }
  update() {} setTheme() {}
}

// 【音频桩】空操作单例:所有播放/调音量/静音请求都被忽略。loop() 返回一个带 set/stop 的假句柄,
// 因为调用方(海港环境音等)期望拿到可控制的循环对象 —— 桩必须返回形状正确的对象而非 undefined。
export const audio = { init() {}, setVolumes() {}, setListener() {}, play() {}, loop() { return { set() {}, stop() {} }; }, duck() {} };
// 【音乐桩】同理为空操作;fileTrack 供 main.js 判断"当前是否为文件曲目"(对局结束时的处理分支)。
export const music = { play() {}, setIntensity() {}, stop() {}, preload() {}, pause() {}, resume() {}, fileTrack: null };
