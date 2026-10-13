// ============================================================================
// 【中文导读】HULLBREAKER 的导航层(BossNav 类):把舞台离散成 0.5m 栅格,预计算两张"安全距离场",
//   再用 A* 在可规划格上寻路并拉直。它不驱动移动,只回答"这只大螃蟹能不能站在这里/能不能这样转身/
//   直线能走多远/怎么过去"。BossBrain 每帧查询它来做决策。
// ----------------------------------------------------------------------------
// 【模块定位】被 boss.js 的 Boss 构造时 new 一次(离线/主机侧才有意义);BossBrain 持有并频繁调用
//   poseOk / cast / path / randomPoint 等。纯 CPU、无渲染资源。
// 【核心机制】
//   · 两张距离场:_field() 对每格暴力搜索最近的目标格,得到
//       Dw = 到最近 WALL(实心块 / 高台,高过 STRIDE=1.35m 的)的距离;
//       Dv = 到最近 DROP(海、缺口、舞台边缘、出生台)的距离。
//   · 两个足迹集合(WALL_BODY / FLOOR_BODY)都是模型空间里的圆盘(z 前后 + r 半径):WALL_BODY 是爪/腿/壳缘,
//     必须离墙足够远;FLOOR_BODY 是"身体下方",必须站在地板上(允许爪腿探出码头,但身体不入水)。
//   · poseOk 就是用 yaw 把圆盘中心旋转到世界坐标,逐一查两张距离场是否达标。
//   · plan 是一张"可规划格"掩码:从多个连通块里挑出【最大的、且离队伍出生台最远的】那块作为主场,避免
//     Boss 走到玩家出生点旁边。
// 【关键约定】单位米;坐标系 xz + yaw(绕 y)。STRIDE=1.35 表示可跨过的障碍高度上界;PAD_MARGIN 是
//   身体相对出生屏障要额外留出的余量(pad0 留 3.5、其余留 1.0)。path 返回 [[x,z],…] 世界坐标折线或 null。
// 【配套阅读】docs/BOSS.zh-CN.md、docs/BOSS.md;调用方 bossBrain.js(walk/turn/pickGoal 都依赖它),
//   数据来源 level 的 bounds/groundHeight/pointInside/spawnPads/spawnBarrier。
// ============================================================================
// HULLBREAKER navigation: a 0.5 m grid over the stage with two clearance fields — distance to the nearest WALL (solid
// blocks and raised decks taller than it can stride over) and distance to the nearest DROP (sea, gaps, the edge of the
// stage, the spawn pads). A pose is valid when the full footprint (claws + legs) clears every wall and the body itself
// (shell + belly) is over floor: on a narrow pier its legs may splay out over the water, but it never wades in, never
// pushes a claw through a wall and never sets foot on a spawn pad. Paths are A* over cells with room to walk and turn,
// string-pulled into straight legs.
import * as THREE from 'three';

// footprints in model space (feet at y 0, facing +z)
// 【对墙足迹】两个圆盘(z 前后偏移 + r 半径),代表爪/腿/壳缘;poseOk 要求它们离墙 ≥ r
export const WALL_BODY = [{ z: 2.3, r: 2.5 }, { z: -1.8, r: 2.6 }];                  // claws, legs, shell rim vs walls
// 【对地足迹】三个圆盘,代表"身体正下方",要求落在有地板的区域(可以探出码头但身体不入水)
export const FLOOR_BODY = [{ z: 2.2, r: 1.45 }, { z: 0, r: 1.5 }, { z: -2.3, r: 1.45 }];  // body over floor
const PLAN_WALL = 2.9;     // path cells: room to swing the claws round
const PLAN_FLOOR = 1.8;    // … and the body well over the floor
const STRIDE = 1.35;       // obstacles up to this high are stepped over (the legs clear them; the belly rides at 1.7 m)
const PAD_MARGIN = [3.5, 1.0];   // the body keeps this far outside a spawn barrier (the squad's pad: well clear)
const _p = new THREE.Vector3();

