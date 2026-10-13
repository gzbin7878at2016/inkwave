// ============================================================================
// 【中文导读】关卡陈设摆放表 —— “哪些道具放在世界的哪个位置”
// ----------------------------------------------------------------------------
// 【模块定位】数据 + 一个展开函数。数据被 src/main.js 的 _buildWorldNow() 消费:
//   对 dressingFor(layoutId) 的每一项调 PropKit.add(it.type, it) 生成道具并收集
//   碰撞盒(见 main.js 装配线第 ①步“道具先行”)。道具几何由 src/world/props.js
//   的 PropKit 程序化生成,本文件只管“摆在哪”。
// 【核心机制】
//   - DRESSING[<id>] 只写 Alpha 半场(half)的列表;dressingFor() 把每一项连同
//     其 180° 镜像副本(x,z → -x,-z,rotY + π,team 取反)一起输出,两半场逐点对称。
//   - 标了 mirror:false 的项只放一次(不在中线上的共享陈设)。
//   - EXTRA 汇总“自带摆放表的舞台包”:Halyard 的船只单独放 props-marina-vessels.js,
//     其余舞台若导出了 PLACEMENTS 也并入 —— 于是合并了手写表与舞台包两条来源。
// 【关键约定】
//   - 单位世界米、Y 向上;pos 是道具的【地面基点】(多数是底面中心;pieredge 等
//     “延伸型”run 的起点,沿局部 +X 延伸)。
//   - rotY = 0 时道具朝 +Z(镜像时自动 +π);run 型道具长度以 length 计。
//   - 每条目的字段含义见下方【字段图例】,具体取默认值由 props.js 的类型表 D 决定。
// 【配套阅读】src/world/props.js(PropKit.add 与类型表 D)、src/main.js(_buildWorldNow)、
//   src/world/props-marina-vessels.js、docs/ASSETS-WEAPONS.zh-CN.md §5.2
// ============================================================================
// Set dressing per stage: PropKit placements (see src/world/props.js). Everything listed for team 0's half is mirrored
// by the map's 180° rotation (x,z → -x,-z, rotY + π) exactly like the level blocks, so both sides stay identical.
// Only `mirror: false` items are placed once.
import { HALYARD_VESSELS } from './props-marina-vessels.js';
import { STAGES } from './stages/index.js';

const P = Math.PI;

