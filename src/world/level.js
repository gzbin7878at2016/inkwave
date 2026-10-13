// ============================================================================
// 【中文导读】关卡几何核心——把"布局数据"烘焙成碰撞块、可涂墨面与渲染网格
// ----------------------------------------------------------------------------
// 【模块定位】世界层(src/world/)的几何枢纽,整条"换图装配线"的第二站。src/main.js 的 _buildWorldNow 里:
//     const level = new Level(layoutFor(MAP_LAYOUTS[layoutId], mode), colliders);
//   随后被这些系统共用同一个 Level 实例(level 是"碰撞 + 面的真值"):
//     · Physics(level)            体素/射线加速结构
//     · PaintSystem(renderer, level) 按 level.faces 里 paintable 的面摆进墨图集
//     · Decor(scene, level)        读 spawnPads/spawnBarrier/decor 摆装饰
//     · NavGraph(level, physics)   用 groundHeight/pointInside 建导航
//     · Minimap(level, paint)
//     · level.buildGeometry(size)  被调用两次:普通网格 + 仅格栅的镂空网格
//   level.js 不持有 GPU 资源,只产出数据结构与一份 BufferGeometry;纹理/材质在 levelMaterial.js。
// 【核心机制】生命周期:constructor → _build()(一次性烘焙) → 运行期只读查询。
//   ① 方块(block):每个布局 def(B/R/O 产出,见 maps.js / mapkit.js)在 _addBlock 里变成带
//      {center, half, axes} 的 OBB,并预算出 AABB;轴对齐盒 axes 为标准正交轴,旋转盒/坡道 axes 为任意正交基。
//   ② XZ 空间哈希:_buildHash 用固定 4 m 网格做宽相,queryBlocks 靠"盖章"时间戳去重,避免同一块被多次返回。
//   ③ 面(face):_buildFaces 为每个可见方块每个朝向生成一张 face(位置/切向 u,v/法向 n/尺寸 su,sv),
//      并标好 wall/turf/ceiling/paintable;背靠实心块的面被 _faceHidden 采样剔除。
//   ④ 渲染网格:buildGeometry 把方块画成"圆角盒"——暴露的棱做真实倒角(四分之一圆条 + 八分之一球角),紧贴其它
//      几何的棱保持锐利,免得地板上出现沟缝;倒角顶点映射进所属面的涂墨图集,墨能平滑绕过圆角。
// 【关键约定】
//   · 坐标系:右手系,Y 向上,米。UP = (0,1,0)。
//   · paintable = b.paint && n.y > -0.5(除竖直向下的底面外均可涂);roof/perch 的顶面强制不可涂。
//   · grate(含 rail)= 子供走的格栅:小孩能站,鱿鱼/墨/子弹穿过,永不涂墨(见 actor.js 的落地判定)。
//   · groundHeight 用 skipGrates 区分"谁在落地"(鱿鱼会穿过格栅)。
//   · 面的 u/v/n 约定:u × v = n;墙面的 v 取最接近世界竖直的在面内轴。
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md、docs/INK.zh-CN.md(面的涂墨)、docs/RENDERING-UE4.zh-CN.md、
//   src/world/maps.js(布局来源)、src/world/mapkit.js(原语)、src/world/paint.js(消费 faces)、
//   src/world/levelMaterial.js(消费面属性渲染)、src/world/variants.js(模式变体)。
// 【建议阅读顺序】constructor → _build → _addBlock → _buildFaces → buildGeometry → groundHeight;
//   只想理解"面怎么来的"直接看 _buildFaces。
// ============================================================================
// Level: turns a map layout (oriented boxes) into collision blocks, paintable faces and render geometry.
import * as THREE from 'three';
import { PATTERN } from './maps.js';

