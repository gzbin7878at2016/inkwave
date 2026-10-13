// ============================================================================
// 【中文导读】Sponge Mitts(海绵拳套)主武器 kit 的"建模"层:程序化生成手持拳套网格与它的海绵材质/部件动画。
// ----------------------------------------------------------------------------
// 【模块定位】属于 src/game/kits/ 武器内容层,是 mitts 三文件分工中的一环:
//   · mitts-model.js —— 本文件,建模:buildMitts() 出几何、makeSpongeMaterial() 出材质、animateMitts() 出部件动画;
//     顶层 registerWeaponModel('mitts', …) 把三者交给角色武器系统(见 ../character-weapons.js)。
//   · mitts-assets.js —— 资产层:HUD 图标与音效(本文件不依赖它)。
//   · mitts.js      —— 逻辑层:开火/蓄力/起跳/贴墙行为,并把运行期状态塞进 runner.kit,供这里的动画读取。
// 【核心机制】
//   · 拳套 [pad](海绵主体)+[thumb](拇指)+[cuff](袖口)+腕带+徽章;pad 单独作为一个 part,便于按部件做挤压/膨胀。
//   · dual:true —— 同一份几何体出现在左/右两只手上(geometry 对称于 X,不得偏向任一侧)。
//   · 材质 makeSpongeMaterial():onBeforeCompile 往 three.js MeshPhysicalMaterial 里注入自写 GLSL,
//     用 Worley 噪声造"海绵毛孔"(压暗+变糙+屏幕空间凹凸),外加 uGlow 蓄力发光、uSoak 吸水程度。
//   · 部件动画 animateMitts(w, st):用精确阻尼弹簧(spring)驱动 pad 沿 +Z 的挤压,表现出拳/蓄力/贴墙。
// 【关键约定】· 武器空间:原点=握把中心,+Z=出拳面,+Y=上(拇指方向),X 横跨;见本文件英文头注释与 character-weapons.js。
//   · 单位:米、秒、弧度;时间 dt 被钳到 ≤0.1 防止大帧跳变。
//   · LOD:near/far 两套 mesh,由 st.near 切换显隐(远看用合并的 ink 版本)。
//   · PAD_PIVOT 是 pad↔cuff 的接缝点,pad 的缩放绕它进行,使袖口处不脱离。
// 【配套阅读】docs/ASSETS-WEAPONS.zh-CN.md(§2 建模四手法、§3 握把孔对位)、../character-geo.js(superEllipsoid/lathe)、
//   ../character-weapons.js(GEO_KIT、registerWeaponModel、animateWeapon 契约)、同目录 mitts.js。
// ============================================================================
// Sponge Mitts — the held model: a pair of squishy ink-soaked sponge boxing gloves (one per fist, dual wield), their
// part animation (each glove squashes on its own punch, both swell and glow while a leap charges, the left one flattens
// against the wall while clinging) and the procedural sponge material (pores + wet sheen in the team's ink).
//
// Weapon space (character-weapons.js): grip at the origin, +Z = the punching face, +Y = up (the thumb), X across.
// The squidkid fist closes round a vertical handle there (a vertical-fist punch), so the glove is modelled as a shell
// round the fist: pad from z ≈ -0.055 (behind the knuckles) to +0.08 (the face), cuff over the wrist behind it. The
// model is symmetric in X — the same geometry sits in both fists (`dual: true`), so nothing may favour one side.
import * as THREE from 'three';
import { superEllipsoid, lathe, smoothProfile } from '../character-geo.js';
import { registerWeaponModel, GEO_KIT } from '../character-weapons.js';

const { Parts, C, M, latheZ, torus, at, deformG, decal, placeXY, squidShape } = GEO_KIT;
const V3 = THREE.Vector3;
// gauss:标准高斯钟形 x→[0,1],用来给"指节隆起""侧腹微鼓"做局部、平滑的形变权重。
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
// PAD_PIVOT:pad 与袖口的接缝位置(武器空间 z≈-0.034);animateMitts 里 pad 的挤压/膨胀绕它缩放,避免袖口脱节。
const PAD_PIVOT = new V3(0, 0, -0.034);   // pad ↔ cuff seam: the pad squashes / swells about it

