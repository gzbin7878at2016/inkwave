// ============================================================================
// 【中文导读】Kelpline(海带线码头)关卡的关卡几何(Layout)——mapkit 的"定向盒"数据表 + 世界化。
// ----------------------------------------------------------------------------
// 【模块定位】
//   本文件是 Kelpline 关卡"四件套"中的 layout(关卡几何本体),由 src/world/stages/kelpline/ 目录拥有:
//     layout.js   关卡几何(本文件)          props.js   道具包 + 摆位(set dressing)
//     surfaces.js 本关专属表面材质(texlib)   murals.js  本关贴花/标识(mural atlas)
//   依赖顺序:layout.js 只 import mapkit.js(B/R/O/PATTERN)与同目录 surfaces.js(SURF 槽位名);
//   props.js 反过来 import layout.js 导出的 LOCAL / ROT_RAD / toWorld(道具给集装箱/楼梯"穿衣",见 props.js 头);
//   murals.js 独立于几何,靠 mural id 与几何上的 mural 字段约定牵手;surfaces.js 被 layout 当作 pattern 槽位。
//   构造:世界装配时 level.js 的 Level 类读 LAYOUT.single / LAYOUT.half(后者再复制出 180° 镜像副本),
//   烘出碰撞块、可上墨面与渲染几何;levelMaterial.js 按面的 pattern id 从 texlib 取材质、按 mural 字段取壁画。
// 【核心机制】
//   1) "半个场地"数据模型:single = 只此一份(如正中的 The Landing);half = 只写 Alpha 半场,运行期由
//      level.js 的 mirrorDef() 生成 (x,z)→(-x,-z) 的 180° 旋转副本给 Bravo 半场——两队竞技场完全对等。
//      标 keep:true 的件"正对港口",不随本关 35° 的码头转向;其余件随整体转向。
//   2) 本关整体在【局部坐标系】(x 横跨突堤、z 沿堤)编排,再整体绕原点旋转 ROT=35°:turn() 把每个 B/R/O
//      转成世界件,并把 mural / noPaint 上的面法线一并转向世界法线。
//   3) 世界化后才算 bounds(AABB + 1m 余量)、出生点、过场镜头(intro)与选关镜头(art);最后汇总成 LAYOUT。
// 【关键约定】
//   • 米制,Y 轴向上;pos/low/high 都是真实坐标(min/max 直接是包围盒角点)。
//   • 地图 180° 旋转镜像:half 的每个件都会再生成一份 (x,z)→(-x,-z)(level.js mirrorDef),所以"半边"件只写
//     一半、镜像补齐;两半必须一致(几何、可上墨性、壁画法线方向都要成对正确)。
//   • 可玩墙面与其采样规则(level.js _buildFaces + levelMaterial.js):|n.y|<0.5 的面判为"墙",其面内坐标
//     faceUv 以米为单位,v 取与世界上方向最贴合的轴(竖直向上)、u = v×n(水平);pattern id 决定材质,
//     竖直面/顶面还会经 onWall/onTop 二次兑换槽位(见 surfaces.js)。可上墨与否:paint 默认 true,但 noPaint
//     (按面向法线)可逐面关掉,roof/perch 顶面一律不可上墨,grate/rail 永不列入。
//   • sea(...) 用 noPaint 把突堤朝海的侧壁标为不可上墨(够不到);slotSides 把堆场"看不见的箱侧"
//     (缝隙 < SLOT)也关掉——避免把墨浪费在没人看得到的面上。
// 【配套阅读】docs/ASSETS.zh-CN.md、docs/BOOT.zh-CN.md(第 6 节"建造世界")、docs/RENDERING-UE4.zh-CN.md §3.3;
//   兄弟文件 src/world/mapkit.js、src/world/level.js、src/world/levelMaterial.js、src/world/murals.js,
//   以及同目录 surfaces.js / murals.js / props.js。
// ============================================================================
// Kelpline Terminal — stage layout (src/world/stages/kelpline/). The stage owns every file in this folder:
//   layout.js    level geometry (this file)        props.js    prop pack + placements (set dressing)
//   surfaces.js  stage surface materials (texlib)  murals.js   stage decals / signage (mural atlas)
import { PATTERN, B, R, O } from '../../mapkit.js';
import { SURF } from './surfaces.js';

