// ============================================================================
// 【中文导读】physics.js —— 关卡碰撞查询库(纯查询,无状态模拟)
// ----------------------------------------------------------------------------
// 【模块定位】玩法层最低处的一层:对关卡"有向盒(oriented box)"集合做几何查询。
//   它不推进任何运动学——只回答"从 A 到 B 打到什么""这个胶囊体嵌进了哪些盒子并被推往哪"
//   "脚下这块地能不能站"。调用者:actor.js(角色控制器,每帧数次)、cameraRig.js(镜头探针)、
//   nav.js(导航图构建/遮挡测试)、weapons/projectiles/subs(弹道与装置落点)、player.js(准星射线)。
// 【核心机制】
//   · 世界由 level.blocks 的【有向盒】构成,每盒带 3 个单位轴 axes[0..2]、半长 half.{x,y,z}、
//     世界中心 center、实体标记 solid、以及可选的 grate(格栅)/roof/rail/perch 语义位。
//     raycast 用 slab(AABB)法在盒的局部坐标里求交,只对 queryBlocks 空间查询命中的盒子测试。
//   · 胶囊体求解(collideCapsule/collideBody)是【迭代推离】:每次取盒与线段最近点,按穿透量把
//     pos 推出;点在盒内时沿"最小穿透轴"推出。迭代数默认 3(角落多次穿插的情况)。
//   · 角色控制器拆成两半:【脚】= groundProbe 平面足迹接地探测(中心射线 + 8 点环),
//     【身体】= collideBody 抬高胶囊体(低于 stepUp 的部分交给脚,避免台阶/路缘互相打架)。
//   · cameraProbe 是"软圆柱"探针:中心射线 = 硬视线,外圈射线按权重软限制,让障碍物在
//     逼近视线前几帧就开始把镜头拉近。
// 【关键约定】单位米,dir 必须预先归一化;命中忽略"包含射线原点"的盒子(避免从盒内自交)。
//   热路径零分配:所有临时向量是模块级共享量(_o/_d/_p/...);out 参数(Hit/GroundHit)由调用者复用。
//   格栅 grate:墨水/子弹/液滴/相机通过,角色(kid)不通过;鱿鱼形态可通过(skipGrates=true 时)。
// 【配套阅读】actor.js(角色控制器如何消费这些结果)、nav.js(_clear/_blocked 复用 raycast)、
//   cameraRig.js(cameraProbe)、docs/ARCHITECTURE.zh-CN.md §2.3。
// ============================================================================
// Collision queries against the level's oriented boxes: raycasts, capsule resolution, point/segment helpers,
// plus the character-controller queries (flat-footprint ground probe, lifted body capsule, camera probe).
import * as THREE from 'three';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3(), _ab = new THREE.Vector3();
const _n = new THREE.Vector3(), _go = new THREE.Vector3();
const DOWNV = new THREE.Vector3(0, -1, 0);
// footprint ring (unit directions) for the ground probe: 8 samples so a ledge edge is caught at any heading
// 【足迹环】地面探测的 8 个采样方向(单位圆):不同朝向都能在边缘处抓到地面,决定"整只脚是否离地"。
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)]);
// 【可行走阈值】地面法线 y ≥ 0.68(约 47°)才算能站;再陡就是滑面/墙。
export const WALKABLE = 0.68;   // min ground normal.y a character can stand on (≈47°)
// camera probe rays: [side, up, weight] in units of the probe radius (centre is the hard line of sight)
// 【相机探针射线组】[侧移, 上下, 权重](均以探针半径为单位的倍数):第 0 条是中心(权重 1 = 硬视线),
// 后 6 条内环(半径 0.5)权重 0.75,再 8 条外环(半径 1.0)权重 0.4;权重越低,越"软"(见 cameraProbe)。
const CAM_RAYS = [[0, 0, 1]];
for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; CAM_RAYS.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.75]); }
for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.39; CAM_RAYS.push([Math.cos(a), Math.sin(a), 0.4]); }

