// ============================================================================
// 【中文导读】Zone Control 占点区域数据 —— 每张图三个争目标的轮廓与高度范围
// ----------------------------------------------------------------------------
// 【模块定位】纯数据模块。被 src/world/maps.js 在装配时挂到 layout 上
//   (layout.zones = ZONE_DEFS[id]),再交由 src/game/zones.js 的规则引擎消费。
//   本文件不含逻辑,只声明几何。
// 【核心机制】每张图给出从俯视底图手绘、再吸附到最近墙/落差上的多边形区域:
//   - center: 中心争目标,一个 zone 或 [zone, zone] 两个(两区中心必须同时占领)
//   - side:   Alpha 半场那一侧的分区;Bravo 侧由 180° 镜像自动得出(zones.js mirrorZone)
//   单位是世界米 (x, z);y0…y1 = 计入的楼层高度区间 —— 同一平面上方不同高度的
//   地面靠它区分,避免把上下两层算进同一个点。
// 【关键约定】
//   - zone 只有一种形状表示:单块用 { poly: [[x,z],…] },多块用
//     { polys: [[[x,z],…],…] }(多块共享一份占点覆盖,如桥面 + 引桥)。
//   - 坐标是布局空间(未镜像);half 侧区域写 Alpha 那份即可。
//   - rect / orect / circle 三个工厂把"手绘矩形/斜矩形/圆"转成顶点数组,
//     数值统一 toFixed(3) 收敛精度,避免浮点噪声进哈希/比较。
// 【配套阅读】src/game/zones.js(ZONE_FORMAT 与规则)、src/world/maps.js(挂载点)、
//   docs/ARCHITECTURE.zh-CN.md
// ============================================================================
// Zone Control zones per stage (src/game/zones.js reads layout.zones). Drawn by hand on the stage top-downs, then
// snapped to the nearest walls / drops. Coordinates are world metres (x, z); y0…y1 = the floor heights that count.
//   center: [zone] or [zone, zone] (two-zone centre: both must be held)
//   side:   the zone on Alpha's half (closer to Alpha's spawn); Bravo's is its 180° mirror
//   zone:   { poly: [[x, z], …] } or { polys: [[[x, z], …], …] } (several parts, one shared coverage)
// 【字段图例】center/side 下每个 zone 项:
//   poly  单块轮廓顶点数组(简单多边形,可凹)—— 与 polys 二选一
//   polys 多块轮廓,共享同一份占点覆盖(如桥面与其引桥)
//   y0/y1 计入的地板高度下/上界(米):只有中心落在 [y0,y1] 且落墨的格算占点
const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
// 【轴对齐矩形】按 (x0..x1, z0..z1) 顺时针给出四角点;最常用,直接写世界坐标即可。
// turned rectangle: centre, local x axis (unit, [ax, az]), half extents along local x / local z (= (-az, ax))
// 【斜矩形】以 (cx,cz) 为中心、局部 x 轴 [ax,az](单位向量)、沿局部 x/z 的半长 hx/hz 生成四角;
// 局部 z 轴取 (-az, ax)(x 轴逆时针转 90°)。用于旋转过的码头/桥面,坐标已 toFixed(3)。
const orect = (cx, cz, [ax, az], hx, hz) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => [cx + ax * hx * i - az * hz * k, cz + az * hx * i + ax * hz * k].map((v) => +v.toFixed(3)));
// 【圆近似多边形】以 (cx,cz) 为心、半径 r 均匀采样 n 个点(默认 24 边)近似圆;
// 用于圆形平台(如 Jubilee terrace)。同样 toFixed(3)。
const circle = (cx, cz, r, n = 24) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [+(cx + Math.cos(a) * r).toFixed(3), +(cz + Math.sin(a) * r).toFixed(3)]; });
// 【旋转轴缓存】三张图各自的局部 x 轴单位向量,供 orect 复用(角度取自布局)。
const K35 = [0.819, -0.574];   // Kelpline berth: local x axis (the whole berth is turned 35°)
const X31 = [0.857, 0.514];    // Crossroads Market: the tram street / market hall axis (turned 31°)
const L45 = [-0.707, 0.707];   // Lockgate: the humpback bridge's run