// Kelpline Terminal — Berth 4 of a working container terminal at shift change. A finger pier runs diagonally out into
// the harbour (the whole berth is laid out in a local frame below, then turned ROT degrees about the origin): a laden
// box ship lies alongside each flank with its bow pointing at mid, and the ship-to-shore crane K7 stands idle between
// the two berths, boom raised, straddling the pier on rails set into both quay aprons.
//   • spawn: the roof deck of the Terminal Operations building (2.6 m), control tower behind; steel stair straight
//     down into the truck lane, open drops to the truck gate (left) and the reefer yard (right)
//   • outline: the pier head at each base is notched on the gate side (a water slot where the outer gate lane ends)
//     and carries a stepped side wing on the reefer side (the empties / reefer depot, out where no ship lies); at mid the
//     quay bulges out on both flanks around the crane's legs, with 45° chamfered shoulders — an S-shaped, skewed band
//   • centre "Truck lane": 12 m of tarmac between the stack blocks — long sightlines, a trailer + a reach stacker for
//     cover, into the Landing under the crane
//   • left block "4A": four packed rows of 40' / 20' boxes = a 2.6 m plateau with 2-high boxes as cover on top and a
//     2-high wall along the apron; stairs up from the base aisle (lane side) and from the mid end (inside the block)
//   • right block "Reefer rack": reefer rows either side of a steel plug-in rack whose grate catwalk (2.6 m) runs
//     over a covered alley (squids drop through, ink + shots pass the grate); stairs at the base + mid ends
//   • aprons (both flanks): the quay along the ships — long lanes down the crane rail, hatch covers, lashing cages, a
//     straddle carrier, bollards; the crane's bogies are low cover where the aprons open into the mid bulge
//   • mid "The Landing": a round crane working zone painted on the quay; hatch covers lifted off a ship set down askew
//     under the crane's portal (1.2 / 2.4 m) — they sit square to the harbour, i.e. at an angle to the pier
// Heights: 0 yard · 1.2 hatch covers / cages · 2.4 landing top · 2.6 stacks + spawn · 5.2 second tier (squid-only).
// 【调色板 K】本关所有盒子的基础色(十六进制)。上面一行是"高度分层备忘":地面 0、舱盖/笼 1.2、Landing 顶 2.4、
//   箱堆与出生点 2.6、第二层 5.2(仅墨鱼可上)。分两类:场地/建筑色(tarmac…opsDk)与集装箱涂装色(liveries,
//   注释里说明故意压暗,好让"队伍墨色"成为画面里最响的元素)。这些值最终喂给 levelMaterial 作为底色/色调源。
const K = {
  tarmac: '#6f7378', tarmacLane: '#76797c', quay: '#c9c4b8', base: '#bdb8ad', wall: '#d9d4c8', ops: '#dfe3e6', spawn: '#e9e6df',
  steel: '#56687d', hatch: '#4f6d8c', hatchTop: '#58779a', stair: '#8a96a0', kerb: '#cfc9bc', opsDk: '#3b556f',
  // container liveries (muted: team ink stays the loudest thing on screen)
  rust: '#a8583f', blue: '#3d5f8c', teal: '#3f8580', mustard: '#c99a3c', grey: '#858c93', green: '#56794f',
  navy: '#34435f', white: '#e4e2da', cream: '#d9cdb3', maroon: '#7d3f45', orange: '#c47440',
};

// ---- the berth's turn: everything below is authored in the local frame (x across the pier, z along it) and turned
// ROT degrees about the origin (boxes → turned boxes, ramp end points, prop placements' pos + rotY in props.js)
// 【整体转向 ROT】本关所有几何都在"局部坐标系"里写(x 横跨突堤,z 沿堤),最后整体绕原点旋转 ROT=35°。
//   RA = 弧度,RC/RS = cos/sin。ROT_RAD 导出给 props.js 用(道具摆位的旋转补偿)。改这个数会同时改变全局朝向与
//   props 的朝向,不能只改一半。
export const ROT = 35;
const RA = (ROT * Math.PI) / 180, RC = Math.cos(RA), RS = Math.sin(RA);
export const ROT_RAD = RA;
export const toWorld = (x, z) => [x * RC + z * RS, -x * RS + z * RC];
// face normals (murals, noPaint) are matched against WORLD face normals by the level: turn them with the berth too
// 【法线随转 turnN】level.js 在"世界坐标系"里比对 mural / noPaint 的法线来决定贴到哪个面,所以局部法线也必须
//   用同一套旋转公式转过去(取 4 位小数避免浮点误差导致匹配不中)。turnFaces 只改 mural[].n 与 noPaint[]。
const turnN = (n) => [+(n[0] * RC + n[2] * RS).toFixed(4), n[1], +(-n[0] * RS + n[2] * RC).toFixed(4)];
const turnFaces = (o) => ({ ...o, ...(o.mural ? { mural: o.mural.map((m) => ({ ...m, n: turnN(m.n) })) } : {}), ...(o.noPaint ? { noPaint: o.noPaint.map(turnN) } : {}) });
// 【世界化 turn】把"局部件"翻译成 level.js 能吃的"世界件":按 kind 分派。
//   keep:true 的件原样保留(正对港口,不随突堤转);box→O(旋转盒);obox→旋转盒(center + rotY+=ROT);
//   ramp→只转 low/high 两端点(坡道本身是直的,不需旋转). 三种分支都调用 turnFaces 把法线一起转向。
function turn(p) {
  if (p.keep) { const { keep, ...q } = p; return q; }   // square to the harbour (not turned with the berth)
  if (p.kind === 'box') {
    const { min, max, kind, ...o } = p;
    const [cx, cz] = toWorld((min[0] + max[0]) / 2, (min[2] + max[2]) / 2);
    return O(cx, cz, max[0] - min[0], max[2] - min[2], min[1], max[1], ROT, turnFaces(o));
  }
  if (p.kind === 'obox') { const [cx, cz] = toWorld(p.center[0], p.center[2]); return { ...turnFaces(p), center: [cx, p.center[1], cz], rotY: p.rotY + ROT }; }
  const [lx, lz] = toWorld(p.low[0], p.low[2]), [hx, hz] = toWorld(p.high[0], p.high[2]);
  return { ...turnFaces(p), low: [lx, p.low[1], lz], high: [hx, p.high[1], hz] };
}

