// ============================================================================
// 【中文导读】Crossroads Market —— 关卡表面材质(texlib 纹理层),占用本关预留的三个 PATTERN 槽
// ----------------------------------------------------------------------------
// 【模块定位】世界层的"程序化纹理"子系统:本关不加载任何贴图文件,三种地面/墙面(铺石、方石、电车轨)的
//   面貌全部由 GLSL 现场生成。启动时 texlib 各占一个 PATTERN 槽各生成一张纹理;layout.js 用
//   `pattern: SURF.<name>` 引用对应槽。消费者:levelMaterial.js(采样)与 mapkit 的 B/R/O(pattern 字段)。
// 【核心机制】SURF 把可读名字映射到槽 id(37/38/39);SURFACES 数组逐条描述每个槽:{ slot, name, onWall?,
//   onTop?, mat }。mat 是一个 texlib 材质描述(字段与 src/world/texlib.js 的 MATERIALS 条目同构):
//     detail/scale/tint/mask/alpha/mode(0 平铺 / 1 网格 / 2 六边)/sym/hr/ao/stair?/prep/surf ——
//     prep 与 surf 是 GLSL 片段,可用 texlib 自带的全部 GEN_COMMON 助手(如 FB、WO、wrp、hf、sdRB、
//     edgeProf、aa、lin…)。本文件用两个共享 GLSL 片段(COURSE 生成一层铺石,SETT_LOOK 生成花岗岩着色)
//     复用到 setts(街道)与 tramway(轨道带)两处,避免重复代码。
//   onWall / onTop 是"侧面/顶面改用别的槽"的覆盖(默认都用自己这个槽)。未使用的槽回退为 concrete。
// 【关键约定】米制;纹理坐标 P(即 uv)在"面空间"里按米计——所以一条 COURSE 的 a/b 直接是米;轨道带
//   对 v 方向(跨线)是固定布局(Plain repeat),因为轨道必须落在固定的 u/v 处。所有 GLSL 现场生成
//   【一次】,启动后不再重算:属性能省则省,严禁逐帧重建。
// 【配套阅读】src/world/texlib.js(材质描述与 GEN_COMMON 助手)、src/world/levelMaterial.js、
//   docs/INK.zh-CN.md、docs/ASSETS.zh-CN.md;兄弟文件 ./layout.js(layout 里 pattern: SURF.* 的用法)。
// ============================================================================
// Crossroads Market — stage surface materials (texlib layers), on this stage's three reserved PATTERN slots.
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
//   setts    granite cobble setts in courses across u (the streets, the square, the forecourts)
//   ashlar   coursed sandstone blocks: the stone buildings, the spawn terrace, quay walls — and, on top faces, the
//            stone-flag pavements / hall floor (the same coursed stone reads as flags in running bond)
//   tramway  grooved tram rails (gauge 1.435 m, centred across a 2.5 m strip; u runs along the track) in setts
// 【槽位别名】本关占用的三个 PATTERN 槽(37/38/39),供 layout.js 写 `pattern: SURF.setts` 等。
//   37 setts 街道广场铺石、38 ashlar 方石(兼作墙面/顶面)、39 tramway 电车轨道带。
export const SURF = { setts: 37, ashlar: 38, tramway: 39 };

// 【mode 常量】mat.mode 的两个取值:GRID=1 走网格采样(逐块随机可寻址),PLAIN=0 平铺(不按格,
//   轨道带必须用 PLAIN——轨道位置由 v 固定,不能被网格量化打乱)。
const GRID = 1, PLAIN = 0;

