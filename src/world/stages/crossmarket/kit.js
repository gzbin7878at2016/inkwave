// ============================================================================
// 【中文导读】Crossroads Market —— 本关共享的"建筑套件"(building kit)
// ----------------------------------------------------------------------------
// 【模块定位】本关所有道具构建器的公共工具库与调色板。makeKit(D, H) 在注册期被调用一次,返回一整套
//   几何/材质助手(笔画字体、窗、门、店面、雨篷、栏杆阳台、立面、屋顶…)。消费者:buildings.js、hall.js、
//   street.js、tram.js、landing.js、scenery.js、props.js(它们都从 props.js 拿到 KIT)。生命周期:构建期
//   一次性生成几何,之后冻结;运行期不再调用。
// 【核心机制】H = PropKit 的 PACK_HELPERS(提供 THREE 及 add/box/cyl/lathe/tube/tor/sph/col/push/pop 等),
//   D = 道具定义表(供 sub() 复用其它道具类型)。文件内三块:
//     ① 几何助手:GB(手写顶点缓冲构造器)、tpl(模板几何缓存)、pbox/colBox/colT/sub(碰撞与子道具)、
//       RAIL/rakedRail(栏杆碰撞,子弹/墨/乌贼可穿);② 笔画字体:GL 字形表 + glyph/letters/textW;
//     ③ 建筑套件:awning/win/flowerBox/balconette/frontDoor/fascia/shopfront/goodsShelf/bracketSign/
//       wallLantern/bill + facade/roof/dormer/slopeGeo。
//   【性能核心】一切几何按"键"进 TPL 模板缓存(tpl),同尺寸同色只建一次;同材质的部件最终被 PropKit 合并
//   成一个 mesh,把 draw call 压到每种材质 1 次。字/窗这类高频小件严禁每实例重建。
// 【关键约定】米制、Y 轴向上。本套件的部件统一"贴墙面"约定:局部 z=0 是墙面,+Z 朝外,x 沿墙,y 从地面向上;
//   除雨篷、壁灯、悬挂招牌外,部件一般不超出首层以下 ~0.15 m。屋顶的 slopeGeo 在局部 -Z 从檐(u=0)到脊(u=L)。
//   绕 Y 的旋转在 PropKit 里精确(碰撞 AABB 用 8 角点变换,见 colT),非 90° 的 rx/rz 只用于纯视觉小件。
// 【配套阅读】src/world/propkit.js(PropKit 与 PACK_HELPERS)、src/world/stages/crossmarket/layout.js(FL)、
//   ./buildings.js、./road 各构建器、docs/ASSETS.zh-CN.md、docs/ARCHITECTURE.zh-CN.md。
// 【建议阅读顺序】先 GB/tpl(几何底座)→ letters/glyph(字体)→ win/awning(最小墙件)→ facade/roof(组装) 。
// ============================================================================
// Crossroads Market — shared building kit for the stage's prop builders (owner: the crossmarket stage).
// makeKit(D, H) returns the palette + geometry helpers (stroke-font channel letters, windows, doors, shopfronts,
// awnings, balconettes, facades, roofs …) used by buildings.js, hall.js, street.js and tram.js. H = the PropKit's
// PACK_HELPERS (THREE + helpers), D = the prop definition table (for sub-props).
// 【首层标高】first-floor level(米),与 layout.js 的 FL 同值——立面按它排窗层。
export const FL = 2.6;   // first-floor level (layout.js)

