// ============================================================================
// 【中文导读】squidkid 的 LOD 套件 —— 只被 character.js 使用
// ----------------------------------------------------------------------------
// 【模块定位】角色 LOD 的"策略 + 工具"层,无几何数据。character.js 在构建每档网格时调用
//   farGeometry()/ditherMaterial(),在每帧 _updateLod() 里用 pickTier() 选档。本文件
//   自身不持有任何角色状态(唯一的缓存 _farCache 以源几何为键)。
// 【核心机制】三件事:
//   1. 档位策略:按角色"投影屏幕高度(px)"而非世界距离选 hero/game/far,并按画质预设取不同
//      阈值,±12% 迟滞防边界抖动(本地玩家用 heroLocal 更低门槛,因为它是你整局盯着的那个)。
//   2. screen-door 抖动交叉淡化:每 kid 克隆一份材质,注入交错梯度噪声 discard 测试,令两档在
//      ~0.3s 内逐像素交叠且每个像素恰好画一次(无 pop、无双重混合、无排序)。
//   3. bone-aware 聚类减面:把任意 skinned 几何抽成 far 档,聚簇按主导骨拆分,肢体/发丝/手指
//      不跨骨合并 → 关节弯曲时不出"蹼"。
// 【关键约定】KID_H 是屏幕高度估算用的身高(米);FADE_S 是交叉时长(秒);HYST=0.12 是迟滞;
//   uLodFade=(f, side),f∈(0,1] 为淡化进度,side=+1 出档(保留 IGN≥f)/−1 入档(保留 IGN<f),
//   f=0 关闭测试。far 档硬目标三角数(皮肤/衣/发/眼)由 character.js 侧给出。
// 【配套阅读】docs/ASSETS-CHARACTER.zh-CN.md §3(LOD 三档与抖动交叉)、
//   docs/RIG.zh-CN.md(骨架契约,聚类需保持骨分离)。
// ============================================================================
// INKWAVE — squidkid LOD kit (used by character.js only).
//   • tier policy: hero / game / far picked by the kid's projected screen height, per quality setting, with hysteresis
//   • screen-door dither cross-fade: per-kid clones of the body materials that discard complementary pixel sets, so two
//     tiers overlap for ~0.3 s with every pixel drawn exactly once (no pop, no double-blend, no sorting)
//   • bone-aware clustering decimator: builds the 'far' tier from any skinned geometry the builders hand us, keeping
//     limbs / strands / fingers separate (clusters never straddle two dominant bones → no webbing when joints bend)
import * as THREE from 'three';

// 【档位常量】TIERS 是档名数组,下标即档值;T_HERO/T_GAME/T_FAR 为对应的整数档标。
export const TIERS = ['hero', 'game', 'far'];
export const T_HERO = 0, T_GAME = 1, T_FAR = 2;
export const KID_H = 1.32;          // head-top height of the kid (m) for the screen-size estimate
export const FADE_S = 0.3;          // cross-fade duration (s)

