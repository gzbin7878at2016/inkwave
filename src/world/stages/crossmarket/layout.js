// ============================================================================
// 【中文导读】Crossroads Market(十字路口市集)—— 关卡几何 layout,本关"市集/街区"场景的地基文件
// ----------------------------------------------------------------------------
// 【模块定位】属于世界层 src/world/stages/crossmarket/ 的关卡定义;由关卡装配流程加载,导出 LAYOUT
//   (供 level.js / maps.js 消费:构建地形盒、碰撞、可涂面、出生点、缩略图机位)。它是本目录的"契约源头"。
//   整个 crossmarket 目录的分工与依赖顺序(即下方英文头的 folder contract 中文版)——
//     ① layout.js(本文件)  关卡几何:地面、巷道、建筑体块、楼梯、坡道;并定义 tramway 坐标架 TH/T()/TB()
//     ② kit.js             共享"建筑工具箱" makeKit():调色板 K + 笔画字体 glyph/letters + 门/窗/店招/
//                          雨篷/阳台/屋顶等积木,供 ③④⑤ 使用
//     ③ buildings.js       crossmarket_house(民房外装)与市政件:stonestair / ironstair / veranda /
//                          exchange / podium / arcade / passage / pergola
//     ④ hall.js            Market Hall 中央地标(180° 自对称,只放一次)
//     ⑤ tram.js            No.3 电车 + 接触网支柱 + 电车亭 + 售票亭 + 缓冲挡 + 架空线
//     ⑥ street.js          街道家具:货摊/推车/喷泉/煤气灯/护柱/长椅/铁栏/石栏/报亭/广告柱/板条箱…
//     ⑦ scenery.js         港口对岸远景房屋(边界外,纯装饰)
//     ⑧ landing.js         Zone Control 专属:市场驳船 + 阶梯货箱 + 吊装平台
//     ⑨ props.js           道具备注入口 register(D,H) + 全部摆位表 PLACEMENTS
//     ⑩ surfaces.js        本关三种纹理槽(setts/ashlar/tramway)的 GLSL 材质
//     ⑪ murals.js          本关壁画/招牌(壁画图集 id 4…11)
//   依赖方向:layout(无依赖)← kit ← {buildings, hall, tram, street, scenery, landing} ← props;
//   surfaces 被 layout 直接 import(取 SURF.setts 等);murals 独立,由舞台装配时镜像加载。
// 【核心机制】一张【朝向盒(oriented box)】列表 half[]:每项由 B/R/O 描述一段静态地形。整表按 Y 轴
//   180° 旋转镜像((x,z) → (-x,-z))得到另一半场地,使两队拥有完全相同、公平的竞技场。tramway 以斜穿
//   城镇的对角线布置(≈31°,过原点),用局部坐标架 T(u,v)/TB() 把"沿线 u / 跨线 v"换算成世界 (x,z)。
// 【关键约定】
//   · 米制;Y 轴向上;pos/中心均为基点。
//   · 镜像:【half 中每一半必须严格一致】——任何单侧改动都要保证 180° 旋转后两半互为镜像(布局、道具、
//     可涂面、出生点皆然);个别条目 mirror:false 表示"全场地共用一件、不镜像"(如居中的 Market Hall
//     与 No.3 电车,它们本身 180° 自对称)。
//   · 可玩墙面与采样:盒的面默认 paint:true,即该面【可上墨】;上层建筑用 paint:false + roof:true 标为
//     "不可上墨的禁区顶"(落到上面会滑落)。墨被画在"面空间"(每面在图集上占一块矩形),故墙/地连续;
//     mural 字段给出该面在壁画图集里的贴花 id 与法线(n)。详细采样规则见 src/world/levelMaterial.js、
//     src/world/paint.js 与 docs/INK.zh-CN.md。
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md §2.2(世界层)、docs/INK.zh-CN.md(墨水系统)、
//   docs/ASSETS.zh-CN.md;兄弟文件 ./kit.js、./props.js、./surfaces.js、./murals.js;../../mapkit.js(B/R/O)。
// ============================================================================
// Crossroads Market — stage layout (src/world/stages/crossmarket/). The stage owns every file in this folder:
//   layout.js    level geometry (this file)        props.js    prop pack + placements (set dressing)
//   surfaces.js  stage surface materials (texlib)  murals.js   stage decals / signage (mural atlas)
import { PATTERN, B, R, O } from '../../mapkit.js';
import { SURF } from './surfaces.js';

