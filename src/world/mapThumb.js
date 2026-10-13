// ============================================================================
// 【中文导读】关卡顶视缩略图——把布局数据直接画成一张 SVG 字符串
// ----------------------------------------------------------------------------
// 【模块定位】世界层(src/world/)的"纯数据→字符串"工具,不 import three.js、不碰 DOM。
//   由 src/main.js 在启动时对每张地图调用一次:`m.thumb = layoutThumbSVG(MAP_LAYOUTS[m.layout || m.id], m.theme)`,
//   结果存进地图定义对象,选图/大厅界面(src/ui/menus.js)直接把它塞进卡片 HTML 当图用;
//   若生成失败,menus.js 会退回 ui-icons.js 的程序化 `mapThumb()` 占位图。生成在 try/catch 里,坏图不至于崩启动。
// 【核心机制】expand() 先把布局"摊平"成一份可画的列表(镜像 half、丢掉 rail、把 OCT 的零件折叠成单个八边形),
//   再按 kind 把每个 def 转成坐标(轴对齐盒 → rect,旋转盒/坡道 → polygon,八边形 → 8 边 polygon),
//   最后按 top 高度排序、逐个输出 SVG。视觉编码(让新手一眼看懂结构):
//     · 长轴 z 横放("世界 z → SVG x"),Alpha 的基地位于左侧;
//     · 高度 top 映射到"投影偏移 + 明度":越高的块阴影越偏、颜色越亮 → 读起来有立体层次;
//     · 坡道用斜纹 pattern、格栅用网格 pattern、集装箱保留自身颜色。
// 【关键约定】
//   · viewBox 固定 W×H(344×160),靠 preserveAspectRatio='xMidYMid slice' 裁剪适配,不随地图尺寸变化;
//   · 映射函数 X(z)/Y(x):X 把世界 z 转成 svg 的 x,Y 把世界 x 转成 svg 的 y 且翻转(Alpha 的右侧朝上);
//   · 只画单/半两种列表,镜像规则与 level.js 完全一致——缩略图与真实关卡"同源同镜像",不容许各自为政。
// 【配套阅读】src/world/maps.js(布局来源)、src/world/mapkit.js(OCT 的 oct 标记)、
//   src/world/level.js(镜像/朝向的权威实现)、src/ui/menus.js(消费 m.thumb)。
// ============================================================================
// Top-down stage thumbnail (SVG markup) generated from the real layout data, for the setup-screen map cards.
// Pure data → string (no three.js): boxes and ramp footprints, mirrored like the level, drawn with a height-shaded
// drop shadow so structure reads at a glance. Long axis (z) runs left → right; team Alpha's base is on the left.

// 【缩略图固定尺寸】344×160 的横向 viewBox;所有坐标都缩放进这个框,靠 slice 裁剪多余边。
const W = 344, H = 160;