// Container sides that look into a slot narrower than SLOT (boxes stowed 10 cm apart, a box against the back wall or its
// neighbour's end) are never seen — nobody gets in there — but ink splash still reaches them: turf nobody can see.
// Every such side of a stack box is made non-inkable (noPaint, local normal; turn() rotates it into the world).
// 【缝隙朝向 SLOT=0.45】堆场箱体若贴着窄缝(< SLOT 米,如相邻箱仅隔 10cm、靠背墙、顶着邻箱端头),那一侧外部
//   永远看不到,但墨点飞溅仍会打上去——等于把墨浪费在没人看得见的面上。本函数只对 half 里 tag 以 "box" 开头的
//   实体箱逐面采样(12×6 = 72 个采样点),覆盖率 ≥ 0.9 就把该面加进 noPaint。注:盒子只写半边,故镜像副本 mir()
//   也一并参与遮挡判定,否则会漏判。turn() 之后这些局部法线会转成世界法线。
const SLOT = 0.45;
function slotSides(pieces) {
  const mir = (d) => ({ ...d, min: [-d.max[0], d.min[1], -d.max[2]], max: [-d.min[0], d.max[1], -d.min[2]] });
  const solid = (d) => d.kind === 'box' && !d.keep && !d.rail && !d.grate;
  const all = [...pieces.single.filter(solid), ...pieces.half.filter(solid), ...pieces.half.filter(solid).map(mir)];
  const sides = [[0, 1], [0, -1], [2, 1], [2, -1]];   // [axis, sign]
  const cover = (p, ax, sg) => {
    const face = sg > 0 ? p.max[ax] : p.min[ax], ox = ax === 0 ? 2 : 0;   // the face's in-plane horizontal axis
    const n = 12, m = 6;
    let hit = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const u = p.min[ox] + ((i + 0.5) / n) * (p.max[ox] - p.min[ox]), y = p.min[1] + ((j + 0.5) / m) * (p.max[1] - p.min[1]);
      if (all.some((q) => q !== p && u > q.min[ox] && u < q.max[ox] && y > q.min[1] && y < q.max[1] &&
        (sg > 0 ? q.min[ax] >= face - 0.01 && q.min[ax] < face + SLOT : q.max[ax] <= face + 0.01 && q.max[ax] > face - SLOT))) hit++;
    }
    return hit / (n * m);
  };
  for (const p of pieces.half) {
    if (p.kind !== 'box' || !/^box/.test(p.tag || '')) continue;
    const np = sides.filter(([ax, sg]) => cover(p, ax, sg) >= 0.9).map(([ax, sg]) => (ax === 0 ? [sg, 0, 0] : [0, 0, sg]));
    if (np.length) p.noPaint = [...(p.noPaint || []), ...np];
  }
}