// 【关卡总述】老港镇的市集区:Market Street(沿 Z,从出生点到出生点)与 Tram Street 斜交——tramway 斜穿
// 城镇(≈31° 偏 X 轴,过中心),故十字路口呈 X 形。铸铁-玻璃的 Market Hall 正对 tramway 跨在路口上,No.3
// 电车停在它的钟楼灯下;对角线把两侧街区切成楔形,留下小块楔形广场;tramway 两端各自伸到海港栈桥上,旁边
// 切进一个船坞水池。这是【近战图】:短视距、转角、小巷与廊道,高度来自一条外廊画廊与一处屋顶平台。
// Crossroads Market — the market quarter of an old harbour town where Market Street (along Z, spawn to spawn) crosses
// Tram Street at an angle: the tramway runs DIAGONALLY through the town (≈31° off the X axis, through the centre) so
// the crossroads is an X. The cast-iron-and-glass Market Hall sits on the crossing turned square to the tramway, with
// the No. 3 tram standing under its clock lantern; the blocks either side are cut into wedges by the diagonal, leaving
// small wedge plazas; the tramway runs out onto a pier at each end over the harbour, and a dock basin cuts in beside it.
// The CLOSE-QUARTERS map: short sightlines, corners, alleys and covered ways, height from a gallery and a roof terrace.
//   • spawn: the Corn Exchange's first-floor terrace (2.6) — grand stair down to Exchange Square, a side flight on the
//     left, and the Arcade Gallery (an iron veranda at first floor) straight off the right end of the terrace
//   • centre lane: Market Street — the fountain, an island row of stalls, then the hall's corner: the street splits
//     round it, into the hall (stalls, the tram as cover; its roof is squid-only high ground) or along the tramway
//   • right lane (−X for Alpha): Fish Lane beside the covered fish-market arcade, out to the tramway where it runs
//     onto its pier; the wedge-shaped fish court between the butcher's and the florist's (turned to the tramway) cuts
//     through to Market Street, with an iron stair up to the gallery
//   • left lane (+X for Alpha): the flank street under the café roof terrace (2.6, stairs at both ends, a bridge over
//     the Market Passage) and the Parade (1.2) along the harbour, down to the dock basin; the flank street runs on
//     past the half line to cross the tramway
// Heights: 0 (setts) · 0.1 (tramway bed + hall floor) · 0.15 (pavements, arcade) · 0.3 (tram stop) · 1.2 (Parade)
// · 2.6 (spawn, gallery, terrace) · 3.0 (tram roof). Buildings above their ground floors are out of play (paint: false,
// roof: true); every railing is a `rail` (props).

// 【高度分层常量】FL 为首层高度(出生平台/外廊/屋顶平台同高),K 为人行道牙坎高度。
const FL = 2.6;   // first-floor level: spawn terrace, veranda, roof terrace
const K = 0.15;   // pavement kerb
// 【调色板 CM】本关所有盒体/道具的基色;由 layout 定义、被 props.js 复用(保持关卡与摆位同一套色调)。
const CM = {
  setts: '#a39a8e', flags: '#d3c8b3', ashlar: '#dccfb2', rose: '#d8b9a2', ochre: '#d9ae6c', blue: '#a9bcc4', cream: '#e8dfcc',
  brick: '#b8765c', spawn: '#eae6de', step: '#d6ccb6', iron: '#3c5a4c', tramGreen: '#3f6b55', tramCream: '#ece2c8',
  timber: '#9c7a56',
};
// 【bldg 建筑体块助手】把一段街区拆成两层盒:① 0…FL 的可上墨首层(paintable 店面)+ ② FL…eave 的
// 上层(不可上墨、roof 禁区顶)。冠部是屋顶坡度道具的碰撞体,同样打 roof 标。o 透传额外字段(如 tag、
// noPaint 指定某些面不刷漆、mural 贴壁画)。
// a building: paintable ground floor (0 … FL) + upper storeys that take no ink (FL … eave) with an off-limits top
// (roof: never inked, anyone landing there slides off; the pitched roofs above are prop colliders, also roof-flagged)
const bldg = (x0, x1, z0, z1, eave, color, pattern = SURF.ashlar, o = {}) => [
  B(x0, x1, 0, FL, z0, z1, { color, pattern, ...o }),
  B(x0, x1, FL, eave, z0, z1, { color, pattern, paint: false, roof: true, ...o }),
];

