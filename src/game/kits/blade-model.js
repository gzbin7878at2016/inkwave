// ============================================================================
// 【中文导读】盐水弯刀的**模型/材质/动画侧**——程序化生成的刀身、随蓄力点亮的墨刃、以及每帧动画。
// 【模块定位】本三件套之一,由 blade.js(行为侧)在模块顶层注册(registerWeaponModel('blade', …));
//   blade.js 负责挥砍/命中逻辑,本文件负责"长什么样、怎么动":
//     · blade-model.js(本文件)—— buildBlade() 造网格、makeEdgeMaterial/makeAuraMaterial 造墨刃与光晕、
//       animateBlade() 每帧按蓄力状态驱动它们;
//     · blade-fx.js —— 挥砍弧光/墨波特效、音效、图标;
//     · blade.js —— 状态机、命中判定、以及调 FX。
// 【核心机制】刀身用"站位放样(loft)"生成:沿刀长取 44 个站位,每站给出刃体/刃口/血槽三组环点再缝成面。
//   墨刃(edge)是独立 mesh,带逐顶点 aSeg(0=护手 → 1=刀尖),用于让蓄力光"从柄流向尖":
//   通过 onBeforeCompile 往 MeshStandardMaterial 里注入 GLSL,按 uCharge/uFull/uFlash 塑形发光。
//   光晕(aura)是刀身沿法线微胀的加法混合网格,蓄力时有光带扫过。
// 【关键约定】武器空间:原点=握把中心,+Z 沿刀身(柄→尖),+Y=刀背侧,−Y=刃口侧,±X=刀面;
//   尺度单位米。刀身几何一次性烘焙,运行期只写 uniform 与矩阵。
// 【配套阅读】blade.js(调用方)、blade-fx.js、../character-weapons.js(武器空间契约 + animateWeapon 的 st)、
//   ../character-geo.js(GEO_KIT:lathe/sweep/superEllipsoid 等程序化原语)。
// ============================================================================
// Brine Cutlass — procedural model + part animation (registered from kits/blade.js).
// Weapon space (character-weapons.js contract): grip centre at the origin, +Z = along the blade (hilt → tip), +Y = the
// spine side (the wrist lies that way), −Y = the cutting edge, ±X = the flats. The kid's fist wraps the rubber grip
// (z −0.06 … 0.06); a cream bowl guard with a dark knuckle bow sweeps round the fingers to a squid-head pommel.
// The blade is lofted from stations along its length: a curved sabre blade that flares a little before a clipped
// point, a satin-steel body with a team-ink fuller on each flat and a bevelled INK EDGE. The edge is its own mesh with a
// per-vertex aSeg (0 at the guard → 1 at the tip) and its own material: team ink at rest, filling with light from the
// hilt to the tip as a swing charges, shimmering at full charge and flashing white on the release. A thin additive
// aura (the blade inflated) shimmers over the steel while charging.
import * as THREE from 'three';
import { GEO_KIT } from '../character-weapons.js';
import { superEllipsoid, lathe, smoothProfile, sweep } from '../character-geo.js';

const { Parts, C, M, latheZ, torus, at, orient, screw, decal, placeXY, squidShape, rng } = GEO_KIT;
const V3 = THREE.Vector3;

