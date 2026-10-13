// ============================================================================
// 【中文导读】触手发 + 鱿鱼形态的"几何内核" —— 解析曲面 S(t, θ)
// ----------------------------------------------------------------------------
// 【模块定位】被 character-geo.js 调用(buildStrand / buildHair / buildSquid),是生成触手
//   与鱿鱼几何的数学底座。本文件不持有角色状态、不每帧运行 —— 只在构建 / 换档(getHairStyle
//   缓存未命中)时执行。character.js 经 character-geo.js 间接使用它。
// 【核心机制】一根触手 = 一条解析曲面 S(t, θ):以向心(centripetal)Catmull-Rom 脊线为骨
//   (弧长参数 t ∈ [0,1]),携带平行传输(parallel transport)坐标架(O = "顶",背离头皮;
//   B = 横),截面可锥化 / 压扁 / 扭转。管体、建模吸盘、圆头全部从同一 S(t, θ) 生成,故吸盘
//   能"共形"贴到皮肤上(不悬空、不陷入),且每个顶点都知道自己的脊参数 t(→ 沿发丝蒙皮)与
//   局部半厚(→ 半透明 shader)。
// 【关键约定】hairDetail(lod, quality) 给出各档的 ring / radial / cup 分辨率('hero'|'game'|'far'
//   × 设置画质 'low'…'ultra'),但骨骼静置位置永不随细节变化(rig 只增不改契约)。far 档按
//   ~1.8k 三角就地生成,不再被 character-lod.js 的聚类器二次减面。
// 【配套阅读】docs/ASSETS-CHARACTER.zh-CN.md(几何 / 权重管线)、docs/RIG.zh-CN.md(发丝骨
//   hair{s}_0..2 与 hairTip 契约)、src/game/character-geo.js(getHairStyle / buildStrand /
//   buildSquid 的真实调用点)。
// ============================================================================
// INKWAVE — tentacle hair + squid-form geometry kernel (used by character-geo.js: buildStrand / buildHair / buildSquid).
//
// A tentacle is an analytic surface S(t, θ): a centripetal Catmull-Rom spine (arc-length t ∈ [0, 1]) carrying a
// parallel-transported frame (O = "top", away from the scalp; B = across) and a tapered, flattened, twisted cross-section.
// Everything that sits on a tentacle (the tube itself, modelled suction cups, the rounded tip) is generated from the same
// S(t, θ), so cups are stamped conformally onto the skin (never floating, never sunk) and every vertex knows its spine
// parameter t (→ skin weights along the strand) and its local half-thickness (→ the translucency shader).
//
// Detail: hairDetail(lod, quality) → ring / radial / cup resolution for the LOD tiers ('hero' | 'game' | 'far')
// scaled by the settings quality ('low' | 'medium' | 'high' | 'ultra'). Bone rest positions never depend on detail.
import * as THREE from 'three';
import { G } from '../core/ctx.js';

const V3 = THREE.Vector3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const even = (n) => Math.max(4, 2 * Math.round(n / 2));

// 【细节阶梯】按 LOD 档 × 设置画质给出分辨率;far 档为省三角用极简参数,hero 档最高。
// ------------------------------------------------------------------------------------------------
// Detail ladder
// ------------------------------------------------------------------------------------------------
const QK = { low: 0.6, medium: 0.8, high: 1, ultra: 1.25 };
/** Current settings quality (defaults to 'high' outside the game, e.g. in the labs). */
// 【当前画质】读 G.settings.quality;在游戏外(labs 等)缺省 'high'。返回值保证是 QK 里存在的键。
export function hairQuality() { const q = G.settings?.quality; return QK[q] ? q : 'high'; }
export const HAIR_LOD_NAMES = ['hero', 'game', 'far'];
/**
 * Resolution of the tentacle hair / squid for a LOD tier × settings quality.
 *  ringsPerM: spine rings per metre (curvature-adaptive), radial: vertices round the section, tipSteps: rounded-tip rings,
 *  cups: modelled suction cups ({ radial, prof, gap } — gap scales the spacing) or null (the shader prints them),
 *  cap: scalp-cap grid (around × rows), brow: brow stroke rings × radial.
 */