// 【expand:把布局摊平成可画列表】做三件事:
//   ① 镜像:`half` 的每个 def 用 mirror() 做 180° 旋转((x,z)→(-x,-z)),与 level.js 的 mirrorDef 同为
//      "同一份半边数据补成整场";`single` 原样保留。镜像必须连 oct 标记一起翻,否则八边形会被画到错误象限。
//   ② 丢 rail:`rail` 是纯碰撞栏杆(可视栏杆另有道具在画),缩略图没有可画之物,过滤掉。
//   ③ 折叠八边形:OCT 拆出的"十字 + 四角板"用 oct 标记去重,合并成单个 'octagon' def,免得画出内部接缝。
function expand(layout) {
  const mirror = (d) => d.kind === 'box'
    ? { ...d, min: [-d.max[0], d.min[1], -d.max[2]], max: [-d.min[0], d.max[1], -d.min[2]] }
    : d.kind === 'obox' ? { ...d, center: [-d.center[0], d.center[1], -d.center[2]], oct: d.oct && [-d.oct[0], -d.oct[1], d.oct[2]] }
    : { ...d, low: [-d.low[0], d.low[1], -d.low[2]], high: [-d.high[0], d.high[1], -d.high[2]] };
  // (rails are collision-only railings: nothing to draw)
  const all = [...layout.single, ...layout.half, ...layout.half.map((d) => (d.oct && d.kind === 'box' ? { ...mirror(d), oct: [-d.oct[0], -d.oct[1], d.oct[2]] } : mirror(d)))].filter((d) => !d.rail);
  // octagon platforms (maps.js OCT) are drawn as one octagon instead of their plus + corner-slab parts
  // 【八边形折叠】同一只八边形的五个部件共享相同 oct 标记,用"标记 + 顶高"做去重键,只留第一块并改写成
  //   kind:'octagon'。只有 'box' 参与折叠(角板是 obox,本就跳过),top 取 d.max[1] 即八边形顶面高度。
  const out = [], seen = new Set();
  for (const d of all) {
    if (!d.oct) { out.push(d); continue; }
    const key = d.oct.map((v) => v.toFixed(2)).join(',') + ':' + (d.kind === 'box' ? d.max[1] : d.center[1] + d.size[1] / 2).toFixed(1);
    if (seen.has(key) || d.kind !== 'box') continue;
    seen.add(key);
    out.push({ ...d, kind: 'octagon', top: d.max[1] });
  }
  return out;
}