// 【共享 GLSL·逐皮铺石】COURSE 工厂:生成"一层皮(course)的铺石"GLSL 片段,被 setts 与 tramway 复用。
//   形参:fn 片段名前缀(每处调用要用不同前缀,否则变量重名)、CH 皮高(m)、SL 平均石块长(m)、NS/NR
//   石块数/皮数(hash 回绕边界)、JIT 长度抖动(m)、R 圆角半径(m)。返回值是一个 vec4 q:
//     q.x = 到石缝的边距 e(m,块内 > 0),q.yz = 归一化局部坐标/半尺寸,q.w = 逐块 hash(供色调变化)。
// 【构造意图/性能】用纯 hash(wrp/hf)做每块随机、不建任何几何:整条街的铺石是"一张纹理 + 位移/粗糙",
//   draw call 为 0 增量。b0/b1 那段"越界就挪到相邻块"保证边界块也能拿到正确的左右邻居,使石缝连续。
// shared GLSL: one sett course. a = along the course (m), b = across (m), CH = course height, SL = mean sett length,
// NS / NR = setts per course / courses per repeat (the jitter hash wraps on them), seed. Returns
// (edge distance e (m, > 0 inside the sett), local x / half-length, local y / half-height, sett id hash)
const COURSE = (fn, CH, SL, NS, NR, JIT, R) => /* glsl */`
  float rowf_${fn} = floor(b / ${CH});
  int rid_${fn} = wrp(ivec2(int(rowf_${fn}), 0), ivec2(${NR}, 1)).x;
  float ly_${fn} = b - rowf_${fn} * ${CH};
  float xs_${fn} = a - hf(ivec2(rid_${fn}, 3), 5u) * ${SL};
  float kf_${fn} = floor(xs_${fn} / ${SL});
  float b0_${fn} = kf_${fn} * ${SL} + (hf(wrp(ivec2(int(kf_${fn}), rid_${fn}), ivec2(${NS}, ${NR})), 7u) - 0.5) * ${JIT};
  float b1_${fn} = (kf_${fn} + 1.0) * ${SL} + (hf(wrp(ivec2(int(kf_${fn}) + 1, rid_${fn}), ivec2(${NS}, ${NR})), 7u) - 0.5) * ${JIT};
  if (xs_${fn} < b0_${fn}) { b1_${fn} = b0_${fn}; kf_${fn} -= 1.0; b0_${fn} = kf_${fn} * ${SL} + (hf(wrp(ivec2(int(kf_${fn}), rid_${fn}), ivec2(${NS}, ${NR})), 7u) - 0.5) * ${JIT}; }
  else if (xs_${fn} > b1_${fn}) { b0_${fn} = b1_${fn}; kf_${fn} += 1.0; b1_${fn} = (kf_${fn} + 1.0) * ${SL} + (hf(wrp(ivec2(int(kf_${fn}) + 1, rid_${fn}), ivec2(${NS}, ${NR})), 7u) - 0.5) * ${JIT}; }
  ivec2 sid_${fn} = wrp(ivec2(int(kf_${fn}), rid_${fn}), ivec2(${NS}, ${NR}));
  vec2 hb_${fn} = vec2((b1_${fn} - b0_${fn}) * 0.5, ${CH} * 0.5);
  vec2 lp_${fn} = vec2(xs_${fn} - (b0_${fn} + b1_${fn}) * 0.5, ly_${fn} - ${CH} * 0.5);
  float e_${fn} = -sdRB(lp_${fn}, hb_${fn}, ${R});
  vec4 ${fn} = vec4(e_${fn}, lp_${fn} / hb_${fn}, hf(sid_${fn}, 11u));
`;

// 【共享 GLSL·花岗岩着色】SETT_LOOK:在 COURSE 产出 q 的基础上算出 `stone`(石块本体色)与 `joint`
//   (石缝色)两个 vec3,供 setts 与 tramway 共用——街道与轨道两侧的铺石必须观感一致。
//   q = COURSE 结果。含:逐块三种色相(灰/暖/蓝灰)、车流磨亮的穹顶(wear)、云母暗斑/长石白点(fleck/
//   felds)、靠棱边加深(arris),以及带苔藓的缝隙色。GS 由调用处定义(每米纹理格数),此处只依赖不重定义。
// granite sett shading shared by the street setts and the tramway (q = COURSE result, d = dome 0..1)
const SETT_LOOK = /* glsl */`
  float t1 = q.w, t2 = fract(q.w * 7.31), t3 = fract(q.w * 13.7);
  vec3 hue = t2 < 0.34 ? vec3(1.05, 0.985, 0.94) : (t2 < 0.67 ? vec3(0.955, 0.99, 1.04) : vec3(1.0));
  float dome = clamp((1.0 - q.y * q.y) * (1.0 - q.z * q.z), 0.0, 1.0);
  float wear = smoothstep(0.15, 0.75, n[0] * 0.5 + 0.5 + 0.35 * (t3 - 0.5)) * dome;           // traffic-polished crowns
  vec4 g = c[0];
  float cell = g.x * GS;
  float fleck = step(0.86, g.z) * (1.0 - aa(0.0035 + 0.002 * fract(g.z * 5.3), cell));        // dark mica flecks
  float felds = step(0.9, fract(g.z * 7.1)) * (1.0 - aa(0.003, cell)) * (1.0 - step(0.86, g.z)); // pale feldspar
  float tone = 0.8 * (1.0 + 0.26 * (t1 - 0.5)) * (1.0 + 0.05 * n[1] + 0.03 * n[2]);
  vec3 stone = vec3(tone) * hue * (1.0 - 0.3 * fleck) * (1.0 + 0.18 * felds) * (1.0 + 0.07 * wear);
  stone *= 1.0 - 0.1 * clamp(1.0 - (q.x - 0.006) / 0.02, 0.0, 1.0);                          // darker toward the arris
  float moss = smoothstep(0.25, 0.8, n[1] * 0.5 + 0.5 + 0.25 * n[3]);
  vec3 joint = mix(vec3(0.33, 0.315, 0.29), vec3(0.25, 0.3, 0.2), moss * 0.7) * (1.0 + 0.18 * n[2]);
`;

