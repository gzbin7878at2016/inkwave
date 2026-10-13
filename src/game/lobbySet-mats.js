// ============================================================================
// 【中文导读】LobbySet 材质库 —— 大厅场景"表面/地面/灯光"的全部材质与共用的 uniform 块
// ----------------------------------------------------------------------------
// 【模块定位】属于 lobbySet 四件套的【材质】一环,由 lobbySet.js 的 LobbySet 构造时调用(见其顶部
//   import 与 _build())。它把 geo 产出的、带 aSurf/aDec/aLit/aNeon 自定义顶点属性的几何,与 texlib
//   的 PBR 层、Canvas 图集、环境贴图组装成 Three 的 MeshStandardMaterial / ShaderMaterial。
//   生命周期跟随 LobbySet:构造期建材质 → 运行期只写 uniform(换队色、时钟、雾),从不重绘。
//
// 【四件套分工与调用顺序】
//   lobbySet.js     【装配/总控】class LobbySet:持有 root 场景图、ALLEY 布局、镜头/站位/入场路径、灯光、
//                   湿地面平面反射、update() 循环与 stats()。构造顺序:makeUniforms()(材质) →
//                   createDecalAtlas/createLitAtlas/createSkyline/createGroundMask(贴图)→ _bakeEnv()
//                   → _build()(用 geo 的 SetBuilder 攒几何 + 本文件材质建 Mesh)→ _lights() →
//                   _reflection() → setTeamColors/setQuality。
//   lobbySet-geo.js 【几何】class SetBuilder(分桶合并)+ 原语(box/rbox/cyl/tube…)+ 程序化道具工厂
//                   (fireEscape/drainPipe/windowUnit/acUnit/shutter/dumpster/vending/…),产出带
//                   aSurf/aDec/aLit/aNeon 的几何 —— "形状/位置/顶点色"的来源。
//   lobbySet-mats.js【本文件·材质】makeUniforms() 与各材质(surfaceMaterial/groundMaterial/litMaterial/
//                   neonMaterial/haloMaterial/glowMaterial/emitMaterial/skyMaterial/skylineMaterial/
//                   steamMaterial/hazeMaterial)+ SLOT 槽位表;消费 geo 的顶点属性,全部共用同一个 U
//                   uniform 块,故换队色/时钟/雾都是一次写入。
//   lobbySet-tex.js 【贴图】Canvas 图集与霓虹字形(createDecalAtlas/createLitAtlas/createGroundMask/
//                   createSkyline/neonText/neonSquid/neonHalo/DECAL/LIT/GROUND_RECT/loadSetFonts)。
//   顺序小结:lobbySet.js 先向 mats 要 uniforms、向 tex 要纹理,再用 geo 的 SetBuilder 攒几何、用 mats
//   的材质建 Mesh,最后接线灯光与反射。
//
// 【核心机制】
//   1) 单一 uniform 块 U:所有材质共享 uTime / uTeamA / uTeamB 及一组雾参数(见 makeUniforms)——换队色
//      只是两次 Color 写、时钟只是 uTime.value 推进、雾是纯参数;所有材质引用同一批对象(非拷贝),故同帧生效。
//   2) 两匹"主力马"各一次 draw 扛下几乎全部静态几何:
//      surface —— 每一面墙/道具/框架/五金:按顶点槽位(见 SLOT)选 texlib PBR 层(brick/stucco/steel/
//        hazard…),叠加世界空间污渍、下淌水痕、墙脚溅水带、接触变暗,以及一张通道编码的贴花图集
//        (涂鸦/海报/标签/泼溅)——贴花随队色重着色,但从不重绘。
//      ground  —— 湿沥青:texlib asphalt、绘制的水洼/墨迹遮罩、平面反射(湿膜上竖向拉丝、积水处锐利)、雨滴涟漪。
//   3) 通道编码(见 lobbySet-tex.js):队色不烘进贴图,而是 R=队A G=队B B=白 A=覆盖;着色器里
//      paint = uTeamA*R + uTeamB*G + white*B 现算,故换队色零重绘。
//   4) 自带深度雾:showcase 拥有 scene.fog,本套件不能改它,于是在每个材质里链入自己的深度雾(hazeify):
//      内建材质走 onBeforeCompile 追加,自定义 ShaderMaterial 直接内联 HAZE_F_PARS。
//
// 【关键约定】
//   - 单位:米;坐标 Y 向上;巷子沿 -Z 伸向街口。
//   - 顶点属性由 lobbySet-geo.js 写入:aSurf=(slot, grime, roughScale, metal)、aDec=(u, v, mode)、
//     aLit=自发光倍数(rgb)、aNeon=(team, buzz, sign)。
//   - additive 材质(halo/glow)必须 alpha-preserving:showcase 按 alpha 反预乘(un-premultiply)整个舞台,
//     相加的光绝不能把 alpha 抬过 1 —— 见 ADD 常量(blendSrcAlpha = ZeroFactor)。
//   - 性能:全部为固定函数 + 少量 GLSL 注入;材质数量固定,切质量不触发重编译(见 customProgramCacheKey)。
//
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md、docs/ASSETS.zh-CN.md;兄弟文件 ./lobbySet.js(装配)、
//   ./lobbySet-geo.js(几何)、./lobbySet-tex.js(贴图)、../world/texlib.js(PBR 库)。
// ============================================================================
// Lobby set materials. All of them share one uniform block (U) so a team change, the ambient clock and the haze are
// single writes. Two workhorses carry almost all static geometry in one draw each:
//   surface — every wall, prop, frame and fixture: texlib PBR layer per vertex (brick / stucco / steel / hazard ...),
//             world-space grime, damp streaks, a wet splash band at the base of walls, contact darkening, and a
//             channel-encoded decal atlas (graffiti, posters, tags, splats) that recolours with the teams
//   ground  — the wet asphalt: texlib asphalt, painted puddle / ink mask, a planar reflection (with vertical streaks
//             on the damp film, sharp in standing water), drip ripples
// plus small ShaderMaterials for neon tubes, additive halos (alpha-preserving: the showcase un-premultiplies the stage
// by its alpha, so additive light must never raise alpha above 1), billboard glows, the sky, skyline cards and steam.
// Every material gets the set's own depth haze (the showcase owns scene.fog, so the set cannot use it).
import * as THREE from 'three';
import { TEXLIB_GLSL } from '../world/texlib.js';