// 【tramway 坐标架】TH 为 tramline 相对 X 轴的角度(atan(0.6)≈30.96°);T(u,v) 把"沿线 u、跨线 v"换算成
// 世界 (x,z)(标准 2D 旋转);TB() 在道砟坐标架内放一个 y0…y1、u0…u1、v0…v1 的朝向盒(用 O 按 DEG 度旋转)。
// 常量 BED=0.1 为道砟与 Hall 地板高出铺石的高度;TW=4 为 tramway 半宽(含轨道两侧铺石到路缘)。
// the tramway frame: u along the tram line (through the origin, rising toward +X +Z), v across it (+v toward +Z)
export const TH = Math.atan(0.6);                       // ≈ 30.96° off the X axis
const CT = Math.cos(TH), ST = Math.sin(TH), DEG = (-TH * 180) / Math.PI;
export const T = (u, v) => [u * CT - v * ST, u * ST + v * CT];          // tramway frame → world (x, z)
// box in the tramway frame: u0…u1 along the line, v0…v1 across (a turned piece)
const TB = (u0, u1, y0, y1, v0, v1, o) => { const [cx, cz] = T((u0 + u1) / 2, (v0 + v1) / 2); return O(cx, cz, u1 - u0, v1 - v0, y0, y1, DEG, o); };
const BED = 0.1;                                         // tramway bed + hall floor sit 10 cm proud of the setts
const TW = 4;                                            // tramway half-width (track + setts to the kerbs)

