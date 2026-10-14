// ============================================================================
// 【中文导读】Zone Control（区域控制模式）的地面标记渲染——把每个争夺区的轮廓、光幕与特效一次性
//             烘焙成一个网格 + 一个透明 ShaderMaterial，单次 draw call 画完全部区域。
// ----------------------------------------------------------------------------
// 【模块定位】纯渲染层：规则引擎在 src/game/zones.js（谁持有、进度、易主事件），本文件只负责"画"，
//             外加 ZoneSounds（区域的环境音/警报）。由 match:state 事件驱动 build/clear，
//             每帧通过 mesh.onBeforeRender 自更新 uniform（不依赖外部调用方记得喂它）。
// 【核心机制】① 几何：每个 zone 的轮廓多边形被逐面裁剪到覆盖它的每块可涂墨地板面上（坡道再加
//             两条高度半平面），抬升 2 cm 贴在各自高度的地面上，不平整/多层地板不会穿帮；② 顶点
//             属性 aInfo 携带 (zone 索引, 种类, d=离边距离/幕高, s=沿边弧长)，片元 shader 全靠它
//             程序化画出 键线→色带→白细线→发丝线→内辉光→填充 的分层描边，以及沿边的光幕；
//             ③ 状态动画全部走 uniform 数组（uSt/uCen/uFl）， revealing 扫描、占领闪光、涂墨洪峰、
//             争议脉冲都在 shader 内完成；④ 距离加粗（11 m 内基准、44 m 处约 3.5×）和地图视图
//             （TAB，G.rig.mapK → uWide）让远处/俯瞰时区域依然可读。
// 【关键约定】MAXZ=8 是 uniform 数组硬上限；LIFT=0.02 m 防 z-fighting；多边形约定 CCW（x·z'−x'·z>0）
//             且法线朝内；NEUTRAL 黄会在某队墨水本身是黄色时换成奶油色（防"中立区像被占"）；
//             GTAO 法线/深度 pass（scene.overrideMaterial）里通过 drawRange=0 跳过绘制；
//             时钟一律用 G.time，跳帧/补帧都能对上。
// 【配套阅读】src/game/zones.js（规则与事件源）、src/world/levelMaterial.js（同款 GTAO 门控先例）、
//             docs/INK.zh-CN.md、docs/EVENTS.zh-CN.md
// 【建议阅读顺序】先读文件头下的事件接线（constructor），再 _buildZone 看几何烘焙，最后 FS shader
//             的 floor 分支——那是视觉分层的主战场。
// ============================================================================
// Zone Control ground markings (src/game/zones.js is the rules engine; this only draws).
//
// Every zone of a Zone Control match is drawn ON the floor it covers: the zone's outline(s) are clipped against each
// inkable floor face that holds the zone's paint cells (so uneven / multi-level floors, ramps and bridges all carry
// their own piece, at their own height) and lifted 2 cm off the face. Nothing floats, nothing z-fights.
//
//   active objective   dark keyline · band (neutral: yellow striped with dark; held: the holder's ink) · white
//                      pinline · dark hairline, an inner glow, a tinted fill and a light curtain rising off the edge;
//                      a capture flashes it
//   inactive zones     a faint dashed ghost outline, so players learn where the next objective will be
//   rotation           the old objective fades back to its ghost; the new one sweeps out from its centre
//   map view (TAB)     the bands widen and the ghosts strengthen as the camera swoops overhead (G.rig.mapK)
//   distance           the band grows bolder with camera distance (today's look within ~11 m, ≈ 3.5× by ~44 m) so a
//                      zone reads from across the stage; the curtain rises taller and a little stronger with it
//   capture flood      a bright crest rides the ink front out across the zone as it floods with the taker's ink
//                      (zones.js zone.flood, same radius function as PaintSystem.flood)
//   contested          a held zone the other team has inked toward the neutralise line pulses in their colour
//   sound              ZoneSounds: a positional hum at each live zone (neutral / ours / theirs, quickening as a flip
//                      nears), the flood / wipe surges, and the contested warnings
//
// One mesh, one transparent ShaderMaterial (a single draw call). Per-zone state lives in small uniform arrays; the
// mesh updates itself from onBeforeRender (frustumCulled = false, so it runs every rendered frame; the clock is G.time,
// so skipped / stepped frames catch up) and hides from the GTAO normal pass (scene.overrideMaterial). Built when a
// Zone Control match starts ('match:state'), cleared when any other match starts or the stage is rebuilt (clear()).
import * as THREE from 'three';
import { G, on } from '../core/ctx.js';
import { ZONES } from '../config.js';

// 【容量与尺寸常量】MAXZ 是 uniform 数组硬上限（着色器里 uCol/uSt/uCen/uFl 都按它声明）；
// RING 是描边色带的几何宽度（米），填充核心把 d=RING 当作"已在带外"处理；CURTAIN 是光幕高度，
// 要足以越过紧贴轮廓的栏杆；LIFT 把整层面标记抬离地板 2 cm 防 z-fighting
const MAXZ = 8;                 // zones per match (centre 1–2 + two sides; headroom for multi-zone layouts)
const RING = 2.2;               // metres of edge band geometry (border + glow); the core fill carries d = RING
const CURTAIN = 1.7;            // light curtain height (m): tall enough to show over railings the outline hugs
const LIFT = 0.02;              // floor overlay offset (m)
// 【中立色二选一】neutral 带的底色（线性空间）：默认 Splat-Zones 黄；但当某队墨水本身就是黄色
// （Lemon、给色盲玩家的 Sun）时改暖奶油色，避免中立区被误读成"已被占"。深色条纹在两种底色上都保
// 证对比度。NEUTRAL 是运行期会被 build() 覆写的可变副本
const NEUTRAL_YELLOW = new THREE.Color(1.0, 0.8, 0.3), NEUTRAL_CREAM = new THREE.Color(1.0, 0.93, 0.78);
const NEUTRAL = NEUTRAL_YELLOW.clone();
// 【黄色判定】把 #rrggbb 转 HSV 色相近似：饱和度够高且色相落在 48°±14°（Lemon 56°、Sun 48°；
// 不含 Tangerine 30°、Lime 81°）才算"这队的墨水是黄色"。格式不合法或灰度色一律返回 false
function yellowish(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  if (c < 0.001 || c / mx < 0.5) return false;
  const h = (mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4) * 60;
  return Math.abs(((h + 360) % 360) - 48) < 14;   // Lemon 56°, Sun 48° (not Tangerine 30°, Lime 81°)
}
// 【新目标揭晓耗时】目标轮换时揭示扫描从圆心扫到边缘的时长（秒）
const SWEEP_T = 0.7;            // reveal sweep duration (s)

