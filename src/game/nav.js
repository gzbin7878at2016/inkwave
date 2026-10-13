// ============================================================================
// 【中文导读】nav.js —— Bot 导航网格与寻路(关卡自动烘焙 + A*)
// ----------------------------------------------------------------------------
// 【模块定位】bot AI(bots.js)的"地图认知"来源。从 level 的实体盒自动烘焙一张 1m 网格的
//   可行走图:节点 = 占位上的可行走进出点(带高度),边 = walk / jump(上跳)/ drop(下落)/
//   climb(涂墙上爬)。离线按需构建(每关卡一次),运行期只做 nearest(定位)与 path(A*)查询。
// 【核心机制】
//   · _build:逐格用 queryBlocks 找该 XZ 处所有"朝上的实体顶面"(排除 roof/rail/noNav),
//     扣除头顶净空(_clear:身体环 + 头顶高度)后建节点;再连 8 邻接边,加 climb 边。
//   · _prune:双重可达性剪枝。seed = 离 team-0 出生台最近的最大连通区节点;valid = 从 seed
//     可达【且】能回到 seed(避免把 Bot 送进爬不出的坑);exitable = 能回到 seed(掉到怪处仍能
//     寻回家)。双向集过小时退回"整区有效"的安全网,防止把 Bot 困死。
//   · path:A*(二叉堆)+ 可采纳启发式(平面距离 + 0.5×高度差)。格子的 zone 是出生台归属,
//     敌方 zone 的节点对当前 team 不可通行;湿滑(近水)节点加代价,让路线稍微远离水边。
//   · Heap:手写二叉堆(数组存 id + 优先级),避免闭包与对象分配。
// 【关键约定】单位米;nodes[].y 是脚底高度;step=1.0m 网格;节点和边在构建后不可变,
//   查询期零分配(g/from/seen/closed 是复用缓冲,用 _stamp 时间戳式"清空"避免每帧 fill)。
// 【配套阅读】physics.js(raycast/pointInside 用于净空与遮挡)、bots.js(如何消费 path)、
//   config.js 的 PLAYER(半径/stepUp)、docs/ARCHITECTURE.zh-CN.md §2.3。
// ============================================================================
// Navigation graph auto-generated from the level: 1 m grid of walkable samples on every floor/platform/ramp,
// connected by walk / jump-up / drop-down edges. A* with a binary heap.
import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { Hit } from './physics.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3();

// 【导航图】持有 level/physics 引用,构造时即刻烘焙(constructor → _build)。节点数可达数千,
// 但只构建一次;之后是纯读查询。
export class NavGraph {
  constructor(level, physics) {
    this.level = level; this.physics = physics;
    this.step = 1.0;
    this.nodes = [];
    this._build();
  }

