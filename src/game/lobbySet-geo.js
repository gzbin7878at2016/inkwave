// ============================================================================
// 【中文导读】后巷场景的【几何源】:分桶攒批器 SetBuilder + 程序化道具工厂
// ----------------------------------------------------------------------------
// 【模块定位】联机大厅后巷(LobbySet,lobbySet.js)四件套之一,只负责"形状/位置/顶点色"。
//   LobbySet._build() 持有一个 SetBuilder B,按顺序调用本文件导出的道具工厂
//   (fireEscape/windowUnit/shutter/dumpster/vending/woodCrate/…)与 B.box/rbox/cyl/tube
//   等原语,把整条后巷的静态几何攒进 B;最后 B.build() 按材质桶合并,交回 lobbySet.js 建 Mesh。
//   本文件【不建 Mesh、不碰灯光、不认识画质档】——只产出带自定义顶点属性的几何。
//
// 【四件套分工与调用顺序】
//   lobbySet.js   【装配/总控】先向 mats 要 uniforms、向 tex 要纹理,再用本文件的 SetBuilder
//                 攒几何、用 mats 的材质建 Mesh,最后接线灯光与反射。
//   lobbySet-geo.js【几何】本文件:SetBuilder 分桶合并 + 原语 + 道具工厂 + mat4/PAINT。
//   lobbySet-mats.js【材质】makeUniforms() 与各材质(surface/ground/lit/neon/…)及 SLOT 槽位表;
//                 消费本文件产出的顶点属性 aSurf/aDec/aLit/aNeon。
//   lobbySet-tex.js【贴图】Canvas 图集与霓虹字形(DECAL/LIT/GROUND_RECT/…)。
//
// 【核心机制:分桶攒批(bucketed builder)】所有静态件按"桶名"分组收集:
//   surface → color(顶点色) + aSurf(材质槽 slot, 脏污 grime, 粗糙 rough, 金属 metal) + aDec(贴花 uv+模式)
//   lit     → aLit(自发光颜色;窗/门/贩卖机玻璃,采样 LIT 图集,覆盖色由这里给)
//   neon    → aNeon(队别 team, 蜂鸣 buzz, 招牌 sign) —— 换队色只改 mats 的 uniform,顶点属性不重写
//   emit    → color(HDR 颜色 × k,供 bloom)
//   build() 时每个桶 mergeGeometries 成一份几何,故整条后巷只占少数几个 draw call。
//
// 【关键约定】
//   - 单位:米、Y 轴向上;后巷沿 -Z 延伸(相机在 +Z 望向 -Z 的街口)。
//   - surface 桶的 uv 是【米制】且在【局部坐标】下算(变换前),这样旋转/缩放的 prop 贴图比例不变。
//     贴花另走 aDec:用几何自带 0..1 的 uv0 定位图集矩形,不受米制 uv 覆盖影响。
//   - 面过滤 faces 字符串:'xXyYzZ',小写 = 负方向面(如 'Xz' 只保留 +x 与 -z 两个面)。
//   - PAINT 是常用油漆配方(color + surf),道具工厂大量复用;这里的色值只是十六进制原料,
//     真正上色在 lobbySet-mats.js 的着色器里按 slot + 图集完成。
//
// 【建议阅读顺序】mat4 → class SetBuilder(尤其 add()/build())→ KIND/KEEP → boxUV
//   → PAINT → 任一 prop 工厂(windowUnit → shutter → dumpster 由简入繁)。
//
// 【配套阅读】lobbySet.js、lobbySet-mats.js(SLOT/aSurf/aDec 的消费方)、docs/ARCHITECTURE.zh-CN.md
// ============================================================================
// Lobby set geometry: a bucketed builder (everything static merges into one geometry per material) + the prop kit.
// Units: metres, Y up; the alley runs along -Z. Surface geometry carries uv in METRES (texlib samples at layer scale),
// a tint colour, aSurf = (slot, grime, roughness multiplier, metalness) and aDec = (decal u, v, mode).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SLOT } from './lobbySet-mats.js';

// 【模块级临时量】攒批期间反复复用,避免在热循环里分配新对象(攒几何可能上万次 add)。
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
// 【TRS 矩阵工厂】mat4(x,y,z, ry,rx,rz, sx,sy,sz):按 'YXZ' 欧拉顺序 compose 出摆放矩阵。
// 是全场"摆一件东西"的统一入口;返回【新】Matrix4,调用方可安全持有。
export const mat4 = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));

// 【共享临时色】add() 里把十六进制色解析进来时复用,省一次分配(用完立即写进顶点属性)。
const COL = new THREE.Color();
// 【分桶几何攒批器】LobbySet._build() 只创建一个实例,调遍所有原语与道具工厂。
// 它把"几何 + 变换 + 顶点属性"一次性登记进桶,绝不在这里建 Mesh;build() 才合并。
export class SetBuilder {
  // 【构造】buckets:桶名 → 几何数组;stack:变换栈(初始为单位矩阵,供 at() 嵌套);
  // tris:累计三角形数,供 LobbySet 统计几何预算用。
  constructor() { this.buckets = new Map(); this.stack = [new THREE.Matrix4()]; this.tris = 0; }
  // 【当前变换】栈顶矩阵 —— 所有 add() 都在此坐标系下求最终矩阵。
  get M() { return this.stack[this.stack.length - 1]; }
  // 【压栈】把 m 乘到当前矩阵之上(子件相对父件摆放);配套 pop() 还原。
  push(m) { this.stack.push(this.M.clone().multiply(m)); return this; }
  // 【出栈】弹回上一层坐标系。
  pop() { this.stack.pop(); return this; }
  // 【作用域变换】push(m) → 跑 fn() → pop():让 fn 内所有子件都活在 m 坐标系里。
  at(m, fn) { this.push(m); fn(); this.pop(); }