// 【命中结果】一次 raycast 的输出:是否命中、距离、世界命中点、命中面法线,以及命中面所属
// block/face 与其在面参数空间(u,v)的坐标——(u,v) 供墨水采样(paint.sample)精确定位。
export class Hit {
  constructor() { this.hit = false; this.dist = 0; this.point = new THREE.Vector3(); this.normal = new THREE.Vector3(); this.block = -1; this.face = -1; this.u = 0; this.v = 0; }
}

// Result of Physics.groundProbe (feet support under a character).
// 【脚部接地结果】groundProbe 输出:命中点/法线/所属面 + center(是否中心射线命中)与 grate(格栅)。
export class GroundHit {
  constructor() { this.hit = false; this.y = 0; this.normal = new THREE.Vector3(0, 1, 0); this.block = -1; this.face = -1; this.u = 0; this.v = 0; this.center = false; this.grate = false; }
}

// 【碰撞查询器】持有 level 引用,自身无状态(除复用的 _ids 查询缓冲);一个关卡建一个,长期存活。
export class Physics {
  constructor(level) {
    this.level = level;
    this._ids = [];   // queryBlocks 的结果缓冲(复用,避免每帧分配)
  }

  // 【射线求交】对射线途经的所有实体盒做 slab 求交,返回最近命中。dir 必须归一化;
  // 忽略包含原点的盒(从盒内射出时不自交)。skipGrates=true 时跳过格栅(墨水/子弹/液滴/相机穿透)。
  // 先用 level.queryBlocks(射线的 XZ 包围盒)做空间裁剪,再逐盒在局部坐标解 tmin/tmax。
  // Ray vs all blocks. dir must be normalized. Ignores blocks containing the origin.
  // opts.skipGrates: ink, shots, droplets and the camera pass straight through grates
  raycast(origin, dir, maxDist, out = new Hit(), skipGrates = false) {
    out.hit = false; out.dist = maxDist; out.block = -1; out.face = -1;
    const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
    const ids = this.level.queryBlocks(Math.min(origin.x, ex), Math.min(origin.z, ez), Math.max(origin.x, ex), Math.max(origin.z, ez), this._ids);
    const blocks = this.level.blocks;
    let best = maxDist, bestK = -1, bestSign = 0, bestB = -1;
    for (let i = 0; i < ids.length; i++) {
      const b = blocks[ids[i]];
      if (!b.solid || (skipGrates && b.grate)) continue;
      // AABB precheck along the segment (cheap)
      // 【slab 法】把射线转进盒的局部系:每根轴求进出 t1/t2,tmin 取最大入点、tmax 取最小出点;
      // tmin>tmax 即不相交。记录 tmin 对应的轴 kmin 与进入方向符号 smin,用于回填法线与面。
      _o.copy(origin).sub(b.center);
      let tmin = -Infinity, tmax = Infinity, kmin = -1, smin = 0, miss = false;
      for (let k = 0; k < 3; k++) {
        const ax = b.axes[k];
        const o = _o.dot(ax), d = dir.dot(ax), h = k === 0 ? b.half.x : k === 1 ? b.half.y : b.half.z;
        if (Math.abs(d) < 1e-9) { if (o < -h || o > h) { miss = true; break; } continue; }
        let t1 = (-h - o) / d, t2 = (h - o) / d, s1 = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s1 = 1; }
        if (t1 > tmin) { tmin = t1; kmin = k; smin = s1; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { miss = true; break; }
      }
      if (miss || tmax < 0 || tmin < 0 || tmin > best) continue;
      best = tmin; bestK = kmin; bestSign = smin; bestB = b.id;
    }
    if (bestB < 0) return out;
    const b = blocks[bestB];
    out.hit = true; out.dist = best; out.block = bestB;
    out.point.copy(origin).addScaledVector(dir, best);
    out.normal.copy(b.axes[bestK]).multiplyScalar(bestSign);
    out.face = b.faces[bestK * 2 + (bestSign > 0 ? 0 : 1)];
    if (out.face >= 0) {
      const f = this.level.faces[out.face];
      _p.copy(out.point).sub(f.origin);
      out.u = _p.dot(f.u); out.v = _p.dot(f.v);
    }
    return out;
  }

