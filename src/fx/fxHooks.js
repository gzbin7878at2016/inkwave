// ===============================================================================================================
// 【中文导读】fxHooks.js —— "玩法事件 → 特效配方" 的粘合层(注:英文头注释里的 Stream 5 指开发流的编号)。
// 【模块定位】属于 fx 子系统。main.js 在 boot 阶段调用 initFxHooks(G) 创建唯一 FxHooks 实例(main.js this.fxHooks),
//         此后每个"未暂停帧"调用 hooks.update(dt)。它自己不绘制任何东西——所有笔触都在 fx.js 的 FX 主类;
//         它也不产生事件——事件来自 core/ctx.js 的事件总线 on(name, fn)(见 docs/EVENTS.zh-CN.md)。
//         它只负责判定"何时、在哪、什么颜色"调用哪个 fx 配方。
// 【双通道设计】离散时刻(落地、命中、超级跳、炸弹爆炸…)走事件订阅;连续效果(游泳气泡、冲刺残影、蓄力辉光)
//         每帧轮询 actor / projectile 状态。每个事件都配有一条"状态轮询兜底":事件尚未被发出时,靠对比上一帧状态推断;
//         一旦真正收到过该事件(this.seen[name] = true),对应兜底就永久关闭——即使某条事件流未实现,特效也照常工作,
//         且不会与真实事件叠加成双份。这就是构造函数里 sub(...) 与 _actor 中 `!this.seen[...]` 分支的由来。
// 【零分配纪律】所有临时向量/颜色都在模块级 scratch(_v/_v2/_v3/_dir/_n/_c)与每 actor 的持久状态对象(this.st Map)中复用;
//         update 热循环不得 new。this._headFn/_bombGC/_cloudGC/_sightFn 等"回调单例"也是首次用到才创建一次,避免每帧闭包垃圾。
// 【关键约定】距离裁剪:配方只在相机/玩家附近触发(this._near 用平方距离);每个系统有触发计数器 this.count,
//         可用 __inkwave.fxHooks.stats() 审计。墨水归墨水:飞溅落点进 paint 图集(fx.onSpeck → paint.speck),
//         涟漪进墨面本身(fx.onRipple → paint.ripple),不再另贴 decal blot。
// 【配套阅读】docs/EVENTS.zh-CN.md(事件名与载荷)、docs/CONTRACTS.zh-CN.md §4(fx 契约 API)、src/fx/fx.js(全部配方实现)、
//         docs/BOOT.zh-CN.md(装配时序)。兄弟文件:src/fx/screenfx.js、src/fx/swimWake.js。
// 【建议阅读顺序】constructor(事件订阅表 + onSpeck/onRipple 接线)→ update(帧入口)→ _actor(最大、兜底最多)
//         → _projectiles/_bombs/_clouds/_beams(投射物)→ _ambient(环境氛围)→ _buildEdges。
// ===============================================================================================================
// INKWAVE — gameplay → VFX glue (Stream 5). main.js calls `initFxHooks(G)` once at boot and `hooks.update(dt)` every
// unpaused frame. Discrete moments come from the event bus (docs/EVENTS.md); continuous effects poll actor / projectile
// state. Every event has a state-polling fallback that switches itself off the first time the real event is seen, so
// the effects work whether or not a given event is emitted yet. The recipes themselves live in fx.js.
//
// Systems: footsteps (own ink / enemy ink / dry dust), landings, jump-off, kid⇄squid pops, dive/emerge splashes, swim
// bubbles, wall-climb drips + ledge pops, enemy-ink sizzle, damage drips, hit splashes, splat ghosts + sea splashes,
// shot mist trails, blaster / charger / roller-flick muzzle extras, charger charge glow + full-charge sparkle + laser dot
// + beam trail/impact, roller spray, bomb trails / bounces / danger zones / beep pulses, Tidal Slam launch / charge /
// fall streaks / shockwaves, Ink Tempest start / puddles / flashes, super-jump charge / launch / trail / landing marker /
// landing splash, spawn-pad pulses, special-ready sparkles, dry-fire wisps, shots plopping into the sea; ambient sea
// spray on the deck edges and drifting gull feathers (+ the GPU dust motes inside fx.js).
// Ink stays ink: flying droplets that land leave a speck in the paint atlas (fx.onSpeck → paint.speck) and every
// splash / footstep / dive ripples the ink surface itself (fx.onRipple → paint.ripple) instead of drawing decals.
import * as THREE from 'three';
import { on } from '../core/ctx.js';
import { PLAYER, SUB, SPECIALS, WEAPONS } from '../config.js';
import { Hit } from '../game/physics.js';

// 【工厂函数】boot 阶段由 main.js 调用一次;返回的实例持有全部事件订阅与每 actor 状态。
export function initFxHooks(G) { return new FxHooks(G); }

// 【模块级 scratch】供所有配方复用,保证 update 热路径零分配(与 fx.js 同款的纪律)。
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3();
const _n = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), ZAX = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;
const rand = Math.random;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// 【审计键】把 weapon 种类映射到 stats 计数器的键,便于 __inkwave.fxHooks.stats() 分辨每种武器的触发量。
const FIRE_KEY = { shooter: 'fire:shooter', blaster: 'fire:blaster', charger: 'fire:charger', roller: 'fire:roller' };
const IMPACT_KEY = { shot: 'impact:shot', blast: 'impact:blast', drop: 'impact:drop', charger: 'impact:charger', roll: 'impact:roll' };