// 【uniform 总表】LobbySet 全局共享的一组 uniform;所有材质都引用同一批对象(不是拷贝),所以:
//   换队色 = 写 uTeamA/uTeamB 的 value(Color),下一帧所有材质同时变色;
//   时钟   = 只推进 uTime.value;
//   雾     = uHzA/uHzB/uHzK/uHzStart 纯参数(近雾色/远雾色/雾打包参数/起始距离)。
// uHzK 分量依次为 (密度 /m, 高度衰减 /m, 街口暖雾起止 -z)。返回的可变对象由 LobbySet 持有并长期复用。
export function makeUniforms() {
  return {
    uTime: { value: 0 },
    uTeamA: { value: new THREE.Color('#ff8a14') }, uTeamB: { value: new THREE.Color('#2f5bff') },
    uHzA: { value: new THREE.Color(0.012, 0.018, 0.034) },    // haze near the camera: cool blue-hour air
    uHzB: { value: new THREE.Color(0.2, 0.13, 0.09) },        // haze toward the street mouth: lit by the sodium lamps
    uHzK: { value: new THREE.Vector4(0.013, 0.14, 10, 36) },  // density /m, height falloff /m, mouth-warm start/end (-z)
    uHzStart: { value: 6.0 },
  };
}

// 【GLSL 片段区】本文件多处内联复用的着色器小块。HAZE_* 是自带深度雾(showcase 占用了 scene.fog);
// NOISE 是整数哈希 + 值噪声 + 4 阶 fbm,供各材质做程序化细节。着色器内此前缀统一用 ls*(lobby set)。
// ------------------------------------------------------------------------------------------------ GLSL snippets
const HAZE_V_PARS = 'varying vec3 vLsW;\n';
const HAZE_V = `
  { vec4 lsw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    lsw = instanceMatrix * lsw;
  #endif
    vLsW = (modelMatrix * lsw).xyz; }`;
// 【雾的数学】lsHazeAmt:沿视线距离减 uHzStart 后按密度指数累积,并乘随高度衰减的权重(近地更浓——
//   地面积水/车灯把雾压在地面);lsHazeCol:近处冷蓝(uHzA)向街口方向暖色(uHzB)过渡,smoothstep 用
//   -w.z 选暖端(街口在 -Z),再按高度加一次权。uHzK = (密度, 高度衰减, 暖雾起, 暖雾止)。
const HAZE_F_PARS = /* glsl */`
varying vec3 vLsW;
uniform vec3 uHzA; uniform vec3 uHzB; uniform vec4 uHzK; uniform float uHzStart;
float lsHazeAmt(vec3 w) {
  float d = max(distance(w, cameraPosition) - uHzStart, 0.0);
  float h = exp(-max(w.y, 0.0) * uHzK.y);
  return 1.0 - exp(-d * uHzK.x * (0.3 + 0.7 * h));
}
vec3 lsHazeCol(vec3 w) { return mix(uHzA, uHzB, smoothstep(uHzK.z, uHzK.w, -w.z) * (0.55 + 0.45 * exp(-max(w.y, 0.0) * 0.08))); }
`;
// 【噪声】lsH:整数格点哈希(廉价、无纹理);lsN:以 smoothstep 插值的值噪声;lsF:4 阶 fbm,每阶用
//   同一个魔方阵旋转 + 平移以打散重复,末尾 /0.9375 把幅值和归一化到约 [0,1)。
const NOISE = /* glsl */`
float lsH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float lsN(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lsH(i), lsH(i + vec2(1, 0)), u.x), mix(lsH(i + vec2(0, 1)), lsH(i + vec2(1, 1)), u.x), u.y); }
float lsF(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * lsN(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.1; a *= 0.5; } return s / 0.9375; }
`;

// 【把雾接进内建材质】从材质的 onBeforeCompile 调用:顶点段在 project_vertex 后记下世界坐标 vLsW
//   (注意 instancing 要先乘 instanceMatrix,否则实例化几何的雾位置全错);片元段在 tonemapping 前
//   混入雾色。additive=true 时只做衰减(乘 1-雾量),绝不混色——否则相加光会被雾染黑,也会破坏
//   alpha-preserving 约定(见文件头)。
// Chain the haze into a built-in material's shader (call from onBeforeCompile). additive: only attenuate.
function hazeify(shader, U, additive = false) {
  Object.assign(shader.uniforms, { uHzA: U.uHzA, uHzB: U.uHzB, uHzK: U.uHzK, uHzStart: U.uHzStart });
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + HAZE_V_PARS)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + HAZE_V);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + HAZE_F_PARS)
    .replace('#include <tonemapping_fragment>', (additive ? 'gl_FragColor.rgb *= 1.0 - lsHazeAmt(vLsW);\n'
      : 'gl_FragColor.rgb = mix(gl_FragColor.rgb, lsHazeCol(vLsW), lsHazeAmt(vLsW));\n') + '#include <tonemapping_fragment>');
}
// 【给任意材质加雾的包装】保留原有 onBeforeCompile 再叠加 hazeify(故可重复包);customProgramCacheKey
//   把"是否 additive + 调用方自定义 key(mat.userData.key)"编进缓存键,避免不同注入的材质共用同一 program。
export function hazeMaterial(mat, U, additive = false) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => { prev?.call(mat, s, r); hazeify(s, U, additive); };
  mat.customProgramCacheKey = () => 'lsHaze' + (additive ? 1 : 0) + (mat.userData.key || '');
  return mat;
}