// 【画质预设表】按屏幕高度(px)分档:超过 hero → 比赛中用 hero 档(heroLocal 专给本地玩家,
// 门槛更低——你整局盯着的那个角色);低于 far → far 档;menu = 不在比赛中的档位(展示台/换装间/大厅
// 列队)。迟滞 ±12%。(默认 FOV 下本地玩家约占视口 28% 高——900px 视口时约 250px——所以 720p 起
// (约 200px)在高画质下就是 hero 档;广场对面的角色约 40–90px。)
// Screen height (CSS px) of the kid: above `hero` → hero tier in a match (`heroLocal` for the local player — the kid
// you look at all match), below `far` → far tier; `menu` = tier out of a match (showcase pedestal, locker, lobby line-up).
// Hysteresis ±12 %. (Default FOV: the local player stands ≈ 28 % of the viewport tall — 250 px at 900 — so from
// 720p up (≈ 200 px) it is hero at high; a kid across the plaza is ≈ 40–90 px.)
export const LOD_QUALITY = {
  low: { hero: Infinity, heroLocal: Infinity, far: 150, menu: T_GAME },
  medium: { hero: 760, heroLocal: 260, far: 110, menu: T_HERO },
  high: { hero: 430, heroLocal: 150, far: 78, menu: T_HERO },
  ultra: { hero: 300, heroLocal: 110, far: 54, menu: T_HERO },
};
export const HYST = 0.12;
// 【选档·带迟滞】给定屏幕高度 px、当前档 cur、画质行 Q 与 hero 阈值 H,返回新档。
// cur<0 表示尚未选过档(首帧直接按阈值判,不施加迟滞);否则只在越过带迟滞的阈值时才换档,
// 防止在同一高度上反复横跳。升级用 H*up、降级用 Q.far*dn。
/** Tier for a screen height `px` given the current tier `cur` (hysteresis), quality row `Q` and hero threshold `H`. */
export function pickTier(px, cur, Q, H = Q.hero) {
  const up = 1 + HYST, dn = 1 - HYST;
  let t = cur < 0 ? (px >= H ? T_HERO : px < Q.far ? T_FAR : T_GAME) : cur;
  if (t === T_HERO && px < H * dn) t = px < Q.far ? T_FAR : T_GAME;
  else if (t === T_GAME && px >= H * up) t = T_HERO;
  else if (t === T_GAME && px < Q.far * dn) t = T_FAR;
  else if (t === T_FAR && px >= Q.far * up) t = px >= H * up ? T_HERO : T_GAME;
  return t;
}