// 【主入口:布局 → SVG 字符串】layout 来自 MAP_LAYOUTS;theme 决定海面/地表配色('day'|'sunset'|'golden');
//   teams 是两队的主题色(出生点色斑与圈用)。返回一段完整 <svg>…</svg> 标记,直接 innerHTML 即得图。
export function layoutThumbSVG(layout, theme = 'day', teams = ['#18c7e8', '#ff4a5a']) {
  const B = layout.bounds;
  const pad = 10;
  // 【缩放与居中】s = 让场地在留白 pad 内"刚好装下"的统一比例(取 z、x 两方向较小者,保证不变形);
  //   ox/oy 是两条轴各自的居中偏移。注意 x 与 z 用了不同的边界差,因为长轴是 z。
  const s = Math.min((W - pad * 2) / (B.maxZ - B.minZ), (H - pad * 2) / (B.maxX - B.minX));
  const ox = (W - (B.maxZ - B.minZ) * s) / 2, oy = (H - (B.maxX - B.minX) * s) / 2;
  const X = (z) => ox + (z - B.minZ) * s;          // world z → svg x
  const Y = (x) => oy + (B.maxX - x) * s;          // world x → svg y (Alpha's right = up)
  const sunset = theme === 'sunset', golden = theme === 'golden';
  const sea = sunset ? ['#ffb36b', '#e0607e', '#5b3b9a'] : golden ? ['#ffd49a', '#3aa9b6', '#185f86'] : ['#7fe3f5', '#2fb1e6', '#1e76cf'];
  // 【SVG defs】三段可复用素材:海面垂直线性渐变 tsea、格栅网格 pattern tgr、坡道 45° 斜纹 pattern tst。
  //   id 里拼了 layout.id 与 theme,避免一页里多张缩略图的 def id 撞车。
  const defs = `<defs><linearGradient id="tsea${layout.id}${theme}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sea[0]}"/><stop offset=".55" stop-color="${sea[1]}"/><stop offset="1" stop-color="${sea[2]}"/></linearGradient>
    <pattern id="tgr${layout.id}" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><rect width="2.4" height="2.4" fill="#8fa0b3"/><rect width="1.2" height="1.2" fill="#dfe6ee"/></pattern>
    <pattern id="tst${layout.id}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#f4ecdc"/><rect width="2" height="4" fill="#ffd66b"/></pattern></defs>`;
  const parts = [`<rect width="${W}" height="${H}" fill="url(#tsea${layout.id}${theme})"/>`];
  // soft wave marks
  // 【装饰波纹】几条等距的白色小弧,纯装饰,让海面不空;位置用确定式公式错开,保证每次生成一致。
  for (let i = 0; i < 6; i++) { const y = 14 + i * 26, x = (i * 53) % 300; parts.push(`<path d="M${x} ${y} q8 -5 16 0 t16 0" stroke="#fff" stroke-opacity=".35" stroke-width="2.4" fill="none" stroke-linecap="round"/>`); }
  // 【def → 可绘坐标】按 kind 分流:box→轴对齐矩形;octagon→8 边多边形;obox→旋转后的四边形;
  //   ramp→坡道脚印(斜置坡道用自身四边形,轴对齐坡道用沿/跨向的盒);每条都记下 top(顶面高度)供着色与排序。
  const blocks = expand(layout).map((d) => {
    if (d.kind === 'box') return { x0: d.min[0], x1: d.max[0], z0: d.min[2], z1: d.max[2], top: d.max[1], d };
    if (d.kind === 'octagon') {
      const [cx, cz, R] = d.oct;
      const poly = Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + (i * Math.PI) / 4; return [cx + R * Math.cos(a), cz + R * Math.sin(a)]; });
      return { poly, top: d.top, d };
    }
    if (d.kind === 'obox') {
      // rotated footprint → polygon (x, z corners)
      const a = (d.rotY * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), hx = d.size[0] / 2, hz = d.size[2] / 2;
      const poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => [d.center[0] + c * hx * i + sn * hz * k, d.center[2] - sn * hx * i + c * hz * k]);
      return { poly, top: d.center[1] + d.size[1] / 2, d };
    }
    const dx = d.high[0] - d.low[0], dz = d.high[2] - d.low[2];
    if (Math.abs(dx) > 1e-3 && Math.abs(dz) > 1e-3) {
      // a ramp running at an angle: its own quad (the along/across box below only fits axis-aligned ramps)
      const l = Math.hypot(dx, dz), px = (-dz / l) * (d.width / 2), pz = (dx / l) * (d.width / 2);
      const poly = [[d.low[0] + px, d.low[2] + pz], [d.high[0] + px, d.high[2] + pz], [d.high[0] - px, d.high[2] - pz], [d.low[0] - px, d.low[2] - pz]];
      return { poly, top: d.high[1], ramp: true, d };
    }
    const along = Math.abs(dz) > Math.abs(dx);
    const hw = d.width / 2;
    return along
      ? { x0: d.low[0] - hw, x1: d.low[0] + hw, z0: Math.min(d.low[2], d.high[2]), z1: Math.max(d.low[2], d.high[2]), top: d.high[1], ramp: true, d }
      : { x0: Math.min(d.low[0], d.high[0]), x1: Math.max(d.low[0], d.high[0]), z0: d.low[2] - hw, z1: d.low[2] + hw, top: d.high[1], ramp: true, d };
  }).sort((a, b) => a.top - b.top);
  // 【按高度升序绘制】低的块先画、高的后画,于是高块自然压在低块上,配合各自投影形成层次。
  for (const b of blocks) {
    const top = b.top;
    // 【多边形分支】旋转盒/八边形/斜坡走这里:先画一层偏移的深色投影(仅当有高度、非坡道、非格栅),
    //   再画本体的多边形,填充色按 top 做明度插值(越高越亮)。多边形用同一组顶点平移 dx,dy 得到"投影"。
    if (b.poly) {
      const pts = (dx, dy) => b.poly.map(([px, pz]) => `${(X(pz) + dx).toFixed(1)},${(Y(px) + dy).toFixed(1)}`).join(' ');
      if (top > 0.2 && !b.ramp && !b.d.grate) parts.push(`<polygon points="${pts(1.2 + top * 0.35, 1.2 + top * 0.45)}" fill="#1b2a44" opacity=".28"/>`);
      const k = Math.min(1, Math.max(0, top) / 5);
      const tint = b.d.pattern === 5 && b.d.color ? b.d.color : null;   // containers keep their colour
      const fill = tint || (b.d.grate ? `url(#tgr${layout.id})` : b.ramp ? `url(#tst${layout.id})` : top <= 0.05 ? (sunset ? '#f1cfae' : golden ? '#f4e6cf' : '#f3ecdd') : mix(sunset ? '#e8bf99' : golden ? '#ead6b6' : '#e7dcc6', sunset ? '#fbe6d0' : golden ? '#fff8ec' : '#ffffff', k));
      parts.push(`<polygon points="${pts(0, 0)}" fill="${fill}" stroke="#2a3552" stroke-opacity="${top > 0.05 ? 0.35 : 0.15}" stroke-width="1" stroke-linejoin="round"/>`);
      continue;
    }
    // 【轴对齐矩形分支】把世界 (x,z) 的包围盒换算成 svg 的 x/y/w/h。注意 y 取的是 x1(坐标被 Y() 翻转),
    //   且 w 来自 z 跨度、h 来自 x 跨度——因为长轴 z 被横放。投影偏移量随 top 线性增大,制造"被顶上光源打出"的立体感。
    const x = X(b.z0), y = Y(b.x1), w = (b.z1 - b.z0) * s, h = (b.x1 - b.x0) * s;
    if (top > 0.2 && !b.ramp && !b.d.grate) parts.push(`<rect x="${(x + 1.2 + top * 0.35).toFixed(1)}" y="${(y + 1.2 + top * 0.45).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.2" fill="#1b2a44" opacity=".28"/>`);
    let fill;
    if (b.d.grate) fill = `url(#tgr${layout.id})`;
    else if (b.ramp) fill = `url(#tst${layout.id})`;
    else if (top <= 0.05) fill = sunset ? '#f1cfae' : golden ? '#f4e6cf' : '#f3ecdd';
    else { const k = Math.min(1, top / 5); fill = mix(sunset ? '#e8bf99' : golden ? '#ead6b6' : '#e7dcc6', sunset ? '#fbe6d0' : golden ? '#fff8ec' : '#ffffff', k); }
    const tint = b.d.pattern === 5 && b.d.color ? b.d.color : null; // containers keep their colour
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${top > 0.05 ? 1.4 : 2.5}" fill="${tint || fill}" stroke="#2a3552" stroke-opacity="${top > 0.05 ? 0.35 : 0.15}" stroke-width="1"/>`);
  }
  // team splats + spawn rings
  // 【出生点标记】每队出生点画:一圈白色外环 + 队伍色内环(定位),加 5 个随机感墨点色斑(blob)作队伍标识。
  //   色斑向己方外侧偏(t 为 0/1 左右分别偏 -14 / +14),seed 由 i + t*7 确定,保证可复现不闪烁。
  layout.spawnPads.forEach(([px, , pz], t) => {
    const cx = X(pz), cy = Y(px), c = teams[t];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.7 + t * 2, r = 9 + (i % 3) * 6;
      const sx = cx + Math.cos(a) * r * (t ? -1.4 : 1.4) + (t ? -14 : 14), sy = cy + Math.sin(a) * r;
      parts.push(blob(sx, sy, 5 + (i % 2) * 3.5, c, i + t * 7));
    }
    parts.push(`<circle cx="${cx}" cy="${cy}" r="7.5" fill="none" stroke="#fff" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="7.5" fill="none" stroke="${c}" stroke-width="1.6"/>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${defs}${parts.join('')}</svg>`;
}

// 【blob:不规则墨点】沿圆周取 14 个采样点,半径叠两个正弦扰动(频率 3 与 5、相位由 seed 决定),
//   得到一块"手泼"似的确定性墨斑,返回一段 path d。出生点色斑用它,形状每次渲染都一致。
function blob(x, y, r, c, seed) {
  let d = '';
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + 0.18 * Math.sin(a * 3 + seed) + 0.1 * Math.sin(a * 5 + seed * 2));
    d += `${i ? 'L' : 'M'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`;
  }
  return `<path d="${d}Z" fill="${c}" opacity=".92"/>`;
}

// 【mix:两个 #rrggbb 颜色按 k∈[0,1] 线性插值】用于按块高做明度渐变(k = 高度归一化值)。
//   逐通道拆位、加权平均、再拼回十六进制;不依赖任何颜色库。
function mix(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
