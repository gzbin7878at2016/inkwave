// Level surface material: MeshPhysicalMaterial + injected procedural surface patterns and the wet ink layer.
//
// ============================ 中文导读 ============================
// 本文件是整个游戏【地面/墙面外观】的总装配车间:以 three.js 的 MeshPhysicalMaterial 为基底,
// 通过 onBeforeCompile 把大段自定义 GLSL"嫁接"进 three.js 官方着色器模板的各个 #include 锚点,
// 最终得到一块材质同时承担:
//
//   ① 程序化地表纹理(混凝土板/瓷砖/集装箱波纹/木板/球场线……由每个面的 pattern id 分发)
//   ② 纹理库系统(texlib.js,把 30+ 种烘焙好的 PBR 材质装进 sampler2DArray 数组纹理)
//   ③ 湿墨层(inkShading.js 的 9 段 GLSL,在这里按锚点拼接——上一节注释过的内容)
//   ④ 街灯点光(黄昏时甲板上的路灯,逐像素裁剪的"光池")
//   ⑤ 透视窗口(挡在本地玩家正前方的矮掩体自动溶解,保证角色永远可见)
//   ⑥ 壁画/ signage、烘焙 AO、泳道尾迹(swimWake.js)等
//
// 【关键机制:onBeforeCompile 字符串替换】
// three.js 的着色器源码不是黑盒——它是由 '#include <xxx>' 片段拼出来的文本。
// 这里对每个锚点 .replace('原片段', '原片段 + 自定义代码'),即可在不 fork three.js 源码的
// 前提下深度定制渲染。改完必须同步 customProgramCacheKey(见文件末尾),否则 three.js 会
// 因缓存键相同而复用旧程序,改了代码却不生效。
import * as THREE from 'three';
import { STAGE_SURFACES, FIRST_STAGE_SLOT, LAST_STAGE_SLOT } from './stages/surfaces.js';
import { TEXLIB_GLSL } from './texlib.js';
import { G } from '../core/ctx.js';
import { inkUniforms, inkBeforeRender, INK_PARS, INK_COLOR, INK_ROUGH, INK_GEL, INK_SLOPE, INK_EMISSIVE, INK_LIGHTS, INK_LIGHT_MAPS, INK_SHADE } from './inkShading.js';

// Street lamps light the deck at dusk: each bulb is a real punctual light through the material's own BRDF (diffuse +
// the ink's wet coat, so fresh ink glints under a lamp), windowed to a few metres and culled per pixel in world space
// (only fragments inside a pool pay for it). No shadows: the pools are soft and the bulbs sit over open deck.
// 【街灯 GLSL 常量】
//   MAX_LAMPS = 12  最多 12 盏灯(uniform 数组大小,编译期定死)
//   LAMP_R    = 10  每盏灯的影响半径(米),超出逐像素 discard 级 continue——不掏光照计算的钱
//   LAMP_HEX  灯色:暖橙 '#ffc48a'(高压钠灯的味道)
//   LAMP_I    光强基数 16,再乘夜晚系数 k(0=关灯)
// 注意:它们不是 three.js 场景里的 PointLight 对象!那是每盏灯一次 draw call 的昂贵做法;
// 这里直接在片元着色器里循环构造 IncidentLight,复用 three.js 内置的 RE_Direct 直接光照 BRDF,
// 12 盏灯也只跑一个材质一次,且只有落在光池里的像素才付费。
const MAX_LAMPS = 12, LAMP_R = 10, LAMP_HEX = '#ffc48a', LAMP_I = 16;
// 注入到 lights_fragment_begin 之后:在场景原有全部光源算完后,追加这 12 盏"伪点光"
const LAMP_LIGHTS = /* glsl */`
for (int i = 0; i < ${MAX_LAMPS}; i++) {
  if (i >= uLampN) break;                                    // 实际灯数(夜晚=0 时整段循环秒退)
  vec3 lw = uLamps[i] - vWPos;
  float d2 = dot(lw, lw);
  if (d2 > ${(LAMP_R * LAMP_R).toFixed(2)}) continue;        // 半径外剔除:这是"光池"省钱的关
  // w:窗口权重——光池边缘用 d2² 做平滑衰减,池中心 1、池边缘 0,池外早被上一行 continue 掉了
  float w = clamp(1.0 - d2 * d2 / ${(LAMP_R ** 4).toFixed(1)}, 0.0, 1.0);
  IncidentLight lampL;
  lampL.direction = normalize((viewMatrix * vec4(lw, 0.0)).xyz);   // 指向灯泡(视线空间)
  // 颜色 = 灯色 × 窗口² ÷ 距离²(平方反比)。max(d2, 0.35) 防止贴着灯时分母爆炸
  lampL.color = uLampCol * (w * w / max(d2, 0.35));
  lampL.visible = true;
  // 复用 three.js 的直接光照例程:漫反射 + 清漆高光一起算,湿墨在灯下会闪,不用另写
  RE_Direct(lampL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
}`;

// Bulb positions of the stage's street lamps (same placement rule as decor.js _buildLamps: mirrored pairs, the arm
// reaching 0.92 m toward the arena centre, bulb 4.9 m up) → uniforms; k = environment night factor (0 = off).
// 【CPU 侧:把关卡里的街灯位置灌进 uniform】
//   level.layout.decor.lamps —— 关卡数据里登记的灯位(只存一半,另一半按原点对称镜像,
//   与 decor.js 摆灯模型用同一套坐标规则);k 是"夜晚系数",0 就直接清空(白天不开灯)
export function setLevelLamps(mat, level, k = 0) {
  const u = mat && mat.userData && mat.userData.uniforms;   // uniform 表挂在 userData 上(见 createLevelMaterial)
  if (!u || !u.uLamps) return;
  const L = (level && level.layout && level.layout.decor && level.layout.decor.lamps) || [];
  const pts = k > 0.01 ? [...L, ...L.map(([x, z]) => [-x, -z])].slice(0, MAX_LAMPS) : [];
  // 灯泡世界坐标:x 向内收 0.92m(灯臂朝向场地中心),y = 该处地面高度 + 4.9m(灯杆高度)
  pts.forEach(([x, z], i) => u.uLamps.value[i].set(x + 0.92 * (x > 0 ? -1 : 1), Math.max(0, level.groundHeight(x, z)) + 4.9, z));
  u.uLampN.value = pts.length;
  u.uLampCol.value.set(LAMP_HEX).multiplyScalar(LAMP_I * k);   // 颜色 × 强度 × 夜晚系数
}

