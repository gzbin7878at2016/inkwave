// ============================================================================
// 【中文导读】地图布局总表——HALYARD 关卡的完整布局 + 所有 stage 布局的汇总入口
// ----------------------------------------------------------------------------
// 【模块定位】世界层(src/world/)的中枢数据文件。它一边定义 HALYARD 这一张地图的全部方块,
//   一边把各 stage 目录(stages/<id>/layout.js 导出的 LAYOUT)与本文件的 HALYARD 合并成
//   全局表 MAP_LAYOUTS。谁消费它:
//     · src/main.js —— 换图时 `new Level(layoutFor(MAP_LAYOUTS[layoutId], mode), colliders)`;
//       地图卡片缩略图 `layoutThumbSVG(MAP_LAYOUTS[m.layout || m.id], m.theme)`;
//     · tools/core-lab.js —— `new Level(MAP_LAYOUTS.tidewater)` 做实验台;
//     · src/world/level.js —— 只借用这里 re-export 的 PATTERN 作默认纹理;
//     · 各 stage 布局 —— import './mapkit.js' 的 B/R/O 原语(本文件也把它们再导出)。
// 【核心机制】MAP_LAYOUTS 在文件末尾按三步装配:
//   ① 先放 { halyard: HALYARD };② 用 STAGES 里每个 stage 的 LAYOUT 覆盖/补齐;
//   ③ 用 ZONE_DEFS(zones-data.js)给还没自带 zones 的布局补上 Zone Control 区域;
//   ④ 最后按固定的 stage-select 顺序把键重排(delete 再插回,JS 保留插入序),保证选图界面的顺序稳定。
// 【关键约定】
//   · 循环镜像:`half` 数组里的每个方块都会被 180° 旋转镜像((x,z)→(-x,-z)),`single` 不镜像。
//     这让两队场地完全对称:你只写一半。Team Alpha 出生 -Z,Bravo +Z。
//   · 面用法向匹配:方块的 `mural`(壁画贴花)和 `noPaint`(禁止涂墨的面)都用面法向 n 匹配,
//     只在对应朝向的面上生效(如 `{ n:[1,0,0], id:6 }` 只贴 +X 面)。
//   · 变体标记:`onlyIn:'zones'` / `notIn:'zones'`(见 variants.js)让同一布局在 turf/zones 两种模式下
//     砌出不同几何——例如拖船为 Zone Control 加了额外上船坡道。
//   · bounds 必须覆盖全部几何(spawnPads 必须在场内);level.js 的 XZ 空间哈希直接拿 bounds 定尺寸。
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md(世界层)、src/world/mapkit.js(原语定义)、
//   src/world/level.js(方块的消费方)、src/world/stages/index.js(STAGES 表)、src/world/variants.js(模式变体)。
// ============================================================================
// Map layouts. A map is a list of oriented boxes. Everything in `half` is also mirrored by a 180° rotation about the
// Y axis ((x,z) -> (-x,-z)) so both teams get an identical arena. Team Alpha spawns at -Z, Bravo at +Z.
// The building kit (PATTERN ids, B/R/O/OCT/ARC helpers) lives in mapkit.js; every stage except Halyard Marina lives in
// its own folder under stages/<id>/ (layout, prop pack + placements, surfaces, murals).
import { PATTERN, C, B, R, O, OCT, ARC, OCTRAMP, R_ } from './mapkit.js';
import { STAGES } from './stages/index.js';
import { ZONE_DEFS } from './zones-data.js';
// 【再导出整包积木】让 stage 布局可以从 './maps.js' 一站式拿到 B/R/O/OCT/ARC/PATTERN/C(它们的 layout.js 实际
//   多从 '../../mapkit.js' 直接 import,两条路径等价)。
export * from './mapkit.js';