  // 【核心:把一个几何塞进桶】流程:①非索引化 + 补法线(攒批要求各几何顶点属性对齐,才能 merge);
  // ②若 surface 桶且未指定 keep,把 uv 重算成【局部】米制 boxUV(变换前);③应用"当前矩阵 × o.m";
  // ④按桶 kind 贴顶点属性(color/aSurf/aDec 或 aLit 或 aNeon);⑤按 KEEP 白名单删掉多余属性;⑥push 进桶。
  // 易踩的坑:uv0(几何自带 0..1 uv)必须在 boxUV【之前】克隆出来,专供 dec 定位贴花 —— 否则被米制 uv 覆盖。
  // Add a geometry to a bucket. o: { color, surf: [slot, grime, rough, metal], dec: [u, v, mode] | fn(pos) , lit: [r,g,b],
  // neon: [team, buzz, sign], emit: colour (HDR, scalar multiplier via o.k), m: extra matrix, uv: 'box' | 'keep' }
  add(key, g, o = {}) {
    g = g.index ? g.toNonIndexed() : g.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = o.m ? this.M.clone().multiply(o.m) : this.M;
    // 【米制 uv】在应用变换【之前】按局部坐标算,保证旋转过的 prop 贴图尺度不变
    // metre uvs from LOCAL coordinates (before the transform) so a rotated prop keeps its texture scale
    const n = g.attributes.position.count;
    const uv0 = g.attributes.uv ? g.attributes.uv.clone() : null;   // the geometry's own 0..1 uv (decal placement)
    if (key === 'surface' && o.uv !== 'keep') boxUV(g, o.uvScale || 1);
    if (o.swapUV) { const u = g.attributes.uv; for (let i = 0; i < n; i++) u.setXY(i, u.getY(i), u.getX(i)); }
    g.applyMatrix4(m);
    const kind = KIND[key] || 'surface';
    if (kind === 'surface') {
      const c = COL.set(o.color ?? '#808080'), cs = new Float32Array(n * 3), ss = new Float32Array(n * 4), ds = new Float32Array(n * 3);
      const sf = o.surf || [SLOT.plain, 0.3, 1, 0];
      for (let i = 0; i < n; i++) { cs.set([c.r, c.g, c.b], i * 3); ss.set(sf, i * 4); }
      // 【贴花 aDec】每顶点三元组 (u, v, mode);dec 可为函数(用 uv0 选图集矩形)或常量值。
      // mode 3/4 = 只在贴花覆盖范围内保留像素,其余丢弃(见 lobbySet-mats.js 的 surface 着色器)。
      if (o.dec) for (let i = 0; i < n; i++) ds.set(typeof o.dec === 'function' ? o.dec(uv0 ? uv0.getX(i) : 0, uv0 ? uv0.getY(i) : 0, i) : o.dec, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cs, 3));
      g.setAttribute('aSurf', new THREE.BufferAttribute(ss, 4));
      g.setAttribute('aDec', new THREE.BufferAttribute(ds, 3));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    } else if (kind === 'lit') {
      const l = new Float32Array(n * 3); for (let i = 0; i < n; i++) l.set(o.lit || [1, 1, 1], i * 3);
      g.setAttribute('aLit', new THREE.BufferAttribute(l, 3));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    } else if (kind === 'neon') {
      const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(o.neon || [0, 0, 0], i * 3);
      g.setAttribute('aNeon', new THREE.BufferAttribute(a, 3));
      g.deleteAttribute('uv');
    } else if (kind === 'emit') {
      const c = COL.set(o.color ?? '#ffffff').multiplyScalar(o.k ?? 1), cs = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cs.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cs, 3));
      g.deleteAttribute('uv');
    }
    // 【属性裁剪】只留 KEEP[kind] 白名单里的顶点属性:同一桶内所有几何必须属性集一致,merge 才能成功。
    for (const k of Object.keys(g.attributes)) if (!KEEP[kind].includes(k)) g.deleteAttribute(k);
    let b = this.buckets.get(key); if (!b) this.buckets.set(key, (b = []));
    b.push(g); this.tris += n / 3;
    return g;
  }
  // 【轴对齐盒】用两对角点(x0..x1, y0..y1, z0..z1)在当前坐标系下定义;faces 过滤要保留的面。
  // surface 桶默认按米制重算 boxUV 并把 uv 标记成 keep,避免 add() 里再算一遍。
  // axis-aligned box from corners (in the current frame); faces: string of faces to keep ('xXyYzZ', lower = negative)
  box(key, x0, y0, z0, x1, y1, z1, o = {}) {
    const g = boxGeo(x1 - x0, y1 - y0, z1 - z0, o.faces);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (key === 'surface' && o.uv !== 'keep') { boxUV(g, 1); o = { ...o, uv: 'keep' }; }
    return this.add(key, g, o);
  }
  // 【圆角盒】w/h/d 尺寸 + r 圆角半径(2 段细分);箱体、机柜、包装盒都用它,边缘有真实倒角高光。
  rbox(key, w, h, d, r, o = {}) { return this.add(key, new RoundedBoxGeometry(w, h, d, 2, r), o); }
  // 【圆柱/圆锥】r0 底 r1 顶(不等则锥形),seg 周向段数;o.open 为 true 时不封顶(做管口/开口筒)。
  cyl(key, r0, r1, h, seg, o = {}) { return this.add(key, new THREE.CylinderGeometry(r1, r0, h, seg, 1, !!o.open), o); }
  // 【管/线】沿 pts 折线扫掠成管;o.sharp 用折线(硬拐角),否则 CatmullRom 平滑;seg 按弧长自动估。
  // 栏杆、电缆、霓虹管、桁架都用它。
  // tube along points (polyline, lightly smoothed through CatmullRom unless o.sharp)
  tube(key, pts, r, o = {}) {
    const v = pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p)));
    const curve = o.sharp ? polyCurve(v) : new THREE.CatmullRomCurve3(v, !!o.closed, 'centripetal', 0.5);
    const seg = o.seg || Math.max(4, Math.ceil(curve.getLength() / (o.step || 0.08)));
    return this.add(key, new THREE.TubeGeometry(curve, seg, r, o.radial || 6, !!o.closed), o);
  }
  // 【合并出桶】每桶 mergeGeometries 成一份几何,返回 { 桶名: 几何 }。
  // LobbySet._build() 直接用返回对象的 .surface/.lit/.neon/.emit 建 Mesh。
  build() {
    const out = {};
    for (const [k, list] of this.buckets) out[k] = list.length === 1 ? list[0] : mergeGeometries(list, false);
    return out;
  }
}
// 【桶名 → 顶点属性 kind】neonA/neonB 是"同一 kind 不同桶":分开攒,建 Mesh 时分属两队材质,但属性布局相同。
const KIND = { surface: 'surface', lit: 'lit', neonA: 'neon', neonB: 'neon', neon: 'neon', emit: 'emit' };
// 【属性白名单】每种 kind 只保留这些顶点属性;mergeGeometries 要求同桶几何属性集完全一致,故必须裁剪。
const KEEP = { surface: ['position', 'normal', 'uv', 'color', 'aSurf', 'aDec'], lit: ['position', 'normal', 'uv', 'aLit'], neon: ['position', 'normal', 'aNeon'], emit: ['position', 'normal', 'color'] };