// 【临时向量复用】模块级 scratch 向量,避免每次查询都 new(热路径上由 Physics/Nav/Paint 高频调用)。
//   注意它们是"单帧内即刻用完"的暂存,不可跨调用持有引用。
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Level {
  // extra: collision-only boxes from set dressing ({min,max}, or {obox, center, size, rotY} for a turned prop; optional
  // roof / rail / perch flags) — solid, un-inkable, never rendered (the prop mesh is)
  // 【构造】layout = 布局对象(maps.js 的 HALYARD 或某 stage 的 LAYOUT);extra = 布景道具交还的"仅碰撞盒"。
  //   extra 的两种形态:{min,max} 轴对齐,或 {obox,center,size,rotY} 旋转的;可带 roof/rail/perch 标志。
  //   extra 一律 solid、不可涂墨、永不渲染(可见网格是道具自己的 mesh,这里只为物理/导航补碰撞)。
  constructor(layout, extra = []) {
    this.extra = extra;
    this.layout = layout;
    this.bounds = layout.bounds;
    this.spawnPads = layout.spawnPads.map((p) => new THREE.Vector3(...p));
    this.spawnBarrier = layout.spawnBarrier;
    this.blocks = [];
    this.faces = [];
    this._stamp = 1;
    this._build();
  }

  // ---------------------------------------------------------------- blocks
  // 【烘焙总入口】把布局拼成完整 def 列表并逐块落地。列表顺序即块 id 顺序(id = 追加时的下标),务必稳定。
  //   defs = single + half + half 的镜像 + extra 转成的隐藏碰撞盒。
  //   随后算 hasRails(actor 只在场内有栏杆处跑"栏杆足部检查"),建哈希,最后对每块生成面。
  _build() {
    const L = this.layout;
    // 【镜像 + extra 展开】half 里每个 def 各出一份镜像(180° 旋转);extra 转成 hidden 的 box/obox,
    //   颜色固定灰、paint:false(不可涂),只有碰撞;roof/rail/perch 标志原样透传。
    const defs = [...L.single, ...L.half, ...L.half.map(mirrorDef),
      ...this.extra.map((c) => (c.obox
        ? { kind: 'obox', center: c.center, size: c.size, rotY: c.rotY, paint: false, hidden: true, color: '#888888', roof: !!c.roof, rail: !!c.rail, perch: !!c.perch }
        : { kind: 'box', min: c.min, max: c.max, paint: false, hidden: true, color: '#888888', roof: !!c.roof, rail: !!c.rail, perch: !!c.perch }))];
    for (const d of defs) this._addBlock(d);
    this.hasRails = this.blocks.some((b) => b.rail);   // (actors only run the railing foot check where there are rails)
    this._buildHash();
    for (const b of this.blocks) this._buildFaces(b);
  }

  // 【单个方块落地】把 def 解释成 {center, half, axes} 的 OBB 及各种标志位。三种 kind 分支:
  //   box(轴对齐)、obox(绕 Y 转 rotY 度)、ramp(斜板,默认延伸至地面)。
  //   建好后统一用 8 个角点算 AABB(供空间哈希),再 push 进 this.blocks。
  _addBlock(d) {
    // 【块字段速查】id=数组下标(全流程引用块都用它);center/half/axes 定义 OBB;faces 存六个面的 face id
    //   (顺序 [axis0+, axis0-, axis1+, axis1-, axis2+, axis2-])。标志位含义:
    //   paint 可涂 / solid 参与碰撞 / grate(含 rail)子供格栅(鱿鱼穿过、不可涂)/ roof 禁入顶(站上去会滑落)
    //   / perch 可站不可涂的顶 / noNav 顶上不做导航 / rail 栏杆(挡小孩不挡子弹墨鱿)/ hidden 仅碰撞不渲染。
    const b = {
      id: this.blocks.length,
      center: new THREE.Vector3(),
      half: new THREE.Vector3(),
      axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
      aabbMin: new THREE.Vector3(), aabbMax: new THREE.Vector3(),
      paint: d.paint !== false && !d.grate && !d.rail, solid: d.solid !== false,
      color: new THREE.Color(d.color || '#dddddd'),
      pattern: d.pattern ?? PATTERN.plain,
      tag: d.tag || null,
      mural: d.mural || null,
      noPaint: d.noPaint || null,
      grate: !!d.grate || !!d.rail, // walkable for kids, squids + ink + shots pass through, never inkable
      roof: !!d.roof,              // off-limits top (roofs, crane legs …): never inkable, anyone landing on it slides off
      perch: !!d.perch,            // a top you can stand on (overhead steel reached by a super jump) but never ink
      noNav: !!d.noNav,            // no route runs along its top (narrow walls a bot would only fall off)
      // rail: railings / fences — kids can't walk through (but can hop up and stand on top), shots + ink + squids pass.
      // Collision-only (the railing you see is a prop): a grate block that is never drawn or inked
      rail: !!d.rail,
      hidden: !!d.hidden || !!d.rail, // collision-only (prop colliders, rails)
      bevel: d.bevel,
      faces: [-1, -1, -1, -1, -1, -1],
      aligned: true,
    };
    if (d.kind === 'box') {
      b.center.set((d.min[0] + d.max[0]) / 2, (d.min[1] + d.max[1]) / 2, (d.min[2] + d.max[2]) / 2);
      b.half.set((d.max[0] - d.min[0]) / 2, (d.max[1] - d.min[1]) / 2, (d.max[2] - d.min[2]) / 2);
    } else if (d.kind === 'obox') {
      // box turned about the vertical axis by rotY degrees (a stage laid out at an angle, turned props)
      const a = (d.rotY * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      b.center.set(d.center[0], d.center[1], d.center[2]);
      b.half.set(d.size[0] / 2, d.size[1] / 2, d.size[2] / 2);
      b.axes = [new THREE.Vector3(c, 0, -s), new THREE.Vector3(0, 1, 0), new THREE.Vector3(s, 0, c)];
      b.aligned = false;
    } else {
      // Ramp: a thick tilted slab whose top surface runs from low → high and whose underside reaches the floor.
      // 【坡道数学】从顶面低端 L0 到高端 H0 构一组正交基:s = 上坡单位向量(局部 z),side = 水平侧向(局部 x),
      //   n = 顶面法线(局部 y)。n 用 s×side 求得;若 n.y<0 说明朝向反了,同时翻转 n 与 side 保证顶面朝上。
      //   随后把 slab 沿 n 向下加厚 thick,使其底面落到 (或近似到) 地面。
      const L0 = new THREE.Vector3(...d.low), H0 = new THREE.Vector3(...d.high);
      const s = H0.clone().sub(L0); const len = s.length(); s.normalize();
      const flat = new THREE.Vector3(s.x, 0, s.z).normalize();
      const side = new THREE.Vector3().crossVectors(UP, flat).normalize();
      const n = new THREE.Vector3().crossVectors(s, side).normalize();
      if (n.y < 0) { n.negate(); side.negate(); }
      const cosT = n.y;
      const rise = H0.y - L0.y;
      // thin: a free-spanning plank/gangway (keeps its own thickness instead of reaching down to the floor)
      // 【厚度规则】普通坡道要"从高端一路垫到地面":vertically 需覆盖 rise,沿法线方向即 rise·cosT,再留 0.35 余量,
      //   与显式 thickness 取大。d.thin(悬空跳板/跳板桥)则保留自身厚度、不接地——否则会把下面的水面/通道堵死。
      const thick = d.thin ? d.thickness : Math.max(d.thickness, rise * cosT + 0.35);
      const ext = 0.6; // extend under the floor at the low end
      // 【低端外延 0.6m】把低端再往下埋一段,防止斜面与地面之间露出缝;顶端不动。
      //   因此坡道实际比 low→high 略长,几何中心取"外延低端"与"高端"的中点,再沿 n 后退半个厚度。
      const a = L0.clone().addScaledVector(s, -ext);
      const topMid = a.clone().add(H0).multiplyScalar(0.5);
      b.center.copy(topMid).addScaledVector(n, -thick / 2);
      b.half.set(d.width / 2, thick / 2, (len + ext) / 2);
      b.axes = [side, n, s];
      b.aligned = false;
      // keep right-handed: side x n should equal s
      // 【右手系校正】Level 的面/法向推导假设 axes 右手正交;若 side×n 与 s 反向则翻转 side,保证 u×v=n 成立。
      const chk = new THREE.Vector3().crossVectors(side, n);
      if (chk.dot(s) < 0) b.axes[0].negate();
    }
    // AABB
    // 【包围盒】无论 OBB 怎么转,都用 8 个角点(±half 沿三轴各组合)的 min/max 求世界 AABB,
    //   供 _buildHash 做宽相。i 的位 0/1/2 分别决定三轴的 ± 号。
    b.aabbMin.set(Infinity, Infinity, Infinity); b.aabbMax.set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      _v.copy(b.center)
        .addScaledVector(b.axes[0], (i & 1 ? 1 : -1) * b.half.x)
        .addScaledVector(b.axes[1], (i & 2 ? 1 : -1) * b.half.y)
        .addScaledVector(b.axes[2], (i & 4 ? 1 : -1) * b.half.z);
      b.aabbMin.min(_v); b.aabbMax.max(_v);
    }
    this.blocks.push(b);
  }

  // 2D spatial hash over XZ for broadphase
  // 【XZ 空间哈希】把场地按 4 m(hashCell)网格切分;每个块按自身 AABB 覆盖到的格子,把块 id 塞进去。
  //   边界向外留 8 m 并在每轴多算一行/列(+16),确保越界查询也能落到有效格子(查询时会 clamp)。
  //   blockStamp 是"查询去重"用的时间戳数组(见 queryBlocks),初始化为 0、与 _stamp 的递增值比较。
  _buildHash() {
    const cs = (this.hashCell = 4);
    const bx = this.bounds;
    this.hx0 = bx.minX - 8; this.hz0 = bx.minZ - 8;
    this.hw = Math.ceil((bx.maxX - bx.minX + 16) / cs);
    this.hd = Math.ceil((bx.maxZ - bx.minZ + 16) / cs);
    this.hash = Array.from({ length: this.hw * this.hd }, () => []);
    this.blockStamp = new Uint32Array(this.blocks.length);
    for (const b of this.blocks) {
      const x0 = this._hxi(b.aabbMin.x), x1 = this._hxi(b.aabbMax.x);
      const z0 = this._hzi(b.aabbMin.z), z1 = this._hzi(b.aabbMax.z);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.hash[z * this.hw + x].push(b.id);
    }
  }
  // 【世界 x/z → 哈希格下标】夹到 [0, hw/hd-1],所以越界坐标也安全。
  _hxi(x) { return Math.max(0, Math.min(this.hw - 1, Math.floor((x - this.hx0) / this.hashCell))); }
  _hzi(z) { return Math.max(0, Math.min(this.hd - 1, Math.floor((z - this.hz0) / this.hashCell))); }

  // Unique block ids whose hash cells overlap the XZ rectangle.
  // 【宽相查询】遍历矩形覆盖的格子,把其中的块 id 追加进调用方传入的 out 数组(就地复用,不 new)。
  //   一个块可能跨多格而被重复遇到——用"盖章去重":本帧 _stamp 自增一次,某块的 blockStamp 若已是本帧值就跳过。
  //   返回 out(即返回值),调用方无需再拷。
  queryBlocks(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const st = ++this._stamp;
    const x0 = this._hxi(minX), x1 = this._hxi(maxX), z0 = this._hzi(minZ), z1 = this._hzi(maxZ);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const cell = this.hash[z * this.hw + x];
      for (let i = 0; i < cell.length; i++) {
        const id = cell[i];
        if (this.blockStamp[id] !== st) { this.blockStamp[id] = st; out.push(id); }
      }
    }
    return out;
  }

  // 【点是否在块内】(可含 pad 容差)把点相对块心的向量投影到三条 axes 上,三轴都落在半长+pad 内即命中。
  //   OBB 判定天然支持旋转盒,无需分 kind。
  pointInBlock(b, p, pad = 0) {
    _v2.copy(p).sub(b.center);
    return Math.abs(_v2.dot(b.axes[0])) < b.half.x + pad &&
      Math.abs(_v2.dot(b.axes[1])) < b.half.y + pad &&
      Math.abs(_v2.dot(b.axes[2])) < b.half.z + pad;
  }

  // 【点是否落在任何实心块内】用 0.01m 的极窄矩形做一次 XZ 查询,再逐个点测;exclude 用于排除"自己"
  //   (面 visibility / 涂墨格归零等场景会把自身块排掉)。只对 solid 块判定。
  pointInside(p, pad = 0, exclude = -1) {
    const ids = this.queryBlocks(p.x - 0.01, p.z - 0.01, p.x + 0.01, p.z + 0.01, this._qtmp || (this._qtmp = []));
    for (const id of ids) {
      if (id === exclude) continue;
      const b = this.blocks[id];
      if (!b.solid) continue;
      if (this.pointInBlock(b, p, pad)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- faces
  // 【生成面】对每个(非 hidden)方块的 3 轴 × ±方向共 6 张候选面逐一处理。每张面记录 origin(u,v 方向的
  //   左下角)、正交切向 u/v、法向 n、尺寸 su/sv;分类 wall/turf/ceiling 决定涂墨与渲染细节。
  //   被别的实心块完全挡住的候选面由 _faceHidden 剔除(exposed 面才留);下探的底面若离地太近也直接丢。
  _buildFaces(b) {
    if (b.hidden) return;
    const ax = b.axes, h = [b.half.x, b.half.y, b.half.z];
    for (let k = 0; k < 3; k++) {
      for (const sign of [1, -1]) {
        const n = ax[k].clone().multiplyScalar(sign);
        // 【丢弃"贴地底面"】竖直向下的面(n.y<-0.5):若其最低点离地不足 0.5m,说明是压在地板上的底面,
        //   画它只会浪费并可能穿模,直接跳过;只有明显悬空的下表面(overhang)才保留。
        if (n.y < -0.5) {
          // underside: only keep if it floats well above the floor (overhangs)
          const lowest = b.center.y - h[1];
          if (lowest < 0.5) continue;
        }
        const others = [0, 1, 2].filter((i) => i !== k);
        // 【选切向 u/v】面法线已定为 n,还需在面内挑两条正交轴。约定 u×v=n(见下),所以先定 v 再叉出 u。
        //   墙面(|n.y|<0.5):v 取两候选轴里更贴近世界竖直的那个(于是墙上 v 朝上、纹理不歪);u 取另一条。
        //   顶/底面:v 取更贴近世界 x 的轴(保证俯视时朝向稳定),u 取另一条。
        let ui, vi;
        if (Math.abs(n.y) < 0.5) {
          // wall: v = the in-plane axis most aligned with world up
          vi = Math.abs(ax[others[0]].y) > Math.abs(ax[others[1]].y) ? others[0] : others[1];
          ui = others[0] === vi ? others[1] : others[0];
        } else {
          ui = Math.abs(ax[others[0]].x) >= Math.abs(ax[others[1]].x) ? others[0] : others[1];
          vi = others[0] === ui ? others[1] : others[0];
        }
        const v = ax[vi].clone();
        // 【切向定向】把 v 统一朝"正"方向:墙面要求 v 朝上(v.y≥0);顶/底面在 v 明显偏向 -z 时翻转。
        //   目的:让所有同类面的 2D 纹理坐标方向一致,拼在一起的墙纹理才不出现镜像接缝。
        if (Math.abs(n.y) < 0.5) { if (v.y < 0) v.negate(); } else if (v.z < 0 && Math.abs(v.z) > 0.3) v.negate();
        const u = new THREE.Vector3().crossVectors(v, n); // u x v = n
        const su = 2 * h[ui], sv = 2 * h[vi];
        // origin = 面心沿 n 外移半厚(到面平面),再沿 -u/-v 各退半尺寸 → 面内左下角(u,v 的原点)。
        const origin = b.center.clone().addScaledVector(n, h[k]).addScaledVector(u, -su / 2).addScaledVector(v, -sv / 2);
        // 【面对象】id/block 反向引用;n/u/v/origin/su/sv 是几何本体。分类:wall(|n.y|<0.3)、turf(n.y>0.7 可计分地面)、
        //   ceiling(n.y<-0.5);paintable=块可涂且非竖直朝下的面。atlas/grid 等字段先占位,运行期由 PaintSystem 填。
        const face = {
          id: this.faces.length, block: b.id, n, u, v, origin, su, sv,
          wall: Math.abs(n.y) < 0.3, turf: n.y > 0.7, ceiling: n.y < -0.5,
          paintable: b.paint && n.y > -0.5,
          pattern: b.pattern, color: b.color,
          groundedBottom: false,
          atlas: null, grid: -1, nu: 0, nv: 0,
        };
        // 【遮挡剔除】被其它实心块包住的面直接丢(连 push 都不做)。
        if (this._faceHidden(face)) continue;
        // 【贴花/禁涂按法向匹配】mural 与 noPaint 都用面法向点乘目标方向 >0.9(约 25°)来"认领"对应朝向的面。
        //   mural 命中则记下贴花 id 供 levelMaterial 采样;noPaint 命中则取消该面可涂性(如箱子被覆盖的侧面)。
        face.mural = -1;
        if (b.mural) for (const m of b.mural) if (n.x * m.n[0] + n.y * m.n[1] + n.z * m.n[2] > 0.9) face.mural = m.id;
        if (b.noPaint) for (const m of b.noPaint) if (n.x * m[0] + n.y * m[1] + n.z * m[2] > 0.9) face.paintable = false;
        // 【roof/perch 顶面禁涂】屋顶与"可站顶"都不可涂墨(防止高结构变成刷分点)。
        if ((b.roof || b.perch) && n.y > 0.5) face.paintable = false;
        if (face.wall) {
          // 【墙底接地判定】取墙底边中段、略向外(y 下移 0.06)的一点:若落在别的实心块内或低于 0.02,
          //   记为 groundedBottom —— 供 levelMaterial 决定墙脚是否要与地面墨"缝合",避免悬浮感。
          _v.copy(origin).addScaledVector(u, su / 2).addScaledVector(v, -0.06).addScaledVector(n, 0.06);
          face.groundedBottom = this.pointInside(_v, 0, b.id) || _v.y < 0.02;
        }
        // 【登记】把 face id 写回块的面槽位(k*2+0 为 +n、k*2+1 为 -n),再 push 进全局 faces。
        b.faces[k * 2 + (sign > 0 ? 0 : 1)] = face.id;
        this.faces.push(face);
      }
    }
  }

  // A face is hidden when every sample point just outside it lies inside another solid block.
  // 【面遮挡判定】在面外侧 0.03m 处按 ~1.25m 间隔(每维至少 2 段)取网格采样点;只要有一个点"露在空气中"
  //   (不在别的实心块内)就判定可见。采样点夹在距边 0.05m 内侧,避免贴边误判。exclude=f.block 排除自身。
  _faceHidden(f) {
    const nu = Math.max(2, Math.ceil(f.su / 1.25)), nv = Math.max(2, Math.ceil(f.sv / 1.25));
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const uu = Math.min(f.su - 0.05, Math.max(0.05, (i / nu) * f.su));
        const vv = Math.min(f.sv - 0.05, Math.max(0.05, (j / nv) * f.sv));
        _v.copy(f.origin).addScaledVector(f.u, uu).addScaledVector(f.v, vv).addScaledVector(f.n, 0.03);
        if (!this.pointInside(_v, 0, f.block)) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- baked-lighting atlas
  // Deterministic shelf layout of every rendered face at a fixed density, independent of the paint atlas/quality.
  // 【烘焙 AO 光照图的摆放】把每张非格栅面按固定 ppm(每米像素)换算成矩形,货架式排进 size×size 图集:
  //   按高降序排序,一行放不下换行。这一步必须"确定性"且与墨图集/画质无关——只有布局一模一样,预烘焙的
  //   光照图 assets/lightmaps/<id>.{png,json} 才能复用。返回是否放得下;放不下主程序会降级(不应用烘焙)。
  //   顺带算一个 FNV-1a checksum(layoutHash):任一面的原点/尺寸变化都会让 hash 变,旧烘焙随即作废。
  //   调用方:src/main.js 的 _loadLightmap。
  layoutLightmap(ppm = 5, size = 1024, pad = 2) {
    const faces = this.faces.filter((f) => !this.blocks[f.block].grate);
    const rects = faces.map((f) => ({ f, w: Math.ceil(f.su * ppm) + pad * 2, h: Math.ceil(f.sv * ppm) + pad * 2 }));
    rects.sort((a, b) => b.h - a.h || b.w - a.w || a.f.id - b.f.id);
    let x = 0, y = 0, rowH = 0;
    for (const r of rects) {
      if (x + r.w > size) { x = 0; y += rowH; rowH = 0; }
      r.f.light = { x, y, ppm, pad };
      x += r.w; rowH = Math.max(rowH, r.h);
    }
    this.lightSize = size;
    this.lightUsed = y + rowH;
    // checksum so a stale bake is never applied to a changed layout
    // 【布局指纹】FNV-1a:遍历所有面的 origin.x/y/z 与 su/sv,按 *100 取整(容忍浮点毛刺)参与混合。
    //   输出的 layoutHash 与烘焙产物里的 hash 比对,不一致就丢弃烘焙(见 main.js _loadLightmap)。
    let h = 2166136261;
    for (const f of this.faces) for (const v of [f.origin.x, f.origin.y, f.origin.z, f.su, f.sv]) { h ^= Math.round(v * 100); h = Math.imul(h, 16777619) >>> 0; }
    this.layoutHash = (h >>> 0).toString(16);
    return this.lightUsed <= size;
  }

  // ---------------------------------------------------------------- render geometry
  // Every block renders as a rounded box: exposed edges get a real bevel (quarter-round strips + octant corners),
  // edges flush against other geometry stay sharp so floors never show grooves. Bevel vertices map into their face's
  // paint atlas (the 8-texel padding holds extrapolated ink), so ink wraps smoothly over the rounded edges.
  // Requires faces to have been laid out in the paint atlas (face.atlas = {x, y, ppm, pad}) — non-paintable faces render too.
  // 【构建渲染网格】为所有(经 filter 选中的)方块生成一份 BufferGeometry。三趟几何:
  //   ① 面:按是否倒角把四角向内缩的矩形,两张三角形;
  //   ② 边条:暴露棱上每 45° 一段的四分之一圆条(SEG=2 → 每四分之一圆 4 段);
  //   ③ 角块:三条棱都倒角的角上,用八分之一球面补角(NC=3 的三角细分)。
  //   顶点带 9 组自定义属性:position/normal/color/paintUv/lightUv/faceUv/faceData(4)/faceFlags(3)/faceTan(3),
  //   全部由 levelMaterial.js 的着色器读取。filter 用于分离"普通网格"与"格栅网格"(第二次以 b=>b.grate 调用)。
  buildGeometry(atlasSize, filter = (b) => !b.grate) {
    // 【属性暂存桶】按属性分组成普通数组,末尾一次性转成 Float32BufferAttribute。idx 是索引。
    const B = { pos: [], nor: [], col: [], puv: [], luv: [], fuv: [], fdat: [], fflag: [], ftan: [], idx: [] };
    const LS = this.lightSize || 1;
    const lin = new THREE.Color();
    const P = new THREE.Vector3(), Nn = new THREE.Vector3(), E = new THREE.Vector3(), Q = new THREE.Vector3();
    // faceOf:块的面槽位 → 全局 face id(槽位序 [axis0+, axis0-, axis1+, axis1-, axis2+, axis2-])。
    const faceOf = (b, k, s) => b.faces[k * 2 + (s > 0 ? 0 : 1)];
    const self = this;
    // 【压入顶点】写一个顶点并返回其索引。它把世界坐标 p 投影到面的 u/v 得 (cu,cv),据此算:
    //   paintUv = 涂墨图集里的 UV(用面图集 x/y/ppm/pad;无图集则塞 0);lightUv = 光照图里同规则(无则 -1);
    //   faceUv = 面内米制 uv(供程序化纹理);faceData = [pattern, 是否有图集, su, sv];faceFlags = [wall, 接地底, mural];
    //   faceTan = 面的 u 切向(供各向异性法线/纹理方向)。颜色取面的 color。
    function vert(f, p, n) {
      const i = B.pos.length / 3;
      B.pos.push(p.x, p.y, p.z); B.nor.push(n.x, n.y, n.z);
      lin.copy(f.color); B.col.push(lin.r, lin.g, lin.b);
      Q.copy(p).sub(f.origin);
      const cu = Q.dot(f.u), cv = Q.dot(f.v);
      if (f.atlas) B.puv.push((f.atlas.x + f.atlas.pad + cu * f.atlas.ppm) / atlasSize, (f.atlas.y + f.atlas.pad + cv * f.atlas.ppm) / atlasSize);
      else B.puv.push(0, 0);
      if (f.light) B.luv.push((f.light.x + f.light.pad + cu * f.light.ppm) / LS, (f.light.y + f.light.pad + cv * f.light.ppm) / LS);
      else B.luv.push(-1, -1);
      B.fuv.push(cu, cv);
      B.fdat.push(f.pattern, f.atlas ? 1 : 0, f.su, f.sv);
      B.fflag.push(f.wall ? 1 : 0, f.groundedBottom ? 1 : 0, f.mural);
      B.ftan.push(f.u.x, f.u.y, f.u.z);
      return i;
    }
    // triangle with winding chosen so it faces along `n`
    // 【绕序自适应三角】算三角面法线,与期望法线 n 点乘;若反向就交换后两个索引。
    //   这样同一段代码既能给正面也能给倒角条/角块用,不必为每个朝向手动排索引。
    const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
    function tri(i0, i1, i2, n) {
      const pp = B.pos;
      _a.set(pp[i1 * 3] - pp[i0 * 3], pp[i1 * 3 + 1] - pp[i0 * 3 + 1], pp[i1 * 3 + 2] - pp[i0 * 3 + 2]);
      _b.set(pp[i2 * 3] - pp[i0 * 3], pp[i2 * 3 + 1] - pp[i0 * 3 + 1], pp[i2 * 3 + 2] - pp[i0 * 3 + 2]);
      _c.crossVectors(_a, _b);
      if (_c.dot(n) >= 0) B.idx.push(i0, i1, i2); else B.idx.push(i0, i2, i1);
    }
    for (const b of this.blocks) {
      if ((!b.solid && !b.render) || !filter(b)) continue;
      const ax = b.axes, h = [b.half.x, b.half.y, b.half.z];
      const minH = Math.min(h[0], h[1], h[2]);
      // bevel scales with the block: chunky rounded edges on big structures, finer on crates/ramps/rails
      // 【倒角半径】随块尺寸缩放:大结构给厚圆角,箱子/坡道/栏杆给细圆角。bevel 可被 def 显式指定,
      //   否则取 min(0.13, minH*0.14) 且不小于 0.04;再夹到 minH*0.45 以内,避免小方块被倒角吃掉。
      const bev = Math.min(b.bevel ?? Math.max(0.04, Math.min(0.13, minH * 0.14)), minH * 0.45);
      // exposed-edge test (both faces rendered and nothing solid hugging the edge)
      // 【暴露棱判定】两件事同时成立才算"该倒角":① 相邻两面都存在(槽位有 face);② 沿这条棱取样,
      //   附近没有别的实心块紧贴(否则说明有几何贴在这条棱上,倒角会穿模)。结果缓存进 edgeCache 复用。
      const edgeCache = new Map();
      const bevelled = (k1, s1, k2, s2) => {
        if (bev < 0.01) return false;
        const key = k1 < k2 ? `${k1}${s1}${k2}${s2}` : `${k2}${s2}${k1}${s1}`;
        if (edgeCache.has(key)) return edgeCache.get(key);
        let ok = faceOf(b, k1, s1) >= 0 && faceOf(b, k2, s2) >= 0;
        if (ok) {
          const k3 = 3 - k1 - k2;
          for (let t = -1; t <= 1; t += 0.25) {
            E.copy(b.center).addScaledVector(ax[k1], s1 * h[k1]).addScaledVector(ax[k2], s2 * h[k2]).addScaledVector(ax[k3], t * h[k3] * 0.98);
            Q.copy(E).addScaledVector(ax[k1], s1 * 0.04).addScaledVector(ax[k2], s2 * 0.04);
            if (self.pointInside(Q, 0, b.id)) { ok = false; break; }
          }
        }
        edgeCache.set(key, ok);
        return ok;
      };
      // --- faces (inset where the edge is bevelled)
      // 【面片】每张面画成一个矩形,四角各按"对应两条棱是否倒角"向内缩 ip/im/jp/jm,再压成两个三角。
      //   未倒角的棱不缩,于是面与面严丝合缝;倒角处留下的缺口由后面的边条/角块补上。
      for (let k = 0; k < 3; k++) for (const s of [1, -1]) {
        const fid = faceOf(b, k, s);
        if (fid < 0) continue;
        const f = this.faces[fid];
        const [i, j] = [0, 1, 2].filter((a) => a !== k);
        const ip = bevelled(k, s, i, 1) ? bev : 0, im = bevelled(k, s, i, -1) ? bev : 0;
        const jp = bevelled(k, s, j, 1) ? bev : 0, jm = bevelled(k, s, j, -1) ? bev : 0;
        const cf = E.copy(b.center).addScaledVector(ax[k], s * h[k]).clone();
        const corner = (si, sj) => {
          const di = si > 0 ? h[i] - ip : -(h[i] - im), dj = sj > 0 ? h[j] - jp : -(h[j] - jm);
          return vert(f, P.copy(cf).addScaledVector(ax[i], di).addScaledVector(ax[j], dj), f.n);
        };
        const v0 = corner(-1, -1), v1 = corner(1, -1), v2 = corner(1, 1), v3 = corner(-1, 1);
        tri(v0, v1, v2, f.n); tri(v0, v2, v3, f.n);
      }
      if (bev < 0.01) continue;
      // --- edge strips
      // 【边条】每条暴露棱沿它扫出四分之一圆弧带。SEG=2 表示每半个四分之一圆分 2 段(整圆角共 4 段),
      //   每段的法线 Nn = nA·cosθ + nB·sinθ(θ 从 0 到 π/4),于是圆滑过渡两面。两端 t0/t1 会按邻棱是否
      //   也倒角而收缩(端头封边),避免与相邻棱的倒角重叠。
      const SEG = 2; // per half (4 segments per quarter-round)
      for (let k1 = 0; k1 < 3; k1++) for (let k2 = k1 + 1; k2 < 3; k2++) for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
        if (!bevelled(k1, s1, k2, s2)) continue;
        const k3 = 3 - k1 - k2;
        const fa = this.faces[faceOf(b, k1, s1)], fb = this.faces[faceOf(b, k2, s2)];
        const nA = ax[k1].clone().multiplyScalar(s1), nB = ax[k2].clone().multiplyScalar(s2);
        const endCut = (s3) => faceOf(b, k3, s3) >= 0 && bevelled(k3, s3, k1, s1) && bevelled(k3, s3, k2, s2) ? bev : 0;
        const t0 = -h[k3] + endCut(-1), t1 = h[k3] - endCut(1);
        const base = E.copy(b.center).addScaledVector(nA, h[k1] - bev).addScaledVector(nB, h[k2] - bev).clone();
        for (const half of [0, 1]) {
          const f = half ? fb : fa;
          const rows = [];
          for (let q = 0; q <= SEG; q++) {
            const th = (Math.PI / 4) * (half + q / SEG);
            Nn.copy(nA).multiplyScalar(Math.cos(th)).addScaledVector(nB, Math.sin(th));
            const r0 = vert(f, P.copy(base).addScaledVector(ax[k3], t0).addScaledVector(Nn, bev), Nn);
            const r1 = vert(f, P.copy(base).addScaledVector(ax[k3], t1).addScaledVector(Nn, bev), Nn);
            rows.push([r0, r1, Nn.clone()]);
          }
          for (let q = 0; q < SEG; q++) {
            const [a0, a1, na] = rows[q], [b0, b1] = rows[q + 1];
            tri(a0, a1, b1, na); tri(a0, b1, b0, na);
          }
        }
      }
      // --- rounded corners (octant patches) where all three edges are bevelled
      // 【角块】当某个角的交汇三条棱都倒角时才补八分之一球面:NC=3 把球面三角细分成 (NC+1)(NC+2)/2 个顶点,
      //   法线 Nn = 归一化的 (n0·a + n1·b + n2·c)。整块角面统一映射到"最朝上的那张面"的图集,
      //   于是从上方看到的圆角墨色与顶面一致(见下方 best 的选取)。
      const NC = 3;
      for (const s0 of [1, -1]) for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
        const sg = [s0, s1, s2];
        if (!(bevelled(0, s0, 1, s1) && bevelled(0, s0, 2, s2) && bevelled(1, s1, 2, s2))) continue;
        const n0 = ax[0].clone().multiplyScalar(s0), n1 = ax[1].clone().multiplyScalar(s1), n2 = ax[2].clone().multiplyScalar(s2);
        const c = E.copy(b.center).addScaledVector(n0, h[0] - bev).addScaledVector(n1, h[1] - bev).addScaledVector(n2, h[2] - bev).clone();
        // map the whole patch to the most "up" face (usually the top) so its ink matches what you see from above
        let best = 0, bd = -2;
        [n0, n1, n2].forEach((nn, a) => { if (nn.y > bd) { bd = nn.y; best = a; } });
        const f = this.faces[faceOf(b, best, sg[best])];
        const ids = [];
        for (let a = 0; a <= NC; a++) { ids.push([]); for (let bb = 0; bb <= NC - a; bb++) {
          const cc = NC - a - bb;
          Nn.set(0, 0, 0).addScaledVector(n0, a).addScaledVector(n1, bb).addScaledVector(n2, cc).normalize();
          ids[a].push(vert(f, P.copy(c).addScaledVector(Nn, bev), Nn));
        } }
        const mid = n0.clone().add(n1).add(n2).normalize();
        for (let a = 0; a < NC; a++) for (let bb = 0; bb < NC - a; bb++) {
          tri(ids[a][bb], ids[a + 1][bb], ids[a][bb + 1], mid);
          if (bb < NC - a - 1) tri(ids[a + 1][bb], ids[a + 1][bb + 1], ids[a][bb + 1], mid);
        }
      }
    }
    // 【打包成 BufferGeometry】9 组属性一次性转成 Float32,索引用 setIndex;computeBoundingSphere 供视锥剔除。
    //   renderTris 记下三角数,主程序可读作构建统计。返回的几何交由 main.js 挂到 Mesh 上。
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
    g.setAttribute('paintUv', new THREE.Float32BufferAttribute(B.puv, 2));
    g.setAttribute('lightUv', new THREE.Float32BufferAttribute(B.luv, 2));
    g.setAttribute('faceUv', new THREE.Float32BufferAttribute(B.fuv, 2));
    g.setAttribute('faceData', new THREE.Float32BufferAttribute(B.fdat, 4));
    g.setAttribute('faceFlags', new THREE.Float32BufferAttribute(B.fflag, 3));
    g.setAttribute('faceTan', new THREE.Float32BufferAttribute(B.ftan, 3));
    g.setIndex(B.idx);
    g.computeBoundingSphere();
    this.renderTris = B.idx.length / 3;
    return g;
  }

  // Highest walkable surface under (x,z) below yMax (used by nav + spawns). Returns y or -Infinity.
  // skipGrates: what a squid would land on (squids drop straight through grates)
  // 【地面高度查询】问"站在 (x,z) 正下方,yMax 以下最高的可走面在哪"。nav 与出生点布置都用它。
  //   skipGrates=true 表示"这是鱿鱼在落地"——格栅(含栏杆)直接跳过(鱿鱼穿过)。返回高度或 -Infinity。
  groundHeight(x, z, yMax = 50, skipGrates = false) {
    let best = -Infinity;
    const ids = this.queryBlocks(x - 0.01, z - 0.01, x + 0.01, z + 0.01, this._qtmp2 || (this._qtmp2 = []));
    for (const id of ids) {
      const b = this.blocks[id];
      if (!b.solid || (skipGrates && b.grate)) continue;
      // intersect vertical line with the block's top face plane
      // 【只认"顶面接近水平"的块】局部 y 轴 n（=axes[1]）与世界竖直夹角需够小(n.y≥0.5);随后把
      //   "竖直线 n·(p-top)=0" 解出交点的 y(见下方公式),再验证该交点确实落在块内(含 0.001 容差)。
      const n = b.axes[1];
      if (n.y < 0.5) continue;
      const top = _v.copy(b.center).addScaledVector(n, b.half.y);
      // plane: n·(p - top) = 0 → y = top.y - (n.x (x-top.x) + n.z (z-top.z)) / n.y
      const y = top.y - (n.x * (x - top.x) + n.z * (z - top.z)) / n.y;
      _v2.set(x, y - 0.01, z);
      if (y <= yMax && y > best && this.pointInBlock(b, _v2, 0.001)) best = y;
    }
    return best;
  }
}

// 【half 的 180° 镜像】把布局 def 绕 Y 轴转 180°((x,z)→(-x,-z),y 不变),让"只写一半"的场地补成整场。
//   三种 kind 分别处理坐标;mural/noPaint 的面法向也要一并镜像。注意镜像后 min/max 需交换对角的 x/z。
//   与 mapThumb.js 的 mirror 逻辑一致(缩略图必须同源镜像),改动请两处同步。
function mirrorDef(d) {
  const mural = d.mural ? d.mural.map((m) => ({ ...m, n: [-m.n[0], m.n[1], -m.n[2]] })) : undefined;
  const noPaint = d.noPaint ? d.noPaint.map((m) => [-m[0], m[1], -m[2]]) : undefined;
  if (d.kind === 'box') {
    return { ...d, mural, noPaint, min: [-d.max[0], d.min[1], -d.max[2]], max: [-d.min[0], d.max[1], -d.min[2]] };
  }
  if (d.kind === 'obox') return { ...d, mural, noPaint, center: [-d.center[0], d.center[1], -d.center[2]] };
  return { ...d, mural, noPaint, low: [-d.low[0], d.low[1], -d.low[2]], high: [-d.high[0], d.high[1], -d.high[2]] };
}
