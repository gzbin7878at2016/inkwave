// ============================================================================
// 【中文导读】HULLBREAKER 的"模型层"总装文件(BossModel / Crablet):把骨架(bossModelGeo)、材质(bossMats)、
//   动画(bossAnim)、演出特效(bossModelFx)四块拼成一个可用的实体,并对外暴露稳定的公开 API。
//   它【不含任何游戏逻辑】——不知道 HP、不知道招式、不知道玩家;sim 通过 update(dt, st) 灌状态、通过
//   flash/trigger/setPhase 触发表现,hooks(onFoot/onImpact/onEvent) 把"踩地/命中/事件"回吐给游戏侧。
// ----------------------------------------------------------------------------
// 【模块定位】被 boss.js 的 Boss 类 new 一次(在 mode: boss 时);crablet 小怪由 boss.js 的 _spawnCrabs
//   经 BossModel.makeCrablet() 生产。root 坐标约定:脚底在 y=0、面朝 +Z。
// 【核心机制】
//   · 一只约 100 骨骼的骨架 + 五套蒙皮网格(steel/chitin/flesh/eye/junk),全部程序化生成;
//   · 材质驱动靠共享 uniform(bossMats 的 makeUniforms):每帧把动画结果 P[] 写进 uOpen/uCannon/uBelly/
//     uCrack/uEnrage 等,GPU 侧据此变形与着色——CPU 端没有逐顶点工作;
//   · 命中盒 hitShapes 是"挂点 + 半径 + 弱点标志"的数组,每帧用 getSocket 把挂点世界坐标刷进 pos,
//     并按时序激活(比如 belly 仅在晕眩/三阶段/belly 参数>0.5 时打开)——见 update 的判定块;
//   · 特效走 BossFX:蒸汽排气口、登场墨爆、死亡喷泉等由 _emit* 钩子在"确切帧"触发。
// 【关键约定】
//   · update 传出的 pos(Vector3)是复用的暂存对象,回调方不得长期持有,需要留存请自行 clone;
//   · flash 后 0.12s 内会抑制 st.hurt 的 flinch(避免同一次受击动画叠加两次);
//   · phase 1/2/3 决定裂甲(uCrack)、激怒(uEnrage)与命中盒开启;首帧 update 会把 phase 从 0 直接接纳,
//     刻意不播 roar(见构造末尾注释)。
// 【配套阅读】docs/BOSS.zh-CN.md、docs/BOSS.md §Model/§ART;同目录 bossModelGeo/bossMats/bossAnim/bossModelFx。
// ============================================================================
// INKWAVE — HULLBREAKER boss model. Public surface (see docs/BOSS.md "Model" + "ART notes"):
//   const m = new BossModel({ ink, weak, quality });  m.root (feet at y = 0, facing +Z), m.ready (Promise)
//   m.update(dt, st) · m.flash(k, weak) · m.getSocket(name, out) · m.hitShapes · m.setInk(c) · m.setWeak(c)
//   m.setPhase(p) · m.trigger(name) · m.dispose() · hooks m.onFoot / m.onImpact / m.onEvent · BossModel.makeCrablet()
// A giant armoured hermit crab living in a rusted 20 ft shipping container. One skeleton (≈100 bones), five skinned
// meshes (steel / chitin / flesh / eyes / junk) + two FX draws; everything procedural (bossModelGeo / bossMats).
import * as THREE from 'three';
import { G } from '../core/ctx.js';
import { buildRig, buildParts, buildCrablet, CONT, HEAD, MC } from './bossModelGeo.js';
import { makeUniforms, makeBossMaterials, makeCrabletMaterial, makeStencilTexture } from './bossMats.js';
import { BossAnimator, C } from './bossAnim.js';
import { BossFX } from './bossModelFx.js';

// 【命中盒定义表】[挂点 socket, 半径(米), 是否弱点]。前五个是硬壳/身体,后五个(eye/belly/crack)是弱点,伤害倍率更高
const HIT = [
  // socket, radius, weak
  ['shellF', 1.8, false], ['shellR', 1.8, false], ['body', 1.05, false], ['clawL', 0.85, false], ['clawR', 0.55, false],
  ['eyeL', 0.4, true], ['eyeR', 0.4, true], ['belly', 0.8, true], ['crackL', 0.7, true], ['crackR', 0.7, true],
];
// 【暂存向量】逐帧复用的 Vector3,供 getSocket/emit 系列写入世界坐标(回调方不得持有)
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// 【对手色推导】没显式给 weak 色时,取墨色的互补色相(色环 +0.5)、抬高饱和、亮度 0.5,保证弱点醒目
function rivalOf(c) { const h = { h: 0, s: 0, l: 0 }; c.getHSL(h); return new THREE.Color().setHSL((h.h + 0.5) % 1, Math.max(0.7, h.s), 0.5); }

