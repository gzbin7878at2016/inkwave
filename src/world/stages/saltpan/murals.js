// ============================================================================
// 【中文导读】Saltpan Basin 关卡的壁画/标识贴花（murals）：在共享的 mural atlas 画布上绘制本关卡
//             专属的 4 张 decal，并返回它们的图集占位表，供 levelMaterial 采样并贴到「脸面」上。
// ----------------------------------------------------------------------------
// 【模块定位】四件套中的"贴花层"，位于 layout/props 之上：
//   依赖 ../index.js 装配时把本文件的 drawMurals 挂进 STAGES['saltpan']；关卡加载时由
//   src/world/murals.js 调用 drawMurals(g, R, kit)，只在属于本关卡的图集区域 R 内绘制。
//   引用关系：layout.js 里盒子的 `mural:[{n,id}]` 用到的 id（4-7）正是在此定义的。
// 【核心机制】
//   · mural atlas 画布 2048×2048：顶部 0-3 行是四张共享的可平铺条带（id 0-3），下方 2048×1008
//     的"关卡区"留给各关自定义 decal（本关卡占 id 4-11，实际用到 4-7）。加载时先画共享条带，
//     再调用本文件的 drawMurals 画本关贴花。
//   · 返回的每条占位 { id, x, y, w, h, m:[faceW,faceH] } 声明"这张贴花画在图集的哪块矩形、
//     真实映射到几米×几米的面上"；也可用 place/fx 显式指定在面上的落位与磨损参数。
//   · u/v 约定（本关卡这些顶面）：u 朝 −X、v 沿上坡 / 朝 +Z，而 canvas 的 v 向上，故贴图方向需换算。
// 【关键约定】
//   · 米制；id 4-11 保留给本关卡，勿与其它关卡冲突。id 4 被旋转 180° 绘制，因为在 −X 侧读它时朝向相反。
//   · 磨损修边技巧：wear() 用 destination-out 在刚画好的矩形里挖出随机斑点，模拟刷漆的风化缺口；
//     fx 的 chip 项控制贴花被表面斑驳"啃掉"的程度。
// 【配套阅读】src/world/murals.js（图集总表与调用点）、docs/ASSETS.zh-CN.md、
//             同目录 layout.js（mural 字段的挂载）、surfaces.js（下层表面材质）。
// ============================================================================
// Saltpan Basin — stage decals / signage for the mural atlas (see src/world/murals.js).
//
// drawMurals(g, R, kit) is called whenever this stage is loaded: draw into the canvas 2D context `g`, inside the
// stage region R = { x, y, w, h } (px; 2048 x 1008) only, and return the table entries for mural ids 4…11:
//   { id, x, y, w, h, m: [faceW, faceH] }                         decal fitted at the face origin, faceW x faceH metres
//   { id, x, y, w, h, place: [x0, xLen, y0, yLen], fx: [weather, chip] }  explicit placement (murals.js header)
// fx defaults to [0.85, 1] (how much the surface's mottling shows through / its chips cut the decal).
// A layout face shows a mural with `mural: [{ n: [nx, ny, nz], id }]` on a box (the face whose outward normal
// matches n). Ids 0–3 are the shared tileable strips (INKWAVE banner, chevrons, shop fronts, shipping line).
// kit: { font(px), fontB(px), NAVY, CORAL, TEAL, MUSTARD, CREAM, SKY, squid(g, x, y, s, color, eye), blob(g, x, y, r, seed, color) }
//
// Saltpan's decals (face u runs toward −X on these top faces, v up-slope / toward +Z; canvas v runs up):
//   4  packing-shed roof, the slope facing mid: giant painted SALT (read from the far side → drawn upside down)
//   5  packing-shed roof, the slope facing base: SALTPAN BASIN · SALT CO.
//   6  loading-gallery deck: stencilled LOADING STAGE band + bay ticks along the front edge
//   7  wind-pump staging: painted ring (SALTPAN BASIN · BRINE PUMP No 1 · 1889) and a compass star round the tower
// 【贴花 id 表】本关卡四张 decal 在 mural atlas 里的 id：棚顶朝中庭面(4)、棚顶朝仓库面(5)、
//   装货甲板条带(6)、风车基台(7)。layout.js 的 mural:[{n,id}] 直接用这些 id。
export const MURAL_IDS = { roofMid: 4, roofBase: 5, gallery: 6, staging: 7 };