// 【距离加粗表达式】模板串：%P 会被替换成世界坐标，smoothstep(11, 44, 距离) 给出 0..1 的"远度"，
// 近处保持设计基准、44 m 处达到全强度（≈3.5× 加粗）；乘 uFarK 可在 A/B 截图时整体关掉
// distance boldening: today's look within ~11 m of the camera, easing up to full strength by ~44 m
const FAR = 'smoothstep(11.0, 44.0, length(%P - cameraPosition)) * uFarK';
// 【顶点着色器】只做两件事：变换到世界空间；光幕上边缘（aInfo 标记的顶部两顶点）按距离额外抬高，
// 让远处/俯瞰时区域光幕更高、跨战场可读。aInfo 原样传给片元
const VS = /* glsl */`
attribute vec4 aInfo;           // zone index, kind (0 floor, 1 curtain), d (m from the outline | curtain height 0..1), s (m along the outline)
uniform float uFarK;
varying vec4 vInfo;
varying vec3 vW;
void main() {
  vInfo = aInfo;
  vec4 w = modelMatrix * vec4(position, 1.0);
  // far away the light curtain rises taller (its top edge), so a zone reads across the stage
  if (aInfo.y > 0.5 && aInfo.z > 0.5) w.y += ${CURTAIN} * 0.85 * ${FAR.replace('%P', 'w.xyz')};
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// 【片元着色器】全部视觉都在这一个 shader 里程序化生成（无贴图）：
//   地面分支（aInfo.y<0.5）：由 d=离轮廓距离 分层画出 暗键线|色带|白细线|发丝线 + 内辉光 + 核心
//     填充；色带中立时黄底深条纹、被持时持方墨水色；叠加 揭示扫描、占领洪峰、争议脉冲、幽灵虚线
//   光幕分支（aInfo.y>0.5）：亮脚跟 + 向上渐隐 + 上移扫描线
// 最终 A（激活层）与 Gh（幽灵层）按 act*reveal 混合，激活区显全效果、非激活区只留虚线残影
const FS = /* glsl */`
precision highp float;
uniform vec3 uCol[${MAXZ}];     // current ink of each zone (neutral / holder), linear
uniform vec4 uSt[${MAXZ}];      // x active 0..1 · y reveal sweep radius (m) · z capture flash 0..1 · w visible 0..1
uniform vec4 uCen[${MAXZ}];     // xz centre, sweep reach (m), held 0..1
uniform vec4 uFl[${MAXZ}];      // x capture-flood front radius (m) · y its strength 0..1 · z contested 0..1 · w contester
uniform vec3 uTeamC[2];         // team inks (linear)
uniform float uTime, uWide, uFarK;
varying vec4 vInfo;
varying vec3 vW;
const vec3 K = vec3(0.0075, 0.0065, 0.012);
// 【平滑带函数】d 落在 [a,b] 内为 1、两侧各 aa 宽度过渡——所有描边分层都靠它切出来
float band(float d, float a, float b, float aa) { return smoothstep(a - aa, a + aa, d) * (1.0 - smoothstep(b - aa, b + aa, d)); }
void main() {
  int i = int(vInfo.x + 0.5);
  vec3 col = uCol[i]; vec4 st = uSt[i]; vec4 cen = uCen[i];
  float act = st.x, flash = st.z;
  float r = length(vW.xz - cen.xy);
  // 【揭示扫描】reveal：扫描半径 st.y 已到之处为 1，未到 0；front 是扫描前沿的亮边（内外各留过渡带）
  float reveal = 1.0 - smoothstep(st.y - 0.9, st.y, r);
  float front = smoothstep(st.y - 1.4, st.y - 0.15, r) * reveal * step(st.y, cen.z + 1.0);   // bright leading edge of the sweep
  float s = vInfo.w;
  // 【提亮基准】被闪白（占领瞬间 flash）和高亮混合度一起把基础色往白推
  vec3 bright = mix(col, vec3(1.0), 0.16 + 0.5 * flash);
  vec4 fl = uFl[i];
  // bolder with distance: today's look within ~11 m, easing up to ≈ 3.5× by ~44 m
  float far = ${FAR.replace('%P', 'vW')};
  // 【双层累积】A=激活区全效果，Gh=非激活区的幽灵虚线，最后按 ka 混合
  vec4 A = vec4(0.0), Gh = vec4(0.0);
  if (vInfo.y < 0.5) {
    // ==================== 地面分支 ====================
    float d = vInfo.z;
    float px = fwidth(d);
    float aa = max(px * 0.75, 0.003);
    // 【带宽容放】三套取最大：地图视图加宽（uWide）、距离加粗（far）、掠射角保底 ~2.5px；再夹在
    // 1..3.6 防止无限变粗。w 是所有后续分层的统一缩放系数
    float w = clamp(max(max(mix(1.0, 2.2, uWide), mix(1.0, 3.5, far)), px * 9.0), 1.0, 3.6);
    float held = cen.w;
    // active, outside in: a dark keyline | the band | a white pinline | a dark hairline, then an inner glow and a core
    // tint. Neutral, the band is Splat-Zones yellow striped with dark (light AND dark, so it reads on white decking and
    // dark cobbles alike; far away the stripes average to a deep ochre); held, it is the holder's ink, stripes faint.
    float rim = 1.0 - smoothstep(0.09 * w - aa, 0.09 * w + aa, d);
    float ink = band(d, 0.09 * w, 0.4 * w, aa);
    float pin = band(d, 0.4 * w, 0.46 * w, aa);
    float hair = band(d, 0.46 * w, 0.52 * w, aa);
    // 【条纹坐标】q 把"沿边弧长 s − 离边距离 d"拧成对角条纹相位（随时间缓慢流动）；fq 是屏幕空间
    // 导数上限，防止远处条纹混叠成摩尔纹。stripe=1 处是深色条纹（占 40%）
    float q = (s - d) * 1.35 / mix(1.0, w, 0.8) - uTime * 0.45, fq = min(fwidth(q), 0.5);
    float stripe = smoothstep(0.3 - fq, 0.3 + fq, abs(fract(q) - 0.5));            // 1 on the dark stripes (40 %)
    // 【色带配色】中立：亮色混深条纹（亮暗双层，白甲板/黑鹅卵石上都可读；远处条纹平均成深赭石）；
    // 被持：持方墨水色，条纹只做 12% 的深浅起伏
    vec3 inkC = mix(mix(bright, K * 1.5, stripe), bright * (1.0 + 0.12 * stripe), held);
    // 【争议脉冲】被挑战时整条色带按 10 Hz 在"原色 ↔ 挑战方墨水色"间呼吸
    inkC = mix(inkC, uTeamC[int(fl.w + 0.5)] * 1.15, fl.z * (0.35 + 0.35 * sin(uTime * 10.0)));
    // 【内外层叠】g 是内辉光的径向衰减（1.6+0.3·uWide 米内从带尾缓降到 0）；分层色 c 与分层透明度
    // a 分别加权相加；ga 是"叠在分层下面的"辉光与核心填充，用 (1−a) 留出空间，最后做预乘还原
    float g = 1.0 - smoothstep(0.52 * w, 0.52 * w + 1.6 + 0.3 * uWide, d);
    vec3 c = K * rim + inkC * ink + vec3(1.0) * pin + K * hair;
    float a = rim * 0.95 + ink * 0.97 + pin * 0.95 + hair * 0.7;
    float ga = (mix(0.46, 0.34, held) + 0.35 * flash + 0.3 * front) * g * g + mix(0.13, 0.08, held) + 0.1 * uWide;
    A.rgb = c + col * ga * (1.0 - a);
    A.a = a + ga * (1.0 - a);
    A.rgb /= max(A.a, 1e-4);
    // 【扫描前沿闪白】揭示波扫过处整体向白推 55%
    A.rgb = mix(A.rgb, vec3(1.0), front * 0.55);
    // 【占领洪峰】一道亮峰（高斯 crest）骑在 ink front 外沿向外滚，身后 2.2 m 内是湿光尾迹（wake）；
    // 峰值越高越白，与底色按透明度先后景混合
    if (fl.y > 0.001) {
      float x = r - fl.x;
      float crest = exp(-x * x * 4.0) * fl.y;
      float wake = (1.0 - smoothstep(0.0, 2.2, -x)) * step(x, 0.0) * fl.y;
      float ca = clamp(crest * 0.85 + wake * 0.3, 0.0, 0.92);
      vec3 cc = mix(bright, vec3(1.0), 0.55 * crest / max(crest + wake, 1e-3));
      float na = ca + A.a * (1.0 - ca);
      A.rgb = (cc * ca + A.rgb * A.a * (1.0 - ca)) / max(na, 1e-4);
      A.a = na;
    }
    // 【幽灵虚线】非激活区的残影：gw 是虚线带宽度（同样受 uWide/far 缩放），dash 按 1.15 m 周期
    // 切出 58% 占空比，grim 是贴着轮廓内侧的深色细边（给亮色虚线勾边）
    float gw = clamp(max(max(mix(0.12, 0.3, uWide), mix(0.12, 0.26, far)), px * 2.2), 0.12, 0.6);
    float dash = step(0.42, fract(s / 1.15));
    float gl = (1.0 - smoothstep(gw - aa, gw + aa, d));
    float grim = 1.0 - smoothstep(0.035 - aa, 0.035 + aa, d);
    Gh.rgb = mix(vec3(0.96), K, grim);
    Gh.a = gl * dash * mix(0.42, 0.8, uWide);
  } else {
    // ==================== 光幕分支 ====================
    // 【光幕】亮脚跟（贴地处）+ 1.5 次幂向上渐隐 + 沿幕身上移的扫描线；地图视图整体压暗 75% 以免
    // 俯瞰时糊成一片；far 同时抬高亮度，配合顶点端已做的"远处更高"
    float hgt = vInfo.z;
    float fade = pow(clamp(1.0 - hgt, 0.0, 1.0), 1.5);
    float foot = 1.0 - smoothstep(0.025, 0.07, hgt);
    float scan = smoothstep(0.4, 0.49, abs(fract(hgt * 4.0 - uTime * 0.45) - 0.5));
    float held = cen.w;
    A.rgb = mix(bright, vec3(1.0), mix(0.08, 0.2, held) + 0.3 * scan + 0.3 * flash);
    A.a = ((mix(0.46, 0.36, held) + 0.36 * scan + 0.3 * flash) * fade + 0.6 * foot) * (1.0 - uWide * 0.75) * (1.0 + 0.4 * far);
  }
  // 【双层混合】ka = 激活度 × 揭示进度：新目标扫到的地方渐显全效果，没扫到的仍显幽灵；
  // 透明度与颜色都按预乘方式交叉混合；st.w 是整体可见度（赛末淡出到 0.55）
  float ka = act * reveal;
  vec4 o;
  o.a = A.a * ka + Gh.a * (1.0 - ka);
  o.rgb = (A.rgb * A.a * ka + Gh.rgb * Gh.a * (1.0 - ka)) / max(o.a, 1e-4);
  o.a *= st.w;
  if (o.a < 0.004) discard;
  gl_FragColor = o;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------------------------------- 2D helpers
// 【2D 几何工具】全部是 x/z 平面上的纯函数多边形运算：面积、半平面裁剪（Sutherland–Hodgman）、
// 线段裁剪、斜接内缩。供 _buildZone 把 zone 轮廓裁到各地板面、并生成描边环带
// 多边形约定：CCW（area>0）、边法线朝内
const partsOf = (def) => def.polys || [def.poly];
// 【有向面积】鞋带公式 ÷2；CCW 为正、CW 为负，后面用它统一轮廓绕向
function area(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
// Sutherland–Hodgman against one affine half-plane f(x, z) = a·x + b·z + c ≥ 0
// 【单边裁剪】经典 Sutherland–Hodgman：保留 f≥0 一侧；边与半平面相交时按比例补交点
function clipHalf(poly, a, b, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const P = poly[i], Q = poly[(i + 1) % n];
    const fp = a * P[0] + b * P[1] + c, fq = a * Q[0] + b * Q[1] + c;
    if (fp >= 0) out.push(P);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
  }
  return out;
}
// 【多边形裁剪】逐条半平面顺序裁剪；顶点数裁到 <3 提前返回（已不可能成面）
function clip(poly, planes) { let p = poly; for (const [a, b, c] of planes) { if (p.length < 3) return p; p = clipHalf(p, a, b, c); } return p; }
// segment [P, Q] against half-planes → [t0, t1] or null
// 【线段裁剪】Liang–Barsky 思路：维护线段参数区间 [t0,t1]，任一平面把区间裁没就返回 null；
// 用于光幕贴边段被地板面边界截断的情形
function clipSeg(P, Q, planes) {
  let t0 = 0, t1 = 1;
  for (const [a, b, c] of planes) {
    const fp = a * P[0] + b * P[1] + c, fq = a * Q[0] + b * Q[1] + c;
    if (fp < 0 && fq < 0) return null;
    if (fp < 0) t0 = Math.max(t0, fp / (fp - fq));
    else if (fq < 0) t1 = Math.min(t1, fp / (fp - fq));
  }
  return t1 - t0 > 1e-4 ? [t0, t1] : null;
}
// 【斜接内缩】把多边形沿各边内法线整体内移 d：顶点处取相邻两法线之和做 miter 向量（长度
// 1/cos(θ/2)，k 是归一化分母）；k 用 max(k, 0.2) 钳制，锐角处 miter 不至于爆炸
function inset(poly, nrm, d) {
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n;
    const n0 = nrm[h], n1 = nrm[i];
    const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    const mx = (n0[0] + n1[0]) / Math.max(k, 0.2), mz = (n0[1] + n1[1]) / Math.max(k, 0.2);   // miter vector (|m| = 1/cos(θ/2))
    out.push([poly[i][0] + mx * d, poly[i][1] + mz * d]);
  }
  return out;
}
// 【安全内缩量】内缩不能超过多边形最窄处的一半，否则边会互相穿过"折纸"。做法：对每个顶点，
// 求其余所有顶点在其内法线方向投影的最大值（即该方向的多边形宽度），取全局最小值 ×0.42 作为上限
function safeInset(poly, nrm, want) {
  let minW = Infinity;
  for (let i = 0; i < poly.length; i++) {
    let far = 0;
    for (const q of poly) far = Math.max(far, (q[0] - poly[i][0]) * nrm[i][0] + (q[1] - poly[i][1]) * nrm[i][1]);
    minW = Math.min(minW, far);
  }
  return Math.min(want, minW * 0.42);
}