  // 【线段求交】把 a→b 变成"从 a 出发、方向归一、长度 = |b-a|"的射线,复用 raycast。
  // 复用的 _segDir 惰性创建(与模块级临时量分开,因为 raycast 内部也用到它们)。
  segment(a, b, out = new Hit(), skipGrates = false) {
    _d.copy(b).sub(a);
    const len = _d.length();
    if (len < 1e-6) { out.hit = false; return out; }
    const dir = (this._segDir || (this._segDir = new THREE.Vector3())).copy(_d).multiplyScalar(1 / len);
    return this.raycast(a, dir, len, out, skipGrates);
  }

  // 【视线判定】a、b 之间是否无遮挡(返回 true = 通畅)。终点前留 0.05m 余量避免打到自己;
  // skipGrates=true 让格栅不挡视线(格栅是透视的)。复用 _losHit。
  // Line of sight between two points (true = clear).
  los(a, b) {
    _ab.copy(b).sub(a);
    const len = _ab.length();
    if (len < 1e-4) return true;
    const dir = _n.copy(_ab).multiplyScalar(1 / len);
    return !this.raycast(a, dir, len - 0.05, this._losHit || (this._losHit = new Hit()), true).hit;
  }

  // 【盒上最近点】把点 p 夹到有向盒的表面/内部(沿每根轴把局部坐标钳到 ±half),写入 out。
  // 胶囊体求解反复调用它做"线段最近点"迭代。
  closestOnBlock(b, p, out) {
    _o.copy(p).sub(b.center);
    out.copy(b.center);
    for (let k = 0; k < 3; k++) {
      const ax = b.axes[k], h = k === 0 ? b.half.x : k === 1 ? b.half.y : b.half.z;
      let d = _o.dot(ax);
      if (d > h) d = h; else if (d < -h) d = -h;
      out.addScaledVector(ax, d);
    }
    return out;
  }