// 【居中排字并自动缩号】把文本居中画在 (x,y)；若超宽则每次减 4px 字号重排，直到放进 maxW。
function paintText(g, s, x, y, px, font, fill, maxW) {
  g.font = font(px);
  let p = px;
  while (g.measureText(s).width > maxW && p > 10) { p -= 4; g.font = font(p); }
  g.fillStyle = fill; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(s, x, y);
}
// 【磨损修边】在矩形 (x,y,w,h) 内挖掉 n 个随机小椭圆斑点（destination-out），做出刷漆风化的缺口；
//   seed 走一个线性同余随机数，保证同一 seed 每次加载结果一致（可复现）。
// brush-worn edges: knock random flecks out of what was just painted in a rect
function wear(g, x, y, w, h, n, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) { g.globalAlpha = 0.25 + rnd() * 0.6; g.beginPath(); g.ellipse(x + rnd() * w, y + rnd() * h, 2 + rnd() * 9, 1 + rnd() * 4, rnd() * 3, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

// 【绘制入口】按关卡加载时由 src/world/murals.js 调用，在本关卡图集区 R 内画 4 张贴花并返回占位表。
//   g=2D 上下文、R={x,y,w,h} 本关卡区、kit=字体与调色板（见文件头）。100 px/m：11 m 宽的面 ≈ 1100 px。
export function drawMurals(g, R, kit) {
  const out = [];
  const PAINT = '#efe9dc', RED = '#b8493d';
  // ---- 4: 棚顶朝中庭的坡面（11×4.24 m，100 px/m），旋转 180° 绘制以便从中庭一侧读时朝向正确
  // ---- 4: roof slope facing mid (11 x 4.24 m, 100 px/m), drawn rotated 180° so it reads from the mid side
  {
    const r = { x: R.x, y: R.y, w: 1100, h: 424 };
    g.save(); g.translate(r.x + r.w / 2, r.y + r.h / 2); g.rotate(Math.PI);
    g.fillStyle = PAINT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = kit.font(300); g.fillText('SALT', 0, 30);
    g.fillRect(-470, -175, 940, 16); g.fillRect(-470, 172, 940, 16);
    g.restore();
    wear(g, r.x, r.y, r.w, r.h, 420, 7);
    out.push({ id: 4, ...r, m: [11, 4.24], fx: [0.95, 1] });
  }
  // ---- 5: 棚顶朝仓库基地的坡面：SALTPAN BASIN / SALT CO. 两行字
  // ---- 5: roof slope facing base
  {
    const r = { x: R.x, y: R.y + 440, w: 1100, h: 424 };
    g.save(); g.translate(r.x + r.w / 2, r.y + r.h / 2);
    paintText(g, 'SALTPAN BASIN', 0, -40, 150, kit.font, PAINT, 1000);
    paintText(g, 'SALT  CO.', 0, 110, 96, kit.font, PAINT, 700);
    g.fillStyle = PAINT; g.fillRect(-420, 42, 840, 10);
    g.restore();
    wear(g, r.x, r.y, r.w, r.h, 380, 11);
    out.push({ id: 5, ...r, m: [11, 4.24], fx: [0.95, 1] });
  }
  // ---- 6: 装货甲板条带（在 14×6.9 m 甲板的前缘，占 12×0.8 m）：BAY 刻度 + LOADING STAGE 字样。
  //     用 place 显式落位到面上（而非默认贴原点），故返回项带 place 字段。
  // ---- 6: gallery deck band (12 x 0.8 m on the 14 x 6.9 m deck, along the front edge)
  {
    const r = { x: R.x + 1120, y: R.y, w: 920, h: 64 };
    g.save(); g.translate(r.x, r.y);
    g.fillStyle = PAINT;
    for (let i = 0; i <= 12; i++) g.fillRect(i * (r.w / 12) - 2, 6, 4, 14);
    g.fillRect(0, 4, r.w, 3);
    paintText(g, 'LOADING  STAGE  ·  No 1', r.w / 2, 42, 34, kit.fontB, PAINT, r.w - 40);
    g.restore();
    wear(g, r.x, r.y, r.w, r.h, 160, 5);
    out.push({ id: 6, ...r, place: [1, 12, 6.0, 0.8], fx: [0.9, 1] });
  }
  // ---- 7: 风车基台（7.2×7.2 m）：环状排字 + 罗盘星绕塔一圈。文字沿圆环逐字旋转摆放。
  // ---- 7: pump staging (7.2 x 7.2 m): ring lettering + compass star round the tower
  {
    const r = { x: R.x + 1120, y: R.y + 90, w: 700, h: 700 };
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, k = r.w / 7.2;
    g.save(); g.translate(cx, cy);
    g.strokeStyle = PAINT; g.lineWidth = 7;
    for (const rr of [2.75, 2.2]) { g.beginPath(); g.arc(0, 0, rr * k, 0, Math.PI * 2); g.stroke(); }
    const txt = 'SALTPAN BASIN  ·  BRINE PUMP No 1  ·  1889  ·  ';
    g.font = kit.fontB(34); g.fillStyle = PAINT; g.textAlign = 'center'; g.textBaseline = 'middle';
    const rad = 2.475 * k, per = (Math.PI * 2) / txt.length;
    for (let i = 0; i < txt.length; i++) { g.save(); g.rotate(i * per); g.translate(0, -rad); g.fillText(txt[i], 0, 0); g.restore(); }
    // compass points outside the ring
    for (let i = 0; i < 4; i++) {
      g.save(); g.rotate((i * Math.PI) / 2); g.fillStyle = i === 0 ? RED : PAINT;
      g.beginPath(); g.moveTo(0, -3.35 * k); g.lineTo(0.22 * k, -2.85 * k); g.lineTo(-0.22 * k, -2.85 * k); g.closePath(); g.fill();
      g.restore();
    }
    g.restore();
    wear(g, r.x, r.y, r.w, r.h, 300, 3);
    out.push({ id: 7, ...r, m: [7.2, 7.2], fx: [0.9, 1] });
  }
  return out;
}