// ================================ surface(墙体/道具主力材质)
// 顶点属性 aSurf 把"用哪层 PBR + 脏污量 + 粗糙/金属缩放"塞进一个 vec4,于是任意表面能在一次 draw 内混合。
// ------------------------------------------------------------------------------------------------ surface
// Slots (aSurf.x) → texlib layer. tint modes: -1 no texture (plain), 0 own colours, 1 albedo x vertex colour, 2 mask.
// 【SLOT 槽位表】aSurf.x 的整数 → 语义槽位。geo 侧只写槽位号(如 S(SLOT.brick, …)),材质侧用它索引
//   下面的两个数组。槽位号是 geo↔mats 的契约,改动必须两边同步。
//   plain=0 无纹理(纯顶点色);其余对应 texlib 的 PBR 层。消费方:lobbySet.js 的 _build()(写 aSurf)。
export const SLOT = { plain: 0, brick: 1, render: 2, concrete: 3, metalpanel: 4, corrugated: 5, hazard: 6, treads: 7, planks: 8, grate: 9, rubber: 10, asphalt: 11 };
// 【槽位 → texlib 层名】index 即槽位号。plain(0) 也占一格(此处映射到 concrete,但着色时因 tint 模式 -1 会被跳过)。
const SLOT_LAYER = ['concrete', 'brick', 'render', 'concrete', 'metalpanel', 'corrugated', 'hazard', 'treads', 'planks', 'grate', 'rubber', 'asphalt'];
// 【槽位 → 法线强度】每槽法线贴图的扰动强度:硬面(砖/板)较强、橡胶等弱;0 表示不平扰。
const SLOT_NSTR = [0, 1.0, 0.9, 0.8, 0.8, 1.0, 0.8, 0.9, 1.0, 0.7, 0.7, 0.9];

