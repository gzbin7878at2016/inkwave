// ========================================================================================
// INKWAVE 主控模块 —— 启动(boot)、主循环(_loop/_frame)与游戏流程编排
// (菜单 ⇄ 吸引模式 ⇄ 对局 ⇄ 结算 的状态切换中枢)
//
// 【这个文件是什么】
//   整个游戏的"总装配工":它不负责具体玩法(那是 game/ 目录的职责),
//   而是决定"什么时候创建谁、按什么顺序、失败怎么降级"。
//   配套阅读:docs/BOOT.zh-CN.md(启动加载全流程新手导读,本文档的叙事版)。
//
// 【三条主线】
//   1. boot()              —— 启动加载全流程:渲染器创建 → 世界建造 → 着色器预热 → 标题画面
//   2. _buildWorld*()      —— 世界建造/重建:换图、换模式时重演的九零件装配线
//   3. _loop() / _frame()  —— 主循环:每一帧的完整旅程(rAF 驱动)
//
// 【新手阅读提示】
//   · 加载条上的每句俏皮话("调配墨水中…"等)都对应 boot() 里一次 progress() 调用
//   · 每个 G.xxx 都是注册到全局上下文单例(core/ctx.js)的系统,供各层随时取用
//   · 模块加载失败不致命:loadModule() 会降级到 dev/stubs.js 的假实现
// ========================================================================================
import * as THREE from 'three';
import { mobileViewport } from './platform/mobileViewport.js';
import { mobileFrameDue } from './platform/mobileFramePacing.js';
import { G, on, emit, clamp, damp } from './core/ctx.js';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { mapTheme,
  DEFAULT_SETTINGS, QUALITY, TEAM_PALETTES, COLORBLIND_PALETTE, TEAM_NAMES, WEAPONS, WEAPON_ORDER, WEAPON_SUCCESSOR, ZONES, SUB, SUBS, SUB_ORDER, SPECIALS, SPECIAL_ORDER,
  MAPS, DIFFICULTY, PLAYER, PROGRESSION, VERSION, MATCH, OFFLINE_MAPS, mapOfflineOk, mapNoBots, mapBossOk,
} from './config.js';
import { warmMobileScene, warmMobilePostprocess } from './platform/mobileStartup.js';
import { createMobilePreparationUI } from './platform/mobilePreparation.js';
import { prepareMobileBoss } from './platform/mobileBossPreparation.js';
import { prepareMobileBossMinimapWorker, clearMobileBossMinimapWorkerForMatch } from './platform/mobileBossMinimapWorker.js';
import { prepareMobileCombat } from './platform/mobileCombatPreparation.js';
import { waitForMobileFrame } from './platform/mobileFrameReady.js';
import { Level } from './world/level.js';
import { MAP_LAYOUTS } from './world/maps.js';
import { PaintSystem } from './world/paint.js';
import { createLevelMaterial, setLevelLamps } from './world/levelMaterial.js';
import { createMobileLevelMaterial } from './world/mobileLevelMaterial.js';
import { SwimWake } from './fx/swimWake.js';
import { Decor } from './world/decor.js';
import { createMuralTexture } from './world/murals.js';
import { layoutThumbSVG } from './world/mapThumb.js';
import { dressingFor } from './world/dressing.js';
import { inMode, layoutFor, variantKey } from './world/variants.js';
import './game/kits/index.js';   // kit weapons + subs register themselves (game/kits/registry.js)
import { Physics, Hit } from './game/physics.js';
import { NavGraph } from './game/nav.js';
import { Projectiles } from './game/weapons.js';
import { SubSystem } from './game/subs.js';
import { SpecialSystem } from './game/specials.js';
import { CameraRig } from './game/cameraRig.js';
import { Match } from './game/match.js';
import { Minimap } from './game/minimap.js';
import { Showcase } from './game/showcase.js';
import { ZoneMarks } from './fx/zoneMarks.js';
import { BOSS_MODE } from './boss/bossMode.js';
import { setLang, t } from './i18n/strings.js';

const params = new URLSearchParams(location.search);
// dev-only: ?devstage lets an online-only stage (config onlineOnly — Cargo Terminal) boot as the backdrop and be walked
// solo offline (never with bots); without it such a stage only ever loads for an online match
const DEV_STAGE = params.has('devstage');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
// 手机预热在rAF之后再排普通任务，避免Promise微任务在同一帧绘制前继续吞掉主线程。
const nextMobileFrame = () => new Promise(resolve => document.hidden ? setTimeout(resolve, 0) : requestAnimationFrame(() => setTimeout(resolve, 0)));
const REFRESH_RATES = [30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 240]; // common display rates (Hz)

// ------------------------------------------------------------------------------------------ persistence
// 【持久化小工具】设置/档案都存在浏览器的 localStorage(一个网页专用的键值小仓库)。
// 读取时与默认值合并({...def, ...v}):旧版本存档缺新字段时自动补默认,不会崩。
function loadJSON(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v ? { ...def, ...v } : { ...def }; } catch { return { ...def }; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }
const DEFAULT_PROFILE = { name: 'Player', level: 1, xp: 0, wins: 0, matches: 0, totalTurf: 0, weapon: 'shooter' };

async function loadModule(path, stubName) {
  try { return await import(path); }
  catch (e) {
    console.error(`[inkwave] failed to load ${path} — using stub`, e);
    const stubs = await import('./dev/stubs.js');
    return stubName ? stubs : {};
  }
}

// ========================================================================================
// Game —— 整个游戏只有一个实例(文件末尾 new Game()),它是所有系统的"装配车间 + 调度员"
// ========================================================================================
class Game {
  // ----------------------------------------------------------------------------------------
  // boot() —— 启动加载全流程(异步)。
  // 阶段与进度条标签的对应关系(每行末尾是你在加载条上看到的中文):
  //   0.05 调配墨水中…   → 设置/档案、语言、渲染三件套、输入
  //   0.15 搭建广场中…   → 动态 import 五大模块(角色/特效/环境/音频/音乐)
  //   0.40 灌注海港中…   → 程序化纹理 + _buildWorld 九零件装配线(最重的一段)
  //   0.55 教鱿鱼游泳中… → 环境光照(天空/太阳/环境反射)
  //   0.70 调校触手中…   → 弹道/副武器/大招/特效池/展示台/联网模块
  //   0.85 预热中…       → 屏幕外放遍特效 + compileAsync 全场景着色器编译
  //   1.00 就绪!         → 模拟 3 帧 → 标题画面 → 主循环接管
  // 每个 await progress(...) 之间就是一个"工作区间",想深挖就顺着函数名往里跳。
  // ----------------------------------------------------------------------------------------
  async boot() {
    const t0 = performance.now();
    const diagnostics = globalThis.inkwaveDiagnostics;
    diagnostics?.startupCheckpoint('boot-setup');
    // real top-down thumbnails for the stage cards, generated from each layout's geometry
    // 【在进入加载条之前】:为每张地图的选关卡卡片用代码生成一张俯视 SVG 缩略图
    for (const m of MAPS) { try { m.thumb = layoutThumbSVG(MAP_LAYOUTS[m.layout || m.id], m.theme); } catch (e) { console.warn('thumb', m.id, e); } }
    // 手机优先稳定30帧/2倍高清；保留玩家之后手动选择60帧。
    const defaults = window.inkwaveMobile ? { ...DEFAULT_SETTINGS, lang: 'zh', quality: 'low', mobileVisual: 'hd', mobileDynamicResolution: false, shadows: false, bloom: false, fpsCap: 30, showFps: true } : DEFAULT_SETTINGS;
    this.settings = G.settings = loadJSON('inkwave.settings', defaults);
    // 用户本轮优先稳定30帧，单独迁移帧率；保留既有高清和触控偏好，之后仍可手动切60。
    if (window.inkwaveMobile && this.settings.mobileDefaultsVersion !== 1) {
      Object.assign(this.settings, { mobileVisual: 'hd', mobileDynamicResolution: false, mobileDefaultsVersion: 1 });
      saveJSON('inkwave.settings', this.settings);
    }
    if (window.inkwaveMobile && this.settings.mobilePacingVersion !== 1) {
      Object.assign(this.settings, { fpsCap: 30, mobilePacingVersion: 1 });
      saveJSON('inkwave.settings', this.settings);
    }
    setLang(this.settings.lang || 'en');   // before any menu renders (src/i18n/strings.js)
    document.title = t('INKWAVE — Turf Riot');
    // desktop app: the window's fullscreen state is owned by the native shell; mirror it into settings for the menu
    if (window.inkwaveNative) {
      this.settings.fullscreen = window.inkwaveNative.isFullScreen();
      window.inkwaveNative.onFullScreenChange((on) => { this.settings.fullscreen = on; });
    }
    // v1.1: fov became horizontal — migrate old vertical values once
    if (this.settings.fovMode !== 'h') { this.settings.fov = DEFAULT_SETTINGS.fov; this.settings.fovMode = 'h'; saveJSON('inkwave.settings', this.settings); }
    this.profile = loadJSON('inkwave.profile', DEFAULT_PROFILE);
    if (WEAPON_SUCCESSOR[this.profile.weapon]) this.profile.weapon = WEAPON_SUCCESSOR[this.profile.weapon];   // retired weapons
    const app = document.getElementById('app');
    this.uiRoot = document.getElementById('ui-root');
    this.fadeEl = document.getElementById('fade');

    // UI first so the loading screen shows immediately
    // 【UI 优先策略】先加载最小的 UI 模块、立刻亮出加载条,再在加载条的掩护下干所有重活——
    // 原则是"让'正在加载'本身尽快可见",玩家永不对着白屏。
    const [menusMod, hudMod] = await Promise.all([loadModule('./ui/menus.js'), loadModule('./ui/hud.js')]);
    this.menus = G.menus = menusMod.Menus ? new menusMod.Menus(this.uiRoot, this._menuApi()) : null;
    this.hud = G.hud = hudMod.HUD ? new hudMod.HUD(this.uiRoot, { playSound: (n, o) => G.audio?.play(n, o) }) : null;
    this._hudMod = hudMod;   // kept so a language switch can rebuild the HUD in the new language (_rebuildHud)
    // map diorama pins/finish live inside the HUD layer (under every other HUD element)
    try { const { DioramaOverlay } = await import('./ui/diorama.js'); this.diorama = new DioramaOverlay(this.hud ? this.hud.el : this.uiRoot); } catch (e) { console.error('[inkwave] diorama', e); this.diorama = null; }
    this.hud?.setVisible(false);
    this.menus?.show('loading');
    this.bootMarks = [];
    // progress() —— 进度条推进器:记录里程碑耗时(供控制台 __inkwave.bootMarks 调试)→
    // 通知 UI 更新标签 → 等一帧(nextFrame)让浏览器把加载画面真的画出来再继续。
    // 注意:百分比是写死的里程碑,不是实测值——条条的丝滑动画在 menus.js 里做。
    const progress = async (p, label) => { this.bootMarks.push([label, Math.round(performance.now() - t0)]); diagnostics?.startupCheckpoint(`loading-${Math.round(p * 100)}`, label); diagnostics?.record('boot-progress', { p, label }); this.menus?.setLoading(p, label); await nextFrame(); };
    await progress(0.05, 'Mixing ink…');

    // renderer / scene
    // 【渲染三件套】Renderer=胶卷+冲印厂(core/renderer.js,含 HDR 后处理链)、Scene=舞台、Camera=镜头。
    // 相机四参数:视野角(设置里可调)/画面宽高比/0.15=近裁剪(贴脸多近开始可见)/6500=远裁剪(天际线)。
    this.R = new Renderer(app, this.settings);
    G.renderer = this.R.renderer;
    const scene = (G.scene = new THREE.Scene());
    const camera = (G.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.15, 6500));
    camera.position.set(0, 40, -60);
    this.R.setScene(scene, camera);
    this.input = G.input = new Input(this.R.renderer.domElement);
    this.input.onKey = (e, repeat) => this._onKey(e, repeat);
    this.input.onUnlock = () => this._onPointerUnlock();
    // after a focus steal while the map was held, the next click on the game takes the mouse back (no pause detour)
    this.R.renderer.domElement.addEventListener('mousedown', () => {
      if (this._relock && G.mode === 'match' && this.match && !this.match.paused && !this.menus?.current) { this._relock = false; this.input.requestLock(); }
    });

    // modules built by other authors
    // 【第二梯队下载】静态 import 之外,这五个大模块用 import() 动态加载——运行到这一行才发 HTTP 请求,
    // Promise.all 并行下载。模块由不同作者维护、允许缺席:加载失败自动降级到 dev/stubs.js 假实现。
    const [charMod, fxMod, envMod, audioMod, musicMod] = await Promise.all([
      loadModule('./game/character.js', true), loadModule('./fx/fx.js', true), loadModule('./world/environment.js', true),
      loadModule('./audio/audio.js', true), loadModule('./audio/music.js', true),
    ]);
    this.CharacterClass = charMod.Character;
    try { this.PropKit = (await import('./world/props.js')).PropKit; } catch (e) { console.error('[inkwave] prop kit failed to load', e); this.PropKit = null; }
    G.audio = audioMod.audio; G.music = musicMod.music;
    await progress(0.15, 'Building the plaza…');