// 【交叉淡化材质】为两档过渡注入 screen-door 抖动:出档材质丢弃 IGN≥f 的像素,入档丢弃 IGN<f 的,
// 两者互补,过渡期内每个像素恰被画一次 —— 规避了半透明排序与双重混合。
// ------------------------------------------------------------------------------------------------
// Dither cross-fade materials
// ------------------------------------------------------------------------------------------------
// 【GLSL 片段】DITHER_PARS 声明 uniform 与交错梯度噪声函数 iwLodIGN();DITHER_TEST 是插入 main() 里的
// discard 判定:if ((n < f) == (side > 0)) discard。MAIN_RE 用来把两个片段拼进 fragmentShader。
// 噪声用 interleaved-gradient noise(把屏幕坐标 floor 后点乘魔数再 fract),比纯白噪声更细腻且在任意 f 都均匀。
// uLodFade = (f, side): f ∈ (0,1] fade progress; side +1 = outgoing (keeps IGN ≥ f), −1 = incoming (keeps IGN < f).
// f = 0 disables the test. Interleaved-gradient noise: fine-grained and even at every f.
const DITHER_PARS = 'uniform vec2 uLodFade;\nfloat iwLodIGN(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';
const DITHER_TEST = '\n  if (uLodFade.x > 0.0) { float iwLodN = iwLodIGN(floor(gl_FragCoord.xy)); if ((iwLodN < uLodFade.x) == (uLodFade.y > 0.0)) discard; }\n';
const MAIN_RE = /void\s+main\s*\(\s*\)\s*\{/;

/** A clone of `base` whose fragment shader dithers against `fadeU` ({ value: Vector2 }). Same program for every kid. */
// 【克隆出抖动材质】克隆 base 材质并把 uLodFade 指向传入的 fadeU({ value: Vector2 });
// 关键性能点:用 customProgramCacheKey 让所有 kid 的该材质共享同一着色器程序(只改 uniform,
// 不触发逐 kid 的 program 编译/切换)。会串联 base 原有的 onBeforeCompile。
export function ditherMaterial(base, fadeU) {
  const m = base.clone();
  const prev = base.onBeforeCompile;
  const key = (base.customProgramCacheKey ? base.customProgramCacheKey() : '') + '|iwLodZ';
  m.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    sh.uniforms.uLodFade = fadeU;
    if (MAIN_RE.test(sh.fragmentShader)) sh.fragmentShader = sh.fragmentShader.replace(MAIN_RE, (s) => DITHER_PARS + s + DITHER_TEST);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

// 【far 档·骨感知顶点聚类】把任意 skinned 几何抽稀成 far 档。用 WeakMap 以源几何为键缓存结果,
// 源几何被回收时缓存随之释放,不会泄漏。
// ------------------------------------------------------------------------------------------------
// Far tier: bone-aware vertex clustering
// ------------------------------------------------------------------------------------------------
const _farCache = new WeakMap();

// 【顶点聚类减面】簇键 = 网格格坐标 + 主导骨索引 + 离散材质 id(aEx / aCloth.xy / aTint 装备类别),
// 因此材质边界得以保留;背向成员会分出独立簇(薄壳两面都留,>95° 折痕也不塌)。
// 每个簇保留"最接近形心"的顶点作为代表(属性含蒙皮权重都从它拷贝——表面不会缩水),法线取成员均值。
/**
 * Decimate an (indexed or not) skinned geometry by vertex clustering. Cluster key = grid cell + dominant bone + discrete
 * material ids (aEx, aCloth.xy, aTint gear class), so material borders survive; opposite-facing members split off (thin
 * shells keep both faces). Each cluster keeps its most central vertex (attributes incl. skin
 * weights copied from it — the surface never shrinks) with the members' averaged normal.
 */
export function clusterDecimate(src, cell) {
  const A = src.attributes, P = A.position, n = P.count;
  const N = A.normal, SI = A.skinIndex, SW = A.skinWeight, EX = A.aEx, CL = A.aCloth, TI = A.aTint;
  const inv = 1 / cell;
  const key2c = new Map(), vc = new Int32Array(n);
  const sx = [], sy = [], sz = [], cn = [], rx = [], ry = [], rz = [];
  const newC = (key, i) => {
    const c = cn.length; key2c.set(key, c); sx.push(0); sy.push(0); sz.push(0); cn.push(0);
    rx.push(N ? N.getX(i) : 0); ry.push(N ? N.getY(i) : 0); rz.push(N ? N.getZ(i) : 0);
    return c;
  };
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let dom = 0;
    if (SI && SW) { let bw = -1; for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; dom = SI.getComponent(i, k); } } }
    let d = '';
    if (EX) d += Math.round(EX.getX(i));
    if (CL) d += ':' + Math.round(CL.getX(i)) + '.' + Math.round(CL.getY(i));
    if (TI) { const t = TI.getX(i); d += ':' + (t <= -1.5 ? Math.round(t) : 0); }
    const key = `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)},${dom},${d}`;
    let c = key2c.get(key);
    if (c === undefined) c = newC(key, i);
    // 【分簇判据】与簇内首个法线夹角过大(点积 < −0.09,>95°)的成员另立簇(键加 "#'"),
    // 于是平滑曲面永不分裂、簇数保持低,而薄片两面都得以保留。
    // a member facing away from the cluster's first normal (the other face of a thin shell, a > 95° crease) gets its own
    // cluster — smooth curvature never splits, so the count stays low while sheets keep both faces
    else if (N && N.getX(i) * rx[c] + N.getY(i) * ry[c] + N.getZ(i) * rz[c] < -0.09) { const k2 = key + '#'; c = key2c.get(k2); if (c === undefined) c = newC(k2, i); }
    vc[i] = c; sx[c] += x; sy[c] += y; sz[c] += z; cn[c]++;
  }
  const nc = cn.length;
  // 【代表点】取离簇形心最近的成员;权重/属性都照抄它,故表面位置不缩水。
  // representative = member nearest the centroid
  const rep = new Int32Array(nc).fill(-1), rd = new Float64Array(nc).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const c = vc[i], k = 1 / cn[c];
    const dx = P.getX(i) - sx[c] * k, dy = P.getY(i) - sy[c] * k, dz = P.getZ(i) - sz[c] * k, d = dx * dx + dy * dy + dz * dz;
    if (d < rd[c]) { rd[c] = d; rep[c] = i; }
  }
  const out = new THREE.BufferGeometry();
  for (const name in A) {
    const a = A[name], s = a.itemSize, arr = new a.array.constructor(nc * s);
    for (let c = 0; c < nc; c++) { const r = rep[c]; for (let k = 0; k < s; k++) arr[c * s + k] = a.getComponent(r, k); }
    out.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized));
  }
  if (N) {
    const acc = new Float32Array(nc * 3);
    for (let i = 0; i < n; i++) { const c = vc[i] * 3; acc[c] += N.getX(i); acc[c + 1] += N.getY(i); acc[c + 2] += N.getZ(i); }
    const on = out.attributes.normal;
    for (let c = 0; c < nc; c++) {
      const x = acc[c * 3], y = acc[c * 3 + 1], z = acc[c * 3 + 2], l = Math.hypot(x, y, z);
      if (l > 0.3 * cn[c]) on.setXYZ(c, x / l, y / l, z / l);
    }
  }
  // 【重建索引】把三角按簇重映射,丢掉塌缩(三点同簇)与完全重复的;重复检测用旋转归一化的键,
  // 但保留朝向,故薄片两面的三角都存活。>65535 顶点时退化为 Uint32 索引。
  // triangles: remap, drop collapsed ones and exact duplicates (orientation kept: both faces of a sheet survive)
  const src3 = src.index ? src.index.array : null, nt = (src3 ? src3.length : n) / 3;
  const tris = [], seen = new Set();
  for (let t = 0; t < nt; t++) {
    const a = vc[src3 ? src3[t * 3] : t * 3], b = vc[src3 ? src3[t * 3 + 1] : t * 3 + 1], c = vc[src3 ? src3[t * 3 + 2] : t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const m = Math.min(a, b, c), key = m === a ? `${a},${b},${c}` : m === b ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(key)) continue;
    seen.add(key); tris.push(a, b, c);
  }
  out.setIndex(nc > 65535 ? new THREE.Uint32BufferAttribute(tris, 1) : new THREE.Uint16BufferAttribute(tris, 1));
  out.userData = { ...src.userData, iwLod: 'far', cell };
  out.computeBoundingSphere();
  return out;
}