  // 【整段胶囊体求解】把"脚在 pos、竖直的胶囊体"推出所有穿插的实体盒(会原地修改 pos),
  // 并把接触信息填进 c。squid=true 时格栅不算碰撞(鱿鱼从格栅缝里穿过)。
  // 算法:每轮 queryBlocks 取邻近盒,对盒求线段(a=底部球心, b=顶部球心)最近点;有穿透则按法线推出,
  // 直到某一轮无移动或到达 iterations。主要用于超跳/滑行等"整段身体"的场合。
  // Resolve a vertical capsule (feet at pos) against the level. Mutates pos. Fills contact info in `c`.
  // squid = true: grates don't collide (squids slip through the mesh)
  collideCapsule(pos, radius, height, c, iterations = 3, squid = false) {
    c.ground = false; c.wall = false; c.ceiling = false;
    c.groundNormal.set(0, 1, 0); c.wallNormal.set(0, 0, 0); c.groundBlock = -1; c.wallBlock = -1;
    const blocks = this.level.blocks;
    const top = Math.max(radius, height - radius);
    for (let it = 0; it < iterations; it++) {
      const ids = this.level.queryBlocks(pos.x - radius - 0.2, pos.z - radius - 0.2, pos.x + radius + 0.2, pos.z + radius + 0.2, this._ids);
      let moved = false;
      for (let i = 0; i < ids.length; i++) {
        const b = blocks[ids[i]];
        if (!b.solid || (squid && b.grate)) continue;
        if (pos.y + height < b.aabbMin.y - 0.05 || pos.y > b.aabbMax.y + 0.05) continue;
        _a.set(pos.x, pos.y + radius, pos.z);
        _b.set(pos.x, pos.y + top, pos.z);
        _ab.copy(_b).sub(_a);
        const abLen2 = Math.max(1e-6, _ab.lengthSq());
        let t = 0.5;
        for (let k = 0; k < 3; k++) {
          _s.copy(_a).addScaledVector(_ab, t);
          this.closestOnBlock(b, _s, _q);
          t = Math.min(1, Math.max(0, ((_q.x - _a.x) * _ab.x + (_q.y - _a.y) * _ab.y + (_q.z - _a.z) * _ab.z) / abLen2));
        }
        _s.copy(_a).addScaledVector(_ab, t);
        this.closestOnBlock(b, _s, _q);
        _n.copy(_s).sub(_q);
        let dist = _n.length();
        let pen;
        if (dist > 1e-5) {
          if (dist >= radius) continue;
          _n.multiplyScalar(1 / dist);
          pen = radius - dist;
        } else {
          // segment point inside the box: push out along the axis of least penetration
          // 【点在盒内】无最近法线可用:沿 3 根轴中"穿透最浅"的那根推出(改动最小),再补上半径。
          _o.copy(_s).sub(b.center);
          let bestPen = Infinity;
          for (let k = 0; k < 3; k++) {
            const ax = b.axes[k], h = k === 0 ? b.half.x : k === 1 ? b.half.y : b.half.z;
            const d = _o.dot(ax);
            const pk = h - Math.abs(d);
            if (pk < bestPen) { bestPen = pk; _n.copy(ax).multiplyScalar(d >= 0 ? 1 : -1); }
          }
          pen = bestPen + radius;
        }
        // prefer resolving as ground when standing on top edges (avoid being shoved sideways off ledges)
        // 【接触分类】按推出法线 n.y 归类:>0.6 记为地面(顶面),<-0.6 记天花板,|n.y|<0.55 记侧墙。
        // 站在顶边时优先按"地面"解算,避免被横向推下悬崖。
        pos.addScaledVector(_n, pen + 1e-4);
        moved = true;
        if (_n.y > 0.6) { c.ground = true; c.groundNormal.copy(_n); c.groundBlock = b.id; }
        else if (_n.y < -0.6) c.ceiling = true;
        else if (Math.abs(_n.y) < 0.55) { c.wall = true; c.wallNormal.copy(_n); c.wallBlock = b.id; }
      }
      if (!moved) break;
    }
    return c;
  }

  // 【脚部接地探测】角色的脚。在中心 + 半径 foot 的环上向下打竖直射线,从脚上方 up 到脚下方 down。
  // 中心面只要可行走且在范围内就胜出 → 斜坡精确贴合(不悬浮、不弹跳);中心悬空时改由环上样本
  // 接管(整只脚离边才掉),或某环样本踩到明显台阶(高于中心 stepMin 以上)时接管(路缘一碰到就迈上)。
  // Flat-footprint ground probe — the character's feet. Vertical rays at the centre and on a ring of radius `foot`
  // cast from `up` above the feet (y) to `down` below them. The centre surface wins when it is walkable and in range,
  // so slopes are exact (no hovering, no sphere-on-plane bounce); ring samples take over when the centre is over a
  // gap (feet stay planted on a ledge until the whole footprint is off) or when one of them sits on a clear step
  // (> stepMin above the centre: curbs/lips are stepped onto as soon as the foot reaches them).
  groundProbe(x, y, z, up, down, foot, out, skipGrates = false, stepMin = 0.12) {
    out.hit = false; out.center = false;
    const h = this._gh || (this._gh = new Hit());
    const len = up + down;
    let cy = -Infinity, have = false;
    // centre
    _go.set(x, y + up, z);
    this.raycast(_go, DOWNV, len, h, skipGrates);
    if (h.hit && h.normal.y >= WALKABLE) {
      have = true; cy = h.point.y;
      this._fillGround(out, h, true);
    }
    // ring: best clear step above the centre, or (centre missing) the highest walkable sample
    let by = have ? cy + stepMin : -Infinity, bi = -1;
    const hr = this._gh2 || (this._gh2 = new Hit());
    for (let i = 0; i < RING.length; i++) {
      _go.set(x + RING[i][0] * foot, y + up, z + RING[i][1] * foot);
      this.raycast(_go, DOWNV, len, hr, skipGrates);
      if (!hr.hit || hr.normal.y < WALKABLE) continue;
      if (hr.point.y > by) { by = hr.point.y; bi = i; this._fillGround(out, hr, false); }
    }
    out.hit = have || bi >= 0;
    return out;
  }