// 【关卡对象 CROSSMARKET】id/bounds/spawnPads/spawnBarrier 为关卡元数据;intro/art 为开场运镜与选关图;
// single 为不参与镜像的单件(No.3 电车);half 为半场朝向盒表(会被 180° 镜像成两半);decor 为装饰占位。
const CROSSMARKET = {
  id: 'crossmarket',
  bounds: { minX: -31, maxX: 31, minZ: -44, maxZ: 44 },
  spawnPads: [[0, FL, -40.2], [0, FL, 40.2]],
  spawnBarrier: 4.2,
  // match intro: opens over the plaza by the hall's corner, on the clock lantern, then sweeps back to your spawn
  intro: { from: [16, 14, -16], lookFrom: [0, 4, 0], toBack: 3.0 },
  // stage-select picture: from over the tramway's pier, down the diagonal tram line to the hall + its clock lantern
  art: { from: [34, 15.5, 18.5], look: [0, 3.2, -4], fov: 54 },
  single: [
    // 【single 单件】No.3 电车,停在 Market Hall 站、恰在路口下方,随 tramway 转向。双端(自对称),深绿车
    // 身裙板 + 米色客室、圆端司机室;车顶只对 squid 开放。四项皆为 tramway 坐标架内的朝向盒(车身下/上、
    // 两端司机室),由 hullpaint 纹理涂装。
    // the No. 3 tram standing at the Market Hall stop, right under the crossing, turned with the tramway: double-ended
    // (self-symmetric), bottle-green rocker panels under a cream saloon, rounded cab ends; its roof is squid-only
    TB(-5, 5, 0, 1.15, -1.2, 1.2, { color: CM.tramGreen, pattern: PATTERN.hullpaint, tag: 'tram-lower' }),
    TB(-5, 5, 1.15, 3.0, -1.2, 1.2, { color: CM.tramCream, pattern: PATTERN.hullpaint, tag: 'tram-upper' }),
    TB(5, 5.6, 0, 3.0, -0.9, 0.9, { color: CM.tramCream, pattern: PATTERN.hullpaint, tag: 'tram-cab' }),
    TB(-5.6, -5, 0, 3.0, -0.9, 0.9, { color: CM.tramCream, pattern: PATTERN.hullpaint, tag: 'tram-cab' }),
  ],
  half: [
    // 【地面层 setts】轴对齐的铺石地面盒。船坞水池切进 tramway 栈桥与对侧 Parade 之间(x −24…−15),故每条
    // 侧街都止于水边、折上对角 tramway。
    // ================= ground: the setts (axis blocks); a dock basin cuts in between the tramway pier and the other
    // team's Parade (x -24 … -15), so each flank street ends at the water and bends onto the diagonal tramway
    B(-24, 24, -1.2, 0, -44, -20, { color: CM.setts, pattern: SURF.setts, tag: 'streets' }),
    B(-15, 24, -1.2, 0, -20, 0, { color: CM.setts, pattern: SURF.setts, tag: 'streets' }),
    B(-19.5, -15, -1.2, 0, -20, -7.05, { color: CM.setts, pattern: SURF.setts, tag: 'streets' }),
    B(-24, -19.5, -1.2, 0, -20, -16.3, { color: CM.setts, pattern: SURF.setts, tag: 'streets' }),

    // 【tramway 道砟(转向)】轨道条带 + 两侧到路缘的铺石,高出地面 10 cm,两端各自伸到海港上的栈桥。道砟
    // 穿过 Hall 时露出 Hall 的方石地板(mosaic 门槛带);栈桥甲板板藏在抬高道砟下方 5 cm,由海面遮罩/泡沫/
    // 桩柱勾出甲板轮廓;13…21 段为电车停靠站台(亭与旗是道具)。
    // ================= the tramway (turned): track strip + setts to the kerbs, 10 cm proud, running out onto a pier
    // over the harbour at each end; the Market Hall's flagged floor where it crosses the hall (mosaic thresholds)
    TB(-33, 0, -1.2, BED, -1.25, 1.25, { color: CM.setts, pattern: SURF.tramway, tag: 'tramway' }),
    // the pier's deck slab under the raised bed (top -0.1, 5 cm inside it: fully hidden) — what the sea masking, foam and
    // pilings read as the deck outline where the tramway runs out over the water
    TB(-32.95, 0, -1.2, -0.1, -TW + 0.05, TW - 0.05, { color: CM.setts, pattern: SURF.setts, tag: 'tramway-deck' }),
    TB(-33, -9, -1.2, BED, 1.25, TW, { color: CM.setts, pattern: SURF.setts, tag: 'tramway-setts' }),
    TB(-33, -9, -1.2, BED, -TW, -1.25, { color: CM.setts, pattern: SURF.setts, tag: 'tramway-setts' }),
    TB(-4.5, 0, -1.2, BED, -7, -6, { color: CM.flags, pattern: SURF.ashlar, tag: 'hall-floor', mural: [{ n: [0, 1, 0], id: 7 }] }),
    TB(-4.5, 0, -1.2, BED, 6, 7, { color: CM.flags, pattern: SURF.ashlar, tag: 'hall-floor', mural: [{ n: [0, 1, 0], id: 7 }] }),
    TB(-9, -4.5, -1.2, BED, -7, -6, { color: CM.flags, pattern: SURF.ashlar, tag: 'hall-floor' }),
    TB(-9, -4.5, -1.2, BED, 6, 7, { color: CM.flags, pattern: SURF.ashlar, tag: 'hall-floor' }),
    TB(-9, 0, -1.2, BED, -6, -1.25, { color: CM.flags, pattern: SURF.ashlar, tag: 'hall-floor' }),
    TB(-9, 0, -1.2, BED, 1.25, 6, { color: CM.flags, pattern: SURF.ashlar, tag: 'hall-floor' }),
    // tram stop platform on the tramway's kerb (shelter + flag are props)
    TB(13, 21, 0, 0.3, -3.9, -2.3, { color: CM.flags, pattern: SURF.ashlar, tag: 'tram-platform' }),

    // 【出生点】Corn Exchange 一层平台(FL):大台阶、侧梯、外廊。R() 是坡道板(ramp slab),此处用 stonestep
    // 纹理充当台阶;两侧各是一栋民房体块(bldg)。
    // ================= spawn: the Corn Exchange terrace (first floor) — grand stair, side flight, the veranda
    B(-9, 9, 0, 2.4, -44, -36, { color: CM.ashlar, pattern: SURF.ashlar, tag: 'spawn-terrace-body' }),
    B(-9, 9, 2.4, FL, -44, -36, { color: CM.spawn, pattern: PATTERN.spawn, tag: 'spawn-terrace' }),
    R([0, 0, -29.8], [0, FL, -36], 4.4, { color: CM.step, pattern: PATTERN.stonestep, tag: 'grand-stair' }),
    R([7, 0, -29.8], [7, FL, -36], 2.8, { color: CM.step, pattern: PATTERN.stonestep, tag: 'side-flight' }),

    // 【出生点两侧的背角】BL(+X 赭色抹灰)/ BR(−X 砖)两栋体块,由 bldg() 展开。
    // ================= back corners either side of the spawn
    ...bldg(9, 24, -44, -36, 8.6, CM.ochre, PATTERN.render, { tag: 'BL' }),
    ...bldg(-24, -9, -44, -36, 9.2, CM.brick, PATTERN.brick, { tag: 'BR' }),

    // 【右翼(−X)】Fish Lane + 海滨排屋下的拱廊(arcade,止于 tramway);.map() 一行生成一排拱廊墩柱。
    // ================= right flank (−X): Fish Lane + the arcade under the sea-front row (ends at the tramway)
    B(-24, -23.2, 0, 2.8, -36, -20, { color: CM.cream, pattern: SURF.ashlar, tag: 'arcade-back' }),
    B(-23.2, -19.4, 0, K, -36, -20, { color: CM.flags, pattern: SURF.ashlar, tag: 'arcade-floor' }),
    ...[-35.9, -32.1, -28.3, -24.5, -20.7].map((z) => B(-20.2, -19.4, K, 2.8, z, z + 0.7, { color: CM.cream, pattern: SURF.ashlar, tag: 'arcade-pier' })),
    B(-24, -19.4, 2.8, 8.2, -36, -20, { color: CM.cream, pattern: SURF.ashlar, paint: false, roof: true, tag: 'arcade-upper' }),

    // 【右街区(−X)】R2(南,正对 Market Street)+ 楔形鱼市小院 + R1(北,转向 tramway);Market Street 上方的
    // 外廊。注意:外廊/通道桥下方的墙 noPaint(不打漆)——在那里墨爬只会撞到天花板(U 型字面朝内造成)。
    // ================= right block (−X): R2 (south, square to Market Street), the wedge-shaped fish court, R1 (north,
    // turned to the tramway); the veranda over Market Street
    // (walls under the gallery / the passage bridge take no ink: an ink-climb there only hits the ceiling)
    B(-15, -6, 0, FL, -28, -23, { color: CM.rose, pattern: SURF.ashlar, tag: 'R2', noPaint: [[1, 0, 0]] }),
    B(-15, -6, FL, 8.0, -28, -23, { color: CM.rose, pattern: SURF.ashlar, paint: false, roof: true, tag: 'R2', mural: [{ n: [-1, 0, 0], id: 5 }] }),
    TB(-19.9, -12.9, 0, FL, -9.2, -TW, { color: CM.blue, pattern: PATTERN.render, tag: 'R1' }),
    TB(-19.9, -12.9, FL, 7.6, -9.2, -TW, { color: CM.blue, pattern: PATTERN.render, paint: false, roof: true, tag: 'R1' }),
    B(-6, -3.8, 0, K, -28, -12, { color: CM.flags, pattern: SURF.ashlar, tag: 'pavement' }),
    B(-6, -3.8, 2.3, FL, -36, -19, { color: CM.iron, pattern: PATTERN.planks, tag: 'veranda' }),
    R([-4.9, 0, -12.8], [-4.9, FL, -19], 2.2, { color: CM.iron, pattern: PATTERN.treads, thin: true, thickness: 0.22, tag: 'veranda-stair' }),
    R([-12.4, 0, -21.9], [-6, FL, -21.9], 2.0, { color: CM.iron, pattern: PATTERN.treads, thin: true, thickness: 0.22, tag: 'court-stair' }),

    // 【左街区(+X)】Market Street 上的高排屋(中间有通道 Market Passage),店面上方是屋顶平台;LA/LB 两段
    // 首层各有一面 noPaint,上层 L-upper 带两处 mural 贴花(4/6 号)。
    // ================= left block (+X): tall row on Market Street (passage through), roof terrace over the shops
    B(6, 10.5, 0, FL, -28, -21, { color: CM.cream, pattern: PATTERN.render, tag: 'LA', noPaint: [[0, 0, 1]] }),
    B(6, 10.5, 0, FL, -18, -12, { color: CM.cream, pattern: PATTERN.render, tag: 'LB', noPaint: [[0, 0, -1]] }),
    B(6, 10.5, FL, 8.4, -28, -12, { color: CM.cream, pattern: PATTERN.render, paint: false, roof: true, tag: 'L-upper', mural: [{ n: [0, 0, -1], id: 4 }, { n: [0, 0, 1], id: 6 }] }),
    B(10.5, 15, 0, FL, -28, -21, { color: CM.ashlar, pattern: SURF.ashlar, tag: 'terrace-A', noPaint: [[0, 0, 1]] }),
    B(10.5, 15, 0, FL, -18, -16, { color: CM.ashlar, pattern: SURF.ashlar, tag: 'terrace-B', noPaint: [[0, 0, -1]] }),
    B(10.5, 15, 2.2, FL, -21, -18, { color: CM.ashlar, pattern: SURF.ashlar, tag: 'passage-bridge' }),
    R([12.75, 0, -34.2], [12.75, FL, -28], 4.5, { color: CM.step, pattern: PATTERN.stonestep, tag: 'terrace-stair' }),
    R([12.75, 0, -9.8], [12.75, FL, -16], 4.5, { color: CM.step, pattern: PATTERN.stonestep, tag: 'terrace-stair' }),
    B(3.8, 6, 0, K, -28, -12, { color: CM.flags, pattern: SURF.ashlar, tag: 'pavement' }),

    // 【左翼(+X)】The Parade(抬高 1.2 的海港步道)向下通到船坞水池;两端各一段石梯。
    // ================= left flank (+X): the Parade (raised harbour walk) down to the dock basin
    B(19.5, 24, 0, 1.2, -30, -6, { color: CM.flags, pattern: SURF.ashlar, tag: 'parade' }),
    R([21.75, 0, -33], [21.75, 1.2, -30], 4.5, { color: CM.step, pattern: PATTERN.stonestep, tag: 'parade-stair' }),
    R([21.75, 0, -3], [21.75, 1.2, -6], 4.5, { color: CM.step, pattern: PATTERN.stonestep, tag: 'parade-stair' }),

    // 【仅 Zone Control】onlyIn:'zones'(见 src/world/variants.js):电车栈桥旁的货物装卸区(侧区)。市场吊装
    // 平台立于船坞水池中的桩上、外挑过栈桥边 0.9 m、高 3 m(一个真实可上墨的侧区位置)。市场驳船泊在它外侧、
    // 离栈桥 4.5 m 的水面上(小孩跳不到,连栈桥栏杆也够不着),载着阶梯状货箱(其台阶即碰撞体),由对队码头
    // 从舷梯登上。进攻方爬箱(0.6/1.5/2.35)上平台再跳进侧区;单向下落:平台比栈桥甲板高 3.0、比栏杆顶高
    // 1.95(小孩够不着),且平台立于水中桩上——无墙可爬墨。道具见 landing.js。
    // ================= ZONE CONTROL ONLY (onlyIn: 'zones', src/world/variants.js): the goods landing beside the tram
    // pier (the side zone). The market's hoist stage stands on piles in the dock basin and overhangs the pier edge by
    // 0.9 m, 3 m up (a real, inkable position over the zone). The market lighter lies off its outer side, 4.5 m of
    // water out from the pier (beyond a kid's jump, even off the pier railing), laden with a stepped stack of stock
    // (crossmarket_cargo: the steps are its colliders), boarded by a gangplank from the other team's quay at the foot
    // of their Parade stair. Attackers climb the crates (0.6 / 1.5 / 2.35) onto the stage and drop into the zone. The
    // drop is one way: 3.0 m up from the pier deck, 1.95 m over the pier railing's top (out of a kid's reach), and the
    // stage stands on piles in the water: no wall to ink-climb. Props: landing.js (hull, cargo, piles, crane, rails).
    TB(-27.5, -23.7, 2.8, 3.1, 3.05, 8.25, { color: CM.timber, pattern: PATTERN.planks, tag: 'hoist-stage', onlyIn: 'zones' }),
    TB(-27.2, -20.45, -0.9, -0.3, 8.45, 11.55, { color: CM.timber, pattern: PATTERN.planks, tag: 'lighter-deck', onlyIn: 'zones' }),
    R([-22.85, -0.3, -3.0], [-22.85, 0, 0], 1.3, { color: CM.timber, pattern: PATTERN.rampboard, thin: true, thickness: 0.14, tag: 'gangplank', onlyIn: 'zones' }),
  ],
  decor: { lamps: [], palms: [], flags: [] },
};

// 【导出】整个 crossmarket 关卡定义;maps.js / level.js 从这里读 bounds、half、single、spawn 等。
export const LAYOUT = CROSSMARKET;