// 【刀身布局常量】z0/z1 = 刀根/刀尖沿 +Z 的位置,bow = 刀尖朝刀背抬起的弯度(仿军刀),gripR = 握把半径。
// ---- blade layout (metres, weapon space)
export const BLADE = {
  z0: 0.092,          // blade root (just past the guard)
  z1: 0.735,          // tip
  bow: 0.05,          // tip lift toward the spine (sabre curve)
  gripR: 0.0138,
};
const L = BLADE.z1 - BLADE.z0;
// 中线高度(u=0 刀根 → 1 刀尖):军刀的弧线上翘,朝刀背侧弯曲。
// centreline height at blade fraction u (0 root → 1 tip): the sabre curve rises toward the spine side
const yc = (u) => BLADE.bow * u * u;
// 半宽(刀背到刃口距的一半)随刀长变化:根部 ~54mm 宽,中段收腰(正弦低谷),临近刀尖又外扩(高斯凸起)。
// half-width (spine → edge distance / 2) along the blade: 54 mm wide at the root, a waist, a flare toward the point
const halfW = (u) => 0.0272 - 0.0042 * Math.sin(Math.PI * Math.min(1, u / 0.7)) + 0.0052 * Math.exp(-(((u - 0.8) / 0.09) ** 2));
// 刀背厚度(跨 X 全厚)随刀长线性收薄:根 11.2mm → 尖 6.4mm。
// spine thickness (full, across X) along the blade
const spineT = (u) => 0.0112 - 0.0048 * u;
// 给定 u 返回 [刀背高, 刃口高] 两个 Y 值,并实现"假刃收尖":u>0.8 后刀背下沉、刃口上扬,在刀尖处的 tipY 相汇。
// spine / edge heights at u, with the clipped point: past 0.8 the spine drops (false edge) and the edge rises to meet it
function span(u) {
  const c = yc(u), h = halfW(u);
  let ys = c + h, ye = c - h;
  const tipY = yc(1) + 0.006;
  if (u > 0.8) {
    const s = (u - 0.8) / 0.2;
    ys = ys + (tipY - ys) * Math.pow(s, 1.7);
    ye = ye + (tipY - ye) * Math.pow(s, 1.15);
  }
  return [ys, ye];
}
const BEVEL = 0.36;   // share of the width (from the edge) that is the ink bevel