// 【分辨率查询】返回触手发 / 鱿鱼在"LOD 档 × 画质"下的分辨率。
// 【far 档】仅几十像素高,按 far 发丝目标(~1.8k 三角)就地生成,直接被采用(不再被聚类)。
// 【game 档】比赛内距离(头高约 60–120px):ultra 以下吸盘交给 shader 印(建模的 2–4px 只会闪烁),
//   截面仍足够圆以维持干净剪影。
// 【hero 档】最高分辨率:建模吸盘 hi 剖面、加密脊环、scalp cap 与眉笔都最细。
export function hairDetail(lod = 'hero', quality = hairQuality()) {
  const k = QK[quality] ?? 1;
  // far: a few dozen px tall — sized under the far hair target (~1.8k tris) so it is used as-is (never re-clustered)
  if (lod === 'far') return { lod, k, ringsPerM: 24, radial: 6, tipSteps: 2, cups: null, locks: false, cap: [24, 5], brow: [4, 4], squid: { around: 24, rows: 16, arm: [8, 6] } };
  if (lod === 'game') {
    // in-match distance (a head is ~60–120 px tall): cups are printed by the shader below ultra (modelled ones would
    // only shimmer at 2–4 px), sections stay round enough for clean silhouettes
    return {
      lod, k, ringsPerM: Math.round(60 * k), radial: even(10 * k), tipSteps: 3,
      cups: k > 1 ? { radial: 6, prof: 'lo', gap: 1.5 } : null,
      cap: [Math.round(56 * k), Math.round(10 * k)], brow: [10, 6],
      squid: { around: Math.round(48 * k), rows: Math.round(34 * k), arm: [Math.round(18 * k), even(9 * k)], cups: k > 1 ? { radial: 6, prof: 'lo', gap: 1.4 } : null },
    };
  }
  return {
    lod, k, ringsPerM: Math.round(120 * k), radial: even(16 * k), tipSteps: 5,
    cups: k >= 0.8 ? { radial: Math.max(6, Math.round(7 * k)), prof: 'hi', gap: 1.12 } : { radial: 6, prof: 'lo', gap: 1.3 },
    cap: [Math.round(96 * k), Math.round(18 * k)], brow: [18, 10],
    squid: { around: Math.round(72 * k), rows: Math.round(48 * k), arm: [Math.round(28 * k), even(12 * k)], cups: { radial: Math.max(6, Math.round(7 * k)), prof: 'lo', gap: 1.6 } },
  };
}

// 【触手曲面】预采样脊线为 N+1 个点/切线/坐标架,供 frame() 插值。_a.._e 是模块级临时 Vector3
// (构建期单线程使用,复用避免每次分配 —— 本文件所有几何函数都只在这些共享临时量上工作)。
// ------------------------------------------------------------------------------------------------
// Tentacle surface
// ------------------------------------------------------------------------------------------------
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3();

/**
 * o.radius(t) half-width · o.flat(t) thickness ratio · o.twist(t) rad · o.section(c, s, t) → [c', s'] unit-section reshape
 * o.outward(P, out, t) "top" hint · o.transport: carry the frame (no flips at curled tips), biased toward the hint.
 */