// 【FxHooks 主类】事件粘贴器 + 连续效果轮询器。构造即完成全部事件订阅;之后只有 update() 一条帧路径。
class FxHooks {
  constructor(G) {
    this.G = G;
    this.seen = Object.create(null);     // events that actually fired → their polling fallbacks switch off
    this.st = new Map();                 // actor → per-actor state
    this.bombs = new Map();              // bomb record → { gp, gn, beepT, vy, stamp }
    this.clouds = new Map();             // storm cloud → { stamp, puddleT, flashT }
    this.seenBeams = new WeakSet();
    // 【状态表】this.st:actor → 该 actor 的持久状态(出生时刻、上一帧坐标/朝向/形态、各效果节流累加器…),
    //  复用不重建;actor 数量固定,不会增长。this.bombs/this.clouds:临时对象 → 每帧存活性记录,配合 GC 回调清理。
    this.hit = new Hit(); this.hit2 = new Hit();
    this.time = 0; this.stamp = 0;
    this.count = Object.create(null);    // per-system trigger counters (audits: __inkwave.fxHooks.stats())
    this.edges = []; this.edgeLevel = null;
    this.sprayT = 0; this.featherT = 4 + rand() * 6;
    this.flickT = new Map();
    this.enabled = true;
    this._sp = new THREE.Vector3();
    this.heads = new Map();              // slosh wave head globs in flight → last seen { x, y, z, vx, vz, t, team, color }
    this.dropHits = [];                  // recent 'drop' impacts (pos, normal, time) — to find where a head glob landed
    // 【契约回接】把 FX 主类的两个回调接到 paint 系统:落地墨点 → paint.speck(写进图集),涟漪 → paint.ripple(进墨面着色器)。
    //  这样飞溅的墨水本身成为真正的涂装,而非叠加的贴花(见 docs/CONTRACTS.zh-CN.md §4、src/world/levelMaterial.js)。
    if (G.fx) {
      G.fx.onSpeck = (p, n, col, size) => {
        const P = this.G.paint, t = this._teamOf(col);
        if (!P || t < 0 || size < 0.014) return;
        P.speck?.(this._sp.copy(p).addScaledVector(n, 0.04), Math.min(0.11, size * 1.7), t);
      };
      G.fx.onRipple = (p, amp, wl, speed, life) => this.G.paint?.ripple?.(p, amp, wl, speed, life);
    }
    // 【订阅包装】sub(name, fn):统一登记"该事件已出现"(sees→关闭兜底)、统一 gate(enabled / G.fx / 载荷存在)、
    //  统一 try/catch(单个配方抛错不影响其它订阅);每帧最多触发一次的事件都在这里挂。
    const sub = (name, fn) => on(name, (e) => { this.seen[name] = true; if (!this.enabled || !G.fx || !e) return; try { fn(e); } catch (err) { console.warn('[fxHooks]', name, err); } });
    sub('actor:footstep', (e) => this._footstep(e.actor, e.pos, e.surface, e.speed));
    sub('actor:land', (e) => this._land(e.actor, e.pos || e.actor.pos, e.speed, e.surface));
    sub('actor:jump', (e) => this._jump(e.actor, e.surface, e.swim));
    sub('actor:form', (e) => this._form(e.actor, e.form, e.surface));
    sub('actor:dive', (e) => this._dive(e.actor, e.pos || e.actor.pos, e.speed || 0));
    sub('actor:emerge', (e) => this._emerge(e.actor, e.pos || e.actor.pos, e.speed || 0));
    sub('actor:climb', (e) => this._climb(e.actor, e.on));
    sub('actor:enemyInk', (e) => this._enemyInk(e.actor, e.on));
    sub('hit', (e) => this._hit(e));
    sub('splatted', (e) => this._splatted(e));
    sub('respawn', (e) => this._respawn(e.actor));
    sub('special:ready', (e) => this._specialReady(e.actor));
    sub('special:use', (e) => this._specialUse(e.actor, e.id));
    sub('special:slam', (e) => this._slam(e.actor, e.pos || e.actor.pos, e.radius));
    sub('superjump', (e) => this._superjump(e.actor, e.phase));
    sub('superjump:land', (e) => this._sjLand(e.actor, e.pos || e.actor.pos));
    sub('lowink', (e) => this._dryFire(e.actor));
    sub('weapon:fire', (e) => this._weaponFire(e));
    sub('weapon:impact', (e) => this._impact(e));
    sub('weapon:dodge', (e) => this._dodge(e));
    sub('storm:start', (e) => this._stormStart(e.pos, e.team));
    sub('bomb:explode', () => {});   // explosion() is drawn by weapons.js; polling handles danger rings + beeps
  }

  // ------------------------------------------------------------------ helpers
  // 【helpers:取用与判定】下面这组都不产生特效,只服务其它方法。
  get fx() { return this.G.fx; }
  _bump(k) { this.count[k] = (this.count[k] || 0) + 1; }                                   // 审计计数
  _near(p, d) { const c = this.G.camera; return !!c && c.position.distanceToSquared(p) < d * d; }   // 相机半径裁剪(平方距离)
  // 【按需状态】为 actor 惰性建持久状态;字段覆盖面很广(落地/跳跃/形态/爬墙/…各自的节流与相位),一 actor 一份,永不复建。
  _state(a) {
    let s = this.st.get(a);
    if (!s) {
      s = { init: false, born: -9, grounded: true, vy: 0, form: 'kid', sub: false, climb: false, alive: a.alive, onEnemy: false,
        stepAcc: 0, foot: 0, dripT: 0, sparkT: 0, sizzleT: 0, climbT: 0, bubbleT: 0, full: false, sj: null, sp: null, spT: 0,
        sjLand: -9, hitT: -9, dryT: -9, climbEnd: -9, slamPending: false, lastSJTo: new THREE.Vector3(), vis: new THREE.Vector3(),
        swimYaw: null, carveT: 0, emergeT: -9, wetT: 0, spinFull: false, dodging: false, dodgeDir: new THREE.Vector3(0, 0, 1) };
      this.st.set(a, s);
    }
    return s;
  }
  // 【视觉位置】优先用角色的视觉插值位置(渲染用的平滑坐标),否则回落到逻辑坐标 a.pos。
  _visual(a, out) { return a.visualPos ? a.visualPos(out) : out.copy(a.pos); }
  // 【水平朝向】速度够快时用速度水平分量;否则用 a.yaw(慢速/静止时朝向由朝向角决定)。
  _heading(a, out) {
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (hs > 0.2) return out.set(a.vel.x / hs, 0, a.vel.z / hs);
    return out.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
  }
  // 【落点墨色】surface 约定:0 干地 / 1 己方墨 / 2 敌方墨;踩在敌方墨上时用敌队色。
  _inkColor(a, surface) { return surface === 2 ? this.G.teamColors[a.enemyTeam] : a.color; }
  // 【颜色 → 队伍】把墨点颜色反查成 0/1 队伍号(用于 onSpeck 决定写谁的颜色),匹配不上返回 -1。
  _teamOf(c) {
    const T = this.G.teamColors;
    if (!T || !c) return -1;
    for (let t = 0; t < 2; t++) { const k = T[t]; if (k && Math.abs(k.r - c.r) + Math.abs(k.g - c.g) + Math.abs(k.b - c.b) < 0.05) return t; }
    return -1;
  }
  // 【刚出生/刚重生】0.35s 内的角色不触发需要过渡的动作特效(避免出生即触地/形变的假象)。
  _fresh(a) { const s = this._state(a); return this.time - s.born < 0.35 || !s.init; }

