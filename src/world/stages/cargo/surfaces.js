// ============================================================================
// 【中文导读】Cargo 关卡专属表面材质(tarmac / quay / chequer)—— 三个"舞台自留"的 PATTERN 槽位。
// ----------------------------------------------------------------------------
// 【模块定位】
//   本文件是 Cargo 关卡"四件套"之一的 surfaces(关卡表面材质),由 src/world/stages/cargo/ 目录拥有。
//   它只做两件事:① 用 SURF 把可读名字映射到槽位 id;② 用 SURFACES 描述每个槽位里"烘焙什么材质"。
//   被谁用:src/world/stages/surfaces.js 汇总所有关卡的 SURFACES(本关槽位 [46,47,48],见 STAGE_SLOTS),
//   texlib.js 在 boot 期把这三种材质逐纹素烘成 sampler2DArray 的一层;levelMaterial.js 再按 layout 里
//   每个面的 pattern id 到槽位表取用。layout.js 以 `pattern: SURF.<name>` 引用它们。
//   生命周期:材质只在启动时生成一次,运行期只读。
// 【核心机制】
//   每个槽位的 mat 对象遵循 src/world/texlib.js 的 MATERIALS 契约:
//     prep  —— 声明最多 4 个 fbm(f[])与 2 个 worley(w[])采样请求(种子固定 → 结果确定);
//     surf  —— 一段 GLSL,读入采样结果,写回 s.alb(rgb=自有颜色 / a=遮罩覆盖度)、s.h(高度,米)、
//              s.rough(粗糙度)、s.metal(金属度)、s.cav(空腔遮蔽)。texlib 用这些在 GPU 上逐纹素烘焙出贴图。
//   三种材质都是 mask 层:layout.js 给每个块一个底色(顶点色),材质写 s.alb.a 决定"这个纹素上,底色能露出多少"
//   (遮盖的部分),s.alb.rgb 则是材质自带的颜色(沥青封缝黑、锈、裸钢…)。这样同一张材质能配合不同底色复用。
// 【关键约定】
//   • 米制:surf 里的长度、高度都用米(如 quay 的 2.4m 现浇板、chequer 的 40mm 凸点间距)。
//   • Y 轴向上:与所有关卡材质一致,UV 的 v 沿面内竖直方向(见 level.js 的墙面采样规则)。
//   • 地图 180° 旋转镜像:材质与坐标无关(按面内 UV 采样),天然对两半一致;但面上画的标识(murals)才需成对。
//   • 可玩墙面采样:竖直面/顶面的槽位可经 onWall / onTop 二次兑换(此处 tarmac/quay 的 onWall 指向基础
//     PATTERN.concrete,chequer 指向 PATTERN.hullpaint);兑换表在 levelMaterial.js 组装,STAGE_SURFACES 的
//     onWall/onTop 优先级更高。
// 【配套阅读】docs/ASSETS.zh-CN.md、docs/RENDERING-UE4.zh-CN.md §3.3;
//   兄弟文件 src/world/texlib.js(MATERIALS 契约)、src/world/stages/surfaces.js(槽位汇总)、
//   src/world/levelMaterial.js(采样与兑换)、同目录 layout.js / murals.js / props.js。
// ============================================================================
// Cargo Terminal — stage surface materials (texlib layers `cargo:<name>`), on this stage's three reserved PATTERN slots.
//
// SURF maps our names to the slot ids (use them in layout.js as `pattern: SURF.<name>`). SURFACES lists what each slot
// holds: { slot, name, onWall?, onTop?, mat } — mat follows the MATERIALS contract in src/world/texlib.js (prep declares
// up to 4 fbm + 2 worley requests, surf writes s.alb / s.a / s.h / s.rough / s.metal / s.cav; heights in metres).
// All three are `mask` layers: albedo.a = where the block colour is applied (the painted / tinted part), albedo.rgb =
// the layer's own colours (bitumen sealant, rust, bare steel …), so layout.js picks the tone per block.
//
//   tarmac   terminal yard asphalt (stack blocks, truck lane): aggregate in binder, sealed crack network, oil drips,
//            traffic-polished patches — the painted bay / lane markings are murals on top of it (murals.js)
//   quay     apron concrete: 2.4 m cast slabs, sawn + sealed joints, broom finish per slab, rust bleeding from
//            lashing gear, exposed aggregate where worn, rubber scuffs
//   chequer  painted steel chequer (tread) plate: raised lugs alternating ±45°, paint worn off the lug tops, seam
//            weld + bolt rows on the repeat border, rust spots — catwalk landings, hatch-cover rims, the spawn stair
import { PATTERN } from '../../mapkit.js';