// 【createLevelMaterial:关卡材质工厂】
//   paintTexture —— 墨水图集渲染目标(paint.js 的 rt.texture),湿墨层采样它
//   atlasSize    —— 图集边长(像素),uTexel = 1/atlasSize
//   muralTexture —— 壁画/招牌图集(murals.js),可空
//   opts         —— { texlib, lightmap, ppm, paint, grate }
export function createLevelMaterial(paintTexture, atlasSize, muralTexture = null, opts = {}) {
  // 基底:白色(实际颜色来自顶点色 × 程序化纹理)、顶点色开启、默认粗糙 0.82。
  // clearcoat 预置 1.0/0.08 —— 这是给湿墨层"占位"的:inkShading 的 INK_LIGHTS 段每帧会
  // 按 gInk/gFresh 重算 clearcoat 参数,无墨处退回这里的基础值(地面本身就带一点釉面感)
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.08,
    envMapIntensity: 0.9,
  });
  // ============================ uniform 总表 ============================
  // 这一张表是 CPU↔GPU 的全部接口;onBeforeCompile 里 Object.assign 进着色器,
  // 之后所有自定义 GLSL 段(含 inkShading 的九段)读写的就是这里登记的名字。
  const uniforms = {
    uPaint: { value: paintTexture },           // ★ 墨水图集(湿墨层的数据源)
    uTexel: { value: 1 / atlasSize },          // 一个图集纹素 = 多少 UV(梯度钳制用)
    uTeamA: { value: new THREE.Color('#ff8a14') },   // 队伍 A 颜色(橙)
    uTeamB: { value: new THREE.Color('#2f5bff') },   // 队伍 B 颜色(蓝)
    uTime: { value: 0 },                       // 场景时钟(凝胶微表面漂移、尾迹用)
    uInkGlow: { value: 0.06 },                 // 墨自发光强度旋钮(inkShading INK_EMISSIVE 用)
    uMural: { value: muralTexture },           // 壁画图集
    uLight: { value: opts.lightmap || null },  // 烘焙 AO 光照图(bake-ao.cjs 产物)
    // ---- 透视窗口(see-through):挡玩家脸的地形按屏幕空间胶囊溶解 ----
    uSeeA: { value: new THREE.Vector3() },   // camera position
    uSeeB: { value: new THREE.Vector3() },   // player chest
    uSeeOn: { value: 0 },                    // 总开关(非本地玩家视角/回放时关)
    uSeeFeet: { value: 0 },                  // local player's feet height (set per draw below)
    uSeeA2C: { value: 0 },                   // 1 when drawing into a multisampled target (alpha-to-coverage fade)
    // 烘焙 AO 强度:有光照图=1.0,无=0.0(着色器里 if(uAO>0) 整体跳过)
    uAO: { value: opts.lightmap ? 1.0 : 0.0 },
    // dusk lamp pools (setLevelLamps, driven by main._applyNight): bulb positions (world) + warm colour × strength
    uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) }, uLampN: { value: 0 }, uLampCol: { value: new THREE.Color(0, 0, 0) },
    uAtlasSize: { value: atlasSize },          // 图集边长(像素),B 样条重建换算纹素坐标用
    uPpm: { value: opts.ppm || 20 },          // atlas texels per metre (from the paint system, set per draw)
    ...inkUniforms(),                        // 湿墨层自己的三个 uniform(墨时钟 + 涟漪表 ×2,见 inkShading.js)
    uGel: { value: 13 },                      // texlib 里"凝胶微表面"所在层号(INK_GEL 采 3D 噪声贴图的 z 切片)
    // ---- 泳道尾迹(swimWake.js 每帧写入):4 个泳者 × 12 点轨迹(xyz + 出生时刻;w<-1 = 空/断点) ----
    // uWakeB:每人一个包围球(xyz 中心 + 半径;0=该泳者不在墨里,整段跳过)
    // uSwimH:头位置 + 是否在墨里(w);uSwimF:头朝向 + 游速(w)
    uWake: { value: Array.from({ length: 48 }, () => new THREE.Vector4(0, 0, 0, -9)) },
    uWakeB: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -999, 0, 0)) },
    uSwimH: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -999, 0, 0)) },
    uSwimF: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 1, 0)) },
  };
  // ============================ 纹理库(texlib)接线 ============================
  // Texture library: one slot per PATTERN id (maps.js) → uTL (layer, 1/scale, anti-tiling mode, sym) and uTLt (tint
  // mode, normal strength, slot used on vertical faces, slot used on top faces). Tint mode 0 = own colours, 1 = albedo x
  // block colour, 2 = premultiplied paint mask (albedo.rgb + block colour x albedo.a x 1.25, see texlib 'mask').
  // The last slot (TL_SIDE) = concrete, used for the vertical sides of ramps / asphalt / boatyard slabs.
  // 概念:maps.js 里每个面有一个 pattern id(0..N)。这里建一张"槽位表":
  //   map[]    —— 槽位 i 用纹理库里的哪种材质(concrete/pavers/…/各舞台自定义面)
  //   uTL[i]   —— (纹理数组层号, 1/世界尺度, 抗平铺模式, 对称模式)
  //   uTLt[i]  —— (着色模式, 法线强度, 竖直面换成哪个槽, 顶面换成哪个槽)
  //              着色模式 0=用材质自带色 1=材质色×面片顶点色 2=预乘遮罩(招牌涂鸦那种)
  // 槽位重映射的动机:同一块"坡道板",顶面要沥青、侧面要混凝土——一个 pattern id 不够,
  // 就用 onWall/onTop 按面的朝向再映射一次。
  const lib = opts.texlib || null;
  if (lib) {
    const L = lib.layers, M = lib.meta;
    // 槽位 → 纹理库材质名。前 28 个是内置地形集;28..LAST_STAGE_SLOT 由舞台(stages/<id>/surfaces.js)
    // 注册(未注册的槽位回落到 concrete);最后一个槽 TL_SIDE 是"侧面专用混凝土"
    const map = ['concrete', 'pavers', 'tiles', 'concrete', 'rubber', 'corrugated', 'boardwalk', 'metalpanel', 'tiles', 'concrete',
      'asphalt', 'metalpanel', 'grate', 'brick', 'rubber', 'glasstile', 'pavers',
      /* 17 planks … 23 render (marina set) */ 'planks', 'hullpaint', 'nonslip', 'gelcoat', 'yard', 'weatherboard', 'render',
      /* 24 treads … 27 gangdeck (stairs + ramps) */ 'treads', 'stonestep', 'rampboard', 'gangdeck',
      /* 28 … LAST_STAGE_SLOT: stage-owned surfaces (stages/<id>/surfaces.js), concrete where a slot is unused */
      ...Array.from({ length: LAST_STAGE_SLOT - FIRST_STAGE_SLOT + 1 }, (_, k) => (STAGE_SURFACES.find((s) => s.slot === FIRST_STAGE_SLOT + k) || { name: 'concrete' }).name),
      /* TL_SIDE */ 'concrete'];
    const SIDE = map.length - 1;   // TL_SIDE 槽位号(数组末尾)
    // ramp / asphalt / yard sides → concrete; car-deck edge → hull plating; stair / ramp sides → steel stringer plating,
    // rendered cheek wall, timber skirting, painted steel
    // 朝向重映射表:槽位 → {竖直面用几号槽, 顶面用几号槽}
    // 例:4 号槽(rubber 坡道)的侧面要混凝土 SIDE;20 号槽(gelcoat 船体)的顶面要木板 17
    const onWall = { 4: SIDE, 10: SIDE, 21: SIDE, 19: 18, 24: 18, 25: 23, 26: 17, 27: 11 };
    const onTop = { 20: 17 };                                  // gelcoat hulls get a planked deck on top
    // 舞台自定义的朝向重映射优先级更高,覆盖内置表
    for (const s of STAGE_SURFACES) { if (s.onWall != null) onWall[s.slot] = s.onWall; if (s.onTop != null) onTop[s.slot] = s.onTop; }
    // 纹理库三张数组纹理:反照率(albedo)、法线(normal)、ORM(遮蔽/粗糙/金属,Roughness 在 G、金属在 B)
    uniforms.tAlbedo = { value: lib.albedo };
    uniforms.tNormal = { value: lib.normal };
    uniforms.tOrm = { value: lib.orm };
    uniforms.uTexSize = { value: lib.stats?.size || 512 };
    uniforms.uTL = { value: map.map((n) => new THREE.Vector4(L[n] ?? 0, 1 / ((M[n] && M[n].scale) || 4), (M[n] && M[n].mode) ?? 1, (M[n] && M[n].sym) ?? 7)) };
    uniforms.uTLt = { value: map.map((n, i) => new THREE.Vector4(M[n] && M[n].mask ? 2 : (M[n] && M[n].tint === false ? 0 : 1), n === 'grate' ? 0.6 : 1.0, onWall[i] ?? i, onTop[i] ?? i)) };
    // stair / ramp slots (meta.stair): top faces are sampled in the ramp's own frame, phase-locked so whole steps fit
    // 楼梯槽位专属:uTLs 存"楼梯参数"(斜坡长度、踏步尺寸等),着色器据此把 UV 锁进坡道自身坐标系,
    // 让整数个踏步正好铺满整段楼梯(否则纹理会对不齐踏步)
    uniforms.uTLs = { value: map.map((n) => new THREE.Vector4(...((M[n] && M[n].stair) || [0, 0, 0, 0]))) };
    uniforms.uGel.value = L.gel ?? -1;         // 凝胶微表面所在的纹理层(没有则 -1,INK_GEL 降级为 vnoise)
    // USE_TEXLIB 宏:让着色器编译进 texlib 分支;TL_SLOTS 是槽位数(数组 uniform 大小,编译期常量)
    mat.defines = { ...(mat.defines || {}), USE_TEXLIB: 1, TL_SLOTS: map.length };
  }
  // ============================ 壁画表 ============================
  // Mural / signage table (murals.js → texture.userData.murals, indexed by mural id): atlas rect, placement on the face
  // (metres), weathering. Without a table: the original four 8:1 strips.
  // uMurA = 图集矩形(xy=左下 UV, zw=宽高 UV);uMurB = 面上的摆放(x 起点/宽度, y 起点/高度,米);
  // uMurC = 风化参数(x=地表纹理透显比例, y=墨覆盖参与程度)。面的 mural id 写在 faceFlags.z。
  {
    const MUR = 12;   // 最多 12 张壁画
    // 没有壁画数据时给 4 条默认的 8:1 长条(老版行为,保证任何关卡都不崩)
    const rows = (muralTexture && muralTexture.userData && muralTexture.userData.murals) || [0, 1, 2, 3].map((id) => ({ rect: [0, 1, (3 - id) / 4, 1 / 4], place: [0, -8, 0, 0] }));
    uniforms.uMurA = { value: Array.from({ length: MUR }, (_, i) => new THREE.Vector4(...((rows[i] && rows[i].rect) || [0, 1, 0, 0.25]))) };
    uniforms.uMurB = { value: Array.from({ length: MUR }, (_, i) => new THREE.Vector4(...((rows[i] && rows[i].place) || [0, -8, 0, 0]))) };
    uniforms.uMurC = { value: Array.from({ length: MUR }, (_, i) => new THREE.Vector2(...((rows[i] && rows[i].fx) || [0, 0]))) };
  }
  mat.userData.uniforms = uniforms;   // 挂到 userData,外部(setLevelLamps / main.js / 小地图)直接读写
  // ============================ 每帧回调(每次绘制前) ============================
  // see-through window: feet height of the local player + whether this draw is multisampled (main.js drives the rest)
  mat.alphaToCoverage = true;         // 透视窗口在 MSAA 目标下走 alpha-to-coverage 亚像素淡出(见下文)
  mat.onBeforeRender = (renderer) => {
    // 本地玩家(过场动画 attract 模式没有本地玩家,退回 uSeeB.y-1)
    const loc = G.match && !G.match.attract ? G.match.local : null;
    uniforms.uSeeFeet.value = loc ? loc.pos.y : uniforms.uSeeB.value.y - 1.0;
    const rt = renderer.getRenderTarget();
    // 当前是不是往 MSAA 目标画?是→用 alpha-to-coverage(4 级亚像素),否→退化成有序抖动 discard
    uniforms.uSeeA2C.value = rt && rt.samples > 0 ? 1 : 0;
    // paint system: atlas density, paint clock + ripples (inkShading.js)
    // 湿墨层数据对接:确认传进来的就是本材质绑定的图集(换地图时会重建),然后灌 ppm 和涟漪表
    const P = opts.paint || G.paint;
    if (P && P.texture === uniforms.uPaint.value) {
      uniforms.uPpm.value = P.ppm;
      inkBeforeRender(uniforms, P);
    }
  };
  // ============================ onBeforeCompile:GLSL 嫁接 ============================
  // three.js 在首次编译该材质时回调这里。sh.vertexShader / sh.fragmentShader 是【字符串】,
  // 对每个 '#include <xxx>' 锚点做"原样保留 + 追加自定义代码"的替换。
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);   // 把上面那张 uniform 总表并进去,GLSL 才能读到
    // ---------- 顶点着色器 ----------
    // 关卡网格(level.js 构建)往每个顶点塞了 5 组自定义 attribute,这里声明并转发给片元:
    //   paintUv  —— 该顶点在【墨水图集】里的 UV(涂墨面的"墨坐标")
    //   faceUv   —— 该顶点在【面自身】里的 UV(米为单位,程序化纹理的"材质坐标")
    //   faceData —— (pattern id, 是否可涂墨, 面宽, 面高)
    //   faceFlags—— (是否墙脚, 是否落地, 壁画 id)
    //   faceTan  —— 面的 U 方向世界切线
    //   lightUv  —— 烘焙 AO 图的 UV(不可用时 x<0)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 paintUv;
