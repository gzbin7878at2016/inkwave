// Halyard Marina — dock / shore prop pack (owner: docks stream). Pilings, cleats, fenders, fuel pumps, dock boxes,
// clubhouse + quay furniture, boatyard kit, the harbour beacon. Registered into the PropKit by props.js; placements go
// in DRESSING.halyard (src/world/dressing.js).
//
// Conventions follow props.js: metres, Y up, `pos` = base point, rotY turns local +Z (the "front"). Wall-mounted pieces
// treat local z = 0 as the wall / slab face and project toward +Z. Pier-edge runs start at `pos` on the deck edge
// (deck top y = 0), run along local +X for `length`, and the water is on local +Z (sea surface y = -1.6).
//
// Signage uses 3D channel letters from a small stroke font (below): bevelled, lit by the sun, cached per glyph.

// ============================ 中文导读 ============================
// 【文件性质】Halyard Marina(帆船码头)码头/岸侧道具包,marina 系列外挂包之一,由 props.js 注册进 PropKit;
//   具体摆放数据在 DRESSING.halyard(src/world/dressing.js)。机制详见 docs/ASSETS-WEAPONS.zh-CN.md §5.2。
// 【注册内容】码头沿口(桩柱/护舷木/碰垫/泳梯)、加油机、储物箱、泵出/供水站、船台垫木、码头板条箱、
//   燃料小屋、FUEL DOCK 高杆招牌、游艇会、船屋、港口办公室、咖啡座、导览图、皮划艇架、岸电桩、
//   系船柱灯、船台吊车、盖布船、脚手架、工作台、港口灯塔、防波堤、航道标、栈桥栏杆、大台阶栏杆等。
// 【坐标约定】米制,Y 向上,pos = 道具基点,rotY 绕局部 +Z("正面")旋转;墙面件以局部 z=0 为墙面并朝 +Z 凸出;
//   码头沿口件从甲板边 pos 出发,沿局部 +X 延伸 length,水在局部 +Z(海平面 y = -1.6,常量 WATER)。
// 【构建体系】全部由几何原语(chamferBox / lathe / tube / extrude + 本文件自建的 GB 微型构建器)程序化生成,
//   无外部模型与贴图;招牌文字用自研描边字体挤出成 3D 槽型字,可按字形缓存、可发光(lit)。
// 【碰撞约定】B.col 注册 AABB 碰撞盒:默认实体盒;{ rail: true } 只挡人(子弹/墨/鱿鱼可穿,也没人站上);
//   { roof: true } 为禁入顶面(站上去会滑走)。与关卡面采样/导航避让相关的工程要点在各函数处均有中文注释。
// 【性能要点】NS(mat) 无阴影材质别名(见下方说明);tpl() 按参数键缓存几何体;微小零件一律用 pbox 单位盒缩放。