// 【Boss 模型主类】公开 API 见文件头;构造后通过 m.ready 等待贴图就绪再进场
export class BossModel {
  // 构造:搭骨架 → 建几何桶 → 建材质/uniform → 蒙皮 mesh → 解析挂点 getSocket 表 → 装动画与 FX → 首帧 update
  constructor({ ink = null, weak = null, quality = 'high' } = {}) {
    this.quality = quality;
    this.root = new THREE.Group(); this.root.name = 'HULLBREAKER';
    this.onFoot = null; this.onImpact = null; this.onEvent = null;
    this.phase = 1; this.physics = null;
    // 【配色回退链】ink:入参 → 队伍 1 色 → 默认蓝;weak:入参 → 队伍 0 色 → ink 的互补色
    const inkC = ink ? new THREE.Color(ink) : G.teamColors?.[1] ? G.teamColors[1].clone() : new THREE.Color('#2f5bff');
    const weakC = weak ? new THREE.Color(weak) : G.teamColors?.[0] ? G.teamColors[0].clone() : rivalOf(inkC);
    // ---- rig + geometry
    this.rig = buildRig();
    const parts = buildParts(this.rig, quality);
    this.tris = parts.tris;
    this.U = makeUniforms();
    // 【容器逆变换 uniform】把集装箱几何的坐标系逆矩阵喂给着色器,用于世界空间贴花/锈迹对齐
    this.U.uContInv.value.copy(MC).invert();
    const st = makeStencilTexture(); this.U.uStencil.value = st.tex; this._stencil = st.tex;
    this.mats = makeBossMaterials(this.U);
    this.skeleton = new THREE.Skeleton(this.rig.bones);
    this.root.add(this.rig.by.base);
    this.root.updateMatrixWorld(true);
    this.meshes = [];
    const shadowOK = quality !== 'low';
    // 【五套蒙皮网格】按材质桶装配;eye 不投影(自发光眼睛),其余 receiveShadow 全开
    for (const k of ['steel', 'cara', 'flesh', 'eye', 'junk']) {
      const b = parts.buckets[k]; if (!b.nv) continue;
      const mesh = new THREE.SkinnedMesh(b.geometry(), this.mats[k]);
      mesh.name = 'hullbreaker:' + k;
      mesh.castShadow = shadowOK && k !== 'eye'; mesh.receiveShadow = true;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.6, 0), 8.6);
      this.root.add(mesh);
      mesh.bind(this.skeleton);
      this.meshes.push(mesh);
    }
    // ---- sockets (bone + bone-local offset)
    // 【挂点表】每个挂点 = 骨骼引用 + 骨骼局部偏移(由 resting 位置反推);getSocket 用 bone.matrixWorld 变换
    this._sock = {};
    for (const [name, [bone, p]] of Object.entries(parts.sockets)) this._sock[name] = { bone: this.rig.by[bone], off: p.clone().sub(this.rig.rest[bone]) };
    this._sock.shellF = { bone: this.rig.by.shell, off: new THREE.Vector3(0, 0.05, 1.5).applyMatrix4(new THREE.Matrix4().makeRotationX(CONT.pitch)).add(CONT.pos).sub(this.rig.rest.shell) };
    this._sock.shellR = { bone: this.rig.by.shell, off: new THREE.Vector3(0, 0.1, -1.55).applyMatrix4(new THREE.Matrix4().makeRotationX(CONT.pitch)).add(CONT.pos).sub(this.rig.rest.shell) };
    this._sock.body = { bone: this.rig.by.head, off: new THREE.Vector3(0, 2.2, 2.3).sub(this.rig.rest.head) };
    this._vents = parts.vents.map(([bone, p]) => ({ bone: this.rig.by[bone], off: p.clone().sub(this.rig.rest[bone]) }));
    // 【命中盒实例】把 HIT 表展开成可变对象;弱点默认只有眼睛初始激活,其余每帧按状态重设(见 update)
    // h.c 是 h.pos 的别名(历史命名),指向同一个 Vector3,玩家命中判定读的是这个实时世界坐标
    this.hitShapes = HIT.map(([socket, r, weak]) => { const h = { socket, r, weak, active: !weak || socket.startsWith('eye'), pos: new THREE.Vector3() }; h.c = h.pos; return h; });
    // ---- animation + fx
    this.anim = new BossAnimator(this, this.rig);
    this.fx = new BossFX({ quality, ink: inkC });
    this.root.add(this.fx.group);
    // ---- state
    this._flash = 0; this._weakFlash = 0; this._lastFlashT = -9; this._t = 0;
    this._crack = 0; this._enrage = 0; this._ventAcc = 0; this._st = null;
    this.setInk(inkC); this.setWeak(weakC);
    this.ready = st.ready.then(() => this);   // 贴图异步就绪后 resolve,调用方等它再进场
    // 【预热首帧】用一份中性的 st 跑一次 update,把动画/材质/uniform 初始化到位,避免首帧闪烁
    this.update(0, { speed: 0, turn: 0, move: null, moveT: 0, movePhase: null, phase: 1, stunned: false, hurt: 0, dead: false, aim: null });
    this.anim.prevPhase = 0; this.phase = 0;     // the first real update adopts st.phase without a roar
  }

  // ---------------------------------------------------------------- per frame
  // 【逐帧总入口】st 是 sim 灌进来的状态(速度/转向/招式/movePhase/phase/晕眩/受击/死亡/瞄准);
  //   顺序:接阶段 → 推动画 → 把动画结果 P[] 写进材质 uniform → 刷新命中盒世界坐标 → 触发 FX
  update(dt, st = {}) {
    this._t += dt; this._st = st;
    if (!this.physics && G.physics) this.physics = G.physics;
    if (st.phase && st.phase !== this.phase) this.setPhase(st.phase);
    // suppress st.hurt flinch right after a flash() (flash already flinched)
    // 【去重受击】flash 已经触发过 flinch,0.12s 内忽略 st.hurt,避免同一帧连播两段受击动画
    if (st.hurt && this._t - this._lastFlashT < 0.12) { this.anim.prevHurt = st.hurt; }
    this.anim.update(dt, st);
    const P = this.anim.P, U = this.U, A = this.anim;
    // ---- material drive
    // 【材质驱动】把动画参数(curve 数组 P)与阶段系数写进共享 uniform,GPU 据此做形变与着色
    // 【包络缓动】flash/weakFlash 线性衰减;crack(裂甲,≥2 阶段)、enrage(激怒,≥3 阶段且未死)用
    //   "朝目标值按 rate*dt 逼近"的一阶滤波,避免阶段切换瞬间跳变
    this._flash = Math.max(0, this._flash - dt * 7); this._weakFlash = Math.max(0, this._weakFlash - dt * 4);
    this._crack += ((this.phase >= 2 ? 1 : 0) - this._crack) * Math.min(1, dt * 1.2);
    this._enrage += ((this.phase >= 3 && !st.dead ? 1 : 0) - this._enrage) * Math.min(1, dt * 1.5);
    U.uTime.value = this._t;
    U.uFlash.value = this._flash; U.uWeakFlash.value = this._weakFlash;
    U.uCrack.value = this._crack * (st.dead ? Math.max(0, 1 - A.deadT * 0.3) : 1);
    U.uOpen.value = Math.max(0, Math.min(1.2, A.sp.tear.x)) * (st.dead ? Math.max(0, 1 - A.deadT * 0.25) : 1);
    U.uEnrage.value = this._enrage;
    U.uGlowL.value = Math.max(0, P[C.glowL]);
    U.uCannon.value = Math.max(0, Math.min(1.2, P[C.cannon]));
    U.uBelly.value = Math.max(0, Math.min(1, P[C.belly]));
    U.uHeat.value = this._enrage;
    const dead = !!st.dead;
    // 【眼睛模式】0=正常 1=晕眩(自转) 2=死亡(熄灭);uEyeSpin 只在晕眩模式下累加
    U.uEyeMode.value = dead && A.deadT > 1.6 ? 2 : (A.key === 'stun' && A.clipT > 0.3) ? 1 : 0;
    U.uEyeSpin.value += dt * (U.uEyeMode.value === 1 ? 1 : 0);
    U.uEyeGlow.value = dead ? Math.max(0.35, 1 - A.deadT * 0.3) : 1 + 0.35 * this._enrage;
    U.uLamp.value = dead ? 0 : 1;
    // ---- hit shapes
    // 【沉入判定】below = 身体根部骨骼降到 -2.2 以下(潜入/坍塌),此时所有命中盒失效
    const below = P[C.by] < -2.2;
    for (const h of this.hitShapes) {
      this.getSocket(h.socket, h.pos);
      // 【激活规则】belly 只在晕眩/三阶段/腹部外露时开;crack 只在壳裂开(tear>0.5)后开;其余硬点未死未沉即开
      if (h.socket === 'belly') h.active = !dead && !below && (!!st.stunned || this.phase >= 3 || P[C.belly] > 0.5);
      else if (h.socket === 'crackL' || h.socket === 'crackR') h.active = !dead && !below && A.sp.tear.x > 0.5;
      else h.active = !dead && !below;
    }
    // ---- fx: steam vents (phase 3 + channel), nozzle steam
    // 【蒸汽排气】P[steam] 是动画输出的"冒汽强度";累加器 _ventAcc 按 9*steam/s 的速率从随机排气口冒汽
    const steam = Math.max(P[C.steam], 0);
    if (steam > 0.01 && !below) {
      this._ventAcc += dt * 9 * steam;
      while (this._ventAcc >= 1) {
        this._ventAcc -= 1;
        const v = this._vents[(Math.random() * this._vents.length) | 0];
        _v.copy(v.off).applyMatrix4(v.bone.matrixWorld);
        this.fx.steamPuff(_v, 1, _v2.set(0, 1, 0), 1.2, 1.0, 1.5);
      }
    }
    // 【炮口蒸汽】sweep 的恢复段(rec)用 cross 检测段首帧,喷一簇朝前的蒸汽作为后坐力提示
    if (A.key === 'sweep:rec' && A.cross(0.02)) { this.getSocket('cannon', _v); this.fx.steamPuff(_v, 8, _v2.set(0, 0.3, 1).transformDirection(this.root.matrixWorld), 2.5, 0.8, 1.2); }
    this.fx.update(dt);
  }

  // hooks (called by the animator on exact frames); the Vector3 passed out is reused
  // 【脚下事件】动画器在足部着地帧调用:转给 onFoot(游戏侧做脚步墨花)并广播 'step' 事件
  _emitFoot(i, pos, s) { if (this.onFoot) this.onFoot(i, pos, s); if (this.onEvent) this.onEvent('step', { leg: i, pos, strength: s }); }
  // 【命中事件】动画器在冲拳/砸地命中帧调用:按挂点喷墨(爪=落地墨、嘴=前喷墨、身体=环形墨),再转 onImpact
  _emitImpact(socket, s) {
    const p = this.getSocket(socket, _v);
    const gy = this.root.matrixWorld.elements[13];
    if (socket === 'clawL') { p.y = gy + 0.05; this.fx.ink(p, 26, _v2.set(0, 1, 0), 7, 0.9, 0.2, gy); }
    if (socket === 'mouth') this.fx.ink(p, 14, _v2.set(0, 0.6, 1).transformDirection(this.root.matrixWorld), 5, 0.9, 0.16, gy);
    if (socket === 'body') this.fx.ink(p.setY(gy + 0.2), 30, _v2.set(0, 1, 0), 6, 1.0, 0.2, gy);
    if (this.onImpact) this.onImpact(socket, p, s);
  }
  // 【事件特效】动画器在关键帧广播具名事件;此处负责把事件落成 BossFX 特效,再转给 onEvent 供游戏侧联动
  //   支持的 name:burst(登场墨爆)/geyser(死亡喷泉)/hatch(舱盖开)/roar(三阶段怒吼蒸汽)
  _emitEvent(name, socket, data) {
    const p = this.getSocket(socket, _v);
    const gy = this.root.matrixWorld.elements[13];   // 矩阵第 14 元素即世界坐标 y,用作地面高度
    if (name === 'burst') { _v.setFromMatrixPosition(this.root.matrixWorld); _v.y += 0.3; this.fx.ink(_v, 90, _v2.set(0, 1, 0), 13, 0.75, 0.3, gy, 2.6); this.fx.steamPuff(_v, 14, _v2.set(0, 1, 0), 4, 2.5, 2.0); }
    if (name === 'geyser') this.fx.geyser(p, 3.6);
    if (name === 'hatch') { this.fx.ink(p, 5, _v2.set(0, 1, 0), 5, 0.5, 0.14, gy); this.fx.steamPuff(p, 2, _v2.set(0, 1, 0), 2, 0.9, 0.9); }
    if (name === 'roar' && this.phase >= 3) this.fx.steamPuff(p, 10, _v2.set(0, 0.5, 1).transformDirection(this.root.matrixWorld), 3, 1.2, 1.3);
    if (this.onEvent) this.onEvent(name, { socket, pos: p, data });
  }

  // ---------------------------------------------------------------- API
  // 【受击闪白】叠加上闪光强度(弱点 1.0 / 普通取 0.6 倍);距上次 flash 超 0.09s 才再触发一次 flinch,防抖
  flash(k = 1, weak = false) {
    if (weak) this._weakFlash = Math.max(this._weakFlash, k); else this._flash = Math.max(this._flash, k * 0.6);
    if (this._t - this._lastFlashT > 0.09) this.anim.flinch(Math.min(1, 0.3 + k * 0.7) * (weak ? 1.2 : 1));
    this._lastFlashT = this._t;
  }
  // 【取挂点世界坐标】name 无效时回退成 root 的世界位置;out 不传则新建(热路径应传入复用)
  getSocket(name, out = new THREE.Vector3()) {
    const s = this._sock[name];
    if (!s) return out.setFromMatrixPosition(this.root.matrixWorld);
    return out.copy(s.off).applyMatrix4(s.bone.matrixWorld);
  }
  // 【换墨色】同时更新材质 uniform 与 FX(墨团会换成同色)
  setInk(color) { this.U.uInk.value.set(color); this.fx?.setInk(this.U.uInk.value); }
  // 【换弱点色】只改 uniform(弱点高亮色)
  setWeak(color) { this.U.uWeak.value.set(color); }
  // 【设阶段】1/2/3;影响裂甲与激怒强度(update 里读取)
  setPhase(p) { this.phase = p; }
  /** one-shots: 'intro' | 'roar' | 'hurt' */
  // 【一次性触发】转发给动画器播放单发剪辑
  trigger(name) { this.anim.trigger(name); }
  // 【挂点名单】调试/工具用,列出全部可用挂点名
  get sockets() { return Object.keys(this._sock); }
  // 【销毁】释放全部几何/材质/贴图/骨架/FX,并摘下 root
  dispose() {
    this._disposed = true;
    for (const m of this.meshes) m.geometry.dispose();
    for (const k in this.mats) this.mats[k].dispose();
    this._stencil?.dispose(); this.skeleton.dispose(); this.fx.dispose();
    this.root.removeFromParent();
  }

  /** the minion: small container-lid crab. { root, ready, update(dt, st), pop(), setInk, dispose } */
  // 【工厂】产出小怪 crablet(小螃蟹);与 BossModel 同一套 API 风格,便于 boss.js 统一驱动
  static makeCrablet(opts = {}) { return new Crablet(opts); }
}