// 【放样刀身】手写顶点环,而非 three 的现成几何——为的是在折缝处放重复顶点、配合手写法线,保住刀背/刃口的硬高光。
// ------------------------------------------------------------------------------------------ lofted blade
// Station rings. Body ring (one side, spine → bevel line): spine crown, spine shoulder, flat top, flat bottom (bevel
// line). Edge ring (one side): bevel line → edge apex. Both mirrored across X; separate vertices at the creases so the
// bevel and the spine keep crisp highlights.
function bladeGeos() {
  const N = 44;
  const body = { pos: [], nor: [], idx: [] }, edge = { pos: [], nor: [], idx: [], seg: [] }, fuller = { pos: [], nor: [], idx: [] };
  // 【站位分布】基本均匀,但用三次项把站位往刀尖(尖点成形处)挤密一点,免得尖端面过疏。
  // stations: roughly uniform, a touch denser toward the tip where the point forms
  const us = [];
  for (let i = 0; i <= N; i++) us.push(Math.min(1, (i / N) * 0.93 + 0.07 * Math.pow(i / N, 3)));
  const Z = (u) => BLADE.z0 + u * L;
  // ---- body: per station, 2 × 4 points (right side then left side)
  const bodyRing = (u) => {
    const [ys, ye] = span(u), w = ys - ye, yb = ye + w * BEVEL, T = spineT(u) * (u > 0.97 ? (1 - u) / 0.03 * 0.9 + 0.1 : 1);
    const pts = [];
    for (const sx of [1, -1]) {
      pts.push([sx * T * 0.18, ys, 0, 1]);                       // crown (normal up)
      pts.push([sx * T * 0.5, ys - Math.min(0.0035, w * 0.08), sx, 0.35]);  // shoulder
      pts.push([sx * T * 0.5, ys - Math.min(0.006, w * 0.14), sx, 0]);     // flat top
      pts.push([sx * T * 0.4, yb, sx, 0.08]);                    // flat bottom = bevel line
    }
    return pts;
  };
  const R = 8;
  for (let i = 0; i <= N; i++) {
    const u = us[i], z = Z(u);
    for (const p of bodyRing(u)) { body.pos.push(p[0], p[1], z); const n = new V3(p[2], p[3], 0).normalize(); body.nor.push(n.x, n.y, n.z); }
    if (i < N) {
      const a = i * R, b = (i + 1) * R;
      for (const [k0, k1] of [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [0, 4]]) {
        const flip = k0 >= 4 || (k0 === 0 && k1 === 4);
        if (!flip) body.idx.push(a + k0, b + k0, a + k1, a + k1, b + k0, b + k1);
        else body.idx.push(a + k0, a + k1, b + k0, a + k1, b + k1, b + k0);
      }
    }
  }
  // spine crown seam between the two crown points faces up (+Y) — the [0,4] quad above; tip: collapse is implicit
  // ---- edge bevel (both sides): bevel line → apex, 3 points per side (bevel, mid, apex)
  const E = 6;
  for (let i = 0; i <= N; i++) {
    const u = us[i], z = Z(u), [ys, ye] = span(u), w = ys - ye, yb = ye + w * BEVEL;
    const T = spineT(u) * (u > 0.97 ? (1 - u) / 0.03 * 0.9 + 0.1 : 1);
    for (const sx of [1, -1]) {
      const pts = [[sx * T * 0.4, yb], [sx * T * 0.24, yb - (yb - ye) * 0.5], [sx * 0.00045, ye]];
      // bevel face normal: outward + down (the bevel faces the edge side)
      const nx = sx * (yb - ye), ny = -(T * 0.4);
      const n = new V3(nx, ny, 0).normalize();
      for (const [x, y] of pts) { edge.pos.push(x, y, z); edge.nor.push(n.x, n.y, n.z); edge.seg.push(u); }
    }
    if (i < N) {
      const a = i * E, b = (i + 1) * E;
      for (const [k0, k1] of [[0, 1], [1, 2]]) edge.idx.push(a + k0, b + k0, a + k1, a + k1, b + k0, b + k1);
      for (const [k0, k1] of [[3, 4], [4, 5]]) edge.idx.push(a + k0, a + k1, b + k0, a + k1, b + k1, b + k0);
    }
  }
  // ---- fuller: a team-ink groove stripe on each flat, root → 0.72, just above the flats
  const NF = 30;
  for (let i = 0; i <= NF; i++) {
    const u = 0.035 + (i / NF) * 0.66, z = Z(u), [ys, ye] = span(u), w = ys - ye;
    const T = spineT(u), yTop = ys - w * 0.2, yBot = ys - w * 0.36;
    const taper = Math.min(1, (0.7 - u) / 0.1, (u - 0.035) / 0.04 + 0.2);
    const mid = (yTop + yBot) / 2, hh = (yTop - yBot) / 2 * Math.max(0.15, taper);
    for (const sx of [1, -1]) {
      const x = sx * (T * 0.5 + 0.0004);
      fuller.pos.push(x, mid + hh, z, x + sx * 0.0005, mid, z, x, mid - hh, z);
      fuller.nor.push(sx, 0.3, 0, sx, 0, 0, sx, -0.3, 0);
    }
    if (i < NF) {
      const a = i * 6, b = (i + 1) * 6;
      for (const [k0, k1] of [[0, 1], [1, 2]]) fuller.idx.push(a + k0, b + k0, a + k1, a + k1, b + k0, b + k1);
      for (const [k0, k1] of [[3, 4], [4, 5]]) fuller.idx.push(a + k0, a + k1, b + k0, a + k1, b + k1, b + k0);
    }
  }
  // 【几何打包】把某个环数据组转成 BufferGeometry;extra 用来给 edge 附上 aSeg 逐顶点属性;法线用手写值而非 computeVertexNormals。
  const mk = (d, extra) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
    if (extra) g.setAttribute('aSeg', new THREE.Float32BufferAttribute(extra, 1));
    g.setIndex(d.idx);
    return g;
  };
  // authored normals (crisp creases at the shoulders and the bevel line)
  return { body: mk(body), edge: mk(edge, edge.seg), fuller: mk(fuller) };
}