// 【TentacleSurface 类】一根触手的脊线 + 平行传输坐标架。o 可给 radius/flat/twist/section/outward/
// transport/curveType/samples 等回调,决定截面形状与坐标架朝向。构造即预采样,运行期只读。
export class TentacleSurface {
  // 【构造】把控制点变成向心 Catmull-Rom 曲线,采样 N+1 个点与归一化切线,再逐点建立坐标架:
  // 通过 transport(平行传输)避免卷曲尖端处坐标架翻转,同时按 wStep 朝 outward 提示缓慢回正。
  constructor(points, o = {}) {
    this.o = o;
    const curve = this.curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p.clone() : new V3(...p))), false, o.curveType || 'centripetal');
    this.len = curve.getLength();
    const N = this.N = o.samples ?? 240;
    const P = this.P = [], T = this.T = [], O = this.O = [], B = this.B = [];
    for (let i = 0; i <= N; i++) { P.push(curve.getPointAt(i / N)); T.push(curve.getTangentAt(i / N).normalize()); }
    const hint = new V3(), prev = new V3();
    const wStep = (hl) => 1 - Math.pow(1 - 0.22 * hl * hl, 18 / N); // same bias per unit length as the old 18-ring sweep
    // 【坐标架回正权重】hl 是提示向量在切向外的长度(0..1);wStep 把它换算成"每单位长度相同的回正量"
    // (与旧 18 环扫掠一致),故 N 或采样密度改变也不影响外观。
    for (let i = 0; i <= N; i++) {
      const Ti = T[i];
      if (o.outward) o.outward(P[i], hint, i / N); else hint.set(0, 1, 0);
      hint.addScaledVector(Ti, -hint.dot(Ti));
      const hl = hint.length();
      let oi;
      if (i === 0 || !o.transport) {
        if (hl > 1e-6) oi = hint.clone().divideScalar(hl);
        else { oi = new V3(0, 1, 0).addScaledVector(Ti, -Ti.y); if (oi.lengthSq() < 1e-6) oi.set(1, 0, 0).addScaledVector(Ti, -Ti.x); oi.normalize(); }
      } else {
        oi = prev.clone().addScaledVector(Ti, -prev.dot(Ti)).normalize();
        if (hl > 1e-6) oi.lerp(hint.divideScalar(hl), wStep(hl)).normalize();
      }
      prev.copy(oi); O.push(oi); B.push(new V3().crossVectors(Ti, oi).normalize());
    }
  }
  /** Spine frame at t (t outside [0, 1] extrapolates along the end tangents). */
  // 【取架】在弧长参数 t 处插值出位置 P、切向 T、顶向 O、横向 B(t 越界则沿端点切线外推)。
  // 复用调用方传入的 P/T/O/B 输出对象以零分配;写进 out 的是 P。
  frame(t, P, T, O, B) {
    const N = this.N;
    const tc = clamp(t, 0, 1);
    const f = tc * N, i0 = Math.min(N - 1, Math.floor(f)), a = f - i0;
    P.copy(this.P[i0]).lerp(this.P[i0 + 1], a);
    T.copy(this.T[i0]).lerp(this.T[i0 + 1], a).normalize();
    O.copy(this.O[i0]).lerp(this.O[i0 + 1], a); O.addScaledVector(T, -O.dot(T)).normalize();
    B.crossVectors(T, O).normalize();
    if (t !== tc) P.addScaledVector(T, (t - tc) * this.len);
    return P;
  }
  /** Section at t: { r, flat, tw } (profiles are evaluated at the clamped t). */
  // 【截面参数】返回该处 { r(半宽), flat(厚度比), tw(扭转角 rad) };回调按 clamp 后的 t 求值。
  section(t) { const o = this.o, tc = clamp(t, 0, 1); return { r: o.radius(tc), flat: o.flat ? o.flat(tc) : 1, tw: o.twist ? o.twist(tc) : 0 }; }
  /** Local (O, B) offset of ring angle th at t (scale shrinks the section, e.g. for the rounded tip). */
  // 【截面偏移】给定环角 th,返回在 (O, B) 平面内的偏移(以及第三分量=外法向厚度 h,
  // 供半透明与吸盘定位用)。scale 缩放截面(圆头收拢时用)。
  offset(t, th, scale = 1, sec = null) {
    const s0 = sec || this.section(t);
    let c = Math.cos(th), s = Math.sin(th);
    if (this.o.section) [c, s] = this.o.section(c, s, clamp(t, 0, 1));
    const xo = c * s0.r * s0.flat * scale, xb = s * s0.r * scale;
    const ct = Math.cos(s0.tw), st = Math.sin(s0.tw);
    return [xo * ct - xb * st, xo * st + xb * ct, Math.abs(c) * s0.r * s0.flat * scale];
  }
  /** Surface point S(t, th). */
  // 【曲面点】S(t, th) = 脊点 + O·x + B·y + T·shift;写入 out 并返回(out 由调用方复用)。
  point(t, th, out, scale = 1, shift = 0) {
    const P = this.frame(t, _a, _b, _c, _d);
    const [x, y] = this.offset(t, th, scale);
    return out.copy(P).addScaledVector(_c, x).addScaledVector(_d, y).addScaledVector(_b, shift);
  }
  /** Outward unit normal of the surface at (t, th) (finite differences; oriented away from the spine). */
  // 【曲面法线】用有限差分(t、th 各 ±1e-3)叉乘求法线,再按"背离脊线"定向。吸盘贴合皮肤的
  // 关键:法线朝外,吸盘剖面才能沿它压印。注:此处会 new V3(非零分配),仅构建期调用。
  normal(t, th, out) {
    const e = 1e-3;
    const p0 = this.point(t, th, new V3());
    const pt = this.point(t + e, th, new V3()).sub(this.point(t - e, th, new V3()));
    const pa = this.point(t, th + e, new V3()).sub(this.point(t, th - e, new V3()));
    out.crossVectors(pt, pa).normalize();
    this.frame(t, _a, _b, _c, _d);
    if (out.dot(_e.copy(p0).sub(_a)) < 0) out.negate();
    return out;
  }
  /** Curvature-adaptive ring params: n + 1 values on [0, 1], denser in tight curls, at the root and toward the tip. */
  // 【自适应环参数】在 [0,1] 上给出 n+1 个位置,环在弯得急处、根部与靠近尖端处更密。
  // 实现:先按曲率 κ=Δangle/ds 生成密度 ρ(并压低 κ 上限 3.5 防爆),两次箱式模糊去噪(样条曲率噪声大),
  // 再对 ρ 做累积分布并按 k/n 反查插值 → 得到按密度分布、且首尾恰为 0、1 的位置数组。
  ringParams(n, tipBias = 1) {
    const N = this.N, rho = new Float64Array(N);
    const ds = this.len / N;
    for (let i = 0; i < N; i++) {
      const k = Math.acos(clamp(this.T[i].dot(this.T[i + 1]), -1, 1)) / Math.max(ds, 1e-6); // 1/m
      const t = (i + 0.5) / N;
      rho[i] = 1 + clamp(k * 0.03, 0, 3.5) + tipBias * (0.9 * sstep(0.8, 1.0, t) + 0.4 * (1 - sstep(0, 0.08, t)));
    }
    // soften (curvature from a spline is noisy) — two box passes
    for (let pass = 0; pass < 2; pass++) { const c = rho.slice(); for (let i = 0; i < N; i++) rho[i] = (c[Math.max(0, i - 2)] + c[Math.max(0, i - 1)] + c[i] + c[Math.min(N - 1, i + 1)] + c[Math.min(N - 1, i + 2)]) / 5; }
    const cum = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) cum[i + 1] = cum[i] + rho[i];
    const out = [0]; let j = 0;
    for (let k = 1; k < n; k++) {
      const target = (k / n) * cum[N];
      while (j < N - 1 && cum[j + 1] < target) j++;
      out.push((j + clamp((target - cum[j]) / Math.max(1e-12, cum[j + 1] - cum[j]), 0, 1)) / N);
    }
    out.push(1);
    return out;
  }
}

