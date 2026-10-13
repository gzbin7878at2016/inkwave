// ============================================================================
// 【中文导读】Cargo(货运码头)关卡的关卡几何(Layout)——mapkit 的"定向盒"数据表 + 世界化。
// ----------------------------------------------------------------------------
// 【模块定位】
//   本文件是 Cargo 关卡"四件套"中的 layout(关卡几何本体),由 src/world/stages/cargo/ 目录拥有:
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
// Cargo Terminal — stage layout (src/world/stages/cargo/; ported from PR #8's rebuilt "Kelpline Terminal"). The stage owns every file in this folder:
//   layout.js    level geometry (this file)        props.js    prop pack + placements (set dressing)
//   surfaces.js  stage surface materials (texlib)  murals.js   stage decals / signage (mural atlas)
import { PATTERN, B, R, O } from '../../mapkit.js';
import { SURF } from './surfaces.js';

// Cargo Terminal — Berth 4 of a working container terminal at shift change. A finger pier runs diagonally out into
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
// 【调色板 K】本关所有块的顶点色来源(键名 = 用途):地面(沥青/码头混凝土/堆场)、钢构、舱盖、出生台,
// 以及一批"低饱和集装箱涂装(rust/blue/teal/mustard…)"——刻意压暗,好让两队上墨的墨色成为画面里最响的颜色。
const K = {
  tarmac: '#6f7378', tarmacLane: '#76797c', quay: '#c9c4b8', base: '#bdb8ad', wall: '#d9d4c8', ops: '#dfe3e6', spawn: '#e9e6df',
  steel: '#56687d', hatch: '#4f6d8c', hatchTop: '#58779a', stair: '#8a96a0', kerb: '#cfc9bc', opsDk: '#3b556f',
  // container liveries (muted: team ink stays the loudest thing on screen)
  rust: '#a8583f', blue: '#3d5f8c', teal: '#3f8580', mustard: '#c99a3c', grey: '#858c93', green: '#56794f',
  navy: '#34435f', white: '#e4e2da', cream: '#d9cdb3', maroon: '#7d3f45', orange: '#c47440',
};

// 【整体转向 ROT / toWorld】本关在"局部坐标系"里编排(x 横跨突堤、z 沿堤),再整体绕原点旋转 ROT=35°。
// 下面是这一转向的全部原语:RC/RS 为 cos/sin(RA),ROT_RAD 供 props.js 复用,toWorld(x,z) 把局部点转成世界点。
// 导出的这一切都会被 props.js 用来摆放道具(道具的 pos/rotY 同样走这个转向)。
// ---- the berth's turn: everything below is authored in the local frame (x across the pier, z along it) and turned
// ROT degrees about the origin (boxes → turned boxes, ramp end points, prop placements' pos + rotY in props.js)
export const ROT = 35;
const RA = (ROT * Math.PI) / 180, RC = Math.cos(RA), RS = Math.sin(RA);
export const ROT_RAD = RA;
export const toWorld = (x, z) => [x * RC + z * RS, -x * RS + z * RC];
// 【法线转向】level.js 匹配 mural / noPaint 时用的都是"世界面法线",所以要跟着码头一起转:
// turnN 把一个局部法线转成世界法线(保留 y、只转 x/z,并用 toFixed(4) 消掉浮点噪声,保证与面法线的点积判定稳定)。
// face normals (murals, noPaint) are matched against WORLD face normals by the level: turn them with the berth too
const turnN = (n) => [+(n[0] * RC + n[2] * RS).toFixed(4), n[1], +(-n[0] * RS + n[2] * RC).toFixed(4)];
const turnFaces = (o) => ({ ...o, ...(o.mural ? { mural: o.mural.map((m) => ({ ...m, n: turnN(m.n) })) } : {}), ...(o.noPaint ? { noPaint: o.noPaint.map(turnN) } : {}) });
// 【世界化 turn】把局部件转成世界件,三种 kind 各一路:keep 件原样(仅摘掉 keep 标记)方对港口;box → 用
// 中心经 toWorld 后交给 O() 生成"带 rotY=ROT 的定向盒";obox → 中心转向、rotY 加 ROT;ramp → 两端点分别转向。
// 三条路径都顺带用 turnFaces 把 mural / noPaint 的法线转向世界。
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
// 【缝隙阈值 SLOT】堆场里两箱相隔 < SLOT(0.45m)时,中间那张箱侧面没人够得到,却仍会被墨水飞溅溅到——
// 属于"看不见的都守区"。slotSides 把这些面标成 noPaint,省下一整块可上墨面的成本。
const SLOT = 0.45;
// 【slotSides 看不见的箱侧剔除】对 half 里的每个"箱"件(box 且非 keep/rail/grate),在 4 个水平侧面
// ([轴, 符号]:x±、z±)上按 12×6 网格采样,若 ≥90% 采样点都被"同缝隙内的邻箱"遮住,就把该面法线加入 noPaint。
// 注意采样把镜像副本(mir)也算作遮挡者,这样两半的判定一致。法线是"局部法线",后续由 turn() 转世界。
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