// 【折线转 Curve】把点列拼成直线段路径,供 tube() 在 o.sharp 模式下扫掠(保留硬拐角)。
function polyCurve(v) { const c = new THREE.CurvePath(); for (let i = 1; i < v.length; i++) c.add(new THREE.LineCurve3(v[i - 1], v[i])); return c; }
// 【带面过滤的盒】faces 字符串挑面:'xXyYzZ' 中小写 = 负方向面,如 'xXyzZ' 丢掉 +Y 顶面。
// 实现靠 BoxGeometry 的 6 个 group(顺序 +x,-x,+y,-y,+z,-z),按 keep 掩码重建索引。
// box with per-face metre uvs; faces filter (e.g. 'xXyzZ' drops the +Y top)
function boxGeo(w, h, d, faces) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (!faces) return g;
  // BoxGeometry groups: +x, -x, +y, -y, +z, -z
  const keep = ['X', 'x', 'Y', 'y', 'Z', 'z'].map((f) => faces.includes(f));
  const idx = g.index.array, out = [];
  g.groups.forEach((gr, i) => { if (keep[i]) for (let k = gr.start; k < gr.start + gr.count; k++) out.push(idx[k]); });
  g.setIndex(out); g.clearGroups();
  return g;
}
// 【平面投影米制 uv】按每个顶点的主法线轴投影:x 面用 (z,y),y 面用 (x,z),z 面用 (x,y),乘缩放 s。
// 符号约定让相邻面纹理连续、不镜像;这是"砖墙/混凝土"等图集能在任意盒子上无缝平铺的关键。
// planar metre uvs chosen per vertex by the dominant normal axis (x faces: z,y · y faces: x,z · z faces: x,y)
export function boxUV(g, s = 1) {
  const p = g.attributes.position, n = g.attributes.normal, N = p.count, uv = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i) * s, y = p.getY(i) * s, z = p.getZ(i) * s;
    if (ax >= ay && ax >= az) uv.set([n.getX(i) > 0 ? -z : z, y], i * 2);
    else if (ay >= az) uv.set([x, n.getY(i) > 0 ? -z : z], i * 2);
    else uv.set([n.getZ(i) > 0 ? x : -x, y], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ================================================================================================ props
// 【surface 配方速记】S(slot, grime, rough, metal) → aSurf 四元组:
//   slot  = SLOT 槽位(0 plain / 1 brick / 3 concrete / 4 metalpanel / 9 grate … 见图集)
//   grime = 脏污/积水/油渍程度(0..1),rough = 粗糙度乘子,metal = 金属度(0..1)。
const S = (slot, grime = 0.3, rough = 1, metal = 0) => [slot, grime, rough, metal];
// 【常用油漆表】道具工厂反复引用的 { color, surf } 配方,避免每次手写 S(...);
// 消费方是 add()(把 surf 铺进 aSurf),色号只是原料,最终由 surface 材质贴图上色。
export const PAINT = {
  steelBlack: { color: '#1b1d21', surf: S(SLOT.plain, 0.25, 0.75, 0.2) },
  steelGalv: { color: '#8a9096', surf: S(SLOT.metalpanel, 0.35, 0.8, 0.6) },
  steelRust: { color: '#5a4032', surf: S(SLOT.metalpanel, 0.5, 1.1, 0.2) },
  pipe: { color: '#4a4d52', surf: S(SLOT.plain, 0.35, 0.6, 0.5) },
  rubber: { color: '#151515', surf: S(SLOT.rubber, 0.2, 1, 0) },
  concrete: { color: '#8c8a86', surf: S(SLOT.concrete, 0.45, 1, 0) },
};

// 【防火梯】贴墙(x = wallX,dir=+1 朝 +x / -1 朝 -x):levels 是各层平台高度(米),
// 逐层生成格栅地板 + 槽钢框 + 栏杆(顶杆/中杆/立柱),层间再挂斜跑楼梯(格栅踏步 + 两侧斜梁),
// o.ladder = [下端起 y, 垂落 z] 时在底层加一截垂梯。是左墙/右墙的立面主要细节件。
// Fire escape against a wall (x = wallX, facing dir = +1 into +x / -1 into -x): landings at `levels`, railings,
// stair flights between landings, a drop ladder at the bottom.
export function fireEscape(B, wallX, dir, z0, z1, levels, o = {}) {
  const P = PAINT.steelBlack, D = 1.15, x0 = wallX, x1 = wallX + dir * D, xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const bar = (ax, ay, az, bx, by, bz, r = 0.018) => B.tube('surface', [[ax, ay, az], [bx, by, bz]], r, { sharp: true, seg: 1, radial: 5, ...P });
  levels.forEach((y, li) => {
    // grate floor + channel frame
    B.box('surface', xa, y - 0.03, z0, xb, y, z1, { color: '#26282c', surf: S(SLOT.grate, 0.3, 0.9, 0.3), uv: 'box' });
    B.box('surface', xa, y - 0.12, z0, xb, y - 0.03, z0 + 0.05, P); B.box('surface', xa, y - 0.12, z1 - 0.05, xb, y - 0.03, z1, P);
    B.box('surface', dir > 0 ? xb - 0.05 : xa, y - 0.12, z0, dir > 0 ? xb : xa + 0.05, y - 0.03, z1, P);
    // railing: top rail, mid rail, balusters
    const rx = x1 - dir * 0.03;
    bar(rx, y + 0.98, z0, rx, y + 0.98, z1, 0.022); bar(rx, y + 0.5, z0, rx, y + 0.5, z1, 0.014);
    bar(x0, y + 0.98, z0, rx, y + 0.98, z0, 0.022); bar(x0, y + 0.98, z1, rx, y + 0.98, z1, 0.022);
    for (let z = z0; z <= z1 + 1e-3; z += 0.5) bar(rx, y, z, rx, y + 0.98, z, 0.011);
    // brackets under the landing
    for (const z of [z0 + 0.1, z1 - 0.1]) bar(x0, y - 0.8, z, x1 - dir * 0.05, y - 0.08, z, 0.02);
    // stair flight up to the next landing (inside the railing)
    const ny = levels[li + 1];
    if (ny != null) {
      const sx0 = x0 + dir * 0.15, sx1 = x0 + dir * 0.85, n = Math.round((ny - y) / 0.2), za = z1 - 0.35, zb = z0 + 0.55;
      for (let k = 1; k < n; k++) { const t = k / n, zz = za + (zb - za) * t, yy = y + (ny - y) * t; B.box('surface', Math.min(sx0, sx1), yy - 0.03, zz - 0.11, Math.max(sx0, sx1), yy, zz + 0.11, { color: '#26282c', surf: S(SLOT.grate, 0.3, 0.9, 0.3) }); }
      for (const sx of [sx0, sx1]) bar(sx, y, za + 0.1, sx, ny, zb - 0.1, 0.03);
      bar(sx1, y + 0.9, za + 0.1, sx1, ny + 0.9, zb - 0.1, 0.018);
    }
  });
  if (o.ladder) {
    const y0 = o.ladder[0], y1 = levels[0], lz = o.ladder[1], lx = x1 - dir * 0.18;
    for (const dz of [-0.2, 0.2]) bar(lx, y0, lz + dz, lx, y1 + 0.9, lz + dz, 0.02);
    for (let y = y0 + 0.15; y < y1; y += 0.3) bar(lx, y, lz - 0.2, lx, y, lz + 0.2, 0.012);
  }
}

// 【落水管】贴墙竖直管,顶部一个折弯偏移、底部一个"鞋"形出水口;沿线每隔 1.8 m 加一个卡箍盒。
// Drain pipe down a wall with brackets, an offset near the top and a shoe at the bottom.
export function drainPipe(B, wallX, dir, z, y0, y1, r = 0.055) {
  const x = wallX + dir * (r + 0.05);
  B.tube('surface', [[x, y1 + 0.2, z - 0.3], [x, y1, z - 0.3], [x, y1 - 0.35, z], [x, y0 + 0.25, z], [x + dir * 0.12, y0 + 0.02, z]], r, { radial: 10, step: 0.1, ...PAINT.pipe });
  for (let y = y0 + 0.9; y < y1 - 0.4; y += 1.8) B.box('surface', Math.min(wallX, x + dir * r), y - 0.03, z - r - 0.02, Math.max(wallX, x + dir * r), y + 0.03, z + r + 0.02, PAINT.steelBlack);
}

// 【窗单元】因墙体是实心盒,窗的进深全部向【外】做:外凸窗套、内凹玻璃、竖中梃 + 横档、
// 出挑的石窗台与窗楣,可选防盗栏杆。玻璃进 lit 桶(rect 指定 LIT 图集矩形,lit 是自发光色)。
// 注意:窗套/窗台用 X(a,b) 统一把 dir 左右两端排序成 min/max,保证 dir=±1 都能正确建盒。
// Window (walls are solid, so the depth is built outward): a proud casing, the glass set back inside it, a mullion
// + transom, a projecting stone sill and lintel, optional security bars. Glass uses the lit bucket (atlas rect).
export function windowUnit(B, wallX, dir, zc, yb, w, h, rect, lit, o = {}) {
  const f = 0.075, cd = 0.11, X = (a, b) => [Math.min(wallX + dir * a, wallX + dir * b), Math.max(wallX + dir * a, wallX + dir * b)];
  const z0 = zc - w / 2, z1 = zc + w / 2;
  const fr = { color: o.frame || '#cfc8b8', surf: S(SLOT.plain, 0.7, 0.85, 0) };
  const [c0, c1] = X(0, cd);
  B.box('surface', c0, yb, z0, c1, yb + h, z0 + f, fr); B.box('surface', c0, yb, z1 - f, c1, yb + h, z1, fr);
  B.box('surface', c0, yb + h - f, z0, c1, yb + h, z1, fr);
  const [m0, m1] = X(0, cd * 0.6);
  B.box('surface', m0, yb + h * 0.55, z0 + f, m1, yb + h * 0.55 + 0.045, z1 - f, fr);
  B.box('surface', m0, yb + f, zc - 0.022, m1, yb + h * 0.55, zc + 0.022, fr);
  const [s0, s1] = X(-0.01, 0.16);
  B.box('surface', s0, yb - 0.08, z0 - 0.07, s1, yb, z1 + 0.07, PAINT.concrete);
  const [l0, l1] = X(0, 0.06);
  B.box('surface', l0, yb + h, z0 - 0.1, l1, yb + h + 0.16, z1 + 0.1, { color: '#77736d', surf: S(SLOT.concrete, 0.6, 1, 0) });
  const gl = new THREE.PlaneGeometry(w - 2 * f, h - f);
  const uv = gl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + (rect[2] - rect[0]) * uv.getX(i), rect[1] + (rect[3] - rect[1]) * uv.getY(i));
  B.add('lit', gl, { m: mat4(wallX + dir * 0.035, yb + (h - f) / 2, zc, dir > 0 ? Math.PI / 2 : -Math.PI / 2), lit });
  if (o.bars) for (let z = z0 + 0.12; z < z1 - 0.05; z += 0.13) B.tube('surface', [[wallX + dir * 0.15, yb + 0.02, z], [wallX + dir * 0.15, yb + h, z]], 0.012, { sharp: true, seg: 1, radial: 5, ...PAINT.steelBlack });
}

