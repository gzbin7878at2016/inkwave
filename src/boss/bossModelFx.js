// ============================================================================
// 【中文导读】HULLBREAKER 模型自带的"演出特效"层(BossFX 类):高光墨团(一个 InstancedMesh)
//   + 柔和蒸汽(一个 Points)。与游戏玩法特效(dust/ring/水花/屏幕震动,经 BossModel 的 hooks 走游戏侧)
//   分离,只负责"这只寄居蟹自己冒出来的东西"。
// ----------------------------------------------------------------------------
// 【模块定位】被 BossModel 与 Crablet 各自 new 一个实例(小螃蟹 pop 时用 quality:'low' 起一个一次性实例);
//   由 BossModel.update 末尾调 fx.update(dt)。世界空间:group 保持单位世界矩阵,矩阵只用来摆放实例。
// 【核心机制】两个定容对象池(墨团 NI、蒸汽 NS),分配采用"未满则递增,满则回收剩余寿命最短的槽位";
//   无逐帧分配。墨团用 IcosahedronGeometry + MeshPhysicalMaterial(clearcoat 做出湿润高光),落地即摊平成
//   飞溅片(splat 标志);蒸汽是一个自定义 ShaderMaterial 的 Points,size/alpha 由顶点属性驱动、按距离缩放。
// 【关键约定】所有 emit 接口(ink/steamPuff/geyser)的 pos 是【世界坐标】;life/size 单位是秒/米;
//   update 里 live/ls 计数即 InstancedMesh.count 与 drawRange,靠复用槽位天然获得压缩。rng(9001) 是
//   确定性伪随机,保证同一发特效在不同机器上回放一致。
// 【配套阅读】docs/BOSS.zh-CN.md、docs/BOSS.md;兄弟文件 bossModel.js(宿主)、bossAnim.js(触发时机)。
// ============================================================================
// INKWAVE — HULLBREAKER set-piece FX owned by the model: glossy ink blobs (one InstancedMesh) and soft
// steam puffs (one Points). World-space (the group keeps an identity world matrix), fixed pools, no per-frame
// allocation. Gameplay FX (dust, rings, splats, shakes) stay with the game via the model's hooks.
import * as THREE from 'three';

// 【复用暂存对象】模块级 scratch(Matrix/Quaternion/Vector3),逐帧循环里反复读写,避免 GC 抖动
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
// 【Z 轴基准】墨团朝向的参考轴:用 setFromUnitVectors(Z, v) 把椭球长轴对齐速度方向
const Z = new THREE.Vector3(0, 0, 1);