// 【ISO 集装箱尺寸】CW 2.44 宽、CH 2.6 高(高箱≈2.9,这里统一取 2.6 让叠箱每层高度刚好在跳跃范围内)、
// LEN 20/40 尺长度。tier = 层号(0 = 落地)。
// ISO box: 2.44 wide, 2.6 high (high cube ≈ 2.9, we use 2.6 so tiers stay jump-sized), 6.06 / 12.19 long
const CW = 2.44, CH = 2.6, LEN = { 20: 6.06, 40: 12.19 };
// 【LOGO 航运标志】o.logo 1/2/3 映射到 mural id 9(KRAKEN,40 尺两侧)/10(TIDEBANK)/9;LOGO(o,n) 生成
// mural 表项(两侧长边各一张);NOCLIMB 是四张"不可攀爬"侧面(给够不到顶上翻越的箱做 roof)。
// a container along z: x0 = its −X side, z0 = its −Z end, tier 0 = on the ground. o.door: 1 = doors at the +Z end
// (0 = −Z), o.logo: 1–3 = 40' line logo (murals 9/10 on both long sides), o.reefer: machinery end.
// The tag carries the dressing spec for props.js (container castings, doors, reefer units).
const LOGO_ID = { 1: 9, 2: 10, 3: 9 };   // 1 KRAKEN, 2 TIDEBANK, 3 KRAKEN (40')
const LOGO = (o, n) => (LOGO_ID[o.logo] ? [{ n: n[0], id: LOGO_ID[o.logo] }, { n: n[1], id: LOGO_ID[o.logo] }] : undefined);
const NOCLIMB = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
// 【box 沿 Z 的箱】x0 = −X 侧、z0 = −Z 端(宽固定 CW、长 LEN[len]、高由 tier 决定);tag 里编码了
// `box:长:门位:是否冷藏`,props.js 读它生成箱角件/门/机组等"穿衣"细节;o.roof 时叠 roof + 四侧不可爬。
function box(x0, z0, len, tier, color, o = {}) {
  return B(x0, x0 + CW, tier * CH, (tier + 1) * CH, z0, z0 + LEN[len], { color, pattern: PATTERN.container, tag: `box:${len}:${o.door ?? 1}:${o.reefer ? 1 : 0}`, mural: LOGO(o, [[1, 0, 0], [-1, 0, 0]]), ...(o.roof ? { roof: true, noPaint: NOCLIMB } : {}) });
}
// 【boxX 沿 X 的箱】同 box,但长度沿 X、宽沿 Z(供"横放"的箱用);o.door:1 = 门在 +X 端;可传 o.noPaint 指定
// 已着装、无需上墨的侧面(如 REEFER TECH 小屋占用的那面)。tag 前缀 `boxx:` 供 props.js 识别朝向。
function boxX(x0, z0, len, tier, color, o = {}) {   // along x (o.door: 1 = doors at the +X end; o.noPaint: dressed faces)
  return B(x0, x0 + LEN[len], tier * CH, (tier + 1) * CH, z0, z0 + CW, { color, pattern: PATTERN.container, tag: `boxx:${len}:${o.door ?? 1}:${o.reefer ? 1 : 0}`, mural: LOGO(o, [[0, 0, 1], [0, 0, -1]]), ...(o.noPaint ? { noPaint: o.noPaint } : {}) });
}
// 【stairZ 钢楼梯】返回 [台阶坡道 R + 两侧 rail 碰撞条]。坡道用 treads 材质(zLow→zHigh 沿 z、y0→y1 爬升);
// rail 条是"只挡小孩、不挡子弹/墨水/鱿鱼"的碰撞体(HR=0.95 高),你看到的实体扶手由 props.js 的 cargo_stair 绘制。
// steel stair (ramp with the treads surface) + its two handrails as rail colliders (collision-only: kids can't step off
// the side, shots / ink / squids pass; the handrails you see are drawn by props.js cargo_stair)
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
// 【GRID 局部坐标网格】本关的"尺寸总表",所有 LOCAL 件都按它摆位(数值为局部坐标):
//   lane   6.0     卡车通道半宽:通道占 x −6…6
//   zs    −31.6    堆场/通道板起始 z(靠基地一侧)
//   ze    −7.0     堆场/通道板结束 z;正中的 The Landing 板覆盖 z −7…7
//   apron 16.16    码头(岸线)起始 |x|,一路到边缘 24
//   notch [20.6,−41] 突堤头靠卡闸侧的水槽:x 20.6…24、z −47.4…−41(外车道尽头的"开口")
//   A     4A 堆场四排的 x0(Alpha 侧朝 +X)
//   RF    冷藏箱架各排 x0 与中央过道 alley(Alpha 侧朝 −X)
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
// 【quay 码头面快捷件】默认码头混凝土色 + SURF.quay 材质槽,可被 o 覆盖(码头、突堤头、侧翼等共用)。
const quay = (o = {}) => ({ color: K.quay, pattern: SURF.quay, ...o });
// the pier's outer walls down to the water: nobody can reach them and the quay-edge steel + fenders dress their top →
// not inkable (sea: the local normals of the sides that face the harbour)
// 【sea 朝海侧壁】把突堤"下到水面"的外墙标为不可上墨(玩家够不到,码头上沿的护舷钢已把它填满):传入若干
// 局部法线(如 X_、_X、Z_、_Z),level.js 会把这些法线朝向的面关掉上墨。
const sea = (...n) => ({ noPaint: n });
const X_ = [1, 0, 0], _X = [-1, 0, 0], Z_ = [0, 0, 1], _Z = [0, 0, -1];

