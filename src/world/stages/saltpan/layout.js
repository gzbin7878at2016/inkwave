// ============================================================================
// 【中文导读】Saltpan Basin（盐田盆地）关卡的几何布局（layout）：用一组带朝向的盒子描述地图的
//             地面、墙体、坡道、栈道，交给 level.js 烘焙成可碰撞/可涂墨的关卡。
// ----------------------------------------------------------------------------
// 【模块定位】世界层 src/world/stages/saltpan/ 四件套之一，是最底层的数据定义：
//   layout.js（本文件）  —— 关卡几何（地面盒子、坡道、立面），只产出一张 `LAYOUT` 表
//   props.js             —— 道具包 + 摆位（栏杆、灯具、可上房顶的碰撞体等），依赖 LAYOUT 里的 tag/高度
//   surfaces.js          —— 本关卡的表面材质（SURF 表 + texlib 的 SURFACES），被本文件的 mud/pan/wood 引用
//   murals.js            —— 本关卡的壁画/标识贴花（mural atlas 的 id 4-7），由 layout 里的 mural 字段挂到面上
//   依赖顺序：surfaces.js（提供 SURF）→ layout.js（引用 SURF）→ props.js / murals.js（在 layout 之上做装饰）。
//   index.js 把四件套装配成 STAGES['saltpan']，level.js 读到本文件的 LAYOUT 后构建网格。
// 【核心机制】
//   · 地图 = 一组「带朝向的盒子」（B/R/O 等 mapkit 助手）加上各自的 tag；level.js 据此生成
//     blocks/faces，并决定每个面是否可涂墨、是否可站人、投影如何映射。
//   · 地形是「下沉的盐池」：dyke（土堤）在 0 米，池底分三级 P1=-0.6 / P2=-0.9 / P3=-1.2。
//   · rise() 造坡道，chamfer() 把凸角斜切成 45°（码头边缘不再方正），两者都是纯几何助手。
// 【关键约定】
//   · 单位为米（metres）；Y 轴向上，地面基准 y=0，池底为负值。
//   · `half` 里的每个盒子都会被「绕 Y 轴旋转 180°」镜像出一份（(x,z) → (-x,-z)），两半互为副本；
//     Team Alpha 出生在 −Z，Bravo 出生在 +Z（见 mapkit.js 头注释）。`single` 里的东西不镜像。
//   · 可玩墙面与采样规则：level.js 中 face 可涂墨当且仅当 `b.paint && n.y > -0.5`；
//     roof/perch 类的顶面永不涂墨；noPaint 列出的一组法线方向会让对应面不可涂墨（常用于
//     栏杆下的立面——斜着游上去会在栏杆下方冒头，导致 Bot 卡住）；竖直墙面取「贴地底部」采样
//     （groundedBottom），图集有 8 texel 的内边距承接外推墨水。
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md、docs/ASSETS.zh-CN.md、docs/INK.zh-CN.md；
//             ../../mapkit.js（B/R/O/PATTERN）、../../level.js（镜像与可涂面规则）、
//             ../../variants.js（onlyIn/notIn 的 Zone Control 变体）、../../props.js、../index.js。
// ============================================================================
// Saltpan Basin — stage layout (src/world/stages/saltpan/). The stage owns every file in this folder:
//   layout.js    level geometry (this file)        props.js    prop pack + placements (set dressing)
//   surfaces.js  stage surface materials (texlib)  murals.js   stage decals / signage (mural atlas)
import { PATTERN, B, R, O } from '../../mapkit.js';
import { SURF } from './surfaces.js';