  // ------------------------------------------------------------------ discrete moments
  // 【离散时刻】以下每个方法对应一条游戏事件(由构造函数订阅);都先做"有效性 + 距离"门控,再调 fx 配方,并 _bump 计数。
  // 【脚步】己方墨(footstep 踏墨)/敌方墨/干地三种 surface;距离随 surface 收紧(踏墨更显眼)。
  _footstep(a, pos, surface = 0, speed) {
    if (!a || !a.alive || !pos || !this._near(pos, surface ? 28 : 18)) return;
    const hs = speed ?? Math.hypot(a.vel.x, a.vel.z);
    this.fx.footstep?.(pos, this._inkColor(a, surface), surface, this._heading(a, _dir), hs);
    this._bump('footstep');
  }
  // 【落地】速度阈值 3.5 以下算轻落不触发;超级跳/特殊技/刚落地 0.3s 内的落地由各自配方负责;鱿鱼落己方墨 = 潜入(走 actor:dive)。
  _land(a, pos, speed = 8, surface = 0) {
    if (!a || !a.alive || speed < 3.5) return;
    const s = this._state(a);
    if (a.specialActive || a.superJumpState || this.time - s.sjLand < 0.3 || !this._near(pos, 38)) return;
    if (a.form === 'squid' && surface === 1) return;          // squid landing in own ink = a dive (actor:dive)
    this.fx.land?.(pos, this._inkColor(a, surface), surface, speed);
    this._bump('land');
  }
  // 【起跳】游泳起跳交给 actor:emerge 水花;超级跳有自己的配方,故此处跳过。
  _jump(a, surface = 0, swim = false) {
    if (!a || swim || a.superJumpState || !this._near(a.pos, 30)) return;   // swim jumps: actor:emerge splashes
    this.fx.jumpOff?.(this._visual(a, _v), this._inkColor(a, surface), surface, false);
    this._bump('jump');
  }
  // 【形态切换】小孩⇄鱿鱼:只有小孩形态的 pop 走这里;己方墨内由 dive/emerge 覆盖,避免双份特效。
  _form(a, form, surface = 0) {
    if (!a || !a.alive || this._fresh(a) || a.superJumpState || a.specialActive) return;
    if (surface === 1) return;                                 // in own ink the dive / emerge splash covers it
    if (!this._near(a.pos, 26)) return;
    this.fx.formPop?.(this._visual(a, _v), a.color, form === 'squid', false);
    this._bump('form');
  }
  // 【潜入】若正在爬墙,dive 实际是"离开墙面",转交 _climb(避免在墙上打水花)。
  _dive(a, pos, speed) {
    if (!a || !a.alive || this._fresh(a) || !this._near(pos, 30)) return;
    if (a.climbing) { this._climb(a, true); return; }
    this.fx.dive?.(pos, a.color, speed);
    this._bump('dive');
  }
  // 【浮出】刚从墙面离开转 climbPop;否则出水特效,并记录 emergeT 让角色接下来 0.5s 滴水(wet drips)。
  _emerge(a, pos, speed) {
    if (!a || !a.alive || this._fresh(a) || a.superJumpState || !this._near(pos, 30)) return;
    const s = this._state(a);
    if (s.climb || this.time - s.climbEnd < 0.25) { this.fx.climbPop?.(pos, this._heading(a, _dir), a.color); this._bump('climbPop'); return; }
    this.fx.emerge?.(pos, a.color, speed);
    s.emergeT = this.time;   // the kid comes up wet: a few drips run off for half a second
    this._bump('emerge');
  }
  // 【上墙/离墙】记录 climb 标志与离墙时刻(climbEnd,供 _emerge 判定是否走 climbPop);上墙时沿墙法线撒 3 滴墨 + 一个环。
  _climb(a, onWall) {
    const s = this._state(a);
    if (!onWall && s.climb) s.climbEnd = this.time;
    s.climb = !!onWall;
    if (!onWall || !a.alive || !this._near(a.pos, 26)) return;
    const n = a.anim?.wallNormal;
    if (!n || n.lengthSq() < 0.5) return;
    _v.copy(a.pos); _v.y += 0.35;
    for (let i = 0; i < 3; i++) this.fx.climbDrip?.(_v, n, a.color);
    this.fx.ring?.(_v2.copy(_v).addScaledVector(n, 0.03), n, a.color, { radius: 0.55, life: 0.3, style: 0, alpha: 0.9 });
    this._bump('climbStart');
  }
  // 【踩敌墨】记录 onEnemy 标志(供 sizzle / 屏幕边缘 goo 等读取),并立刻打一发敌方墨脚步。
  _enemyInk(a, onInk) {
    this._state(a).onEnemy = !!onInk;
    if (!onInk || !a.alive || this._fresh(a) || !this._near(a.pos, 22)) return;
    const col = this.G.teamColors[a.enemyTeam];
    this.fx.footstep?.(a.pos, col, 2, this._heading(a, _dir), 4);
    this._bump('enemyInk');
  }
  // 【受伤】每 victim 0.05s 节流;方向取 victim − attacker 的水平分量;squid 形态溅点更低。
  _hit({ attacker, victim, damage, killed }) {
    if (!attacker || !victim || killed || damage <= 0 || !victim.alive) return;
    const s = this._state(victim);
    if (this.time - s.hitT < 0.05 || !this._near(victim.pos, 40)) return;
    s.hitT = this.time;
    _v.copy(victim.pos); _v.y += victim.form === 'squid' ? 0.3 : 0.95;
    _dir.copy(victim.pos).sub(attacker.pos); _dir.y = 0;
    if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
    _dir.normalize();
    this.fx.hitSplash?.(_v, _dir, attacker.color, damage, false);
    this._bump('hit');
  }
  // 【被击杀】落水击杀额外给水花;一律在(不低于水面的)位置留一个幽灵(spawnGhost 式 squid ghost)。
  _splatted({ victim, cause }) {
    if (!victim) return;
    if (cause === 'water') { this.fx.waterSplash?.(victim.pos, 1.1); this._bump('seaSplat'); }
    this.fx.ghost?.(_v.copy(victim.pos).setY(Math.max(victim.pos.y, PLAYER.waterY + 0.2)), victim.color);
    this._bump('ghost');
  }
  // 【重生】重置该 actor 的瞬时状态(出生时刻、特殊技/超级跳轨迹),并让队伍出生台发一次脉冲闪光。
  _respawn(a) {
    const s = this._state(a);
    s.born = this.time; s.init = true; s.full = false; s.sj = null; s.sp = null;
    this.G.game?.decor?.pulse?.(a.team, 1);
    this._bump('respawn');
  }
  // 【特殊技就绪】一次性的一圈 sparkle + 环;这里只是即时提示,持续闪烁在 _actor 里轮询。
  _specialReady(a) {
    if (!a || !a.alive || !this._near(a.pos, 40)) return;
    this._visual(a, _v);
    for (let i = 0; i < 10; i++) this.fx.specialSparkle?.(_v, a.color, a.form === 'squid' ? 0.6 : 1.6);
    this.fx.ring?.(_v2.copy(_v).setY(_v.y + 0.03), UP, a.color, { radius: 1.3, life: 0.45, style: 7, alpha: 0.8 });
    this._bump('specialReady');
  }
  // 【使用特殊技】记录当前 id/计时;Tidal Slam 额外给一次 launch 特效(其余靠 specialActive 相位轮询)。
  _specialUse(a, id) {
    const s = this._state(a);
    s.sp = id; s.spT = 0;
    if (id === 'slam') { this.fx.slamLaunch?.(a.pos, a.color); this._bump('slamLaunch'); }
  }
  // 【Slam 落地】清除 slam 状态并画冲击波;半径兜底用 SPECIALS.slam.radius(config.js)。
  _slam(a, pos, radius) {
    if (!a) return;
    const s = this._state(a);
    s.sp = null; s.slamPending = false;
    this.fx.slamWave?.(pos, a.color, radius || SPECIALS.slam.radius);
    this._bump('slamWave');
  }
  // 【超级跳】记录相位;进入 flight 时给发射特效;其余相位(charge/land)在 _actor 轮询里画。
  _superjump(a, phase) {
    const s = this._state(a);
    s.sj = phase;
    if (phase === 'flight') { this.fx.superJumpLaunch?.(a.pos, a.color); this._bump('sjLaunch'); }
  }
  // 【超级跳落地】落点若在本队出生台附近,顺带触发一次出生台脉冲(回家跳的视觉呼应)。
  _sjLand(a, pos) {
    const s = this._state(a);
    s.sj = null; s.sjLand = this.time;
    this.fx.superJumpLand?.(pos, a.color);
    const pad = this.G.level?.spawnPads?.[a.team];
    if (pad && Math.hypot(pos.x - pad.x, pos.z - pad.z) < 3.5) this.G.game?.decor?.pulse?.(a.team, 0.8);
    this._bump('sjLand');
  }
  // 【空击/低墨】无墨开火:0.4s 节流,取枪口位置(character.getMuzzle)与瞄向,冒一缕干烟。
  _dryFire(a) {
    if (!a || !a.alive || a.form === 'squid') return;
    const s = this._state(a);
    if (this.time - s.dryT < 0.4) return;
    s.dryT = this.time;
    a.character?.getMuzzle?.(_v);
    if (!Number.isFinite(_v.x)) return;
    this.fx.dryFire?.(_v, a.aimDir || _dir.set(0, 0, 1));
    this._bump('dryFire');
  }
  // 【开火】按武器种类分派:blaster/charger 走 muzzle,roller/bucket/brush 走 _flick(甩墨帘)。
  _weaponFire(e) {
    const a = e.actor; if (!a || !e.muzzle) return;
    const kind = (e.weapon && (e.weapon.kind || e.weapon)) || a.weapon?.kind;
    const dir = e.dir || a.aimDir;
    if (kind === 'blaster') this.fx.muzzle?.(e.muzzle, dir, a.color, 'blaster');
    else if (kind === 'charger') this.fx.muzzle?.(e.muzzle, dir, a.color, 'charger');
    else if (kind === 'roller' || kind === 'bucket' || kind === 'brush') this._flick(a);
    this._bump(FIRE_KEY[kind] || 'fire:other');
  }
  // 【着弹】charger 命中给 beamImpact;'drop'(甩墨块)命中记录到 dropHits(供 slosh wave head 落地定位);
  //  shots/flick 的水花已由 weapons.js 与 paint 涟漪负责,这里不叠加贴花(见英文注释)。
  _impact(e) {
    if (!e.pos || !this._near(e.pos, 32)) return;
    const col = this.G.teamColors[e.team] || _c.set(0xffffff);
    const n = e.normal || UP;
    // shots / flick drops: weapons.js already bursts the splash (fx.burst) and the paint system ripples the ink —
    // nothing is stacked on top here (no decal blots)
    if (e.kind === 'charger') this.fx.beamImpact?.(e.pos, n, col, 1);
    if (e.kind === 'drop' && !e.victim) {
      const H = this.dropHits;
      if (H.length >= 24) H.shift();
      H.push({ x: e.pos.x, y: e.pos.y, z: e.pos.z, nx: n.x, ny: n.y, nz: n.z, t: this.time });
    }
    this._bump(IMPACT_KEY[e.kind] || 'impact:other');
  }
  // 【暴风雨开始】Ink Tempest 起云:用队伍色兜底(tempColors 缺失时用白色)画起始云。
  _stormStart(pos, team) {
    if (!pos) return;
    this.fx.stormStart?.(pos, this.G.teamColors[team] || _c.set(0xffffff), SPECIALS.storm.radius);
    this._bump('stormStart');
  }
  // 【甩墨】roller/bucket/brush 的 flick:0.25s 节流,枪口上方画扇形墨帘(flickCurtain)。
  _flick(a) {
    const last = this.flickT.get(a) || -9;
    if (this.time - last < 0.25) return;
    this.flickT.set(a, this.time);
    if (!this._near(a.pos, 34)) return;
    _v.copy(a.pos); _v.y += 1.05;
    _dir.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    this.fx.flickCurtain?.(_v, _dir, a.color, a.weapon?.flickSpreadDeg || 50);
    this._bump('flick');
  }