// 【空调外机】挂在窗下:外壳(圆角盒)、正面百叶格栅、底盘集水盘、两侧挂臂支架。o.color 换壳色。
// AC unit hung under a window: casing, grille, fan disc, drip tray + brackets.
export function acUnit(B, wallX, dir, zc, y, o = {}) {
  const w = 0.72, h = 0.46, d = 0.55;
  B.at(mat4(wallX + dir * d / 2, y + h / 2, zc, dir > 0 ? Math.PI / 2 : -Math.PI / 2), () => {
    B.rbox('surface', w, h, d, 0.025, { color: o.color || '#bfbcb4', surf: S(SLOT.metalpanel, 0.7, 0.9, 0.1) });
    // grille slats on the face
    for (let i = 0; i < 9; i++) B.box('surface', -w / 2 + 0.05, -h / 2 + 0.06 + i * 0.04, d / 2, w / 2 - 0.05, -h / 2 + 0.075 + i * 0.04, d / 2 + 0.012, { color: '#8d8a84', surf: S(SLOT.plain, 0.8, 0.9, 0.2) });
    B.box('surface', -w / 2, -h / 2 - 0.05, -d / 2, w / 2, -h / 2, d / 2 + 0.04, PAINT.steelRust);
    for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) B.box('surface', x - 0.02, -h / 2 - 0.35, -d / 2, x + 0.02, -h / 2 - 0.05, -d / 2 + 0.04, PAINT.steelBlack);
  });
}