// 【surface 材质】本套件的绝对主力:一次 draw 承接几乎所有静态表面。基于 MeshStandardMaterial +
//   onBeforeCompile 注入:
//     · 按 aSurf.x 选 texlib 层采样(albedo/normal/orm),tint 模式(tt.x)决定颜色如何合成:
//       -1 纯顶点色 / 0 用层自身色 / 1 顶点色 × albedo / 2 遮罩(用 albedo.a 当遮罩);
//     · 世界空间做旧:污渍、从挑檐下淌的水痕、墙脚溅水带、墙地接触变暗;顶面更湿;
//     · 通道编码贴花:teamA*R + teamB*G + 白*B,带磨损 alpha,模式 3/4 为"只画贴花"的四边形(界外 discard);
//     · 入射法线用 texlibTangentFrame 建 TBN,再按槽位法线强度 gNS 做凹凸;
//     · 末尾 hazeify 接自带深度雾。envMap 提供低强度环境反射。
//   customProgramCacheKey 只区分有无 texlib(注入是静态的),避免同材质多 program。
export function surfaceMaterial(U, texlib, decalTex, envMap) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMap, envMapIntensity: 0.55 });
  const lib = texlib;
  mat.onBeforeCompile = (s) => {
    s.uniforms.tDecal = { value: decalTex };
    s.uniforms.uTeamA = U.uTeamA; s.uniforms.uTeamB = U.uTeamB; s.uniforms.uTime = U.uTime;
    if (lib) {
      const L = lib.layers, M = lib.meta;
      s.uniforms.tAlbedo = { value: lib.albedo }; s.uniforms.tNormal = { value: lib.normal }; s.uniforms.tOrm = { value: lib.orm };
      s.uniforms.uTL = { value: SLOT_LAYER.map((n) => new THREE.Vector4(L[n] ?? 0, 1 / ((M[n] && M[n].scale) || 2), (M[n] && M[n].mode) ?? 1, (M[n] && M[n].sym) ?? 7)) };
      // hazard is re-tinted (mode 1) so its stripes can be dirtied down by the vertex colour instead of shouting
      s.uniforms.uTLt = { value: SLOT_LAYER.map((n, i) => new THREE.Vector4(i === 0 ? -1 : i === SLOT.hazard ? 1 : M[n] && M[n].mask ? 2 : M[n] && M[n].tint === false ? 0 : 1, SLOT_NSTR[i], 0, 0)) };
      s.defines = { ...(s.defines || {}), LS_TEXLIB: 1 };
    }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aSurf; attribute vec3 aDec;
varying vec2 vUvM; varying vec4 vSurf; varying vec3 vDec; varying vec3 vWN;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vUvM = uv; vSurf = aSurf; vDec = aDec;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vWN = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vUvM; varying vec4 vSurf; varying vec3 vDec; varying vec3 vWN;
uniform sampler2D tDecal; uniform vec3 uTeamA; uniform vec3 uTeamB; uniform float uTime;
#ifdef LS_TEXLIB
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo; uniform sampler2DArray tNormal; uniform sampler2DArray tOrm;
uniform vec4 uTL[12]; uniform vec4 uTLt[12];
${TEXLIB_GLSL}
#endif
${NOISE}
vec3 gN = vec3(0.0, 0.0, 1.0); float gNS = 0.0; float gRough = 0.7; float gMetal = 0.0;`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
{
  // 【槽位解码】aSurf.x 以 float 存整数,+0.5 后取整即得槽位号(避免浮点截断误差)
  int slot = int(vSurf.x + 0.5);
  vec3 tint = diffuseColor.rgb, base = tint;
  vec3 wp = vLsW; vec3 wn = normalize(vWN);
  float vert = 1.0 - abs(wn.y);
  gRough = 0.7 * vSurf.z; gMetal = vSurf.w;
#ifdef LS_TEXLIB
  vec4 tl = uTL[slot]; vec4 tt = uTLt[slot];
  TexlibSample ts = texlibSample(tAlbedo, tNormal, tOrm, vUvM * tl.y, tl.x, int(tl.z), int(tl.w));
  // 【tint 模式】tt.x > 1.5:遮罩模式(albedo.a 当遮罩,叠加顶点色);> 0.5:顶点色 × albedo 染色;
  //   否则直接用层原色。orm.r 当作 AO 轻乘,orm.g 乘顶点粗糙缩放得最终粗糙度
  if (tt.x > -0.5) {
    base = tt.x > 1.5 ? ts.albedo.rgb + tint * ts.albedo.a * 1.25 : (tt.x > 0.5 ? tint * ts.albedo.rgb * 1.25 : ts.albedo.rgb);
    base *= mix(1.0, ts.orm.r, 0.8);
    gRough = clamp(ts.orm.g * vSurf.z, 0.03, 1.0);
    gN = ts.normal; gNS = tt.y;
    if (slot == 9 && ts.albedo.a < 0.5) discard;   // grate openings
    // 【grate 镂空】槽位 9(grater)用 albedo.a 当孔洞遮罩,挡住的地方直接 discard(排水篦子要能看穿)
  }
#else
  if (slot == 1) {   // procedural brick fallback: 0.23 x 0.075 m running bond
    vec2 b = vUvM / vec2(0.23, 0.075); b.x += 0.5 * floor(b.y);
    vec2 f = fract(b); float m = step(0.06, f.x) * step(0.1, f.y);
    base = tint * mix(0.55, 0.9 + 0.2 * lsH(floor(b)), m);
  } else base = tint * (0.9 + 0.2 * lsN(vUvM * 3.0));
#endif
  // 【世界空间做旧】全部用世界坐标采样噪声,故墙面不会重复同一片脏(不随 UV 平铺),四类叠加:
  //   blot 大块污渍 / streak 从挑檐往下的水痕(用垂直度 vert 加权,只在竖面出现) /
  //   band 墙脚溅水带(近地变暗)/ 以及竖向按高度渐亮(顶部更干净)。vert = 1-|wn.y| 保证只作用于立面。
  // weathering, all world-space (walls never repeat their dirt): blotchy grime, damp streaks running down from
  // ledges, a dark wet splash band at the foot of every wall, contact darkening where walls meet the ground
  float gr = vSurf.y;
  if (gr > 0.0) {
    float hc = dot(wp.xz, vec2(-wn.z, wn.x));
    float blot = lsF(vec2(hc, wp.y) * 0.45 + wp.xz * 0.05);
    float st = lsF(vec2(hc * 2.6, wp.y * 0.16 + 3.0 * lsN(vec2(hc * 0.4, 1.7))));
    float streak = smoothstep(0.5, 0.82, st) * vert;
    float band = (1.0 - smoothstep(0.04, 0.3 + 0.35 * lsN(vec2(hc * 1.7, 2.0)), wp.y)) * vert;
    float grime = gr * (0.6 * smoothstep(0.3, 0.8, blot) + 0.55 * streak);
    base *= 1.0 - 0.5 * grime;
    base *= mix(1.0, 0.5, band * min(gr * 1.5, 1.0));
    base *= mix(0.55, 1.0, smoothstep(0.0, 0.8, wp.y) * vert + (1.0 - vert));
    gRough = mix(gRough, gRough * 0.4, clamp(streak * 0.7 + band, 0.0, 1.0) * min(gr * 1.5, 1.0));
    // tops of things are rain-wet
    gRough *= mix(1.0, 0.55, smoothstep(0.6, 0.95, wn.y) * gr);
  }
  // 【贴花(通道编码)】R/G/B 分别是队A/队B/白的覆盖,a 是覆盖度;A 之外三通道全 0 即黑漆。
  //   奇偶模式(见下 mod)决定是否交换 R/G——同一张图集可给不同队镜像用。mode 3/4 是"只画贴花"的
  //   独立四边形,覆盖度低于阈值时 discard,以免四边形本体露底。磨损用两次噪声削减 a。
  // decals (channel encoded): teamA*R + teamB*G + white*B over black; mode 1/2 = paint on this surface,
  // 3/4 = decal-only quad (discards outside the paint), even modes swap the team channels
  if (vDec.z > 0.5) {
    vec4 d = texture2D(tDecal, vDec.xy);
    if (mod(vDec.z + 0.5, 2.0) < 1.0) d.rg = d.gr;
    float wear = smoothstep(0.45, 0.85, lsF(vUvM * 2.3 + 11.0)) * 0.75 + smoothstep(0.5, 0.9, lsN(vUvM * 14.0)) * 0.25;
    float cov = d.a * (1.0 - wear * 0.8);
    if (vDec.z > 2.5 && cov < 0.08) discard;
    vec3 paint = uTeamA * d.r * 0.85 + uTeamB * d.g * 0.85 + vec3(0.72) * d.b;
    base = mix(base, paint * mix(1.0, 0.8, gr), cov);
    gRough = mix(gRough, 0.5, cov * 0.7);
    gNS *= 1.0 - 0.5 * cov;
  }
  diffuseColor.rgb = base;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef LS_TEXLIB
  { int slot = int(vSurf.x + 0.5); mat3 tbn = texlibTangentFrame(-vViewPosition, normal, vUvM * uTL[slot].y);
    if (gNS > 0.0) normal = texlibPerturbNormal(gN, tbn, gNS); }
#endif`);
    hazeify(s, U);
  };
  mat.customProgramCacheKey = () => 'lsSurface' + (lib ? 1 : 0);
  return mat;
}