  // dualies dodge roll: push-off splash (the skid + plant are driven per frame from the runner's dodge state)
  // 【翻滚冲刺】dualies 起滚:记录滚向(供每帧读 dodge state 的 skid/plant 使用),近处给一次推出水花。
  _dodge(e) {
    const a = e.actor;
    if (!a || !a.alive || !e.pos || !e.dir) return;
    const s = this._state(a);
    s.dodgeDir.set(e.dir.x, 0, e.dir.z);
    if (s.dodgeDir.lengthSq() < 1e-4) s.dodgeDir.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    s.dodgeDir.normalize();
    if (!this._near(e.pos, 34)) return;
    this.fx.dodgeSplash?.(e.pos, s.dodgeDir, a.color);
    this._bump('dodge');
  }

  // ------------------------------------------------------------------ per frame
  // 【帧入口】main.js 每个未暂停帧调用。顺序:推进时钟 → 同步 paint 视角 → 遍历 actors → 遍历投射物(弹/炸弹/云/光束)→ 环境氛围。
  //  任何一环缺失(G.fx 未就绪 / 暂停 / dt<=0)直接早退。
  update(dt) {
    const G = this.G, fx = G.fx;
    if (!fx || !this.enabled || !(dt > 0)) return;
    this.time += dt; this.stamp++;
    if (G.paint && G.camera && G.paint.viewPos !== G.camera.position) G.paint.setView?.(G.camera.position);
    if (G.actors) for (let i = 0; i < G.actors.length; i++) this._actor(G.actors[i], dt);
    const P = G.projectiles;
    if (P) {
      this._projectiles(P, dt);
      this._bombs(P, dt);
      this._clouds(P, dt);
      this._beams(P);
    }
    this._ambient(dt);
  }