// 【管网格】沿 S 生成闭合管体:起点埋入圆帽、末端圆头(tipSteps 环收成一点)。
// ------------------------------------------------------------------------------------------------
// Tube mesh
// ------------------------------------------------------------------------------------------------
// 【建管】每顶点带 t(脊参数)、cs/sn(环角 cos/sin)、thick(该处半厚,米),供蒙皮与半透明 shader 使用。
// 环按 ringParams 自适应分布;起点可埋入(capStart)、末端用 tipLen×半径长的圆头收拢。
/**
 * Closed tube over S with a buried rounded start cap and a rounded tip (tipSteps rings closing on a point).
 * opts: rings (spine rings), radial, tipSteps, startSteps, t0/t1 (build only [t0, t1]), tipLen (tip cap length / r).
 * Per vertex: t (spine param), cs/sn (ring angle), thick (half-thickness through the section there, metres).
 */
export function tentacleTube(S, opts = {}) {
  const radial = opts.radial ?? 16;
  const t0 = opts.t0 ?? 0, t1 = opts.t1 ?? 1;
  const ts = S.ringParams(Math.max(4, opts.rings ?? 32), opts.tipBias ?? 1).map((u) => t0 + u * (t1 - t0));
  const pos = [], tt = [], cs = [], sn = [], th = [], idx = [];
  const P = new V3(), T = new V3(), O = new V3(), B = new V3();
  const ring = (t, scale, shift) => {
    S.frame(t, P, T, O, B);
    const sec = S.section(t);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * TAU;
      const [x, y, h] = S.offset(t, a, scale, sec);
      pos.push(P.x + O.x * x + B.x * y + T.x * shift, P.y + O.y * x + B.y * y + T.y * shift, P.z + O.z * x + B.z * y + T.z * shift);
      tt.push(t); cs.push(Math.cos(a)); sn.push(Math.sin(a)); th.push(Math.max(h, 0.18 * sec.r * sec.flat * scale));
    }
  };
  const pole = (t, shift) => {
    S.frame(t, P, T, O, B); pos.push(P.x + T.x * shift, P.y + T.y * shift, P.z + T.z * shift);
    const sec = S.section(t);
    tt.push(t); cs.push(shift > 0 ? 1 : -1); sn.push(0); th.push(0.3 * sec.r * sec.flat);
  };
  let rings = 0;
  const startSteps = opts.startSteps ?? 2;
  const hasStart = opts.capStart !== false;
  const r0 = S.section(ts[0]).r;
  if (hasStart) {
    pole(ts[0], -r0 * 0.9);
    for (let j = 1; j < startSteps; j++) { const a = (j / startSteps) * Math.PI * 0.5; ring(ts[0], Math.sin(a), -r0 * 0.9 * Math.cos(a)); rings++; }
  }
  for (const t of ts) { ring(t, 1, 0); rings++; }
  const tipSteps = opts.tipSteps ?? 4;
  const r1 = S.section(ts[ts.length - 1]).r, tipLen = (opts.tipLen ?? 1.05) * r1;
  for (let j = 1; j < tipSteps; j++) { const a = (j / tipSteps) * Math.PI * 0.5; ring(ts[ts.length - 1], Math.cos(a), tipLen * Math.sin(a)); rings++; }
  pole(ts[ts.length - 1], tipLen);
  const base = (r) => (hasStart ? 1 : 0) + r * radial;
  for (let r = 0; r < rings - 1; r++) {
    const a0 = base(r), a1 = base(r + 1);
    for (let k = 0; k < radial; k++) { const k1 = (k + 1) % radial; idx.push(a0 + k, a1 + k1, a1 + k, a0 + k, a0 + k1, a1 + k1); }
  }
  if (hasStart) for (let k = 0; k < radial; k++) idx.push(0, 1 + ((k + 1) % radial), 1 + k);
  const tip = pos.length / 3 - 1, last = base(rings - 1);
  for (let k = 0; k < radial; k++) idx.push(last + k, last + ((k + 1) % radial), tip);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, t: new Float32Array(tt), cs: new Float32Array(cs), sn: new Float32Array(sn), thick: new Float32Array(th), rings: ts };
}

