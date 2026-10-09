// Ink paint system.
//  * GPU: every paintable face owns a rectangle in one big atlas render target. Splats are drawn as quads straight into
//    the atlas in face space (texture-space painting), so ink wraps across floors/walls/corners exactly like a spherical
//    splash would.
//  * CPU: a parallel coarse grid (0.25 m cells) per face answers gameplay queries — "is this spot my ink?" — and
//    tracks turf coverage for scoring. Both sides evaluate the same body edge (blobWobble / wob, or the roller band)
//    so they agree; everything drawn beyond that edge (rays, satellite droplets, fine spatter, wall drips, cosmetic
//    specks from landing droplets) is finer than the gameplay grid and never claims turf.
//
// Atlas encoding (RGBA8, premultiplied by coverage — the level shader divides by A, see src/world/inkShading.js):
//   R = team share (0 = team 0, 1 = team 1), "over" composited: the newest splat wins at a team border
//   G = wetness: every splat lands at 1, a subtract pass dries it to 0 over ≈ 6 s (fresh ink is glossier + prouder)
//   B = per-splat tone
//   A = coverage as a smooth ≈ 3-texel profile, MAX blended (union of splats; redrawing a spreading splat every frame
//       is idempotent). The level shader reads A through a cubic B-spline for a thick, rounded ink height field.
//
// How a splat lands (all timings scale with its size): the body floods out from ≈ 40 % with a strong ease-out, rays
// shoot out ahead of it, satellite droplets thrown off the crown land a beat later (the farthest last), fine spatter
// lands after that, and on walls the lower edge sags into drips that keep running for 1.5–3 s. Each splat also sends
// a ripple across the ink surface (paint.ripple — also used by footsteps / dives / landings via fxHooks).
//
// API: splat(center, radius, team, { seed, stretch: Vector3, stretchAmt, kind, instant, cosmetic }) → m² claimed
//      speck(center, radius, team, seed)  — cosmetic micro-splat (landing droplets), GPU only
//      flood(region, team, { center, y, reach, dur, ease }) — ink a whole region (Zone Control), or wipe it (team -1)
//      ripple(pos, amp, wavelength, speed, life) · setView(camPos) · flush(dt) · sample/sampleWorld/coverage/regionStats
// kind: 'shot' 'line' 'blast' 'bomb' 'trail' 'drop' 'roll' 'speck' (inferred from radius/stretch when omitted;
//       'roll' needs `stretch` = the roll direction and paints a straight-edged band segment instead of a blob)
import * as THREE from 'three';
import { G } from '../core/ctx.js';

// 【中文导读】墨水系统 = GPU/CPU 双轨架构:
//  · GPU 轨:所有可涂墨的 3D 面被"剪开摊平"塞进一张大图集(渲染目标,见 _layout),
//    每滴墨作为一个 quad 画进图集,fragment shader 用 SDF(有符号距离场)现场"长"出墨团形状
//    (主体/射线/卫星液滴/飞溅/墙面滴流 5 层),玩家看到的是把这张图集贴回 3D 表面的结果。
//  · CPU 轨:每个面对应一张 0.25m 的粗网格(见 _initGrid),记录每格属于哪队,
//    回答"脚下是敌墨吗""涂地面积多少"等玩法问题——O(1) 查询,从不读 GPU。
//  · 两条轨用同一个 blobWobble() 轮廓公式,保证"看见的"和"判定的"是同一条边界。
//  · 联机:每滴墨只有 (中心, 半径, 队伍, 种子) 四个数,种子决定形状(纯函数),
//    其他端收到后重放同一个 splat() 即得到逐像素一致的墨。
// 配套阅读:docs/INK.zh-CN.md(新手图解)、src/world/inkShading.js(图集如何被着色消费)。

const MAX_QUADS = 6000;   // 每帧墨滴实例上限:一个 6000 quad 的大 BufferGeometry 一次 draw call 画完
const RIP_N = 24;         // 涟漪槽位数:脚步/跳跃/墨滴落水都会在墨面激起波纹(着色器见 inkShading.js)
const _rel = new THREE.Vector3();

// 墨滴类型 → 整数编号:不同武器只是同一套 SDF 形状系统的不同参数(见 fragment shader 里的 kindShape)
const K = { shot: 0, line: 1, blast: 2, bomb: 3, trail: 4, drop: 5, roll: 6, speck: 7 };
const K_SHOT = 0, K_LINE = 1, K_BLAST = 2, K_BOMB = 3, K_TRAIL = 4, K_DROP = 5, K_ROLL = 6, K_SPECK = 7;
// quad 半宽(以墨滴足迹半径为单位):射线/液滴/飞溅会溅到多远;DRIP_REACH 是墙面墨滴额外向下流多远
const REACH = [2.45, 2.1, 2.7, 2.75, 2.3, 1.9, 1.25, 1.35];
const DRIP_REACH = 3.9;

// 墨团主体轮廓:几个正弦项画出有机波浪边,两个高次幂余弦项画出"甩出去的手指"。
// 【关键】GPU 的 splat shader(PAINT_FS 里的 wob)逐行复刻了同一公式,
// 所以 CPU 判定网格和渲染出来的墨在边界上完全 agree——看见的就是判定的。
// seed 由 splat 传入(联机时由网络层固定),同一种子永远长出同一形状的墨团。
export function blobWobble(ang, seed) {
  return 1 + 0.12 * Math.sin(3 * ang + seed * 6.2831) + 0.08 * Math.sin(5 * ang + seed * 17.0) +
    0.05 * Math.sin(7 * ang + seed * 41.0) + 0.03 * Math.sin(11 * ang + seed * 73.0) + 0.018 * Math.sin(17 * ang + seed * 29.0) +
    0.17 * Math.pow(Math.max(Math.cos(ang - seed * 37.7), 0), 28) + 0.12 * Math.pow(Math.max(Math.cos(ang - seed * 53.3 - 2.1), 0), 36);
}
const WOB_MAX = 1.5;   // upper bound of blobWobble (reach of the CPU cell loop)
// roller band segment (face space, along = roll direction): half length / half width / corner rounding, × radius
const BAND_L = 0.55, BAND_W = 0.62, BAND_R = 0.1;