// 【地面标记总管】一个 Zone Control 比赛一份实例：事件驱动 build/clear，渲染驱动每帧 uniform 更新
export class ZoneMarks {
  // 【构造】只注册事件订阅，不建几何；mesh 为 null 表示当前没有 Zone Control 比赛在画
  // 事件接线（全部来自 zones.js / 比赛状态机）：
  //   match:state  —— 有 zones 且非表演赛时 build，其他模式开场比赛或 results 时清掉
  //   zones:active —— 目标轮换：重算激活集合并播"旧墨被擦除"音
  //   zones:zone   —— 某 zone 易主：闪白 + 播占领洪峰音
  //   zones:contest—— 进入争议：播警报（我方被冲）或机会音（对方快丢）
  constructor(scene) {
    this.scene = scene;
    this.mesh = null; this.match = null; this.Z = null;
    this.state = [];
    this._t = null;
    this.sounds = new ZoneSounds();
    this._unsubs = [
      on('match:state', ({ state, match }) => {
        if (!match || match.attract || !match.zones) { if (match !== this.match || state === 'intro') this.clear(); return; }
        if (match !== this.match) this.build(match);
        if (state === 'results') this.clear();
      }),
      on('zones:active', (e) => { this._syncActive(true); if (this.Z) this.sounds.shifted(this.Z, this.match, e); }),
      on('zones:zone', ({ zone, owner }) => { const s = this.state[zone?.id]; if (s) s.flash = 1; if (this.Z) this.sounds.flipped(this.match, zone, owner); }),
      on('zones:contest', ({ zone, holder }) => { if (this.Z) this.sounds.contested(this.match, zone, holder); }),
    ];
  }