attribute vec2 faceUv;
attribute vec4 faceData;
attribute vec3 faceFlags;
attribute vec3 faceTan;
attribute vec2 lightUv;
varying vec2 vLightUv;
varying vec3 vFaceTan;
varying vec2 vPaintUv;
varying vec2 vFaceUv;
varying vec4 vFaceData;
varying vec3 vFaceFlags;
varying vec3 vWPos;
varying vec3 vWNorm;`)
      // project_vertex 之后所有内置变换都完成了:把各 attribute 存进 varying,
      // 同时顺手算出世界坐标 vWPos / 世界法线 vWNorm(片元里所有世界空间计算的前提)
      .replace('#include <project_vertex>', `#include <project_vertex>
vPaintUv = paintUv; vFaceUv = faceUv; vFaceData = faceData; vFaceFlags = faceFlags;
vFaceTan = normalize(mat3(modelMatrix) * faceTan);
vLightUv = lightUv;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNorm = normalize(mat3(modelMatrix) * objectNormal);`);

    // ---------- 片元着色器 ----------
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uPaint;
uniform float uTexel;
uniform vec3 uTeamA;
uniform vec3 uTeamB;
uniform float uTime;
uniform float uInkGlow;
uniform sampler2D uMural;
uniform sampler2D uLight;
uniform float uAO;
uniform vec3 uLamps[${MAX_LAMPS}];
uniform int uLampN;
uniform vec3 uLampCol;
uniform vec3 uSeeA;
uniform vec3 uSeeB;
uniform float uSeeOn;
uniform float uSeeFeet;
uniform float uSeeA2C;
uniform float uAtlasSize;
uniform float uPpm;
uniform float uGel;
uniform vec4 uWake[48];
uniform vec4 uWakeB[4];
uniform vec4 uSwimH[4];
uniform vec4 uSwimF[4];
varying vec2 vLightUv;
varying vec3 vFaceTan;
varying vec2 vPaintUv;
varying vec2 vFaceUv;
varying vec4 vFaceData;
varying vec3 vFaceFlags;
varying vec3 vWPos;
varying vec3 vWNorm;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
// anti-aliased grid line: returns 1 on the line
// gridLine:任意周期的网格线,fwidth 自适应过渡宽度 → 远近都不闪
float gridLine(float x, float period, float width) {
  float fx = abs(fract(x / period + 0.5) - 0.5) * period;
  float w = fwidth(x) * 0.75;
  return 1.0 - smoothstep(width - w, width + w, fx);
}
${INK_PARS}
vec2 fsz0(vec4 fd) { return fd.zw; }
#ifdef USE_TEXLIB
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform sampler2DArray tNormal;
uniform sampler2DArray tOrm;
uniform float uTexSize;
uniform vec4 uTL[TL_SLOTS];
uniform vec4 uTLt[TL_SLOTS];
uniform vec4 uTLs[TL_SLOTS];
${TEXLIB_GLSL}
#endif
uniform vec4 uMurA[12];
uniform vec4 uMurB[12];
uniform vec2 uMurC[12];
// ============================ 全局状态变量(g 前缀 = global) ============================
// 各着色段之间靠这一组"像素级状态"传话:前面的段写入,后面的段读取,最后在光照段统一结算。
// 命名规律:gTex*=地表纹理系,gInk*=湿墨层系。
vec3 gTexMod = vec3(1.0);   // surface albedo modulation (≈ 1 mean) + paint coverage, for weathered murals
float gTexPaint = 1.0;      // 该像素的"可涂墨程度"(1=正常涂墨;遮罩类材质<1,墨会斑驳脱落)
vec3 gTexN = vec3(0.0, 0.0, 1.0);   // 纹理库法线(切空间)
vec4 gTexORM = vec4(1.0, 0.8, 0.0, 0.5);   // 纹理库 ORM(遮蔽/粗糙/金属)
float gTexStr = 0.0;        // 纹理法线强度(后续被墨覆盖、压花等逐步衰减)
vec4 gStair = vec4(0.0);    // stair / ramp top: distance across from one side (m), width (m), edge kind, step coordinate
float gTexKeep = 0.0;       // share of the texture relief kept under ink (stairs keep their steps)
float gTexAlpha = 1.0;      // 纹理 alpha(镂空格栅等用)
float gInk = 0.0;           // ★ 本像素墨覆盖率 0..1(湿墨层总开关,由 inkShading INK_COLOR 写入)
vec3 gInkCol = vec3(0.0);   // ★ 算好的墨颜色(INK_COLOR 写入,EMISSIVE/SHADE 等段读取)
float gBaseRough = 0.8;     // 地表自身粗糙度(供 INK_ROUGH 当混合基底)
float gInkH = 0.0;
vec2 gInkD = vec2(0.0);     // ★ 墨面高度场梯度(弯月唇/交界/尾迹/涟漪都累加到这里,最后统一转法线)
float gRib = 0.0;
float gFresh = 0.0;         // 新墨鲜亮度 0..1
float gInkNear = 0.0;       // 近景权重(B 样条重建参与度)
float gInkS = 0.0;          // 墨面厚度剖面(0=边缘唇,1=平顶)
float gWake = 0.0;`)       // 尾迹/涟漪"动态高光"强度(喂给清漆段提亮)
      // ============================ color_fragment:地表颜色总装 ============================
      // 执行顺序:透视窗口溶解 → 格栅镂空 → 纹理库/程序化图案算 base → 模型细节 → 壁画 →
      //           边缘/AO 修饰 → 湿墨层混合(INK_COLOR)→ 写回 diffuseColor
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // see-through: geometry in front of the local player that overlaps their on-screen silhouette dissolves, so low
  // cover never hides your character. The window is a capsule in screen space around the body (feet → head) with a
  // soft edge; only fragments clearly in front of the player dissolve (never anything behind them), and floors /
  // platform sides at or below the player's feet are never cut (no holes under you).
  // With MSAA the fade uses alpha-to-coverage (sub-pixel, smooth); without it an 8×8 ordered dither + discard.
  // 【透视窗口】第三人称视角里,挡在玩家正前方的矮墙会挡住角色。这段把"玩家屏幕投影胶囊"
  // 前方 0.2~0.75m 的地形按 k 值溶解:掩体半透明,角色始终可见。
  diffuseColor.a = 1.0;
  if (uSeeOn > 0.001) {
    // Bv = 玩家胸口(视点空间);dB = 玩家深度。玩家须在相机前 0.6m 以上才启用
    vec3 Bv = (viewMatrix * vec4(uSeeB, 1.0)).xyz;
    float dB = -Bv.z, dP = vViewPosition.z;
    if (dB > 0.6 && dP < dB - 0.2) {
      float bodyH = uSeeB.y - uSeeFeet;                        // kid ≈ 1.0, squid ≈ 0.4
      // 屏幕空间胶囊:脚 Fv → 头顶 Hv(身高 ×1.42 +  margin)。手形态短、人形态长,胶囊自适应
      vec3 Fv = (viewMatrix * vec4(uSeeB.x, uSeeFeet + 0.05, uSeeB.z, 1.0)).xyz;
      vec3 Hv = (viewMatrix * vec4(uSeeB.x, uSeeFeet + bodyH * 1.42 + 0.06, uSeeB.z, 1.0)).xyz;
      // 把片段和胶囊端点都除以自己的深度 → 归一化屏幕坐标,再算到胶囊轴线的距离 sd(换算回米)
      vec2 p = -vViewPosition.xy / dP, f = Fv.xy / max(-Fv.z, 0.05), h = Hv.xy / max(-Hv.z, 0.05);
      vec2 fh = h - f;
      float t = clamp(dot(p - f, fh) / max(dot(fh, fh), 1e-8), 0.0, 1.0);
      float sd = length(p - (f + fh * t)) * dB;                  // metres, measured at the player's distance
      float R = mix(0.3, 0.46, clamp(bodyH, 0.0, 1.0));          // body half-width + margin
      // k = 溶解度:胶囊内 1,软边 0.42m 过渡;再乘"深度门禁"——只溶玩家前方 0.2~0.75m,身后的墙不动
      float k = 1.0 - smoothstep(R, R + 0.42, sd);
      k *= smoothstep(dB - 0.2, dB - 0.75, dP);                  // only well in front of the player
      // never cut floors at the player's feet, nor the sides of the platform they stand on
      // 脚下保护:玩家脚上方 0.3m 以内的"地板"和"站台侧壁"永不溶解——不然脚底下会开个洞
      float feetTop = uSeeFeet + 0.3;
      if (vWNorm.y > 0.6 && vWPos.y < feetTop) k = 0.0;
      if (abs(vWNorm.y) < 0.6 && vWPos.y + max(vFaceData.w - vFaceUv.y, 0.0) * 0.9 < feetTop) k = 0.0;
      k *= uSeeOn;
      if (k > 0.002) {
        // bay:8×8 Bayer 有序抖动阈值(位运算铺出 64 级),把"溶解"离散化成可复现的图案
        ivec2 q = ivec2(gl_FragCoord.xy) & 7;
        int xy = q.x ^ q.y;
        float bay = (float(((xy & 1) << 5) | ((q.x & 1) << 4) | ((xy & 2) << 2) | ((q.x & 2) << 1) | ((xy & 4) >> 1) | ((q.x & 4) >> 2)) + 0.5) / 64.0;
        // alpha-to-coverage gives 4 levels per pixel; a small ordered offset fills the steps in between, tapered so
        // the open centre and the untouched rim stay perfectly clean (no screen-door grain over the character)
        // MSAA 路径:alpha-to-coverage 每像素 4 级,加 (bay-0.5)×0.25 的有序偏移补出中间级;
        // 偏移量两端 taper 掉——溶解中心的空洞和边缘的完整地形都不带抖动噪点
        float a = 1.0 - k;
        if (uSeeA2C > 0.5) diffuseColor.a = clamp(a + (bay - 0.5) * 0.25 * smoothstep(0.0, 0.2, a) * smoothstep(1.0, 0.8, a), 0.0, 1.0);
        else if (k > bay * 0.98 + 0.01) discard;   // 无 MSAA:纯阈值丢弃
      }
    }
  }
  vec2 fu = vFaceUv;              // 面内坐标(米):后面所有程序化纹理的"画布"
  float pattern = vFaceData.x;    // 本面的图案 id
