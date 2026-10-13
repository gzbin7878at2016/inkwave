// ============================================================================
// 【中文导读】地图"积木套装"——所有 stage 布局(layout)共用的数据格式与摆放原语
// ----------------------------------------------------------------------------
// 【模块定位】世界层(src/world/)的最底层数据工具,不含 three.js、不产生任何副作用。
//   它定义"一张地图长什么样":布局 = 一组带朝向的盒子(oriented box)列表。
//   消费方:
//     · 各 stage 的 layout.js(src/world/stages/<id>/layout.js)import 这里的 B/R/O/OCT/ARC 拼关卡;
//     · maps.js 直接 import 并 `export * from './mapkit.js'`,于是 HALYARD 也用它;
//     · level.js 只从 maps.js 取 PATTERN(默认纹理);levels 的构建吃 B/R/O 产出的 def 对象;
//     · mapThumb.js 读 def 的 kind / oct 字段来画缩略图;
//     · levelMaterial.js 按 PATTERN 的 id 值建"纹理槽位表"(每 id 一张程序化地表)。
// 【核心机制】本文件只产出"纯数据 def",不做任何几何/碰撞计算——真正的解释发生在
//   level.js 的 _addBlock()(盒子→OBB 块)与 mapThumb.js 的 expand()(盒子→SVG 图形)。
//   一个 def 的 kind 决定它怎么被解释:'box'(轴对齐盒)/ 'obox'(绕 Y 轴转过的盒)/ 'ramp'(斜板)。
// 【关键约定】
//   · 坐标系:右手系,Y 向上,单位米;0° = +x 方向,90° = +z(见 ARC 注释)。
//   · 镜像约定:布局的 `half` 数组会被 180° 旋转镜像((x,z)→(-x,-z)),让两队拿到完全对称的场地;
//     `single` 不镜像。Team Alpha 出生在 -Z,Bravo 在 +Z。
//   · PATTERN 的 id 一旦发布就被 levelMaterial.js 的槽位表按数值引用,不可随意插入/重排。
//   · opts 通用字段:color / pattern / paint(默认 true,是否可涂墨)/ solid(默认 true,是否参与碰撞)/ tag。
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md(世界层)、docs/ASSETS.zh-CN.md(程序化纹理)、
//   src/world/level.js(def 如何变成碰撞块)、src/world/maps.js(HALYARD 用例)、src/world/mapThumb.js。
// ============================================================================
// Map-building kit (shared by every stage layout). Map layouts. A map is a list of oriented boxes. Everything in `half` is also mirrored by a 180° rotation about the
// Y axis ((x,z) -> (-x,-z)) so both teams get an identical arena. Team Alpha spawns at -Z, Bravo at +Z.
//
// box helpers:
//   B(x0,x1, y0,y1, z0,z1, opts)             axis-aligned box
//   R([x,y,z] low, [x,y,z] high, width, opts) ramp slab whose top surface runs from low edge-centre to high edge-centre
// opts: { color, pattern, paint (default true), solid (default true), tag }

// 【PATTERN 纹理 id 表】每个可涂墨/可渲染的面携带一个 pattern id,levelMaterial.js 用它从
//   "程序化地表库"里选一种纹理。0–16 是通用地表;17–23 是码头/船只专用的漆面;
//   24–27 是楼梯/坡道专用(坡面在坡道自身坐标系里贴图,踏步永远横跨坡向)。
//   各 stage 还会从 28 号起占用自己的槽位(见 stages/surfaces.js),所以这里的号段是"共享段"。
export const PATTERN = { plain: 0, deck: 1, tiles: 2, concrete: 3, hazard: 4, container: 5, wood: 6, metal: 7, spawn: 8, planter: 9, asphalt: 10, metalpanel: 11, grate: 12, brick: 13, rubber: 14, glasstile: 15, pavers: 16,
  // marina set (texlib: planks = hardwood dock decking in its own colours; the rest take the block colour as paint)
  planks: 17, hullpaint: 18, nonslip: 19, gelcoat: 20, yard: 21, weatherboard: 22, render: 23,
  // stairs + ramps (ramp tops are textured in the ramp's own frame: treads / cleats always run across the slope)
  treads: 24, stonestep: 25, rampboard: 26, gangdeck: 27 };