// 【吸盘】沿底面按两行交错排布的小环状杯:每条剖面点都沿 S 的法线偏置,故共形贴合皮肤。
// ------------------------------------------------------------------------------------------------
// Suction cups: small ringed cups stamped onto S in two staggered rows along the underside
// ------------------------------------------------------------------------------------------------
// 【杯剖面】[半径/R, 高/h] 从埋入的脚(融进皮肤)→ 裙边 → 卷起的边缘 → 盘 → 中心。
// hi 用 7 点、lo 用 5 点;rimK 指向"卷边顶点"(高度≥0.99 的第一个剖面项)。
// cup profile: [radius / R, height / h] from the buried foot (fillet into the skin) → skirt → rolled rim → dish → centre
const CUP_PROF = {
  hi: [[1.22, -0.1], [0.98, 0.36], [0.84, 0.94], [0.68, 1.0], [0.55, 0.72], [0.34, 0.3], [0.0, 0.16]],
  lo: [[1.18, -0.1], [0.92, 0.7], [0.7, 1.0], [0.52, 0.55], [0.0, 0.2]],
};
// 【压印吸盘】rows 给截面角与相位(相位错开两行),size(t) 给杯半径;沿 S 逐杯把剖面点沿法线偏置生成,
// 返回 { geo, t(每顶点=杯心的脊参数)、ring(0 中心…1 卷边顶…≥1 脚)、list:[{t,th,R}] }。
// 结尾用循环向外的朝向修正:若整体法线朝向脊线内侧则翻面(取决于局部坐标架手性)。
/**
 * opts: rows [{ th, phase }] (section angles; phase 0..1 staggers the row), from/to (t range), size(t) → cup radius R (m),
 * gap (spacing multiplier), radial, prof ('hi' | 'lo'), skip(C, t) → true drops a cup (inside the head / another strand).
 * Returns { geo, t (per vertex: the cup centre's spine param), ring (0 centre … 1 rim top … ≥1 foot), list: [{t, th, R}] }.
 */