  // 【每 actor】本文件最大的方法。先置状态,再跑"状态轮询兜底"(仅当事件未出现时),然后按距离跑连续效果,最后处理特殊技/超级跳相位。
  //  形参 dt 供节流累加器使用;注意很多分支只在近处(near)才执行,远处角色只更新状态不做特效,以省 CPU。
  _actor(a, dt) {
    const fx = this.fx, s = this._state(a);
    const an = a.anim || {};
    if (!a.alive) { s.alive = false; s.stepAcc = 0; s.full = false; return; }
    if (!s.alive) { s.alive = true; s.born = this.time; }
    const pos = this._visual(a, s.vis);
    const near = this._near(pos, 36);
    const hs = Math.hypot(a.vel.x, a.vel.z);
    const form = an.form || 'kid';
    if (!s.init) { s.init = true; s.grounded = a.grounded; s.vy = a.vel.y; s.form = form; s.sub = form === 'swim' || form === 'climb'; s.born = this.time; return; }

    // 【兜底:事件未出现时靠状态差分推断】每个分支都带 `!this.seen[...]` 守卫;一旦事件总线真正送达过一次就永久跳过。
    // ---- polling fallbacks for events that may not be emitted (each disables itself once the event is seen)
    if (!this.seen['actor:land'] && a.grounded && !s.grounded && s.vy < -3.5) this._land(a, a.pos, -s.vy, a.groundTeam);
    if (!this.seen['actor:jump'] && !a.grounded && s.grounded && a.vel.y > 4 && !a.superJumpState) this._jump(a, a.groundTeam, s.form === 'swim');
    const sub = form === 'swim' || form === 'climb';
    if (!this.seen['actor:dive'] && sub && !s.sub) this._dive(a, a.pos, hs);
    if (!this.seen['actor:emerge'] && !sub && s.sub) this._emerge(a, a.pos, hs);
    if (!this.seen['actor:climb'] && (form === 'climb') !== s.climb) this._climb(a, form === 'climb');
    const kidForm = form === 'kid' ? 'kid' : 'squid', prevKid = s.form === 'kid' ? 'kid' : 'squid';
    if (!this.seen['actor:form'] && kidForm !== prevKid) this._form(a, kidForm, a.groundTeam);
    // footsteps from stride distance until character.js emits real foot plants
    if (!this.seen['actor:footstep'] && form === 'kid' && a.grounded && hs > 1.2 && !a.superJumpState && !a.specialActive && near) {
      s.stepAcc += hs * dt;
      const stride = 0.45 + 0.12 * hs;
      if (s.stepAcc >= stride) {
        s.stepAcc -= stride;
        s.foot ^= 1;
        const bone = a.character?.bones?.[s.foot ? 'footR' : 'footL'];
        if (bone) { bone.getWorldPosition(_v2); _v2.y = pos.y; } else _v2.copy(pos);
        if (Number.isFinite(_v2.x)) this._footstep(a, _v2, a.groundTeam, hs);
      }
    } else if (hs <= 1.2) s.stepAcc = 0.3;

    // 【连续效果】只在近处(near)角色上运行:爬墙滴水、急转甩尾、出水滴水、游泳气泡、踩敌墨嘶嘶、受伤滴墨、
    //  特殊技就绪闪光、武器(蓄力辉光/激光/splatling/dualies/roller)等,全部靠节流累加器按频率触发。
    // ---- continuous effects
    if (near) {
      const col = a.color;
      // wall climb drips
      if (form === 'climb' && an.wallNormal) {
        s.climbT += dt;
        if (s.climbT > 0.07) { s.climbT = 0; _v.copy(pos); _v.y += 0.3; fx.climbDrip?.(_v, an.wallNormal, col); }
      }
      // 【急转甩尾】按 yaw 变化率(clamp(dy/dt))累积;超过阈值才在转弯外侧抛一扇墨。sg 取号:正向 yaw 率朝右转,墨飞向左侧。
      // carving a hard turn in the ink: throw a fan off the outside of the turn
      if (form === 'swim' && hs > 4.5) {
        const yaw = Math.atan2(a.vel.x, a.vel.z);
        if (s.swimYaw !== null && dt > 0) {
          let dy = yaw - s.swimYaw; dy -= Math.round(dy / TAU) * TAU;
          const rate = dy / dt;
          s.carveT += dt * clamp((Math.abs(rate) - 3.2) / 5, 0, 1) * 22;
          if (s.carveT >= 1) {
            s.carveT = 0;
            _dir.set(a.vel.x / hs, 0, a.vel.z / hs);
            const sg = rate > 0 ? -1 : 1;   // positive yaw rate turns toward the right vector: spray flies left
            _v.set(_dir.z * sg, 0, -_dir.x * sg);
            this.fx.swimCarve?.(pos, _dir, _v, col, clamp(hs / 11.8, 0, 1));
          }
        }
        s.swimYaw = yaw;
      } else { s.swimYaw = null; s.carveT = 0; }
      // just emerged: drips run off the body
      if (form === 'kid' && this.time - s.emergeT < 0.5) {
        s.wetT += dt * 26 * (1 - (this.time - s.emergeT) / 0.5);
        while (s.wetT >= 1) {
          s.wetT -= 1;
          const ang = rand() * TAU, r = 0.14 + rand() * 0.08;
          _v.set(pos.x + Math.cos(ang) * r, pos.y + 0.35 + rand() * 0.8, pos.z + Math.sin(ang) * r);
          fx.hurtDrip?.(_v, col, 0.03);
        }
      } else s.wetT = 0;
      // idle swimming: bubbles
      if (form === 'swim' && hs < 2) {
        s.bubbleT += dt;
        if (s.bubbleT > 0.35) { s.bubbleT = 0; fx.bubbles?.(pos, col, 1); }
      }
      // enemy ink under a kid: sticky sizzle
      const onEnemy = a.onEnemy !== undefined ? a.onEnemy : (a.grounded && a.groundTeam === 2 && form === 'kid');
      if (onEnemy && this._near(pos, 22)) {
        s.sizzleT += dt;
        if (s.sizzleT > 0.11) { s.sizzleT = 0; fx.enemyInkSizzle?.(pos, this.G.teamColors[a.enemyTeam]); }
      }
      // damage: enemy-ink drips off the body
      const hurt = 1 - a.hp / PLAYER.hp;
      if (hurt > 0.08 && !a.superJumpState) {
        s.dripT += dt * hurt * 7;
        while (s.dripT >= 1) {
          s.dripT -= 1;
          const sq = form !== 'kid';
          const ang = rand() * TAU, r = sq ? 0.12 : 0.16 + rand() * 0.06;
          _v.set(pos.x + Math.cos(ang) * r, pos.y + (sq ? 0.15 + rand() * 0.2 : 0.55 + rand() * 0.75), pos.z + Math.sin(ang) * r);
          fx.hurtDrip?.(_v, this.G.teamColors[a.enemyTeam], 0.026 + hurt * 0.02);
        }
      } else s.dripT = 0;
      // special gauge full: sparkles swirl around the character
      if (a.specialReady && a.specialReady() && !a.superJumpState) {
        s.sparkT += dt * (a.isLocal ? 12 : 9);
        while (s.sparkT >= 1) { s.sparkT -= 1; fx.specialSparkle?.(pos, col, form === 'kid' ? 1.55 : 0.55); }
      }
      // 【武器态】charger/spinner 蓄力辉光 + 满蓄提示;splatling(旋转机枪)自成一档;dualies 翻滚的滑擦/落定;roller 滚动喷墨。
      // weapons: charger glow / laser / roller spray
      const wr = a.weaponRunner;
      if (wr) {
        const wk = a.weapon?.kind ?? 'charger';
        // charger + spinner only — the splatling's spin-up also sets `charging` but has its own tells
        if (wr.charging && form === 'kid' && (wk === 'charger' || wk === 'spinner')) {
          a.character?.getMuzzle?.(_v);
          if (Number.isFinite(_v.x)) {
            fx.chargeGlow?.(_v, col, wr.charge);
            if (wr.charge >= 0.999 && !s.full) { s.full = true; fx.chargeFull?.(_v, col); this._bump('chargeFull'); }
          }
        } else s.full = false;
        // splatling: glow + ink slung off the barrels while spinning up, one crisp "full" cue, a steady sling while
        // streaming (burstFrac = stream left)
        if (wk === 'splatling' && form === 'kid' && (wr.charging || wr.streaming)) {
          a.character?.getMuzzle?.(_v);
          if (Number.isFinite(_v.x)) {
            const aim = a.aimDir || _dir.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
            if (wr.charging) {
              fx.spinUp?.(_v, aim, col, wr.charge, false);
              if (wr.charge >= 0.999 && !s.spinFull) { s.spinFull = true; fx.spinFull?.(_v, aim, col); this._bump('spinFull'); }
            } else fx.spinUp?.(_v, aim, col, 0.35 + 0.65 * (wr.burstFrac || 0), true);
          }
        } else if (!wr.charging) s.spinFull = false;
        // dualies: skid spray + body fling through the roll, a squelch when it plants
        if (wr.dodge) {
          if (!s.dodging) { s.dodging = true; if (s.dodgeDir.lengthSq() < 0.5) s.dodgeDir.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)); }
          fx.dodgeSkid?.(pos, s.dodgeDir, col, wr.dodge.dur ? wr.dodge.t / wr.dodge.dur : 0);
        } else if (s.dodging) {
          s.dodging = false;
          fx.dodgePlant?.(pos, s.dodgeDir, col);
          this._bump('dodgePlant');
        }
        if (wr.rolling && a.grounded && hs > 0.8) {
          const w = a.weapon || WEAPONS.roller;
          _dir.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
          _v.set(pos.x + _dir.x * 0.85, pos.y, pos.z + _dir.z * 0.85);
          fx.rollerSpray?.(_v, _dir, w.rollWidth || 1.1, col, clamp(hs / (w.rollSpeed || 5), 0, 1));
        }
      }
    }
    // 【特殊技】不受距离裁剪:它们是大而可读的关键时刻(悬浮蓄力 / 下砸 / 上升)。
    // ---- specials (drawn at any distance: they are big readable moments)
    const sa = a.specialActive;
    if (sa && sa.id === 'slam') {
      if (sa.phase === 'hang') { _v.copy(pos); _v.y += 0.8; this.fx.slamCharge?.(_v, a.color, clamp(sa.t / (SPECIALS.slam.hang || 0.25), 0, 1)); }
      else if (sa.phase === 'fall') this.fx.slamFall?.(pos, a.color);
      else if (sa.phase === 'rise') this.fx.superJumpTrail?.(_v.copy(pos).setY(pos.y + 0.5), a.vel, a.color);
      if (!this.seen['special:slam']) s.slamPending = true;
    } else if (s.slamPending) {
      s.slamPending = false;
      this._slam(a, a.pos, SPECIALS.slam.radius);
    }
    // 【超级跳】同样不受距离裁剪;charge 阶段在目标点画落地标记(回家跳除外,由返回信标负责),flight 阶段拉尾迹。
    // ---- super jump
    const sj = a.superJumpState;
    if (sj) {
      if (sj.phase === 'charge') {
        fx.superJumpCharge?.(pos, a.color, clamp(sj.t / 0.75, 0, 1));
        const tg = sj.target;
        const tp = tg && tg.pos && tg.pos.isVector3 ? (tg.jumpAnchor ? tg.jumpAnchor() : tg.pos) : tg && tg.isVector3 ? tg : null;
        if (tp && !sj.home) fx.jumpMarker?.(tp, a.color, sj.t);   // (home jumps: the return beacon marks it)
      } else if (sj.phase === 'flight') {
        fx.superJumpTrail?.(pos, a.vel, a.color);
        if (sj.to) { if (!sj.home) fx.jumpMarker?.(sj.to, a.color, sj.t); s.lastSJTo.copy(sj.to); }
      }
      if (!this.seen['superjump'] && s.sj !== sj.phase) { if (sj.phase === 'flight') this._superjump(a, 'flight'); else s.sj = sj.phase; }
    } else if (s.sj === 'flight' && !this.seen['superjump:land']) {
      this._sjLand(a, a.pos);
    }
    s.grounded = a.grounded; s.vy = a.vel.y; s.form = form; s.sub = sub;
  }

  // 【每帧:投射物】弹道雾尾、新弹的枪口补充(在 weapon:fire 事件出现前)、入海扑通声浪。
  //  budget=48 限制每帧最多 48 个尾迹触发(弹幕密集时的性能闸门);p._fxAge/_fxD/_fxY 是挂在投射物自身的追踪字段。
  //  slosh(波浪块)的 head 弹体记录进 this.heads,落地时与 this.dropHits 匹配出重击。
  // shots: mist trails, muzzle extras for new projectiles (until weapon:fire exists), plops into the sea
  _projectiles(P, dt) {
    const list = P.list;
    if (!list) return;
    const fx = this.fx, wy = PLAYER.waterY;
    let budget = 48;
    const fireFallback = !this.seen['weapon:fire'];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.owner) continue;
      if (p._fxAge === undefined || p.age < p._fxAge) {
        // new (or recycled) projectile
        p._fxD = 0; p._fxY = p.pos.y;
        if (fireFallback && p.age < 0.1) {
          if (p.type === 'blast' && this._near(p.pos, 34)) { _dir.copy(p.vel).normalize(); fx.muzzle?.(p.start || p.pos, _dir, p.owner.color, 'blaster'); this._bump('fire:blaster'); }
          else if (p.type === 'drop') this._flick(p.owner);
        }
      }
      p._fxAge = p.age;
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      p._fxD += sp * dt;
      const slosh = p.type === 'slosh';
      if (slosh && p.head) {
        let h = this.heads.get(p);
        if (!h) { h = { x: 0, y: 0, z: 0, vx: 0, vz: 1, t: 0, color: null, born: this.time }; this.heads.set(p, h); }
        h.x = p.pos.x; h.y = p.pos.y; h.z = p.pos.z; h.vx = p.vel.x; h.vz = p.vel.z; h.t = this.time; h.color = p.owner.color; h.stamp = this.stamp;
      }
      const step = p.type === 'blast' ? 0.55 : p.type === 'drop' ? 1.1 : slosh ? (p.head ? 0.45 : 1.0) : 0.8;
      if (p._fxD >= step) {
        p._fxD = 0;
        if (budget > 0 && p.age > 0.03 && (p.delay === undefined || p.age > p.delay) && this._near(p.pos, 30)) {
          budget--;
          if (slosh) fx.sloshTrail?.(p.pos, p.vel, p.owner.color, !!p.head); else fx.shotTrail?.(p.pos, p.vel, p.owner.color, p.type === 'blast');
        }
      }
      if (p._fxY >= wy + 0.05 && p.pos.y < wy + 0.05 && this.G.level && this.G.level.groundHeight(p.pos.x, p.pos.z, p.pos.y + 3) === -Infinity) {
        if (this._near(p.pos, 45)) { fx.waterPlop?.(p.pos, p.type === 'blast' ? 0.6 : 0.3); this._bump('plop'); }
      }
      p._fxY = p.pos.y;
    }
    // slosh wave heads that landed since last frame: the heavy slap where their impact was reported
    if (this.heads.size) {
      this.heads.forEach(this._headFn || (this._headFn = (h, p) => {
        if (h.stamp === this.stamp && p.type === 'slosh' && p.head) return;
        this.heads.delete(p);
        const H = this.dropHits;
        for (let i = H.length - 1; i >= 0; i--) {
          const d = H[i];
          if (d.t < h.t - 1e-6) break;
          const dx = d.x - h.x, dy = d.y - h.y, dz = d.z - h.z;
          if (dx * dx + dy * dy + dz * dz > 1.3 * 1.3) continue;
          if (this._near(_v.set(d.x, d.y, d.z), 34)) {
            _n.set(d.nx, d.ny, d.nz); _v2.set(h.vx, 0, h.vz);
            this.fx.sloshImpact?.(_v, _n, _v2, h.color);
            this._bump('sloshHead');
          }
          H.splice(i, 1);
          break;
        }
      }));
    }
  }

  // 【每帧:炸弹】飞行拖尾、弹跳水花、引爆前的危险圈、每次 beep 的脉冲。this.bombs 以炸弹对象为键,用 stamp 做帧存活性 GC。
  //  炸弹首次进入 armed 状态时向下 raycast 找地面,危险圈贴合真实地面法线(而非假设水平面)。
  // bombs: flight drips, bounce splashes, danger zone under an armed bomb, a pulse on every beep
  _bombs(P, dt) {
    const bombs = P.bombs;
    if (!bombs) return;
    const fx = this.fx, st = this.stamp;
    const R = SUB.bomb.radius, fuse0 = SUB.bomb.fuse;
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      const col = this.G.teamColors[b.team];
      let r = this.bombs.get(b);
      if (!r) { r = { gp: new THREE.Vector3(), gn: new THREE.Vector3(0, 1, 0), ground: false, beepT: b.beepT || 0, vy: b.vel.y, stamp: st, armed: false }; this.bombs.set(b, r); }
      r.stamp = st;
      const near = this._near(b.pos, 40);
      if (b.fuse < 0) {
        if (near) fx.bombTrail?.(b.pos, b.vel, col);
        if (r.vy < -1.5 && b.vel.y > 0.3 && near) { _n.set(0, 1, 0); fx.bounceSplash?.(_v.copy(b.pos).setY(b.pos.y - 0.2), _n, col); this._bump('bombBounce'); }
      } else if (b.kind === 'bomb') {
        if (!r.armed) {
          r.armed = true;
          _v.copy(b.pos); _v.y += 0.3;
          const h = this.G.physics?.raycast(_v, DOWN, 2.5, this.hit, true);
          if (h && h.hit) { r.gp.copy(h.point); r.gn.copy(h.normal); r.ground = true; } else { r.gp.copy(b.pos); r.gp.y -= 0.2; }
          fx.bounceSplash?.(r.gp, r.gn, col);
          this._bump('bombArm');
        }
        const k = clamp(1 - b.fuse / fuse0, 0, 1);
        fx.dangerRing?.(_v.copy(r.gp).addScaledVector(r.gn, 0.02), r.gn, col, R, k);
        if ((b.beepT || 0) > r.beepT + 1e-4) { fx.beepPulse?.(b.pos, r.gp, r.gn, col, R, k); this._bump('bombBeep'); }
      }
      r.beepT = b.beepT || 0; r.vy = b.vel.y;
    }
    if (this.bombs.size) this.bombs.forEach(this._bombGC || (this._bombGC = (r, b) => { if (r.stamp !== this.stamp) this.bombs.delete(b); }));
  }

  // 【每帧:Ink Tempest 云】起云噗、雨点落地的水洼涟漪/溅冠(向下 raycast 找地面)、云内闪光。
  //  puddleT/flashT 为每个云的节流累加器;fade 让消散末尾减弱特效。dt 形参此处未直接使用(节流靠累加器),属保留签名。
  // Ink Tempest clouds: start puff, puddle ripples + splash crowns under the rain, flickers inside
  _clouds(P, dt) {
    const clouds = P.clouds;
    if (!clouds) return;
    const fx = this.fx, st = this.stamp, R = SPECIALS.storm.radius;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const pos = c.group?.position;
      if (!pos) continue;
      const col = this.G.teamColors[c.team];
      let r = this.clouds.get(c);
      if (!r) {
        r = { stamp: st, puddleT: 0, flashT: 0.5 };
        this.clouds.set(c, r);
        if (!this.seen['storm:start']) this._stormStart(pos, c.team);
      }
      r.stamp = st;
      if (!this._near(pos, 45)) continue;
      const fade = c.dur ? clamp((c.dur - c.t) / 0.6, 0, 1) : 1;
      if (c.t > 0.35 && fade > 0.3) fx.rainSheet?.(pos, R * clamp(c.group.scale.x, 0.3, 1), col, dt);
      r.puddleT += dt * 16 * fade;
      while (r.puddleT >= 1) {
        r.puddleT -= 1;
        const a = rand() * TAU, rr = Math.sqrt(rand()) * R * 0.95;
        _v.set(pos.x + Math.cos(a) * rr, pos.y - 0.6, pos.z + Math.sin(a) * rr);
        const h = this.G.physics?.raycast(_v, DOWN, 14, this.hit, true);
        if (h && h.hit) fx.stormPuddle?.(h.point, h.normal, col);
      }
      r.flashT -= dt;
      if (r.flashT <= 0) { r.flashT = 0.5 + rand() * 1.2; fx.stormFlash?.(pos, col, R); }
    }
    if (this.clouds.size) this.clouds.forEach(this._cloudGC || (this._cloudGC = (r, c) => { if (r.stamp !== this.stamp) this.clouds.delete(c); }));
  }

  // 【每帧:蓄力光束】蓄力时在表面打激光红点(sights);发射的光束柱(beams)用 WeakSet 去重,只在其出现的那一帧处理一次。
  //  beams 的终点若命中表面给 beamImpact,否则给空中爆开的 hitSplash。
  // charger: laser-sight dot on surfaces while charging, beam trail + impact when a shot is fired
  _beams(P) {
    const fx = this.fx;
    if (P.sights) P.sights.forEach(this._sightFn || (this._sightFn = (s, a) => {
      if (!s.visible || !a.alive || !this._near(s.position, 50)) return;
      _dir.copy(ZAX).applyQuaternion(s.quaternion);
      const len = s.scale.z;
      _v.copy(s.position).addScaledVector(_dir, Math.max(0, len - 0.25));
      const h = this.G.physics?.raycast(_v, _dir, 0.6, this.hit2, true);
      if (h && h.hit) this.fx.laserDot?.(h.point, h.normal, a.color, a.weaponRunner?.charge || 0);
    }));
    if (!P.beams) return;
    for (let i = 0; i < P.beams.length; i++) {
      const b = P.beams[i];
      if (this.seenBeams.has(b)) continue;
      this.seenBeams.add(b);
      const m = b.mesh;
      if (!m) continue;
      _dir.copy(ZAX).applyQuaternion(m.quaternion);
      const len = m.scale.z;
      _v.copy(m.position); _v2.copy(m.position).addScaledVector(_dir, len);
      if (!this._near(_v, 60) && !this._near(_v2, 40)) continue;
      _c.copy(m.material.color).multiplyScalar(1 / 2.2);
      const charge = clamp(((b.th || 0.06) - 0.035) / 0.05, 0, 1);
      fx.beamTrail?.(_v, _v2, _c, charge);
      if (!this.seen['weapon:fire']) fx.muzzle?.(_v, _dir, _c, 'charger');
      if (!this.seen['weapon:impact']) {
        _v3.copy(_v2).addScaledVector(_dir, -0.3);
        const h = this.G.physics?.raycast(_v3, _dir, 0.7, this.hit, true);
        if (h && h.hit) fx.beamImpact?.(h.point, h.normal, _c, charge);
        else fx.hitSplash?.(_v2, _dir, _c, 40 + 60 * charge, false);
      }
      this._bump('beam');
    }
  }

  // ------------------------------------------------------------------ ambient life
  // 【环境氛围】与玩家状态无关、纯烘托气氛:甲板边缘的拍浪喷沫 + 偶发的海鸥羽毛。
  //  海况 G.env.seaState 缩放喷沫强度/频率;候选边缘点用"相机朝向 + 距离"打分随机挑选(不固定循环),避免重复感。
  _ambient(dt) {
    const G = this.G, fx = this.fx, cam = G.camera;
    if (!cam) return;
    if (G.level !== this.edgeLevel) this._buildEdges();
    // sea spray bursting against the deck edges: waves slap the edge somewhere in view every ~0.3–0.8 s on the open
    // sea; scaled by the environment's sea state (sheltered marina water ≈ 0.15 → no spray at all)
    const sea = clamp(G.env?.seaState ?? 1, 0, 2);
    this.sprayT -= dt;
    if (sea < 0.3) this.sprayT = Math.max(this.sprayT, 0.3);
    else if (this.sprayT <= 0 && this.edges.length) {
      this.sprayT = (0.3 + rand() * 0.5) / sea;
      cam.getWorldDirection(_dir);
      let best = null, bestS = -1;
      for (let tries = 0; tries < 14; tries++) {
        const e = this.edges[(rand() * this.edges.length) | 0];
        const dx = e.x - cam.position.x, dz = e.z - cam.position.z, d = Math.hypot(dx, dz);
        if (d > 48 || d < 2) continue;
        const facing = (dx * _dir.x + dz * _dir.z) / d;
        if (facing < 0.35) continue;
        const score = facing * (1 - d / 60) + rand() * 0.3;
        if (score > bestS) { bestS = score; best = e; }
      }
      if (best) {
        _v.set(best.x, PLAYER.waterY + 0.05, best.z); _n.set(best.nx, 0, best.nz);
        this.fx.seaSpray?.(_v, _n, (rand() < 0.18 ? 1.3 + rand() * 0.3 : 0.55 + rand() * 0.55) * Math.min(1, sea));
        this._bump('seaSpray');
      }
    }
    // a gull feather now and then, drifting down through the view
    this.featherT -= dt;
    if (this.featherT <= 0) {
      this.featherT = 7 + rand() * 9;
      cam.getWorldDirection(_dir);
      _v.set(cam.position.x + _dir.x * (6 + rand() * 8) + (rand() - 0.5) * 8, cam.position.y + 5 + rand() * 4, cam.position.z + _dir.z * (6 + rand() * 8) + (rand() - 0.5) * 8);
      fx.feather?.(_v);
      this._bump('feather');
    }
  }

  // 【构建喷沫候选点】仅在关卡切换时重建(缓存于 this.edgeLevel)。优先用 env.deckEdges(含被旋转的板块);
  //  否则从 env.footprint / level.bounds 的矩形四边走,每 ~1.6m 采一点,跳过仍被陆地包住的内侧边(inside 检测),
  //  得到"甲板临开水面"的点与朝外法线。inR/P 支持 aligned:false 的旋转矩形(货物码头)。
  // open-water deck edges (from the environment's deck footprint): candidate points for sea spray
  _buildEdges() {
    const G = this.G;
    this.edgeLevel = G.level;
    this.edges = [];
    // the environment knows the real deck edges (turned slabs included): spray only where a deck meets open water
    if (G.env && typeof G.env.deckEdges === 'function') { const e = G.env.deckEdges(1.6); if (e.length) { this.edges = e; return; } }
    const rects = (G.env && G.env.footprint && G.env.footprint.length ? G.env.footprint : null) || (G.level ? [G.level.bounds] : []);
    // (turned slabs — env.footprint rects with aligned === false: Cargo Terminal — use their own edges, not the AABB)
    const inR = (r, x, z) => (r.aligned !== false ? x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ
      : Math.abs((x - r.cx) * r.ax + (z - r.cz) * r.az) < r.hx && Math.abs((z - r.cz) * r.ax - (x - r.cx) * r.az) < r.hz);
    const inside = (x, z) => rects.some((r) => inR(r, x, z));
    const P = (r, u, v) => [r.cx + u * r.ax - v * r.az, r.cz + u * r.az + v * r.ax];
    for (const r of rects) {
      const q = r.aligned === false ? [P(r, -r.hx, -r.hz), P(r, r.hx, -r.hz), P(r, r.hx, r.hz), P(r, -r.hx, r.hz)] : null;
      const sides = q ? q.map((a, i) => { const c = q[(i + 1) & 3], n = [[r.az, -r.ax], [r.ax, r.az], [-r.az, r.ax], [-r.ax, -r.az]][i]; return [a[0], a[1], c[0], c[1], n[0], n[1]]; }) : [
        [r.minX, r.minZ, r.maxX, r.minZ, 0, -1], [r.maxX, r.minZ, r.maxX, r.maxZ, 1, 0],
        [r.maxX, r.maxZ, r.minX, r.maxZ, 0, 1], [r.minX, r.maxZ, r.minX, r.minZ, -1, 0],
      ];
      for (const [x0, z0, x1, z1, nx, nz] of sides) {
        const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(len / 1.6));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
          if (inside(x + nx * 0.6, z + nz * 0.6)) continue;
          this.edges.push({ x: x + nx * 0.05, z: z + nz * 0.05, nx, nz });
        }
      }
    }
  }

  // 【审计】返回各系统触发计数 + 已见到的事件名列表(暴露为 __inkwave.fxHooks.stats())。
  stats() { return { ...this.count, seen: Object.keys(this.seen).sort() }; }
}
