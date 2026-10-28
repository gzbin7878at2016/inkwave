// ===============================================================================================================
// 【中文导读】screenfx.js —— 屏幕层后处理 FX(全屏合成 pass + 镜头墨水场)。
// 【模块定位】属于 fx 子系统,但是"镜头/屏幕"层而非世界层。main.js 在 boot 阶段 new ScreenFX(R, G)
//         (R = core/renderer.js 的渲染器包装器),构造函数通过 R.setExtraPass(pass) 把自己作为一个 ShaderPass
//         插在 grade pass 之后、OutputPass 之前(线性 HDR 空间,见 src/core/renderer.js 的 extraPass 注入位);
//         此后 main.js 每帧在 composer 渲染前调用 sfx.update(dt, this)。它还把自身交给 hud.attachScreenFX(this)。
// 【核心机制】两件东西:
//   ① 一个全屏 composite pass(FRAG):把各种 uniform 强度合成到画面上——屏幕扭曲(uPunch/uStretch)、径向模糊
//      (uSpeed 速度线 / uBlast 爆炸)、色散(uChroma)、暗角(uHeart/uHurt 低血心跳)、边缘敌墨 goo(uEdgeInk)、
//      墨洪/虹膜揭示(uFlood/uHole)、白闪(uFlash)、去饱和(uDesat)等。TAPS 决定径向模糊采样数,随画质变。
//   ② 一个独立的 GPU "镜头墨水场" LensInk:把镜头(屏幕)上的光泽墨珠画成一堆 metaball 光斑,渲染进半分辨率
//      render target,再由 composite pass 采样并做厚度/法线着色;墨珠会 splat、滴落、滑动、蒸发。
// 【零成本空闲】所有效果都由 uniform 强度驱动;当全部强度低于阈值时 this.pass.enabled = false,全屏 pass 整段不执行,
//         静止时几乎零开销(见 update() 末尾的 any 判定)。
// 【关键约定】① 高强度效果(模糊/色散/冲击/白闪)受 settings.cameraShake 与 prefers-reduced-motion 缩放系数 I 调制;
//         ② 所有衰减/弹簧跑在"模拟时钟" sdt(暂停时为 0),冻结/单步审计可复现;③ LensInk 的 rt 为半分辨率
//         (高画质 1/3,否则 1/4)以省填充率;④ 世界效应与屏幕效应分工:世界里的墨在 fx.js,镜头上的墨在这里。
// 【配套阅读】docs/CONTRACTS.zh-CN.md §4(屏幕 FX 契约)、docs/EVENTS.zh-CN.md(订阅的事件)、docs/RENDERING-UE4.zh-CN.md
//         (tonemapping/colorspace 注入点)、src/core/renderer.js(setExtraPass)、src/ui/hud.js(attachScreenFX)。
// 【建议阅读顺序】FRAG(全屏合成,按段读)→ LensInk 类(镜头墨场)→ ScreenFX 构造函数(状态 + uniform)→ _bind(事件)→
//         update → _sim → _simFlood。
// ===============================================================================================================
// INKWAVE — screen FX (stream 6). One full-screen composite pass inserted after the grade pass, before OutputPass
// (linear HDR), plus a GPU "lens ink" field: glossy metaball ink blobs on the camera lens that splat, drip and slide.
//
//   const sfx = new ScreenFX(R, G)      // R = core/renderer.js wrapper; installs itself with R.setExtraPass()
//   sfx.update(dt, game)                // every frame (main.js), before the composer renders
//   sfx.test(name, opts)                // debug/audit triggers: 'splat' 'water' 'flood' 'reveal' 'blast' 'jump' 'land' …
//
// Effects (all event/state driven, idle cost = zero because the pass disables itself):
//   lens ink splats (enemy hits, stepping in enemy ink, storm rain, sea water) · enemy-ink edge goo · low-HP heartbeat
//   vignette · hit chromatic kick + zoom punch · explosion/slam radial blur + shock ring + chroma pulse · swim speed
//   streaks + lens stretch + submerged ripple · super-jump charge glow, launch whiteout, flight streaks, landing punch ·
//   special aura · kill-confirm edge flash · spawn shimmer · charger focus tunnel · splatted ink flood + respawn iris
//   reveal · GO pop · final-10 s urgency pulse · time's-up freeze.
// Respects settings.cameraShake + prefers-reduced-motion for the intense ones (blur, chroma, punch, streaks, flash).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { on, G as CTX, clamp, damp, lerp } from '../core/ctx.js';
import { QUALITY } from '../config.js';

// 【模块级 scratch 与常量】同 fx.js 的零分配纪律:_v/_v2/_c/_cc 供 project/clamp 中转,不 new。
const TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _c = new THREE.Color(), _cc = new THREE.Color();
const SEA = new THREE.Color(0.06, 0.34, 0.62);   // 落水被击杀时的墨洪颜色(海蓝)
const HOT = new THREE.Color(1.0, 0.16, 0.05);    // 读秒紧迫感的暖红
const WHITE = new THREE.Color(1, 1, 1);
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const rnd = (a, b) => a + Math.random() * (b - a);
// 【无障碍】prefers-reduced-motion:若系统开启,所有剧烈效果乘以 0.35 的强度(见 update 里的 rm 系数)。
const RM_Q = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedMotion = () => !!(RM_Q && RM_Q.matches);