// 【卷帘门】瓦楞帘片(用 corrugated 槽位贴图)+ 两侧导轨 + 上部卷箱 + 底杆。
// 涂鸦不画在这里,而是另铺一张 decalQuad 盖在帘片上(见 shop 里的 graffiti)。
// Roll-up shutter: corrugated curtain, guide rails, the coil housing above, a bottom bar. (The graffiti is a separate
// decal quad over it, see decalQuad.)
export function shutter(B, wallX, dir, z0, z1, y0, y1) {
  const x = wallX + dir * 0.06, xl = Math.min(wallX, x), xh = Math.max(wallX, x);
  const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0, 1, 1);
  B.add('surface', g, { m: mat4(x, (y0 + y1) / 2, (z0 + z1) / 2, dir > 0 ? Math.PI / 2 : -Math.PI / 2), color: '#6f7479', surf: S(SLOT.corrugated, 0.45, 1, 0.35), swapUV: true });
  B.box('surface', Math.min(wallX, wallX + dir * 0.32), y1, z0 - 0.08, Math.max(wallX, wallX + dir * 0.32), y1 + 0.42, z1 + 0.08, { color: '#4b5055', surf: S(SLOT.metalpanel, 0.5, 0.9, 0.4) });
  for (const z of [z0 - 0.06, z1]) B.box('surface', xl, y0, z, xh + 0.02, y1, z + 0.06, PAINT.steelGalv);
  B.box('surface', xl, y0, z0, xh + 0.03, y0 + 0.08, z1, PAINT.steelBlack);
}

