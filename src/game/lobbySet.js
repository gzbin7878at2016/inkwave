// ============================================================================
// 【中文导读】联机大厅后巷场景的【装配/总控】:class LobbySet
// ----------------------------------------------------------------------------
// 【模块定位】联机 hub(大厅)与 lobby(房间)两套界面共用的舞台 —— 蓝调时刻、雨后的一条后巷。
//   由 showcase.js 动态 import 后 new 出来(见 src/game/showcase.js 的 _lobLoad),
//   scene.add(set.root) 挂进自己的场景全屏绘制;main.js 在它全屏时既不画也不模拟世界
//   (走 showcase 的 fullFrame)。生命周期:preloadLobby() 主菜单空闲时提前建好 →
//   await set.ready(fonts + env 烘焙完)→ 展示 → dispose()。
//
// 【四件套分工与调用顺序】LobbySet 是总装,另外三件各司其职:
//   lobbySet.js   【装配/总控】本文件:拥有场景图 root、布局常量 ALLEY、镜头/站位/入场路径、
//                 灯光、湿地面平面反射、update() 循环、stats()。
//   lobbySet-mats.js【材质】makeUniforms() 与各材质(surface/ground/lit/neon/…)、SLOT 槽位表;
//                 全部共用同一个 uniform 块 U ⇒ 换队色/时钟/雾都只写一次。
//   lobbySet-tex.js 【贴图】Canvas 图集与霓虹字形(DECAL/LIT/GROUND_RECT/loadSetFonts);
//                 队色一律【通道编码】(R=队A G=队B B=白 A=覆盖),换队色只写 uniform 不重绘。
//   lobbySet-geo.js 【几何】SetBuilder 分桶合并 + 原语 + 程序化道具工厂 + mat4/PAINT。
//   构造顺序(不可乱):makeUniforms()(材质)→ createDecalAtlas/createLitAtlas/createSkyline/
//   createGroundMask(贴图)→ _bakeEnv() → _build()(用 SetBuilder 攒几何 + 用 mats 建 Mesh)
//   → _lights() → _reflection() → setTeamColors/setQuality。
//
// 【核心机制】
//   - 【队色解耦】材质不写死队色:队色走 uniform,贴图通道编码,故 setTeamColors() 只重烘焙
//     一次环境贴图(_rebakeEnv)并刷新一次,不重建任何几何/贴图。
//   - 【湿地面平面反射】_reflection() 在 ground 的 onBeforeRender 里,把整个场景(含小孩)以
//     y=0 为镜面镜像渲染进半分辨率 HDR target(仿 three 的 Reflector,但固定水平面),
//     地面着色器再按湿度拉伸+模糊;high/medium 开,low 退回 envMap。
//   - 【站位/路径按相机方位排】FRONT/BACK 站位用"相机方位角(度)+ 深度 z"反算 world-x,
//     让后排 rivals 正好落进前排头部之间的屏幕缝隙(lanes());lanes/exitPath 给入场/离场游动路径。
//   - 【自带灯光与天空】后巷自带全部灯光,并在远平面自绘天空/天际线;任意相机 far 都可用,
//     其余物体都在 hero 相机 ~80 m 内。渲染时须每帧 scene.environment = set.environment。
//
// 【关键约定】单位米、Y 向上;后巷沿 -Z 延伸(相机在 +Z,街口在 -Z)。
//   换队色后 environment 纹理对象会变,旧纹理保留多一帧再 dispose(见 _rebakeEnv 注释),持有引用者安全。
//
// 【建议阅读顺序】ALLEY/CAM → constructor → _buildLanes → _build(骨架)→ _bakeEnv →
//   _neon/_overhead/_glows → _lights → _reflection → update → setTeamColors/setQuality → stats/dispose。
//
// 【配套阅读】lobbySet-mats.js、lobbySet-tex.js、lobbySet-geo.js、src/game/showcase.js、docs/ARCHITECTURE.zh-CN.md
// ============================================================================
// INKWAVE online lobby set: the back alley behind an ink-and-skate shop, blue hour, just after rain.
//
//   const set = new LobbySet(renderer, { quality: 'high' | 'medium' | 'low', texlib });  scene.add(set.root);
//   set.spots[i] { pos, yaw }  — 0..3 your team on the wet asphalt (0 = you, front and centre), 4..7 the rivals on the
//                                loading dock behind, standing in the gaps between the front row's heads
//   set.lanes(i) / set.exitPath(i) — arrival / exit paths (mouth ↔ mark) on walkable surfaces; no two cross
//   set.hubSpot, set.camera, set.hubCamera ({ pos, target, fov, near, far })
//   set.update(dt, t); set.setTeamColors(a, b); set.setQuality(q); set.dispose(); set.ready (fonts + env baked)
//   set.environment / set.environmentIntensity — a PMREM of the alley (neon, door, mouth) to light the squidkids with
//   set.stats() — draw calls / triangles of the set itself
// Integration notes: the set carries every light it needs and draws its own sky at the far plane (any camera far works;
// everything else sits within ~80 m of the hero camera). Assign scene.environment = set.environment every render while
// the set is up — the texture object changes on setTeamColors (the old one is kept alive for one more re-bake). The wet
// floor's planar reflection renders the host scene (kids included) from the ground mesh's onBeforeRender at quality
// 'high' / 'medium', restoring render target, autoClear and shadow state; 'low' falls back to the env map.
//
// Composition (camera at +Z looking down the alley toward the street mouth at -Z): the alley's leading lines and the
// wet gutter run to the glowing mouth just left of the line-up (the UI covers the left 28%), the kids stand centre-right,
// the backdrop behind their heads is the calm, dark far end of the right-hand wall; colour lives above them (squid neon,
// string lights), at the frame edges (INK & SKATE neon, the graffiti shutter) and on the floor (puddles, ink).
// Lighting: a warm key from over the shop's back door (off-frame right, the one shadow caster, framed tightly on the
// stage), the door's own warm spill (light cookie shaped by the door frame), a cool rim from the street mouth, neon
// bounce in each team's colour, string-bulb top light, a hemisphere for the blue-hour sky.
// Draw calls: everything static is merged per material (surface, lit glass, neon, emitters) — see stats().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SetBuilder, mat4, PAINT, fireEscape, drainPipe, windowUnit, acUnit, shutter, dumpster, vending, woodCrate, milkCrate, speakerStack, cone, bike, trashBag, catenary, decalQuad } from './lobbySet-geo.js';
import { makeUniforms, surfaceMaterial, groundMaterial, litMaterial, neonMaterial, haloMaterial, glowMaterial, emitMaterial, skyMaterial, skylineMaterial, steamMaterial, hazeMaterial, SLOT } from './lobbySet-mats.js';
import { createDecalAtlas, createLitAtlas, createGroundMask, createSkyline, neonText, neonSquid, neonHalo, DECAL, LIT, GROUND_RECT, loadSetFonts } from './lobbySet-tex.js';

// 【向量速记】V(x,y,z):布局与路径里大量用到;虽然每次都 new,但只在构造期调用,无妨。
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// update() temporaries (it never allocates)
// 【update 临时量】热循环(update/走位)复用,保证每帧零分配 —— 见顶部英文注释 "it never allocates"。
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
// 【车灯色】headlight sweep 的暖白,update() 里乘亮度系数复用。
const HEADLIGHT = new THREE.Color('#fff1d8');
// 【surface 配方速记】S(slot,grime,rough,metal) → aSurf 四元组,与 lobbySet-geo.js 同名同义。
const S = (slot, grime = 0.3, rough = 1, metal = 0) => [slot, grime, rough, metal];

// ------------------------------------------------------------------------------------------------ layout (metres)
// 【后巷布局常量】全场几何与站位都从这里取数,单位米、Y 向上。字段:
//   xL/xR  左右墙 x;zNear 相机端 z;zMouth 街口 z(后巷沿 -Z 延伸)。
//   hL/hR  左右墙高(左 13.2、右 15.6,错落)。
//   dock   rivals 站的装卸台:x0..x1 × z0..z1 矩形,高 h = 1.0 m。
//   stair  上台台阶:x0..x1、起点 z0、台阶数 n。
//   street 街口外的横街:z0..z1(更远),curb 路缘高。
// 消费方:_build/_dock/_buildLanes/_farStreet/_reflection 及全部路径计算。
export const ALLEY = {
  xL: -4, xR: 4, zNear: 14, zMouth: -34, hL: 13.2, hR: 15.6,
  dock: { x0: -1.35, x1: 4, z0: -10.5, z1: -1.9, h: 1.0 },
  stair: { x0: 0.2, x1: 2.7, z0: -11.6, n: 3 },
  street: { z0: -34, z1: -46, curb: 0.14 },
};
// 【主镜头】hub/lobby 的默认机位:fov 32 的长焦压扁纵深(失焦背景),near/far 覆盖后巷+街口。
// 站位(bear)与路径都按这台相机推导,改它等于重排整场。
const CAM = { pos: V(-2.45, 2.25, 10.4), target: V(-0.95, 1.2, -1.7), fov: 32, near: 0.1, far: 140 };
// 【站位推导】用相机方位角(deg,从 -Z 向右为正)+ 深度 z 反算 world-x,让 rivals 落进前排头部之间的
// 屏幕缝隙(从线阵左侧看,world-x 的间隙不等于屏幕间隙)。front = 你的队(0 = 你,正前中心);back = 台上 rivals。
// Marks are placed by camera BEARING (degrees right of -Z from the hero camera) + depth z, so the rivals land in the
// on-screen gaps between the front row's heads (world-x gaps are not screen gaps from a camera left of the line-up).
// front = your team (0 = you, front and centre), back = rivals on the dock.
// 【bear】把 [方位角, z] 化成 [world-x, z]:x = camX + (camZ - z) * tan(deg)。方括号里是各队 4 个站位。
const bear = ([deg, z]) => [CAM.pos.x + (CAM.pos.z - z) * Math.tan((deg * Math.PI) / 180), z];
const FRONT = [[16.4, 0.35], [10.6, 0.05], [22.2, 0.05], [4.8, -0.35]].map(bear);
const BACK = [[13.3, -2.6], [7.6, -2.75], [18.9, -2.6], [24.2, -2.4]].map(bear);
// 【面向相机】由站位反算朝向角,k<1 时略偏(不是正对,更自然);rivals 用 k=0.6 侧身些。
const faceCam = (x, z, k = 0.72) => Math.atan2(CAM.pos.x - x, CAM.pos.z - z) * k;

// 【画质档】quality 名 → 该档开关:refl 反射分辨率比例(0 = 关)、shadow 阴影贴图边长、
// steam 是否画蒸汽、extraLights 是否保留 vend/sweep 等次要灯。setQuality() 消费本表。
const QUALITY = {
  high: { refl: 0.5, shadow: 2048, steam: true, extraLights: true },
  medium: { refl: 0.34, shadow: 1536, steam: true, extraLights: true },
  low: { refl: 0, shadow: 1024, steam: false, extraLights: false },
};