// ------------------------------------------------------------------------------------------------ composite shader
// 【全屏合成 pass 着色器】VERT 只是标准全屏三角/四边形;FRAG 是全部屏幕效果的合成核心,按段罗列:
//   uPunch/uStretch/uSwim/uBlast → 几何扭曲;blurDir+TAPS 循环 → 径向模糊;sceneTap → 带色散的采样;
//   之后依次叠加饱和度/聚焦隧道/速度线/水下色调/暗角/紧迫感/光环/白闪/边缘 goo/镜头墨/flood 等。
//   采样点全部走 sceneTap(单一入口,内部按 uChroma 决定 1 或 3 次采样),便于统一成本。
const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tLens;
  uniform vec2 uRes;
  uniform float uAspect;
  uniform float uTime;
  uniform float uSpeed;
  uniform vec3 uSpeedTint;
  uniform float uStretch;
  uniform float uPunch;
  uniform vec2 uPunchPos;
  uniform float uBlast;
  uniform vec2 uBlastPos;
  uniform float uBlastRing;
  uniform vec3 uBlastColor;
  uniform float uChroma;
  uniform float uLensOn;
  uniform vec2 uLensTexel;
  uniform vec3 uLensColA;
  uniform vec3 uLensColB;
  uniform vec4 uEdgeInk;
  uniform vec4 uAura;
  uniform vec4 uHeart;
  uniform float uHurt;
  uniform vec4 uUrgency;
  uniform vec4 uSwim;
  uniform float uFocus;
  uniform vec4 uShimmer;
  uniform vec4 uFlood;
  uniform float uFloodDrip;
  uniform float uFloodClear;
  uniform float uHole;
  uniform vec3 uHoleRim;
  uniform vec4 uFlash;
  uniform float uDesat;
  uniform float uSat;
  uniform vec4 uKill;
  uniform vec4 uCharge;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

  // 【edgeD】到最近屏幕边缘的距离(以屏幕高度为单位),用 logsumexp 让四角圆滑过渡(避免内角尖点)。
  // distance (in screen-height units) to the nearest screen edge, with rounded inner corners
  float edgeD(vec2 uv) {
    vec2 p = uv * vec2(uAspect, 1.0);
    float dx = min(p.x, uAspect - p.x), dy = min(p.y, 1.0 - p.y);
    const float k = 16.0;
    return -log(exp(-k * dx) + exp(-k * dy)) / k;
  }
  // 【gooBand】贴屏幕边缘的黏稠墨带:width 为带宽(高度单位),wob 让边缘用 fbm/vnoise 抖动;> 0 在墨内。
  // gooey ink band hugging the screen edges: > 0 inside the ink
  float gooBand(vec2 uv, float width, float wob, float seed) {
    vec2 p = uv * vec2(uAspect, 1.0);
    float n = fbm(p * 3.2 + vec2(seed, uTime * 0.12)) - 0.44;
    float n2 = vnoise(p * 10.0 + vec2(uTime * 0.25, seed * 1.7)) - 0.5;
    return width * (1.0 + n * wob * 2.2 + n2 * wob * 0.7) - edgeD(uv);
  }
  // 【drips】从屏幕顶边垂下的墨滴:按 x 分 19 个 id 格,每格随机长度/宽度,末端有 bulb 球头;> 0 在墨内。
  // ink drips hanging from the top edge: > 0 inside
  float drips(vec2 uv, float len, float seed, float top) {
    const float N = 19.0;
    float x = uv.x * N;
    float id = floor(x);
    float h = hash12(vec2(id, seed));
    float h2 = hash12(vec2(id, seed + 7.3));
    float fx = (fract(x) - 0.5 - (h2 - 0.5) * 0.5) / N * uAspect;   // horizontal distance, height units
    float L = len * (0.12 + 0.88 * h * h) * (0.9 + 0.1 * sin(uTime * (0.7 + h) + h * 6.28));
    float y = 1.0 - uv.y - top;
    if (y < -0.02) return -1.0;
    float w = (0.005 + 0.011 * h2) * (0.55 + 0.45 * step(0.35, h));
    float bulb = w * 1.55;
    float inTail = clamp(y / max(L, 1e-4), 0.0, 1.0);
    float rad = mix(w * 1.2, w, smoothstep(0.0, 0.3, inTail));
    rad = mix(rad, bulb, smoothstep(0.8, 1.0, inTail));
    float d = length(vec2(fx, max(y - L, 0.0))) - rad;
    return -d;
  }
  // 【inkShade】给定法线 n 的光泽湿墨着色:漫反射 + 两束高光 + 菲涅尔;thick 越大越不透明(越看不出背后)。
  // glossy wet-ink shading for a surface with normal n
  vec3 inkShade(vec3 inkCol, vec3 behind, vec3 n, float thick) {
    vec3 L = normalize(vec3(-0.42, 0.62, 0.66));
    float ndl = clamp(dot(n, L), 0.0, 1.0);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(clamp(dot(n, H), 0.0, 1.0), 64.0);
    float spec2 = pow(clamp(dot(n, normalize(vec3(0.5, -0.3, 0.8))), 0.0, 1.0), 18.0);
    float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0);
    vec3 base = inkCol * (0.42 + 0.62 * ndl);
    base = mix(base, behind * (0.35 + inkCol * 1.1), (1.0 - thick) * 0.28);
    return base * (1.0 - fres * 0.45) + spec * 2.4 + spec2 * inkCol * 0.25;
  }

  vec3 sceneTap(vec2 uv, vec2 ca) {
    if (uChroma > 0.0005) return vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
    return texture2D(tDiffuse, uv).rgb;
  }

  void main() {
    vec2 uv = vUv;
    vec2 c0 = vUv - 0.5;
    vec2 q = c0 * vec2(uAspect, 1.0);
    float r = length(q);

    // 【几何扭曲】先扭曲 uv(而非着色):冲击拉伸(以 uPunchPos 为中心放大)、游速/超级跳的镜头拉伸、
    //  水下波动、爆炸冲击环的径向挤压——都在采样前完成,后续段只用扭曲后的 uv,保证一致。
    // ---------------------------------------------------------------- geometric distortion
    uv = uPunchPos + (uv - uPunchPos) * (1.0 - uPunch);
    if (uStretch > 0.0001) { vec2 d = uv - 0.5; vec2 da = d * vec2(uAspect, 1.0); uv = 0.5 + d * (1.0 - uStretch * dot(da, da)); }
    if (uSwim.a > 0.001) uv += vec2(sin(uv.y * 37.0 + uTime * 2.6) + 0.5 * sin(uv.y * 71.0 - uTime * 3.3), cos(uv.x * 29.0 + uTime * 2.1)) * 0.0011 * uSwim.a;
    if (uBlast > 0.001) {
      vec2 bd = (uv - uBlastPos) * vec2(uAspect, 1.0);
      float bl = length(bd);
      float ring = exp(-pow((bl - uBlastRing) * 18.0, 2.0));
      uv -= (bd / max(bl, 1e-4)) / vec2(uAspect, 1.0) * ring * 0.028 * uBlast;
    }

    // 【采样:径向模糊 + 色散】blurDir 合并了速度线边缘模糊与爆炸径向模糊;TAPS 次采样每次走 sceneTap
    //  (内部按 uChroma 决定 1 或 3 次纹理取样)。blurDir≈0 时直接单采样,省掉循环。
    // ---------------------------------------------------------------- sampling: radial blurs + chromatic split
    float edgeW = smoothstep(0.22, 0.95, r);
    vec2 blurDir = (vec2(0.5) - uv) * (uSpeed * 0.055 * edgeW) + (uBlastPos - uv) * (uBlast * 0.05);
    vec2 ca = c0 * uChroma * 0.011 * (0.35 + r);
    vec3 col;
    if (dot(blurDir, blurDir) > 1e-7) {
      col = vec3(0.0);
      for (int i = 0; i < TAPS; i++) {
        float t = float(i) / float(TAPS - 1);
        col += sceneTap(uv + blurDir * t, ca);
      }
      col /= float(TAPS);
    } else {
      col = sceneTap(uv, ca);
    }

    // 【分级式调整】饱和度/去饱和;uFocus 蓄力时中心保持、边缘压暗的"聚焦隧道",并叠一圈随蓄力内缩的充能环。
    // ---------------------------------------------------------------- grading-type adjustments
    float l0 = luma(col);
    col = max(mix(vec3(l0), col, uSat * (1.0 - uDesat)), 0.0);
    if (uFocus > 0.001) {
      float v = smoothstep(0.3, 0.92, r);
      col *= 1.0 - v * uFocus * 0.5;
      col += uCharge.rgb * exp(-abs(r - mix(0.95, 0.3, uCharge.a)) * 40.0) * uCharge.a * 0.35 * step(0.01, uCharge.a);
    }

    // 【速度线】按角度分 96 lane,每 lane 随机宽度/相位,沿半径方向流动的虚线;只在外圈(r→1)显现。
    // ---------------------------------------------------------------- speed streaks
    if (uSpeed > 0.001) {
      float ang = atan(q.y, q.x);
      float a = ang / 6.28318 * 96.0;
      float id = floor(a);
      float h = hash12(vec2(id, 7.0));
      float lane = abs(fract(a) - 0.5);
      float lw = 0.05 + 0.1 * h;
      float streak = smoothstep(lw, lw * 0.25, lane);
      float mv = fract(r * (1.2 + h) - uTime * (2.2 + 2.4 * h) + h * 10.0);
      float dash = smoothstep(0.0, 0.08, mv) * smoothstep(0.55, 0.25, mv);
      float s = streak * dash * smoothstep(0.42, 1.0, r) * step(0.5, h) * uSpeed;
      col += uSpeedTint * s * 1.3;
    }

    // 【水下】游泳时整体偏水色,并叠焦散(caustic)闪点,越靠外圈越强。
    // ---------------------------------------------------------------- swim: submerged tint + caustic glints
    if (uSwim.a > 0.001) {
      float v = smoothstep(0.35, 1.05, r);
      col = mix(col, col * (0.55 + uSwim.rgb * 0.9), v * 0.45 * uSwim.a);
      float cst = vnoise(q * 16.0 + vec2(uTime * 0.7, -uTime * 0.4)) * vnoise(q * 21.0 - vec2(uTime * 0.5, uTime * 0.6));
      col += uSwim.rgb * pow(cst, 3.0) * 1.6 * uSwim.a * v;
    }

    // 【低血心跳暗角】uHeart.a 由 _sim 的心跳包络驱动,uHurt 提供持续压暗;噪声让暗角边缘不规整。
    // ---------------------------------------------------------------- low HP heartbeat vignette
    if (uHeart.a > 0.001 || uHurt > 0.001) {
      float v = smoothstep(0.42, 1.08, r + (fbm(q * 2.6 + uTime * 0.08) - 0.44) * 0.18);
      float k = clamp(v * (uHurt * 0.5 + uHeart.a * 0.65), 0.0, 0.9);
      col = mix(col, col * 0.3 + uHeart.rgb * (0.12 + 0.22 * uHeart.a), k);
    }

    // 【读秒紧迫】最后 10 秒边缘泛暖红、轻微发白,随 urg 强度脉冲。
    // ---------------------------------------------------------------- final-seconds urgency
    if (uUrgency.a > 0.001) {
      float v = smoothstep(0.5, 1.12, r);
      col = mix(col, col * vec3(1.1, 0.78, 0.72) + uUrgency.rgb * 0.2, v * uUrgency.a);
    }

    // 【边框特效】特殊技光环(边缘流线 + 虚线)、击杀闪光、出生微光——都是沿屏幕边缘的加法亮度。
    // ---------------------------------------------------------------- special aura / super-jump charge / kill flash / spawn shimmer
    if (uAura.a > 0.001) {
      float e = edgeD(vUv);
      float ang = atan(q.y, q.x);
      float flow = vnoise(vec2(ang * 4.0 - uTime * 1.2, e * 10.0 - uTime * 2.6));
      float rim = exp(-e * 55.0) * (0.55 + 0.6 * flow);
      float lane = 0.5 + 0.5 * sin(ang * 26.0 - uTime * 7.0 + flow * 3.0);
      float dashes = smoothstep(0.82, 0.97, lane) * exp(-e * 22.0) * 0.9;
      float tint = smoothstep(0.16, 0.0, e) * 0.22;
      col = mix(col, col * (0.7 + uAura.rgb * 0.45), tint * uAura.a);
      col += uAura.rgb * (rim + dashes) * uAura.a;
    }
    if (uKill.a > 0.001) col += uKill.rgb * smoothstep(0.5, 1.15, r) * uKill.a;
    if (uShimmer.a > 0.001) {
      float s = 0.5 + 0.5 * sin(uTime * 9.0 + r * 24.0 - atan(q.y, q.x) * 3.0);
      col += uShimmer.rgb * smoothstep(0.62, 1.12, r) * s * uShimmer.a * 0.35;
    }

    // 【爆炸辉光】以 uBlastPos 为中心的高斯辉光,乘上 uBlastColor。
    // ---------------------------------------------------------------- blast glow
    if (uBlast > 0.001) {
      float bd = length((vUv - uBlastPos) * vec2(uAspect, 1.0));
      col += uBlastColor * exp(-bd * 6.0) * uBlast * 0.2;
    }

    // 【脚下敌墨:边缘 goo】底部更宽,用 gooBand 的 SDF 反求法线做湿墨着色,覆盖度 m 抗锯齿。
    // ---------------------------------------------------------------- enemy ink underfoot: gooey edge band
    if (uEdgeInk.a > 0.001) {
      float bottom = smoothstep(0.6, 0.0, vUv.y);
      float w = uEdgeInk.a * (0.002 + 0.08 * bottom * bottom + 0.012 * bottom);
      float f = gooBand(vUv, w, 0.85, 11.0);
      float aa = fwidth(f) + 0.0015;
      float m = smoothstep(-aa, aa, f);
      if (m > 0.0) {
        float hgt = smoothstep(0.0, 0.028, f);
        vec3 n = normalize(vec3(-vec2(dFdx(hgt), dFdy(hgt)) * 0.028 * uRes.y * 0.9, 1.0));
        col = mix(col, inkShade(uEdgeInk.rgb, col, n, hgt), m * 0.94);
      }
    }

    // 【镜头墨水】采样 LensInk 的半分辨率 metaball 场 tLens:R/G 通道是该点两种墨色的权重(叠成 inkCol),
    //  B 通道是水面膜的覆盖度;由 fs(=R+G)的反差求法线,做厚度/菲涅尔/折射着色;fs<0.03 时整段跳过(省成本)。
    // ---------------------------------------------------------------- lens ink (metaball field rendered by LensInk)
    if (uLensOn > 0.5) {
      vec4 Lc = texture2D(tLens, vUv);
      float fs = Lc.r + Lc.g;
      if (fs > 0.03) {
        vec2 tx = uLensTexel * 1.5;
        vec4 Lx1 = texture2D(tLens, vUv + vec2(tx.x, 0.0)), Lx0 = texture2D(tLens, vUv - vec2(tx.x, 0.0));
        vec4 Ly1 = texture2D(tLens, vUv + vec2(0.0, tx.y)), Ly0 = texture2D(tLens, vUv - vec2(0.0, tx.y));
        vec2 gi = vec2((Lx1.r + Lx1.g) - (Lx0.r + Lx0.g), (Ly1.r + Ly1.g) - (Ly0.r + Ly0.g));
        vec3 n = normalize(vec3(-gi * 1.35, 1.0));
        float aa = fwidth(fs) * 1.1 + 0.012;
        float cov = smoothstep(0.5 - aa, 0.5 + aa, fs);
        float film = smoothstep(0.08, 0.5, fs) * (1.0 - cov);
        float thick = clamp((fs - 0.5) * 1.3, 0.0, 1.0);
        vec3 inkCol = (Lc.r * uLensColA + Lc.g * uLensColB) / max(fs, 1e-4);
        vec3 behind = texture2D(tDiffuse, vUv + n.xy * 0.03).rgb;
        vec3 body = inkShade(inkCol, behind, n, thick);
        float rim = smoothstep(0.5, 0.56, fs) * (1.0 - smoothstep(0.56, 0.75, fs));
        body *= 1.0 - rim * 0.3;
        col = mix(col, behind * mix(vec3(1.0), inkCol * 1.5 + 0.1, 0.55), film * 0.42);
        col = mix(col, body, cov);
      }
      float fw = Lc.b;
      if (fw > 0.03) {
        vec2 tx = uLensTexel * 1.5;
        float wx = texture2D(tLens, vUv + vec2(tx.x, 0.0)).b - texture2D(tLens, vUv - vec2(tx.x, 0.0)).b;
        float wy = texture2D(tLens, vUv + vec2(0.0, tx.y)).b - texture2D(tLens, vUv - vec2(0.0, tx.y)).b;
        vec3 n = normalize(vec3(-vec2(wx, wy) * 1.6, 1.0));
        float aa = fwidth(fw) * 1.1 + 0.012;
        float cov = smoothstep(0.5 - aa, 0.5 + aa, fw);
        vec3 refr = texture2D(tDiffuse, vUv - n.xy * 0.07).rgb;
        vec3 L = normalize(vec3(-0.42, 0.62, 0.66));
        float spec = pow(clamp(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 80.0);
        float fres = pow(1.0 - n.z, 1.6);
        vec3 wcol = refr * (1.02 - fres * 0.55) * vec3(0.93, 0.98, 1.04) + spec * 2.6;
        col = mix(col, wcol, cov);
        col = mix(col, col * 0.92, smoothstep(0.1, 0.5, fw) * (1.0 - cov) * 0.4);
      }
    }

    // 【墨洪 / 重生虹膜】被击杀时边缘涌墨铺满(uFloodClear=1 时是半透明海水膜),重生时中心开出虹膜孔(uHole)露出画面,
    //  孔缘叠一圈亮边(uHoleRim)。fbm 让墨面有起伏与厚度。
    // ---------------------------------------------------------------- splatted ink flood + respawn iris reveal
    if (uFlood.a > 0.001) {
      float width = uFlood.a * 1.05;
      float f = gooBand(vUv, width, 0.3 * (1.0 - 0.5 * smoothstep(0.7, 1.0, uFlood.a)), 3.7);
      f = max(f, drips(vUv, uFloodDrip, 1.3, width * 0.8));
      if (uHole > 0.0) {
        float hn = (fbm(q * 4.5 + vec2(uTime * 0.4, 0.0)) - 0.44) * 0.16;
        f = min(f, r + hn - uHole);
      }
      float aa = fwidth(f) + 0.0015;
      float m = smoothstep(-aa, aa, f);
      if (m > 0.0) {
        // thickness: bevelled rim + slow glossy undulations inside the sheet
        float und = fbm(q * 2.2 + vec2(uTime * 0.05, -uTime * 0.03)) - 0.44;
        float hgt = smoothstep(0.0, 0.05, f) + und * 1.6 * smoothstep(0.01, 0.16, f);
        vec3 n = normalize(vec3(-vec2(dFdx(hgt), dFdy(hgt)) * 0.05 * uRes.y * 0.8, 1.0));
        if (uFloodClear > 0.5) {
          // sea water sheet: refract + tint instead of opaque ink
          vec3 refr = texture2D(tDiffuse, vUv - n.xy * 0.09).rgb;
          vec3 L = normalize(vec3(-0.42, 0.62, 0.66));
          float spec = pow(clamp(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 70.0);
          vec3 w = mix(refr, refr * uFlood.rgb * 2.2 + uFlood.rgb * 0.12, 0.55 + 0.3 * clamp(hgt, 0.0, 1.0)) + spec * 2.2;
          col = mix(col, w, m);
        } else {
          float grain = vnoise(q * 60.0) * 0.05;
          col = mix(col, inkShade(uFlood.rgb * (0.94 + grain), col, n, clamp(hgt, 0.0, 1.0)), m);
        }
      }
      if (uHole > 0.0) {
        float rd = abs(r + (fbm(q * 4.5 + vec2(uTime * 0.4, 0.0)) - 0.44) * 0.16 - uHole);
        col += uHoleRim * exp(-rd * 26.0) * 0.9 * (1.0 - smoothstep(0.9, 1.25, uHole));
      }
    }

    // 【白闪】先压向灰度再叠色,且按半径加权(边缘更亮、中心留可读性)——这是"不遮住战斗"的关键。
    // ---------------------------------------------------------------- whiteout flash
    if (uFlash.a > 0.001) {
      col = mix(col, vec3(luma(col)), clamp(uFlash.a * 0.35, 0.0, 0.5));
      col += uFlash.rgb * uFlash.a * (0.2 + 0.8 * smoothstep(0.12, 0.95, r));   // edge-weighted: the centre (the action) stays readable
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ------------------------------------------------------------------------------------------------ lens ink field
// 【镜头墨场着色器】把每个墨珠当成一个屏幕空间的 metaball 光斑:片元输出 (R+G=覆盖/强度, B=水面膜),用加法混合
//  叠加进半分辨率 rt,再在 composite 里按 iso 阈值(0.5)还原成墨面。iA=(uv, rx, ry),iB=(rot, intensity, channel, 未用)。
const LENS_VERT = /* glsl */`
  attribute vec4 iA;   // x, y (uv), rx, ry (screen-height units)
  attribute vec4 iB;   // rotation, intensity, channel, unused
  uniform float uAspect;
  varying vec2 vP; varying float vI; varying vec3 vCh;
  void main() {
    vec2 corner = position.xy;
    float c = cos(iB.x), s = sin(iB.x);
    vec2 lp = vec2(corner.x * iA.z, corner.y * iA.w);
    vec2 rp = vec2(c * lp.x - s * lp.y, s * lp.x + c * lp.y);
    vec2 p = iA.xy + vec2(rp.x / uAspect, rp.y);
    vP = corner; vI = iB.y;
    vCh = iB.z < 0.5 ? vec3(1.0, 0.0, 0.0) : iB.z < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;
const LENS_FRAG = /* glsl */`
  varying vec2 vP; varying float vI; varying vec3 vCh;
  void main() {
    float d2 = dot(vP, vP);
    if (d2 >= 1.0) discard;
    float k = 1.0 - d2; k = k * k;
    gl_FragColor = vec4(vCh * k * vI, 0.0);
  }`;

// 【容量与通道】MAXS=220 是墨珠/拖尾的上限(池);CH_* 是 meteball 的"墨通道",决定它叠进 R/G/B 哪个通道
//  从而在 composite 里用不同颜色显示(enemy=R 敌方色 / own=G 己方色 / water=B 水膜)。
const MAXS = 220;       // sprite capacity (drops + trails)
const CH_ENEMY = 0, CH_OWN = 1, CH_WATER = 2;

// 【LensInk 类】镜头墨水的 GPU 场管理器。自带一个半分辨率 HalfFloat render target、一个 InstancedBufferGeometry
//  (每帧最多 MAXS 个 quad)与独立 Scene/Camera;parts/pool 是 CPU 侧的对象池,渲染时一次性写进实例属性。
class LensInk {
  constructor(renderer) {
    this.r = renderer;
    this.parts = [];
    this.pool = [];
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAspect: { value: 16 / 9 } }, vertexShader: LENS_VERT, fragmentShader: LENS_FRAG,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(mesh);
    this.cam = new THREE.Camera();
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.texel = new THREE.Vector2(0.25, 0.25);
    this.scale = 1 / 3;
    this.dirty = false;
  }

  // 【改尺寸】窗口/画质变化时重设 rt 尺寸;texel 供 composite 里做邻域采样求法线。
  resize(w, h, scale) {
    const W = Math.max(64, Math.round(w * scale)), H = Math.max(36, Math.round(h * scale));
    if (this.rt.width !== W || this.rt.height !== H) { this.rt.setSize(W, H); this.texel.set(1 / W, 1 / H); this.dirty = true; }
  }

  // 【取一个粒子】池空则新建;池满(≥MAXS)时优先淘汰"最弱/最老的 trail"(评分:trail 用 I,其余 I+10),
  //  回收进 pool 复用。所有字段在此重置为初始值,避免上一任残留。
  _new() {
    if (this.parts.length >= MAXS) {
      // recycle the weakest/oldest trail first
      let k = -1, best = Infinity;
      for (let i = 0; i < this.parts.length; i++) { const p = this.parts[i]; const s = p.kind === 'trail' ? p.I : p.I + 10; if (s < best) { best = s; k = i; } }
      const p = this.parts[k]; this.parts.splice(k, 1); this.pool.push(p);
    }
    const p = this.pool.pop() || {};
    p.vx = 0; p.vy = 0; p.rot = 0; p.age = 0; p.slide = false; p.trailT = 0; p.hold = 0; p.pop = 1; p.grow = 0; p.seed = Math.random() * 100;
    this.parts.push(p);
    return p;
  }

  // 【加一个光斑】kind: 'drop'|'arm'|'sat'|'trail';ch 是墨通道;x/y 为 uv(注意 VERT 里 y 已翻成向上)。
  //  stick 是开始下滑前的停留时间,pop 是出现时的膨胀时长(grow 0→1)。
  add(kind, ch, x, y, r, { rx = r, ry = r, rot = 0, I = 1, life = 1.5, stick = 99, pop = 0.09 } = {}) {
    const p = this._new();
    p.kind = kind; p.ch = ch; p.x = x; p.y = y; p.r = r; p.rx = rx; p.ry = ry; p.rot = rot; p.I0 = p.I = I;
    p.life = life; p.stick = stick; p.pop = pop; p.grow = pop > 0 ? 0 : 1;
    return p;
  }

  // 【墨溅】一次镜头溅墨 = 不规则核心 + 数条粗细不一、末端带球头的"臂" + 甩出的卫星小滴;重块稍后下滑并拖细膜拖尾。
  // One ink splat: a lumpy core, a few fat bulb-tipped arms of uneven length, flung satellite droplets. The heavy parts
  // slide down after a moment and leave a thin film trail; everything soaks away (shrinks through the iso-threshold).
  splat(ch, cx, cy, size, aspect, { arms = 6, sats = 6, life = 2.1 } = {}) {
    const rot0 = Math.random() * TAU;
    const P = (x, y, a, d) => [x + (Math.cos(a) * d) / aspect, y + Math.sin(a) * d];
    const core = this.add('drop', ch, cx, cy, size * 0.92, { I: 1.4, life: life * rnd(0.95, 1.15), stick: rnd(0.25, 0.55) });
    core.mass = 1;
    // lumps make the core silhouette irregular
    const nl = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < nl; i++) {
      const a = rot0 + (i / nl) * TAU + rnd(-0.5, 0.5);
      const [x, y] = P(cx, cy, a, size * rnd(0.3, 0.55));
      const l = this.add('drop', ch, x, y, size * rnd(0.5, 0.72), { I: 1.25, life: life * rnd(0.75, 1.0), stick: rnd(0.5, 1.2) });
      l.mass = 0.6;
    }
    // arms: fat necks (elongated metaballs) ending in bulbs; some stubby, one or two long
    for (let i = 0; i < arms; i++) {
      const a = rot0 + ((i + rnd(-0.3, 0.3)) / arms) * TAU;
      const long = Math.random() < 0.3;
      const L = size * (long ? rnd(1.35, 1.8) : rnd(0.85, 1.2));
      const [nx, ny] = P(cx, cy, a, L * 0.5);
      this.add('arm', ch, nx, ny, size * 0.3, { rx: size * rnd(0.2, 0.3) * (long ? 0.8 : 1), ry: L * 0.5, rot: a - Math.PI / 2, I: 1.3, life: life * rnd(0.6, 0.85) });
      const [bx, by] = P(cx, cy, a, L);
      const b = this.add('drop', ch, bx, by, size * (long ? rnd(0.26, 0.34) : rnd(0.3, 0.42)), { I: 1.35, life: life * rnd(0.7, 1.0), stick: rnd(0.4, 1.1) });
      b.mass = 0.4;
    }
    // satellites flung outward (a few stretched along their flight direction)
    for (let i = 0; i < sats; i++) {
      const a = Math.random() * TAU, d = size * rnd(1.45, 2.5);
      const sr = size * rnd(0.07, 0.16);
      const [x, y] = P(cx, cy, a, d);
      const st = Math.random() < 0.4;
      this.add('sat', ch, x, y, sr, { rx: sr * (st ? 0.7 : 1), ry: sr * (st ? 1.9 : 1), rot: a - Math.PI / 2, I: 1.3, life: rnd(0.5, 1.3), pop: 0.05 });
    }
    this.dirty = true;
  }

  // 【单滴】一颗小墨滴(雨点/脚步溅起/出墨带出);slide 是开始下滑的停留。
  // small single droplet (rain, stepping splashes, emerging from ink)
  droplet(ch, x, y, r, { slide = 0.25, life = 1.1 } = {}) {
    const d = this.add('drop', ch, x, y, r, { I: 1.3, life, stick: slide, pop: 0.05 });
    d.mass = 0.3;
    this.dirty = true;
    return d;
  }

  // 【清空】全部粒子退回池(重生/换局时调用)。
  clear() { while (this.parts.length) this.pool.push(this.parts.pop()); this.dirty = true; }

  // 【每帧推进】生长、按 life 淡出(metaball 缩过阈值→读作蒸发/吸收)、重滴的 stick-slip 下滑与拖膜、
  //  越界(y<-0.1)剔除。倒序遍历以便原地 splice。
  update(dt, aspect) {
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.grow < 1) p.grow = Math.min(1, p.grow + dt / Math.max(0.01, p.pop));
      // fade out after life (the metaball shrinks through the threshold → reads as ink evaporating / soaking away)
      const fade = p.age > p.life ? 1 - (p.age - p.life) / (p.kind === 'trail' ? 0.9 : 0.55) : 1;
      if (p.kind === 'trail') p.I = p.I0 * clamp(1 - p.age / p.life, 0, 1);
      else p.I = p.I0 * clamp(fade, 0, 1);
      if (p.I <= 0.01) { P.splice(i, 1); this.pool.push(p); continue; }
      if (p.kind === 'drop') {
        if (!p.slide && p.age > p.stick && p.r > 0.012) p.slide = true;
        if (p.slide) {
          // stick-slip: heavy drops run, pause, run; light ones creep
          p.hold -= dt;
          if (p.hold <= 0 && Math.random() < dt * 0.45) p.hold = rnd(0.06, 0.22);
          const g = p.hold > 0 ? 0 : 1.05 * (p.r / 0.05) * (0.55 + 0.45 * (p.mass || 1));
          p.vy -= g * dt;
          p.vy *= Math.exp(-dt * (p.hold > 0 ? 12 : 2.1));
          p.vx = Math.sin(p.age * 2.3 + p.seed) * 0.006 + Math.sin(p.age * 6.1 + p.seed * 2) * 0.003;
          const dx = p.vx * dt, dy = p.vy * dt;
          p.x += dx; p.y += dy;
          const sp = -p.vy;
          // leave a thin film trail (one sprite per ~0.6 radius travelled) and lose mass
          p.trailT += Math.hypot(dx * aspect, dy);
          if (p.trailT > p.r * 0.55) {
            p.trailT = 0;
            this.add('trail', p.ch, p.x, p.y + p.r * 0.45, p.r * 0.55, { rx: p.r * 0.42, ry: p.r * 0.72, I: 0.5, life: 1.2, pop: 0 });
            p.r *= 0.965;
          }
          p.ry = p.r * (1 + Math.min(0.9, sp * 9)); p.rx = p.r * (1 - Math.min(0.25, sp * 2.5));
          if (p.r < 0.01) { p.slide = false; p.life = Math.min(p.life, p.age + 0.2); }
        } else { p.rx = p.ry = p.r; }
        if (p.y < -0.1) { P.splice(i, 1); this.pool.push(p); continue; }
      }
    }
    this.dirty = true;
  }

  // 【渲染墨场】把 CPU 粒子写进实例属性(iA/iB),在自身 rt 上清屏后一次性 draw;保存/恢复渲染器的 RT、
  //  清屏色,确保不污染主渲染流程。grow 用 easeOut + 微弹(0.12*sin)做出"啪"的膨胀。
  render(aspect) {
    const P = this.parts, n = Math.min(P.length, MAXS);
    const A = this.aA.array, B = this.aB.array;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const g = p.grow < 1 ? 0.35 + 0.65 * easeOut(p.grow) * (1 + 0.12 * Math.sin(p.grow * Math.PI)) : 1;
      A[i * 4] = p.x; A[i * 4 + 1] = p.y; A[i * 4 + 2] = p.rx * g; A[i * 4 + 3] = p.ry * g;
      B[i * 4] = p.rot; B[i * 4 + 1] = p.I; B[i * 4 + 2] = p.ch; B[i * 4 + 3] = 0;
    }
    this.aA.needsUpdate = true; this.aB.needsUpdate = true;
    this.geo.instanceCount = n;
    this.mat.uniforms.uAspect.value = aspect;
    const r = this.r;
    const prevRT = r.getRenderTarget();
    r.getClearColor(_cc); const ca = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    if (n) r.render(this.scene, this.cam);
    r.setRenderTarget(prevRT);
    r.setClearColor(_cc, ca);
    this.dirty = false;
  }

  // 【释放】释放 rt / 几何 / 材质。
  dispose() { this.rt.dispose(); this.geo.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------------------ ScreenFX
// 【ScreenFX 主类】屏幕 FX 的总控:持有 composite ShaderPass、LensInk 场、全部效果状态与 uniform。
//  构造即安装 pass 并订阅事件;之后由 main.js 每帧 update() 驱动。
export class ScreenFX {
  constructor(R, Gctx) {
    this.R = R;
    this.G = Gctx || CTX;
    this.renderer = R.renderer;
    this.time = 0;
    this.lens = new LensInk(this.renderer);
    this.taps = 0;
    // 【合成材质】defines.TAPS 是径向模糊的采样数,update 里随画质改写并触发重编译;
    //  所有 uniform 都是"强度"(0=无效果)。tLens 指向 LensInk 的半分辨率 rt 纹理。
    this.mat = new THREE.ShaderMaterial({
      name: 'InkwaveScreenFX',
      defines: { TAPS: 8 },
      uniforms: {
        tDiffuse: { value: null }, tLens: { value: this.lens.rt.texture },
        uRes: { value: new THREE.Vector2(1600, 900) }, uAspect: { value: 16 / 9 }, uTime: { value: 0 },
        uSpeed: { value: 0 }, uSpeedTint: { value: new THREE.Color(1, 1, 1) }, uStretch: { value: 0 },
        uPunch: { value: 0 }, uPunchPos: { value: new THREE.Vector2(0.5, 0.5) },
        uBlast: { value: 0 }, uBlastPos: { value: new THREE.Vector2(0.5, 0.5) }, uBlastRing: { value: 0 }, uBlastColor: { value: new THREE.Color(1, 0.9, 0.8) },
        uChroma: { value: 0 },
        uLensOn: { value: 0 }, uLensTexel: { value: this.lens.texel }, uLensColA: { value: new THREE.Color(0.1, 0.2, 1) }, uLensColB: { value: new THREE.Color(1, 0.4, 0.05) },
        uEdgeInk: { value: new THREE.Vector4(0, 0, 0, 0) }, uAura: { value: new THREE.Vector4(0, 0, 0, 0) },
        uHeart: { value: new THREE.Vector4(0.6, 0.02, 0.06, 0) }, uHurt: { value: 0 },
        uUrgency: { value: new THREE.Vector4(HOT.r, HOT.g, HOT.b, 0) }, uSwim: { value: new THREE.Vector4(0, 0, 0, 0) },
        uFocus: { value: 0 }, uCharge: { value: new THREE.Vector4(1, 1, 1, 0) }, uShimmer: { value: new THREE.Vector4(0, 0, 0, 0) },
        uFlood: { value: new THREE.Vector4(0, 0, 0, 0) }, uFloodDrip: { value: 0 }, uFloodClear: { value: 0 }, uHole: { value: 0 }, uHoleRim: { value: new THREE.Color(1, 1, 1) },
        uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, uDesat: { value: 0 }, uSat: { value: 1 }, uKill: { value: new THREE.Vector4(1, 1, 1, 0) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
    });
    this.U = this.mat.uniforms;
    // 【安装 pass】包裹成 ShaderPass 并交给渲染器;初始 enabled=false——无效果时整段 pass 不执行(零成本)。
    this.pass = new ShaderPass(this.mat);
    this.pass.enabled = false;
    R.setExtraPass(this.pass);

    // 【效果状态】所有衰减/弹簧都跑在模拟时钟上(暂停时 sdt=0),使冻结/单步审计可复现。
    //  s.* 是各效果的当前强度/相位;flood 系列是墨洪序列器的状态;lastBlast 用于爆炸去重。
    // ---- effect state (all decays/springs run on the sim clock so frozen/stepped audits are deterministic)
    this.s = {
      speed: 0, stretch: 0, punch: 0, punchV: 0, blast: 0, blastT: 9, chroma: 0,
      edgeInk: 0, aura: 0, auraPulse: 0, heart: 0, heartPh: 0, hurt: 0, urg: 0, urgBase: 0, swim: 0, focus: 0, chargePulse: 0,
      shimmer: 0, kill: 0, flash: 0, desat: 0, sat: 1, satPop: 0,
      flood: 0, floodDrip: 0, hole: 0, floodMode: null, floodT: 0, holeT: 0,
      jump: null, jumpCharge: 0, wasJump: false, stepT: 0, rainT: 0, emergeT: 0, lastForm: 'kid', dmgAcc: 0, dmgT: 0, dmgAng: null, dmgAtk: null,
      lastBlast: { t: -9, x: 0, y: 0, z: 0 },
    };
    this._aspect = 16 / 9;
    this._w = 0; this._h = 0;
    this._inMatch = false;
    this._local = null;
    this.debugHold = 0;          // >0: test effects keep running even outside a match (lab/audit)
    this.stats = { lensParts: 0, enabled: false };
    this._size = new THREE.Vector2();
    // 【接线】订阅事件;把自己交给 HUD(接管损伤墨渍/暗角/阵亡去色),并在 G 上注册为 G.screenfx。
    this._bind();
    this.G.hud?.attachScreenFX?.(this);
    this.G.screenfx = this;
  }

  // ---------------------------------------------------------------------------------------------- events
  // 【事件绑定】只对"本地玩家 + 进行中的对局"生效(live/isLocal 守卫);每个订阅把事件翻译成状态变化或 lens 调用。
  _bind() {
    const G = this.G;
    // only react to gameplay while a round is actually running (not over the judge / results screens)
    const live = () => { const m = G.match; return !!(m && !m.attract && G.mode === 'match' && (m.state === 'playing' || m.state === 'intro' || m.state === 'finish')); };
    const isLocal = (a) => !!(a && a.isLocal && live());
    on('damage', ({ victim, attacker, amount, source }) => {
      if (!isLocal(victim) || amount <= 0) return;
      const s = this.s;
      s.dmgAcc += amount; s.dmgAtk = attacker || s.dmgAtk;
      if (s.dmgT <= 0) s.dmgT = 0.06; // gather a burst (multi-pellet / DOT ticks) into one splat
      const k = clamp(amount / 60, 0.1, 1);
      s.chroma = Math.min(0.9, s.chroma + 0.12 + k * 0.4);
      if (amount >= 40) this._kickPunch(-0.005 - 0.008 * k);   // chip damage doesn't pump the whole frame
    });
    on('hit', ({ attacker, killed }) => {
      if (!isLocal(attacker)) return;
      if (killed) { this.s.kill = 1; this.s.chroma = Math.min(1, this.s.chroma + 0.3); this._kickPunch(0.012); }
    });
    on('splatted', ({ victim, attacker, cause }) => {
      if (!live()) return;
      if (victim?.isLocal) this._startFlood(attacker, cause);
    });
    on('respawn', ({ actor }) => { if (isLocal(actor)) this._startReveal(actor); });
    on('superjump', ({ actor, phase }) => {
      if (!isLocal(actor)) return;
      const s = this.s;
      if (phase === 'charge') { s.jump = { phase: 'charge', t: 0 }; }
      else if (phase === 'flight') { s.jump = { phase: 'flight', t: 0 }; s.flash = 0.5; s.chroma = Math.min(1.2, s.chroma + 0.6); this._kickPunch(-0.04); }   // capped: the launch geyser must stay visible
    });
    on('superjump:land', ({ actor }) => { if (isLocal(actor)) this._land(actor); });
    on('special:use', ({ actor, id }) => {
      if (!isLocal(actor)) return;
      this.s.auraPulse = 1;
      this.s.chroma = Math.min(1, this.s.chroma + 0.25);
      if (id === 'storm') this.s.aura = Math.max(this.s.aura, 0.9);
    });
    // explosions: typed events when stream 4 emits them, otherwise the positional 'shake' requests (bombs, slams)
    const blast = (pos, amount, color) => {
      if (!pos || !live()) return;
      const lb = this.s.lastBlast;
      const same = this.time - lb.t < 0.05 && Math.abs(lb.x - pos.x) + Math.abs(lb.y - pos.y) + Math.abs(lb.z - pos.z) < 0.8;
      if (same) { if (color) this.U.uBlastColor.value.copy(color).lerp(WHITE, 0.35); return; }
      lb.t = this.time; lb.x = pos.x; lb.y = pos.y; lb.z = pos.z;
      this._blast(pos, amount, color);
    };
    on('shake', ({ amount, pos }) => { if (pos) blast(pos, amount, null); });
    on('bomb:explode', ({ pos, team }) => blast(pos, 0.6, G.teamColors?.[team]));
    on('special:slam', ({ pos, actor }) => {
      blast(pos, 1.0, actor ? G.teamColors?.[actor.team] : null);
      // your own slam: you expect it — keep the punch, soften the blur/glow so the payoff stays readable
      if (actor && actor.isLocal) { this.s.blast *= 0.55; this.s.chroma *= 0.7; }
    });
    on('match:state', ({ state, match }) => {
      if (!match || match.attract) return;
      const s = this.s;
      if (state === 'intro') this.reset();
      if (state === 'playing') { s.satPop = 1; s.chroma = Math.min(1, s.chroma + 0.35); this._kickPunch(0.015); }
      if (state === 'judge' || state === 'results') { s.floodMode = s.flood > 0 ? 'fadeout' : null; s.floodT = 0; this.lens.clear(); }
    });
    // enemy ink landing right next to the lens (shots splashing a wall beside you) flicks a few droplets onto it
    on('weapon:impact', ({ pos, team, kind }) => {
      if (!live() || !pos || kind === 'roll') return;
      const me = G.match && G.match.local, cam = G.camera;
      if (!me || !me.alive || team === me.team || !cam) return;
      const d2 = cam.position.distanceToSquared(pos);
      if (d2 > 2.4 * 2.4) return;
      _v2.copy(pos).project(cam);
      if (_v2.z > 1) return;
      const u = Math.min(0.97, Math.max(0.03, _v2.x * 0.5 + 0.5)), v = Math.min(0.97, Math.max(0.05, _v2.y * 0.5 + 0.5));
      const n = d2 < 1.2 ? 3 : 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) this.lens.droplet(CH_ENEMY, Math.min(0.98, Math.max(0.02, u + rnd(-0.06, 0.06))), Math.min(0.97, Math.max(0.04, v + rnd(-0.06, 0.06))), rnd(0.008, 0.02), { slide: rnd(0.1, 0.35), life: rnd(0.5, 1.0) });
    });
    on('match:count', ({ n }) => {
      if (!live()) return;
      this.s.urg = 1;
      this.s.urgBase = clamp((11 - n) / 10, 0, 1) * 0.35;
    });
  }

  // 【冲击弹簧】给 punch 速度注入冲量(×22 换算成弹簧单位);正值拉伸、负值收缩,由 _sim 里的临界阻尼弹簧回正。
  _kickPunch(v) { this.s.punchV += v * 22; }

  // 【爆炸】把世界坐标投影到屏幕:若在视野内则设置爆炸中心/环/色,并注入冲击;chroma 恒加(即使不在视野也抖一下)。
  _blast(pos, amount, color) {
    const G = this.G, cam = G.camera;
    if (!cam) return;
    const d = cam.position.distanceTo(pos);
    const k = amount * clamp(1 - (d - 3) / 24, 0, 1);
    if (k < 0.04) return;
    _v.copy(pos).project(cam);
    const on = _v.z < 1 && Math.abs(_v.x) < 1.25 && Math.abs(_v.y) < 1.25;
    const s = this.s;
    if (on) {
      this.U.uBlastPos.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      s.blast = Math.min(1.2, Math.max(s.blast, k * 1.1));
      s.blastT = 0;
      this.U.uBlastColor.value.copy(color || WHITE).lerp(WHITE, 0.35);
      this.U.uPunchPos.value.copy(this.U.uBlastPos.value);
    }
    s.chroma = Math.min(1.3, s.chroma + k * 0.9);
    this._kickPunch(0.02 * k);
  }

  // 【队伍色】取 G.teamColors[team],缺失回白色。
  _teamColor(team) { const c = this.G.teamColors?.[team]; return c || WHITE; }

  // 【墨洪开始】被击杀:边缘涌墨铺满;cause==='water' 时用水蓝并额外在镜头上撒一堆水滴(CH_WATER)。
  _startFlood(attacker, cause) {
    const s = this.s, U = this.U;
    const col = cause === 'water' ? SEA : attacker ? this._teamColor(attacker.team) : this._teamColor(this._local ? this._local.enemyTeam : 1);
    U.uFlood.value.set(col.r, col.g, col.b, s.flood);
    U.uFloodClear.value = cause === 'water' ? 1 : 0;
    s.floodMode = 'in'; s.floodT = 0; s.hole = 0;
    s.jump = null;
    s.chroma = Math.min(1.4, s.chroma + 0.9);
    this._kickPunch(-0.03);
    if (cause === 'water') {
      const a = this._aspect;
      for (let i = 0; i < 34; i++) this.lens.droplet(CH_WATER, Math.random(), rnd(0.05, 1.0), rnd(0.01, 0.034), { slide: rnd(0.3, 1.2), life: rnd(1.8, 3.6) });
      void a;
    }
  }

  // 【重生揭示】用己方色铺满,再从中心开出虹膜孔(uHole)露出战场;清镜头墨、叠一点去饱和与微光。
  _startReveal(actor) {
    const s = this.s, U = this.U;
    const col = this._teamColor(actor.team);
    U.uFlood.value.set(col.r, col.g, col.b, 1);
    U.uFloodClear.value = 0;
    U.uHoleRim.value.copy(col).lerp(WHITE, 0.55).multiplyScalar(1.6);
    s.flood = 1; s.floodMode = 'reveal'; s.floodT = 0; s.hole = 0.0001;
    s.floodDrip = 0.05;
    this.lens.clear();
    s.desat = Math.min(s.desat, 0.3);
    s.shimmer = 1;
  }

  // 【超级跳落地冲击】底部的爆炸环 + 冲击 + 轻微白闪。0.3s 去抖:类型化事件与状态迁移兜底可能都触发。
  _land(actor) {
    const s = this.s;
    if (this.time - (this._landT ?? -9) < 0.3) return;   // typed event + state-transition fallback can both fire
    this._landT = this.time;
    s.jump = null;
    this.U.uPunchPos.value.set(0.5, 0.3);
    this.U.uBlastPos.value.set(0.5, 0.18);
    this.U.uBlastColor.value.copy(this._teamColor(actor.team)).lerp(WHITE, 0.3);
    s.blast = Math.max(s.blast, 0.75); s.blastT = 0;
    s.chroma = Math.min(1.3, s.chroma + 0.7);
    this._kickPunch(0.045);
    s.flash = Math.max(s.flash, 0.35);
  }

  // 【损伤溅墨】把攻击者投影到屏幕,算出朝向他的边缘角度,在该侧溅墨(绝不盖住玩家角色本身);重击溅两团。
  // lens splat for a damage burst, placed on the screen edge toward the attacker (never over the player character)
  _damageSplat(amount, attacker) {
    const G = this.G, cam = G.camera, a = this._aspect;
    const k = clamp(amount / 70, 0.18, 1.2);
    let ang = null;
    if (attacker && cam && attacker.pos) {
      _v.copy(attacker.pos); _v.y += 1; _v.project(cam);
      let dx = _v.x, dy = _v.y;
      const behind = _v.z > 1;
      if (behind) { dx = -dx; dy = -dy; }
      if (!behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) { ang = dx >= 0 ? 0 : Math.PI; ang += rnd(-0.35, 0.35); }
      else ang = Math.atan2(dy, dx * a);
    }
    if (ang === null) ang = Math.random() * TAU;
    const n = k > 0.7 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const aa = ang + (i ? rnd(-0.7, 0.7) : rnd(-0.18, 0.18));
      const size = (0.045 + 0.05 * k) * (i ? 0.6 : 1) * rnd(0.85, 1.15);
      const p = this._edgePoint(aa, size * rnd(0.2, 0.9));
      this.lens.splat(CH_ENEMY, p.x, p.y, size, a, { arms: 6 + ((Math.random() * 4) | 0), sats: 5 + ((Math.random() * 5) | 0), life: 1.5 + k * 0.9 });
    }
  }

  // 【边缘取点】从中心沿角度 ang 打到屏幕边框、再向内缩 inset;避开下方中央(角色)与准星附近。
  // point on the screen border along a direction from the centre (uv, y up), pulled `inset` (height units) inward,
  // kept off the player character (bottom centre) and away from the crosshair
  _edgePoint(ang, inset) {
    const a = this._aspect;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    const t = Math.min((a / 2) / Math.max(1e-3, Math.abs(cx)), 0.5 / Math.max(1e-3, Math.abs(cy)));
    let x = a / 2 + cx * t, y = 0.5 + cy * t;
    x -= Math.sign(cx) * inset * (Math.abs(cx) > 0.25 ? 1 : 0.3);
    y -= Math.sign(cy) * inset * (Math.abs(cy) > 0.25 ? 1 : 0.3);
    let u = x / a, v = y;
    if (v < 0.5 && Math.abs(u - 0.5) < 0.2) u = 0.5 + Math.sign(u - 0.5 || (Math.random() - 0.5)) * rnd(0.22, 0.3);
    return { x: clamp(u, 0.02, 0.98), y: clamp(v, 0.03, 0.97) };
  }

  // 【重置】清空镜头墨并把所有效果强度归零(intro 开始 / 离开对局时调用)。
  reset() {
    const s = this.s;
    this.lens.clear();
    Object.assign(s, { speed: 0, stretch: 0, punch: 0, punchV: 0, blast: 0, chroma: 0, edgeInk: 0, aura: 0, auraPulse: 0, heart: 0, hurt: 0, urg: 0, urgBase: 0, swim: 0, focus: 0, shimmer: 0, kill: 0, flash: 0, desat: 0, sat: 1, satPop: 0, flood: 0, floodDrip: 0, hole: 0, floodMode: null, jump: null, dmgAcc: 0, dmgT: 0 });
  }

  // ---------------------------------------------------------------------------------------------- per frame
  // 【每帧入口】main.js 调用。流程:判定是否在对局内 → 尺寸/画质(set TAPS、resize lens)→ 强度缩放系数 I
  //  → 推进(_sim 或 _decayAll)→ 写 uniforms → 渲染镜头墨场 → 按"是否有可见效果"开关 pass。
  //  暂停时 sdt=0(模拟冻结),但 dt 仍推进外层计时。
  update(dt, game) {
    const G = this.G, s = this.s, U = this.U;
    const m = game?.match || G.match;
    const inMatch = !!(m && !m.attract && G.mode === 'match');
    const paused = !!(m && m.paused);
    if (!inMatch && this._inMatch) this.reset();
    this._inMatch = inMatch;
    const local = inMatch ? m.local : null;
    this._local = local;
    this.debugHold = Math.max(0, this.debugHold - dt);
    const active = inMatch || this.debugHold > 0;
    const sdt = paused ? 0 : dt;
    this.time += sdt;

    // 【尺寸 / 画质】尺寸变化时同步 uRes;TAPS 与 lens 分辨率随 QUALITY.particles 缩放(TAPS 变化需重编译)。
    // size / quality
    this.renderer.getDrawingBufferSize(this._size);
    const W = this._size.x, H = this._size.y;
    if (W !== this._w || H !== this._h) { this._w = W; this._h = H; U.uRes.value.set(W, H); }
    this._aspect = W / Math.max(1, H);
    U.uAspect.value = this._aspect;
    const q = QUALITY[G.settings?.quality] || QUALITY.high;
    const taps = q.particles >= 1 ? 8 : q.particles >= 0.7 ? 6 : 5;
    if (taps !== this.taps) { this.taps = taps; this.mat.defines.TAPS = taps; this.mat.needsUpdate = true; }
    this.lens.resize(W, H, q.particles >= 1 ? 1 / 3 : 1 / 4);

    // 【强度缩放】cameraShake 设置 × 减弱动效偏好;只作用于剧烈效果(模糊/色散/冲击/速度线/白闪等)。
    // intensity scaling for the intense (motion) effects
    const shake = clamp(G.settings?.cameraShake ?? 1, 0, 1);
    const rm = reducedMotion() ? 0.35 : 1;
    const I = shake * rm;

    if (active && !paused) this._sim(sdt, m, local);
    else if (!active) this._decayAll(dt);
    if (this.force && this.debugHold > 0) Object.assign(s, this.force);
    else if (this.force && this.debugHold <= 0) this.force = null;

    // 【写 uniforms】把 s.* 强度 × 缩放 I 写进 uniform;队伍相关色(敌墨 goo、暗角、光环、速度线、闪光…)在下方
    //  用 local 的队色重设 —— 所以这些效果的色调随你站哪队而变。
    // ---- uniforms
    const alive = !!(local && local.alive);
    U.uTime.value = this.time;
    U.uSpeed.value = s.speed * I;
    U.uStretch.value = s.stretch * I;
    U.uPunch.value = clamp(s.punch, -0.08, 0.08) * I;
    U.uBlast.value = s.blast * I;
    U.uBlastRing.value = easeOut(s.blastT / 0.55) * 0.9;
    U.uChroma.value = Math.min(1.5, s.chroma) * I;
    U.uEdgeInk.value.w = s.edgeInk;
    U.uAura.value.w = s.aura * (0.55 + 0.45 * I);
    U.uHeart.value.w = s.heart;
    U.uHurt.value = s.hurt;
    U.uUrgency.value.w = s.urg;
    U.uSwim.value.w = s.swim;
    U.uFocus.value = s.focus;
    U.uCharge.value.w = s.chargePulse * I;
    U.uShimmer.value.w = s.shimmer;
    U.uKill.value.w = s.kill * (0.5 + 0.5 * I);
    U.uFlash.value.w = s.flash * (0.3 + 0.7 * I);
    U.uDesat.value = s.desat;
    U.uSat.value = s.sat + s.satPop * 0.28;
    U.uFlood.value.w = s.flood;
    U.uFloodDrip.value = s.floodDrip;
    U.uHole.value = s.hole;
    if (local) {
      const own = this._teamColor(local.team), enemy = this._teamColor(local.enemyTeam);
      U.uLensColA.value.copy(enemy); U.uLensColB.value.copy(own);
      U.uEdgeInk.value.set(enemy.r, enemy.g, enemy.b, s.edgeInk);
      _c.copy(enemy).lerp(_cc.setRGB(0.55, 0.0, 0.04), 0.55);
      U.uHeart.value.set(_c.r, _c.g, _c.b, s.heart);
      U.uAura.value.set(own.r * 1.6, own.g * 1.6, own.b * 1.6, U.uAura.value.w);
      U.uSwim.value.set(own.r, own.g, own.b, s.swim);
      U.uSpeedTint.value.copy(own).lerp(WHITE, 0.6);
      U.uKill.value.set(own.r * 1.3, own.g * 1.3, own.b * 1.3, U.uKill.value.w);
      U.uShimmer.value.set(own.r + 0.3, own.g + 0.3, own.b + 0.3, s.shimmer);
      U.uCharge.value.set(own.r + 0.5, own.g + 0.5, own.b + 0.5, U.uCharge.value.w);
    }
    void alive;

    // 【镜头墨场】有粒子才渲染;game._skipRender 时跳过(审计/单步用)。stats.lensParts 供 __inkwave 查询。
    // ---- lens field
    const lensOn = this.lens.parts.length > 0;
    U.uLensOn.value = lensOn ? 1 : 0;
    if (lensOn && !game?._skipRender) this.lens.render(this._aspect);
    this.stats.lensParts = this.lens.parts.length;

    // 【空闲零成本】把所有效果强度做"或"判断:全部低于阈值时 pass.enabled=false,全屏 pass 整段不执行。
    // ---- enable the pass only when something is visible (idle = zero cost)
    const any = lensOn || s.speed > 0.002 || s.stretch > 0.0005 || Math.abs(s.punch) > 0.0004 || s.blast > 0.002 || s.chroma > 0.004 ||
      s.edgeInk > 0.002 || s.aura > 0.002 || s.heart > 0.002 || s.hurt > 0.002 || s.urg > 0.002 || s.swim > 0.002 || s.focus > 0.002 ||
      s.chargePulse > 0.002 || s.shimmer > 0.002 || s.kill > 0.002 || s.flash > 0.002 || s.desat > 0.002 || Math.abs(s.sat - 1) > 0.002 ||
      s.satPop > 0.002 || s.flood > 0.001;
    this.pass.enabled = any;
    this.stats.enabled = any;
  }

  // 【离开对局时的衰减】不在对局(菜单/结果页)时,把一切效果指数衰减收敛到 0,并继续推进/蒸发镜头墨。
  _decayAll(dt) {
    const s = this.s;
    const k = Math.exp(-dt * 6);
    for (const key of ['speed', 'stretch', 'blast', 'chroma', 'edgeInk', 'aura', 'auraPulse', 'heart', 'hurt', 'urg', 'swim', 'focus', 'chargePulse', 'shimmer', 'kill', 'flash', 'desat', 'satPop', 'flood']) {
      s[key] *= k; if (s[key] < 0.001) s[key] = 0;
    }
    s.punch *= k; s.punchV = 0; s.sat = damp(s.sat, 1, 6, dt); s.hole = 0; s.floodMode = null;
    this.lens.update(dt, this._aspect);
    if (this.lens.parts.length && dt > 0) { /* keep evaporating */ }
  }

  // 【每帧模拟】对局进行中的核心推进:损伤爆发结算、游速/超级跳、水下、敌墨 goo、镜头雨点、低血心跳、
  //  特殊技光环、蓄力聚焦、出生微光、读秒紧迫、结束去饱和、一次性效果衰减、punch 弹簧、墨洪序列器、镜头墨推进。
  _sim(dt, m, a) {
    const G = this.G, s = this.s;
    const alive = !!(a && a.alive);
    const state = m ? m.state : 'playing';

    // --- damage bursts → lens splats
    if (s.dmgT > 0) { s.dmgT -= dt; if (s.dmgT <= 0) { if (s.dmgAcc > 0 && alive) this._damageSplat(s.dmgAcc, s.dmgAtk); s.dmgAcc = 0; s.dmgAtk = null; } }

    // --- speed (swimming fast) + super jump flight
    const hs = alive ? Math.hypot(a.vel.x, a.vel.z) : 0;
    const form = alive ? a.anim.form : 'kid';
    const swimming = form === 'swim' || form === 'climb';
    let speedT = swimming ? clamp((hs - 6.5) / 5.3, 0, 1) * 0.55 : 0;
    let stretchT = swimming ? clamp((hs - 7) / 4.8, 0, 1) * 0.045 : 0;
    const sj = alive ? a.superJumpState : null;
    if (sj && sj.phase === 'flight') {
      const kk = clamp(sj.t / (sj.dur || 1.2), 0, 1);
      speedT = 0.55 + 0.45 * Math.abs(Math.cos(kk * Math.PI));   // fast launch, float at the apex, dive
      stretchT = 0.06 * (0.4 + 0.6 * Math.abs(Math.cos(kk * Math.PI)));
    }
    s.speed = damp(s.speed, speedT, speedT > s.speed ? 5 : 3, dt);
    s.stretch = damp(s.stretch, stretchT, 4, dt);
    // detect the super-jump landing if the typed event isn't emitted
    const wasFlight = s.wasJump;
    s.wasJump = !!(sj && sj.phase === 'flight');
    if (wasFlight && !s.wasJump && alive) this._land(a);
    // charge glow
    if (sj && sj.phase === 'charge') s.jumpCharge = Math.min(1, s.jumpCharge + dt / 0.75); else s.jumpCharge = Math.max(0, s.jumpCharge - dt * 3);

    // --- swim tint
    s.swim = damp(s.swim, alive && form === 'swim' ? 1 : 0, 7, dt);
    // emerging from ink with speed → a few own-ink droplets on the lower lens
    if (alive && s.lastForm === 'swim' && form !== 'swim' && form !== 'climb' && (hs > 7 || a.vel.y > 4) && s.emergeT <= 0) {
      s.emergeT = 0.6;
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) { const side = Math.random() < 0.5 ? rnd(0.04, 0.3) : rnd(0.7, 0.96); this.lens.droplet(CH_OWN, side, rnd(0.03, 0.22), rnd(0.008, 0.016), { slide: rnd(0.05, 0.2), life: rnd(0.45, 0.8) }); }
    }
    s.emergeT -= dt;
    s.lastForm = form;

    // --- enemy ink underfoot: edge goo + splashes on the lower lens when walking through it
    const inEnemy = alive && (a.onEnemy !== undefined ? !!a.onEnemy : a.grounded && a.groundTeam === 2 && !a.submerged);
    s.edgeInk = damp(s.edgeInk, inEnemy ? 1 : 0, inEnemy ? 9 : 3, dt);
    if (inEnemy && hs > 0.8) {
      s.stepT -= dt * (0.6 + hs / 3);
      if (s.stepT <= 0) {
        s.stepT = rnd(0.22, 0.4);
        const side = Math.random() < 0.5 ? rnd(0.03, 0.34) : rnd(0.66, 0.97);
        this.lens.droplet(CH_ENEMY, side, rnd(0.02, 0.14), rnd(0.012, 0.024), { slide: rnd(0.1, 0.4), life: rnd(0.6, 1.1) });
      }
    }

    // --- storm rain on the lens
    const clouds = G.projectiles?.clouds;
    if (alive && clouds && clouds.length) {
      for (const c of clouds) {
        const p = c.group?.position; if (!p) continue;
        const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
        if (dx * dx + dz * dz < 3.6 * 3.6 && c.t < c.dur) {
          s.rainT -= dt;
          if (s.rainT <= 0) {
            s.rainT = rnd(0.05, 0.12);
            const ch = c.team === a.team ? CH_OWN : CH_ENEMY;
            let u = Math.random(), v = rnd(0.15, 1.0);
            if (Math.abs(u - 0.5) < 0.16 && Math.abs(v - 0.5) < 0.2) u += 0.3 * Math.sign(u - 0.5 || 1);
            this.lens.droplet(ch, clamp(u, 0.02, 0.98), v, rnd(0.008, 0.02), { slide: rnd(0.02, 0.2), life: rnd(0.5, 1.1) });
          }
          break;
        }
      }
    }

    // --- low HP heartbeat (lub-dub, faster when lower)
    const hp = alive ? clamp(a.hp / 100, 0, 1) : 1;
    const lowK = alive ? clamp((0.5 - hp) / 0.38, 0, 1) : 0;
    s.hurt = damp(s.hurt, lowK, 4, dt);
    if (lowK > 0) {
      const bpm = 80 + 70 * lowK;
      s.heartPh = (s.heartPh + dt * bpm / 60) % 1;
      const p = s.heartPh;
      const beat = Math.exp(-Math.pow((p - 0.04) / 0.05, 2)) + 0.7 * Math.exp(-Math.pow((p - 0.24) / 0.055, 2));
      s.heart = lowK * beat;
    } else s.heart = damp(s.heart, 0, 6, dt);

    // --- special aura (active special) + super-jump charge build-up
    const special = alive && !!a.specialActive;
    s.auraPulse = Math.max(0, s.auraPulse - dt * 1.4);
    const auraT = Math.max(special ? 0.75 : 0, s.jumpCharge * 0.9, s.auraPulse * 0.9);
    s.aura = damp(s.aura, auraT, auraT > s.aura ? 10 : 2.5, dt);

    // --- charger focus tunnel
    const wr = alive ? a.weaponRunner : null;
    const charge = wr && wr.charging ? wr.charge : 0;
    s.focus = damp(s.focus, charge > 0 ? 0.25 + 0.75 * charge : 0, 8, dt);
    if (charge >= 0.999 && !s._fullCharge) { s._fullCharge = true; s.chargePulse = 1; }
    if (charge < 0.999) s._fullCharge = false;
    s.chargePulse = Math.max(0, s.chargePulse - dt * 2.4);

    // --- spawn shimmer (invulnerability window after a respawn)
    s.shimmer = damp(s.shimmer, alive && a.invuln > 0 && state === 'playing' ? 0.7 : 0, 5, dt);

    // --- final 10 s urgency: pulses decay toward a baseline that rises with the count
    s.urg = Math.max(state === 'playing' && m && m.time <= 10.2 ? s.urgBase : 0, s.urg - dt * 1.6);
    if (state !== 'playing') s.urgBase = 0;

    // --- time's up freeze / judge
    const desatT = state === 'finish' ? 0.45 : s.floodMode && s.floodMode !== 'reveal' && s.floodMode !== 'fadeout' ? 0.62 : 0;
    s.desat = damp(s.desat, desatT, 5, dt);
    s.sat = damp(s.sat, state === 'finish' ? 0.92 : 1, 4, dt);
    s.satPop = Math.max(0, s.satPop - dt * 2.2);

    // --- one-shots decay
    s.kill = Math.max(0, s.kill - dt * 2.4);
    s.flash = Math.max(0, s.flash - dt * (s.flash > 0.6 ? 4.5 : 2.6));
    s.chroma = Math.max(0, s.chroma - dt * 3.2);
    s.blast = Math.max(0, s.blast - dt * 2.4);
    s.blastT += dt;
    // 【冲击弹簧】临界阻尼(不回弹抖动);按帧内子步(hP)积分,任意帧率都稳定。
    // punch spring: critically damped (no overshoot wobble), sub-stepped so it's stable at any frame rate
    const wP = 16, nP = Math.max(1, Math.ceil((wP * dt) / 0.12)), hP = dt / nP;
    for (let i = 0; i < nP; i++) { s.punchV += (-wP * wP * s.punch - 2 * wP * s.punchV) * hP; s.punch += s.punchV * hP; }
    if (s.jumpCharge > 0) s.punch = lerp(s.punch, -0.012 * s.jumpCharge, 0.2);

    // --- splatted flood / respawn reveal sequencer
    this._simFlood(dt);

    // --- lens drops
    this.lens.update(dt, this._aspect);
  }

  _simFlood(dt) {
    const s = this.s;
    if (!s.floodMode) { s.flood = Math.max(0, s.flood - dt * 2); s.hole = 0; return; }
    s.floodT += dt;
    const t = s.floodT;
    if (s.floodMode === 'in') {
      // surge to full cover, hold, recede to a heavy dripping frame while spectating
      if (t < 0.24) s.flood = easeInOut(t / 0.24);
      else if (t < 0.5) s.flood = 1;
      else s.flood = lerp(1, 0.17, easeOut((t - 0.5) / 0.8));
      s.floodDrip = Math.min(0.4, t < 0.5 ? 0.05 : 0.05 + (t - 0.5) * 0.08);
    } else if (s.floodMode === 'reveal') {
      // own-colour ink covers everything, then an iris opens from the centre with a bright rim
      s.flood = 1;
      s.floodDrip = 0.05;
      const k = clamp((t - 0.1) / 0.72, 0, 1);
      s.hole = t < 0.1 ? 0.0001 : (Math.pow(k, 1.7) * 0.75 + easeOut(k) * 0.25) * 1.32;
      if (t > 0.86) { s.floodMode = null; s.flood = 0; s.hole = 0; }
    } else if (s.floodMode === 'fadeout') {
      s.flood = Math.max(0, s.flood - dt * 2.5);
      if (s.flood <= 0) s.floodMode = null;
    }
  }

  // ---------------------------------------------------------------------------------------------- debug / audit
  // __inkwave.screenfx.test('splat') etc. Works in a match; outside one it keeps effects alive for ~8 s.
  test = (typeof __INKWAVE_MANUAL__ === 'undefined' || !__INKWAVE_MANUAL__) ? function(name, o = {}) {
    const s = this.s, a = this._local || this.G.match?.local || null;
    this.debugHold = o.hold ?? 8;
    const team = a ? a.team : 0;
    const own = this._teamColor(team), enemy = this._teamColor(1 - team);
    if (!a) { this.U.uLensColA.value.copy(enemy); this.U.uLensColB.value.copy(own); this.U.uEdgeInk.value.set(enemy.r, enemy.g, enemy.b, 0); }
    switch (name) {
      case 'splat': { const ang = o.angle ?? Math.random() * TAU; const p = this._edgePoint(ang, o.inset ?? 0.05); this.lens.splat(CH_ENEMY, o.x ?? p.x, o.y ?? p.y, o.size ?? 0.08, this._aspect, { life: o.life ?? 2.2 }); break; }
      case 'damage': this._damageSplat(o.amount ?? 50, o.attacker || null); s.chroma = Math.min(1.2, s.chroma + 0.7); this._kickPunch(-0.025); break;
      case 'water': this._startFlood(null, 'water'); break;
      case 'flood': this.U.uFlood.value.set(enemy.r, enemy.g, enemy.b, 0); this.U.uFloodClear.value = 0; s.floodMode = 'in'; s.floodT = o.t ?? 0; break;
      case 'reveal': this.U.uFloodClear.value = 0; this.U.uFlood.value.set(own.r, own.g, own.b, 1); this.U.uHoleRim.value.copy(own).lerp(WHITE, 0.55).multiplyScalar(1.6); s.floodMode = 'reveal'; s.floodT = o.t ?? 0; s.flood = 1; break;
      case 'blast': this.U.uBlastPos.value.set(o.x ?? 0.5, o.y ?? 0.45); this.U.uPunchPos.value.copy(this.U.uBlastPos.value); this.U.uBlastColor.value.copy(own).lerp(WHITE, 0.35); s.blast = o.amount ?? 1; s.blastT = 0; s.chroma = 1; this._kickPunch(0.02); break;
      case 'jump': s.flash = 0.5; s.chroma = 1; s.speed = 1; s.stretch = 0.06; this._kickPunch(-0.04); break;
      case 'land': if (a) this._land(a); else { this.U.uBlastPos.value.set(0.5, 0.18); s.blast = 0.75; s.blastT = 0; s.chroma = 1; this._kickPunch(0.045); s.flash = 0.35; } break;
      case 'speed': s.speed = o.amount ?? 0.6; s.stretch = 0.045; break;
      case 'heart': s.hurt = o.amount ?? 0.8; s.heart = 1; this.force = { ...(this.force || {}), hurt: o.amount ?? 0.8, heart: o.beat ?? 0.9 }; break;
      case 'urgency': s.urg = 1; s.urgBase = 0.3; break;
      case 'aura': s.aura = 0.8; s.auraPulse = 1; this.force = { ...(this.force || {}), aura: 0.8 }; break;
      case 'kill': s.kill = 1; s.chroma = 0.3; break;
      case 'edge': s.edgeInk = 1; this.force = { ...(this.force || {}), edgeInk: 1 }; break;
      case 'swim': s.swim = 1; this.force = { ...(this.force || {}), swim: 1, speed: 0.55, stretch: 0.045 }; break;
      case 'focus': s.focus = 1; s.chargePulse = 1; this.force = { ...(this.force || {}), focus: 1 }; break;
      case 'urgencyHold': this.force = { ...(this.force || {}), urg: o.amount ?? 0.8 }; break;
      case 'rain': for (let i = 0; i < 30; i++) this.lens.droplet(CH_ENEMY, Math.random(), rnd(0.1, 1), rnd(0.008, 0.02), { slide: rnd(0.02, 0.2), life: rnd(0.8, 1.6) }); break;
      case 'clear': this.reset(); this.force = null; break;
      default: console.warn('[screenfx] unknown test', name);
    }
    return name;
  } : undefined;

  dispose() { this.lens.dispose(); this.mat.dispose(); }
}