  // 【回填接地结果】把一次射线命中拷贝进 GroundHit,并标记它是否来自中心射线、是否踩在格栅上。
  _fillGround(out, h, center) {
    out.y = h.point.y; out.normal.copy(h.normal); out.block = h.block; out.face = h.face; out.u = h.u; out.v = h.v;
    out.center = center; out.grate = h.block >= 0 && !!this.level.blocks[h.block].grate;
  }

  // 【身体胶囊体求解】角色控制器的主体:一个底部抬高 lift(约等于 stepUp)的竖直胶囊体——
  // 抬升以下的部分交给脚处理(迈台阶、路缘)。horizontal=true(着地时)把推出改成水平推,使墙
  // 永远不会把着地的角色上下顶(不与地面吸附互相打架)。修改 pos,填充接触 c。
  // Resolve the character BODY: a vertical capsule whose bottom is lifted `lift` above the feet (everything below the
  // lift is the feet's job — step-ups, curbs). `horizontal` (grounded) turns push-outs into horizontal pushes so walls
  // never shove a grounded character up or down (no fighting with the ground snap). Mutates pos, fills contacts `c`.
  collideBody(pos, radius, lift, height, c, horizontal = false, skipGrates = false, iterations = 3) {
    c.ground = false; c.wall = false; c.ceiling = false;
    c.groundNormal.set(0, 1, 0); c.wallNormal.set(0, 0, 0); c.groundBlock = -1; c.wallBlock = -1;
    const blocks = this.level.blocks;
    const bot = lift + radius, top = Math.max(bot, height - radius);
    for (let it = 0; it < iterations; it++) {
      const ids = this.level.queryBlocks(pos.x - radius - 0.2, pos.z - radius - 0.2, pos.x + radius + 0.2, pos.z + radius + 0.2, this._ids);
      let moved = false;
      for (let i = 0; i < ids.length; i++) {
        const b = blocks[ids[i]];
        if (!b.solid || (skipGrates && b.grate)) continue;
        if (pos.y + height < b.aabbMin.y - 0.05 || pos.y + lift > b.aabbMax.y + 0.05) continue;
        _a.set(pos.x, pos.y + bot, pos.z);
        _b.set(pos.x, pos.y + top, pos.z);
        _ab.copy(_b).sub(_a);
        const abLen2 = Math.max(1e-6, _ab.lengthSq());
        let t = 0.5;
        for (let k = 0; k < 3; k++) {
          _s.copy(_a).addScaledVector(_ab, t);
          this.closestOnBlock(b, _s, _q);
          t = Math.min(1, Math.max(0, ((_q.x - _a.x) * _ab.x + (_q.y - _a.y) * _ab.y + (_q.z - _a.z) * _ab.z) / abLen2));
        }
        _s.copy(_a).addScaledVector(_ab, t);
        this.closestOnBlock(b, _s, _q);
        _n.copy(_s).sub(_q);
        let dist = _n.length(), pen;
        if (dist > 1e-5) {
          if (dist >= radius) continue;
          _n.multiplyScalar(1 / dist);
          pen = radius - dist;
        } else {
          _o.copy(_s).sub(b.center);
          let bestPen = Infinity;
          for (let k = 0; k < 3; k++) {
            const ax = b.axes[k], h = k === 0 ? b.half.x : k === 1 ? b.half.y : b.half.z;
            const d = _o.dot(ax), pk = h - Math.abs(d);
            if (pk < bestPen) { bestPen = pk; _n.copy(ax).multiplyScalar(d >= 0 ? 1 : -1); }
          }
          pen = bestPen + radius;
        }
        const hl = Math.hypot(_n.x, _n.z);
        if (horizontal && hl > 0.3 && _n.y > -0.6) {
          // grounded: push straight out sideways by the horizontal distance that clears the penetration
          // 【着地时纯水平推】只沿水平方向(hl)推出穿透所需距离,上限 0.45m;上下分量丢弃,
          // 保证墙面不会把贴地的角色抬起或压落。
          const push = Math.min(0.45, pen / hl) + 1e-4;
          pos.x += (_n.x / hl) * push; pos.z += (_n.z / hl) * push;
          c.wall = true; c.wallNormal.set(_n.x / hl, 0, _n.z / hl); c.wallBlock = b.id;
        } else {
          pos.addScaledVector(_n, pen + 1e-4);
          if (_n.y > 0.6) { c.ground = true; c.groundNormal.copy(_n); c.groundBlock = b.id; }
          else if (_n.y < -0.6) c.ceiling = true;
          else if (Math.abs(_n.y) < 0.6) { c.wall = true; c.wallNormal.copy(_n); c.wallBlock = b.id; }
        }
        moved = true;
      }
      if (!moved) break;
    }
    return c;
  }