// 【区域总表】键 = 图 id(halyard/tidewater/kelpline/saltpan/crossmarket/lockgate/terraces),
// 与 maps.js 的 MAP_LAYOUTS 一一对应;maps.js 仅在 layout 自身没写 zones 时用它兜底。
export const ZONE_DEFS = {
  // the ferry's sun deck either side of the wheelhouse (two-zone centre); the tug up on blocks
  // 【halyard】中心=渡轮上层甲板舵室两侧(两区中心,须同时占领);Alpha 侧=搁墩上的拖船舱面
  halyard: {
    center: [{ poly: rect(1.5, 6.5, -2.9, 2.9), y0: 3.5, y1: 4.1 }, { poly: rect(-6.5, -1.5, -2.9, 2.9), y0: 3.5, y1: 4.1 }],
    side: { poly: rect(14.5, 20.5, -24, -13), y0: 2.3, y1: 2.9 },
  },
  // the round Jubilee terrace (dais + ring) round the clock tower; a patch of the square against the colonnade stair
  // 【tidewater】中心=钟楼周圈圆形 Jubilee terrace;Alpha 侧=柱廊台阶前那方广场
  tidewater: {
    center: [{ poly: circle(0, 0, 8.55), y0: 0.8, y1: 1.3 }],
    side: { poly: rect(10, 17.5, -20, -10), y0: -0.5, y1: 0.3 },
  },
  // the mid landing across the berth's full width (hatch-cover stack included); the Block 4A container plateau
  // 【kelpline】中心=横跨泊位全宽的中段平台(含舱盖堆放);Alpha 侧=4A 街区集装箱顶台
  kelpline: {
    center: [{ poly: orect(0, 0, K35, 6.5, 7), y0: -0.3, y1: 2.6 }],
    side: { poly: orect(-2.1, -22.2, K35, 4, 6.5), y0: 2.3, y1: 2.9 },
  },
  // the Great Pan's two quarters beside the wind pump (two-zone centre); the packing-shed roof
  // 【saltpan】中心=大风车(风泵)旁的两块盐田(两区中心);Alpha 侧=包装棚屋顶
  saltpan: {
    center: [{ poly: rect(3.6, 13, -0.8, 8), y0: -1.4, y1: -0.9 }, { poly: rect(-13, -3.6, -8, 0.8), y0: -1.4, y1: -0.9 }],
    side: { poly: rect(-26, -15, -25, -18), y0: 3.0, y1: 4.4 },
  },
  // the market hall floor the length of the tram; the tram pier out to its end over the harbour
  // 【crossmarket】中心=沿电车长度方向的市集大厅地面;Alpha 侧=伸向海港尽头的电车站台
  crossmarket: {
    center: [{ poly: orect(0, 0, X31, 5, 6), y0: -0.2, y1: 0.5 }],
    side: { poly: orect(-22.88, -13.72, X31, 6.2, 3.95), y0: -0.2, y1: 0.5 },
  },
  // the humpback bridge between its parapets (ramps included, not the towpath under it); two yard pockets per side
  // 【lockgate】中心=驼背桥桥面(含引桥,不含桥下的拖船道);Alpha 侧=两处船坞口袋地块(多块共享覆盖)
  lockgate: {
    center: [{ poly: orect(0, 0, L45, 15.5, 2.2), y0: 0.3, y1: 3.5 }],
    side: { polys: [rect(-1.5, 5.5, -28, -18), rect(-15.5, -8, -25.5, -18.7)], y0: -0.3, y1: 0.4 },
  },
  // San Vito's sagrato, the whole open platform round the tempietto (Zone Control build: 16 x 12, the chapel block is
  // gone — only the colonnade's columns stand on it); the promenade bulge on the sea wall
  // 【terraces】中心=小教堂周圈露天平台(Zone Control 构建为 16×12,教堂体块已移除,
  // 只剩柱廊立柱);Alpha 侧=海堤步道凸出段
  terraces: {
    center: [{ poly: rect(-8, 8, -6, 6), y0: 1.0, y1: 1.4 }],
    side: { poly: [[14.4, -27.1], [20, -22.5], [20, -15.2], [14.4, -10.6]], y0: -0.3, y1: 0.4 },
  },
};