// 【导航类】构造时一次性烘焙地面高度、kind 分类、两张距离场与可规划区域;运行期只读查询
export class BossNav {
  // 构造:按 level.bounds 建立栅格,算出 floor/kind/pads,再 _build 烘焙距离场与 plan
  constructor(level) {
    this.level = level;
    const B = level.bounds, st = (this.step = 0.5);
    this.x0 = B.minX + st / 2; this.z0 = B.minZ + st / 2;
    this.nx = Math.floor((B.maxX - B.minX) / st); this.nz = Math.floor((B.maxZ - B.minZ) / st);
    const N = this.nx * this.nz;
    // 【逐格数据】floor 记录地形高度;kind 是分类标签(下面的值 0/1/2/3),两者按下标 i = iz*nx + ix 存
    this.floor = new Float32Array(N);
    this.kind = new Uint8Array(N);   // 0 floor · 1 wall (solid / raised) · 2 drop (sea, gap) · 3 spawn pad
    this.pads = level.spawnPads.map((p) => ({ x: p.x, z: p.z, r: level.spawnBarrier }));
    this.planR = PLAN_WALL;
    this._build();
  }

  // 【烘焙】一次性算出主地坪高度、逐格 kind/floor、两张距离场、以及可规划区域 plan;运行期不再重算
  _build() {
    const L = this.level, N = this.nx * this.nz, st = this.step;
    // main floor height: the most common ground level across the stage (0.25 m bins)
    // 【主地坪高度】用 0.25m 直方图取众数(=出现最多的地面高度),作为"基准地面"best;低于 it 太多的算水
    const hist = new Map();
    for (let i = 0; i < N; i++) {
      const [x, z] = this.xz(i);
      const g = L.groundHeight(x, z, 30);
      if (g > -5) { const k = Math.round(g * 4); hist.set(k, (hist.get(k) || 0) + 1); }
    }
    let best = 0, bn = -1;
    for (const [k, n] of hist) if (n > bn) { bn = n; best = k / 4; }
    this.floorY = best;
    for (let i = 0; i < N; i++) {
      const [x, z] = this.xz(i);
      // ground under the body: the main floor, or anything low enough to stride over (curbs, benches, planters, crates);
      // the body itself stays at floor height. Taller blocks and raised decks are walls to it.
      const g = L.groundHeight(x, z, best + STRIDE);
      let k = 0;
      // 【水判定】地面比基准低 0.55m 以上视为 drop(k=2);否则记地形高度,再用几个高度层探针判断上方是否有墙
      if (!(g >= best - 0.55)) k = 2;
      else {
        this.floor[i] = g;
        // 在 1.45/2.6/3.8/5.2m 四个高度各探一次,只要有一层落在实心体内即为墙(高台/集装箱等)
        for (const h of [STRIDE + 0.1, 2.6, 3.8, 5.2]) if (L.pointInside(_p.set(x, best + h, z), 0)) { k = 1; break; }
      }
      // 【出生台】墙格不覆盖;其余格若落在某个出生屏障 + 余量内,标记为不可踩的 pad(k=3)
      if (k !== 1) this.pads.forEach((pd, t) => { if (Math.hypot(x - pd.x, z - pd.z) < pd.r + PAD_MARGIN[t]) k = 3; });
      this.kind[i] = k;
      if (k) this.floor[i] = best;   // 非地面格的高度统一记为主地坪(仅作基准)
    }
    // 【两张距离场】Dw:到墙(k=1)的距离;Dv:到落水/边缘(k>=2,含舞台外缘)的距离
    this.Dw = this._field((k) => k === 1);
    this.Dv = this._field((k) => k >= 2, true);
    // plannable cells; keep one connected region: the boss's home ground — big, and toward the far end of the stage from
    // the squad's spawn (team 0), so it never wanders up to the squad's pad
    // 【可规划掩码】同时满足"离墙够远(PLAN_WALL)"与"离地够近(PLAN_FLOOR)"的格才可走
    const nx = this.nx, nz = this.nz;
    const ok = new Uint8Array(N);
    for (let i = 0; i < N; i++) ok[i] = this.Dw[i] >= PLAN_WALL && this.Dv[i] >= PLAN_FLOOR ? 1 : 0;
    const comp = new Int32Array(N).fill(-1);
    let bestC = -1, bestScore = 0, c = 0;
    const pad = this.pads[0], span = Math.hypot(L.bounds.maxX - L.bounds.minX, L.bounds.maxZ - L.bounds.minZ);
    // 【连通块划分】对每个未访问的 ok 格做 8 邻域洪水填充(显式栈,避免深递归),统计 size 与质心(sx/sz)
    for (let i = 0; i < N; i++) {
      if (!ok[i] || comp[i] >= 0) continue;
      let size = 0, sx = 0, sz = 0; const stack = [i]; comp[i] = c;
      while (stack.length) {
        const k = stack.pop(); size++;
        const [kx0, kz0] = this.xz(k); sx += kx0; sz += kz0;
        const kx = k % nx, kz = (k / nx) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const jx = kx + dx, jz = kz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (ok[j] && comp[j] < 0) { comp[j] = c; stack.push(j); }
        }
      }
      // 【选块打分】面积越大越好、质心离队伍出生台越远越好(0.4 保底项避免小远块翻盘)
      const score = size * (0.4 + Math.hypot(sx / size - pad.x, sz / size - pad.z) / span);
      if (score > bestScore) { bestScore = score; bestC = c; }
      c++;
    }
    // 【最终主场】只保留胜出的那一块作为 plan;planIds 是其格下标表,供 randomPoint 均匀取样
    this.plan = new Uint8Array(N);
    this.planIds = [];
    for (let i = 0; i < N; i++) if (ok[i] && comp[i] === bestC) { this.plan[i] = 1; this.planIds.push(i); }
    this.area = this.planIds.length * st * st;
  }

  // distance from each cell centre to the nearest matching cell's edge (brute force within 7 m; off-grid counts when edge)
  // 【构建距离场】对每格取最近匹配格:用预排序的偏移列表(按距离升序)逐个探测,命中即停。
  //   _offs 是 (2R+1)^2 邻域按距离排序的 [dx,dz,dist] 表,只建一次(所有 _field 调用共享)。
  //   edge=true 时,越出栅格边界也算"匹配"(用于 Dv,把舞台外缘当作落水)。
  _field(match, edge = false) {
    const R = 14, N = this.nx * this.nz, nx = this.nx, nz = this.nz, st = this.step, D = new Float32Array(N);
    // 【偏移表】(2R+1)^2 个邻域偏移按欧氏距离升序排一次;之后每格只需从头探测,首个命中即最近
    if (!this._offs) {
      this._offs = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) { const d = Math.hypot(dx, dz) * st; if (d <= R * st) this._offs.push([dx, dz, d]); }
      this._offs.sort((a, b) => a[2] - b[2]);
    }
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      if (match(this.kind[i])) { D[i] = 0; continue; }   // 本格即目标,距离 0
      let d = R * st;   // 默认上限:超出 7m 探测范围一律记 7m(足够远即可)
      for (const [dx, dz, dd] of this._offs) {
        const jx = ix + dx, jz = iz + dz;
        const out = jx < 0 || jz < 0 || jx >= nx || jz >= nz;
        // 命中目标格(或越界且 edge)则停下;减去半格修正"格心到格心"的量化误差
        if (out ? edge : match(this.kind[jz * nx + jx])) { d = Math.max(0, dd - st * 0.5); break; }
      }
      D[i] = d;
    }
    return D;
  }

  // 【格下标 → 世界坐标】返回该格中心的 [x, z]
  xz(i) { return [this.x0 + (i % this.nx) * this.step, this.z0 + ((i / this.nx) | 0) * this.step]; }
  // 【世界坐标 → 格下标】就近取整;越界返回 -1
  cell(x, z) {
    const ix = Math.round((x - this.x0) / this.step), iz = Math.round((z - this.z0) / this.step);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }
  // 【查询封装】以下五个把"越界/查询"统一成安全默认值,方便上层直接用世界坐标问问题
  wallClear(x, z) { const i = this.cell(x, z); return i < 0 ? 0 : this.Dw[i]; }   // 到墙距离,越界按 0(贴墙)
  floorClear(x, z) { const i = this.cell(x, z); return i < 0 ? 0 : this.Dv[i]; }  // 到落水/边缘距离
  kindAt(x, z) { const i = this.cell(x, z); return i < 0 ? 2 : this.kind[i]; }    // 格分类,越界当成 drop(2)
  // 【地面高度】非地面格回退到主地坪;若地形比主地坪高出 ≥0.45m 也回退(避免 Boss 站上高台)
  floorAt(x, z) { const i = this.cell(x, z); const f = i < 0 || this.kind[i] ? this.floorY : this.floor[i]; return f - this.floorY < 0.45 ? f : this.floorY; }
  inPad(x, z, margin = 0) { for (const p of this.pads) if (Math.hypot(x - p.x, z - p.z) < p.r + margin) return true; return false; }
  isPlan(x, z) { const i = this.cell(x, z); return i >= 0 && !!this.plan[i]; }

  // the whole footprint fits: claws/legs clear of walls, body over floor
  // 【姿态合法性】按 yaw 把每个足迹圆盘中心旋到世界,要求 WALL_BODY 离墙达标、FLOOR_BODY 站在地板上
  poseOk(x, z, yaw) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (const b of WALL_BODY) if (this.wallClear(x + s * b.z, z + c * b.z) < b.r) return false;
    for (const b of FLOOR_BODY) if (this.floorClear(x + s * b.z, z + c * b.z) < b.r) return false;
    return true;
  }
  // turning on the spot: the claws must clear the walls at the new heading and the belly stays over floor (the ends
  // may swing out over the water for a moment — a crab turning on a pier)
  // 【原地转身合法性】比 poseOk 宽松:只查爪/腿对墙 + 身体中心在地板上(两端可短暂探出码头)
  turnOk(x, z, yaw) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (const b of WALL_BODY) if (this.wallClear(x + s * b.z, z + c * b.z) < b.r) return false;
    return this.floorClear(x, z) >= FLOOR_BODY[1].r;
  }

  // how far the body can travel straight along yaw before the pose stops fitting; wall = a solid is what stops it
  // 【直线探测】从 (x,z) 沿 yaw 以 stepLen 为步长推进,返回 {dist, wall}。
  //   dist 是走不动的距离;wall=true 表示"停下的是墙"(撞墙),false 表示是边缘/出生台(会蹭出滑行)
  cast(x, z, yaw, maxDist, stepLen = 0.25) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    let d = 0;
    while (d + stepLen <= maxDist && this.poseOk(x + s * (d + stepLen), z + c * (d + stepLen), yaw)) d += stepLen;
    let wall = false;
    if (d + stepLen <= maxDist) {
      // what's just ahead of the claws: a wall bonks; an edge or the pad makes it dig in and skid
      // 【判别阻挡源】在爪前方 ±0.9rad 扫 9 条射线,只要有一条落在墙格(kind=1)就判定为撞墙
      const f = WALL_BODY[0], fx = x + s * (d + f.z), fz = z + c * (d + f.z);
      for (let k = 0; k <= 8 && !wall; k++) {
        const a = -0.9 + (k / 8) * 1.8;
        const px = fx + Math.sin(yaw + a) * (f.r + 0.6), pz = fz + Math.cos(yaw + a) * (f.r + 0.6);
        if (this.kindAt(px, pz) === 1) wall = true;
      }
    }
    return { dist: d, wall };
  }

  // 【单格可走判断】slack 允许比 PLAN 阈值稍松,用于路径拉直时的容差
  _cellOk(i, slack = 0) { return i >= 0 && this.Dw[i] >= PLAN_WALL - slack && this.Dv[i] >= PLAN_FLOOR - slack; }
  // straight walk between two points stays on plannable ground
  // 【直线可走】按 0.8 格步长采样两点连线,全部落格都 _cellOk 才返回 true(路径拉直用)
  lineOk(x0, z0, x1, z1, slack = 0.3) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / (this.step * 0.8)));
    for (let k = 0; k <= n; k++) { const t = k / n; if (!this._cellOk(this.cell(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t), slack)) return false; }
    return true;
  }

  // the plannable cell nearest to (x, z)
  // 【最近可规划格】从 (x,z) 向外按"环 r"逐圈搜索,只查第 r 圈(切比雪夫距离),命中即停,最多 60 圈
  nearestPlan(x, z) {
    const ix = Math.round((x - this.x0) / this.step), iz = Math.round((z - this.z0) / this.step);
    for (let r = 0; r < 60; r++) {
      let best = -1, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        const j = jz * this.nx + jx;
        if (!this.plan[j]) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) return best;
    }
    return this.planIds[0] ?? -1;
  }

  // A* over plannable cells (prefers open floor), string-pulled into a few straight legs. Returns [[x, z], …] or null.
  // 【A* 寻路】在 plan 格上做 8 邻域 A*,代价含"离墙/离地惩罚"(偏好开阔地);解出后做弦长拉直输出折线。
  //   返回世界坐标数组 [[x,z],…] 或 null(不可达)。用 stamp 机制复用缓冲,避免每次分配大数组。
  path(x0, z0, x1, z1) {
    const a = this.nearestPlan(x0, z0), b = this.nearestPlan(x1, z1);
    if (a < 0 || b < 0) return null;
    const N = this.nx * this.nz, nx = this.nx;
    // 【复用缓冲】g/from/seen/closed 一次性分配;用单调递增的 stamp 当"这一轮有没有访问过"的版本号
    if (!this._g) { this._g = new Float32Array(N); this._from = new Int32Array(N); this._seen = new Uint32Array(N); this._closed = new Uint32Array(N); this._stamp = 0; }
    const g = this._g, from = this._from, seen = this._seen, closed = this._closed, st = ++this._stamp;
    const [bx, bz] = this.xz(b);
    const h = (i) => { const [x, z] = this.xz(i); return Math.hypot(x - bx, z - bz); };   // 启发式:到目标的直线距离
    const heap = new MinHeap();
    g[a] = 0; from[a] = -1; seen[a] = st; heap.push(a, h(a));
    let it = 0;
    while (heap.size && it++ < 40000) {   // 迭代上限 40000,防止病态网格卡死
      const cur = heap.pop();
      if (cur === b) break;
      if (closed[cur] === st) continue;   // 已最终确定,跳过重复入堆的旧项
      closed[cur] = st;
      const cx = cur % nx, cz = (cur / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = cx + dx, jz = cz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= this.nz) continue;
        const j = jz * nx + jx;
        if (!this.plan[j]) continue;
        // 【代价函数】基础是格距;离墙/离地越近的格加惩罚(5/3m 内线性),让路径偏向开阔水面
        const ng = g[cur] + Math.hypot(dx, dz) * this.step * (1 + Math.max(0, 5 - this.Dw[j]) * 0.1 + Math.max(0, 3 - this.Dv[j]) * 0.15);
        if (seen[j] !== st || ng < g[j]) { seen[j] = st; g[j] = ng; from[j] = cur; heap.push(j, ng + h(j)); }
      }
    }
    if (seen[b] !== st) return null;   // 从未到达终点 → 不可达
    // 【回溯路径】沿 from 反推格链(上限 8000 防环),再反转成正序
    const cells = [];
    for (let k = b; k !== -1; k = from[k]) { cells.push(k); if (cells.length > 8000) break; }
    cells.reverse();
    // 【弦长拉直】从当前锚点尽量往后找最远"直线可走"的点作为下一路点,把锯齿折线压成几段直线
    const out = [this.xz(cells[0])];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      const [ax, az] = this.xz(cells[i]);
      while (j > i + 1) { const [qx, qz] = this.xz(cells[j]); if (this.lineOk(ax, az, qx, qz)) break; j--; }
      out.push(this.xz(cells[j]));
      i = j;
    }
    return out;
  }

  // a plannable point: rnd() → [0,1)
  // 【随机可走点】在 planIds 上均匀取一格,用于 Boss 闲逛/选点;rnd 由调用方注入以保持确定性
  randomPoint(rnd) { const i = this.planIds[(rnd() * this.planIds.length) | 0]; return i === undefined ? [0, 0] : this.xz(i); }
}