// ISO box: 2.44 wide, 2.6 high (high cube ≈ 2.9, we use 2.6 so tiers stay jump-sized), 6.06 / 12.19 long
// 【标准箱尺寸常量】CW=2.44 宽、CH=2.6 高(真实高柜≈2.9,这里压到 2.6 使每一层恰好是"可跳上"的高度)、
//   LEN 为 20'/40' 箱长(6.06 / 12.19 m)。所有堆场几何都用这些常量,保证分层跳跃手感一致。
const CW = 2.44, CH = 2.6, LEN = { 20: 6.06, 40: 12.19 };
// a container along z: x0 = its −X side, z0 = its −Z end, tier 0 = on the ground. o.door: 1 = doors at the +Z end
// (0 = −Z), o.logo: 1–3 = 40' line logo (murals 9/10 on both long sides), o.reefer: machinery end.
// The tag carries the dressing spec for props.js (container castings, doors, reefer units).
const LOGO_ID = { 1: 9, 2: 10, 3: 9 };   // 1 KRAKEN, 2 TIDEBANK, 3 KRAKEN (40')
const LOGO = (o, n) => (LOGO_ID[o.logo] ? [{ n: n[0], id: LOGO_ID[o.logo] }, { n: n[1], id: LOGO_ID[o.logo] }] : undefined);
// 【不可攀法线 NOCLIMB】带 roof 的箱顶四周四个侧面,统一标为 noPaint(不可上墨);船公司 logo 贴花本身则由 mural 提供。
const NOCLIMB = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// 【箱构造函数 box(沿 z)】生成一个沿 z 轴摆放的 ISO 箱:参数 x0 = 其 −X 侧面, z0 = 其 −Z 端, len = 20/40,
//   tier = 层号(0 = 落地), color = 涂装色。o 里:door(1=门在 +Z 端)、logo(1–3,决定 LOGO_ID 贴在哪对长边上)、
//   reefer(制冷机端)。tag 里带 `box:len:door:reefer` 供 props.js 读取生成集装箱铸件/门/制冷机组等装饰。
//   一个箱子同时是:渲染盒 + 碰撞盒 + 可上墨面 + 贴花载体。
function box(x0, z0, len, tier, color, o = {}) {
  return B(x0, x0 + CW, tier * CH, (tier + 1) * CH, z0, z0 + LEN[len], { color, pattern: PATTERN.container, tag: `box:${len}:${o.door ?? 1}:${o.reefer ? 1 : 0}`, mural: LOGO(o, [[1, 0, 0], [-1, 0, 0]]), ...(o.roof ? { roof: true, noPaint: NOCLIMB } : {}) });
}
function boxX(x0, z0, len, tier, color, o = {}) {   // along x (o.door: 1 = doors at the +X end; o.noPaint: dressed faces)
// 【箱构造函数 boxX(沿 x)】同 box,但长边沿 x 轴:长边法线是 ±z,故 logo 贴在 ±z 两个面上;tag 前缀用 `boxx`。
//   o.noPaint 可显式指定"被装饰遮挡、不必上墨"的面(如某箱正面被 REEFER TECH 机房挡住)。
  return B(x0, x0 + LEN[len], tier * CH, (tier + 1) * CH, z0, z0 + CW, { color, pattern: PATTERN.container, tag: `boxx:${len}:${o.door ?? 1}:${o.reefer ? 1 : 0}`, mural: LOGO(o, [[0, 0, 1], [0, 0, -1]]), ...(o.noPaint ? { noPaint: o.noPaint } : {}) });
}
// steel stair (ramp with the treads surface) + its two handrails as rail colliders (collision-only: kids can't step off
// the side, shots / ink / squids pass; the handrails you see are drawn by props.js kelpline_stair)
// 【楼梯 stairZ(沿 z 上坡)】一把钢楼梯 = 一条 treads 面的坡道 R(...) + 两侧各 3 段"隐形栏杆"碰撞盒。
//   栏杆是 rail:true(可碰撞、但不可上墨、绘制的真实栏杆由 props.js 的 kelpline_stair 负责);HR=0.95 栏杆高。
//   参数 x=坡道中心 x, zLow/zHigh=起止 z, y0/y1=起止高度, w=坡宽。返回值是"件数组",故调用处用 ...stairZ(...) 展开。
const HR = 0.95;
function stairZ(x, zLow, zHigh, y0, y1, w, o = {}) {
  const out = [R([x, y0, zLow], [x, y1, zHigh], w, { tag: 'stair', color: K.stair, pattern: PATTERN.treads, ...o })];
  const run = zHigh - zLow, rise = y1 - y0;
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const za = zLow + (run * k) / 3, zb = zLow + (run * (k + 1)) / 3, top = y0 + (rise * (k + 1)) / 3 + HR + 0.05;
    const xr = x + sx * (w / 2 - 0.05);
    out.push(B(xr - 0.06, xr + 0.06, 0, top, Math.min(za, zb), Math.max(za, zb), { tag: 'stair-rail', rail: true, paint: false, color: K.stair }));
  }
  return out;
}