// 【后巷场景类】usage 与对外契约见文件顶部英文注释;这里只概述成员:
//   root 场景图、spots 站位、camera/hubCamera 两套机位、_lanes 入场路径、tex 纹理、mats 材质、
//   lights 灯光、ground/surface/… 各 Mesh、glows/bulbs/steam/drips 等动态件。
//   update(dt,t) 每帧驱动;setTeamColors/setQuality 运行期可调;stats() 报数;dispose() 释放。
export class LobbySet {
  // 【构造】按固定顺序装配(顺序有依赖,详见顶部导读):材质 uniforms → 布局/站位/相机 →
  // 路径 → 纹理 → 环境烘焙 → 几何 → 灯光 → 反射 → 队色/画质。renderer 可空(_bakeEnv 会跳过)。
  constructor(renderer, { quality = 'high', texlib = null } = {}) {
    this.renderer = renderer; this.texlib = texlib;
    this.quality = QUALITY[quality] ? quality : 'high';
    this.Q = QUALITY[this.quality];
    this.U = makeUniforms();
    this.root = new THREE.Group(); this.root.name = 'lobbySet';
    const D = ALLEY.dock;
    // spots 0..3 你的队站在湿地面上(0 = 你,正前中心),4..7 rivals 站在台上(dock.h 高度)。
    this.spots = [...FRONT.map(([x, z]) => ({ pos: V(x, 0, z), yaw: faceCam(x, z) })), ...BACK.map(([x, z]) => ({ pos: V(x, D.h, z), yaw: faceCam(x, z, 0.6) }))];
    this.hubSpot = { pos: V(1.7, 0, 0.9), yaw: -0.45 };
    this.camera = { pos: CAM.pos.clone(), target: CAM.target.clone(), fov: CAM.fov, near: CAM.near, far: CAM.far };
    this.hubCamera = { pos: V(-1.2, 1.1, 5.6), target: V(0.39, 1.0, 0.86), fov: 30, near: 0.1, far: 140 };
    this._lanes = this._buildLanes();
    // 动态态:时钟 _t;6 条水滴(drips,供屋檐滴水);_ripI 涟漪环形缓冲写指针;_nextDrip/_nextSweep 计时器。
    this._t = 0; this._drips = Array.from({ length: 6 }, () => ({ p: new THREE.Vector3(), v: 0, on: false })); this._ripI = 0; this._nextDrip = 1.2; this._nextSweep = 3; this._sweep = null;
    this.environmentIntensity = 0.6;

    // textures (drawn now with fallback fonts, redrawn when the set fonts load)
    // 【纹理】先用回退字体画一版立刻可用;等 set 字体加载后再重绘(纹理的 userData.ready 是那个 Promise)。
    this.tex = {
      decal: createDecalAtlas(), lit: createLitAtlas(), sky: createSkyline(),
      mask: createGroundMask(PUDDLES, SPLATS),
    };
    this.environment = this._bakeEnv();
    this._build();
    this._lights();
    this._reflection();
    this.setTeamColors(this.U.uTeamA.value, this.U.uTeamB.value);
    this.setQuality(this.quality);
    // ready = 两张图集就绪 + 字体加载完成;showcase 会 await 它再显示,保证首帧不缺字形。
    this.ready = Promise.all([this.tex.decal.userData.ready, this.tex.lit.userData.ready, loadSetFonts()]).then(() => this);
  }