// 【LOCAL 局部件集(导出给 props.js)】关卡几何的"原始数据",分两张表:
//   single 只此一份(不镜像):正中的 The Landing 圆盘作业区、错位摆放的舱盖(keep: true 方对港口、不随码头转向);
//   half   只写 Alpha 半场,运行期由 mirrorDef 复制 180° 给 Bravo:地面板、运营楼、卡闸、冷藏场、4A 堆场、
//          冷藏箱架、卡车通道掩体、码头掩体等整组布景。
// props.js 通过 import { LOCAL } 读取这些件,在箱子/楼梯上生成着装细节;两表都是"局部坐标",随后整体 turn()。
// Local-frame pieces (exported for props.js: the container / stair dressing is generated from them)
export const LOCAL = {
  // 【single:正中一份,不镜像】The Landing(码头正中,唯一跨两半的圆盘作业区,画 mural 11)与两块错位
  // 舱盖(keep: true —— 正对港口、不随 35° 码头转向,所以与突堤成斜角;1.2/2.4m 两级,构成中场掩体)。
  single: [
    // ---- mid "The Landing": the round crane working zone (painted, mural 11) and the hatch covers set down askew
    B(-G.apron, G.apron, -1.2, 0, -7, 7, quay({ tag: 'landing', color: '#c3beb2', mural: [{ n: [0, 1, 0], id: 11 }] })),
    B(-5.4, 5.4, 0, 1.2, -3.0, 3.0, { tag: 'hatch-lower', color: K.hatch, pattern: PATTERN.nonslip, keep: true }),
    B(-2.2, 2.2, 1.2, 2.4, -1.6, 1.6, { tag: 'hatch-upper', color: K.hatchTop, pattern: SURF.chequer, keep: true }),
  ],
  // 【half:Alpha 半场,镜像补 Bravo】下列各件按 180° 旋转各复制一份。分组:地面板(各带上漆标识,见 murals.js)
  // → 运营楼(出生点在其屋顶) → 卡车卡闸 → 冷藏场 → 4A 堆场 → 冷藏箱架 → 通道掩体 → 码头掩体。
  half: [
    // ================= ground slabs (each carries its own painted markings — murals.js)
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
    // (its ground-floor facade — ribbon windows, doors, fascia, plant — and the deck's 20 cm edge band under its trim are
    //  dressing that would hide ink: not inkable, like the other stages' glazed facades)
    B(-9, 9, 0, 2.4, -47.4, -39.4, { tag: 'ops-body', color: K.ops, pattern: PATTERN.metalpanel, noPaint: [X_, _X, Z_] }),
    B(-9, 9, 2.4, 2.6, -47.4, -39.4, { tag: 'spawn-deck', color: K.spawn, pattern: PATTERN.spawn, noPaint: [X_, _X, Z_] }),
    B(-9, -3.4, 2.6, 3.4, -40.0, -39.4, { tag: 'parapet', color: K.ops, pattern: PATTERN.metalpanel }),
    B(3.4, 9, 2.6, 3.4, -40.0, -39.4, { tag: 'parapet', color: K.ops, pattern: PATTERN.metalpanel }),
    ...stairZ(0, -32.8, -39.4, 0, 2.6, 6.8, { tag: 'ops-stair' }),

    // ================= truck gate (left corner of the base): two booth islands between the lanes (the outer one's
    // far side is the quay edge of the water slot)
    B(12.4, 14.4, 0, 0.18, -45.6, -39.2, { tag: 'gate-island', color: K.kerb, pattern: PATTERN.concrete }),
    B(18.6, 20.6, 0, 0.18, -45.6, -39.2, { tag: 'gate-island', color: K.kerb, pattern: PATTERN.concrete }),

    // ================= reefer yard (right corner of the base): reefers against the back wall; the depot on the wing
    boxX(-23.6, -47.3, 20, 0, K.white, { door: 0, reefer: 1 }),
    boxX(-17.44, -47.3, 20, 0, K.white, { door: 0, reefer: 1, noPaint: [[0, 0, 1]] }),   // (its front is the REEFER TECH cabin: door, windows, AC)
    boxX(-23.6, -47.3, 20, 1, K.cream, { door: 0, reefer: 1 }),
    box(-28.9, -45.8, 20, 0, K.white, { door: 1, reefer: 1 }), box(-28.9, -45.8, 20, 1, K.cream, { door: 1, reefer: 1 }),
    box(-28.9, -39.6, 20, 0, K.white, { door: 1, reefer: 1 }),

    // ================= Block 4A (+X): 2.6 m plateau
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
    ...stairZ(RF.row0 + CW / 2, G.zs, -25.3, 0, 2.6, 2.3),
    box(RF.row0, -25.3, 40, 0, K.white, { reefer: 1 }), box(RF.row0, -13.01, 20, 0, K.white, { reefer: 1, door: 0 }),
    B(RF.alley[0], RF.alley[1], 2.45, 2.6, -25.3, -6.95, { tag: 'reefer-catwalk', color: K.steel, pattern: PATTERN.grate, grate: true }),
    box(RF.row1, G.zs, 20, 0, K.white, { reefer: 1, door: 0 }), box(RF.row1, -25.44, 40, 0, K.cream, { reefer: 1 }),
    ...stairZ(RF.row1 + CW / 2, -6.95, -13.25, 0, 2.6, 2.3),
    box(RF.row2, G.zs, 20, 0, K.white, { reefer: 1, door: 0 }), box(RF.row2, G.zs, 20, 1, K.white, { reefer: 1, door: 0 }), box(RF.row2, -25.44, 40, 0, K.white, { reefer: 1 }),
    box(RF.row2, -13.15, 20, 0, K.white, { reefer: 1 }), box(RF.row2, -13.15, 20, 1, K.cream, { reefer: 1 }),

    // ================= truck lane cover: a 20' on a skeletal chassis behind its tractor (box deck at 1.35: squids slip
    // under the chassis, its top at 3.95 is squid-only), a box the reach stacker just set down
    B(1.6, 1.6 + CW, 1.35, 1.35 + CH, -28.6, -28.6 + LEN[20], { color: K.maroon, pattern: PATTERN.container, tag: 'trailer' }),
    box(2.6, -15.2, 20, 0, K.orange),
    // a 20' just landed by the crane beside the hatch covers (its twin flanks the other side of mid)
    boxX(10.0, -3.4, 20, 0, K.blue, { door: 0 }),

    // ================= apron cover: a hatch cover set down behind the crane (left), the straddle carrier's box (right)
    B(17.2, 20.0, 0, 1.2, -27, -20, { tag: 'apron-hatch', color: K.hatch, pattern: SURF.chequer }),
    box(-21.42, -29.0, 20, 0, K.teal, { door: 1 }),
  ],
};