export function suctionCups(S, opts) {
  const prof = CUP_PROF[opts.prof || 'hi'];
  const radial = opts.radial ?? 9;
  const gap = opts.gap ?? 1;
  const pos = [], tt = [], rr = [], idx = [], list = [];
  const n = new V3(), et = new V3(), ea = new V3(), C = new V3(), q = new V3(), qn = new V3();
  const eps = 1e-3;
  const rimK = prof.findIndex((p) => p[1] >= 0.99);
  for (const row of opts.rows) {
    let t = opts.from;
    const R0 = opts.size(t);
    t += (row.phase ?? 0) * (R0 * 2.7 * gap) / S.len;
    while (t < opts.to) {
      const R = opts.size(t);
      if (R < 6e-4) break;
      S.point(t, row.th, C);
      if (!(opts.skip && opts.skip(C, t, R))) {
        // local metric: metres per unit t / per radian round the section
        const lt = S.point(t + eps, row.th, new V3()).distanceTo(S.point(t - eps, row.th, new V3())) / (2 * eps);
        const la = S.point(t, row.th + eps, new V3()).distanceTo(S.point(t, row.th - eps, new V3())) / (2 * eps);
        const h = R * (opts.height ?? 0.46);
        const b0 = pos.length / 3;
        const nr = prof.length;
        for (let j = 0; j < nr; j++) {
          const [pr, pz] = prof[j];
          if (pr === 0) {
            S.normal(t, row.th, qn); S.point(t, row.th, q).addScaledVector(qn, pz * h);
            pos.push(q.x, q.y, q.z); tt.push(t); rr.push(0);
            continue;
          }
          for (let k = 0; k < radial; k++) {
            const a = (k / radial) * TAU;
            const dt = (pr * R * Math.cos(a)) / Math.max(lt, 1e-6), da = (pr * R * Math.sin(a)) / Math.max(la, 1e-6);
            S.normal(t + dt, row.th + da, qn);
            S.point(t + dt, row.th + da, q).addScaledVector(qn, pz * h - (j === 0 ? 0.0004 : 0));
            pos.push(q.x, q.y, q.z); tt.push(t); rr.push(j === 0 ? 1.4 : j < rimK ? 1 + 0.4 * (rimK - j) / rimK : pr / prof[rimK][0]);
          }
        }
        // rings j (radial verts) → j+1; the last profile entry is the centre point
        const ringStart = (j) => b0 + j * radial;
        for (let j = 0; j < nr - 2; j++) {
          const a0 = ringStart(j), a1 = ringStart(j + 1);
          for (let k = 0; k < radial; k++) { const k1 = (k + 1) % radial; idx.push(a0 + k, a0 + k1, a1 + k1, a0 + k, a1 + k1, a1 + k); }
        }
        const ctr = b0 + (nr - 1) * radial, lr = ringStart(nr - 2);
        for (let k = 0; k < radial; k++) idx.push(lr + k, lr + ((k + 1) % radial), ctr);
        list.push({ t, th: row.th, R });
      }
      t += (R * 2.7 * gap) / S.len;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // orient: the cup's rim normals must face away from the spine (winding depends on the local frame handedness)
  {
    const N = geo.attributes.normal, Pp = geo.attributes.position; let acc = 0; const sp = new V3(), tmp = new V3(), nn = new V3();
    for (let i = 0; i < Pp.count; i += 7) { S.frame(tt[i], sp, _b, _c, _d); tmp.fromBufferAttribute(Pp, i).sub(sp); nn.fromBufferAttribute(N, i); acc += nn.dot(tmp); }
    if (acc < 0) { const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) { const s = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = s; } geo.computeVertexNormals(); }
  }
  return { geo, t: new Float32Array(tt), ring: new Float32Array(rr), list };
}

// 【卷尖 + 雕琢刘海】在发丝末端追加一段螺旋卷曲,并可由主发丝派生多缕"刘海"(bangs)。
// ------------------------------------------------------------------------------------------------
// Curled tips + sculpted locks
// ------------------------------------------------------------------------------------------------
// 【卷尖】在脊线末端沿 (d, o) 平面卷起一段逐渐收紧的螺旋(约 0.25…0.75 圈),返回新的点表(不改动入参)。
// curl 为卷曲强度(可正负=方向),lift 给一个沿 +Y 的小抬升避免扎进头皮。
/**
 * Roll the end of a spine: extend the last segment and curl it toward `outDir(b)` (away from the head) in a tightening
 * spiral (≈ a quarter to three-quarter turn for curl 0.5 … 1.2). Returns a new point list.
 */
export function curlTip(pts, curl, outDir, lift = 0.35) {
  if (!curl) return pts.map((p) => p.clone());
  const out = pts.map((p) => p.clone());
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const d = b.clone().sub(a).normalize();
  const o = outDir(b).clone(); o.addScaledVector(d, -o.dot(d)).normalize();
  const L = a.distanceTo(b);
  const turn = Math.abs(curl) * 1.9;            // total roll angle (rad)
  const R = L * 0.42 / Math.max(0.5, Math.abs(curl));
  const n = 4;
  const sg = Math.sign(curl) || 1;
  for (let k = 1; k <= n; k++) {
    const u = k / n, ang = turn * u, rk = R * (1 - 0.35 * u);
    // spiral in the (d, o) plane: starts tangent to d, bends toward o
    const x = rk * Math.sin(ang), y = sg * rk * (1 - Math.cos(ang));
    out.push(b.clone().addScaledVector(d, x + L * 0.12 * u).addScaledVector(o, y).add(new V3(0, lift * rk * u * u * Math.abs(curl), 0)));
  }
  return out;
}

// 【雕琢刘海】围绕一根主发丝生成多缕刘海:每缕沿主脊走其长度的 len,横向按 d 张开(尖端处全幅、
// 根部约 35%)、按 h 沿顶向分层,再各自 curlTip 卷曲。返回若干点表(V3 数组)。
/**
 * Sculpted locks around a main strand (bangs): each lock follows the main spine for `len` of its length, fanned sideways
 * by `d` (m, at the lock's tip; ~35 % of it at the root) and layered by `h` (m along the top direction), then curls.
 * S = the main strand's surface (frames), n = samples. Returns an array of point lists (V3).
 */
export function lockSpines(S, locks, outDir, n = 12) {
  const res = [];
  const P = new V3(), T = new V3(), O = new V3(), B = new V3();
  for (const L of locks) {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n, t = u * (L.len ?? 0.8);
      S.frame(t, P, T, O, B);
      const fan = lerp(L.root ?? 0.3, 1, sstep(0.05, 1, u));
      const lay = sstep(0.0, 0.25, u);
      pts.push(P.clone().addScaledVector(B, (L.d || 0) * fan).addScaledVector(O, (L.h || 0) * lay).add(new V3(0, (L.dy || 0) * sstep(0.3, 1, u), 0)));
    }
    res.push(curlTip(pts, L.curl ?? 0.6, outDir));
  }
  return res;
}

// 【烘焙接触遮蔽】为头发烘 AO:计算点到一组遮挡体(头 / 其它发丝)的距离。
// ------------------------------------------------------------------------------------------------
// Baked contact occlusion for the hair: distance of a point to a set of occluders (head / other strands)
// ------------------------------------------------------------------------------------------------
/** Spine samples of a surface (for proximity tests): [{ p, r, h }] every ~1 cm. */
// 【脊线采样】为邻近测试取发丝脊线样本,约每 1cm 一个;每点带位置 p、半径 r、厚 h 及坐标架 O/T、参数 t。
export function spineSamples(S, from = 0, to = 1) {
  const out = []; const P = new V3(), T = new V3(), O = new V3(), B = new V3();
  const n = Math.max(4, Math.ceil((S.len * (to - from)) / 0.008));
  for (let i = 0; i <= n; i++) {
    const t = lerp(from, to, i / n); S.frame(t, P, T, O, B); const s = S.section(t);
    out.push({ p: P.clone(), r: s.r, h: s.r * s.flat, O: O.clone(), T: T.clone(), t });
  }
  return out;
}