export function registerMarinaDock(D, H) {
  const { THREE, col, shade, mixc, chamferBox, latheGeo, tubeGeo, extrudeGeo, rcylProf, flangeProf, arcPts, woodCrate, drum, pallet, rod, wheel, TIRE, LIFERING, PI, TAU, HP, P3 } = H;

  // ------------------------------------------------------------------------------------------ local palette
  // muted, weathered marina tones (the team inks stay the loudest thing on screen)
  // 【调色板 K】低饱和的风化码头色调——刻意压暗,保证画面上最抢眼的是各队墨弹颜色
  const K = {
    tar: '#2e2a27', pile: '#8b7a67', pileLt: '#a3927b', endgrain: '#b9a684', whaler: '#86745f', whalerDk: '#6f5f4e',
    mussel: '#262b35', weed: '#56683b', rope: '#cdb894', ropeDk: '#a88f68', ropeBlue: '#3f5a7a',
    fender: '#25272c', stainless: '#c9d0d6', galv: '#b7bec4', galvDk: '#8d959c',
    fuelBlue: '#2f5f9e', fuelBlueDk: '#24497a', fuelRed: '#c6503f', fuelYel: '#e8b64a', club: '#23385c', clubGold: '#caa251',
    glass: '#34495a', glassLt: '#4f6a7c', frame: '#e9e4d9', frameDk: '#56606b', render: '#efe8da', cladding: '#8fb8b4',
    concrete: '#cfc8bb', concreteDk: '#a9a295', rock: '#8e8a82', rockDk: '#6d6a64', rockLt: '#aba69b',
    liftBlue: '#2d5f9a', liftYel: '#e3b23c', tarp: '#3d6b8f', tarpDk: '#2f5675', hull: '#eeeae2', antifoul: '#a8483c',
    red: '#c9453b', green: '#3d8a5a', white: '#f2eee6', lamp: '#ffe2a8', led: '#ff5a3c', ledG: '#63e08a',
  };

  // 【无阴影别名 NS】看不到自身阴影的部分(甲板下桩段、水线附着物、螺栓、扁平字母、贴墙饰条、远景)
  // 一律走无阴影材质:优先用套件的 H.noShadow 钩子;否则退回同材质 '<mat>_ns' 别名桶——与同名桶合并渲染,
  // 仅跳过投影 pass。glow/blob 桶与已是别名的材质直接原样返回。无头套件保持原桶即可。
  // Parts whose shadow can't be seen (sub-deck piles, waterline growth, bolts, flat lettering, trims flush on a wall,
  // distant scenery) go through NS(mat): the kit's no-shadow hook when it offers one (H.noShadow), otherwise the same
  // `<mat>_ns` alias bucket the vessels pack uses (the kit decides castShadow per bucket key; an alias of the same
  // material merges like any bucket but skips the shadow pass). Headless kits keep the plain key.
  const before = new Set(Object.keys(D));
  let curB = null;
  const NS = (m) => {
    if (H.noShadow) return H.noShadow(m);
    const mats = curB && curB.k && curB.k.mat;
    if (!mats || m === 'glow' || m === 'blob' || m.endsWith('_ns')) return m;
    const k2 = m + '_ns';
    if (!mats[k2] && mats[m]) mats[k2] = mats[m];
    return mats[k2] ? k2 : m;
  };

  // ------------------------------------------------------------------------------------------ geometry helpers
  // 【几何助手区】
  // tiny builder (same contract as props.js GB: triangles auto-orient to the supplied outward normals)
  // 【微型构建器 GB】契约同 props.js:顶点自带法线/顶点色/uv,tri() 按外法线方向自动确定三角形绕向
  class GB {
    constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; }
    v(x, y, z, nx, ny, nz, r = 1, g = r, b = r) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(0, 0); this.c.push(r, g, b); return this.p.length / 3 - 1; }
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
  // 【几何模板缓存】按参数键缓存几何体,全场景同类小件只构建一次(tpl)
  const TPL = new Map();
  const tpl = (key, fn) => { let g = TPL.get(key); if (!g) { g = fn(); TPL.set(key, g); } return g; };
  const kf = (a) => (typeof a === 'number' ? a.toFixed(4) : String(a));
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const cx3 = (c) => { const k = col(c); return [k.r, k.g, k.b]; };
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // 【子道具组合 sub】在当前局部坐标系内以 (x,y,z)/ry 嵌入另一种已注册道具,并把其碰撞盒旋转平移回本坐标系
  // (B.col 盒是道具局部的,嵌套构建后必须重新映射;末尾元素保留 roof / rail 标志位)。
  // Compose another prop type inside this one (at x,y,z / ry in the current local frame) with its colliders carried
  // along (B.col boxes are prop-local, so nested builds must be re-mapped).
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
      B.cols[i] = b.length > 6 ? [x0, b[1] + y, z0, x1, b[4] + y, z1, b[6]] : [x0, b[1] + y, z0, x1, b[4] + y, z1];   // keep roof / rail flags
    }
  }
  // 【碰撞盒助手 colBox】局部坐标下以 中心点(x,z)+尺寸(w,h,d) 注册 AABB
  // local-frame collider helper: centre + size
  const colBox = (B, x, y, z, w, h, d) => B.col(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2);

  // ------------------------------------------------------------------------------------------ stroke font
  // 【描边字体】自研圆头粗体无衬线字库(字帽高 1):中心线笔画 + 圆端帽/圆转角,正面倒角、背面平整,
  // 3D 槽型字直接可用于招牌;字形几何按 (字,线宽,厚度,倒角,段数) 缓存。
  // Rounded bold sans (cap height 1): centre-line strokes, round caps + round joins, bevelled front, flat back.
  const EA = (cx, cy, rx, ry, a0, a1, n = 12) => { const o = []; for (let i = 0; i <= n; i++) { const a = ((a0 + (a1 - a0) * (i / n)) * PI) / 180; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return o; };
  const LOOP = (cx, cy, rx, ry, n = 24) => ({ c: EA(cx, cy, rx, ry, 0, 360, n).slice(0, n) });
  // 【字形表 GL】每个字形 = [字面宽度, 若干笔画…]:开笔画是折线点列,闭环笔画给 { c: 点列 }
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
    '+': [0.46, [[0, 0.45], [0.46, 0.45]], [[0.23, 0.22], [0.23, 0.68]]],
    '/': [0.4, [[0, 0], [0.4, 1]]],
    "'": [0, [[0, 1], [0, 0.8]]],
    '&': [0.7, [[0.7, 0], ...EA(0.27, 0.72, 0.17, 0.2, -40, 220, 12).reverse(), [0.08, 0.28], ...EA(0.26, 0.24, 0.24, 0.24, 180, 300, 6), [0.62, 0.36]]],
  };
  const DOTS = { '·': [[0, 0.46]], '.': [[0, 0]], ':': [[0, 0.1], [0, 0.62]] };
  const SPACE = 0.34;

  // 【笔画带 ribbon】把一条折线/闭环挤出成带状实体:正面平贴在 z=d(倒角 b 过渡到侧壁),侧壁落到 z0;
  // b=0 无倒角;d=z0 时退化为纯平面(喷漆/镂空字:只有正面)。
  // Stroke ribbon: flat face at z = d (bevel b down to the sides), side walls to z0. b = 0 → no bevel; d = z0 → flat
  // (paint / stencil lettering: face only).
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
  // 【圆盘 disc】笔画端帽/转角的圆片:a0..a1 为整圆,或朝外露出的半圆(开口笔画端头)
  // round cap / join: disc (a0..a1 = 0..TAU) or a half disc facing an open stroke end
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
  // 【字形几何 glyph】字帽单位(baseline y=0、cap y=1,背面 z=0、正面 z=dep),返回 { geo, adv 字宽 };
  // dep=0 → 平面喷漆字(只出面);ds = 圆帽段数。锐角转折处拆段并在交点画整圆连接。
  // glyph geometry in cap units (baseline y = 0, cap y = 1, back at z = 0, face at z = dep); returns { geo, adv }.
  // dep = 0 → flat painted lettering (face only); ds = round-cap segments.
  function glyph(ch, wt, dep, bev, ds = 10) {
    return tpl(['gl', ch, wt, dep, bev, ds].map(kf).join('|'), () => {
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
        // split at sharp turns (round join discs there), round caps at both ends
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
        // half-disc caps at the two open ends (facing outward), full discs at the sharp joints
        const endCap = (p, q) => { const a = Math.atan2(p[1] - q[1], p[0] - q[0]); disc(g, p[0], p[1], hw, b, d, 0, Math.max(3, Math.round(ds / 2)), a - HP, a + HP); };
        endCap(pts[0], pts[1]); endCap(pts[pts.length - 1], pts[pts.length - 2]);
        for (const p of joints.slice(2)) disc(g, p[0], p[1], hw, b, d, 0, ds);
      });
      return { geo: g.geo(), adv: w * s + wt };
    });
  }
  const textW = (str, wt = 0.17, track = 0.12) => { let w = 0; const cs = [...str]; cs.forEach((ch, i) => { w += ch === ' ' ? SPACE : glyph(ch, wt, 0.12, 0.035).adv; if (i < cs.length - 1) w += track; }); return w; };
  // 【排字 letters】在当前坐标系内铺一行朝 +Z 的字(凸字或 flat 平面漆字),返回行宽(米);
  // o.lit 时凸字正面再贴一层微凸的灯面(见下)。
  // Lay out a line of letters facing +Z in the current frame (raised channel letters, or flat paint with flat: true).
  // Returns the width (m).
  function letters(B, str, o = {}) {
    const h = o.h ?? 0.3, wt = o.wt ?? 0.17, flat = !!o.flat;
    const dep = flat ? 0 : o.dep ?? 0.12, bev = flat ? 0 : o.bev ?? (h < 0.34 ? 0 : 0.03), track = o.track ?? 0.12;
    const ds = o.ds ?? (flat || h < 0.12 ? 6 : 8);
    const W = textW(str, wt, track) * h;
    let x = o.align === 'left' ? 0 : o.align === 'right' ? -W : -W / 2;
    const cs = [...str];
    cs.forEach((ch, i) => {
      if (ch === ' ') { x += (SPACE + track) * h; return; }
      const gi = glyph(ch, wt, dep, bev, ds);
      const m = o.mat ?? (flat ? 'paint' : 'gloss');
      if (gi.geo) B.add(flat || h < 0.2 ? NS(m) : m, gi.geo, o.c ?? K.club, (o.x ?? 0) + x, o.y ?? 0, o.z ?? 0, { s: h, sz: flat ? 1 : h, glow: o.glow, ao: false });
      // lit channel letters: an illuminated acrylic face (flat, unlit-shaded) just proud of the raised letter's face, so
      // the sign reads as switched on at dusk and as a crisp lit sign by day
      // 【发光字】凸字正面再叠一层微凸的亚克力灯面(glow 桶,无光照着色):黄昏读作"通电",白天读作清晰的灯箱字
      if (gi.geo && o.lit) {
        const fg = glyph(ch, wt, 0, 0, ds);
        if (fg.geo) B.add(NS('glow'), fg.geo, o.litC ?? o.c ?? K.clubGold, (o.x ?? 0) + x, o.y ?? 0, (o.z ?? 0) + dep * h + 0.004, { s: h, sz: 1, glow: o.lit, ao: false });
      }
      x += (gi.adv + (i < cs.length - 1 ? track : 0)) * h;
    });
    return W;
  }

  // 【七段数码管】单元格 0.62×1、略斜体:点亮段走 glow 桶,未点亮的"幽灵 8"压在 paint 桶垫底
  // 7-segment LED digits (unit cell 0.62 × 1, slight italic): lit segments on 'glow', the unlit "ghost 8" on 'paint'
  const SEG7 = { a: [[0.1, 1], [0.46, 1]], b: [[0.53, 0.94], [0.53, 0.56]], c: [[0.53, 0.44], [0.53, 0.06]], d: [[0.1, 0], [0.46, 0]], e: [[0.03, 0.44], [0.03, 0.06]], f: [[0.03, 0.94], [0.03, 0.56]], g: [[0.1, 0.5], [0.46, 0.5]] };
  const DIG = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
  function segGeo(key) {
    return tpl('seg7|' + key, () => {
      const g = new GB(), t = 0.1, sk = 0.09;
      const put = (x, y) => g.v(x + y * sk, y, 0, 0, 0, 1);
      for (const ch of key) {
        if (ch === '.') { const q = [put(0.6, 0), put(0.68, 0), put(0.68, 0.08), put(0.6, 0.08)]; g.quad(q[0], q[1], q[2], q[3]); continue; }
        const [p0, p1] = SEG7[ch], dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
        const v = [put(p0[0], p0[1]), put(p0[0] + ux * t / 2 + nx * t / 2, p0[1] + uy * t / 2 + ny * t / 2), put(p1[0] - ux * t / 2 + nx * t / 2, p1[1] - uy * t / 2 + ny * t / 2),
          put(p1[0], p1[1]), put(p1[0] - ux * t / 2 - nx * t / 2, p1[1] - uy * t / 2 - ny * t / 2), put(p0[0] + ux * t / 2 - nx * t / 2, p0[1] + uy * t / 2 - ny * t / 2)];
        g.quad(v[0], v[1], v[2], v[5]); g.quad(v[5], v[2], v[3], v[4]);
      }
      return g.geo();
    });
  }
  // 【LED 数字行 ledText】如 '1.89'('.' 归前一位数字);h = 字高,面朝 +Z
  // a row of LED digits, e.g. '1.89' (the '.' belongs to the digit before it); h = digit height, faces +Z
  function ledText(B, str, x, y, z, h, c = K.led, glow = 2.4) {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '.') continue;
      const dot = str[i + 1] === '.' ? '.' : '';
      B.add(NS('paint'), segGeo('abcdefg.'), shade(c, 0.16), cx, y, z, { s: h, ao: false });
      if (ch !== ' ') B.add('glow', segGeo((DIG[+ch] ?? '') + dot), c, cx, y, z + 0.0015, { s: h, glow, ao: false });
      cx += h * 0.72;
    }
    return cx - x;
  }
  // 【迷你盒 pbox】无倒角单位立方体(12 三角形)缓存,专给微小零件,用 sx/sy/sz 缩放
  // plain (unbevelled) box for tiny parts: 12 triangles
  const pboxGeo = () => tpl('pbox', () => new THREE.BoxGeometry(1, 1, 1));
  const pbox = (B, mat, c, w, h, d, x, y, z, o = {}) => B.add(mat, pboxGeo(), c, x, y, z, { ...o, sx: w, sy: h, sz: d });

  // ------------------------------------------------------------------------------------------ pier timber
  // 【码头木结构】桩柱、水线贻贝裙、缠绳、系缆桩、充气碰垫、泳梯等甲板沿口小件;水面高度常量 WATER = -1.6
  const WATER = -1.6;
  // 【桩柱几何 pileGeo】焦油双色调烘焙:溅水区以下焦油色、以上风化灰棕带竖向木纹,桩顶切面端纹更浅
  // Tarred timber pile, baked two-tone: tar below the splash zone, weathered grey-brown above with vertical grain
  // streaks, lighter end grain on the cut top. Local origin at the pile axis, y = world height.
  function pileGeo(top, r, seg, seed) {
    return tpl(['pile', top, r, seg, seed % 5].map(kf).join('|'), () => {
      const prof = [[r * 1.06, -2.9], [r * 1.045, -1.3], [r * 1.02, -0.92], [r, top - 0.045], null, [r, top - 0.045], [r * 0.84, top], null, [r * 0.84, top], [0, top + 0.016]];
      const g = latheGeo(prof, seg);
      const P = g.attributes.position, C = g.attributes.color, N = g.attributes.normal, U = g.attributes.uv;
      const tar = cx3(K.tar), wood = cx3(K.pile), woodLt = cx3(K.pileLt), grain = cx3(K.endgrain);
      for (let i = 0; i < P.count; i++) {
        const y = P.getY(i), k = Math.round(U.getX(i) * seg) % seg, n1 = hash(k * 3.1 + seed), n2 = hash(k * 7.7 + seed * 1.3);
        let c;
        if (N.getY(i) > 0.6 && y > top - 0.01) c = lerp3(grain, woodLt, n1 * 0.4);
        else {
          const w = lerp3(wood, woodLt, n1 * 0.55);
          const wet = smooth(-1.3, -0.92, y);                          // tar + splash zone below
          c = lerp3(lerp3(tar, wood, 0.1 + n2 * 0.12), w, wet);
          c = lerp3(c, cx3('#3c4a30'), 0.55 * (1 - smooth(-1.52, -1.2, y)) * smooth(-1.9, -1.55, y));  // green slime just above the shells
          const damp = 1 - 0.14 * (1 - smooth(-0.92, -0.3, y)) * wet;  // darker damp band just above the tar line
          c = [c[0] * damp, c[1] * damp, c[2] * damp];
        }
        C.setXYZ(i, c[0], c[1], c[2]);
      }
      return g;
    });
  }
  // 【贻贝裙 musselGeo】水线上的一圈疙瘩状贻贝/藤壶附着带:蓝黑壳块带浅色藤壶斑点,顶部收紧贴着水线
  // lumpy mussel collar at the waterline: blue-black shell clumps with pale barnacle flecks, tucked tight at the top
  function musselGeo(r, seg, seed) {
    return tpl(['mussel', r, seg, seed % 4].map(kf).join('|'), () => {
      const g = new GB(), ys = [-1.84, -1.66, -1.5], rows = [];
      const cM = cx3(K.mussel), cM2 = cx3('#34394a'), cB = cx3('#9a978c'), cW = cx3('#3b4a33');
      ys.forEach((y, j) => {
        const row = [];
        for (let k = 0; k <= seg; k++) {
          const kk = k % seg, a = (k / seg) * TAU, cs = Math.cos(a), sn = Math.sin(a);
          const h1 = hash(kk * 1.9 + j * 5.3 + seed), h2 = hash(kk * 4.1 + j * 2.7 + seed * 0.7);
          const bulge = j === ys.length - 1 ? 0.003 : j === 0 ? 0.01 : 0.022 + 0.03 * h1;
          const rr = r + bulge;
          let c = lerp3(cM, cM2, h2);
          if (h1 > 0.82 && j > 0 && j < ys.length - 1) c = lerp3(c, cB, 0.55);   // barnacle fleck
          if (j === ys.length - 1) c = lerp3(cM2, cW, 0.6);                        // slimy weed lip
          const ny = j === 0 ? -0.55 : j === ys.length - 1 ? 0.85 : (h1 - 0.5) * 0.7;
          const l = Math.hypot(1, ny);
          row.push(g.v(cs * rr, y + (j === 1 ? (h2 - 0.5) * 0.04 : 0), sn * rr, cs / l, ny / l, sn / l, c[0], c[1], c[2]));
        }
        rows.push(row);
      });
      for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < seg; k++) g.quad(rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]);
      return g.geo();
    });
  }
  // 【缠绳 wrapGeo】绕桩的螺旋绳圈(局部原点在桩轴/最底圈处),tubeGeo 扫出
  // rope turns wrapped round a pile (helix), local origin at the pile axis / bottom turn
  function wrapGeo(r, turns, rr, radial) {
    return tpl(['wrap', r, turns, rr, radial].map(kf).join('|'), () => {
      const pts = [], n = Math.round(turns * 9);
      for (let i = 0; i <= n; i++) { const t = (i / n) * turns * TAU; pts.push([Math.cos(t) * (r + rr * 0.8), (i / n) * turns * rr * 2.05, Math.sin(t) * (r + rr * 0.8)]); }
      return tubeGeo(pts, rr, radial);
    });
  }
  // 【桩柱 pile】组装件:桩身(带帽时 wood 桶投影,否则 NS 无阴影)+ 水线贻贝裙 + 可选缠绳(wraps 圈数、wrapY 高度)与镀锌桩帽(cap)
  function pile(B, x, z, top, r, o = {}) {
    const seg = Math.max(5, B.seg(o.seg ?? (o.cap ? 7 : 6))), seed = Math.floor(B.r(0, 97));
    B.add(o.cap ? 'wood' : NS('wood'), pileGeo(top, r, seg, seed), 'white', x, 0, z, { ry: B.r(0, TAU), ao: false });
    B.add(NS('rubber'), musselGeo(r * 1.04, seg, seed), 'white', x, 0, z, { ry: B.r(0, TAU), ao: false });
    if (o.wrap) B.add(NS('paint'), wrapGeo(r * 1.02, o.wrap, 0.021, 4), o.ropeC ?? K.rope, x, o.wrapY ?? -0.62, z, { ry: B.r(0, TAU), ao: false });
    if (o.cap) {
      B.lathe('metal', K.galv, [[r * 1.07, top - 0.05], [r * 1.07, top + 0.015], [0, top + 0.1]], x, 0, z, { seg });
    }
  }

  // 【系缆桩 cleat】不锈钢羊角桩 + 底板(长度沿局部 X),pos = 甲板点
  // stainless horn cleat on a base plate (length along local X), pos = deck point
  function cleat(B, x, y, z, ry, L = 0.3, c = K.stainless) {
    B.push(x, y, z, ry);
    pbox(B, NS('metal'), shade(c, 0.86), L * 0.62, 0.014, 0.07, 0, 0.007, 0);
    for (const sx of [-1, 1]) B.lathe(NS('metal'), c, [[0.03, 0.012], [0.02, 0.07], [0, 0.074]], sx * L * 0.2, 0, 0, { seg: 6 });
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6, xx = (t - 0.5) * L; pts.push(P3(xx, 0.074 + 0.01 * Math.cos((t - 0.5) * PI) - 0.022 * Math.pow(Math.abs(t - 0.5) * 2, 3), 0)); }
    B.tube(NS('metal'), c, pts, 0.017, { radial: 6 });
    B.pop();
  }

  // 【碰垫 fender】黑色圆柱形(充气)碰垫,横挂时轴沿局部 X;由缆绳吊在甲板沿口(vert 竖挂),
  // 绳路上翻护舷木面、越过甲板边、系到甲板系绳环(tie)。
  // black cylindrical (inflatable) fender, axis along local X when horizontal; hangs by a line from the deck edge
  function fender(B, x, y, z, o = {}) {
    const L = o.len ?? 0.62, r = o.r ?? 0.11, vert = !!o.vert, c = o.color ?? K.fender;
    B.push(x, y, z, 0, 0, vert ? HP : 0);
    B.lathe(NS('gloss'), c, [[0, -L / 2 - 0.03], [r * 0.5, -L / 2 - 0.02], [r * 0.9, -L / 2 + r * 0.4], [r, -L / 2 + r], [r, L / 2 - r], [r * 0.9, L / 2 - r * 0.4], [r * 0.5, L / 2 + 0.02], [0, L / 2 + 0.03]], 0, 0, 0, { seg: 8, rz: HP });
    for (const s of [-1, 1]) B.tor(NS('gloss'), shade(c, 1.25), 0.02, 0.008, s * (L / 2 + 0.05), 0, 0, { rs: 3, ts: 7, ry: HP });
    B.pop();
    // lines run up the whaler face, over the deck edge and down to a deck eye (horizontal: a bridle to one eye)
    const tie = o.tie ?? [x, 0.0, -0.16];
    const ends = vert ? [[x, y + L / 2 + 0.06, z]] : [[x - L / 2 - 0.06, y, z], [x + L / 2 + 0.06, y, z]];
    const knot = [tie[0], y + (vert ? L / 2 + 0.2 : 0.2), z - 0.02];
    for (const e of ends) B.tube(NS('paint'), o.rope ?? K.ropeBlue, [P3(e[0], e[1], e[2]), P3((e[0] * 2 + knot[0]) / 3, (e[1] + knot[1]) / 2 + 0.01, z), P3(knot[0], knot[1], knot[2])], 0.01, { radial: 4 });
    B.tube(NS('paint'), o.rope ?? K.ropeBlue, [P3(knot[0], knot[1], knot[2]), P3(tie[0], -0.12, 0.125), P3(tie[0], 0.03, 0.07), P3(tie[0], 0.035, -0.02), P3(tie[0], 0.012, tie[2])], 0.011, { radial: 4 });
    B.sph(NS('paint'), o.rope ?? K.ropeBlue, 0.02, knot[0], knot[1], knot[2], { ws: 6, hs: 4 });
    B.tor(NS('metal'), K.stainless, 0.028, 0.008, tie[0], 0.012, tie[2], { rs: 3, ts: 8, rx: HP });
    B.cyl(NS('metal'), K.stainless, 0.035, 0.008, tie[0], 0.004, tie[2], { seg: 8 });
  }

  // 【泳梯 swimLadder】不锈钢泳梯,装在平板立面(z=0 为立面、水在 +Z),抓握拱圈翻过甲板边
  // stainless swim ladder on a slab face (face at z = 0, water +Z), grab hoops over the deck edge
  function swimLadder(B, x, o = {}) {
    const W = 0.46, z = 0.1, bot = -2.25, hoop = o.hoop ?? 0.78, c = K.stainless;
    B.push(x, 0, 0);
    for (const sx of [-1, 1]) {
      const xx = sx * W / 2, pts = [P3(xx, bot, z), P3(xx, -0.08, z)];
      for (let k = 1; k <= 3; k++) { const t = (k / 3) * HP; pts.push(P3(xx, -0.08 + Math.sin(t) * 0.1, z - 0.1 + Math.cos(t) * 0.1)); }
      pts.push(P3(xx, hoop - 0.18, -0.02));
      for (let k = 1; k <= 5; k++) { const t = (k / 5) * PI; pts.push(P3(xx, hoop - 0.18 + Math.sin(t) * 0.18, -0.02 - (1 - Math.cos(t)) * 0.17)); }
      pts.push(P3(xx, 0.05, -0.36), P3(xx, 0.0, -0.36));
      B.tube('metal', c, pts, 0.021, { radial: 6 });
      B.cyl('metal', K.galvDk, 0.042, 0.018, xx, 0.009, -0.36, { seg: 8 });
      for (const yy of [-0.45, -1.2]) pbox(B, 'metal', K.galvDk, 0.04, 0.05, z, xx, yy, z / 2);
    }
    for (let y = -1.95; y < -0.2; y += 0.3) pbox(B, 'metal', c, W, 0.028, 0.07, 0, y, z + 0.01);
    B.pop();
  }

  // ------------------------------------------------------------------------------------------ pier edge run
  // 【道具 pieredge:码头沿口】沿 +X 的码头/岸壁沿口装饰(立面 z=0、水在 +Z、甲板面 y=0):
  // 焦油桩+贻贝裙+缠绳、风化护舷木、可选系缆桩/碰垫/泳梯、橡胶 D 型护舷条;outer 模式桩柱高出甲板并带镀锌帽(仅竞技场周界)。
  D.pieredge = {
    desc: 'Pier / quay edge dressing along +X (slab face at z = 0, water on +Z, deck top y = 0): tarred timber fender piles with mussel line + rope wraps, weathered timber whaler with bolts, optional cleats, black cylinder fenders, a rubber D-fender strip, swim ladders. outer: piles rise above deck with galvanised caps (arena perimeter only).',
    params: { length: 'm (8)', outer: 'bool tall piles', spacing: 'pile spacing m (3.4)', s0: 'first pile offset (0.3)', s1: 'last pile offset (0.3)', skip: '[[s0,s1]] no piles/whaler', cleats: '[s] cleat positions', fenders: '[s] hung fenders', ladders: '[s] swim ladders', dfender: 'rubber strip', ext0: 'whaler extension at start (0)', ext1: 'at end (0)' },
    variants: 1, mount: 'wall',
    build(B, o) {
      B.aoBase = null;
      const L = o.length ?? 8, outer = !!o.outer, sp = o.spacing ?? (outer ? 4.4 : 4.6), s0 = o.s0 ?? 0.3, s1 = o.s1 ?? 0.3;
      // 【避让采样 skip】skip = [[s0,s1]] 禁布区间(台阶口、下水坡口等):桩和护舷木都要跳过这些开口
      const skip = o.skip || [], inSkip = (a, b = a) => skip.some(([p, q]) => b > p && a < q);
      const r = outer ? 0.17 : 0.155, zc = 0.1 + r * 0.92, top = outer ? 0.82 + B.r(-0.04, 0.05) : -0.06;
      // piles
      const span = L - s0 - s1, n = Math.max(1, Math.round(span / sp) + 1);
      const piles = [];
      for (let i = 0; i < n; i++) {
        const s = n === 1 ? s0 + span / 2 : s0 + (span * i) / (n - 1);
        if (inSkip(s - r, s + r)) continue;
        piles.push(s);
        const tp = outer ? top + B.r(-0.05, 0.05) : top;
        pile(B, s, zc, tp, r, { wrap: o.wraps === false ? 0 : (outer ? i % 5 === 1 : i % 5 === 2) ? 2 : 0, wrapY: outer ? 0.16 : -0.64, cap: outer });
      }
      // 【护舷木 whaler】顶部横木按板材长度分段(错缝平接),每根桩处及桩间打螺栓
      // whaler (top timber) in board lengths with butt joints, bolts at every pile and between
      const e0 = o.ext0 ?? 0, e1 = o.ext1 ?? 0;
      const runs = [];
      let a = -e0;
      const cuts = [...skip].sort((p, q) => p[0] - q[0]);
      for (const [p, q] of cuts) { if (p > a) runs.push([a, Math.min(p, L + e1)]); a = Math.max(a, q); }
      if (a < L + e1) runs.push([a, L + e1]);
      for (const [ra, rb] of runs) {
        const len = rb - ra, nb = Math.max(1, Math.round(len / 4.2));
        for (let k = 0; k < nb; k++) {
          const x0 = ra + (len * k) / nb, x1 = ra + (len * (k + 1)) / nb, w = x1 - x0 - (k < nb - 1 ? 0.012 : 0);
          B.box(NS('wood'), mixc(K.whaler, K.whalerDk, B.r(0, 0.6)), w, 0.28, 0.1, x0 + w / 2, -0.2, 0.05, { r: 0.018 });
        }
      }
      // rubber D-fender strips on the whaler, between the piles
      if (o.dfender) {
        const stops = [-(o.ext0 ?? 0), ...piles.flatMap((p) => [p - r - 0.05, p + r + 0.05]), L + (o.ext1 ?? 0)];
        for (let k = 0; k + 1 < stops.length; k += 2) {
          const x0 = stops[k] + 0.04, x1 = stops[k + 1] - 0.04;
          if (x1 - x0 < 0.3 || inSkip(x0, x1)) continue;
          B.box(NS('rubber'), K.fender, x1 - x0, 0.15, 0.075, (x0 + x1) / 2, -0.19, 0.137, { r: 0.032 });
        }
      }
      // 【避让采样 snap】悬挂/固定五金绝不能穿桩:若落点与桩冲突,滑到最近的空档里
      // hung / fixed hardware never clips a pile: slide it to the nearest clear gap
      const snap = (s, half) => {
        const need = half + r + 0.05, hit = piles.some((p) => Math.abs(s - p) < need);
        if (!hit) return s;
        const edges = [-(o.ext0 ?? 0) + 0.05, ...piles, L + (o.ext1 ?? 0) - 0.05];
        let best = s, bd = Infinity;
        for (let i = 0; i + 1 < edges.length; i++) {
          const a0 = edges[i] + (i === 0 ? half : need), a1 = edges[i + 1] - (i + 1 === edges.length - 1 ? half : need);
          if (a1 < a0) continue;
          const c = Math.max(a0, Math.min(a1, s));
          if (Math.abs(c - s) < bd) { bd = Math.abs(c - s); best = c; }
        }
        return best;
      };
      for (const s of o.cleats || []) cleat(B, s, 0, -0.14, 0, 0.3);
      for (const s of o.fenders || []) fender(B, snap(s, 0.4), -0.66, 0.16, {});
      for (const s of o.ladders || []) swimLadder(B, snap(s, 0.28), { hoop: o.hoop });
    },
  };

  // ================================================================================================ required cover
  // 【必配道具区】关卡要求必须出现的功能道具(加油机、储物箱、服务站、垫木、板条箱)
  // 【油枪 nozzle】加油机挂枪:手柄+护圈+弯管出油嘴插在枪座里;两侧 ±Z 显示,DIESEL 在 +X、UNLEADED 在 -X
  // ---- marina fuel dispenser: two-sided (displays on ±Z), DIESEL nozzle on +X, UNLEADED on -X; 0.8 × 0.8 × 1.25
  function nozzle(B, x, y, z, side, grip) {
    // pistol nozzle resting in its boot: grip + trigger guard + curved spout down into the boot
    B.push(x, y, z, 0, 0, side * -0.25);
    B.box('gloss', grip, 0.038, 0.15, 0.055, 0, 0.02, 0, { r: 0.016 });
    B.box('rubber', 'charcoal', 0.03, 0.05, 0.05, 0, 0.11, 0, { r: 0.01 });
    B.tube('metal', K.stainless, [P3(0, -0.06, 0), P3(side * 0.035, -0.1, 0), P3(side * 0.055, -0.16, 0)], 0.012, { radial: 6 });
    B.tube('metal', K.galvDk, [P3(-side * 0.02, 0.07, 0), P3(-side * 0.055, 0.02, 0), P3(-side * 0.04, -0.06, 0)], 0.006, { radial: 4 });
    B.pop();
  }
  // 【道具 fuelpump:码头加油机】0.8×0.8×1.25 双面(±Z 显示),含泄油盘、蓝色柜体+百叶门、
  // LED 油价屏、DIESEL(+X)/UNLEADED(-X) 油枪与盘绕油管、FUEL 字、禁烟/易燃标、急停钮
  D.fuelpump = {
    desc: 'Marina fuel dispenser (0.8 × 0.8 × 1.25, collider): spill tray, blue cabinet with doors + louvres, white head with LED price displays on both faces, DIESEL (+X) and UNLEADED (-X) nozzles in boots with looping hoses, FUEL letters, NO SMOKING + flammable labels, e-stop.',
    params: { price: 'diesel price text (1.89)', price2: 'unleaded price (2.14)' }, variants: 1, mount: 'ground',
    build(B, o) {
      const blue = K.fuelBlue, white = K.white;
      // spill tray + plinth
      B.box('metal', K.galvDk, 0.8, 0.05, 0.8, 0, 0.025, 0, { r: 0.015 });
      for (const sz of [-1, 1]) { pbox(B, 'metal', K.galv, 0.8, 0.035, 0.02, 0, 0.065, sz * 0.39); pbox(B, 'metal', K.galv, 0.02, 0.035, 0.76, sz * 0.39, 0.065, 0); }
      B.box('paint', K.concreteDk, 0.66, 0.06, 0.54, 0, 0.08, 0, { r: 0.02 });
      // lower cabinet
      B.box('gloss', blue, 0.6, 0.64, 0.46, 0, 0.43, 0, { round: true, r: 0.03 });
      for (const sz of [-1, 1]) {
        B.push(0, 0, sz * 0.232, sz > 0 ? 0 : PI);
        B.box('gloss', shade(blue, 1.08), 0.5, 0.5, 0.012, 0, 0.42, 0, { r: 0.008 });
        for (let i = 0; i < 5; i++) pbox(B, 'paint', shade(blue, 0.62), 0.3, 0.012, 0.012, -0.06, 0.24 + i * 0.03, 0.008);
        B.cyl('metal', K.stainless, 0.014, 0.012, 0.19, 0.5, 0.01, { rx: HP, seg: 8 });
        letters(B, 'FUEL', { h: 0.085, x: 0, y: 0.52, z: 0.008, c: white, flat: true, wt: 0.22 });
        B.decal('dia0', 0.07, 0.07, 0.19, 0.3, 0.008);
        B.pop();
      }
      // grade band + head
      B.box('paint', white, 0.62, 0.1, 0.48, 0, 0.8, 0, { r: 0.02 });
      B.box('gloss', white, 0.66, 0.38, 0.52, 0, 1.04, 0, { round: true, r: 0.04 });
      B.box('gloss', blue, 0.7, 0.035, 0.56, 0, 1.232, 0, { r: 0.016 });
      for (const sz of [-1, 1]) {
        B.push(0, 0, sz * 0.26, sz > 0 ? 0 : PI);
        B.box('gloss', K.glass, 0.52, 0.24, 0.012, 0, 1.06, 0.002, { r: 0.01 });
        B.box('paint', shade(K.glass, 0.5), 0.46, 0.2, 0.004, 0, 1.06, 0.009);
        ledText(B, o.price ?? '1.89', -0.2, 1.09, 0.0115, 0.07, K.led);
        ledText(B, '42.60', -0.2, 0.99, 0.0115, 0.045, K.fuelYel, 1.8);
        pbox(B, 'glow', K.ledG, 0.014, 0.014, 0.004, 0.19, 1.14, 0.012, { glow: 2 });
        // grade select buttons + card slot under the screen
        for (let i = 0; i < 3; i++) pbox(B, 'gloss', ['#4f9a57', K.fuelYel, K.white][i], 0.045, 0.022, 0.012, -0.09 + i * 0.06, 0.9, 0.004);
        pbox(B, 'paint', 'ink', 0.07, 0.012, 0.01, 0.17, 0.9, 0.004);
        // grade label on the band
        letters(B, sz > 0 ? 'DIESEL' : 'UNLEADED', { h: 0.036, x: 0, y: 0.782, z: -0.018, c: sz > 0 ? '#a07a1e' : '#3f7a4a', flat: true, wt: 0.22 });
        B.pop();
      }
      // boots + nozzles + hoses on ±X
      for (const sx of [-1, 1]) {
        const grip = sx > 0 ? K.fuelYel : '#4f9a57';
        B.box('rubber', 'charcoal', 0.05, 0.14, 0.1, sx * 0.355, 0.95, -0.06, { r: 0.018 });
        nozzle(B, sx * 0.36, 1.02, -0.06, sx, grip);
        B.cyl('metal', K.galvDk, 0.03, 0.04, sx * 0.3, 1.2, 0.12, { rz: HP, seg: 8 });
        const hose = [P3(sx * 0.33, 1.2, 0.12), P3(sx * 0.37, 1.17, 0.14), P3(sx * 0.395, 1.0, 0.15), P3(sx * 0.4, 0.62, 0.12), P3(sx * 0.395, 0.4, 0.06), P3(sx * 0.39, 0.36, -0.02), P3(sx * 0.392, 0.45, -0.07), P3(sx * 0.39, 0.72, -0.09), P3(sx * 0.37, 0.93, -0.07), P3(sx * 0.36, 1.07, -0.06)];
        B.tube('rubber', '#1f2126', hose, 0.017, { radial: 6 });
        B.cyl('metal', K.stainless, 0.024, 0.05, sx * 0.4, 0.66, 0.12, { seg: 8 });
        B.decal('lb4', 0.16, 0.04, sx * 0.301, 0.2, 0.0, { ry: sx * HP });
      }
      // e-stop on the head's top corner
      B.cyl('metal', K.galv, 0.03, 0.02, 0.24, 1.26, 0.18, { seg: 10 });
      B.sph('gloss', K.red, 0.028, 0.24, 1.272, 0.18, { ws: 10, hs: 5, half: true });
      // 【碰撞】整机一个实体盒(加油机是不可穿越的落地设备)
      B.col(-0.4, 0, -0.4, 0.4, 1.25, 0.4);
    },
  };

  // 【道具 dockbox:码头储物箱】白色玻璃钢箱体(rotY=±PI/2 时世界 1.2×1.8×1.0;局部 1.8 宽 ×1.2 深),
  // 锥形模压箱体+滑橇、圆顶盖带垂边、钢琴铰链+气撑、挂锁扣、端部内凹拉手、铭牌、盖上盘绳
  // ---- white fibreglass dock box (1.2 × 1.8 × 1.0 world when rotY = ±PI/2; local 1.8 wide × 1.2 deep), lid opens to +Z
  D.dockbox = {
    desc: 'White fibreglass dock box: moulded tapered body on skids, domed lid with overhanging lip, stainless piano hinge + gas struts, hasp and brass padlock, recessed end handles, moulded nameplate, a coiled line on the lid. Local 1.8 (x) × 1.2 (z) × 1.0; front +Z.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const W = 1.8, Dd = 1.2, Hh = 1.0, c = mixc(K.white, 'offwhite', 0.4);
      for (const sz of [-1, 1]) B.box('rubber', 'charcoal', W - 0.16, 0.05, 0.1, 0, 0.025, sz * (Dd / 2 - 0.12), { r: 0.018 });
      // tapered body: extruded trapezoid (wider at the top), rounded
      const prof = [[-Dd / 2 + 0.07, 0.05], [Dd / 2 - 0.07, 0.05], [Dd / 2 - 0.02, 0.84], [-Dd / 2 + 0.02, 0.84]];
      B.add('gloss', tpl('dbx', () => extrudeGeo(prof, W - 0.06, 0.03)), c, 0, 0, 0);
      // moulded rub strake + lid
      B.box('gloss', shade(c, 0.93), W - 0.02, 0.05, Dd - 0.02, 0, 0.83, 0, { r: 0.02 });
      B.box('gloss', c, W + 0.04, 0.1, Dd + 0.04, 0, 0.9, 0, { round: true, r: 0.045 });
      B.box('gloss', c, W - 0.2, 0.06, Dd - 0.24, 0, 0.965, 0.0, { round: true, r: 0.03 });
      for (let i = 0; i < 3; i++) pbox(B, 'paint', shade(c, 0.9), W - 0.5, 0.008, 0.03, 0, 0.999, -0.3 + i * 0.3);
      // hinge + struts (back), hasp + padlock (front), end handles
      B.cyl('metal', K.stainless, 0.012, W - 0.3, 0, 0.86, -Dd / 2 - 0.02, { rz: HP, seg: 6 });
      for (const sx of [-1, 1]) B.tube('metal', K.stainless, [P3(sx * 0.6, 0.62, -Dd / 2 + 0.005), P3(sx * 0.6, 0.82, -Dd / 2 - 0.005)], 0.009, { radial: 5 });
      B.box('metal', K.stainless, 0.06, 0.12, 0.012, 0, 0.8, Dd / 2 - 0.01, { r: 0.004 });
      B.box('metal', '#c9a24b', 0.045, 0.05, 0.022, 0, 0.72, Dd / 2 + 0.012, { r: 0.008 });
      B.tor('metal', K.stainless, 0.016, 0.004, 0, 0.755, Dd / 2 + 0.012, { rs: 3, ts: 8 });
      for (const sx of [-1, 1]) { B.box('paint', shade(c, 0.78), 0.012, 0.06, 0.26, sx * (W / 2 - 0.022), 0.66, 0, { r: 0.006 }); pbox(B, 'metal', K.stainless, 0.012, 0.018, 0.2, sx * (W / 2 - 0.012), 0.69, 0); }
      // nameplate + stencil
      B.box('paint', K.club, 0.46, 0.12, 0.01, -0.45, 0.62, Dd / 2 - 0.022, { r: 0.012 });
      letters(B, 'LIFEJACKETS', { h: 0.036, x: -0.45, y: 0.6, z: Dd / 2 - 0.012, c: K.white, flat: true, wt: 0.2 });
      B.decal('lb13', 0.22, 0.055, 0.45, 0.62, Dd / 2 - 0.02);
      // a coiled line left on the lid
      for (let i = 0; i < 4; i++) B.tor('paint', K.rope, 0.16 - i * 0.012, 0.014, 0.35, 1.012 + i * 0.012, -0.1, { rx: HP, rs: 4, ts: 16 });
      B.tube('paint', K.rope, [P3(0.5, 1.02, -0.12), P3(0.62, 1.01, -0.05), P3(0.8, 0.98, 0.1), P3(0.9, 0.93, 0.2), P3(0.93, 0.8, 0.26)], 0.014, { radial: 4 });
      // 【碰撞】整箱一个实体盒
      B.col(-W / 2, 0, -Dd / 2, W / 2, Hh, Dd / 2);
    },
  };

  // 【道具 pumpout:泵出/供水服务站】敞前脸亭棚(局部 1.6 宽 ×1.8 深 ×2.2 高,正面 +Z;后 1.25 实体,
  // 前 0.55 栏杆后敞开):木披板墙+单坡顶+PUMP OUT 楣字、黄色真空泵出机(表/按钮/卷盘吸污管)、
  // 蓝色饮用水立管(黄铜龙头+盘管)、告示牌+灯
  // ---- pump-out / water service station: open-fronted shelter (1.6 wide × 1.8 deep local, 2.2 tall), front +Z
  D.pumpout = {
    desc: 'Marina service station (collider 1.6 × 2.2 × 1.8 local, front +Z; back 1.25 solid, open front 0.55 behind the barrier = rail): timber-clad shelter with a mono-pitch roof and PUMP OUT fascia letters, yellow vacuum pump-out unit with gauge and buttons, suction hose on a reel, blue potable-water standpipe with brass taps and a coiled hose, notice + lamp.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const W = 1.6, Dd = 1.8, clad = mixc(K.cladding, K.white, 0.25), trim = K.white, pumpC = '#d8b04f';
      B.box('paint', K.concrete, W, 0.1, Dd, 0, 0.05, 0, { round: true, r: 0.03 });
      // back + side walls (planked), corner posts
      for (let i = 0; i < 12; i++) pbox(B, 'wood', mixc(clad, K.white, (i % 2) * 0.12), W - 0.06, 0.155, 0.05, 0, 0.19 + i * 0.16, -Dd / 2 + 0.05);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 12; i++) pbox(B, 'wood', mixc(clad, K.white, (i % 2) * 0.12), 0.05, 0.155, Dd * 0.5, sx * (W / 2 - 0.03), 0.19 + i * 0.16, -Dd * 0.25);
        B.box('paint', trim, 0.09, 2.02, 0.09, sx * (W / 2 - 0.04), 1.11, 0.02, { r: 0.02 });
        B.box('paint', trim, 0.09, 2.02, 0.09, sx * (W / 2 - 0.04), 1.11, -Dd / 2 + 0.04, { r: 0.02 });
      }
      // mono-pitch roof with fascia + letters
      B.push(0, 2.12, 0, 0, 0.06);
      B.box('paint', K.frameDk, W + 0.12, 0.07, Dd + 0.12, 0, 0, 0, { r: 0.02 });
      B.pop();
      B.box('paint', K.fuelBlue, W + 0.1, 0.2, 0.05, 0, 2.02, Dd / 2 + 0.03, { r: 0.015 });
      letters(B, 'PUMP OUT', { h: 0.1, x: 0, y: 1.97, z: Dd / 2 + 0.055, c: K.white, dep: 0.1, wt: 0.2 });
      B.cyl('paint', 'charcoal', 0.07, 0.03, 0, 1.94, 0.3, { seg: 10 });
      B.sph('glow', K.lamp, 0.05, 0, 1.92, 0.3, { ws: 8, hs: 4, half: false, glow: 1.3 });
      // pump-out unit (left)
      B.push(-0.33, 0.1, -0.35);
      B.box('gloss', pumpC, 0.7, 1.0, 0.62, 0, 0.5, 0, { round: true, r: 0.04 });
      B.box('metal', K.stainless, 0.5, 0.32, 0.012, 0, 0.72, 0.312, { r: 0.008 });
      B.cyl('metal', K.stainless, 0.07, 0.03, -0.12, 0.76, 0.32, { rx: HP, seg: 14 });
      B.cyl('paint', K.white, 0.058, 0.004, -0.12, 0.76, 0.336, { rx: HP, seg: 14 });
      pbox(B, 'paint', 'ink', 0.004, 0.05, 0.002, -0.1, 0.77, 0.339, { rz: -0.7 });
      B.cyl('gloss', '#4f9a57', 0.03, 0.03, 0.08, 0.8, 0.325, { rx: HP, seg: 10 });
      B.cyl('gloss', K.red, 0.03, 0.03, 0.17, 0.8, 0.325, { rx: HP, seg: 10 });
      for (let i = 0; i < 4; i++) pbox(B, 'paint', shade(pumpC, 0.7), 0.44, 0.014, 0.012, 0, 0.18 + i * 0.05, 0.312);
      letters(B, 'PUMP OUT', { h: 0.045, x: 0, y: 0.47, z: 0.314, c: K.club, flat: true, wt: 0.22 });
      // suction hose reel on the side
      B.push(0.36, 0.62, 0);
      B.cyl('metal', K.galvDk, 0.3, 0.02, 0.0, 0, -0.2, { rz: HP, seg: 18 });
      B.cyl('metal', K.galvDk, 0.3, 0.02, 0.26, 0, -0.2, { rz: HP, seg: 18 });
      for (let i = 0; i < 4; i++) B.tor('rubber', '#1f2126', 0.2 + (i % 2) * 0.04, 0.032, 0.05 + i * 0.055, 0, -0.2, { ry: HP, rs: 5, ts: 12 });
      B.pop();
      B.tube('rubber', '#1f2126', [P3(0.5, 0.42, -0.2), P3(0.55, 0.2, 0.05), P3(0.5, 0.12, 0.3), P3(0.3, 0.14, 0.45), P3(0.2, 0.35, 0.42), P3(0.18, 0.55, 0.36)], 0.032, { radial: 7 });
      B.box('metal', K.stainless, 0.08, 0.18, 0.08, 0.18, 0.62, 0.36, { r: 0.015 });
      B.pop();
      // potable water standpipe (right)
      B.push(0.5, 0.1, -0.25);
      B.box('gloss', '#3f6fb0', 0.14, 1.3, 0.14, 0, 0.65, 0, { r: 0.03 });
      B.box('gloss', shade('#3f6fb0', 1.2), 0.18, 0.06, 0.18, 0, 1.33, 0, { r: 0.02 });
      for (const yy of [0.62, 0.95]) {
        B.cyl('metal', '#c9a24b', 0.022, 0.12, 0, yy, 0.12, { rx: HP, seg: 8 });
        B.cyl('metal', '#c9a24b', 0.012, 0.08, 0, yy - 0.04, 0.17, { seg: 6 });
        B.tor('metal', '#c9a24b', 0.03, 0.008, 0, yy + 0.04, 0.12, { rx: HP, rs: 3, ts: 10 });
      }
      B.decal('lb1', 0.2, 0.05, 0, 1.16, 0.072);
      for (let i = 0; i < 3; i++) B.tor('rubber', '#5a8fc9', 0.17 - (i % 2) * 0.012, 0.017, 0.0, 0.34 + i * 0.02, 0.2, { rx: HP * 0.25, rs: 4, ts: 12 });
      B.box('metal', K.galvDk, 0.05, 0.05, 0.14, 0, 0.44, 0.1, { r: 0.012 });
      B.pop();
      // front barrier: posts + rails + a chain gate (the open front half is a rail collider, the back half solid)
      for (const x of [-W / 2 + 0.05, -0.05, W / 2 - 0.05]) B.box('metal', K.fuelYel, 0.07, 1.05, 0.07, x, 0.62, Dd / 2 - 0.05, { r: 0.02 });
      for (const yy of [0.62, 1.1]) B.cyl('metal', K.fuelYel, 0.022, W / 2 - 0.1, -W / 4 - 0.02, yy, Dd / 2 - 0.05, { rz: HP, seg: 6 });
      B.tube('metal', K.galvDk, arcPts(0.37, 1.02, Dd / 2 - 0.05, 0.37, PI, TAU, 8).map((p, i, a) => P3(p[0], 1.02 - Math.sin((i / (a.length - 1)) * PI) * 0.12, p[2])), 0.01, { radial: 3 });
      B.decal('lb6', 0.3, 0.075, -0.4, 0.86, Dd / 2 - 0.01);
      // notice on the back wall
      B.box('paint', K.white, 0.36, 0.5, 0.01, 0.25, 1.55, -Dd / 2 + 0.08, { r: 0.01 });
      B.decal('pst9', 0.32, 0.46, 0.25, 1.55, -Dd / 2 + 0.086);
      // 【碰撞】后半(墙+泵机+立管)= 实体遮挡盒;前半(栏杆+链门之后)= rail 盒:只挡人,墨/弹可穿
      B.col(-W / 2, 0, -Dd / 2, W / 2, 2.2, 0.35);                     // walls, pump-out unit, standpipe: solid cover
      B.col(-W / 2, 0, 0.35, W / 2, 2.2, Dd / 2, { rail: true });       // open front behind the barrier rail + chain gate
    },
  };

  // 【道具 keelblocks:船台垫木堆】1.8×2.0×1.2:六层交叉叠放的 200mm 方木(端纹、防污漆渍、随机错缝),
  // 顶面毛毡垫+硬木楔子,斜靠一只钢船架
  // ---- keel-block stack (timber cribbing) 1.8 × 2.0 × 1.2: crossed layers, end grain, antifouling smudges, wedges
  // 【垫木单根 beamGeo】带倒角方木,逐顶点烘焙:两端端纹色、侧面随机木色、上表面偶发防污漆渍
  function beamGeo(L, t, seed) {
    return tpl(['beam', L, t, seed % 6].map(kf).join('|'), () => {
      const g = chamferBox(L, t, t, 0.018);
      const C = g.attributes.color, N = g.attributes.normal, P = g.attributes.position;
      const tone = hash(seed * 1.9), side = cx3(tone < 0.35 ? mixc('#8a8478', '#a39c8f', hash(seed)) : mixc(K.pile, '#b58a5a', hash(seed) * 0.9)), end = cx3(tone < 0.35 ? '#b5ab98' : K.endgrain), paint = cx3(K.antifoul);
      for (let i = 0; i < C.count; i++) {
        let c = Math.abs(N.getX(i)) > 0.7 ? end : side;
        if (N.getY(i) > 0.7 && hash(seed * 3.7) > 0.55 && Math.abs(P.getX(i)) < L * 0.3) c = lerp3(c, paint, 0.55);
        const k = 0.9 + 0.12 * hash(i * 0.37 + seed);
        C.setXYZ(i, c[0] * k, c[1] * k, c[2] * k);
      }
      return g;
    });
  }
  D.keelblocks = {
    desc: 'Boatyard keel-block crib (1.8 × 2.0 × 1.2, collider): six crossed layers of 200 mm timbers with end grain and antifouling smudges, carpeted top block with hardwood wedges, a steel boat stand leaning against it.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const t = 0.2, n = 6;
      for (let i = 0; i < n; i++) {
        const along = i % 2 === 0, y = t / 2 + i * t;
        for (let k = 0; k < 4; k++) {
          const off = -0.72 + k * 0.48 + B.r(-0.03, 0.03), seed = i * 7 + k;
          const cut = [0, 0.04, 0.08][(seed * 5) % 3];
          if (along) B.add('wood', beamGeo(2.0 - cut, t - 0.004, seed), 'white', off * (1.8 / 2.0), y, B.r(-0.02, 0.02), { ry: HP + B.r(-0.02, 0.02), ao: false });
          else B.add('wood', beamGeo(1.8 - cut, t - 0.004, seed), 'white', B.r(-0.02, 0.02), y, off, { ry: B.r(-0.02, 0.02), ao: false });
        }
      }
      // carpet pad + wedges on top
      B.box('paint', '#5d6a78', 0.5, 0.02, 1.6, 0, n * t + 0.01, 0, { r: 0.006 });
      for (const sz of [-0.45, 0.45]) { B.push(0.1, n * t + 0.02, sz, 0.1); B.add('wood', tpl('wedge', () => extrudeGeo([[-0.18, 0], [0.18, 0], [0.18, 0.02], [-0.18, 0.09]], 0.14, 0.008)), '#b08556', 0, 0, 0, { ry: HP }); B.pop(); }
      // boat stand leaning on the stack (+X side)
      B.push(1.02, 0, 0.3, 0, 0, 0.22);
      B.tube('metal', K.liftBlue, [P3(0, 0.02, -0.25), P3(0, 1.05, 0)], 0.028, { radial: 6 });
      B.tube('metal', K.liftBlue, [P3(0, 0.02, 0.25), P3(0, 1.05, 0)], 0.028, { radial: 6 });
      B.cyl('metal', K.galv, 0.022, 0.4, 0, 1.2, 0, { seg: 8 });
      B.box('rubber', 'charcoal', 0.16, 0.04, 0.16, 0, 1.41, 0, { r: 0.015 });
      B.pop();
      // 【碰撞】整堆一个实体盒(斜靠的船架在盒内)
      B.col(-0.9, 0, -1.0, 0.9, 1.2, 1.0);
    },
  };

  // 【道具 quaycrates:码头板条箱堆】2.2×1.6×1.2:托盘上两只加斜撑的出口木箱(HALYARD MARINA 模板字+箭头),
  // 一只半罩蓝防雨布(垂坠褶皱+缆绳捆扎),箱顶捆着碰垫组(variant 0)或浮球袋(variant 1)
  // ---- quay crates 2.2 × 1.6 × 1.2: two braced export crates on pallets, a tarp half off, stencils, rope lashing
  // 【木箱 crate】单只出口板条箱:板缝读作暗线,框条+角柱+每面斜撑;tone 控制明暗
  function crate(B, x, y, z, w, h, d, ry, tone) {
    B.push(x, y, z, ry);
    const wc = shade('woodlight', tone), dk = shade('wooddark', tone * 0.95);
    B.box('wood', wc, w - 0.03, h - 0.02, d - 0.03, 0, h / 2, 0, { r: 0.015 });
    // planks read through dark seams; frame battens + corner posts + diagonal brace per face
    for (let k = 1; k < 5; k++) { const yy = (k * h) / 5; pbox(B, 'wood', shade(wc, 0.72), w - 0.05, 0.008, d - 0.02, 0, yy, 0); pbox(B, 'wood', shade(wc, 0.72), w - 0.02, 0.008, d - 0.05, 0, yy, 0); }
    for (const yy of [0.05, h - 0.05]) { pbox(B, 'wood', dk, w, 0.09, 0.05, 0, yy, d / 2 - 0.025); pbox(B, 'wood', dk, w, 0.09, 0.05, 0, yy, -d / 2 + 0.025); pbox(B, 'wood', dk, 0.05, 0.09, d - 0.1, w / 2 - 0.025, yy, 0); pbox(B, 'wood', dk, 0.05, 0.09, d - 0.1, -w / 2 + 0.025, yy, 0); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pbox(B, 'wood', dk, 0.07, h - 0.16, 0.07, sx * (w / 2 - 0.035), h / 2, sz * (d / 2 - 0.035));
    for (const sz of [-1, 1]) { B.push(0, h / 2, sz * (d / 2 - 0.005), 0, 0, Math.atan2(h - 0.2, w - 0.2) * sz); pbox(B, 'wood', dk, Math.hypot(w - 0.2, h - 0.2), 0.08, 0.03, 0, 0, 0); B.pop(); }
    B.box('wood', shade(wc, 1.04), w - 0.06, 0.03, d - 0.06, 0, h + 0.005, 0, { r: 0.01 });
    B.pop();
  }
  D.quaycrates = {
    desc: 'Quay cargo stack (2.2 × 1.6 × 1.2, collider): two braced timber export crates on pallets with painted HALYARD MARINA stencils and arrows, a blue tarp half drawn over one with rope lashings, a strapped fender bundle on top.',
    params: {}, variants: 2, mount: 'ground',
    build(B, o) {
      const v = (o.variant ?? 0) % 2;
      for (const sx of [-1, 1]) {
        B.push(sx * 0.55, 0, 0);
        for (const zz of [-0.62, 0, 0.62]) pbox(B, 'wood', shade('wooddark', 0.92), 1.0, 0.1, 0.1, 0, 0.05, zz);
        for (let i = 0; i < 6; i++) pbox(B, 'wood', shade('woodlight', 0.88 + (i % 3) * 0.05), 0.14, 0.022, 1.46, -0.43 + i * 0.172, 0.111, 0);
        B.pop();
      }
      crate(B, -0.55, 0.122, 0, 1.02, 1.07, 1.5, B.r(-0.02, 0.02), 1.0);
      crate(B, 0.56, 0.122, 0.02, 1.02, 1.0, 1.46, B.r(-0.03, 0.03), 0.93);
      // stencils (front + back of each crate)
      for (const [cx, hh, sz, fz] of [[-0.55, 1.07, 1, 0.737], [0.56, 1.0, -1, -0.697]]) {
        B.push(cx, 0.122, fz, sz > 0 ? 0 : PI);
        letters(B, 'HALYARD', { h: 0.1, x: 0, y: hh * 0.62, z: 0.004, c: '#3a3f4a', flat: true, wt: 0.2 });
        B.pop();
      }
      // tarp over the right crate: draped sheet with sagging folds + rope lashings
      B.push(0.56, 0.122, 0.02, 0);
      const tg = tpl('tarp|' + v, () => {
        const g = new GB(), nx = 9, nz = 11, w = 1.14, d = 1.58, ht = 1.0;
        const cA = cx3(K.tarp), cB2 = cx3(K.tarpDk), rows = [];
        for (let j = 0; j <= nz; j++) {
          const row = [];
          for (let i = 0; i <= nx; i++) {
            const u = i / nx, vv = j / nz;
            let x = (u - 0.5) * w, z = (vv - 0.5) * d, y = ht + 0.012 + 0.02 * Math.sin(u * 9 + vv * 3);
            // sheet runs over the top and down the -X side (hanging) and part of +Z face
            if (u > 0.78) { const k = (u - 0.78) / 0.22; x = w / 2 + 0.012 + 0.03 * Math.sin(vv * 11) * k; y = ht - k * 0.75 + 0.05 * Math.sin(vv * 14); }
            if (vv > 0.86 && u <= 0.78) { const k = (vv - 0.86) / 0.14; z = d / 2 + 0.012; y = ht - k * 0.35 - 0.04 * Math.sin(u * 13); }
            const c = lerp3(cA, cB2, 0.5 + 0.5 * Math.sin(u * 12 + vv * 7));
            row.push(g.v(x, y, z, u > 0.78 ? 1 : 0, u > 0.78 ? 0 : 1, vv > 0.86 ? 0.8 : 0, c[0], c[1], c[2]));
          }
          rows.push(row);
        }
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) g.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
        const geo = g.geo(); geo.computeVertexNormals(); return geo;
      });
      B.add('foliage', tg, 'white', 0, 0, 0, {});
      for (const zz of [-0.4, 0.35]) B.tube('paint', K.rope, [P3(-0.55, 0.3, zz), P3(-0.54, 1.02, zz), P3(0.0, 1.035, zz + 0.02), P3(0.53, 1.02, zz), P3(0.54, 0.35, zz)], 0.012, { radial: 4 });
      for (const zz of [-0.62, -0.2, 0.2, 0.62]) B.tor('metal', K.galv, 0.016, 0.005, 0.535, 0.3, zz, { rs: 3, ts: 8, ry: HP });
      B.pop();
      // strapped fender bundle / net float bag on the left crate
      if (v === 0) {
        for (let i = 0; i < 3; i++) B.lathe('gloss', i === 1 ? K.white : K.fender, [[0, -0.28], [0.07, -0.26], [0.1, -0.2], [0.1, 0.2], [0.07, 0.26], [0, 0.28]], -0.55, 1.29, -0.28 + i * 0.22, { seg: 10, rz: HP, ry: 0.08 });
        B.box('paint', K.fuelRed, 0.05, 0.012, 0.7, -0.3, 1.39, 0, { r: 0.004 });
      } else {
        for (let i = 0; i < 7; i++) B.sph('gloss', i % 2 ? K.fuelRed : K.white, 0.08, -0.72 + (i % 4) * 0.13, 1.28 + Math.floor(i / 4) * 0.1, -0.2 + (i % 3) * 0.14, { ws: 7, hs: 5 });
      }
      // 【碰撞】整堆一个实体盒
      B.col(-1.1, 0, -0.8, 1.1, 1.2, 0.8);
    },
  };

  // ================================================================================================ building kit
  // 【建筑立面套件区】以下全部贴装在可玩墙面上(凸出 ≤0.12 m,墙在局部 z=0、朝 +Z)
  // striped awning valance strip (scalloped), cached per width / colours; hangs from y = 0 down ~0.2 m
  // 【遮阳篷垂边 valanceGeo】条纹扇形垂帘,按 宽/双色 缓存;从 y=0 下垂约 0.2 m
  function valanceGeo(W, cA, cB) {
    return tpl(['val', W, cA, cB].map(kf).join('|'), () => {
      const g = new GB(), n = Math.max(2, Math.round(W / 0.2)), sw = W / n, vh = 0.13, ca = cx3(cA), cb = cx3(cB);
      for (let i = 0; i < n; i++) {
        const c = i % 2 ? cb : ca, x0 = -W / 2 + i * sw, x1 = x0 + sw;
        const q = [g.v(x0, 0, 0, 0, 0, 1, ...c), g.v(x1, 0, 0, 0, 0, 1, ...c), g.v(x1, -vh, 0, 0, 0, 1, ...c), g.v(x0, -vh, 0, 0, 0, 1, ...c)];
        g.quad(q[0], q[1], q[2], q[3]);
        const cen = g.v((x0 + x1) / 2, -vh, 0, 0, 0, 1, ...c), arc = [];
        for (let k = 0; k <= 5; k++) { const t = PI + (k / 5) * PI; arc.push(g.v((x0 + x1) / 2 - Math.cos(t) * sw / 2, -vh + Math.sin(t) * sw * 0.4, 0, 0, 0, 1, ...c)); }
        for (let k = 0; k < 5; k++) g.tri(cen, arc[k], arc[k + 1]);
      }
      return g.geo();
    });
  }
  // 【卷帘遮阳篷 awningRolled】卷收盒+条纹垂帘,凸出 0.13 m
  // rolled-in awning: cassette box + striped scalloped valance (projects 0.13 m)
  function awningRolled(B, x, y, W, cA = K.fuelBlue, cB = K.white) {
    B.box('gloss', mixc(cA, K.white, 0.1), W + 0.06, 0.13, 0.12, x, y, 0.06, { round: true, r: 0.04 });
    for (const sx of [-1, 1]) B.box('metal', K.galvDk, 0.03, 0.18, 0.05, x + sx * (W / 2 + 0.05), y - 0.02, 0.025, { r: 0.01 });
    B.add('foliage', valanceGeo(W, cA, cB), 'white', x, y - 0.055, 0.125, {});
    B.cyl('metal', K.galv, 0.012, W, x, y - 0.06, 0.1, { rz: HP, seg: 6 });
  }
  // 【窗单元 windowUnit】带框窗(洞口 w×h,左下角在 x-w/2, y):内凹玻璃、方框料、倒角窗台,
  // 可选中梃/亮子、百叶(blind,可 lit 发光)、百叶窗板(shutters)
  // framed window (opening w × h, bottom-left at x - w/2, y): recessed glass, square frame members, bevelled sill,
  // optional mullions / transom / blind / louvred shutters
  function windowUnit(B, x, y, w, h, o = {}) {
    const fc = o.frame ?? K.frame, gc = o.glass ?? K.glass, t = o.t ?? 0.07, dz = o.dz ?? 0.06, P = o.ns ? NS('paint') : 'paint';
    pbox(B, NS('gloss'), gc, w, h, 0.02, x, y + h / 2, 0.012);
    pbox(B, P, fc, w + t * 2, t, dz, x, y + h + t / 2, dz / 2);
    pbox(B, P, fc, w + t * 2, t * 0.8, dz, x, y - t * 0.4, dz / 2);
    for (const sx of [-1, 1]) pbox(B, P, fc, t, h, dz, x + sx * (w / 2 + t / 2), y + h / 2, dz / 2);
    const nm = o.mull ?? (w > 1.1 ? Math.round(w / 0.8) - 1 : 0);
    for (let i = 1; i <= nm; i++) pbox(B, NS('paint'), fc, 0.04, h, 0.035, x - w / 2 + (i * w) / (nm + 1), y + h / 2, 0.035);
    if (o.transom) pbox(B, NS('paint'), fc, w, 0.04, 0.035, x, y + h * o.transom, 0.035);
    if (o.sill !== false) B.box(P, o.sillC ?? mixc(fc, K.concreteDk, 0.35), w + t * 2 + 0.08, 0.05, dz + 0.05, x, y - t * 0.8 - 0.025, (dz + 0.05) / 2, { r: 0.012 });
    if (o.blind) pbox(B, NS(o.lit ? 'glow' : 'paint'), o.lit ? '#ffdca0' : o.blind, w - 0.02, h * 0.34, 0.006, x, y + h * 0.83, 0.024, o.lit ? { glow: o.lit } : {});
    if (o.shutters) for (const sx of [-1, 1]) {
      const sw = w / 2 + 0.02, sxp = x + sx * (w / 2 + t + sw / 2 + 0.02);
      pbox(B, P, o.shutters, sw, h + 0.04, 0.035, sxp, y + h / 2, 0.02);
      for (let k = 1; k < 4; k++) pbox(B, NS('paint'), shade(o.shutters, 0.8), sw - 0.06, 0.014, 0.01, sxp, y + (k * h) / 4, 0.04);
    }
  }
  // 【门单元 doorUnit】玻璃门带框:踢板、推杆(pushbar)或执手、门槛;double 双扇
  // glazed door with frame, kick plate, push bar / handle, threshold
  function doorUnit(B, x, w, h, o = {}) {
    const fc = o.frame ?? K.frameDk, leaf = o.leaf ?? K.frameDk, gl = o.glass ?? K.glass, dbl = !!o.double;
    for (const sx of [-1, 1]) pbox(B, 'paint', fc, 0.08, h + 0.08, 0.07, x + sx * (w / 2 + 0.04), (h + 0.08) / 2, 0.035);
    pbox(B, 'paint', fc, w + 0.16, 0.08, 0.07, x, h + 0.04, 0.035);
    pbox(B, 'metal', K.galvDk, w + 0.1, 0.02, 0.1, x, 0.01, 0.03);
    const nl = dbl ? 2 : 1, lw = w / nl;
    for (let i = 0; i < nl; i++) {
      const lx = x - w / 2 + lw * (i + 0.5);
      B.box('paint', leaf, lw - 0.01, h - 0.01, 0.045, lx, h / 2, 0.022, { r: 0.012 });
      pbox(B, 'gloss', gl, lw - 0.16, h * (o.glassH ?? 0.62), 0.012, lx, h * 0.6, 0.047);
      pbox(B, 'metal', K.stainless, lw - 0.1, 0.16, 0.008, lx, 0.1, 0.048);
      const hx = dbl ? lx + (i ? -1 : 1) * (lw / 2 - 0.08) : lx + lw / 2 - 0.09;
      if (o.pushbar) B.cyl('metal', K.stainless, 0.016, lw * 0.7, lx, 1.0, 0.09, { rz: HP, seg: 6 });
      else { pbox(B, 'metal', K.stainless, 0.03, 0.14, 0.03, hx, 1.02, 0.07); pbox(B, 'metal', K.stainless, 0.1, 0.022, 0.03, hx - 0.03, 1.05, 0.09); }
    }
  }
  // 【招牌板 boardSign】贴墙招牌:底板按字宽自动定宽,凸字(可 lit 发光),返回板宽
  // flush sign board with raised letters (board centred at x, y); returns board width
  function boardSign(B, text, x, y, o = {}) {
    const h = o.h ?? 0.22, pad = o.pad ?? h * 0.7, W = o.w ?? textW(text, o.wt ?? 0.17, o.track ?? 0.12) * h + pad * 2, Hb = o.hb ?? h + pad * 1.1;
    B.box(o.boardMat ?? 'gloss', o.board ?? K.fuelBlue, W, Hb, o.bd ?? 0.05, x, y, (o.bd ?? 0.05) / 2 + (o.z ?? 0), { round: true, r: Math.min(0.04, Hb * 0.2) });
    if (o.border) B.box('paint', o.border, W - 0.05, Hb - 0.05, 0.004, x, y, (o.bd ?? 0.05) + (o.z ?? 0) + 0.001, { r: 0.01 });
    if (o.border) B.box(o.boardMat ?? 'gloss', o.board ?? K.fuelBlue, W - 0.09, Hb - 0.09, 0.006, x, y, (o.bd ?? 0.05) + (o.z ?? 0) + 0.002, { r: 0.01 });
    letters(B, text, { h, x, y: y - h / 2, z: (o.bd ?? 0.05) + (o.z ?? 0) + 0.004, c: o.c ?? K.white, wt: o.wt, track: o.track, mat: o.mat, dep: o.dep, glow: o.glow, lit: o.lit, litC: o.litC, bev: o.lit ? 0 : undefined });
    return W;
  }
  // 【灭火器箱 extinguisher】挂墙(z=0,凸出 0.1 m):红箱+玻璃门内可见瓶体+标签
  // fire-extinguisher cabinet (wall z = 0, 0.1 m proud): red box, glazed door showing the cylinder, label
  function extinguisher(B, x, y) {
    B.box('gloss', K.red, 0.3, 0.62, 0.1, x, y + 0.31, 0.05, { r: 0.02 });
    pbox(B, NS('gloss'), K.glassLt, 0.22, 0.44, 0.01, x, y + 0.34, 0.101);
    B.cyl(NS('gloss'), shade(K.red, 1.15), 0.06, 0.36, x, y + 0.32, 0.07, { seg: 10 });
    pbox(B, NS('paint'), K.white, 0.2, 0.06, 0.004, x, y + 0.075, 0.102);
    pbox(B, NS('metal'), K.stainless, 0.03, 0.08, 0.02, x + 0.12, y + 0.34, 0.105);
  }
  // 【道具 fuelhut:燃料小屋】围绕 w×d×h 方块(pos=块基座中心)做立面装修:-Z 门+遮阳篷+灭火器,
  // +Z 服务窗+卷帘篷,±X 窗+FUEL PRICES 价格牌(LED 数字),屋顶檐口/天沟/落水管,
  // 屋顶双面 FUEL·ICE·BAIT 招牌(带碰撞)+空调/风帽子道具;各立面用 face() 翻转到对应墙面
  // ---- fuel hut kit: dresses the `fuel-hut` block (w × d × h around pos), roof sign FUEL · ICE · BAIT with colliders
  D.fuelhut = {
    desc: 'Fuel-dock attendant hut dressing around a w × d × h block (pos = block base centre): door + awning (-Z), service hatch + awning (+Z), windows and FUEL PRICES boards (±X), roof trim, gutters + downpipes, double-sided FUEL · ICE · BAIT roof sign, rooftop AC and vent (roof pieces collide), extinguisher, NO SMOKING plates.',
    params: { w: 'm (3.4)', d: 'm (3.7)', h: 'm (2.7)', diesel: '1.89', unleaded: '2.14' }, variants: 1, mount: 'ground',
    build(B, o) {
      B.aoBase = null;
      const W = o.w ?? 3.4, Dd = o.d ?? 3.7, Hh = o.h ?? 2.7;
      // 【face 助手】把回调临时推入指定墙面局部系:side 0 +Z / 1 +X / 2 -Z / 3 -X;x 沿墙面、z 朝外
      const face = (side, fn) => { // side: 0 +Z, 1 +X, 2 -Z, 3 -X → local frame on that face (x along the face, z out)
        const ry = [0, HP, PI, -HP][side], off = side % 2 === 0 ? Dd / 2 : W / 2;
        B.push(Math.sin(ry) * off, 0, Math.cos(ry) * off, ry); fn(side % 2 === 0 ? W : Dd); B.pop();
      };
      // roof trim + gutters, corner beads
      for (let side = 0; side < 4; side++) face(side, (L) => {
        B.box('paint', K.fuelBlue, L + 0.12, 0.2, 0.06, 0, Hh - 0.02, 0.03, { r: 0.02 });
        B.box('paint', K.white, L + 0.13, 0.035, 0.07, 0, Hh + 0.09, 0.03, { r: 0.012 });
        B.box('paint', mixc(K.white, K.concreteDk, 0.3), L + 0.02, 0.1, 0.04, 0, 0.05, 0.02, { r: 0.012 });
      });
      // -Z (spawn side): door with rolled awning, window, extinguisher, plates
      face(2, (L) => {
        doorUnit(B, -0.75, 0.86, 2.02, { frame: K.fuelBlueDk, leaf: K.fuelBlue });
        awningRolled(B, -0.75, 2.36, 1.1);
        windowUnit(B, 0.72, 1.0, 1.1, 0.95, { frame: K.white, mull: 1, blind: '#e6ddc8', lit: 0.8 });
        B.decal('lb4', 0.34, 0.085, 0.72, 2.2, 0.012);
        extinguisher(B, 0.1, 0.55);
        B.decal('lb9', 0.3, 0.075, -0.75, 2.2, 0.075);
      });
      // +Z (pump side): service hatch with counter ledge + rolled awning
      face(0, (L) => {
        windowUnit(B, 0, 1.0, 1.5, 1.0, { frame: K.white, mull: 1, transom: 0.72 });
        B.box('wood', K.woodlight ?? 'woodlight', 1.7, 0.05, 0.12, 0, 0.975, 0.06, { r: 0.012 });
        awningRolled(B, 0, 2.36, 1.8);
        B.decal('lb11', 0.52, 0.13, 0, 0.62, 0.012);
        B.decal('ferry', 0.45, 0.3, 1.25, 1.55, 0.012);
      });
      // ±X: window + price board
      for (const side of [1, 3]) face(side, (L) => {
        windowUnit(B, -0.95, 1.05, 0.9, 0.9, { frame: K.white, mull: 0, blind: '#e6ddc8', lit: 0.8 });
        B.push(0.72, 0, 0);
        B.box('gloss', K.fuelBlueDk, 1.3, 1.02, 0.05, 0, 1.52, 0.025, { round: true, r: 0.03 });
        B.box('gloss', K.white, 1.2, 0.2, 0.012, 0, 1.9, 0.052, { r: 0.01 });
        letters(B, 'FUEL PRICES', { h: 0.085, x: 0, y: 1.857, z: 0.059, c: K.fuelBlueDk, flat: true, wt: 0.22, track: 0.1 });
        for (const [row, name, price, cc] of [[0, 'DIESEL', o.diesel ?? '1.89', K.fuelYel], [1, 'UNLEADED', o.unleaded ?? '2.14', '#4f9a57']]) {
          const yy = 1.58 - row * 0.3;
          B.box('paint', cc, 0.05, 0.2, 0.01, -0.56, yy, 0.052, { r: 0.006 });
          letters(B, name, { h: 0.06, x: -0.5, y: yy - 0.03, z: 0.052, c: K.white, flat: true, wt: 0.22, align: 'left' });
          B.box('gloss', '#15181d', 0.46, 0.22, 0.012, 0.3, yy, 0.052, { r: 0.008 });
          ledText(B, price, 0.13, yy - 0.075, 0.059, 0.15, K.led, 2.6);
        }
        B.pop();
        // downpipe at the corner
        B.cyl('paint', K.fuelBlueDk, 0.04, Hh - 0.25, L / 2 - 0.12, (Hh - 0.25) / 2 + 0.05, 0.06, { seg: 8 });
        B.cyl('paint', K.fuelBlueDk, 0.05, 0.12, L / 2 - 0.12, 0.06, 0.1, { rx: 0.9, seg: 8 });
        for (const yy of [0.7, 1.7]) pbox(B, 'metal', K.galvDk, 0.1, 0.03, 0.06, L / 2 - 0.12, yy, 0.03);
      });
      // roof: double-sided FUEL · ICE · BAIT sign on posts (collides), AC unit + vent (sub-props, collide)
      const sy = Hh, sz = -0.55;
      for (const sx of [-1.3, 1.3]) { B.box('metal', K.galvDk, 0.08, 0.36, 0.08, sx, sy + 0.18, sz, { r: 0.02 }); B.box('metal', K.galvDk, 0.2, 0.02, 0.2, sx, sy + 0.01, sz, { r: 0.006 }); }
      B.box('gloss', K.fuelBlue, 3.2, 0.6, 0.1, 0, sy + 0.62, sz, { round: true, r: 0.04 });
      B.box('paint', K.fuelYel, 3.2, 0.05, 0.11, 0, sy + 0.36, sz, { r: 0.015 });
      for (const f of [1, -1]) {
        B.push(0, 0, sz + f * 0.05, f > 0 ? 0 : PI);
        letters(B, 'FUEL · ICE · BAIT', { h: 0.25, x: 0, y: sy + 0.5, z: 0.003, c: K.white, flat: true, wt: 0.2, track: 0.1, mat: 'glow', glow: 0.9 });
        B.pop();
      }
      // 【碰撞】屋顶双面招牌整体一个实体盒(高出墙沿的悬空物,防攀爬判定)
      B.col(-1.62, sy, sz - 0.08, 1.62, sy + 0.94, sz + 0.08);
      sub(B, 'acunit', 0.75, sy, 0.95, 0, { variant: 1 });
      sub(B, 'vent', -1.0, sy, 1.1, 0, { variant: 2 });
    },
  };

  // 【道具 fueldocksign:FUEL DOCK 高杆地标】6.4 m 镀锌桅杆立于码头边(pos),悬臂朝局部 -X 伸到水面上方,
  // 挂双面发光牌(FUEL/DOCK+油枪图标,面朝 ±Z),鹅颈灯洗牌,桅顶风向旗;【碰撞】只有桅杆本体
  // ---- tall FUEL DOCK landmark: galvanised mast on the dock edge, cantilever arm over the water, lit double-sided panel
  D.fueldocksign = {
    desc: 'Tall FUEL DOCK landmark: 6.4 m galvanised mast on a bolted base at the dock edge (pos), cantilever arm toward local -X over the water carrying a double-sided lit panel (FUEL / DOCK + nozzle icon) facing ±Z, gooseneck lamps, wind pennant. Only the mast collides.',
    params: { reach: 'arm length m (2.2)' }, variants: 1, mount: 'ground',
    build(B, o) {
      const Hm = 6.4, reach = o.reach ?? 2.2, pc = K.galv;
      B.box('metal', K.galvDk, 0.44, 0.04, 0.44, 0, 0.02, 0, { r: 0.012 });
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { B.cyl('metal', K.galvDk, 0.022, 0.04, sx * 0.16, 0.055, sz * 0.16, { seg: 6 }); B.cyl('metal', K.galvDk, 0.012, 0.05, sx * 0.16, 0.08, sz * 0.16, { seg: 5 }); }
      B.lathe('metal', pc, [[0.13, 0.04], [0.12, 0.3], [0.1, 0.34], [0.1, Hm], [0.06, Hm + 0.04], [0, Hm + 0.05]], 0, 0, 0, { seg: 12 });
      for (const yy of [1.2, 3.2]) B.cyl('metal', K.galvDk, 0.108, 0.05, 0, yy, 0, { seg: 12, open: true });
      // arm + diagonal brace
      B.box('metal', pc, reach + 0.15, 0.12, 0.12, -reach / 2, Hm - 0.3, 0, { r: 0.02 });
      B.tube('metal', pc, [P3(0, Hm - 1.3, 0), P3(-reach * 0.7, Hm - 0.36, 0)], 0.035, { radial: 6 });
      // panel hanging from two rods
      const pw = 2.1, ph = 1.35, px = -reach + 0.95, py = Hm - 0.55 - 0.18 - ph / 2;
      for (const dx of [-0.75, 0.75]) B.cyl('metal', K.galvDk, 0.012, 0.18, px + dx, Hm - 0.45, 0, { seg: 5 });
      B.box('gloss', K.white, pw + 0.08, ph + 0.08, 0.1, px, py, 0, { round: true, r: 0.05 });
      for (const f of [1, -1]) {
        B.push(px, py, f * 0.052, f > 0 ? 0 : PI);
        B.box('gloss', K.fuelBlue, pw - 0.04, ph - 0.04, 0.012, 0, 0, 0.004, { r: 0.03 });
        letters(B, 'FUEL', { h: 0.46, x: 0.18, y: -0.02, z: 0.012, c: K.white, flat: true, wt: 0.21, track: 0.1, mat: 'glow', glow: 1.25 });
        letters(B, 'DOCK', { h: 0.24, x: 0.18, y: -0.42, z: 0.012, c: K.fuelYel, flat: true, wt: 0.22, track: 0.2, mat: 'glow', glow: 1.2 });
        // fuel-pump pictogram: pump body with display window, hose arcing to a nozzle
        B.push(-0.66, -0.06, 0.012);
        B.box('glow', K.white, 0.26, 0.42, 0.02, 0, 0, 0.012, { r: 0.03, glow: 1.25 });
        pbox(B, 'paint', K.fuelBlue, 0.15, 0.1, 0.01, 0, 0.1, 0.025);
        B.box('glow', K.white, 0.34, 0.05, 0.02, 0, -0.23, 0.012, { r: 0.012, glow: 1.25 });
        B.tube('glow', K.white, [P3(0.13, 0.12, 0.014), P3(0.21, 0.14, 0.014), P3(0.25, 0.04, 0.014), P3(0.25, -0.12, 0.014), P3(0.2, -0.15, 0.014)], 0.018, { radial: 4, glow: 1.25 });
        B.box('glow', K.white, 0.06, 0.1, 0.02, 0.23, 0.18, 0.012, { r: 0.015, glow: 1.25, rz: -0.35 });
        B.pop();
        B.pop();
        // gooseneck lamps washing the panel
        for (const dx of [-0.6, 0.6]) {
          B.tube('metal', K.galvDk, [P3(px + dx, Hm - 0.36, 0), P3(px + dx, Hm - 0.2, f * 0.25), P3(px + dx, Hm - 0.3, f * 0.5)], 0.016, { radial: 5 });
          B.cyl('paint', 'charcoal', 0.06, 0.08, px + dx, Hm - 0.34, f * 0.52, { seg: 8, rx: f * 0.6 });
          B.cyl('glow', K.lamp, 0.045, 0.01, px + dx, Hm - 0.38, f * 0.55, { seg: 8, rx: f * 0.6, glow: 2 });
        }
      }
      // pennant on the mast top
      B.cyl('metal', pc, 0.012, 0.6, 0, Hm + 0.3, 0, { seg: 5 });
      B.flag(0.0, Hm + 0.46, 0.0, { color: K.fuelYel, rz: HP, ry: PI, s: 1.7 });
      // 【碰撞】只有桅杆本体一个细盒;悬臂/招牌都在头顶,不设碰撞
      B.col(-0.16, 0, -0.16, 0.16, Hm, 0.16);
    },
  };

  // ================================================================================================ clubhouse
  // 【游艇会区】
  // wall lantern (wall z = 0): bracket, carriage lantern with a warm glowing glass
  // 【壁灯 lantern】挂墙(z=0):背板+ carriage 灯笼,暖色发光玻璃
  // flush marine bulkhead light (wall z = 0, 0.11 m proud): cast back plate, glowing half-dome lens, cage bars
  // 【舱壁灯】贴墙凸出 0.11 m:铸造背板、发光半球罩、护栅条
  function lantern(B, x, y) {
    B.box('metal', K.club, 0.2, 0.2, 0.03, x, y, 0.015, { r: 0.012 });
    B.cyl('metal', K.club, 0.085, 0.03, x, y, 0.035, { rx: HP, seg: 10 });
    B.sph('glow', K.lamp, 0.07, x, y, 0.045, { ws: 10, hs: 4, half: true, rx: HP, glow: 1.7 });
    for (const a of [0, HP]) pbox(B, 'metal', K.club, 0.15, 0.014, 0.014, x, y, 0.1, { rz: a });
  }
  // 【坡屋顶 gableRoof】覆盖 x0..x1 × z0..z1(屋脊沿 X,檐口 yE,起坡 r):山墙三棱柱 + 两扇石板瓦 + 屋脊压顶
  // pitched roof over x0..x1 × z0..z1 (ridge along X, eaves at yE, rise r): gable prism + two slate slabs + ridge cap
  function gableRoof(B, x0, x1, z0, z1, yE, r, o = {}) {
    const L = x1 - x0, cx = (x0 + x1) / 2, d = z1 - z0, cz = (z0 + z1) / 2, rc = o.roof ?? '#5f6d7c', ov = o.ov ?? 0.18;
    B.add('paint', tpl(['gprism', d, r].map(kf).join('|'), () => extrudeGeo([[-d / 2, 0], [d / 2, 0], [0, r]], 1, 0.001)), o.wall ?? K.render, cx, yE, cz, { sx: L });
    const pitch = Math.atan2(r, d / 2), sl = Math.hypot(r, d / 2) + ov, t = 0.13;
    for (const s of [-1, 1]) {
      B.push(cx, yE + r / 2, cz + (s * d) / 4, 0, s * pitch);
      B.box('paint', rc, L + ov * 2, t, sl, 0, t / 2 + 0.01, s * (ov / 2 - 0.0), { r: 0.03 });
      if (o.seams) for (let x = -L / 2 + 0.3; x < L / 2 - 0.1; x += o.seams) pbox(B, 'paint', shade(rc, 1.12), 0.035, 0.03, sl - 0.06, x, t + 0.02, 0);
      B.pop();
      B.box('metal', K.galvDk, L + ov * 2, 0.08, 0.1, cx, yE - 0.02, cz + s * (d / 2 + ov * 0.7), { r: 0.03 });
    }
    B.box('paint', shade(rc, 0.8), L + ov * 2, 0.1, 0.22, cx, yE + r + 0.07, cz, { r: 0.04 });
  }
  // 【道具 clubhouse:HALYARD MARINA 游艇会】pos = 可玩墙面中心(局部 z=0 即墙面,建筑在其后):
  // 一层门面(THE GALLEY 咖啡座 + CHANDLERY 船具店、会所落地窗、壁灯、卷帘篷、檐口)、
  // 二层+双翼坡屋顶+中央山墙楼阁大招牌(HALYARD MARINA·YACHT CLUB 发光字)+穹顶瞭望亭+
  // 海事旗杆(斜桁+横桁+燕尾旗/信号旗)+烟囱,以及墙后供外景看的低层背面与码头延伸;
  // 除 ≤0.1 m 的贴墙饰条外 z=0 之前不放任何东西,二层及以上设防相机碰撞
  D.clubhouse = {
    desc: 'HALYARD MARINA yacht club (pos = centre of the back wall face, local z = 0 is the wall face, building behind it): ground-floor fittings on the playable wall (THE GALLEY café + CHANDLERY shopfronts, clubroom French doors behind the terrace, lanterns, rolled awnings, cornice), upper storey + roofs + central gabled pavilion with the big HALYARD MARINA · YACHT CLUB sign, cupola, nautical flagstaff with burgee + signal pennants, chimneys, and the lower building + quay extension behind the wall for outside views. Upper storey collides (camera-safe); nothing sits in front of z = 0 except flush trims ≤ 0.1 m.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      B.aoBase = null;
      const FZ = -0.2, BZ = -6.1, WT = 4.6, EW = 7.7, EP = 9.4, render = K.render, trim = '#f7f4ee', navy = K.club, gold = K.clubGold;
      // ---------------- ground floor fittings on the playable wall face
      // cornice along the wall top hides the seam to the upper storey
      B.box('paint', trim, 48.2, 0.2, 0.28, 0, WT - 0.02, -0.06, { r: 0.04 });
      B.box('paint', shade(trim, 0.92), 48.2, 0.06, 0.2, 0, WT - 0.15, -0.02, { r: 0.02 });
      // plinth band at the foot of the wings
      for (const [a, b] of [[-24, -8.5], [8.5, 24]]) B.box('paint', mixc(render, K.concreteDk, 0.45), b - a, 0.32, 0.06, (a + b) / 2, 0.16, 0.03, { r: 0.015 });
      // THE GALLEY café (left wing, x -17.2 … -8.7)
      windowUnit(B, -16.0, 0.62, 1.8, 2.0, { frame: trim, mull: 1, transom: 0.74, blind: '#efe2c4', lit: 0.85 });
      windowUnit(B, -9.9, 0.62, 1.6, 2.0, { frame: trim, mull: 1, transom: 0.74, blind: '#efe2c4', lit: 0.85 });
      doorUnit(B, -12.95, 1.7, 2.45, { double: true, frame: navy, leaf: navy, pushbar: true, glassH: 0.7 });
      for (const [x, w] of [[-16.0, 2.1], [-12.95, 2.0], [-9.9, 1.9]]) awningRolled(B, x, 2.98, w, navy, trim);
      for (const [x, y, n] of [[-16.55, 1.7, 'menu'], [-9.45, 1.55, 'pst11'], [-15.4, 1.5, 'chalk2']]) B.decal(n, n === 'pst11' ? 0.36 : 0.44, n === 'pst11' ? 0.54 : 0.32, x, y, 0.024);
      boardSign(B, 'THE GALLEY', -12.95, 3.72, { h: 0.3, board: navy, c: '#6e5530', bd: 0.05, pad: 0.22, wt: 0.18, track: 0.14, lit: 1.3, litC: gold });
      for (const x of [-17.55, -14.35, -11.45, -8.75]) lantern(B, x, 2.3);
      // back door + meter cabinet behind the kiosk, downpipes
      doorUnit(B, -20.2, 0.95, 2.1, { frame: shade(render, 0.8), leaf: '#8a939c', glassH: 0.25 });
      B.box('paint', '#c9c3b6', 0.7, 0.9, 0.1, -18.6, 1.1, 0.05, { r: 0.02 });
      B.decal('lb0', 0.34, 0.085, -18.6, 1.3, 0.102);
      for (const x of [-23.7, -8.95, 8.95, 23.7]) { B.cyl('paint', shade(trim, 0.9), 0.055, WT - 0.3, x, (WT - 0.3) / 2, 0.08, { seg: 8 }); for (const yy of [1.0, 2.6, 3.9]) pbox(B, 'metal', K.galvDk, 0.14, 0.035, 0.1, x, yy, 0.05); }
      // CHANDLERY (right wing, x 8.7 … 14.3)
      windowUnit(B, 10.6, 0.62, 2.6, 2.0, { frame: trim, mull: 2, transom: 0.74, blind: '#efe2c4', lit: 0.85 });
      doorUnit(B, 13.35, 1.0, 2.35, { frame: navy, leaf: navy, glassH: 0.7 });
      awningRolled(B, 10.6, 2.98, 2.9, navy, trim); awningRolled(B, 13.35, 2.98, 1.2, navy, trim);
      for (const [x, y, n] of [[9.8, 1.6, 'pst4'], [11.55, 1.5, 'pst8'], [10.7, 0.95, 'lb11']]) B.decal(n, n === 'lb11' ? 0.6 : 0.36, n === 'lb11' ? 0.15 : 0.54, x, y, 0.024);
      boardSign(B, 'CHANDLERY', 11.5, 3.72, { h: 0.28, board: navy, c: '#6e5530', bd: 0.05, pad: 0.2, wt: 0.18, track: 0.14, lit: 1.3, litC: gold });
      for (const x of [9.05, 12.25, 14.2]) lantern(B, x, 2.3);
      // strip above the boathouse roof (y 3.2 … 4.6) + east end
      for (const x of [16.2, 20.8]) windowUnit(B, x, 3.52, 1.0, 0.72, { frame: trim, mull: 1, sill: false });
      // clubroom glazing behind the terrace (terrace floor y = 2.4)
      B.push(0, 2.4, 0);
      for (const x of [-6.6, -3.3, 0, 3.3, 6.6]) doorUnit(B, x, 1.2, 1.9, { double: true, frame: trim, leaf: trim, glass: K.glassLt, glassH: 0.78 });
      B.pop();
      B.box('metal', K.galvDk, 17.2, 0.03, 0.08, 0, 2.415, 0.04, { r: 0.01 });
      for (const x of [-4.95, -1.65, 1.65, 4.95]) lantern(B, x, 3.9);
      // club crest plaques either side of the centre doors
      for (const sx of [-1, 1]) { B.cyl('gloss', navy, 0.28, 0.04, sx * 8.0, 3.35, 0.02, { rx: HP, seg: 18 }); B.cyl('gloss', gold, 0.22, 0.012, sx * 8.0, 3.35, 0.045, { rx: HP, seg: 18 }); B.cyl('gloss', navy, 0.18, 0.014, sx * 8.0, 3.35, 0.05, { rx: HP, seg: 18 }); letters(B, 'HM', { h: 0.14, x: sx * 8.0, y: 3.28, z: 0.055, c: gold, flat: true, wt: 0.22, track: 0.06 }); }

      // ---------------- upper storey (facade plane z = FZ), weatherboards, windows with shutters
      B.box('paint', render, 48, EW - WT, 5.9, 0, (WT + EW) / 2, (FZ + BZ) / 2, { r: 0.05 });
      for (let y = WT + 0.3; y < EW - 0.1; y += 0.23) pbox(B, NS('paint'), shade(render, 0.9), 48, 0.018, 0.02, 0, y, FZ + 0.005);
      for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
        const x = sx * (10.9 + i * 2.85);
        windowUnit(B, x, 5.25, 1.05, 1.55, { frame: trim, mull: 1, transom: 0.66, dz: 0.07, shutters: navy, sillC: trim });
      }
      // corner boards + eaves fascia + gutter/downpipes on the wings
      for (const x of [-24, 24]) B.box('paint', trim, 0.22, EW - WT + 0.3, 0.2, x - Math.sign(x) * 0.09, (WT + EW) / 2, FZ - 0.08, { r: 0.03 });
      B.box('paint', trim, 48.2, 0.24, 0.18, 0, EW - 0.12, FZ - 0.06, { r: 0.03 });
      gableRoof(B, -24.2, -9.0, BZ - 0.1, FZ, EW, 1.75, { roof: '#5f6d7c', ov: 0.16 });
      gableRoof(B, 9.0, 24.2, BZ - 0.1, FZ, EW, 1.75, { roof: '#5f6d7c', ov: 0.16 });
      // wing gable ends at x = ±24 get a round vent
      for (const sx of [-1, 1]) { B.cyl('paint', trim, 0.36, 0.08, sx * 24.08, EW + 0.62, (FZ + BZ) / 2, { rz: HP, seg: 16 }); B.cyl('paint', navy, 0.28, 0.02, sx * 24.13, EW + 0.62, (FZ + BZ) / 2, { rz: HP, seg: 16 }); }
      // chimneys
      for (const [x, z] of [[-17.5, -4.2], [18.5, -4.4]]) {
        B.box('paint', '#b36d58', 0.9, 2.2, 0.7, x, EW + 1.3, z, { r: 0.04 });
        B.box('paint', shade('#b36d58', 0.85), 1.02, 0.14, 0.82, x, EW + 2.4, z, { r: 0.03 });
        for (const dx of [-0.2, 0.2]) B.cyl('paint', '#8c4c3c', 0.1, 0.34, x + dx, EW + 2.62, z, { seg: 10 });
      }
      // ---------------- central pavilion: taller block, front gable, the big sign
      const PW = 9.1, PE = 9.6, PR = 2.1;
      B.box('paint', render, PW * 2, PE - EW + 0.1, 6.1, 0, (EW + PE) / 2, (FZ + BZ) / 2 - 0.1, { r: 0.05 });
      B.box('paint', render, PW * 2, EW - WT, 0.12, 0, (WT + EW) / 2, FZ + 0.02, { r: 0.03 });
      for (let y = EW + 0.25; y < PE - 0.1; y += 0.23) pbox(B, NS('paint'), shade(render, 0.9), PW * 2, 0.018, 0.02, 0, y, FZ + 0.005);
      for (const sx of [-1, 1]) B.box('paint', trim, 0.24, PE - WT, 0.24, sx * (PW - 0.02), (WT + PE) / 2, FZ - 0.06, { r: 0.04 });
      // sign fascia: navy band with gold channel letters, lit edge
      B.box('gloss', navy, 13.6, 1.7, 0.08, 0, 5.95, FZ + 0.04, { round: true, r: 0.05 });
      B.box('paint', gold, 13.4, 0.04, 0.012, 0, 6.72, FZ + 0.086, { r: 0.004 });
      B.box('paint', gold, 13.4, 0.04, 0.012, 0, 5.18, FZ + 0.086, { r: 0.004 });
      letters(B, 'HALYARD MARINA', { h: 0.84, x: 0, y: 5.66, z: FZ + 0.085, c: '#6e5530', mat: 'gloss', dep: 0.1, bev: 0, wt: 0.17, track: 0.09, lit: 1.3, litC: gold });
      letters(B, 'YACHT CLUB', { h: 0.25, x: 0, y: 5.3, z: FZ + 0.085, c: '#8a8578', mat: 'gloss', dep: 0.12, bev: 0, wt: 0.2, track: 0.34, lit: 0.86, litC: trim });
      // burgee emblems either side of the name (flat swallowtail pennants on staffs)
      for (const sx of [-1, 1]) {
        B.push(sx * 6.35, 5.95, FZ + 0.09, 0);
        B.cyl('metal', gold, 0.018, 1.0, 0, 0, 0, { seg: 6 });
        B.add('paint', tpl('burgee', () => { const g = new GB(); const cR = cx3('#c9453b'), cW = cx3('#f2eee6'); const q = [[0, 0.42], [0.62, 0.3], [0.44, 0.21], [0.62, 0.12], [0, 0]]; const ids = q.map(([x, y]) => g.v(x, y, 0, 0, 0, 1, ...cR)); g.tri(ids[0], ids[1], ids[2]); g.tri(ids[0], ids[2], ids[4]); g.tri(ids[2], ids[3], ids[4]); const w = [[0.08, 0.3], [0.26, 0.21], [0.08, 0.12]].map(([x, y]) => g.v(x, y, 0.002, 0, 0, 1, ...cW)); g.tri(w[0], w[1], w[2]); return g.geo(); }), 'white', 0, 0.08, 0.01, { sx: sx * 1.1, s: 1.1 });
        B.pop();
      }
      // arched windows above the sign
      for (const x of [-4.2, 0, 4.2]) {
        windowUnit(B, x, 6.98, 1.4, 1.45, { frame: trim, mull: 1, transom: 0.62, dz: 0.07, sill: true, sillC: trim });
        B.tube('paint', trim, arcPts(x, 8.5, FZ + 0.05, 0.78, 0.06, PI - 0.06, 10), 0.07, { radial: 6 });
        B.sph('paint', gold, 0.07, x, 9.3, FZ + 0.1, { ws: 8, hs: 6 });
      }
      // front gable (ridge along Z) with an oculus
      B.push(0, PE, (FZ + BZ) / 2 - 0.1, HP);
      B.add('paint', tpl('pgable', () => extrudeGeo([[-PW, 0], [PW, 0], [0, PR]], 1, 0.001)), render, 0, 0, 0, { sx: 6.1 });
      const pp = Math.atan2(PR, PW), psl = Math.hypot(PR, PW) + 0.2;
      for (const s of [-1, 1]) { B.push(0, PR / 2, (s * PW) / 2, 0, s * pp); B.box('paint', '#56636f', 6.4, 0.14, psl, 0, 0.08, 0, { r: 0.03 }); for (let x = -2.9; x <= 2.9; x += 0.58) pbox(B, 'paint', '#6b7885', 0.035, 0.035, psl - 0.05, x, 0.17, 0); B.pop(); }
      B.box('paint', '#4a5560', 6.5, 0.12, 0.26, 0, PR + 0.08, 0, { r: 0.04 });
      B.pop();
      for (const s of [-1, 1]) { B.push(s * PW / 2, PE + PR / 2, FZ + 0.06, 0, 0, -s * Math.atan2(PR, PW)); B.box('paint', trim, Math.hypot(PR, PW) + 0.3, 0.22, 0.16, 0, 0, 0, { r: 0.03 }); B.pop(); }
      B.box('paint', trim, PW * 2 + 0.3, 0.22, 0.18, 0, PE - 0.02, FZ - 0.04, { r: 0.03 });
      B.cyl('paint', trim, 0.62, 0.12, 0, PE + 0.85, FZ + 0.0, { rx: HP, seg: 24 });
      B.cyl('gloss', K.glass, 0.5, 0.05, 0, PE + 0.85, FZ + 0.04, { rx: HP, seg: 24 });
      for (const a of [0, HP]) pbox(B, 'paint', trim, 1.0, 0.05, 0.05, 0, PE + 0.85, FZ + 0.07, { rz: a });
      // ---------------- cupola / lookout + nautical flagstaff (gaff + yardarm, burgee + signal pennants)
      const CY = PE + PR - 0.3, cz = (FZ + BZ) / 2 - 0.1;
      B.box('paint', trim, 1.9, 0.5, 1.9, 0, CY + 0.25, cz, { r: 0.04 });
      B.box('paint', render, 1.6, 1.3, 1.6, 0, CY + 1.15, cz, { r: 0.03 });
      for (let side = 0; side < 4; side++) { const a = (side * PI) / 2; B.push(Math.sin(a) * 0.81, 0, cz + Math.cos(a) * 0.81, a); windowUnit(B, 0, CY + 0.72, 0.95, 0.8, { frame: trim, mull: 1, dz: 0.05, sill: false, glass: K.glassLt }); B.pop(); }
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('paint', trim, 0.14, 1.36, 0.14, sx * 0.8, CY + 1.15, cz + sz * 0.8, { r: 0.03 });
      B.box('paint', trim, 1.95, 0.14, 1.95, 0, CY + 1.86, cz, { r: 0.04 });
      B.lathe('gloss', '#6fa08e', [[1.28, 0], [0.9, 0.35], [0.35, 0.95], [0.09, 1.2], [0, 1.24]], 0, CY + 1.93, cz, { seg: 4, ry: PI / 4 });
      B.sph('metal', gold, 0.1, 0, CY + 3.2, cz, { ws: 10, hs: 6 });
      // weather vane
      B.cyl('metal', '#3a3f48', 0.02, 0.9, 0, CY + 3.6, cz, { seg: 5 });
      for (const a of [0, HP]) pbox(B, 'metal', '#3a3f48', 0.5, 0.012, 0.012, 0, CY + 3.45, cz, { ry: a });
      B.push(0, CY + 3.85, cz, 0.6); B.add('paint', tpl('vane', () => extrudeGeo([[-0.34, 0], [0.26, 0], [0.34, 0.08], [0.26, 0.16], [-0.26, 0.16], [-0.34, 0.26], [-0.3, 0.08]], 0.01, 0.002)), '#3a3f48', 0, 0, 0, { ry: HP }); B.pop();
      // flagstaff on the roof ridge of the east wing (landmark mast with gaff + yardarm)
      const MX = 15.5, MZ = (FZ + BZ) / 2, MY = EW + 1.7;
      B.lathe('metal', trim, [[0.14, 0], [0.11, 0.3], [0.09, 1.0], [0.06, 7.2], [0.04, 7.4], [0, 7.42]], MX, MY, MZ, { seg: 10 });
      B.sph('metal', gold, 0.1, MX, MY + 7.5, MZ, { ws: 10, hs: 6 });
      B.cyl('metal', trim, 0.035, 3.2, MX, MY + 5.6, MZ, { rz: HP, seg: 6 });
      B.push(MX, MY + 4.6, MZ, 0, 0, -0.9); B.cyl('metal', trim, 0.03, 2.2, 0, 1.1, 0, { seg: 6 }); B.pop();
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) B.flag(MX + sx * (0.5 + k * 0.45), MY + 5.55 - k * 0.3, MZ, { color: ['#c9453b', '#f2eee6', '#3f6fb0', '#e3b23c', '#2f5f9e', '#c9453b'][k + (sx > 0 ? 3 : 0)], s: 1.2 });
      B.flag(MX, MY + 7.3, MZ, { color: '#c9453b', rz: HP, s: 2.0 });
      B.flag(MX - 1.62, MY + 5.92, MZ, { color: navy, rz: HP, s: 1.6 });
      for (const sx of [-1, 1]) B.tube('paint', '#e8e2d0', [P3(MX, MY + 7.3, MZ), P3(MX + sx * 1.6, MY + 5.62, MZ + 0.01)], 0.008, { radial: 3 });
      // ---------------- the building behind the wall (outside views): lower walls, quay extension, back
      for (const sx of [-1, 1]) {
        B.box(NS('paint'), render, 0.2, WT, 5.6, sx * 23.88, WT / 2, (-0.6 + BZ) / 2, { r: 0.03 });
        B.push(sx * 24, 0, (-0.6 + BZ) / 2, sx * HP);
        windowUnit(B, -1.2, 1.2, 1.0, 1.4, { frame: trim, mull: 1, shutters: navy });
        windowUnit(B, 1.4, 1.2, 1.0, 1.4, { frame: trim, mull: 1, shutters: navy });
        B.pop();
      }
      B.box(NS('paint'), render, 48, WT, 0.2, 0, WT / 2, BZ + 0.1, { r: 0.03 });
      B.box(NS('paint'), mixc(K.concrete, '#dccbb0', 0.4), 48, 1.2, 5.95, 0, -0.6, -3.575, { r: 0.04 });
      // back + gable-end windows (seen from outside the arena)
      B.push(0, 0, BZ - 0.1, PI);
      for (let x = -21; x <= 21.1; x += 3.5) { windowUnit(B, x, 5.3, 1.0, 1.4, { frame: trim, mull: 1, sill: false, ns: true }); windowUnit(B, x + 1.75, 1.3, 1.0, 1.5, { frame: trim, mull: 0, sill: false, ns: true }); }
      doorUnit(B, -1.75, 1.6, 2.3, { double: true, frame: navy, leaf: navy });
      B.pop();
      for (const sx of [-1, 1]) { B.push(sx * 24.02, 0, (FZ + BZ) / 2, sx * HP); for (const x of [-1.5, 1.5]) windowUnit(B, x, 5.3, 1.0, 1.4, { frame: trim, mull: 1, sill: false, ns: true }); B.pop(); }
      // colliders: upper storey + pavilion + cupola/mast (camera-safe, all behind the wall face)
      // 【碰撞】二层整层/楼阁/穹顶瞭望亭均标 roof(禁入顶面,站上去会滑走);全部位于墙面 z=FZ 之后,相机安全
      B.col(-24.3, WT, BZ - 0.3, 24.3, EW + 1.75, FZ, { roof: true });   // roofs: off limits (slide off)
      B.col(-PW, EW, BZ - 0.2, PW, PE + PR, FZ, { roof: true });
      B.col(-1.0, PE + PR - 0.3, cz - 1.0, 1.0, CY + 3.2, cz + 1.0, { roof: true });
    },
  };

  // ================================================================================================ quay buildings
  // 【码头建筑区】
  // face helper for block dressings: side 0 +Z, 1 +X, 2 -Z, 3 -X → frame on that face (x along the face, z out)
  // 【onFace 助手】方块立面装修通用:把回调临时推入指定墙面局部系(同 clubhouse 的 face)
  function onFace(B, W, Dd, side, fn) {
    const ry = [0, HP, PI, -HP][side], off = side % 2 === 0 ? Dd / 2 : W / 2;
    B.push(Math.sin(ry) * off, 0, Math.cos(ry) * off, ry); fn(side % 2 === 0 ? W : Dd); B.pop();
  }
  // 【blockTrim】平屋顶方块的檐口条+转角线脚+底部裙边(可按面挑选)
  // roof edge trim + corner beads + skirt for a flat-roofed block (W × Dd × Hh)
  function blockTrim(B, W, Dd, Hh, c, sides = [0, 1, 2, 3]) {
    for (const side of sides) onFace(B, W, Dd, side, (L) => {
      B.box('paint', c, L + 0.1, 0.16, 0.05, 0, Hh - 0.02, 0.025, { r: 0.015 });
      pbox(B, 'paint', shade(c, 1.12), L + 0.12, 0.04, 0.06, 0, Hh + 0.07, 0.025);
      pbox(B, 'paint', mixc(c, K.concreteDk, 0.5), L + 0.02, 0.12, 0.035, 0, 0.06, 0.017);
    });
  }
  // 【落水管 downpipe】墙面上固定卡子+底部弯口
  function downpipe(B, x, Hh, c) {
    B.cyl('paint', c, 0.045, Hh - 0.3, x, (Hh - 0.3) / 2 + 0.08, 0.07, { seg: 8 });
    B.cyl('paint', c, 0.055, 0.14, x, 0.08, 0.12, { rx: 0.95, seg: 8 });
    B.box('paint', c, 0.16, 0.08, 0.14, x, Hh - 0.16, 0.07, { r: 0.02 });
    for (const yy of [0.8, Hh - 0.8]) pbox(B, 'metal', K.galvDk, 0.12, 0.03, 0.08, x, yy, 0.04);
  }

  // 【道具 boathouse:船屋】围绕 W×D×H 方块:正面肋板卷帘门(导轨+卷筒盒+警示边+KEEP CLEAR)、
  // 行人门、BOATHOUSE 凸字、侧窗、檐沟/落水管;屋顶套件(风帽、采光顶、太阳能板)带碰撞
  // ---- boathouse: roller door + pedestrian door + BOATHOUSE letters on the front, windows, roof kit (collides)
  D.boathouse = {
    desc: 'Boathouse dressing around a W × D × H block (pos = block base centre): big ribbed roller door with guide rails + drum box + hazard edges + KEEP CLEAR, pedestrian door, BOATHOUSE letters, side windows, gutters/downpipes, roof trim; roof kit (turbine vents, glazed rooflight, solar panels) collides.',
    params: { w: 'm (8)', d: 'm (4.8)', h: 'm (3.2)' }, variants: 1, mount: 'ground',
    build(B, o) {
      B.aoBase = null;
      const W = o.w ?? 8, Dd = o.d ?? 4.8, Hh = o.h ?? 3.2, trim = K.white, dk = '#2f4a52';
      blockTrim(B, W, Dd, Hh, trim, [0, 1, 3]);
      onFace(B, W, Dd, 0, (L) => {
        // roller door (4.3 × 2.7) at x -0.7
        const dx = -0.7, dw = 4.3, dh = 2.36;
        for (const sx of [-1, 1]) { pbox(B, 'metal', K.galvDk, 0.12, dh + 0.1, 0.1, dx + sx * (dw / 2 + 0.06), (dh + 0.1) / 2, 0.05); B.decal('hazard', dh * 0.42, 0.1, dx + sx * (dw / 2 + 0.06), dh * 0.23, 0.101, { rz: HP, tint: K.fuelYel }); }
        B.box('metal', K.galvDk, dw + 0.36, 0.3, 0.12, dx, dh + 0.18, 0.06, { r: 0.03 });
        pbox(B, 'metal', K.galv, dw, dh, 0.03, dx, dh / 2, 0.02);
        for (let y = 0.12; y < dh - 0.02; y += 0.105) pbox(B, 'metal', shade(K.galv, 0.82), dw, 0.016, 0.012, dx, y, 0.038);
        pbox(B, 'metal', K.galvDk, dw, 0.06, 0.05, dx, 0.03, 0.03);
        for (const hx of [-1.1, 1.1]) pbox(B, 'metal', 'charcoal', 0.18, 0.04, 0.04, dx + hx, 0.3, 0.05);
        B.decal('lb6', 0.5, 0.125, dx, 1.3, 0.042);
        // pedestrian door + number plate, lantern, BOATHOUSE letters
        doorUnit(B, 2.85, 0.9, 2.1, { frame: dk, leaf: dk, glassH: 0.3 });
        lantern(B, 2.1, 2.2);
        letters(B, 'BOATHOUSE', { h: 0.24, x: dx, y: 2.78, z: 0.004, c: K.club, dep: 0.12, wt: 0.2, track: 0.16 });
        downpipe(B, L / 2 - 0.12, Hh, trim);
      });
      for (const side of [1, 3]) onFace(B, W, Dd, side, (L) => {
        windowUnit(B, -0.9, 1.1, 1.2, 1.05, { frame: trim, mull: 1, blind: '#d9e1dc' });
        windowUnit(B, 1.0, 1.1, 1.2, 1.05, { frame: trim, mull: 1 });
        downpipe(B, -L / 2 + 0.14, Hh, trim);
      });
      // roof kit
      const y = Hh;
      sub(B, 'vent', -2.6, y, -1.2, 0, { variant: 1 });
      sub(B, 'vent', 1.6, y, -1.3, 0, { variant: 2 });
      // glazed rooflight
      B.box('paint', trim, 1.6, 0.28, 1.0, -0.4, y + 0.14, 0.4, { r: 0.03 });
      B.push(-0.4, y + 0.28, 0.4, 0, -0.18); pbox(B, 'gloss', K.glassLt, 1.5, 0.04, 0.9, 0, 0.02, 0); for (let i = -2; i <= 2; i++) pbox(B, 'paint', trim, 0.03, 0.05, 0.92, i * 0.3, 0.03, 0); B.pop();
      // 【碰撞】采光顶一个实体盒(可站立的屋面凸起)
      B.col(-1.22, y, -0.12, 0.42, y + 0.45, 0.92);
      // solar panels on a low frame
      for (let i = 0; i < 3; i++) {
        B.push(2.2 + (i - 1) * 0.02, y + 0.25, 1.05 - i * 0.02 + 0, 0, 0.3);
        pbox(B, 'metal', K.galvDk, 1.0, 0.04, 0.62, 0 + (i - 1) * 1.05, 0, 0);
        pbox(B, 'gloss', '#243248', 0.96, 0.02, 0.58, (i - 1) * 1.05, 0.03, 0);
        for (let k = -1; k <= 1; k++) pbox(B, 'paint', '#6f7d90', 0.006, 0.022, 0.56, (i - 1) * 1.05 + k * 0.24, 0.04, 0);
        B.pop();
      }
      for (const sx of [-1, 1]) for (const sz of [0.8, 1.35]) pbox(B, 'metal', K.galvDk, 0.04, 0.3, 0.04, 2.2 + sx * 1.45, y + 0.12, sz);
      // 【碰撞】太阳能板阵列一个实体盒
      B.col(0.6, y, 0.7, 3.8, y + 0.45, 1.5);
    },
  };

  // 【道具 harbouroffice:港口办公室】围绕 W×D×H 方块:+X 服务窗+卷帘篷+柜台+铜铃、HARBOUR OFFICE 楣字、
  // 软木告示板(船期表/告示)、+Z 门+窗、-X 窗、屋顶天线桅杆(闪烁灯)+碟形天线+旗杆(屋顶件带碰撞)
  // ---- harbour office kiosk: service window + awning + counter, notice board, door, HARBOUR OFFICE fascia, roof kit
  D.harbouroffice = {
    desc: 'Harbour-office kiosk dressing around a W × D × H block (pos = block base centre): service window with rolled awning, counter and bell on +X, HARBOUR OFFICE fascia letters, notice board with notices, door + window on +Z, window on -X, roof trim, antenna mast with blinking light + dish + flagpole (roof pieces collide).',
    params: { w: 'm (4.8)', d: 'm (3.4)', h: 'm (2.8)' }, variants: 1, mount: 'ground',
    build(B, o) {
      B.aoBase = null;
      const W = o.w ?? 4.8, Dd = o.d ?? 3.4, Hh = o.h ?? 2.8, trim = K.club;
      blockTrim(B, W, Dd, Hh, trim, [0, 1, 3]);
      onFace(B, W, Dd, 1, (L) => {
        windowUnit(B, -0.35, 0.95, 1.5, 1.1, { frame: K.white, mull: 1, transom: 0.7 });
        B.box('wood', 'woodlight', 1.7, 0.05, 0.12, -0.35, 0.93, 0.06, { r: 0.012 });
        B.cyl('metal', '#c9a24b', 0.04, 0.03, 0.2, 0.97, 0.08, { seg: 10 }); B.sph('metal', '#c9a24b', 0.035, 0.2, 0.995, 0.08, { ws: 8, hs: 4, half: true });
        awningRolled(B, -0.35, 2.3, 1.8, K.club, K.white);
        B.box('gloss', K.white, L - 0.3, 0.34, 0.04, 0, Hh - 0.3, 0.02, { round: true, r: 0.03 });
        letters(B, 'HARBOUR OFFICE', { h: 0.16, x: 0, y: Hh - 0.38, z: 0.043, c: K.club, flat: true, wt: 0.22, track: 0.14 });
        // notice board: framed cork with pinned notices + ferry times
        B.box('wood', 'wooddark', 0.95, 0.75, 0.05, 1.35, 1.45, 0.025, { r: 0.015 });
        pbox(B, 'paint', '#b98f62', 0.85, 0.65, 0.01, 1.35, 1.45, 0.052);
        B.decal('ferry', 0.36, 0.24, 1.14, 1.58, 0.059);
        B.decal('pst9', 0.2, 0.3, 1.55, 1.5, 0.059, { rz: 0.04 });
        B.decal('pst10', 0.18, 0.27, 1.62, 1.28, 0.06, { rz: -0.06 });
        B.decal('pst2', 0.17, 0.25, 1.1, 1.27, 0.06, { rz: 0.05 });
        downpipe(B, -L / 2 + 0.12, Hh, trim);
      });
      onFace(B, W, Dd, 0, (L) => {
        doorUnit(B, -1.2, 0.9, 2.1, { frame: trim, leaf: trim, glassH: 0.55 });
        windowUnit(B, 0.8, 1.0, 1.3, 1.0, { frame: K.white, mull: 1, blind: '#e6ddc8', lit: 0.8 });
        B.decal('lb13', 0.3, 0.075, -1.2, 2.25, 0.02);
        lantern(B, -0.45, 2.05);
      });
      onFace(B, W, Dd, 3, () => { windowUnit(B, 0, 1.0, 1.2, 1.0, { frame: K.white, mull: 1 }); });
      // roof: antenna mast (blinking), dish, harbour-master flagpole
      sub(B, 'dish', -1.4, Hh, -0.8, 0, { variant: 1 });
      B.lathe('metal', K.white, [[0.05, 0], [0.04, 0.2], [0.03, 3.4], [0, 3.42]], 1.6, Hh, 0.9, { seg: 8 });
      B.sph('metal', K.clubGold, 0.05, 1.6, Hh + 3.45, 0.9, { ws: 8, hs: 5 });
      B.flag(1.6, Hh + 3.3, 0.9, { color: '#3f6fb0', s: 1.3 });
      // 【碰撞】天线桅杆一个细实体盒
      B.col(1.5, Hh, 0.8, 1.7, Hh + 3.4, 1.0);
    },
  };

  // ---- café set: round bistro table, 3 chairs, striped parasol (collider = table + chairs)
  // 【道具 cafeset:咖啡座】圆 Bistro 桌(铸铁脚)+三把板条椅+条纹遮阳伞(2.3 m)+菜单牌+咖啡杯;
  // 伞顶按 半径/双色 缓存成伞面扇片+垂边
  function parasolTop(B, x, y, z, R, cA, cB, n = 8) {
    B.add('foliage', tpl(['para', R, cA, cB, n].map(kf).join('|'), () => {
      const g = new GB(), ca = cx3(cA), cb = cx3(cB), rise = 0.38, sub = 3;
      for (let i = 0; i < n; i++) {
        const c = i % 2 ? cb : ca;
        const rows = [];
        for (const [rr, yy] of [[0.02, rise], [R * 0.55, rise * 0.58], [R, 0]]) {
          const row = [];
          for (let k = 0; k <= sub; k++) { const a = ((i + k / sub) / n) * TAU, sag = Math.sin((k / sub) * PI) * 0.035 * (rr / R); row.push(g.v(Math.cos(a) * rr, yy - sag, Math.sin(a) * rr, Math.cos(a) * 0.4, 0.92, Math.sin(a) * 0.4, ...c)); }
          rows.push(row);
        }
        for (let r = 0; r < 2; r++) for (let k = 0; k < sub; k++) g.quad(rows[r][k], rows[r][k + 1], rows[r + 1][k + 1], rows[r + 1][k]);
        // valance flap
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        const q = [[a0, 0], [a1, 0], [a1, -0.12], [a0, -0.12]].map(([a, dy]) => g.v(Math.cos(a) * R, dy, Math.sin(a) * R, Math.cos(a), 0, Math.sin(a), ...c));
        g.quad(q[0], q[1], q[2], q[3]);
      }
      return g.geo();
    }), 'white', x, y, z, {});
    B.sph('gloss', cA, 0.045, x, y + 0.42, z, { ws: 8, hs: 6 });
    for (let i = 0; i < n; i++) { const a = ((i + 0.5) / n) * TAU; B.tube('metal', K.galv, [P3(x, y - 0.32, z), P3(x + Math.cos(a) * R * 0.5, y + 0.14, z + Math.sin(a) * R * 0.5)], 0.007, { radial: 3 }); }
  }
  // 【bistroChair】板条 Bistro 椅:四根锥形钢管腿+板条座/靠背
  function bistroChair(B, x, z, ry, c) {
    B.push(x, 0, z, ry);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.tube('metal', c, [P3(sx * 0.19, 0, sz * 0.19), P3(sx * 0.17, 0.45, sz * 0.17)], 0.013, { radial: 5 });
    B.box('wood', 'woodlight', 0.42, 0.035, 0.4, 0, 0.465, 0, { r: 0.012 });
    for (let k = 0; k < 3; k++) pbox(B, 'wood', shade('woodlight', 0.93), 0.4, 0.06, 0.02, 0, 0.58 + k * 0.1, -0.2);
    for (const sx of [-1, 1]) B.tube('metal', c, [P3(sx * 0.17, 0.45, -0.19), P3(sx * 0.18, 0.86, -0.22)], 0.012, { radial: 5 });
    B.pop();
  }
  D.cafeset = {
    desc: 'Café terrace set: round bistro table with a painted steel base, three slatted bistro chairs, striped parasol (2.3 m), a little menu stand and cups. Collider covers table + chairs.',
    params: { color: 'parasol stripe (club navy)' }, variants: 2, mount: 'ground',
    build(B, o) {
      const cA = o.color ?? K.club, v = (o.variant ?? 0) % 2, fc = '#2f3a47';
      B.lathe('metal', fc, [[0, 0], [0.26, 0], [0.27, 0.02], [0.08, 0.06], [0.03, 0.1], [0.028, 0.7], [0, 0.7]], 0, 0, 0, { seg: 12 });
      B.cyl('wood', 'woodlight', 0.36, 0.035, 0, 0.73, 0, { seg: 18, bevel: 0.01 });
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + (v ? 0.5 : 0.2); bistroChair(B, Math.cos(a) * 0.62, Math.sin(a) * 0.62, -a - HP, fc); }
      B.cyl('metal', K.galv, 0.02, 2.3, 0, 1.15, 0, { seg: 6 });
      parasolTop(B, 0, 1.95, 0, 1.15, cA, K.white, 8);
      B.box('paint', K.white, 0.1, 0.13, 0.02, 0.12, 0.81, -0.08, { r: 0.006, rx: -0.2 });
      for (const [cx, cz] of [[-0.12, 0.1], [0.18, 0.16]]) B.lathe('gloss', K.white, [[0, 0], [0.03, 0], [0.035, 0.07], [0.028, 0.072], [0, 0.01]], cx, 0.748, cz, { seg: 8 });
  // 【碰撞】桌面+三把椅子一整盒
      B.col(-0.85, 0, -0.85, 0.85, 0.78, 0.85);
    },
  };

  // 【道具 mapboard:码头导览图】双镀锌立柱上的园区平面图(正面 +Z):藏青框、浅水蓝底、
  // 奶油色栈桥平面(世界坐标按比例映射)、泊位号刻度、红色 YOU ARE HERE 发光点、楣字、小顶棚
  // ---- marina site map on two posts (front +Z): stylised pier plan, YOU ARE HERE, header
  D.mapboard = {
    desc: 'HALYARD MARINA site map on two galvanised posts (front +Z): navy frame, pale blue water with the piers laid out in cream, berth numbers as ticks, a red YOU ARE HERE dot, header letters, little roof.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const W = 1.5, Hb = 1.0, y0 = 1.0;
      for (const sx of [-1, 1]) { B.box('metal', K.galv, 0.07, y0 + Hb + 0.2, 0.07, sx * (W / 2 + 0.02), (y0 + Hb + 0.2) / 2, 0, { r: 0.015 }); B.box('paint', K.concrete, 0.22, 0.08, 0.22, sx * (W / 2 + 0.02), 0.04, 0, { r: 0.02 }); }
      B.box('gloss', K.club, W + 0.08, Hb + 0.08, 0.06, 0, y0 + Hb / 2, 0.02, { r: 0.02 });
      pbox(B, 'paint', '#3f79a3', W - 0.06, Hb - 0.26, 0.006, 0, y0 + Hb / 2 - 0.1, 0.053);
      for (let i = 0; i < 5; i++) pbox(B, 'paint', '#4f8ab3', W - 0.08, 0.006, 0.002, 0, y0 + 0.2 + i * 0.13, 0.057);
      letters(B, 'HALYARD MARINA', { h: 0.08, x: 0, y: y0 + Hb - 0.14, z: 0.052, c: K.white, flat: true, wt: 0.22, track: 0.12 });
      // pier plan (x: -0.7..0.7 ↔ world x, y: map z) in cream
      const M = (x0, x1, z0, z1) => { const sx = 0.68 / 24, sy = (Hb - 0.34) / 92; pbox(B, 'paint', '#f4ead2', Math.abs(x1 - x0) * sx, Math.abs(z1 - z0) * sy, 0.004, ((x0 + x1) / 2) * sx, y0 + 0.05 + (Hb - 0.34) / 2 + ((z0 + z1) / 2) * sy, 0.058); };
      for (const f of [1, -1]) {
        M(-24 * f, 24 * f, -46 * f, -31 * f); M(-4.5, 4.5, -31 * f, -8.6 * f); M(-24 * f, -19.5 * f, -31 * f, 0); M(-19.5 * f, -4.5 * f, -12.4 * f, -10.4 * f);
        M(-19.5 * f, -12.5 * f, -26.4 * f, -25.2 * f); M(10 * f, 24 * f, -31 * f, -7 * f); M(19.5 * f, 24 * f, -7 * f, 0); M(4.5 * f, 10 * f, -26 * f, -24 * f);
      }
      pbox(B, 'paint', '#1f2a3d', 32 * 0.68 / 24, 10 * (Hb - 0.34) / 92, 0.004, 0, y0 + 0.05 + (Hb - 0.34) / 2, 0.06);
      pbox(B, 'paint', K.white, 13 * 0.68 / 24, 5.8 * (Hb - 0.34) / 92, 0.004, 0, y0 + 0.05 + (Hb - 0.34) / 2, 0.062);
      B.cyl('glow', K.red, 0.022, 0.01, (-21.5 * 0.68) / 24, y0 + 0.05 + (Hb - 0.34) / 2 + (-31.5 * (Hb - 0.34)) / 92, 0.066, { rx: HP, seg: 10, glow: 1.4 });
      B.box('paint', K.club, W + 0.24, 0.05, 0.3, 0, y0 + Hb + 0.12, 0.06, { r: 0.02, rx: 0.12 });
      // 【碰撞】整牌一个实体盒
      B.col(-W / 2 - 0.1, 0, -0.1, W / 2 + 0.1, y0 + Hb + 0.2, 0.14);
    },
  };

  // ---- kayak rack: galvanised frame with padded arms, three sit-on-top kayaks and paddles (front +Z, along X)
  // 【kayakGeo】坐式皮划艇壳体:舯大两头尖的截面环扫出船体+微拱平顶甲板
  function kayakGeo(L, Wd, c1) {
    return tpl(['kayak', L, Wd, c1].map(kf).join('|'), () => {
      const prof = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12, x = (t - 0.5) * L, w = Wd / 2 * Math.pow(Math.sin(t * PI), 0.62); prof.push([x, w]); }
      const g = new GB(), ring = 8, rows = [], c = cx3(c1), cd = cx3(shade(c1, 0.72));
      prof.forEach(([x, w]) => {
        const row = [];
        for (let k = 0; k <= ring; k++) {
          const a = (k / ring) * PI, cs = Math.cos(a), sn = Math.sin(a);
          const yy = -sn * w * 0.55 + (1 - Math.abs(cs)) * 0.0, zz = cs * w;
          const top = k === 0 || k === ring;
          row.push(g.v(x, top ? 0 : yy, zz, 0, top ? 1 : -sn, cs, ...(k < ring / 2 ? c : cd)));
        }
        rows.push(row);
      });
      for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < ring; k++) g.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
      // deck (flat top with a slight crown)
      const deck = prof.map(([x, w]) => [g.v(x, 0, -w, 0, 1, 0, ...c), g.v(x, 0.05 * (w / (Wd / 2 + 1e-6)), 0, 0, 1, 0, ...c), g.v(x, 0, w, 0, 1, 0, ...c)]);
      for (let i = 0; i < deck.length - 1; i++) { g.quad(deck[i][0], deck[i][1], deck[i + 1][1], deck[i + 1][0]); g.quad(deck[i][1], deck[i][2], deck[i + 1][2], deck[i + 1][1]); }
      const geo = g.geo(); geo.computeVertexNormals(); return geo;
    });
  }
  // 【道具 kayakrack:皮划艇架】镀锌 A 字架+软垫托臂,三只坐式皮划艇(壳+甲板+座窝),端部斜靠双叶桨;
  // 正面 +Z、沿 X 排布
  D.kayakrack = {
    desc: 'Galvanised kayak rack (along +X, front +Z): two A-frame uprights with padded arms, three sit-on-top kayaks (hull + deck + seat wells), paddles leaning at the end.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const L = 3.4, c = K.galv;
      for (const x of [-1.0, 1.0]) {
        for (const sz of [-1, 1]) B.tube('metal', c, [P3(x, 0.02, sz * 0.32), P3(x, 1.6, sz * 0.06)], 0.025, { radial: 6 });
        for (const yy of [0.45, 0.95, 1.45]) { pbox(B, 'metal', c, 0.05, 0.05, 0.9, x, yy, 0.05); B.box('rubber', 'charcoal', 0.08, 0.06, 0.34, x, yy + 0.05, 0.28, { r: 0.02 }); }
        B.box('metal', K.galvDk, 0.1, 0.03, 0.7, x, 0.015, 0, { r: 0.01 });
      }
      [['#e36a4a', 0.5], ['#e3b23c', 1.0], ['#3f8fb0', 1.5]].forEach(([kc, yy], i) => {
        B.add('gloss', kayakGeo(L - 0.1 * i, 0.72, kc), 'white', 0.05 * (i - 1), yy + 0.12, 0.22, { ry: 0.02 * (i - 1) });
        B.box('rubber', 'charcoal', 0.5, 0.02, 0.36, -0.1, yy + 0.17, 0.22, { r: 0.01 });
      });
      for (let k = 0; k < 2; k++) { B.push(1.55 + k * 0.12, 0, 0.2 - k * 0.1, 0, 0, 0.1); B.cyl('metal', '#2b2f36', 0.017, 2.1, 0, 1.05, 0, { seg: 6 }); for (const s of [-1, 1]) B.box('gloss', k ? '#e3b23c' : '#3f8fb0', 0.03, 0.4, 0.16, 0, 1.05 + s * 0.95, 0, { r: 0.012 }); B.pop(); }
      // 【碰撞】整架一个实体盒(含斜靠的桨)
      B.col(-1.3, 0, -0.4, 1.85, 1.75, 0.6);
    },
  };

  // ================================================================================================ dock hardware
  // 【码头五金区】
  // 【道具 shorepower:岸电桩】1.2 m 玻璃钢双色调柱体(钢底座、发光圆顶灯、两个蓝色 16A CEE 插座带翻盖、
  // 一只插着电缆垂向泊位、表窗、闪烁状态 LED、侧面黄铜水嘴+盘管、泊位号 A12)
  // ---- marina shore-power pedestal: fibreglass body, light dome, CEE sockets with flip lids, meter, status LEDs, tap
  D.shorepower = {
    desc: 'Marina shore-power pedestal (front +Z, 1.2 m): rounded two-tone fibreglass body on a steel base, glowing dome light, two blue 16 A sockets with flip lids + one plugged-in lead running off, meter window, blinking status LEDs, a brass tap with a coiled hose on the side, berth number.',
    params: { berth: 'label text (A12)' }, variants: 1, mount: 'ground',
    build(B, o) {
      const c = '#e9ebe6', dk = '#3f4a58';
      B.box('metal', K.galvDk, 0.4, 0.05, 0.34, 0, 0.025, 0, { r: 0.012 });
      B.box('gloss', dk, 0.32, 0.3, 0.26, 0, 0.2, 0, { round: true, r: 0.03 });
      B.box('gloss', c, 0.3, 0.72, 0.24, 0, 0.7, 0, { round: true, r: 0.05 });
      B.box('gloss', dk, 0.33, 0.1, 0.27, 0, 1.08, 0, { round: true, r: 0.035 });
      B.lathe('gloss', '#f4f1e6', [[0.1, 0], [0.1, 0.03], [0.08, 0.09], [0.04, 0.12], [0, 0.125]], 0, 1.13, 0, { seg: 10 });
      B.sph('glow', K.lamp, 0.075, 0, 1.18, 0, { ws: 10, hs: 5, half: true, glow: 1.5 });
      // meter window + LEDs + berth label
      pbox(B, 'gloss', '#1d2229', 0.12, 0.07, 0.01, -0.05, 0.93, 0.122);
      pbox(B, 'glow', K.ledG, 0.09, 0.035, 0.004, -0.05, 0.93, 0.128, { glow: 1.3 });
      B.blink(K.ledG, 0.09, 0.95, 0.125, { size: 0.012, rate: 0.35, lo: 0.3, hi: 4 });
      pbox(B, 'glow', K.fuelYel, 0.018, 0.018, 0.006, 0.09, 0.91, 0.124, { glow: 1.2 });
      letters(B, o.berth ?? 'A12', { h: 0.045, x: 0, y: 1.0, z: 0.122, c: dk, flat: true, wt: 0.24 });
      for (const sx of [-1, 1]) {
        B.cyl('gloss', '#3f6fb0', 0.045, 0.06, sx * 0.075, 0.62, 0.12, { rx: HP, seg: 10 });
        B.push(sx * 0.075, 0.67, 0.155, 0, -0.5); pbox(B, 'gloss', '#3f6fb0', 0.09, 0.012, 0.06, 0, 0, 0.03); B.pop();
      }
      // plugged lead running down and off toward the berth
      B.cyl('gloss', '#3f6fb0', 0.05, 0.12, 0.075, 0.62, 0.2, { rx: HP, seg: 10 });
      B.tube('rubber', '#2a5d9a', [P3(0.075, 0.62, 0.26), P3(0.1, 0.45, 0.34), P3(0.12, 0.05, 0.45), P3(0.2, 0.012, 0.8), P3(0.25, 0.012, 1.1)], 0.012, { radial: 5 });
      // tap + coiled hose on the side
      B.cyl('metal', '#c9a24b', 0.018, 0.1, 0.19, 0.5, 0, { rz: HP, seg: 8 });
      B.cyl('metal', '#c9a24b', 0.01, 0.06, 0.24, 0.47, 0, { seg: 6 });
      pbox(B, 'metal', K.galvDk, 0.03, 0.16, 0.12, 0.165, 0.34, 0);
      for (let i = 0; i < 2; i++) B.tor('rubber', '#5a8fc9', 0.13 - i * 0.012, 0.016, 0.2, 0.26 - i * 0.02, 0, { ry: HP, rx: 0.2, rs: 4, ts: 12 });
      B.decal('lb0', 0.2, 0.05, 0, 0.35, 0.122);
      // 【碰撞】整柱一个实体盒
      B.col(-0.2, 0, -0.17, 0.2, 1.22, 0.17);
    },
  };
  // 【道具 bollardlight:系船柱灯】0.85 m 低杆灯:铸造底座、阳极氧化杆身、穹顶帽下百叶头发暖光
  // ---- low bollard light: louvred aluminium post, warm glow under the cap
  D.bollardlight = {
    desc: 'Low dock bollard light (0.85 m): cast base, anodised post, louvred glowing head under a domed cap.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const c = '#39424d';
      B.lathe('metal', c, [[0, 0], [0.12, 0], [0.12, 0.03], [0.085, 0.07], [0.075, 0.1], [0, 0.1]], 0, 0, 0, { seg: 12 });
      B.cyl('metal', c, 0.068, 0.56, 0, 0.38, 0, { seg: 12 });
      B.cyl('glow', K.lamp, 0.058, 0.14, 0, 0.73, 0, { seg: 12, glow: 1.7 });
      for (let k = 0; k < 4; k++) pbox(B, 'metal', c, 0.13, 0.012, 0.13, 0, 0.675 + k * 0.035, 0, { ry: PI / 4 });
      B.lathe('metal', c, [[0.085, 0], [0.085, 0.02], [0.05, 0.06], [0, 0.07]], 0, 0.8, 0, { seg: 12 });
      B.col(-0.1, 0, -0.1, 0.1, 0.87, 0.1);
    },
  };

  // ================================================================================================ boatyard
  // 【船厂区】
  // big boatyard tyre on a hub (axis along local X)
  // 【yardWheel】船厂大轮胎连轮毂(轴沿局部 X),TIRE 标准轮廓按目标尺寸缩放
  function yardWheel(B, x, y, z, R, wdt) {
    B.lathe('rubber', '#26282d', TIRE.map(([r, yy]) => [r * (R / 0.33), yy * (wdt / 0.2)]), x, y, z, { seg: 9, closed: true, rz: HP });
    B.cyl('metal', K.liftYel, R * 0.52, wdt * 0.9, x, y, z, { rz: HP, seg: 12 });
    B.cyl('metal', K.galvDk, R * 0.2, wdt * 1.05, x, y, z, { rz: HP, seg: 8 });
  }
  // 【道具 travellift:船台吊车(35 t)】四条蓝色箱形腿架黄色双轮台车(腿碰撞),5.4–6.1 m 侧梁+后横梁+膝撑,
  // 四只卷扬机与吊缆、收起的吊带(最低点 ≥5.0 m)、发动机房+排烟、操作台,HALYARD / SWL 35 T 标识+警示带
  // ---- travel lift: 4 box legs on twin-wheel bogies, side beams ≥ 5.4 m, rear cross beam, winches + slings (raised),
  //      engine house, operator station; legs collide, beams are overhead (≥ 4.6 m clear everywhere)
  D.travellift = {
    desc: 'Boatyard travel lift (35 t): four blue box-section legs on yellow twin-tyre bogies (colliders), side beams at 5.4–6.1 m, rear cross beam with knee braces, four winch drums with cables and raised lifting slings, engine house with exhaust, operator console, HALYARD + SWL 35 T markings, hazard bands. Local: W 5.4 between leg centres (X), L 3.8 (Z), open at +Z.',
    params: { w: 'leg span X (5.4)', l: 'leg span Z (3.8)' }, variants: 1, mount: 'ground',
    build(B, o) {
      const W = o.w ?? 5.4, L = o.l ?? 3.8, BY = 5.45, BH = 0.66, blue = K.liftBlue, yel = K.liftYel;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * W / 2, z = sz * L / 2;
        // bogie: frame + two big tyres
        B.box('metal', yel, 0.5, 0.5, 1.3, x, 0.8, z, { r: 0.04 });
        B.box('metal', shade(yel, 0.85), 0.56, 0.08, 1.36, x, 1.07, z, { r: 0.02 });
        for (const dz of [-0.42, 0.42]) yardWheel(B, x + sx * 0.02, 0.42, z + dz, 0.42, 0.3);
        // leg column with a flare into the beam, hazard band at the foot
        B.box('metal', blue, 0.42, BY - 1.05, 0.52, x, 1.05 + (BY - 1.05) / 2, z, { r: 0.03 });
        B.decal('hazard', 0.42, 0.3, x, 1.35, z + sz * 0.262, { tint: yel, ry: sz > 0 ? 0 : PI });
        B.decal('hazard', 0.52, 0.3, x + sx * 0.212, 1.35, z, { tint: yel, ry: sx * HP });
        for (const k of [0, 1]) pbox(B, 'metal', shade(blue, 0.8), 0.44, 0.03, 0.54, x, 2.4 + k * 1.6, z);
        B.push(x, BY - 0.25, z - sz * 0.45, 0, sz * 0.62); B.box('metal', blue, 0.34, 0.14, 1.0, 0, 0, 0, { r: 0.02 }); B.pop();
      }
      // side beams + beam top rails, markings
      for (const sx of [-1, 1]) {
        const x = sx * W / 2;
        B.box('metal', blue, 0.46, BH, L + 1.3, x, BY + BH / 2, -0.2, { r: 0.04 });
        pbox(B, 'metal', yel, 0.47, 0.06, L + 1.28, x, BY + 0.1, -0.2);
        B.push(x + sx * 0.235, BY + 0.38, 0.2, sx * HP);
        letters(B, 'HALYARD', { h: 0.22, x: 0, y: 0, z: 0.002, c: K.white, flat: true, wt: 0.2, track: 0.14 });
        if (sx > 0) letters(B, 'SWL 35 T', { h: 0.1, x: -1.55, y: -0.2, z: 0.002, c: yel, flat: true, wt: 0.22 });
        B.pop();
        // winches + raised slings (straps sag between the side beams, lowest point ≥ 5.0 m)
        for (const wz of [-1.0, 0.8]) {
          B.cyl('metal', K.galvDk, 0.2, 0.36, x - sx * 0.05, BY - 0.12, wz, { rz: HP, seg: 12 });
          B.cyl('metal', K.galv, 0.012, 0.3, x - sx * 0.05, BY - 0.42, wz, { seg: 4 });
        }
      }
      for (const wz of [-1.0, 0.8]) {
        const pts = [];
        for (let i = 0; i <= 8; i++) { const t = i / 8, xx = (t - 0.5) * (W - 0.2); pts.push([xx, BY - 0.5 - 0.22 * Math.sin(t * PI)]); }
        for (let i = 0; i < 8; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; B.push((x0 + x1) / 2, (y0 + y1) / 2, wz, 0, 0, Math.atan2(y1 - y0, x1 - x0)); pbox(B, 'paint', '#3f6fb0', Math.hypot(x1 - x0, y1 - y0) + 0.02, 0.012, 0.16, 0, 0, 0); B.pop(); }
        for (const sx of [-1, 1]) B.box('metal', K.galvDk, 0.12, 0.2, 0.2, sx * (W / 2 - 0.1), BY - 0.52, wz, { r: 0.02 });
      }
      // rear cross beam (−Z end) with knee braces
      B.box('metal', blue, W + 0.46, 0.56, 0.48, 0, BY + 0.34, -L / 2 - 0.62, { r: 0.04 });
      pbox(B, 'metal', yel, W + 0.44, 0.06, 0.49, 0, BY + 0.62, -L / 2 - 0.62);
      for (const sx of [-1, 1]) { B.push(sx * (W / 2 - 0.45), BY - 0.2, -L / 2 - 0.62, 0, 0, sx * 0.75); B.box('metal', blue, 1.1, 0.16, 0.3, 0, 0, 0, { r: 0.02 }); B.pop(); }
      // engine house on top of the rear cross beam (east end) + exhaust stack
      B.push(W / 2 - 0.9, BY + 0.62, -L / 2 - 0.62);
      B.box('metal', blue, 1.5, 0.75, 0.62, 0, 0.375, 0, { round: true, r: 0.05 });
      for (let k = 0; k < 6; k++) pbox(B, 'metal', shade(blue, 0.7), 0.05, 0.4, 0.02, -0.5 + k * 0.1, 0.4, 0.315);
      B.cyl('metal', '#3a3f48', 0.05, 0.9, 0.55, 1.05, 0, { seg: 8 });
      B.cyl('metal', '#3a3f48', 0.06, 0.08, 0.55, 1.52, 0, { seg: 8 });
      B.pop();
      // operator console on the south-west leg
      B.push(-W / 2 - 0.3, 1.5, -L / 2 + 0.55);
      B.box('metal', K.galvDk, 0.12, 0.9, 0.12, 0, -0.1, 0, { r: 0.02 });
      B.box('metal', yel, 0.36, 0.3, 0.22, 0, 0.45, 0, { r: 0.03, rx: -0.3 });
      for (let k = 0; k < 3; k++) B.cyl('metal', 'charcoal', 0.012, 0.1, -0.1 + k * 0.1, 0.62, 0.02, { seg: 5, rx: 0.3 });
      B.sph('gloss', K.red, 0.03, 0.12, 0.55, 0.12, { ws: 8, hs: 4 });
      B.pop();
      B.blink('#ffb347', W / 2, BY + BH + 0.12, L / 2 + 0.3, { size: 0.05, rate: 0.8, lo: 0.2, hi: 5 });
      B.cyl('metal', 'charcoal', 0.06, 0.1, W / 2, BY + BH + 0.05, L / 2 + 0.3, { seg: 8 });
      // 【碰撞】只有四条支腿碰撞(腿间净空可穿行吊装);横梁/吊带全部 ≥4.6 m 悬在头顶,不设碰撞
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.col(sx * W / 2 - (sx < 0 && sz < 0 ? 0.5 : 0.3), 0, sz * L / 2 - 0.66, sx * W / 2 + 0.3, BY, sz * L / 2 + 0.66);
    },
  };

  // 【hullLoft】放样:从船尾(t=0, x=-L/2)到船首(t=1)的硬折角滑行艇型值——折角线、外飘舷弧、上翘龙骨
  // ---- boat under a tarp on a steel cradle (front +Z along the keel), at the yard edge
  function hullLoft(L, Bm, Dp, n = 14) {
    // sections from the transom (t = 0, x = -L/2) to the stem (t = 1): hard-chine planing hull, raked stem, rising keel
    const secs = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = (t - 0.5) * L;
      const bw = (Bm / 2) * (t < 0.55 ? 0.94 + 0.06 * Math.sin((t / 0.55) * HP) : Math.max(0.03, Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.55) / 0.45, 1.6)))));
      const sheer = Dp + 0.18 * Math.pow(Math.max(0, t - 0.45) / 0.55, 2);
      const keel = -0.06 + (sheer + 0.06) * Math.pow(Math.max(0, t - 0.72) / 0.28, 1.8) * 0.92;
      const chine = keel + (sheer - keel) * 0.42;
      secs.push({ x, bw, sheer, keel, chine, t });
    }
    return { secs };
  }
  // 【hullRing】单个截面的 9 点环:右舷舷缘→折角→龙骨→左舷折角→左舷舷缘(镜像)
  // ring of section points starboard sheer → chine → keel → port chine → port sheer (9 points)
  const hullRing = (sc) => {
    const S = (z, y) => [z, y], cw = sc.bw * 0.9;
    const pts = [S(sc.bw, sc.sheer), S((sc.bw + cw) / 2 + 0.01, (sc.sheer + sc.chine) / 2), S(cw, sc.chine), S(cw * 0.5, (sc.chine + sc.keel) / 2 - 0.02), S(0, sc.keel)];
    return [...pts, ...pts.slice(0, 4).reverse().map(([z, y]) => [-z, y])];
  };
  // 【道具 tarpboat:盖布船】钢支架上的退役摩托艇(龙骨沿局部 X):支架螺旋顶垫贴合船体放样、
  // 放样船壳(红防污/ navy 水线带/白上壳)、舷缘防擦条、拱形防雨布罩(撑杆起脊+绑带+弹力钩)
  D.tarpboat = {
    desc: 'Laid-up motor launch on a painted steel cradle with screw pads, wrapped in a sagging blue tarp with lashings and bungees, white topsides with a navy boot stripe and red antifouling showing below the cover. Keel along local X.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const L = 3.6, Bm = 1.5, Dp = 0.75, cy = 0.62;
      // cradle: skids, cross beams, pads
      for (const sz of [-0.55, 0.55]) B.box('metal', K.liftBlue, L * 0.8, 0.1, 0.12, 0, 0.05, sz, { r: 0.02 });
      for (const sx of [-0.9, 0.8]) {
        B.box('metal', K.liftBlue, 0.12, 0.12, 1.35, sx, 0.16, 0, { r: 0.02 });
        // screw pads meet the topsides (hull section height at |z| = 0.52 from the loft formula)
        const hs = hullLoft(L, Bm, Dp).secs[Math.round(((sx / L) + 0.5) * 14)];
        const padY = cy + 0.1 + hs.chine + (hs.keel - hs.chine) * Math.max(0, (hs.bw * 0.9 - 0.52) / (hs.bw * 0.9)) + 0.01;
        for (const sz of [-1, 1]) { B.tube('metal', K.galv, [P3(sx, 0.2, sz * 0.66), P3(sx, padY - 0.06, sz * 0.56)], 0.025, { radial: 5 }); B.box('rubber', 'charcoal', 0.16, 0.05, 0.14, sx, padY - 0.02, sz * 0.54, { r: 0.012, rx: -sz * 0.75 }); }
        const kY = cy + 0.1 + hs.keel;
        pbox(B, 'wood', '#9c7a52', 0.24, kY - 0.2, 0.26, sx, 0.2 + (kY - 0.2) / 2, 0);
      }
      // hull: lofted hard-chine sections — red antifouling, navy boot stripe, white topsides, flat transom
      const hg = tpl('tarphull2', () => {
        const { secs } = hullLoft(L, Bm, Dp);
        const g = new GB(), rows = [];
        const cW = cx3(K.hull), cN = cx3(K.club), cR = cx3(K.antifoul);
        for (const sc of secs) {
          const wl = sc.keel + (Dp + 0.06) * 0.5;
          rows.push(hullRing(sc).map(([z, y]) => g.v(sc.x, y, z, 0, y < sc.chine ? -1 : 0, Math.sign(z) || 0, ...(y < wl - 0.05 ? cR : y < wl + 0.04 ? cN : cW))));
        }
        for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < rows[i].length - 1; k++) g.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
        const t0 = rows[0], cen = g.v(secs[0].x, (secs[0].sheer + secs[0].keel) / 2, 0, -1, 0, 0, ...cW);
        for (let k = 0; k < t0.length - 1; k++) g.tri(cen, t0[k], t0[k + 1]);
        const geo = g.geo(); geo.computeVertexNormals(); return geo;
      });
      B.add('gloss', hg, 'white', 0, cy + 0.1, 0, {});
      // rubbing strake at the sheer
      B.add('paint', tpl('strake', () => { const { secs } = hullLoft(L, Bm, Dp); const pts = []; for (const sc of secs) pts.push([sc.x, sc.sheer - 0.03, sc.bw + 0.015]); for (let i = secs.length - 1; i >= 0; i--) pts.push([secs[i].x, secs[i].sheer - 0.03, -secs[i].bw - 0.015]); return tubeGeo(pts, 0.022, 5); }), K.club, 0, cy + 0.1, 0, {});
      // tarp: tented over the sheer (ridge line from a boat hook), sagging between lashings, skirt draped over the side
      const tg = tpl('tarpcover2', () => {
        const { secs } = hullLoft(L + 0.1, Bm + 0.08, Dp);
        const g = new GB(), rows = [], ring = 12, cA = cx3(K.tarp), cB2 = cx3(K.tarpDk);
        secs.forEach((sc, i) => {
          const row = [], lash = Math.abs(Math.cos(sc.t * PI * 3));
          for (let k = 0; k <= ring; k++) {
            const u = k / ring, a = u * PI, zz = Math.cos(a) * sc.bw * 1.03;
            const tent = (0.24 + 0.12 * Math.sin(sc.t * PI)) * Math.pow(Math.sin(a), 0.8) * (0.8 + 0.2 * lash);
            const skirt = Math.pow(Math.abs(Math.cos(a)), 5) * (0.26 + 0.05 * Math.sin(i * 1.7 + k));
            const c = lerp3(cA, cB2, 0.3 + 0.4 * (1 - lash) * Math.sin(a) + 0.15 * Math.sin(i * 0.9 + k * 0.7));
            row.push(g.v(sc.x, sc.sheer + tent - skirt, zz * (1 + skirt * 0.12), 0, Math.sin(a), Math.cos(a), ...c));
          }
          rows.push(row);
        });
        for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < ring; k++) g.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
        const geo = g.geo(); geo.computeVertexNormals(); return geo;
      });
      B.add('foliage', tg, 'white', 0, cy + 0.1, 0, {});
      // lashings over the cover to the cradle + bungee hooks
      for (const x of [-1.2, -0.4, 0.45]) {
        const pts = [];
        for (let k = 0; k <= 8; k++) { const a = (k / 8) * PI; pts.push(P3(x, cy + 0.1 + Dp + Math.pow(Math.sin(a), 0.8) * 0.3 + 0.012, Math.cos(a) * (Bm / 2 + 0.07))); }
        pts.unshift(P3(x, 0.2, Bm / 2 - 0.1)); pts.push(P3(x, 0.2, -Bm / 2 + 0.1));
        B.tube('paint', K.fuelYel, pts, 0.012, { radial: 4 });
      }
      // 【碰撞】船体+罩布+支架整体一个实体盒
      B.col(-L / 2 - 0.05, 0, -0.8, L / 2 + 0.05, cy + 0.1 + Dp + 0.4, 0.8);
    },
  };

  // 【道具 scaffold:移动铝合金脚手架】1.3×1.1×4.2:脚轮、梯框端架、斜撑、3.2 m 木平台+踢脚板+双道护栏,
  // 顶上的油漆桶+滚筒盘;整塔按 rail 盒碰撞(框架看得见:挡人,子弹/墨/鱿鱼可穿,也没人站上)
  // ---- aluminium mobile scaffold tower (1.3 × 1.1): castors, frames, braces, timber platform, guard rails, tins
  D.scaffold = {
    desc: 'Mobile aluminium scaffold tower (1.3 × 1.1 × 4.2): castor wheels, ladder-frame ends, diagonal braces, timber-boarded platform at 3.2 m with toe boards and double guard rails, paint tin + roller tray up top. Collides as a rail block (see-through frame: kids blocked, shots / ink / squids pass, nobody perches).',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const W = 1.3, Dd = 1.1, Hp = 3.2, Ht = 4.2, c = '#c3cad0';
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * (W / 2 - 0.04), z = sz * (Dd / 2 - 0.04);
        B.cyl('metal', c, 0.024, Ht - 0.2, x, 0.2 + (Ht - 0.2) / 2, z, { seg: 6 });
        B.cyl('metal', K.galvDk, 0.03, 0.12, x, 0.16, z, { seg: 6 });
        B.cyl('rubber', 'charcoal', 0.06, 0.04, x, 0.06, z, { rz: HP, seg: 8 });
        pbox(B, 'metal', K.red, 0.02, 0.05, 0.06, x + 0.05, 0.1, z);
      }
      for (let y = 0.5; y < Ht; y += 0.9) for (const sx of [-1, 1]) B.cyl('metal', c, 0.017, Dd - 0.08, sx * (W / 2 - 0.04), y, 0, { rx: HP, seg: 5 });
      for (const y of [0.5, 1.4, 2.3, Hp - 0.02, Hp + 0.5, Ht - 0.02]) for (const sz of [-1, 1]) B.cyl('metal', c, 0.017, W - 0.08, 0, y, sz * (Dd / 2 - 0.04), { rz: HP, seg: 5 });
      for (const sz of [-1, 1]) for (const [y0, y1] of [[0.5, 1.4], [1.4, 2.3], [2.3, Hp]]) B.tube('metal', c, [P3(-W / 2 + 0.04, y0, sz * (Dd / 2 - 0.04)), P3(W / 2 - 0.04, y1, sz * (Dd / 2 - 0.04))], 0.014, { radial: 4 });
      for (let i = 0; i < 5; i++) pbox(B, 'wood', shade('woodlight', 0.9 + (i % 2) * 0.08), W - 0.1, 0.04, (Dd - 0.1) / 5 - 0.01, 0, Hp + 0.02, -Dd / 2 + 0.05 + (i + 0.5) * (Dd - 0.1) / 5);
      for (const sz of [-1, 1]) pbox(B, 'wood', 'wooddark', W - 0.06, 0.15, 0.025, 0, Hp + 0.1, sz * (Dd / 2 - 0.02));
      for (const sx of [-1, 1]) pbox(B, 'wood', 'wooddark', 0.025, 0.15, Dd - 0.06, sx * (W / 2 - 0.02), Hp + 0.1, 0);
      B.lathe('gloss', K.white, [[0, 0], [0.09, 0], [0.09, 0.16], [0, 0.16]], 0.35, Hp + 0.04, 0.25, { seg: 10 });
      B.cyl('metal', K.galvDk, 0.092, 0.012, 0.35, Hp + 0.205, 0.25, { seg: 10 });
      pbox(B, 'paint', '#2f5f9e', 0.28, 0.04, 0.34, -0.3, Hp + 0.06, -0.2);
      // 【碰撞】整塔一个 rail 盒:镂空框架只挡小孩,子弹/墨/鱿鱼照常穿透,没人能站上平台
      B.col(-W / 2, 0, -Dd / 2, W / 2, Ht, Dd / 2, { rail: true });   // open frame: kids blocked, shots / ink / squids pass
    },
  };

  // ---- workbench against a hull / wall behind it (-Z): vice, tools, tins, pressure washer cart beside it
  // 【paintTin】油漆桶(镀锌桶身+内衬色+淌下的漆痕)
  function paintTin(B, x, y, z, c, s = 1) {
    B.lathe('metal', K.galv, [[0, 0], [0.085 * s, 0], [0.085 * s, 0.17 * s], [0.08 * s, 0.18 * s], [0, 0.18 * s]], x, y, z, { seg: 10 });
    B.cyl('paint', c, 0.086 * s, 0.09 * s, x, y + 0.09 * s, z, { seg: 10, open: true });
    B.tube('paint', c, [P3(x + 0.07 * s, y + 0.18 * s, z), P3(x + 0.087 * s, y + 0.12 * s, z + 0.01), P3(x + 0.087 * s, y + 0.05 * s, z + 0.01)], 0.009 * s, { radial: 4 });
  }
  // 【道具 workbench:船厂工作台】1.5×0.65×0.9,背贴船体/墙(-Z):厚木台面+钢腿、台虎钳、锤/木槌、
  // 防污漆桶+滚筒盘(台面/搁板/地面),旁边 +X 一台带卷盘喷枪的高压清洗机推车
  D.workbench = {
    desc: 'Boatyard workbench (1.5 × 0.65 × 0.9, back to a hull at -Z): thick timber top on steel legs, engineer vice, hammer + mallet, antifoul tins and a roller tray on the shelf and the ground, plus a wheeled pressure washer with its hose reel and lance at +X.',
    params: {}, variants: 1, mount: 'ground',
    build(B, o) {
      const W = 1.5, Dd = 0.65, Hh = 0.9, ws = o.washerSide ?? 1;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pbox(B, 'metal', '#3f4a58', 0.05, Hh - 0.06, 0.05, sx * (W / 2 - 0.06), (Hh - 0.06) / 2, sz * (Dd / 2 - 0.06));
      B.box('wood', '#b08556', W, 0.07, Dd, 0, Hh - 0.035, 0, { r: 0.015 });
      pbox(B, 'wood', '#9c7a52', W - 0.1, 0.03, Dd - 0.1, 0, 0.25, 0);
      // vice
      B.push(-W / 2 + 0.22, Hh, Dd / 2 - 0.08);
      B.box('metal', '#3f6fb0', 0.18, 0.12, 0.14, 0, 0.06, 0, { r: 0.02 });
      B.box('metal', '#3f6fb0', 0.18, 0.1, 0.06, 0, 0.07, 0.12, { r: 0.015 });
      B.cyl('metal', K.galv, 0.012, 0.28, 0, 0.06, 0.2, { rx: HP, seg: 5 });
      B.cyl('metal', K.galv, 0.008, 0.18, 0, 0.06, 0.33, { rz: HP, seg: 5 });
      B.pop();
      // hammer + mallet on the top
      B.push(0.15, Hh + 0.02, 0.05, 0.4); pbox(B, 'wood', '#c99a61', 0.3, 0.025, 0.025, 0, 0, 0); pbox(B, 'metal', '#3a3f48', 0.03, 0.035, 0.1, 0.15, 0.01, 0); B.pop();
      B.push(0.45, Hh + 0.04, -0.12, -0.2); B.cyl('wood', '#b08556', 0.05, 0.14, 0, 0.0, 0, { rz: HP, seg: 8 }); pbox(B, 'wood', '#c99a61', 0.025, 0.025, 0.26, 0, -0.01, 0.13); B.pop();
      paintTin(B, -0.35, Hh, -0.15, K.antifoul); paintTin(B, 0.65, 0.27, 0.05, '#3f6fb0', 0.9);
      paintTin(B, -0.45, 0.27, 0.0, K.antifoul, 0.9); paintTin(B, 0.1, 0, Dd / 2 + 0.15, K.antifoul, 1.1); paintTin(B, 0.34, 0, Dd / 2 + 0.2, K.white, 1.0);
      pbox(B, 'metal', '#2f3a47', 0.34, 0.04, 0.26, -0.3, 0.02, Dd / 2 + 0.2);
      B.cyl('paint', K.antifoul, 0.03, 0.2, -0.3, 0.08, Dd / 2 + 0.2, { rz: HP, seg: 8 });
      // pressure washer cart beside the bench (side ws)
      B.push(ws * (W / 2 + 0.42), 0, 0.05, ws > 0 ? 0 : PI);
      B.box('metal', K.fuelYel, 0.42, 0.34, 0.5, 0, 0.4, 0, { round: true, r: 0.05 });
      pbox(B, 'metal', '#2f3a47', 0.44, 0.08, 0.52, 0, 0.2, 0);
      for (const sz of [-1, 1]) yardWheel(B, 0, 0.13, sz * 0.26, 0.13, 0.06);
      B.tube('metal', '#2f3a47', [P3(-0.2, 0.25, -0.22), P3(-0.24, 0.9, -0.2), P3(-0.24, 0.9, 0.2), P3(-0.2, 0.25, 0.22)], 0.015, { radial: 5 });
      B.cyl('rubber', '#1f2126', 0.12, 0.1, -0.1, 0.72, 0, { rz: HP, seg: 12 });
      for (let i = 0; i < 3; i++) B.tor('rubber', '#1f2126', 0.12 + i * 0.008, 0.012, -0.1 + (i - 1) * 0.03, 0.72, 0, { ry: HP, rs: 4, ts: 14 });
      B.tube('metal', K.galv, [P3(-0.26, 0.88, 0.15), P3(-0.3, 0.5, 0.2), P3(-0.32, 0.12, 0.24)], 0.01, { radial: 4 });
      B.tube('rubber', '#1f2126', [P3(-0.1, 0.6, 0.12), P3(0.1, 0.08, 0.35), P3(0.4, 0.012, 0.45), P3(0.7, 0.012, 0.3)], 0.012, { radial: 4 });
      B.pop();
      // 【碰撞】台面+清洗机一整盒(清洗机在侧面,盒体按 ws 方向扩边)
      B.col(ws > 0 ? -W / 2 : -W / 2 - 0.66, 0, -Dd / 2, ws > 0 ? W / 2 + 0.66 : W / 2, Hh + 0.05, Dd / 2);
    },
  };

  // ================================================================================================ harbour beacon
  // 【港口灯塔区】
  // 【道具 beacon:灯塔冠】装在 S×S×H 灯塔方块顶部(pos=块基座中心):顶部红带+角护、±X 昼标三角+名牌、
  // -Z 墙面爬梯(带翻越抓环)、顶部镀锌护栏圈(碰撞)、红白灯室+格条玻璃+闪烁红灯、红色穹顶、通风球+避雷针
  // lantern house on the beacon block (pos = block base centre, block S × S × H): railing ring (collides), red/white
  // bands, wall ladder with hoops, gallery grating, glazed lantern with astragals + lamp (blinks), domed red roof, vane
  D.beacon = {
    desc: 'Harbour beacon crown for the S × S × H beacon block: red band + daymark + nameplate on the block, flush steel wall ladder (-Z face) with grab hoops, galvanised railing ring round the top (collides), red/white lantern house with glazed lantern, blinking red light, domed roof, ventilator ball and lightning rod (collides).',
    params: { s: 'block size (2.4)', h: 'block height (2.4)', color: 'identity colour (red)' }, variants: 1, mount: 'ground',
    build(B, o) {
      B.aoBase = null;
      const S = o.s ?? 2.4, Hh = o.h ?? 2.4, red = o.color ?? K.red, white = K.white, rail = K.galv;
      // red band round the block top + corner guards, daymark + plate on +X and -X
      for (let side = 0; side < 4; side++) onFace(B, S, S, side, (Lf) => {
        B.box('paint', red, Lf + 0.06, 0.34, 0.04, 0, Hh - 0.2, 0.02, { r: 0.012 });
        B.box('paint', white, Lf + 0.06, 0.06, 0.045, 0, Hh - 0.4, 0.022, { r: 0.01 });
      });
      for (const side of [1, 3]) onFace(B, S, S, side, () => {
        B.box('paint', white, 0.9, 0.9, 0.04, 0, 1.2, 0.02, { r: 0.02 });
        B.add('paint', tpl('daymark', () => { const g = new GB(); const c = cx3(K.red); const a = g.v(-0.36, -0.3, 0, 0, 0, 1, ...c), b = g.v(0.36, -0.3, 0, 0, 0, 1, ...c), d = g.v(0, 0.34, 0, 0, 0, 1, ...c); g.tri(a, b, d); return g.geo(); }), 'white', 0, 1.2, 0.042, {});
        B.box('paint', K.club, 0.7, 0.16, 0.02, 0, 0.55, 0.012, { r: 0.01 });
        letters(B, 'HM 1', { h: 0.08, x: 0, y: 0.51, z: 0.023, c: white, flat: true, wt: 0.22, track: 0.14 });
      });
      // wall ladder on -Z with hoops over the top rail
      onFace(B, S, S, 2, () => {
        for (const sx of [-1, 1]) {
          const x = sx * 0.22, pts = [P3(x, 0.05, 0.1), P3(x, Hh - 0.02, 0.1)];
          for (let k = 1; k <= 4; k++) { const t = (k / 4) * PI; pts.push(P3(x, Hh + Math.sin(t) * 0.55 + 0.4 * (k / 4), 0.1 - (1 - Math.cos(t)) * 0.16)); }
          pts.push(P3(x, Hh + 0.3, -0.22), P3(x, Hh + 0.02, -0.22));
          B.tube('metal', rail, pts, 0.02, { radial: 6 });
          for (const yy of [0.3, Hh - 0.4]) pbox(B, 'metal', K.galvDk, 0.04, 0.05, 0.1, x, yy, 0.05);
        }
        for (let y = 0.3; y < Hh - 0.1; y += 0.3) B.cyl('metal', rail, 0.014, 0.44, 0, y, 0.1, { rz: HP, seg: 5 });
      });
      // gallery grating + railing ring (posts + two rails) inset 0.06 from the edge
      const top = Hh, ri = S / 2 - 0.08;
      pbox(B, 'metal', K.galvDk, S - 0.1, 0.03, S - 0.1, 0, top + 0.015, 0);
      for (let side = 0; side < 4; side++) {
        const a = (side * PI) / 2;
        B.push(Math.sin(a) * ri, top, Math.cos(a) * ri, a);
        for (const yy of [0.5, 1.0]) B.cyl('metal', rail, yy > 0.9 ? 0.028 : 0.018, 2 * ri, 0, yy, 0, { rz: HP, seg: 6, open: true });
        for (const x of [-ri, -ri / 3, ri / 3]) B.cyl('metal', rail, 0.022, 1.0, x, 0.5, 0, { seg: 6 });
        B.pop();
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.sph('metal', rail, 0.035, sx * ri, top + 1.0, sz * ri, { ws: 6, hs: 4 });
      // lantern house: red base with a white band, glazed lantern, red dome roof, vane
      const ly = top + 0.03;
      B.lathe('gloss', red, [[0, 0], [0.66, 0], [0.66, 0.08], [0.6, 0.12], [0.6, 0.72], [0.68, 0.76], [0.68, 0.82], [0, 0.82]], 0, ly, 0, { seg: 16 });
      B.cyl('gloss', white, 0.605, 0.16, 0, ly + 0.4, 0, { seg: 16, open: true });
      // lantern: the pulsing lens fills the glazing, astragals + glazing bars in front of it
      B.cyl('glow', '#ffd8cc', 0.3, 0.7, 0, ly + 0.82 + 0.39, 0, { seg: 12, glow: 0.9 });
      B.blink('#ff4a3a', 0, ly + 1.21, 0, { size: 0.46, rate: 0.4, lo: 0.35, hi: 3.2 });
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; pbox(B, 'metal', white, 0.035, 0.8, 0.035, Math.cos(a) * 0.49, ly + 0.82 + 0.39, Math.sin(a) * 0.49, { ry: -a }); }
      B.tor('metal', white, 0.49, 0.02, 0, ly + 1.21, 0, { rx: HP, rs: 4, ts: 24 });
      B.lathe('gloss', red, [[0, 0], [0.62, 0], [0.62, 0.05], [0.5, 0.2], [0.3, 0.36], [0.1, 0.44], [0, 0.45]], 0, ly + 1.6, 0, { seg: 16 });
      B.sph('metal', white, 0.1, 0, ly + 2.12, 0, { ws: 10, hs: 6 });
      B.cyl('metal', '#3a3f48', 0.012, 0.7, 0, ly + 2.5, 0, { seg: 4 });
      B.push(0, ly + 2.62, 0, 0.9); pbox(B, 'metal', '#3a3f48', 0.4, 0.1, 0.008, 0.1, 0, 0); B.pop();
      // colliders: lantern house + the four railing sides (the crown is not a perch)
      // 【碰撞】灯室一个实体盒 + 四侧护栏 rail 盒(塔冠不可站立)
      B.col(-0.68, top, -0.68, 0.68, ly + 2.1, 0.68);
      // railing colliders hug the very edge (≥ 0.04 outboard of the level's face-visibility samples, so the block's top
      // face is never culled and the baked lightmap stays valid)
      // 【采样避让】护栏碰撞盒贴着块体外缘(比关卡的面可见性采样点外扩 ≥0.04):保证方块顶面
      // 永不被剔除、烘焙光照图不失效
      const e0 = S / 2 - 0.04, e1 = S / 2 + 0.02;
      B.col(-e1, top, e0, e1, top + 1.05, e1, { rail: true }); B.col(-e1, top, -e1, e1, top + 1.05, -e0, { rail: true });   // gallery rails
      B.col(e0, top, -e1, e1, top + 1.05, e1, { rail: true }); B.col(-e1, top, -e1, -e0, top + 1.05, e1, { rail: true });
    },
  };

  // ================================================================================================ outside the arena
  // 【竞技场外区】(不可达,纯景观)
  // 【道具 breakwater:防波堤】沿局部 +Z 的抛石堤(pos=根部水线中线):两侧两排乱石护面、混凝土压顶+防浪墙、
  // +Z 端圆弧堤头+绿色堤头灯(闪烁)
  // rubble-mound breakwater along local +Z (length L) with a concrete crest + parapet and a rounded head at the +Z end
  // 【rockGeo】单块抛石:十二面体逐顶点哈希扰动,压扁成块石,法线平滑+灰度顶点色(读作碎石断面)
  function rockGeo(seed) {
    return tpl('rock|' + seed, () => {
      let g = new THREE.DodecahedronGeometry(1, 0);
      g.deleteAttribute('normal'); g.deleteAttribute('uv');
      const P = g.attributes.position, pos = [];
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const n = 0.82 + 0.3 * hash(Math.round(x * 7) * 3.1 + Math.round(y * 7) * 1.7 + Math.round(z * 7) * 2.3 + seed * 5.1);
        pos.push(x * n * 1.15, y * n * 0.75, z * n);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();                                  // flat-ish facets read as broken rock
      const C = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) { const y = pos[i * 3 + 1], k = 0.78 + 0.26 * smooth(-0.8, 0.9, y) + 0.08 * hash(i + seed); C[i * 3] = k; C[i * 3 + 1] = k; C[i * 3 + 2] = k * 0.97; }
      geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      return geo;
    });
  }
  D.breakwater = {
    desc: 'Rubble-mound breakwater arm along local +Z (pos = root at the waterline centre-line): tumbled armour rocks in two rows either side, a concrete crest slab with a seaward parapet, a rounded rock head at the +Z end with a small green pier-head light (blinks).',
    params: { length: 'm (60)', light: 'head light colour (green)' }, variants: 1, mount: 'wall',
    build(B, o) {
      B.aoBase = null;
      const L = o.length ?? 60, Wc = 2.4;
      const tones = [K.rock, K.rockDk, K.rockLt, '#98938a'];
      const put = (x, y, z, s, k) => B.add(NS('paint'), rockGeo(k % 7), mixc(tones[k % 4], '#6d7a74', y < -1.2 ? 0.35 : 0), x, y, z, { s, ry: hash(k * 3.3) * TAU, rx: (hash(k * 1.7) - 0.5) * 0.5, ao: false });
      let k = 0;
      for (let z = 0.8; z < L; z += 2.8) {
        for (const [x, y, sc] of [[-3.1, -1.5, 1.45], [-1.8, -0.5, 1.2], [1.9, -0.55, 1.2], [3.3, -1.7, 1.4]].filter((_, j) => j !== 3 || (Math.round(z / 2.2) % 2 === 0))) {
          put(x + (hash(k) - 0.5) * 0.5, y + (hash(k + 9) - 0.5) * 0.3, z + (hash(k + 4) - 0.5) * 0.7, sc * (0.8 + 0.4 * hash(k + 2)), k); k++;
        }
      }
      // crest slab + parapet, expansion joints
      B.box(NS('paint'), K.concrete, Wc, 0.55, L, 0, 0.2, L / 2, { r: 0.06 });
      B.box(NS('paint'), K.concreteDk, 0.5, 0.75, L, 1.1, 0.8, L / 2, { r: 0.06 });
      for (let z = 4; z < L; z += 4) pbox(B, NS('paint'), shade(K.concreteDk, 0.8), Wc + 0.02, 0.01, 0.03, 0, 0.475, z);
      // rounded head
      for (let i = 0; i < 14; i++) { const a = (i / 14) * PI - HP * 0.0, r = 2.6 + hash(i) * 0.6; put(Math.cos(a + PI) * r * 0.0 + Math.sin(a - HP) * r, i % 2 ? -1.5 : -0.5, L + Math.cos(a - HP) * r * 0.9 + 0.4, 1.2 + hash(i + 3) * 0.4, k++); }
      B.cyl(NS('paint'), K.concrete, 1.5, 0.55, 0, 0.2, L, { seg: 16 });
      // pier-head light: short white column with a coloured band, lantern, blink
      const lc = o.light ?? K.green;
      B.lathe(NS('gloss'), K.white, [[0, 0], [0.42, 0], [0.42, 0.1], [0.3, 0.18], [0.26, 2.2], [0.34, 2.26], [0.34, 2.32], [0, 2.32]], 0, 0.47, L, { seg: 12 });
      B.cyl(NS('gloss'), lc, 0.285, 0.5, 0, 1.6, L, { seg: 12, open: true });
      B.cyl(NS('gloss'), K.glassLt, 0.18, 0.36, 0, 3.0, L, { seg: 10 });
      B.lathe(NS('gloss'), lc, [[0, 0], [0.24, 0], [0.12, 0.2], [0, 0.26]], 0, 3.18, L, { seg: 10 });
      B.blink(lc === K.green ? '#5dff8a' : '#ff5a4a', 0, 3.0, L, { size: 0.22, rate: 0.33, lo: 0.1, hi: 4 });
    },
  };
  // 【道具 channelmarker:航道标】浮在水面(pos y = 海平面):variant 0 = 绿色右侧桩式标(爬梯+锥形顶标+闪绿光);
  // 1 = 红色左侧罐形浮标(罐形顶标+闪红光)
  // ---- channel marker: 0 = green starboard pile beacon (cone topmark), 1 = red port can buoy; pos on the water
  D.channelmarker = {
    desc: 'Channel marker on the water (pos y = sea level): variant 0 = green steel pile beacon with a ladder, cone topmark and blinking green light; 1 = red floating can buoy with a can topmark and blinking red light.',
    params: {}, variants: 2, mount: 'wall',
    build(B, o) {
      B.aoBase = null;
      if ((o.variant ?? 0) % 2 === 0) {
        B.add(NS('wood'), pileGeo(2.2, 0.26, 10, 3), 'white', 0, 1.6, 0, { ao: false });
        B.add(NS('rubber'), musselGeo(0.28, 10, 3), 'white', 0, 1.6, 0, { ao: false });
        B.cyl(NS('gloss'), K.green, 0.3, 1.4, 0, 1.6 + 1.5, 0, { seg: 12, open: true });
        B.box(NS('metal'), K.galvDk, 0.9, 0.06, 0.9, 0, 3.9, 0, { r: 0.02 });
        B.lathe(NS('gloss'), K.green, [[0, 0], [0.34, 0], [0, 0.5]], 0, 4.3, 0, { seg: 12 });
        B.cyl(NS('metal'), K.galv, 0.03, 0.4, 0, 4.1, 0, { seg: 6 });
        B.cyl(NS('gloss'), K.glassLt, 0.1, 0.2, 0, 4.92, 0, { seg: 8 });
        B.blink('#5dff8a', 0, 4.92, 0, { size: 0.16, rate: 0.5, lo: 0.1, hi: 4 });
        for (let y = 0.3; y < 2.2; y += 0.3) B.cyl(NS('metal'), K.galv, 0.014, 0.4, 0.33, y + 1.6 - 1.6, 0, { rx: HP, seg: 5 });
      } else {
        const n0 = B.cols.length;
        sub(B, 'buoy', 0, -0.45, 0, 0, { variant: 1, color: K.red });
        // 【采样避让】撤销 sub() 刚注册的全部碰撞盒:浮标悬在竞技场外的水面上,绝不允许产生碰撞体,
        // 更不允许被误判成"甲板"方块(那会污染导航/落点采样)
        B.cols.length = n0;                       // floating outside the arena: no collision (and never a "deck" block)
      }
    },
  };

  // ================================================================================================ ramps
  // 【坡道栏杆区】
  // All three dress level ramps whose top surface runs along local +Z from (0, 0, 0) to (0, rise, run); everything sits
  // outside the walking width (|x| ≥ width / 2). The handrails carry `rail` colliders (kids can't walk through or off the
  // side, shots / ink / squids pass); the masonry newels are solid.
  // 【共同约定】三者都装饰顶面沿局部 +Z、(0,0,0)→(0,rise,run) 的关卡坡道;所有构件放在步行宽
  // 度之外(|x| ≥ width/2);扶手为 rail 碰撞(挡人,墨/弹/鱿鱼可穿),砖石望柱为实体
  const slopeY = (rise, run, t) => (rise * t) / run;
  // 【slopeRail】沿斜坡扶手的 rail 碰撞盒:局部 x0…x1(须比坡道侧面外扩 ≥0.045,关卡的面/倒角采样
  // 点永不落进盒内),从 z=za 到 zb 分 n 段阶梯盒;每段低端从坡面上 0.06 起(避开甲板采样),
  // 高端到坡面上 top。bot 给固定底面:成为实体楼梯旁的全深栅栏,任何导航节点/边都无法跨越
  // Rail colliders along a sloped handrail: local x0…x1 (keep ≥ 0.045 outboard of the ramp's side face so the level's
  // face / bevel samples never land inside them), from z = za to zb in `n` stepped boxes; each box starts 0.06 above the
  // slope at its low end (clear of the deck samples) and reaches `top` above the slope at its high end. bot: fixed bottom
  // instead (a full-depth fence beside a solid stair side, so no nav node / edge survives across it).
  function slopeRail(B, x0, x1, za, zb, rise, run, top, n, bot) {
    for (let i = 0; i < n; i++) {
      const s0 = za + ((zb - za) * i) / n, s1 = za + ((zb - za) * (i + 1)) / n;
      const y0 = bot ?? Math.max(0, slopeY(rise, run, Math.min(s0, s1))) + 0.06, y1 = slopeY(rise, run, Math.max(s0, s1)) + top;
      B.col(x0, y0, Math.min(s0, s1), x1, y1, Math.max(s0, s1), { rail: true });
    }
  }
  // 【道具 gangwayrails:栈桥栏杆】为薄板关卡坡道(顶面 (0,0,0)→(0,rise,run),宽 W 居中)做两侧铝桁架:
  // 下弦兼踢脚板、立杆、斜坡扶手+中杆、N 形斜撑(无阴影,透过扶手可读),码头端铰链座+销轴,远端叉架着地滚轮;
  // 桁架外 rail 碰撞(走道从头到尾保持敞开)
  // ---- marina gangway: aluminium side trusses (bottom chord / kick plate, stanchions, sloped top + mid rail, N-bracing),
  //      hinge brackets + pins at the pier end, landing rollers at the far end. Same alloy language as the vessels pack.
  D.gangwayrails = {
    desc: 'Marina gangway dressing for a thin level ramp (local +Z from (0,0,0) up to (0,rise,run), width W centred): aluminium side trusses outside the walking width — bottom chord doubling as kick plate, stanchions, sloped top rail + mid rail, N-bracing — hinge brackets with pins at the pier end, landing rollers on forks at the far end. Rail colliders along both trusses (the walkway stays open end to end).',
    params: { run: 'm (3.85)', rise: 'm (1.3)', width: 'm (3.4)', thick: 'plank thickness (0.22)', posts: 'stanchions per side (5)', land0: 'low deck edge along the run (0.2)', land1: 'high deck edge along the run (run - 0.05)' }, variants: 1, mount: 'ground',
    build(B, o) {
      B.aoBase = null;
      const run = o.run ?? 3.85, rise = o.rise ?? 1.3, W = o.width ?? 3.4, th = o.thick ?? 0.22, n = Math.max(2, o.posts ?? 5);
      const L = Math.hypot(run, rise), pitch = Math.atan2(rise, run), alu = '#b7bec4', aluLt = '#c9ced3', aluDk = '#8b949c';
      const HR = 1.0, MR = 0.5, xo = W / 2 + 0.035;
      for (const sx of [-1, 1]) {
        const x = sx * xo;
        // bottom chord along the slope: covers the plank's side, stands 0.08 proud of the walking surface as a kick plate
        B.push(x, rise / 2, run / 2, 0, -pitch);
        B.box('metal', alu, 0.06, th + 0.12, L + 0.04, 0, 0.08 - (th + 0.12) / 2, 0, { r: 0.012 });
        pbox(B, NS('metal'), aluDk, 0.062, 0.02, L + 0.02, 0, 0.075, 0);
        B.pop();
        // stanchions (vertical) + rails
        const ts = [];
        for (let i = 0; i < n; i++) ts.push(0.12 + ((run - 0.24) * i) / (n - 1));
        for (const t of ts) {
          const y = slopeY(rise, run, t);
          B.cyl('metal', aluLt, 0.02, HR - 0.05, x, y + 0.05 + (HR - 0.05) / 2, t, { seg: 6 });
          pbox(B, NS('metal'), aluDk, 0.07, 0.02, 0.07, x, y + 0.075, t);
        }
        const rail = (h, r, mat) => {
          const a = P3(x, h + slopeY(rise, run, ts[0]), ts[0]), b = P3(x, h + slopeY(rise, run, ts[n - 1]), ts[n - 1]);
          B.tube(mat, aluLt, [a, b], r, { radial: 6 });
          for (const [p, sgn] of [[a, -1], [b, 1]]) B.sph(mat, aluLt, r * 1.05, p[0], p[1], p[2], { ws: 6, hs: 4 });
        };
        rail(HR, 0.025, 'metal'); rail(MR, 0.015, NS('metal'));
        // N-bracing in the lower bay (shadowless: reads through the rails)
        for (let i = 0; i + 1 < n; i++) {
          const t0 = ts[i], t1 = ts[i + 1];
          B.tube(NS('metal'), aluDk, [P3(x, slopeY(rise, run, t0) + 0.1, t0), P3(x, slopeY(rise, run, t1) + MR - 0.03, t1)], 0.01, { radial: 4 });
        }
        // hinge at the pier end: base plate + bracket cheek outside the walking width, pin through the chord
        B.box('metal', K.galvDk, 0.2, 0.02, 0.34, sx * (W / 2 + 0.14), 0.01, -0.02, { r: 0.006 });
        for (const bz of [-0.13, 0.09]) B.cyl(NS('metal'), K.galv, 0.012, 0.012, sx * (W / 2 + 0.2), 0.024, bz, { seg: 5 });
        pbox(B, 'metal', K.galvDk, 0.025, 0.2, 0.24, sx * (W / 2 + 0.095), 0.1, 0.0);
        B.cyl('metal', K.stainless, 0.03, 0.14, sx * (W / 2 + 0.07), 0.1, 0.02, { rz: HP, seg: 8 });
        // landing roller on a fork at the far end, resting on the deck it lands on
        const zr = run + 0.1, yr = rise + 0.07;
        pbox(B, 'metal', aluDk, 0.02, 0.16, 0.2, x + sx * 0.045, yr + 0.02, zr - 0.06);
        pbox(B, 'metal', aluDk, 0.02, 0.16, 0.2, x - sx * 0.045, yr + 0.02, zr - 0.06);
        B.cyl('rubber', '#26282d', 0.07, 0.07, x, yr, zr, { rz: HP, seg: 10 });
        B.cyl('metal', aluLt, 0.03, 0.09, x, yr, zr, { rz: HP, seg: 6 });
      }
      // rail colliders along both trusses (never across the walkway). They stop 0.25 m short of the deck edge at each end:
      // no rail end pokes onto a deck (bots walking along the pier edge), and a kid (r 0.38) still can't squeeze past the
      // end over the water — past it you are already standing on the deck. They reach 0.5 m out over the water so a kid
      // whose feet still hold the walkway edge (squid surfacing on the lip) is inboard of the box centre and gets pushed
      // back onto the walkway, never off it.
      // 【采样避让】两侧 rail 盒(绝不横跨走道)。两端各留 0.25 m 不伸上甲板:栏杆端头不会戳进
      // 甲板(沿码头沿走的机器人不会被绊),而 r=0.38 的小孩也挤不过端头落水——走过端头就已站上甲板。
      // 盒体向水面伸出 0.5 m:脚还勾着走道边的小孩(鱿鱼从沿口冒头场景)被盒中心推回走道,而非推下水。
      const la = (o.land0 ?? 0.2) + 0.25, lb = (o.land1 ?? run - 0.05) - 0.25, nR = Math.max(1, Math.ceil((lb - la) / 1.3));
      slopeRail(B, W / 2 + 0.045, W / 2 + 0.5, la, lb, rise, run, HR + 0.03, nR);
      slopeRail(B, -W / 2 - 0.5, -W / 2 - 0.045, la, lb, rise, run, HR + 0.03, nR);
    },
  };

  // 【道具 grandstair:大台阶栏杆】为宽坡道((0,0,0)→(0,rise,run),宽 W 居中)做两侧:灰泥 cheek 斜板+
  // 石压顶(盖住坡侧上沿),藏青钢立杆+清漆柚木扶手+双道细杆,脚端望柱带灯、顶端望柱带球饰;
  // 栏杆为 rail 碰撞,望柱实体(不可站立)
  // ---- grand stair balustrade: render cheek stringers with stone coping along both sides, navy steel stanchions,
  //      varnished teak handrail + two rod rails, newel pillars at the foot (with lanterns) and at the terrace (finials)
  D.grandstair = {
    desc: 'Grand-stair dressing (local +Z from the foot (0,0,0) up to (0,rise,run), width W centred): render cheek stringers + stone coping outside the walking width covering the upper band of the ramp sides, navy stanchions with a varnished teak handrail and two rod rails, square newel pillars with lanterns at the foot and ball finials at the top. Balustrade = rail colliders, newels = solid (off-limits tops).',
    params: { run: 'm (6.1)', rise: 'm (2.4)', width: 'm (6)' }, variants: 1, mount: 'ground',
    build(B, o) {
      B.aoBase = null;
      const run = o.run ?? 6.1, rise = o.rise ?? 2.4, W = o.width ?? 6, L = Math.hypot(run, rise), pitch = Math.atan2(rise, run);
      const render = K.render, stone = '#e7e1d4', navy = K.club, teak = '#9a6a3f', HR = 0.95;
      for (const sx of [-1, 1]) {
        const x = sx * (W / 2 + 0.06);
        // cheek stringer: sloped band over the top of the ramp side (0.12 thick, 0.42 deep, 0.06 upstand) + coping
        B.push(x, rise / 2, run / 2, 0, -pitch);
        B.box('paint', render, 0.12, 0.42, L + 0.1, 0, 0.06 - 0.21, 0, { r: 0.02 });
        B.box('paint', stone, 0.2, 0.06, L + 0.14, sx * 0.02, 0.09, 0, { r: 0.02 });
        pbox(B, NS('paint'), shade(render, 0.88), 0.122, 0.018, L + 0.08, 0, -0.26, 0);
        B.pop();
        // stanchions + rails from the foot newel to the top newel
        const t0 = 0.35, t1 = run - 0.3, n = 6;
        for (let i = 0; i < n; i++) {
          const t = t0 + ((t1 - t0) * i) / (n - 1), y = slopeY(rise, run, t) + 0.12;
          B.cyl('metal', navy, 0.02, HR - 0.1, x, y + (HR - 0.1) / 2, t, { seg: 6 });
          B.cyl(NS('metal'), navy, 0.035, 0.02, x, y + 0.01, t, { seg: 8 });
        }
        const at = (t, h) => P3(x, slopeY(rise, run, t) + h, t);
        // teak handrail: rounded, dips into the newels at both ends
        B.tube('wood', teak, [at(0.12, HR - 0.02), at(t0, HR + 0.02), at(t1, HR + 0.02), at(run - 0.1, HR - 0.02)], 0.035, { radial: 7 });
        for (const h of [0.35, 0.62]) B.tube(NS('metal'), navy, [at(0.14, h), at(run - 0.12, h)], 0.011, { radial: 4 });
        // foot newel with a lantern, top newel with a ball finial
        const newel = (t, y0, hN, lamp) => {
          const cx = sx * (W / 2 + 0.14);
          B.box('paint', render, 0.28, hN, 0.28, cx, y0 + hN / 2, t, { r: 0.03 });
          B.box('paint', stone, 0.36, 0.08, 0.36, cx, y0 + hN + 0.04, t, { r: 0.02 });
          B.box('paint', stone, 0.34, 0.1, 0.34, cx, y0 + 0.05, t, { r: 0.02 });
          if (lamp) {
            B.lathe('metal', navy, [[0.09, 0], [0.07, 0.04], [0.05, 0.05], [0, 0.05]], cx, y0 + hN + 0.08, t, { seg: 8 });
            B.cyl('glow', K.lamp, 0.07, 0.24, cx, y0 + hN + 0.25, t, { seg: 8, glow: 1.6 });
            for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + PI / 4; B.cyl(NS('metal'), navy, 0.008, 0.26, cx + Math.cos(a) * 0.075, y0 + hN + 0.25, t + Math.sin(a) * 0.075, { seg: 4 }); }
            B.lathe('metal', navy, [[0.11, 0], [0.1, 0.02], [0.03, 0.1], [0, 0.11]], cx, y0 + hN + 0.38, t, { seg: 8 });
            B.sph('metal', K.clubGold, 0.022, cx, y0 + hN + 0.5, t, { ws: 6, hs: 4 });
          } else B.sph('paint', stone, 0.11, cx, y0 + hN + 0.18, t, { ws: 10, hs: 7 });
        };
        newel(-0.02, 0, 1.0, true);
        newel(run + 0.14, rise, 0.95, false);
        // colliders: see-through balustrade between the newels = rail; the render newels are solid (nobody perches)
        // (full depth down to the quay beside the solid stair side: no quay nav node survives next to it, so bots never
        //  plan a drop off the stair through the balustrade; ends 6 cm short of the terrace front so its lip keeps its bevel)
        // 【采样避让】望柱间透空栏杆 = rail 盒;望柱实体(没人站上);rail 盒全深落到码头面(紧挨
        // 实体梯侧,码头上的导航节点无一幸存,bot 不会规划翻越栏杆跳下);盒端比平台前沿收进 6 cm,
        // 平台沿口的倒角采样不受影响
        const a = sx * (W / 2 + 0.045), b = sx * (W / 2 + 0.2), n0 = sx * (W / 2 + 0.045), n1 = sx * (W / 2 + 0.28);
        slopeRail(B, Math.min(a, b), Math.max(a, b), 0.12, run - 0.06, rise, run, HR + 0.08, 4, 0.06);
        B.col(Math.min(n0, n1), 0, -0.16, Math.max(n0, n1), 1.08, 0.12, { roof: true });
        B.col(Math.min(n0, n1), rise, run, Math.max(n0, n1), rise + 1.03, run + 0.28, { roof: true });
      }
    },
  };

  // 【收尾】给本包注册的每种道具包一层 build 包装,让 NS() 在构建时能拿到当前 builder(经 curB 取材质桶)
  // every docks type builds with its builder in scope for NS()
  for (const t of Object.keys(D)) {
    if (before.has(t)) continue;
    const def = D[t], build = def.build;
    def.build = function (B, o) { const prev = curB; curB = B; try { return build.call(this, B, o); } finally { curB = prev; } };
  }
}
