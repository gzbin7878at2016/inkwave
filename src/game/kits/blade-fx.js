// ============================================================================
// 【中文导读】盐水弯刀的**特效/音效/图标侧**——挥砍弧光、蓄满墨波的视觉、程序化音效、HUD 图标。
// 【模块定位】本三件套之一,由 blade.js(行为侧)在模块顶层 import 并按需调用;
//   blade.js 负责"什么时候放",本文件负责"看起来/听起来什么样":
//     · blade-model.js —— 刀的模型 + 部件动画(蓄力时刃口发光);
//     · blade-fx.js(本文件)—— BladeFX 对象池(弧光/月牙)、installBladeSounds()、BLADE_ICON;
//     · blade.js —— 状态机与命中,调 BladeFX.slash / BladeFX.waveMesh,并 emit 事件。
// 【核心机制】两套对象池 + 两套 ShaderMaterial:
//   · 挥砍弧光:环形扇面几何(arcGeometry),池大小 ARC_N;slash() 取一个空闲弧,沿挥砍轴旋转并按
//     左右镜像/斜置,随时间推进 uniform uHead 让亮头扫过、uFade 淡出。
//   · 墨波:月牙几何(waveGeometry,双子面:正看是镜片、侧看带拖尾)+ waveMaterial 池 WAVE_N;
//     blade.js 拿到 mesh 后每帧摆位、写 uT/uFade。
//   两套材质都走自定义 GLSL;gate() 让这些透明片在 GTAO/深度覆写 pass 里退场(不当遮挡体)。
// 【关键约定】热路径零分配:全部 mesh 在 ensure() 里一次性建好并池化,运行期只改矩阵/uniform。
//   坐标系:弧光以角色为原点、+Z 为朝向面;墨波以行进方向为 +Z。池对象带 busy 标志,拿不到空闲即放弃(不新建)。
// 【配套阅读】blade.js(调用方)、blade-model.js(模型侧)、docs/RENDERING-UE4.zh-CN.md(GLSL/后处理)。
// ============================================================================
// Brine Cutlass — slash trails, the charged ink wave's look, sounds and the weapon icon (used by kits/blade.js).
//   Slash arcs: pooled annular-sector meshes (a swoosh that sweeps with the blade and fades from its tail): a flat,
//   slightly diagonal arc round the chest for the quick cuts (alternating sides), a tall vertical arc for the charged
//   overhead cut. Ink wave: a pooled crescent (a lens-shaped front sheet you see from behind + a crescent profile with
//   a streaming tail you see from the side), team ink with a white-hot leading edge.
import * as THREE from 'three';
import { G } from '../../core/ctx.js';
import { SFX } from '../../audio/audio.js';
import { pts } from '../../audio/music.js';

const DEG = Math.PI / 180;

// 【几何】挥手可参数化的环形扇面(弧光)与月牙(墨波)一次生成、全程复用。
// ------------------------------------------------------------------------------------------ geometry
// arc: u along the sweep (0 start → 1 end), v across (0 inner → 1 outer, the blade tip's path). plane 'h' = XZ
// (angle from +Z toward +X), 'v' = YZ (angle from +Z toward +Y)
// 生成一块环形扇面:角度 a0→a1、半径 r0→r1 的 (nu×nv) 网格;plane 'h' 铺在 XZ(水平横斩),'v' 立在 YZ(过顶重斩)。
// uv 里 u 沿扫掠方向、v 沿径向(0 内→1 外),供着色器按扫掠进度塑形。
function arcGeometry(a0, a1, r0, r1, plane, nu = 44, nv = 7) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu, th = a0 + (a1 - a0) * u;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv, r = r0 + (r1 - r0) * v;
      if (plane === 'h') pos.push(Math.sin(th) * r, 0, Math.cos(th) * r);
      else pos.push(0, Math.sin(th) * r, Math.cos(th) * r);
      uv.push(u, v);
      if (i < nu && j < nv) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