#ifdef GRATE
  // 格栅镂空(opts.grate 的材质才有,如排水沟盖板):4cm 主筋 × 7cm 间距,20cm 一道 2cm 横筋,孔洞 discard。
  // 墙面上不镂空(竖直面整块实心)。fwidth 自适应 → 斜看网格线不闪。
  {
    float gw = fwidth(fu.x) + 1e-4;
    float bx = 1.0 - smoothstep(0.02 - gw, 0.02 + gw, abs(fract(fu.x / 0.07 + 0.5) - 0.5) * 0.07);
    float by = 1.0 - smoothstep(0.01 - gw, 0.01 + gw, abs(fract(fu.y / 0.2 + 0.5) - 0.5) * 0.2);
    // 面边缘 5~6cm 一圈强制实心(边框),solid = 主筋∨横筋∨边框
    float edge = 1.0 - smoothstep(0.05, 0.06, min(min(fu.x, fsz0(vFaceData).x - fu.x), min(fu.y, fsz0(vFaceData).y - fu.y)));
    float solid = max(max(bx, by), edge);
    if (abs(vWNorm.y) < 0.5) solid = 1.0;
    if (solid < 0.5) discard;
  }
#endif
  vec2 fsz = vFaceData.zw;        // 面尺寸(米)
  vec3 base = diffuseColor.rgb;   // 顶点色起点,后面所有纹理乘/混在它上面
  float rough = 0.82;             // 本像素粗糙度(各图案分支改写)
  float big = fbm(vWPos.xz * 0.18 + vWPos.y * 0.1);   // 世界空间大尺度斑驳(各图案共享,统一"旧化"感)
  float fine = vnoise(fu * 9.0);                      // 面内细噪声