// 【组装】把刀当一堆程序化零件拼起来:柄头/握把/护碗/护指弓/护手/刀身/贴花;P 是实体部件, I 是用队伍墨的
//   "墨件"(血槽、护手嵌片、墨瓶等)。
// ------------------------------------------------------------------------------------------ build
export function buildBlade() {
  const P = new Parts(), I = new Parts();
  // ---- pommel: cream squid-head knob with a dark collar and a steel cap screw
  P.add(at(superEllipsoid(0.0205, 0.0215, 0.022, 0.8, 0.9, 14, 10, (q) => { if (q.z < 0) { q.x *= 1 + 0.12 * (q.z / 0.022); q.y *= 1 + 0.12 * (q.z / 0.022); } }), 0, 0.001, -0.086), C.cream, M.gloss);
  P.add(at(latheZ([[0.0112, -0.07], [0.0162, -0.069], [0.0172, -0.064], [0.0162, -0.059], [0.0112, -0.058]], 14), 0, 0, 0), C.dark, M.gloss);
  P.add(orient(lathe([[0, 0], [0.0062, 0], [0.0064, 0.0022], [0.0038, 0.0038], [0, 0.004]], 10), new V3(0, 0, -1), new V3(0, 0.001, -0.1075)), C.metal, M.metal);
  for (const ex of [1, -1]) P.add(at(superEllipsoid(0.0034, 0.0042, 0.002, 1, 1, 8, 6), ex * 0.0105, 0.009, -0.1005), C.dark, M.gloss);   // squid eyes
  // ---- grip: oval rubber wrap with raised spiral cord, two ink-ring ferrules
  const grip = lathe(smoothProfile([[0.0112, -0.058], [0.0132, -0.052], [0.0139, -0.03], [0.0134, 0.0], [0.0139, 0.03], [0.0134, 0.054], [0.0118, 0.06]], 16), 20, (v) => {
    const a = Math.atan2(v.z, v.x), r = Math.hypot(v.x, v.z);
    if (r > 0.011) { const k = 1 + 0.07 * Math.max(0, Math.cos(a * 2 - v.y * 170)) ** 3; v.x *= k * 0.92; v.z *= k * 1.06; }
  });
  grip.rotateX(Math.PI / 2); P.add(grip, C.rubber, M.rubber);
  I.add(at(torus(0.0128, 0.0021, 5, 16), 0, 0, -0.056));
  P.add(latheZ([[0.0118, 0.058], [0.0158, 0.06], [0.0166, 0.068], [0.0158, 0.076], [0.0118, 0.078]], 16), C.metal, M.metal);
  I.add(at(torus(0.0162, 0.0018, 5, 16), 0, 0, 0.068));
  // ---- bowl guard: a dished cream shell (its hollow toward the hand), dark rim, team-ink inset on the blade face
  const shell = superEllipsoid(0.036, 0.052, 0.013, 0.55, 0.62, 18, 10, (q) => {
    q.z += 0.012 * (1 - (q.x / 0.036) ** 2 - (q.y / 0.052) ** 2 * 0.6);   // dished: centre forward, rim back
    q.y -= 0.01;                                                            // hangs toward the edge (knuckle) side
  });
  P.add(at(shell, 0, 0, 0.078), C.cream, M.gloss);
  P.add(torus(0.0355, 0.0034, 5, 32).scale(1, 1.45, 1).translate(0, -0.01, 0.078), C.dark, M.satin);
  I.add(at(superEllipsoid(0.021, 0.03, 0.0035, 0.6, 0.7, 14, 6), 0, -0.012, 0.1005));
  for (const [x, y] of [[0.022, -0.036], [-0.022, -0.036], [0.024, 0.014], [-0.024, 0.014]]) screw(P, new V3(x, y, 0.0955), new V3(0, 0, 1), 0.0026);
  // ---- knuckle bow: from the guard's edge side round the fingers to the pommel collar (dark, flattened ribbon)
  const bow = sweep([new V3(0, -0.052, 0.074), new V3(0, -0.066, 0.04), new V3(0, -0.068, -0.005), new V3(0, -0.058, -0.045), new V3(0, -0.034, -0.068), new V3(0, -0.012, -0.07)], {
    seg: 22, radial: 7, capSteps: 2, radius: (t) => 0.0056 - 0.0012 * t, flat: 1.9, outward: (Pp, o) => o.set(1, 0, 0),
  });
  P.add(bow.geo, C.dark, M.satin);
  // back quillon: a short steel curl on the spine side
  const quil = sweep([new V3(0, 0.03, 0.079), new V3(0, 0.05, 0.082), new V3(0, 0.063, 0.074), new V3(0, 0.066, 0.062), new V3(0, 0.058, 0.056)], {
    seg: 14, radial: 7, capSteps: 2, radius: (t) => 0.0052 - 0.002 * t, flat: 1.35, outward: (Pp, o) => o.set(1, 0, 0),
  });
  P.add(quil.geo, C.gunmetal, M.metal);
  P.add(at(superEllipsoid(0.0058, 0.0058, 0.0058, 1, 1, 8, 6), 0, 0.057, 0.056), C.metal, M.metal);
  // ---- ricasso block + ink vial (a little canister riding the spine, feeding the edge)
  P.add(at(superEllipsoid(0.0082, 0.034, 0.016, 0.45, 0.5, 8, 8), 0, -0.002, 0.1), C.gunmetal, M.metal);
  I.add(at(superEllipsoid(0.0064, 0.0064, 0.026, 0.8, 0.9, 10, 8), 0, 0.0385, 0.118));
  for (const z of [0.094, 0.142]) P.add(at(superEllipsoid(0.0084, 0.0084, 0.0038, 0.6, 0.7, 10, 5), 0, 0.0385, z), C.dark, M.gloss);
  P.add(at(superEllipsoid(0.0024, 0.0066, 0.024, 0.6, 0.6, 5, 6), 0, 0.032, 0.118), C.dark, M.satin);
  // ---- blade
  const bg = bladeGeos();
  P.add(bg.body, C.metal, M.metal);
  I.add(bg.fuller);
  // squid decal etched on each flat at the root
  for (const sx of [1, -1]) {
    const sq = decal(squidShape(0.018));
    const u = 0.1, [ys, ye] = span(u);
    placeXY(sq, new V3(0, 0, sx), new V3(0, 1, 0), new V3(sx * (spineT(u) * 0.5 + 0.0006), (ys + ye) / 2 - 0.004, BLADE.z0 + u * L + 0.004));
    P.add(sq, C.decal, M.print);
  }
  return {
    kind: 'blade', body: P.build(), ink: I.build(),
    bladeEdge: bg.edge, bladeAura: bg.body,
    muzzle: new V3(0, yc(0.85), BLADE.z0 + 0.85 * L),
    // right fist on the grip, thumb toward the blade; the wrist lies on the spine side, a little toward the pommel
    gripR: { pos: new V3(0, 0, 0), handZ: new V3(0, 0, 1), handY: new V3(0, 1, -0.45) },
    gripL: { pos: new V3(0, 0, -0.04), handZ: new V3(0, 0, 1), handY: new V3(0.4, 1, -0.3) },
    twirl: new V3(0, 0, 0),
  };
}