  // 【能否容纳】与 collideBody 同形状的身体胶囊体放在 pos 会不会撞实体?(迈台阶/上边沿的可行性判定,
  // 只读不修改 pos)。多留 margin 的余量,严格小于才判"塞得下"。
  // Would a body capsule (same shape as collideBody) at `pos` overlap solid geometry? (step-up / ledge checks)
  bodyFits(pos, radius, lift, height, skipGrates = false, margin = 0.01) {
    const blocks = this.level.blocks;
    const bot = lift + radius, top = Math.max(bot, height - radius);
    const ids = this.level.queryBlocks(pos.x - radius - 0.1, pos.z - radius - 0.1, pos.x + radius + 0.1, pos.z + radius + 0.1, this._ids);
    for (let i = 0; i < ids.length; i++) {
      const b = blocks[ids[i]];
      if (!b.solid || (skipGrates && b.grate)) continue;
      if (pos.y + height < b.aabbMin.y || pos.y + lift > b.aabbMax.y) continue;
      _a.set(pos.x, pos.y + bot, pos.z); _b.set(pos.x, pos.y + top, pos.z); _ab.copy(_b).sub(_a);
      const abLen2 = Math.max(1e-6, _ab.lengthSq());
      let t = 0.5;
      for (let k = 0; k < 3; k++) {
        _s.copy(_a).addScaledVector(_ab, t); this.closestOnBlock(b, _s, _q);
        t = Math.min(1, Math.max(0, ((_q.x - _a.x) * _ab.x + (_q.y - _a.y) * _ab.y + (_q.z - _a.z) * _ab.z) / abLen2));
      }
      _s.copy(_a).addScaledVector(_ab, t); this.closestOnBlock(b, _s, _q);
      if (_s.distanceToSquared(_q) < (radius - margin) * (radius - margin)) return false;
    }
    return true;
  }