// ================================ ground(湿沥青)
// 一次 draw 画完整条湿地面:沥青 PBR、程序化修补块、绘制的水洼/墨迹遮罩、油污/胎痕、雨滴涟漪,
// 最后用世界坐标平面反射替换环境贴图的镜面,使霓虹/门/人物能"照"到地面上正确的位置。
// ------------------------------------------------------------------------------------------------ ground
// 【ground 材质】基于 MeshStandardMaterial:
//   · albedo/normal/rough 取自 texlib 的 asphalt 层,texlibMacro 做宏变化以打散平铺感;
//   · tMask 是 createGroundMask 画的 RGB 遮罩:R=队A墨 G=队B墨 B=积水深度(见 lobbySet-tex.js);
//   · 水洼 = 遮罩蓝通道 + 远处程序化水洼 + 沿巷子的排水沟;墨水是"带圆角边缘的液膜",用遮罩梯度
//     (换算成世界米)给法线加倾斜(见 gTilt),所以墨迹边缘有一圈反光;
//   · 雨滴涟漪:6 个槽位 uRip 循环复用,由 LobbySet.update() 写入,超过 2.2s 的自动跳过;
//   · 平面反射:在 lights_fragment_end 后用 uReflMat 投影到反射贴图,积水处锐利、湿膜处竖向拉丝模糊,
//     用 Fresnel 与几何视线点乘定强度;'low' 质量下 uReflOn=0,退回 envMap。
//   把反射相关 uniform 挂在 mat.userData.refl(供 _reflection() 接线),涟漪挂在 mat.userData.rip。
export function groundMaterial(U, texlib, maskTex, maskRect, envMap) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMap, envMapIntensity: 1 });
  const lib = texlib;
  const R = (mat.userData.refl = { tex: { value: null }, mat: { value: new THREE.Matrix4() }, on: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } });
  mat.userData.rip = { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { tMask: { value: maskTex }, uMaskR: { value: new THREE.Vector4(...maskRect) }, uTeamA: U.uTeamA, uTeamB: U.uTeamB, uTime: U.uTime,
      tRefl: R.tex, uReflMat: R.mat, uReflOn: R.on, uReflRes: R.res, uRip: mat.userData.rip });
    if (lib) {
      const n = 'asphalt', M = lib.meta[n] || { scale: 2, mode: 2, sym: 7 };
      Object.assign(s.uniforms, { tAlbedo: { value: lib.albedo }, tNormal: { value: lib.normal }, tOrm: { value: lib.orm },
        uAs: { value: new THREE.Vector4(lib.layers[n] ?? 0, 1 / M.scale, M.mode ?? 2, M.sym ?? 7) } });
      s.defines = { ...(s.defines || {}), LS_TEXLIB: 1 };
    }
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tMask; uniform vec4 uMaskR; uniform vec3 uTeamA; uniform vec3 uTeamB; uniform float uTime;
uniform sampler2D tRefl; uniform mat4 uReflMat; uniform float uReflOn; uniform vec2 uReflRes; uniform vec4 uRip[6];
#ifdef LS_TEXLIB
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo; uniform sampler2DArray tNormal; uniform sampler2DArray tOrm; uniform vec4 uAs;
${TEXLIB_GLSL}
#endif
${NOISE}
vec3 gN = vec3(0.0, 0.0, 1.0); float gRough = 0.8; float gWater = 0.0; float gDamp = 0.0; float gInk = 0.0; vec2 gRipN = vec2(0.0); vec2 gTilt = vec2(0.0);`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
{
  vec2 p = vLsW.xz;
  vec3 alb = vec3(0.075, 0.074, 0.078);
#ifdef LS_TEXLIB
  TexlibSample ts = texlibSample(tAlbedo, tNormal, tOrm, p * uAs.y, uAs.x, int(uAs.z), int(uAs.w));
  alb *= ts.albedo.rgb * 1.25 * texlibMacro(p);
  alb *= mix(1.0, ts.orm.r, 0.7);
  gRough = ts.orm.g; gN = ts.normal;
#else
  alb *= 0.8 + 0.4 * lsN(p * 9.0) * lsN(p * 2.3);
  gRough = 0.82;
#endif
  // 【修补块】按 2.7×3.9 m 的格点做哈希,选出少数格子画成更暗更光滑的新沥青矩形(step 决定边界留边)
  // patched repairs: darker, smoother rectangles of newer asphalt
  vec2 pc = floor(p / vec2(2.7, 3.9)); float patchSel = step(0.8, lsH(pc + 3.0));
  vec2 pf = fract(p / vec2(2.7, 3.9)); float inPatch = patchSel * step(0.12, pf.x) * step(pf.x, 0.88) * step(0.1, pf.y) * step(pf.y, 0.9);
  alb *= mix(1.0, 0.7, inPatch);
  // 【水洼合成】三类取并集(max):①绘制遮罩的蓝通道(舞台区手工水洼,按 GROUND_RECT 换算 UV);
  //   ②远处(远离观众)的程序化水洼;③沿巷子的排水沟(在 x≈-2.35 附近,朝 -Z 收)。gDamp 另算"整体潮湿度"。
  // painted mask (stage area) + procedural puddles further out + the drain gutter down the lane
  vec2 muv = vec2((p.x - uMaskR.x) / (uMaskR.z - uMaskR.x), 1.0 - (p.y - uMaskR.y) / (uMaskR.w - uMaskR.y));
  float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  vec3 m = texture2D(tMask, clamp(muv, 0.0, 1.0)).rgb * inside;
  float pn = lsF(p * vec2(0.42, 0.3) + 5.0);
  float far = smoothstep(-12.0, -16.0, p.y);
  float gut = (1.0 - smoothstep(0.1, 0.32, abs(p.x + 2.35))) * smoothstep(8.0, 5.0, p.y);
  float water = clamp(m.b * 1.6 - 0.12, 0.0, 1.0);
  water = max(water, smoothstep(0.6, 0.7, pn) * far);
  water = max(water, gut * (0.55 + 0.45 * smoothstep(0.35, 0.6, lsN(p * vec2(3.0, 0.4)))));
  gWater = water;
  gDamp = clamp(0.55 + 0.6 * (lsF(p * 0.55 + 1.3) - 0.5) + m.b * 0.6 + gut * 0.5, 0.0, 1.0);
  alb *= mix(1.0, 0.55, gDamp);
  alb *= mix(1.0, 0.35, water);
  // tyre-polished centre track (a touch smoother / darker where vans drive)
  float track = (1.0 - smoothstep(0.3, 0.9, abs(abs(p.x + 1.9) - 0.85))) * 0.25;
  alb *= 1.0 - track * 0.3;
  // oil stains
  float oil = smoothstep(0.72, 0.8, lsF(p * 0.9 + 17.0)) * 0.6;
  alb *= 1.0 - oil * 0.55;
  // ink splats: glossy, slightly raised, team coloured (normal flattened)
  float ia = clamp(m.r * 1.2, 0.0, 1.0), ib = clamp(m.g * 1.2, 0.0, 1.0);
  alb = mix(alb, uTeamA * 0.4, ia); alb = mix(alb, uTeamB * 0.4, ib);
  float ink = max(ia, ib);
  gInk = ink;
  // 【墨迹边缘】墨是"带圆角边缘的液膜":对遮罩做中心差分求梯度,换算成世界米,得坡度 gTilt,
  //   在法线阶段据此倾斜表面,于是墨迹边界有一圈反光(像真的积墨)。差分步长 0.025 与 UV 尺寸挂钩。
  // ink is a liquid film with a rounded rim: slope from the mask gradient (world metres) tilts the normal at its edges
  {
    vec2 du = vec2(0.025 / (uMaskR.z - uMaskR.x), 0.0), dv = vec2(0.0, 0.025 / (uMaskR.w - uMaskR.y));
    float hx = dot(texture2D(tMask, muv + du).rg - texture2D(tMask, muv - du).rg, vec2(1.0));
    float hz = -dot(texture2D(tMask, muv + dv).rg - texture2D(tMask, muv - dv).rg, vec2(1.0));
    gTilt = vec2(hx, hz) * 0.35 * inside;
  }
  gRough = mix(gRough, gRough * 0.42, gDamp);
  gRough = mix(gRough, 0.07, max(ink, track * 0.4));
  gRough = mix(gRough, 0.025, water);
  // 【雨滴涟漪】6 个槽位,每个是 (x, z, 起始时刻, 强度);以 uTime 求年龄,>2.2s 直接跳过;
  //   front=age*0.32 是扩散波前,env 用指数衰减 * 波前平滑 * 圆心渐出,cos 生成同心环;乘 water 只在积水处显现。
  // drip ripples in standing water
  for (int i = 0; i < 6; i++) {
    vec4 r = uRip[i]; float age = uTime - r.z;
    if (age < 0.0 || age > 2.2) continue;
    vec2 dv = p - r.xy; float d = length(dv) + 1e-4;
    float front = age * 0.32;
    float env = exp(-age * 1.8) * smoothstep(front + 0.05, front - 0.03, d) * smoothstep(0.0, 0.03, d) * r.w;
    gRipN += (dv / d) * cos((d - front) * 70.0) * env * 0.6;
  }
  gRipN *= water;
  gTilt += gRipN;
  diffuseColor.rgb = alb;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
#ifdef LS_TEXLIB
  mat3 tbn = texlibTangentFrame(-vViewPosition, normal, vLsW.xz * uAs.y);
  normal = texlibPerturbNormal(normalize(gN + vec3(gRipN, 0.0) * 0.0), tbn, 1.0 - gWater * 0.92);
#endif
  // ripples + ink rims tilt the surface (world xz slope → view normal)
  if (dot(gTilt, gTilt) > 1e-6) {
    vec3 rw = normalize(vec3(-gTilt.x, 1.0, -gTilt.y));
    normal = normalize(mix(normal, (viewMatrix * vec4(rw, 0.0)).xyz, clamp(max(gWater, gInk), 0.0, 1.0)));
  }
}`)
      .replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
  // 【平面反射】必须是最后的镜面贡献:把世界坐标经 uReflMat 投影到反射贴图 UV(再按法线加一点偏移),
  //   积水处用低 lod(锐利)、湿膜处高 lod(模糊),并在竖直方向叠两条偏移采样做"水面拉丝";
  //   用 Fresnel(F=0.02+0.98*(1-NdV)^5)加权,直接替换 indirectSpecular——因为 envMap 无法把霓虹/门/
  //   人物放到地面上的正确位置。k 融合积水/潮湿/墨。
  // planar reflection: sharp in standing water, streaked + blurred on the damp film. Replaces the env-map specular
  // where it applies (the env map can't place the neon / door / kids correctly on the floor).
  if (uReflOn > 0.5) {
    vec4 rp = uReflMat * vec4(vLsW, 1.0);
    vec3 nw = (vec4(normal, 0.0) * viewMatrix).xyz;          // view → world normal
    vec2 ruv = rp.xy / rp.w + nw.xz * vec2(0.05, 0.08) * (1.0 - gWater * 0.6);
    float lod = mix(3.2, 0.2, gWater);
    float sp = mix(0.018, 0.003, gWater);
    vec3 rc = textureLod(tRefl, ruv, lod).rgb * 0.36
            + (textureLod(tRefl, ruv + vec2(0.0, sp), lod).rgb + textureLod(tRefl, ruv - vec2(0.0, sp), lod).rgb) * 0.22
            + (textureLod(tRefl, ruv + vec2(0.0, sp * 2.6), lod + 0.6).rgb + textureLod(tRefl, ruv - vec2(0.0, sp * 2.6), lod + 0.6).rgb) * 0.1;
    float NdV = saturate(dot(normal, geometryViewDir));
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    float k = clamp(gWater + gDamp * 0.5 + gInk * 0.5, 0.0, 1.0);
    reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, rc * F * mix(0.8, 1.0, gWater), k);
  }`);
    hazeify(s, U);
  };
  mat.customProgramCacheKey = () => 'lsGround' + (lib ? 1 : 0);
  return mat;
}

// ================================ lit glass(发光玻璃)
// 窗户/自动贩卖机正面/店铺后间:暗色高光玻璃(反射 env)叠在自发光图集之上。
// ------------------------------------------------------------------------------------------------ lit glass
// 【lit 材质】MeshStandardMaterial:低粗糙高反射的暗玻璃(底色 0x06070a)+ emissiveMap(atlas)自发光。
//   注入顶点属性 aLit 作为自发光乘子(rgb),于是"亮/暗/关"的窗户共用一次 draw,无需为每档亮度拆材质。
//   内部用视图射线做一次廉价视差位移,让"房间内部"有纵深。
// Windows, the vending front, the shop back room: dark glossy glass (reflects the env) over an emissive atlas;
// per-vertex aLit = emissive multiplier (rgb) so lit / dim / off windows share one draw. A cheap parallax shift of
// the interior along the view ray gives the rooms depth.
export function litMaterial(U, atlas, envMap) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x06070a, roughness: 0.07, metalness: 0, emissive: 0xffffff, emissiveMap: atlas, envMap, envMapIntensity: 1.2 });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aLit; varying vec3 vLit;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vLit = aLit;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vLit;');
    hazeify(s, U);
  };
  mat.customProgramCacheKey = () => 'lsLit';
  return mat;
}

// ================================ neon(霓虹灯管)
// 玻璃管:给定队色,并在面向观察者处出现近白热芯。aNeon = (team, buzz, sign)。
// ------------------------------------------------------------------------------------------------ neon
// 【neon 材质】纯 ShaderMaterial(不走光照)。片段里:c 按 vNe.x 选队色(A/B/绿 sign)并归一化到最大值,
//   保证纯色相不被强度染灰;I 为强度(同一路选择,buzz 灯管再乘 uI.z 做闪烁)。
// Glass tubes: team colour, a hot near-white core where the tube faces the viewer. aNeon = (team, buzz, sign).
export function neonMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uColA: U.uTeamA, uColB: U.uTeamB, uColC: { value: new THREE.Color(0.1, 1, 0.35) }, uI: { value: new THREE.Vector4(7, 7, 1, 5) }, uHzA: U.uHzA, uHzB: U.uHzB, uHzK: U.uHzK, uHzStart: U.uHzStart },
    vertexShader: /* glsl */`
      attribute vec3 aNeon; varying vec3 vN; varying vec3 vV; varying vec3 vNe; varying vec3 vLsW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vLsW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; vNe = aNeon;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC; uniform vec4 uI; varying vec3 vN; varying vec3 vV; varying vec3 vNe;
      ${HAZE_F_PARS}
      void main() {
        vec3 n = normalize(vN), v = normalize(vV); float f = abs(dot(n, v));
        vec3 c = vNe.x > 1.5 ? uColC : (vNe.x > 0.5 ? uColB : uColA); c /= max(max(c.r, c.g), max(c.b, 1e-3));
        float I = vNe.x > 1.5 ? uI.w : (vNe.x > 0.5 ? uI.y : uI.x); if (vNe.y > 0.5) I *= uI.z;
        // 【热芯】f=|dot(n,v)| 是正对程度:队色项随 f 增亮,再加一项白热芯 I*0.4*pow(f,4)(只有正对时才亮),
        //   末尾 c*0.06 是极弱自发光底,防止背光面全黑
        vec3 col = c * I * (0.45 + 0.55 * f) + vec3(1.0) * I * 0.4 * pow(f, 4.0) + c * 0.06;
        col *= 1.0 - lsHazeAmt(vLsW) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
// 【相加混合常量】alpha-preserving:颜色用 One/One 相加(ADD),但 alpha 用 Zero/One 即保持不变。
//   这是硬约束——showcase 会按 alpha 反预乘(un-premultiply)整个舞台,若相加光把 alpha 抬过 1,
//   反预乘就会把画面压暗。故 blendSrcAlpha = ZeroFactor(见文件头)。transparent + depthWrite=false。
// additive blending that leaves destination alpha alone (see the header)
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, transparent: true, depthWrite: false };
// 【halo 材质】贴片光晕:texture.R 为辉光形状,乘队色(按 team 选 A/B);uI.x 为强度;同样 alpha-preserving
//   相加。由 lobbySet.js 的 _halo() 为每个霓虹招牌生成一张平面,renderOrder=2。
// Halo planes (texture R = glow) in a team colour; uI.x = intensity.
export function haloMaterial(U, map, team) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uCol: team ? U.uTeamB : U.uTeamA, uI: { value: 1 }, uHzA: U.uHzA, uHzB: U.uHzB, uHzK: U.uHzK, uHzStart: U.uHzStart },
    vertexShader: 'varying vec2 vUv; varying vec3 vLsW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vLsW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform sampler2D map; uniform vec3 uCol; uniform float uI; varying vec2 vUv;
      ${HAZE_F_PARS}
      void main() { float g = texture2D(map, vUv).r; vec3 c = uCol / max(max(uCol.r, uCol.g), max(uCol.b, 1e-3));
        gl_FragColor = vec4(c * g * g * uI * (1.0 - lsHazeAmt(vLsW)), 1.0); }`,
    ...ADD, side: THREE.DoubleSide,
  });
}
// 【glow 材质】面向相机的辉光 sprite(实例化):实例缩放的模长 = 半径,instanceColor = HDR 颜色。
//   顶点把 sprite 朝观察者拉近 min(r*0.8, 0.6),避免贴在墙上的辉光被墙切掉一半。同样 additive + alpha-preserving。
// Camera-facing glow sprites (instanced): instance scale = radius, instanceColor = HDR colour. Pulled toward the viewer
// so a glow on a wall isn't cut in half by it.
export function glowMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uHzA: U.uHzA, uHzB: U.uHzB, uHzK: U.uHzK, uHzStart: U.uHzStart },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vCol; varying vec3 vLsW;
      void main() {
        vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float r = length(instanceMatrix[0].xyz);
        vLsW = c; vUv = position.xy; vCol = instanceColor;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        vec3 toCam = normalize(-mv.xyz);
        mv.xyz += toCam * min(r * 0.8, 0.6);
        mv.xy += position.xy * r;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vCol;
      ${HAZE_F_PARS}
      void main() { float d = length(vUv); float g = exp(-d * d * 7.0) * 0.8 + exp(-d * d * 60.0) * 1.2; g *= smoothstep(1.0, 0.7, d);
        gl_FragColor = vec4(vCol * g * (1.0 - lsHazeAmt(vLsW) * 0.8), 1.0); }`,
    ...ADD,
  });
}
// 【emit 材质】灯泡/灯罩:平色 HDR 发光体(实例化),只是包一层 hazeMaterial 加雾(非 additive)。
// Bulbs / lamp lenses: flat HDR emitters (instanced), hazed like everything else.
export function emitMaterial(U) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  return hazeMaterial(m, U, false);
}