    // world
    // 【选图】URL ?map= 参数 > 默认第一张图;纯单机启动时,仅联机可用的图自动降级到第一张单机图。
    // q = 画质档(QUALITY 表:决定墨图集尺寸、阴影分辨率等所有"按质量伸缩"的数值)
    // (old ?map=sunset links = Tidewater at dusk)
    const pm = params.get('map') === 'sunset' ? 'tidewater' : params.get('map');
    let map = MAPS.find((m) => m.id === pm) || MAPS[0];
    if (!mapOfflineOk(map.id) && !DEV_STAGE) { console.info(`[inkwave] ${map.name} is online only — booting ${OFFLINE_MAPS[0].name}`); map = OFFLINE_MAPS[0]; }
    this.time = params.get('time') === 'dusk' || params.get('map') === 'sunset' ? 'dusk' : (this.settings.timeOfDay === 'dusk' ? 'dusk' : 'day');
    this.theme = mapTheme(map, this.time);
    const q = QUALITY[this.settings.quality] || QUALITY.high;
    // 【先画"皮肤"再建"身体"】本项目没有贴图文件,两张核心纹理都是此刻用代码现画的:
    //   murals  —— 壁画图集:关卡涂鸦/招牌,Canvas 逐笔画成(画在墨水下层的贴图)
    //   texlib  —— 纹理库:混凝土/防滑槽/锈痕…逐纹素 2×2 子采样烘焙(texlib.js)
    // 画失败不致命:texlib 为 null 时材质走内置程序化兜底。
    this.murals = await createMuralTexture();
    try {
      const { createTextureLibrary } = await import('./world/texlib.js');
      this.texlib = await createTextureLibrary(G.renderer, { size: q.paintAtlas >= 4096 ? 512 : 256 });
    } catch (e) { console.error('[inkwave] texture library failed — procedural fallback', e); this.texlib = null; }
    // 【建造世界】加载条背后最重的一段:九零件装配线(道具→关卡→物理→光照图→墨水→材质→网格→装饰→导航)。
    // 详见 _buildWorldNow() 的中文导读。换地图/换模式时会重演;同图重赛则短路跳过。
    await this._buildWorld(map);
    this.zoneMarks = new ZoneMarks(scene);   // Zone Control ground markings: build / clear themselves on 'match:state'
    // 【0.40 灌注海港中…】世界本体已建成
    await progress(0.4, 'Filling the harbor…');
    const B = G.level.bounds;
    // 【环境光照】天空穹顶、太阳平行光、环境反射贴图(envMap 挂到 scene.environment 后,
    // 所有 PBR 材质的"间接光/反射"都由它供);曝光 0.94 是阳光下的基准值。
    G.env = new envMod.Environment(G.renderer, scene, { bounds: B, theme: this.theme, shadowSize: q.shadowSize, footprint: this._footprint(G.level) });
    if (G.env.envMap) scene.environment = G.env.envMap;
    // sky-fill balance (scene.environmentIntensity, hemisphere) + per-theme exposure are the environment theme's job
    // (Environment.setTheme), so a stage/time looks the same booted into or switched to mid-session
    G.renderer.toneMappingExposure = 0.94;
    await progress(0.55, 'Teaching squids to swim…');
    // 【0.55 教鱿鱼游泳中…】以下系统的共同模式:构造时只搭骨架(对象池/场景挂点),不造弹药不造粒子——
    // 加载期建池,运行期复用,游戏中永不因新建对象而分配内存。
    G.projectiles = new Projectiles(scene);
    G.subs = new SubSystem(scene);
    G.specials = new SpecialSystem(scene);
    G.fx = new fxMod.FX(scene, { quality: q });
    G.fx.setLighting?.(G.env.getSkyColors?.());
    this._applyNight();
    G.fx.setCollider?.((from, to) => { const h = G.physics.segment(from, to, this._fxHit || (this._fxHit = new Hit()), true); return h.hit ? { point: h.point, normal: h.normal } : null; });
    G.fx.onDropletLand = (point, normal, color, size) => {
      if (G.netm) return;   // online: turf only comes from replicated splats, never from local-only cosmetic droplets
      const team = this._teamOfColor(color);
      if (team < 0) return;
      G.paint.splat(this._tmpV.copy(point).addScaledVector(normal, 0.05), clamp(size * 2.4, 0.12, 0.45), team, { seed: Math.random() });
    };
    this._tmpV = new THREE.Vector3(); this._tmpC = new THREE.Color();
    this.rig = new CameraRig(camera);
    G.post = this.R; G.game = this; G.rig = this.rig;
    // optional modules owned by the VFX / screen-FX work streams (absent = skipped)
    try { const m = await import('./fx/fxHooks.js'); this.fxHooks = m.initFxHooks?.(G) || null; } catch (e) { if (!/Failed to fetch|Cannot find module|404/i.test(String(e))) console.error('[inkwave] fxHooks', e); }
    try { const m = await import('./fx/screenfx.js'); this.screenfx = m.ScreenFX ? new m.ScreenFX(this.R, G) : null; } catch (e) { if (!/Failed to fetch|Cannot find module|404/i.test(String(e))) console.error('[inkwave] screenfx', e); }
    this.showcase = new Showcase(G.renderer, this.CharacterClass);
    // online session (G.net) — the menus' online screens and startNetMatch/netMatchGo/netMatchEnd below drive it
    try { (await import('./net/session.js')).installNet(); } catch (e) { console.error('[inkwave] net', e); }
    G.net?.on?.('lobby', ({ lobby }) => this._roomPalette(lobby));
    await progress(0.7, 'Tuning the tentacles…');

    this._setPalette(this._pickPalette());
    this._bindEvents();
    this._startAttract();
    // 首次使用才链接的材质会造成卡顿。手机分批真实绘制并让出线程；PC保留原编译流程。
    // compileAsync没有后台线程保证，特别是设备缺少KHR_parallel_shader_compile时。
    await progress(0.85, 'Warming up…');
    if (window.inkwaveMobile) {
      // 保留特效池/炸弹替身准备，逐批真实绘制；不抢跑无关展台/联机大厅。
      const finish = diagnostics?.beginStage('startup-effect-pools');
      try { this._warmup(); } finally { finish?.(); }
      // 先完成角色动画/LOD的首次更新，让真正将显示的网格进入分批队列。
      // 否则预热后首个完整帧才创建/显示另一套角色材质，仍会集中阻塞。
      const skipRender = this._skipRender;
      try {
        this._skipRender = true;
        for (let i = 0; i < 2; i++) {
          const done = diagnostics?.beginStage('startup-simulation-prime', { frame: i + 1 });
          try { this._frame(1 / 60, 'startup-prime'); } finally { done?.(); }
          await nextMobileFrame();
        }
      } finally { this._skipRender = skipRender; }
      await warmMobilePostprocess(scene, G.renderer, this.R.composer, nextMobileFrame, diagnostics);
      await warmMobileScene(scene, () => this.R.render(), nextMobileFrame, diagnostics);
      for (const mesh of this._warmMeshes || []) G.scene.remove(mesh);
      this._warmMeshes?.[0]?.geometry.dispose(); this._warmMeshes = null;
    } else {
      this._warmup();
      // 桌面沿用原有场景编译预热。
      try { await G.renderer.compileAsync(scene, camera); } catch { G.renderer.compile(scene, camera); }
      for (const m of this._warmMeshes || []) { G.scene.remove(m); }
      this._warmMeshes?.[0]?.geometry.dispose(); this._warmMeshes = null;
    }
    await progress(0.93, 'Warming up…');
    // 手机已逐批触发首次资源使用，只做1次完整帧收尾；PC仍保留原3帧初始化。
    for (let i = 0; i < (window.inkwaveMobile ? 1 : 3); i++) {
      const finish = diagnostics?.beginStage('startup-full-frame', { frame: i + 1 });
      try { this._frame(1 / 60, window.inkwaveMobile ? 'startup-frame' : null); } finally { finish?.(); }
      await nextFrame();
    }
    // 手机图形失败必须止于启动门槛，不能继续记录Ready或创建可交互主菜单。
    if (window.inkwaveMobile && (this.mobileSuspended || this.R.mobileSafety?.state.fatal || this.R.renderer.getContext().isContextLost())) {
      this.frozen = true;
      diagnostics?.graphicsFailure?.();
      throw new Error('手机图形初始化失败，已停止加载。请退出后重新打开，诊断日志已保留。');
    }
    await progress(1, 'Ready!');
    await new Promise((r) => setTimeout(r, 250));   // 停 250ms,让你看清"就绪!"(纯节奏设计)

