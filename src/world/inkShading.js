// INKWAVE — the wet-ink layer of the level surface shader. levelMaterial.js splices these GLSL chunks
// into its MeshPhysicalMaterial at the `${INK_*}` markers and merges inkUniforms() / calls inkBeforeRender().
//
// Paint atlas (src/world/paint.js), premultiplied by coverage — divide by A to read a channel:
//   R = team share (0 team A … 1 team B, "over" composited: the newest splat wins at a border)
//   G = wetness (every splat lands at 1; a subtract pass dries it to 0 over ≈ 6 s)
//   B = per-splat tone      A = coverage, a smooth ≈ 3-texel profile, MAX blended (union of all splats)
//
// Per pixel the layer
//  * rebuilds the atlas with a cubic B-spline close up (round outlines + a C2 height field with analytic gradients of
//    all four channels), mip-filtered far away;
//  * builds the ink surface: a meniscus lip at every edge (taller while wet), an overlap lip where the two teams meet
//    (the wetter = newer ink rides over the older one; two dry inks meet in a crease between their rounded edges),
//    expanding ripples from impacts / footsteps / dives (paint.ripple) and the gel micro-surface (smooth while fresh,
//    a little textured once dry);
//  * colours it: team colour × per-splat tone, a lighter translucent lip, a deeper body, a wet sheen; floors get a
//    contact shadow thrown away from the sun by the lip, walls a damp halo where the ink soaks into the surface;
//  * lights it: a clear wet coat (sharp while fresh, satin once dry) with a tamed grazing Fresnel so a low camera still
//    sees the team colour, and a lifted, richer fill in shade — ink never turns brown or muddy.
//
// ============================ 中文导读 ============================
// 本文件是「关卡材质」里的【湿墨层】着色代码。levelMaterial.js 在编译材质时,把下面这 9 段 GLSL 字符串
// 按 ${INK_*} 占位符拼接进 three.js 的 MeshPhysicalMaterial 模板里,并调用本文件的 inkUniforms() /
// inkBeforeRender() 完成数据对接。
//
// 【整体思路:效果全部从图集"读"出来,从不往图集"写"】
//   墨水的形状/湿度数据由 paint.js 维护在一张 GPU 渲染目标(图集)里,本文件只是消费者:
//   地面每一帧本来就要重新着色,着色器顺手采样图集,把"覆盖率、队伍占比、湿度、单滴色调"四个数
//   换算成:墨面高度场 → 边缘弯月唇/两军交界/涟漪 → 颜色混合 → 清漆高光 → 阴影补偿。
//
// 【四通道含义(图集是预乘覆盖率的,读某通道要除以 A)】
//   R = 队伍占比(0=队伍A … 1=队伍B,新墨在边界处盖过旧墨)
//   G = 湿度(每滴墨落下都是 1;paint.js 的减法 pass 在约 6 秒内把它减到 0,即"干燥")
//   B = 单滴色调(同队不同滴墨之间的深浅变化)
//   A = 覆盖率(所有墨滴的并集,约 3 像素宽的平滑剖面)
//
// 【九段代码各自负责(拼接顺序即渲染管线内的执行顺序)】
//   INK_PARS        采样工具:限梯度双线性采样 + 三次 B 样条重建(近景圆边)+ 高度→法线扰动
//   INK_COLOR       颜色:队伍混色、弯月唇、两军交界的"骑跨/折缝"、落地接触阴影/墙面洇晕
//   INK_ROUGH       粗糙度:湿墨 0.26 → 新墨 0.14(底层颜料)
//   INK_GEL         微表面:凝胶般的细小起伏(新墨更平、随时间微微晃动)
//   INK_SLOPE       涟漪:冲击/脚步/下潜产生的扩散波包(从 uniform 涟漪表循环求和)
//   INK_EMISSIVE    自发光:阴影里墨不发灰(类次表面散射)
//   INK_LIGHTS      湿清漆层:clearcoat 高光,压低掠射 Fresnel 防止低视角洗白
//   INK_LIGHT_MAPS  环境光/反射:阴影区保持色相,湿反射推向中性+微微透色
//   INK_SHADE       暗部补偿:提高暗部亮度并加深色度,墨在阴影里"更浓而不发褐"
//
// 贯穿全局的约定:所有 gInk* 都是本像素处的"墨状态"(0=无墨,1=满墨),后续每段代码都按 gInk 加权
// 与原本的地表混合——所以没墨的地方,这段着色代码全部是恒等变换,零开销。
import * as THREE from 'three';

export const INK_RIPPLES = 24;   // 涟漪表容量:任意时刻最多 24 条涟漪参与逐像素求和

// 本文件需要的全部 uniform(由 levelMaterial 合并进材质的 uniforms 里):
//   uInkClock —— paint.js 维护的"墨时钟"(秒),涟漪用它算 age;与 three.js 的 uTime 无关
//   uRip      —— 每条涟漪:xyz=世界坐标中心, w=诞生时刻(墨时钟)
//   uRipP     —— 每条涟漪:x=振幅(m), y=波长(m), z=波前速度(m/s), w=寿命(s)
export function inkUniforms() {
  return {
    uInkClock: { value: 0 },
    // ripples: xyz + birth time (paint clock) · amplitude (m), wavelength (m), speed (m/s), life (s)
    uRip: { value: Array.from({ length: INK_RIPPLES }, () => new THREE.Vector4(0, -999, 0, -99)) },
    uRipP: { value: Array.from({ length: INK_RIPPLES }, () => new THREE.Vector4(0, 0.2, 1, 0.01)) },
  };
}

