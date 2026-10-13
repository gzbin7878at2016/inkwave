// ============================================================================
// 【中文导读】Saltpan Basin 关卡的表面材质定义：把「盐壳 / 干裂泥 / 木栈板」三张程序化纹理
//             注册到 texlib 为本关卡预留的三个 PATTERN slot（34/35/36），供 layout.js 引用。
// ----------------------------------------------------------------------------
// 【模块定位】四件套中最底层：surfaces.js（本文件，定义材质）→ layout.js（pattern: SURF.x 引用）
//   → props.js / murals.js 在其上做装饰。调用链：../index.js 收集本文件的 SURFACES，交给
//   texlib 在 boot 期各生成一层（layer）；stage 槽位由 STAGE_SLOTS 预留（本关卡 [34,35,36]），
//   ../index.js 会校验 slot 与 STAGE_SURFACES 一致，不符则告警。
// 【核心机制】
//   · SURF 是「可读名字 → slot id」的映射，layout.js 里写 pattern: SURF.mud 即用 35 号槽。
//   · 每个 SURFACES 条目 = { slot, name, onWall?, onTop?, mat }：
//       mat     —— 一份 texlib 材质（字段含义见文件头英文注释：detail/scale/tint/mask/alpha/mode/
//                  sym/hr/ao + prep/surf —— 两段 GLSL，可用 texlib 的 GEN_COMMON 全部助手）。
//                  在 boot 期烘焙成独立纹理层，运行期不再分配。
//       onWall  —— 该槽"竖直面"改用什么 PATTERN id（默认用本槽）；本关卡 mud 的竖面换成 36 (timber)。
//       onTop   —— 该槽"顶面"改用什么 PATTERN id（默认用本槽）。
//   · 未使用的槽位回退到 concrete。
//   · 全部纹理程序化生成：GLSL 里用噪声/坐标直接合成盐晶、裂纹、木纹，无需外部贴图。
// 【关键约定】
//   · 米制；纹理按世界坐标 (P/uv) 平铺，故 scale 决定"几米一循环"。mode: GRID 表示格状排布。
//   · onWall/onTop 覆盖机制让同一块地形在顶面与竖面呈现不同材质（盐池底=盐壳、池壁=木护岸）。
//   · 约定「涂墨遮罩」：mat 的 mask 让方块固有色充当"墨水遮罩"，tint 让固有色染进纹理。
// 【配套阅读】../index.js（STAGE_SLOTS/SURFACES 校验）、docs/ASSETS.zh-CN.md、docs/INK.zh-CN.md、
//             ../../texlib.js（MATERIALS 字段与 GEN_COMMON 助手）、同目录 layout.js。
// ============================================================================
// Saltpan Basin — stage surface materials (texlib layers), on this stage's three reserved PATTERN slots.
//
// SURF maps your names to the slot ids; use them in layout.js as `pattern: SURF.<name>`. SURFACES lists what each
// slot holds: { slot, name, onWall?, onTop?, mat }.
//   mat      a texlib material, same fields as the entries of MATERIALS in src/world/texlib.js (detail, scale, tint,
//            mask, alpha, mode: 0 plain / 1 grid / 2 hex, sym, hr, ao, stair?, prep, surf — GLSL bodies that can use
//            every GEN_COMMON helper texlib's own materials use). Generated once at boot into its own layer.
//   onWall   PATTERN id drawn on this slot's vertical faces instead (default: the slot itself)
//   onTop    PATTERN id drawn on this slot's top faces instead (default: the slot itself)
// Unused slots fall back to concrete.
//
//   salt    crystallising-pan floor: polygonal salt crust with raised crystal ridges over shallow PINK BRINE pools
//           (the brine is the layer's own colour, glossy; the crust takes the block colour as a paint mask)
//   mud     sun-baked tidal clay on the dykes and yards: curled shrinkage-crack plates, salt bloom in the cracks.
//           Its vertical faces are the timber revetments that line every pan (onWall → timber)
//   timber  bleached boardwalk timber: 200 mm silvered boards, dark gaps, salt crusted along the joints, rusty nails
// 【SURF：名字 → slot】salt=盐壳池底(34)、mud=干裂泥堤(35)、timber=漂白木栈板(36)。
//   layout.js 的 mud()/pan()/wood() 预设即引用这三个名字。
export const SURF = { salt: 34, mud: 35, timber: 36 };