// 【二叉最小堆】A* 的开放集:并行数组存 id 与优先级,手写 sift-up/sift-down 避免对象分配
class MinHeap {
  constructor() { this.ids = []; this.pr = []; }
  get size() { return this.ids.length; }
  // 【入堆】先把元素放到末尾,再与父节点比优先级向上冒泡(sift-up)
  push(id, p) {
    const ids = this.ids, pr = this.pr;
    let i = ids.length; ids.push(id); pr.push(p);
    while (i > 0) { const j = (i - 1) >> 1; if (pr[j] <= p) break; ids[i] = ids[j]; pr[i] = pr[j]; i = j; }
    ids[i] = id; pr[i] = p;
  }
  // 【出堆】取出堆顶后,用末尾元素顶替堆顶再向下沉降(sift-down),恢复堆序
  pop() {
    const ids = this.ids, pr = this.pr, top = ids[0], lid = ids.pop(), lp = pr.pop();
    if (ids.length) {
      let i = 0; const n = ids.length;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i, mp = lp;
        if (l < n && pr[l] < mp) { m = l; mp = pr[l]; }
        if (r < n && pr[r] < mp) { m = r; mp = pr[r]; }
        if (m === i) break;
        ids[i] = ids[m]; pr[i] = pr[m]; i = m;
      }
      ids[i] = lid; pr[i] = lp;
    }
    return top;
  }
}