// 【垃圾集装箱】体身下窄上宽(锥形),两片盖板(一片掀开靠墙)、侧挂耳、四个脚轮。
// Dumpster (roll-off bin): tapered body, two lids (one propped open), side pockets, casters.
export function dumpster(B, x, z, ry, color = '#2f5a45') {
  const W = 1.9, D = 1.1, H = 1.12;
  B.at(mat4(x, 0, z, ry), () => {
    const body = new THREE.BoxGeometry(W, H, D, 1, 1, 1); const p = body.attributes.position;
    // 【锥形】只把【下半】顶点的 z 收 0.82,得到上宽下窄的箱体;再重算法线否则侧面高光会平。
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setZ(i, p.getZ(i) * 0.82);   // tapered toward the bottom
    body.computeVertexNormals();
    B.add('surface', body, { m: mat4(0, 0.16 + H / 2, 0), color, surf: S(SLOT.metalpanel, 0.85, 1, 0.3) });
    B.box('surface', -W / 2 - 0.04, 0.16 + H - 0.08, -D / 2 - 0.04, W / 2 + 0.04, 0.16 + H, D / 2 + 0.04, { color, surf: S(SLOT.metalpanel, 0.8, 1, 0.3) });
    for (const sx of [-1, 1]) B.box('surface', sx * W / 2 - (sx > 0 ? 0.08 : -0.08) - 0.04 * sx, 0.5, -0.3, sx * W / 2 + 0.04 * sx - (sx > 0 ? 0 : 0), 0.95, 0.3, { color, surf: S(SLOT.metalpanel, 0.9, 1, 0.3) });
    // lids: back one closed, front one propped open against the wall
    B.box('surface', -W / 2, 0.16 + H, -D / 2 - 0.02, 0, 0.16 + H + 0.05, D / 2 + 0.02, { color: '#1c1f22', surf: S(SLOT.plain, 0.6, 1.25, 0) });
    B.at(mat4(W / 4, 0.16 + H, -D / 2, 0, -1.9), () => B.box('surface', -W / 4, 0, 0, W / 4, 0.05, D + 0.04, { color: '#1c1f22', surf: S(SLOT.plain, 0.6, 1.25, 0) }));
    for (const [cx, cz] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) { B.cyl('surface', 0.08, 0.08, 0.06, 12, { m: mat4(cx, 0.08, cz, 0, 0, Math.PI / 2), ...PAINT.rubber }); B.box('surface', cx - 0.05, 0.1, cz - 0.05, cx + 0.05, 0.17, cz + 0.05, PAINT.steelBlack); }
  });
}

// 【自动贩卖机】机身 + 发光正面(lit 桶,rectFront 指定 LIT 图集矩形)+ 投币面板 + 取物翻盖。
// Vending machine: body, lit front (lit bucket), coin panel, delivery flap.
export function vending(B, x, z, ry, rectFront, body = '#d9dde0') {
  const W = 0.95, D = 0.78, H = 1.9;
  B.at(mat4(x, 0, z, ry), () => {
    B.rbox('surface', W, H, D, 0.04, { m: mat4(0, H / 2 + 0.04, 0), color: body, surf: S(SLOT.plain, 0.5, 0.45, 0.1) });
    B.box('surface', -W / 2 + 0.02, 0, -D / 2 + 0.05, W / 2 - 0.02, 0.06, D / 2 - 0.05, PAINT.steelBlack);
    const g = new THREE.PlaneGeometry(0.62, 1.52); const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rectFront[0] + (rectFront[2] - rectFront[0]) * uv.getX(i), rectFront[1] + (rectFront[3] - rectFront[1]) * uv.getY(i));
    B.add('lit', g, { m: mat4(-0.1, 1.12, D / 2 + 0.005), lit: [1.7, 1.7, 1.7] });
    B.box('surface', 0.25, 0.9, D / 2, 0.42, 1.5, D / 2 + 0.03, { color: '#2a2d31', surf: S(SLOT.plain, 0.3, 0.5, 0.3) });
    B.box('surface', -0.38, 0.14, D / 2, 0.2, 0.34, D / 2 + 0.03, { color: '#1a1c1f', surf: S(SLOT.plain, 0.4, 0.6, 0.2) });
  });
}

// 【木质果箱】三层板条箱(planks 槽位)+ 底板 + 四角立柱;w/h/d 可调,默认 0.6×0.45×0.42。
// Stacked crates: wooden produce crates (plank slot) and plastic milk crates (bars) in a colour.
export function woodCrate(B, x, y, z, ry, w = 0.6, h = 0.45, d = 0.42) {
  B.at(mat4(x, y, z, ry), () => {
    const P = { color: '#9c7b55', surf: S(SLOT.planks, 0.6, 1, 0) };
    for (let i = 0; i < 3; i++) { const yy = 0.02 + i * (h / 3); B.box('surface', -w / 2, yy, -d / 2, w / 2, yy + h / 3 - 0.03, -d / 2 + 0.018, P); B.box('surface', -w / 2, yy, d / 2 - 0.018, w / 2, yy + h / 3 - 0.03, d / 2, P); B.box('surface', -w / 2, yy, -d / 2, -w / 2 + 0.018, yy + h / 3 - 0.03, d / 2, P); B.box('surface', w / 2 - 0.018, yy, -d / 2, w / 2, yy + h / 3 - 0.03, d / 2, P); }
    B.box('surface', -w / 2, 0, -d / 2, w / 2, 0.02, d / 2, P);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('surface', sx * w / 2 - (sx > 0 ? 0.045 : 0), 0, sz * d / 2 - (sz > 0 ? 0.045 : 0), sx * w / 2 + (sx < 0 ? 0.045 : 0), h, sz * d / 2 + (sz < 0 ? 0.045 : 0), { color: '#7d5f3f', surf: S(SLOT.planks, 0.7, 1, 0) });
  });
}
// 【塑料奶箱】镂空格栅箱(底 + 上下框 + 密排竖条),color 决定塑料色 —— 场里蓝/红两只。
export function milkCrate(B, x, y, z, ry, color) {
  const w = 0.46, h = 0.3, d = 0.34, C = { color, surf: S(SLOT.plain, 0.35, 0.55, 0) };
  B.at(mat4(x, y, z, ry), () => {
    B.box('surface', -w / 2, 0, -d / 2, w / 2, 0.025, d / 2, C);
    for (const yy of [0.12, h - 0.03]) { B.box('surface', -w / 2, yy, -d / 2, w / 2, yy + 0.03, -d / 2 + 0.02, C); B.box('surface', -w / 2, yy, d / 2 - 0.02, w / 2, yy + 0.03, d / 2, C); B.box('surface', -w / 2, yy, -d / 2, -w / 2 + 0.02, yy + 0.03, d / 2, C); B.box('surface', w / 2 - 0.02, yy, -d / 2, w / 2, yy + 0.03, d / 2, C); }
    for (let i = 0; i <= 5; i++) { const xx = -w / 2 + (i / 5) * (w - 0.02); B.box('surface', xx, 0, -d / 2, xx + 0.02, h, -d / 2 + 0.02, C); B.box('surface', xx, 0, d / 2 - 0.02, xx + 0.02, h, d / 2, C); }
    for (let i = 0; i <= 3; i++) { const zz = -d / 2 + (i / 3) * (d - 0.02); B.box('surface', -w / 2, 0, zz, -w / 2 + 0.02, h, zz + 0.02, C); B.box('surface', w / 2 - 0.02, 0, zz, w / 2, h, zz + 0.02, C); }
  });
}