// ---- grid (local frame)
// 【网格常量 GRID(局部坐标)】本关所有尺寸的"骨架数字",被下面几何和 props.js 共用。逐字段:
//   lane  车道半宽,车行道 x ∈ [−6, 6];  zs/ze = 箱堆与车道板的 z 起止(ze=−7,Landing 板覆盖 z∈[−7,7]);
//   apron 码头前沿内边 |x|=16.16(到边缘 24);  notch 门侧水槽(突堤头 x 20.6…24, z −47.4…−41);
//   A     4A 堆场四排箱的 x0(向 +X 为 Alpha);  RF    冷藏架各排 x0 与巷子(向 −X 为 Alpha)。
export const GRID = {
  lane: 6.0,                                   // truck lane x −6 … 6
  zs: -31.6,                                   // stacks start (base side)
  ze: -7.0,                                    // stacks / lane slab end (the Landing slab spans z −7 … 7)
  apron: 16.16,                                // apron (quay) from |x| = 16.16 to the edge at 24
  notch: [20.6, -41],                          // gate-side water slot at the pier head: x 20.6 … 24, z −47.4 … −41
  A: [6.0, 8.54, 11.08, 13.62],                // block 4A rows (x0), +X for Alpha
  RF: { row0: -8.44, alley: [-10.44, -8.44], row1: -12.88, row2: -15.42 },   // reefer rack rows (x0), −X for Alpha
};
const G = GRID, A = G.A, RF = G.RF;
// 【码头面 quay(o)】地面件的默认选项:码头顶色 + SURF.quay 图案,再用 o 覆盖(如加 tag / mural / noPaint)。
const quay = (o = {}) => ({ color: K.quay, pattern: SURF.quay, ...o });
// the pier's outer walls down to the water: nobody can reach them and the quay-edge steel + fenders dress their top →
// not inkable (sea: the local normals of the sides that face the harbour)
// 【朝海面 sea(...n)】把突堤外侧临水的几面墙标 noPaint(玩不到、且顶部被码头护舷/钢材装饰挡住);入参是这些面的
//   局部法线,turn() 后会转成世界法线再与世界面法线比对。
const sea = (...n) => ({ noPaint: n });
// 【轴法线简写】+X/−X/+Z/−Z 四个方向的单位法线,供 sea/noPaint 用(mural 的 n 字段同理,但方向不一定同这些)。
const X_ = [1, 0, 0], _X = [-1, 0, 0], Z_ = [0, 0, 1], _Z = [0, 0, -1];