// 【mode 常量】1 = GRID（格状排布）；此处给个可读名字，避免魔数。另见 texlib：0 plain / 1 grid / 2 hex。
const GRID = 1;

// 【SURFACES：三张表面材质】按 slot 升序给出，../index.js 会收集烘焙。
export const SURFACES = [
  {
    // slot 34 saltcrust：结晶盐池底——多边形盐壳板块 + 抬起的晶脊，浅处露出粉色盐水，
    // 盐水是图层自身色（glossy）；盐壳吃方块固有色当涂墨遮罩。
    slot: 34, name: 'saltcrust',
    mat: {
      // detail=细节强度、scale=世界坐标缩放(米/循环)、tint=固有色染色、mask=固有色作墨水遮罩、
      // alpha=false(不透明)、mode=GRID、sym=7(对称量)、hr=高度范围[-0.005,0.003]、ao=0.35。
      // prep 预置 f[0..2]（不同尺度的 FB 噪声）与 w[0..1]（WO 波噪声，用于板块边界扰动）。
      detail: 0.45, scale: 3.2, tint: true, mask: true, alpha: false, mode: GRID, sym: 7, hr: [-0.005, 0.003], ao: 0.35,
      prep: `f[0] = FB(uv, ivec2(3), 4, 0.55, 811u); f[1] = FB(uv, ivec2(12), 3, 0.5, 821u); f[2] = FB(uv, ivec2(48), 3, 0.5, 827u);
  vec2 wq = uv + 0.012 * vec2(sin(TAU * (3.0 * uv.y + 2.0 * uv.x)), sin(TAU * (3.0 * uv.x - 2.0 * uv.y) + 1.1));
  w[0] = WO(wq, ivec2(7), 0.92, 831u); w[1] = WO(uv, ivec2(90), 1.0, 839u);`,
      surf: /* glsl */`
  // crystallising-pan floor: 0.45 m crust plates (slightly domed, per-plate tone) with raised crystal ridges along their
  // borders and a hairline split on the crest; fine crystal facets; shallow pink brine pools where the crust is thin —
  // glossy, the layer's own colour — with a slushy wet margin and little hopper crystals floating at the edges
  vec4 wc = c[0], xc = c[1];
  float big = n[0], mott = n[1], fine = n[2];
  float eP = (wc.y - wc.x) * (3.2 / 7.0);
  float ridge = (1.0 - smoothstep(0.0, 0.04, eP)) * (0.5 + 0.5 * step(0.35, fract((wc.z + wc.w) * 7.1)));
  float seam = 1.0 - aa(0.0025, eP);
  float dome = smoothstep(0.0, 0.18, eP);
  float facet = smoothstep(0.02, 0.35, xc.y - xc.x);
  float ftone = fract(xc.z * 7.31);
  float wf = 0.92 * big + 0.1 * mott + 0.14 * (wc.z - 0.5);
  float pool = smoothstep(0.02, -0.12, wf) * (1.0 - 0.75 * ridge * smoothstep(-0.3, -0.1, wf));
  float slush = smoothstep(0.16, 0.0, wf) * (1.0 - pool);
  // hopper crystals: small turned squares in the pool margins
  ivec2 hi = ivec2(floor(uv * 29.0));
  vec2 hq = fract(uv * 29.0) - 0.5 - (hf2(wrp(hi, ivec2(29)), 871u) - 0.5) * 0.5;
  float ha = hf(wrp(hi, ivec2(29)), 873u) * 1.57;
  hq = mat2(cos(ha), sin(ha), -sin(ha), cos(ha)) * hq;
  float hsz = 0.07 + 0.08 * hf(wrp(hi, ivec2(29)), 877u);
  float hop = step(0.55, hf(wrp(hi, ivec2(29)), 879u)) * (1.0 - smoothstep(hsz - 0.03, hsz, max(abs(hq.x), abs(hq.y))))
            * smoothstep(0.1, 0.6, slush + pool * (1.0 - pool) * 2.0);
  float tone = 0.95 + 0.08 * (fract(wc.z * 13.7) - 0.5);
  float crustL = 0.8 * tone * (1.0 + 0.035 * mott + 0.03 * fine) * (0.97 + 0.05 * ftone * facet) * (1.0 + 0.05 * ridge) * (1.0 - 0.05 * (1.0 - dome));
  crustL *= 1.0 - 0.12 * seam;
  vec3 brine = mix(lin(vec3(0.94, 0.83, 0.81)), lin(vec3(0.9, 0.73, 0.71)), smoothstep(-0.1, -0.5, wf)) * (0.95 + 0.05 * mott);
  vec3 wetC = lin(vec3(0.94, 0.87, 0.85)) * (0.96 + 0.05 * fine);
  vec3 own = vec3(0.0); float cov = 1.0;
  own = mix(own, wetC, slush * 0.55); cov *= 1.0 - slush * 0.55;
  own = mix(own, brine, pool); cov *= 1.0 - pool;
  own = mix(own, lin(vec3(0.97, 0.95, 0.94)), hop); cov *= 1.0 - hop;
  s.alb = own; s.a = cov * crustL;
  float hC = 0.0012 * dome + 0.0013 * ridge + 0.00035 * facet + 0.0002 * fine - 0.0009 * seam;
  s.h = mix(mix(hC, -0.0012 + 0.0003 * fine, slush * 0.7), -0.0028, pool) + 0.0006 * hop;
  s.rough = mix(mix(mix(0.74 - 0.12 * facet + 0.04 * mott, 0.34, slush), 0.05, pool), 0.4, hop);
  s.cav = 1.0 - 0.35 * seam;`,
    },
  },
  {
    // slot 35 drymud：晒裂潮泥——0.4 m 收缩裂纹板块（裂宽 8–20 mm、板缘上翘漂白）、次级细裂纹、
    //   粉砂颗粒、潮湿暗斑；裂缝及其沿线结盐霜（图层白色）；裂底暗（图层色）、偶有贝壳碎片。
    //   onWall:36 让它的竖直面改用 timber 材质（每个盐池都由木护岸包边）。
    slot: 35, name: 'drymud', onWall: 36,
    mat: {
      // detail=0.9(细节更强)、scale=2.4、hr=[-0.016,0.003]、ao=0.55；prep 里 f[0..2] 三级 FB，
      // w[0] 用带双重正弦扰动的 wq 造不规则裂纹走向。
      detail: 0.9, scale: 2.4, tint: true, mask: true, alpha: false, mode: GRID, sym: 7, hr: [-0.016, 0.003], ao: 0.55,
      prep: `f[0] = FB(uv, ivec2(4), 4, 0.55, 851u); f[1] = FB(uv, ivec2(24), 3, 0.5, 853u); f[2] = FB(uv, ivec2(96), 2, 0.5, 857u);
  vec2 wq = uv + 0.025 * vec2(sin(TAU * (2.0 * uv.y + uv.x)) + 0.5 * sin(TAU * (5.0 * uv.y - 3.0 * uv.x) + 0.7),
                              sin(TAU * (2.0 * uv.x - uv.y) + 1.3) + 0.5 * sin(TAU * (4.0 * uv.x + 5.0 * uv.y) + 2.1));
  w[0] = WO(wq, ivec2(6), 0.95, 859u); w[1] = WO(uv, ivec2(18), 1.0, 861u);`,
      surf: /* glsl */`
  // sun-baked tidal clay: 0.4 m shrinkage-crack plates (cracks 8–20 mm, plate rims curled up and bleached by the sun),
  // finer secondary cracks, silt grain, damp darker patches; salt bloom (own white) crusting in and along the cracks
  // and over damp patches, crack floors dark (own), a few shell fragments
  vec4 wc = c[0], sc = c[1];
  float big = n[0], silt = n[1], grit = n[2];
  float e1 = (wc.y - wc.x) * 0.4;
  float cw = 0.0025 + 0.0045 * (0.5 + 0.5 * big) + 0.003 * fract(wc.z * 5.1);
  float healed = step(0.72, fract((wc.z + wc.w) * 17.3)) * smoothstep(-0.2, 0.3, silt);
  float crack = (1.0 - aa(cw, e1)) * (1.0 - 0.85 * healed);
  float rim = (1.0 - smoothstep(cw, cw + 0.045, e1)) * (1.0 - crack);
  float cup = smoothstep(0.0, 0.16, e1);
  float e2 = (sc.y - sc.x) * (2.4 / 18.0);
  float sec = (1.0 - aa(0.0016, e2)) * step(0.42, fract(sc.z * 3.7 + sc.w * 1.3)) * smoothstep(0.02, 0.05, e1);
  float damp = smoothstep(0.2, 0.6, -big);
  float ptone = 0.93 + 0.12 * (fract(wc.z * 11.3) - 0.5);
  float mudL = 0.8 * ptone * (1.0 + 0.06 * silt + 0.05 * grit) * (1.0 - 0.12 * damp) * (1.0 + 0.08 * rim) * (1.0 - 0.28 * sec);
  float bloomF = smoothstep(0.3, 0.75, 0.55 * big + 0.45 * silt);
  float bloom = max((1.0 - smoothstep(0.0, 0.035, e1 - cw)) * bloomF, 0.55 * damp * smoothstep(0.1, 0.5, grit + 0.3)) * (1.0 - crack * 0.4);
  float shell = step(0.985, fract(sc.z * 13.3)) * (1.0 - aa(0.012, sc.x * 0.133)) * (1.0 - crack);
  vec3 own = vec3(0.0); float cov = 1.0;
  own = mix(own, lin(vec3(0.93, 0.92, 0.9)) * (0.95 + 0.06 * grit), bloom * 0.8); cov *= 1.0 - bloom * 0.8;
  own = mix(own, lin(vec3(0.86, 0.81, 0.74)), shell); cov *= 1.0 - shell;
  own = mix(own, lin(vec3(0.24, 0.2, 0.17)) * (0.8 + 0.3 * silt), crack); cov *= 1.0 - crack;
  s.alb = own; s.a = cov * mudL;
  s.h = -0.014 * crack + 0.0024 * rim + 0.0008 * cup - 0.0015 * sec + 0.0004 * silt + 0.00015 * grit + 0.0003 * bloom + 0.0005 * shell;
  s.rough = mix(mix(0.93 - 0.05 * rim, 0.72, bloom), 1.0, crack);
  s.cav = (1.0 - 0.6 * crack) * (1.0 - 0.25 * sec);`,
    },
  },
  {
    // slot 36 saltboard：漂白盐场木栈板——沿 u 方向 200 mm 宽的板、7 mm 缝、每循环每板一处错开的对接缝；
    //   银灰木纹（受 tint 染色）、晚材线、自对接缝端延伸的干裂；缝隙与板端结盐霜（图层白色）、缝暗（图层色）；
    //   每根托梁(每 0.6 m)上一对锈钉，锈迹渗入木里。
    slot: 36, name: 'saltboard',
    mat: {
      // detail=0.35、scale=2.4、sym=1(无对称)、hr=[-0.02,0.0015]、ao=0.45；prep 按板号 row 造逐板相位：
      //   f[0] 沿板长的高频纹理、f[2] 逐板错位、f[3] 细噪声、w[0] 木纹波。surf 里 PW=0.2 为板宽常量。
      detail: 0.35, scale: 2.4, tint: true, mask: true, alpha: false, mode: GRID, sym: 1, hr: [-0.02, 0.0015], ao: 0.45,
      prep: `int row = int(floor(P.y / 0.2)); float ly = P.y - float(row) * 0.2;
  f[0] = Req(vec2(uv.x * 6.0, ly * 30.0 + float(row) * 5.37), ivec2(6, 4096), 3, 0.55, 881u);
  f[1] = FB(uv, ivec2(5), 4, 0.5, 883u);
  f[2] = Req(vec2(uv.x * 3.0, float(row) * 2.31), ivec2(3, 4096), 3, 0.5, 887u);
  f[3] = FB(uv, ivec2(48), 2, 0.5, 889u);
  w[0] = WO(uv, ivec2(4, 12), 1.0, 891u);`,
      surf: /* glsl */`
  // bleached salt-works timber: 200 mm boards along u, 7 mm gaps, one staggered butt joint per board per repeat, silvered
  // grain (tinted), latewood lines, checks running in from the butt ends; salt crusted into the gaps and along the board
  // ends (own white), gaps dark (own), a pair of rusty nails over each joist (every 0.6 m) with rust bleeding into the wood
  const float PW = 0.2;
  int row = int(floor(P.y / PW));
  float ly = P.y - float(row) * PW;
  int js[12] = int[12](0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 2, 2);
  float jx = 0.3 + 0.6 * float(js[row]);
  float eE = jd(P.x - jx, 2.4);
  float eS = min(ly, PW - ly);
  vec2 ps = edgeProf(eS, 0.0035, 0.006, 0.002, 0.02);
  vec2 pe = edgeProf(eE, 0.0015, 0.004, 0.0016, 0.016);
  float gap = max(ps.y, pe.y);
  float b1 = hf(ivec2(row, 0), 5u), b2 = hf(ivec2(row, 1), 5u), b3 = hf(ivec2(row, 2), 5u);
  float q = clamp((ly - PW * 0.5) / (PW * 0.5 - 0.0035), -1.0, 1.0);
  float cupH = mix(-0.0006, 0.0008, b2) * (1.0 - q * q);
  float streak = n[0], patchN = n[1], warp = n[2], fib = n[3];
  float late = smoothstep(0.72, 0.96, 0.5 + 0.5 * cos(TAU * (q * (1.4 + 1.2 * b1) + 1.1 * warp + 3.0 * b3)));
  // checks from the butt ends
  float chk = 0.0;
  for (int k = 0; k < 2 * uOne; k++) {
    float h1 = hf(ivec2(row, k + 3), 41u), h2 = hf(ivec2(row, k + 3), 43u);
    if (h1 > 0.6) continue;
    float L = 0.05 + 0.25 * h2;
    float xc = jx + (k == 0 ? 1.0 : -1.0) * (0.01 + L);
    float yc = 0.03 + h1 * (PW - 0.06) / 0.6;
    float taper = clamp(1.0 - jd(P.x - xc, 2.4) / L, 0.0, 1.0);
    float d = abs(ly - yc - 0.002 * sin(P.x * 29.0 + h1 * 40.0));
    chk = max(chk, (1.0 - smoothstep(0.0003 + 0.0012 * taper, 0.0003 + 0.0012 * taper + PX, d)) * step(0.001, taper));
  }
  chk *= 1.0 - gap;
  // nails: a pair over every joist, 35 mm in from each board edge
  float nx = jd(P.x - 0.3, 0.6);
  float ny = min(abs(ly - 0.035), abs(PW - 0.035 - ly));
  float nd = length(vec2(nx, ny));
  float nail = 1.0 - aa(0.0045, nd);
  float halo = (1.0 - smoothstep(0.0045, 0.03, nd)) * (1.0 - nail) * step(0.4, hf(wrp(ivec2(int(floor(P.x / 0.6 + 0.5)), row), ivec2(4, 12)), 51u));
  float board = 0.8 * (0.86 + 0.26 * b1) * (1.0 + 0.1 * streak) * (1.0 - 0.1 * late) * (1.0 + 0.03 * fib) * (1.0 + 0.05 * patchN);
  board *= (1.0 - 0.35 * chk) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.03, eE)));
  // salt bloom: along the gaps + board ends, patchy
  float sEdge = (1.0 - smoothstep(0.0, 0.012 + 0.012 * patchN, min(eS - 0.0035, eE - 0.0015))) * smoothstep(-0.2, 0.5, patchN + 0.3 * fib);
  float sPatch = smoothstep(0.55, 0.85, c[0].z * 0.5 + 0.5 * (0.5 + 0.5 * patchN)) * (1.0 - smoothstep(0.1, 0.35, c[0].x)) * 0.5;
  float salt = clamp(max(sEdge * 0.75, sPatch), 0.0, 0.8) * (1.0 - gap);
  vec3 own = vec3(0.0); float cov = 1.0;
  own = mix(own, lin(vec3(0.94, 0.93, 0.91)) * (0.95 + 0.05 * fib), salt); cov *= 1.0 - salt;
  own = mix(own, lin(vec3(0.45, 0.24, 0.12)) * (0.8 + 0.4 * fib), halo * 0.45); cov *= 1.0 - halo * 0.45;
  own = mix(own, lin(vec3(0.3, 0.17, 0.1)) * (0.7 + 0.5 * smoothstep(0.0045, 0.0, nd)), nail); cov *= 1.0 - nail;
  own = mix(own, mix(lin(vec3(0.05, 0.045, 0.04)), lin(vec3(0.6, 0.58, 0.55)), 0.2 * smoothstep(-0.2, 0.6, patchN)), gap); cov *= 1.0 - gap;
  s.alb = own; s.a = cov * board;
  float h = min(ps.x, pe.x);
  h += (cupH + 0.00012 * streak + 0.00018 * late + 0.00006 * fib - 0.0025 * chk + 0.0002 * salt) * (1.0 - gap);
  s.h = mix(h, -0.0006 + 0.0003 * smoothstep(0.0045, 0.0, nd), nail);
  s.rough = mix(mix(0.78 + 0.08 * (fib * 0.5 + 0.5) + 0.04 * late, 0.7, salt), 0.95, gap);
  s.metal = nail * 0.3;
  s.cav = mix(1.0, 0.3, gap) * (1.0 - 0.35 * chk);`,
    },
  },
];