// Saltpan Basin — a working salt works on a sun-baked tidal flat. The OPEN map: low, bright, long sightlines, few tall
// walls, low cover (salt rows and cones, tipper wagons, sluice headstocks, sack stacks). Everything is built from
// crystallising pans: sunken pans (salt crust over pink brine, 0.6 / 0.9 / 1.2 m below the dykes), cracked-mud dykes
// lined with timber revetments, bleached timber boardwalks on posts across the pans (squids slip underneath).
//   • spawn: the loading gallery of the Salt Store (2.4 m) — the barn facade is the back wall; a timber stair straight
//     at the pans, a side ramp to the conveyor yard, open drops to the rail yard
//   • rail yard: a narrow-gauge line with tipper wagons along the front of the store, a spur to the shed dock
//   • right lane (per team, −X for Alpha) "Packing Shed": the timber shed with its corrugated roof across the flank —
//     loading dock (1.1 m) facing mid, stacked sacks as steps up to the roof, a boarded loft stair at the back; the
//     roof (3.2–4.2 m) is the flank's real high ground
//   • centre "The Pans": the shallow back pan (−0.6) with its boardwalk, the sluice dyke (Decauville track, sluices),
//     the front pan (−0.9) crossed by a diagonal boardwalk
//   • left lane "Salt Heap": the long heap (2.4 m ridge, walkable 23° slopes; fresh salt at the mid end, the back half
//     under a tyre-weighted tarp) and the conveyor gantry feeding it: an incline from the yard up to the 3.6 m catwalk and
//     the head platform over the heap's mid end (kids jump up to it from the ridge). The strip under the catwalk is
//     braced off (prop colliders), so nobody — bot or kid — ends up underneath the deck
//   • mid: the Great Pan (−1.2) with the wind pump on its timber staging, boardwalks in from each side
//   • outline: a jagged tidal-flat edge, not a box — a creek cuts in between the office quay and the shed quay (crossed
//     by a diagonal railed causeway), the shed quay juts out past the shed with a 45° cut, the conveyor stage steps out
//     at the base, a sea notch runs beside the heap, the mid dyke ends in a pointed jetty with an inlet beside it, and the
//     pans are staggered (back pan ends 2 m short of the front pan, the Great Pan runs 2 m past both)
// Out-of-play tops (office, store gable, hopper, drive house, vents, lamps, sluices …) are roof colliders in props.js.
// 【调色板 SP】本关卡的固有色表：盐田是曝晒的亮色调子。mud=干裂泥堤、mudDk=阴面泥色、
// salt/saltMid=盐壳与盐水池底、heap=盐堆、tarp=压舱油布、timber/timberDk=木材与深色木、
// store/shed/roof/office/steel/spawn=各建筑与出生区的主色。颜色值经 color 字段进入材质。
const SP = {
  mud: '#cbbb9f', mudDk: '#b9a88b', salt: '#f3ebe8', saltMid: '#f1e3e2', heap: '#e3ded5', tarp: '#5f6a66', timber: '#d6cfc3', timberDk: '#a89c8a',
  store: '#9c6a5b', storeTrim: '#efe9dd', shed: '#b8bdb1', roof: '#9a6b58', office: '#e2cf9f', steel: '#8d969c', spawn: '#d9d2c6',
};
// 【三种地面预设】把「颜色 + texlib 表面材质」打成一包，供 B/R/O 直接展开。
// pattern 指向 surfaces.js 的 SURF（salt/mud/timber 三个 texlib slot），调用方可再用 ...o 覆盖任意字段。
const mud = (o = {}) => ({ color: SP.mud, pattern: SURF.mud, ...o });
const pan = (o = {}) => ({ color: SP.salt, pattern: SURF.salt, ...o });
const wood = (o = {}) => ({ color: SP.timber, pattern: SURF.timber, ...o });