// 【音箱堆】两只箱体(低音单元圆柱 + 号角)叠放,顶部功放头(电源指示灯走 emit 桶发红光),
// 一根电缆从背后蛇行拖到地面。摆在贩卖机旁边,是近景的一个高光点。
// Speaker stack: two cabinets with woofers + a horn, an amp head on top (with a glowing power LED in the emit bucket).
export function speakerStack(B, x, z, ry) {
  B.at(mat4(x, 0, z, ry), () => {
    const cab = (y, w, h, d, cones) => {
      B.rbox('surface', w, h, d, 0.02, { m: mat4(0, y + h / 2, 0), color: '#161719', surf: S(SLOT.rubber, 0.25, 1, 0) });
      B.box('surface', -w / 2 + 0.03, y + 0.03, d / 2 - 0.005, w / 2 - 0.03, y + h - 0.03, d / 2 + 0.005, { color: '#0c0c0d', surf: S(SLOT.grate, 0.1, 1, 0.2) });
      for (const [cx, cy, r] of cones) {
        B.cyl('surface', r, r * 0.4, 0.08, 20, { m: mat4(cx, y + cy, d / 2 - 0.03, 0, Math.PI / 2), color: '#202123', surf: S(SLOT.plain, 0.1, 0.9, 0) });
        B.add('surface', new THREE.TorusGeometry(r, 0.018, 6, 24), { m: mat4(cx, y + cy, d / 2 + 0.01), color: '#2c2d30', surf: S(SLOT.plain, 0.1, 0.6, 0.3) });
        B.cyl('surface', r * 0.25, r * 0.25, 0.02, 14, { m: mat4(cx, y + cy, d / 2 - 0.02, 0, Math.PI / 2), color: '#3a3b3e', surf: S(SLOT.plain, 0.1, 0.4, 0.5) });
      }
    };
    cab(0, 0.62, 0.72, 0.5, [[0, 0.36, 0.22]]);
    cab(0.72, 0.62, 0.62, 0.48, [[-0.14, 0.4, 0.1], [0.14, 0.4, 0.1], [0, 0.15, 0.07]]);
    B.rbox('surface', 0.56, 0.22, 0.4, 0.015, { m: mat4(0, 1.45, -0.02), color: '#1c1d20', surf: S(SLOT.plain, 0.2, 0.55, 0.3) });
    for (let i = 0; i < 5; i++) B.cyl('surface', 0.018, 0.018, 0.02, 10, { m: mat4(-0.18 + i * 0.07, 1.44, 0.185, 0, Math.PI / 2), color: '#bfbfbf', surf: S(SLOT.plain, 0, 0.35, 0.8) });
    B.add('emit', new THREE.SphereGeometry(0.012, 8, 6), { m: mat4(0.22, 1.47, 0.185), color: '#ff2a2a', k: 6 });
    // cable snaking off to the door
    B.tube('surface', [[0.2, 1.4, -0.2], [0.35, 0.6, -0.3], [0.5, 0.02, -0.1], [1.2, 0.015, 0.2], [2.0, 0.015, 0.1]], 0.012, { radial: 5, ...PAINT.rubber });
  });
}

// 【交通锥】底座 + LatheGeometry 旋转轮廓成锥体 + 两道反光带;tipped=true 时绕 z 轴放倒(躺在路边)。
// Traffic cone with two retro-reflective bands.
export function cone(B, x, z, ry, tipped = false) {
  B.at(mat4(x, 0, z, ry, tipped ? 0 : 0, tipped ? Math.PI / 2 - 0.35 : 0), () => {
    B.box('surface', -0.19, 0, -0.19, 0.19, 0.035, 0.19, { color: '#1a1a1a', surf: S(SLOT.rubber, 0.4, 1, 0) });
    const prof = [[0.15, 0.035], [0.14, 0.12], [0.1, 0.36], [0.06, 0.58], [0.03, 0.7], [0.0, 0.705]].map(([r, y]) => new THREE.Vector2(r, y));
    B.add('surface', new THREE.LatheGeometry(prof, 20), { color: '#ff5a14', surf: S(SLOT.plain, 0.35, 0.55, 0) });
    for (const [y, r] of [[0.3, 0.113], [0.47, 0.085]]) B.cyl('surface', r + 0.01, r - 0.01 + 0.005, 0.08, 20, { m: mat4(0, y, 0), open: true, color: '#e8e8e8', surf: S(SLOT.plain, 0.3, 0.3, 0.5) });
  });
}