// (slots 46–48 belong to this stage: stages/surfaces.js STAGE_SLOTS)
// 【SURF 名字→槽位】给 layout.js 用:pattern: SURF.tarmac / SURF.quay / SURF.chequer。46/47/48 是本关在全局
// 槽位表中的三段(每个关卡各占 3 段,见 src/world/stages/surfaces.js 的 STAGE_SLOTS)。
export const SURF = { tarmac: 46, quay: 47, chequer: 48 };

// 【抗平铺模式常量】传给 mat.mode:1 = GRID(网格对齐,适合砖/板缝),2 = HEX(六边形偏移,打散平铺感,适合
// 沥青这种无方向纹理)。数值须与 texlib.js 的 mode 定义一致。
const GRID = 1, HEX = 2;

// 【SURFACES 槽位定义表】每项 = 一个槽位:{ slot, name, onWall?, onTop?, mat }。被 stages/surfaces.js 汇总、
// texlib.js 烘焙。slot 必须落在本关的预留段内(46–48),否则汇总时会告警并跳过。
export const SURFACES = [
  // 【槽位 46 · tarmac】堆场/车道沥青:集料嵌在结合料里,封缝的裂缝网、油渍、轮胎磨光斑。mode=HEX 打散平铺。
  // 【mat 字段术语表(texlib MATERIALS 契约,三个材质共用)】
  //   detail 细节手感强度;scale 世界尺度(米/纹理重复);tint 是否吃块底色(mask 层=tint 生效);
  //   mask 遮罩层标记;alpha 该层是否带透明;mode 抗平铺模式(GRID/HEX);sym 对称模式(镜像/旋转,防接缝感);
  //   hr 高度范围 [最小,最大](米,给法线/位移用);ao 空腔遮蔽强度;
  //   prep f[]/w[] 采样请求;surf 描述如何把采样结果写成 s.alb / s.a / s.h / s.rough / s.metal / s.cav。
  {
    slot: 46, name: 'tarmac', onWall: PATTERN.concrete,
    mat: {
      detail: 0.6, scale: 4.0, tint: true, mask: true, alpha: false, mode: HEX, sym: 7, hr: [-0.004, 0.0012], ao: 0.45,
      prep: `f[0] = FB(uv, ivec2(3), 4, 0.5, 3101u); f[1] = FB(uv, ivec2(8), 3, 0.5, 3107u); f[2] = FB(uv, ivec2(48), 2, 0.5, 3109u);
  f[3] = FB(uv, ivec2(4), 3, 0.55, 3113u); w[0] = WO(uv, ivec2(190), 1.0, 3119u); w[1] = WO(uv, ivec2(7), 0.9, 3121u);`,
      // 【tarmac surf GLSL】① 由 c[0](粗 worley)分离出集料"石子"与结合料两相,按石子/交通磨光调底色 tone;
      // ② 由 c[1] 的 worley 蜂窝边生成裂缝网,用 edgeSel 每格随机决定"封缝 / 开缝 / 无",s.a 是"底色覆盖度"
      // (封缝黑 0.85、油渍 0.55、裂缝 0.6 依次把覆盖度压下去,s.alb 存这些自有颜色);③ s.h/s.rough/s.cav
      // 给封缝一个微凸、石子磨光处降粗糙度。-- 见英文注释逐行对应。
      surf: /* glsl */`
  // dense-graded wearing course: aggregate set in binder (the tinted part), a sealed crack network (glossy black
  // bitumen bands, own colour), oil drips, rubber scuffs, lighter traffic-polished patches
  vec4 wc = c[0];
  float stone = smoothstep(0.08, 0.3, wc.y - wc.x);
  float light = step(0.9, wc.z);
  float big = n[0], mid = n[1], fine = n[2];
  float tone = mix(0.6 + 0.05 * fine, 0.74 + 0.16 * fract(wc.z * 7.13), stone);
  tone = mix(tone, 0.98, light * stone * 0.55);
  float worn = smoothstep(-0.05, 0.6, big);
  tone *= 1.0 + 0.07 * big + 0.04 * mid + 0.06 * worn;
  // crack network: coarse worley cell borders where the low-frequency noise allows it; sealant band ~4 cm
  vec4 cr = c[1];
  float edgeM = (cr.y - cr.x) * (4.0 / 7.0);
  float edgeSel = fract((cr.z + cr.w) * 13.7 + abs(cr.z - cr.w) * 5.3);     // per cell border: sealed / open / none
  float crackOn = smoothstep(0.3, 0.62, n[3]) * step(0.55, edgeSel);
  float seal = (1.0 - aa(0.016 + 0.006 * mid, edgeM)) * crackOn;
  float crack = (1.0 - aa(0.0018, edgeM)) * step(edgeSel, 0.3) * smoothstep(0.1, 0.4, n[3]) * 0.7;
  // oil drips + rubber scuffs (own dark colours)
  float oil = smoothstep(0.66, 0.84, 0.5 + 0.5 * mid) * smoothstep(0.1, 0.5, 0.5 + 0.5 * fine) * (1.0 - seal);
  float scuff = smoothstep(0.7, 0.9, 0.5 + 0.5 * n[3]) * smoothstep(0.3, 0.7, 0.5 + 0.5 * big) * 0.5;
  vec3 own = vec3(0.0); float cov = 1.0;
  own = mix(own, vec3(0.035, 0.035, 0.038) * (1.0 + 0.3 * fine), seal * 0.85); cov *= 1.0 - seal * 0.85;
  own = mix(own, vec3(0.03, 0.028, 0.026), oil * 0.55); cov *= 1.0 - oil * 0.55;
  own = mix(own, vec3(0.05), crack * 0.6); cov *= 1.0 - crack * 0.6;
  s.alb = own;
  s.a = cov * clamp(tone * 1.18 * (1.0 - 0.22 * scuff), 0.0, 1.0);
  s.h = (-0.0011 * (1.0 - stone) + 0.0005 * stone * (1.0 - wc.x * wc.x) + 0.0001 * big) * (1.0 - seal) + 0.0006 * seal - 0.002 * crack;
  s.rough = mix(mix(mix(0.93, 0.8, stone) - 0.1 * worn, 0.38, seal * 0.9), 0.5, oil * 0.6);
  s.cav = (1.0 - 0.25 * (1.0 - stone)) * (1.0 - 0.4 * crack);`,
    },
  },
  // 【槽位 47 · quay】码头岸线混凝土:2.4m 现浇大板(每次重复 2×2 块)、锯切+封缝的纵缝、逐板交替方向的扫帚纹、
  // 逐板色调、被车磨出骨料的磨光区、系固件淌下的锈、发丝裂缝、橡胶刮痕。mode=GRID(板缝需与世界网格对齐)。
  {
    slot: 47, name: 'quay', onWall: PATTERN.concrete,
    mat: {
      detail: 0.9, scale: 4.8, tint: true, mask: true, alpha: false, mode: GRID, sym: 7, hr: [-0.008, 0.001], ao: 0.5,
      prep: `f[0] = FB(uv, ivec2(4), 5, 0.55, 3201u); f[1] = FB(uv, ivec2(12), 3, 0.5, 3203u);
  f[2] = FB(uv, ivec2(4, 150), 1, 0.5, 3209u); f[3] = FB(uv, ivec2(150, 4), 1, 0.5, 3211u);
  w[0] = WO(uv, ivec2(160), 1.0, 3217u); w[1] = WO(uv, ivec2(6), 0.85, 3221u);`,
      // 【quay surf GLSL】① 把 P(面内米坐标)切成 2.4m 单元,cw 取 2×2 循环,用 sdRB 圆角盒 SDF 求板缝 e;
      // ② edgeProf 由 e 得到缝轮廓(高度 pr.x、缝内标记 inJ),扫帚纹方向按 (cw.x+cw.y) 奇偶交替;
      // ③ c[0] worley 出骨料与磨光;c[1] worley 出锈斑与发丝裂缝;④ 缝里填封缝黑、锈色、裂缝色(s.a 覆盖度);
      // s.h 用缝轮廓 + 扫帚/斑驳微起伏,s.rough/s.cav 跟随。-- 见英文注释逐行对应。
      surf: /* glsl */`
  // 2.4 m cast apron slabs (2 x 2 per repeat): sawn joints filled with dark sealant, rounded arrises, a broom finish
  // whose direction alternates slab to slab, per-slab tone, exposed aggregate where traffic wore the laitance off,
  // rust bleeding from dropped lashing gear, hairline cracks, rubber scuffs
  ivec2 cell = ivec2(floor(P / 2.4));
  ivec2 cw = wrp(cell, ivec2(2));
  vec2 lp = P - (vec2(cell) * 2.4 + 1.2);
  float e = -sdRB(lp, vec2(1.2), 0.004);
  vec2 pr = edgeProf(e, 0.005, 0.007, 0.0025, 0.008);
  float inJ = pr.y;
  float hid = hf(cw, 3u), hid2 = hf(cw, 5u);
  bool du = ((cw.x + cw.y) & 1) == 0;
  float broom = du ? n[2] : n[3];
  float mott = n[0], cloud = n[1];
  vec4 ag = c[0];
  float agg = smoothstep(0.1, 0.3, ag.y - ag.x);
  float worn = smoothstep(0.15, 0.7, mott + 0.3 * cloud);
  float tone = 0.8 * (1.0 + 0.09 * (hid - 0.5) + 0.07 * mott + 0.04 * cloud + 0.035 * broom);
  tone *= mix(1.0, 0.86 + 0.28 * fract(ag.z * 9.1), agg * worn * 0.7);
  float grime = (1.0 - smoothstep(0.0, 0.07, e - 0.005)) * (1.0 - inJ);
  tone *= 1.0 - 0.1 * grime;
  // rust stains: a few blotches per repeat (coarse worley cells), fading out from a darker core
  vec4 rs = c[1];
  float rsel = step(0.72, rs.z) * step(0.03, e);
  float rust = rsel * (1.0 - smoothstep(0.05, 0.28 + 0.1 * cloud, rs.x * 0.8)) * smoothstep(-0.3, 0.4, cloud);
  float crack = (1.0 - aa(0.0022, (rs.y - rs.x) * 0.8)) * step(0.5, fract(rs.z * 5.7 + rs.w * 3.1)) * smoothstep(0.2, 0.5, mott) * step(0.05, e);
  float scuff = smoothstep(0.72, 0.92, 0.5 + 0.5 * cloud) * smoothstep(0.35, 0.8, 0.5 + 0.5 * mott) * 0.6;
  vec3 own = vec3(0.0); float cov = 1.0;
  own = mix(own, vec3(0.03, 0.03, 0.032), inJ); cov *= 1.0 - inJ;
  own = mix(own, vec3(0.34, 0.16, 0.07) * (0.85 + 0.3 * cloud), rust * 0.55); cov *= 1.0 - rust * 0.55;
  own = mix(own, vec3(0.08), crack * 0.55); cov *= 1.0 - crack * 0.55;
  s.alb = own;
  s.a = cov * tone * (1.0 - 0.2 * scuff);
  s.h = pr.x + (0.00012 * broom + 0.0002 * mott + 0.0003 * agg * worn) * (1.0 - inJ) - 0.0015 * crack;
  s.rough = mix(mix(0.86 + 0.05 * broom - 0.08 * worn + 0.04 * hid2, 0.45, inJ), 0.8, rust * 0.5);
  s.cav = mix(1.0, 0.5, inJ) * (1.0 - 0.35 * crack) * (1.0 - 0.1 * grime);`,
    },
  },
  // 【槽位 48 · chequer】涂装钢花纹(防滑)板:40mm 网格上交替 ±45° 的凸点、重复边界上的对接焊缝+螺栓排、
  // 走行线上凸点顶被磨掉漆露出裸钢(自有颜色)、锈点。用于猫道落脚、舱盖边缘、出生台楼梯。onWall 指向
  // PATTERN.hullpaint(竖直面按船体漆读取)。mode=GRID、sym=3(小对称度,强调凸点的规则排布)。
  {
    slot: 48, name: 'chequer', onWall: PATTERN.hullpaint,
    mat: {
      detail: 0.3, scale: 1.2, tint: true, mask: true, alpha: false, mode: GRID, sym: 3, hr: [-0.004, 0.003], ao: 0.3,
      prep: `f[0] = FB(uv, ivec2(3), 4, 0.5, 3301u); f[1] = FB(uv, ivec2(24), 2, 0.5, 3303u); f[2] = FB(uv, ivec2(6), 3, 0.5, 3307u);
  f[3] = FB(uv, ivec2(10), 3, 0.5, 3309u); w[0] = WO(uv, ivec2(8), 0.9, 3311u);`,
      // 【chequer surf GLSL】① 把面内坐标按 40mm(CS)切格;按格奇偶把局部坐标旋到 ±45°,用圆角盒 SDF 出凸点
      // ld 与圆顶 dome;② 每 1.2m 一条焊缝 jd,出焊珠 bead、焊缝旁 nearS、螺栓排 bolt;③ wear = 凸点圆顶被磨;
      // ④ 磨处写裸钢自有色、锈点写锈色,并把覆盖度压下;s.h/s.rough/s.metal 反映凸点高度、磨光、露钢金属度。
      surf: /* glsl */`
  // painted steel chequer plate: raised lugs on a 40 mm grid alternating ±45°, a butt-welded seam with a bolt row on
  // the repeat border, paint worn off the lug tops along the walking lines (bare steel, own colour), rust spots
  const float CS = 0.04;
  vec2 cp = P / CS;
  ivec2 ci = ivec2(floor(cp));
  vec2 cf = cp - vec2(ci) - 0.5;
  bool odd = ((ci.x + ci.y) & 1) == 1;
  vec2 q = (odd ? vec2(cf.x + cf.y, cf.y - cf.x) : vec2(cf.x - cf.y, cf.x + cf.y)) * 0.70710678;
  float ld = length(vec2(max(abs(q.x) - 0.26, 0.0), q.y)) - 0.1;
  float lw = PX / CS;
  float lug = 1.0 - smoothstep(-lw, lw, ld);
  float dome = sqrt(clamp(-ld / 0.1, 0.0, 1.0));
  float dS = min(jd(P.x, 1.2), jd(P.y, 1.2));
  float bead = exp(-dS * dS / 0.00004);
  float nearS = 1.0 - smoothstep(0.004, 0.012, dS);
  lug *= 1.0 - nearS;
  float bu = abs(fract(P.x / 0.15) - 0.5) * 0.15, bv = abs(fract(P.y / 0.15) - 0.5) * 0.15;
  float bd = min(length(vec2(bu, jd(P.y, 1.2) - 0.03)), length(vec2(bv, jd(P.x, 1.2) - 0.03)));
  float bolt = 1.0 - aa(0.009, bd);
  float mott = n[0], fineN = n[1], wearN = n[2], rustN = n[3];
  float wear = lug * dome * smoothstep(0.45, 0.8, 0.5 + 0.5 * wearN);
  float edgeWear = bead * smoothstep(0.5, 0.8, 0.5 + 0.5 * wearN) * 0.7;
  vec4 rc = c[0];
  float rust = step(0.86, rc.z) * (1.0 - smoothstep(0.04, 0.2 + 0.08 * rustN, rc.x * 0.15)) * smoothstep(-0.2, 0.4, rustN);
  vec3 steel = vec3(0.42, 0.43, 0.44) * (1.0 + 0.08 * fineN);
  vec3 rustC = vec3(0.3, 0.13, 0.05) * (0.8 + 0.4 * fineN);
  vec3 own = vec3(0.0); float cov = 1.0;
  own = mix(own, steel, wear * 0.85); cov *= 1.0 - wear * 0.85;
  own = mix(own, steel * 0.9, edgeWear); cov *= 1.0 - edgeWear;
  own = mix(own, rustC, rust * 0.7); cov *= 1.0 - rust * 0.7;
  s.alb = own;
  s.a = cov * 0.8 * (1.0 + 0.05 * mott + 0.03 * fineN) * (1.0 - 0.12 * (1.0 - lug) * (1.0 - bolt) * 0.0) * (1.0 + 0.06 * lug * dome);
  s.h = 0.0018 * lug * dome + 0.0008 * bead - 0.0012 * nearS * (1.0 - bead) + 0.0014 * bolt;
  s.rough = mix(mix(0.5 + 0.06 * mott, 0.32, wear), 0.82, rust * 0.7);
  s.metal = wear * 0.8 + edgeWear * 0.6;
  s.cav = (1.0 - 0.2 * (1.0 - lug) * smoothstep(-0.05, 0.02, ld) * 0.0) * (1.0 - 0.3 * nearS * (1.0 - bead));`,
    },
  },
];