// 【高程常量】盐池是下沉结构：dyke（堤顶）在 y=0，池底分三级递降——P1/P2/P3 分别是
// back-pan / front-pan / Great Pan 的底板高度（越靠中庭的池子挖得越深）。
// heights
const P1 = -0.6, P2 = -0.9, P3 = -1.2;
// 【rise：坡道上端定位助手】给定坡道两端的 (x0,z0,y0) → (x1,z1,y1)，返回一个「起坡点」，
// 使得 slab 自带的 0.6 m 低端外延恰好落在 y0 这一端（用于房顶/盐堆斜坡与相邻体块对齐）。
// ramp helper: low point placed so the slab's 0.6 m low-end extension ends exactly on `edge` (roofs, heap slopes)
const rise = (x0, z0, y0, x1, z1, y1) => { const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), a = Math.atan2(y1 - y0, L); return [x0 + (dx / L) * 0.6 * Math.cos(a), y0 + 0.6 * Math.sin(a), z0 + (dz / L) * 0.6 * Math.cos(a)]; };

// 【chamfer：凸角 45° 斜切】在凸地面角 (cx,cz) 处，地面盒子刻意留出一个边长 s 的方角空缺，
// 再用这块「转向」的 slab（下沉 9 cm，好塞进邻块下方）补上方角内的三角形——于是码头边缘斜着跨过该角。
// (sx,sz) 由角点指向海侧（取 ±1,±1），决定斜切朝哪个象限翻转。
// 45° chamfer on a convex ground corner (cx, cz): the corner square of size s is left out of the ground boxes and this
// turned slab (9 cm lower, so it tucks under its neighbours) fills the square's inner triangle — the deck edge then runs
// diagonally across the corner. (sx, sz) points from the corner out to sea (±1, ±1).
const chamfer = (cx, cz, s, sx, sz) => O(cx - 0.75 * sx * s, cz - 0.75 * sz * s, s * Math.SQRT2, s / Math.SQRT2, -3, -0.09, (Math.atan2(sz, sx) * 180) / Math.PI, mud({ tag: 'chamfer' }));