// ================================= sky + skyline(天空与天际线)
// 蓝调时刻:深靛天顶、屋顶上的淡青带、朝街口方向的钠灯暖光。画在最远平面(强制深度),对任意相机 far 都成立。
// ------------------------------------------------------------------------------------------------ sky + skyline
// 【sky 材质】按视线方向 d 在 天顶/中层/地平 三色间插值,再叠加朝街口(-z)的城市暖光与被城市光从下方
//   照亮的高空薄云。gl_Position.z = w*0.99999 把天空压到远平面;BackSide + 不写深度。
// Blue hour: deep indigo zenith, a pale teal band over the roofs, the city's sodium glow low toward the street mouth.
// Drawn at the far plane (depth forced) so it works with any camera far distance.
export function skyMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uGlow: { value: new THREE.Color(0.55, 0.3, 0.18) } },
    vertexShader: 'varying vec3 vDir; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uGlow; varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir); float e = d.y;
        vec3 zen = vec3(0.006, 0.012, 0.045), mid = vec3(0.02, 0.05, 0.14), hor = vec3(0.07, 0.12, 0.2);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, e)); c = mix(c, zen, smoothstep(0.2, 0.75, e));
        float toward = smoothstep(0.2, 1.0, -d.z);
        c += uGlow * exp(-max(e, 0.0) * 9.0) * (0.25 + 0.75 * toward);
        // thin high cloud streaks catching the city light from below
        vec2 cp = d.xz / max(e + 0.12, 0.05);
        float cl = smoothstep(0.55, 0.8, lsF(cp * vec2(0.35, 1.2) + vec2(uTime * 0.004, 0.0)));
        c = mix(c, uGlow * 0.35 + vec3(0.03, 0.04, 0.07), cl * 0.55 * smoothstep(0.02, 0.2, e) * smoothstep(0.9, 0.3, e));
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
}
// 【skyline 材质】天际线卡片:纹理 alpha<0.5 处 discard(剪出建筑轮廓),颜色平方*1.6 提 HDR,
//   再按顶点高度权重 h 与雾色 uFog 混合(近景楼顶亮、贴近背景处融进雾);uV 选近/远两条(uV.y=0.5 为一整条)。
export function skylineMaterial(U, map, fogCol, fog) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uFog: { value: fogCol }, uF: { value: fog }, uV: { value: new THREE.Vector2(0, 0.5) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform vec3 uFog; uniform float uF; uniform vec2 uV; varying vec2 vUv;
      void main() { vec4 t = texture2D(map, vec2(vUv.x, uV.x + vUv.y * uV.y)); if (t.a < 0.5) discard;
        vec3 c = t.rgb * t.rgb * 1.6;
        float h = mix(1.0, 0.45, vUv.y);
        gl_FragColor = vec4(mix(c, uFog, uF * h), 1.0); }`,
  });
}

// ================================ steam(蒸汽)
// 面向相机的软卷气柱:两层滚动噪声,卡片边缘与高度处淡出。
// ------------------------------------------------------------------------------------------------ steam
// 【steam 材质】纯 ShaderMaterial:两层滚动的 fbm 噪声(用 uTime 与逐实例 aSeed 错相),经边缘 smoothstep
//   与阈值 smoothstep 得 alpha;颜色混入少量雾色;transparent + 不写深度 + 双面。
// Soft curling plume on camera-facing cards: two scrolling noise octaves, faded at the card edges and with height.
export function steamMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCol: { value: new THREE.Color(0.2, 0.19, 0.21) }, uHzA: U.uHzA, uHzB: U.uHzB, uHzK: U.uHzK, uHzStart: U.uHzStart },
    vertexShader: /* glsl */`
      attribute float aSeed; varying vec2 vUv; varying float vSeed; varying vec3 vLsW;
      void main() { vUv = uv; vSeed = aSeed; vec4 w = modelMatrix * vec4(position, 1.0); vLsW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uCol; varying vec2 vUv; varying float vSeed;
      ${HAZE_F_PARS}
      ${NOISE}
      void main() {
        vec2 p = vUv * vec2(1.6, 3.0); float t = uTime * 0.35 + vSeed * 7.0;
        vec2 q = vec2(lsF(p + vec2(0.0, -t)), lsF(p * 1.3 + vec2(3.1, -t * 1.3)));
        float n = lsF(p * 1.1 + q * 1.4 + vec2(vSeed * 3.0, -t * 0.8));
        float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
        float a = smoothstep(0.4, 0.85, n) * edge * 0.6;
        vec3 c = mix(uCol, lsHazeCol(vLsW), 0.3);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