// 【材质表】三条描述对应三个槽;被 texlib 在启动时各读一次、各生成一张纹理层。
//   字段逐条:slot=PATTERN 槽 id;name=可读名(onTop/onWall 缺省即用它);onWall=侧面改用哪个槽;
//   onTop=顶面改用哪个槽;mat=纹理生成描述,字段:
//     detail 细节强度(0..1,越大越吃高频格)/scale 纹理总尺寸(米,决定每格采样密度)/tint 是否吃底色染色/
//     mask 是否把 albedo.a 当遮罩(轨道带借此把轨道区与铺石区分开)/alpha 是否透明/
//     mode 0 平铺 1 网格 /sym 对称折叠数/hr 高度范围/ao 环境遮蔽/ prep 生成 f[]/w[] 噪声表的 GLSL /
//     surf 生成 s.*(alb/h/rough/cav/metal/a)的 GLSL。
export const SURFACES = [
  // 【槽 37 setts】街道/广场/前庭的花岗岩小方石:0.16 m 皮高、块长 0.24 m±4 cm、每皮随机错缝、11 mm 砂缝,
//   表面带穹顶与车流磨亮,逐块灰/暖/蓝灰色。onWall:38 —— 竖面(台阶立面等)改用方石槽,避免铺石纹理贴在立面上。
  {
    slot: 37, name: 'setts', onWall: 38,
    mat: {
      // 【参数】scale 1.92 m 一个纹理周期;mode GRID 逐格可寻址;hr 高度范围略低于/高于 0(石面微起伏)。
      detail: 0.55, scale: 1.92, tint: true, alpha: false, mode: GRID, sym: 3, hr: [-0.02, 0.006], ao: 0.6,
      // 【噪声表】f[0..3] 四层蓝噪声(3/12/96/40 格),w[0] 一层 Worley;GS 在 surf 里定为 scale/150。
      prep: `f[0] = FB(uv, ivec2(3), 4, 0.5, 3701u); f[1] = FB(uv, ivec2(12), 3, 0.5, 3703u); f[2] = FB(uv, ivec2(96), 2, 0.5, 3709u);
  f[3] = FB(uv, ivec2(40), 2, 0.5, 3713u); w[0] = WO(uv, ivec2(150), 1.0, 3711u);`,
      // 【着色】调用共享的 COURSE('q',…) 铺一皮石 + SETT_LOOK 上花岗岩色,再用 edgeProf 生成石缝剖面。
      surf: /* glsl */`
  // granite setts: 0.16 m courses along u, setts 0.24 m ± 4 cm with a random bond per course, 11 mm sand joints (grit
  // and a little moss), domed and traffic-polished crowns, per-sett granite (grey / warm / blue-grey), mica + feldspar
  const float GS = 1.92 / 150.0;
  float a = P.x, b = P.y;
  ${COURSE('q', '0.16', '0.24', 8, 12, '0.08', '0.024')}
  ${SETT_LOOK}
  vec2 pr = edgeProf(q.x, 0.0055, 0.03, 0.009, 0.016);
  float inJ = pr.y;
  s.alb = mix(stone, joint, inJ);
  s.h = pr.x + 0.0045 * dome * (1.0 - inJ) + 0.00015 * n[1] - 0.0002 * fleck;
  s.rough = mix(0.74 - 0.26 * wear + 0.05 * n[2], 0.96, inJ);
  s.cav = mix(1.0, 0.42, inJ);`,
    },
  },
  // 【槽 38 ashlar】方石:石构建筑、出生台地、码头墙的墙面;顶面则读作顺丁砌的石板路/大厅地面。
  //   0.36 m 皮高、块 0.72 m±0.18,7 mm 灰浆缝,drafted margin(25 mm 光边)包着錾面(tooled face)带斜向凿纹,
  //   逐块色调/分层线,少量风化/铁锈块。无 onWall/onTop:侧面顶面都用自己。
  {
    slot: 38, name: 'ashlar',
    mat: {
      // 【参数】scale 2.88 m 周期;detail 0.8 较高;sym 1(不折叠)。
      detail: 0.8, scale: 2.88, tint: true, alpha: false, mode: GRID, sym: 1, hr: [-0.009, 0.0025], ao: 0.5,
      // 【噪声表】f[3] 用非正方形的 Req(6×90 细长格)采出横向分层。
      prep: `f[0] = FB(uv, ivec2(4), 4, 0.5, 3801u); f[1] = FB(uv, ivec2(12), 3, 0.5, 3803u); f[2] = FB(uv, ivec2(120), 2, 0.5, 3807u);
  f[3] = Req(vec2(uv.x * 6.0, uv.y * 90.0), ivec2(6, 90), 3, 0.5, 3809u); w[0] = WO(uv, ivec2(48), 0.9, 3811u);`,
      // 【着色】同样复用 COURSE,但参数更方正(0.36/0.72);face/margin、tool 斜纹、worn/stain 风化锈迹分别控制。
      surf: /* glsl */`
  // coursed sandstone ashlar: 0.36 m courses, blocks 0.72 m ± 0.18 in a random bond, 7 mm lime joints, a drafted
  // margin (smooth 25 mm band) round a boasted face with diagonal tooling, per-block tone + bedding lines, a few
  // weathered / iron-stained blocks. On top faces it reads as flagstones in running bond.
  float a = P.x, b = P.y;
  ${COURSE('q', '0.36', '0.72', 4, 8, '0.36', '0.004')}
  vec2 pr = edgeProf(q.x, 0.0035, 0.006, 0.0022, 0.006);
  float inJ = pr.y;
  float face = smoothstep(0.018, 0.03, q.x);                       // 0 in the drafted margin, 1 on the tooled face
  float t1 = q.w, t2 = fract(q.w * 7.31), t3 = fract(q.w * 3.77);
  float tool = 0.5 + 0.5 * sin((a + b) * 190.0 + 3.0 * n[2] + t1 * 20.0);
  float bed = n[3];
  vec3 hue = mix(vec3(1.035, 0.99, 0.935), vec3(0.975, 0.99, 1.015), t2);
  float tone = 0.8 * (1.0 + 0.14 * (t1 - 0.5)) * (1.0 + 0.04 * n[1] + 0.03 * bed) * (1.0 - 0.035 * face * tool);
  float worn = step(0.86, t3) * smoothstep(-0.2, 0.5, n[0]);         // weathered block: darker, rougher, pitted
  vec4 g = c[0];
  float pit = worn * step(0.6, g.z) * (1.0 - aa(0.006, g.x * (2.88 / 48.0) * 0.4));
  float stain = step(0.95, fract(t1 * 17.3)) * smoothstep(0.2, -0.6, q.z) * 0.6;   // rust run from an old iron fixing
  vec3 col = vec3(tone) * hue * (1.0 - 0.1 * worn) * (1.0 - 0.25 * pit);
  col = mix(col, col * vec3(1.06, 0.86, 0.7), stain);
  col *= 1.0 + 0.03 * (1.0 - face);                                   // the smoother margin catches a little more light
  vec3 mort = vec3(0.9, 0.88, 0.83) * (1.0 + 0.05 * n[2]);
  s.alb = mix(col, mort, inJ);
  s.h = pr.x + (0.0012 * face * (0.55 + 0.45 * n[2]) + 0.00025 * face * tool - 0.0015 * pit + 0.0002 * bed) * (1.0 - inJ);
  s.rough = mix(0.78 + 0.06 * face + 0.08 * worn, 0.93, inJ);
  s.cav = mix(1.0, 0.7, inJ) * (1.0 - 0.3 * pit);`,
    },
  },
  // 【槽 39 tramway】电车轨道带(跨线 v 向 2.5 m,轨道沿 u):两条带槽的工字轨,轨距 1.435 m;
  //   每根轨两侧各一皮顺轨的长石,其余处石皮横跨轨道。albedo.a 作遮罩区分"铺石 vs 轨道"。
  //   mode PLAIN —— 轨道必须固定在确定的 v 处,不能用网格量化。onWall:38 立面仍用方石。
  {
    slot: 39, name: 'tramway', onWall: 38,
    mat: {
      // 【参数】mask:true 让 albedo.a 当遮罩(区分轨道/铺石);hr 下探到 -0.028(轨槽下沉)。
      detail: 0.5, scale: 2.5, tint: true, mask: true, alpha: false, mode: PLAIN, sym: 0, hr: [-0.028, 0.006], ao: 0.6,
      // 【噪声表】与 setts 同构;w[0] 用 190 格对应跨线 2.5 m(GS=2.5/190)。
      prep: `f[0] = FB(uv, ivec2(3), 4, 0.5, 3901u); f[1] = FB(uv, ivec2(12), 3, 0.5, 3903u); f[2] = FB(uv, ivec2(96), 2, 0.5, 3907u);
  f[3] = FB(uv, ivec2(40), 2, 0.5, 3913u); w[0] = WO(uv, ivec2(190), 1.0, 3911u);`,
      // 【着色】yc=P.y-1.25 把跨线坐标居中;d=到轨距线的有符号距离决定 border(0.17 m 内走沿轨长石,
      //   其余走横轨石皮);再叠 rz/head/groove/lip/tar 抽出钢轨截面,最后用 s.a=sett*lumS 写遮罩。
      surf: /* glsl */`
  // tramway strip (2.5 m across v, the track along u): two grooved girder rails at 1.435 m gauge, a border course of
  // long setts along each rail, and elsewhere setts in courses ACROSS the track. albedo.a = sett (block colour),
  // rgb = the rails' own steel (bright polished head, dark groove, duller lip). Plain repeat (the rails sit at fixed v).
  const float GS = 2.5 / 190.0;
  float yc = P.y - 1.25;
  float d = abs(yc) - 0.7175;                      // signed distance from the rail's gauge line (< 0 = inside the gauge)
  float a, b;
  vec4 q;
  bool border = abs(d) < 0.17;
  if (border) {
    // one course of long setts (0.3125 m, 8 per repeat) running along the rail either side of it
    a = P.x; b = (d < 0.0 ? -d - 0.05 : d - 0.05) + (yc > 0.0 ? 0.0 : 0.37);
    ${COURSE('q1', '0.12', '0.3125', 8, 4, '0.05', '0.018')}
    q = q1;
  } else {
    // setts in courses across the track: courses stacked along u (16 per repeat), setts along v
    a = P.y; b = P.x;
    ${COURSE('q2', '0.15625', '0.25', 10, 16, '0.08', '0.024')}
    q = q2;
  }
  ${SETT_LOOK}
  vec2 pr = edgeProf(q.x, 0.0055, 0.03, 0.009, 0.016);
  float inJ = pr.y;
  // rail: head (outer side), groove (inner side), guard lip — 0.07 m across, set flush in a tarred joint
  float rz = 1.0 - smoothstep(0.052 - PX, 0.052 + PX, abs(d + 0.008));
  float head = (1.0 - smoothstep(0.03 - PX, 0.03 + PX, abs(d - 0.018))) * rz;
  float groove = (1.0 - smoothstep(0.016 - PX, 0.016 + PX, abs(d + 0.02))) * rz;
  float lip = rz * (1.0 - head) * (1.0 - groove);
  float tar = (1.0 - smoothstep(0.052, 0.062, abs(d + 0.008))) * (1.0 - rz);
  vec3 steelHi = lin(vec3(0.74, 0.74, 0.76)) * (1.0 + 0.05 * n[2]), steelLo = lin(vec3(0.36, 0.33, 0.3)) * (1.0 + 0.1 * n[1]);
  vec3 grooveC = lin(vec3(0.12, 0.1, 0.09));
  vec3 railC = head * steelHi + groove * grooveC + lip * steelLo;
  float sett = (1.0 - rz) * (1.0 - tar);
  vec3 own = railC * rz + lin(vec3(0.09)) * tar;
  float lumS = mix(dot(stone, vec3(0.3333)), dot(joint, vec3(0.3333)) * 0.85, inJ);
  s.alb = own * (1.0 - sett);
  s.a = sett * lumS;
  s.h = mix(pr.x + 0.0045 * dome * (1.0 - inJ), -0.022 * groove - 0.001 * tar, 1.0 - sett);
  s.rough = mix(mix(0.74 - 0.26 * wear, 0.96, inJ), mix(0.3, 0.8, groove + lip * 0.6), 1.0 - sett);
  s.metal = (1.0 - sett) * (head * 0.9 + lip * 0.5);
  s.cav = mix(mix(1.0, 0.42, inJ), mix(1.0, 0.35, groove), 1.0 - sett);`,
    },
  },
];