// ------------------------------------------------------------------------------------------------------------
// 【HALYARD 关卡总览】下方整段是"Halyard Marina"(哈耶德码头)的布局数据——它不像其它 stage 拆进独立目录,
//   而是直接住在本文件里(配套装饰/壁画见 dressing.js / murals.js)。原文要点:
//   · 中段横着一艘双头汽车渡轮,甲板之间处处是水——掉下去就"splat",这些缺口正是本图的设计核心;
//   · 出生点:游艇会屋顶露台,大台阶直通加油码头,两侧各有 2.4 m 落差;
//   · 右/左车道(每队各一)"长栈桥 / 船厂",中央"加油码头"有棚屋与油泵作掩体、跳板通渡轮侧廊;
//   · 渡轮:两端敞开的车甲板、1.7 m 侧廊、顶上的日光甲板与驾驶室;
//   · 鱿鱼专属缺口(约 3.5–5.5 m 水面):涂一条跑道、游过去、海豚跳跨越——小孩只能走跳板。
// Halyard Marina — a working marina with a double-ended car ferry moored across the middle. Water everywhere
// between the decks: falling in splats you, and the gaps are the point of the map.
//   • spawn: the clubhouse roof terrace — a grand stair straight at the fuel dock, 2.4 m side drops to either flank
//   • right lane (per team) "Long Pier": open, long sightlines, the SEA SHANTY houseboat filling the slip (a broad
//     open sun deck; its cottage roof is squid-only high ground); a boardwalk near mid links it to the fuel dock
//   • centre "Fuel Dock": fuel hut + pumps for cover, a gangway onto the ferry's side corridor
//   • left lane "Boatyard": hardstanding with a tug up on blocks (ramp to its deck = flank high ground), a narrow
//     plank onto the ferry's end deck; linked to the fuel dock near base
//   • the ferry: open car decks at both ends, 1.7 m side corridors along the cabin, the sun deck on top (each team's
//     stair is at its own left end), a wheelhouse to fight around up there
//   • squid-only gaps (~3.5–5.5 m of water): fuel dock ↔ boatyard, side lanes ↔ ferry ends. Ink a runway, swim,
//     dolphin-jump across. Kids take the gangways.
// 【码头专用调色板 M】只服务 HALYARD:每种表面一个语义色名(面漆),配合 pattern 决定观感。
//   命名即用途:pavers 铺路石、stone 石阶、deck 木甲板、finger 指状栈桥、yard 船厂硬地、clubhouse 游艇会外墙、
//   navy 船体海军蓝、ferryDeck 渡轮车甲板、cabin 客舱米白、tug 拖船铁锈红、steel 钢件、orange 橙色标记等。
const M = {
  pavers: '#dccbb0', stone: '#cfc6b6', deck: '#cdb89a', finger: '#c7ae8c', yard: '#bdb8af', clubhouse: '#efe8da',
  spawn: '#eae6de', hut: '#f1ece2', navy: '#3f5372', ferryDeck: '#b8c3bb', cabin: '#f3f0ea', tug: '#9c4838',
  tugHouse: '#efe9dd', house: '#8fb8b4', houseTop: '#f0ebe0', steel: '#98a0a6', wood: '#c29a72', orange: '#e79a4b',
  beacon: '#e9e4d8', boat: '#4f6f96', planter: '#b9ad9a', carDeck: '#a1ada3', render: '#efe8da', office: '#e8e4dc',
};
// 【deck() 甲板 opts 工厂】给码头所有"木板甲板"预置统一的颜色 + planks 纹理,再展开调用方覆写的字段。
//   用它可保证各处栈桥/甲板色调一致;需要例外时(如指状栈桥换 finger 色)显式传 { color } 覆盖即可。
const deck = (o = {}) => ({ color: M.deck, pattern: PATTERN.planks, ...o });
// 【HALYARD 布局对象】顶层字段含义(消费方见各字段注释):
//   id            关卡标识,与 MAP_LAYOUTS 的键一致,主程序用来查变体/装饰/光照图;
//   water         水面风格: 'marina' 让 environment.js 切到"掩蔽码头水"的海面外观;
//   bounds        场地 AABB 的 XZ 范围(米),供 level.js 空间哈希与地图缩略图定比例;
//   spawnPads     两队出生点世界坐标(米,[x,y,z]),index 0 = Team Alpha(-Z)、1 = Bravo(+Z);
//   spawnBarrier  出生点保护半径(米),actor.js/_spawnBarrier 与 decor.js 出生圈据此画圈、判越界;
//   intro         开局运镜:from 机位、lookFrom 看点、toBack 回到己方出生点的距离;
//   single        不镜像的方块(渡轮等本来就是"整只"的中线结构);
//   half          会被 180° 镜像的方块(只写一半,镜像补另一半);
//   decor         非碰撞装饰点位(灯/棕榈/旗帜),decor.js 消费;灯位只登记一半,另一半自动镜像。
export const HALYARD = {
  id: 'halyard',
  water: 'marina',   // sheltered marina water (environment.js keys the sea look on this)
  bounds: { minX: -24, maxX: 24, minZ: -46, maxZ: 46 },
  spawnPads: [[0, 2.4, -42], [0, 2.4, 42]],
  spawnBarrier: 4.2,
  // match intro opens high over the ferry's sun deck, then sweeps back down the fuel dock to your spawn (ending in
  // front of the clubhouse wall, not inside the building behind it)
  intro: { from: [7, 12.5, 11], lookFrom: [0, 2.8, -1], toBack: 3.0 },
  single: [
    // 【single:不镜像的方块】渡轮横跨中线、左右本就对称,整只写在这里;half 里的场地结构由镜像补齐。
    // ---- the ferry: navy hull, light non-slip deck plate (its 0.2 m edge reads as the sheer stripe)
    B(-16, 16, -1.9, 1.1, -5, 5, { color: M.navy, tag: 'ferry-hull', pattern: PATTERN.hullpaint }),
    B(-16, 16, 1.1, 1.3, -5, 5, { tag: 'ferry-deck', color: M.carDeck, pattern: PATTERN.nonslip, mural: [{ n: [0, 1, 0], id: 4 }] }),
    // cabin (its roof is the sun deck) + wheelhouse on top
    B(-6.5, 6.5, 1.3, 3.8, -2.9, 2.9, { tag: 'ferry-cabin', color: M.cabin, pattern: PATTERN.hullpaint, mural: [{ n: [1, 0, 0], id: 6 }, { n: [-1, 0, 0], id: 6 }, { n: [0, 0, 1], id: 5 }, { n: [0, 0, -1], id: 5 }] }),
    B(-1.5, 1.5, 3.8, 5.2, -1.6, 1.6, { tag: 'ferry-wheelhouse', roof: true, color: M.cabin, pattern: PATTERN.hullpaint }),
  ],
  half: [
    // 【half:镜像方块】只写"左半边"(Alpha 侧的场地),运行时被 180° 旋转复制到 Bravo 侧。
    //   每个方块可带 tag(调试/装饰定位用)、onlyIn/notIn(模式变体)、mural/noPaint(面用法向匹配)。
    // ================= quay + clubhouse (solid ground behind the basin)
    B(-24, 24, -1.2, 0, -46, -31, { tag: 'quay', color: M.pavers, pattern: PATTERN.pavers }),
    B(-24, 24, 0, 4.6, -46, -45.4, { tag: 'backwall', roof: true, color: M.clubhouse, pattern: PATTERN.render }),
    // spawn terrace on the clubhouse roof: grand stair to the fuel dock, open 2.4 m drops on both sides
    // (body in the clubhouse's render so the terrace reads as part of the building; spawn tiles only on the deck + lip)
    B(-8.5, 8.5, 0, 2.2, -45.4, -38.5, { tag: 'spawn-terrace-body', color: M.render, pattern: PATTERN.render }),
    B(-8.5, 8.5, 2.2, 2.4, -45.4, -38.5, { tag: 'spawn-terrace', color: M.spawn, pattern: PATTERN.spawn }),
    R([0, 0, -32.4], [0, 2.4, -38.5], 6, { tag: 'grand-stair', color: M.stone, pattern: PATTERN.stonestep }),
    B(-8.5, -4.6, 2.4, 3.15, -39.1, -38.5, { tag: 'parapet', color: M.clubhouse, pattern: PATTERN.render }),
    B(4.6, 8.5, 2.4, 3.15, -39.1, -38.5, { tag: 'parapet', color: M.clubhouse, pattern: PATTERN.render }),
    // quay corners: boathouse (left) and a harbour-office kiosk (right) — cover + landmarks, out of the lanes
    B(14.5, 22.5, 0, 3.2, -45.4, -40.6, { tag: 'boathouse', roof: true, color: M.house, pattern: PATTERN.weatherboard }),
    B(-22.2, -17.4, 0, 2.8, -44.6, -41.2, { tag: 'kiosk', roof: true, color: M.office, pattern: PATTERN.render }),

    // ================= centre: the fuel dock
    B(-4.5, 4.5, -1.2, 0, -31, -8.6, deck({ tag: 'fuel-dock' })),
    B(-1.7, 1.7, 0, 2.7, -22.5, -18.8, { tag: 'fuel-hut', roof: true, color: M.hut, pattern: PATTERN.render }),
    // gangway onto the ferry's side corridor (free-spanning plank over the water)
    R([0, 0, -8.8], [0, 1.3, -4.95], 3.4, { tag: 'gangway', thin: true, thickness: 0.22, color: M.steel, pattern: PATTERN.gangdeck }),

    // ================= right lane: the Long Pier (−X for Alpha)
    B(-24, -19.5, -1.2, 0, -31, 0, deck({ tag: 'long-pier' })),
    B(-19.5, -12.5, -1.2, 0, -26.4, -25.2, deck({ tag: 'finger-pier', color: M.finger })),
    B(-19.5, -4.5, -1.2, 0, -12.4, -10.4, deck({ tag: 'boardwalk', color: M.finger })),          // boardwalk to the fuel dock
    // houseboat SEA SHANTY filling the slip: a wide floating-home pontoon (deck 0.7, kid-hoppable from the Long Pier
    // side, the finger pier and the boardwalk; porch rail on the fuel-dock side, 2.5 m of water to the fuel dock), the
    // cottage cabin toward the pier with an open sun deck on the fuel-dock side, squid-only roof garden
    B(-17.6, -7.0, -1.8, 0.7, -23.4, -14.4, { tag: 'houseboat-hull', color: M.house, pattern: PATTERN.gelcoat }),
    B(-16.2, -13.0, 0.7, 2.9, -21.4, -16.2, { tag: 'houseboat-cabin', color: M.houseTop, pattern: PATTERN.gelcoat }),
    R([-19.7, 0, -18.8], [-17.35, 0.7, -18.8], 1.6, { tag: 'houseboat-gangway', thin: true, thickness: 0.18, color: M.steel, pattern: PATTERN.gangdeck }),
    // harbour beacon where the lane meets the other team's boatyard (cover at the seam)
    B(-23.8, -21.4, 0, 2.4, -1.2, 1.2, { tag: 'beacon', color: M.beacon, pattern: PATTERN.render }),

    // ================= left lane: the Boatyard (+X for Alpha)
    B(10, 24, -1.2, 0, -31, -7, { tag: 'yard', color: M.yard, pattern: PATTERN.yard }),
    B(19.5, 24, -1.2, 0, -7, 0, { tag: 'yard-strip', color: M.yard, pattern: PATTERN.yard }),
    B(4.5, 10, -1.2, 0, -26, -24, deck({ tag: 'yard-walkway', color: M.finger })),                   // walkway from the fuel dock (near base)
    // tug up on blocks: deck = flank high ground, ramp up from the mid end, wheelhouse for cover
    B(14.5, 20.5, 0, 2.6, -24, -13, { tag: 'tug-hull', color: M.tug, pattern: PATTERN.hullpaint, notIn: 'zones' }),
    B(15.8, 19.2, 2.6, 4.3, -20.4, -17.4, { tag: 'tug-house', roof: true, color: M.tugHouse, pattern: PATTERN.hullpaint }),
    R([17.5, 0, -7.6], [17.5, 2.6, -13], 2.2, { tag: 'tug-ramp', color: M.wood, pattern: PATTERN.rampboard, notIn: 'zones' }),
    // Zone Control (the tug deck is each team's side zone): easier ways up for both sides
    //  • defenders: a steel boarding stair from the yard (quay side) straight up onto the bow
    //  • attackers: the stern ramp eased to 23.8° (it lands 0.45 m into a notch in the stern) and a two-step stack of
    //    spares crates against the west hull side by the aft deck, facing mid (crates = tug_access colliders)
    B(14.5, 20.5, 0, 2.6, -24, -13.45, { tag: 'tug-hull', color: M.tug, pattern: PATTERN.hullpaint, onlyIn: 'zones' }),
    B(14.5, 16.4, 0, 2.6, -13.45, -13, { tag: 'tug-hull', color: M.tug, pattern: PATTERN.hullpaint, onlyIn: 'zones' }),
    B(18.6, 20.5, 0, 2.6, -13.45, -13, { tag: 'tug-hull', color: M.tug, pattern: PATTERN.hullpaint, onlyIn: 'zones' }),
    R([17.5, 0, -7.55], [17.5, 2.6, -13.45], 2.2, { tag: 'tug-ramp', color: M.wood, pattern: PATTERN.rampboard, onlyIn: 'zones' }),
    R([19.0, 0, -29.95], [19.0, 2.6, -24.0], 2.2, { tag: 'tug-bow-stair', color: M.steel, pattern: PATTERN.treads, onlyIn: 'zones' }),
    // plank from the boatyard onto the ferry's end deck
    R([19.7, 0, -3.6], [15.85, 1.3, -3.6], 2.0, { tag: 'ferry-plank', thin: true, thickness: 0.2, color: M.wood, pattern: PATTERN.planks }),

    // ================= ferry details (mirrored to the far side)
    // bulwarks along the long sides, open at the gangway
    B(-16, -1.8, 1.3, 2.0, -5, -4.6, { tag: 'ferry-bulwark', color: M.navy, pattern: PATTERN.hullpaint }),
    B(1.8, 16, 1.3, 2.0, -5, -4.6, { tag: 'ferry-bulwark', color: M.navy, pattern: PATTERN.hullpaint }),
    // sun-deck stair (Alpha's, at its left end). Small cover (fuel pumps, dock box, pump-out station, crates, keel
    // blocks, dinghy, ferry locker + cargo) is set dressing with colliders — see docs/HALYARD.md
    R([12.6, 1.3, -1.9], [6.5, 3.8, -1.9], 2.0, { tag: 'ferry-stair', color: M.steel, pattern: PATTERN.treads }),
  ],
  decor: {
    // 【decor:非碰撞装饰点位】全部只登记一半(除 flags 成对写在两侧),decor.js 会自动镜像另一半。
    //   lamps: 街灯 [x,z];decor.js 摆灯 + levelMaterial.js 的 setLevelLamps 用同一坐标建"光池"。
    //   palms: 棕榈树 [x,z];flags: 旗杆 [x,y,z],按 team 分色(此处两个分别是 Alpha/Bravo 的旗)。
    lamps: [[-23.5, -32.2], [23.5, -32.2], [-23.6, -14], [23.6, -9], [-5.7, -31.8], [5.7, -31.8]],
    palms: [[-15.5, -38.5], [15.5, -38]],
    flags: [[-8, 2.4, -44.6], [8, 2.4, -44.6]],
  },
};