  // 【构建】三遍:1) 逐格找顶面 → 扣净空 → 建节点(含出生台 zone 归属);
  // 2) 标注湿滑/格栅下方有水;3) 连 8 邻接的 walk/jump/drop 边;最后加 climb 边、剪枝。
  _build() {
    const L = this.level, B = L.bounds, st = this.step;
    this.x0 = B.minX + st / 2; this.z0 = B.minZ + st / 2;
    this.nx = Math.floor((B.maxX - B.minX) / st); this.nz = Math.floor((B.maxZ - B.minZ) / st);
    this.cells = new Array(this.nx * this.nz);
    const topBlocks = L.blocks.filter((b) => b.solid && b.axes[1].y > 0.6);
    const ids = [];
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.x0 + ix * st, z = this.z0 + iz * st;
        const heights = [];
        L.queryBlocks(x - 0.01, z - 0.01, x + 0.01, z + 0.01, ids);
        for (const id of ids) {
          const b = L.blocks[id];
          if (!b.solid || b.axes[1].y < 0.6 || b.roof || b.rail || b.noNav) continue;   // (roofs: off limits; rail tops / noNav walls: no route runs along them)
          const n = b.axes[1];
          // 【顶面求交】把顶面沿法线平移半高得到面上一点 top,再解该面在 (x,z) 处的 y
          // (斜面/坡道也能精确求高)。下方 pointInBlock 用极小容差确认这个点确实落在实心盒内。
          const top = _p.copy(b.center).addScaledVector(n, b.half.y);
          const y = top.y - (n.x * (x - top.x) + n.z * (z - top.z)) / n.y;
          _d.set(x, y - 0.02, z);
          if (!L.pointInBlock(b, _d, 0.001)) continue;
          if (heights.some((h) => Math.abs(h - y) < 0.15)) continue;
          heights.push(y);
        }
        const list = [];
        for (const y of heights) {
          // headroom + clearance (not inside geometry, not hugging walls)
          if (!this._clear(x, y, z)) continue;
          const node = { id: this.nodes.length, x, y, z, ix, iz, nb: [], zone: -1 };
          for (let t = 0; t < 2; t++) {
            const pad = L.spawnPads[t];
            if (Math.hypot(x - pad.x, z - pad.z) < L.spawnBarrier + 0.6 && y > pad.y - 1) node.zone = t;
          }
          this.nodes.push(node);
          list.push(node.id);
        }
        this.cells[iz * this.nx + ix] = list;
      }
    }
    // water proximity: wet = 2 with open water within ~1.2 m, 1 within ~2.2 m (paths pay extra to hug such edges);
    // overWater = standing on a grate with water under it (a squid would drop through)
    // 【近水标注】wet=2:1.2m 内有开阔水;wet=1:2.2m 内。寻路会给湿节点加代价,让路线略离水边
    // (Bot 掉水里=死)。overWater:站在格栅上而其下方是水(鱿鱼会漏下去)。
    for (const n of this.nodes) {
      n.wet = 0;
      for (const [rad, level] of [[1.2, 2], [2.2, 1]]) {
        if (n.wet) break;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (L.groundHeight(n.x + Math.cos(a) * rad, n.z + Math.sin(a) * rad, n.y + 0.6) === -Infinity) { n.wet = level; break; }
        }
      }
      n.overWater = L.groundHeight(n.x, n.z, n.y + 0.3, true) === -Infinity;
    }
    // edges
    // 【连边规则】8 邻接:高差 ≤0.5 → walk(对角线要求两个正交邻格都存在且高度相近,防穿角);
    // 上跳 0.5<dy≤1.25 且非对角 → jump(额外代价 2.5);下坠 -3.4≤dy<-0.5 且非对角且下方无遮挡
    // → drop(代价 0.8)。每类都先 _blocked 检查两格间腰部是否有栏杆/薄墙挡路。
    for (const n of this.nodes) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = n.ix + dx, jz = n.iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        for (const mid of this.cells[jz * this.nx + jx]) {
          const m = this.nodes[mid];
          const dy = m.y - n.y;
          const flat = Math.hypot(dx, dz) * this.step;
          if (Math.abs(dy) <= 0.5) {
            if (dx && dz) { // diagonal: both orthogonal neighbours must exist at similar height
              if (!this._has(n.ix + dx, n.iz, n.y) || !this._has(n.ix, n.iz + dz, n.y)) continue;
            }
            if (this._blocked(n, m, Math.max(n.y, m.y))) continue;   // a railing / thin wall between the two cells
            n.nb.push({ to: mid, cost: flat, type: 'walk' });
          } else if (dy > 0.5 && dy <= 1.25 && !(dx && dz)) {
            if (this._blocked(n, m, m.y)) continue;                    // rail along the ledge above
            n.nb.push({ to: mid, cost: flat + 2.5, type: 'jump' });
          } else if (dy < -0.5 && dy >= -3.4 && !(dx && dz) && this._openAbove(m, n.y)) {
            if (this._blocked(n, m, n.y)) continue;                    // rail along the ledge you'd drop off
            n.nb.push({ to: mid, cost: flat + 0.8, type: 'drop' });
          }
        }
      }
    }
    this._climbEdges();
    // keep nodes connected to the spawn both ways (see _prune)
    this._prune();
  }

  // 【可选通行性】两邻格之间的腰部高度(y+0.6)是否被实体挡住——站在两格中心之间的栏杆/栅栏/薄墙
  // (格栅与栏杆也算:kid 过不去)。用一条水平 raycast 探。
  // is the walk between two neighbouring cells cut by something solid at waist height — a railing, fence or thin wall
  // standing between the cell centres (grates and rails count: kids can't pass them)
  _blocked(n, m, y) {
    if (!this.physics) return false;
    _p.set(n.x, y + 0.6, n.z); _d.set(m.x - n.x, 0, m.z - n.z);
    const len = _d.length(); if (len < 1e-4) return false;
    _d.multiplyScalar(1 / len);
    return this.physics.raycast(_p, _d, len, this._bh || (this._bh = new Hit()), false).hit;
  }

  // 【下落净空】从 fromY 高度往下落到 m,m 上方(1.0m 到 fromY 之间)不能有实体挡着——
  // 否则头顶的走道/阳台会被误判成"穿过自己地板"的落点。
  // a drop lands on m only if nothing solid hangs over it below the ledge it drops from (a walkway / veranda / deck
  // overhead would otherwise read as a drop "through" its own floor)
  _openAbove(m, fromY) {
    const L = this.level;
    for (let y = m.y + 1.0; y < fromY - 0.05; y += 0.3) if (L.pointInside(_p.set(m.x, y, m.z), 0)) return false;
    return true;
  }

  // 【格内有近高节点】查询 (ix,iz) 格在高度 y ±0.5 内是否有节点(对角线连边的正交校验用)。
  _has(ix, iz, y) {
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return false;
    return this.cells[iz * this.nx + ix].some((id) => Math.abs(this.nodes[id].y - y) <= 0.5);
  }

  // 【净空判定】节点在 (x,y,z) 处身体能否容纳:向上取 4 个高度(0.15/0.4/0.85/1.4)测中心点,
  // 从 0.4 起再测半径 r(=PLAYER.radius+0.08)的 8 点环。0.4 以下只测中心:胶囊体抬到 stepUp 之上,
  // 下层环会在 >18° 的坡上误插进坡体,故不测。
  _clear(x, y, z) {
    const L = this.level;
    const r = PLAYER.radius + 0.08;
    // the body ring is tested from just above step-up height: the capsule rides that high (curbs below it are walked
    // onto), and a lower ring would dip into the slope itself on any ramp steeper than ~18°
    for (const h of [0.15, 0.4, 0.85, 1.4]) {
      if (L.pointInside(_p.set(x, y + h, z), 0)) return false;
      if (h < PLAYER.stepUp) continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (L.pointInside(_p.set(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r), 0)) return false;
      }
    }
    return true;
  }


  // 【双向可达剪枝】从 team-0 出生台出发的有向可达性分析,见文件导读【核心机制】_prune 条。
  _prune() {
    // Directed reachability from the team-0 spawn. valid = nodes you can reach from spawn AND walk/jump back from
    // (goals: never send a bot into a pit it can't leave); exitable = nodes that can get back to spawn (starts: a bot
    // that fell somewhere odd can still path home).
    const N = this.nodes.length;
    const radj = Array.from({ length: N }, () => []);
    for (const n of this.nodes) for (const e of n.nb) radj[e.to].push(n.id);
    const walk = (start, next) => {
      const seen = new Uint8Array(N), stack = [start]; seen[start] = 1;
      while (stack.length) { const k = stack.pop(); for (const j of next(k)) if (!seen[j]) { seen[j] = 1; stack.push(j); } }
      return seen;
    };
    // seed = the node of the largest undirected region nearest the team-0 spawn pad (never a lone node on a prop top)
    const und = (k) => [...this.nodes[k].nb.map((e) => e.to), ...radj[k]];
    const comp = new Int32Array(N).fill(-1);
    let bestC = -1, bestSize = 0, c = 0;
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0) continue;
      const seen = walk(i, und); let size = 0;
      for (let k = 0; k < N; k++) if (seen[k]) { comp[k] = c; size++; }
      if (size > bestSize) { bestSize = size; bestC = c; }
      c++;
    }
    const pad = this.level.spawnPads[0];
    let seed = -1, sd = Infinity;
    for (const n of this.nodes) {
      if (comp[n.id] !== bestC) continue;
      const d = (n.x - pad.x) ** 2 + (n.z - pad.z) ** 2 + ((n.y - pad.y) * 3) ** 2;
      if (d < sd) { sd = d; seed = n.id; }
    }
    this.valid = new Uint8Array(N);
    if (seed < 0) { this.exitable = this.valid; this.validIds = []; return; }
    const fwd = walk(seed, (k) => this.nodes[k].nb.map((e) => e.to));
    const back = walk(seed, (k) => radj[k]);
    this.exitable = back;
    let count = 0;
    for (let i = 0; i < N; i++) { this.valid[i] = fwd[i] && back[i] ? 1 : 0; count += this.valid[i]; }
    // safety net: if the two-way set is implausibly small, fall back to the whole region rather than strand the bots
    // 【安全网】若双向集不到最大连通区的一半(关卡过于破碎),退回"整区有效",宁可放宽也不把 Bot 困死。
    if (count < bestSize * 0.5) { for (let i = 0; i < N; i++) this.valid[i] = comp[i] === bestC ? 1 : 0; this.exitable = this.valid; }
    this.validIds = this.nodes.filter((n) => this.valid[n.id]).map((n) => n.id);
  }


  // 【最近节点】从 pos 所在格向外逐环(半径 0..3)找最近的合法节点:只接受高度不高于 pos+maxUp
  // 的节点(不能"跳"到头顶的高台上),距离用平面距离 + 2.5×高度差加权。start=true 时也接受
  // 只能"出去"的 exitable 节点(见 _prune),便于从怪位置寻路回家。
  // start = true also accepts nodes that are only a way *out* (see _prune)
  nearest(pos, maxUp = 0.8, start = false) {
    const ix = Math.round((pos.x - this.x0) / this.step), iz = Math.round((pos.z - this.z0) / this.step);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
        for (const id of this.cells[jz * this.nx + jx]) {
          if (!this.valid[id] && !(start && this.exitable[id])) continue;
          const n = this.nodes[id];
          if (n.y > pos.y + maxUp) continue;
          const d = (n.x - pos.x) ** 2 + (n.z - pos.z) ** 2 + ((n.y - pos.y) * 2.5) ** 2;
          if (d < bd) { bd = d; best = id; }
        }
      }
      if (best >= 0) return best;
    }
    return best;
  }

  // 【A* 寻路】从节点 a 到 b;team 用于屏蔽敌方出生台 zone;返回含 a、b 的节点 id 数组或 null。
  // noClimb:不使用 climb 边(刚爬墙失败的 Bot 重规划)。启发式 h 可采纳(平面距离 + 0.5×高差),
  // 保证最短。g/from/seen/closed 是复用缓冲 + 时间戳 st 逻辑清空(避免每次 path 都 fill 大数组)。
  // A* from node a to node b; `team` blocks the enemy spawn zone. Returns array of node ids (incl. a and b) or null.
  // noClimb: plan without climb edges (a bot that just failed a climb)
  path(a, b, team, maxIter = 6000, noClimb = false) {
    if (a < 0 || b < 0) return null;
    const N = this.nodes.length;
    if (!this._g || this._g.length !== N) { this._g = new Float32Array(N); this._from = new Int32Array(N); this._seen = new Uint32Array(N); this._closed = new Uint32Array(N); this._stamp = 0; }
    const g = this._g, from = this._from, seen = this._seen, closed = this._closed;
    const st = ++this._stamp;
    const nodes = this.nodes, goal = nodes[b];
    const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z) + Math.abs(n.y - goal.y) * 0.5;
    const heap = new Heap();
    g[a] = 0; from[a] = -1; seen[a] = st;
    heap.push(a, h(nodes[a]));
    let it = 0;
    while (heap.size && it++ < maxIter) {
      const cur = heap.pop();
      if (cur === b) break;
      if (closed[cur] === st) continue;
      closed[cur] = st;
      const n = nodes[cur];
      for (const e of n.nb) {
        if (noClimb && e.type === 'climb') continue;
        const m = nodes[e.to];
        if (m.zone >= 0 && m.zone !== team) continue;
        // 【代价】边代价 + 湿滑惩罚(wet=2 加 2.0,wet=1 加 0.5):路线会绕开近水格,减少 Bot 落水。
        const ng = g[cur] + e.cost + (m.wet === 2 ? 2.0 : m.wet === 1 ? 0.5 : 0);
        if (seen[e.to] !== st || ng < g[e.to]) {
          seen[e.to] = st; g[e.to] = ng; from[e.to] = cur;
          heap.push(e.to, ng + h(m));
        }
      }
    }
    if (seen[b] !== st) return null;
    const out = [];
    for (let k = b; k !== -1; k = from[k]) { out.push(k); if (out.length > 4000) break; }
    return out.reverse();
  }

  // 【查边类型】两节点间边的类型串(walk/jump/drop/climb);无此边则默认 'walk'。
  edgeType(a, b) {
    for (const e of this.nodes[a].nb) if (e.to === b) return e.type;
    return 'walk';
  }
  // 【取边对象】返回 a→b 的边记录(含 cost/type 及 climb 的 wallP/wallN/topY),无则 null。
  edge(a, b) {
    for (const e of this.nodes[a].nb) if (e.to === b) return e;
    return null;
  }

  // Climb edges: an inkable wall right in front of a node, whose block top holds a node 1.3–5.5 m higher. Bots
  // ink the wall up to the top and swim up it (the same squid wall-climb players use). They make pits escapable
  // without a ramp and raised perches reachable for long-range weapons.
  // 【爬墙边】节点正前方(1.3m 内)有一面可涂墨的墙(法线朝玩家、需有 atlas 能承接墨水、非格栅/隐藏),
  // 且墙顶上方 1.3–5.5m 处有节点:连一条 climb 边。代价 ≈ 水平距离 + 3.5 + 1.5×抬升高度。
  // 让深坑无需坡道也能逃出、让远处的长枪栖点可达。wallP/wallN/topY 供 Bot 执行涂墙+上爬。
  _climbEdges() {
    const L = this.level, P = this.physics, hit = new Hit(), o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const n of this.nodes) {
      const seenTop = new Set();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        d.set(Math.cos(a), 0, Math.sin(a));
        o.set(n.x, n.y + 0.35, n.z);
        if (!P.raycast(o, d, 1.3, hit, true).hit) continue;
        if (Math.abs(hit.normal.y) > 0.3 || d.x * hit.normal.x + d.z * hit.normal.z > -0.7) continue; // wall, faced head-on
        const f = hit.face >= 0 ? L.faces[hit.face] : null;
        if (!f || !f.atlas) continue;                                                           // must take ink
        const b = L.blocks[f.block];
        if (b.grate || b.hidden) continue;
        const topY = b.center.y + b.axes[1].y * b.half.y;
        if (topY - n.y < 1.3 || topY - n.y > 5.5) continue;
        // node on top, just past the wall
        const qx = hit.point.x - hit.normal.x * 0.9, qz = hit.point.z - hit.normal.z * 0.9;
        const ix = Math.round((qx - this.x0) / this.step), iz = Math.round((qz - this.z0) / this.step);
        if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
        let top = -1;
        for (const id of this.cells[iz * this.nx + ix]) if (Math.abs(this.nodes[id].y - topY) < 0.25) top = id;
        if (top < 0 || seenTop.has(top)) continue;
        seenTop.add(top);
        const m = this.nodes[top], rise = m.y - n.y;
        n.nb.push({ to: top, cost: Math.hypot(m.x - n.x, m.z - n.z) + 3.5 + rise * 1.5, type: 'climb',
          wallP: [hit.point.x, hit.point.y, hit.point.z], wallN: [hit.normal.x, hit.normal.z], topY });
      }
    }
  }
}

// 【二叉最小堆】A* 的开放集:并行数组存 id 与优先级,按"上浮/下沉"维护堆序。
// 手写而非用对象堆:避免每次 push/pop 产生包装对象,寻路热路径零 GC。
class Heap {
  constructor() { this.ids = []; this.pr = []; }
  get size() { return this.ids.length; }
  push(id, p) {
    const ids = this.ids, pr = this.pr;
    let i = ids.length; ids.push(id); pr.push(p);
    while (i > 0) { const j = (i - 1) >> 1; if (pr[j] <= p) break; ids[i] = ids[j]; pr[i] = pr[j]; i = j; }
    ids[i] = id; pr[i] = p;
  }
  pop() {
    const ids = this.ids, pr = this.pr;
    const top = ids[0];
    const lid = ids.pop(), lp = pr.pop();
    if (ids.length) {
      let i = 0; const n = ids.length;
      while (true) {
        let l = i * 2 + 1, r = l + 1, m = i;
        let mp = lp;
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