// ============================================================ GPU 轨:墨滴顶点着色器
// 不做任何矩阵变换:quad 的位置直接就是图集上的 NDC 坐标(-1..1),把"画贴图"当成全屏 2D 绘制。
// 每个顶点携带的参数原样传给 fragment shader,真正的形状在那里用数学"长"出来。
const PAINT_VS = /* glsl */`
attribute vec2 aPos;
attribute vec3 aLocal;
attribute vec4 aSplat;
attribute vec3 aStretch;
attribute vec4 aGrow;
varying vec3 vLocal;
varying vec4 vSplat;
varying vec3 vStretch;
varying vec4 vGrow;
void main() {
  vLocal = aLocal; vSplat = aSplat; vStretch = aStretch; vGrow = aGrow;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// ============================================================ GPU 轨:墨滴片元着色器
// 输入是"我在图集上的哪个像素",输出是"这个像素属于墨团的哪一部分、覆盖率多少"。
// 每一层形状(主体/射线/液滴/飞溅/滴流)都是一个距离场:距离 < 0 在形状内,> 0 在形状外,
// 最后用 smoothstep 把 0 附近约 3 个纹素宽的过渡变成平滑覆盖率。
// 形状完全由 (seed, 时间 tn) 决定,无任何历史状态——所以同一滴墨每帧重画结果不变(幂等)。
const PAINT_FS = /* glsl */`
precision highp float;
varying vec3 vLocal;     // metres from the splat centre in face space; z = centre's distance from the face plane
varying vec4 vSplat;     // final radius, team, seed, flags (isWall + 2 × kind)
varying vec3 vStretch;   // travel direction in face space, smear amount (0 = none)
varying vec4 vGrow;      // x: age / spread time (runs on past 1) · y: drip progress 0..1 · z: 1 = drips only
float hsh(float n) { return fract(sin(n) * 43758.5453123); }   // 一维哈希:同一种子 → 同样的"随机"形状参数
// 【与 CPU 的 blobWobble 逐行一致】墨团主体的有机轮廓
float wob(float a, float s) {
  return 1.0 + 0.12 * sin(3.0 * a + s * 6.2831) + 0.08 * sin(5.0 * a + s * 17.0) + 0.05 * sin(7.0 * a + s * 41.0)
    + 0.03 * sin(11.0 * a + s * 73.0) + 0.018 * sin(17.0 * a + s * 29.0)
    + 0.17 * pow(max(cos(a - s * 37.7), 0.0), 28.0) + 0.12 * pow(max(cos(a - s * 53.3 - 2.1), 0.0), 36.0);
}
// smin:平滑最小值,把两个距离场柔和地融合(墨滴主体和射线/液滴衔接处不生硬棱角)
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// 锥形射线:从 a(半径 ra)到 b(半径 rb)的渐细线条——墨滴"星芒"的基本件
float sdRay(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
// 每种墨滴类型 4 个数 = (射线数, 卫星液滴数, 细密飞溅数, 滴流数):炸弹最全,滚筒/墨点没有
vec4 kindShape(float k) {
  if (k < 0.5) return vec4(5.0, 7.0, 8.0, 3.0);     // shot
  if (k < 1.5) return vec4(3.0, 4.0, 5.0, 2.0);     // charger line
  if (k < 2.5) return vec4(7.0, 9.0, 10.0, 4.0);    // blast
  if (k < 3.5) return vec4(10.0, 12.0, 14.0, 5.0);  // bomb / slam / splat-out
  if (k < 4.5) return vec4(3.0, 4.0, 4.0, 2.0);     // trail drip
  if (k < 5.5) return vec4(2.0, 2.0, 0.0, 1.0);     // droplet paint
  return vec4(0.0);                                  // roller band, speck
}
void main() {
  float R = vSplat.x, team = vSplat.y, seed = vSplat.z;
  float isWall = mod(vSplat.w, 2.0);          // flags 编码:bit0 = 是否墙面,其余位 = 墨滴类型
  float kind = floor(vSplat.w * 0.5 + 0.01);
  float dn = vLocal.z;                         // 墨滴球心到这个面的垂直距离
  float r2 = R * R - dn * dn;
  if (r2 <= 0.0) discard;                      // 球够不着这个面,整个 quad 丢弃
  float r = sqrt(r2);                          // 3D 墨球在这个 2D 面上留下的"圆形足迹"半径
  // fall = 足迹相对完整半径的比例:球心离面越远的邻面墨印越小越淡(墨水绕过墙角时外侧自然变淡)
  float fall = clamp(r / max(R, 1e-3), 0.0, 1.0);
  vec2 p0 = vLocal.xy;
  float tx = max(max(abs(dFdx(p0.x)), abs(dFdy(p0.x))), max(abs(dFdx(p0.y)), abs(dFdy(p0.y))));   // metres per texel
  vec2 dir = vStretch.xy; float sa = vStretch.z;
  vec2 p = p0;
  if (sa > 0.0) {                              // 射击类:沿飞行方向前向涂抹(拖尾感)
    float a = dot(p, dir); vec2 perp = p - a * dir;
    float s = a > 0.0 ? 1.0 + sa : 1.0 + 0.25 * sa;   // 前方拉长多、后方略拉长
    p = perp + dir * (a / s);
  }
  float tn = vGrow.x;                          // 归一化时间:0=刚落地,1=主体扩散完,>1=液滴/飞溅陆续落地
  vec4 ks = kindShape(kind);
  float sd = 1e3;                              // 累计距离场:所有形状取(平滑)最小值合并进来
  if (vGrow.z < 0.5) {
    // ---- 【第①层 主体】从 40% 涨大到 100%,强烈 ease-out;它的最终边缘就是 CPU 判分用的那条边界
    float tb = 1.0 - pow(1.0 - clamp(tn, 0.0, 1.0), 4.0);
    float grow = mix(0.4, 1.0, tb);
    if (kind > 5.5 && kind < 6.5) {
      // 滚筒:直边矩形带(压过去的痕迹),长边带轻微波浪
      vec2 bx = vec2(-dir.y, dir.x);
      vec2 q = vec2(dot(p0, dir), dot(p0, bx));
      float wv = r * (0.03 * sin(q.x / r * 9.0 + seed * 30.0) + 0.018 * sin(q.x / r * 23.0 + seed * 11.0));
      vec2 dq = abs(q) - vec2(r * ${BAND_L} * grow, r * ${BAND_W} + wv);
      sd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - r * ${BAND_R};
    } else if (kind > 6.5) {
      sd = length(p) - r * grow * (1.0 + 0.12 * sin(3.0 * atan(p.y, p.x) + seed * 20.0));
    } else {
      sd = length(p) - r * grow * wob(atan(p.y, p.x), seed);
    }
    float dirAng = sa > 0.0 ? atan(dir.y, dir.x) : 0.0;
    float spread = mix(6.2831, 2.5, clamp(sa * 1.2, 0.0, 1.0));
    bool big = kind > 1.5 && kind < 3.5;
    // ---- 【第②层 射线】比主体先伸出去的短粗星芒:多数钝、偶尔一条长,末端结一颗"墨珠"
    float tsp = 1.0 - pow(1.0 - clamp(tn * 1.4, 0.0, 1.0), 3.0);
    for (int k = 0; k < 10; k++) {
      float fk = float(k);
      if (fk >= ks.x) break;
      float h1 = hsh(seed * 7.31 + fk * 1.93), h2 = hsh(seed * 3.17 + fk * 5.71), h3 = hsh(seed * 11.3 + fk * 2.39);
      float a = sa > 0.0 ? dirAng + (h1 - 0.5) * spread : (fk + 0.35 + 0.6 * h1) / ks.x * 6.2831 + seed * 6.2831;
      vec2 u = vec2(cos(a), sin(a));
      float edge = r * grow * wob(a, seed);
      float len = r * (0.07 + (big ? 0.5 : 0.4) * h2 * h2 * h2) * tsp;
      float wB = r * (0.055 + 0.06 * h3);
      float tipR = max(r * (0.012 + 0.012 * h3), tx * 0.45);
      vec2 tip = u * (edge + len) + vec2(-u.y, u.x) * len * 0.18 * (h1 - 0.5);
      float ray = min(sdRay(p, u * edge * 0.72, tip, wB, tipR), length(p - tip) - tipR * (1.6 + 1.4 * h2));
      sd = smin(sd, ray, r * 0.06);
    }
    // ---- 【第③层 卫星液滴】被主体冠部甩出去的小滴,落地比主体晚一拍(越远越晚),
    //      沿飞行线拉成椭圆;在墙上会被重力向下拽偏 32%
    for (int k = 0; k < 12; k++) {
      float fk = float(k);
      if (fk >= ks.y) break;
      float h1 = hsh(seed * 13.1 + fk * 7.7), h2 = hsh(seed * 5.3 + fk * 3.1), h3 = hsh(seed * 9.9 + fk * 1.7);
      float tl = 0.28 + 0.95 * h2;
      float land = smoothstep(tl, tl + 0.2, tn);
      if (land <= 0.0) continue;
      float a2 = sa > 0.0 ? dirAng + (h1 - 0.5) * spread : h1 * 6.2831;
      vec2 u = vec2(cos(a2), sin(a2));
      if (isWall > 0.5) u = normalize(mix(u, vec2(0.0, -1.0), 0.32));
      float dist = r * (1.1 + (big ? 1.05 : 0.8) * h2 * h2);
      float rad = r * (0.028 + 0.085 * h3) * fall * (1.0 - 0.4 * h2) * (big ? 0.8 : 1.0) * land;
      vec2 q = p - u * dist;
      float el = 1.0 + (0.5 + 1.6 * sa) * h2;
      q -= u * dot(q, u) * (1.0 - 1.0 / el);
      sd = smin(sd, length(q) - rad, rad * 0.8);
    }
    // ---- 【第④层 细密飞溅】更远处的小点,最晚落地;半径下限钳到 ~1 纹素,再远缩略也不消失
    for (int k = 0; k < 14; k++) {
      float fk = float(k);
      if (fk >= ks.z) break;
      float h1 = hsh(seed * 17.9 + fk * 4.13), h2 = hsh(seed * 2.71 + fk * 8.09), h3 = hsh(seed * 6.47 + fk * 3.37);
      if (tn < 0.45 + 0.95 * h2) continue;
      float a3 = sa > 0.0 ? dirAng + (h1 - 0.5) * spread * 1.15 : h1 * 6.2831;
      vec2 u = vec2(cos(a3), sin(a3));
      if (isWall > 0.5) u = normalize(mix(u, vec2(0.0, -1.0), 0.25));
      float rad = max(r * (0.011 + 0.02 * h3) * fall, tx * 0.9);
      sd = min(sd, length(p - u * r * (1.3 + 1.2 * h2)) - rad);
    }
  }
  // ---- 【第⑤层 墙面滴流】仅墙面:墨团下缘垂成细流,头部膨大带着墨往下走,中途轻微蜿蜒,随时间越流越长
  if (isWall > 0.5 && fall > 0.3 && ks.w > 0.0) {
    float dT = vGrow.y;
    float nD = min(6.0, ks.w + floor(R * 1.2));
    for (int k = 0; k < 6; k++) {
      float fk = float(k);
      if (fk >= nD) break;
      float h1 = hsh(seed * 3.7 + fk * 11.3), h2 = hsh(seed * 8.1 + fk * 2.9), h3 = hsh(seed * 4.3 + fk * 5.9);
      if (k > 1 && h3 < 0.3) continue;
      float x = (h1 * 2.0 - 1.0) * r * 0.72;
      float c = sqrt(max(1.0 - (x / r) * (x / r), 0.0));
      float yTop = -c * r * 0.7;
      float len = c * r * 0.25 + r * (0.3 + 2.3 * h2 * h2) * fall * dT;
      float w = r * (0.042 + 0.04 * h3) * (0.75 + 0.35 * fall);
      vec2 q = p0 - vec2(x, yTop);
      float ty = clamp(-q.y / max(len, 1e-4), 0.0, 1.0);
      q.x += sin(q.y / r * 9.0 + seed * 20.0 + fk * 2.3) * w * 0.35 * ty;
      float wt = w * mix(1.0, 0.6, smoothstep(0.05, 0.85, ty));
      float stream = max(abs(q.x) - wt, max(q.y, -len - q.y));
      vec2 tq = (q - vec2(0.0, -len + w * 0.3)) * vec2(1.0, 0.8);
      float bulb = length(tq) - w * (1.2 + 0.35 * h2) * (0.6 + 0.4 * dT);
      sd = smin(sd, smin(stream, bulb, w * 0.9), w * 1.2);
    }
  }
  // 距离 → 覆盖率:边界附近 ~3 纹素宽的平滑过渡(fwidth 自适应,任何缩放下边缘都不锯齿)
  float fw = max(fwidth(sd), 1e-5);
  float a = 1.0 - smoothstep(-1.5 * fw, 1.5 * fw, sd);
  if (a <= 0.002) discard;
  // 写入图集(premultiplied by coverage,R 队伍份额 G 湿度=1 新墨 B 单滴随机色调 A 覆盖率)
  gl_FragColor = vec4(team, 1.0, hsh(seed * 1.73), a);   // premultiplied by the blend: team share, wet, tone
}`;

// ============================================================ 区域灌注(区域控制模式 Zone Control)
// 用一道从中心向外跑的"波前"把整块区域涂成某队颜色(team -1 = 擦除回裸地面)。
// 每个被波前扫过的面画一个 quad,片元用自己的世界坐标判断是否落在区域轮廓内。
const FLOOD_MAXV = 64, FLOOD_MAXP = 6;   // 轮廓顶点/部件数上限(超出部分丢弃并告警)
const FLOOD_VS = /* glsl */`
attribute vec2 aPos;
attribute vec3 aW;
varying vec3 vW;
void main() { vW = aW; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FLOOD_FS = /* glsl */`
precision highp float;
uniform vec2 uPoly[${FLOOD_MAXV}];
uniform int uPart[${FLOOD_MAXP + 1}];
uniform int uParts;
uniform vec2 uY;        // floor heights that count
uniform vec2 uC;        // front centre (x, z)
uniform vec2 uR;        // this frame's band of the front: r0 < r <= r1
uniform float uTeam;    // 0 | 1, or -1 = wipe
varying vec3 vW;
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  if (vW.y < uY.x || vW.y > uY.y) discard;
  float r = length(vW.xz - uC);
  if (r <= uR.x || r > uR.y) discard;
  bool inside = false;
  for (int p = 0; p < ${FLOOD_MAXP}; p++) {
    if (p >= uParts) break;
    int a = uPart[p], b = min(uPart[p + 1], ${FLOOD_MAXV});
    bool c = false;
    int j = b - 1;
    for (int k = 0; k < ${FLOOD_MAXV}; k++) {                 // (constant bound: a part is uPoly[a .. b))
      int i = a + k;
      if (i >= b) break;
      vec2 P = uPoly[i], Q = uPoly[j];
      if ((P.y > vW.z) != (Q.y > vW.z) && vW.x < (Q.x - P.x) * (vW.z - P.y) / (Q.y - P.y) + P.x) c = !c;
      j = i;
    }
    if (c) { inside = true; break; }
  }
  if (!inside) discard;
  if (uTeam < -0.5) { gl_FragColor = vec4(0.0); return; }   // wiped: bare floor (written straight, no blending)
  // fresh (wet) ink with a soft, blotchy tone field so the flood isn't one flat sheet
  float tone = clamp(0.5 + 0.6 * (vnoise(vW.xz * 0.6) - 0.5) + 0.3 * (vnoise(vW.xz * 1.9 + 7.0) - 0.5), 0.0, 1.0);
  gl_FragColor = vec4(uTeam, 1.0, tone, 1.0);
}`;

export class PaintSystem {
  // atlasSize: 图集边长(像素);maxDensity: 目标分辨率(像素/米),打包失败会自动降;cell: CPU 判定网格边长(米)
  constructor(renderer, level, { atlasSize = 4096, maxDensity = 30, cell = 0.25 } = {}) {
    this.renderer = renderer;
    this.level = level;
    this.size = atlasSize;
    this.cell = cell;
    this.pad = 8;            // ≥ 2^maxInkLod texels so mip levels never bleed between faces
    this._layout(maxDensity);    // 先把所有可涂墨面摆进图集
    this._initGrid();            // 再建 CPU 判定网格
    this._q = [];
    this.growing = [];            // 正在扩散/滴落的墨滴(GPU 动画用;CPU 网格在 splat 时已记为最终形状)
    this.version = 0;          // CPU 网格版本号,变化时小地图等轮询方知道要刷新
    this.clock = 0;            // 墨水系统的内部时钟(涟漪出生时间以它为基准)
    this.frame = 0;
    this.viewPos = null;       // 相机位置(setView 每帧更新):太远的涟漪直接跳过/优先淘汰
    // 涟漪表:被关卡着色器(inkShading.js)读取,xyz + 出生时刻 · 振幅/波长/速度/寿命
    this.rip = new Float32Array(RIP_N * 4);
    this.ripP = new Float32Array(RIP_N * 4);
    this._ripS = new Float32Array(RIP_N);   // 每个槽位的"重要性"评分(振幅÷距离),淘汰最差的
    this._dryAcc = 0;                       // 干燥累积器:攒够 1/40s 才做一次减法 pass
    this._floods = [];         // 进行中的区域灌注
    this._floodPrep = new Map();   // region → 预算数据(按离波前中心距离排序的格子 + 图集 quads)
    this._initGPU();
  }

  // ------------------------------------------------------------ 图集布局(货架式打包 shelf packing)
  // 把所有可涂墨的面按真实尺寸换算成矩形,从高到低排序,一行一行摆进 size×size 的图集;
  // 摆不下就整体降分辨率(ppm ×0.92)重试,最多 30 次,直到放下为止。
  _layout(maxDensity) {
    const faces = this.level.faces.filter((f) => f.paintable);
    this.paintFaces = faces;
    const S = this.size;
    let ppm = maxDensity;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (this._tryPack(faces, ppm, S)) break;
      ppm *= 0.92;
    }
    this.ppm = ppm;
  }
  // 单行货架摆放:当前行放不下就开新一行;任何一行超出图集高度即宣告失败(返回 false 让 _layout 降分辨率)
  _tryPack(faces, ppm, S) {
    const pad = this.pad;
    const rects = faces.map((f) => ({ f, w: Math.ceil(f.su * ppm) + pad * 2, h: Math.ceil(f.sv * ppm) + pad * 2 }));
    // rotate nothing; sort by height
    rects.sort((a, b) => b.h - a.h);
    let x = 0, y = 0, rowH = 0;
    for (const r of rects) {
      if (r.w > S) return false;
      if (x + r.w > S) { x = 0; y += rowH; rowH = 0; }
      if (y + r.h > S) return false;
      r.x = x; r.y = y;
      x += r.w; rowH = Math.max(rowH, r.h);
    }
    for (const r of rects) r.f.atlas = { x: r.x, y: r.y, w: r.w, h: r.h, ppm, pad };
    this.usedHeight = y + rowH;
    return true;
  }

  // ------------------------------------------------------------ CPU 判定网格
  // 每个可涂墨面 → 一个 nu×nv 的格子数组(格子边长 this.cell,默认 0.25m),全部格子
  // 连续存放在一个大的 Uint8Array 里(面的 grid 字段是它在数组里的起始下标)。
  // 同时做两件初始化:1) 把格心往面内推 6cm 问关卡"是否埋进别的几何体",埋了的记为 dead
  // (柱子、台阶内部永不计分);2) 统计 turf 格总数与总面积,作为涂地百分比分母。
  _initGrid() {
    let total = 0;
    const lvl = this.level;
    const p = new THREE.Vector3();
    for (const f of this.paintFaces) {
      f.nu = Math.max(1, Math.round(f.su / this.cell));
      f.nv = Math.max(1, Math.round(f.sv / this.cell));
      f.cu = f.su / f.nu; f.cv = f.sv / f.nv;
      f.grid = total;
      total += f.nu * f.nv;
    }
    this.grid = new Uint8Array(total);      // 0 none, 1 team0, 2 team1
    this.dead = new Uint8Array(total);      // cells buried inside other geometry
    this.turfTotal = 0;
    this.turfArea = 0;
    this.counts = [0, 0];                   // live turf cells per team
    for (const f of this.paintFaces) {
      for (let j = 0; j < f.nv; j++) for (let i = 0; i < f.nu; i++) {
        p.copy(f.origin).addScaledVector(f.u, (i + 0.5) * f.cu).addScaledVector(f.v, (j + 0.5) * f.cv).addScaledVector(f.n, 0.06);
        const k = f.grid + j * f.nu + i;
        if (lvl.pointInside(p, 0, f.block)) this.dead[k] = 1;
        else if (f.turf) { this.turfTotal++; this.turfArea += f.cu * f.cv; }
      }
    }
  }

  // ------------------------------------------------------------ GPU 资源
  // 1) 图集渲染目标 rt:一张可以"往上面画"的贴图(RGBA8,带 mipmap,无深度)。
  //    R=队伍份额 G=湿度 B=单滴色调 A=覆盖率,详见文件头注释与 docs/INK.zh-CN.md。
  // 2) 一个常驻的 BufferGeometry 大缓冲(MAX_QUADS 个 quad),所有墨滴往里面填属性,
  //    每帧一次 draw call 全部画进图集。
  // 3) dryMesh:覆盖图集已用区域的小 quad,用"反向减法混合"把 G(湿度)一点点扣掉 → 墨水变干。
  // 4) flood 网格/材质:区域控制模式的整块灌注(单独的场景里画)。
  _initGPU() {
    const S = this.size;
    this.rt = new THREE.WebGLRenderTarget(S, S, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: true, depthBuffer: false, stencilBuffer: false,
    });
    this.texture = this.rt.texture;
    this.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const g = new THREE.BufferGeometry();
    this.aPos = new Float32Array(MAX_QUADS * 4 * 2);
    this.aLocal = new Float32Array(MAX_QUADS * 4 * 3);
    this.aSplat = new Float32Array(MAX_QUADS * 4 * 4);
    this.aStretch = new Float32Array(MAX_QUADS * 4 * 3);
    this.aGrow = new Float32Array(MAX_QUADS * 4 * 4);
    const idx = new Uint32Array(MAX_QUADS * 6);
    for (let i = 0; i < MAX_QUADS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    const mk = (arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('aPos', mk(this.aPos, 2));
    g.setAttribute('aLocal', mk(this.aLocal, 3));
    g.setAttribute('aSplat', mk(this.aSplat, 4));
    g.setAttribute('aStretch', mk(this.aStretch, 3));
    g.setAttribute('aGrow', mk(this.aGrow, 4));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_QUADS * 4 * 3), 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = g;
    // 【混合规则是这个系统的精妙处】
    //   RGB 用 "over" 合成(新墨颜色按覆盖率盖在旧墨上,谁后画谁赢——两队墨水边界是覆盖渐变)
    //   A   用 "max"  合成(覆盖率取最大值,墨滴并集——扩散中的墨每帧重画不会越叠越深)
    // 两条规则各管一件事:over 管"队伍归属",max 管"形状并集"。
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PAINT_VS, fragmentShader: PAINT_FS,
      transparent: true, depthTest: false, depthWrite: false,
      // RGB: newest splat wins ("over"); A: max → union coverage that stays idempotent while a splat spreads
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    // drying: 1/255 of wetness (G) from the used part of the atlas, drawn in the same pass as the splats so the mip chain is rebuilt once per frame
    // 干燥 pass:每帧从图集已用区域的 G 通道(湿度)里减掉几级 1/255(≈6.4 秒干透)。
    // 和墨滴画在同一个渲染 pass 里,这样 mipmap 链每帧只重建一次。
    const yTop = Math.min(1, ((this.usedHeight + 2) / S) * 2 - 1);   // 图集只用到底部 usedHeight,上面全空不用画
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, yTop, 0, -1, yTop, 0]), 3));
    dg.setIndex([0, 1, 2, 0, 2, 3]);
    this._dryU = { uDry: { value: 0 } };
    this.dryMesh = new THREE.Mesh(dg, new THREE.ShaderMaterial({
      uniforms: this._dryU,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'precision highp float; uniform float uDry; void main() { gl_FragColor = vec4(0.0, uDry, 0.0, 0.0); }',
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.ReverseSubtractEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }));
    this.dryMesh.frustumCulled = false;
    this.dryMesh.renderOrder = -1;
    this.dryMesh.visible = false;
    this.scene.add(this.dryMesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quads = 0;
    // region floods: one mesh, its geometry / material swapped per flood. Ink blends like a splat (RGB over, A max);
    // a wipe writes bare floor straight into the atlas.
    const fu = {
      uPoly: { value: new Float32Array(FLOOD_MAXV * 2) }, uPart: { value: new Int32Array(FLOOD_MAXP + 1) }, uParts: { value: 0 },
      uY: { value: new THREE.Vector2() }, uC: { value: new THREE.Vector2() }, uR: { value: new THREE.Vector2() }, uTeam: { value: 0 },
    };
    const fmat = (o) => new THREE.ShaderMaterial({ uniforms: fu, vertexShader: FLOOD_VS, fragmentShader: FLOOD_FS, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, ...o });
    this._floodInk = fmat({
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    this._floodWipe = fmat({ blending: THREE.NoBlending });
    this._floodU = fu;
    this._floodMesh = new THREE.Mesh(new THREE.BufferGeometry(), this._floodInk);
    this._floodMesh.frustumCulled = false;
    this._floodScene = new THREE.Scene();
    this._floodScene.add(this._floodMesh);
    this.clear();
  }

  // 清空图集与全部状态(换地图/重开比赛时调用)。version 递增,通知小地图等轮询方整体重画。
  clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
    this.grid.fill(0);
    this.counts[0] = this.counts[1] = 0;
    this.quads = 0;
    if (this.growing) this.growing.length = 0;
    if (this.rip) { for (let i = 0; i < RIP_N; i++) { this.rip[i * 4 + 3] = -99; this.ripP[i * 4 + 3] = 0.01; this._ripS[i] = 0; } }
    this._dryAcc = 0;
    this._floods.length = 0;
    for (const p of this._floodPrep.values()) p.geo.dispose();
    this._floodPrep.clear();
    this.version++;
  }

  // Camera position for ripple priorities (fxHooks calls it every frame; the vector is kept by reference).
  setView(pos) { this.viewPos = pos; }

  _kind(opts, radius, st, sAmt) {
    if (opts.kind !== undefined) { const k = K[opts.kind]; if (k !== undefined && (k !== K_ROLL || st)) return k; }
    if (st) return sAmt >= 1 ? K_LINE : K_SHOT;
    if (radius >= 1.9) return K_BOMB;
    if (radius >= 1.05) return K_BLAST;
    if (radius < 0.3) return K_DROP;
    return K_TRAIL;
  }

  // ------------------------------------------------------------ splat:一滴墨落地
  // center: 世界坐标墨滴中心;radius: 墨球半径(米);team: 0|1;opts: { stretch 飞行方向, stretchAmt, seed,
  // kind, instant(立即成型,不做扩散动画), cosmetic(纯装饰,不记判分) }
  // 返回值:本滴墨新涂下的面积 m²(涂地得分 / 大招充能用)。
  splat(center, radius, team, opts = {}) {
    // online: other players' ghost rounds never paint (their owner's splats arrive instead); yours are recorded
    const nm = G.netm;
    if (nm && !opts.cosmetic) {
      if (nm.mute > 0) return 0;
      if (!nm.applying) { if (opts.seed === undefined) opts.seed = Math.random(); nm.recSplat(center, radius, team, opts); }
    }
    const seed = opts.seed ?? Math.random();
    const cosmetic = !!opts.cosmetic;
    const st = opts.stretch;
    let sAmt = st ? (opts.stretchAmt ?? 1) : 0;
    const kind = cosmetic && opts.kind === undefined ? K_SPECK : this._kind(opts, radius, st, sAmt);
    if (kind === K_ROLL) sAmt = 0;      // the direction orients the band; no smear
    const reachK = REACH[kind];
    const reach = radius * Math.max(3.2, reachK + 1.4 * sAmt + 0.3);
    const ids = this.level.queryBlocks(center.x - reach, center.z - reach, center.x + reach, center.z + reach, this._qb || (this._qb = []));
    let claimed = 0;
    const entries = [];
    let wall = false;
    for (const bid of ids) {
      const b = this.level.blocks[bid];
      // quick reject by AABB distance
      // AABB 快速排除:墨球够不到这个方块就跳过(纯距离比较,便宜)
      if (center.x < b.aabbMin.x - reach || center.x > b.aabbMax.x + reach ||
          center.y < b.aabbMin.y - reach || center.y > b.aabbMax.y + reach ||
          center.z < b.aabbMin.z - reach || center.z > b.aabbMax.z + reach) continue;
      for (let fi = 0; fi < 6; fi++) {
        const fid = b.faces[fi];
        if (fid < 0) continue;
        const f = this.level.faces[fid];
        if (!f.atlas) continue;                    // 这个面不参与涂墨(不可涂面没有图集格子)
        // —— 球面与平面的相交:dn = 球心到面的垂直距离 ——
        //    dn > R   球在面外,够不着;dn < −0.12 球钻到面背后去了
        //    否则足迹半径 rr = √(R² − dn²):球心离面越远,这个面上留下的墨印越小越淡
        //    (这就是墨滴"绕过墙角"时外侧自然变淡的原理)
        _rel.copy(center).sub(f.origin);
        const dn = _rel.dot(f.n);
        if (dn > radius || dn < -0.12) continue;
        const lu = _rel.dot(f.u), lv = _rel.dot(f.v);
        const rr = Math.sqrt(Math.max(0, radius * radius - dn * dn));
        const ext = rr * (reachK + 1.4 * sAmt);
        if (lu < -ext || lu > f.su + ext || lv < -ext - (f.wall ? rr * DRIP_REACH : 0) || lv > f.sv + ext) continue;
        // stretch / band direction projected into face space
        // 飞行方向投影到这个面的 2D 坐标系(u,v),决定墨滴的前向涂抹/滚筒朝向
        let sdu = 0, sdv = 0, sa = 0;
        if (st) {
          sdu = st.dot(f.u); sdv = st.dot(f.v);
          const l = Math.hypot(sdu, sdv);
          if (l > 0.2) { sdu /= l; sdv /= l; sa = sAmt * l; } else if (kind === K_ROLL) { sdu = 1; sdv = 0; } else { sdu = sdv = 0; }
        }
        if (!cosmetic) claimed += this._cpuSplat(f, lu, lv, rr, team, seed, sdu, sdv, sa, kind);
        entries.push(f, lu, lv, dn, sdu, sdv, sa);
        if (f.wall && rr > radius * 0.3) wall = true;
      }
    }
    if (entries.length) {
      // an older splat of the other team still spreading underneath this one finishes instantly, so the newer ink
      // always ends up on top (matching the gameplay grid)
      // 被这滴墨压住的"敌方正在扩散的墨"立刻催熟(把剩余动画一次性画完再移除),
      // 保证新的永远盖在旧的上面,与 CPU 网格的"后涂覆盖先涂"一致
      if (!cosmetic) {
        for (let i = this.growing.length - 1; i >= 0; i--) {
          const g = this.growing[i];
          if (g.team === team || g.kind === K_SPECK) continue;
          const dx = g.cx - center.x, dy = g.cy - center.y, dz = g.cz - center.z;
          const rs = (g.R * (g.dripDur ? DRIP_REACH : REACH[g.kind]) + radius * REACH[kind]);
          if (dx * dx + dy * dy + dz * dz < rs * rs) { this._emitGrowth(g, 3, 1, false); this.growing.splice(i, 1); }
        }
      }
      const drips = wall && kind !== K_SPECK && kind !== K_ROLL ? 1 : 0;
      // 生成一条"生长记录":CPU 网格此刻已按最终形状记完判分,GPU 动画交给 growing 队列在 flush 里逐帧推进
      const g = {
        entries, R: radius, team, seed, kind, age: 0,
        // the body floods out in ≈ 0.1–0.3 s (bigger = heavier), droplets land up to ~1.3× that later; drips run on
        // 动画时长:主体扩散 0.085~0.3s(越大越"沉"),液滴/飞溅在 1.7× 时长内陆续落地;dripDur 是墙面滴流总时长(1.1~3.3s)
        dur: kind === K_SPECK ? 0.05 : 0.085 + Math.min(0.22, radius * 0.075),
        dripDur: drips ? 1.1 + Math.min(2.2, radius * 1.5) : 0,
        cx: center.x, cy: center.y, cz: center.z,
      };
      if (opts.instant) this._emitGrowth(g, 3, 1, false);
      else this.growing.push(g);
      if (!cosmetic && radius >= 0.15 && !this._rippledNear(center, radius)) {
        // a ripple runs out across the wet ink from the impact (one per cluster: a roller stroke or a burst of trail
        // drips does not turn the ink into rain)
        // 落点在湿墨上激起一圈涟漪(半径够大才触发;0.16s 内附近的涟漪会去重——
        // 滚筒一行或一串 trail 不会把墨面打成"下雨")
        this.ripple(center, 0.0038 + 0.0036 * Math.min(radius, 3), 0.1 + 0.05 * Math.min(radius, 3), 0.85 + 0.35 * Math.min(radius, 3), 0.55 + 0.2 * Math.min(radius, 3));
      }
    }
    return claimed;
  }

  // 装饰性微墨点:飞行中的小液滴落地时调用。只画 GPU,半径上限 0.12m,比 0.25m 判定网格细,永不计分。
  speck(center, radius, team, seed = Math.random()) {
    return this.splat(center, Math.min(radius, 0.12), team, { seed, kind: 'speck', cosmetic: true });
  }

  // A ripple of at least this size already started nearby within the last ~0.16 s?
  // 0.16 秒内在附近已有不小于该振幅的涟漪?(落点簇去重:连续打在一个地方的子弹只激起一圈)
  _rippledNear(pos, radius) {
    const R = this.rip, P = this.ripP, reach = 0.55 + radius * 0.6;
    for (let i = 0; i < RIP_N; i++) {
      const o = i * 4, age = this.clock - R[o + 3];
      if (age < 0 || age > 0.16 || P[o] < 0.0036 + 0.0036 * Math.min(radius, 3) * 0.7) continue;
      const dx = R[o] - pos.x, dy = R[o + 1] - pos.y, dz = R[o + 2] - pos.z;
      if (dx * dx + dy * dy + dz * dz < reach * reach) return true;
    }
    return false;
  }

  // 在 pos 处的墨面激起一圈涟漪(只在有墨的地方可见)。amp 振幅(米,≈0.003–0.015)、wavelength 波长(米)、
  // speed 波速(m/s)、life 寿命(s)。24 个槽位用"振幅÷(1+距离²衰减)"评分,只保留最重要的一批;
  // 相机 38m 外的涟漪直接不要(看不见)。
  ripple(pos, amp = 0.006, wavelength = 0.14, speed = 1.2, life = 0.7) {
    let d2 = 0;
    const vp = this.viewPos;
    if (vp) {
      const dx = pos.x - vp.x, dy = pos.y - vp.y, dz = pos.z - vp.z;
      d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 38 * 38) return;
    }
    const score = amp / (1 + d2 * 0.012);
    let best = -1, bestS = Infinity;
    for (let i = 0; i < RIP_N; i++) {
      const o = i * 4;
      const age = this.clock - this.rip[o + 3], L = this.ripP[o + 3];
      if (age >= L || age < -1) { best = i; bestS = -1; break; }
      const s = this._ripS[i] * (1 - age / L);
      if (s < bestS) { bestS = s; best = i; }
    }
    if (best < 0 || bestS > score) return;
    const o = best * 4;
    this.rip[o] = pos.x; this.rip[o + 1] = pos.y; this.rip[o + 2] = pos.z; this.rip[o + 3] = this.clock;
    this.ripP[o] = amp; this.ripP[o + 1] = wavelength; this.ripP[o + 2] = speed; this.ripP[o + 3] = life;
    this._ripS[best] = score;
  }

  // 画墨滴的一次生长步骤。tn = 年龄/扩散时长(主体在 [0,1] 内涨大,液滴/飞溅在 ≈1.7 内陆续落地),
  // dT = 滴流进度 0..1,dripOnly = 主体已结束:只在墙上补画仍在流淌的滴流。
  // 图集 A 是 max 混合、RGB 是 over 混合且形状是时间的纯函数,所以每帧重画完全幂等(不会叠深)。
  _emitGrowth(g, tn, dT, dripOnly) {
    const E = g.entries, R = g.R, kind = g.kind;
    const reachK = REACH[kind];
    for (let i = 0; i < E.length; i += 7) {
      const f = E[i], lu = E[i + 1], lv = E[i + 2], dn = E[i + 3], sdu = E[i + 4], sdv = E[i + 5], sa = E[i + 6];
      if (dn >= R) continue;
      const rr = Math.sqrt(R * R - dn * dn);
      if (dripOnly) {
        if (!f.wall || rr < R * 0.3) continue;
        this._pushQuad(f, lu - rr * 0.95, lu + rr * 0.95, lv - rr * DRIP_REACH, lv - rr * 0.3, lu, lv, dn, R, g.team, g.seed, kind, sdu, sdv, sa, tn, dT, 1);
      } else {
        const ext = rr * (reachK + 1.4 * sa);
        const down = f.wall && g.dripDur ? rr * DRIP_REACH : 0;
        this._pushQuad(f, lu - ext, lu + ext, lv - Math.max(ext, down), lv + ext, lu, lv, dn, R, g.team, g.seed, kind, sdu, sdv, sa, tn, dT, 0);
      }
    }
  }

  // ------------------------------------------------------------ CPU 判分:墨滴在一个面上涂了哪些格子
  // f: 面;lu/lv: 墨滴中心在面坐标系中的位置;r: 该面上的足迹半径(=√(R²−dn²));
  // sdu/sdv/sa: 涂抹方向与强度(射击拖尾);返回新涂面积 m²。
  // 【一致性核心】格心判定用与 GPU 完全相同的公式:
  //   滚筒 → 直边矩形带的 SDF;其他 → 格心到中心距离 ÷ blobWobble(角度, 种子) ≤ 0.97。
  // 装饰层(射线/液滴/飞溅/滴流)比格子细,刻意不参与判分。
  _cpuSplat(f, lu, lv, r, team, seed, sdu, sdv, sa, kind) {
    if (r <= 0.02) return 0;
    const val = team + 1;                     // 格值编码:0 无墨,1 = 队伍0,2 = 队伍1
    const roll = kind === K_ROLL;
    // 扫描范围:普通墨按 wob 最大包络 WOB_MAX(1.5×r)加涂抹伸长;滚筒按矩形带对角线
    const ext = roll ? r * (Math.hypot(BAND_L, BAND_W) + BAND_R + 0.05) : r * (1 + sa) * WOB_MAX;
    const i0 = Math.max(0, Math.floor((lu - ext) / f.cu)), i1 = Math.min(f.nu - 1, Math.floor((lu + ext) / f.cu));
    const j0 = Math.max(0, Math.floor((lv - ext) / f.cv)), j1 = Math.min(f.nv - 1, Math.floor((lv + ext) / f.cv));
    if (i1 < i0 || j1 < j0) return 0;
    let claimed = 0;
    const cellA = f.cu * f.cv;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let px = (i + 0.5) * f.cu - lu, py = (j + 0.5) * f.cv - lv;   // 格心相对墨滴中心
        if (roll) {
          // 滚筒带:旋转到带坐标系后做圆角矩形 SDF(与 GPU 同一组 BAND_L/BAND_W/BAND_R 参数)
          const qa = Math.abs(px * sdu + py * sdv) - r * BAND_L, qb = Math.abs(-px * sdv + py * sdu) - r * BAND_W;
          const sd = Math.hypot(Math.max(qa, 0), Math.max(qb, 0)) + Math.min(Math.max(qa, qb), 0) - r * BAND_R;
          if (sd > -0.03 * r) continue;
        } else {
          if (sa > 0) {   // 前向涂抹:与 GPU 相同的坐标变换(前方拉长 1+sa,后方 1+0.25sa)
            const a = px * sdu + py * sdv;
            const qx = px - a * sdu, qy = py - a * sdv;
            const s = a > 0 ? 1 + sa : 1 + 0.25 * sa;
            px = qx + sdu * (a / s); py = qy + sdv * (a / s);
          }
          const d = Math.hypot(px, py);
          if (d > r * WOB_MAX) continue;   // 粗筛:肯定在最大包络外
          // 精判:距离 ÷ 该角度上的轮廓半径 ≤ 0.97 才算在墨内(0.97 留一点与 GPU smoothstep 边界的容差)
          if (d / (r * blobWobble(Math.atan2(py, px), seed)) > 0.97) continue;
        }
        const k = f.grid + j * f.nu + i;
        const prev = this.grid[k];
        if (prev === val) continue;          // 已经是本队墨,跳过
        this.grid[k] = val;
        claimed += cellA;                    // 后涂覆盖先涂:重新涂对方的地同样计入"新涂面积"(抢分)
        if (f.turf && !this.dead[k]) {       // 只有活 turf 格参与涂地百分比统计
          if (prev) this.counts[prev - 1]--;
          this.counts[team]++;
        }
      }
    }
    if (claimed > 0) this.version++;
    return claimed;
  }

  // 把一条 quad(墨滴在某个面上的一次绘制)写进大缓冲。
  // u0..v1: quad 在"面空间"(米)中的范围;其他参数原样打包给 shader。
  // 坐标换算:面空间(米)→ 图集像素 → NDC(-1..1);范围钳在面的图集格子内(含 pad)。
  _pushQuad(f, u0, u1, v0, v1, lu, lv, dn, R, team, seed, kind, sdu, sdv, sa, tn, dT, dripOnly) {
    if (this.quads >= MAX_QUADS) this._drawQuads();
    const a = f.atlas, S = this.size;
    const padM = (a.pad - 0.5) / a.ppm;
    u0 = Math.max(-padM, u0); u1 = Math.min(f.su + padM, u1);
    v0 = Math.max(-padM, v0); v1 = Math.min(f.sv + padM, v1);
    if (u1 <= u0 || v1 <= v0) return;
    const q = this.quads++;
    const flags = (f.wall ? 1 : 0) + 2 * kind;   // flags 编码:bit0 = 墙面,其余 = 墨滴类型
    // 4 个顶点各填一份完整参数(shader 里逐像素插值;quad 覆盖的范围就是形状可能触及的最大范围)
    for (let c = 0; c < 4; c++) {
      const cu = c === 1 || c === 2 ? u1 : u0, cv = c >= 2 ? v1 : v0;
      const vi = q * 4 + c;
      const px = a.x + a.pad + cu * a.ppm, py = a.y + a.pad + cv * a.ppm;
      this.aPos[vi * 2] = (px / S) * 2 - 1;         // aPos: 图集上的 NDC 位置(画在哪)
      this.aPos[vi * 2 + 1] = (py / S) * 2 - 1;
      this.aLocal[vi * 3] = cu - lu; this.aLocal[vi * 3 + 1] = cv - lv; this.aLocal[vi * 3 + 2] = dn;  // aLocal: 相对墨滴中心(米)+ 球心到面的距离
      this.aSplat[vi * 4] = R; this.aSplat[vi * 4 + 1] = team; this.aSplat[vi * 4 + 2] = seed; this.aSplat[vi * 4 + 3] = flags;  // aSplat: 半径/队伍/种子/flags
      this.aStretch[vi * 3] = sdu; this.aStretch[vi * 3 + 1] = sdv; this.aStretch[vi * 3 + 2] = sa;   // aStretch: 涂抹方向 + 强度
      this.aGrow[vi * 4] = tn; this.aGrow[vi * 4 + 1] = dT; this.aGrow[vi * 4 + 2] = dripOnly; this.aGrow[vi * 4 + 3] = 0;         // aGrow: 生长时间/滴流进度/是否只画滴流
    }
  }

  // ------------------------------------------------------------ 每帧主循环
  // 推进正在扩散/滴落的墨滴动画 → 干燥湿度 → (区域控制模式)推进灌注波前 → 把所有 quad 画进图集。
  flush(dt = 1 / 60) {
    this.clock += dt;
    this.frame++;
    for (let i = 0; i < this.growing.length; i++) {
      const g = this.growing[i];
      g.age += dt;
      const tn = g.age / g.dur;                 // 主体生长进度(>1 表示液滴/飞溅还在陆续落地)
      const td = g.dripDur ? Math.min(1, g.age / g.dripDur) : 1;
      const dT = 1 - Math.pow(1 - td, 2.2);     // 滴流进度:粘性流体的缓动——先快后慢地停下来
      const bodyDone = tn >= 1.75;              // 1.75 = 连最晚的飞溅都落地了
      if (bodyDone && td >= 1) {
        // 彻底结束:最后再画一次(把滴流画到终点),从队列移除。用 swap-and-pop 保持 O(1)
        this._emitGrowth(g, 3, 1, !!g.dripDur);
        this.growing[i] = this.growing[this.growing.length - 1]; this.growing.pop(); i--;
        continue;
      }
      this._emitGrowth(g, Math.min(tn, 3), dT, bodyDone);
    }
    // drying: 1/255 of wetness every 1/40 s (≈ 6.4 s from landing to dry), applied in steps of ≥ 2
    // 干燥:每 1/40 秒扣 1/255 的湿度(约 6.4 秒干透),攒够 ≥2 级才触发一次减法 pass(太少不值得画一次)
    this._dryAcc += dt;
    const n = Math.floor(this._dryAcc * 40);
    if (n >= 2) {
      const k = Math.min(n, 12);                // 单帧最多扣 12 级(掉帧时不会一口气全干)
      this._dryAcc -= k / 40;
      this._dryU.uDry.value = k / 255;
      this.dryMesh.visible = true;
    }
    const floods = this._floods.length > 0;
    // 灌注期间关掉 mipmap 自动生成,等灌注 pass 结束后由 _floodStep 重建(mip 链每帧只重建一次)
    if (floods) { this._floodSettle(); this.texture.generateMipmaps = false; }   // (one mip rebuild: after the floods)
    this._drawQuads();
    this.dryMesh.visible = false;
    if (floods) { this.texture.generateMipmaps = true; this._floodStep(dt); }
  }

  // ------------------------------------------------------------ region floods (Zone Control)
  // flood(region, team, { center: [x, z], y, reach, dur = 0.5, ease = 'out' | 'linear' }): ink a whole region with one
  // team's ink (team 0 | 1), or wipe it back to bare floor (team -1), as a front running out from `center` (radius =
  // reach · ease(t / dur); everything left is done at dur, so dur 0 = at once). region = { cells: Int32Array (its live
  // turf cells), polys: [[[x, z], …], …] (outlines), y0, y1 }. The atlas is flooded with the same test the cells were
  // picked with (inside an outline, y0 ≤ y ≤ y1), and the gameplay grid, the coverage counts and `version` (→ the
  // minimap) change with it as the front passes each cell, so what you see and what you swim in agree. Nobody is
  // credited: no turf points, no special gauge. A new flood of a region replaces one still running there.
  // 区域灌注(区域控制模式):把整块区域一次性涂成某队颜色(team 0|1)或擦除(team -1),
  // 表现为从 center 向外跑的一道"波前"(半径 = reach × ease(t/dur))。
  // CPU 网格随波前推进逐格翻转(所见即所游),图集用同样的轮廓/高度测试画同样的波前环带;
  // 不计个人得分、不涨大招槽。同一区域的新灌注会顶掉未完成的旧灌注。
  flood(region, team, opts = {}) {
    if (!region || !region.cells || !region.cells.length) return null;
    const c = opts.center || [0, 0];
    const P = this._floodPrepFor(region, c[0], c[1]);
    for (let k = this._floods.length - 1; k >= 0; k--) if (this._floods[k].region === region) this._floods.splice(k, 1);
    const J = {
      region, prep: P, team: team === 0 || team === 1 ? team : -1, t: 0, dur: Math.max(0, +opts.dur || 0), r: -1, i: 0,
      reach: Math.max(0.1, opts.reach ?? (P.n ? P.dist[P.n - 1] + 0.2 : 1)), ease: opts.ease === 'linear' ? 'linear' : 'out', cx: c[0], cz: c[1],
    };
    if (opts.dur == null) J.dur = 0.5;
    this._floods.push(J);
    // a flood sends a swell out across the fresh ink, riding the front
    if (J.team >= 0 && opts.y != null) this.ripple(_rel.set(c[0], opts.y, c[1]), 0.03, 0.45, J.reach / Math.max(0.2, J.dur) * 0.85, Math.max(0.6, J.dur * 1.6));
    return J;
  }

  // 区域的预算数据:1) 活 turf 格按到波前中心的距离排序(波前推进时按距离批量翻转格子);
  // 2) 每个涉及的面一个覆盖其 cell 包围盒(±1 格)的图集 quad(带着世界坐标);
  // 3) 轮廓多边形顶点(上传给 flood shader 做点在多边形内测试)。同一 region+中心可复用缓存。
  _floodPrepFor(region, cx, cz) {
    let P = this._floodPrep.get(region);
    if (P && P.cx === cx && P.cz === cz) return P;
    const faces = this.paintFaces, cells = region.cells;
    const faceOf = (k) => { let a = 0, b = faces.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (faces[m].grid <= k) a = m; else b = m - 1; } return faces[a]; };
    const ids = [], ds = [], box = new Map();
    for (let n = 0; n < cells.length; n++) {
      const k = cells[n], f = faceOf(k);
      if (!f || !f.atlas || k < f.grid || k >= f.grid + f.nu * f.nv) continue;
      const l = k - f.grid, i = l % f.nu, j = (l - i) / f.nu;
      const b = box.get(f);
      if (!b) box.set(f, [i, i, j, j]);
      else { if (i < b[0]) b[0] = i; if (i > b[1]) b[1] = i; if (j < b[2]) b[2] = j; if (j > b[3]) b[3] = j; }
      if (!f.turf || this.dead[k]) continue;                       // (counts only ever track live turf cells)
      const s = (i + 0.5) * f.cu, t = (j + 0.5) * f.cv;
      ids.push(k); ds.push(Math.hypot(f.origin.x + f.u.x * s + f.v.x * t - cx, f.origin.z + f.u.z * s + f.v.z * t - cz));
    }
    const ord = ids.map((_, n) => n).sort((a, b) => ds[a] - ds[b]);
    if (!P) {
      // one quad per face: the region's cell bounds on it + a cell (the outline can run up to half a cell past them),
      // clamped to the face's atlas rect incl. its padding (like a splat)
      const pos = [], w = [], index = [], S = this.size;
      for (const [f, b] of box) {
        const a = f.atlas, padM = (a.pad - 0.5) / a.ppm;
        const u0 = Math.max(-padM, (b[0] - 1) * f.cu), u1 = Math.min(f.su + padM, (b[1] + 2) * f.cu);
        const v0 = Math.max(-padM, (b[2] - 1) * f.cv), v1 = Math.min(f.sv + padM, (b[3] + 2) * f.cv);
        const base = pos.length / 2;
        for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
          pos.push(((a.x + a.pad + u * a.ppm) / S) * 2 - 1, ((a.y + a.pad + v * a.ppm) / S) * 2 - 1);
          w.push(f.origin.x + f.u.x * u + f.v.x * v, f.origin.y + f.u.y * u + f.v.y * v, f.origin.z + f.u.z * u + f.v.z * v);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('aPos', new THREE.Float32BufferAttribute(pos, 2));
      geo.setAttribute('aW', new THREE.Float32BufferAttribute(w, 3));
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 2) * 3), 3));
      geo.setIndex(index);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const poly = new Float32Array(FLOOD_MAXV * 2), part = new Int32Array(FLOOD_MAXP + 1);
      let nv = 0, np = 0;
      for (const p of region.polys || []) {
        if (!p || p.length < 3) continue;
        if (np >= FLOOD_MAXP || nv + p.length > FLOOD_MAXV) { console.warn('[paint] flood region outline too detailed; extra parts ignored'); break; }
        part[np++] = nv;
        for (const [x, z] of p) { poly[nv * 2] = x; poly[nv * 2 + 1] = z; nv++; }
      }
      part[np] = nv;
      P = { geo, poly, part, parts: np, y0: region.y0 ?? -2, y1: region.y1 ?? 6 };
      this._floodPrep.set(region, P);
    }
    P.cx = cx; P.cz = cz;
    P.order = Int32Array.from(ord, (n) => ids[n]); P.dist = Float32Array.from(ord, (n) => ds[n]); P.n = ord.length;
    return P;
  }

  // 灌注开始前:把波前即将经过之处"还在扩散的墨滴"全部催熟(一次性画到最终形状并移除),
  // 保证它们被画在灌注层下面,且不会在波前过去之后继续长到灌注的墨水上面。
  _floodSettle() {
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const g = this.growing[i];
      for (const J of this._floods) {
        const reach = J.reach + g.R * (g.dripDur ? DRIP_REACH : REACH[g.kind]) + 0.5;
        const dx = g.cx - J.cx, dz = g.cz - J.cz;
        if (dx * dx + dz * dz < reach * reach && g.cy > J.prep.y0 - 4 && g.cy < J.prep.y1 + 4) {
          this._emitGrowth(g, 3, 1, false);
          this.growing[i] = this.growing[this.growing.length - 1]; this.growing.pop();
          break;
        }
      }
    }
  }

  // 推进所有波前:半径从 J.r 涨到 rad 的格子的 CPU 状态翻转(网格 + 两队计数),
  // 同时把"这一帧波前跨过的环带"画进图集(flood shader 只画 r0 < r ≤ r1 的像素)。
  _floodStep(dt) {
    const r = this.renderer, prev = r.getRenderTarget(), ac = r.autoClear, U = this._floodU;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    let drew = false, changed = false;
    for (let k = 0; k < this._floods.length; k++) {
      const J = this._floods[k], P = J.prep;
      J.t += dt;
      const done = J.t >= J.dur, x = done ? 1 : J.t / J.dur;
      const rad = done ? 1e9 : J.reach * (J.ease === 'linear' ? x : 1 - (1 - x) * (1 - x));
      const val = J.team + 1;
      while (J.i < P.n && P.dist[J.i] <= rad) {
        const c = P.order[J.i++], was = this.grid[c];
        if (was === val) continue;
        this.grid[c] = val;
        if (was) this.counts[was - 1]--;
        if (val) this.counts[val - 1]++;
        changed = true;
      }
      if (rad > J.r && P.parts > 0) {
        U.uPoly.value = P.poly; U.uPart.value = P.part; U.uParts.value = P.parts;
        U.uY.value.set(P.y0, P.y1); U.uC.value.set(J.cx, J.cz); U.uR.value.set(J.r, rad); U.uTeam.value = J.team;
        this._floodMesh.geometry = P.geo;
        this._floodMesh.material = J.team < 0 ? this._floodWipe : this._floodInk;
        r.render(this._floodScene, this.cam);
        drew = true;
      }
      J.r = rad;
      if (done) this._floods.splice(k--, 1);
    }
    if (!drew) { this._floodMesh.visible = false; r.render(this._floodScene, this.cam); this._floodMesh.visible = true; }   // (mips)
    r.setRenderTarget(prev);
    r.autoClear = ac;
    if (changed) this.version++;
  }

  // 把本帧攒下的所有 quad(+干燥 pass)一次 draw call 画进图集渲染目标,然后清空队列。
  // 只上传 0..n 区间的缓冲(addUpdateRange),不整 buffer 重传。
  _drawQuads() {
    if (!this.quads && !this.dryMesh.visible) return;
    const g = this.geo, n = this.quads * 4;
    if (n) {
      for (const name of ['aPos', 'aLocal', 'aSplat', 'aStretch', 'aGrow']) {
        const at = g.attributes[name];
        at.clearUpdateRanges(); at.addUpdateRange(0, n * at.itemSize); at.needsUpdate = true;
      }
    }
    g.setDrawRange(0, this.quads * 6);
    this.mesh.visible = this.quads > 0;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.autoClear = ac;
    this.quads = 0;
    this.dryMesh.visible = false;
  }

  // ------------------------------------------------------------ 查询接口(都是 O(1) 数组下标)
  // 面局部坐标 (u,v) 处的队伍:0 无墨,1 = 队伍0,2 = 队伍1
  sample(faceId, u, v) {
    if (faceId < 0) return 0;
    const f = this.level.faces[faceId];
    if (!f || !f.atlas) return 0;   // (a face id from a stage being swapped in under a still-running match)
    const i = Math.min(f.nu - 1, Math.max(0, Math.floor(u / f.cu)));
    const j = Math.min(f.nv - 1, Math.max(0, Math.floor(v / f.cv)));
    return this.grid[f.grid + j * f.nu + i];
  }

  // Team at a world point lying on face faceId.
  sampleWorld(faceId, p) {
    if (faceId < 0) return 0;
    const f = this.level.faces[faceId];
    _rel.copy(p).sub(f.origin);
    return this.sample(faceId, _rel.dot(f.u), _rel.dot(f.v));
  }

  // 两队涂地百分比(裁判/计分板用)。分母是初始化时统计的"活 turf 格总数"。
  coverage() {
    return [this.counts[0] / this.turfTotal, this.counts[1] / this.turfTotal];
  }

  // 区域控制模式:以 (x, z, 高≈y) 为圆心 radius 范围内的 turf 格统计 { 己方, 敌方, 空白 } 份额。
  // 隔 2 格采样一格(精度够用、速度快);跳过 dead 格与高度差超过 2.5m 的面。
  regionStats(x, y, z, radius, team, out = { own: 0, enemy: 0, empty: 0, n: 0 }) {
    out.own = out.enemy = out.empty = out.n = 0;
    const ids = this.level.queryBlocks(x - radius, z - radius, x + radius, z + radius, this._qr || (this._qr = []));
    const own = team + 1;
    for (const bid of ids) {
      const b = this.level.blocks[bid];
      for (let fi = 0; fi < 6; fi++) {
        const fid = b.faces[fi];
        if (fid < 0) continue;
        const f = this.level.faces[fid];
        if (!f.turf || !f.atlas) continue;
        if (Math.abs(f.origin.y - y) > 2.5) continue;
        _rel.set(x, y, z).sub(f.origin);
        const lu = _rel.dot(f.u), lv = _rel.dot(f.v);
        const i0 = Math.max(0, Math.floor((lu - radius) / f.cu)), i1 = Math.min(f.nu - 1, Math.floor((lu + radius) / f.cu));
        const j0 = Math.max(0, Math.floor((lv - radius) / f.cv)), j1 = Math.min(f.nv - 1, Math.floor((lv + radius) / f.cv));
        for (let j = j0; j <= j1; j += 2) for (let i = i0; i <= i1; i += 2) {
          const du = (i + 0.5) * f.cu - lu, dv = (j + 0.5) * f.cv - lv;
          if (du * du + dv * dv > radius * radius) continue;
          const k = f.grid + j * f.nu + i;
          if (this.dead[k]) continue;
          const g = this.grid[k];
          out.n++;
          if (g === own) out.own++; else if (g) out.enemy++; else out.empty++;
        }
      }
    }
    if (out.n) { out.own /= out.n; out.enemy /= out.n; out.empty /= out.n; }
    return out;
  }

  dispose() {
    this.rt.dispose(); this.geo.dispose(); this.mat.dispose(); this.dryMesh.geometry.dispose(); this.dryMesh.material.dispose();
    for (const p of this._floodPrep.values()) p.geo.dispose();
    this._floodPrep.clear(); this._floods.length = 0;
    this._floodInk.dispose(); this._floodWipe.dispose();
  }
}