  // 【清除】摘掉网格并释放 GPU 资源、停掉全部区域音、断开比赛引用；可重入（mesh 为 null 时全跳过）
  clear() {
    this.sounds?.stop();
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose(); this.mesh.material.dispose();
      this.mesh = null;
    }
    this.match = null; this.Z = null; this.state = []; this._t = null;
  }

  // 【析构】清除 + 退订全部事件（场景切换时由调用方负责调用）
  dispose() { this.clear(); this._unsubs.forEach((u) => u()); }

  // 【构建】一场 Zone Control 比赛开始时调用一次：烘焙全部 zone 的几何 → 建单网格 → 初始化
  // 每 zone 动画状态 → 立即刷一帧 uniform。前置条件不满足（无涂墨系统/无关卡）时静默跳过
  build(match) {
    this.clear();
    const Z = match.zones;
    if (!Z || !G.paint || !G.level) return;
    this.match = match; this.Z = Z;
    // 【中立色定案】本局有队伍的墨水是黄色系 → 中立带换奶油色，防止"中立区≈被 Lemon/Sun 队占领"的误读
    NEUTRAL.copy((G.teamHex || []).some(yellowish) ? NEUTRAL_CREAM : NEUTRAL_YELLOW);
    const pos = [], info = [], idx = [];
    const faces = this._faceList();
    Z.zones.slice(0, MAXZ).forEach((zone, zi) => this._buildZone(zone, zi, faces, pos, info, idx));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const uniforms = {
      uCol: { value: Array.from({ length: MAXZ }, () => NEUTRAL.clone()) },
      uSt: { value: Array.from({ length: MAXZ }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uCen: { value: Array.from({ length: MAXZ }, () => new THREE.Vector4()) },
      uFl: { value: Array.from({ length: MAXZ }, () => new THREE.Vector4()) },
      uTeamC: { value: [new THREE.Color(1, 0.5, 0), new THREE.Color(0, 0.3, 1)] },
      uTime: { value: 0 }, uWide: { value: 0 }, uFarK: { value: 1 },   // uFarK: the distance boldening (0 = off, A/B shots)
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'zoneMarks';
    // 【每帧自更新】关视锥剔除（frustumCulled=false）保证 onBeforeRender 每个渲染帧都执行——
    // 这才是本模块"每帧驱动"的真正入口，而不是靠外部循环调 _update
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;           // before the other transparents (particles, ink spray stay on top)
    mesh.castShadow = false; mesh.receiveShadow = false;
    // 【GTAO 门控】GTAO 法线/深度 pass（scene.overrideMaterial）不得看到透明覆层（与武器缎带、
    // 角色部件同一约定）：那个 pass 里把 drawRange 清零跳过，颜色 pass 里恢复并正常更新 uniform
    mesh.onBeforeRender = (renderer, scene, camera, geometry) => {
      if (scene.overrideMaterial) { geometry.drawRange.count = 0; return; }
      geometry.drawRange.count = Infinity;
      this._update();
    };
    this.mesh = mesh;
    this.scene.add(mesh);
    // 【每 zone 动画状态】CPU 侧的"平滑内存"：col/act/sweep/flash/held/vis 都是趋近目标值的
    // 阻尼量，每帧在 _update 里推进后写入 uniform；uCen.w 初始化 0（未被持有）；sweep 起点设为
    // reach+3 表示"开场已在完全揭晓态"，build 里 _syncActive(false) 的 animate=false 沿用之
    this.state = Z.zones.slice(0, MAXZ).map((zone, i) => {
      let reach = 0;
      for (const p of partsOf(zone.def)) for (const [x, z] of p) reach = Math.max(reach, Math.hypot(x - zone.center[0], z - zone.center[2]));
      uniforms.uCen.value[i].set(zone.center[0], zone.center[2], reach + 1.5, 0);
      return { zone, col: NEUTRAL.clone(), act: 0, sweep: reach + 3, reach: reach + 1.5, flash: 0, vis: 0, held: 0, active: false };
    });
    this._syncActive(false);
    this._update();
  }

  // 【地板面清单】只保留带涂墨网格的面（grid≥0）；保持 paintFaces 的原有顺序，因为 zones.js
  // 下发的格子索引就是按这个顺序铺的
  _faceList() {
    return G.paint.paintFaces.filter((f) => f.grid >= 0);
  }
  // 【zone 覆盖的地板面】zone.cells 是涂墨格索引数组，按面序递增；用游标 lo 顺序走，跨面时
  // 二分定位（O(n + k log n) 而非每格一次二分）。返回这些面对象的集合
  _facesOf(zone, faces) {
    const set = new Set();
    const c = zone.cells;
    let lo = 0;
    for (let k = 0; k < c.length; k++) {
      const cell = c[k];
      // cells come in face order: walk forward (binary search when we jump)
      if (!(faces[lo] && cell >= faces[lo].grid && cell < faces[lo].grid + faces[lo].nu * faces[lo].nv)) {
        let a = 0, b = faces.length - 1;
        while (a < b) { const m = (a + b + 1) >> 1; if (faces[m].grid <= cell) a = m; else b = m - 1; }
        lo = a;
      }
      set.add(faces[lo]);
    }
    return [...set];
  }

  // 【zone 几何烘焙】本文件最重的函数：把一个 zone 的轮廓变成顶点/索引流。
  // 流程：① 对 zone 覆盖的每块地板面算出它的 xz 半平面集、高度范围裁剪（坡道）和面高度函数
  // y(x,z)；② 轮廓统一为 CCW；③ 每对面×轮廓片：逐边发梯形描边带（d=离边距、s=沿边弧长）、
  // 发核心填充、发沿边光幕四边形。顶点直接写进共享的 pos/info/idx 数组
  _buildZone(zone, zi, faces, pos, info, idx) {
    const def = zone.def;
    const y0 = (def.y0 ?? -2) - 0.05, y1 = (def.y1 ?? 6) + 0.05;
    const zf = this._facesOf(zone, faces);
    // 【逐面区域参数】y0/y1 取 zone 高度范围并外扩 5 cm 容差；对每个面：4 条边 → 4 个内向半平面；
    // 非水平面（坡道）再加 2 条"高度裁剪"半平面——坡道离开高度范围的那条线本身就是 zone 的真实
    // 边缘，同样要有描边；ky/kz/k0 把面方程整理成 y(x,z) 的仿射函数，顶点落点统一用它抬高 LIFT
    const regions = zf.map((f) => {
      const o = f.origin, u = f.u, v = f.v, n = f.n;
      const C = [[o.x, o.z], [o.x + u.x * f.su, o.z + u.z * f.su], [o.x + u.x * f.su + v.x * f.sv, o.z + u.z * f.su + v.z * f.sv], [o.x + v.x * f.sv, o.z + v.z * f.sv]];
      const ccw = area(C) > 0 ? 1 : -1;
      const planes = [];
      for (let i = 0; i < 4; i++) {
        const P = C[i], Q = C[(i + 1) % 4];
        const ex = Q[0] - P[0], ez = Q[1] - P[1];
        const a = -ez * ccw, b = ex * ccw;                              // inward normal
        planes.push([a, b, -(a * P[0] + b * P[1])]);
      }
      // y(x, z) = o.y − (n.x (x − o.x) + n.z (z − o.z)) / n.y
      const ky = -n.x / n.y, kz = -n.z / n.y, k0 = o.y + (n.x * o.x + n.z * o.z) / n.y;
      const cut = [];
      if (Math.abs(n.y) < 0.999) {
        const g = Math.hypot(ky, kz);                                   // normalised: f = metres from the cut line
        cut.push([ky / g, kz / g, (k0 - y0) / g], [-ky / g, -kz / g, (y1 - k0) / g]);
      }
      let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (const [x, z] of C) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
      return { planes, cut, y: (x, z) => ky * x + kz * z + k0, box: [bx0, bx1, bz0, bz1] };
    });
    // 【粗筛】AABB 重叠测试：轮廓/边带与本面边界盒都不相交就直接跳过，省掉昂贵的多边形裁剪
    const overlaps = (R, pts) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return !(x1 < R.box[0] || x0 > R.box[1] || z1 < R.box[2] || z0 > R.box[3]);
    };
    // 【发多边形】把裁剪后的多边形写进顶点流：每个顶点带 attr(x,z) 算出的 (d, s)；
    // fan=true 时按扇形三角化（凸四边形梯形，省 earcut 调用），否则用 ShapeUtils 三角剖分（凹多边形）
    const emitPoly = (R, poly, attr, fan) => {
      if (poly.length < 3) return;
      const base = pos.length / 3;
      for (const [x, z] of poly) { pos.push(x, R.y(x, z) + LIFT, z); const [d, s] = attr(x, z); info.push(zi, 0, d, s); }
      if (fan) { for (let i = 1; i < poly.length - 1; i++) idx.push(base, base + i, base + i + 1); return; }
      const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
    };
    // 【轮廓预处理】去掉重复/首尾闭合点 → 逐边生成切向 tan、内法线 nrm、边长 len 和弧长前缀 S
    // （沿轮廓的累计周长坐标，条纹和虚线都靠它对齐）→ 安全内缩量 D 和内缩副本 Q（外边界）
    const outline = (poly) => {
      const P = [];
      for (const p of poly) { const q = P[P.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) P.push(p); }
      while (P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) <= 1e-4) P.pop();
      if (P.length < 3) return null;
      const n = P.length, nrm = [], tan = [], len = [], S = [];
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const A = P[i], B = P[(i + 1) % n];
        const ex = B[0] - A[0], ez = B[1] - A[1], L = Math.hypot(ex, ez) || 1;
        tan.push([ex / L, ez / L]); nrm.push([-ez / L, ex / L]); len.push(L); S.push(acc); acc += L;
      }
      const D = safeInset(P, nrm, RING);
      return { P, n, nrm, tan, len, S, D, Q: inset(P, nrm, D) };
    };
    // 【逐轮廓片 × 逐面】每个 zone 可由多个多边形组成；非 CCW 的先翻正。水平面直接用整轮廓，
    // 坡道面用高度裁剪后的子轮廓（O 为 null 说明该面完全在高度范围外）
    for (let part of partsOf(def)) {
      if (!part || part.length < 3) continue;
      if (area(part) < 0) part = [...part].reverse();                 // CCW (x·z' − x'·z > 0)
      const whole = outline(part);
      if (!whole) continue;
      for (const R of regions) {
        if (!overlaps(R, part)) continue;
        const O = R.cut.length ? outline(clip(part, R.cut)) : whole;
        if (!O) continue;
        const { P: poly, n, nrm, tan, len, S, D, Q } = O;
        // 【描边环带】一条边一个梯形（外边界 poly[i]→poly[j]，内边界 Q[j]→Q[i]），顶点属性
        // d=到该边线的距离、s=沿轮廓弧长——shader 由此画出整圈连续的分层描边
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const trap = [poly[i], poly[j], Q[j], Q[i]];
          if (!overlaps(R, trap)) continue;
          const A = poly[i], nn = nrm[i], tt = tan[i], s0 = S[i];
          emitPoly(R, clip(trap, R.planes), (x, z) => [Math.max(0, (x - A[0]) * nn[0] + (z - A[1]) * nn[1]), s0 + (x - A[0]) * tt[0] + (z - A[1]) * tt[1]], true);
        }
        // 【核心填充】内缩副本 Q 的实体面，d 恒为 D（色带外缘），shader 画成低透明度核心底色
        if (overlaps(R, Q)) emitPoly(R, clip(Q, R.planes), () => [D, 0], false);
        // 【光幕】沿轮廓向内 4 cm（避开紧贴的墙面），逐边发竖直四边形：aInfo.y=1 标记为光幕，
        // aInfo.z=0 是底边/1 是顶边（shader 按它渐隐，顶点着色器按它抬高）；线段先被面半平面
        // 裁剪，坡道面上只保留落在本面内的那段
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, nn = nrm[i];
          const A = [poly[i][0] + nn[0] * 0.04, poly[i][1] + nn[1] * 0.04], B = [poly[j][0] + nn[0] * 0.04, poly[j][1] + nn[1] * 0.04];
          if (!overlaps(R, [A, B])) continue;
          const tt = clipSeg(A, B, R.planes);
          if (!tt) continue;
          const ax = A[0] + (B[0] - A[0]) * tt[0], az = A[1] + (B[1] - A[1]) * tt[0];
          const bx = A[0] + (B[0] - A[0]) * tt[1], bz = A[1] + (B[1] - A[1]) * tt[1];
          const ya = R.y(ax, az) + LIFT, yb = R.y(bx, bz) + LIFT;
          const sa = S[i] + tt[0] * len[i], sb = S[i] + tt[1] * len[i];
          const base = pos.length / 3;
          pos.push(ax, ya, az, bx, yb, bz, bx, yb + CURTAIN, bz, ax, ya + CURTAIN, az);
          info.push(zi, 1, 0, sa, zi, 1, 0, sb, zi, 1, 1, sb, zi, 1, 1, sa);
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  // 【激活集同步】zones:active 事件或 build 时调用：比对规则引擎的当前目标集，给"新晋升"的
  // zone 重置揭示扫描起点（animate=true 时从圆心 0 开始扫，并给一点初始闪白；build 时 animate=
  // false，直接呈现已揭晓态）
  _syncActive(animate) {
    const Z = this.Z;
    if (!Z) return;
    const act = new Set(Z.active.zones);
    for (const s of this.state) {
      const on = act.has(s.zone);
      if (on && !s.active) { s.sweep = animate ? 0 : s.reach + 2; if (animate) s.flash = 0.6; }
      s.active = on;
    }
  }

  // 【每帧 uniform 推进】onBeforeRender 里调用：dt 用 G.time 差值并钳到 0.25 s（GTAO 双 pass、
  // 掉帧都不会让阻尼爆炸）；把每个 zone 的 CPU 平滑状态写进 uSt/uCen/uFl/uCol
  _update() {
    const Z = this.Z, mesh = this.mesh;
    if (!Z || !mesh) return;
    const t = G.time;
    const dt = this._t == null ? 0 : Math.min(0.25, Math.max(0, t - this._t));
    this._t = t;
    const u = mesh.material.uniforms;
    u.uTime.value = t;
    u.uWide.value = G.rig?.mapK ?? 0;
    const tc = G.teamColors;
    if (tc && tc[0] && tc[1]) { u.uTeamC.value[0].copy(tc[0]); u.uTeamC.value[1].copy(tc[1]); }
    const over = Z.winner != null && this.match && this.match.state !== 'playing';
    for (let i = 0; i < this.state.length; i++) {
      const s = this.state[i], z = s.zone;
      // 【占领洪峰前沿】zones.js 在易主瞬间写下 zone.flood（t0/dur/reach/ease）：前 85% 时段全强度，
      // 尾段 15% 淡出；半径推进用与 PaintSystem.flood 相同的缓动函数，保证亮峰与真实涂墨前沿同步
      const f = z.flood, F = u.uFl.value[i];
      if (f && f.team >= 0 && t - f.t0 < f.dur) {
        const x = Math.max(0, (t - f.t0) / f.dur);
        F.x = f.reach * (f.ease === 'linear' ? x : 1 - (1 - x) * (1 - x));
        F.y = x < 0.85 ? 1 : (1 - x) / 0.15;
      } else F.y = 0;
      // 【争议强度】被持有且对方涂墨份额越过预警线（warn−0.05）后，按 contest 线的接近程度
      // 0..1 平滑推进，shader 拿它做色带呼吸；F.w 记录挑战方（1−owner），配色用
      const warnS = (ZONES.warn ?? 0.3) - 0.05;
      const cz = s.active && z.owner >= 0 ? Math.min(1, Math.max(0, (z.share[1 - z.owner] - warnS) / (ZONES.contest - warnS))) : 0;
      s.warn = (s.warn || 0) + (cz - (s.warn || 0)) * (1 - Math.exp(-dt * 6));
      F.z = s.warn; if (z.owner >= 0) F.w = 1 - z.owner;
      // 【颜色趋近】zone 当前目标色（持方墨水或中立色）按指数阻尼逼近——易主瞬间是渐变色带
      // 而不是硬切
      const target = z.owner >= 0 && tc && tc[z.owner] ? tc[z.owner] : NEUTRAL;
      const k = 1 - Math.exp(-dt * 9);
      s.col.lerp(target, k);
      // 【激活度/揭示/闪光/持有度/可见度】全部一阶指数阻尼；激活的进入比退出快（14 vs 6），
      // 揭示扫描按 SWEEP_T 匀速推到 reach+2；vis 在分出胜负后收到 0.55 做整体淡出
      s.act += ((s.active ? 1 : 0) - s.act) * (1 - Math.exp(-dt * (s.active ? 14 : 6)));
      if (s.active && s.sweep < s.reach + 2) s.sweep = Math.min(s.reach + 2, s.sweep + dt * (s.reach + 2) / SWEEP_T);
      s.flash = Math.max(0, s.flash - dt * 1.6);
      s.held += ((z.owner >= 0 ? 1 : 0) - s.held) * k;
      u.uCen.value[i].w = s.held;
      s.vis += ((over ? 0.55 : 1) - s.vis) * (1 - Math.exp(-dt * 4));
      u.uCol.value[i].copy(s.col);
      u.uSt.value[i].set(s.act, s.sweep, s.flash, s.vis);
    }
    this.sounds.update(Z, this.match, dt);
  }
}

// ---------------------------------------------------------------------------------------------------- sound
// 【区域音效】zone 标记的另一半：每个生效 zone 一个定位循环"嗡嗡"声（音色区分 中立/我方/敌方，
// 争夺临近时脉冲加快、音高上扬），外加 占领洪峰 / 擦除 / 争议警报 的一次性音效（2D、限频）。
// 控制类播报（WE/THEY took it）归 HUD 管，这里只负责空间氛围音
// The zones' own sounds (src/audio/audio.js): a positional hum at each live zone — one loop per zone, its timbre saying
// who holds it (neutral / ours / theirs, relative to the viewer) and its pulse quickening, pitch lifting as a flip nears
// (the holder's hold being inked back toward the 40 % line, or a neutral zone being inked toward the 80 % capture) —
// plus the flood / wipe surges at the zone and the contested warnings (2D, rate-limited). The control cues themselves
// (WE / THEY took it, WE / THEY lost it) are the HUD's, with its call-outs.
// 【控制节拍】hums 的控制量以 1/6 s 为最小步长更新（听感上足够平滑，又省得每帧调音频参数）
const HUM_DT = 1 / 6;            // hum control updates (s)
// 【定位点】zone 中心抬高 1 m——贴近地面会被脚步/地形遮住，略高于人耳高度扩散最自然
const zonePos = (z) => ({ x: z.center[0], y: z.center[1] + 1, z: z.center[2] });
class ZoneSounds {
  constructor() { this.hums = new Map(); this.acc = 0; this.warnT = -99; }
  // 【我方视角】本地玩家所属队伍；观战/未分队时兜底为 0（音色只影响"ours/theirs"标签）
  _me(match) { const a = match?.local; return a && (a.team === 0 || a.team === 1) ? a.team : 0; }
  // 【生效条件】真正在比赛中（非 attract、模式 match、音频就绪、playing 且未分胜负）
  _live(match) { return !!(match && !match.attract && G.mode === 'match' && G.audio && match.state === 'playing'); }

  // 【嗡鸣维护】每个生效 zone 一个定位循环：音量/音色按 中立/我方/敌方 与 tension（被涂回的
  // 紧迫度，由 share 份额推 0..1）推进；不再生效的 zone 淡出停声并清出表
  update(Z, match, dt) {
    this.acc += dt;
    if (this.acc < HUM_DT) return;
    const step = Math.min(1, this.acc); this.acc = 0;
    const on = this._live(match) && !match.paused && Z.winner == null;
    const act = on ? Z.active.zones : [];
    const me = this._me(match);
    for (const z of act) {
      let h = this.hums.get(z);
      if (!h || !h.handle.playing) {
        const handle = G.audio.loop('zone_hum', { pos: zonePos(z), volume: 0 });
        if (!handle || !handle.playing) continue;          // audio not started yet: try again next update
        h = { handle, k: 0 };   // k=紧迫度平滑值，从 0 起步向 tension 逼近
        this.hums.set(z, h);
      }
      const mode = z.owner < 0 ? 'neutral' : z.owner === me ? 'ours' : 'theirs';
      // 【紧迫度】被持有：对方份额距 contest 线越近越紧张；中立：任一方份额逼近 control 线越紧张
      const tension = z.owner >= 0 ? (z.share[1 - z.owner] - 0.08) / (ZONES.contest - 0.08) : (Math.max(z.share[0], z.share[1]) - 0.35) / (ZONES.control - 0.35);
      h.k += (Math.min(1, Math.max(0, tension)) - h.k) * Math.min(1, step * 4);
      h.handle.set({ volume: (mode === 'neutral' ? 0.8 : 0.95) * (1 + 0.6 * h.k), params: { mode, tension: h.k } });
    }
    for (const [z, h] of this.hums) if (!act.includes(z)) { h.handle.stop(0.6); this.hums.delete(z); }
  }

  // 【易主】zone 被占领：墨浪从 zone 滚出；是我方时音高略升（1.06）做正向反馈，对方则压低（0.9）
  flipped(match, zone, owner) {
    if (!this._live(match) || !zone || !(owner === 0 || owner === 1)) return;
    G.audio.play('zone_flood', { pos: zonePos(zone), pitch: owner === this._me(match) ? 1.06 : 0.9 });
  }

  // 【轮换】新目标揭晓：旧 objective 的墨水被擦除（全部生效 zone 各播一次 wipe）
  shifted(Z, match, e) {
    if (!this._live(match) || !e || e.moved === false) return;
    for (const z of Z.active.zones) G.audio.play('zone_wipe', { pos: zonePos(z) });
  }

  // 【争议警报】我方持有被涂回 → 警报音；对方持有快被磨掉 → 机会音（go-go）。2.5 s 限频防连播刷屏
  contested(match, zone, holder) {
    if (!this._live(match) || !zone || !(holder === 0 || holder === 1)) return;
    const now = G.time ?? 0;
    if (now - this.warnT < 2.5) return;
    this.warnT = now;
    G.audio.play(holder === this._me(match) ? 'zone_warn' : 'zone_chance');
  }

  // 【停止】比赛结束/清场：全部嗡鸣 0.3 s 淡出并清空（clear() 的配套）
  stop() { for (const h of this.hums.values()) h.handle.stop(0.3); this.hums.clear(); this.acc = 0; }
}