// 【自行车】斜靠墙:两轮(轮胎圆环 + 轮辋 + 12 根辐条)、菱形车架(用 tube 连关键点)、车把、车座。
// lean 给整车一个侧倾角,靠墙姿态更自然。
// Bike leaning on a wall: wheels (tyre torus + rim + spokes), diamond frame, bars, saddle.
export function bike(B, x, z, ry, lean = 0.18, color = '#c2372f') {
  B.at(mat4(x, 0, z, ry, 0, lean), () => {
    const R = 0.33, wb = 1.02, F = { color, surf: S(SLOT.plain, 0.35, 0.4, 0.3) }, K = PAINT.steelBlack;
    for (const wx of [-wb / 2, wb / 2]) {
      B.add('surface', new THREE.TorusGeometry(R, 0.024, 8, 36), { m: mat4(wx, R + 0.024, 0), ...PAINT.rubber });
      B.add('surface', new THREE.TorusGeometry(R - 0.035, 0.008, 5, 36), { m: mat4(wx, R + 0.024, 0), color: '#9aa0a6', surf: S(SLOT.plain, 0.2, 0.3, 0.9) });
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; B.tube('surface', [[wx, R + 0.024, 0], [wx + Math.cos(a) * (R - 0.04), R + 0.024 + Math.sin(a) * (R - 0.04), 0]], 0.0025, { sharp: true, seg: 1, radial: 3, color: '#9aa0a6', surf: S(SLOT.plain, 0, 0.3, 0.9) }); }
    }
    const bb = [-0.05, 0.3, 0], st = [-0.16, 0.84, 0], hd = [0.36, 0.86, 0], rw = [-wb / 2, R + 0.024, 0], fw = [wb / 2, R + 0.024, 0];
    const t = (a, b, r = 0.018, P = F) => B.tube('surface', [a, b], r, { sharp: true, seg: 1, radial: 6, ...P });
    t(bb, st); t(bb, hd, 0.022); t(st, hd); t(bb, rw, 0.013); t(st, rw, 0.012); t(hd, fw, 0.015);
    t(hd, [0.34, 0.98, 0], 0.016, K); t([0.3, 0.98, -0.24], [0.38, 0.98, 0.24], 0.013, K);
    B.rbox('surface', 0.24, 0.05, 0.12, 0.02, { m: mat4(-0.18, 0.9, 0), color: '#111', surf: S(SLOT.rubber, 0.2, 0.8, 0) });
    t(st, [-0.18, 0.88, 0], 0.012, K);
    B.cyl('surface', 0.06, 0.06, 0.02, 14, { m: mat4(-0.05, 0.3, 0.02, 0, Math.PI / 2), ...K });
  });
}

// 【垃圾袋】黑色有光泽的鼓包。做法:二十面体细分 3 级后去索引/顶点焊接(保证共享顶点=鼓包连续),
// 再用三个不同频率的正弦叠加把每个顶点沿径向【随机起伏】成皱褶,最后压扁底部(y 下限)让它坐地。
// 起伏相位由 seed 决定 ⇒ 同 seed 每次都长一样,不同垃圾袋各异。
// Trash bags: lumpy glossy black blobs.
export function trashBag(B, x, y, z, s = 1, seed = 1) {
  let g = new THREE.IcosahedronGeometry(0.3 * s, 3); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); const p = g.attributes.position;
  let a = seed * 9.1;
  for (let i = 0; i < p.count; i++) { const v = _p.fromBufferAttribute(p, i); const n = 1 + 0.18 * Math.sin(v.x * 11 + a) * Math.sin(v.z * 9 + a * 0.7) + 0.1 * Math.sin(v.y * 15 + a); v.multiplyScalar(n); v.y = Math.max(v.y * 0.82, -0.3 * s * 0.8); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  B.add('surface', g, { m: mat4(x, y + 0.23 * s, z, seed), color: '#0d0e10', surf: S(SLOT.plain, 0.1, 0.35, 0) });
  B.cyl('surface', 0.035 * s, 0.02 * s, 0.12 * s, 8, { m: mat4(x, y + 0.5 * s, z, 0, 0.2), color: '#0d0e10', surf: S(SLOT.plain, 0.1, 0.35, 0) });
}

// 【悬链线】在 a、b 两点间采 n+1 个点;sag 是最大下垂(米),用抛物线近似 y -= sag*4*t*(1-t)(t∈[0,1],中点下垂最大)。
// 返回 Vector3 数组,供 tube() 扫掠成电缆,或供 CatmullRomCurve3 做更平滑的线缆(见 lobbySet.js 的 _wires)。
// Catenary between two points (sag in metres), n samples.
export function catenary(a, b, sag, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))); }
  return out;
}

// 【纯贴花四边形】只用来贴一张图集贴花,本身不产生实体面:墙面海报、涂鸦、地面墨点、码头模具印。
// rect = 图集 [u0,v0,u1,v1];swap=true 用 mode 4(否则 3),两者都表示"贴花外的像素丢弃"。
// dec 用几何自带 0..1 uv 映射到 rect,故不受米制 uv 影响。
// Decal-only quad (mode 3 / 4 = discard outside the paint) on a wall plane or the dock top; rect = atlas [u0, v0, u1, v1].
export function decalQuad(B, m, w, h, rect, swap = false, slot = SLOT.plain, color = '#777') {
  const g = new THREE.PlaneGeometry(w, h);
  B.add('surface', g, { m, color, surf: [slot, 0.4, 1, 0], dec: (u, v) => [rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v, swap ? 4 : 3] });
}