// Local-frame pieces (exported for props.js: the container / stair dressing is generated from them)
// 【局部件总表 LOCAL】本文件的"真源":single(全场唯一件)与 half(只写 Alpha 半场,运行期镜像)两个数组,
//   全部在局部坐标系。导出的目的是让 props.js 据此生成、放置集装箱/楼梯等装饰(它按 tag 匹配)。
//   每个件都是 mapkit 的 B/R/O 结构,可带 tag / color / pattern / mural / noPaint / roof 等字段。
export const LOCAL = {
  single: [
    // ---- mid "The Landing": the round crane working zone (painted, mural 11) and the hatch covers set down askew
    // 【single 段:中场 "The Landing"】正中唯一件:圆形吊机作业区地面(贴 mural 11)+ 两块斜放的舱盖(keep:true,
    //   正对港口不随突堤转;上盖 1.2m、下盖 2.4m,成为中场掩体)。
    B(-G.apron, G.apron, -1.2, 0, -7, 7, quay({ tag: 'landing', color: '#c3beb2', mural: [{ n: [0, 1, 0], id: 11 }] })),
    B(-5.4, 5.4, 0, 1.2, -3.0, 3.0, { tag: 'hatch-lower', color: K.hatch, pattern: PATTERN.nonslip, keep: true }),
    B(-2.2, 2.2, 1.2, 2.4, -1.6, 1.6, { tag: 'hatch-upper', color: K.hatchTop, pattern: SURF.chequer, keep: true }),
  ],
  half: [
    // ================= ground slabs (each carries its own painted markings — murals.js)
    // 【half 段:地面板】Alpha 半场的地面(基座码头面/车道/4A 与冷藏堆场板/前沿/突堤角/侧翼/中鼓包)。
    //   每块板顶面用 mural 挂自己的喷绘标记(编号对应 murals.js 的 id)。keep/sea 各按需处理。
    B(-G.apron, G.apron, -1.2, 0, -47.4, G.zs, { tag: 'base-apron', color: K.base, pattern: SURF.quay, mural: [{ n: [0, 1, 0], id: 7 }] }),
    B(-G.lane, G.lane, -1.2, 0, G.zs, G.ze, { tag: 'lane', color: K.tarmacLane, pattern: SURF.tarmac, mural: [{ n: [0, 1, 0], id: 5 }] }),
    B(G.lane, G.apron, -1.2, 0, G.zs, G.ze, { tag: 'block-4a', color: K.tarmac, pattern: SURF.tarmac, mural: [{ n: [0, 1, 0], id: 4 }] }),
    B(-G.apron, -G.lane, -1.2, 0, G.zs, G.ze, { tag: 'block-reefer', color: K.tarmac, pattern: SURF.tarmac, mural: [{ n: [0, 1, 0], id: 8 }] }),
    B(G.apron, 24, -1.2, 0, G.notch[1], 0, quay({ tag: 'apron', mural: [{ n: [0, 1, 0], id: 6 }], ...sea(X_, _Z) })),
    B(-24, -G.apron, -1.2, 0, G.notch[1], 0, quay({ tag: 'apron', mural: [{ n: [0, 1, 0], id: 6 }], ...sea(_X) })),
    // pier-head corners: gate side stops at the water slot (x ≤ 20.6), reefer side runs out into the side wing
    B(G.apron, G.notch[0], -1.2, 0, -47.4, G.notch[1], quay({ tag: 'gate-corner', color: K.base, ...sea(X_, _Z) })),
    B(-24, -G.apron, -1.2, 0, -47.4, G.notch[1], quay({ tag: 'reefer-corner', color: K.base, ...sea(_X, _Z) })),
    // reefer-side wing (stepped): the empties / reefer depot out on the free flank (no ship lies here)
    B(-29.5, -24, -1.2, 0, -46.4, -22, quay({ tag: 'wing', ...sea(_X, Z_, _Z) })),
    B(-32, -29.5, -1.2, 0, -42, -27, quay({ tag: 'wing', ...sea(_X, Z_, _Z) })),
    // mid bulge on the flanks around the crane's legs (the ships' bows point at it), 45° shoulders 10 cm lower (lip)
    B(24, 30, -1.2, 0, -8, 8, quay({ tag: 'bulge', ...sea(X_, Z_, _Z) })),
    O(25.5, -9.5, 8.485, 4.243, -1.2, -0.1, -45, quay({ tag: 'bulge-shoulder', ...sea([0.7071, 0, -0.7071], [0.7071, 0, 0.7071], [-0.7071, 0, -0.7071]) })),
    O(25.5, 9.5, 8.485, 4.243, -1.2, -0.1, 45, quay({ tag: 'bulge-shoulder', ...sea([0.7071, 0, 0.7071], [0.7071, 0, -0.7071], [-0.7071, 0, 0.7071]) })),
    // perimeter wall behind the base (the terminal fence line; the ops building + tower stand behind it)
    B(-24, 24, 0, 4.8, -48, -47.4, { tag: 'backwall', color: K.wall, pattern: PATTERN.concrete, roof: true }),

    // ================= Terminal Operations building: spawn on its roof deck
    // 【half 段:终端运营楼】出生点位于其屋顶平台(2.6m)。一层玻璃幕墙/门/绿化带照旧用 noPaint 关掉可上墨
    //   (装饰会挡墨,同其它关卡的玻璃立面处理)。含屋顶、胸墙(parapet)、以及直下卡车道的钢梯 ops-stair。
    // (its ground-floor facade — ribbon windows, doors, fascia, plant — and the deck's 20 cm edge band under its trim are
    //  dressing that would hide ink: not inkable, like the other stages' glazed facades)
    B(-9, 9, 0, 2.4, -47.4, -39.4, { tag: 'ops-body', color: K.ops, pattern: PATTERN.metalpanel, noPaint: [X_, _X, Z_] }),
    B(-9, 9, 2.4, 2.6, -47.4, -39.4, { tag: 'spawn-deck', color: K.spawn, pattern: PATTERN.spawn, noPaint: [X_, _X, Z_] }),
    B(-9, -3.4, 2.6, 3.4, -40.0, -39.4, { tag: 'parapet', color: K.ops, pattern: PATTERN.metalpanel }),
    B(3.4, 9, 2.6, 3.4, -40.0, -39.4, { tag: 'parapet', color: K.ops, pattern: PATTERN.metalpanel }),
    ...stairZ(0, -32.8, -39.4, 0, 2.6, 6.8, { tag: 'ops-stair' }),

    // ================= truck gate (left corner of the base): two booth islands between the lanes (the outer one's
    // far side is the quay edge of the water slot)
    // 【half 段:卡车大门】基座左角,两条车道之间是两块收费岛台;外侧岛台远边正是水槽的码头边缘。
    B(12.4, 14.4, 0, 0.18, -45.6, -39.2, { tag: 'gate-island', color: K.kerb, pattern: PATTERN.concrete }),
    B(18.6, 20.6, 0, 0.18, -45.6, -39.2, { tag: 'gate-island', color: K.kerb, pattern: PATTERN.concrete }),

    // ================= reefer yard (right corner of the base): reefers against the back wall; the depot on the wing
    // 【half 段:冷藏堆场】基座右角,冷藏箱靠背墙码放,侧翼上是空箱/冷藏车场。注意其中一个 boxX 用 noPaint 关掉
    //   正面(它被 REEFER TECH 机房遮住)。
    boxX(-23.6, -47.3, 20, 0, K.white, { door: 0, reefer: 1 }),
    boxX(-17.44, -47.3, 20, 0, K.white, { door: 0, reefer: 1, noPaint: [[0, 0, 1]] }),   // (its front is the REEFER TECH cabin: door, windows, AC)
    boxX(-23.6, -47.3, 20, 1, K.cream, { door: 0, reefer: 1 }),
    box(-28.9, -45.8, 20, 0, K.white, { door: 1, reefer: 1 }), box(-28.9, -45.8, 20, 1, K.cream, { door: 1, reefer: 1 }),
    box(-28.9, -39.6, 20, 0, K.white, { door: 1, reefer: 1 }),

    // ================= Block 4A (+X): 2.6 m plateau
    // 【half 段:4A 堆场(+X 侧)】四排箱构成一座 2.6m 高原,顶上两层箱作掩体、沿前沿立 2 层箱墙;
    //   从基座侧车道与中场端各有一把楼梯可供上顶。row0…row3 对应 GRID.A。
    // row 0 (lane side): stair up from the base aisle, then a 40' and a 20'
    ...stairZ(A[0] + CW / 2, G.zs, -25.3, 0, 2.6, 2.3),
    box(A[0], -25.3, 40, 0, K.rust, { logo: 1 }), box(A[0], -13.01, 20, 0, K.mustard),
    // row 1: 40' (+ a 20' on top near the base end), 20', then the stair up from the mid end
    box(A[1], G.zs, 40, 0, K.blue), box(A[1], G.zs, 20, 1, K.maroon, { door: 0 }), box(A[1], -19.31, 20, 0, K.navy, { door: 0 }),
    ...stairZ(A[1] + CW / 2, -6.95, -13.25, 0, 2.6, 2.3),
    // row 2: 40', 20', 20' (2-high at the mid end)
    box(A[2], G.zs, 40, 0, K.teal, { logo: 3 }), box(A[2], -19.31, 20, 0, K.green), box(A[2], -13.15, 20, 0, K.grey), box(A[2], -13.15, 20, 1, K.blue, { door: 0 }),
    // row 3 (apron side): 2-high wall along the apron, 1-high 20' at the mid end
    box(A[3], G.zs, 40, 0, K.grey, { door: 0 }), box(A[3], G.zs, 40, 1, K.green, { logo: 2, door: 0 }), box(A[3], G.zs, 20, 2, K.mustard, { door: 0, roof: true }),
    box(A[3], -19.31, 20, 0, K.orange), box(A[3], -19.31, 20, 1, K.navy), box(A[3], -13.15, 20, 0, K.rust),

    // ================= Reefer rack (−X): reefers either side of the plug-in rack; grate catwalk over the alley
    // 【half 段:冷藏架(−X 侧)】插电架两侧排布满冷藏箱;巷子上方是 grate 格栅走道(2.6m,墨鱼可穿过缝隙下坠,
    //   墨与子弹也穿过格栅)。基座端与中场端各一把楼梯。row0/row1/row2 与 alley 见 GRID.RF。
    ...stairZ(RF.row0 + CW / 2, G.zs, -25.3, 0, 2.6, 2.3),
    box(RF.row0, -25.3, 40, 0, K.white, { reefer: 1 }), box(RF.row0, -13.01, 20, 0, K.white, { reefer: 1, door: 0 }),
    B(RF.alley[0], RF.alley[1], 2.45, 2.6, -25.3, -6.95, { tag: 'reefer-catwalk', color: K.steel, pattern: PATTERN.grate, grate: true }),
    box(RF.row1, G.zs, 20, 0, K.white, { reefer: 1, door: 0 }), box(RF.row1, -25.44, 40, 0, K.cream, { reefer: 1 }),
    ...stairZ(RF.row1 + CW / 2, -6.95, -13.25, 0, 2.6, 2.3),
    box(RF.row2, G.zs, 20, 0, K.white, { reefer: 1, door: 0 }), box(RF.row2, G.zs, 20, 1, K.white, { reefer: 1, door: 0 }), box(RF.row2, -25.44, 40, 0, K.white, { reefer: 1 }),
    box(RF.row2, -13.15, 20, 0, K.white, { reefer: 1 }), box(RF.row2, -13.15, 20, 1, K.cream, { reefer: 1 }),

    // ================= truck lane cover: a 20' on a skeletal chassis behind its tractor (box deck at 1.35: squids slip
    // under the chassis, its top at 3.95 is squid-only), a box the reach stacker just set down
    // 【half 段:车道掩体】一辆骨架拖挂(箱底 1.35m,墨鱼可钻底;顶 3.95m 仅墨鱼可上)+ 堆高机刚放下的箱子,
    //   以及吊机在舱盖旁刚落地的另一只 20' 箱。
    B(1.6, 1.6 + CW, 1.35, 1.35 + CH, -28.6, -28.6 + LEN[20], { color: K.maroon, pattern: PATTERN.container, tag: 'trailer' }),
    box(2.6, -15.2, 20, 0, K.orange),
    // a 20' just landed by the crane beside the hatch covers (its twin flanks the other side of mid)
    boxX(10.0, -3.4, 20, 0, K.blue, { door: 0 }),

    // ================= apron cover: a hatch cover set down behind the crane (left), the straddle carrier's box (right)
    // 【half 段:前沿掩体】吊机后方放下一块舱盖(左),右侧是跨运车运来的箱(teal)。
    B(17.2, 20.0, 0, 1.2, -27, -20, { tag: 'apron-hatch', color: K.hatch, pattern: SURF.chequer }),
    box(-21.42, -29.0, 20, 0, K.teal, { door: 1 }),
  ],
};