  // ---------------------------------------------------------------------------------------------- paths
  // 【入场路径构造】每站位一条路径(_lanes[i] 是 Vector3 数组):
  //   前排:走码头左侧的空旷车道,嵌套的 L 形 —— 越靠右的站位走越靠近码头的车道、转身越靠后,
  //         故任意两条路径不相交;最左的站位直接走直线进。
  //   rivals:走右半场,在远端上台台阶,再到台上按 x 顺序扇形散开(同样不相交)。
  //   拐角用 round() 倒圆(每个转角补几个点),保证游动者不会瞬间折向。
  // Front row: down the open lane left of the dock in nested L's — the mark furthest right takes the lane nearest the
  // dock and turns furthest back, so no two paths cross; the leftmost mark walks straight in. Rivals: down the right
  // half, up the dock stairs at its far end, then fanned out across the dock to their marks in x order (again no
  // crossings). Corners are rounded (a few points per turn) so a walker never snaps direction.
  _buildLanes() {
    const D = ALLEY.dock, ST = ALLEY.stair, out = [];
    // 【倒圆】对折线内部每个拐点 a-b-c:在入边/出边上各退 rr,再用二次贝塞尔补 4 个点。
    // rr 受相邻边长限制(min(r, 0.45*边长)),避免短边被圆角吃掉导致回头。
    const round = (pts, r = 0.45) => {
      const o = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const d1 = a.clone().sub(b), d2 = c.clone().sub(b), l1 = d1.length(), l2 = d2.length(), rr = Math.min(r, l1 * 0.45, l2 * 0.45);
        const p1 = b.clone().addScaledVector(d1, rr / l1), p2 = b.clone().addScaledVector(d2, rr / l2);
        for (let k = 0; k <= 3; k++) { const t = k / 3, u = 1 - t; o.push(p1.clone().multiplyScalar(u * u).addScaledVector(b, 2 * u * t).addScaledVector(p2, t * t)); }
      }
      o.push(pts[pts.length - 1]);
      return o;
    };
    // 【前排排序】按 world-x 升序给站位编号 —— 越左的站位越先走直线,越右的用越靠码头的车道、转身越靠后。
    const fr = FRONT.map((f, i) => i).sort((a, b) => FRONT[a][0] - FRONT[b][0]);
    const laneX = [-3.5, -3.0, -2.5, -2.0], turnZ = [null, -1.0, -1.3, -1.6];
    fr.forEach((id, k) => {
      const [mx, mz] = FRONT[id], lx = laneX[k];
      const tz = k === 0 ? mz : turnZ[k];
      const p = [V(lx, 0, ALLEY.zMouth - 3), V(lx, 0, -6), V(lx, 0, tz)];
      if (k === 0) p.push(V(mx, 0, mz));
      else p.push(V(mx, 0, tz), V(mx, 0, mz));
      out[id] = round(p);
    });
    const bk = BACK.map((f, i) => i).sort((a, b) => BACK[a][0] - BACK[b][0]);
    const stepX = [0.55, 1.15, 1.75, 2.35], run = (D.z0 - ST.z0) / ST.n;
    bk.forEach((id, k) => {
      const [mx, mz] = BACK[id], sx = stepX[k];
      const p = [V(sx, 0, ALLEY.zMouth - 3), V(sx, 0, ST.z0 - 0.45)];
      for (let s = 1; s <= ST.n; s++) p.push(V(sx, (D.h * s) / ST.n, ST.z0 + (s - 0.5) * run));
      // 【台阶段保尖】台阶点带 y 抬升,不能倒圆(否则会在空中划弧);只有上台之后的台面段才 round。
      // keep the stair points sharp (y steps), round only the dock-top part
      out[4 + id] = [...p, ...round([V(sx, D.h, D.z0 + 0.1), V(sx, D.h, D.z0 + 0.6), V(mx, D.h, mz - 1.5), V(mx, D.h, mz)], 0.8).slice(1)];
    });
    return out;
  }
  // 【取路径】lanes(i):站位 i 的入场路径(克隆,防调用方改动内部数组);exitPath(i):反向即离场路径。
  lanes(i) { return this._lanes[i].map((v) => v.clone()); }
  exitPath(i) { return this.lanes(i).reverse(); }

  // ---------------------------------------------------------------------------------------------- environment
  // 【环境贴图烘焙】用一组"代理盒/卡片"拼出一条假后巷(暗墙、头顶蓝天缝、发光街口、店门、
  // 队色霓虹片),烘成 PMREM;它照亮本场景的高光面,并经 set.environment 照亮小孩(rivals/你)。
  // 换队色时 _rebakeEnv() 只改两张霓虹卡的颜色再重烘,不重建代理场景。
  // A PMREM of a proxy alley: dark walls, the blue sky slot overhead, the glowing mouth, the door, neon patches in the
  // team colours (re-baked on a team change). Lights the set's glossy surfaces and, via set.environment, the kids.
  _bakeEnv() {
    if (!this.renderer) return null;
    const sc = new THREE.Scene();
    // 【代理件】box:内向盒(墙面);card:双面卡片(天空缝/街口/门/霓虹/吊灯),都按颜色乘 k 亮度。
    // 这是 headless(无 renderer)时直接返回 null 的原因:没有 WebGL 就没法 PMREM。
    const box = (w, h, d, x, y, z, c, k = 1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.BackSide })); m.position.set(x, y, z); sc.add(m); return m; };
    const card = (w, h, x, y, z, ry, c, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; sc.add(m); return m; };
    box(8, 30, 90, 0, 14, -10, '#0b0d14', 1);
    card(8, 10, 0, 29, -10, 0, '#2a3f6e', 1).rotation.x = Math.PI / 2;           // sky slot
    card(8, 10, 0, 5, -36, 0, '#d9a878', 0.5);                                    // the mouth (city glow)
    card(8, 30, 0, 18, -36, 0, '#304a78', 0.6);
    card(1.2, 2.2, 3.95, 1.1, 3.05, -Math.PI / 2, '#ffb366', 5);                   // shop door
    this._envA = card(2.6, 0.6, 3.9, 3.3, -2.4, -Math.PI / 2, '#ffffff', 4);       // INK & SKATE neon
    this._envB = card(0.9, 1.1, 3.3, 5.2, -7, 0, '#ffffff', 4);                   // squid neon
    card(7, 0.2, 0, 4.6, -1, 0, '#ffcf8a', 3).rotation.x = Math.PI / 2;           // string bulbs
    card(0.7, 1.5, -3.2, 1.2, 2.6, Math.PI / 2, '#cfefff', 2.5);                   // vending
    card(90, 30, 0, 0.02, -10, 0, '#07080b', 1).rotation.x = -Math.PI / 2;
    this._envScene = sc;
    this._pmrem = new THREE.PMREMGenerator(this.renderer);
    return this._rebakeEnv();
  }
  // 【重烘环境】把两张队色霓虹卡染成本队色(归一化到峰值 4,保证够亮),重烘 PMREM。
  // 旧的 _envRT 推迟到【下一次】重烘才 dispose —— 这样外部持有 environment 引用多看一两帧也安全。
  _rebakeEnv() {
    if (!this._pmrem) return null;
    const nA = this.U.uTeamA.value.clone(), nB = this.U.uTeamB.value.clone();
    nA.multiplyScalar(4 / Math.max(nA.r, nA.g, nA.b, 1e-3)); nB.multiplyScalar(4 / Math.max(nB.r, nB.g, nB.b, 1e-3));
    this._envA.material.color.copy(nA); this._envB.material.color.copy(nB);
    // the previous bake is disposed one re-bake later, so a reference held for a frame or two stays valid
    this._envOld?.dispose(); this._envOld = this._envRT;
    this._envRT = this._pmrem.fromScene(this._envScene, 0.04, 0.1, 100, { size: 128, position: V(0.8, 1.4, -1.2) });
    const t = this._envRT.texture;
    for (const m of this._envMats || []) m.envMap = t;
    this.environment = t;
    return t;
  }

  // ---------------------------------------------------------------------------------------------- build
  // 【场景装配总入口】一次跑完:建材质(mats)→ 用 SetBuilder 攒全部静态几何 → 合并建 Mesh →
  // 地面/路缘/天空/天际线 → 引线/灯柱体积/光晕/飞蛾/蒸汽/水滴等动态件。
  // 此后运行期只更新实例矩阵与 uniform,不再新增 GPU 对象。
  _build() {
    const U = this.U, T = this.tex, B = new SetBuilder(), A = ALLEY, D = A.dock;
    const env = this.environment;
    // 【材质面】全部共用 uniform 块 U 与图集;env 是刚烘好的环境贴图。mats 的键名与 geo 的桶名对应。
    this.mats = {
      surface: surfaceMaterial(U, this.texlib, T.decal, env),
      ground: groundMaterial(U, this.texlib, T.mask, GROUND_RECT, env),
      lit: litMaterial(U, T.lit, env),
      neon: neonMaterial(U),
      emit: emitMaterial(U),
      glow: glowMaterial(U),
      sky: skyMaterial(U),
      steam: steamMaterial(U),
    };
    this._envMats = [this.mats.surface, this.mats.ground, this.mats.lit];
    // 【确定性随机】固定种子 4242:窗户亮灭、空调位置、涂鸦刊登等每次都一致(各客户端同款后巷)。
    const rnd = mulberry(4242);

    // 【建筑体】左墙 = 老砖楼;右墙 = 店铺(底层刷浆、上层砖)。用 faces 过滤只保留可见的面。
    // ---- buildings: left = old brick walk-up; right = the shop (painted render ground floor, brick above)
    const brickL = { color: '#7a4a3a', surf: S(SLOT.brick, 0.9, 1, 0) };
    const brickR = { color: '#8d6a55', surf: S(SLOT.brick, 0.85, 1, 0) };
    const renderR = { color: '#3a4550', surf: S(SLOT.concrete, 0.95, 1.1, 0) };   // painted concrete block, dark slate
    const band = { color: '#6f6b64', surf: S(SLOT.concrete, 0.7, 1, 0) };
    B.box('surface', A.xL - 0.5, 0, A.zMouth, A.xL, A.hL, A.zNear, { ...brickL, faces: 'Xz' });
    B.box('surface', A.xL - 0.5, 0, A.zMouth, A.xL + 0.04, 0.45, A.zNear, { color: '#57544f', surf: S(SLOT.concrete, 1, 1, 0), faces: 'XYz' });   // plinth
    B.box('surface', A.xL - 0.5, 3.9, A.zMouth, A.xL + 0.08, 4.12, A.zNear, { ...band, faces: 'XYyz' });
    B.box('surface', A.xL - 0.5, A.hL - 0.5, A.zMouth, A.xL + 0.22, A.hL, A.zNear, { ...band, faces: 'XYyz' });      // cornice
    B.box('surface', A.xR, 0, A.zMouth, A.xR + 0.5, 3.95, A.zNear, { ...renderR, faces: 'xz' });
    B.box('surface', A.xR, 3.95, A.zMouth, A.xR + 0.5, A.hR, A.zNear, { ...brickR, faces: 'xz' });
    B.box('surface', A.xR - 0.1, 3.85, A.zMouth, A.xR + 0.5, 4.1, A.zNear, { color: '#2a2d31', surf: S(SLOT.metalpanel, 0.6, 0.9, 0.3), faces: 'xYyz' });  // steel beam
    B.box('surface', A.xR - 0.25, A.hR - 0.55, A.zMouth, A.xR + 0.5, A.hR, A.zNear, { ...band, faces: 'xYyz' });
    // mouth corners: the buildings' street faces (seen edge-on in the mouth) and the far side of the cross street
    B.box('surface', A.xL - 14, 0, A.zMouth - 0.5, A.xL - 0.5, A.hL, A.zMouth, { ...brickL, faces: 'z' });
    B.box('surface', A.xR + 0.5, 0, A.zMouth - 0.5, A.xR + 14, A.hR, A.zMouth, { ...renderR, faces: 'z' });
    this._farStreet(B, rnd);

    // 【立面细节】上楼层的窗(随机亮灭)、空调外机、落水管、防火梯。
    // ---- windows (upper floors), AC units, pipes, fire escapes
    const litPick = (r) => (r < 0.3 ? [1.4, 1.25, 1.1] : r < 0.4 ? [0.6, 0.8, 1.2] : r < 0.5 ? [0.35, 0.3, 0.28] : [0.03, 0.03, 0.035]);
    const wins = ['win0', 'win1', 'win2', 'win3'];
    for (const [wx, dir, zs, floors, frame] of [[A.xL, 1, [7, 3.5, -3.5, -7, -14, -17.5, -21, -24.5, -28, -31], [4.7, 8.0], '#cdbfa8'], [A.xR, -1, [8.5, 5, -11.5, -15, -18.5, -22, -25.5, -29], [4.8, 8.3, 11.8], '#b9c3c8']]) {
      for (const z of zs) for (const y of floors) {
        const r = rnd();
        windowUnit(B, wx, dir, z, y, 1.15, 1.75, LIT[wins[Math.floor(rnd() * 4)]], litPick(r), { frame, bars: y < 5 && rnd() < 0.3 });
        if (y < 9 && rnd() < 0.3 && !(dir > 0 && z === -3.5 && y < 5)) acUnit(B, wx, dir, z + 0.1, y - 0.62, { color: rnd() < 0.5 ? '#c9c6bd' : '#a9aca8' });
      }
    }
    // the right wall directly behind the rivals (z ≈ -12 .. -2) stays quiet: no lit windows at head height
    windowUnit(B, A.xR, -1, -4.2, 5.0, 1.15, 1.75, LIT.win2, [0.02, 0.02, 0.025], { frame: '#b9c3c8' });
    windowUnit(B, A.xR, -1, -8.0, 5.0, 1.15, 1.75, LIT.win0, [0.5, 0.42, 0.35], { frame: '#b9c3c8' });
    // the dripping ones (drips + ripples in update()): a window unit on the left, a sleeve unit over the shutter
    acUnit(B, A.xL, 1, -3.4, 4.08); acUnit(B, A.xR, -1, 1.6, 4.45, { color: '#a9aca8' });
    fireEscape(B, A.xR, -1, -9.6, -3.2, [5.0, 8.4, 11.8], { ladder: [2.4, -9.0] });
    fireEscape(B, A.xL, 1, -12.2, -6.8, [4.5, 7.9, 11.3], { ladder: [2.2, -8.0] });
    fireEscape(B, A.xL, 1, -27.5, -22.5, [4.5, 7.9, 11.3]);
    drainPipe(B, A.xR, -1, -10.9, 0, A.hR - 0.4);
    drainPipe(B, A.xR, -1, 1.9, 0, A.hR - 0.4);
    drainPipe(B, A.xL, 1, -5.2, 0, A.hL - 0.4);
    drainPipe(B, A.xL, 1, -19.6, 0, A.hL - 0.4);
    // conduit + junction boxes along the right wall at 3.3 m (feeds the neon)
    B.tube('surface', [[A.xR - 0.06, 3.72, 1.0], [A.xR - 0.06, 3.72, -12]], 0.025, { sharp: true, seg: 1, radial: 6, ...PAINT.pipe });
    for (const z of [-0.2, -5.5, -11]) B.box('surface', A.xR - 0.12, 3.57, z - 0.12, A.xR, 3.87, z + 0.12, { color: '#5a5f64', surf: S(SLOT.metalpanel, 0.7, 0.9, 0.4) });
    // gas meters + pipework low on the left wall, a breaker box, a steel back door
    for (let i = 0; i < 3; i++) B.rbox('surface', 0.3, 0.42, 0.22, 0.02, { m: mat4(A.xL + 0.13, 1.2, -2.2 + i * 0.42), color: '#b9b4a6', surf: S(SLOT.plain, 0.6, 0.5, 0.2) });
    B.tube('surface', [[A.xL + 0.08, 0.3, -2.8], [A.xL + 0.08, 0.3, -1.1], [A.xL + 0.08, 1.0, -1.1]], 0.03, { sharp: true, seg: 3, radial: 6, color: '#b8a13a', surf: S(SLOT.plain, 0.5, 0.5, 0.3) });
    this._door(B, A.xL, 1, -9.8, { color: '#3b4148' });

    // 【装卸台】rivals 登高的平台(见 _dock)。
    // ---- the loading dock (rivals' riser)
    this._dock(B, rnd);

    // 【店铺侧】右墙近相机:涂鸦卷帘门、后门 + 门灯、INK & SKATE 霓虹。
    // ---- the shop side (right, near the camera): graffiti shutter, back door with its lamp, INK & SKATE neon
    shutter(B, A.xR, -1, -0.55, 2.05, 0, 2.6);
    decalQuad(B, mat4(A.xR - 0.075, 1.28, 0.5, -Math.PI / 2), 4.2, 2.36, DECAL.graffiti, false, SLOT.plain);
    this._shopDoor(B);

    // 【陈设】按现实逻辑摆放:店门旁垃圾桶、遮阳灯下贩卖机、洗衣房排风的蒸汽、
    // 台上门口堆的木箱、守着排水篦子的交通锥。
    // ---- props, with real-world logic: the bins by the shop door, the vending machine under the awning light,
    // the steam from the laundry vent, crates stacked on the dock by its door, a cone guarding the gutter grate
    dumpster(B, -3.35, 4.4, Math.PI / 2 + 0.06);
    trashBag(B, -3.5, 0, 2.9, 1.05, 1); trashBag(B, -3.1, 0, 3.2, 0.85, 2); trashBag(B, -3.55, 0.05, 3.4, 0.8, 3);
    vending(B, -3.55, 1.3, Math.PI / 2, LIT.vending, '#27384a');
    woodCrate(B, -0.42, D.h, -9.4, 0.1); woodCrate(B, -0.4, D.h + 0.45, -9.35, -0.15); woodCrate(B, -0.45, D.h, -8.75, -0.05);
    milkCrate(B, 3.55, D.h, -9.9, 0.2, '#2f6fd6'); milkCrate(B, 3.55, D.h + 0.3, -9.85, -0.1, '#2f6fd6'); milkCrate(B, 3.6, D.h, -9.4, 0.4, '#d63a2f');
    speakerStack(B, 3.35, 1.95, -Math.PI / 2 + 0.35);
    cone(B, -0.85, -12.6, 0.3); cone(B, -0.2, -14.2, 0.9, true);
    bike(B, 3.74, -1.3, -Math.PI / 2, 0.2, '#1f7a8c');
    trashBag(B, 3.5, 0, -14.6, 0.9, 4);
    for (let i = 0; i < 3; i++) woodCrate(B, 3.4 - i * 0.05, i * 0.45, -16.2, 0.05 * i);
    // pallets leaning on the left wall far down
    for (let i = 0; i < 2; i++) B.at(mat4(A.xL + 0.1 + i * 0.07, 0, -15.2, Math.PI / 2, 0, 0), () => { B.at(mat4(0, 0, 0, 0, -0.1), () => { for (let k = 0; k < 7; k++) B.box('surface', -0.6 + k * 0.19, 0, -0.07, -0.6 + k * 0.19 + 0.1, 1.2, 0.0, { color: '#8a6b48', surf: S(SLOT.planks, 0.7, 1, 0) }); B.box('surface', -0.62, 0.1, 0, 0.62, 0.2, 0.1, { color: '#7a5d3e', surf: S(SLOT.planks, 0.7, 1, 0) }); B.box('surface', -0.62, 1.0, 0, 0.62, 1.1, 0.1, { color: '#7a5d3e', surf: S(SLOT.planks, 0.7, 1, 0) }); }); });
    // 【地面附属】蒸汽排风格栅(洗衣房排风)、排水篦子、一个井盖。
    // ground furniture: steam vent grate (laundry exhaust), gutter grates, a manhole
    B.box('surface', -3.2, -0.02, -6.4, -2.4, 0.025, -5.6, { color: '#2b2c2e', surf: S(SLOT.grate, 0.2, 0.9, 0.5) });
    B.box('surface', -3.25, -0.2, -6.45, -2.35, -0.02, -5.55, { color: '#050506', surf: S(SLOT.plain, 0, 1, 0) });
    for (const z of [-2.8, -17]) B.box('surface', -2.6, -0.01, z - 0.4, -2.1, 0.012, z + 0.4, { color: '#1f2022', surf: S(SLOT.grate, 0.2, 0.8, 0.6) });
    B.cyl('surface', 0.38, 0.38, 0.02, 28, { m: mat4(1.4, 0.0, -18.5), color: '#2a2a2b', surf: S(SLOT.treads, 0.2, 0.7, 0.6) });

    // 【墙面贴花】门边海报、涂鸦签名、台上模板喷印,以及两队队色的墨点。
    // ---- wall decals: posters by the door, tags, a stencil on the dock, splats in both team colours
    decalQuad(B, mat4(A.xL + 0.012, 1.55, -0.2, Math.PI / 2), 0.42, 0.63, DECAL.poster0); decalQuad(B, mat4(A.xL + 0.012, 1.5, 0.35, Math.PI / 2, 0, 0.04), 0.42, 0.63, DECAL.poster1);
    decalQuad(B, mat4(A.xL + 0.012, 1.62, 0.9, Math.PI / 2, 0, -0.03), 0.42, 0.63, DECAL.poster2);
    decalQuad(B, mat4(A.xL + 0.012, 1.2, -4.2, Math.PI / 2), 1.6, 0.8, DECAL.tag0);
    decalQuad(B, mat4(A.xL + 0.012, 1.45, -12.8, Math.PI / 2), 2.0, 1.5, DECAL.throwup);
    decalQuad(B, mat4(A.xR - 0.012, 1.8, -13.9, -Math.PI / 2), 1.6, 0.8, DECAL.tag1, true);
    decalQuad(B, mat4(A.xL + 0.012, 2.3, -1.2, Math.PI / 2), 1.1, 1.1, DECAL.splat0, true);
    decalQuad(B, mat4(A.xR - 0.012, 0.9, -13.0, -Math.PI / 2), 1.3, 1.3, DECAL.splat1);
    decalQuad(B, mat4(-0.3, D.h + 0.003, -8.4, 0, -Math.PI / 2), 2.2, 0.55, DECAL.stencil);
    decalQuad(B, mat4(0.3, D.h + 0.004, -5.4, 0.4, -Math.PI / 2), 1.1, 1.1, DECAL.splat2, true);

    // 【霓虹】INK & SKATE(队 A,店墙上)、乌贼刀牌(队 B,台上方)。
    // ---- neon: INK & SKATE (team A, on the shop wall), the squid blade sign (team B, over the dock)
    this._neon(B);

    // ---- string lights + overhead cables
    // 【灯串 + 架空线缆】见 _overhead(灯串摆点)与 _wires(可摇摆的线)。
    this._overhead(B, rnd);

    // ---- merge
    // 【合并出桶】B.build() 返回 { 桶: 合并几何 };这里只用它统计三角形数,tris 供调优参考。
    const G = B.build();
    this.tris = Math.round(B.tris);
    // 【建 Mesh 助手】统一设名、阴影开关、关闭 matrixAutoUpdate(静态件不动,省每帧矩阵更新)。
    const mesh = (geo, mat, name, cast = false, recv = true) => { const m = new THREE.Mesh(geo, mat); m.name = 'lobbySet:' + name; m.castShadow = cast; m.receiveShadow = recv; m.matrixAutoUpdate = false; this.root.add(m); return m; };
    // 【四个大网格】surface 是唯一投影者(cast 阴影);lit/neon/emit 不投影不接收,走各自发光通道。
    this.surface = mesh(G.surface, this.mats.surface, 'surface', true, true);
    if (G.lit) this.litMesh = mesh(G.lit, this.mats.lit, 'lit', false, false);
    if (G.neon) this.neonMesh = mesh(G.neon, this.mats.neon, 'neon');
    if (G.emit) this.emitMesh = mesh(G.emit, this.mats.emit, 'emit');
    // 【emit 桶】用顶点 color(HDR)驱动,四个 Mesh 共享同一材质,故需开启 vertexColors。
    this.mats.emit.vertexColors = true;

    // ground: one plane (y = 0) under the alley and the cross street
    // 【地面】一整块 y = 0 的大平面盖住后巷与横街;湿滑/反射全在地面着色器里完成,见 _reflection。
    const gg = new THREE.PlaneGeometry(90, 70).rotateX(-Math.PI / 2).translate(0, 0, -21);
    this.ground = mesh(gg, this.mats.ground, 'ground', false, true);
    // 【路缘/人行道】横街两侧抬高的人行道;后巷的"路边缺口"(curb cut)故意留空,方便游入。
    // sidewalks + curbs of the cross street (raised; the alley's curb cut is a gap)
    const curbB = new SetBuilder();
    for (const [z0, z1] of [[A.street.z0 - 2.6, A.street.z0], [A.street.z1, A.street.z1 + 2.6]]) {
      for (const [x0, x1] of z0 > -40 ? [[-40, A.xL - 0.02], [A.xR + 0.02, 40]] : [[-40, 40]]) curbB.box('surface', x0, 0, z0, x1, A.street.curb, z1, { color: '#6d6a66', surf: S(SLOT.concrete, 0.6, 0.8, 0) });
    }
    curbB.box('surface', A.xL, 0, A.street.z0 - 2.6, A.xR, 0.02, A.street.z0, { color: '#5e5b57', surf: S(SLOT.concrete, 0.6, 0.7, 0) });
    this.curbs = mesh(curbB.build().surface, this.mats.surface, 'curbs');

    // sky + skyline
    // 【天空球】半径 60 的球(renderOrder -10 最先画、永不裁剪);后巷自带天空,故任意相机 far 都行。
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), this.mats.sky); this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.sky.name = 'lobbySet:sky';
    this.sky.position.set(0, 0, -10); this.root.add(this.sky);
    this._skyline();

    // glows (instanced billboards): bulbs, lamps, the vending machine, headlights (last two slots)
    // 【动态件收尾】线缆、灯柱光柱、光晕广告牌、飞蛾、蒸汽与水滴。
    this._wires();
    this._volumes();
    this._glows();
    this._moth();
    // steam + drips
    this._fx();
  }

  // 【钢制后门】贴墙的平门:踢脚板 + 闭门臂;wx/dir 定墙与朝向,zc 门中心,y0 底部高度(台上门要抬高)。
  // Steel back door (flush, with a kick plate + closer arm) on a wall.
  _door(B, wx, dir, zc, o = {}) {
    const y = o.y0 || 0, x0 = Math.min(wx, wx + dir * 0.06), x1 = Math.max(wx, wx + dir * 0.06);
    B.box('surface', x0, y, zc - 0.55, x1, y + 2.2, zc + 0.55, { color: o.color || '#3b4148', surf: S(SLOT.metalpanel, 0.7, 1.2, 0.08) });
    B.box('surface', Math.min(wx, wx + dir * 0.1), y + 2.2, zc - 0.65, Math.max(wx, wx + dir * 0.1), y + 2.3, zc + 0.65, PAINT.steelBlack);
    B.box('surface', Math.min(wx, wx + dir * 0.075), y + 0.05, zc - 0.5, Math.max(wx, wx + dir * 0.075), y + 0.35, zc + 0.5, PAINT.steelGalv);
    B.box('surface', Math.min(wx, wx + dir * 0.15), y + 1.95, zc - 0.1, Math.max(wx, wx + dir * 0.15), y + 2.05, zc + 0.35, PAINT.steelBlack);
  }

  // 【装卸台】混凝土板 + 包边(沿两条开敞边缘的钢角,带黄黑警示条)、橡胶防撞条、
  // 远端的台阶 + 扶手、墙上的台上门与带笼壁灯。是 rivals 的登高位,故台面刻意压暗(紧贴前排身体之后)。
  // Concrete dock: slab + nosing (steel angle with hazard stripes along both open edges), rubber bumpers, stairs with
  // a handrail at the far end, a dock door + caged lamp on the wall behind.
  _dock(B) {
    const A = ALLEY, D = A.dock, ST = A.stair;
    // dark, water-stained concrete: the face sits right behind the front row's bodies, so it stays low-key
    const conc = { color: '#5b5955', surf: S(SLOT.concrete, 1.0, 1, 0) };
    B.box('surface', D.x0, 0, D.z0, D.x1, D.h - 0.06, D.z1, { ...conc, faces: 'xYZz' });
    B.box('surface', D.x0 + 0.06, D.h - 0.06, D.z0, D.x1, D.h, D.z1 - 0.06, { color: '#65625d', surf: S(SLOT.concrete, 0.7, 0.85, 0), faces: 'Y' });
    // nosing: hazard-striped steel angle on the front (z1) and left (x0) edges, galv top lip
    const hz = { color: '#9d978c', surf: S(SLOT.hazard, 1.0, 1.1, 0.05) };
    B.box('surface', D.x0, D.h - 0.15, D.z1 - 0.06, D.x1, D.h, D.z1 + 0.012, { ...hz, faces: 'Z' });
    B.box('surface', D.x0 - 0.012, D.h - 0.15, D.z0, D.x0 + 0.06, D.h, D.z1 + 0.012, { ...hz, faces: 'x', swapUV: true });
    B.box('surface', D.x0, D.h - 0.06, D.z1 - 0.06, D.x1, D.h + 0.004, D.z1 + 0.012, { ...PAINT.steelGalv, faces: 'YZ' });
    B.box('surface', D.x0 - 0.012, D.h - 0.06, D.z0, D.x0 + 0.06, D.h + 0.004, D.z1 + 0.012, { ...PAINT.steelGalv, faces: 'Yx' });
    // rubber bumpers on the front face
    for (const x of [-0.2, 1.5, 3.2]) B.box('surface', x - 0.14, 0.18, D.z1, x + 0.14, 0.68, D.z1 + 0.11, PAINT.rubber);
    for (const z of [-4.2, -7.6]) B.box('surface', D.x0 - 0.11, 0.18, z - 0.14, D.x0, 0.68, z + 0.14, PAINT.rubber);
    // stairs at the far end + handrails
    const run = (D.z0 - ST.z0) / ST.n;
    for (let s = 0; s < ST.n; s++) B.box('surface', ST.x0, 0, ST.z0 + s * run, ST.x1, (D.h * (s + 1)) / ST.n, D.z0, { color: '#85827b', surf: S(SLOT.treads, 0.7, 1, 0), faces: 'XYxz' });
    for (const x of [ST.x0 - 0.06, ST.x1 + 0.06]) {
      B.tube('surface', [[x, 0.95, ST.z0 - 0.1], [x, D.h + 0.95, D.z0 + 0.05], [x, D.h + 0.95, D.z0 + 0.8]], 0.024, { sharp: true, seg: 2, radial: 8, color: '#e2b023', surf: S(SLOT.plain, 0.6, 0.55, 0.2) });
      for (const [z, y0] of [[ST.z0 - 0.05, 0], [D.z0 + 0.75, D.h]]) B.tube('surface', [[x, y0, z], [x, y0 + 0.97, z]], 0.024, { sharp: true, seg: 1, radial: 8, color: '#e2b023', surf: S(SLOT.plain, 0.6, 0.55, 0.2) });
    }
    // dock door (roll-up, closed, plain) + caged lamp above it
    this._door(B, A.xR, -1, -9.4, { color: '#2b3036', y0: D.h });
    B.cyl('surface', 0.07, 0.09, 0.14, 12, { m: mat4(A.xR - 0.25, D.h + 3.25, -4.6), color: '#1b1d20', surf: S(SLOT.plain, 0.4, 0.6, 0.3) });
    B.add('emit', new THREE.SphereGeometry(0.055, 12, 8), { m: mat4(A.xR - 0.25, D.h + 3.13, -4.6), color: '#ffb35c', k: 9 });
    B.tube('surface', [[A.xR, D.h + 3.3, -4.6], [A.xR - 0.25, D.h + 3.3, -4.6]], 0.015, { sharp: true, seg: 1, radial: 5, ...PAINT.steelBlack });
  }

  // 【店铺后门】敞开的门(门后暖色内景 card 走 lit 桶)、门上带笼的壁灯、一级踏步、外开的门扇。
  // The shop's back door (open, warm room behind), a caged bulkhead lamp over it, a step.
  _shopDoor(B) {
    const A = ALLEY, zc = 3.05, w = 1.05, h = 2.2, x = A.xR;
    // interior card set back into the wall (seen through the opening) + dark reveals
    const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv, r = LIT.door;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + (r[2] - r[0]) * uv.getX(i), r[1] + (r[3] - r[1]) * uv.getY(i));
    B.add('lit', g, { m: mat4(x + 0.35, h / 2, zc, -Math.PI / 2), lit: [3.2, 2.9, 2.6] });
    B.box('surface', x - 0.02, 0, zc - w / 2 - 0.12, x + 0.35, h + 0.14, zc - w / 2, { color: '#262320', surf: S(SLOT.plain, 0.5, 1, 0), faces: 'Zx' });
    B.box('surface', x - 0.02, 0, zc + w / 2, x + 0.35, h + 0.14, zc + w / 2 + 0.12, { color: '#262320', surf: S(SLOT.plain, 0.5, 1, 0), faces: 'zx' });
    B.box('surface', x - 0.02, h, zc - w / 2, x + 0.35, h + 0.14, zc + w / 2, { color: '#262320', surf: S(SLOT.plain, 0.5, 1, 0), faces: 'yx' });
    // the open door leaf, swung out into the alley (toward the camera)
    B.at(mat4(x - 0.02, 0, zc + w / 2, -2.0), () => B.box('surface', 0, 0.02, -0.04, w, h - 0.02, 0, { color: '#8b2a24', surf: S(SLOT.metalpanel, 0.7, 0.8, 0.2) }));
    B.box('surface', x - 0.45, 0, zc - w / 2 - 0.2, x, 0.16, zc + w / 2 + 0.2, { color: '#6c6964', surf: S(SLOT.concrete, 0.6, 0.9, 0) });
    // bulkhead lamp
    B.rbox('surface', 0.2, 0.28, 0.14, 0.03, { m: mat4(x - 0.07, h + 0.55, zc), color: '#1c1e21', surf: S(SLOT.plain, 0.3, 0.6, 0.4) });
    B.add('emit', new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI), { m: mat4(x - 0.1, h + 0.55, zc, -Math.PI / 2), color: '#ffc47a', k: 12 });
    // cut out the wall behind the door opening: the right wall box is solid, so the interior card sits in front of a
    // dark recess panel instead (reads as depth through the doorway)
  }

  // 【霓虹招牌】两块:队 A 的 "INK & SKATE" 贴店墙(正文从后巷内看沿 -z→+z),队 B 的乌贼刀牌
  // 从右墙挑出悬在台上方。字形由 lobbySet-tex.js 的 neonText/neonSquid 提供(strokes = 折线点),
  // 每段用 neon 桶的 tube 扫成管;每个字母选一根做"接触不良"的闪烁(见 update 的 buzz)。
  // 记录 _neonA/_neonB 位置供 _lights 的队色点光引用。
  _neon(B) {
    const A = ALLEY;
    this.halos = [];
    // INK & SKATE on the shop wall (x = xR, facing -x); text reads -z → +z from inside the alley
    const txt = neonText('INK & SKATE', 0.42, 0.18);
    const buzzIdx = 8;   // the second K ... "SKATE": S=6, K=7, A=8 → the A buzzes
    const sA = { z0: -4.05, y0: 3.05 };
    const wallPt = (u, v, off) => V(A.xR - off, sA.y0 + v, sA.z0 + u);
    // raceway (the painted box the tubes mount to) + tube standoffs
    B.box('surface', A.xR - 0.07, sA.y0 + 0.12, sA.z0 - 0.05, A.xR, sA.y0 + 0.28, sA.z0 + txt.width + 0.05, { color: '#15171a', surf: S(SLOT.metalpanel, 0.3, 0.7, 0.4) });
    for (const s of txt.strokes) {
      const pts = s.pts.map(([u, v]) => wallPt(u, v, 0.1));
      B.tube('neon', pts, 0.013, { neon: [0, s.letter === buzzIdx ? 1 : 0, 0], radial: 6, step: 0.03 });
      B.tube('surface', [wallPt(s.pts[0][0], s.pts[0][1], 0.0), wallPt(s.pts[0][0], s.pts[0][1], 0.1)], 0.006, { sharp: true, seg: 1, radial: 4, color: '#777', surf: S(SLOT.plain, 0, 0.4, 0.8) });
    }
    const hA = neonHalo(txt.strokes, 0.45);
    this.halos.push(this._halo(hA, (u, v) => wallPt(u, v, 0.03), 0, 1.0));
    // squid blade sign: a double-faced sign box projecting from the right wall over the dock, tubes on the +z face
    const sq = neonSquid(0.95), zc = -7.05, yb = 4.5, xc = A.xR - 0.62;
    B.box('surface', xc - 0.5, yb - 0.08, zc - 0.07, xc + 0.5, yb + 1.08, zc + 0.02, { color: '#08090b', surf: S(SLOT.metalpanel, 0.3, 1.2, 0.1) });
    B.box('surface', xc + 0.5, yb + 0.9, zc - 0.03, A.xR, yb + 0.95, zc - 0.01, PAINT.steelBlack);
    B.box('surface', xc + 0.5, yb + 0.05, zc - 0.03, A.xR, yb + 0.1, zc - 0.01, PAINT.steelBlack);
    const sqPt = (u, v, off) => V(xc + u, yb + v, zc + 0.02 + off);
    for (const s of sq.strokes) B.tube('neon', s.pts.map(([u, v]) => sqPt(u, v, 0.05)), 0.019, { neon: [1, 0, 1], radial: 6, step: 0.03, closed: false });
    const hB = neonHalo(sq.strokes, 0.5);
    this.halos.push(this._halo(hB, (u, v) => sqPt(u, v, 0.01), 1, 1.0));
    this._neonA = { pos: V(A.xR - 0.6, sA.y0 + 0.25, sA.z0 + txt.width / 2) };
    this._neonB = { pos: V(2.1, 3.4, -4.4) };
  }
  // 【光晕面片】在招牌自己的 2-D 坐标系里铺一块四边形(uv 直接映射到米),再用招牌的点函数 P 摆到 3D;
  // haloMaterial 按队别着色,配合 _neon 的位置。这是霓虹"散射辉光"的载体。
  // halo plane in a sign's own 2-D frame (map uv ↔ metres), placed by the sign's point function
  _halo(h, P, team, k) {
    const [x0, y0, x1, y1] = h.rect;
    const g = new THREE.BufferGeometry();
    const c = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap((v) => [v.x, v.y, v.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(g, haloMaterial(this.U, h.texture, team));
    m.material.uniforms.uI.value = k; m.renderOrder = 2; m.name = 'lobbySet:halo' + team;
    this.root.add(m);
    return m;
  }

  // 【灯串与线缆】灯串在舞台上方左右墙间之字形来回(登记到 _strings,每段 n=8 只灯泡,下垂 sag);
  // 上方几根更重的架空线用 catenary 采样后 tube 扫成。只建"锚点/灯串数据",灯泡留给 _glows 做实例化。
  // String lights zig-zagging wall to wall over the stage + cable runs; bulbs are an instanced emitter that sways.
  _overhead(B, rnd) {
    const A = ALLEY;
    const anchors = [];
    for (let i = 0; i < 7; i++) { const z = 3.2 - i * 2.4; anchors.push(V(i % 2 ? A.xR - 0.05 : A.xL + 0.05, 4.9 + (i % 2) * 0.3, z)); }
    this._strings = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1], sag = 0.55 + rnd() * 0.2;
      this._strings.push({ a, b, sag, n: 8 });
      B.box('surface', a.x > 0 ? a.x - 0.08 : a.x, a.y - 0.04, a.z - 0.04, a.x > 0 ? a.x : a.x + 0.08, a.y + 0.04, a.z + 0.04, PAINT.steelBlack);
    }
    // heavier utility cables higher up, crossing at a slant
    for (const [z0, z1, y0, y1, s] of [[-3, -6, 7.2, 7.8, 0.7], [-8, -5.5, 9.0, 8.6, 0.9], [0.5, -2, 10.4, 10.9, 0.6], [-15, -18, 7.5, 8.2, 0.8], [-20, -19, 9.4, 9.1, 0.7]]) {
      B.tube('surface', catenary(V(A.xL + 0.05, y0, z0), V(A.xR - 0.05, y1, z1), s, 20), 0.014, { radial: 5, step: 0.3, color: '#0c0c0d', surf: S(SLOT.plain, 0, 0.4, 0) });
    }
  }
  // 【灯串线】随灯泡一起摆动的线(顶点着色器里的摆公式与 _bulbPos 一致):单独一个小网格。
  // 每顶点写上 aSway = (横向权重 sin(π·u), 相位 = a.z*0.7),着色器按 uTime 摆动 —— 与 CPU 端 _bulbPos 同式。
  // the bulb wires sway with the bulbs (same formula in the vertex shader as _bulbPos): their own small mesh
  _wires() {
    const geos = this._strings.map((s) => {
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(catenary(s.a, s.b, s.sag, 24)), 48, 0.0065, 4, false);
      const uv = g.attributes.uv, n = uv.count, sw = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) sw.set([Math.sin(Math.PI * uv.getX(i)), s.a.z * 0.7], i * 2);
      g.setAttribute('aSway', new THREE.BufferAttribute(sw, 2)); g.deleteAttribute('uv');
      return g;
    });
    const mat = hazeMaterial(new THREE.MeshStandardMaterial({ color: '#0e0e0f', roughness: 0.5, envMap: this.environment }), this.U);
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      sh.uniforms.uTime = this.U.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSway; uniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ float sw = sin(uTime * 1.3 + aSway.y) * 0.035 * aSway.x; transformed.z += sw; transformed.y -= abs(sw) * 0.2; }');
      prev(sh, r);
    };
    mat.userData.key = 'wires';
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.name = 'lobbySet:wires'; m.matrixAutoUpdate = false;
    this.root.add(m); this._envMats.push(mat);
    return m;
  }
  // 【灯泡位置】算第 s 段灯串第 k 个灯泡在时刻 t 的 world 位置(写入 out),含:segment 插值 + 抛物线下垂
  // + 随时间的横向摆动。CPU 版,与 _wires 的 GLSL 版口径一致(两者必须同步改)。
  _bulbPos(s, k, t, out) {
    const f = (k + 0.5) / s.n;
    out.lerpVectors(s.a, s.b, f); out.y -= s.sag * 4 * f * (1 - f);
    const sw = Math.sin(t * 1.3 + s.a.z * 0.7) * 0.035 * Math.sin(Math.PI * f);
    out.z += sw; out.y -= 0.045 + Math.abs(sw) * 0.2;
    return out;
  }

  // 【天际线】两张竖直面片(带 skylineMaterial,采样 sky 图集)摆在街口之外作城市剪影;
  // 刻意压在相机 ~80 m 内,这样连 showcase 那种 far=90 的相机也不会裁掉它们。
  _skyline() {
    const tex = this.tex.sky;
    this.skyline = [];
    const fogCol = new THREE.Color(0.1, 0.12, 0.2);
    // kept inside ~80 m of the camera so a showcase far plane of 90 never clips them
    for (const [z, w, h, x, vo, f] of [[-66, 130, 36, 0, 0.5, 0.75], [-56, 104, 28, 8, 0, 0.45]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), skylineMaterial(this.U, tex, fogCol, f));
      m.position.set(x, h / 2 - 3, z); m.material.uniforms.uV.value.set(vo, 0.5); m.renderOrder = -5; m.name = 'lobbySet:skyline';
      tex.wrapS = THREE.RepeatWrapping;
      this.root.add(m); this.skyline.push(m);
    }
  }

  // 【横街对面】一排店面(亮窗、雨棚、绿色霓虹药房十字)、路灯、一辆停着的车 —— 在 45 m 外主要是光点与剪影。
  // 药房十字与路灯登记为发光点,供 _glows/_lights 使用。
  // The far side of the cross street: a row of shopfronts (lit windows, awnings, a pharmacy cross in neon green),
  // street lamps, a parked van — mostly light and silhouette at 45 m.
  _farStreet(B, rnd) {
    const z = ALLEY.street.z1;
    B.box('surface', -40, 0, z - 0.5, 40, 9.5, z, { color: '#3a3431', surf: S(SLOT.brick, 0.8, 1, 0), faces: 'Z' });
    B.box('surface', -40, 9.2, z - 0.5, 40, 9.6, z + 0.25, { color: '#26262a', surf: S(SLOT.concrete, 0.5, 1, 0), faces: 'ZY' });
    B.box('surface', -40, 3.6, z, 40, 3.9, z + 0.15, { color: '#1c1d20', surf: S(SLOT.plain, 0.3, 0.8, 0), faces: 'ZYy' });
    for (let i = -6; i <= 6; i++) {
      const x = i * 5.2 + 1.2;
      const g = new THREE.PlaneGeometry(4.2, 2.8); const uv = g.attributes.uv, r = LIT[['win0', 'win2', 'win3', 'win1'][(i + 12) % 4]];
      for (let k = 0; k < uv.count; k++) uv.setXY(k, r[0] + (r[2] - r[0]) * uv.getX(k), r[1] + (r[3] - r[1]) * uv.getY(k));
      const on = rnd() < 0.7;
      B.add('lit', g, { m: mat4(x, 1.8, z + 0.02), lit: on ? [2.2, 1.9, 1.5] : [0.2, 0.22, 0.3] });
      B.box('surface', x - 2.3, 0, z, x - 2.1, 3.6, z + 0.1, { color: '#222', surf: S(SLOT.plain, 0.3, 0.7, 0), faces: 'ZXx' });
      if (rnd() < 0.5) B.box('surface', x - 2.2, 3.1, z, x + 2.2, 3.3, z + 1.1, { color: ['#7a2f2a', '#2f5a4a', '#2c3e6a'][Math.floor(rnd() * 3)], surf: S(SLOT.plain, 0.4, 0.8, 0), faces: 'ZYy' });
      for (const y of [5.2, 7.6]) if (rnd() < 0.6) {
        const g2 = new THREE.PlaneGeometry(1.2, 1.7); const uv2 = g2.attributes.uv, r2 = LIT[['win0', 'win1', 'win2', 'win3'][Math.floor(rnd() * 4)]];
        for (let k = 0; k < uv2.count; k++) uv2.setXY(k, r2[0] + (r2[2] - r2[0]) * uv2.getX(k), r2[1] + (r2[3] - r2[1]) * uv2.getY(k));
        const lit = rnd() < 0.5;
        B.add('lit', g2, { m: mat4(x + (rnd() - 0.5) * 2, y, z + 0.02), lit: lit ? [1.3, 1.1, 0.9] : [0.05, 0.05, 0.06] });
      }
    }
    // a pharmacy cross over a shopfront (fixed green neon, sign colour 2) — a small cool accent deep in the mouth,
    // left of the rivals' heads. One tube per edge so the corners stay square.
    { const cx = -1.3, cy = 4.4, zz = z + 0.35, A2 = 0.32, b = 0.1, P = (x, y) => V(cx + x, cy + y, zz);
      const o = [[-b, A2], [b, A2], [b, b], [A2, b], [A2, -b], [b, -b], [b, -A2], [-b, -A2], [-b, -b], [-A2, -b], [-A2, b], [-b, b]];
      o.forEach((p0, i) => { const p1 = o[(i + 1) % o.length]; B.tube('neon', [P(...p0), P(...p1)], 0.03, { sharp: true, seg: 1, radial: 6, neon: [2, 0, 2] }); });
      B.box('surface', cx - 0.45, cy - 0.45, z, cx + 0.45, cy + 0.45, zz - 0.03, { color: '#0c0d0f', surf: S(SLOT.metalpanel, 0.3, 1, 0.1) });
      this._farNeon = V(cx, cy, zz + 0.3); }
    // street lamps (poles on the near sidewalk either side of the mouth, heads glowing sodium)
    this._lampHeads = [];
    for (const x of [-9, 9.5, 24]) {
      B.cyl('surface', 0.07, 0.09, 6.5, 10, { m: mat4(x, 3.25, ALLEY.street.z0 - 2.1), ...PAINT.steelBlack });
      B.tube('surface', [[x, 6.4, ALLEY.street.z0 - 2.1], [x, 6.7, ALLEY.street.z0 - 3.0], [x, 6.6, ALLEY.street.z0 - 3.8]], 0.05, { radial: 6, ...PAINT.steelBlack });
      B.rbox('surface', 0.5, 0.14, 0.28, 0.04, { m: mat4(x, 6.55, ALLEY.street.z0 - 3.9), ...PAINT.steelBlack });
      this._lampHeads.push(V(x, 6.42, ALLEY.street.z0 - 3.9));
    }
    // parked van silhouette across the street
    B.rbox('surface', 5.0, 2.2, 2.0, 0.25, { m: mat4(-7.5, 1.45, z + 2.2), color: '#d8d8d4', surf: S(SLOT.plain, 0.4, 0.35, 0.1) });
    for (const x of [-9.3, -5.7]) B.cyl('surface', 0.36, 0.36, 0.25, 16, { m: mat4(x, 0.36, z + 3.15, 0, Math.PI / 2), ...PAINT.rubber });
  }

  // 【光晕广告牌】一个 InstancedMesh(N=64)挂在 glowMaterial 上,承载场景里所有"发光点"的柔光;
  // 每只灯泡、门顶壁灯、台上灯、贩卖机、路灯、药房十字、以及最后两个 slots(车头灯)都在 _glowList 里,
  // 每帧由 _placeGlows 重写实例矩阵/颜色。_headlightGlow 记下头灯在列表中的起始下标。
  _glows() {
    const N = 64;
    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedMesh(quad, this.mats.glow, N);
    g.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    g.frustumCulled = false; g.renderOrder = 3; g.name = 'lobbySet:glows';
    this.root.add(g);
    this.glows = g;
    // bulb emitters (instanced spheres)
    const nb = this._strings.reduce((a, s) => a + s.n, 0);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 8), hazeMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff }), this.U), nb);
    bulbs.frustumCulled = false; bulbs.name = 'lobbySet:bulbs';
    const warm = new THREE.Color('#ffc47a');
    for (let i = 0; i < nb; i++) bulbs.setColorAt(i, warm.clone().multiplyScalar(i % 7 === 3 ? 1.5 : 7));   // one dead-ish bulb per string
    this.root.add(bulbs); this.bulbs = bulbs;
    this._glowList = [];
    const add = (pos, color, k, r, tag) => { this._glowList.push({ pos, color: new THREE.Color(color).multiplyScalar(k), r, tag, base: k }); };
    let i = 0;
    for (const s of this._strings) for (let k = 0; k < s.n; k++, i++) add(V(), '#ffb865', i % 7 === 3 ? 0.08 : 0.34, 0.32, { bulb: i, s, k });
    add(V(ALLEY.xR - 0.2, 2.75, 3.05), '#ffb86a', 1.0, 0.7);                // bulkhead over the shop door
    add(V(ALLEY.xR - 0.25, ALLEY.dock.h + 3.1, -4.6), '#ffae5a', 0.5, 0.5); // dock lamp
    add(V(-3.1, 1.2, 1.3), '#bfe8ff', 0.22, 1.1);                           // vending glow
    for (const p of this._lampHeads) add(p, '#ff9c45', 1.4, 1.6);           // sodium street lamps
    add(this._farNeon, '#39ff88', 0.5, 1.4);                                 // pharmacy cross
    this._headlightGlow = this._glowList.length;
    add(V(0, 0.7, -40), '#fff1d8', 0, 1.8); add(V(0, 0.7, -40), '#fff1d8', 0, 1.8);
    g.count = this._glowList.length;
    this._placeGlows(0);
  }
  // 【每帧刷新光晕】遍历 _glowList:灯泡类(tag)用 _bulbPos 求位置并写进 bulbs 实例矩阵;
  // 所有条目都写进 glows 的实例矩阵(按 gl.r 缩放)与实例色。只改实例缓冲,不重建。
  _placeGlows(t) {
    let bi = 0;
    _q.identity();
    this._glowList.forEach((gl, i) => {
      if (gl.tag) { this._bulbPos(gl.tag.s, gl.tag.k, t, gl.pos); _m.compose(gl.pos, _q, _s.setScalar(1)); this.bulbs.setMatrixAt(bi++, _m); }
      _m.compose(_p.copy(gl.pos), _q, _s.setScalar(gl.r));
      this.glows.setMatrixAt(i, _m); this.glows.setColorAt(i, gl.color);
    });
    this.glows.instanceMatrix.needsUpdate = true; this.glows.instanceColor.needsUpdate = true;
    this.bulbs.instanceMatrix.needsUpdate = true;
  }

  // 【灯柱光柱】街口路灯下方的淡淡锥形光体(雨后潮湿空气把钠灯"显出"体积感)。
  // 自定义 ShaderMaterial:顶点属性 aF = 0(灯处)→1(地面);片元按视线-法线夹角(Fresnel 式)
  // 与高度衰减求和,加色混合(one/one)叠到已画内容上,不写深度。
  // Faint light volumes under the street lamps at the mouth (the humid air after rain catches the sodium light).
  _volumes() {
    const geos = this._lampHeads.map((p) => {
      const h = p.y, g = new THREE.CylinderGeometry(0.2, 3.2, h, 24, 1, true).translate(0, -h / 2, 0);
      const f = new Float32Array(g.attributes.position.count);
      for (let i = 0; i < f.length; i++) f[i] = -g.attributes.position.getY(i) / h;   // 0 at the lamp → 1 at the ground
      g.setAttribute('aF', new THREE.BufferAttribute(f, 1)); g.deleteAttribute('uv');
      return g.translate(p.x, p.y, p.z);
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color('#ff9a4a').multiplyScalar(0.05) } },
      vertexShader: 'attribute float aF; varying float vF; varying vec3 vN; varying vec3 vV; void main() { vF = aF; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform vec3 uCol; varying float vF; varying vec3 vN; varying vec3 vV; void main() { float e = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = e * smoothstep(0.0, 0.15, vF) * (1.0 - vF * 0.85); gl_FragColor = vec4(uCol * a, 1.0); }',
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.name = 'lobbySet:volumes'; m.renderOrder = 2; m.matrixAutoUpdate = false;
    this.root.add(m); this.volumes = m;
  }
  // 【飞蛾】绕着台上壁灯打转:两片三角翅膀,靠 x 缩放模拟扇动,沿抖动的 Lissajous 轨道飞行(见 update)。
  // A moth worrying the dock lamp: two wing triangles, flapping by scale, on a jittery Lissajous orbit.
  _moth() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.035, 0.012, -0.02, -0.03, -0.004, 0.02, 0, 0, 0, 0.035, 0.012, -0.02, 0.03, -0.004, 0.02], 3));
    g.computeVertexNormals();
    this.moth = new THREE.Mesh(g, hazeMaterial(new THREE.MeshBasicMaterial({ color: '#6b5a48', side: THREE.DoubleSide }), this.U));
    this.moth.name = 'lobbySet:moth'; this.moth.frustumCulled = false;
    this._mothC = V(ALLEY.xR - 0.45, ALLEY.dock.h + 3.1, -4.6);
    this.root.add(this.moth);
  }
  // 【蒸汽 + 水滴】蒸汽:排风格栅上方三张交叉卡片(自定义 aSeed 供着色器扰动),steamMaterial 渲染;
  // 水滴:6 个实例化细圆柱的池子,由 update 触发从空调托盘滴落到水洼。
  _fx() {
    // steam: three crossed cards over the vent grate
    const cards = new THREE.BufferGeometry(), pos = [], uv = [], seed = [], idx = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI, c = Math.cos(a) * 0.9, s = Math.sin(a) * 0.9, b = pos.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(-2.8 + (u - 0.5) * 2 * c * 0.8 + v * v * 0.35, v * 3.4, -6.0 + (u - 0.5) * 2 * s * 0.8); uv.push(u, v); seed.push(i * 1.7); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    cards.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cards.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); cards.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); cards.setIndex(idx);
    this.steam = new THREE.Mesh(cards, this.mats.steam); this.steam.renderOrder = 4; this.steam.name = 'lobbySet:steam'; this.steam.frustumCulled = false;
    this.root.add(this.steam);
    // drips: little bright streaks falling from AC drip trays into the puddles below
    this._dripSrc = [V(ALLEY.xL + 0.5, 3.98, -3.4), V(ALLEY.xR - 0.5, 4.35, 1.6), V(ALLEY.xL + 0.9, 4.4, -9.2)];
    const dg = new THREE.CylinderGeometry(0.006, 0.006, 0.09, 5);
    this.dripMesh = new THREE.InstancedMesh(dg, hazeMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.25, 1.35) }), this.U), 6);
    this.dripMesh.frustumCulled = false; this.dripMesh.count = 0; this.dripMesh.name = 'lobbySet:drips';
    this.root.add(this.dripMesh);
  }

  // ---------------------------------------------------------------------------------------------- lights
  // 【灯光】后巷自带全部灯光(不依赖关卡灯)。key 是唯一投影者;spill 用"门形 cookie"塑形不投影;
  // rim 用限距 spot 而非方向光(方向光的掠射高光会把近景所有高光面洗白);neonA/B 用队色点光;
  // 另有灯泡顶光、贩卖机冷补光、蓝调半球光、横街钠灯、车头灯 sweep(update 驱动)。
  _lights() {
    const L = (this.lights = {}), r = this.root, A = ALLEY;
    // key: warm, from over the shop door (off-frame right), the one shadow caster, framed tightly on the stage
    const key = (L.key = new THREE.SpotLight('#ffe8d0', 215, 0, 0.6, 0.55, 2));
    key.position.set(3.45, 3.9, 5.5); key.target.position.set(0.6, 0.95, -1.2);
    key.castShadow = true; key.shadow.bias = -0.00025; key.shadow.normalBias = 0.02; key.shadow.radius = 2.5;
    key.shadow.camera.near = 2; key.shadow.camera.far = 16;
    // the door's own spill: low, orange, shaped by a door-frame cookie; no shadows (the cookie does the framing)
    const spill = (L.spill = new THREE.SpotLight('#ffa052', 30, 14, 0.95, 0.9, 2));
    spill.position.set(A.xR + 0.9, 1.5, 3.05); spill.target.position.set(0.2, 0.0, 0.6);
    spill.map = doorCookie();
    // rim: cool light from the street mouth behind the line-up. A range-limited spot rather than a directional light:
    // grazing forward-scatter specular from a directional rim turned every glossy top near the camera white
    const rim = (L.rim = new THREE.SpotLight('#a9c2ff', 1150, 31, 0.36, 0.8, 2));
    rim.position.set(-1.2, 6.8, -22.5); rim.target.position.set(0.9, 1.2, -1.2);
    // neon bounce, one per team
    L.neonA = new THREE.PointLight(0xffffff, 22, 9, 2); L.neonA.position.copy(this._neonA.pos);
    L.neonB = new THREE.PointLight(0xffffff, 26, 11, 2); L.neonB.position.copy(this._neonB.pos);
    // string bulbs: soft warm top light over the stage
    L.bulbs = new THREE.PointLight('#ffc27a', 9, 12, 2); L.bulbs.position.set(0.8, 4.6, -1.0);
    // vending machine: cool fill from the left
    L.vend = new THREE.PointLight('#bfe6ff', 2.5, 6, 2); L.vend.position.set(-2.9, 1.3, 1.3);
    // blue-hour sky over the slot of the alley
    L.hemi = new THREE.HemisphereLight('#5573b0', '#2a2630', 0.6);   // ground term = the wet asphalt's bounce
    // the cross street's sodium lamps light the mouth: the far walls, the wet ground running back toward us
    L.street = new THREE.PointLight('#ffb070', 420, 34, 2); L.street.position.set(0.5, 6.5, -39);
    // headlight sweep (animated; off between cars)
    // (range-limited to the far end: it must never reach the stage)
    L.sweep = new THREE.SpotLight('#fff0d6', 0, 20, 0.4, 0.7, 1.5); L.sweep.position.set(-8, 0.8, -40); L.sweep.target.position.set(0, 0.5, -26);
    for (const l of [key, spill, rim, L.sweep]) r.add(l, l.target);
    r.add(L.neonA, L.neonB, L.bulbs, L.vend, L.hemi, L.street);
  }

  // ---------------------------------------------------------------------------------------------- planar reflection
  // 【平面反射】地面在自己的 onBeforeRender 里把场景(含小孩)镜像进半分辨率 HDR target,手法比照 three 的
  // Reflector(在 y = 0 上做斜近裁剪面),但固定水平面;地面着色器再按湿度对反射做拉伸和模糊。
  // 它在 showcase 自己的 render 里嵌套渲染,退出时完整还原渲染目标/autoClear/阴影状态。low 档关掉。
  // The floor mirrors the scene (kids included) into a half-res HDR target from its own onBeforeRender, exactly like
  // three's Reflector (oblique near plane on y = 0) but for a fixed horizontal plane; the ground shader streaks and
  // blurs it by wetness. Works inside the showcase's own render (nested render, state restored).
  _reflection() {
    // 【反射句柄】mat = 地面材质;R = mat.userData.refl(着色器里 tex/mat/res/on 的 uniform 引用)。
    // 下面的相机/RT/平面/裁剪等向量都在闭包里复用,避免每帧分配。
    const mat = this.mats.ground, R = mat.userData.refl;
    const cam = (this._rCam = new THREE.PerspectiveCamera());
    const rt = (this._rRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true }));
    R.tex.value = rt.texture;
    const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4(), size = new THREE.Vector2();
    const cw = new THREE.Vector3(), look = new THREE.Vector3(), tgt = new THREE.Vector3(), rot = new THREE.Matrix4();
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.ground.onBeforeRender = (renderer, scene, camera) => {
      // 【防递归/低画质/水下】_inRefl 守卫防自反射;Q.refl=0 直接跳过;相机在 y≤0.02(贴地/水下)不反射。
      if (this._inRefl || !this.Q.refl) return;
      cw.setFromMatrixPosition(camera.matrixWorld);
      if (cw.y <= 0.02) return;
      // mirrored camera
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(cw);
      cam.position.set(cw.x, -cw.y, cw.z);
      tgt.set(look.x, -look.y, look.z);
      cam.up.set(0, 1, 0).applyMatrix4(rot); cam.up.y = -cam.up.y;
      cam.lookAt(tgt);
      cam.far = camera.far; cam.updateMatrixWorld();
      cam.projectionMatrix.copy(camera.projectionMatrix);
      R.mat.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      // 【镜像相机】把相机位置/朝向/up 的 y 取反,得到水下的等价机位;投影沿用主相机的。
      // 【斜裁剪】把近裁剪面[斜插]成 y=0 平面,裁掉镜面下方的几何(Lengyel 算法)。
      // oblique clip plane y = 0 (Lengyel)
      plane.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(cam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const pm = cam.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      // size from the current target
      const cur = renderer.getRenderTarget();
      if (cur) size.set(cur.width, cur.height); else renderer.getDrawingBufferSize(size);
      const w = Math.max(64, Math.round(size.x * this.Q.refl)), h = Math.max(64, Math.round(size.y * this.Q.refl));
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      R.res.value.set(w, h);
      // render (skip what can't be seen in a floor reflection / would self-reflect)
      // 【隐藏自反射件】ground 自身、蒸汽、路缘在反射里看不见或会自反射,渲染前临时隐藏,渲完还原。
      this._inRefl = true;
      const hide = [this.ground, this.steam, this.curbs];
      const vis = hide.map((o) => o && o.visible); hide.forEach((o) => o && (o.visible = false));
      const xr = renderer.xr.enabled, sau = renderer.shadowMap.autoUpdate, snu = renderer.shadowMap.needsUpdate, ac = renderer.autoClear;
      renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;   // reuse this frame's shadows
      renderer.setRenderTarget(rt);
      renderer.state.buffers.depth.setMask(true);
      renderer.autoClear = false; renderer.clear(true, true, false);
      renderer.render(scene, cam);
      renderer.autoClear = ac; renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sau; renderer.shadowMap.needsUpdate = snu;
      renderer.setRenderTarget(cur);
      hide.forEach((o, i) => o && (o.visible = vis[i]));
      this._inRefl = false;
      R.on.value = 1;
    };
  }

  // ---------------------------------------------------------------------------------------------- runtime
  // 【每帧更新】驱动所有"活"的东西:霓虹闪烁/蜂鸣、灯泡摆动、屋檐滴水与涟漪、飞蛾绕灯、车灯扫街。
  // 全程零分配;只写 uniform、实例矩阵与灯参数。t 是绝对时间(秒),dt 是帧间隔。
  update(dt, t) {
    this._t = t; this.U.uTime.value = t;
    const L = this.lights;
    // neon: INK & SKATE steady with a faint mains shimmer, its 'A' buzzing in bursts; the squid breathes slightly
    const n = this.mats.neon.uniforms.uI.value;
    const shimmer = 1 + 0.02 * Math.sin(t * 120) * Math.sin(t * 7.3);
    const burst = Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3) > 0.55;
    const buzz = burst ? (hash1(Math.floor(t * 22)) > 0.45 ? 1 : 0.08) : 1;
    n.x = 7 * shimmer; n.y = 7.5 * (1 + 0.03 * Math.sin(t * 1.7)); n.z = buzz;
    this.halos[0].material.uniforms.uI.value = 1.0 * shimmer * (0.93 + 0.07 * buzz);
    this.halos[1].material.uniforms.uI.value = 1.05 * (1 + 0.03 * Math.sin(t * 1.7));
    const colA = this.U.uTeamA.value, colB = this.U.uTeamB.value;
    L.neonA.color.copy(colA).multiplyScalar(1 / Math.max(colA.r, colA.g, colA.b, 1e-3)); L.neonA.intensity = 16 * shimmer * (0.93 + 0.07 * buzz);
    L.neonB.color.copy(colB).multiplyScalar(1 / Math.max(colB.r, colB.g, colB.b, 1e-3)); L.neonB.intensity = 26 * (1 + 0.03 * Math.sin(t * 1.7));
    // bulbs sway + the one flickery bulb
    this._placeGlows(t);
    // drips: every ~1.5-3 s one falls from a drip tray; its splash starts a ripple in the puddle below
    this._nextDrip -= dt;
    if (this._nextDrip <= 0) { this._nextDrip = 1.4 + hash1(Math.floor(t * 10)) * 1.8; const src = this._dripSrc[Math.floor(hash1(Math.floor(t * 3)) * this._dripSrc.length)]; const d = this._drips.find((q) => !q.on); if (d) { d.p.copy(src); d.v = 0; d.on = true; } }
    const m = _m, rip = this.mats.ground.userData.rip.value;
    let k = 0;
    for (const d of this._drips) {
      if (!d.on) continue;
      d.v += 9.8 * dt; d.p.y -= d.v * dt;
      if (d.p.y <= 0.0) { rip[this._ripI++ % rip.length].set(d.p.x, d.p.z, t, 1); d.on = false; continue; }
      m.makeScale(1, 1 + d.v * 0.25, 1).setPosition(d.p); this.dripMesh.setMatrixAt(k++, m);
    }
    this.dripMesh.count = k; this.dripMesh.instanceMatrix.needsUpdate = true;
    // the moth: fast erratic loops around the lamp, wings flapping ~18 Hz
    { const c = this._mothC, m = this.moth, a = t * 2.3;
      m.position.set(c.x + Math.sin(a * 1.7) * 0.22 + Math.sin(t * 9.1) * 0.03, c.y + Math.sin(a * 1.3 + 1) * 0.12 + Math.sin(t * 11.3) * 0.02, c.z + Math.cos(a * 1.1) * 0.25);
      m.rotation.set(0, a * 1.7 + Math.PI / 2, 0.3 * Math.sin(t * 5)); m.scale.set(0.6 + 0.4 * Math.abs(Math.sin(t * 57)), 1, 1); }
    // headlight sweep across the mouth every 7-14 s: two glows travel along the cross street, a spot rakes the far
    // end of the alley as the car passes the opening
    this._nextSweep -= dt;
    if (!this._sweep && this._nextSweep <= 0) { const dir = hash1(Math.floor(t)) > 0.5 ? 1 : -1; this._sweep = { t: 0, dir, dur: 3.2 }; }
    const g0 = this._glowList[this._headlightGlow], g1 = this._glowList[this._headlightGlow + 1];
    if (this._sweep) {
      const s = this._sweep; s.t += dt;
      const f = s.t / s.dur, x = s.dir * (-26 + 52 * f), zc = ALLEY.street.z0 - (s.dir > 0 ? 4.5 : 8.5);
      g0.pos.set(x, 0.7, zc); g1.pos.set(x + s.dir * -0.0, 0.7, zc);
      g1.pos.x = x - s.dir * 1.5;
      const vis = Math.max(0, 1 - Math.abs(x) / 26);
      const k2 = 0.9 * Math.min(1, s.t * 3) * Math.min(1, (s.dur - s.t) * 3);
      g0.color.copy(HEADLIGHT).multiplyScalar(k2 * 1.2); g1.color.copy(HEADLIGHT).multiplyScalar(k2 * 1.2);
      L.sweep.position.set(x, 0.8, zc); L.sweep.target.position.set(x * 0.3 + s.dir * 4, 1.0, -27);
      L.sweep.intensity = 260 * vis * vis * k2;
      if (s.t >= s.dur) { this._sweep = null; this._nextSweep = 7 + hash1(Math.floor(t * 2)) * 7; L.sweep.intensity = 0; g0.color.setScalar(0); g1.color.setScalar(0); }
    }
  }

  // 【换队色】a/b 任一可空(只换一队)。只写 uniform + 重烘一次环境贴图,再立即 update(0,t) 让灯光/霓虹跟上。
  // 不重建任何几何或贴图 —— 队色是通道编码的,这是四件套解耦的关键收益。
  setTeamColors(a, b) {
    if (a != null) this.U.uTeamA.value.set(a);
    if (b != null) this.U.uTeamB.value.set(b);
    this._rebakeEnv();
    this.update(0, this._t);
  }

  // 【换画质】切 Q 档:改阴影贴图尺寸(必要时释放旧 map)、关反射、开关蒸汽、开关次要灯(vend/sweep)。
  // 未知档名直接忽略,保留当前档。
  setQuality(q) {
    if (!QUALITY[q]) return;
    this.quality = q; this.Q = QUALITY[q];
    const L = this.lights, sh = this.Q.shadow;
    if (L.key.shadow.mapSize.x !== sh) { L.key.shadow.mapSize.set(sh, sh); if (L.key.shadow.map) { L.key.shadow.map.dispose(); L.key.shadow.map = null; } }
    if (!this.Q.refl) this.mats.ground.userData.refl.on.value = 0;
    this.steam.visible = this.Q.steam;
    L.vend.visible = L.sweep.visible = this.Q.extraLights;
  }

  // 【统计】遍历 root 数可见 Mesh/InstancedMesh 的 draw call 与三角形(实例按 count 计入),
  // 并报当前反射分辨率。供 HUD/调试用。注意:这是本场景自身,不含外部小孩/FX。
  stats() {
    let meshes = 0, tris = 0;
    this.root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible) { meshes++; const g = o.geometry; const n = g.index ? g.index.count : g.attributes.position.count; tris += (n / 3) * (o.isInstancedMesh ? o.count : 1); } });
    return { setDraws: meshes, setTriangles: Math.round(tris), reflection: this.Q.refl ? `${this._rRT.width}x${this._rRT.height}` : 'off' };
  }

  // 【释放】遍历 root dispose 全部几何/材质,再 dispose 纹理、halo 纹理、RT/PMREM、门 cookie、代理环境场景,
  // 最后把自己从父节点摘掉。showcase 在场景被替换或失败回滚时调用。
  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    for (const t of Object.values(this.tex)) t.dispose();
    this.halos?.forEach((h) => h.material.uniforms.map.value.dispose());
    this._rRT?.dispose(); this._envRT?.dispose(); this._envOld?.dispose(); this._pmrem?.dispose();
    this.lights?.spill.map?.dispose();
    this._envScene?.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.root.removeFromParent();
  }
}