#ifdef USE_TEXLIB
  {
    int pid = int(pattern + 0.5);
    bool vertical = abs(vWNorm.y) < 0.5;
    // per-slot remaps: ramp / asphalt / yard sides → concrete, car-deck edge → plating, gelcoat tops → planks
    // 按朝向二次映射槽位:竖直面/顶面可以换成另一种材质(同一块板,侧面和顶面不同纹理)
    if (vertical) pid = int(uTLt[pid].z + 0.5); else if (vWNorm.y > 0.5) pid = int(uTLt[pid].w + 0.5);
    vec4 tl = uTL[pid]; vec4 tt = uTLt[pid];
    // stairs / ramps: sample in the ramp's own frame — u across, v downhill from the top landing — with v phase-locked so
    // a whole number of steps fits the visible flight (the slab runs 0.6 m on under the floor at its low end, level.js)
    // 【楼梯 UV 锁定】把 UV 换到坡道自身坐标系:v 轴 = 从顶平台顺坡向下,u 轴 = 横向。
    // 关键点:v 的相位按"整段坡长 ÷ 整数个踏步"重新量化(Ps),保证任意长度的楼梯都恰好
    // 铺满整数个踏步,纹理边缘永远对齐踏步沿——否则会出现"半步"。
    vec2 tuv = fu * tl.y;         // 默认:面内坐标 × 纹理尺度
    vec4 sp = uTLs[pid];          // 楼梯参数(非楼梯槽位全 0)
    vec2 tA = vec2(1.0, 0.0), tD = vec2(0.0, 1.0);   // 纹理(切线)轴 → 面(u,v)轴 的映射
    if (sp.x > 0.0 && vWNorm.y > 0.5) {
      bool alongU = abs(vFaceTan.y) > 0.02;                                   // x-running ramps: face u runs up/down the slope
      // sg:上坡方向符号;fa = 沿坡向坐标,fcr = 横向坐标(按坡道朝向二选一)
      float sg = alongU ? sign(vFaceTan.y) : sign(vWNorm.z * vFaceTan.x - vWNorm.x * vFaceTan.z);   // uphill = +axis?
      float fa = alongU ? fu.x : fu.y, fcr = alongU ? fu.y : fu.x;
      float La = alongU ? fsz.x : fsz.y, Wd = alongU ? fsz.y : fsz.x;
      float dTop = sg > 0.0 ? La - fa : fa;                                   // 到顶平台端的坡向距离
      // 坡道低端有 0.6m 埋进楼板(level.js 的做法):顶冠 bevel 之后可见片段永远不会落在埋入段,
      // 这里把方向反过来量,保证纹理从"第一个可见踏步"开始对齐
      if (dTop > La - 0.3) { sg = -sg; dTop = La - dTop; }                   // bevel past the crest: visible fragments never sit in the buried tail
      float Lv = max(La - 0.6, sp.x);                                         // 可见坡长
      float Ps = Lv / max(1.0, floor(Lv / sp.x + 0.5));                       // 重量化步距:整数步铺满
      tuv = vec2(fcr * tl.y, dTop / (Ps * sp.y));                             // v = 第几个踏步(含小数)
      tA = alongU ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
      tD = alongU ? vec2(-sg, 0.0) : vec2(0.0, -sg);
      gStair = vec4(fcr, Wd, sp.w, dTop / Ps);                                // 记下横向位置/宽度/边缘类型/踏步内位置,后面细节段用
      gTexKeep = sp.z;                                                        // 楼梯保留多少纹理浮雕(墨盖上去后踏步还在)
    }
    // 一次采样同时取回 反照率+法线+ORM(texlib.js 的 TexlibSample)
    TexlibSample ts = texlibSample(tAlbedo, tNormal, tOrm, tuv, tl.x, int(tl.z), int(tl.w));
    ts.normal = vec3(ts.normal.x * tA + ts.normal.y * tD, ts.normal.z);      // back into the face's (u, v) frame
    // 三种着色模式:2=预乘遮罩(招牌喷绘:albedo.rgb 直接叠加,albedo.a 乘顶点色发光部分)
    //               1=albedo×顶点色(多数材质:纹理提供明暗,顶点色提供色相)
    //               0=albedo 原色(tint=false 的材质,如集装箱波纹板自带颜色)
    base = tt.x > 1.5 ? ts.albedo.rgb + diffuseColor.rgb * ts.albedo.a * 1.25
         : (tt.x > 0.5 ? diffuseColor.rgb * ts.albedo.rgb * 1.25 : ts.albedo.rgb);
    base *= texlibMacro(vWPos.xz + vWPos.y * 0.7);              // 世界空间宏观明暗(打破平铺感)
    base *= mix(1.0, ts.orm.r, 0.85);                            // cavity occlusion in grout / seams / grooves
    // 同步算好壁画风化要用的两个调制量 + 法线强度,后面的段不再回头采纹理
    gTexMod = (tt.x > 1.5 ? vec3(ts.albedo.a * 1.25) : (tt.x > 0.5 ? ts.albedo.rgb * 1.25 : vec3(1.0))) * mix(1.0, ts.orm.r, 0.85);
    gTexPaint = tt.x > 1.5 ? clamp(ts.albedo.a * 1.45, 0.0, 1.0) : 1.0;
    rough = ts.orm.g;
    gTexN = ts.normal; gTexORM = ts.orm; gTexStr = tt.y; gTexAlpha = ts.albedo.a;
    #ifdef GRATE
      // 格栅 + 纹理库叠加时:按纹理 alpha 再镂空一次(钢格板的真实镂空靠贴图)
      if (texlibCoverage(ts.albedo.a, fu * tl.y, uTexSize) < 0.5 && !vertical) discard;
    #endif
  }
  // ---- 图案 id 的"二次修饰"分支(叠在纹理库之上,只挑少数几种面做) ----
  if (pattern < 0.5) {
  } else if (pattern < 1.5) {
    // court markings over the pavers
    // 1 = 球场:混凝土板上画球场线(9.5m 中圈 + 半场线),带磨损
    float rr = length(vWPos.xz);
    float wr = fwidth(rr);
    float mark = 1.0 - smoothstep(0.09 - wr, 0.09 + wr, abs(rr - 9.5));
    float wz = fwidth(vWPos.z);
    mark = max(mark, (1.0 - smoothstep(0.07 - wz, 0.07 + wz, abs(vWPos.z))) * step(9.5, abs(vWPos.x)));
    mark *= 0.75 + 0.25 * step(0.35, vnoise(vWPos.xz * 6.0));   // 25% 随机磨损
    if (vWNorm.y > 0.5) base = mix(base, vec3(0.97, 0.96, 0.92), mark * 0.9);
  } else if (pattern > 3.5 && pattern < 4.5) {
    // 4 = 坡道:两侧 16~20cm 黄色安全边线
    float edge = 1.0 - smoothstep(0.16, 0.2, min(fu.x, fsz.x - fu.x));
    if (vWNorm.y > 0.5) { base = mix(base, vec3(0.93, 0.72, 0.12), edge * 0.95); rough = mix(rough, 0.6, edge); }
  } else if (pattern > 7.5 && pattern < 8.5) {
    // 8 = 出生台:34~36cm 边带 + 黄黑 V 形警示纹
    float e = min(min(fu.x, fsz.x - fu.x), min(fu.y, fsz.y - fu.y));
    float band = 1.0 - smoothstep(0.34, 0.36, e);
    float chev = step(0.5, fract((fu.x + fu.y) * 1.6));
    if (vWNorm.y > 0.5) base = mix(base, mix(vec3(0.95, 0.76, 0.1), vec3(0.12), chev), band * step(0.05, e));
  } else if (pattern > 8.5 && pattern < 9.5) {
    // 9 = 花台:石质边框 + 顶部草坪(fbm 草地斑驳)
    float e = min(min(fu.x, fsz.x - fu.x), min(fu.y, fsz.y - fu.y));
    float bed = smoothstep(0.24, 0.27, e) * step(0.5, vWNorm.y);
    vec3 grass = vec3(0.32, 0.55, 0.22) * (0.8 + 0.35 * fbm(fu * 6.0));
    base = mix(base, grass, bed);
    rough = mix(rough, 0.95, bed);
    gTexStr *= 1.0 - bed;   // 草坪上法线浮雕清零(草是软的)
  }
  // ---- modelled detail (shader-only, no layout change) ----
  // 【模型化细节】不改动关卡几何,纯着色"画"出额外的构造感。每个 if 挑特定 pattern + 朝向。
  {
    int pid = int(pattern + 0.5);
    vec2 wp = vWPos.xz;
    float ef = min(min(fu.x, fsz.x - fu.x), min(fu.y, fsz.y - fu.y));   // 到面边缘的距离
    bool isTop = vWNorm.y > 0.6;
    bool isWall = abs(vWNorm.y) < 0.5;
    // floors: soft grime patches, sun-bleached warm areas and smoother traffic-polished patches (sheen at grazing sun)
    // 几种"大平地面":污渍斑块 + 日晒褪色区 + 人流磨光区(磨光处粗糙度降,掠射阳光下有绸缎光泽)
    if (isTop && (pid == 1 || pid == 16 || pid == 10 || pid == 2 || pid == 8 || pid == 17 || pid == 19 || pid == 21)) {
      float m1 = vnoise(wp * 0.09 + 5.3), m2 = vnoise(wp * 0.31 + 1.7), m3 = vnoise(wp * 1.3);
      float grime = smoothstep(0.52, 0.86, m1 * 0.65 + m2 * 0.35);
      base *= 1.0 - 0.075 * grime * (0.7 + 0.3 * m3);
      base *= mix(vec3(1.0), vec3(1.025, 1.005, 0.965), smoothstep(0.42, 0.12, m1));
      rough = mix(rough, rough * 0.72, smoothstep(0.62, 0.9, m2) * 0.7);
    }
    // stone coping on exposed tops of walls / platforms / parapets, with a drip-groove shadow under the cap
    // 石质压顶:墙/台/矮墙的 exposed 顶面四周 20~26cm 盖一圈石材,外沿下有一道滴水槽阴影。
    // 小台面(<1.15m)整面都是压顶;墙面上沿(faceFlags.x=压顶墙)也补一条
    if (pid == 0 || pid == 2 || pid == 3 || pid == 13 || pid == 15 || pid == 16 || pid == 23) {
      float cop = 0.0, groove = 0.0;
      float cw = mix(0.2, 0.26, step(3.0, min(fsz.x, fsz.y)));
      if (isTop) {
        cop = min(fsz.x, fsz.y) < 1.15 ? 1.0 : 1.0 - smoothstep(cw - 0.008, cw + 0.008, ef);
        groove = (1.0 - smoothstep(0.004, 0.012, abs(ef - cw))) * step(1.15, min(fsz.x, fsz.y));
      } else if (isWall && vFaceFlags.x > 0.5) {
        float dt = fsz.y - fu.y;
        cop = 1.0 - smoothstep(0.1, 0.108, dt);
        groove = 1.0 - smoothstep(0.005, 0.016, abs(dt - 0.118));
      }
      vec3 stone = vec3(0.9, 0.885, 0.845) * (0.95 + 0.07 * vnoise(fu * 9.0) + 0.03 * vnoise(fu * 41.0));
      base = mix(base, stone * texlibMacro(wp + vWPos.y * 0.7), cop);
      rough = mix(rough, 0.72, cop);
      gTexStr *= 1.0 - 0.8 * cop;   // 石材区纹理法线减弱(光滑石材)
      base *= 1.0 - 0.28 * groove;
    }
    // ramps: anti-slip grooves across the slope
    // 坡道防滑槽:沿坡向每 32cm 一道 1.6cm 凹槽(把面内坐标投到上坡方向再画 gridLine)
    if (pid == 4 && isTop) {
      vec3 Tt = normalize(vFaceTan - vWNorm * dot(vFaceTan, vWNorm)), Bb = cross(vWNorm, Tt);
      vec2 up2 = vec2(Tt.y, Bb.y);
      float along = dot(fu, up2 / max(length(up2), 1e-4));
      float g = gridLine(along, 0.32, 0.016);
      base *= 1.0 - 0.2 * g;
      rough = mix(rough, 0.95, g);
    }
    // containers: rust streaks bleeding from the top rail and corners, dirt toward the bottom
    // 集装箱:上梁和角部淌锈痕,底部积灰
    if (pid == 5 && isWall) {
      float st = vnoise(vec2(dot(wp, vec2(0.707)) * 5.5 + vWPos.x * 0.8, vWPos.y * 0.35));
      float fromTop = smoothstep(fsz.y * 0.25, fsz.y, fu.y);
      float rust = smoothstep(0.6, 0.92, st) * (0.35 + 0.65 * fromTop);
      rust = max(rust, (1.0 - smoothstep(0.05, 0.3, ef)) * smoothstep(0.45, 0.8, vnoise(fu * 3.0)) * 0.8);
      base = mix(base, vec3(0.42, 0.2, 0.1) * (0.8 + 0.4 * vnoise(fu * 11.0)), rust * 0.42);
      rough = mix(rough, 0.85, rust);
      base *= mix(0.84, 1.0, smoothstep(0.0, 0.7, fu.y));   // 底部整体压暗
    }
    // stairs / ramps: soft contact shadow along the stringers / kick plates / cheek walls the props put at both sides;
    // the stone stair is worn smoother and paler down its middle, the steel stair's plate polished along the walking line
    // 楼梯两侧(靠 stringer/踢脚板处)一道软接触阴影;石材楼梯中线被磨白磨光,钢板楼梯沿走行线磨亮
    if (gStair.z > 0.5) {
      float e = min(gStair.x, gStair.y - gStair.x);          // 到两侧横向距离
      float kind = gStair.z;                                  // 边缘类型(石材/钢板/木板…)
      float sw = kind < 1.5 ? 0.16 : (kind < 2.5 ? 0.3 : (kind < 3.5 ? 0.14 : 0.12));
      base *= 1.0 - (kind < 2.5 ? 0.26 : 0.2) * (1.0 - smoothstep(0.0, sw, e));
      float mid = 1.0 - smoothstep(0.18, 0.42, abs(gStair.x / max(gStair.y, 0.01) - 0.5));   // 中线磨损带
      if (kind > 1.5 && kind < 2.5) { base *= 1.0 + 0.05 * mid; rough = mix(rough, rough * 0.78, mid); }
      if (kind < 1.5) rough = mix(rough, rough * 0.85, mid * (1.0 - gTexPaint));   // 石材磨损处被墨盖回则无效
    }
    // painted render / timber cladding: rain-washed grime streaks hanging from the top edge of each wall face
    // 粉刷墙/木板墙:每面墙顶缘往下淌的雨渍条纹(随高度指数衰减)
    if ((pid == 23 || pid == 22) && isWall) {
      float fromTop = fsz.y - fu.y;
      float st = 0.6 * vnoise(vec2(fu.x * 1.9, fromTop * 0.3 + 7.1)) + 0.4 * vnoise(vec2(fu.x * 6.3, fromTop * 0.8 + 2.3));
      float streak = smoothstep(0.5, 0.85, st) * exp(-fromTop * 0.75);
      base *= 1.0 - 0.2 * streak;
      rough = mix(rough, 0.9, streak * 0.6);
    }
    // boatyard: galvanised slot drain round the tug's wash-down bay (Alpha-half coordinates; the 180° twin follows)
    // 船坞:拖船冲洗区周围一圈镀锌排水槽(Alpha 半场坐标,对称的另一半自动跟随),槽盖镂空条纹 +
    // 槽唇亮边 + 槽内地面污渍 + 油滴 + 旁边车道的轮胎磨痕。一整套"这一个区域用烂了"的叙事。
    if (pid == 21 && isTop) {
      vec2 q = wp.y > 0.0 ? -wp : wp;                        // 折叠到半场
      vec2 d = abs(q - vec2(17.5, -18.4)) - vec2(4.4, 7.0);  // 矩形槽的 SDF
      float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      float e = abs(sd), aw = fwidth(e) + 1e-4;
      float chan = 1.0 - smoothstep(0.08 - aw, 0.08 + aw, e);          // 槽体
      float lip = (1.0 - smoothstep(0.105 - aw, 0.105 + aw, e)) * (1.0 - chan);   // 槽唇
      // 槽盖:沿槽走向每 2.5cm 一条缝,远处用条形平均近似(防摩尔纹)
      float run = d.x > d.y ? q.y : q.x;
      float fw = fwidth(run) + 1e-5;
      float slot = smoothstep(0.3 - fw / 0.025, 0.3 + fw / 0.025, abs(fract(run / 0.025) - 0.5) * 2.0);
      float bar = mix(0.4, slot, clamp(0.025 / (fw * 4.0) - 0.5, 0.0, 1.0));
      base = mix(base, mix(vec3(0.025), vec3(0.34, 0.35, 0.36), bar), chan);
      base = mix(base, vec3(0.4, 0.41, 0.42) * (0.9 + 0.2 * fine), lip * 0.85);
      rough = mix(rough, 0.48, max(chan * bar, lip));
      gTexORM.b = mix(gTexORM.b, 0.75, max(chan * bar, lip));   // 镀锌金属
      gTexStr *= 1.0 - max(chan, lip);
      base *= mix(vec3(1.0), vec3(0.94, 0.9, 0.87), step(sd, -0.105) * 0.8);   // the bay floor: darker, run-off stained
      // world-scale (non-repeating) oil drips and a worn service-lane wheel track beside the bay
      float oilW = smoothstep(0.68, 0.88, 0.65 * vnoise(q * 0.9 + 13.1) + 0.35 * vnoise(q * 3.1 + 2.7));
      base *= 1.0 - 0.26 * oilW * (1.0 - chan);
      rough = mix(rough, 0.62, oilW * 0.5);
      float tx = q.x - (12.15 + 0.25 * sin(q.y * 0.37));
      float track = (1.0 - smoothstep(0.1, 0.17, min(abs(tx - 0.85), abs(tx + 0.85)))) * step(q.y, -7.6) * (0.5 + 0.5 * vnoise(q * vec2(1.3, 0.35)));
      base *= 1.0 - 0.1 * track;
      rough = mix(rough, rough * 0.85, track);
    }
  }
  // ============================ 旧版程序化图案链 ============================
  // 纹理库(USE_TEXLIB)出现之前,每种图案都是这里的一段手写程序化纹理(数学画混凝土/瓷砖/木板…)。
  // 现在默认走纹理库分支,这条链通过 if(false) 编译排除保留在源码里,作为无纹理库构建的降级路径
  // 和"这些图案曾经长什么样"的参考。
  if (false) { if (pattern < 0.5) {   // legacy procedural chain below is compiled out of use
#else
  base *= 0.93 + 0.1 * big;
  if (pattern < 0.5) {
#endif
    // plain painted concrete
    base *= 0.97 + 0.05 * fine;
  } else if (pattern < 1.5) {
    // deck: 2 m concrete slabs with dark joints, tone per slab, speckle
    vec2 cell = floor(fu / 2.0);
    base *= 0.95 + 0.08 * h21(cell);
    float j = max(gridLine(fu.x, 2.0, 0.018), gridLine(fu.y, 2.0, 0.018));
    base *= 1.0 - 0.28 * j;
    base *= 0.96 + 0.06 * step(0.93, h21(floor(fu * 22.0)));
    // painted court markings: centre ring + halfway line (slightly worn)
    float rr = length(vWPos.xz);
    float wr = fwidth(rr);
    float mark = 1.0 - smoothstep(0.09 - wr, 0.09 + wr, abs(rr - 9.5));
    float wz = fwidth(vWPos.z);
    mark = max(mark, (1.0 - smoothstep(0.07 - wz, 0.07 + wz, abs(vWPos.z))) * step(9.5, abs(vWPos.x)));
    mark *= 0.75 + 0.25 * step(0.35, vnoise(vWPos.xz * 6.0));
    if (vWNorm.y > 0.5) base = mix(base, vec3(0.97, 0.96, 0.92), mark * 0.9);
    rough = 0.86;
  } else if (pattern < 2.5) {
    // tiles: 0.5 m tiles with lighter grout
    vec2 cell = floor(fu / 0.5);
    base *= 0.94 + 0.09 * h21(cell + 3.1);
    float j = max(gridLine(fu.x, 0.5, 0.012), gridLine(fu.y, 0.5, 0.012));
    base = mix(base, base * 0.78 + 0.08, j);
    rough = 0.6;
  } else if (pattern < 3.5) {
    // concrete wall: formwork bands + tie holes + low grime
    float band = gridLine(fu.y, 1.2, 0.01);
    base *= 1.0 - 0.14 * band;
    vec2 tp = vec2(fract(fu.x / 1.2) - 0.5, fract(fu.y / 1.2 - 0.25) - 0.5) * 1.2;
    base *= 1.0 - 0.35 * (1.0 - smoothstep(0.02, 0.035, length(tp)));
    base *= 0.94 + 0.06 * smoothstep(0.0, 0.9, fu.y);
    rough = 0.9;
  } else if (pattern < 4.5) {
    // ramps: grip grooves + yellow safety edges
    float g = gridLine(fu.y, 0.35, 0.02);
    base *= 1.0 - 0.18 * g;
    float edge = 1.0 - smoothstep(0.16, 0.2, min(fu.x, fsz.x - fu.x));
    if (vWNorm.y > 0.5) base = mix(base, vec3(0.93, 0.72, 0.12), edge * 0.95);
    rough = 0.75;
  } else if (pattern < 5.5) {
    // shipping container: vertical corrugation ribs
    float rib = sin(fu.x / 0.28 * 6.2831);
    gRib = rib;
    base *= 0.92 + 0.1 * rib;
    float frame = 1.0 - smoothstep(0.08, 0.1, min(min(fu.y, fsz.y - fu.y), min(fu.x, fsz.x - fu.x)));
    base = mix(base, base * 0.7, frame);
    base *= 0.95 + 0.07 * fbm(fu * vec2(3.0, 0.7));
    rough = 0.55;
  } else if (pattern < 6.5) {
    // wood planks
    float pl = gridLine(fu.y, 0.26, 0.008);
    float plank = floor(fu.y / 0.26);
    float grain = fbm(vec2(fu.x * 0.7 + h21(vec2(plank)) * 30.0, fu.y * 18.0));
    base *= 0.84 + 0.22 * grain;
    base *= 1.0 - 0.35 * pl;
    float frame = 1.0 - smoothstep(0.1, 0.12, min(min(fu.y, fsz.y - fu.y), min(fu.x, fsz.x - fu.x)));
    base = mix(base, base * 0.82, frame * step(fsz.x, 3.0) * step(fsz.y, 3.0));
    rough = 0.78;
  } else if (pattern < 7.5) {
    // metal railing: brushed + rivets
    base *= 0.92 + 0.08 * vnoise(vec2(fu.x * 40.0, fu.y * 1.5));
    vec2 rp = vec2(fract(fu.x / 0.8) - 0.5, fu.y - fsz.y + 0.12) * vec2(0.8, 1.0);
    base *= 1.0 - 0.3 * (1.0 - smoothstep(0.02, 0.03, length(rp)));
    rough = 0.45;
  } else if (pattern < 8.5) {
    // spawn deck: tiles + chevron hazard band around the edges
    vec2 cell = floor(fu / 0.6);
    base *= 0.95 + 0.06 * h21(cell + 7.7);
    float j = max(gridLine(fu.x, 0.6, 0.01), gridLine(fu.y, 0.6, 0.01));
    base *= 1.0 - 0.15 * j;
    float e = min(min(fu.x, fsz.x - fu.x), min(fu.y, fsz.y - fu.y));
    float band = 1.0 - smoothstep(0.34, 0.36, e);
    float chev = step(0.5, fract((fu.x + fu.y) * 1.6));
    if (vWNorm.y > 0.5) base = mix(base, mix(vec3(0.95, 0.76, 0.1), vec3(0.12), chev), band * step(0.05, e));
    rough = 0.65;
  } else if (pattern > 9.5 && pattern < 10.5) {
    if (abs(vWNorm.y) < 0.5) {
      // slab edges / trench walls read as poured concrete
      base = base * 1.18 * (0.95 + 0.05 * fine);
      base *= 1.0 - 0.12 * gridLine(fu.y, 1.2, 0.01);
      rough = 0.9;
    } else {
      base *= 0.92 + 0.08 * vnoise(fu * 3.0) + 0.04 * (vnoise(fu * 37.0) - 0.5) * (1.0 - smoothstep(0.02, 0.06, length(fwidth(fu))));
      rough = 0.92;
    }
  } else if (pattern > 10.5 && pattern < 11.5) {
    // painted steel panels: 1.2 m panels with seams + bolt rows
    float seam = max(gridLine(fu.x, 1.2, 0.008), gridLine(fu.y, 1.2, 0.008));
    base *= 1.0 - 0.22 * seam;
    base *= 0.95 + 0.06 * fbm(fu * 1.3);
    rough = 0.5;
  } else if (pattern > 11.5 && pattern < 12.5) {
    base *= 0.9;
    rough = 0.45;
  } else if (pattern > 15.5 && pattern < 16.5) {
    // pavers: 2 m slabs
    vec2 cell = floor(fu / 2.0);
    base *= 0.95 + 0.07 * h21(cell + 1.3);
    float j = max(gridLine(fu.x, 2.0, 0.02), gridLine(fu.y, 2.0, 0.02));
    base *= 1.0 - 0.25 * j;
    rough = 0.84;
  } else if (pattern > 12.5) {
    base *= 0.95 + 0.05 * fine;
    rough = 0.7;
  } else {
    // planter: stone rim with grass bed on top
    float e = min(min(fu.x, fsz.x - fu.x), min(fu.y, fsz.y - fu.y));
    float bed = smoothstep(0.24, 0.27, e) * step(0.5, vWNorm.y);
    vec3 grass = vec3(0.32, 0.55, 0.22) * (0.8 + 0.35 * fbm(fu * 6.0));
    base = mix(base * (0.95 + 0.05 * fine), grass, bed);
    rough = mix(0.8, 0.95, bed);
  }
#ifdef USE_TEXLIB
  }
#endif
  // ============================ 壁画 / 招牌 ============================
  // faceFlags.z = 壁画 id(-1 = 无)。按面的实际尺寸把壁画图集的矩形铺到面上,
  // 支持横向重复(mB.y<0 时按面高倍数重复)和满铺(mB.w<=0 时纵向拉满)。
  // 风化:地表纹理调制(gTexMod)和墨覆盖(gTexPaint)都会让壁画"斑驳脱落"。
  if (vFaceFlags.z > -0.5) {
    // atlas rect (mA) + placement on the face in metres (mB: x0, xLen, y0, yLen; xLen < 0 = strip repeating every
    // -xLen face heights, yLen <= 0 = full face height) + weathering (mC: surface shows through, paint damage cuts it)
    int mi = int(vFaceFlags.z + 0.5);
    vec4 mA = uMurA[mi], mB = uMurB[mi];
    vec2 mC = uMurC[mi];
    float my = mB.w > 0.0 ? (fu.y - mB.z) / mB.w : fu.y / fsz.y;
    float mx = mB.y < 0.0 ? fu.x / (-mB.y * fsz.y) : clamp((fu.x - mB.x) / mB.y, 0.0005, 0.9995);
    vec2 muv = vec2(mA.x + mA.y * mx, mA.z + mA.w * clamp(my, 0.004, 0.996));
    vec4 mc = texture2D(uMural, muv);
    mc.rgb *= mix(vec3(1.0), gTexMod, mC.x);
    mc.a *= mix(1.0, gTexPaint, mC.y);
    base = mix(base, mc.rgb * (0.92 + 0.1 * big), mc.a * 0.96);
  }
  // 模型棱线:边缘用几何倒角表达(曾经的"画亮边"做法会在面片堆叠处画出假缝,已废弃,ew 保留未用)
  // crisp modelled edges: thin bright chamfer + soft inner shadow
  float e = min(min(fu.x, fsz.x - fu.x), min(fu.y, fsz.y - fu.y));
  float ew = fwidth(e);
  // (edges are real bevel geometry now; the old painted chamfer lines drew seams where faces stack)
  // contact darkening at the foot of walls that stand on something
  // 落地墙脚(faceFlags.x∧y):从地面向上 0.85m 内一道接触压暗,让墙"踩"在地上
  if (vFaceFlags.x > 0.5 && vFaceFlags.y > 0.5) {
    base *= mix(0.55, 1.0, smoothstep(0.0, 0.85, fu.y));
  }
  gBaseRough = rough;   // 地表粗糙度定案,交给 INK_ROUGH 当混合基底

  // ---- wet ink (src/world/inkShading.js) ----
  // ★ 湿墨层:INK_COLOR 读图集、算颜色、混合 base(详见 inkShading.js 的注释)
${INK_COLOR}
  diffuseColor.rgb = base;
}`)
      // roughnessmap 锚点:地表粗糙度之后,让湿墨层改写(干墨哑光 → 新墨绸缎,见 inkShading)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
${INK_ROUGH}`)
      // metalness 锚点:纹理库材质的金属度来自 ORM.b;有墨处金属度清零(颜料是非金属)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef USE_TEXLIB