// buildMitts:一次性程序化生成整只拳套的几何,返回武器描述对象(供 registerWeaponModel 挂手)。
// 返回值里的 gripR/gripL 声明握把位姿,dual:true 表示左右手共用同一几何;
// parts.pad 把海绵主体分离出来(材质:近处用 sponge 材质,远处并入 ink LOD)。
function buildMitts() {
  // 三个 Parts 收集器:P=主体(奶油色袖口等),I=队伍色 ink 件,PAD=单独分离的海绵主体(材质可替换)。
  const P = new Parts(), I = new Parts(), PAD = new Parts();
  // 【海绵主体 pad】超椭圆体(sponge 肉感)经多层回调塑形:正面压扁成打击面、后段收窄接袖口、
  // 顶部隆起成指节、侧腹微鼓;superEllipsoid 的 e1/e2 指数越低越方,这里取 0.7/0.66 得到"圆中带方"的海绵块。
  // ---- the pad: a fat rounded sponge mitt, flattened punching face, knuckle roll on top, tapering into the cuff
  const pad = superEllipsoid(0.071, 0.064, 0.077, 0.7, 0.66, 44, 32, (q) => {
    if (q.z > 0.031) q.z = 0.031 + (q.z - 0.031) * 0.72;                        // flatter punching face
    if (q.z < -0.02) { const t = Math.min(1, (-0.02 - q.z) / 0.057); q.x *= 1 - 0.14 * t; q.y *= 1 - 0.11 * t; }
    q.y += 0.007 * gauss(q.z - 0.04, 0.02) * Math.max(0, q.y / 0.064);           // knuckle roll
    q.x *= 1 + 0.05 * gauss(q.y + 0.01, 0.033) * gauss(q.z - 0.022, 0.044);        // a little belly on the flanks
  });
  PAD.add(at(pad, 0, 0.004, 0.02), C.cream);
  // 【拇指】握拳是竖拳(拳心朝内),故拇指压在拳顶;指尖向前下卷、根部粗,融进 pad 不显接缝。
  // thumb: lies along the top of the fist (vertical-fist grip → the thumb is on top), fused into the pad
  const thumb = superEllipsoid(0.024, 0.021, 0.041, 0.8, 0.78, 22, 14, (q) => {
    q.y -= 0.013 * ((q.z + 0.041) / 0.082) ** 2;                               // tip curls down onto the face
    q.x *= 1 - 0.18 * Math.max(0, q.z / 0.041);
  });
  thumb.rotateX(0.12);
  PAD.add(at(thumb, 0, 0.062, 0.012), C.cream);
  // 【渗出的墨】三滴大小不一的胖墨滴挂在拳套下缘、朝袖口方向;y<0 处横向放大(k 随深度)制造下坠的水滴尖。
  // ink welling out of the sponge: three fat drips hanging off the lower rim toward the cuff
  for (const [x, y, z, s] of [[0.032, -0.048, -0.03, 1], [-0.024, -0.054, -0.02, 0.8], [0.0, -0.061, -0.01, 0.9]]) {
    const d = superEllipsoid(0.0085 * s, 0.017 * s, 0.0085 * s, 0.9, 1, 10, 8, (q) => { if (q.y < 0) { const k = 1 + 0.35 * (-q.y / (0.017 * s)); q.x *= k; q.z *= k; } });
    PAD.add(at(d, x, y, z), C.cream);
  }
  // 【袖口 cuff】latheZ 把二维轮廓绕 Z 轴车削成回转体:一段粗短的奶油色袖套,开口处卷边;前臂从后端穿入。
  // smoothProfile 对折线做平滑,latheZ 车削;satin 材质给出布料的柔光。
  // ---- cuff: a stubby cream sleeve over the wrist with a rolled opening; the forearm goes in through the back
  const cuff = latheZ(smoothProfile([
    [0.041, -0.03], [0.05, -0.036], [0.056, -0.05], [0.057, -0.09], [0.0595, -0.112], [0.0605, -0.122], [0.057, -0.128],
    [0.05, -0.126], [0.047, -0.118], [0.045, -0.09], [0.044, -0.05],
  ], 30), 30);
  P.add(cuff, C.cream, M.satin);
  // 【卷边与接缝】两圈 torus:袖口开口卷边(bone 色)与海绵/袖套的交界缝(darker 色)。
  // rolled rim + seam where the sponge meets the sleeve
  P.add(at(torus(0.0585, 0.0042, 6, 30), 0, 0, -0.123), C.bone, M.satin);
  P.add(at(torus(0.0532, 0.0038, 5, 30), 0, 0, -0.034), C.darker, M.satin);
  // 【腕带】深色橡胶圈箍住袖套,顶部一条魔术贴(把 tab 的顶点按半径重映射成贴着圆柱面),两个金属铆钉;
  // I.add(...) 的那圈 torus 归入 ink 部分,会随队伍色变化。
  // wrist strap: dark rubber band round the sleeve, a velcro tab over the top, team-ink stripe near the rim
  P.add(at(latheZ(smoothProfile([[0.0572, -0.064], [0.0612, -0.066], [0.0618, -0.08], [0.0612, -0.094], [0.0572, -0.096]], 10), 30), 0, 0, 0), C.rubber, M.rubber);
  const tab = superEllipsoid(0.022, 0.0048, 0.018, 0.4, 0.45, 12, 5, (q) => { const r = 0.0615 + q.y; const a = q.x / 0.0615; q.x = Math.sin(a) * r; q.y = Math.cos(a) * r - 0.0615; });
  P.add(at(tab, 0, 0.0625, -0.08), C.dark, M.gloss);
  for (const sx of [1, -1]) P.add(at(superEllipsoid(0.0022, 0.0022, 0.0022, 1, 1, 6, 4), sx * 0.015, 0.0672, -0.08), C.metal, M.metal);
  I.add(at(torus(0.0588, 0.0026, 5, 30), 0, 0, -0.106));
  // 【乌贼徽章】squidShape 生成的贴花(decal)用 placeXY 投到袖套左右两侧(x=±,严格对称);
  // 因为 dual:true,两侧都要有,才不论戴哪只手都朝向正确。
  // squid badge on both flanks of the sleeve (x = ±, symmetric) + a hazard chevron pair under it
  for (const sx of [1, -1]) {
    const sq = decal(squidShape(0.026));
    placeXY(sq, new V3(0, 0, sx), new V3(0, 1, 0), new V3(sx * 0.0612, 0.004, -0.08));
    P.add(sq, C.decal, M.print);
  }
  // 【内握杆】拳心始终包住的一小段圆柱(几乎看不见),保留它是为了远 LOD 合并时不吃出空洞;做得很小省面数。
  // ---- inner grip bar (never seen: the fist closes round it) — kept tiny so the far LOD has no holes
  P.add(latheZ([[0, -0.03], [0.012, -0.03], [0.012, 0.03], [0, 0.03]], 8).rotateX(Math.PI / 2), C.darker, M.rubber);
  // PAD.build() 把海绵主体单独烘焙成一份几何(padG),下方作为独立 part 交出。
  const padG = PAD.build();
  return {
    kind: 'mitts', body: P.build(), ink: I.build(),
    // 【pad 独立成件】近处给它换成 sponge 材质(见 animateMitts),远处则并回队伍色 ink LOD,pivot 设为接缝点。
    // the sponge pad is its own part (team sponge material near, merged into the ink far LOD)
    parts: { pad: { src: padG, pivot: PAD_PIVOT.clone(), mat: 'ink' } },
    // muzzle:出拳点/墨口位置(武器空间),供 mitts.js 生成拳头弹道与粒子时取用。
    muzzle: new V3(0, 0.006, 0.088),
    // gripR/gripL:左右手握把位姿(pos 在手骨局部;handZ/handY 定义武器轴向),两边相同 = 竖拳同姿。
    gripR: { pos: new V3(0, 0, 0), handZ: new V3(0, 1, 0), handY: new V3(0, 0, -1) },
    gripL: { pos: new V3(0, 0, 0), handZ: new V3(0, 1, 0), handY: new V3(0, 0, -1) },
    // dual:true —— 同一几何体装到两只手上(mitts 是双拳套)。
    dual: true,
    twirl: new V3(0, 0, 0),
  };
}