// 【确定性 RNG】mulberry32 变体:同一 seed 产出同一串随机数,保证特效在多端回放逐位一致
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 【蒸汽顶点着色器】点精灵:gl_PointSize 随 aSize 与透视距离(-mv.z)反比缩放,保证近大远小
const STEAM_VS = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute float aSeed; varying float vA; varying float vSeed;
uniform float uScale;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.1, -mv.z); vA = aAlpha; vSeed = aSeed; }`;
// 【蒸汽片元着色器】圆形软边(smoothstep 边缘) + 两层正弦制造絮状噪声;中间 r>1 的方块直接丢弃成圆
const STEAM_FS = /* glsl */`
varying float vA; varying float vSeed; uniform vec3 uTint;
void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
  float a = smoothstep(1.0, 0.2, r); float n = 0.75 + 0.25 * sin(c.x * 9.0 + vSeed * 7.0) * sin(c.y * 8.0 + vSeed * 3.0);
  gl_FragColor = vec4(uTint, a * vA * n); }`;

// 【Boss 演出特效池】BossModel 与 Crablet 各持一个;构造即建好两个定容池与共享 Group
export class BossFX {
  // 构造:按画质系数 k 决定池容量(墨团 320*k、蒸汽 140*k),一次性分配全部 TypedArray
  constructor({ quality = 'high', ink }) {
    const k = { low: 0.4, medium: 0.7, high: 1, ultra: 1.2 }[quality] ?? 1;
    this.k = k;
    // 【世界空间 Group】关掉自动矩阵更新并锁成单位矩阵:特效位置直接写在世界坐标,不走父级变换
    this.group = new THREE.Group(); this.group.name = 'hullbreaker-fx';
    this.group.matrixAutoUpdate = false; this.group.matrixWorldAutoUpdate = false; this.group.matrixWorld.identity();
    // ink blobs
    // 【墨团池】一个 InstancedMesh 画所有墨团:物理材质 + clearcoat 出湿润高光;并行数组保存每实例状态
    this.NI = Math.round(320 * k);
    this.inkMat = new THREE.MeshPhysicalMaterial({ color: ink.clone(), roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 });
    const g = new THREE.IcosahedronGeometry(1, quality === 'low' ? 0 : 1);
    this.inkMesh = new THREE.InstancedMesh(g, this.inkMat, this.NI); this.inkMesh.count = 0; this.inkMesh.frustumCulled = false; this.inkMesh.castShadow = false;
    this.inkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.inkMesh);
    this.I = { p: new Float32Array(this.NI * 3), v: new Float32Array(this.NI * 3), life: new Float32Array(this.NI), max: new Float32Array(this.NI), size: new Float32Array(this.NI), gy: new Float32Array(this.NI), splat: new Uint8Array(this.NI) };
    this.ni = 0;
    // steam
    // 【蒸汽池】一个自定义 Points:每实例 position(3)+aSize+aAlpha+aSeed,drawRange 控制可见数量
    this.NS = Math.round(140 * k);
    const sg = new THREE.BufferGeometry();
    this.sp = new Float32Array(this.NS * 3); this.ssz = new Float32Array(this.NS); this.sal = new Float32Array(this.NS); this.sseed = new Float32Array(this.NS);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aSize', new THREE.BufferAttribute(this.ssz, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aAlpha', new THREE.BufferAttribute(this.sal, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(this.sseed, 1));
    sg.setDrawRange(0, 0);
    this.steamMat = new THREE.ShaderMaterial({ vertexShader: STEAM_VS, fragmentShader: STEAM_FS, transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 }, uTint: { value: new THREE.Color(0.92, 0.94, 0.96) } } });
    this.steam = new THREE.Points(sg, this.steamMat); this.steam.frustumCulled = false; this.steam.renderOrder = 2;
    this.group.add(this.steam);
    this.S = { v: new Float32Array(this.NS * 3), life: new Float32Array(this.NS), max: new Float32Array(this.NS), s0: new Float32Array(this.NS) };
    this.ns = 0;
    this.rnd = rng(9001);
    this.geyserT = -1; this.geyserPos = new THREE.Vector3(); this.accS = 0; this.accG = 0;
  }
  // 换墨色(队伍切换时由 BossModel.setInk 透传)
  setInk(c) { this.inkMat.color.copy(c); }
  // 【焦距校准】按视口高度与 FOV 推 uScale,使点精灵在屏幕上的像素尺寸与实际米数一致(透视缩放基准)
  setViewportHeight(h, fov = 50) { this.steamMat.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360)); }

  // 手机小怪归池时复位已有缓冲，保留GPU分配；与新建池相同的确定性随机序列。
  reset() {
    for (const array of [...Object.values(this.I), ...Object.values(this.S), this.sp, this.ssz, this.sal, this.sseed]) array.fill(0);
    this.ni = this.ns = 0; this.geyserT = -1; this.geyserDur = 0; this.geyserPos.set(0, 0, 0); this.accS = this.accG = 0;
    this.rnd = rng(9001); this.inkMesh.count = 0; this.inkMesh.visible = false;
    this.steam.visible = false; this.steam.geometry.setDrawRange(0, 0);
    this.inkMesh.instanceMatrix.needsUpdate = true;
    for (const attribute of Object.values(this.steam.geometry.attributes)) attribute.needsUpdate = true;
  }

  // 加载期借用真实实例缓冲画一次演出帧，结束后恢复粒子/RNG/可见性；不调用Boss或发送游戏事件。
  // 共享同一个instanceMatrix/蒸汽attribute，避免预热临时特效后实战仍要首次分配大缓冲。
  async withPreparationFrame(kind, draw) {
    if (this._preparing) throw new Error('Boss特效正在准备');
    this._preparing = true;
    const arrays = [...Object.values(this.I), ...Object.values(this.S), this.sp, this.ssz, this.sal, this.sseed, this.inkMesh.instanceMatrix.array];
    const copies = arrays.map(array => array.slice());
    const scalars = Object.fromEntries(['ni', 'ns', 'geyserT', 'geyserDur', 'accS', 'accG'].map(key => [key, this[key]]));
    const state = { rnd: this.rnd, geyserPos: this.geyserPos.clone(), inkCount: this.inkMesh.count, inkVisible: this.inkMesh.visible,
      steamVisible: this.steam.visible, start: this.steam.geometry.drawRange.start, count: this.steam.geometry.drawRange.count };
    try {
      this.rnd = rng(9001); this.ni = this.ns = 0; this.geyserT = -1; this.accS = this.accG = 0;
      const pos = new THREE.Vector3(0, 0.3, 0), up = new THREE.Vector3(0, 1, 0);
      if (kind === 'burst') { this.ink(pos, 90, up, 13, 0.75, 0.3, 0, 2.6); this.steamPuff(pos, 14, up, 4, 2.5, 2); }
      else if (kind === 'landing') this.ink(pos.setY(0.2), 30, up, 6, 1, 0.2, 0);
      else if (kind === 'steam') this.steamPuff(pos, 10, up, 3, 1.2, 1.3);
      else throw new Error(`未知Boss预备特效:${kind}`);
      this.update(1 / 30);
      return await draw([this.inkMesh, this.steam].filter(object => object.visible));
    } finally {
      arrays.forEach((array, index) => array.set(copies[index]));
      Object.assign(this, scalars); this.rnd = state.rnd; this.geyserPos.copy(state.geyserPos);
      this.inkMesh.count = state.inkCount; this.inkMesh.visible = state.inkVisible;
      this.inkMesh.instanceMatrix.needsUpdate = true;
      this.steam.visible = state.steamVisible; this.steam.geometry.setDrawRange(state.start, state.count);
      for (const attribute of Object.values(this.steam.geometry.attributes)) attribute.needsUpdate = true;
      this._preparing = false;
    }
  }

  // 【喷墨团】从 pos 沿 dir(单位向量)方向、以 speed±spread 散射出 n 个墨团;groundY 用于落地摊平
  // 【分配策略】未满则递增 ni,已满则回收"剩余寿命最短"的槽位(最不重要者),保证池内始终是活的
  /** n glossy ink blobs from pos: dir (unit) * speed ± spread, sizes in metres */
  ink(pos, n, dir, speed, spread = 0.6, size = 0.18, groundY = 0, life = 2.2) {
    const I = this.I, r = this.rnd;
    n = Math.max(1, Math.round(n * this.k));
    for (let c = 0; c < n; c++) {
      let i = -1;
      if (this.ni < this.NI) i = this.ni++;
      else { let best = 1e9; for (let j = 0; j < this.NI; j++) { const rem = I.max[j] - I.life[j]; if (rem < best) { best = rem; i = j; } } }
      const j = i * 3;
      I.p[j] = pos.x + (r() - 0.5) * 0.2; I.p[j + 1] = pos.y + (r() - 0.5) * 0.2; I.p[j + 2] = pos.z + (r() - 0.5) * 0.2;
      _d.set(dir.x + (r() - 0.5) * 2 * spread, dir.y + (r() - 0.5) * 2 * spread, dir.z + (r() - 0.5) * 2 * spread).normalize();
      const sp = speed * (0.55 + r() * 0.6);
      I.v[j] = _d.x * sp; I.v[j + 1] = _d.y * sp; I.v[j + 2] = _d.z * sp;
      I.life[i] = 0; I.max[i] = life * (0.7 + r() * 0.5); const rs = r(); I.size[i] = size * (0.3 + rs * rs * 1.3); I.gy[i] = groundY; I.splat[i] = 0;
    }
  }
  // 【蒸汽团】从 pos 沿 dir 冒出 n 个蒸汽;竖直方向额外 +0.6 初速(热气上浮),其余方向带较大随机
  steamPuff(pos, n, dir, speed, size = 1.2, life = 1.6) {
    const S = this.S, r = this.rnd;
    n = Math.max(1, Math.round(n * this.k));
    for (let c = 0; c < n; c++) {
      let i;
      if (this.ns < this.NS) i = this.ns++;
      else { let best = 1e9; i = 0; for (let j = 0; j < this.NS; j++) { const rem = S.max[j] - S.life[j]; if (rem < best) { best = rem; i = j; } } }
      const j = i * 3;
      this.sp[j] = pos.x + (r() - 0.5) * 0.3; this.sp[j + 1] = pos.y + (r() - 0.5) * 0.3; this.sp[j + 2] = pos.z + (r() - 0.5) * 0.3;
      const sp = speed * (0.6 + r() * 0.6);
      S.v[j] = (dir.x + (r() - 0.5) * 0.5) * sp; S.v[j + 1] = (dir.y + (r() - 0.5) * 0.3) * sp + 0.6; S.v[j + 2] = (dir.z + (r() - 0.5) * 0.5) * sp;
      S.life[i] = 0; S.max[i] = life * (0.7 + r() * 0.6); S.s0[i] = size * (0.6 + r() * 0.8); this.sseed[i] = r() * 10;
    }
    this.steam.geometry.attributes.aSeed.needsUpdate = true;
  }
  // 【持续喷泉】Boss 死亡时由 _emitEvent('geyser') 触发:一段时间内从 pos 连续上喷墨柱与蒸汽
  geyser(pos, dur = 3.6) { this.geyserT = dur; this.geyserDur = dur; this.geyserPos.copy(pos); }

  // 【逐帧推进】先跑喷泉发射器,再积分墨团(重力+落地摊平)与蒸汽(上浮+淡出),最后回填 GPU 缓冲
  update(dt) {
    // continuous geyser (death)
    // 【喷泉包络】k 是淡入淡出系数:前 0.2s 淡入、临近结束 0.8s 淡出,避免开关突兀
    if (this.geyserT > 0) {
      this.geyserT -= dt;
      const k = Math.min(1, this.geyserT / 0.8) * Math.min(1, (this.geyserDur - this.geyserT) / 0.2);
      this.accG += dt * 130 * k;
      while (this.accG >= 1) { this.accG -= 1; this.ink(this.geyserPos, 1, _d.set(0, 1, 0), 16 * (0.6 + 0.4 * k), 0.2, 0.15, this.geyserPos.y - 4.2, 3.0); }
      this.accS += dt * 10 * k; while (this.accS >= 1) { this.accS -= 1; this.steamPuff(this.geyserPos, 1, _p.set(0, 1, 0), 3, 2.4, 2.0); }
    }
    // ink blobs
    // 【墨团积分】用 live 指针把存活实例紧凑写入实例矩阵(压缩渲染),淘汰的槽位靠 ni 复位回收
    const I = this.I; let live = 0;
    for (let i = 0; i < this.ni; i++) {
      I.life[i] += dt;
      if (I.life[i] >= I.max[i]) continue;
      const j = i * 3;
      if (!I.splat[i]) {
        // 未落地:重力 -16(强于真实重力,出夸张弹道)+ 空气阻力 0.4/s;撞地后转 splat 并缩短寿命
        I.v[j + 1] -= 16 * dt; const dr = 1 - 0.4 * dt; I.v[j] *= dr; I.v[j + 2] *= dr;
        I.p[j] += I.v[j] * dt; I.p[j + 1] += I.v[j + 1] * dt; I.p[j + 2] += I.v[j + 2] * dt;
        if (I.p[j + 1] < I.gy[i] + 0.02 && I.v[j + 1] < 0) { I.splat[i] = 1; I.p[j + 1] = I.gy[i] + 0.02; I.max[i] = Math.min(I.max[i], I.life[i] + 0.7); }
      }
      // 【寿命尾部收缩】age>0.8 后线性缩到 0,做出墨点"蒸发"而非硬消失
      const age = I.life[i] / I.max[i];
      const sz = I.size[i] * (age > 0.8 ? 1 - (age - 0.8) / 0.2 : 1);
      _p.set(I.p[j], I.p[j + 1], I.p[j + 2]);
      // 落地:压扁成 xz 方向摊开的圆片;飞行中:沿速度方向拉长(椭球),拉长量随速度 saturate 到 2.6 倍
      if (I.splat[i]) { _q.identity(); _s.set(sz * 1.9, sz * 0.18, sz * 1.9); }
      else {
        const vl = Math.hypot(I.v[j], I.v[j + 1], I.v[j + 2]);
        _d.set(I.v[j], I.v[j + 1], I.v[j + 2]).divideScalar(vl || 1); _q.setFromUnitVectors(Z, _d);
        const st = 1 + Math.min(2.6, vl * 0.16); _s.set(sz / Math.sqrt(st), sz / Math.sqrt(st), sz * st);
      }
      _m.compose(_p, _q, _s);
      this.inkMesh.setMatrixAt(live++, _m);
    }
    this.inkMesh.count = live; this.inkMesh.visible = live > 0;
    if (live) this.inkMesh.instanceMatrix.needsUpdate = true;
    if (live === 0) this.ni = 0;
    // steam
    // 【蒸汽积分】更大阻力(1.4/s)+ 恒定上浮加速度 0.9;尺寸随 sqrt(u) 膨胀,透明度先快后慢地淡出
    const S = this.S; let ls = 0;
    for (let i = 0; i < this.ns; i++) {
      S.life[i] += dt;
      const j = i * 3;
      if (S.life[i] >= S.max[i]) { this.sal[i] = 0; continue; }
      const u = S.life[i] / S.max[i];
      const dr = 1 - 1.4 * dt; S.v[j] *= dr; S.v[j + 1] = S.v[j + 1] * dr + 0.9 * dt; S.v[j + 2] *= dr;
      this.sp[j] += S.v[j] * dt; this.sp[j + 1] += S.v[j + 1] * dt; this.sp[j + 2] += S.v[j + 2] * dt;
      this.ssz[i] = S.s0[i] * (0.5 + 1.6 * Math.sqrt(u));
      // 【透明度曲线】(1-u)^2 保证尾部平滑消失;开头 u*6 截断做出 0.17s 淡入
      this.sal[i] = 0.42 * Math.min(1, u * 6) * (1 - u) * (1 - u);
      ls++;
    }
    if (ls === 0) this.ns = 0;
    const sg = this.steam.geometry;
    sg.setDrawRange(0, this.ns); this.steam.visible = this.ns > 0;
    if (this.ns) { sg.attributes.position.needsUpdate = true; sg.attributes.aSize.needsUpdate = true; sg.attributes.aAlpha.needsUpdate = true; }
  }
  // 【销毁】释放两侧几何/材质并从父级移除(实例矩阵等 TypedArray 交给 GC,无需手动)
  dispose() { this.inkMesh.geometry.dispose(); this.inkMat.dispose(); this.steam.geometry.dispose(); this.steamMat.dispose(); this.group.removeFromParent(); }
}