// 【材质】墨刃与光晕两套材质,都是"随蓄力变化"的自定义着色;墨刃靠 onBeforeCompile 注入标准材质。
// ------------------------------------------------------------------------------------------ materials
// Ink edge: team ink at rest (a faint glow so it reads as liquid ink), the charge fills it with light from the hilt
// to the tip (a hot front at the fill line), full charge ripples toward the tip, the release flashes white-hot.
// 墨刃材质:静息用队伍墨微发光(像液态墨);蓄力时发光从柄(uCharge 推进)流向尖,充满后有波动、释放瞬间爆白。
// 用 onBeforeCompile 改注入 MeshStandardMaterial,以保留标准光照,只替换自发光项。
function makeEdgeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.16, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 1 });
  const U = { uCharge: { value: 0 }, uFull: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uIdle: { value: 0.22 } };
  m.userData.u = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeg;\nvarying float vSeg;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeg = aSeg;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCharge, uFull, uFlash, uTime, uIdle;\nvarying float vSeg;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float lit = smoothstep(vSeg - 0.06, vSeg + 0.01, uCharge);
          float front = exp(-pow((uCharge - vSeg) * 16.0, 2.0)) * (1.0 - uFull) * step(0.02, uCharge);
          float rip = uFull * (1.2 + 1.3 * pow(0.5 + 0.5 * sin(uTime * 26.0 - vSeg * 22.0), 3.0));
          float I = uIdle + lit * (0.9 + 2.2 * uCharge) + front * (2.5 + 1.0 * sin(uTime * 61.0)) + rip + uFlash * 6.0;
          totalEmissiveRadiance = emissive * I + vec3(uFlash * 2.5 + front * 0.6 + uFull * 0.25);
        }`);
  };
  m.customProgramCacheKey = () => 'iw-blade-edge-1';
  return m;
}
// 光晕材质:刀身沿法线胀大 1.6mm 的加法混合壳,蓄力时有微光带从柄扫向尖,充满时钢面泛光。
// Aura: the blade inflated a hair, additive; a shimmer band sweeps hilt → tip while charging, the steel glows at full
function makeAuraMaterial() {
  const U = { uColor: { value: new THREE.Color() }, uCharge: { value: 0 }, uFull: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 } };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying float vZ; varying vec3 vN; varying vec3 vV;
      void main() {
        vZ = position.z;
        vec4 mv = modelViewMatrix * vec4(position + normal * 0.0016, 1.0);
        vN = normalize(normalMatrix * normal); vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uCharge, uFull, uFlash, uTime;
      varying float vZ; varying vec3 vN; varying vec3 vV;
      void main() {
        float u = clamp((vZ - ${BLADE.z0.toFixed(3)}) / ${L.toFixed(3)}, 0.0, 1.0);
        float band = exp(-pow((fract(uTime * 1.6) * 1.4 - 0.2 - u) * 9.0, 2.0));
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float a = uCharge * (0.12 + 0.55 * band) * step(u, uCharge + 0.04) + uFull * (0.25 + 0.35 * rim + 0.4 * band) + uFlash * 0.9;
        vec3 col = mix(uColor, vec3(1.0), 0.35 + 0.4 * band + 0.5 * uFlash) * a * 1.6;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  m.userData.u = U;
  return m;
}

// 【动画】每帧读蓄力状态驱动墨刃/光晕;首次调用时惰性建 edge/aura 两个 mesh 挂进 w.off,并做近/远 LOD 切换。
// ------------------------------------------------------------------------------------------ animate
// st: see character-weapons.js animateWeapon. Charge comes from the runner's kit state (kits/blade.js) when there is a
// runner, else st.charge (labs / lockers). The release flash: runner.kit.flash (set on a charged slash).
// 指数阻尼插值:朝目标 b 收敛,速率 l(越大越快);帧率无关(用 1-exp 而非线性)。
const dampE = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
// 逐帧驱动刀身特效:w 是武器实例,st 是 animateWeapon 传入的姿态/状态(见 character-weapons.js)。
export function animateBlade(w, st) {
  const d = w.def, dt = Math.min(0.1, Math.max(0, st.dt || 0));
  if (!w.bl) {
    const em = makeEdgeMaterial(), am = makeAuraMaterial();
    const edge = new THREE.Mesh(d.bladeEdge, em); edge.castShadow = false;
    const aura = new THREE.Mesh(d.bladeAura, am); aura.renderOrder = 3; aura.visible = false; aura.frustumCulled = false;
    w.off.add(edge, aura);
    w.bl = { edge, aura, em, am, charge: 0, flash: 0, full: 0, near: true };
  }
  const B = w.bl, R = st.runner, K = R && R.kit;
  // 【LOD】与内置武器一致:远处只显示低模刀身(bodyFar/inkFar),但墨刃始终保留——蓄力中的刀是任何距离都要能看懂的"预告"。
  // LOD like the built-ins (the edge stays: a charging blade is a tell at any range)
  const near = st.near !== false;
  if (near !== B.near) {
    B.near = near;
    if (w.body) w.body.visible = near; if (w.ink) w.ink.visible = near;
    if (w.bodyFar) w.bodyFar.visible = !near; if (w.inkFar) w.inkFar.visible = !near;
  }
  let ch = K ? K.charge || 0 : (st.charge || 0);
  if (K && K.flashT != null && K.flashT < 0.02) B.flash = 1;
  if (!K && st.chargeFlash > 0.9) B.flash = 1;
  B.flash = Math.max(0, B.flash - dt * 3.2);
  // 【充能阻尼】上升(30)远快于回落(9):蓄力要跟手,泄力则留一点余韵不突兀。
  B.charge = dampE(B.charge, ch, ch > B.charge ? 30 : 9, dt);
  const full = ch >= 0.999 ? 1 : 0;
  // 【满充辉光】到 0.999 即视为充满,同样升快(18)降慢(10),让"叮"的一下更利落。
  B.full = dampE(B.full, full, full ? 18 : 10, dt);
  const eu = B.em.userData.u;
  B.em.color.copy(st.color); B.em.emissive.copy(st.color);
  eu.uCharge.value = B.charge; eu.uFull.value = B.full; eu.uFlash.value = B.flash; eu.uTime.value = st.t;
  const au = B.am.userData.u;
  const on = B.charge > 0.01 || B.full > 0.01 || B.flash > 0.01;
  B.aura.visible = on && near;
  if (on) { au.uColor.value.copy(st.color); au.uCharge.value = B.charge; au.uFull.value = B.full; au.uFlash.value = B.flash; au.uTime.value = st.t; }
}