// ---- world layout
// 【世界装配流水线】1) slotSides:给堆场箱的"隐蔽侧"补 noPaint;2) turn 把 single/half 逐件转为世界件。
//   注意此处仍只是"世界坐标下的数据",真正的碰撞块/面/几何由 level.js 的 Level 构造时再烘。
slotSides(LOCAL);
const single = LOCAL.single.map(turn), half = LOCAL.half.map(turn);
// bounds: the AABB of every turned piece (and its 180° twin), 1 m margin
// 【包围盒 bounds】遍历所有件,取"世界化后"最大的 |x| 、|z|(keep 件不转、ramp 取端点、obox 取旋转后四角),
//   加上 1m 余量后向外取整,得到 ±X × ±Z 的对称范围。因为地图是 180° 中心对称,只需算半边即可覆盖镜像。
const bounds = (() => {
  let mx = 0, mz = 0;
  const pt = (x, z) => { mx = Math.max(mx, Math.abs(x)); mz = Math.max(mz, Math.abs(z)); };
  for (const p of [...LOCAL.single, ...LOCAL.half]) {
    if (p.kind === 'ramp') { for (const e of [p.low, p.high]) pt(...toWorld(e[0], e[2])); continue; }
    if (p.kind === 'box') { for (const x of [p.min[0], p.max[0]]) for (const z of [p.min[2], p.max[2]]) pt(...(p.keep ? [x, z] : toWorld(x, z))); continue; }
    const a = ((p.rotY + ROT) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), [cx, cz] = toWorld(p.center[0], p.center[2]);
    for (const i of [-1, 1]) for (const k of [-1, 1]) pt(cx + (c * i * p.size[0]) / 2 + (s * k * p.size[2]) / 2, cz - (s * i * p.size[0]) / 2 + (c * k * p.size[2]) / 2);
  }
  const X = Math.ceil(mx + 1), Z = Math.ceil(mz + 1);
  return { minX: -X, maxX: X, minZ: -Z, maxZ: Z };
})();
// 【世界点助手 W】把"局部 (x,z) + 高度 y" 转成世界点(取 3 位小数),用于出生点、镜头等单个坐标。
const W = (x, y, z) => { const [a, b] = toWorld(x, z); return [+a.toFixed(3), y, +b.toFixed(3)]; };
const pad = W(0, 2.6, -43.6);   // 出生点:运营楼屋顶中部(局部 z=−43.6)