// wave: sheet A (k = 0) = a lens across X·Y at the crescent's front; sheet B (k = 1) = the crescent profile in Y·Z with a
// tail streaming back along −Z. uv: A = (x −1…1, y −1…1); B = (tail 0…1, y −1…1). Unit size (scaled per wave).
// 生成墨波几何:两面片合一——A 面(k=0)是月牙正前方的镜片,B 面(k=1)是带后拖尾的月牙侧剖;单位尺寸,逐个浪缩放。
// 顶点属性 aK 区分两面,供 WAVE_FRAG 分别着色。
function waveGeometry() {
  const pos = [], uv = [], kk = [], idx = [];
  const bow = 0.32;
  const NY = 18, NX = 8, NT = 10;
  let base = 0;
  for (let i = 0; i <= NY; i++) {
    const y = (i / NY) * 2 - 1, lens = Math.sqrt(Math.max(0, 1 - y * y));
    for (let j = 0; j <= NX; j++) {
      const x = (j / NX) * 2 - 1;
      pos.push(x * 0.6 * (0.25 + 0.75 * lens), y, bow * (1 - y * y) - 0.08 * x * x);
      uv.push(x, y); kk.push(0);
      if (i < NY && j < NX) { const a = base + i * (NX + 1) + j, b = a + NX + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
  }
  base = pos.length / 3;
  for (let i = 0; i <= NY; i++) {
    const y = (i / NY) * 2 - 1, c = 1 - y * y;
    for (let j = 0; j <= NT; j++) {
      const t = j / NT;
      pos.push(0, y * (1 - 0.3 * t), bow * c - t * (0.35 + 0.65 * c) * 1.6);
      uv.push(t, y); kk.push(1);
      if (i < NY && j < NT) { const a = base + i * (NT + 1) + j, b = a + NT + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -0.5), 2);
  return g;
}

// 【材质】弧光与墨波各一套 ShaderMaterial;片段着色器用 uHead/uFade/uTail 等 uniform 塑形。
// ------------------------------------------------------------------------------------------ materials
const ARC_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ARC_FRAG = `
uniform vec3 uColor; uniform float uHead, uFade, uTail, uHeavy;
varying vec2 vUv;
void main() {
  float u = vUv.x, v = vUv.y;
  float behind = uHead - u;
  if (behind < -0.015) discard;
  float tail = exp(-max(behind, 0.0) / uTail);
  float thick = mix(0.2, 0.9, tail);
  float body = smoothstep(1.0 - thick, 1.0 - thick + 0.3, v) * (1.0 - smoothstep(0.94, 1.0, v));
  float rim = exp(-pow((v - 0.9) * 11.0, 2.0));
  float head = exp(-pow(max(behind, 0.0) * 12.0, 2.0));
  float ends = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.93, 1.0, u));
  // streaks along the sweep (ink torn by the edge)
  float streak = 0.75 + 0.25 * sin(v * 60.0 + u * 7.0);
  float a = (body * 0.78 * streak + rim * 0.95) * tail * uFade * ends;
  vec3 col = mix(uColor * (1.1 + 0.4 * uHeavy), vec3(1.0), clamp(rim * 0.5 + head * 0.55, 0.0, 1.0));
  col *= 1.0 + head * (1.4 + uHeavy);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const WAVE_VERT = `attribute float aK; varying vec2 vUv; varying float vK;
void main() { vUv = uv; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WAVE_FRAG = `
uniform vec3 uColor; uniform float uT, uFade;
varying vec2 vUv; varying float vK;
void main() {
  float a; float hot;
  float y = vUv.y, ends = 1.0 - pow(abs(y), 6.0);
  if (vK < 0.5) {
    float x = vUv.x;
    float lens = 1.0 - x * x;
    hot = exp(-x * x * 18.0);
    float rimA = exp(-pow((abs(x) - 0.82) * 7.0, 2.0));
    a = pow(max(lens, 0.0), 0.6) * ends * (0.72 + 0.1 * sin(y * 9.0 - uT * 30.0)) + rimA * 0.35 * ends;
  } else {
    float t = vUv.x;
    hot = exp(-t * 14.0);
    float streak = 0.6 + 0.4 * sin(y * 23.0 + t * 5.0 - uT * 20.0);
    a = ends * exp(-t * 2.6) * (0.35 + 0.65 * hot) * mix(1.0, streak, smoothstep(0.05, 0.4, t)) * smoothstep(1.0, 0.75, t);
  }
  a *= uFade;
  vec3 col = mix(uColor * 1.25, vec3(1.0), hot * 0.7) * (1.0 + 1.6 * hot);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// 弧光材质工厂:每次取一个独立实例(便于每个池槽各写各的 uniform);透明、不写深度、双面。
function arcMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uHead: { value: 0 }, uFade: { value: 1 }, uTail: { value: 0.35 }, uHeavy: { value: 0 } },
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
}
// 墨波材质工厂:同样每槽一实例;uniform uColor/uT/uFade。
function waveMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uFade: { value: 1 } },
    vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
}
// GTAO / depth override passes would draw the raw sheets as occluders: sit them out (same as the charger ribbons)
// 绘制闸门(onBeforeRender 回调):正在跑深度覆写(GTAO 等)的 pass 时把 drawRange 置 0——否则这些
// 透明墨片会被当成遮挡体投进 AO/深度。普通 pass 恢复全量绘制。
function gate(renderer, scene, camera, geometry) { geometry.drawRange.count = scene.overrideMaterial ? 0 : Infinity; }

// 【对象池】BladeFX:弧光池 + 墨波池,外加公用的 _place/tick/clear。ARC_N / WAVE_N 是池容量。
// ------------------------------------------------------------------------------------------ pools
const ARC_N = 14, WAVE_N = 12;
export const BladeFX = {
  scene: null, arcs: [], waves: [], live: [],
  _geoH: null, _geoV: null, _geoW: null,
  // 惰性建池:首次用到(或场景换成新的 G.scene)时一次性建好几何与全部槽位并挂进场景;之后只复用。
  // 场景一致时直接返回 true;几何缓存(_geoH/_geoV/_geoW)跨场景切换保留,只重挂 mesh。
  ensure() {
    if (!G.scene) return false;
    if (this.scene === G.scene) return true;
    this.scene = G.scene; this.arcs.length = 0; this.waves.length = 0; this.live.length = 0;
    // tap arc: 150° round the chest, 0.35 → 1.55 m; heavy arc: overhead (behind the head) → down past the feet
    this._geoH = this._geoH || arcGeometry(-75 * DEG, 75 * DEG, 0.34, 1.55, 'h');
    this._geoV = this._geoV || arcGeometry(118 * DEG, -58 * DEG, 0.3, 1.7, 'v');
    this._geoW = this._geoW || waveGeometry();
    for (let i = 0; i < ARC_N; i++) {
      const grp = new THREE.Group(), m = new THREE.Mesh(this._geoH, arcMaterial());
      m.frustumCulled = false; m.renderOrder = 5; m.onBeforeRender = gate;
      grp.add(m); grp.visible = false; this.scene.add(grp);
      this.arcs.push({ grp, mesh: m, busy: false });
    }
    for (let i = 0; i < WAVE_N; i++) {
      const m = new THREE.Mesh(this._geoW, waveMaterial());
      m.frustumCulled = false; m.renderOrder = 5; m.onBeforeRender = gate; m.visible = false;
      this.scene.add(m);
      this.waves.push({ mesh: m, busy: false });
    }
    return true;
  },
  // a slash arc riding with actor a: side ±1 (+1 sweeps the kid's right → left), heavy = the overhead cut
  // 放一道挥砍弧光:side 决定左右镜像(+1 = 从角色右手扫向左手),heavy 用竖直弧(过顶重斩)否则水平横斩。
  // 依据 dur 决定描边进度节奏、fade 决定收尾淡出时长;角色摄像机太远(>50 m)时跳过以省绘制。
  slash(a, side, heavy, dur, yaw = a.aimYaw) {
    if (G.camera && G.camera.position.distanceToSquared(a.pos) > 50 * 50) return;   // too far to read: skip the trail
    if (!this.ensure()) return;
    // 【池取槽】先找空闲弧;没有则"抢"最早入 live 的那道(挤掉旧弧),再没有就放弃(绝不新建)。
    let s = this.arcs.find((x) => !x.busy);
    if (!s) { s = this.live.shift(); if (!s) return; }
    s.busy = true; s.a = a; s.t = 0; s.dur = dur; s.side = side; s.heavy = heavy; s.yaw = yaw;
    s.fade = heavy ? 0.26 : 0.2;
    const m = s.mesh, u = m.material.uniforms;
    // 【几何切换】重斩用竖直弧(_geoV),快斩用水平弧(_geoH);颜色随队伍墨(uColor)。
    m.geometry = heavy ? this._geoV : this._geoH;
    u.uColor.value.copy(G.teamColors[a.team] || a.color); u.uHead.value = 0; u.uFade.value = 1; u.uTail.value = heavy ? 0.4 : 0.32; u.uHeavy.value = heavy ? 1 : 0;
    // 【快斩镜像/斜置】水平弧按 side 做 X 轴镜像(扫掠方向),并绕 Z 倾斜成对角线(起手高、收手低);重斩微抬。
    // the tap arc: mirrored per side (sweep direction), tilted into a diagonal (high at the start → low at the end)
    m.scale.set(heavy ? 1 : side, 1, 1);
    m.rotation.set(0, 0, heavy ? 0.2 : -side * 0.4);
    m.position.set(heavy ? -0.12 : 0, 0, 0);
    s.grp.visible = true;
    this._place(s);
    this.live.push(s);
  },
  // 把弧光组摆到角色身上:挂在胸口高度(重斩 1.18 m / 快斩 0.98 m,叠加角色起伏 smoothY),朝向取 s.yaw。
  // 每帧 tick 会重调用以跟随移动中的角色。
  _place(s) {
    const a = s.a;
    s.grp.position.set(a.pos.x, a.pos.y + (a.smoothY || 0) + (s.heavy ? 1.18 : 0.98), a.pos.z);
    s.grp.rotation.set(0, s.yaw, 0);
  },
  // 借一个墨波槽给 blade.js 摆位:拿不到空闲则返回 null(调用方负责放弃,不会新建);成功即置色、可见、uT/uFade 复位。
  // 返回的槽对象后续由 slot.mesh 操作,用完必须调 freeWave(w) 归还。
  waveMesh(color) {
    if (!this.ensure()) return null;
    const w = this.waves.find((x) => !x.busy);
    if (!w) return null;
    w.busy = true; w.mesh.visible = true;
    w.mesh.material.uniforms.uColor.value.copy(color); w.mesh.material.uniforms.uFade.value = 1; w.mesh.material.uniforms.uT.value = 0;
    return w;
  },
  // 归还墨波槽:置空闲、隐藏 mesh(空入参安全)。
  freeWave(w) { if (!w) return; w.busy = false; w.mesh.visible = false; },
  // 每帧推进所有活跃弧光:uHead 扫过 0→1.04(略过 1 让亮头走出弧尾),随后 uFade 在 s.fade 秒内淡出;
  // 角色还活着就持续重摆位跟随;收尾或角色已死则释放槽位。倒序遍历以便安全 splice。
  tick(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.t += dt;
      const u = s.mesh.material.uniforms;
      u.uHead.value = Math.min(1.04, s.t / s.dur * 1.04);
      const after = s.t - s.dur;
      u.uFade.value = after <= 0 ? 1 : Math.max(0, 1 - after / s.fade);
      if (s.a && s.a.alive) this._place(s);
      if (after > s.fade || !s.a || !s.a.alive) { s.busy = false; s.grp.visible = false; this.live.splice(i, 1); }
    }
  },
  // 比赛重置/切图时清空:释放全部活跃弧光与所有墨波槽(不清几何缓存,下次 ensure 复用)。
  clear() {
    for (const s of this.live) { s.busy = false; s.grp.visible = false; }
    this.live.length = 0;
    for (const w of this.waves) { w.busy = false; w.mesh.visible = false; }
  },
};

// 【音效】把 blade 的五条 SFX 配方装进 SFX 表(调用方 blade.js 只 play 名字)。幂等:已装过直接返回。
// ------------------------------------------------------------------------------------------ sounds
// Same voice kit as audio.js's def() entries (v.tone / v.nz / v.bub / v.noise / filters); pitch p per play.
export function installBladeSounds() {
  if (SFX.blade_swish) return;
  // 【快速横斩音】一声利落的"嗖":带通从 650Hz 冲上 3900Hz 再回落到 1100Hz 模拟空气划过,
  //   叠两枚钢音泛音(3020/4610Hz)与一记湿润甩墨噪声;tone/nz 都是 audio.js 的合成原语。
  // quick cut: a tight "shwip" of air (band sweep up then down), a steel glint, the ink flicking off the edge
  SFX.blade_swish = {
    gain: 0.5, max: 5, jitter: 0.05, reverb: 0.07, minGap: 0.03,
    build(v, p) {
      const T = v.t, g = v.gain(0, v.out), bp = v.filter('bandpass', 900 * p, 1.4, g);
      bp.frequency.setValueAtTime(650 * p, T); bp.frequency.exponentialRampToValueAtTime(3900 * p, T + 0.06); bp.frequency.exponentialRampToValueAtTime(1100 * p, T + 0.17);
      pts(g.gain, T, [[0, 0], [0.045, 0.95], [0.085, 0.5], [0.18, 0]]);
      v.noise('white', T, T + 0.19, bp);
      v.nz({ ft: 'highpass', f: 6500, a: 0.02, d: 0.06, peak: 0.16 });                                     // air hiss
      v.tone({ t: 0.012, f: 3020 * p, a: 0.002, d: 0.14, peak: 0.1 });                                     // steel glint
      v.tone({ t: 0.012, f: 4610 * p, a: 0.002, d: 0.09, peak: 0.06 });
      v.nz({ t: 0.05, f: 1600 * p, f1: 520 * p, sw: 0.1, q: 4.5, a: 0.003, d: 0.1, peak: 0.34 });          // wet flick
      for (let i = 0; i < 3; i++) v.bub(T + 0.06 + v.r(0, 0.08), v.r(800, 1600) * p, 0.1, v.r(0.015, 0.03), 1.8);
    },
  };
  // 【蓄力循环音】一段可实时调音的金属共鸣 drone:锯齿基频 + 两枚正弦泛音经带通,外挂 9Hz 颤音与高频嘶声;
  //   蓄力推进时调用 pitch(q) 用 setTargetAtTime 把各振荡器频率(及带通、颤音速率)平滑推到 q 倍，q 从 1 到 1.6。
  // charge hum (loop): a resonant metallic drone that climbs and shimmers as the blade fills; set({ pitch: 1 … 1.6 })
  SFX.blade_charge = {
    gain: 0.24, max: 2, jitter: 0, reverb: 0.06, oneShot: 0.8,
    loop(v, p) {
      const T = v.t, base = 196;
      const amp = v.gain(0.6, v.out);
      const bp = v.filter('bandpass', base * 5 * p, 4, amp);
      const o1 = v.osc('sawtooth', base * p, T, null, bp);
      const o2 = v.osc('sine', base * 2.005 * p, T, null, v.gain(0.3, amp));
      const o3 = v.osc('sine', base * 3.98 * p, T, null, v.gain(0.1, amp));
      const trem = v.lfo(9 * p, 0.28, amp.gain, T, null);
      const sh = v.gain(0.04 * p, v.out);
      v.noise('white', T, null, v.filter('highpass', 8000, 0.7, sh));
      return {
        pitch(q, now) {
          const k = 0.04;
          o1.frequency.setTargetAtTime(base * q, now, k); o2.frequency.setTargetAtTime(base * 2.005 * q, now, k);
          o3.frequency.setTargetAtTime(base * 3.98 * q, now, k); bp.frequency.setTargetAtTime(Math.min(base * 5 * q * q, 14000), now, k);
          trem.osc.frequency.setTargetAtTime(9 * q * q, now, k); sh.gain.setTargetAtTime(0.04 * q * q, now, k);
        },
      };
    },
  };
  // 【蓄满提示音】一记明亮钢鸣:用非谐泛音比 ×1/2.76/5.4/8.93(仿钟体)叠出一声"叮",前面加一段高频刮擦。
  //   蓄力条满时播一次，告诉玩家可以放重斩。
  // fully charged: a bright steel "shiing" (inharmonic bell partials + a scrape)
  SFX.blade_ready = {
    gain: 0.26, max: 2, jitter: 0, reverb: 0.22,
    build(v, p) {
      v.nz({ f: 5200 * p, f1: 8200 * p, sw: 0.12, q: 3, a: 0.004, d: 0.14, peak: 0.3 });                   // scrape
      for (const [r, a, d] of [[1, 0.5, 0.8], [2.76, 0.24, 0.5], [5.4, 0.12, 0.3], [8.93, 0.05, 0.18]]) v.tone({ t: 0.02, f: 1318 * p * r, a: 0.001, d, peak: a });
      v.tone({ t: 0.07, f: 1976 * p, a: 0.001, d: 0.5, peak: 0.22 });
    },
  };
  // 【重斩音】一次厚重过顶劈:低频粉噪经带通做 300→2600→520Hz 的重扫(风声),叠 150→48Hz 的下坠闷击,
  //   880Hz 钟音泛音 + 900→2600Hz 上行噪声(墨波撕裂感)与一组气泡"咕"。"fwoom"。
  // charged overhead cut: a heavy low whoosh, the steel ring, the ink wave tearing loose ("fwoom")
  SFX.blade_heavy = {
    gain: 0.62, max: 3, jitter: 0.03, reverb: 0.16,
    build(v, p) {
      const T = v.t, g = v.gain(0, v.out), bp = v.filter('bandpass', 400 * p, 1.2, g);
      bp.frequency.setValueAtTime(300 * p, T); bp.frequency.exponentialRampToValueAtTime(2600 * p, T + 0.08); bp.frequency.exponentialRampToValueAtTime(520 * p, T + 0.3);
      pts(g.gain, T, [[0, 0], [0.06, 1], [0.14, 0.6], [0.32, 0]]);
      v.noise('pink', T, T + 0.33, bp);
      v.tone({ t: 0.05, f: 150 * p, f1: 48 * p, sw: 0.22, a: 0.002, d: 0.3, peak: 0.95 });                 // thump
      v.nz({ t: 0.05, kind: 'pink', ft: 'lowpass', f: 1800, f1: 260, sw: 0.3, q: 1.2, a: 0.003, d: 0.32, peak: 0.7 });
      for (const [r, a] of [[1, 0.16], [2.76, 0.08], [5.4, 0.04]]) v.tone({ t: 0.04, f: 880 * p * r, a: 0.002, d: 0.45, peak: a });   // ring
      v.nz({ t: 0.07, f: 900 * p, f1: 2600 * p, sw: 0.3, q: 1.3, a: 0.05, d: 0.35, peak: 0.35 });          // wave rushing off
      for (let i = 0; i < 5; i++) v.bub(T + 0.09 + v.r(0, 0.2), v.r(500, 1300) * p, 0.14, v.r(0.02, 0.04), 1.8);
      v.nz({ t: 0.08, ft: 'highpass', f: 3800, a: 0.02, d: 0.4, peak: 0.2 });
    },
  };
  // 【命中音】刀刃落身:210→70Hz 的肉质"噗" + 1300→420Hz 的敲击 + 1650Hz 三泛音短"哐" + 粉噪墨溅;
  //   重斩命中传入 p<1 使整体更低沉。
  // the blade landing on a body: a meaty thwack + a short clang + an ink splat (pitch < 1 for a charged cut)
  SFX.blade_hit = {
    gain: 0.62, max: 4, jitter: 0.05, reverb: 0.1, minGap: 0.04,
    build(v, p) {
      v.tone({ f: 210 * p, f1: 70 * p, sw: 0.09, a: 0.001, d: 0.14, peak: 1 });                             // thwack
      v.nz({ f: 1300 * p, f1: 420 * p, sw: 0.06, q: 2.2, a: 0.0006, d: 0.06, peak: 0.9 });                  // knock
      for (const [r, a, d] of [[1, 0.2, 0.22], [2.4, 0.12, 0.15], [4.1, 0.07, 0.1]]) v.tone({ t: 0.003, f: 1650 * p * r, a: 0.0008, d, peak: a });   // clang
      v.nz({ t: 0.012, kind: 'pink', f: 1700 * p, f1: 380 * p, sw: 0.18, q: 3.5, a: 0.003, d: 0.2, peak: 0.7 });   // splat
      for (let i = 0; i < 3; i++) v.bub(v.t + 0.02 + v.r(0, 0.09), v.r(500, 1100) * p, 0.16, v.r(0.02, 0.035), 1.7);
    },
  };
}

// 【图标】HUD / 装配界面用的内联 SVG(ui-icons.js 同款画法:墨色描边 + 深/浅塑料 + currentColor 队伍墨)。
// ------------------------------------------------------------------------------------------ icon (ui-icons.js style)
const K = '#15121c', DK = '#2b2735', LT = '#e4e8ef';
// 盐水弯刀图标:刀身用 LT(浅塑料)与 currentColor(队伍墨)分层,刀柄墨色描边;ui-icons.js 里的 .iw-ico 一并生效。
export const BLADE_ICON = `<svg class="iw-ico " viewBox="0 0 64 64" aria-hidden="true">
    <path d="M29.5 49 Q26.5 62 10.5 59.5" fill="none" stroke="${K}" stroke-width="8" stroke-linecap="round"/>
    <path d="M29.5 49 Q26.5 62 10.5 59.5" fill="none" stroke="${DK}" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M21.5 43.5 L10.5 54.5" stroke="${K}" stroke-width="11" stroke-linecap="round"/>
    <path d="M21.5 43.5 L10.5 54.5" stroke="${DK}" stroke-width="6.2" stroke-linecap="round"/>
    <path d="M18.6 47.4 L16.6 45.4 M15.6 50.4 L13.6 48.4" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M19.5 36.5 Q36 25.5 51.5 8 L60 3 Q59.5 12 55 16.5 Q46 32.5 28.5 45.5 Z" fill="${LT}"/>
    <path d="M28.5 45.5 Q46 32.5 55 16.5 Q59.5 12 60 3 Q56.5 10 52 13 Q43.5 29 25.3 42.3 Z" fill="currentColor"/>
    <path d="M19.5 36.5 Q36 25.5 51.5 8 L60 3 Q59.5 12 55 16.5 Q46 32.5 28.5 45.5 Z" fill="none" stroke="${K}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 36.8 Q37.5 28 48.5 14" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="23" cy="42.5" rx="11.5" ry="5.2" transform="rotate(48 23 42.5)" fill="${LT}" stroke="${K}" stroke-width="3"/>
    <ellipse cx="23" cy="42.5" rx="6.4" ry="2.4" transform="rotate(48 23 42.5)" fill="currentColor"/>
    <circle cx="8.6" cy="57" r="5" fill="${LT}" stroke="${K}" stroke-width="3"/>
    <circle cx="7.3" cy="55.7" r="1.6" fill="#fff" fill-opacity=".8"/>
  </svg>`;