// ---------------------------------------------------------------------------------------------- sponge material
// 【海绵材质】用 onBeforeCompile 往标准 PBR 材质里注入自写 GLSL(见 RENDERING-UE4.zh-CN.md §3.3 的做法)。
// 下面这段 SPONGE_FRAG_PARS 是分片着色器里插入的公共函数/变量片段:
//   · spHash —— 三维哈希噪声;spPore —— 三点式 Worley(细胞)噪声,返回 [0,1] 的"毛孔"场。
//   · spPerturb —— 由屏幕空间高度梯度 dHdxy 重建扰动后的法线,做廉价凹凸(比法线贴图省一次采样)。
//   · spH/spFade —— 逐片元共享的临时量:高度值与"毛孔太小则淡出"的系数。
// Team-ink sponge: Worley pores (two octaves, object space so they ride the squash) darken + roughen the surface and
// dent it (screen-space bump, faded out once pores get smaller than a pixel); a clear wet coat on top. uGlow = the
// leap charge (the sponge soaks the ink up and glows with it).
const SPONGE_FRAG_PARS = /* glsl */`
varying vec3 vSpP;
uniform float uGlow, uSoak;
vec3 spHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float spPore(vec3 p) {
  vec3 i = floor(p), f = fract(p); float d = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + 0.1 + 0.8 * spHash(i + g) - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - smoothstep(0.02, 0.17, d);
}
vec3 spPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd) {
  vec3 sx = normalize(dFdx(surf_pos)), sy = normalize(dFdy(surf_pos));
  vec3 r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
  float det = dot(sx, r1) * fd;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surf_norm - grad);
}
float spH = 0.0, spFade = 1.0;
`;
// makeSpongeMaterial:构造一只海绵材质(MeshPhysicalMaterial 基座:低粗糙+清漆层给出湿亮感)。
// U(uGlow/uSoak)是暴露给动画的 uniform;onBeforeCompile 在编译期把上面的 GLSL 片段与几处 include 缝合。
export function makeSpongeMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.18, sheen: 0.5, sheenRoughness: 0.45, sheenColor: 0xffffff, name: 'iw-sponge' });
  const U = { uGlow: { value: 0 }, uSoak: { value: 1 } };
  m.userData.u = U;
  // onBeforeCompile:拼接 three.js 内置着色器。顶点阶段把对象空间坐标 position 经 vSpP 传到片元;
  // 片元阶段在 color_fragment 处压暗毛孔、在 roughnessmap_fragment 处增糙、在 normal_fragment_maps 处做凹凸、
  // 在 emissivemap_fragment 处叠加蓄力发光。各 replace 锚点都是 three.js 稳定 include 名,顺序即渲染管线顺序。
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SPONGE_FRAG_PARS)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 q = vSpP * 92.0;
          spFade = 1.0 - smoothstep(0.35, 0.9, length(fwidth(q)));
          spH = (spPore(q) + 0.55 * spPore(q * 2.1 + 3.7)) * spFade;
          diffuseColor.rgb *= 1.0 - 0.42 * clamp(spH, 0.0, 1.0) * uSoak;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = min(1.0, roughnessFactor + 0.45 * clamp(spH, 0.0, 1.0));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = spPerturb(-vViewPosition, normal, vec2(dFdx(spH), dFdy(spH)) * 0.55, faceDirection);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuse * uGlow * (0.55 + 0.45 * (1.0 - clamp(spH, 0.0, 1.0)));`);
  };
  // 【为什么固定 cacheKey】onBeforeCompile 改过的材质若用默认 key,three.js 可能和未改版本共用一次编译结果;
  // 给一个唯一字符串确保"注入过的着色器"独占一个 program,避免与其它 PBR 材质串味。
  m.customProgramCacheKey = () => 'iw-sponge-1';
  return m;
}

// ---------------------------------------------------------------------------------------------- part animation
// 【部件动画】animateMitts 每帧被角色武器系统调用(契约见 character-weapons.js 的 animateWeapon)。
// st 携带时间、LOD、队伍色、手别等;跑手的 kit 状态(kits/mitts.js 里的 runner.kit.mitts)告诉这里拳套在干什么。
// st: see character-weapons.js animateWeapon. The runner's kit state (kits/mitts.js) says what the gloves are doing.
const _white = new THREE.Color(1, 1, 1);
// pulse:一条"先线性冲上、再指数衰减"的脉冲曲线——t<0 未触发为 0;用于把单次事件(出拳/落地)变成短促的动画冲量。
const pulse = (t, atk, dec) => (t < 0 ? 0 : t < atk ? t / atk : Math.exp(-(t - atk) * dec));
// spring:精确(解析解)阻尼弹簧积分,把标量 S[i] 拉向 target;S[i] 是位置、S[i+1] 是速度,hz=固有频率、zeta=阻尼比。
// 【为什么用解析解】与逐步显式积分相比,大 dt 下也稳定,不会因帧率抖动而过冲/爆掉;出拳的回弹因此可复现。
function spring(S, i, target, hz, zeta, dt) {   // exact damped spring (see character-weapons sprE)
  const w = Math.PI * 2 * hz, x0 = S[i] - target, v0 = S[i + 1];
  const wd = w * Math.sqrt(1 - zeta * zeta), e = Math.exp(-zeta * w * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt), B = (v0 + zeta * w * x0) / wd;
  S[i] = e * (x0 * c + B * sn) + target; S[i + 1] = e * ((-zeta * w * x0 + wd * B) * c + (-zeta * w * B - wd * x0) * sn);
  return S[i];
}
// animateMitts:每帧更新拳套部件动画。要点:出拳的挤压/膨胀(弹簧)、蓄力时的膨胀+发光、贴墙时左拳压平、
// 以及 near/far LOD 切换。所有可变状态懒建在 w 上(首次调用初始化),避免每帧分配。
function animateMitts(w, st) {
  // dt 钳到 [0,0.1]:首帧或卡顿的大间隔不会把弹簧/发光积分弹飞。
  const dt = Math.min(0.1, Math.max(0, st.dt || 0));
  // 首次调用初始化:ms=弹簧状态数组([0,1]=z 挤压, [2,3]=... , [4]=发光平滑值);sponge=海绵材质;lastPunch 哨兵 99。
  if (!w.ms) { w.ms = new Float32Array(8); w.ms[0] = 1; w.ms[2] = 1; w.near = true; w.sponge = makeSpongeMaterial(); w.lastPunch = 99; }
  const S = w.ms, pad = w.parts && w.parts.pad;
  // near / far LOD (kit weapons animate themselves, LOD included)
  const near = st.near !== false;
  if (near !== w.near) {
    w.near = near;
    if (w.body) w.body.visible = near; if (w.ink) w.ink.visible = near;
    if (w.bodyFar) w.bodyFar.visible = !near; if (w.inkFar) w.inkFar.visible = !near;
    for (const g of w.partList || []) g.visible = near;
  }
  if (!pad) return;
  const mesh = pad.userData.mesh;
  if (mesh.material !== w.sponge) mesh.material = w.sponge;   // (setColor re-assigns 'ink' parts; take it back)
  const sp = w.sponge, U = sp.userData.u;
  sp.color.copy(st.color); sp.sheenColor.copy(st.color).lerp(_white, 0.5);
  const R = st.runner, K = R && R.kit && R.kit.mitts ? R.kit : null;
  const hand = st.hand || 0;
  // ts = 距离这只手上次出拳的秒数(sinceHand 由角色系统维护);它是"出拳冲量"的判据。
  const ts = R && R.sinceHand ? R.sinceHand[hand] : (st.sinceShoot ?? 99);
  // 【出拳】手套在全伸展点(~45ms)撞实:沿打击面压扁、四周鼓出、再抖回。
  // 通过 ts 较上帧变小判断"这帧新打了一拳",给弹簧一个负速度冲量 S[1]-=7.5,从而触发一次挤压回弹。
  // punch: the glove lands at full reach (~45 ms in): squash along the face, bulge round it, jiggle back
  if (ts < w.lastPunch) S[1] -= 7.5;                                      // (new punch this frame: kick the spring)
  w.lastPunch = ts;
  // 从 kit 状态取本帧的语义量:蓄力档位、是否贴墙(仅左手 hand===1)、是否跃起、落地脉冲。
  const charge = K && K.charging ? K.charge : 0;
  const cling = K && K.cling && hand === 1 ? 1 : 0;
  const leap = K && K.leaping ? 1 : 0;
  const land = K ? pulse(K.landT - 0.01, 0.02, 7) : 0;
  // wob:蓄力时给 pad 一个高频正弦抖动,频率与幅度随蓄力上升(越满抖越急),强化"要炸开"的紧张感。
  const wob = charge > 0 ? 0.022 * charge * Math.sin(st.t * (22 + 14 * charge) + hand * 1.7) : 0;
  // zT = pad 沿 +Z 的目标缩放:蓄力略鼓、贴墙压扁(-0.3)、跃起微鼓、落地明显压扁(-0.28)、再加 wob 抖动。
  const zT = 1 + 0.08 * charge - 0.3 * cling + 0.05 * leap - 0.28 * land + wob;
  // 用弹簧逼近 zT;蓄力时降低固有频率到 6Hz 让它更"软"地慢摆,其余 9Hz 干脆。zeta=0.3 略微欠阻尼以产生回弹。
  const z = spring(S, 0, zT, charge > 0 ? 6 : 9, 0.3, dt);
  // xy = 横向缩放:体积守恒的近似——被压扁(z<1)时横向鼓起;蓄力/贴墙再额外加宽。y 在贴墙时再单独略压。
  const xy = 1 + (1 - z) * 0.55 + 0.1 * charge + 0.06 * cling;
  pad.scale.set(xy, xy * (1 - 0.35 * cling * 0.5), Math.max(0.55, z));
  // 【发光】uGlow = 随蓄力累积的增长(charge 平方,后期更亮)+ 满档脉动 + 出拳瞬间闪光 + 落地余亮;
  // S[4] 用一阶低通(30Hz 时间常数)平滑目标 g,避免数值跳变造成闪烁。uSoak 满蓄力时降到 0.6(吸饱墨,毛孔变浅)。
  // glow: builds with the charge, flashes when a fist leaves, pulses at full charge
  const full = charge >= 0.999 ? 0.35 + 0.25 * Math.sin(st.t * 18) : 0;
  const g = 0.06 + 1.1 * charge * charge + full + 1.4 * pulse(ts - 0.005, 0.01, 20) + 0.8 * land;
  S[4] += (g - S[4]) * (1 - Math.exp(-dt * 30));
  U.uGlow.value = S[4];
  U.uSoak.value = 1 - 0.4 * charge;
}

// 自注册:把 buildMitts/animateMitts 挂进角色武器系统的模型表,角色装备 mitts 时按 kind 查到此二者。
registerWeaponModel('mitts', buildMitts, animateMitts);
// 导出 buildMitts 供其它模块(如选枪预览、lab)直接构造该模型。
export { buildMitts };