// 【LAYOUT 主体】整个关卡的描述对象，最终 `export const LAYOUT = SALTPAN` 交给 level.js。
const SALTPAN = {
  // 地图 id：与 STAGES 键、STAGE_SLOTS / STAGE_SURFACES 校验、config.js 的 mapBossOk 等对应。
  id: 'saltpan',
  // 世界包围盒（米）：AI 导航、小地图、相机裁剪据此限定范围。
  bounds: { minX: -30, maxX: 30, minZ: -46, maxZ: 46 },
  // 出生点（[x,y,z]）：Alpha 在 −Z（-42），Bravo 在 +Z（42），站在 loading gallery 甲板 2.4 m 高。
  spawnPads: [[-2, 2.4, -42], [2, 2.4, 42]],
  // 出生保护圈半径（米）：decor.js 用它画环形屏障并做「敌方靠近」提示。
  spawnBarrier: 4.2,
  // 【intro 开场运镜】比赛开场：先贴着 Great Pan 上方的风车 (from)，再沿中央盐池回拉到出生廊道。
  //   from=起始机位、lookFrom=起始看向点、toBack=回拉后相机退让距离。
  // match intro: opens on the wind pump over the Great Pan, then pulls back along the centre pans to the spawn gallery
  intro: { from: [10, 10.5, 9], lookFrom: [0, 4.5, -3], toBack: 3.0 },
  // 【art 选图机位】关卡选择界面用的高位三分之四视角，从 Alpha 侧传送台外俯拍锯齿状的码头、河汊与盐池。
  // stage-select picture: high three-quarter view from off Alpha's conveyor stage — the jagged quays, creeks and pans
  art: { from: [36, 22, -50], look: [-5, -1, 0], fov: 58 },
  // 【single：不镜像的唯一条目】地图中轴线上的体块，只出现一次（两边共用）。
  single: [
    // ---- 【开凿最深的中庭 Great Pan】底板 P3=-1.2；中央立着风车的木制基台（pump-staging），
    //      其顶面挂 mural id 7（盐田壁画/标识，见 murals.js）。
    // ---- the Great Pan (mid) + the wind pump's timber staging in its middle
    B(-13, 13, -3, P3, -8, 8, pan({ tag: 'great-pan', color: SP.saltMid })),
    B(-3.6, 3.6, P3, 0.08, -3.6, 3.6, wood({ tag: 'pump-staging', mural: [{ n: [0, 1, 0], id: 7 }] })),
  ],
  // 【half：镜像半区】以下每个盒子都会绕 Y 轴 180° 镜像出一份（(x,z)→(-x,-z)），只写 Alpha 侧即可。
  half: [
    // 【分区：地面 / 锯齿状潮滩轮廓】不再是方正盒子——木护岸的码头进进出出：base 仓库院、向东探出的传送带尾台、
    //   河汊西侧的办公室码头；west 打包棚码头外伸到 x−30 并在中段 45° 斜切；east 盐堆码头带一处海槽、
    //   中堤收成尖码头（x29）并有一处内湾；河汊上架斜向木栈桥跨越，凸角处用 chamfer() 斜切。
    // ================= ground: a jagged tidal-flat outline (no longer a box). Timber-revetted quays step in and out:
    //   base   the store yard, the conveyor tail stage stepping out east, the office quay beyond a tidal creek (west)
    //   west   the packing-shed quay juts out to x −30 (a path round the shed's far side), a 45° cut at its mid end
    //   east   the heap wharf with a sea notch beside the heap, the mid dyke ending in a pointed jetty (x 29) with an
    //          inlet north of it (so each side of mid reads: jetty on one flank, inlet on the other)
    //   the creek is crossed by a diagonal timber causeway; 45° chamfers on the convex corners (chamfer() below)
    B(-18, 14, -3, 0, -46, -30, mud({ tag: 'yard' })),
    B(14, 23.5, -3, 0, -41, -30, mud({ tag: 'conveyor-stage' })),
    B(23.5, 26, -3, 0, -38.5, -30, mud({ tag: 'conveyor-stage' })),
    chamfer(26, -41, 2.5, 1, -1),
    B(-26, -18, -3, 0, -46, -38, mud({ tag: 'office-quay' })),
    B(-18, -12, -3, 0, -30, -26, mud({ tag: 'creek-neck' })),
    B(-30, -12, -3, 0, -26, -15, mud({ tag: 'shed-quay' })),
    chamfer(-30, -11, 4, -1, 1),
    B(-26, -12, -3, 0, -15, -8, mud({ tag: 'dock-yard' })),
    B(9, 26, -3, 0, -30, -24, mud({ tag: 'heap-wharf' })),
    B(9, 24.2, -3, 0, -24, -20, mud({ tag: 'heap-wharf' })),
    B(11, 24.2, -3, 0, -20, -12.2, mud({ tag: 'heap-wharf' })),
    B(11, 26, -3, 0, -12.2, -8, mud({ tag: 'heap-wharf' })),
    chamfer(26, -14, 1.8, 1, -1),
    B(13, 27, -3, 0, -8, -2, mud({ tag: 'mid-jetty' })),
    B(27, 29, -3, 0, -6, -4, mud({ tag: 'mid-jetty' })),
    chamfer(29, -8, 2, 1, -1),
    chamfer(29, -2, 2, 1, 1),
    B(13, 23, -3, 0, -2, 8, mud({ tag: 'mid-dyke' })),
    // 【斜向栈桥】跨过河汊，连接办公室码头 → 打包棚码头（两侧带栏杆，见 props.js）。
    // diagonal causeway boardwalk over the creek: office quay → shed quay (railed both sides, see props.js)
    O(-23.7, -32, 1.8, 14.6, -0.08, 0.08, -28.7, wood({ tag: 'causeway' })),

    // 【分区：中央盐池】back-pan(P1)/sluice-dyke/front-pan(P2)/front-dyke 依次排布；
    //   池间由架在桩上的木栈道跨越（高出堤面 8 cm，乌贼可从下方穿过），另有木板坡道下到池底。
    // ================= centre: the pans
    B(-12, 9, -3, P1, -30, -20, pan({ tag: 'back-pan' })),
    B(-12, 11, -3, 0, -20, -17, mud({ tag: 'sluice-dyke' })),
    B(-12, 11, -3, P2, -17, -10, pan({ tag: 'front-pan' })),
    B(-12, 11, -3, 0, -10, -8, mud({ tag: 'front-dyke' })),
    // 【桩上栈道】高出落脚堤面 8 cm（乌贼可从底下钻过）；末尾一条 boardwalk-east 走向 +X 侧。
    // boardwalks on posts, 8 cm proud of the dykes they land on (squids slip underneath)
    B(-3.6, -1.8, -0.08, 0.08, -30.4, -19.6, wood({ tag: 'boardwalk' })),
    O(0.9, -13.5, 1.8, 10.6, -0.08, 0.08, -38, wood({ tag: 'boardwalk-diag' })),
    B(1.4, 3.2, -0.08, 0.08, -8.4, -3.6, wood({ tag: 'boardwalk-mid' })),
    B(3.6, 13.4, -0.08, 0.08, -2.6, -0.8, wood({ tag: 'boardwalk-east' })),
    // 【下池木板坡道】R() 造斜坡；thin:true + thickness:0.14 表示薄板（碰撞体是薄壳而非实心块）。
    // plank ramps down into the pans
    R([7.5, P1, -28.4], [7.5, 0, -30], 1.4, wood({ tag: 'pan-ramp', thin: true, thickness: 0.14 })),
    R([-9.5, P2, -12.3], [-9.5, 0, -10], 1.4, wood({ tag: 'pan-ramp', thin: true, thickness: 0.14 })),
    R([-6.5, P3, -4.8], [-6.5, 0, -8], 1.6, wood({ tag: 'pan-ramp', thin: true, thickness: 0.14 })),
    R([9.8, P3, -5.2], [13, P3 + 1.2, -5.2], 1.6, { tag: 'pan-ramp', color: SP.timber, pattern: PATTERN.rampboard, thin: true, thickness: 0.14 }),

    // 【分区：出生区 / 盐仓装货廊道】仓库立面（store-facade）作背墙，noPaint:[[0,0,1]] 让朝内的那面不吃墨水；
    //   两段海墙(sea-wall)夹在 facade 两侧；gallery-body/-deck 是高 2.4 m 的装货甲板（头顶 mural id 6）；
    //   一条直梯上甲板、一条侧坡道通传送带场；角落的 works office 属"场外"（四面墙 noPaint，屋顶会让人滑落，
    //   见 props.js）；另有传送带尾斗 hopper（钢制，四面 noPaint）。
    // ================= spawn: loading gallery of the Salt Store (the barn facade is the back wall)
    B(-12, 8, 0, 5.4, -46, -45.4, { tag: 'store-facade', color: SP.store, pattern: PATTERN.weatherboard, noPaint: [[0, 0, 1]] }),
    B(-26, -12, 0, 0.9, -46, -45.5, wood({ tag: 'sea-wall', color: SP.timberDk })),
    B(8, 14, 0, 0.9, -46, -45.5, wood({ tag: 'sea-wall', color: SP.timberDk })),
    B(-9, 5, 0, 2.2, -45.4, -38.5, wood({ tag: 'gallery-body', color: SP.timberDk })),
    B(-9, 5, 2.2, 2.4, -45.4, -38.5, wood({ tag: 'gallery-deck', color: SP.spawn, mural: [{ n: [0, 1, 0], id: 6 }] })),
    R([-2, 0, -32.4], [-2, 2.4, -38.5], 5, wood({ tag: 'gallery-stair' })),
    R([11.4, 0, -43.6], [5, 2.4, -43.6], 3, { tag: 'gallery-ramp', color: SP.timber, pattern: PATTERN.rampboard }),
    // works office in the corner (out of play: walls take no ink, its roof slides you off — see props.js)
    B(-25.5, -19, 0, 2.8, -45.5, -40.5, { tag: 'office', color: SP.office, pattern: PATTERN.weatherboard, noPaint: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] }),
    // conveyor tail hopper
    B(19.2, 23.2, 0, 1.4, -39.8, -36.8, { tag: 'hopper', color: SP.steel, pattern: PATTERN.metalpanel, noPaint: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] }),

    // 【分区：右路 Packing Shed（对 Alpha 而言是 −X 侧）】打包棚：棚体本身 + 朝中庭的装货台 dock(1.1) +
    //   一叠 sack 当台阶上房顶 + 背后一条 boarded loft stair。房顶（3.2–4.2 m）是这一侧真正的制高点，
    //   两片倾斜屋面板各挂一枚 mural（id 5 / id 4，法线为棚顶的斜面方向）。
    // ================= right lane: the Packing Shed (−X for Alpha)
    B(-26, -15, 0, 3.2, -25, -18, { tag: 'shed', color: SP.shed, pattern: PATTERN.weatherboard }),
    R(rise(-20.5, -25, 3.2, -20.5, -21.5, 4.2), [-20.5, 4.2, -21.5], 11, { tag: 'shed-roof', color: SP.roof, pattern: PATTERN.container, mural: [{ n: [0, 0.962, -0.275], id: 5 }] }),
    R(rise(-20.5, -18, 3.2, -20.5, -21.5, 4.2), [-20.5, 4.2, -21.5], 11, { tag: 'shed-roof', color: SP.roof, pattern: PATTERN.container, mural: [{ n: [0, 0.962, 0.275], id: 4 }] }),
    B(-26, -16, 0, 1.1, -18, -15.4, wood({ tag: 'dock', color: SP.timberDk })),
    R([-24, 0, -12.6], [-24, 1.1, -15.4], 1.8, wood({ tag: 'dock-steps' })),
    // 【阁楼梯】上到棚后并接房顶；notIn:'zones' 表示"除 Zone Control 模式外都建"（见 variants.js）。
    // loft stair up the back of the shed onto the roof
    R([-17, 0, -33], [-17, 3.2, -25], 1.8, wood({ tag: 'loft-stair', notIn: 'zones' })),
    // 【Zone Control 变体】同一段楼梯，两侧不可涂墨（noPaint:[[1,0,0],[-1,0,0]]）：这两面承载手扶栏杆的
    //   rail 碰撞体，斜着游上去会在栏杆下方冒头；当房顶成为目标点时常有 Bot 在此卡顿数秒，故屏蔽涂墨。
    // (Zone Control: the same flight, its two sides uninkable — they carry the handrail's rail colliders, and a squid
    // swimming up a side surfaced under the rail: bots got stuck there for seconds while the roof was the objective)
    R([-17, 0, -33], [-17, 3.2, -25], 1.8, wood({ tag: 'loft-stair', noPaint: [[1, 0, 0], [-1, 0, 0]], onlyIn: 'zones' })),
    // 【Zone Control 进攻路线】模式里房顶是主队控制区，中庭来的进攻方在装货台一侧也要有上房路：
    //   从 dock(1.1) 上立面到与檐口齐平的平台(3.2) 旁的 sack 托盘（props.js：开放侧装栏杆，立面第二道门让位）；
    //   上台路线有楼梯、跳 sack 托盘(2.0/2.6) 上檐、以及沿可涂墨的棚正面/山墙游上去；防守方保有阁楼梯。
    //   （楼梯开放侧与平台正面带手栏杆 rail 碰撞体，这两面不吃墨；踏面、平台顶、棚正面可涂。）
    // Zone Control (src/world/variants.js): the roof is the home side zone, so attackers from mid get ways up on the
    // dock side too — a timber stair up the facade from the dock (1.1) to a landing flush with the eave (3.2) beside
    // the sack pallets (props.js: handrail on the open side, the facade's second door moved out of its way). Routes up
    // from the dock: the stair; hopping the sack pallets stacked against the landing (2.0 / 2.6) onto it or the eave;
    // swimming up the inkable shed front past the pallets or the gables. The defenders keep the loft stair and the rest.
    // (the flight's open side and the landing's front carry the handrail — rail colliders — so those two faces take no
    // ink: a squid swimming up them would surface under the rail; the treads, the landing top and the shed front do)
    R([-16.7, 1.1, -17.24], [-21.5, 3.2, -17.24], 1.5, wood({ tag: 'shed-stair', noPaint: [[0, 0, 1]], onlyIn: 'zones' })),
    B(-23, -21.5, 1.1, 3.2, -18, -16.5, wood({ tag: 'shed-landing', noPaint: [[0, 0, 1]], onlyIn: 'zones' })),
    // 【东端第二段 dock 台阶】从院子直上到楼梯脚（本版本里 dock 支线在转盘处中断，见 props.js）；仅 Zone Control 建。
    // … and a second flight of dock steps at the east end, straight up from the yard to the stair's foot (the dock spur
    // stops short at the turntable in this build, props.js)
    R([-16.9, 0, -12.6], [-16.9, 1.1, -15.4], 1.8, wood({ tag: 'dock-steps', onlyIn: 'zones' })),

    // 【分区：左路 Salt Heap（对 Alpha 而言是 +X 侧）】长条盐堆（2.4 m 脊线，23° 可走斜坡；中段是新盐，
    //   后半在压胎油布下）及其传送带龙门架——从院子一路上坡到 3.6 m 走道与盐堆中段上方的头部平台
    //   （小孩可从盐堆脊跳上去）。gantry-catwalk 下方的条带被 props 的碰撞体撑住，防止有人钻到甲板下。
    // ================= left lane: the Salt Heap + conveyor gantry (+X for Alpha)
    // 【盐堆坡面】四片 rise() 斜坡拼出脊线：中段正面/背面是新盐，后半换成 tarp 油布材质；
    //   顶部 gantry-head 平台与 catwalk 走道悬在盐堆上方，incline 是薄壳上传送带坡道。
    // the heap: fresh salt at the mid end (fed by the conveyor), the older back half under a tarp weighted with tyres
    R(rise(11.8, -16, 0, 17.5, -16, 2.4), [17.5, 2.4, -16], 6, { tag: 'heap', color: SP.heap, pattern: PATTERN.rubber }),
    R(rise(23.2, -16, 0, 17.5, -16, 2.4), [17.5, 2.4, -16], 6, { tag: 'heap', color: SP.heap, pattern: PATTERN.rubber }),
    R(rise(11.8, -22, 0, 17.5, -22, 2.4), [17.5, 2.4, -22], 6, { tag: 'heap-tarp', color: SP.tarp, pattern: PATTERN.rubber }),
    R(rise(23.2, -22, 0, 17.5, -22, 2.4), [17.5, 2.4, -22], 6, { tag: 'heap-tarp', color: SP.tarp, pattern: PATTERN.rubber }),
    B(16, 22.45, 3.35, 3.6, -13, -9.5, { tag: 'gantry-head', color: SP.steel, pattern: PATTERN.metalpanel }),
    B(20, 22.45, 3.35, 3.6, -26, -13, wood({ tag: 'gantry-catwalk' })),
    R([21.225, 0, -35.6], [21.225, 3.6, -26], 2.45, wood({ tag: 'gantry-incline', thin: true, thickness: 0.25 })),
  ],
  // 【decor：程序化装饰点】由 decor.js 读取；lamps/palms 为空表示本关不用路灯与棕榈；
  //   flags 给出两面队旗在出生廊道的位置（[x,y,z]），decor.js 会自动镜像出另一侧并分别上两队的队色。
  decor: {
    lamps: [],
    palms: [],
    flags: [[-8.2, 2.4, -44.8], [4.2, 2.4, -44.8]],
  },
};

// 【导出】LAYOUT 交给 level.js 构建网格；被 ../index.js 收集进 STAGES。
export const LAYOUT = SALTPAN;