// ------------------------------------------------------------------------------------------------ data
// 【水洼表】地面 mask 贴图的输入(createGroundMask 消费),决定哪里反光/更湿。
//   字段:x/z 中心;rx/rz 半轴;n(可选)多边形扰动边数,越大越不规则;d(可选)深度权重。
//   摆位意图:线阵前方(接住小孩与霓虹的反射)、台面沿线、车道、滴水点下方。
// Puddles (ground mask): in front of the line-up (catches the kids + neon), along the dock face, the lane, by the drips.
const PUDDLES = [
  { x: 0.9, z: 2.2, rx: 1.5, rz: 0.8, n: 9 }, { x: -1.4, z: 3.6, rx: 1.0, rz: 0.7 }, { x: 2.4, z: 1.2, rx: 0.8, rz: 0.5 },
  { x: 0.8, z: -1.35, rx: 2.2, rz: 0.35, n: 10, d: 0.8 }, { x: -2.5, z: -2.5, rx: 0.8, rz: 2.5, n: 9 }, { x: -3.3, z: -3.4, rx: 0.5, rz: 0.5 },
  { x: -2.3, z: -9, rx: 1.0, rz: 2.0 }, { x: 1.8, z: -12.5, rx: 1.2, rz: 0.9 }, { x: 3.4, z: 1.7, rx: 0.5, rz: 0.6 },
  { x: -3.2, z: -5.8, rx: 0.7, rz: 0.7, d: 0.7 }, { x: 0.2, z: 5.2, rx: 1.4, rz: 0.9 }, { x: -3.1, z: -9.2, rx: 0.6, rz: 0.8 },
];
// 【地面墨点表】画进 decal 图集/地面 mask 的墨渍:你的队在他们站位处、rivals 在台边、车道里几个旧点。
//   字段:x/z 中心;r 半径;team 0/1(用哪队队色通道);seed 形状种子;arms(可选)墨点触须数。
// ink on the floor: your team's where they'll stand, the rivals' by the dock, a few older drops down the lane
const SPLATS = [
  { x: 0.4, z: 1.2, r: 0.42, team: 0, seed: 3 }, { x: -1.6, z: 0.9, r: 0.3, team: 0, seed: 5, arms: 7 }, { x: 2.8, z: 0.6, r: 0.28, team: 0, seed: 8 },
  { x: -0.6, z: -1.6, r: 0.3, team: 1, seed: 11 }, { x: 2.6, z: -1.5, r: 0.24, team: 1, seed: 13, arms: 6 }, { x: -2.9, z: -7.5, r: 0.35, team: 1, seed: 17 },
  { x: -1.8, z: -11, r: 0.3, team: 0, seed: 19 },
];

// 【一维哈希】把任意实数 n 散成 [0,1):经典 sin-hash。update 里用它做"按时间取随机"(滴水/车灯节律)。
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
// 【确定性 PRNG】mulberry32:同种子同序列;构造期给窗户亮灭等布局做"每客户端一致"的随机。
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 【门灯 cookie】给 spill 灯做的光照蒙版:一块软边矩形(门洞),因灯"坐"在室内,门框把光锥裁成
// 投在沥青上的一道光梯形 —— 用蒙版比几何遮挡更省。
// Light cookie for the door spill: the doorway's soft-edged rectangle (the spot sits inside the room, so the frame
// clips its cone into a tall trapezoid of light on the asphalt).
function doorCookie() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.filter = 'blur(5px)'; g.fillStyle = '#fff'; g.fillRect(38, 14, 52, 100);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