// 【陈设总表】键 = 图 id;值是“Alpha 半场”的摆放数组(会被 dressingFor 镜像)。
// 【字段图例】(由 props.js 类型表 D 与各 build 配方解释,常用者):
//   type      道具类型名,查 PropKit 类型表 D(如 'bench' / 'pieredge' / 'trawler')
//   pos       [x, y, z] 世界坐标地面基点(米);run 型为起点
//   rotY      绕 Y 的朝向(弧度);0 = 朝 +Z;镜像时自动 +π
//   team      归属队(0/1);缺省 = 中立;镜像时取反
//   length/width/run/rise/thick  尺寸类(随 type 解释,如 pieredge 的护栏长度)
//   s0/s1     延伸型 run 两端内缩量(米);0.75 = 让护栏离角一定距离
//   ext0/ext1 端点相对分界线的外/内缩(米),用于凹角“让位/顶死”相邻护栏
//   cleats/fenders/ladders/skip  run 上的系缆桩/防撞垫/爬梯位置、需跳过的区段(局部 X 上)
//   variant/color/count/…  透传给该 type 的造型参数
//   mirror:false  该项不再生成镜像副本(只放一次)
export const DRESSING = {
  halyard: [
    // owner: docks stream (src/world/props-marina-dock.js). Alpha half; every entry is mirrored (x,z → -x,-z).
    // ---- pier edges: `pieredge` runs start on the deck edge and run along local +X with the water on local +Z.
    //      Concave corners: one run keeps its whaler to the corner (ext 0, first pile 0.75 in), the other butts into it
    //      (ext -0.1); convex corners: one run wraps the corner (ext 0.1). Jump edges carry nothing on the deck.
    // quay front (basin)
    { type: 'pieredge', pos: [-19.5, 0, -31], rotY: 0, length: 15, s0: 0.75, s1: 0.75, cleats: [3.2, 8.6], fenders: [1.9, 5.3, 12] },
    { type: 'pieredge', pos: [4.5, 0, -31], rotY: 0, length: 5.5, s0: 0.75, s1: 0.75 },
    // fuel dock: west side (fuel berth, D-fender), east side (jump edge x = 4.5), mid end (gangway)
    { type: 'pieredge', pos: [-4.5, 0, -31], rotY: -P / 2, length: 18.6, ext0: -0.1, ext1: -0.1, dfender: true, cleats: [4.2, 9.4, 14.6], ladders: [2.2] },
    { type: 'pieredge', pos: [-4.5, 0, -10.4], rotY: -P / 2, length: 1.8, ext0: -0.1, dfender: true },
    { type: 'pieredge', pos: [4.5, 0, -26], rotY: P / 2, length: 5, ext0: -0.1, ext1: -0.1, dfender: true },
    { type: 'pieredge', pos: [4.5, 0, -8.6], rotY: P / 2, length: 15.4, ext1: -0.1, dfender: true },
    { type: 'pieredge', pos: [-4.5, 0, -8.6], rotY: 0, length: 9, ext0: 0.1, ext1: 0.1, skip: [[2.5, 6.5]], dfender: true },
    // long pier inner side (houseboat berth), finger pier, boardwalk
    { type: 'pieredge', pos: [-19.5, 0, -26.4], rotY: P / 2, length: 4.6, ext0: -0.1, ext1: -0.1 },
    { type: 'pieredge', pos: [-19.5, 0, -12.4], rotY: P / 2, length: 12.8, ext0: -0.1, ext1: -0.1, skip: [[5.4, 7.4]], cleats: [2.4, 10.4], fenders: [3.9, 9.2] },
    { type: 'pieredge', pos: [-19.5, 0, 0], rotY: P / 2, length: 10.4, ext1: -0.1 },
    { type: 'pieredge', pos: [-19.5, 0, -25.2], rotY: 0, length: 7, s0: 0.75, ext1: 0.1, cleats: [2.6, 5.9], fenders: [1.6, 4.3] },
    { type: 'pieredge', pos: [-12.5, 0, -26.4], rotY: P, length: 7, ext0: 0.1, s1: 0.75, cleats: [1.1, 4.4], fenders: [2.7, 5.4], ladders: [6.1] },
    { type: 'pieredge', pos: [-12.5, 0, -25.2], rotY: P / 2, length: 1.2 },
    { type: 'pieredge', pos: [-19.5, 0, -10.4], rotY: 0, length: 15, s0: 0.75, s1: 0.75, cleats: [4.1, 10.9] },
    { type: 'pieredge', pos: [-4.5, 0, -12.4], rotY: P, length: 15, s0: 0.75, s1: 0.75, cleats: [4.1, 10.9], fenders: [7.5] },
    // boatyard: west side (jump edge z -24…-8.6), north end, strip (jump edge to the ferry, plank landing)
    { type: 'pieredge', pos: [10, 0, -31], rotY: -P / 2, length: 5, ext0: -0.1, ext1: -0.1 },
    { type: 'pieredge', pos: [10, 0, -24], rotY: -P / 2, length: 17, ext0: -0.1 },
    { type: 'pieredge', pos: [10, 0, -7], rotY: 0, length: 9.5, ext0: 0.1, s1: 0.75, cleats: [2.2] },
    { type: 'pieredge', pos: [19.5, 0, -7], rotY: -P / 2, length: 7, ext0: -0.1, skip: [[1.9, 4.6]] },
    // walkway fuel dock ↔ yard
    { type: 'pieredge', pos: [4.5, 0, -24], rotY: 0, length: 5.5, s0: 0.75, s1: 0.75 },
    { type: 'pieredge', pos: [10, 0, -26], rotY: P, length: 5.5, s0: 0.75, s1: 0.75 },
    // arena perimeter (outer edges): tall capped piles
    { type: 'pieredge', pos: [-24, 0, -51.95], rotY: -P / 2, length: 51.95, outer: true, cleats: [10.5, 27.5, 43.5] },
    { type: 'pieredge', pos: [24, 0, 0], rotY: P / 2, length: 51.95, outer: true, spacing: 4.0, cleats: [8.5, 24.5, 30.0] },   // 4.0: vessels' marina gangway (z -37.9) sits between the piles at z -35.85 / -39.8
    { type: 'pieredge', pos: [24, 0, -51.95], rotY: P, length: 48, outer: true, ext0: 0.1, ext1: 0.1, spacing: 6.0, wraps: false },
    // ---- clubhouse (facade fittings on the back wall + upper storey / roofs / cupola / flagstaff behind it, collides)
    { type: 'clubhouse', pos: [0, 0, -45.4], rotY: 0 },
    // terrace: planters with little trees at the back corners (outside the 4.2 m spawn circle)
    { type: 'planter', pos: [-6.4, 2.4, -44.72], rotY: 0, variant: 2, color: 'tealdark' },
    { type: 'planter', pos: [6.4, 2.4, -44.72], rotY: 0, variant: 2, color: 'tealdark' },
    // ---- quay: boathouse + harbour office dressing, café terrace, benches, bins, bikes, kayaks, site map
    { type: 'boathouse', pos: [18.5, 0, -43.0], rotY: 0 },
    { type: 'harbouroffice', pos: [-19.8, 0, -42.9], rotY: 0 },
    { type: 'cafeset', pos: [-15.35, 0, -43.55], rotY: 0.3, variant: 0 },
    { type: 'cafeset', pos: [-14.0, 0, -41.7], rotY: 0.9, variant: 1 },
    { type: 'aboard', pos: [-11.75, 0, -44.75], rotY: 0.25 },
    { type: 'planter', pos: [-10.0, 0, -44.95], rotY: 0, length: 1.2, width: 0.6, variant: 1, color: 'tealdark' },
    { type: 'bench', pos: [-15.4, 0, -31.75], rotY: 0 },
    { type: 'bench', pos: [-8.9, 0, -31.75], rotY: 0 },
    { type: 'bench', pos: [7.6, 0, -31.75], rotY: 0 },
    { type: 'trashbin', pos: [-13.95, 0, -31.95] },
    { type: 'trashbin', pos: [9.05, 0, -32.0] },
    { type: 'bikerack', pos: [10.85, 0, -44.55], count: 2, bikes: 0 },
    { type: 'scooter', pos: [12.05, 0, -44.7], rotY: 0.12, variant: 0 },
    { type: 'kayakrack', pos: [23.25, 0, -43.0], rotY: P / 2 },
    { type: 'surfrack', pos: [14.18, 0, -42.1], rotY: -P / 2, variant: 1 },
    { type: 'mapboard', pos: [-23.35, 0, -34.2], rotY: P / 2 },
    // ---- dock hardware: shore power at the berths, bollard lights + life rings on the edges, mooring bitts
    { type: 'shorepower', pos: [-19.88, 0, -22.3], rotY: P / 2, berth: 'H1' },
    { type: 'shorepower', pos: [-17.2, 0, -31.38], rotY: 0, berth: 'Q4' },
    { type: 'bollardlight', pos: [-23.72, 0, -27.0] },
    { type: 'bollardlight', pos: [-23.72, 0, -13.0] },
    { type: 'bollardlight', pos: [23.72, 0, -27.5] },
    { type: 'bollardlight', pos: [23.72, 0, -15.5] },
    { type: 'bollardlight', pos: [-4.15, 0, -26.0] },
    { type: 'lifering', pos: [-23.6, 0, -21.0], rotY: P / 2 },
    { type: 'bollard', pos: [-23.55, 0, -38.0], variant: 2 },
    { type: 'bollard', pos: [23.55, 0, -34.0], variant: 2 },
    // ---- boatyard: travel lift over the yard entrance (legs collide, beams ≥ 5.4 m), workbench + washer between its
    //      west legs at the water's edge, laid-up launch under a tarp at the yard edge, scaffold at the tug's bow beside
    //      (not on) the ramp, drums by the tug's stern (the tug's own stands, cribbing and ladder come from vessels)
    { type: 'travellift', pos: [13.6, 0, -29.0], rotY: 0 },
    { type: 'tarpboat', pos: [23.2, 0, -11.4], rotY: P / 2 },
    { type: 'scaffold', pos: [19.66, 0, -12.36], rotY: 0 },
    { type: 'workbench', pos: [10.45, 0, -29.45], rotY: P / 2, washerSide: -1 },
    { type: 'barrel', pos: [21.1, 0, -23.25], rotY: P / 2, variant: 1, color: '#3f6fb0', color2: '#c9453b' },
    // ---- ramps (dressing outside the walking widths; handrails carry rail colliders): grand stair balustrade, fuel-dock
    //      gangway rails, houseboat gangway rails (land1: its high end lands on the houseboat deck edge 0.25 before the top)
    { type: 'grandstair', pos: [0, 0, -32.4], rotY: P, run: 6.1, rise: 2.4, width: 6 },
    { type: 'gangwayrails', pos: [0, 0, -8.8], rotY: 0, run: 3.85, rise: 1.3, width: 3.4, thick: 0.22, posts: 5 },
    { type: 'gangwayrails', pos: [-19.7, 0, -18.8], rotY: P / 2, run: 2.35, rise: 0.7, width: 1.6, thick: 0.18, posts: 3, land1: 2.1 },
    // ---- harbour beacon crown (the beacon block straddles the lane seam; the mirror copy dresses the far one)
    { type: 'beacon', pos: [-22.6, 0, 0], rotY: 0 },
    // ---- outside the arena: breakwater arm with a green pier-head light, channel markers
    { type: 'breakwater', pos: [42, 0, -62], rotY: 0, length: 72 },
    { type: 'channelmarker', pos: [37.0, -1.6, 21.5], variant: 0 },
    { type: 'channelmarker', pos: [31.0, -1.6, 17.0], variant: 1 },
    // ---- required cover (gameplay footprints from docs/HALYARD.md — colliders are exact)
    { type: 'fuelpump', pos: [3.5, 0, -13.8], rotY: 0, price: '1.89' },
    { type: 'fuelpump', pos: [-3.5, 0, -13.8], rotY: P, price: '1.89' },
    { type: 'dockbox', pos: [-23.1, 0, -7.5], rotY: P / 2 },
    { type: 'pumpout', pos: [-22.7, 0, -19.0], rotY: P / 2 },
    { type: 'keelblocks', pos: [11.9, 0, -10.8], rotY: 0 },
    { type: 'quaycrates', pos: [-11.7, 0, -34.4], rotY: 0, variant: 0 },
    { type: 'quaycrates', pos: [11.5, 0, -35.6], rotY: 0, variant: 1 },
    // ---- fuel dock: hut kit (roof sign + roof kit collide), ice chest + bait cooler, landmark sign, life ring
    { type: 'fuelhut', pos: [0, 0, -20.65], rotY: 0 },
    { type: 'cooler', pos: [-0.85, 0, -22.9], rotY: P, variant: 1 },
    { type: 'cooler', pos: [-0.55, 0.94, -22.85], rotY: P + 0.18, variant: 0, color: 'teal' },
    { type: 'fueldocksign', pos: [-4.2, 0, -9.3], rotY: 0 },
    { type: 'lifering', pos: [-4.12, 0, -16.6], rotY: P / 2 },
  ],
};

// stage packs that own their own placement lists
// 【外挂摆放表】Halyard 的船只列表来自 props-marina-vessels.js;其余舞台若导出了
// PLACEMENTS 也并入 EXTRA —— 于是 dressingFor 统一从两条来源取数。
const EXTRA = { halyard: HALYARD_VESSELS };
for (const [id, st] of Object.entries(STAGES)) if (st.PLACEMENTS) EXTRA[id] = st.PLACEMENTS;

// Expand the half-list into world placements for both halves.
// 【展开为全场摆放】合并手写表与舞台包列表后,逐项输出:原项 + 其 180° 镜像副本
// (pos 取相反数、rotY + π、team 取反);mirror:false 的项跳过镜像只放一次。
export function dressingFor(layoutId) {
  const src = [...(DRESSING[layoutId] || []), ...(EXTRA[layoutId] || [])];
  const out = [];
  for (const it of src) {
    out.push(it);
    if (it.mirror === false) continue;
    const [x, y, z] = it.pos;
    out.push({ ...it, pos: [-x, y, -z], rotY: (it.rotY || 0) + P, team: it.team === undefined ? undefined : 1 - it.team });
  }
  return out;
}