// 【工厂入口】注册期调用一次:解构 H 的助手,返回套件对象(见文件末 return)。D 用于 sub() 复用道具类型。
export function makeKit(D, H) {
  const { THREE, col, shade, mixc, latheGeo, tubeGeo, extrudeGeo, arcPts, PI, TAU, HP, P3 } = H;
  // 【无阴影包一层】NS:标 tiny 部件(字、销钉…)为不投影,省 shadow map 里的小物件。
  const NS = (m) => (H.noShadow ? H.noShadow(m) : m);

  // ------------------------------------------------------------------------------------------ palette
  // 【调色板】低饱和老城色调;小酒馆绿(bistro-green)铁艺与鎏金字是仅有的重音(墨迹仍是最响的)。
  const K = {
    iron: '#2f5446', ironDk: '#223d33', ironLt: '#4d7766', gold: '#c9a55a', goldDk: '#9c7c3c', black: '#232427',
    frame: '#efe9dc', frameDk: '#dcd3c2', glass: '#2c3a44', glassLt: '#46596a', glassWarm: '#4a4538', lit: '#ffd9a0',
    stone: '#e4d7bd', stoneDk: '#c3b392', stoneLt: '#efe6d3', mortar: '#d9d0bf', brickDk: '#8e5641',
    slate: '#5b646e', slateDk: '#4b535c', tile: '#b0634a', tileDk: '#8f4d3a', lead: '#8b939a', zinc: '#9aa3a8', verdigris: '#6f9e8b',
    chim: '#b87a5f', pot: '#b5654a', gutter: '#3c4247',
    canvas: '#efe6d2', red: '#b8483e', green: '#3f7a5a', blue: '#3f5f86', ochre: '#cf9a3c', plum: '#7a3a4c', teal: '#3f8a85',
    wood: '#b98a5a', woodDk: '#8a6340', woodLt: '#d9b687', bread: '#c98a45', breadDk: '#9a5e2a',
  };


  // ------------------------------------------------------------------------------------------ geometry helpers
  // 【GB 几何构造器】轻量顶点缓冲:[p]osition/[n]ormal/[uv]/[c]olor/[idx] 五个并行数组;v() 压入一个顶点
  //   返回其索引,tri/quad 追加索引并按法线朝向自动修正绕序(避免背面剔除)。geo() 组装成 BufferGeometry。
  class GB {
    constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; }
    // 【加顶点】带法线与顶点色;返回索引。uv 恒为 (0,0)——本套件几何不用贴图。
    v(x, y, z, nx, ny, nz, r = 1, g = r, b = r) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(0, 0); this.c.push(r, g, b); return this.p.length / 3 - 1; }
    // 【加三角】用三顶点平均法线判断朝向;退化(面积≈0)直接丢弃,朝里则反转绕序。
    tri(a, b, c) {
      const P = this.p, N = this.n;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
      const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      if (cx * cx + cy * cy + cz * cz < 1e-18) return;
      const s = cx * (N[a * 3] + N[b * 3] + N[c * 3]) + cy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + cz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
      if (s < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
    }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
    // 【产出】组装 THREE.BufferGeometry(position/normal/uv/color + 索引)。
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.idx);
      return g;
    }
  }
  // 【模板缓存】TPL 以字符串键存已建几何;tpl(key, fn) 首次现建、之后复用——同尺寸窗/字/屋顶只建一次。
  const TPL = new Map();
  const tpl = (key, fn) => { let g = TPL.get(key); if (!g) { g = fn(); TPL.set(key, g); } return g; };
  // 【键格式化】数字保留 4 位小数以免浮点噪差异导致缓存击穿。
  const kf = (a) => (typeof a === 'number' ? a.toFixed(4) : String(a));
  // 【确定性 hash】把标量映射到 [0,1),供逐实例色调/随机微差(不依赖 Math.random,保证可复现)。
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  // 【颜色→线性三元组】cx3 把十六进制/色名转成 [r,g,b](0..1),写进顶点色。
  const cx3 = (c) => { const k = col(c); return [k.r, k.g, k.b]; };
  const pboxGeo = () => tpl('pbox', () => new THREE.BoxGeometry(1, 1, 1));
  // cached lumpy foliage / sack blob (H.blobGeo builds a new geometry per call)
  // 【植被团块】H.blobGeo 每次调用都新建几何,故用 det+seed 缓存复用(花箱、树冠等)。
  const blob = (det, seed) => tpl('cmblob|' + det + '|' + seed, () => H.blobGeo(1, det, seed));
  // plain (unbevelled) box for small / flush parts: 12 triangles
  // 【素盒】无倒角小盒(12 三角)用于细小/贴平部件;w/h/d 作为 sx/sy/sz 缩放共享的 pboxGeo。
  const pbox = (B, mat, c, w, h, d, x, y, z, o = {}) => B.add(mat, pboxGeo(), c, x, y, z, { ...o, sx: w, sy: h, sz: d });
  // collider from centre + size; roof: true = an off-limits top (nobody stands on it, never inked), or pass the
  // flags object itself ({ rail: true } for railings: blocks kids, shots / ink / squids pass)
  // 【中心+尺寸碰撞】roof:true = 不可站的顶(上不去、不可上墨);也可传 flags 对象(如 { rail:true } 栏杆:挡人,子弹/墨/乌贼可穿)。
  const colBox = (B, x, y, z, w, h, d, roof = false) => B.col(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, roof === true ? { roof: true } : roof || undefined);
  // collider given in the CURRENT push frame (B.col takes prop-local coordinates): the box's corners go through the
  // builder's stack top and the prop-local AABB is stored (pushes here only turn about Y, so the fit is exact)
  // 【当前帧碰撞】在当前 push 坐标系(world 局部)给定 AABB:把 8 角点经栈顶矩阵变换后取轴对齐包围盒再存。
  //   因本套件的 push 只绕 Y 旋转,变换后仍是精确 AABB(无需近似)。
  const _cv = new THREE.Vector3();
  function colT(B, x0, y0, z0, x1, y1, z1, flags) {
    const m = B.top; let ax = Infinity, ay = Infinity, az = Infinity, bx = -Infinity, by = -Infinity, bz = -Infinity;
    for (let i = 0; i < 8; i++) {
      _cv.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0).applyMatrix4(m);
      ax = Math.min(ax, _cv.x); ay = Math.min(ay, _cv.y); az = Math.min(az, _cv.z); bx = Math.max(bx, _cv.x); by = Math.max(by, _cv.y); bz = Math.max(bz, _cv.z);
    }
    B.col(ax, ay, az, bx, by, bz, flags);
  }
  // 【栏杆标志】挡人、可穿弹/墨/乌贼。
  const RAIL = { rail: true };
  // raked railing collider beside a stair (local +Z from the foot up to (0, rise, run)): `n` stepped rail boxes from
  // x0 to x1, each from the ground (below == null) or `below` m under the flight up to the handrail height
  // 【斜梯扶手碰撞】楼梯旁的扶手:从 x0..x1 用 n 个阶梯小盒逼近斜坡(局部 +Z 从梯脚到 (rise,run)),
  //   每块从地面(或 below 米处)顶到扶手高度。
  function rakedRail(B, x0, x1, rise, run, HR, n = 5, below = null) {
    for (let i = 0; i < n; i++) {
      const t0 = (run * i) / n, t1 = (run * (i + 1)) / n, ya = (rise * t0) / run, yb = (rise * t1) / run;
      colT(B, x0, below == null ? 0 : Math.max(0, ya - below), t0, x1, yb + HR, t1, RAIL);
    }
  }
  // 【杆件】在两点间拉一根管(低径向,默认 5 边),用于铁艺细杆。
  const rod = (B, mat, c, a, b, r, radial = 5) => B.tube(mat, c, [a, b], r, { radial });
  // compose another prop type inside this one, carrying its colliders into this prop's frame
  // 【子道具】把另一个道具类型 D[type] 嵌进当前道具:push 到 (x,y,z,ry) 后调用其 build,再把它的
  //   碰撞盒从局部旋转/平移到本帧(含 roof/rail 标志透传)。用于货架上的小件、招牌等复用。
  function sub(B, type, x, y, z, ry, opts = {}) {
    const def = D[type];
    if (!def) return;
    const n0 = B.cols.length, ao = B.aoBase;
    B.push(x, y, z, ry);
    def.build(B, opts);
    B.pop();
    B.aoBase = ao;
    const c = Math.cos(ry), s = Math.sin(ry);
    for (let i = n0; i < B.cols.length; i++) {
      const b = B.cols[i];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [lx, lz] of [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]]) {
        const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
        x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
      }
      B.cols[i] = b[6] ? [x0, b[1] + y, z0, x1, b[4] + y, z1, b[6]] : [x0, b[1] + y, z0, x1, b[4] + y, z1];   // keep roof / rail flags
    }
  }

  // ------------------------------------------------------------------------------------------ stroke font
  // 【笔画字体】圆头粗体无衬线(大写高度=1):字形用"中心线笔画+圆端/圆角"定义,可挤出成立体通道字
  //   (channel letters)或压平成涂料字。坐标为字形空间(0..1),由 glyph 缩放到字高。不依赖任何字体文件。
  // Rounded bold sans (cap height 1): centre-line strokes, round caps + joins; raised channel letters or flat paint.
  // 【椭圆弧采样】返回 a0..a1 度之间、n+1 个 [x,y] 点(角度制、椭圆半径 rx/ry),构建曲线笔画。
  const EA = (cx, cy, rx, ry, a0, a1, n = 12) => { const o = []; for (let i = 0; i <= n; i++) { const a = ((a0 + (a1 - a0) * (i / n)) * PI) / 180; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return o; };
  // 【整圆】用 EA 采一整圈(去掉重复尾点),{c:…} 标记为闭合环。
  const LOOP = (cx, cy, rx, ry, n = 24) => ({ c: EA(cx, cy, rx, ry, 0, 360, n).slice(0, n) });
  // 【字形表】GL[字符] = [前进宽度, 笔画1, 笔画2, …];笔画是 [x,y] 折线数组,或 {c:…} 闭合环。
  const GL = {
    A: [0.66, [[0, 0], [0.33, 1], [0.66, 0]], [[0.13, 0.33], [0.53, 0.33]]],
    B: [0.58, [[0, 0], [0, 1]], [[0, 1], ...EA(0.3, 0.755, 0.245, 0.245, 90, -90, 12), [0, 0.51]], [[0, 0.51], ...EA(0.32, 0.255, 0.255, 0.255, 90, -90, 12), [0, 0]]],
    C: [0.64, EA(0.34, 0.5, 0.34, 0.5, 46, 314, 22)],
    D: [0.6, [[0, 0], [0, 1]], [[0, 1], ...EA(0.16, 0.5, 0.44, 0.5, 90, -90, 16), [0, 0]]],
    E: [0.5, [[0.5, 1], [0, 1], [0, 0], [0.5, 0]], [[0, 0.52], [0.42, 0.52]]],
    F: [0.5, [[0.5, 1], [0, 1], [0, 0]], [[0, 0.52], [0.42, 0.52]]],
    G: [0.68, [...EA(0.34, 0.5, 0.34, 0.5, 46, 360, 22), [0.4, 0.5]]],
    H: [0.6, [[0, 0], [0, 1]], [[0.6, 0], [0.6, 1]], [[0, 0.52], [0.6, 0.52]]],
    I: [0, [[0, 0], [0, 1]]],
    J: [0.5, [[0.5, 1], ...EA(0.25, 0.3, 0.25, 0.3, 0, -172, 12)]],
    K: [0.58, [[0, 0], [0, 1]], [[0.56, 1], [0.02, 0.38]], [[0.22, 0.6], [0.6, 0]]],
    L: [0.48, [[0, 1], [0, 0], [0.48, 0]]],
    M: [0.76, [[0, 0], [0, 1], [0.38, 0.3], [0.76, 1], [0.76, 0]]],
    N: [0.62, [[0, 0], [0, 1], [0.62, 0], [0.62, 1]]],
    O: [0.74, LOOP(0.37, 0.5, 0.37, 0.5, 28)],
    P: [0.56, [[0, 0], [0, 1]], [[0, 1], ...EA(0.29, 0.735, 0.265, 0.265, 90, -90, 12), [0, 0.47]]],
    Q: [0.74, LOOP(0.37, 0.5, 0.37, 0.5, 28), [[0.46, 0.22], [0.78, -0.04]]],
    R: [0.58, [[0, 0], [0, 1]], [[0, 1], ...EA(0.29, 0.735, 0.265, 0.265, 90, -90, 12), [0, 0.47]], [[0.26, 0.47], [0.6, 0]]],
    S: [0.56, [...EA(0.28, 0.75, 0.27, 0.25, 28, 270, 12), ...EA(0.28, 0.25, 0.28, 0.25, 90, -152, 12).slice(1)]],
    T: [0.62, [[0, 1], [0.62, 1]], [[0.31, 1], [0.31, 0]]],
    U: [0.6, [[0, 1], ...EA(0.3, 0.32, 0.3, 0.32, 180, 360, 14), [0.6, 1]]],
    V: [0.66, [[0, 1], [0.33, 0], [0.66, 1]]],
    W: [0.92, [[0, 1], [0.23, 0], [0.46, 0.72], [0.69, 0], [0.92, 1]]],
    X: [0.62, [[0, 1], [0.62, 0]], [[0, 0], [0.62, 1]]],
    Y: [0.64, [[0, 1], [0.32, 0.48], [0.64, 1]], [[0.32, 0.48], [0.32, 0]]],
    Z: [0.56, [[0, 1], [0.56, 1], [0, 0], [0.56, 0]]],
    0: [0.56, LOOP(0.28, 0.5, 0.28, 0.5, 26)],
    1: [0.3, [[0, 0.78], [0.26, 1], [0.26, 0]]],
    2: [0.54, [...EA(0.27, 0.72, 0.27, 0.28, 160, -30, 12), [0, 0], [0.56, 0]]],
    3: [0.54, EA(0.26, 0.75, 0.25, 0.25, 150, -90, 12), EA(0.27, 0.26, 0.28, 0.26, 90, -150, 12)],
    4: [0.6, [[0.44, 0], [0.44, 1], [0, 0.3], [0.6, 0.3]]],
    5: [0.54, [[0.5, 1], [0.07, 1], [0.05, 0.52], ...EA(0.29, 0.34, 0.28, 0.34, 150, -150, 14)]],
    6: [0.56, [...EA(0.28, 0.5, 0.28, 0.5, 62, 180, 10), [0, 0.3]], LOOP(0.28, 0.3, 0.28, 0.3, 20)],
    7: [0.54, [[0, 1], [0.54, 1], [0.18, 0]]],
    8: [0.56, LOOP(0.28, 0.76, 0.23, 0.24, 18), LOOP(0.28, 0.27, 0.28, 0.27, 20)],
    9: [0.56, LOOP(0.28, 0.7, 0.28, 0.3, 20), [[0.56, 0.7], ...EA(0.28, 0.5, 0.28, 0.5, 0, -118, 10)]],
    '-': [0.36, [[0, 0.45], [0.36, 0.45]]],
    '/': [0.4, [[0, 0], [0.4, 1]]],
    "'": [0, [[0, 1], [0, 0.8]]],
    '&': [0.7, [[0.7, 0], ...EA(0.27, 0.72, 0.17, 0.2, -40, 220, 12).reverse(), [0.08, 0.28], ...EA(0.26, 0.24, 0.24, 0.24, 180, 300, 6), [0.62, 0.36]]],
  };
  // 【点类字符】圆点构成的字符(中点/句点/冒号),逐个点用 disc 画圆。
  const DOTS = { '·': [[0, 0.46]], '.': [[0, 0]], ':': [[0, 0.1], [0, 0.62]] };
  // 【空格宽度】字形空间单位。
  const SPACE = 0.34;
  // 【带状挤出】沿折线挤出一条有厚度的带(中心线笔画的本体):带斜接(miter)拐角、可选倒角(bev)、
  //   可选侧墙(walls 从 z=d 拉回 z0,用于立体通道字)。pts 为折线,closed 决定是否闭合。
  function ribbon(g, pts, closed, hw, b, d, z0) {
    const n = pts.length, R = Math.SQRT1_2, walls = d - z0 > 1e-5, bev = b > 1e-5;
    const N = pts.map((p, i) => {
      const a = closed ? pts[(i - 1 + n) % n] : i > 0 ? pts[i - 1] : null;
      const c = closed ? pts[(i + 1) % n] : i < n - 1 ? pts[i + 1] : null;
      const nrm = (u, v) => { const dx = v[0] - u[0], dy = v[1] - u[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
      const n1 = a ? nrm(a, p) : null, n2 = c ? nrm(p, c) : null;
      if (!n1) return [n2[0], n2[1], 1];
      if (!n2) return [n1[0], n1[1], 1];
      let mx = n1[0] + n2[0], my = n1[1] + n2[1]; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      return [mx, my, Math.min(1.6, 1 / Math.max(0.3, mx * n2[0] + my * n2[1]))];
    });
    const rings = pts.map((p, i) => {
      const [nx, ny, k] = N[i];
      const at = (s) => [p[0] + nx * k * s, p[1] + ny * k * s];
      const hi = bev ? hw - b : hw, Li = at(hi), Lo = at(hw), Ri = at(-hi), Ro = at(-hw), dz = bev ? b : 0;
      const r = [g.v(Li[0], Li[1], d, 0, 0, 1), g.v(Ri[0], Ri[1], d, 0, 0, 1)];
      if (bev) r.push(g.v(Li[0], Li[1], d, nx * R, ny * R, R), g.v(Lo[0], Lo[1], d - b, nx * R, ny * R, R), g.v(Ri[0], Ri[1], d, -nx * R, -ny * R, R), g.v(Ro[0], Ro[1], d - b, -nx * R, -ny * R, R));
      if (walls) r.push(g.v(Lo[0], Lo[1], d - dz, nx, ny, 0), g.v(Lo[0], Lo[1], z0, nx, ny, 0), g.v(Ro[0], Ro[1], d - dz, -nx, -ny, 0), g.v(Ro[0], Ro[1], z0, -nx, -ny, 0));
      return r;
    });
    const segs = closed ? n : n - 1, np = rings[0].length;
    for (let i = 0; i < segs; i++) {
      const A = rings[i], Bq = rings[(i + 1) % n];
      for (let j = 0; j < np; j += 2) g.quad(A[j], A[j + 1], Bq[j + 1], Bq[j]);
    }
  }
  // 【圆盘挤出】笔画圆端/圆点:一个圆面 + 可选倒角环 + 可选侧墙,可只画 a0..a1 的扇形(圆端帽用)。
  function disc(g, cx, cy, r, b, d, z0, seg, a0 = 0, a1 = TAU) {
    const R = Math.SQRT1_2, walls = d - z0 > 1e-5, bev = b > 1e-5, ri = bev ? r - b : r, full = a1 - a0 > TAU - 1e-4;
    const c0 = g.v(cx, cy, d, 0, 0, 1), f = [], bi = [], bo = [], wt = [], wb = [];
    const n = full ? seg : seg + 1;
    for (let k = 0; k < n; k++) {
      const a = a0 + ((a1 - a0) * k) / seg, cs = Math.cos(a), sn = Math.sin(a);
      f.push(g.v(cx + cs * ri, cy + sn * ri, d, 0, 0, 1));
      if (bev) { bi.push(g.v(cx + cs * ri, cy + sn * ri, d, cs * R, sn * R, R)); bo.push(g.v(cx + cs * r, cy + sn * r, d - b, cs * R, sn * R, R)); }
      if (walls) { wt.push(g.v(cx + cs * r, cy + sn * r, d - (bev ? b : 0), cs, sn, 0)); wb.push(g.v(cx + cs * r, cy + sn * r, z0, cs, sn, 0)); }
    }
    for (let k = 0; k < seg; k++) {
      const j = full ? (k + 1) % seg : k + 1;
      g.tri(c0, f[k], f[j]);
      if (bev) g.quad(bi[k], bo[k], bo[j], bi[j]);
      if (walls) g.quad(wt[k], wb[k], wb[j], wt[j]);
    }
  }
  // 【取字形几何】按 (字符,笔画宽 wt,挤出深 dep,倒角 bev,弧段 ds) 缓存一份字形几何;返回 {geo, adv}。
  //   dep>0 走立体通道字(逐笔画向后退 0.006 做出层叠);dep=0 走平压字。字宽 s=1-wt 使字形缩进到笔画中线。
  function glyph(ch, wt, dep, bev, ds = 10) {
    return tpl(['cmgl', ch, wt, dep, bev, ds].map(kf).join('|'), () => {
      const s = 1 - wt, hw = wt / 2, T = (p) => [hw + p[0] * s, hw + p[1] * s];
      const g = new GB();
      const b = Math.min(bev, hw * 0.6);
      if (DOTS[ch]) {
        for (const p of DOTS[ch]) { const q = T(p); disc(g, hw * 1.15, q[1], hw * 1.15, b, dep, 0, ds); }
        return { geo: g.geo(), adv: wt * 1.3 };
      }
      const def = GL[ch];
      if (!def) return { geo: null, adv: SPACE };
      const [w, ...strokes] = def;
      strokes.forEach((st, si) => {
        const d = dep > 0 ? dep - si * 0.006 : si * 0.0004;
        const closed = !Array.isArray(st);
        let pts = (closed ? st.c : st).map(T);
        pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-4);
        if (closed) { ribbon(g, pts, true, hw, b, d, 0); return; }
        let cur = [pts[0]];
        const joints = [pts[0], pts[pts.length - 1]];
        for (let i = 1; i < pts.length; i++) {
          cur.push(pts[i]);
          if (i < pts.length - 1) {
            const a = pts[i - 1], p = pts[i], c = pts[i + 1];
            const t1 = Math.atan2(p[1] - a[1], p[0] - a[0]), t2 = Math.atan2(c[1] - p[1], c[0] - p[0]);
            let dt = Math.abs(t2 - t1); if (dt > PI) dt = TAU - dt;
            if (dt > 0.6) { ribbon(g, cur, false, hw, b, d, 0); cur = [pts[i]]; joints.push(pts[i]); }
          }
        }
        if (cur.length > 1) ribbon(g, cur, false, hw, b, d, 0);
        const endCap = (p, q) => { const a = Math.atan2(p[1] - q[1], p[0] - q[0]); disc(g, p[0], p[1], hw, b, d, 0, Math.max(3, Math.round(ds / 2)), a - HP, a + HP); };
        endCap(pts[0], pts[1]); endCap(pts[pts.length - 1], pts[pts.length - 2]);
        for (const p of joints.slice(2)) disc(g, p[0], p[1], hw, b, d, 0, ds);
      });
      return { geo: g.geo(), adv: w * s + wt };
    });
  }
  // 【测宽】量一行字的总宽(字形空间单位):逐字累加 adv + 字距 track。供 align/缩放预算。
  const textW = (str, wt = 0.17, track = 0.12) => { let w = 0; const cs = [...str]; cs.forEach((ch, i) => { w += ch === ' ' ? SPACE : glyph(ch, wt, 0.12, 0.035).adv; if (i < cs.length - 1) w += track; }); return w; };
  // a line of letters facing +Z in the current frame (raised channel letters, or flat paint with flat: true);
  // lit: an unlit-shaded acrylic face just proud of each letter (reads as switched on at dusk). Returns the width (m).
  // 【排字】在当前帧里朝 +Z 排一行字:通道字(默认)或 flat:true 涂料字;lit 会给每个字再叠一层自发光亚克力面
  //   (黄昏像亮灯)。返回总宽(米)。用于招牌/门楣/账单海报。
  function letters(B, str, o = {}) {
    const h = o.h ?? 0.3, wt = o.wt ?? 0.17, flat = !!o.flat;
    const dep = flat ? 0 : o.dep ?? 0.05, bev = flat ? 0 : o.bev ?? 0, track = o.track ?? 0.12;
    const ds = o.ds ?? (flat || h < 0.12 ? 6 : 8);
    const W = textW(str, wt, track) * h;
    let x = o.align === 'left' ? 0 : o.align === 'right' ? -W : -W / 2;
    const cs = [...str];
    cs.forEach((ch, i) => {
      if (ch === ' ') { x += (SPACE + track) * h; return; }
      const gi = glyph(ch, wt, dep, bev, ds);
      const m = o.mat ?? (flat ? 'paint' : 'gloss');
      if (gi.geo) B.add(o.cast ? m : NS(m), gi.geo, o.c ?? K.gold, (o.x ?? 0) + x, o.y ?? 0, o.z ?? 0, { s: h, sz: flat ? 1 : h, glow: o.glow, ao: false });
      if (gi.geo && o.lit) {
        const fg = glyph(ch, wt, 0, 0, ds);
        if (fg.geo) B.add(NS('glow'), fg.geo, o.litC ?? o.c ?? K.lit, (o.x ?? 0) + x, o.y ?? 0, (o.z ?? 0) + dep * h + 0.003, { s: h, sz: 1, glow: o.lit, ao: false });
      }
      x += (gi.adv + (i < cs.length - 1 ? track : 0)) * h;
    });
    return W;
  }

  // ------------------------------------------------------------------------------------------ building kit
  // 【建筑套件·贴墙约定】以下部件全部"贴墙面"安装:局部 z=0 是墙面,+Z 朝墙外,x 沿墙,y 从地面向上。
  //   除雨篷、壁灯、悬挂招牌外,部件一般不超首层以下 ~0.15 m。
  // Everything below mounts flush on a wall face: local z = 0 is the face, +Z out of the wall, x along it, y up from
  // the ground. Nothing projects more than ~0.15 m below the first floor except awnings, lamps and hanging signs.

  // striped canvas shop awning: sloping blind from the wall (y0) out to `proj` and down to y0 - drop, scalloped
  // valance at the front, triangular side cheeks; stripes run down the slope. Cached per size + colours.
  // 【雨篷几何】条纹帆布店篷:从墙(y0)向外 `proj`、下垂 `drop` 的斜面;前沿带扇贝形帷板,两侧三角形颊板;
  //   条纹顺坡向下。按尺寸+配色缓存。双腿(1 正面 0.72 亮度 / -1 背面)做出双面观感。
  function awningGeo(W, proj, drop, cA, cB) {
    return tpl(['awn', W, proj, drop, cA, cB].map(kf).join('|'), () => {
      const g = new GB(), n = Math.max(3, Math.round(W / 0.24)), sw = W / n, ca = cx3(cA), cb = cx3(cB);
      const L = Math.hypot(proj, drop), ny = proj / L, nz = drop / L;
      for (const side of [1, -1]) {
        const off = side > 0 ? 0 : -0.006, k = side > 0 ? 1 : 0.72;
        for (let i = 0; i < n; i++) {
          const c = (i % 2 ? cb : ca).map((v) => v * k), x0 = -W / 2 + i * sw, x1 = x0 + sw;
          // canvas slope (slight belly)
          const rows = 3, ids = [];
          for (let r = 0; r <= rows; r++) {
            const t = r / rows, belly = Math.sin(t * PI) * 0.035;
            ids.push([g.v(x0, -drop * t - belly + off, proj * t, 0, ny * side, nz * side, ...c), g.v(x1, -drop * t - belly + off, proj * t, 0, ny * side, nz * side, ...c)]);
          }
          for (let r = 0; r < rows; r++) g.quad(ids[r][0], ids[r][1], ids[r + 1][1], ids[r + 1][0]);
          // valance with a scallop
          const vh = 0.16, y0 = -drop + off, z0 = proj + 0.003 * side;
          const q = [g.v(x0, y0, z0, 0, 0, side, ...c), g.v(x1, y0, z0, 0, 0, side, ...c), g.v(x1, y0 - vh, z0, 0, 0, side, ...c), g.v(x0, y0 - vh, z0, 0, 0, side, ...c)];
          g.quad(q[0], q[1], q[2], q[3]);
          const cen = g.v((x0 + x1) / 2, y0 - vh, z0, 0, 0, side, ...c), arc = [];
          for (let s = 0; s <= 5; s++) { const t = PI + (s / 5) * PI; arc.push(g.v((x0 + x1) / 2 - Math.cos(t) * sw / 2, y0 - vh + Math.sin(t) * sw * 0.4, z0, 0, 0, side, ...c)); }
          for (let s = 0; s < 5; s++) g.tri(cen, arc[s], arc[s + 1]);
        }
        // side cheeks (plain colour A)
        for (const sx of [-1, 1]) {
          const c = ca.map((v) => v * (side > 0 ? 0.92 : 0.7)), x = sx * (W / 2 + 0.002 * side);
          const a = g.v(x, 0, 0, sx * side, 0, 0, ...c), b = g.v(x, -drop, proj, sx * side, 0, 0, ...c), d2 = g.v(x, -drop - 0.16, proj, sx * side, 0, 0, ...c), e = g.v(x, -0.3, 0.12, sx * side, 0, 0, ...c);
          g.quad(a, b, d2, e);
        }
      }
      return g.geo();
    });
  }
  // 【雨篷】把 awningGeo 装到墙上,并补卷轴盒、两侧铁臂、前横杆。
  function awning(B, x, y, W, proj, drop, cA, cB = K.canvas) {
    B.box('paint', K.ironDk, W + 0.1, 0.12, 0.14, x, y + 0.02, 0.07, { r: 0.03 });            // roller box
    B.add('foliage', awningGeo(W, proj, drop, cA, cB), 'white', x, y - 0.02, 0.1, {});
    for (const sx of [-1, 1]) {                                                              // iron arms
      rod(B, NS('metal'), K.ironDk, P3(x + sx * (W / 2 - 0.05), y - 0.75, 0.02), P3(x + sx * (W / 2 - 0.05), y - drop - 0.02, proj + 0.08), 0.014);
      B.cyl(NS('metal'), K.ironDk, 0.025, 0.04, x + sx * (W / 2 - 0.05), y - 0.75, 0.02, { rx: HP, seg: 6 });
    }
    B.cyl(NS('metal'), K.ironDk, 0.02, W, x, y - drop - 0.02, proj + 0.1, { rz: HP, seg: 6 });  // front bar
  }
  // double-hung sash window in an opening w × h (sill at y), with a surround: 'stone' architrave + sill (+ keystone /
  // cornice hood / pediment), 'paint' band, 'brick' segmental arch; shutters, a lit blind, a balconette
  // 【窗】上下推拉窗,开洞 w×h(窗台在 y):含窗框/中挺/分格条;surround 可选 stone 石框(+ 拱心石/檐口/山花)、
  //   paint 涂料框、brick 砖拱;可带百叶窗(shut)、亮灯窗帘(lit/curtain)、花箱(box)。door 变体画成落地法式门。
  function win(B, x, y, w, h, o = {}) {
    const fc = o.frame ?? K.frame, gc = o.glass ?? K.glass, sur = o.sur ?? 'stone', sc = o.surC ?? K.stone;
    const door = !!o.door;
    pbox(B, NS('gloss'), o.lit ? K.glassWarm : gc, w, h, 0.02, x, y + h / 2, 0.006);
    // sash frames: outer frame, meeting rail, glazing bars
    pbox(B, NS('paint'), fc, w, 0.05, 0.05, x, y + h - 0.025, 0.03);
    pbox(B, NS('paint'), fc, w, 0.06, 0.05, x, y + 0.03, 0.03);
    for (const sx of [-1, 1]) pbox(B, NS('paint'), fc, 0.05, h, 0.05, x + sx * (w / 2 - 0.025), y + h / 2, 0.03);
    const mr = door ? 0.62 : 0.52;
    pbox(B, NS('paint'), fc, w, 0.045, 0.05, x, y + h * mr, 0.035);
    const nb = o.bars ?? (w > 0.8 ? 1 : 0);
    for (let i = 1; i <= nb; i++) pbox(B, NS('paint'), fc, 0.024, h - 0.1, 0.03, x - w / 2 + (i * w) / (nb + 1), y + h / 2, 0.036);
    if (!door) for (const t of [0.26, 0.77]) pbox(B, NS('paint'), fc, w - 0.08, 0.022, 0.03, x, y + h * t, 0.036);
    else pbox(B, NS('paint'), fc, w - 0.06, h * 0.3, 0.035, x, y + h * 0.15 + 0.03, 0.028);   // French-door bottom panels
    if (o.lit) pbox(B, NS('glow'), K.lit, w - 0.1, h * 0.3, 0.004, x, y + h * 0.8, 0.018, { glow: o.lit });
    else if (o.curtain) for (const sx of [-1, 1]) pbox(B, NS('paint'), o.curtain, w * 0.22, h * 0.8, 0.01, x + sx * w * 0.36, y + h * 0.55, 0.019);
    // surround
    if (sur === 'stone') {
      const t = 0.13;
      pbox(B, NS('paint'), sc, w + t * 2, t, 0.06, x, y + h + t / 2, 0.03);
      for (const sx of [-1, 1]) pbox(B, NS('paint'), sc, t, h + 0.02, 0.06, x + sx * (w / 2 + t / 2), y + h / 2, 0.03);
      if (o.key) pbox(B, NS('paint'), shade(sc, 1.04), 0.16, 0.24, 0.09, x, y + h + 0.1, 0.045);
      if (o.hood === 'cornice') { pbox(B, 'paint', sc, w + 0.44, 0.08, 0.2, x, y + h + 0.18, 0.1); pbox(B, NS('paint'), shade(sc, 0.95), w + 0.36, 0.06, 0.14, x, y + h + 0.11, 0.07); for (const sx of [-1, 1]) pbox(B, NS('paint'), sc, 0.08, 0.26, 0.16, x + sx * (w / 2 + 0.13), y + h + 0.02, 0.08); }
      if (o.hood === 'pediment') {
        pbox(B, 'paint', sc, w + 0.4, 0.08, 0.16, x, y + h + 0.17, 0.08);
        B.push(x, y + h + 0.21, 0.07, 0);
        for (const s of [-1, 1]) { B.push(s * (w + 0.4) / 4, 0.12, 0, 0, 0, -s * 0.52); pbox(B, 'paint', sc, (w + 0.4) / 2 / Math.cos(0.52) + 0.04, 0.07, 0.15, 0, 0, 0.01); B.pop(); }
        B.pop();
      }
    } else if (sur === 'paint') {
      const t = 0.11;
      pbox(B, NS('paint'), sc, w + t * 2, t, 0.02, x, y + h + t / 2, 0.01);
      for (const sx of [-1, 1]) pbox(B, NS('paint'), sc, t, h, 0.02, x + sx * (w / 2 + t / 2), y + h / 2, 0.01);
      pbox(B, NS('paint'), sc, w + t * 2, t, 0.02, x, y - t / 2, 0.01);
    } else if (sur === 'brick') {
      B.tube(NS('paint'), o.archC ?? K.brickDk, arcPts(x, y + h - 0.08, 0.04, w / 2 + 0.1, 0.25, PI - 0.25, 7), 0.085, { radial: 4, sz: 0.6 });
      pbox(B, NS('paint'), o.archC ?? K.brickDk, 0.14, 0.2, 0.08, x, y + h + 0.13, 0.04);
    }
    if (o.sill !== false && !door) pbox(B, 'paint', o.sillC ?? sc, w + 0.26, 0.07, 0.14, x, y - 0.035, 0.07);
    if (o.shut) {
      for (const sx of [-1, 1]) {
        const sw = w / 2 + 0.03, sxp = x + sx * (w / 2 + (sur === 'stone' ? 0.14 : 0.12) + sw / 2);
        pbox(B, NS('paint'), o.shut, sw, h + 0.04, 0.04, sxp, y + h / 2, 0.025);
        for (let k = 1; k < 4; k++) pbox(B, NS('paint'), shade(o.shut, 0.78), sw - 0.07, 0.03, 0.012, sxp, y + (k * (h + 0.04)) / 4, 0.048);
        pbox(B, NS('metal'), K.black, 0.04, 0.02, 0.03, sxp - sx * (sw / 2 - 0.03), y + h * 0.25, 0.05);
      }
    }
    if (o.box) flowerBox(B, x, y - 0.02, w + 0.1, o.box);
  }
  // window box of geraniums hanging under a sill
  // 【花箱】窗台下挂的花箱:木箱 + 绿叶团块 + 一排天竺葵球(红/粉/白交替)。
  function flowerBox(B, x, y, w, c) {
    pbox(B, 'wood', c === true ? '#8a4f3a' : c, w, 0.18, 0.2, x, y - 0.12, 0.14);
    const n = Math.max(3, Math.round(w / 0.22));
    B.add('foliage', blob(1, 3), '#4f8a45', x, y + 0.03, 0.14, { sx: w * 0.52, sy: 0.12, sz: 0.13 });
    for (let i = 0; i < n; i++) {
      const fx = x - w / 2 + 0.06 + (i / (n - 1)) * (w - 0.12);
      B.sph(NS('foliage'), ['#d9443c', '#e87a8c', '#f2ece0', '#d9443c'][(i + Math.round(x * 3)) & 3], 0.05, fx, y + 0.1 + (i % 2) * 0.03, 0.12 + (i % 3) * 0.03, { ws: 5, hs: 3 });
    }
  }
  // wrought-iron balconette at floor level y in front of an opening w (slab + railing with a scroll panel)
  // 【铁艺小阳台】楼面 y 前、开洞宽 w:石板 + 栏杆(中部带卷草花纹板);碰撞用 RAIL(可穿弹/墨)。
  function balconette(B, x, y, w, o = {}) {
    const W = w + 0.5, dz = o.depth ?? 0.42, ic = o.iron ?? K.iron;
    B.box('paint', o.slab ?? K.stone, W, 0.1, dz + 0.04, x, y - 0.05, dz / 2, { r: 0.02 });
    for (const sx of [-1, 1]) B.box('paint', o.slab ?? K.stone, 0.1, 0.24, 0.18, x + sx * (W / 2 - 0.12), y - 0.2, 0.09, { r: 0.02 });   // corbels
    colT(B, x - W / 2, y - 0.1, 0, x + W / 2, y + 0.95, dz, RAIL);                             // see-through iron: a rail
    const top = y + 0.9;
    B.tube(NS('metal'), ic, [P3(x - W / 2 + 0.03, top, 0.02), P3(x - W / 2 + 0.03, top, dz - 0.03), P3(x + W / 2 - 0.03, top, dz - 0.03), P3(x + W / 2 - 0.03, top, 0.02)], 0.02, { radial: 5 });
    pbox(B, NS('metal'), ic, W - 0.06, 0.025, 0.025, x, y + 0.09, dz - 0.03);
    const nb = Math.round((W - 0.1) / 0.13);
    for (let i = 0; i <= nb; i++) pbox(B, NS('metal'), ic, 0.016, 0.8, 0.016, x - W / 2 + 0.05 + (i * (W - 0.1)) / nb, y + 0.5, dz - 0.03);
    for (const sx of [-1, 1]) for (let i = 1; i < 3; i++) pbox(B, NS('metal'), ic, 0.016, 0.8, 0.016, x + sx * (W / 2 - 0.03), y + 0.5, (i * dz) / 3);
    // scroll panel in the middle
    for (const s of [-1, 1]) B.tor(NS('metal'), ic, 0.11, 0.011, x + s * 0.12, y + 0.48, dz - 0.03, { rs: 4, ts: 12, arc: PI * 1.5, rz: s > 0 ? PI : 0 });
    B.tor(NS('metal'), K.gold, 0.05, 0.01, x, y + 0.48, dz - 0.03, { rs: 4, ts: 10 });
    if (o.pots) for (const [px, c] of [[-W / 2 + 0.2, '#d9443c'], [W / 2 - 0.22, '#e87a8c']]) {
      B.lathe(NS('paint'), '#b5654a', [[0, 0], [0.08, 0], [0.11, 0.18], [0, 0.18]], x + px, y, dz * 0.55, { seg: 8 });
      B.add(NS('foliage'), blob(1, 5), '#4f8a45', x + px, y + 0.26, dz * 0.55, { s: 0.15 });
      B.sph(NS('foliage'), c, 0.05, x + px + 0.05, y + 0.36, dz * 0.55 + 0.05, { ws: 6, hs: 4 });
    }
  }
  // panelled front door with a fanlight, in a stone doorcase (door opening dw × dh at ground level)
  // 【正门】带扇形气窗(fanlight)的镶板大门,外框为石门套;含门把手、信箱板、门前台阶。
  function frontDoor(B, x, dw, dh, o = {}) {
    const dc = o.door ?? K.iron, sc = o.surC ?? K.stone;
    B.box(NS('paint'), dc, dw, dh - 0.35, 0.05, x, (dh - 0.35) / 2, 0.02, { r: 0.012 });
    for (const [yy, hh] of [[0.45, 0.6], [1.25, 0.7]]) for (const sx of (dw > 1.1 ? [-1, 1] : [0])) pbox(B, NS('paint'), shade(dc, 0.85), dw * (dw > 1.1 ? 0.36 : 0.66), hh, 0.02, x + sx * dw * 0.23, yy, 0.05);
    pbox(B, NS('gloss'), K.glass, dw, 0.3, 0.02, x, dh - 0.18, 0.01);                          // fanlight
    for (let i = -2; i <= 2; i++) { B.push(x, dh - 0.33, 0.03, 0, 0, i * 0.5); pbox(B, NS('paint'), K.frame, 0.02, 0.3, 0.02, 0, 0.15, 0); B.pop(); }
    B.sph(NS('metal'), K.gold, 0.035, x + dw * 0.3, 1.0, 0.07, { ws: 8, hs: 6 });
    pbox(B, NS('metal'), K.gold, 0.2, 0.05, 0.02, x, 1.2, 0.052);                                // letter plate
    const t = 0.16;
    pbox(B, NS('paint'), sc, dw + t * 2, 0.16, 0.08, x, dh + 0.08, 0.04);
    for (const sx of [-1, 1]) pbox(B, NS('paint'), sc, t, dh, 0.08, x + sx * (dw / 2 + t / 2), dh / 2, 0.04);
    B.box(NS('paint'), shade(sc, 1.04), 0.2, 0.26, 0.11, x, dh + 0.1, 0.055, { r: 0.015 });
    pbox(B, NS('paint'), shade(sc, 0.9), dw + 0.5, 0.12, 0.3, x, 0.06, 0.15);                        // door step
  }
  // lettered fascia board between two console brackets (x0 … x1), top at y
  // 【店招横楣】x0..x1、顶在 y 的招牌板:两端托座、金线、檐口压顶;o.name 时排一行鎏金通道字(可亮灯)。
  function fascia(B, x0, x1, y, o = {}) {
    const W = x1 - x0, cx = (x0 + x1) / 2, fc = o.fascia ?? K.iron, Hh = 0.5;
    B.box(NS('paint'), fc, W, Hh, 0.1, cx, y - Hh / 2, 0.08, { r: 0.02 });
    B.box(NS('paint'), shade(fc, 1.12), W + 0.12, 0.07, 0.2, cx, y + 0.02, 0.1, { r: 0.02 });   // cornice cap
    pbox(B, NS('paint'), K.gold, W - 0.12, 0.018, 0.005, cx, y - 0.06, 0.132);                 // gilt lines
    pbox(B, NS('paint'), K.gold, W - 0.12, 0.018, 0.005, cx, y - Hh + 0.06, 0.132);
    for (const x of [x0, x1]) {                                                              // console brackets
      B.box(NS('paint'), shade(fc, 0.9), 0.22, 0.56, 0.18, x, y - 0.28, 0.1, { r: 0.03 });
      B.box(NS('paint'), K.gold, 0.12, 0.1, 0.05, x, y - 0.46, 0.19, { r: 0.02 });
    }
    if (o.name) {
      const maxH = 0.3, hL = Math.min(maxH, ((W - 0.6) / textW(o.name, 0.17, 0.12)));
      letters(B, o.name, { h: hL, x: cx, y: y - Hh / 2 - hL / 2 + 0.01, z: 0.133, c: o.letterC ?? K.gold, dep: 0.03, wt: 0.17, lit: o.lit ?? 1.1, litC: o.litC ?? '#ffe7b0' });
    }
  }
  // Victorian shopfront between x0 … x1: pilasters, fascia with gilded name, stallriser, display glazing with
  // mullions + transom lights, a recessed door, awning (open or rolled), a warm-lit interior strip; goods rack
  // 【维多利亚店面】x0..x1:壁柱 + 鎏金横楣 + 窗下裙板 + 橱窗(竖挺/横档)/凹进门/雨篷(展开或卷起)/
  //   暖光内条;o.goods 时在玻璃后侧摆一排货架剪影。o.door='l'/'c' 决定门靠左/居中。
  function shopfront(B, x0, x1, o = {}) {
    const W = x1 - x0, cx = (x0 + x1) / 2, fc = o.fascia ?? K.iron, top = o.top ?? 2.45;
    const dw = 0.95, dx = o.door === 'l' ? x0 + 0.3 + dw / 2 : o.door === 'c' ? cx : x1 - 0.3 - dw / 2;
    // pilasters (full height to the fascia)
    for (const x of [x0 + 0.12, x1 - 0.12]) { B.box(NS('paint'), fc, 0.26, top - 0.5, 0.1, x, (top - 0.5) / 2, 0.05, { r: 0.015 }); pbox(B, NS('paint'), shade(fc, 1.1), 0.3, 0.1, 0.12, x, 0.05, 0.06); }
    fascia(B, x0 + 0.05, x1 - 0.05, top + 0.05, o);
    // display windows either side of the door
    const segs = [[x0 + 0.25, dx - dw / 2 - 0.05], [dx + dw / 2 + 0.05, x1 - 0.25]].filter(([a, b]) => b - a > 0.3);
    for (const [a, b] of segs) {
      const w = b - a, c = (a + b) / 2;
      B.box(NS('paint'), fc, w, 0.52, 0.08, c, 0.26, 0.04, { r: 0.012 });                            // stallriser
      pbox(B, NS('paint'), shade(fc, 0.85), w - 0.16, 0.3, 0.02, c, 0.26, 0.085);
      pbox(B, NS('gloss'), K.glass, w, 1.35, 0.02, c, 1.2, 0.012);
      pbox(B, NS('glow'), o.glowC ?? K.lit, w - 0.04, 0.24, 0.004, c, 1.72, 0.024, { glow: 0.55 });   // lit interior band
      pbox(B, NS('paint'), fc, w, 0.06, 0.06, c, 0.55, 0.035);
      pbox(B, NS('paint'), fc, w, 0.05, 0.05, c, 1.62, 0.035);                                       // transom
      pbox(B, NS('paint'), fc, w, 0.06, 0.06, c, 1.9, 0.035);
      const nm = Math.max(1, Math.round(w / 0.9));
      for (let i = 1; i < nm; i++) pbox(B, NS('paint'), fc, 0.05, 1.35, 0.05, a + (i * w) / nm, 1.22, 0.035);
      for (let i = 1; i < nm * 2; i++) pbox(B, NS('paint'), fc, 0.025, 0.26, 0.03, a + (i * w) / (nm * 2), 1.76, 0.038);
      // shelf of goods behind the glass (reads through the dark glazing as silhouettes)
      if (o.goods) goodsShelf(B, c, 0.62, w - 0.2, o.goods);
    }
    // recessed door
    pbox(B, NS('paint'), fc, dw + 0.12, 0.08, 0.08, dx, 2.0, 0.04);
    for (const sx of [-1, 1]) pbox(B, NS('paint'), fc, 0.06, 2.0, 0.08, dx + sx * (dw / 2 + 0.03), 1.0, 0.04);
    B.box(NS('paint'), shade(fc, 0.92), dw - 0.04, 1.92, 0.05, dx, 0.96, -0.04, { r: 0.012 });
    pbox(B, NS('gloss'), K.glass, dw - 0.24, 1.0, 0.02, dx, 1.22, -0.01);
    pbox(B, NS('metal'), K.gold, 0.03, 0.3, 0.03, dx + dw / 2 - 0.14, 1.05, 0.0);
    pbox(B, NS('gloss'), K.glass, dw, 0.24, 0.02, dx, 2.2, 0.012);                             // fanlight over the door
    pbox(B, NS('paint'), shade(fc, 1.1), dw + 0.2, 0.05, 0.3, dx, 0.025, 0.02);                    // threshold step
    if (o.awn) awning(B, cx, top - 0.43, W - 0.35, o.proj ?? 1.25, o.drop ?? 0.55, o.awn[0], o.awn[1] ?? K.canvas);
    else if (o.rolled) { B.box(NS('paint'), o.rolled, W - 0.4, 0.13, 0.14, cx, top - 0.44, 0.07, { round: true, r: 0.04 }); }
  }
  // goods silhouettes on a display shelf just behind the glass: bread, fish, flowers, tins, cups, wine
  // 【橱窗货物剪影】玻璃后货架上的货品剪影:面包/鱼/花/罐头/杯/酒/书,kind 选择;逐件用 hash 微差。
  function goodsShelf(B, x, y, w, kind) {
    pbox(B, NS('wood'), K.woodDk, w, 0.04, 0.2, x, y, -0.1);
    const n = Math.max(3, Math.round(w / 0.22));
    for (let i = 0; i < n; i++) {
      const gx = x - w / 2 + 0.11 + (i * (w - 0.22)) / (n - 1), k = hash(gx * 7.3 + y);
      if (kind === 'bread') { B.sph(NS('paint'), k > 0.5 ? K.bread : K.breadDk, 0.1, gx, y + 0.08, -0.1, { ws: 6, hs: 3, sx: 1.3, sy: 0.6 }); if (i % 2) B.sph(NS('paint'), '#e3c8a0', 0.07, gx, y + 0.42, -0.1, { ws: 5, hs: 3, sy: 0.8 }); }
      else if (kind === 'flowers') { B.cyl(NS('paint'), '#8a939a', 0.07, 0.2, gx, y + 0.12, -0.1, { seg: 7 }); B.sph(NS('foliage'), ['#d9443c', '#f2d15a', '#e87a8c', '#f2ece0'][i & 3], 0.1, gx, y + 0.3, -0.1, { ws: 5, hs: 3 }); }
      else if (kind === 'fish') { B.sph(NS('gloss'), k > 0.5 ? '#9aa6ad' : '#c7ced2', 0.06, gx, y + 0.06, -0.1, { ws: 6, hs: 3, sx: 2.4, sy: 0.6 }); }
      else if (kind === 'tins') { for (let t = 0; t < 2; t++) B.cyl(NS('paint'), ['#b8483e', '#3f5f86', '#cf9a3c', '#3f7a5a'][(i + t) & 3], 0.05, 0.12, gx, y + 0.08 + t * 0.12, -0.1, { seg: 7 }); }
      else if (kind === 'cups') { B.lathe(NS('gloss'), K.frame, [[0, 0], [0.05, 0], [0.06, 0.08], [0, 0.08]], gx, y + 0.02, -0.1, { seg: 7 }); B.sph(NS('paint'), '#c9a47a', 0.08, gx, y + 0.38, -0.1, { ws: 5, hs: 3, sy: 0.5 }); }
      else if (kind === 'wine') { B.cyl(NS('gloss'), k > 0.5 ? '#2f4a30' : '#5b2230', 0.04, 0.26, gx, y + 0.15, -0.1, { seg: 7 }); }
      else if (kind === 'books') { pbox(B, NS('paint'), ['#7a3a4c', '#3f5f86', '#cf9a3c', '#3f7a5a'][i & 3], 0.18, 0.26, 0.14, gx, y + 0.15, -0.1, { rz: (k - 0.5) * 0.3 }); }
    }
  }
  // projecting bracket sign: scrolled iron bracket from the wall at y, hanging a double-sided emblem / board
  // 【悬挑招牌】墙上 y 处伸出卷草铁支架,下挂双面徽标/招牌:kind 决定徽标形状(pretzel/fish/key/cup/flower/
  //   barber 或默认文字板 o.text);徽标在局部空间绘制,末尾统一 pop。
  function bracketSign(B, x, y, kind, o = {}) {
    const ic = K.iron, reach = 0.95;
    B.box('metal', ic, 0.16, 0.32, 0.04, x, y, 0.02, { r: 0.01 });
    rod(B, 'metal', ic, P3(x, y + 0.1, 0.03), P3(x, y + 0.1, reach), 0.022);
    B.tube(NS('metal'), ic, arcPts(x, y + 0.1 - 0.28, 0.32, 0.28, 0, HP, 6, 'yz').map(([a, b, c]) => P3(a, b, c)), 0.013, { radial: 4 });
    B.tor(NS('metal'), ic, 0.08, 0.01, x, y + 0.02, reach - 0.2, { rs: 4, ts: 10, ry: HP, arc: PI * 1.6 });
    B.sph(NS('metal'), K.gold, 0.035, x, y + 0.1, reach + 0.02, { ws: 6, hs: 5 });
    const hx = x, hy = y - 0.35, hz = reach - 0.35;
    for (const dz of [-0.2, 0.2]) rod(B, NS('metal'), ic, P3(hx, y + 0.08, hz + dz), P3(hx, hy + 0.3, hz + dz), 0.006, 3);
    B.push(hx, hy, hz, HP);
    if (kind === 'pretzel') {
      for (const [ax, rot] of [[-0.1, 0.4], [0.1, -0.4]]) B.tor('gloss', K.gold, 0.15, 0.035, ax, 0, 0, { rs: 6, ts: 16, rz: rot });
      B.tor('gloss', K.gold, 0.22, 0.035, 0, -0.02, 0, { rs: 6, ts: 18, arc: PI, rz: PI });
    } else if (kind === 'fish') {
      B.lathe('gloss', '#9fb3bb', [[0, -0.34], [0.08, -0.25], [0.13, -0.05], [0.12, 0.12], [0.06, 0.26], [0, 0.3]], 0, 0, 0, { seg: 10, rz: HP, sz: 0.4 });
      B.add('gloss', tpl('fishtail', () => extrudeGeo([[-0.16, 0], [0.16, 0], [0, 0.2]], 0.03, 0.002)), '#9fb3bb', -0.38, 0, 0, { ry: HP, rx: -HP, rz: 0 });
      B.sph(NS('gloss'), K.black, 0.025, 0.24, 0.04, 0.05, { ws: 6, hs: 4 });
    } else if (kind === 'key') {
      B.tor('gloss', K.gold, 0.12, 0.03, -0.24, 0, 0, { rs: 6, ts: 14 });
      B.cyl('gloss', K.gold, 0.03, 0.45, 0.1, 0, 0, { rz: HP, seg: 8 });
      pbox(B, 'gloss', K.gold, 0.06, 0.14, 0.05, 0.28, -0.07, 0); pbox(B, 'gloss', K.gold, 0.05, 0.1, 0.05, 0.18, -0.06, 0);
    } else if (kind === 'cup') {
      B.lathe('gloss', K.frame, [[0, -0.15], [0.14, -0.15], [0.18, 0.15], [0, 0.15]], 0, 0, 0, { seg: 12 });
      B.tor('gloss', K.frame, 0.08, 0.025, 0.2, 0, 0, { rs: 5, ts: 10 });
      B.cyl('gloss', K.frame, 0.26, 0.03, 0, -0.17, 0, { seg: 12 });
      for (const dx of [-0.05, 0.05]) B.tube(NS('paint'), '#f2ece0', [P3(dx, 0.2, 0), P3(dx + 0.04, 0.3, 0), P3(dx, 0.4, 0)], 0.012, { radial: 3 });
    } else if (kind === 'flower') {
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; B.sph('paint', '#e87a8c', 0.1, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0, { ws: 8, hs: 5, sz: 0.4 }); }
      B.sph('paint', '#f2d15a', 0.08, 0, 0, 0.02, { ws: 8, hs: 5, sz: 0.5 });
    } else if (kind === 'barber') {
      B.cyl('gloss', K.frame, 0.09, 0.6, 0, 0, 0, { seg: 12 });
      for (let i = 0; i < 4; i++) { B.push(0, -0.22 + i * 0.15, 0, i * 0.5); B.tor('paint', '#b8483e', 0.092, 0.018, 0, 0, 0, { rs: 4, ts: 12, rx: HP + 0.35 }); B.pop(); }
      for (const yy of [-0.33, 0.33]) B.sph('metal', K.gold, 0.1, 0, yy, 0, { ws: 10, hs: 6, sy: 0.5 });
    } else {
      // board sign with a name either side
      const W = o.w ?? 0.9, Hh = o.hb ?? 0.55;
      B.box('gloss', o.board ?? K.iron, W, Hh, 0.05, 0, 0, 0, { r: 0.02 });
      for (const f of [1, -1]) {
        B.push(0, 0, f * 0.026, f > 0 ? 0 : PI);
        B.box('paint', K.gold, W - 0.06, Hh - 0.06, 0.004, 0, 0, 0, { r: 0.01 });
        B.box('gloss', o.board ?? K.iron, W - 0.1, Hh - 0.1, 0.006, 0, 0, 0.002, { r: 0.01 });
        letters(B, o.text ?? 'INN', { h: Math.min(0.24, (W - 0.2) / textW(o.text ?? 'INN')), x: 0, y: -0.1, z: 0.006, c: K.gold, flat: true, wt: 0.2 });
        B.pop();
      }
    }
    B.pop();
  }
  // cast-iron wall lantern on a scroll bracket (wall z = 0)
  // 【壁灯】卷草支架上的铸铁壁灯:灯罩(metal)+ 自发光灯芯(glow)+ 底盖。
  function wallLantern(B, x, y) {
    B.box('metal', K.black, 0.1, 0.22, 0.03, x, y, 0.015, { r: 0.01 });
    B.tube(NS('metal'), K.black, [P3(x, y + 0.05, 0.02), P3(x, y + 0.12, 0.2), P3(x, y + 0.05, 0.34)], 0.014, { radial: 4 });
    const lx = x, ly = y - 0.18, lz = 0.34;
    B.lathe('metal', K.black, [[0, 0.24], [0.05, 0.23], [0.12, 0.14], [0.13, 0.12], [0.09, 0.12]], lx, ly, lz, { seg: 6 });
    B.lathe(NS('glow'), K.lit, [[0.001, -0.02], [0.08, 0.0], [0.1, 0.12], [0.001, 0.12]], lx, ly, lz, { seg: 6, glow: 1.6 });
    B.lathe('metal', K.black, [[0, -0.08], [0.05, -0.07], [0.09, -0.02], [0, -0.02]], lx, ly, lz, { seg: 6 });
  }

  // vintage bill poster (faces +Z, centred at x, y, z; w × h): paper, a coloured field, a headline, an emblem and
  // rows of small print as bars. kinds: circus, opera, tram, soap, herring, market, regatta, cocoa
  // 【海报配色表】每种 bill 的 [bg 底色, fg 前景/字色, word 标题词, em 图案] 四元组;em 取 star/ring/fish/bar。
  const BILLS = {
    circus: ['#b8483e', '#f1e3c4', 'CIRCUS', 'star'], opera: ['#23304a', '#d9b25a', 'OPERA', 'ring'], tram: ['#3f6b55', '#efe6d2', 'TRAMS', 'bar'],
    soap: ['#e0b04a', '#7a3a4c', 'SOAP', 'ring'], herring: ['#3f5f86', '#efe6d2', 'HERRING', 'fish'], market: ['#efe6d2', '#b8483e', 'MARKET', 'star'],
    regatta: ['#f1e3c4', '#23304a', 'REGATTA', 'bar'], cocoa: ['#6a3f2a', '#f1e3c4', 'COCOA', 'ring'],
  };
  // 【海报】朝 +Z 贴一张复古戏报(纸底 + 色块 + 标题字 + 图案 + 若干小字条),居中于 (x,y,z),尺寸 w×h。
  function bill(B, x, y, z, w, h, kind = 'circus', o = {}) {
    const [bg, fg, word, em] = BILLS[kind] ?? BILLS.circus;
    B.push(x, y, z, 0, 0, o.rz ?? 0);
    pbox(B, NS('paint'), '#efe9da', w, h, 0.004, 0, 0, 0.002);
    pbox(B, NS('paint'), bg, w - 0.05, h - 0.05, 0.004, 0, 0, 0.004);
    const th = Math.min(h * 0.16, (w - 0.1) / textW(word, 0.2, 0.08));
    letters(B, word, { h: th, x: 0, y: h * 0.3 - th / 2, z: 0.0065, c: fg, flat: true, wt: 0.2, track: 0.08 });
    if (em === 'star') for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; B.box(NS('paint'), fg, 0.035, h * 0.16, 0.002, Math.sin(a) * h * 0.05, -h * 0.02 + Math.cos(a) * h * 0.05, 0.0065, { rz: -a, r: 0.001 }); }
    else if (em === 'ring') { B.tor(NS('paint'), fg, h * 0.09, 0.012, 0, -h * 0.02, 0.0065, { rs: 3, ts: 14 }); }
    else if (em === 'fish') B.sph(NS('paint'), fg, h * 0.06, 0, -h * 0.02, 0.0065, { ws: 8, hs: 4, sx: 2.2, sz: 0.1 });
    else pbox(B, NS('paint'), fg, w * 0.6, h * 0.08, 0.002, 0, -h * 0.02, 0.0065);
    for (let i = 0; i < 3; i++) pbox(B, NS('paint'), fg, w * (0.66 - i * 0.12), h * 0.028, 0.002, 0, -h * (0.2 + i * 0.075), 0.0065);
    B.pop();
  }

  // ------------------------------------------------------------------------------------------ facade + roof
  // 【立面 + 屋顶】facade 只画"一个墙面"(居中 x=0),由 buildings.js 逐面摆放;roof 盖屋顶。
  // One wall face of a building: `len` long (centred on x = 0), eave height h. Spec:
  //   style 'ashlar' | 'render' | 'brick'   wall / trim colours: wall, trim (surrounds, bands, cornice)
  //   bays (window bays), floors (window storey levels, default FL, FL+2.7 …), shut (shutter colour), frame
  //   balc 'first' | 'all' | [bay indices] (iron balconettes + French windows on the first floor)
  //   shops [{ x0, x1, name, fascia, awn: [cA, cB] | rolled, door, goods, sign: 'pretzel' | 'fish' | … }]
  //   door [x, w] (a house door), gskip / uskip: x ranges kept bare on the ground / upper floors, cornice, quoins
  // 【立面装配器】规格 s 字段:style 石/抹灰/砖、wall/trim 配色、bays 开间数、floors 各层窗标高(默认从 FL
  //   每 2.7 m 一层)、shut 百叶色、balc 哪层设阳台、shops 店面数组、door 大门、gskip/uskip 底层/上层留空区、
  //   cornice/quoins 檐口/隅石、plaque 街名牌。所有窗/店都复用上面的零件函数。
  function facade(B, len, s, seed) {
    const h = s.h, style = s.style ?? 'ashlar', trim = s.trim ?? (style === 'render' ? K.stoneLt : K.stone);
    const rnd = (k) => hash(seed * 13.1 + k * 7.7);
    const bays = s.bays ?? Math.max(1, Math.round(len / 2.4));
    const levels = s.floors ?? (() => { const L = []; for (let y = FL; y + 2.2 < h; y += 2.7) L.push(y); return L; })();
    const inSkip = (x, ranges) => (ranges || []).some(([a, b]) => x > a - 0.6 && x < b + 0.6);
    const surK = style === 'brick' ? 'brick' : style === 'render' ? (s.sur ?? 'paint') : 'stone';
    // string course at every floor level + plinth
    for (const y of levels) if (!(s.noBand)) pbox(B, NS('paint'), trim, len, 0.16, 0.07, 0, y - 0.02, 0.035);
    if (s.plinth !== false && !s.noGround) pbox(B, NS('paint'), shade(trim, 0.86), len, 0.32, 0.05, 0, 0.16, 0.025);
    // cornice / eaves course
    if (s.cornice !== 'none') {
      const cy = h - 0.02;
      B.box('paint', trim, len + 0.1, 0.18, 0.3, 0, cy - 0.09, 0.14, { r: 0.03 });
      pbox(B, NS('paint'), shade(trim, 0.9), len + 0.04, 0.12, 0.2, 0, cy - 0.24, 0.1);
      pbox(B, NS('paint'), shade(trim, 0.95), len, 0.08, 0.12, 0, cy - 0.34, 0.06);
      if (s.cornice === 'dentil') for (let x = -len / 2 + 0.15; x < len / 2 - 0.1; x += 0.22) pbox(B, NS('paint'), trim, 0.1, 0.1, 0.1, x, cy - 0.44, 0.05);
      if (s.parapet) { B.box('paint', s.wall ?? trim, len, s.parapet, 0.3, 0, h + s.parapet / 2, 0.0 - 0.15, { r: 0.03 }); B.box('paint', trim, len + 0.06, 0.08, 0.36, 0, h + s.parapet + 0.04, -0.15, { r: 0.02 }); }
    }
    // quoins at the corners
    if (s.quoins) for (const sx of [-1, 1]) for (let y = 0.35, i = 0; y < h - 0.5; y += 0.36, i++) {
      const w = i % 2 ? 0.34 : 0.52;
      pbox(B, NS('paint'), s.quoinC ?? trim, w, 0.32, 0.04, sx * (len / 2 - w / 2 + 0.02), y + 0.16, 0.02);
    }
    // upper windows
    levels.forEach((y, fi) => {
      for (let b = 0; b < bays; b++) {
        const x = -len / 2 + ((b + 0.5) * len) / bays;
        if (inSkip(x, s.uskip)) continue;
        const first = fi === 0, balc = first && (s.balc === 'first' || s.balc === 'all' || (Array.isArray(s.balc) && s.balc.includes(b)));
        const fr = first && s.french;                          // French doors straight onto a terrace / the veranda
        const ww = s.winW ?? (len / bays > 2.0 ? 1.0 : 0.85), wh = balc || fr ? 1.95 : first ? 1.65 : 1.45;
        const wy = balc || fr ? y + 0.04 : y + 0.55;
        const lit = rnd(fi * 17 + b) < (s.lit ?? 0.28) ? 0.75 : 0;
        win(B, x, wy, ww, wh, { sur: surK, surC: trim, frame: s.frame ?? K.frame, shut: s.shut, key: style === 'ashlar' && !first, hood: style === 'ashlar' && first ? (b % 2 ? 'cornice' : 'pediment') : null, door: balc || fr, lit, curtain: !lit && rnd(fi * 5 + b + 9) < 0.5 ? (s.curtain ?? '#e9dfcc') : null, box: !balc && first && s.boxes && rnd(b + 3) < 0.7 ? true : null, archC: s.archC });
        if (balc && !fr) balconette(B, x, y, ww, { pots: rnd(b + 11) < 0.6, iron: s.iron });
      }
    });
    // ground floor: shops, a house door, plain windows
    for (const sp of s.shops || []) shopfront(B, sp.x0, sp.x1, sp);
    for (const sp of s.shops || []) if (sp.sign) bracketSign(B, sp.signX ?? (sp.door === 'l' ? sp.x1 - 0.35 : sp.x0 + 0.35), 3.05, sp.sign, sp);
    if (s.door) frontDoor(B, s.door[0], s.door[1] ?? 1.1, 2.25, { door: s.doorC ?? K.iron, surC: trim });
    if (s.gwin) for (const x of s.gwin) win(B, x, 0.75, 0.95, 1.4, { sur: surK, surC: trim, frame: s.frame ?? K.frame, shut: s.gshut ?? null, bars: 1, archC: s.archC });
    if (s.lanterns) for (const x of s.lanterns) wallLantern(B, x, 2.3);
    // drainpipe at one end
    if (s.pipe !== false) {
      const px = (rnd(3) < 0.5 ? -1 : 1) * (len / 2 - 0.25), pc = s.pipeC ?? K.gutter;
      B.cyl(NS('paint'), pc, 0.045, h - 0.3, px, (h - 0.3) / 2 + 0.1, 0.07, { seg: 7 });
      pbox(B, NS('paint'), pc, 0.16, 0.16, 0.14, px, h - 0.45, 0.07);
      B.cyl(NS('paint'), pc, 0.055, 0.16, px, 0.1, 0.12, { rx: 0.95, seg: 7 });
      for (let y = 0.9; y < h - 0.6; y += 1.6) pbox(B, NS('metal'), K.black, 0.12, 0.03, 0.09, px, y, 0.04);
    }
    if (s.plaque) streetPlaque(B, s.plaque[0], s.plaque[1], s.plaque[2]);
  }
  // enamel street-name plaque (white on blue), wall z = 0
  // 【街名牌】搪瓷蓝底白字街名牌,贴墙 z=0;宽度按字宽自适应。
  function streetPlaque(B, x, y, text) {
    const W = textW(text, 0.2, 0.1) * 0.13 + 0.22;
    B.box('gloss', '#f2eee6', W, 0.26, 0.02, x, y, 0.01, { r: 0.02 });
    B.box('gloss', '#2f4a78', W - 0.04, 0.22, 0.004, x, y, 0.021, { r: 0.015 });
    letters(B, text, { h: 0.13, x, y: y - 0.065, z: 0.024, c: '#f2eee6', flat: true, wt: 0.2, track: 0.1 });
  }

  // one roof slope: courses of tiles / slates as a sawtooth (each course a tilted face + a small drip step), from the
  // eave (u = 0) to the ridge (u = L) in local -Z, lifted along +Y; half-width at the eave hw0 and at the top hw1
  // (hips taper); a flat underside; per-course tone jitter. Cached.
  // 【单坡屋面几何】把瓦/石板做成锯齿:每皮一个斜面 + 一个滴水踏步,从檐(u=0)到脊(u=L,局部 -Z 方向),
  //   沿 +Y 抬升;檐半宽 hw0、脊半宽 hw1(四坡时收窄成尖);带平底。逐皮色调抖动。按参数缓存。
  function slopeGeo(L, hw0, hw1, course, cc, seed) {
    return tpl(['slope', L, hw0, hw1, course, cc, seed].map(kf).join('|'), () => {
      const g = new GB(), n = Math.max(2, Math.round(L / course)), step = L / n, lift = 0.035, base = cx3(cc);
      for (let i = 0; i < n; i++) {
        const u0 = i * step, u1 = u0 + step, t0 = u0 / L, t1 = u1 / L;
        const w0 = hw0 + (hw1 - hw0) * t0, w1 = hw0 + (hw1 - hw0) * t1;
        const k = 0.9 + 0.16 * hash(i * 3.7 + seed), c = base.map((v) => v * k), cd = base.map((v) => v * k * 0.62);
        const tl = Math.atan2(lift, step), ny = Math.cos(tl), nz = Math.sin(tl);
        // tile face: from (u0, lift) down to (u1, 0) — the lower edge of each course stands proud
        const a = g.v(-w0, lift, -u0, 0, ny, nz, ...c), b = g.v(w0, lift, -u0, 0, ny, nz, ...c), d = g.v(w1, 0, -u1, 0, ny, nz, ...c), e = g.v(-w1, 0, -u1, 0, ny, nz, ...c);
        g.quad(a, b, d, e);
        // drip step at the course's lower edge (faces down the slope)
        if (i > 0) { const f = g.v(-w0, 0, -u0, 0, 0, 1, ...cd), h2 = g.v(w0, 0, -u0, 0, 0, 1, ...cd), a2 = g.v(-w0, lift, -u0, 0, 0, 1, ...cd), b2 = g.v(w0, lift, -u0, 0, 0, 1, ...cd); g.quad(f, h2, b2, a2); }
      }
      // underside + eave edge
      const cu = base.map((v) => v * 0.55);
      const p = [g.v(-hw0, -0.06, 0, 0, -1, 0, ...cu), g.v(hw0, -0.06, 0, 0, -1, 0, ...cu), g.v(hw1, -0.06, -L, 0, -1, 0, ...cu), g.v(-hw1, -0.06, -L, 0, -1, 0, ...cu)];
      g.quad(p[0], p[1], p[2], p[3]);
      const q = [g.v(-hw0, -0.06, 0, 0, 0, 1, ...cu), g.v(hw0, -0.06, 0, 0, 0, 1, ...cu), g.v(hw0, lift, 0, 0, 0, 1, ...cu), g.v(-hw0, lift, 0, 0, 0, 1, ...cu)];
      g.quad(q[0], q[1], q[2], q[3]);
      return g.geo();
    });
  }
  // pitched roof over w (X) × d (Z) at y = 0: 'gable' (ridge along X, gable ends in the wall colour), 'hip', 'mansard'
  // (steep lower slopes with dormers + a shallow top), 'flat' (lead roof + parapet kit). Chimneys, dormers, skylights.
  // 【屋顶】在 w(X)×d(Z)、y=0 处盖屋顶:kind 取 gable 双坡(脊沿 X,山墙用墙色)/ hip 四坡 / mansard 折线坡
  //   (陡下坡+老虎窗+缓顶)/ flat 平屋顶(铅皮+女儿墙)。r 还可指定 chimneys 烟囱、dormers 老虎窗、skylights
  //   天窗、ov 出檐、pitch 坡度、c 瓦色、seed 随机种。
  function roof(B, w, d, r) {
    const kind = r.kind ?? 'gable', pitch = r.pitch ?? 0.62, ov = r.ov ?? 0.25, cc = r.c ?? K.slate, course = cc === K.tile || r.tiles ? 0.24 : 0.3;
    const seed = r.seed ?? 1;
    if (kind === 'flat') {
      pbox(B, 'paint', K.lead, w - 0.2, 0.08, d - 0.2, 0, 0.04, 0);
      for (const [x, z] of r.vents || []) { B.box('metal', K.zinc, 0.5, 0.4, 0.5, x, 0.2, z, { r: 0.03 }); B.box('metal', K.zinc, 0.62, 0.05, 0.62, x, 0.43, z, { r: 0.01 }); }
    } else if (kind === 'mansard') {
      const lo = 1.35, a1 = 1.2, inset = lo / Math.tan(a1), a2 = 0.3, ww = w / 2 - inset, dd = d / 2 - inset, hr = Math.min(ww, dd) * Math.tan(a2);
      for (const [ry, hw, dz] of [[0, w / 2 + ov * 0.4, d / 2 + ov * 0.4], [PI, w / 2 + ov * 0.4, d / 2 + ov * 0.4], [HP, d / 2 + ov * 0.4, w / 2 + ov * 0.4], [-HP, d / 2 + ov * 0.4, w / 2 + ov * 0.4]]) {
        const L1 = Math.hypot(lo, inset + ov * 0.4);
        B.push(0, 0, 0, ry); B.add('paint', slopeGeo(L1, hw, hw - inset - ov * 0.4, 0.26, cc, seed), 'white', 0, -0.05, dz, { rx: a1 }); B.pop();
        const hw2 = ry === 0 || ry === PI ? ww : dd, dz2 = ry === 0 || ry === PI ? dd : ww, L2 = Math.hypot(hr, Math.min(ww, dd));
        B.push(0, lo - 0.03, 0, ry); B.add('paint', slopeGeo(L2, hw2, Math.abs(ww - dd), 0.3, shade(cc, 0.95), seed + 3), 'white', 0, 0, dz2, { rx: a2 }); B.pop();
      }
      B.box('metal', K.zinc, w + ov * 0.8 + 0.06, 0.08, 0.1, 0, lo + 0.02, d / 2 - inset + 0.02, { r: 0.02 });
      for (const s of [-1, 1]) B.box('metal', K.zinc, 0.1, 0.08, d - 2 * inset + 0.1, s * (w / 2 - inset), lo + 0.02, 0, { r: 0.02 });
      B.box('metal', K.zinc, w + ov * 0.8 + 0.06, 0.08, 0.1, 0, lo + 0.02, -(d / 2 - inset) - 0.02, { r: 0.02 });
      // dormers on the long faces
      for (const s of r.dormerSides ?? [1, -1]) for (let i = 0; i < (r.dormers ?? Math.max(1, Math.round(w / 3.2))); i++) {
        const n = r.dormers ?? Math.max(1, Math.round(w / 3.2)), x = -w / 2 + ((i + 0.5) * w) / n;
        B.push(x, 0, s * (d / 2 - inset * 0.55), s > 0 ? 0 : PI);
        dormer(B, 0.9, 1.05, cc, r.dormerC ?? K.stoneLt, 'round');
        B.pop();
      }
    } else {
      const hip = kind === 'hip', hw = w / 2 + ov, rise = (d / 2) * Math.tan(pitch), L = Math.hypot(d / 2 + ov, (d / 2 + ov) * Math.tan(pitch));
      const hipIn = hip ? Math.min(d / 2, w / 2) : 0;
      for (const s of [1, -1]) {
        B.push(0, 0, 0, s > 0 ? 0 : PI);
        B.add('paint', slopeGeo(L, hw, hw - (hip ? hipIn + ov : 0), course, cc, seed + (s > 0 ? 0 : 5)), 'white', 0, -ov * Math.tan(pitch), d / 2 + ov, { rx: pitch });
        B.pop();
      }
      if (hip) {
        const Lh = Math.hypot(w / 2 - (w / 2 - hipIn) + ov, (hipIn + ov) * Math.tan(pitch));
        for (const s of [1, -1]) {
          B.push(0, 0, 0, s > 0 ? HP : -HP);
          B.add('paint', slopeGeo(Math.hypot(hipIn + ov, (hipIn + ov) * Math.tan(pitch)), d / 2 + ov, 0.02, course, cc, seed + 9), 'white', 0, -ov * Math.tan(pitch), w / 2 + ov, { rx: pitch });
          B.pop();
        }
        void Lh;
        const rl = w - 2 * hipIn;
        if (rl > 0.05) B.box('paint', shade(cc, 0.8), rl + 0.1, 0.12, 0.16, 0, rise + 0.02, 0, { r: 0.04 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const a = P3(sx * (rl / 2), rise + 0.02, 0), b = P3(sx * (w / 2 + ov * 0.7), -ov * 0.7 * Math.tan(pitch) + 0.02, sz * (d / 2 + ov * 0.7));
          B.tube('paint', shade(cc, 0.8), [a, b], 0.06, { radial: 4 });
        }
      } else {
        // gable prism in the wall colour, bargeboards, ridge
        B.add('paint', tpl(['gprism', d, rise].map(kf).join('|'), () => extrudeGeo([[-d / 2, 0], [d / 2, 0], [0, rise]], 1, 0.001)), r.wall ?? K.stone, 0, 0, 0, { sx: w - 0.02 });
        const Lb = Math.hypot(d / 2 + ov, (d / 2 + ov) * Math.tan(pitch));
        for (const sx of [-1, 1]) for (const s of [-1, 1]) {
          B.push(sx * (w / 2 + ov - 0.04), (rise - ov * Math.tan(pitch)) / 2 + 0.07, s * (d / 2 + ov) / 2, 0, s * pitch);
          B.box('paint', r.barge ?? K.frame, 0.08, 0.22, Lb + 0.04, 0, 0, 0, { r: 0.02 });
          B.pop();
        }
        B.box('paint', shade(cc, 0.8), w + ov * 2 + 0.06, 0.12, 0.18, 0, rise + 0.03, 0, { r: 0.04 });
      }
      // gutters along the eaves
      for (const s of [1, -1]) B.cyl(NS('metal'), K.gutter, 0.06, w + (hip ? ov * 2 : ov * 2), 0, -ov * Math.tan(pitch) - 0.07, s * (d / 2 + ov + 0.02), { rz: HP, seg: 6 });
      for (const [x, s, n] of r.dormers || []) {
        const u = 0.45, zz = s * (d / 2 - (d / 2) * u), yy = (d / 2) * u * Math.tan(pitch);
        B.push(x, yy - 0.2, zz, s > 0 ? 0 : PI); dormer(B, 0.85, 1.0, cc, r.dormerC ?? K.frame, n ?? 'gable'); B.pop();
      }
      for (const [x, s] of r.skylights || []) {
        B.push(x, 0, 0, s > 0 ? 0 : PI);
        B.push(0, (d / 4) * Math.tan(pitch) + 0.07, d / 4, 0, pitch);
        pbox(B, 'metal', K.gutter, 0.8, 0.06, 0.95, 0, 0, 0); pbox(B, NS('gloss'), K.glassLt, 0.7, 0.02, 0.85, 0, 0.035, 0);
        B.pop(); B.pop();
      }
    }
    // chimneys: stack, cap, pots
    for (const [x, z, n] of r.chimneys || []) {
      const top = (kind === 'mansard' ? 1.9 : (Math.max(0.3, d / 2 - Math.abs(z))) * Math.tan(pitch)) + 1.1;
      B.box('paint', r.chimC ?? K.chim, 0.62 + (n ?? 2) * 0.12, top + 0.4, 0.62, x, (top + 0.4) / 2 - 0.4, z, { r: 0.03 });
      B.box('paint', K.stone, 0.76 + (n ?? 2) * 0.12, 0.12, 0.76, x, top + 0.02, z, { r: 0.02 });
      for (let i = 0; i < (n ?? 2); i++) B.lathe('paint', K.pot, [[0.1, 0], [0.11, 0.08], [0.085, 0.1], [0.085, 0.3], [0.1, 0.33], [0.1, 0.36], [0.07, 0.36], [0.07, 0.33]], x - ((n ?? 2) - 1) * 0.12 + i * 0.24, top + 0.08, z, { seg: 8 });
    }
  }
  // roof dormer facing +Z: cheeks, a small gable (or round-topped) roof, a window
  // 【老虎窗】朝 +Z 的屋顶老虎窗:侧颊、小双坡(或圆顶)屋面、一扇窗。
  function dormer(B, w, h, cc, fc, kind = 'gable') {
    B.box('paint', fc, w + 0.2, h, 0.9, 0, h / 2, -0.35, { r: 0.03 });
    pbox(B, NS('gloss'), K.glass, w - 0.18, h - 0.25, 0.02, 0, h / 2 - 0.02, 0.105);
    pbox(B, NS('paint'), K.frame, 0.035, h - 0.25, 0.03, 0, h / 2 - 0.02, 0.115);
    pbox(B, NS('paint'), K.frame, w - 0.18, 0.035, 0.03, 0, h / 2 + 0.05, 0.115);
    if (kind === 'round') B.cyl('paint', shade(cc, 0.95), (w + 0.34) / 2, 1.0, 0, h, -0.35, { rx: HP, seg: 12, sy: 1, sz: 0.55 });
    else for (const s of [-1, 1]) { B.push(s * (w + 0.3) / 4, h + 0.2, -0.35, 0, 0, -s * 0.72); B.box('paint', cc, (w + 0.4) / 2 / Math.cos(0.72) + 0.06, 0.08, 1.0, 0, 0, 0, { r: 0.02 }); B.pop(); }
  }


  // 【返回套件对象】props.js 拿到后挂到 KIT 上,供各构建器共享:调色板 K、常量 FL、几何/碰撞助手、
  //   字体、以及全部建筑零件函数与 BILLS 配色表。
  return { THREE, col, shade, mixc, latheGeo, tubeGeo, extrudeGeo, arcPts, PI, TAU, HP, P3, NS, K, FL, GB, tpl, kf, hash, cx3, pbox, colBox, rod, sub,
    colT, RAIL, rakedRail, letters, textW, glyph, awning, awningGeo, win, flowerBox, balconette, frontDoor, fascia, shopfront, goodsShelf, bracketSign, wallLantern, facade,
    streetPlaque, roof, dormer, slopeGeo, blob, bill, BILLS };
}