// 【全局布局表 MAP_LAYOUTS】键 = 关卡 id(与 stage-select 顺序一致),值 = 布局对象。
//   下面几行按"先内建、再合并各 stage、再补 zones、最后重排顺序"的顺序装配(见文件顶部导读)。
export const MAP_LAYOUTS = { halyard: HALYARD };
// 【合并各 stage 的 LAYOUT】stages/index.js 把每个 stage 目录的导出打成一个对象;只挑带 LAYOUT 的并进来。
//   于是 tidewater/kelpline/... 的布局与 HALYARD 同表并列(它们各自住在 stages/<id>/layout.js)。
for (const [id, s] of Object.entries(STAGES)) if (s.LAYOUT) MAP_LAYOUTS[id] = s.LAYOUT;
// Zone Control zones (zones-data.js) — a layout can also carry its own `zones`
// 【补 Zone Control 区域】zones-data.js 是区域控制的独立数据表;若某布局自己没带 zones,就挂上官方定义。
//   挂上后 match.js 的 zones 系统、bots.js 的 ZoneGraph 才能取到区域边界。
for (const [id, z] of Object.entries(ZONE_DEFS)) if (MAP_LAYOUTS[id] && !MAP_LAYOUTS[id].zones) MAP_LAYOUTS[id].zones = z;
// stage-select order
// 【固定选图顺序】JS 对象保留插入序;这里用"删了再插回"把键按下面这个硬编码列表重排,
//   于是 UI 里地图卡片的先后顺序不受上面合并操作影响。列表里不含的键保持原位。
for (const id of ['tidewater', 'kelpline', 'halyard', 'saltpan', 'crossmarket', 'lockgate', 'terraces', 'cargo']) { const L = MAP_LAYOUTS[id]; if (L) { delete MAP_LAYOUTS[id]; MAP_LAYOUTS[id] = L; } }