    this.timer = new THREE.Timer(); this.timer.connect?.(document);
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 60;
    G.mode = 'menu';
    this.menus?.show(params.has('skipTitle') ? 'main' : 'title');
    // the online hub / lobby set loads in the background once the menus are idle (no arena flash on the first visit)
    // 【后台预载大厅】菜单闲置 2.5 秒后偷偷预建联机大厅场景——第一次进大厅才不闪加载条
    if (!window.inkwaveMobile && !params.has('autostart')) setTimeout(() => { if (G.mode === 'menu') this.showcase.preloadLobby?.(); }, 2500);
    this._applyAudioVolumes();
    requestAnimationFrame((t) => this._loop(t));
    if (params.has('autostart')) {
      const pm = params.get('mode');
      this.api.startMatch({ mapId: map.id, difficulty: params.get('difficulty') || this.settings.difficulty, duration: +params.get('autostart') || undefined, mode: pm === 'boss' || pm === 'zones' ? pm : 'turf' });
    }
    this.bootMs = Math.round(performance.now() - t0);
    window.__inkwave = this; // debug/audit hook
    window.__G = G;
    diagnostics?.finishStartup();
    this.debug = {
      endMatch: (t = 0.5) => { if (this.match && !this.match.attract) this.match.time = t; },
      paintRandom: (n = 400) => { const v = new THREE.Vector3(); for (let i = 0; i < n; i++) { v.set((Math.random() - 0.5) * 48, 0.4, (Math.random() - 0.5) * 86); G.paint.splat(v, 0.8 + Math.random() * 1.4, Math.random() < 0.5 ? 0 : 1); } },
      // deterministic stepping for audits: freeze(), then step(ms) advances the sim at a fixed 60 Hz and renders once
      freeze: () => { this.frozen = true; },
      unfreeze: () => { this.frozen = false; this.timer.update(this._lastTs); },
      step: (ms = 16.7) => {
        const n = Math.max(1, Math.round(ms / (1000 / 60)));
        this._skipRender = true;
        for (let i = 0; i < n - 1; i++) this._frame(1 / 60);
        this._skipRender = false;
        this._frame(1 / 60);
      },
      key: (code, down) => { if (down) { this.input.keys.add(code); this.input.pressed.add(code); } else this.input.keys.delete(code); },
      fire: (on) => { this.input.mouse.left = on; },
      freezeBots: () => { for (const a of G.actors) if (a.bot && !a.isLocal) a.bot.update = () => { a.intent.move.set(0, 0, 0); a.intent.fire = false; }; },
    };
  }

  // Build (or rebuild) everything that depends on the stage layout: level, collision, paint atlas, surface material,
  // decor, navigation graph and minimap. Environment/FX/projectiles persist across stages.
  // mode: 'turf' | 'zones' — a stage with Zone Control-only pieces (variants.js) builds a separate world for that mode
  // 【世界建造入口】换图/换模式时重演装配线;同图重赛走 worldKey 短路直接返回(秒进)。
  // _building 标志位:重建期间的 await(光照图下载)会让新旧世界短暂不一致,
  // 主循环每帧开头检查它并暂停模拟,防止"用新关卡射线、采样旧墨图集"的错位帧。
  async _buildWorld(map, mode = 'turf') {
    const scene = G.scene;
    const layoutId = map.layout || map.id;
    const worldKey = variantKey(layoutId, MAP_LAYOUTS[layoutId], dressingFor(layoutId), mode);
    if (this.worldKey === worldKey) { this.mapDef = map; return; }
    // the rebuild awaits (lightmap fetch) between swapping G.level and G.paint: hold the simulation until every
    // stage-dependent system matches, or a frame in between raycasts the new level and samples the old paint atlas
    this._building = true;
    try { await this._buildWorldNow(map, scene, layoutId, mode, worldKey); } finally { this._building = false; }
  }
  async _buildWorldNow(map, scene, layoutId, mode = 'turf', worldKey = layoutId) {
    // 【九零件装配线——顺序本身就是设计】
    //   ① 道具先行:它们交还碰撞盒,必须赶在关卡定型之前(否则箱子没碰撞)
    //   ② Level 关卡几何(面/块/坡) ③ Physics 物理加速结构 ④ 烘焙 AO 光照图(唯一网络下载)
    //   ⑤ PaintSystem 墨水图集(GPU 视觉 + CPU 判定双轨) ⑥ createLevelMaterial 缝合材质
    //   ⑦ 关卡网格上桌(普通版 + 镂空格栅版两份) ⑧ Decor 装饰 ⑨ NavGraph 导航 + Minimap 小地图
    // 先拆旧:旧网格/材质/道具/墨图集全部 dispose,显存不留残骸。
    this.zoneMarks?.clear();   // zone markings belong to the old stage's faces
    if (this.levelMesh) { scene.remove(this.levelMesh, this.grateMesh); this.levelMesh.geometry.dispose(); this.grateMesh?.geometry.dispose(); this.levelMat.dispose(); this.grateMat?.dispose(); }
    if (this.decor) { scene.remove(this.decor.group); }
    if (this.props) { this.props.dispose?.(); this.props = null; }
    G.paint?.dispose();
    this.layoutId = layoutId; this.worldKey = worldKey;
    this.mapDef = map;
    const q = QUALITY[this.settings.quality] || QUALITY.high;
    // set dressing first: solid props hand back collision boxes that become part of the level (physics, nav, paint)
    const colliders = [];
    if (this.PropKit) {
      try {
        this.props = new this.PropKit(scene, { castShadow: true, quality: this.settings.quality });
        for (const it of dressingFor(layoutId)) {
          if (!inMode(it, mode)) continue;
          const r = this.props.add(it.type, it);
          if (r && r.colliders) colliders.push(...r.colliders);
        }
        this.props.build();
      } catch (e) { console.error('[inkwave] props failed', e); this.props = null; }
    }
    const level = (G.level = new Level(layoutFor(MAP_LAYOUTS[layoutId], mode), colliders));
    G.physics = new Physics(level);
    const lightmap = await this._loadLightmap(level, worldKey);
    const paintSize = window.inkwaveMobile ? Math.min(q.paintAtlas, 2048, G.renderer.capabilities.maxTextureSize) : q.paintAtlas;
    G.paint = new PaintSystem(G.renderer, level, { atlasSize: paintSize, maxDensity: paintSize >= 4096 ? 30 : 18 });
    this.murals.userData.setStage?.(layoutId);   // stage decals (murals.js) before the material reads the table
    const surfaceFactory = window.inkwaveMobile ? createMobileLevelMaterial : createLevelMaterial;
    this.levelMat = surfaceFactory(G.paint.texture, G.paint.size, this.murals, { lightmap, texlib: this.texlib });
    (this.swimWake || (this.swimWake = new SwimWake())).reset();
    this.levelMesh = new THREE.Mesh(level.buildGeometry(G.paint.size), this.levelMat);
    this.levelMesh.castShadow = true; this.levelMesh.receiveShadow = true;
    this.levelMesh.name = 'level';
    scene.add(this.levelMesh);
    // grates: same surface shader, cut-out holes, no ink (they cast no shadow; the mesh is too fine for the shadow map)
    this.grateMat = surfaceFactory(G.paint.texture, G.paint.size, this.murals, { grate: true, lightmap, texlib: this.texlib });
    const gg = level.buildGeometry(G.paint.size, (b) => b.grate);
    this.grateMesh = new THREE.Mesh(gg, this.grateMat);
    this.grateMesh.receiveShadow = true; this.grateMesh.visible = gg.index.count > 0;
    scene.add(this.grateMesh);
    this.decor = new Decor(scene, level);
    G.nav = new NavGraph(level, G.physics);
    this.minimap = new Minimap(level, G.paint);
    if (G.env?.rebuildForArena) G.env.rebuildForArena(level.bounds, this._footprint(level));
    else if (G.env?.setFootprint) G.env.setFootprint(this._footprint(level));
    if (G.teamColors[0]) this._setPalette(this.palette || this._pickPalette());
  }

  // Baked AO (tools/bake-ao.mjs). Applied only when the bake matches this exact layout.
  // 【烘焙光照图加载——全项目唯一像样的"资产下载"】
  // 两张小文件:json(每米像素数 ppm + 布局 hash)+ png(预烘焙的环境光遮蔽)。
  // 两个工程细节:① hash 校验——关卡布局改过,旧烘焙图直接作废降级,绝不显示错误光影;
  //              ② 失败优雅降级——没有光照图就用全亮,游戏照样跑。
  async _loadLightmap(level, layoutId) {
    try {
      const meta = await (await fetch(`assets/lightmaps/${layoutId}.json`, { cache: 'no-cache' })).json();
      level.layoutLightmap(meta.ppm, meta.size);
      if (level.layoutHash !== meta.hash) { console.warn(`[inkwave] lightmap for ${layoutId} is stale — re-run tools/bake-ao.mjs`); level.lightSize = 0; for (const f of level.faces) f.light = null; return null; }
      const tex = await new THREE.TextureLoader().loadAsync(`assets/lightmaps/${layoutId}.png?h=${meta.hash}`);
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;
      return tex;
    } catch (e) {
      console.warn('[inkwave] no lightmap for', layoutId, e.message);
      for (const f of level.faces) f.light = null;
      return null;
    }
  }

  // deck slabs (top at deck level, bottom in the sea) for the environment: axis-aligned boxes and boxes turned about Y
  // (obox) as oriented rects — centre (cx, cz), half extents (hx, hz), local x axis (ax, az) — plus their XZ AABB
  _footprint(level) {
    return level.blocks.filter((b) => (b.aligned || Math.abs(b.axes[1].y) > 0.9999) && b.aabbMax.y < 0.01 && b.aabbMax.y > -2.5 && b.aabbMin.y < -1)
      .map((b) => ({ minX: b.aabbMin.x, maxX: b.aabbMax.x, minZ: b.aabbMin.z, maxZ: b.aabbMax.z,
        ...(b.aligned ? {} : { cx: b.center.x, cz: b.center.z, hx: b.half.x, hz: b.half.z, ax: b.axes[0].x, az: b.axes[0].z }) }));
  }

  _warmup() {
    // 【预热】在屏幕外(y=-30,玩家看不见)把每种特效各放一遍:爆炸/涟漪/枪口焰/出生闪光……
    // 副作用 = 所有"第一次创建"的对象与着色器此刻全部触发;再给懒创建的炸弹材质挂两个替身球,
    // 确保后面的 compileAsync 把它们的着色器也编进去。编完即拆,不留残骸。
    // trigger one of each effect off-screen so shaders + pools exist
    const p = new THREE.Vector3(0, -30, 0), n = new THREE.Vector3(0, 1, 0);
    const c = G.teamColors[0];
    try {
      G.fx.burst(p, n, c, { count: 4 }); G.fx.ring(p, n, c, {}); G.fx.explosion(p, c, 2); G.fx.splatted(p, c);
      G.fx.wake(p, n, c, 5); G.fx.muzzle(p, n, c); G.fx.spawnFlash(p, c);
    } catch (e) { console.warn('fx warmup', e); }
    // materials made lazily on first use (a thrown bomb's) get an off-screen stand-in so the boot compile covers them
    try {
      const g = new THREE.SphereGeometry(0.1, 8, 6);
      this._warmMeshes = [0, 1].map((t) => { const m = new THREE.Mesh(g, G.projectiles._bombMat(t)); m.position.copy(p); m.castShadow = true; G.scene.add(m); return m; });
    } catch (e) { console.warn('bomb warmup', e); }
  }

  // ---------------------------------------------------------------------------------------- palette
  // the room's colours while you're in one (so the lobby line-up and the match agree on every screen)
  _pickPalette() {
    if (this.settings.colorblind) return COLORBLIND_PALETTE;
    const room = G.net && G.net.state !== 'offline' && G.net.state !== 'error' && TEAM_PALETTES[G.net.lobby?.palette];
    if (room) return room;
    const p = TEAM_PALETTES[(Math.random() * TEAM_PALETTES.length) | 0];
    return p;
  }
  paletteIndex() { const i = TEAM_PALETTES.indexOf(this.palette); return i >= 0 ? i : (Math.random() * TEAM_PALETTES.length) | 0; }
  _roomPalette(l) {
    if (this.settings.colorblind || G.mode === 'match' || !l) return;
    const p = TEAM_PALETTES[l.palette];
    if (p && p !== this.palette) this._setPalette(p);
  }
  _setPalette(p) {
    this.palette = p;
    G.teamHex = [p.a, p.b];
    G.teamColors = [new THREE.Color(p.a), new THREE.Color(p.b)];
    this.levelMat.userData.uniforms.uTeamA.value.copy(G.teamColors[0]);
    this.levelMat.userData.uniforms.uTeamB.value.copy(G.teamColors[1]);
    if (this.grateMat) { this.grateMat.userData.uniforms.uTeamA.value.copy(G.teamColors[0]); this.grateMat.userData.uniforms.uTeamB.value.copy(G.teamColors[1]); }
    // warm/low light mutes saturated ink: give it more self-glow at dusk so team colours stay the loudest thing on screen
    // ink self-light: more at dusk, a touch more in golden hour's long shadows
    this.levelMat.userData.uniforms.uInkGlow.value = { sunset: 0.2, golden: 0.1 }[this.theme] ?? 0.07;
    this.decor.setTeamColors(G.teamColors);
    this.props?.setTeamColors?.(G.teamColors[0], G.teamColors[1]);
    G.projectiles.refreshColors();
    for (const a of G.actors) a.character.setColor(G.teamColors[a.team]);
    this.minimap.version = -1;
    this.menus?.setAccent?.(p.a, p.b);
  }
  _teamOfColor(color) {
    const c = color.isColor ? color : this._tmpC.set(color);
    for (let t = 0; t < 2; t++) { const k = G.teamColors[t]; if (Math.abs(k.r - c.r) + Math.abs(k.g - c.g) + Math.abs(k.b - c.b) < 0.05) return t; }
    return -1;
  }

  // ---------------------------------------------------------------------------------------- menus api
  _menuApi() {
    const self = this;
    const api = (this.api = {
      version: VERSION,
      weapons: WEAPONS, weaponOrder: WEAPON_ORDER, specials: SPECIALS, specialOrder: SPECIAL_ORDER, sub: SUB.bomb, subs: SUBS, subOrder: SUB_ORDER, maps: MAPS, difficulties: DIFFICULTY,
      getSettings: () => ({ ...self.settings }),
      setSettings: (partial) => self._setSettings(partial),
      getProfile: () => {
        const p = self.profile;
        return { ...p, played: p.matches, xpToNext: PROGRESSION.xpForLevel(p.level) };
      },
      setProfileName: (n) => { self.profile.name = String(n || 'Player').slice(0, 16); saveJSON('inkwave.profile', self.profile); },
      // locker look ({ hair, skin, outfit, eyes, hat, brows, … } — indices into character-style.js tables)
      setProfileStyle: (st) => { self.profile.style = { ...(st || {}) }; saveJSON('inkwave.profile', self.profile); },
      getLoadout: () => ({ weapon: self.profile.weapon || 'shooter', sub: self._subFor(self.profile.weapon), special: self._specialFor(self.profile.weapon) }),
      setLoadout: ({ weapon, sub, special }) => {
        if (weapon !== undefined) {
          if (!WEAPONS[weapon]) return;
          self.profile.weapon = weapon;
        }
        if (sub !== undefined) self.profile.sub = SUBS[sub] ? sub : null;
        if (special !== undefined) self.profile.special = SPECIALS[special] ? special : null;
        saveJSON('inkwave.profile', self.profile);
        if (self.menus?.current === 'loadout' && weapon !== undefined) self.showcase.showLoadout(weapon, G.teamColors[0], self.profile.style);
        self._applyPracticeLoadout();   // in practice the new kit is in your hands straight away
      },
      startMatch: (o) => self.startMatch(o),
      // practice: solo on a random stage (no enemies, no clock); the loadout can be changed mid-session
      startPractice: (o) => self.startPractice(o),
      isPractice: () => self._inPractice(),
      practiceInfo: () => (self._inPractice() ? { map: self.mapDef.name, weapon: self.match.local?.weaponId, sub: self.match.local?.subId, special: self.match.local?.specialId } : null),
      practiceReset: () => self.practiceReset(),
      practiceNewStage: () => self.startPractice(),
      quitPractice: () => self.quitToMenu('loadout'),
      resumeMatch: () => self.resume(),
      // online results: the host can take the room back to the lobby without waiting out the timer
      netBackToLobby: () => { if (G.netm && G.net?.isHost && self.match?.state === 'results') { clearTimeout(self._netEndT); G.netm.sendEnd(); self.netMatchEnd(); } },
      quitMatch: () => self.quitToMenu(),
      rematch: () => self.startMatch(self.lastMatchOpts || {}),
      toMainMenu: () => self.quitToMenu(),
      onScreenChange: (s) => self._onScreen(s),
      playSound: (n) => { G.audio?.init?.(); G.audio?.play(n); },
    });
    return api;
  }

  // the loadout's sub: the one picked in the loadout, else the weapon's own default
  _subFor(weapon) { return (SUBS[this.profile.sub] && this.profile.sub) || (WEAPONS[weapon || 'shooter'] || WEAPONS.shooter).sub || 'bomb'; }
  // the loadout's special: the one picked in the loadout, else the weapon's own
  _specialFor(weapon) { return (SPECIALS[this.profile.special] && this.profile.special) || (WEAPONS[weapon || 'shooter'] || WEAPONS.shooter).special || 'slam'; }

  _setSettings(partial) {
    Object.assign(this.settings, partial);
    saveJSON('inkwave.settings', this.settings);
    if ('lang' in partial) { setLang(partial.lang); document.title = t('INKWAVE — Turf Riot'); this._rebuildHud(); }
    if ('quality' in partial || 'shadows' in partial || 'bloom' in partial || (window.inkwaveMobile && 'mobileVisual' in partial)) this.R?.applySettings(this.settings);
    if (window.inkwaveMobile && 'mobileDynamicResolution' in partial) {
      this._dyn = null;
      if (!partial.mobileDynamicResolution) this.R?.setDynamicScale(1);
    }
    if ('fullscreen' in partial && window.inkwaveNative) window.inkwaveNative.setFullScreen(!!partial.fullscreen);
    if ('master' in partial || 'music' in partial || 'sfx' in partial) this._applyAudioVolumes();
    if ('colorblind' in partial && G.mode !== 'match') this._setPalette(this._pickPalette());
  }
  _applyAudioVolumes() { G.audio?.setVolumes?.({ master: this.settings.master, music: this.settings.music, sfx: this.settings.sfx }); }

  // The HUD's static labels are built once with the current language; a language switch rebuilds it (menus only —
  // mid-match the old HUD stays until the next load, which is the safer trade). The TAB-map diorama mounts inside
  // the HUD layer, so it is recreated with it.
  async _rebuildHud() {
    if (G.mode === 'match' || !this._hudMod?.HUD) return;
    try {
      this.diorama?.el?.remove();
      this.hud?.dispose();
      this.hud = G.hud = new this._hudMod.HUD(this.uiRoot, { playSound: (n, o) => G.audio?.play(n, o) });
      try { const { DioramaOverlay } = await import('./ui/diorama.js'); this.diorama = new DioramaOverlay(this.hud ? this.hud.el : this.uiRoot); } catch (e) { console.error('[inkwave] diorama', e); this.diorama = null; }
      this.hud?.setVisible(false);
    } catch (e) { console.error('[inkwave] hud rebuild', e); }
  }

  _onScreen(s) {
    // the loadout opened mid-practice sits over the live stage: tuck the HUD away while it's up
    if (G.mode === 'match' && this.hud) {
      const hide = s === 'loadout';
      if (hide !== !!this._hudTucked) { this._hudTucked = hide; this.hud.setVisible(!hide); }
    } else this._hudTucked = false;
    if (!this.showcase) return;
    if (s === 'loadout') this.showcase.showLoadout(this.profile.weapon || 'shooter', G.teamColors[0], this.profile.style);
    else if (s !== 'results') { if (this.showcase.mode === 'loadout') this.showcase.hide(); }
    if (G.mode === 'menu') {
      if (s === 'title' || s === 'main' || s === 'setup' || s === 'settings' || s === 'howto' || s === 'credits' || s === 'loadout' || s === 'locker' || s === 'online' || s === 'lobby') {
        if (this._musicTrack !== (s === 'title' ? 'title' : 'menu')) this._playMusic(s === 'title' ? 'title' : 'menu');
      }
    }
  }
  _playMusic(t) {
    this._musicTrack = t;
    try {
      G.music?.play(t, { fade: 1.2 });
      // asking for the track that's already current is a no-op — if it was left paused, un-pause it (unless we're paused)
      if (t && !this.match?.paused) G.music?.resume?.();
    } catch (e) { /* not initialised yet */ }
  }

  // ---------------------------------------------------------------------------------------- input routing
  _onKey(e, repeat) {
    // first gesture unlocks audio
    if (!this._audioOn) { this._audioOn = true; G.audio?.init?.(); this._applyAudioVolumes(); this._playMusic(this.menus?.current === 'title' || !this.menus ? 'title' : 'menu'); }
    if (G.mode === 'match' && this.match && !this.match.paused && !this.menus?.current) {
      if (e.code === 'Escape' || e.code === 'KeyP') { this.pause(); return true; }
      if (e.code === 'KeyL' && this.match.practice && !repeat) { this.openPracticeLoadout(); return true; }
      return false;
    }
    if (this.menus && this.menus.current) return this.menus.handleKey(e) || false;
    return false;
  }
  _onPointerUnlock() {
    // only a live round pauses on focus loss; intro / time's up / judge / results release the mouse on purpose.
    // Holding the map is never a reason to pause (some browsers/embeds steal focus on TAB): relock on the next click.
    if (this.match?.controller?.mapHeld || (this.rig?.mapK ?? 0) > 0) { this._relock = true; return; }
    if (G.mode === 'match' && this.match && !this.match.paused && this.match.state === 'playing' && !this.menus?.current) this.pause();
  }
  // pull the fog back while the view is overhead (the stage is ~150 m away up there), restore it exactly after
  _dioFog() {
    const f = G.scene?.fog, k = this.rig.mapK;
    if (!f || !f.isFog) return;
    if (k > 0) {
      if (!this._fog0) this._fog0 = { near: f.near, far: f.far };
      const e = k * k * (3 - 2 * k);
      f.near = this._fog0.near + 190 * e; f.far = this._fog0.far + 600 * e;
    } else if (this._fog0) { f.near = this._fog0.near; f.far = this._fog0.far; this._fog0 = null; }
  }


  // ---------------------------------------------------------------------------------------- events → HUD/audio
  _bindEvents() {
    const self = this;
    let lastHitSnd = 0, lastHurtSnd = 0;
    on('hit', ({ attacker, victim, damage, killed }) => {
      if (!this.match || this.match.attract) return;
      if (attacker?.isLocal) {
        this.hud?.hitMarker(killed ? 'kill' : 'hit');
        if (G.time - lastHitSnd > 0.06) { lastHitSnd = G.time; G.audio?.play('hit_marker', { volume: 0.6 }); }
      }
    });
    on('damage', ({ victim, amount, attacker, source }) => {
      if (!this.match || this.match.attract || !victim.isLocal) return;
      let ang = null;
      if (attacker && attacker !== victim) {
        const v = this._dmgV || (this._dmgV = new THREE.Vector3());
        v.copy(attacker.pos); v.y += 1; v.project(G.camera);
        let dx = v.x, dy = -v.y;
        const behind = v.z > 1;
        if (behind) { dx = -dx; dy = -dy; }
        if (!behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) ang = dx >= 0 ? 0 : Math.PI;   // attacker on screen: ink the nearer side edge, never over them
        else ang = Math.atan2(dy * innerHeight, dx * innerWidth);
      }
      this.hud?.damage(clamp(amount / 80, 0.15, 1), G.teamHex[victim.enemyTeam], ang);
      if (G.time - lastHurtSnd > 0.25) { lastHurtSnd = G.time; G.audio?.play('hurt', { volume: 0.7 }); }
      if (amount >= 40) this.rig.addShake(clamp((amount - 30) / 220, 0, 0.4));   // only heavy hits move the camera; chip damage reads through the HUD
    });
    // a squid dropping back into its own ink (dolphin-jump re-entry, hopping in from dry ground) gets a wet plunge;
    // transform dives already play squid_in
    const formT = new WeakMap();
    on('actor:form', ({ actor }) => formT.set(actor, G.time));
    on('actor:dive', ({ actor, speed }) => {
      if (!actor || !this.match || this.match.attract || G.time - (formT.get(actor) ?? -9) < 0.2) return;
      if (actor.isLocal || actor._nearCamera?.()) G.audio?.play('swim_splash', { pos: actor.isLocal ? undefined : actor.pos, volume: (actor.isLocal ? 0.5 : 0.32) * Math.min(1, 0.55 + (speed || 0) / 16) });
    });
    // online, humans-only stage: a player who left is gone from the match (Match.removeActor) — say so in the feed
    on('actor:removed', ({ actor }) => { if (this.match && !this.match.attract) this.hud?.feed({ text: { id: '{name} left the match', params: { name: t(actor.name) } }, color: G.teamHex[actor.team], kind: 'info' }); });
    on('splatted', ({ victim, attacker, cause }) => {
      if (!this.match || this.match.attract) return;
      this._addDeathMark(victim);
      const local = this.match.local;
      if (attacker?.isLocal) {
        G.audio?.play('splat_enemy', { volume: 0.9 });
        this.hud?.feed({ text: { id: 'You splatted {name}!', params: { name: t(victim.name) } }, color: G.teamHex[local.team], kind: 'kill' });
      } else if (victim.isLocal) {
        G.audio?.play('splatted_self');
        G.audio?.duck?.(0.45, 2.2);
        // the card shows what did it (hud.js splatCause): the attacker's main weapon, or the sub / special / the sea
        const by = attacker ? attacker.name : cause === 'water' ? null : 'enemy ink';
        this.hud?.showSplatted({ by, byColor: attacker ? G.teamHex[attacker.team] : '#6fd0ff', respawn: PLAYER.respawnTime, attacker: attacker || null, cause });
        this.rig.mode = 'spectate';
        this.rig.spectate = { actor: attacker && attacker.alive ? attacker : null, pos: victim.pos.clone(), from: victim.pos.clone() };
        this.rig.lookAt.copy(victim.pos);
      } else if (victim.team === local?.team) {
        G.audio?.play('ally_splatted', { volume: 0.5 });
        this.hud?.feed({ text: attacker ? { id: '{name} was splatted by {by}', params: { name: t(victim.name), by: t(attacker.name) } } : { id: '{name} was splatted', params: { name: t(victim.name) } }, color: G.teamHex[victim.enemyTeam], kind: 'death' });
      } else if (attacker && attacker.team === local?.team) {
        this.hud?.feed({ text: { id: '{name} splatted {victim}', params: { name: t(attacker.name), victim: t(victim.name) } }, color: G.teamHex[attacker.team], kind: 'ally' });
      }
    });
    on('respawn', ({ actor }) => {
      if (!this.match || this.match.attract) return;
      if (actor.isLocal) {
        this.hud?.hideSplatted(); this.rig.follow(actor, true); this.rig.yaw = actor.yaw; this.rig.pitch = -0.12;
        // a Super Jump planned on the TAB map while splatted launches now (normal charge + flight)
        this.match.controller?.launchQueuedJump?.();
      }
    });
    on('special:ready', ({ actor }) => {
      if (actor.isLocal && !this.match?.attract) { G.audio?.play('special_ready'); }
    });
    on('special:use', ({ actor, id }) => {
      if (actor.isLocal && !this.match?.attract) this.hud?.banner('special', t(SPECIALS[id].name).toUpperCase() + '!');
    });
    on('shake', ({ amount, pos }) => { if (!this.match?.attract) this.rig.addShake(amount, pos); });
    on('recoil', ({ amount }) => { if (!this.match?.attract) this.rig.recoil(amount); });
    on('lowink', ({ actor }) => { if (actor.isLocal) this._lowInkFlash = 1.2; });
    // footsteps (character animation → 'actor:footstep'): surface-aware, only for actors near the camera
    on('actor:footstep', ({ actor, surface, pos, speed }) => {
      if (!actor || !actor.alive || actor.form === 'squid') return;
      const p = pos || actor.pos;
      if (!actor.isLocal && G.camera.position.distanceToSquared(p) > 18 * 18) return;
      const name = surface === 1 ? 'step_ink' : surface === 2 ? 'step_enemy' : 'step_dry';
      const vol = (actor.isLocal ? 0.7 : 0.45) * Math.min(1, 0.45 + (speed || actor.anim.speed || 0) / 8);
      G.audio?.play(name, { pos: actor.isLocal ? undefined : p, volume: vol });
    });
    on('match:oneminute', () => { this.hud?.banner('one_minute'); G.audio?.play('one_minute'); if (this.match?.mode !== 'boss') this._playMusic('battle_final'); });
    on('match:count', ({ n }) => { this.hud?.countdown(n); G.audio?.play('final_count'); });
    on('match:state', ({ state, match }) => {
      if (match.attract || match !== this.match) return;
      if (state === 'intro') this._intro();
      if (state === 'playing') {
        if (!match.practice) { this.hud?.banner('go'); G.audio?.play('go_horn'); }
        if (match.mode !== 'boss') this._playMusic('battle');   // boss mode: the boss audio director scores it by phase
        if (this.match.local) { this.rig.follow(this.match.local, true); }
      }
      if (state === 'finish') {
        const bossWon = match.mode === 'boss' && match.boss?.dead;   // the defeat already had its moment (boss:defeat)
        this.hud?.banner('timesup');
        if (!bossWon) G.audio?.play('times_up');
        if (match.mode !== 'boss') {
          // the final-minute recording is timed to ring out just past the horn; anything else stops here
          if (G.music?.fileTrack !== 'battle_final') G.music?.stop?.(0.4);
          this._musicTrack = null;
        }
        this.input.exitLock();
        if (match.boss) this._bossFinishCam(match.boss);
      }
      if (state === 'judge') this._judge();
    });
  }

  // ---------------------------------------------------------------------------------------- death markers
  // A squid-skull in the victim's ink where anyone (either team) was splatted, MATCH.deathMarkLife s, fading out at the
  // end. One fixed pool, reused (no per-frame allocation): the HUD draws the world-view and minimap marks from it
  // (positions filled in _updateHud), the TAB map diorama its own (G.deathMarks).
  _deathPool() {
    return this.deathMarks || (this.deathMarks = G.deathMarks = Array.from({ length: 12 }, () => (
      { on: false, id: 0, x: 0, y: 0, z: 0, team: 0, name: '', ally: false, local: false, t: 0, k: 0, sx: 0, sy: 0, sc: 1, vis: false, mx: 0, my: 0 })));
  }
  _addDeathMark(victim) {
    const pool = this._deathPool();
    let d = pool.find((o) => !o.on);
    if (!d) d = pool.reduce((o, b) => (b.t > o.t ? b : o));   // all showing: recycle the oldest
    const p = victim.pos;
    this._dmId = (this._dmId || 0) + 1;
    d.on = true; d.id = this._dmId; d.t = 0; d.k = 1; d.vis = false;
    d.x = p.x; d.y = Math.max(p.y, PLAYER.waterY + 0.1); d.z = p.z;   // lost at sea: on the water where they went in
    d.team = victim.team; d.name = victim.name || ''; d.local = !!victim.isLocal;
  }
  _ageDeathMarks(dt) {
    const life = MATCH.deathMarkLife ?? 5, fade = MATCH.deathMarkFade ?? 1.3;
    for (const d of this._deathPool()) {
      if (!d.on) continue;
      d.t += dt;
      if (d.t >= life) { d.on = false; continue; }
      d.k = d.t > life - fade ? (life - d.t) / fade : 1;
    }
  }
  _clearDeathMarks() { for (const d of this._deathPool()) d.on = false; }

  // ---------------------------------------------------------------------------------------- attract mode
  _startAttract() {
    if (this.match) this.match.dispose();
    this.rig.dioFlip = false;
    G.projectiles.clear(); G.subs.clear(); G.specials.clear(); G.fx.clear?.(); G.paint.clear(); this._clearDeathMarks();
    // (a humans-only stage — after an online match there — idles with nobody on it; ?devstage stands idle kids there
    // for the render audits)
    const m = (this.match = G.match = new Match({ attract: true, duration: 99999, difficulty: 'normal', CharacterClass: this.CharacterClass, rig: this.rig, input: this.input,
      noBots: mapNoBots(this.mapDef?.id), mannequins: DEV_STAGE }));
    m.setup(); m.start();
    for (const a of m.actors) { a.respawnTimer = 0; }
    this.attractT = 0; this.shotT = 0; this.shotIdx = 0;
    this._attractShot();
    this.hud?.setVisible(false);
  }
  _attractShot() {
    const shots = ['orbit', 'follow', 'orbit2', 'follow'];
    const s = shots[this.shotIdx++ % shots.length];
    this.shotT = s.startsWith('follow') ? 7 : 10;
    if (s === 'orbit') this.rig.orbit(new THREE.Vector3(0, 1, 0), 34, 17, 0.05, Math.random() * 6);
    else if (s === 'orbit2') this.rig.orbit(new THREE.Vector3(0, 2, -8), 18, 7, -0.07, Math.random() * 6);
    else {
      const alive = this.match.actors.filter((a) => a.alive);
      const a = alive[(Math.random() * alive.length) | 0];
      if (a) { this.rig.follow(a, true); this.rig.yaw = a.yaw; this.rig.pitch = -0.28; this._attractFollow = a; }
    }
  }
  _updateAttract(dt) {
    this.attractT += dt; this.shotT -= dt;
    if (this.menus?.current === 'title') { if (this.rig.mode !== 'orbit') this.rig.orbit(new THREE.Vector3(0, 1, 0), 34, 17, 0.05, 0); }
    else if (this.shotT <= 0) this._attractShot();
    if (this.rig.mode === 'follow' && this._attractFollow) {
      const a = this._attractFollow;
      if (!a.alive) this.shotT = Math.min(this.shotT, 0.5);
      this.rig.yaw = G.time > 0 ? this.rig.yaw + (((a.yaw - this.rig.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-2 * dt)) : a.yaw;
    }
    const cov = G.paint.coverage();
    if (this.attractT > 110 || cov[0] + cov[1] > 0.72) {
      this._fade(1, 400).then(() => { this._setPalette(this._pickPalette()); this._startAttract(); this._fade(0, 600); });
      this.attractT = -999;
    }
  }

  // ---------------------------------------------------------------------------------------- match flow
  // lamps, signs, lit windows: follow the environment's night factor (0 day / golden … 1 dusk)
  _applyNight() {
    const k = G.env?.getSkyColors?.()?.night ?? 0;
    this.props?.setNight?.(k); this.decor?.setNight?.(k);
    // dusk: lanterns bright enough to bloom, and they pool warm light on the deck around them
    if (this.decor?.bulbMat) this.decor.bulbMat.emissiveIntensity *= 1 + 3.2 * k;
    for (const m of [this.levelMat, this.grateMat]) setLevelLamps(m, G.level, k);
  }

  // 手机准备从入口立即互斥，防止淡入/换图等待期间重复点击并发重建世界。
  _beginMobilePreparation({ boss = false, retry } = {}) {
    if (!window.inkwaveMobile) return null;
    if (this._mobilePreparation || this._mobilePreparationError || this.mobileSuspended) return false;
    clearMobileBossMinimapWorkerForMatch(this.match, 'prepare-next');
    G.audio?.setBossParamDedupe?.(false); // 换局的异步准备期间不保留上一局音频参数缓存。
    this.mobile?.bossRasterHints?.clear(); // 准备期间释放上一局标签栅格缓存提示。
    this.R.mobileAA?.clearBossEdges?.(); // 新局准备开始前释放旧局专用的边缘格式。
    const token = { cancelled: false, retry };
    token.done = new Promise(resolve => { token.finish = resolve; });
    this._mobilePreparation = token;
    this.input.touch?.setEnabled(false); this.input.touch?.clear();
    this.input.keys?.clear(); this.input.pressed?.clear();
    if (this.input.mouse) Object.assign(this.input.mouse, { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false });
    token.shaderFailures = globalThis.inkwaveDiagnostics?.shaderFailureCount?.() || 0;
    token.ui = createMobilePreparationUI({
      onCancel: () => this.quitToMenu(),
      onRetry: retry ? async () => { await this.quitToMenu(); await retry(); } : undefined,
    });
    this._mobilePreparationOverlay = token.ui;
    token.ui.show({ title: boss ? '准备 Boss 战' : '准备对局' });
    globalThis.inkwaveDiagnostics?.record('mobile-preparation-start', { boss });
    return token;
  }
  _isMobilePreparationCurrent(token) { return !token || (this._mobilePreparation === token && !token.cancelled && (!token.networkMatch || G.net?.match === token.networkMatch)); }
  _updateMobilePreparation(token, progress, label, detail = '准备完成后进入对局。') {
    if (token && this._isMobilePreparationCurrent(token)) token.ui?.update({ progress, label, detail });
  }
  _failMobilePreparation(token, error) {
    if (!token || !this._isMobilePreparationCurrent(token)) return;
    token.failed = true; this._mobilePreparationError = true;
    globalThis.inkwaveDiagnostics?.record('mobile-preparation-failed', error, 'error');
    token.ui?.fail('场景准备未完成，请重试或返回菜单。');
  }
  _finishMobilePreparation(token) {
    if (!token) return;
    if (this._mobilePreparation === token) this._mobilePreparation = null;
    if (!token.failed && !token.keepUntilMenu) {
      token.ui?.dispose();
      if (this._mobilePreparationOverlay === token.ui) this._mobilePreparationOverlay = null;
    }
    token.finish();
  }

  async _checkMobilePreparedFrame(m, token) {
    if (!token) return true;
    this._updateMobilePreparation(token, 0.96, '检查场景', '正在完成进入前的最后准备。');
    await nextMobileFrame();
    if (!this._isMobilePreparationCurrent(token) || this.match !== m) return false;
    // 受击等屏幕效果首次启用也可能编译；在加载遮罩内准备实际Pass，保留原启用状态。
    if (this.R.extraPass) {
      const pass = this.R.extraPass, target = G.renderer.getRenderTarget(), screen = pass.renderToScreen;
      const finish = globalThis.inkwaveDiagnostics?.beginStage('match-screen-effects-prepare');
      try { pass.renderToScreen = false; pass.render(G.renderer, this.R.composer.writeBuffer, this.R.composer.readBuffer, 0, false); }
      finally { pass.renderToScreen = screen; G.renderer.setRenderTarget(target); finish?.(); }
    }
    const done = globalThis.inkwaveDiagnostics?.beginStage('match-prepared-first-frame');
    try { this._frame(0, 'match-preflight'); }
    finally { done?.(); }
    if (G.renderer.getContext?.().isContextLost() || this.R.mobileSafety?.state.fatal || this.mobileSuspended ||
      (globalThis.inkwaveDiagnostics?.shaderFailureCount?.() || 0) > token.shaderFailures) throw new Error('手机图形准备未通过');
    if (!await waitForMobileFrame(G.renderer, { isCurrent: () => this._isMobilePreparationCurrent(token) && this.match === m,
      yieldTurn: nextMobileFrame, diagnostics: globalThis.inkwaveDiagnostics })) return false;
    globalThis.inkwaveDiagnostics?.record('mobile-preparation-ready', { programs: G.renderer.info.programs.length,
      fpsCap: this.settings.fpsCap, boss: !!m.boss, actors: m.actors.length });
    this._updateMobilePreparation(token, 0.99, '场景已就绪');
    await nextMobileFrame();
    return this._isMobilePreparationCurrent(token) && this.match === m;
  }
  async _completeMobilePreparation(token, fadeMs) {
    if (!token) return true;
    if (!this._isMobilePreparationCurrent(token)) return false;
    token.ui?.complete();
    await nextMobileFrame();
    if (!this._isMobilePreparationCurrent(token)) return false;
    await this._fade(0, fadeMs);
    return this._isMobilePreparationCurrent(token);
  }

  async startMatch(o = {}) {
    const preparation = this._beginMobilePreparation({ boss: o.mode === 'boss', retry: () => this.startMatch(o) });
    if (preparation === false) return false;
    try {
      const practice = !!o.practice;
      const opts = {
        mapId: o.mapId === 'sunset' ? 'tidewater' : (o.mapId || this.mapDef.id),
        time: o.mapId === 'sunset' ? 'dusk' : (o.time || this.time || 'day'),
        difficulty: o.difficulty || this.settings.difficulty,
        // Zone Control / Boss Battle from the stage select's MODE; practice is always turf
        mode: o.practice ? 'turf' : o.mode === 'zones' ? 'zones' : o.mode === 'boss' ? 'boss' : 'turf',
      };
      opts.duration = opts.mode === 'zones' ? (o.duration || ZONES.duration) : opts.mode === 'boss' ? (o.duration || BOSS_MODE.duration)
        : Math.min(MATCH.maxDuration, o.duration || this.settings.matchLength || MATCH.defaultDuration);
      if (!practice) this.lastMatchOpts = opts;
      G.audio?.init?.();
      G.audio?.duck?.(1, 0.01);   // a new stage picked from the practice pause menu starts un-ducked
      this.input.requestLock();
      this.menus?.show(null);
      if (preparation) await nextMobileFrame();
      await this._fade(1, 350);
      if (!this._isMobilePreparationCurrent(preparation)) return false;
      this._updateMobilePreparation(preparation, 0.05, '准备场景');
      G.music?.stop?.(0.3); this._musicTrack = null;
      // start buffering this round's match song and the final-minute song while the world loads
      G.music?.preload?.('battle'); if (!practice) G.music?.preload?.('battle_final');
      this.showcase.hide();
      if (this.match) this.match.dispose();
      G.projectiles.clear(); G.subs.clear(); G.specials.clear(); G.fx.clear?.(); G.paint.clear(); this._clearDeathMarks();
      let map = MAPS.find((m) => m.id === opts.mapId) || MAPS[0];
      // offline never plays an online-only stage (the menus don't offer one; a stray ?autostart / api call falls back)
      if (!mapOfflineOk(map.id) && !DEV_STAGE) {
        console.warn(`[inkwave] ${map.name} is online only — offline match on ${OFFLINE_MAPS[0].name} instead`);
        this.menus?.toast?.(`${map.name} is online only`);
        map = OFFLINE_MAPS[0];
      }
      if (opts.mode === 'boss' && !mapBossOk(map.id)) opts.mode = 'turf';
      this._updateMobilePreparation(preparation, 0.08, '准备地图');
      const worldDone = globalThis.inkwaveDiagnostics?.beginStage('match-world-prepare', { map: map.id, mode: opts.mode });
      try { await this._buildWorld(map, opts.mode); } finally { worldDone?.(); }
      if (!this._isMobilePreparationCurrent(preparation)) return false;
      const theme = mapTheme(map, opts.time);
      this.time = opts.time === 'dusk' ? 'dusk' : 'day';
      if (theme !== this.theme) {
        this.theme = theme;
        G.env.setTheme?.(theme);
        if (G.env.envMap) G.scene.environment = G.env.envMap;
        G.fx.setLighting?.(G.env.getSkyColors?.());
      }
      this._applyNight();   // after any stage rebuild too (new prop kit / decor)
      this.mapDef = map;
      this._setPalette(this._pickPalette());
      const m = (this.match = G.match = new Match({
        attract: false, practice, duration: opts.duration, mode: opts.mode, difficulty: opts.difficulty, weapon: this.profile.weapon || 'shooter', sub: this._subFor(this.profile.weapon), special: this._specialFor(this.profile.weapon),
        playerName: this.profile.name || 'Player', CharacterClass: this.CharacterClass, rig: this.rig, input: this.input,
        autopilot: params.has('autopilot'), style: this.profile.style || null, noBots: mapNoBots(map.id),   // (devstage: a solo walk)
      }));
      this._updateMobilePreparation(preparation, 0.2, '创建对局');
      if (preparation) { await nextMobileFrame(); if (!this._isMobilePreparationCurrent(preparation)) return false; }
      const setupDone = globalThis.inkwaveDiagnostics?.beginStage('match-setup', { map: map.id, practice });
      try { m.setup(); } finally { setupDone?.(); }
      await this._warmCharacters(m, preparation);
      if (!this._isMobilePreparationCurrent(preparation) || (preparation && this.match !== m)) return false;
      if (!await this._checkMobilePreparedFrame(m, preparation)) return false;
      this.minimap.setViewerTeam(0);
      if (preparation && m.boss && !await this._prepareBossMinimapWorker(m, preparation)) return false;
      G.mode = 'match';
      this.hud?.setVisible(false);
      this.hudPrompt = null; this._hintT = 0; this._hints = {};
      this.hud?.setPractice?.(practice);
      if (!await this._completeMobilePreparation(preparation, 500)) return false;
      m.start();
      if (practice) {
        // no intro fly-over: straight in, special charged so it can be tried right away
        if (m.local) m.local.special = m.local.specialCost();
        this.hud?.setVisible(true);
      }
      if (!preparation) this._fade(0, 500);
      return true;
    } catch (error) {
      if (!preparation) throw error;
      this._failMobilePreparation(preparation, error); return false;
    } finally { this._finishMobilePreparation(preparation); }
  }

  // 最终视角/数组已确定后才复制像素工作集；失败只回同步，不阻止原比赛启动。
  async _prepareBossMinimapWorker(match, preparation) {
    if (!preparation || !match.boss) return true;
    const current = () => this._isMobilePreparationCurrent(preparation) && this.match === match;
    this._updateMobilePreparation(preparation, 0.96, '准备Boss小地图计算');
    await prepareMobileBossMinimapWorker(this, match, { isCurrent: current });
    return current();
  }

  _inPractice() { return !!(this.match && this.match.practice && G.mode === 'match'); }

  // a random stage (a different one from the current, when there's a choice)
  startPractice(o = {}) {
    const pool = OFFLINE_MAPS.filter((m) => m.id !== this.mapDef?.id);   // (never an online-only stage)
    const map = (o.mapId && OFFLINE_MAPS.find((m) => m.id === o.mapId)) || pool[(Math.random() * pool.length) | 0] || OFFLINE_MAPS[0];
    return this.startMatch({ mapId: map.id, practice: true });
  }

  // practice: open the loadout screen straight from play (Esc on it drops you back in)
  openPracticeLoadout() {
    const m = this.match;
    if (!this._inPractice() || m.paused || m.state !== 'playing') return;
    m.paused = true;
    this.input.exitLock();
    this.menus?.show('loadout', { under: ['pause'], quick: true });
    G.audio?.duck?.(0.5, 99);
    G.music?.pause?.();
  }

  // equip the profile's loadout on the practising player (called whenever the loadout changes)
  _applyPracticeLoadout() {
    if (!this._inPractice()) return;
    const a = this.match.local;
    if (!a) return;
    const w = this.profile.weapon || 'shooter', sub = this._subFor(w), sp = this._specialFor(w);
    if (a.weaponId !== w || a.specialId !== sp) {
      G.specials.end(a, 'swap');
      a.specialActive = null;
      if (a.weaponId !== w) a.setWeapon(w);
      a.setSpecial(sp);
      a.special = a.specialCost();
    }
    if (a.subId !== sub) a.setSub(sub);
    a.ink = PLAYER.inkMax;
  }

  // practice: wipe the stage clean and drop back in at spawn with full ink and special
  practiceReset() {
    if (!this._inPractice()) return;
    const a = this.match.local;
    G.projectiles.clear(); G.subs.clear(); G.specials.clear(); G.fx.clear?.(); G.paint.clear(); this._clearDeathMarks();
    if (!a) return;
    a.respawn();
    a.special = a.specialCost();
    a.stats.turf = 0; a.stats.splats = 0; a.stats.deaths = 0; a.stats.specials = 0;
  }

  // ---- online (src/net/session.js drives these) -----------------------------------------------------------------
  // Build the host's match: same stage / time / palette / roster on every client; the intro starts on netMatchGo.
  async startNetMatch(cfg, nm) {
    const preparation = this._beginMobilePreparation({ boss: cfg.mode === 'boss' });
    if (preparation === false) return false;
    if (preparation) preparation.networkMatch = nm;
    try {
      G.audio?.init?.();
      this.menus?.show(null);
      if (preparation) await nextMobileFrame();
      await this._fade(1, 350);
      if (!this._isMobilePreparationCurrent(preparation)) return false;
      this._updateMobilePreparation(preparation, 0.05, '准备场景');
      G.music?.stop?.(0.3); this._musicTrack = null;
      this.showcase.hide();
      if (this.match) this.match.dispose();
      G.projectiles.clear(); G.subs.clear(); G.specials.clear(); G.fx.clear?.(); G.paint.clear(); this._clearDeathMarks();
      const map = MAPS.find((m) => m.id === cfg.map) || MAPS[0];
      this._updateMobilePreparation(preparation, 0.08, '准备地图');
      const worldDone = globalThis.inkwaveDiagnostics?.beginStage('match-world-prepare', { map: map.id, mode: cfg.mode, online: true });
      try { await this._buildWorld(map, cfg.mode); } finally { worldDone?.(); }
      if (!this._isMobilePreparationCurrent(preparation)) return false;
      const theme = mapTheme(map, cfg.time);
      this.time = cfg.time === 'dusk' ? 'dusk' : 'day';
      if (theme !== this.theme) {
        this.theme = theme;
        G.env.setTheme?.(theme);
        if (G.env.envMap) G.scene.environment = G.env.envMap;
        G.fx.setLighting?.(G.env.getSkyColors?.());
      }
      this._applyNight();
      this.mapDef = map;
      this._setPalette(this.settings.colorblind ? COLORBLIND_PALETTE : TEAM_PALETTES[cfg.palette] || TEAM_PALETTES[0]);
      const m = (this.match = G.match = new Match({
        attract: false, duration: cfg.duration, difficulty: cfg.difficulty, mode: cfg.mode, CharacterClass: this.CharacterClass, rig: this.rig, input: this.input,
        roster: cfg.roster, myId: G.net.myId, host: G.net.isHost, autopilot: params.has('autopilot'),
      }));
      this._updateMobilePreparation(preparation, 0.2, '创建对局');
      if (preparation) { await nextMobileFrame(); if (!this._isMobilePreparationCurrent(preparation)) return false; }
      const setupDone = globalThis.inkwaveDiagnostics?.beginStage('match-setup', { map: map.id, online: true });
      try { m.setup(); } finally { setupDone?.(); }
      await this._warmCharacters(m, preparation);   // before 'ready': nobody starts until every shader a squidkid can use is compiled
      if (!this._isMobilePreparationCurrent(preparation) || (preparation && this.match !== m)) return false;
      if (!await this._checkMobilePreparedFrame(m, preparation)) return false;
      nm.bind(m);
      this.lastMatchOpts = null;
      this.minimap.setViewerTeam(m.local ? m.local.team : 0);
      if (preparation && m.boss && !await this._prepareBossMinimapWorker(m, preparation)) return false;
      G.mode = 'match';
      this.hud?.setVisible(false);
      this.hudPrompt = null; this._hintT = 0; this._hints = {};
      // hold on the stage (not black) while the others finish loading
      if (m.local) { this.rig.follow(m.local, true); this.rig.yaw = m.local.team === 0 ? 0 : Math.PI; }
      this.rig.dioFlip = !!(m.local && m.local.team === 1);
      if (!await this._completeMobilePreparation(preparation, 450)) return false;
      if (!preparation) this._fade(0, 450);
      return true;
    } catch (error) {
      if (!preparation) throw error;
      this._failMobilePreparation(preparation, error); return false;
    } finally { this._finishMobilePreparation(preparation); }
  }
  // Compile every shader variant a squidkid can use this match (all detail tiers, their cross-fades, squid form,
  // weapons) and build every kid's tier meshes while the screen is still faded out, so none of it lands mid-match.
  // Programs are shared, so after the first kid of each weapon the rest are a few ms each.
  async _warmCharacters(m, preparation = this._mobilePreparation) {
    if (window.inkwaveMobile) {
      const diagnostics = globalThis.inkwaveDiagnostics, current = () => this.match === m && this._isMobilePreparationCurrent(preparation);
      const finish = diagnostics?.beginStage('match-character-warm-total', { actors: m.actors.length, boss: !!m.boss });
      try {
        const end = m.boss ? 0.62 : 0.8;
        for (let index = 0; index < m.actors.length; index++) {
          if (!current()) return false;
          const actor = m.actors[index], label = `准备角色 ${index + 1} / ${m.actors.length}`;
          const report = ({ completed = 0, total = 1 } = {}) => this._updateMobilePreparation(preparation,
            0.3 + (end - 0.3) * (index + Math.min(1, completed / Math.max(1, total))) / m.actors.length, label);
          report();
          const done = diagnostics?.beginStage('match-character-warm', { actor: index, weapon: actor.weaponId });
          try { await actor.character?.warmAll?.(G.renderer, G.camera, G.scene, { onProgress: report }); }
          finally { done?.(); }
          if (!current()) return false;
          report({ completed: 1, total: 1 });
        }
        if (!current()) return false;
        const combatStart = m.boss ? 0.62 : 0.8, combatEnd = m.boss ? 0.72 : 0.94;
        this._updateMobilePreparation(preparation, combatStart, '准备战斗效果');
        await prepareMobileCombat(this, m, { isCurrent: current, diagnostics,
          onProgress: ({ completed = 0, total = 1, label } = {}) => this._updateMobilePreparation(preparation,
            combatStart + (combatEnd - combatStart) * Math.min(1, completed / Math.max(1, total)), label || '准备战斗效果') });
        if (!current()) return false;
        if (m.boss && current()) {
          this._updateMobilePreparation(preparation, 0.72, '准备 Boss 和登场效果');
          await prepareMobileBoss(this, m, { isCurrent: current, diagnostics,
            onProgress: ({ completed = 0, total = 1, label } = {}) => this._updateMobilePreparation(preparation,
              0.72 + 0.23 * Math.min(1, completed / Math.max(1, total)), label || '准备 Boss 和登场效果') });
        }
        return current();
      } finally { finish?.(); }
      return false;
    }
    const jobs = m.actors.map((a) => a.character?.warmAll ? Promise.resolve(a.character.warmAll()).catch((e) => console.warn('[inkwave] warm', e)) : null).filter(Boolean);
    if (m.boss) jobs.push(Promise.resolve(m.boss.model.ready).then(() => Promise.all(m.boss.warm().map((o) => G.renderer.compileAsync(o, G.camera, G.scene)))).catch((e) => console.warn('[inkwave] boss warm', e)));
    if (jobs.length) await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 8000))]);   // never hang a load
  }
  netMatchGo() {
    if (window.inkwaveMobile && (this._mobilePreparation || this._mobilePreparationError)) return false;
    const m = this.match;
    if (!m || m.state !== 'init') return;
    this.input.requestLock();
    m.start();
  }
  // results done → everyone back in the room's lobby
  async netMatchEnd() {
    if (this._netEnding) return;
    this._netEnding = true;
    clearTimeout(this._netEndT);
    try {
      this.input.exitLock();
      this.menus?.show(null);
      await this._fade(1, 350);
      this.hud?.setVisible(false);
      this.hud?.hideSplatted?.();
      this.showcase.hide();
      G.mode = 'menu';
      G.net?.endMatch();
      this._startAttract();
      this.menus?.show(this.menus?.hasScreen?.('lobby') === false ? 'main' : 'lobby');
      this._playMusic('menu');
      G.audio?.duck?.(1, 0.01);
      this._fade(0, 500);
    } finally { this._netEnding = false; }
  }
  // the room went away mid-match (connection lost): back to the menus with the reason
  netMatchAborted(reason) {
    // `reason` is an error code (src/net/errors.js) or a legacy message — menus turns it into a translatable line
    this.quitToMenu().then(() => { if (reason) this.menus?.toast?.(this.menus?.netErrorText?.(reason) || 'Lost connection to the room'); });
  }

  _intro() {
    if (this.match.boss) { this._bossIntro(this.match.boss); return; }
    const L = G.level;
    const local = this.match.local;
    const team = local ? local.team : 0, pad = L.spawnPads[team];
    const sgn = team === 0 ? 1 : -1;     // the layout is a 180° mirror: Bravo's shot is Alpha's rotated about the centre
    // sweep from high over the enemy base down behind the player (a stage can open on its own hero shot instead)
    const I = L.layout?.intro;
    const from = I ? new THREE.Vector3(I.from[0] * sgn, I.from[1], I.from[2] * sgn) : new THREE.Vector3(18 * sgn, 26, 30 * sgn);
    const to = new THREE.Vector3(pad.x, pad.y + 2.6, pad.z - (I?.toBack ?? 5.2) * sgn);
    const lookFrom = I ? new THREE.Vector3(I.lookFrom[0] * sgn, I.lookFrom[1], I.lookFrom[2] * sgn) : new THREE.Vector3(0, 0, 10 * sgn), lookTo = new THREE.Vector3(pad.x, pad.y + 1.6, pad.z + 6 * sgn);
    this.rig.cinematic(from, to, lookFrom, lookTo, 3.6, () => {});
    this.rig.yaw = team === 0 ? 0 : Math.PI; this.rig.pitch = -0.12;
    this.rig.dioFlip = team === 1;
    G.audio?.play('ready');
    setTimeout(() => { if (this.match?.state === 'intro') this.hud?.banner('ready'); }, 1700);
    setTimeout(() => { if (this.match?.state === 'intro') this.hud?.setVisible(true); }, 3000);
    this._playMusic(null);
  }

  pause() {
    if (!this.match || this.match.attract || this.match.paused) return;
    // only a live round (or its intro) can pause — never on top of time's up / judge / results
    if (this.match.state !== 'playing' && this.match.state !== 'intro') return;
    if (G.netm) {   // online: the match carries on underneath the menu
      this.input.exitLock();
      if (this.match.controller) this.match.controller.enabled = false;
      this.menus?.show('pause');
      return;
    }
    this.match.paused = true;
    this.input.exitLock();
    this.menus?.show('pause');
    G.audio?.duck?.(0.5, 99);
    G.music?.pause?.(); // a recording holds its place so the final-minute song stays in step with the clock
  }
  resume() {
    if (!this.match) return;
    this.menus?.show(null);
    this.match.paused = false;
    if (this.match.controller) this.match.controller.enabled = true;
    this.input.requestLock();
    G.audio?.duck?.(1, 0.01);
    G.music?.resume?.();
  }
  async quitToMenu(screen = 'main') {
    if (window.inkwaveMobile) clearMobileBossMinimapWorkerForMatch(this.match, 'quit');
    if (window.inkwaveMobile) G.audio?.setBossParamDedupe?.(false); // 先释放Boss独占缓存，再等待淡出/准备取消。
    if (window.inkwaveMobile) this.mobile?.bossRasterHints?.clear();
    if (window.inkwaveMobile) this.R.mobileAA?.clearBossEdges?.();
    const preparation = this._mobilePreparation;
    if (preparation) { preparation.cancelled = true; preparation.keepUntilMenu = true; }
    clearTimeout(this._netEndT);
    if (G.net && G.net.state !== 'offline' && G.net.state !== 'error') G.net.leave();
    // 取消后等待正在进行的建造/编译安全退出，旧任务不能覆盖新的菜单演示世界。
    if (preparation) await preparation.done;
    this.input.exitLock();
    this.menus?.show(null);
    await this._fade(1, 350);
    this.hud?.setVisible(false);
    this.hud?.hideSplatted?.();
    this.showcase.hide();
    G.mode = 'menu';
    this._setPalette(this._pickPalette());
    this._startAttract();
    this.hud?.setPractice?.(false);
    this.menus?.show(screen);
    this._mobilePreparationError = false;
    this._mobilePreparationOverlay?.dispose(); this._mobilePreparationOverlay = null;
    this._playMusic('menu');
    G.audio?.duck?.(1, 0.01);
    this._fade(0, 500);
  }

  // Boss Battle intro: sweep in over the arena as HULLBREAKER bursts out of its home ground (boss time 1.8 s), hold on the
  // roar while the title card plays, then swing back down behind the squad's pad for GO. Chained on the rig's own
  // clock (not timers), so it stays in step with the boss under freeze/step audits.
  _bossIntro(b) {
    const pad = G.level.spawnPads[0], B = b.pos, fy = b.yaw;
    const fx = Math.sin(fy), fz = Math.cos(fy), sx = fz, sz = -fx;       // its forward (toward the squad) and a side
    const reveal = new THREE.Vector3(B.x + fx * 15 + sx * 5, B.y + 4.6, B.z + fz * 15 + sz * 5);
    const push = new THREE.Vector3(B.x + fx * 12 + sx * 3.2, B.y + 3.4, B.z + fz * 12 + sz * 3.2);
    const behind = new THREE.Vector3(pad.x, pad.y + 2.6, pad.z - 5.2);
    const chest = new THREE.Vector3(B.x, B.y + 2.6, B.z), head = new THREE.Vector3(B.x, B.y + 3.4, B.z);
    const high = new THREE.Vector3(pad.x + 6, pad.y + 17, pad.z + 4), mid = new THREE.Vector3((pad.x + B.x) / 2, 0, (pad.z + B.z) / 2);
    const m = this.match;
    this.rig.cinematic(high, reveal, mid, chest, 1.9, () => {
      if (this.match !== m || m.state !== 'intro') return;
      this.rig.cinematic(reveal, push, chest, head, 3.0, () => {
        if (this.match !== m || m.state !== 'intro') return;
        this.rig.cinematic(push, behind, head, new THREE.Vector3(pad.x, pad.y + 1.6, pad.z + 6), 2.1, () => {});
      });
    });
    this.rig.yaw = 0; this.rig.pitch = -0.12; this.rig.dioFlip = false;
    G.audio?.play('ready');
    setTimeout(() => { if (this.match === m && m.state === 'intro') this.hud?.banner('ready'); }, 5300);
    setTimeout(() => { if (this.match === m && m.state === 'intro') this.hud?.setVisible(true); }, 5600);
    this._playMusic(null);
  }
  // round over: circle the boss (sinking, or roaring over a squad that ran out of time)
  _bossFinishCam(b) {
    const c = new THREE.Vector3(b.pos.x, b.pos.y + 2.2, b.pos.z), cam = G.camera.position;
    this.rig.orbit(c, 15, 5.5, 0.09, Math.atan2(cam.x - c.x, cam.z - c.z));
  }
  // Boss Battle results: no turf judge — straight to VICTORY / DEFEAT with the fight's numbers
  async _bossResults() {
    const m = this.match, R = m.result, bo = R.boss || {};
    this.hud?.hideSplatted?.();
    await new Promise((r) => setTimeout(r, 400));
    if (this.match !== m) return;
    const won = !!bo.win, cov = R.coverage || G.paint.coverage();
    m.setState('results');
    this.hud?.setVisible(false);
    const local = m.local, p = this.profile;
    const turf = Math.round(local.stats.turf), dmg = Math.round(local.stats.bossDmg || 0);
    const gained = Math.round((won ? PROGRESSION.xpWin : PROGRESSION.xpLose) + turf * PROGRESSION.xpPerTurfPoint + local.stats.splats * PROGRESSION.xpPerSplat + dmg * 0.04);
    const before = { level: p.level, xp: p.xp, toNext: PROGRESSION.xpForLevel(p.level) };
    p.xp += gained; p.matches++; if (won) p.wins++; p.totalTurf += turf;
    while (p.xp >= PROGRESSION.xpForLevel(p.level)) { p.xp -= PROGRESSION.xpForLevel(p.level); p.level++; }
    saveJSON('inkwave.profile', p);
    const data = {
      mode: 'boss', win: won, percents: [cov[0] * 100, cov[1] * 100], colors: [G.teamHex[0], G.teamHex[1]], teamNames: this.palette.names || TEAM_NAMES,
      boss: { name: bo.name, defeated: won, time: bo.time, hpLeft: bo.maxHp ? bo.hp / bo.maxHp : 0, phase: bo.phase, maxHp: bo.maxHp },
      players: m.actors.map((a) => ({ name: a.name, team: 0, weapon: a.weaponId, turf: Math.round(a.stats.turf), damage: Math.round(a.stats.bossDmg || 0), weakHits: a.stats.weakHits || 0, splats: a.stats.splats, deaths: a.stats.deaths, isSelf: a.isLocal, bot: !!a.isBot })),
      xp: { gained, levelBefore: before.level, levelAfter: p.level, xpBefore: before.xp, xpAfter: p.xp, xpToNextBefore: before.toNext, xpToNextAfter: PROGRESSION.xpForLevel(p.level) },
      mapName: this.mapDef.name,
    };
    // the squad's top four (by damage) on the podium
    const top = [...m.actors].sort((a1, a2) => (a2.stats.bossDmg || 0) - (a1.stats.bossDmg || 0)).slice(0, 4);
    this.showcase.showResults(0, won, G.teamColors[0], top.map((a) => ({ weapon: a.weaponId, style: a.character.style || { hair: a.slot % 4, skin: (a.slot * 3) % 4 }, name: a.name })));
    if (G.netm) data.online = true;
    this.menus?.showResults(data);
    this.menus?.show('results');
    G.audio?.play(won ? 'victory_fanfare' : 'defeat_jingle');
    if (G.netm && G.net.isHost) this._netEndT = setTimeout(() => { G.netm?.sendEnd(); this.netMatchEnd(); }, 12000);
  }

  async _judge() {
    const m = this.match;
    if (m.result?.mode === 'boss') return this._bossResults();
    this.hud?.hideSplatted?.();
    this.rig.overview();
    this.hud?.setVisible(true);
    const cov = m.result.coverage;
    // Zone Control: the final counts (the scores) and each team's leftover penalty (shown apart, like the HUD's "+N"), winner and how it was won
    let zr = null;
    if (m.mode === 'zones' && m.zones && m.result.mode === 'zones') {
      const zs = m.zones.state();
      zr = { counts: [...zs.count], penalty: zs.penalty.map((p) => Math.max(0, Math.ceil(p - 1e-6))), winner: m.result.winner, reason: m.result.reason || 'time', overtime: !!m.result.overtime, overtimeT: zs.overtimeT };
    }
    const judgeP = zr
      ? this.hud?.judge({ mode: 'zones', colors: [G.teamHex[0], G.teamHex[1]], names: this.palette.names || TEAM_NAMES, counts: zr.counts, penalty: zr.penalty, winner: zr.winner, reason: zr.reason, overtime: zr.overtime, percents: [cov[0] * 100, cov[1] * 100] })
      : this.hud?.judge({ colors: [G.teamHex[0], G.teamHex[1]], percents: [cov[0] * 100, cov[1] * 100], names: this.palette.names || TEAM_NAMES });
    await (judgeP || new Promise((r) => setTimeout(r, 4000)));
    const myTeam = m.local ? m.local.team : 0;
    const won = m.result.winner === myTeam;
    m.setState('results');
    this.hud?.setVisible(false);
    // profile / XP
    const local = m.local;
    const p = this.profile;
    const turf = Math.round(local.stats.turf);
    let gained = Math.round((won ? PROGRESSION.xpWin : PROGRESSION.xpLose) + turf * PROGRESSION.xpPerTurfPoint + local.stats.splats * PROGRESSION.xpPerSplat);
    let xpParts = null;
    if (zr) {
      // Zone Control: less per point of turf (a 5 min match), extra for ink laid on the live zone, a knockout bonus
      const ZX = PROGRESSION.zones || { turfScale: 0.6, xpPerZoneTurfPoint: 1, xpKnockout: 300 };
      const zoneTurf = Math.round(local.stats.zoneTurf || 0);
      xpParts = [[won ? 'WIN BONUS' : 'MATCH', won ? PROGRESSION.xpWin : PROGRESSION.xpLose], ['TURF', Math.round(turf * PROGRESSION.xpPerTurfPoint * ZX.turfScale)],
        ['ZONE INK', Math.round(zoneTurf * ZX.xpPerZoneTurfPoint)], ['SPLATS', Math.round(local.stats.splats * PROGRESSION.xpPerSplat)], ['KNOCKOUT', won && zr.reason === 'knockout' ? ZX.xpKnockout : 0]].filter(([, v], i) => i < 2 || v > 0);
      gained = xpParts.reduce((a, [, v]) => a + v, 0);
    }
    const before = { level: p.level, xp: p.xp, toNext: PROGRESSION.xpForLevel(p.level) };
    p.xp += gained; p.matches++; if (won) p.wins++; p.totalTurf += turf;
    while (p.xp >= PROGRESSION.xpForLevel(p.level)) { p.xp -= PROGRESSION.xpForLevel(p.level); p.level++; }
    saveJSON('inkwave.profile', p);
    const data = {
      win: won, percents: [cov[0] * 100, cov[1] * 100], colors: [G.teamHex[0], G.teamHex[1]], teamNames: this.palette.names || TEAM_NAMES,
      players: m.actors.map((a) => ({ name: a.name, team: a.team, weapon: a.weaponId, turf: Math.round(a.stats.turf), splats: a.stats.splats, deaths: a.stats.deaths, isSelf: a.isLocal, bot: !!a.isBot, ...(zr ? { zoneTurf: Math.round(a.stats.zoneTurf || 0) } : {}) })),
      xp: { gained, levelBefore: before.level, levelAfter: p.level, xpBefore: before.xp, xpAfter: p.xp, xpToNextBefore: before.toNext, xpToNextAfter: PROGRESSION.xpForLevel(p.level), ...(xpParts ? { parts: xpParts } : {}) },
      mapName: this.mapDef.name,
      ...(zr ? { mode: 'zones', zones: zr } : {}),
    };
    // your team on the podium
    const team = m.actors.filter((a) => a.team === myTeam);
    this.showcase.showResults(myTeam, won, G.teamColors[myTeam], team.map((a) => ({ weapon: a.weaponId, style: a.character.style || { hair: a.slot % 4, skin: (a.slot * 3) % 4 }, name: a.name })));
    if (G.netm) data.online = true;   // the results screen builds its online variant (back-to-room countdown) from this
    this.menus?.showResults(data);
    this.menus?.show('results');
    G.audio?.play(won ? 'victory_fanfare' : 'defeat_jingle');
    setTimeout(() => this._playMusic(won ? 'results_win' : 'results_lose'), 2600);
    // online: the host brings the room back to the lobby once everyone has seen the results
    if (G.netm) {
      if (G.net.isHost) this._netEndT = setTimeout(() => { G.netm?.sendEnd(); this.netMatchEnd(); }, 12000);
    }
  }

  _fade(to, ms) {
    return new Promise((r) => {
      const el = this.fadeEl;
      if (!el) return r();
      el.style.transition = `opacity ${ms}ms ease`;
      el.style.opacity = String(to);
      el.style.pointerEvents = to > 0.5 ? 'all' : 'none';
      setTimeout(r, ms + 20);
    });
  }

  // ---------------------------------------------------------------------------------------- loop
  // ts is the rAF (vsync) timestamp: stepping the sim by vsync-to-vsync intervals instead of callback times keeps motion
  // even on 120 Hz displays. settings.fpsCap (0 = display rate) skips vsyncs so frames land on a steady cadence.
  // 【主循环】浏览器的 requestAnimationFrame(简称 rAF)= "每帧叫我一次",与显示器刷新同步(60Hz 屏每秒 60 次)。
  // 每轮:先预约下一帧(循环的发动机)→ 可选 FPS 上限(没到间隔直接 return)→ 算 dt(距上帧的真实秒数)
  // → 冻结/换世界期间暂停 → 动态分辨率 → 交 _frame() 干正活。
  // dt 是全部游戏逻辑的"时间货币":30 帧和 144 帧下手感一致,靠的就是所有移动都乘 dt。
  _loop(ts) {
    requestAnimationFrame((t) => this._loop(t));
    this._trackVsync(ts);
    const cap = this.settings.fpsCap || 0;
    if (window.inkwaveMobile) {
      if (!mobileFrameDue(this._mobilePacing || (this._mobilePacing = {}), ts, cap)) return;
    } else if (cap && ts !== undefined && this._lastTs !== undefined && ts - this._lastTs < 1000 / cap - 2) return;
    this._lastTs = ts;
    this.timer.update(ts); let dt = Math.max(0, this.timer.getDelta());
    if (this.frozen || this._building || this.mobileSuspended) return;
    if (this._mobilePreparation || this._mobilePreparationError) {
      // 分批预热期间保持联网心跳，但不让模拟/绘制并发修改正在准备的角色。
      G.net?.update?.(dt); this.input.endFrame(); return;
    }
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    this._dynRes(dt);
    this.mobile?.profile?.recordInterval?.(dt * 1000);
    this.mobile?.recordFrame(dt * 1000); // 记录钳制前的实际帧间隔，不能把掉帧隐藏在 dt 上限内。
    dt = Math.min(dt, 1 / 24);
    this._frame(dt);
  }

  // Display refresh estimate: 10th percentile of raw rAF intervals (rAF fires every vsync while frames keep up, and
  // keeps doing so under an fps cap because capped frames are skipped here, not in the browser).
  // 【显示器刷新率估算】收集 90 个 rAF 间隔,取第 10 百分位(抗抖动)再吸附到常见档位(30/60/120/144…)。
  // 用途:动态分辨率和 FPS 上限都要知道"目标帧间隔"才能判断是否掉帧。
  _trackVsync(ts) {
    if (ts === undefined) return;
    const v = this._vs || (this._vs = { last: ts, buf: [], ms: 1000 / 60 });
    const d = ts - v.last; v.last = ts;
    if (d > 2 && d < 50) v.buf.push(d);
    if (v.buf.length >= 90) {
      v.buf.sort((a, b) => a - b);
      // timestamp jitter makes the raw percentile read a little short (7.8 ms on a 120 Hz panel): snap to a real rate
      const hz = 1000 / v.buf[9];
      v.ms = 1000 / REFRESH_RATES.reduce((best, r) => (Math.abs(r - hz) < Math.abs(best - hz) ? r : best));
      v.buf.length = 0;
    }
  }
  // the frame interval (ms) we pace and size the render for: the display's refresh, or the user's cap if that is lower
  _frameTarget() {
    const cap = this.settings.fpsCap || 0;
    return Math.max(this._vs?.ms || 1000 / 60, cap ? 1000 / cap : 0);
  }

  // hold the frame target: when a 4 s window of a live round averages over ~112% of it (frames missing vsync, which
  // on a 120 Hz display reads as 8/16 ms judder), drop render density one notch. Stepping back up needs 12 s locked
  // at the target and happens at most twice, so the image never pumps between sizes (re-sizing every couple of
  // seconds read as flicker).
  // 【动态分辨率】4 秒窗口内平均帧时超过目标的 112% → 渲染精度降一档;回升需要稳定 12 秒且最多两次,
  // 防止画面尺寸来回"呼吸"造成闪烁。掉帧自保的核心思想:宁可略糊,不可卡。
  _dynRes(dt) {
    // 固定高清时不为追帧偷偷降低像素密度；玩家明确勾选自动降低清晰度才启用。
    if (window.inkwaveMobile && this.settings.mobileDynamicResolution === false) return;
    if (dt <= 0 || dt > 0.25) return;
    const d = this._dyn || (this._dyn = { acc: 0, n: 0, t: 0, fast: 0, ups: 0 });
    d.acc += dt; d.n++; d.t += dt;
    if (d.t < 4) return;
    const avg = d.acc / d.n;
    d.acc = 0; d.n = 0; d.t = 0;
    const m = this.match;
    if (this.settings.quality === 'ultra' || document.hidden || !m || m.attract || m.state !== 'playing') { d.fast = 0; return; }
    const s = this.R.dynScale || 1, tgt = this._frameTarget() / 1000;
    if (avg > tgt * 1.12 && s > this.R.dynFloor() + 0.01) { this.R.setDynamicScale(s - 0.125); d.fast = 0; }
    else if (avg < tgt * 1.04 && s < 1 && d.ups < 2) { if (++d.fast >= 3) { this.R.setDynamicScale(s + 0.125); d.fast = 0; d.ups++; } }
    else d.fast = 0;
  }

  // 【一帧的全部工作】boot() 结束后,游戏从此只剩这一函数的循环往复。流水线:
  // 输入轮询 → 网络 → 比赛模拟(帧太慢自动拆 2 个子步,物理不跳步)→ 弹道/副武器/大招 →
  // 特效/环境音/相机跟随 → 渲染出图。dt 全程参与换算。
  _frame(dt, diagnosticPrefix = null) {
    const tA = performance.now();
    const diagnostics = diagnosticPrefix ? globalThis.inkwaveDiagnostics : null;
    let endStage = diagnostics?.beginStage(`${diagnosticPrefix}-input`);
    const traceStage = diagnostics ? name => { endStage?.(); endStage = diagnostics.beginStage(`${diagnosticPrefix}-${name}`); } : null;
    const profile = this.mobile?.profile; profile?.begin(tA);
    G.renderer.info.reset();
    G.time += dt;
    this.input.pollPad();
    this.mobile?.update(dt);
    this._padMenus();
    G.net?.update?.(dt);
    profile?.mark(); // 输入、诊断与网络
    traceStage?.('simulation');
    const m = this.match;
    // the online lobby / hub stand in their own full-frame set (showcase): the attract match behind them is neither
    // simulated nor drawn while it's covered — it resumes exactly where it was when the set fades away
    const setUp = !!this.showcase?.fullFrame;
    if (m && !(setUp && m.attract)) {
      m.updateController(dt);
      const sub = dt > 1 / 45 ? 2 : 1; // substep physics on slow frames
      for (let i = 0; i < sub; i++) m.update(dt / sub);
      if (!m.paused) { G.projectiles.update(dt); G.subs.update(dt); G.specials.update(dt); }
      if (m.attract) this._updateAttract(dt);
      else if (m.state === 'playing' && m.local?.alive && this.rig.mode !== 'follow' && this.rig.mode !== 'path') this.rig.follow(m.local, true);
    }
    profile?.mark(); // 权威模拟、控制器与弹道
    traceStage?.('effects');
    if (!m || !m.paused) G.fx.update(dt, G.camera);
    if (!m || !m.paused) this.fxHooks?.update?.(dt);
    if (m && !m.paused && !m.attract) this._ageDeathMarks(dt);
    this.screenfx?.update?.(dt, this);
    // the TAB map (also while splatted, planning a Super Jump): lift the splatted desaturation + ink flood off the stage
    // so the ink and the pins read
    // (fully gone well before the map is fully open: the flood's drips draw at any alpha above zero)
    const fxU = this.screenfx?.U, mk = this.rig.mapK || 0;
    if (fxU && mk > 0 && fxU.uDesat && fxU.uFlood) {
      const e = Math.min(1, mk / 0.8), k = 1 - e * e * (3 - 2 * e);
      fxU.uDesat.value *= k; fxU.uFlood.value.w = k > 0.02 ? fxU.uFlood.value.w * k : 0;
    }
    profile?.mark(); // 特效
    traceStage?.('environment');
    G.env.update?.(dt, G.camera);
    this.decor.update(dt);
    this.props?.update?.(dt, G.time);
    profile?.mark(); // 环境、装饰与道具
    traceStage?.('camera');
    // map diorama: held map key during live play (or while waiting to respawn) swoops the view overhead — but not while
    // aiming a Vortex Strike (that uses the flat stage map)
    const strikeAiming = !!(m?.local?.specialActive && m.local.specialActive.id === 'strike' && m.local.specialActive.aiming);
    this.rig.setMap?.(!!(m && !m.attract && !m.paused && m.state === 'playing' && m.controller?.mapHeld && !this.menus?.current && !strikeAiming));
    this.rig.update(dt);
    this._dioFog();
    this.diorama?.update(dt, this.rig.mapK);
    // local player camera-dependent aim must use this frame's camera
    if (m && m.controller && m.state === 'playing') m.controller.computeAim?.();
    // bomb arc preview
    const loc = m?.local;
    const orbReady = !!(loc && loc.specialActive && loc.specialActive.id === 'booyah' && loc.specialActive.charge >= 1);
    G.projectiles.updateArc(loc, !!(loc && loc.alive && (loc.weaponRunner.aimingSub || orbReady) && m.state === 'playing' && !m.paused));
    const tB = performance.now();
    profile?.mark(); // 相机与瞄准
    traceStage?.('paint');
    // paint → atlas, shader uniforms
    G.paint.flush(dt);
    profile?.mark(); // 墨迹图集提交
    traceStage?.('prepare');
    this.levelMat.userData.uniforms.uTime.value = G.time;
    // see-through window toward the local player
    {
      const lu = this.levelMat.userData.uniforms;
      const on = !!(m && !m.attract && loc && loc.alive && this.rig.mode === 'follow' && this.rig.target === loc && (this.rig.mapK ?? 0) < 0.3);
      lu.uSeeOn.value = damp(lu.uSeeOn.value, on ? 1 : 0, 10, dt);
      lu.uSeeA.value.copy(G.camera.position);
      if (loc) lu.uSeeB.value.set(loc.pos.x, loc.pos.y + (loc.form === 'squid' ? 0.4 : 1.0), loc.pos.z);
      if (this.grateMat) { const gu = this.grateMat.userData.uniforms; gu.uSeeOn.value = lu.uSeeOn.value; gu.uSeeA.value.copy(lu.uSeeA.value); gu.uSeeB.value.copy(lu.uSeeB.value); }
    }
    if (this.grateMat) this.grateMat.userData.uniforms.uTime.value = G.time;
    // swimmers' wakes in the ink surface
    if (this.swimWake && (!m || !m.paused)) this.swimWake.update(dt, this.levelMat.userData.uniforms, G.camera.position);
    // music self-heal: a live, unpaused round never sits in silence because a recording was left paused
    if (m && !m.paused && !m.attract && G.mode === 'match' && (this._musicHealT = (this._musicHealT || 0) + dt) > 1) {
      this._musicHealT = 0;
      const ct = G.music?.current;
      if (ct && ct.el && ct.el.paused && !ct.stopped && !ct.el.ended && (m.state === 'playing' || m.state === 'intro')) G.music.resume();
    }
    this.showcase.update(dt);
    this._updateLocalLoops(dt);
    this._updateAmbience(dt);
    // audio listener
    if (G.audio?.setListener) {
      const cam = this.rig.gameCam || G.camera;   // the player's ears stay with the player while the map is up
      G.audio.setListener(cam.position, cam.getWorldDirection(this._lf || (this._lf = new THREE.Vector3())), cam.up);
    }
    // post uniforms (low-hp vignette)
    const g = this.R.grade.uniforms;
    const hpK = loc && m && !m.attract && loc.alive ? clamp(1 - loc.hp / 55, 0, 1) : 0;
    g.uHurt.value = damp(g.uHurt.value, hpK * 0.8, 6, dt);
    if (loc) g.uHurtColor.value.copy(G.teamColors[loc.enemyTeam]);
    // shadows: every frame (half-rate updates made moving shadows — your own, right under the crosshair — judder);
    // only the low preset halves it
    const sm = G.renderer.shadowMap;
    sm.autoUpdate = false;
    this._frameN = (this._frameN || 0) + 1;
    if (this.settings.quality !== 'low' || (this._frameN & 1)) sm.needsUpdate = true;
    profile?.mark(); // 材质参数、声音与渲染准备
    traceStage?.('draw');
    if (!this._skipRender) {
      if (!setUp) this.R.render();
      this.R.mobileSafety?.recover(this);
      if (this.showcase.mode) sm.needsUpdate = true;
      this.showcase.render();
    }
    const tC = performance.now();
    profile?.mark(); // 场景与后处理提交
    traceStage?.('ui');
    const ps = this.perf || (this.perf = { sim: 0, render: 0, calls: 0, tris: 0 });
    ps.sim += (tB - tA - ps.sim) * 0.05; ps.render += (tC - tB - ps.render) * 0.05;
    ps.calls = G.renderer.info.render.calls; ps.tris = G.renderer.info.render.triangles;
    // HUD
    if (m && !m.attract && this.hud && (m.state === 'playing' || m.state === 'intro' || m.state === 'finish')) this._updateHud(dt);
    this.menus?.update?.(dt);
    this.input.endFrame();
    profile?.end(); // HUD、菜单与帧末处理也纳入总时间
    endStage?.();
  }

  // continuous sounds tied to the local player's state (swim gurgle, wall climb, enemy-ink sizzle)
  // harbour soundscape: continuous sea wash + occasional gull cries out over the water
  _updateAmbience(dt) {
    if (!this._audioOn || !G.audio?.loop) return;
    if (!this._amb) this._amb = G.audio.loop('harbor_ambience', { volume: 0.55 });
    // in the lobby's alley the harbour is only a distant wash (and no gulls overhead)
    const inSet = !!this.showcase?.fullFrame;
    this._ambV = damp(this._ambV ?? 0.55, inSet ? 0.12 : 0.55, 2, dt);
    this._amb.set?.({ volume: this._ambV });
    if (inSet) return;
    this._gullT = (this._gullT ?? 4) - dt;
    if (this._gullT <= 0) {
      this._gullT = 7 + Math.random() * 12;
      const B = G.level.bounds, a = Math.random() * Math.PI * 2;
      const p = this._gullP || (this._gullP = new THREE.Vector3());
      p.set(Math.cos(a) * (B.maxX + 25), 12 + Math.random() * 8, Math.sin(a) * (B.maxZ + 20));
      G.audio.play('gull', { pos: p, volume: 0.6 + Math.random() * 0.4, pitch: 0.9 + Math.random() * 0.25 });
    }
    // marina: rigging ringing against the masts in the gusts, and now and then a ship's horn out in the channel
    if (G.level?.layout?.id === 'halyard') {
      const p = this._ambP || (this._ambP = new THREE.Vector3());
      this._gustT = (this._gustT ?? 2) - dt;
      if (this._gustT <= 0) { this._gustT = 2.5 + Math.random() * 4; this._clinks = 2 + ((Math.random() * 4) | 0); this._clinkT = 0; }
      if (this._clinks > 0 && (this._clinkT -= dt) <= 0) {
        this._clinks--; this._clinkT = 0.12 + Math.random() * 0.45;
        const s = Math.random() < 0.5 ? -1 : 1;
        p.set(s * (27 + Math.random() * 14), 8 + Math.random() * 4, (Math.random() * 2 - 1) * 40);
        G.audio.play('halyard_clink', { pos: p, volume: 0.5 + Math.random() * 0.5, pitch: 0.85 + Math.random() * 0.35 });
      }
      this._hornT = (this._hornT ?? 28 + Math.random() * 10) - dt;
      if (this._hornT <= 0) {
        this._hornT = 55 + Math.random() * 30;
        p.set((Math.random() < 0.5 ? -1 : 1) * 95, 8, (Math.random() * 2 - 1) * 70);
        G.audio.play('ferry_horn', { pos: p, volume: 0.8 });
      }
    }
  }

  _updateLocalLoops(dt) {
    const m = this.match, a = m && !m.attract && !m.paused ? m.local : null;
    const L = this._loops || (this._loops = {});
    const want = (name, on, vol, pitch = 1) => {
      if (on && !L[name]) L[name] = G.audio?.loop?.(name, { volume: 0 });
      const h = L[name];
      if (!h) return;
      h._v = damp(h._v || 0, on ? vol : 0, on ? 10 : 7, dt);
      h.set({ volume: h._v, pitch });
      if (!on && h._v < 0.01) { h.stop(0.05); L[name] = null; }
    };
    const alive = !!(a && a.alive);
    const hs = alive ? Math.hypot(a.vel.x, a.vel.z) : 0;
    want('swim', alive && a.anim.form === 'swim' && hs > 0.5, Math.min(0.6, hs / 11.8 * 0.6 + 0.08), 0.6 + Math.min(1, hs / 11.8));
    want('climb', alive && a.anim.form === 'climb', 0.5, alive ? 0.6 + Math.min(1, Math.abs(a.vel.y) / 7.5) : 1);
    want('enemy_ink_sizzle', alive && a.grounded && a.groundTeam === 2, 0.45, 1.0);
  }

  _padMenus() {
    const inp = this.input;
    if (!inp.pad) return;
    const pp = inp.padPressed;
    if (this.menus?.current) {
      const nav = (d) => this.menus.nav?.(d);
      if (pp.has(12)) nav('up'); if (pp.has(13)) nav('down'); if (pp.has(14)) nav('left'); if (pp.has(15)) nav('right');
      if (pp.has(0)) nav('accept'); if (pp.has(1)) nav('back'); if (pp.has(2)) nav('alt');   // X: locker shuffle etc.
      if (pp.has(4)) nav('tab_prev'); if (pp.has(5)) nav('tab_next');
      if (pp.has(3)) nav('alt');
      // left stick as d-pad with repeat
      const ly = inp.padAxis(1), lx = inp.padAxis(0);
      this._stickT = (this._stickT || 0) - 1 / 60;
      if (this._stickT <= 0) {
        if (ly < -0.6) { nav('up'); this._stickT = 0.22; } else if (ly > 0.6) { nav('down'); this._stickT = 0.22; }
        else if (lx < -0.6) { nav('left'); this._stickT = 0.22; } else if (lx > 0.6) { nav('right'); this._stickT = 0.22; }
      }
      if (pp.has(9) && this.menus.current === 'pause') this.resume();
    } else if (G.mode === 'match' && pp.has(9)) this.pause();
    else if (G.mode === 'match' && pp.has(8) && this.match?.practice) this.openPracticeLoadout();
  }

  _updateHud(dt) {
    const m = this.match, a = m.local, cam = G.camera;
    // 手机准星与队友标记共用真实视口缓存，避免战斗事件写DOM后再次同步窗口布局。
    // PC保留原生读取；公式与窗口变化处理不变。
    const viewport = window.inkwaveMobile ? mobileViewport() : null;
    const W = viewport ? viewport.width : innerWidth, H = viewport ? viewport.height : innerHeight;
    this.minimap.update(dt);
    const w = a.weapon;
    // crosshair spread = the weapon's live cone (first-shot accurate, blooms with sustained fire / in the air)
    const vHalf = (G.camera.fov * Math.PI) / 360;
    const coneDeg = a.weaponRunner.spread ?? (w.kind === 'shooter' ? 5.5 : w.kind === 'blaster' ? 1.2 : 0);
    const spread = w.kind === 'roller' ? 28 : w.kind === 'brush' ? 22 : Math.min(90, (Math.tan((coneDeg * Math.PI) / 180) / Math.tan(vHalf)) * ((viewport ? H : innerHeight) / 2));
    const players = [];
    const t = { x: 0, y: 0 };
    for (const o of m.actors) {
      if (!o.alive) continue;
      const tracked = o.team !== a.team && o.status.track > 0 && o.status.trackTeam === a.team;
      if (o.team !== a.team && !o.isLocal) {
        // enemies only show on the map when visible to your team (not submerged far away) — tracked ones always do
        if (o.anim.form === 'swim' && !tracked) continue;
      }
      this.minimap.toCanvas(o.pos.x, o.pos.z, t);
      players.push({ x: t.x / this.minimap.w, y: t.y / this.minimap.h, team: o.team, isSelf: o.isLocal, yaw: -o.yaw + (this.minimap.flip ? Math.PI : 0), alive: o.alive, color: G.teamHex[o.team], tracked });
    }
    // ally markers
    const markers = [];
    const v = this._mv || (this._mv = new THREE.Vector3());
    for (const o of m.actors) {
      const tracked = o.team !== a.team && o.alive && o.status.track > 0 && o.status.trackTeam === a.team;
      if (!tracked && (o.isLocal || o.team !== a.team || !o.alive)) continue;
      if (o.character.getHeadPosition && o.form !== 'squid') { o.character.getHeadPosition(v); v.y += 0.45; }
      else { if (o.visualPos) o.visualPos(v); else v.copy(o.pos); v.y += o.form === 'squid' ? 1.0 : 1.9; }
      v.project(cam);
      const behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      const onScreen = !behind && x > 20 && x < W - 20 && y > 20 && y < H - 20;
      let angle = 0;
      if (!onScreen) {
        let dx = x - W / 2, dy = y - H / 2;
        if (behind) { dx = -dx; dy = -dy; }
        angle = Math.atan2(dy, dx);
        const k = Math.min((W / 2 - 40) / Math.max(1e-3, Math.abs(Math.cos(angle))), (H / 2 - 40) / Math.max(1e-3, Math.abs(Math.sin(angle))));
        x = W / 2 + Math.cos(angle) * k; y = H / 2 + Math.sin(angle) * k;
      }
      markers.push({ x, y, name: o.name, color: G.teamHex[o.team], onScreen, angle, dist: o.pos.distanceTo(a.pos), tracked });
    }
    // contextual prompts (light tutorial)
    this._hintT += dt;
    let prompt = null;
    const inkF = a.ink / PLAYER.inkMax;
    if (m.state === 'playing' && a.alive) {
      if (m.controller?.mapHeld) prompt = null;   // the map diorama carries its own super-jump hints
      else if (a.superJumpState) prompt = null;
      else if (this._lowInkFlash > 0) { this._lowInkFlash -= dt; prompt = { id: 'Low ink! Hold SHIFT in your ink to refill' }; }
      else if (a.specialReady() && (this._hints.specialT = (this._hints.specialT || 0) + dt) > 2) prompt = { id: 'Special ready! Press F' };
      else if (inkF < 0.25 && a.form !== 'squid') prompt = { id: 'Hold SHIFT to swim in your ink and refill' };
      else if (m.duration - m.time < 8 && !this._hints.shot) prompt = m.zones ? { id: 'Ink the zone and hold it to count down!' } : { kind: 'turfTip', id: 'Paint the ground — most turf wins!' };
      if (!a.specialReady()) this._hints.specialT = 0;
      if (a.intent.fire) this._hints.shot = true;
    }
    if (m.practice && m.state === 'playing' && a.alive && this._hintT < 7) prompt = { id: 'Practice · L to change loadout · ESC for the practice menu' };
    const strikeAim = !!(a.specialActive && a.specialActive.id === 'strike' && a.specialActive.aiming);
    // "Yeah!" cheers → screen positions over the cheering player (anyone on screen)
    const cheers = [];
    for (const c of G.specials.cheers) {
      const o = c.a;
      v.set(o.pos.x, o.pos.y + (o.smoothY || 0) + 2.25, o.pos.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      cheers.push({ x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, k: c.t / 1.1, color: G.teamHex[o.team] });
    }
    // death markers: screen spot (floating a little over where they fell), size by camera distance, minimap spot —
    // written into the pooled records the HUD reads (no per-frame garbage)
    const deaths = this._deathPool();
    for (const d of deaths) {
      if (!d.on) continue;
      d.ally = d.team === a.team;
      v.set(d.x, d.y + 0.95, d.z);
      const dist = v.distanceTo(cam.position);
      v.project(cam);
      d.vis = v.z < 1 && Math.abs(v.x) < 1.08 && Math.abs(v.y) < 1.08;
      d.sx = (v.x * 0.5 + 0.5) * W; d.sy = (-v.y * 0.5 + 0.5) * H;
      d.sc = clamp(1.12 - dist / 60, 0.56, 1);
      this.minimap.toCanvas(d.x, d.z, t); d.mx = t.x / this.minimap.w; d.my = t.y / this.minimap.h;
    }
    if (a.specialActive && m.state === 'playing' && a.alive) prompt = G.specials.prompt(a) || prompt;
    else if (m.state === 'playing' && a.alive && m.actors.some((o) => o !== a && o.team === a.team && o.specialActive?.id === 'booyah' && !o.specialActive.thrown)) prompt = { id: 'A teammate is charging a Cheer Orb — press C to cheer it on!' };
    const frame = {
      time: m.practice ? null : m.time,
      teams: a.team === 1 ? m.teamSummary().reverse() : m.teamSummary(),   // HUD: [your team, theirs]
      ink: a.ink / PLAYER.inkMax, inkLow: a.ink < 18 || (this._lowInkFlash > 0), subCost: a.specialActive?.kind === 'barrage' ? 0 : (a.sub || SUB.bomb).inkCost / PLAYER.inkMax, subKind: (a.specialActive?.kind === 'barrage' ? a.specialActive.bomb : a.sub || SUB.bomb).kind,
      poisoned: a.status.poison > 0, tracked: a.status.track > 0,
      special: a.specialActive ? G.specials.remaining(a) : a.specialFrac(), specialReady: a.specialReady(), specialActive: !!a.specialActive, specialId: a.specialId,
      hp: a.hp / PLAYER.hp,
      weapon: a.weaponId, charge: a.weaponRunner.charge,
      twin: w.kind === 'twins' ? { planted: !!a.weaponRunner.turret, rolls: a.weaponRunner.rollsLeft() } : null,
      crosshair: { spread, onTarget: m.controller?.onTarget ? 'enemy' : null, inRange: m.controller ? m.controller.inRange !== false : true },
      // corner minimap follows the setting; the TAB map (needed for super jumps) is always available
      map: (this.settings.minimap !== false || strikeAim) ? { canvas: this.minimap.canvas, expanded: strikeAim, strike: strikeAim, players } : null,
      markers,
      cheers,
      deaths,
      // a Super Jump planned on the TAB map while splatted ({ kind, target, name } | null): shown on the splat screen
      jumpQueue: !a.alive ? m.controller?.jumpQueue || null : null,
      prompt,
      fps: this.settings.showFps ? this.fps : undefined,
      // Zone Control: counts / penalties / the operational objective (HUD counters, objective chip, banners)
      zones: m.zones ? { ...m.zones.state(), viewer: a.team } : undefined,
    };
    this.hud.update(dt, frame);
  }
}

// 【发动机点火】整个游戏从这里启动:浏览器加载完本模块就执行这两行。
// boot() 失败(比如 WebGL 不可用)不会白屏——抓住异常,显示 index.html 里预留的红底 #boot-error 框。
const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('boot-error');
  if (el) { el.textContent = t('Something went wrong while loading') + ': ' + e.message; el.style.display = 'block'; }
});