// 【KELPLINE 汇总对象】交给 level.js 的整关描述。逐字段:
//   id 关卡标识(选 surfaces/murals 时用);  envBoats 是否生成通用系泊船(本关 false——侧翼就是靠泊的货轮);
//   bounds 上一步算的范围;  spawnPads 两个出生点(另一半为 (x,z) 取反的镜像);  spawnBarrier 出生屏障半径;
//   intro 过场飞行镜头(低空掠过 TIDEBANK 船首、中鼓包、4A 堆场,落在运营楼顶);  art 选关/展示镜头;
//   single/half 已世界化的件;  decor.lamps/palms/flags 装饰(本关灯/棕榈为空,旗帜两根)。
const KELPLINE = {
  id: 'kelpline',
  envBoats: false,   // no generic moored boats: the flanks are the moored ships
  // 【envBoats=false】不生成环境通用系泊船——因为本关侧翼本身就是靠泊的货轮,避免重复。
  bounds,
  spawnPads: [pad, [-pad[0], pad[1], -pad[2]]],
  spawnBarrier: 4.2,
  // fly in low over the TIDEBANK's bow and the mid bulge, across Block 4A, down onto the ops roof
  intro: { from: W(40, 22, -8), lookFrom: W(0, 4, -12), toBack: 3.0 },
  art: { from: W(46, 26, -46), look: W(-4, 4, 4), fov: 55 },   // over the gate-side shoulder: K7's portal, the Landing, CORAL MAXIMA's bow
  single,
  half,
  decor: {
    lamps: [],
    palms: [],
    flags: [W(-7.6, 2.6, -46.7), W(7.6, 2.6, -46.7)],
  },
};

// 【对外导出】layout.js 的唯一出口:level.js / props.js 都从这里拿整关描述。
export const LAYOUT = KELPLINE;