metalnessFactor = gTexORM.b * (1.0 - gInk);
#endif`)
      // ============================ normal_fragment_maps:法线总装 ============================
      // 把三个来源的"面内斜率"合成最终法线:
      //   ① gInkD      —— 湿墨高度场(弯月唇/两军交界,来自 INK_COLOR)
      //   ② INK_GEL    —— 凝胶微表面(inkShading)
      //   ③ 游泳尾迹    —— 下面的 4 泳者 × 12 点循环(鱿鱼游过墨面推起的水丘/涟漪)
      //   ④ INK_SLOPE  —— 冲击涟漪表(inkShading,跟在尾迹之后)
      // 最后:slope → 世界切线架 → 减出扰动法线;有纹理库时再混入地表纹理法线。
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // slopes along the face's u / v axes (height per unit length), applied in the face's world tangent frame
  vec2 slope = gInkD;
${INK_GEL}
#ifndef USE_TEXLIB
  // 无纹理库:集装箱波纹板的解析波纹(只在没墨的地方,×(1-gInk))
  if (vFaceData.x > 4.5 && vFaceData.x < 5.5) {
    // corrugation on containers (only where not inked), analytic derivative
    slope.x += (1.0 - gInk) * -sin(vFaceUv.x / 0.28 * 6.2831) * 0.35;
  }