  // 【相机软探针】"软圆柱投射"手感:一束平行于吊臂的射线——中心 + 两圈(半径 0.5R 与 R)。
  // 每条射线的命中会限制吊臂长度;偏轴射线只按权重 w 部分限制,于是障碍物在逼近视线之前好几帧
  // 就开始把镜头往里拉,而不是等它真正挡住视线才"啪"地切入。
  // back = 单位吊臂方向(pivot → 镜头)。返回 out={hard,soft,floor}:hard=中心射线限制,
  // soft=混合限制(≤hard),floor=中心射线打在朝上的面(镜头永不穿到地面之下)。
  // 先按 back 构造正交的 side/up 基,_s 从 pivot 沿两基偏移采样点再射线。
  // Soft camera probe ("sphere-cast feel"): a cylinder of rays parallel to the boom — the centre plus two rings
  // (radius 0.5·R and R). Each ray's hit limits the boom length; off-axis rays only partially (weight w), so an
  // obstacle sweeping toward the line of sight starts pulling the camera in several frames before it crosses it.
  // `back` = unit boom direction (pivot → lens). Returns out = { hard, soft, floor }: hard = centre-ray limit,
  // soft = blended limit (≤ hard), floor = true when the centre ray hit an upward-facing surface (never go under).
  cameraProbe(pivot, back, want, radius, out, pad = 0.3) {
    const h = this._camHit || (this._camHit = new Hit());
    _a.set(0, 1, 0); if (Math.abs(back.y) > 0.95) _a.set(1, 0, 0);
    _p.crossVectors(back, _a).normalize();     // side
    _q.crossVectors(_p, back).normalize();     // up-ish
    let hard = want, soft = want;
    out.floor = false;
    for (let i = 0; i < CAM_RAYS.length; i++) {
      const ox = CAM_RAYS[i][0], oy = CAM_RAYS[i][1], w = CAM_RAYS[i][2];
      _s.copy(pivot).addScaledVector(_p, ox * radius).addScaledVector(_q, oy * radius);
      this.raycast(_s, back, want + pad, h, true);
      if (!h.hit) continue;
      const lim = Math.max(0, h.dist - pad);
      if (w >= 1) { if (lim < hard) { hard = lim; out.floor = h.normal.y > 0.6; } }
      const blended = lim + (want - lim) * (1 - w);
      if (blended < soft) soft = blended;
    }
    out.hard = hard; out.soft = Math.min(soft, hard);
    return out;
  }

  // 【点到胶囊距离】点 p 到"脚在 base 的竖直胶囊"的最短距离。先把 p.y 夹到胶囊轴段(两端各留半径),
  // 再算欧氏距离——命中判定(子弹/爆炸)的基础原语。
  // Distance from point p to the vertical capsule (feet at base).
  static pointCapsuleDist(p, base, radius, height) {
    const y = Math.min(Math.max(p.y, base.y + radius), base.y + Math.max(radius, height - radius));
    const dx = p.x - base.x, dy = p.y - y, dz = p.z - base.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // 【线段到胶囊最近距离】线段 a→b 与竖直胶囊的最接近点,返回距离并置 res.t(线段参数 0..1)。
  // 弹道命中判定用:先 6 段粗采样定位最近区间,再在区间内做 8 次三分搜索精修(t 收敛到最优)。
  // Closest approach of segment a→b to the vertical capsule; returns distance and sets outT (0..1 along segment).
  static segmentCapsuleDist(a, b, base, radius, height, res) {
    // sample-based closest point (short segments; robust enough for projectiles)
    let best = Infinity, bt = 0;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      _p.copy(a).lerp(b, t);
      const d = Physics.pointCapsuleDist(_p, base, radius, height);
      if (d < best) { best = d; bt = t; }
    }
    // refine
    let lo = Math.max(0, bt - 1 / steps), hi = Math.min(1, bt + 1 / steps);
    for (let k = 0; k < 8; k++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      _p.copy(a).lerp(b, m1); const d1 = Physics.pointCapsuleDist(_p, base, radius, height);
      _p.copy(a).lerp(b, m2); const d2 = Physics.pointCapsuleDist(_p, base, radius, height);
      if (d1 < d2) hi = m2; else lo = m1;
    }
    res.t = (lo + hi) / 2;
    _p.copy(a).lerp(b, res.t);
    res.dist = Physics.pointCapsuleDist(_p, base, radius, height);
    return res;
  }
}

// 【接触缓冲工厂】建一个可复用的接触结构(供 collideCapsule/collideBody 就地填充)。
export function makeContacts() {
  return { ground: false, wall: false, ceiling: false, groundNormal: new THREE.Vector3(0, 1, 0), wallNormal: new THREE.Vector3(), groundBlock: -1, wallBlock: -1 };
}