// ---- world layout
// 【世界化流水线】① slotSides 先剔除看不见的箱侧(在局部坐标上算,再 turn 转世界);
// ② single/half 逐件 turn() 成世界件。half 的 180° 镜像不在这里做——由 level.js 的 mirrorDef 负责。
slotSides(LOCAL);
const single = LOCAL.single.map(turn), half = LOCAL.half.map(turn);
// 【bounds AABB】把每个局部件的角点经 toWorld 投到世界并取最大 |x|/|z|(half 的镜像副本天然对称,故只算一半
// 即可覆盖两半),再加 1m 余量向上取整,得到世界坐标下的对称包围盒——level.js 用它建空间哈希与导航边界。
// bounds: the AABB of every turned piece (and its 180° twin), 1 m margin
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
// 【W 世界点助手】把局部 (x,z) 经 toWorld 转成世界点(保留给定 y),坐标四舍五入到 3 位小数——供出生点、
// 镜头等"单点"定位复用;pad 是运营楼屋顶出生台的世界坐标(其 180° 镜像即 Bravo 的出生台)。
const W = (x, y, z) => { const [a, b] = toWorld(x, z); return [+a.toFixed(3), y, +b.toFixed(3)]; };
const pad = W(0, 2.6, -43.6);

// 【CARGO = LAYOUT 汇总表】交给 level.js / 主循环消费的全部元数据,字段含义:
//   id           关卡 id 'cargo'(选关、材质换关卡、道具命名空间都靠它)
//   envBoats     false:不放通用系泊小艇(本关两舷停的是大船,由 props.js 的船体放样承担)
//   bounds       上面的世界 AABB
//   spawnPads    [pad, -pad]:两队的出生点(运营楼屋顶,互为 180° 镜像),level.js 转成 Vector3
//   spawnBarrier 出生屏障半径(开局把玩家拢在出生点附近)
//   intro        过场镜头:{ from 起点, lookFrom 看向点, toBack 回退量 }——掠过大船船艏与中场、落到楼顶
//   art          选关画面镜头:{ from, look, fov }——在卡闸侧肩上俯瞰 K7 门架、The Landing 与大船船艏
//   single/half  世界化后的几何件(level.js 消费)
//   decor        装饰表:{ lamps 街灯(空), palms 棕榈(空), flags 旗位(楼前两面,世界坐标) }
const CARGO = {
  id: 'cargo',
  envBoats: false,   // no generic moored boats: the flanks are the moored ships
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

// 【对外唯一出口】stage index 与本关其它模块都从这里取 LAYOUT。
export const LAYOUT = CARGO;