#endif
  // 面的世界切线架:T = U 方向(投影到面平面),Bt = 法线 × T
  vec3 T = normalize(vFaceTan - vWNorm * dot(vFaceTan, vWNorm));
  vec3 Bt = cross(vWNorm, T);
  if (gInk > 0.01) {
    // swim wakes: the ink itself ripples where a squid swims. Each trail segment sheds an expanding ripple (a stadium
    // around the path — their envelope opens into the V-wake) and the submerged body pushes up a glossy mound with a
    // small bow ridge at speed. Height field → analytic gradient in the face's tangent plane.
    // 【游泳尾迹】鱿鱼形态在墨里游过时,12 点轨迹上每段都在"脱"一个扩散涟漪(体育场形包络,
    // 连成 V 形尾流);身体本身推起一个小水丘,速度快时头部前方还有船艏脊。
    vec3 wS = vec3(0.0); float wG = 0.0;
    for (int s = 0; s < 4; s++) {
      vec4 Bd = uWakeB[s];
      // 粗剔除:本像素不在该泳者的包围球里就整段跳过(4 泳者 × 11 段的成本被限制在墨面的小区域)
      if (Bd.w <= 0.0 || distance(vWPos, Bd.xyz) > Bd.w) continue;
      for (int i = 0; i < 11; i++) {
        vec4 A0 = uWake[s * 12 + i], A1 = uWake[s * 12 + i + 1];
        if (A0.w < -1.0 || A1.w < -1.0) continue;   // 空点/断点
        // 本像素到轨迹段的最近点参数 t 与垂距 D(投到面平面)
        vec3 ab = A1.xyz - A0.xyz;
        float t = clamp(dot(vWPos - A0.xyz, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        float age = uTime - mix(A0.w, A1.w, t);     // 该段"出生"多久了
        if (age <= 0.0 || age > 1.15) continue;
        vec3 D = vWPos - (A0.xyz + ab * t);
        D -= vWNorm * dot(D, vWNorm);
        float d = length(D);
        // 波前半径随 age 扩散(0.1+0.95·age 米),波包宽度同步变宽;|x|>3σ 的环带跳过
        float r = 0.1 + age * 0.95, w = 0.075 + age * 0.085;
        float x = d - r;
        float env = exp(-x * x / (w * w));
        if (env < 0.003) continue;
        // 与 INK_SLOPE 相同的"高斯包络 × 余弦载波"波包,解析导数得坡度;1.15s 寿命内 (1-t/T)² 淡出
        float fade = 1.0 - age / 1.15;
        fade *= fade * smoothstep(0.0, 0.05, age);
        float amp = 0.0135 * fade;
        float dh = amp * env * (-2.0 * x / (w * w) * cos(x * 25.0) - 25.0 * sin(x * 25.0));
        wS += D * (dh / max(d, 1e-4));
        wG += env * fade * 0.6;
      }
      // 身体水丘:头位置 H(在场才推),沿游向 Fp 拉伸的高斯丘(速度越快越长),头部前方 0.3m 一道船艏脊
      vec4 H = uSwimH[s], F = uSwimF[s];
      if (H.w > 0.002) {
        vec3 D = vWPos - H.xyz;
        D -= vWNorm * dot(D, vWNorm);
        vec3 Fp = F.xyz - vWNorm * dot(F.xyz, vWNorm);
        float fl = length(Fp);
        Fp = fl > 1e-3 ? Fp / fl : T;
        float al = dot(D, Fp);          // 沿游向坐标
        vec3 Cv = D - Fp * al;          // 横向向量
        float ac = length(Cv);
        vec3 Cn = Cv / max(ac, 1e-4);
        // mound over the body (sits a touch behind the head, stretches with speed)
        // am: 丘心略落后于头;La/Lc: 沿向/横向半长(速度拉伸);两个高斯的乘积 = 椭圆丘
        float am = al + 0.1, La = 0.3 + 0.2 * F.w, Lc = 0.19;
        float hm = 0.05 * H.w * exp(-(am * am) / (La * La) - (ac * ac) / (Lc * Lc));
        // bow ridge pushed ahead of the head
        float ab2 = al - 0.3, hb = 0.022 * H.w * F.w * exp(-(ab2 * ab2) / 0.012 - (ac * ac) / 0.07);
        // 解析梯度:沿向分量(am 求导)+ 横向分量(ac 求导),wG 记录亮度
        wS += Fp * (-2.0 * am / (La * La) * hm - 2.0 * ab2 / 0.012 * hb) + Cn * (-2.0 * ac / (Lc * Lc) * hm - 2.0 * ac / 0.07 * hb);
        wG += hm * 16.0 + hb * 20.0;
      }
    }
    // clamp the slope so crests never flip the normal; fade with distance like the gel (no shimmer on far floors)
    // 限幅(0.9)防 crest 翻转法线;远处按 fwidth 淡出(和凝胶/涟漪同款防闪策略)
    float wl = length(wS);
    if (wl > 0.9) wS *= 0.9 / wl;
    float wFar = 1.0 - smoothstep(0.05, 0.16, length(fwidth(vWPos)));
    slope += vec2(dot(wS, T), dot(wS, Bt)) * gInk * wFar;
    gWake = clamp(wG, 0.0, 1.0) * gInk * wFar;
  }
${INK_SLOPE}
  // ---- 地表纹理法线 + 湿墨浮雕的最终合成 ----
  vec3 nBase = vWNorm;
#ifdef USE_TEXLIB
  // surface relief from the texture library; ink fills the grooves so the relief fades out under it
  // (on corrugated metal the ink still follows the ribs)
  // 墨会"填满"地表凹槽 → 墨下的纹理浮雕按 gInk 衰减;但集装箱波纹板(keep 0.55)和楼梯
  // (gTexKeep)例外:墨顺着波纹/踏步走,浮雕保留
  float keep = max((vFaceData.x > 4.5 && vFaceData.x < 5.5) ? 0.55 : 0.0, gTexKeep);   // containers + stairs
  nBase = texlibPerturbNormal(gTexN, T, Bt, vWNorm, gTexStr * (1.0 - gInk * (1.0 - max(keep, gInkKeep))));
#endif
  // slope 沿切线架折回世界法线:wn = 基础法线 − 坡度扰动;再转回视线空间交给 three.js 光照
  vec3 wn = normalize(nBase - slope.x * T - slope.y * Bt);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`)
      // 街灯光池:场景原有光源算完后,追加 12 盏"伪点光"(仅池内像素付费,见文件头 LAMP_LIGHTS 注释)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>${LAMP_LIGHTS}`)
      // 湿墨暗部补偿(inkShading INK_SHADE:阴影里更浓、不发褐)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>${INK_SHADE}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
if (uAO > 0.0 && vLightUv.x >= 0.0) {
  // baked ambient occlusion: full on sky/indirect light, a touch on the sun so contact shadows read in daylight
  // 烘焙 AO 的三种光分量吃不同程度:间接光全吃、镜面反射吃 85%、直射阳光只吃 40%
  // (白天阳光下接触阴影要"读得出来"但不能过重)
  float bao = mix(1.0, texture2D(uLight, vLightUv).r, uAO);
  reflectedLight.indirectDiffuse *= bao;
  reflectedLight.indirectSpecular *= mix(1.0, bao, 0.85);
  reflectedLight.directDiffuse *= mix(1.0, bao, 0.4);
}`)
      // 清漆法线 = 主法线:湿墨层高光与颜料共享同一微表面,不另设 clearcoat 法线扰动
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
clearcoatNormal = normal;`)
      // 墨自发光保底(inkShading INK_EMISSIVE)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${INK_EMISSIVE}`)
      // 湿清漆层参数(inkShading INK_LIGHTS:clearcoat 强度/粗糙度/压平的 Fresnel)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>${INK_LIGHTS}`)
      // 环境光/反射修正(inkShading INK_LIGHT_MAPS:阴影区保色相、湿反射中性+透色)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>${INK_LIGHT_MAPS}`)
      // 色调钳制:outgoingLight 封顶 5.0 —— 湿墨高光 + 街灯 + 自发光叠加后防止 HDR 爆值,
      // 否则 bloom 后处理会糊成一片
      .replace('#include <opaque_fragment>', `outgoingLight = min(outgoingLight, vec3(5.0));
#include <opaque_fragment>`);
  };
  // ---- 格栅材质变体(opts.grate,排水沟盖板等) ----
  if (opts.grate) {
    mat.side = THREE.DoubleSide;   // 镂空板从下面也要看得见
    mat.defines = { ...(mat.defines || {}), GRATE: 1 };
  }
  // 【重要】程序缓存键:onBeforeCompile 改了着色器源码,但 three.js 的程序缓存默认只看
  // 材质类型 + 少量参数。这个键相当于"注入代码的版本号"——每次改动注入的 GLSL 都要 bump 'v6',
  // 否则旧程序被缓存复用:改了代码画面却不变,排查时非常迷惑。grate 变体用后缀区分另一套程序。
  mat.customProgramCacheKey = () => 'inkwave-level-v6' + (opts.grate ? '-grate' : '');
  return mat;
}