// 每次绘制前调用(CPU 侧,JS):把 paint.js 的 Float32Array 拷贝成 uniform 的 Vector4 数组。
// 注意不是引用共享——GLSL 里 uRip 是 vec4 数组,three.js 需要 JS 侧的 Vector4 对象,
// 所以这里每帧做一次 24×2 次 .set(),量很小,可以忽略。
// Per draw: paint clock + the ripple table (paint.rip / paint.ripP are Float32Arrays of INK_RIPPLES × 4).
export function inkBeforeRender(U, P) {
  if (!U.uInkClock) return;
  U.uInkClock.value = P.clock || 0;
  const A = P.rip, B = P.ripP;
  if (!A || !B) return;
  const ra = U.uRip.value, rb = U.uRipP.value;
  for (let i = 0; i < INK_RIPPLES; i++) {
    const o = i * 4;
    ra[i].set(A[o], A[o + 1], A[o + 2], A[o + 3]);
    rb[i].set(B[o], B[o + 1], B[o + 2], B[o + 3]);
  }
}

// ---------------------------------------------------------------------------------------------------- fragment pars
// (after levelMaterial's own uniforms / varyings / noise helpers; uPaint, uTexel, uAtlasSize, uGel … are declared there)
export const INK_PARS = /* glsl */`
uniform float uInkClock;
uniform vec4 uRip[${INK_RIPPLES}];
uniform vec4 uRipP[${INK_RIPPLES}];
float gInkKeep = 0.0;      // share of the surface relief that still shows through thin (wall) ink
// gInkKeep:墙面上的墨很薄,地表本身的凹凸细节要保留多少(0=全盖住,1=全保留)

// Paint lookups use textureGrad with gradients clamped to ≤ 8 texels: trilinear + anisotropic filtering (no shimmer at
// distance) while never reaching mip levels coarse enough to bleed across the 8-texel face padding.
// 【为什么用 textureGrad 而不是 texture】双线性/三线性采样本身没问题,问题在于 mipmap 自动选层:
// 远处一个像素横跨图集的很多纹素,会自动跳到很粗的 mip 层——而图集里每个"面"之间只有 8 像素的
// 间隔,粗 mip 层会把相邻面的墨"串色"过来。所以这里把梯度手动钳制到 ≤8 纹素,即:
// 远处仍然平滑(靠各向异性过滤,不闪),但 mip 层永远不会粗到跨过面与面之间的间隔。
vec2 gPdx = vec2(0.0), gPdy = vec2(0.0);
vec4 paintAt(vec2 uv) { return textureGrad(uPaint, uv, gPdx, gPdy); }
// Close-up reconstruction of the paint atlas with a cubic B-spline (C2: smooth, round ink outlines and a smooth height
// field at any magnification) plus its analytic gradient — 12 bilinear taps inside one 4×4 texel footprint.
// 【近景重建:三次 B 样条】图集本身是逐像素存的,直接双线性放大后墨滴边缘是多边形的。
// 三次 B 样条 (B-spline) 重建把采样核换成 4×4 支撑区上的三次多项式:
//   C2 连续 → 边缘是真正的圆弧线,四通道(R/G/B/A)都得到一条光滑的高度场,
//   且导数有解析解(下面的 dw),不必做有限差分再采一次。
// 同时返回 gX/gY:四个通道各自沿 x/y 的梯度(每纹素变化量)——后面算弯月唇、交界都靠它。
void inkBspl(float t, out vec4 w, out vec4 dw) {
  // 一维三次 B 样条基函数在 [0,1] 内的值与导数,标准的 1/6·(…展开)形式:
  // w  = 权重(四段基函数在 t 处的取值,和为 1)
  // dw = 权重对 t 的导数(用于解析梯度)
  float t2 = t * t, t3 = t2 * t, it = 1.0 - t;
  w = vec4(it * it * it, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) * (1.0 / 6.0);
  dw = vec4(-it * it, 3.0 * t2 - 4.0 * t, -3.0 * t2 + 2.0 * t + 1.0, t2) * 0.5;
}
vec4 inkTap(vec2 st) { return textureLod(uPaint, (st + 0.5) / uAtlasSize, 0.0); }
// 【完整 2D 三次 B 样条:12 次双线性采样】经典的两 pass 可分离技巧,打包成单次采样:
// 三次 B 样条核可以分解为"双线性核 + 偏移",这里用 4 次双线性 tap 的加权组合
// 算出样条值,再用 8 次 tap(带导数偏移 dox/doy)算出解析梯度,合计 12 次 inkTap。
// 输入 uv 是图集纹理坐标(0..1),返回重建后的四通道值,梯度写入 gX/gY。
vec4 paintCubic(vec2 uv, out vec4 gX, out vec4 gY) {
  vec2 st = uv * uAtlasSize - 0.5;
  vec2 i = floor(st), f = st - i;
  vec4 wx, dwx, wy, dwy;
  inkBspl(f.x, wx, dwx); inkBspl(f.y, wy, dwy);
  vec2 gx = vec2(wx.x + wx.y, wx.z + wx.w), gy = vec2(wy.x + wy.y, wy.z + wy.w);
  vec2 ox = vec2(-1.0 + wx.y / gx.x, 1.0 + wx.w / gx.y), oy = vec2(-1.0 + wy.y / gy.x, 1.0 + wy.w / gy.y);
  vec2 dgx = vec2(dwx.x + dwx.y, dwx.z + dwx.w), dgy = vec2(dwy.x + dwy.y, dwy.z + dwy.w);
  vec2 dox = vec2(-1.0 + dwx.y / dgx.x, 1.0 + dwx.w / dgx.y), doy = vec2(-1.0 + dwy.y / dgy.x, 1.0 + dwy.w / dgy.y);
  vec4 v = gx.x * (gy.x * inkTap(i + vec2(ox.x, oy.x)) + gy.y * inkTap(i + vec2(ox.x, oy.y)))
         + gx.y * (gy.x * inkTap(i + vec2(ox.y, oy.x)) + gy.y * inkTap(i + vec2(ox.y, oy.y)));
  gX = dgx.x * (gy.x * inkTap(i + vec2(dox.x, oy.x)) + gy.y * inkTap(i + vec2(dox.x, oy.y)))
     + dgx.y * (gy.x * inkTap(i + vec2(dox.y, oy.x)) + gy.y * inkTap(i + vec2(dox.y, oy.y)));
  gY = dgy.x * (gx.x * inkTap(i + vec2(ox.x, doy.x)) + gx.y * inkTap(i + vec2(ox.y, doy.x)))
     + dgy.y * (gx.x * inkTap(i + vec2(ox.x, doy.y)) + gx.y * inkTap(i + vec2(ox.y, doy.y)));
  return v;
}
// Unnormalised Mikkelsen bump: dHdxy is the per-pixel change of a height in metres, so the tilt equals the true
// slope of the ink surface regardless of distance/viewing angle.
// 【高度场 → 法线:Mikkelsen 凹凸映射】输入 dHdxy 是"墨面高度沿屏幕 x/y 的真实坡度"(米/像素),
// 用屏幕空间的叉积基底把梯度折回切空间,得到扰动后的法线。
// 关键:高度单位是真实的米,所以 1 米外看和 100 米外看,墨面倾斜的视觉大小完全一致——
// 不会出现"远处墨面看起来变陡/变平"的失真。
vec3 perturbInk(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = dFdx(surf_pos.xyz);
  vec3 vSigmaY = dFdy(surf_pos.xyz);
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

// ---------------------------------------------------------------------------------------------------- colour
// Inside levelMaterial's color_fragment block, after the surface (base, rough) is built; writes gInk* and mixes base.
// 【INK_COLOR:颜色段】执行顺序解读:
//   ① 采样图集,近景用三次 B 样条重建,远景退化为普通采样 → 得到四通道 pnt 和梯度 gX/gY
//   ② 从覆盖率 A 平滑地挖出"这一像素有多少墨" gInk ∈ [0,1] —— 之后所有效果都乘它加权
//   ③ 队伍占比 R÷A → 经 smoothstep 得出锐利的队伍混色参数 tm(边界不混出第三色)
//   ④ 湿度 G÷A → 新墨鲜亮度 fresh(刚涂上的几秒发艳、发亮)
//   ⑤ 用覆盖率梯度 gradA 构造墨面高度剖面:边缘凸起弯月唇,墨面本身凹陷成"液池"
//   ⑥ 两队墨交界:新墨骑跨在旧墨上(圆唇),同龄墨相遇成折缝,并有接触阴影
//   ⑦ 落地墨在地面投软接触阴影;墙面墨在边缘洇出潮晕
export const INK_COLOR = /* glsl */`
  // vFaceData.y>0.5 → 这个面是可涂墨面;不可涂的道具/装饰直接跳过整段
  if (vFaceData.y > 0.5) {
    vec2 pdx = dFdx(vPaintUv), pdy = dFdy(vPaintUv);
    // 本像素横跨多少个图集纹素(屏幕 footprint)。它是"近景/远景"的判据:
    //   texFoot < 0.9  → 很近,要用三次 B 样条重建圆边;
    //   texFoot > 2.4  → 较远,直接双线性采样(远处重建没有意义,只会浪费)
    float texFoot = max(length(pdx), length(pdy)) / uTexel;
    // 把采样梯度钳制到 8 纹素以内(见 paintAt 的注释):远处三线性+各向异性过滤,永不跨面串色
    float gk = min(1.0, 8.0 / max(texFoot, 1e-4));
    gPdx = pdx * gk; gPdy = pdy * gk;
    vec4 pnt = paintAt(vPaintUv);
    // near ∈ [0,1]:近景权重,>0 才会走 B 样条重建
    float near = 1.0 - smoothstep(0.9, 2.4, texFoot);
    vec4 gX = vec4(0.0), gY = vec4(0.0);                   // per-texel gradients of all four channels
    // 预取 mip 2(约 1/4 分辨率):只为读一个"粗覆盖率"判断本像素是否真的在墨的边缘,
    // 避免对整块平坦墨面都跑 12 次采样的 B 样条(中间平坦区梯度为零,重建是浪费)
    vec4 l2 = textureLod(uPaint, vPaintUv, 2.0);
    float seam2 = l2.r / max(l2.a, 1e-3);
    // 走 B 样条重建的三个条件:够近 且 粗覆盖率显示这里有墨 且 真在边缘(A 不满 / 队伍占比在中间区)
    if (near > 0.0 && l2.a > 0.002 && (l2.a < 0.998 || pnt.a < 0.998 || (seam2 > 0.006 && seam2 < 0.994))) {
      vec4 cX, cY;
      vec4 cub = paintCubic(vPaintUv, cX, cY);
      pnt = mix(pnt, cub, near);
      gX = cX * near; gY = cY * near;
    }
    gInkNear = near;
    float amt = pnt.a;
    // 从覆盖率(0..1)到"墨占比例" gInk:用 fwidth 自适应过渡宽度做像素级抗锯齿,
    // 边缘处按屏幕分辨率平滑过渡,远看是一条干净的墨边
    float fw = fwidth(amt);
    float w = clamp(fw * 0.8, 0.008, 0.25);
    gInk = smoothstep(0.5 - w, 0.5 + w, amt);
    float ia = 1.0 / max(amt, 0.02);
    // 预乘还原:图集存的是 channel×A,要除以 A 才能拿到真实的队伍占比
    float tRaw = clamp(pnt.r * ia, 0.0, 1.0);
    // crisp, pixel-anti-aliased colour border between the teams (no muddy mixed-colour fringe)
    // 队伍边界:tRaw 过 0.5 处用自适应宽度 smoothstep 锐化 → 边界是清晰的"线",而不是两色泥在一起的过渡带
    float wT = clamp(fwidth(tRaw) * 0.75, 0.012, 0.2);
    float tm = smoothstep(0.5 - wT, 0.5 + wT, tRaw);
    float wet = clamp(pnt.g * ia, 0.0, 1.0);
    // fresh:新墨鲜亮度,wet 从 0.3→0.97 时平滑升起 —— 墨落地约 4 秒内保持"发亮"外观
    float fresh = smoothstep(0.3, 0.97, wet);               // visibly wet for ≈ 4 s after landing
    gFresh = fresh * gInk;
    // 单滴色调:同队不同滴之间的深浅差异(每滴一个随机种子写在 B 通道)
    float tone = clamp(pnt.b * ia, 0.0, 1.0);
    // 墙面判断:世界法线接近水平(y 分量 <0.5)→ 墙面。墙面墨更薄、贴附,地面墨厚、积聚
    bool wallF = abs(vWNorm.y) < 0.5;
    // 本面的世界切线架:Tf=U 方向(沿面),Bf=法线×Tf。太阳方向会投到这个平面里,
    // 用于判断墨唇的哪一侧背光(接触阴影偏移方向)
    vec3 Tf = normalize(vFaceTan - vWNorm * dot(vFaceTan, vWNorm)), Bf = cross(vWNorm, Tf);
    // world-space direction toward the sun (the scene's only directional light)
#if NUM_DIR_LIGHTS > 0
    vec3 sunW = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
#else
    vec3 sunW = normalize(vec3(-0.41, 0.83, -0.38));
#endif
    vec2 sunF = vec2(dot(sunW, Tf), dot(sunW, Bf));        // sun direction in the face's (u, v) plane
    // thickness profile: 0 at the edge → 1 on the flat top (≈2–3 texels in). Floors pool (tall rounded lip, taller
    // while fresh); walls hold a thinner clinging film that lets the surface relief show through a little.
    // 【墨面高度剖面】真实的湿墨在地面上不是平的——表面张力让边缘隆起成"弯月唇",中心是平坦液池。
    // 用覆盖率 A 当"到墨缘的径向距离"的代理:s 在边缘=0,深入约 2~3 纹素后=1。
    // hs 把 s 缓化成"隆起形状":1-(1-s)²,边缘处斜率最大(唇最翘)。
    float s = clamp((amt - 0.5) * 1.7, 0.0, 1.0);
    float hs = 1.0 - (1.0 - s) * (1.0 - s);
    gInkS = hs;
    // 厚度:地面 1.0,墙面 0.6(墨更薄);新墨再 ×1.5(表面张力让湿唇更高,干燥后回落)
    float thick = (wallF ? 0.6 : 1.0) * (1.0 + 0.5 * fresh);
    // 墙面薄墨:地表浮雕要透出来多少。新墨时更不透(湿墨盖得严),干燥后更透
    gInkKeep = wallF ? 0.32 * (1.0 - 0.5 * fresh) : 0.0;
    // 弯月唇高度梯度:沿覆盖率下降最快的方向(向外)给高度场一个向下的坡度,
    // 法线扰动后唇的外侧会"翘起来接住光"——这就是湿墨边缘发亮的来源。
    // gradA 越陡(边缘越锐利)唇越高;(1-s) 让坡度集中在边缘带;×gInk 让无墨处不生效
    vec2 gradA = vec2(gX.a, gY.a);
    gInkD = gradA * 2.0 * (1.0 - s) * 1.7 * 1.9 * gInk * thick;
    // where the two teams' inks meet: the newer (wetter) ink rides over the older one on a rounded lip; two inks of
    // the same age meet in a soft crease between their rounded edges
    // 【两军交界】gT = 队伍占比梯度(预乘还原后)。长度 gTl 大 → 正在穿过两色交界;
    // 方向 sn = 朝向队伍 B 侧。
    vec2 gT = (vec2(gX.r, gY.r) - tRaw * gradA) * ia;       // d(team share) per texel
    float gTl = length(gT);
    float seam = 0.0, seamShadow = 0.0;
    if (gTl > 0.03 && amt > 0.6) {
      vec2 sn = gT / gTl;                                    // across the seam, toward team B
      // x = 到交界中线的有符号距离(以纹素为单位)。后面 e1/e2 两个高斯包络都按 x 衰减,
      // 让交界效果只出现在中线附近几纹素内
      float x = (tRaw - 0.5) / gTl;                          // signed distance to the midline, texels
      float e1 = exp(-x * x / 1.7), e2 = exp(-x * x / 0.8);
      // seam:交界出现强度(宽高斯 e1);gTl 越大越完整,near 保证远处不闪
      seam = e1 * smoothstep(0.03, 0.14, gTl) * near;
      // 谁更新?gW = 湿度梯度沿 sn 方向的分量 → 正值 = B 侧是更湿(更新)的墨
      vec2 gW = (vec2(gX.g, gY.g) - wet * gradA) * ia;
      float newer = clamp(dot(gW, sn) / gTl * 1.6, -1.0, 1.0);   // +1: team B's side is the newer, wetter ink
      // 交界高度扰动 dh:第一项(×newer)让更新一侧隆起骑跨旧墨;第二项(e2 窄高斯)是两缘相对成折缝,
      // |newer| 小时折缝更深。加到 gInkD 上,后面统一做高度→法线
      float dh = newer * 2.4 * e1 / 2.3 + 0.9 * 2.0 * x / 0.8 * e2 * (1.0 - 0.6 * abs(newer));
      gInkD += sn * dh * seam * gInk * thick;
      // the lower (older) side sits in the lip's shadow; the crease itself is a thin dark line
      // 交界阴影:较旧(较低)一侧被唇挡住光 → 暗;折缝本身是一条细暗线(窄高斯 e2)
      seamShadow = seam * (0.45 * max(0.0, -x * newer) * e1 + 0.55 * e2 * (1.0 - 0.7 * abs(newer)));
    }
    // 队伍混色 + 单滴色调:同队墨也有 ±13% 的深浅变化,画面不"平涂"
    vec3 team = mix(uTeamA, uTeamB, tm);
    vec3 inkCol = team * (0.93 + 0.13 * tone);
    // translucent thin lip reads lighter and a touch more saturated; the thick body a little deeper
    // 半透明薄唇(边缘)更亮更饱和——像真实的湿颜料边缘透光;厚墨体本身稍压暗,显"沉"
    float lip = (1.0 - hs) * near;
    inkCol = mix(inkCol, inkCol * 1.16 + team * 0.05, lip * 0.35);
    inkCol *= 1.0 - 0.05 * hs;
    // 交界折缝/阴影让交界线颜色压暗——立体感来源之一
    inkCol *= 1.0 - 0.3 * seamShadow * gInk;
    // fresh ink: a touch brighter + richer for the first moments, settling to its dry colour
    // 新墨阶段再提亮 7%(×fresh² 让效果集中在最湿的头几秒),随后自然回落到干色
    inkCol *= 1.0 + 0.07 * fresh * fresh;
    gInkCol = inkCol;
    // halo:墨边缘之外、覆盖率刚起步的一圈——落地接触阴影 / 墙面潮晕的作用区
    float halo = smoothstep(0.06, 0.5, amt) * (1.0 - gInk) * near;
    if (!wallF) {
      // ink sits ON the ground: the lip throws a soft contact shadow, heavier on the side away from the sun
      // 【地面】弯月唇会挡住太阳投下接触阴影:阴影方向 = 覆盖率梯度反方向(朝外),
      // 再按太阳方位加权——背光侧阴影更重(away>1),向阳侧更轻
      vec2 outN = -gradA / max(length(gradA), 1e-4);
      float away = clamp(0.55 - 0.9 * dot(outN, normalize(sunF + 1e-4)) * length(sunF), 0.25, 1.3);
      // 只对朝上的面生效( smoothstep(y) ),且只作用在地表 base 颜色上(不是墨本身)
      halo *= smoothstep(0.4, 0.85, vWNorm.y) * away;
      base *= mix(vec3(1.0), team * 0.45 + 0.3, halo * 0.5);
    } else {
      // walls: the edge soaks into the surface — a damp, slightly tinted halo instead of a shadow
      // 【墙面】墨"洇"进墙面材质:不是阴影,是一圈颜色微深、微带队伍色的潮晕
      base *= mix(vec3(1.0), team * 0.35 + 0.5, halo * 0.55);
    }
    // 最后一步:按 gInk 把地表颜色和墨色混合——整块墨面在颜色层面到此完成,
    // 后续段落(粗糙度/法线/光照)继续叠加质感
    base = mix(base, gInkCol, gInk);
  }`;

// roughness of the pigment layer under the coat
// 【INK_ROUGH:颜料层粗糙度】上面会再叠清漆高光(INK_LIGHTS),这一层是底下的颜料本身:
// 干墨 0.26(哑光)→ 新墨 0.14(绸缎感);按 gInk 与地表原粗糙度混合
export const INK_ROUGH = /* glsl */`
roughnessFactor = mix(gBaseRough, mix(0.26, 0.14, gFresh), gInk);`;

// ---------------------------------------------------------------------------------------------------- normal
// Inside levelMaterial's normal block before the face frame is built: adds the gel micro-surface to \`slope\`.
// 【INK_GEL:凝胶微表面】墨不是镜面的——有细小起伏,让高光碎成一片"湿亮"。
// 向 slope(面内二维斜率)累加噪声梯度;最终和弯月唇/涟漪一起经 perturbInk 转成法线。
export const INK_GEL = /* glsl */`
  if (gInk > 0.01) {
    // gel micro-surface: soft swells so reflections break into wet highlights. Mip-filtered (fades to flat by itself
    // at distance). Walls stretch it vertically. Fresh ink is smoother (surface tension) and sways very gently while it
    // settles; dry ink shows a little more texture.
    // gp:凝胶噪声的采样坐标。墙面把噪声纵向压扁 0.42(墨顺墙往下淌的拉丝感),
    // 地面用 0.75/0.75 近似各向同性;加 uTime 项让噪声极慢漂移,新墨阶段再叠一个微小正弦晃动——
    // 像湿漆表面张力还没稳定下来的"呼吸"
    vec2 gp = vFaceUv * (abs(vWNorm.y) < 0.5 ? vec2(0.9, 0.42) : vec2(0.75));
    float fr2 = gFresh * gFresh;
    gp += vec2(uTime * 0.011, -uTime * 0.007) + fr2 * 0.022 * vec2(sin(uTime * 2.3), cos(uTime * 1.9));
#ifdef USE_TEXLIB
    // 有纹理库:直接采一张 3D 噪声法线贴图的切片(uGel),用 textureGrad 让远处自动 mip 平滑
    if (uGel >= 0.0) {
      vec2 gx = dFdx(gp), gy = dFdy(gp);
      vec3 gn = textureGrad(tNormal, vec3(gp, uGel), gx, gy).xyz * 2.0 - 1.0;
      // 噪声梯度 → 斜率;gFresh 越大乘子越小(0.95→0.45,新墨更平——表面张力),
      // ×gInkS 让边缘唇带也带一点凝胶感
      slope += -gn.xy / max(gn.z, 0.3) * (0.95 - 0.5 * gFresh) * gInk * gInkS;
    }
#else
    // 无纹理库的降级路径:用两个 vnoise 做中心差分近似梯度(粗一些,但零资源依赖)
    {
      const float e = 0.06;
      vec2 q = gp * 2.2;
      float hx = vnoise(q + vec2(e, 0.0)) - vnoise(q - vec2(e, 0.0));
      float hy = vnoise(q + vec2(0.0, e)) - vnoise(q - vec2(0.0, e));
      // gf:近景才启用,远处衰减为平面(没有 textureGrad 的 mip 平滑,只能手动按 fwidth 淡出)
      float gf = 1.0 - smoothstep(0.03, 0.12, length(fwidth(vWPos)));
      slope += vec2(hx, hy) / (2.0 * e) * 0.035 * gf * gInk;
    }
#endif
  }`;

// After the swim wakes (T, Bt = the face's world tangent frame): expanding ripples in the ink surface.
// 【INK_SLOPE:涟漪】paint.js 的 paint.ripple() 会往 uniform 涟漪表里登记冲击(落地/脚步/下潜),
// 这里逐像素循环 24 条,把还活着的涟漪合成一个高度场梯度,累加到 slope。
// 数学上是一个"波包":高斯包络 × 正弦载波,波前以 Qr.z(米/秒)外扩,振幅随距离和寿命衰减。
export const INK_SLOPE = /* glsl */`
  if (gInk > 0.01) {
    // ripples: a wave packet runs out from every impact / footstep / dive, thinning as it spreads; the crests catch
    // the light (glossier). Height field → analytic gradient in the face plane.
    vec3 rS = vec3(0.0); float rG = 0.0;
    for (int i = 0; i < ${INK_RIPPLES}; i++) {
      vec4 Pr = uRip[i], Qr = uRipP[i];
      // age 超出 [0, 寿命) → 涟漪已死,跳过(出生时刻存在 w 里,时钟是 uInkClock)
      float age = uInkClock - Pr.w;
      if (age <= 0.0 || age >= Qr.w) continue;
      vec3 D = vWPos - Pr.xyz;
      // 只影响涟漪所在的面:本像素到涟漪中心连线上的法向分量超 0.4m → 是别的面,跳过
      float off = dot(D, vWNorm);
      if (abs(off) > 0.4) continue;                          // another surface
      D -= vWNorm * off;
      // x = 到波前的有符号距离(米);只处理波前附近 ±几个波长的环形带,其余跳过
      float front = Qr.z * age;
      float d = length(D);
      float x = d - front;
      float sg = Qr.y * 0.8;
      if (x > sg * 3.0 || x < -Qr.y * 4.0) continue;
      // 高斯包络 × 余弦载波的高度场 h(x) = amp·env·cos(kx);
      // dh 是它的解析导数(链式法则:包络导数×cos + 包络×cos 导数)——直接得到坡度,无需差分
      float env = exp(-x * x / (sg * sg));
      float k = 6.2831853 / Qr.y;
      // fade:寿命内按 (1-t/T)² 淡出;开头 0.03s 用 smoothstep 淡入(出生时不 pop)
      float fade = 1.0 - age / Qr.w;
      fade *= fade * smoothstep(0.0, 0.03, age);
      // 振幅随传播距离衰减(1/(1+1.6d)),模拟能量扩散
      float amp = Qr.x * fade / (1.0 + d * 1.6);
      float dh = amp * env * (-2.0 * x / (sg * sg) * cos(k * x) - k * sin(k * x));
      // 径向坡度 → 世界向量;rG 记录"波峰总亮度"(给 gWake,波峰处更亮)
      rS += D * (dh / max(d, 1e-4));
      rG += env * fade * min(Qr.x * 90.0, 1.0);
    }
    // 多条涟漪叠加后限幅(0.75):防大振幅涟漪交汇处斜率爆炸产生噪点
    float rl = length(rS);
    if (rl > 0.75) rS *= 0.75 / rl;
    // 近景才显示涟漪;远处 fwidth 大,直接淡出(没有对应的 mip 数据,硬画会闪)
    float rFar = 1.0 - smoothstep(0.05, 0.18, length(fwidth(vWPos)));
    // 世界向量 → 面切线架的二维斜率,累加给 slope(和弯月唇/凝胶汇合)
    slope += vec2(dot(rS, T), dot(rS, Bt)) * gInk * rFar;
    // gWake:波峰亮度因子,通知后续清漆段"这里有动态高光"
    gWake = max(gWake, clamp(rG * 0.5, 0.0, 1.0) * gInk * rFar);
  }`;

// ---------------------------------------------------------------------------------------------------- lighting
// a little self-light keeps ink loud in shadow and at dusk (subsurface-ish glow, stronger in the thick body)
// 【INK_EMISSIVE:自发光】直接往 totalEmissiveRadiance 加墨色:
// 阴影里的墨不会变成黑块(像颜料微微透光),厚墨体(×gInkS)发光更强;
// uInkGlow 是 levelMaterial 暴露的强度旋钮。量很小(仍受 tone mapping 约束),只是"保底亮度"。
export const INK_EMISSIVE = /* glsl */`
totalEmissiveRadiance += gInkCol * gInk * uInkGlow * (0.75 + 0.35 * gInkS);`;

// after lights_physical_fragment: the wet coat
// 【INK_LIGHTS:湿清漆层】MeshPhysicalMaterial 的 clearcoat(车漆式透明高光层)在这里被"借用"为湿墨层:
//   有墨处清漆强度 = gInk;清漆粗糙度按 湿/新/涟漪 状态在 0.022~0.06 之间;
//   颜料层本身的 specular 被压低 70%(高光交给清漆,颜料只留柔和光泽,色相保持纯净);
//   关键是压低掠射 Fresnel(clearcoatF90 0.3):低视角相机看墨面不会被天空洗白,队伍色还在。
export const INK_LIGHTS = /* glsl */`
{
  // glossy wet coat on ink (sharp while fresh, satin once dry); roughness widened where the ink normal varies faster
  // than the pixel grid (no sparkle)
  // kern:屏幕空间曲率补偿——某像素处法线变化比像素网格还快时(涟漪尖峰/弯月唇棱线),
  // 把粗糙度抬高,防止亚像素高光闪烁成白色噪点(sparkle)
  vec3 cdu = dFdx(normal), cdv = dFdy(normal);
  float kern = min(0.3 * (dot(cdu, cdu) + dot(cdv, cdv)), 0.18);
  // 清漆基础粗糙度:干 0.06 → 新 0.028(更锐);有涟漪时 0.022(波峰反光更利)
  float cr = mix(mix(0.06, 0.028, gFresh), 0.022, gWake);
  material.clearcoat = gInk;
  // 四次根式混合:小 kern 几乎不影响,大 kern 平滑抬升(soft maximum 的味道)
  material.clearcoatRoughness = min(sqrt(sqrt(cr * cr * cr * cr + kern)), 1.0);
  material.roughness = mix(material.roughness, min(sqrt(sqrt(pow(material.roughness, 4.0) + kern)), 1.0), gInk);
  // the coat carries the gloss; the pigment layer underneath only adds a soft sheen (keeps the hue pure)
  // 颜料层高光压低:两层都乘 (1-0.7·gInk) —— 高光主要由清漆贡献,颜料色相不被白色高光稀释
  material.specularColor *= 1.0 - 0.7 * gInk;
  material.specularColorBlended *= 1.0 - 0.7 * gInk;
  material.specularF90 = mix(material.specularF90, 0.35, gInk);
  // flatter Fresnel on the coat: a little more reflection head-on, far less at grazing angles, so the team colour
  // survives a low gameplay camera instead of washing out to sky-white
  // 压平清漆 Fresnel:正视 F0 微升(0.04→0.055,湿亮),掠射 F90 从 1.0 压到 0.3 —
  // 第三人称低视角扫过墨面时,看到的是队伍色 + 柔和高光,而不是一片天空反光的白色
  material.clearcoatF0 = vec3(mix(0.04, 0.055 + 0.015 * gFresh, gInk));
  material.clearcoatF90 = mix(1.0, 0.3, gInk);
}`;

// after lights_fragment_maps: ambient / reflection treatment
// 【INK_LIGHT_MAPS:环境光/反射修正】两个目的:
//   ① 阴影区的环境光(irradiance)去色 70% 再乘回去 —— 天空环境光偏蓝,直接乘会让黄墨发绿、暗部发灰;
//      换成"亮度等价的中性灰"照射,色相由墨自己决定。
//   ② 清漆反射(clearcoatRadiance):环境湿反射先推向中性(天空蓝不会把黄墨照成橄榄绿),
//      再按 30% 混回"墨色本身的染色"(厚彩胶的质感),掠射视角保留队伍色相。
export const INK_LIGHT_MAPS = /* glsl */`
// ink keeps its hue in shade: the blue sky's ambient is applied hue-neutral to the pigment
if (gInk > 0.0) {
  // LW:Rec.709 亮度权重。dot(x, LW) = 亮度标量 —— 把彩色光"去色"成同亮度的灰
  const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  irradiance = mix(irradiance, vec3(dot(irradiance, LW)), 0.7 * gInk);
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  iblIrradiance = mix(iblIrradiance, vec3(dot(iblIrradiance, LW)), 0.7 * gInk);
  #endif
}
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular ) && defined( USE_CLEARCOAT )
  // stylised wet reflections: pushed toward a neutral sheen so a blue sky never turns yellow ink olive, then tinted a
  // little by the pigment underneath (a thick coloured gel) so a grazing view keeps the team hue
  {
    float cl = dot(clearcoatRadiance, vec3(0.2126, 0.7152, 0.0722));
    // tint = 墨色与其自身亮度的比值 = "每单位亮度贡献多少色相"。乘以亮度 cl 即得到"染过色的反射";
    // min(…, 2.5) 封顶,防止深色墨把反射染得过爆
    vec3 tint = gInkCol / max(dot(gInkCol, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    clearcoatRadiance = mix(clearcoatRadiance, mix(vec3(cl), cl * min(tint, vec3(2.5)), 0.3), 0.6 * gInk);
    // 有墨处整体提亮反射:新墨 +0.25~0.55,涟漪处再 +0.7(波峰闪光的来源)
    clearcoatRadiance *= 1.0 + gInk * (0.25 + 0.3 * gFresh) + gWake * 0.7;
  }
#endif`;

// after lights_fragment_end: pigment in shade glows through its own body — more fill, and a richer (never browner) hue
// 【INK_SHADE:暗部补偿】墨在阴影里要"更浓而不是更黑":
//   shade 因子量出本像素处于多深的阴影;暗部间接光提亮 60%(×(1+0.6·shade)),
//   同时把颜色替换为 rich —— 墨色自乘归一化后的"同色加深版"(亮度不变、色度更纯),
//   保证暗部墨不发褐、不发脏 —— 这是 Splatoon 式美术的关键手感。
export const INK_SHADE = /* glsl */`
if (gInk > 0.0) {
  const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  // 直射/间接光的亮度;shade = 直射占比越低(阴影越深)越接近 1
  float dL = dot(reflectedLight.directDiffuse, LW), iL = dot(reflectedLight.indirectDiffuse, LW);
  float shade = 1.0 - smoothstep(0.1, 0.6, dL / max(dL + iL, 1e-5));
  vec3 c2 = gInkCol * gInkCol;
  // rich:c² 按亮度归一 → "同亮度、色度加倍"的墨;数学上让色度向量相对灰轴拉长
  vec3 rich = c2 * (dot(gInkCol, LW) / max(dot(c2, LW), 1e-4));      // same brightness, deeper chroma
  // 间接光先换成 rich(浓度感),再整体提亮;按 0.5·shade 混合 —— 阴影越深替换越多
  vec3 id = reflectedLight.indirectDiffuse;
  vec3 idRich = rich * (iL / max(dot(gInkCol, LW), 1e-4));
  id = mix(id, idRich, 0.5 * shade) * (1.0 + 0.6 * shade);
  // 最后按 gInk 与原始值混合(没墨的地方不受影响)
  reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, id, gInk);
}`;