// ------------------------------------------------------------------------------------------------ crablet
// 【暂存】小怪逐帧复用的四元数/欧拉(欧拉序 YXZ,便于分别控制偏航/俯仰/翻滚)
const _cq = new THREE.Quaternion(), _ce = new THREE.Euler(0, 0, 0, 'YXZ');
// 【小怪类】集装箱盖外壳的小螃蟹:全程序化骨骼动画,由 st(speed/dead 等)驱动;死亡时 pop 成一团墨
export class Crablet {
  // 构造:建骨架与蒙皮网格,配色回退链同 BossModel;then 立即跑一帧 update(0,{}) 预热
  constructor({ ink = null, weak = null, quality = 'high' } = {}) {
    this.root = new THREE.Group(); this.root.name = 'crablet';
    const inkC = ink ? new THREE.Color(ink) : G.teamColors?.[1] ? G.teamColors[1].clone() : new THREE.Color('#2f5bff');
    const weakC = weak ? new THREE.Color(weak) : G.teamColors?.[0] ? G.teamColors[0].clone() : rivalOf(inkC);
    const R = buildCrablet(quality);
    this.R = R; this.tris = R.tris;
    this.U = makeUniforms(); this.U.uInk.value.copy(inkC); this.U.uWeak.value.copy(weakC);
    this.mat = makeCrabletMaterial(this.U);
    this.skel = new THREE.Skeleton(R.bones);
    this.root.add(R.by.base); this.root.updateMatrixWorld(true);
    this.mesh = new THREE.SkinnedMesh(R.geo, this.mat); this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 0.9);
    this.root.add(this.mesh); this.mesh.bind(this.skel);
    this.t = 0; this.phi = Math.random(); this.popped = false; this.popT = -1; this.fx = null; this.seed = Math.random() * 10;
    this.ready = Promise.resolve(this);   // 无异步资源,立即就绪
    this.update(0, {});
  }
  // 【逐帧驱动】st.t 累计时间;tumble 段(前 0.55s)做翻滚+落地压扁,之后进入六足交替步态与钳/眼小动作
  update(dt, st = {}) {
    this.t += dt;
    const by = this.R.by, t = this.t;
    if (st.dead && !this.popped) this.pop();
    const sp = Math.min(1, (st.speed || 0) / 3);   // 速度归一化到 0..1,作步态幅度
    this.phi += dt * (1.2 + (st.speed || 0) * 2.4);   // 步频随速度提升
    const ph = this.phi * Math.PI * 2;
    // tumble in (first 0.55 s): a roll and a squash on landing
    // 【入场翻滚】tum 从 1 线性降到 0;land 是 0.5~0.8s 的一个正弦脉冲,做落地挤压
    const tum = Math.max(0, 1 - t / 0.55);
    const land = t > 0.5 && t < 0.8 ? Math.sin(((t - 0.5) / 0.3) * Math.PI) : 0;
    _ce.set(tum * tum * 6.0, 0, tum * 2.5 + Math.sin(ph * 2) * 0.06 * sp, 'YXZ');
    by.body.quaternion.setFromEuler(_ce);
    // 身体高度 = 基准 0.26 + 步态起伏 + 细微呼吸 + 落地下沉 + 翻滚抬升
    by.body.position.set(0, 0.26 + Math.abs(Math.sin(ph)) * 0.035 * sp + Math.sin(t * 3 + this.seed) * 0.008 - land * 0.05 + tum * 0.2, 0);
    by.body.scale.set(1 + land * 0.12, 1 - land * 0.15, 1 + land * 0.12);   // 落地横向鼓、纵向扁
    by.lid.quaternion.setFromAxisAngle(_v.set(1, 0, 0), -0.05 * Math.abs(Math.sin(ph * 2)) * sp - land * 0.1);
    // legs: alternating tripods
    // 【交替三足步态】按 i 的奇偶与前后半分组(grp),相位差 π,做出六足交替着地的节奏
    const legs = this.R.legs;
    for (let i = 0; i < legs.length; i++) {
      const L = legs[i], grp = (i % 2) ^ (i >= 3 ? 1 : 0), a = ph + grp * Math.PI;
      _ce.set(0, Math.sin(a) * 0.45 * sp, L.side * (Math.max(0, Math.cos(a)) * 0.5 * sp + tum * 0.9), 'YXZ');
      by[L.name].quaternion.setFromEuler(_ce);
    }
    // claws snap, eyes wobble
    const snap = Math.max(0, Math.sin(t * 5 + this.seed)) ** 6;
    by.clawL.quaternion.setFromAxisAngle(_v.set(1, 0, 0), -0.3 * snap - 0.15 * Math.sin(ph) * sp);
    by.clawR.quaternion.setFromAxisAngle(_v.set(1, 0, 0), -0.3 * Math.max(0, Math.sin(t * 5 + this.seed + 1.7)) ** 6 + 0.15 * Math.sin(ph) * sp);
    by.eyeL.quaternion.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(t * 7 + this.seed) * 0.15);
    by.eyeR.quaternion.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(t * 7.3 + this.seed + 1) * 0.15);
    // pop: swell + flash, then burst into ink
    // 【爆墨演出】0.14s 内先胀大+闪白,到点后隐藏网格、现场起一个低画质 BossFX 喷出一团墨,再自行淡出
    if (this.popT >= 0) {
      this.popT += dt;
      const u = Math.min(1, this.popT / 0.14);
      this.mesh.scale.setScalar(1 + 0.45 * u * u);
      this.U.uFlash.value = u;
      if (this.popT >= 0.14 && this.mesh.visible) {
        this.mesh.visible = false;
        if (!this.fx) { this.fx = new BossFX({ quality: 'low', ink: this.U.uInk.value }); this.root.add(this.fx.group); }
        else this.fx.reset();
        _v.set(0, 0.3, 0).applyMatrix4(this.root.matrixWorld);
        this.fx.ink(_v, 26, _v2.set(0, 1, 0), 4.2, 1.0, 0.09, this.root.matrixWorld.elements[13], 1.2);
      }
    } else this.U.uFlash.value = Math.max(0, this.U.uFlash.value - dt * 6);
    if (this.fx) this.fx.update(dt);
    this.U.uTime.value = t;
  }
  // 【受击】闪白一下(具体伤害由 boss.js 结算,这里只管视觉)
  hit() { this.U.uFlash.value = 1; }
  // 【触发爆墨】幂等:只第一次生效,置 popT=0 启动 pop 动画
  pop() { if (this.popped) return; this.popped = true; this.popT = 0; }
  // 手机加载期预建并保留每只小蟹自己的爆墨缓冲，真正死亡时复用同一实例。
  preparePopEffect() {
    if (!this.fx) { this.fx = new BossFX({ quality: 'low', ink: this.U.uInk.value }); this.root.add(this.fx.group); }
    this.fx.reset(); return this.fx;
  }
  resetForReuse({ ink, weak } = {}) {
    this.root.removeFromParent(); this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.scale.setScalar(1); this.root.visible = true;
    for (const bone of this.R.bones) {
      bone.position.copy(this.R.rest[bone.name]);
      if (bone.parent?.isBone) bone.position.sub(this.R.rest[bone.parent.name]);
      bone.quaternion.identity(); bone.scale.setScalar(1);
    }
    this.t = 0; this.phi = Math.random(); this.seed = Math.random() * 10; this.popped = false; this.popT = -1;
    this.mesh.visible = true; this.mesh.scale.setScalar(1); this.U.uTime.value = 0; this.U.uFlash.value = 0;
    if (ink) this.setInk(ink); if (weak) this.U.uWeak.value.set(weak);
    this.fx?.reset(); if (this.fx) this.fx.setInk(this.U.uInk.value);
    this.update(0, {}); this.root.updateMatrixWorld(true);
  }
  // 换墨色
  setInk(c) { this.U.uInk.value.set(c); }
  // 销毁:释放网格几何/材质/骨架,以及 pop 时可能新建的临时 FX
  dispose() { if (this._disposed) return; this._disposed = true; this.mesh.geometry.dispose(); this.mat.dispose(); this.skel.dispose(); this.fx?.dispose(); this.root.removeFromParent(); }
}