// 【三角数】索引几何取 index.count,非索引取 position.count,再除以 3。
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Far-tier version of `geo`, decimated to ≲ `target` triangles (cached per source geometry). */
// 【生成 far 档几何】若源几何三角数已 ≤ target 则原样返回(不重复聚类);否则从 cell=0.018 起,
// 因三角数 ∝ 1/cell²,用 sqrt(tri/target) 逐步放大格距,最多 3 步逼近,把三角数压到 target 的 1.12 倍内。
// 结果按源几何缓存(WeakMap),同款角色/发丝不重复减面。
/** Far-tier version of `geo`, decimated to ≲ `target` triangles (cached per source geometry). */
export function farGeometry(geo, target) {
  if (!geo || !geo.attributes || !geo.attributes.position) return geo;
  let c = _farCache.get(geo);
  if (c) return c;
  if (triCount(geo) <= target) { _farCache.set(geo, geo); return geo; }
  // cell size from the surface density, then one correction step (triangle count ∝ 1 / cell²)
  let cell = 0.018;
  let g = clusterDecimate(geo, cell);
  for (let it = 0; it < 3 && triCount(g) > target * 1.12; it++) {
    cell *= Math.sqrt(triCount(g) / target) * 1.02;
    g.dispose(); g = clusterDecimate(geo, cell);
  }
  _farCache.set(geo, g);
  return g;
}
export { triCount };