// 【通用调色板 C】给非码头关卡(各 stage layout)复用的中性色,配合 pattern 表现出混凝土/石板/木板等。
//   色值写死在此是为了让各 stage 视觉统一;真正的"地表"仍靠 pattern 的程序化纹理,颜色只是底漆。
export const C = {
  deck: '#d8d2c4', deckEdge: '#c9c1b0', tile: '#d9dfe0', cream: '#ece4d4', sand: '#e6d3b3', slate: '#a9b4bc',
  stone: '#c7c2b8', trim: '#8e98a0', teal: '#8fb3b1', rust: '#cf9c88', mustard: '#dcc48e', lav: '#b3abd0',
  spawn: '#eae6de', wood: '#c9a27c', planter: '#b9ad9a', white: '#f3f1ec',
};

// 【B:轴对齐盒】关卡里最常用的原语——给两对角坐标(米)加可选 opts,产出 { kind:'box', min, max }。
//   level.js 会把 min/max 换算成中心 + 半长;B 本身不校验 y0<y1、x0<x1,写反了会在下游出错。
export function B(x0, x1, y0, y1, z0, z1, o = {}) {
  return { kind: 'box', min: [x0, y0, z0], max: [x1, y1, z1], ...o };
}
// 【R:坡道/斜板】用低端边心 low 与高端边心 high 定义一块厚斜板,width 是水平宽度。
//   厚度默认 0.6 m;level.js 会把它从高端延伸到地面(除非 o.thin:true,见下)。
//   注意 low/high 给的是"顶面边心",不是 AABB 角点;拓展开来的实心体会吃掉下方空间。
export function R(low, high, width, o = {}) {
  return { kind: 'ramp', low, high, width, thickness: o.thickness ?? 0.6, ...o };
}
// box turned about the vertical axis by `deg` degrees: centre (cx, cz), w along its local x, d along its local z
// 【O:绕竖直轴旋转的盒】中心 (cx,cz),底面 y0、顶面 y1,沿自身 x 长 w、沿自身 z 长 d,绕 Y 轴逆时针转 deg 度。
//   典型用途:摆成斜角的舞台/道具(level.js 会为它建一组旋转过的轴 axes,碰撞用 OBB 而非 AABB)。
export function O(cx, cz, w, d, y0, y1, deg, o = {}) {
  return { kind: 'obox', center: [cx, (y0 + y1) / 2, cz], size: [w, y1 - y0, d], rotY: deg, ...o };
}
// Regular octagon platform (circumradius R): a plus of three boxes + four 45° corner slabs 10 cm lower. The corner
// slabs tuck under the arms (that part is buried: no z-fighting, and paint under it is dead), leaving a shallow lip.
// 【OCT:正八边形平台】返回一组 def(不是单个),因为八边形用五个部件拼出来:
//   外接圆半径 R → 边长参数 A = R·cos(π/8)(内切半径/apothem)、hs = R·sin(π/8)(半边长)。
//   三个轴对齐盒拼成"十字":中间一横 + 上下两竖;四块 45° 角板比主体低 0.1 m 塞进十字臂下。
//   角板刻意埋进主体(被盖住的部分不会 z-fighting,其下也永不参与涂墨),外沿留一圈浅唇。
//   o.oct = [cx,cz,R] 是给缩略图用的标记:mapThumb.js 见到它就把整只八边形当"一个图形"画,不再画五个部件。
export function OCT(cx, cz, R, y0, y1, o0 = {}) {
  const A = R * Math.cos(Math.PI / 8), hs = R * Math.sin(Math.PI / 8); // apothem, half side
  const o = { ...o0, oct: [cx, cz, R] };                                // lets the stage thumbnail draw one octagon
  const out = [
    B(cx - A, cx + A, y0, y1, cz - hs, cz + hs, o),
    B(cx - hs, cx + hs, y0, y1, cz + hs, cz + A, o),
    B(cx - hs, cx + hs, y0, y1, cz - A, cz - hs, o),
  ];
  // corner slabs reach past the arm corners by a margin small enough that neighbouring slabs never meet (≤ 0.158·R)
  // 【角板几何】depth 是 45° 板的厚度(沿对角线方向),k 是它中心到原点的距离;两者凑成"刚好顶到臂角又不与
  //   邻板相碰"的尺寸。Math.min(0.3, 0.12*R) 是外伸余量——超过 0.158·R 邻板就会撞上,故夹住。
  //   旋转方向按 (sx*sz>0) 选 ±45°,保证四块板朝向外侧。
  const depth = A - hs * Math.SQRT2 + Math.min(0.3, 0.12 * R), k = (A - depth / 2) / Math.SQRT2;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push(O(cx + sx * k, cz + sz * k, 2 * hs, depth, y0, y1 - 0.1, sx * sz > 0 ? 45 : -45, o));
  return out;
}
// Curved wall: n straight segments following a circle (centre cx,cz; r = wall centre line) from a0° to a1°
// (0° = +x, 90° = +z). Segments meet at their inner corners, so they never overlap.
// 【ARC:圆弧墙】把一段圆弧(圆心 cx,cz、半径 r 为墙中线、从 a0° 到 a1°、共 n 段)近似成 n 块直板。
//   角度约定:0° = +x 方向,90° = +z(即角度从 +x 朝 +z 转,绕 Y 轴的右手方向)。
//   len = 相邻段在内角相接处的弦长 = 2·(r - t/2)·tan(Δ/2)(用内切半径算),所以各段只在"内角"相遇、永不重叠。
//   每段的 deg 用 -a° 是因为 O 的 rotY 与这里的角度增长方向相反,取负才能让板面朝外。
export function ARC(cx, cz, r, t, y0, y1, a0, a1, n, o = {}) {
  const out = [], da = (a1 - a0) / n, len = 2 * (r - t / 2) * Math.tan((Math.abs(da) * Math.PI) / 360);
  for (let i = 0; i < n; i++) {
    const a = ((a0 + da * (i + 0.5)) * Math.PI) / 180;
    out.push(O(cx + r * Math.cos(a), cz + r * Math.sin(a), t, len, y0, y1, (-a * 180) / Math.PI, o));
  }
  return out;
}
// ramp onto an octagon's diagonal face: q = quadrant sign (±1, ±1), run = horizontal length
// 【OCTRAMP:搭到八边形斜面的坡道】把坡道接到八边形的某条斜边上。象限符号 (sx,sz) 选斜边方向,
//   (ux,uz) 是那条斜边的单位外法线。坡顶落在斜边中点(距中心 A = R·cos(π/8),并下探 0.1 m 埋进台面),
//   坡底从它沿外法线延伸 run 米。本质是 R_ 的便捷封装。
export function OCTRAMP(cx, cz, R, yLow, yTop, sx, sz, run, width, o = {}) {
  const A = R * Math.cos(Math.PI / 8), ux = sx / Math.SQRT2, uz = sz / Math.SQRT2;
  const hx = cx + ux * A, hz = cz + uz * A;
  return R_(hx + ux * run, yLow, hz + uz * run, hx, yTop - 0.1, hz, width, o);
}
// 【R_:展平坐标的 R】把 low/high 六个分量拆成参数,免得每次都手写两个数组字面量;产出与 R 完全相同。
export function R_(lx, ly, lz, hx, hy, hz, width, o) { return R([lx, ly, lz], [hx, hy, hz], width, o); }