// 仅由手机Boss持有；7只存活上限加一批5只死亡演出余量，加载时逐只建造。耗尽仍走原factory，不减少敌人数。
export class MobileCrabletPool {
  constructor(options, { capacity = 12, factory = opts => new Crablet(opts) } = {}) {
    this.options = options; this.capacity = capacity; this.factory = factory;
    this.models = new Set(); this.free = []; this.borrowed = new Set(); this.disposed = false;
  }
  prepareNext() {
    if (this.disposed || this.models.size >= this.capacity) return null;
    const model = this.factory(this.options);
    try { model.preparePopEffect(); model.resetForReuse(this.options); }
    catch (error) { model.dispose(); throw error; }
    this.models.add(model); this.free.push(model); return model;
  }
  acquire() {
    if (this.disposed) return null;
    const model = this.free.pop();
    if (!model) return null;
    try { model.resetForReuse(this.options); }
    catch (error) { this.models.delete(model); model.dispose(); throw error; }
    this.borrowed.add(model); return model;
  }
  release(model) {
    if (!this.models.has(model)) return false;
    if (!this.borrowed.delete(model)) return true;
    model.resetForReuse(this.options); this.free.push(model); return true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.models) model.dispose();
    this.models.clear(); this.free.length = 0; this.borrowed.clear();
  }
}
