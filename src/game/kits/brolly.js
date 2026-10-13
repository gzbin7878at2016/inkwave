// ============================================================================
// 【中文导读】Canopy Brolly 伞枪(主武器)→ 行为/命中/盾牌逻辑侧;模型与部件动画在 brolly-model.js。
// 【模块定位】本三件套之二(伞枪只有行为 + 模型两份,brolly-model.js 里顺带注册了模型与动画)。
//   本文件由 kits/index.js import 触发自注册,顶层往 registry 的 MAIN_KITS.brolly 挂 update/tick/
//   blockShot/blockRay/shields/bot/netState 等 hook,并装 SFX 与图标。
// 【核心机制】
//   1. 开火:每扣一次扳机用 Projectiles.fireCustom 打出一簇窄锥墨弹(damage=0,只涂墨不伤人);真正的
//      伤害由本 kit 在 tick() 里自己结算——它预演核心弹道积分器的"下一帧位置",把同一 blast 里同帧
//      命中同一目标的弹丸合并成一次伤害(单次扣血/单声音),并按飞行距离做每弹衰减。
//   2. 伞面护盾:开火后继续按住会张开伞面挡在身前(移动变慢),挡敌弹/光柱/墨;tick 预扫弹丸下一步,
//      保证没有子弹能"钻缝"打到身后的人。有耐久,会撕裂+闪烁,0 血破碎,过 regrowTime 再生。
//      张开到 launchHold 秒后"发射":伞面脱手贴地滑行成墙(自身身下涂墨、挡敌弹与敌玩家、放行队友),
//      launchLife 秒后或被打散则淡出。
//   3. 炸弹保护:炸弹在伤害结算前 emit bomb:explode,kit 给被伞面遮住的队友一帧无敌,让伞替他们吃炸弹。
// 【关键约定】runner 状态挂在 runner.kit(kit.brolly===true);HUD 准星直接读 kit.hp/hpMax/state/open/
//   launchK/regrowK。盾牌查询 shields() 给 bots 用(描述子稳定、getter 读实时状态)。联机:netState 打包、
//   netApply 还原、launch 走 ghost(netRec 广播)。单位米·秒·弧度。
// 【配套阅读】brolly-model.js(模型/动画/材质);registry.js(契约);config.js 的 WEAPONS.brolly;
//   docs/ASSETS-WEAPONS.zh-CN.md、docs/CONTRACTS.zh-CN.md。
// ============================================================================
// Canopy Brolly (main weapon, kind 'brolly') — see kits/registry.js for the hooks; model + part animation in
// kits/brolly-model.js; tuning in WEAPONS.brolly (config.js).
//
// Fire: each trigger pull fires a narrow cone of ink pellets (core projectiles via fireCustom, damage 0 there). The
//   kit scores pellet hits itself in tick(): it replays the core's integrator + hit test one frame ahead, so a blast's
//   pellets that land together sum into ONE hit per victim (one damage number / hit sound) with per-pellet distance
//   falloff. Holding the trigger with no canopy (broken / launched) repeats the blast at the fire rate.
// Canopy: keep holding after the shot and it unfolds into a shield in front of you (you move slower). It blocks
//   enemy shots, beams and ink (tick pre-scans every projectile's next step, so a shot never slips through to the
//   body behind; blockShot / blockRay cover other callers), soaks bomb blasts (bomb:explode), shows tears + flicker
//   as it wears, breaks at 0 hp and regrows after regrowTime. Held open for launchHold s it LAUNCHES: detaches and
//   slides along the ground as a wall (inks under itself, blocks enemy shots and enemy players, lets allies and
//   their shots through), fading after launchLife s or when shot apart. No canopy until it regrows.
//   Bomb blasts rip into canopies in their radius, and a canopy between a blast and a player on its team takes the
//   blast for them: every bomb emits bomb:explode just before its damage loop, so the kit gives the players it covers
//   a one-frame guard (invuln) for that loop (there is no per-player damage-filter hook for kits).
// Runner state lives in runner.kit (kit.brolly === true); the HUD reticle reads hp / hpMax / state / open / launchK /
//   regrowK straight off it.
import * as THREE from 'three';
import { G, emit, on, clamp, lerp, angleDiff } from '../../core/ctx.js';
import { WEAPONS, PLAYER, weaponRange } from '../../config.js';
import { Physics, Hit } from '../physics.js';
import { MAIN_KITS, netRec } from './registry.js';
import { CHARGES, LONG } from '../bots.js';
import { rumble } from '../actor.js';
import { registerWeaponModel } from '../character-weapons.js';
import { getPlasticMaterial } from '../character-mats.js';
import { WEAPON_ICONS } from '../../ui/ui-icons.js';
import { SFX } from '../../audio/audio.js';
import { pts } from '../../audio/music.js';
import { brollyDef, animateBrolly, canopyOpenGeo, makeFabric, DEPTH, RIM_R } from './brolly-model.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _m = new THREE.Vector3(), _x = new THREE.Vector3(), _hb = new THREE.Vector3();
const _hit = new Hit(), _res = { t: 0, dist: 0 };
const W = () => WEAPONS.brolly;

// 【手持盾几何】逻辑盾:面向准星方向、圆心在胸口前方的一段圆盘(up=离脚高、fwd=前伸、r=半径);
//   pitchMin/Max 限制俯仰,免得盾牌随视角点头穿帮。数值须与 brolly-model.js 的瞄准姿态模型一致。
// held canopy (logical shield): a disc facing the aim, centred ahead of the chest (matches the model in the aim pose)
const HELD = { up: 0.9, fwd: 0.62, r: 0.8, pitchMin: -0.5, pitchMax: 0.45 };
// 【发射盾几何】LAUNCH_H = 伞冠离地高;阻挡平面位于冠后半个穹顶深度处。
// launched canopy: crown this high over the ground; the blocking plane sits half the dome's depth behind the crown
const LAUNCH_H = 0.76, LAUNCH_R = 0.8;
// 【减伤系数】不同弹种打到伞面的伤害占比(喷淋类 drop / slosh 是喷雾,按比例弱化;其余默认 1)。
// share of a projectile's damage the canopy takes, by type (flick / swipe / sprinkler drops are sprays; bucket blobs volleys)
const CANOPY_MUL = { drop: 0.25, slosh: 0.5 };

// 【跑者状态区】runner.kit 的惰性初始化:非 brolly 或尚无 kit 时建一份(含伞面耐久、张开/发射进度、
//   与描述子 sh)。sh 是给 bots 的稳定盾牌描述子。
// ---------------------------------------------------------------------------------------------- runner state
// 取(或惰性创建)该 runner 的 brolly 状态;换武器/首次调用都会补建。
function kitOf(r) {
  let k = r.kit;
  if (!k || !k.brolly) {
    const w = W();
    k = r.kit = {
      brolly: true, hp: w.canopyHp, hpMax: w.canopyHp, state: 'ready', regrowT: 0, regrowK: 0, grow: 1,
      open: 0, opening: false, want: false, pressT: 0, openT: 0, launchK: 0, shot: false, prevFire: false, lockRelease: false,
      flash: 0, shake: 0, lastHit: -9, lastUpd: G.time || 0, sndT: -9,
      sh: { held: true, kit: null, owner: r.a, team: r.a.team, C: new THREE.Vector3(), N: new THREE.Vector3(), R: HELD.r, Cp: new THREE.Vector3(), Np: new THREE.Vector3(), prev: false },
    };
    k.sh.kit = k;
  }
  return k;
}

// 单颗弹丸按已飞行距离 d 求伤害:falloffStart 内满伤,之后线性衰减到 pelletDamageFar。
// pellet damage by distance travelled
function pelletDamage(d) {
  const w = W();
  if (d <= w.falloffStart) return w.pelletDamage;
  return lerp(w.pelletDamage, w.pelletDamageFar, clamp((d - w.falloffStart) / (w.falloffEnd - w.falloffStart), 0, 1));
}

// 【开火区】一次 fireBlast 打出锥形弹幕;PELLETS 记录本 kit 负责结算的弹丸(带 blast 号用于同帧合并)。
// ---------------------------------------------------------------------------------------------- firing
const PELLETS = [];   // { p, id, owner } — live pellets this kit scores
let SEQ = 0, BLAST = 0;
const LOOK = Object.freeze({ vis: 0.068, tail0: 0.55, tailK: 1.1, wob: 0.06, wobF: 24, nose: 0.2, sats: 1 });
// 【弹丸图案】单位锥内的分布:1 枚中心 + 内圈 4 + 外圈 6;每次 blast 整体随机旋转并加抖动,避免完全重合。
// pellet pattern (unit cone): centre, an inner ring of 4, an outer ring of 6 — turned randomly per blast, jittered
const PATTERN = [[0, 0]];
for (let i = 0; i < 4; i++) PATTERN.push([0.42, (i / 4) * Math.PI * 2 + 0.4]);
for (let i = 0; i < 6; i++) PATTERN.push([0.9, (i / 6) * Math.PI * 2]);

// 发射一整轮墨弹:扣墨、取枪口/准星方向、按图案在锥内散布、逐颗 fireCustom(damage=0),并记入 PELLETS。
// 返回是否真的开火(墨不足时消耗失败,给一个短冷却)。
function fireBlast(r, w) {
  const a = r.a, PJ = G.projectiles;
  if (a.ink < w.inkPerShot) { r._empty(); r.cooldown = Math.max(r.cooldown, 0.2); return false; }
  a.ink -= w.inkPerShot; a.lastFire = 0;
  r.firingT = 0.35; a.fireFacing = 0.5;
  const m = PJ._muzzle(a, _m.set(0, 0, 0));
  const dir = PJ._aimFrom(a, m, _d);
  PJ._ballistic(m, dir, a.aimPoint, w.projSpeed, w.straightTime, w.pelletGrav, w.pelletDrag, w.range);
  _r.crossVectors(dir, UP); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize();
  _u.crossVectors(_r, dir).normalize();
  const cone = Math.tan((a.grounded ? w.spreadDeg : w.spreadAir) * DEG), turn = Math.random() * Math.PI * 2;
  const n = Math.min(w.pellets, PATTERN.length);
  BLAST++;
  for (let i = 0; i < n; i++) {
    const [pr, pa] = PATTERN[i];
    // 【散布】把图案点(极坐标)按锥半角 cone 投影到右/上两轴,加小幅抖动,叠加到准星方向上再归一化。
    const ang = pa + turn, jx = (Math.random() - 0.5) * 0.18, jy = (Math.random() - 0.5) * 0.18;
    const ox = (pr * Math.cos(ang) + jx) * cone, oy = (pr * Math.sin(ang) + jy) * cone * 0.72;
    _v.copy(dir).addScaledVector(_r, ox).addScaledVector(_u, oy).normalize();
    const p = PJ.fireCustom(a, m, _v, {
      // 【同速前提】整个 blast 用一个速度(仅 ±极小抖动),让弹丸同时抵达 → 一次 blast 落成一次命中。
      // one speed for the whole blast (± a hair): the pellets arrive together, so a blast lands as one hit
      type: 'shot', speed: w.projSpeed * (0.985 + Math.random() * 0.03), range: w.range, life: w.pelletLife, damage: 0, radius: w.pelletPaint * (0.85 + Math.random() * 0.3),
      size: w.pelletSize, grav: w.pelletGrav, drag: w.pelletDrag, straight: w.straightTime, weaponId: 'brolly', trailEvery: 0,
      look: { ...LOOK, vis: LOOK.vis * (i === 0 ? 1.25 : 0.85 + Math.random() * 0.3) },
    });
    p.life = w.pelletLife;
    p._bid = ++SEQ;
    PELLETS.push({ p, id: p._bid, owner: a, blast: BLAST });
  }
  const near = a.isLocal || a._nearCamera();
  if (near) {
    G.audio?.play('brolly_blast', { pos: a.isLocal ? undefined : m, volume: a.isLocal ? 0.7 : 0.5 });
    G.fx?.muzzle(m, dir, a.color, 'blaster');
  }
  if (a.isLocal) emit('recoil', { amount: 0.011 });
  emit('weapon:fire', { actor: a, weapon: w.id, muzzle: m.clone(), dir: dir.clone() });
  a.character.trigger('shoot');
  rumble(a, 0.22, 0.3, 80);
  r.cooldown = w.fireInterval;
  STATS.blasts++;
  return true;
}

// 【每帧触发区】主武器 update:处理"点射/按住张伞/按久发射"的按键状态机,bot 由 bb.holdUntil 驱动。
// ---------------------------------------------------------------------------------------------- per-frame trigger
function update(r, dt, inp, w) {
  const a = r.a, k = kitOf(r);
  k.lastUpd = G.time;
  const bb = a.bot && a.bot._brolly;
  // bots: the canopy only opens when their fight logic asks (bb.holdUntil) — a trigger held to paint, refill or climb
  // repeats blasts instead. A bot holding the canopy keeps it up while its aim settles.
  const botHold = !!bb && bb.holdUntil > G.time && a.form === 'kid' && a.bot.mode === 'fight';
  const fire = inp.fire || botHold;
  const press = fire && !k.prevFire;
  k.prevFire = fire;
  if (press) { k.pressT = 0; k.shot = false; }
  if (fire) k.pressT += dt; else k.lockRelease = false;
  const canopy = k.state === 'ready' && k.grow > 0.6 && !k.lockRelease;
  const shieldMode = canopy && (!bb || botHold);
  let want = false;
  if (fire && !k.lockRelease) {
    if (shieldMode) {
      // tap = one blast; hold = the blast, then the canopy unfolds
      if (!k.shot && r.cooldown <= 0 && k.open < 0.05 && k.pressT <= w.openDelay + 0.06) { fireBlast(r, w); k.shot = true; }
      want = k.pressT >= w.openDelay;
    } else if (r.cooldown <= 0) fireBlast(r, w);
  }
  if (!fire && r.cooldown < 0) r.cooldown = 0;
  // unfold / fold
  const was = k.open;
  if (want) k.open = Math.min(1, k.open + dt / w.openTime); else k.open = Math.max(0, k.open - dt / w.closeTime);
  k.opening = k.open > was || (k.open >= 1 && k.opening);
  if (was <= 0 && k.open > 0) { sound(a, 'brolly_open', 0.6); STATS.opens++; }
  if (k.want && !want && was > 0.4) sound(a, 'brolly_close', 0.5);
  k.want = want;
  if (k.open > 0) { a.fireFacing = 0.5; a.lastFire = 0; r.firingT = Math.max(r.firingT, 0.2); }
  // held fully open → launch
  if (k.open >= 1 && want) {
    k.openT += dt;
    if (k.openT >= w.launchHold) launch(r, k, w);
  } else k.openT = 0;
  k.launchK = k.state === 'ready' ? clamp(k.openT / w.launchHold, 0, 1) : 0;
}

// 播 brolly 音效的薄封装:远处(vs 本机)音量打折,且只有本机或近镜头角色才播(省 CPU/带宽)。
function sound(a, name, vol, pitch) {
  if (!G.audio || !(a.isLocal || a._nearCamera())) return;
  G.audio.play(name, { pos: a.isLocal ? undefined : a.pos, volume: a.isLocal ? vol : vol * 0.7, pitch });
}

// 【盾牌区】SH 是每帧刷新一次的活跃盾列表(手持 + 发射),SH_T 记录刷新时刻供同帧复用(blockShot/blockRay)。
//   LAUNCHED 是场上的发射盾世界对象;STATS 供测试/调参观测。segShield 用"上帧姿态→本帧姿态"的扫掠线段做
//   连续碰撞,避免移动/转向中的伞面被子弹"跳过"。
// ---------------------------------------------------------------------------------------------- shields
const LAUNCHED = [];   // world canopies
const STATS = { blasts: 0, opens: 0, blocked: 0, blockedDmg: 0, launches: 0, breaks: 0, guarded: 0 };   // (tests / tuning)
const SH = [];         // active shields this frame (held + launched)
let SH_T = -1;         // G.time of the last refresh (blockShot / blockRay reuse it within a frame)

// 计算手持伞面的世界姿态:圆心 C 在胸口上方 + 沿准星方向前伸,法线 N 即朝向;写入描述子 s(C/N/team/owner)。
function heldPose(a, s) {
  const yaw = a.aimYaw, p = clamp(a.aimPitch, HELD.pitchMin, HELD.pitchMax), cp = Math.cos(p);
  s.N.set(Math.sin(yaw) * cp, Math.sin(p), Math.cos(yaw) * cp);
  s.C.set(a.pos.x, a.pos.y + (a.smoothY || 0) + HELD.up, a.pos.z).addScaledVector(s.N, HELD.fwd);
  s.team = a.team; s.owner = a;
}
// 重建本帧活跃盾列表:遍历所有 brolly 角色、满足(存活/kid/ready/张开≥0.55/生长≥0.9)才把手持盾加入;
//   再把存活的发射盾加入;并给新出现的盾把"上一帧姿态"Cp/Np 对齐到当前(防首帧瞬移误判)。
function refreshShields() {
  SH.length = 0; SH_T = G.time;
  for (const a of G.actors || []) {
    if (a.weapon?.kind !== 'brolly') continue;
    const k = a.weaponRunner?.kit;
    if (!k || !k.brolly) continue;
    if (!a.alive || a.form !== 'kid' || k.state !== 'ready' || k.open < 0.55 || k.grow < 0.9) { k.sh.prev = false; continue; }
    heldPose(a, k.sh); SH.push(k.sh);
  }
  for (const c of LAUNCHED) if (c.alive) SH.push(c.sh);
  for (const s of SH) if (!s.prev) { s.Cp.copy(s.C); s.Np.copy(s.N); s.prev = true; }
  return SH;
}
// 帧末快照:把当前姿态存成下一帧扫掠测试的起点。
// end of the frame: this pose becomes the swept test's start pose
function snapShields() { for (const s of SH) { s.Cp.copy(s.C); s.Np.copy(s.N); } }
// 【扫掠判定】线段 prev→pos 是否穿过盾牌 s(双向皆可):prev 对上"帧初姿态"、pos 对上"当前姿态"求符号变化求交点,
//   再判断交点到盾心的距离 < R。这样移动/转向中的伞面不会漏掉本帧穿过的子弹。命中则把交点写入 out 并返回 true。
// segment prev→pos through shield s, either direction. Swept: prev is measured against the shield's pose at the
// start of the frame and pos against its pose now, so a canopy moving / turning onto a shot can't skip past it.
function segShield(prev, pos, s, out) {
  const a = _v3.copy(prev).sub(s.Cp).dot(s.Np), b = _v3.copy(pos).sub(s.C).dot(s.N);
  if ((a > 0) === (b > 0) || a === b) return false;
  out.lerpVectors(prev, pos, a / (a - b));
  return out.distanceToSquared(s.C) < s.R * s.R;
}
// 统一取"耐久/闪白/抖动/音效计时"所在对象:手持盾在 runner.kit,发射盾在它自己的记录 c。
// hp / flash / sound state: the runner's kit for a held canopy, the canopy record for a launched one
function hpOf(s) { return s.held ? s.kit : s.ref; }
// 伞面受击:扣耐久、累计闪白/抖动、在近镜头时溅墨与播音效(有 0.07s 节流),扣到 0 则破碎。dmg 非正或已碎则忽略。
function hitShield(s, at, dmg, color, from) {
  const o = hpOf(s);
  if (o.hp <= 0 || !(dmg > 0)) return;
  o.hp -= dmg; o.lastHit = G.time; STATS.blocked++; STATS.blockedDmg += dmg;
  o.flash = Math.min(1, (o.flash || 0) + 0.3 + dmg / 140);
  o.shake = Math.min(1, (o.shake || 0) + 0.25 + dmg / 120);
  const nearCam = G.camera && G.camera.position.distanceToSquared(at) < 26 * 26;
  if (nearCam) {
    // ink splashing off the canopy (toward the side it came from)
    // 【溅向】把溅墨方向 n 取为盾面法线;若来袭点 from 在盾的另一侧,则翻转,保证墨朝来弹那侧溅。
    _n.copy(s.N); if (from && _v2.copy(from).sub(s.C).dot(s.N) < 0) _n.negate();
    G.fx?.burst(at, _n, color, { count: dmg > 40 ? 9 : 4, speed: dmg > 40 ? 3.4 : 2.4, size: dmg > 40 ? 0.085 : 0.065 });
    if (G.time - (o.sndT || -9) > 0.07) {
      o.sndT = G.time;
      const local = s.owner && s.owner.isLocal && s.held;
      G.audio?.play('brolly_hit', { pos: local ? undefined : at, volume: clamp(0.35 + dmg / 90, 0.35, 0.9) * (local ? 0.8 : 0.65), pitch: dmg > 60 ? 0.8 : 1 });
    }
  }
  if (s.held && s.owner?.isLocal) rumble(s.owner, 0.05 + Math.min(0.3, dmg / 300), 0.12, 50);
  if (o.hp <= 0) breakShield(s);
}
// 伞面破碎:置 0 血、近镜头时爆墨/白花/冲击环与音效。手持盾→进入 broken 并开始再生计时;
//   发射盾→标记 alive=false(交给 updateLaunched 走消散动画)。最后 emit brolly:break。
function breakShield(s) {
  const o = hpOf(s), w = W();
  o.hp = 0; STATS.breaks++;
  const col = G.teamColors?.[s.team] || s.owner?.color;
  if (G.camera && G.camera.position.distanceToSquared(s.C) < 40 * 40) {
    G.fx?.burst(s.C, s.N, col, { count: 22, speed: 5.2, size: 0.11, spread: 1.6 });
    G.fx?.burst(s.C, _n.copy(s.N).negate(), new THREE.Color('#f4efe4'), { count: 10, speed: 3.5, size: 0.08, spread: 1.4 });
    G.fx?.ring?.(s.C, s.N, col, { radius: RIM_R * 1.2, life: 0.3, snap: false });
    G.audio?.play('brolly_break', { pos: s.held && s.owner?.isLocal ? undefined : s.C, volume: 0.85 });
  }
  if (s.held) {
    const k = s.kit;
    k.state = 'broken'; k.regrowT = w.regrowTime; k.regrowK = 0; k.open = 0; k.grow = 0; k.openT = 0; k.lockRelease = true;
    if (s.owner?.isLocal) { rumble(s.owner, 0.45, 0.4, 160); emit('shake', { amount: 0.25 }); }
  } else o.alive = false;
  emit('brolly:break', { actor: s.owner, pos: s.C.clone(), team: s.team, launched: !s.held });
}

// 某弹丸打在伞面上造成多少伤害:本武器自己的弹丸按距离衰减;其余取 p.damage(部分弹种按距离插值),再乘弹种系数。
// damage a projectile deals to a canopy
function projDamage(p) {
  if (p._bid && p.weaponId === 'brolly') return pelletDamage(p.start.distanceTo(p.pos));
  let d = p.damage || 10;
  if (p.type === 'drop') d = lerp(p.damage || 10, p.dmgFar ?? p.damage ?? 10, clamp(p.start.distanceTo(p.pos) / 7, 0, 1));
  return d * (CANOPY_MUL[p.type] ?? 1);
}
// 【弹道预演】复刻 Projectiles.update 下一帧的积分(重力/阻力),算出 p 在 dt 后的位置写入 out——
//   让本 kit 能在核心真正推进弹丸之前就判定是否撞伞(因此子弹不会钻缝)。g 表示已过直飞段(受重力)。
// where a core projectile will be after this frame's step (the exact integrator Projectiles.update runs next)
function predict(p, dt, out) {
  const age = p.age + dt, g = age > p.straight;
  let vx = p.vel.x, vy = p.vel.y, vz = p.vel.z;
  if (g) vy -= p.grav * dt;
  if (p.drag) { const f = 1 - p.drag * dt * (g ? 1 : 0); vx *= f; vy *= f; vz *= f; }
  return out.set(p.pos.x + vx * dt, p.pos.y + vy * dt, p.pos.z + vz * dt);
}

// 【发射伞区】把张紧的伞面脱手贴地滑行成"墙":自带涂墨、挡敌弹、拦敌玩家;寿命到或被打散后消散。
// ---------------------------------------------------------------------------------------------- launched canopy
// 发射:以角色前方 0.9m 处向下的射线找落点,生成发射盾(耐久至少留半),广播 netRec,并让 runner 进入 launched 状态。
function launch(r, k, w) {
  const a = r.a;
  const yaw = a.aimYaw, dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  // start where the held canopy was, settle onto the ground just ahead
  const g = G.physics.raycast(_v.set(a.pos.x + dir.x * 0.9, a.pos.y + 1.2, a.pos.z + dir.z * 0.9), DOWN, 3.5, _hit, true);
  const pos = g.hit ? g.point.clone() : new THREE.Vector3(a.pos.x + dir.x * 0.9, a.pos.y, a.pos.z + dir.z * 0.9);
  const hp = Math.max(k.hp, w.canopyHp * 0.5), h0 = a.pos.y + (a.smoothY || 0) + HELD.up - pos.y;
  addLaunched(a, pos, dir, hp, h0, false);
  netRec(a, 'brolly', [r2(pos.x), r2(pos.y), r2(pos.z), r3(dir.x), r3(dir.z), Math.round(hp), r2(h0)]);
  STATS.launches++;
  k.state = 'launched'; k.regrowT = w.regrowTime; k.regrowK = 0; k.open = 0; k.grow = 0; k.openT = 0; k.launchK = 0; k.lockRelease = true;
  sound(a, 'brolly_launch', 0.8);
  if (a.isLocal) emit('recoil', { amount: 0.008 });
  rumble(a, 0.3, 0.35, 120);
  emit('brolly:launch', { actor: a, pos: pos.clone(), dir: dir.clone() });
}
// 生成一个发射盾世界对象并建网格;ghost=true 表示是远端玩家的复刻(会滑行、挡弹、拦人,但绝不涂墨,墨线由 owner 端发)。
// a launched canopy in the world. ghost: a remote player's (online) — it slides, blocks shots and holds players back
// like the owner's (solid on every screen), but never paints (its stripe is the owner's to send)
function addLaunched(a, pos, dir, hp, h0, ghost) {
  const w = W();
  const c = {
    held: false, alive: true, owner: a, team: a.team, pos: pos.clone(), dir: dir.clone(), t: 0, life: w.launchLife, hp, hpMax: w.canopyHp,
    vy: 0, paintAcc: 0, shoving: false, h0, flash: 0, shake: 0, sndT: -9, fxT: 0, ghost,
    sh: null, mesh: null, mats: null,
  };
  c.sh = { held: false, kit: null, ref: c, owner: a, team: a.team, C: new THREE.Vector3(), N: c.dir.clone(), R: LAUNCH_R, Cp: new THREE.Vector3(), Np: c.dir.clone(), prev: false };
  buildLaunchedMesh(c);
  LAUNCHED.push(c);
  if (ghost) sound(a, 'brolly_launch', 0.8);
  return c;
}
// 为发射盾建网格:用 canopyOpenGeo() 的墨面/白面/中枢三份几何 + makeFabric 织物材质,朝 dir 摆放后挂进场景。
function buildLaunchedMesh(c) {
  const geo = canopyOpenGeo();
  const col = G.teamColors?.[c.team] || c.owner.color;
  const ink = makeFabric(col, true), cream = makeFabric(new THREE.Color(1, 1, 1), false);
  ink.transparent = cream.transparent = true;
  const root = new THREE.Group(), inner = new THREE.Group();
  const mi = new THREE.Mesh(geo.ink, ink), mc = new THREE.Mesh(geo.cream, cream), mh = new THREE.Mesh(geo.hub, getPlasticMaterial());
  for (const m of [mi, mc, mh]) { m.castShadow = true; inner.add(m); }
  root.add(inner);
  root.rotation.y = Math.atan2(c.dir.x, c.dir.z);
  G.scene?.add(root);
  c.mesh = root; c.inner = inner; c.mats = [ink, cream];
}
// 卸载发射盾:从场景移除网格并 dispose 材质。
function disposeLaunched(c) {
  if (c.mesh) { c.mesh.parent?.remove(c.mesh); for (const m of c.mats) m.dispose(); }
  c.mesh = null;
}
// 推进一个发射盾:寿命到/被打散→淡出消散;存活则贴地滑行(撞墙停、推敌变慢、遇落差/海水坠落)、沿途按宽度涂墨;
//   最后更新阻挡盾的 C/N 与网格姿态/闪白/低血闪烁/行进喷墨。返回 false 表示应被移除。
function updateLaunched(c, dt) {
  c.t += dt;
  const w = W();
  if (c.alive && c.t >= c.life) c.alive = false;
  if (!c.alive) {
    // fade out (or collapse, when shot apart)
    c.fade = (c.fade || 0) + dt / (c.hp <= 0 ? 0.18 : 0.45);
    if (c.fade >= 1) { disposeLaunched(c); return false; }
  } else {
    // slide: stop at walls; ease off while shoving an enemy
    const sp = w.launchSpeed * (c.shoving ? 0.6 : 1) * Math.min(1, 0.35 + c.t * 3);
    c.shoving = false;
    const step = sp * dt;
    let blocked = false;
    for (const hgt of [0.3, 1.0]) {
      _v.copy(c.pos); _v.y += hgt;
      if (G.physics.raycast(_v, c.dir, 0.12 + step, _hit, true).hit) { blocked = true; break; }
    }
    if (!blocked) {
      c.pos.addScaledVector(c.dir, step);
      // ground: step up small lips, follow slopes down, fall off edges (and into the sea)
      const g = G.physics.raycast(_v.set(c.pos.x, c.pos.y + 0.6, c.pos.z), DOWN, 1.5, _hit, true);
      if (g.hit && g.point.y > c.pos.y - 0.12 - Math.max(0, -c.vy) * dt - 0.02 && c.vy <= 0.01) { c.pos.y = g.point.y; c.vy = 0; }
      else { c.vy -= 24 * dt; c.pos.y += c.vy * dt; if (g.hit && c.pos.y < g.point.y) { c.pos.y = g.point.y; c.vy = 0; } }
      if (c.pos.y < PLAYER.waterY - 0.4) { c.alive = false; c.hp = 0; }
      // ink the ground under it: a stripe the canopy's width
      c.paintAcc += step;
      if (c.paintAcc >= 0.32 && c.vy === 0) {
        c.paintAcc = 0;
        _v.set(c.pos.x, c.pos.y + 0.3, c.pos.z);
        const area = G.paint.splat(_v, w.launchPaint, c.team, { seed: Math.random(), kind: 'roll', stretch: c.dir });
        const o = c.owner; if (o) { if (o.specialActive) o.addTurfNoSpecial(area); else o.addTurf(area); }
      }
    }
  }
  // blocking shield (crown ahead, plane at mid-depth)
  const hNow = LAUNCH_H + (c.h0 - LAUNCH_H) * Math.max(0, 1 - c.t / 0.22);
  c.sh.C.set(c.pos.x, c.pos.y + hNow, c.pos.z).addScaledVector(c.dir, -DEPTH * 0.5);
  c.sh.N.copy(c.dir);
  // mesh
  if (c.mesh) {
    c.flash = Math.max(0, c.flash - dt * 6); c.shake *= Math.exp(-dt * 12);
    const fade = c.alive ? 0 : c.fade || 0, k = 1 - fade;
    c.mesh.position.set(c.pos.x, c.pos.y, c.pos.z);
    c.inner.position.set(0, hNow + 0.012 * Math.sin(c.t * 11), 0);
    c.inner.rotation.set(-0.08 * c.shake, 0, 0.035 * Math.sin(c.t * 7.3));
    const s = c.hp <= 0 ? 1 + 0.4 * fade : 1 - 0.25 * fade;
    c.inner.scale.set(s, s, c.hp <= 0 ? Math.max(0.05, 1 - fade) : s);
    const col = G.teamColors?.[c.team] || c.owner.color;
    const low = c.hp / c.hpMax < 0.25 && Math.sin(c.t * 37) * Math.sin(c.t * 23.3) > 0.2 ? 0.35 : 0;
    c.mats[0].emissive.copy(col).multiplyScalar(0.5 * c.flash + low);
    c.mats[1].emissive.setRGB(1, 1, 1).multiplyScalar(0.45 * c.flash + low * 0.6);
    for (const m of c.mats) m.opacity = k;
    // a spray of ink kicked up at the leading edge
    c.fxT -= dt;
    if (c.alive && c.fxT <= 0 && G.camera && G.camera.position.distanceToSquared(c.pos) < 28 * 28) {
      c.fxT = 0.22;
      G.fx?.burst(_v.copy(c.pos).addScaledVector(c.dir, 0.05), _v2.copy(c.dir).setY(0.8).normalize(), col, { count: 3, speed: 1.8, size: 0.05, sheet: false });
    }
  }
  return true;
}
// 发射盾拦敌:把范围内的敌方玩家推回其所在侧(沿盾宽 ±LAUNCH_R 内、越过阻挡平面则滑回),并抵消其法向速度;队友可穿过。
// enemy players can't pass a launched canopy: push them back out to the side they're on (allies walk through)
function blockActors(c) {
  if (!c.alive) return;
  const N = c.dir, tx = -N.z, tz = N.x, rr = PLAYER.radius + 0.18;
  for (const e of G.actors || []) {
    if (!e.alive || e.team === c.team) continue;
    const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z, dy = e.pos.y - c.pos.y;
    if (dy < -1.2 || dy > 1.6) continue;
    const along = dx * tx + dz * tz;
    if (Math.abs(along) > LAUNCH_R + PLAYER.radius * 0.6) continue;
    const across = dx * N.x + dz * N.z + DEPTH * 0.5;   // from the blocking plane
    if (Math.abs(across) >= rr) continue;
    const side = across >= 0 ? 1 : -1, push = side * rr - across;
    e.pos.x += N.x * push; e.pos.z += N.z * push;
    const vn = e.vel.x * N.x + e.vel.z * N.z;
    if (vn * side < 0) { e.vel.x -= N.x * vn; e.vel.z -= N.z * vn; }
    if (side > 0) c.shoving = true;   // shoving someone along slows it (next frame)
  }
}

// 【世界每帧区】tick(dt) 是主循环每帧调用的总入口,顺序不可乱:
//   ① 先跑 runner 侧计时(再生/张开衰减,即使被大招接管身体也要跑);② 先移动发射盾(本帧盾位要就位);
//   ③ 刷新盾表;④ 弹丸下一步 vs 盾(挡弹);⑤ 本 kit 的弹丸 vs 敌身(同帧合并成一次命中);⑥ 结算 PEND;⑦ 发射盾拦人。
//   PEND 是"同 blast 同目标合并"的暂存表,key 用 blast 号+目标槽位,MERGE(1/30s)是合并窗口。
// ---------------------------------------------------------------------------------------------- per-frame (world)
const PEND = new Map(), LIVE = new Set(), MERGE = 1 / 30;
function tick(dt) {
  const w = W();
  // runner-side timers (run even while a special owns the body / the runner is idle)
  for (const a of G.actors || []) {
    if (a.weapon?.kind !== 'brolly') continue;
    const r = a.weaponRunner, k = r?.kit;
    if (!k || !k.brolly) continue;
    if (G.time - k.lastUpd > 0.1 || !a.alive || a.form !== 'kid') { k.want = false; k.open = Math.max(0, k.open - dt / w.closeTime); k.openT = 0; }
    if (k.state !== 'ready') {
      k.regrowT -= dt; k.regrowK = clamp(1 - k.regrowT / w.regrowTime, 0, 1);
      if (k.regrowT <= 0) {
        k.state = 'ready'; k.hp = k.hpMax; k.grow = 0.001; k.regrowK = 1;
        if (a.alive) {
          sound(a, 'brolly_regrow', 0.6);
          if (a._nearCamera() || a.isLocal) { a.character.getMuzzle?.(_v); G.fx?.burst(_v, UP, a.color, { count: 6, speed: 1.6, size: 0.05, sheet: false }); }
        }
      }
    } else {
      if (k.grow < 1) k.grow = Math.min(1, k.grow + dt / 0.32);
      if (k.open <= 0 && G.time - k.lastHit > w.canopyRegenDelay) k.hp = Math.min(k.hpMax, k.hp + w.canopyRegen * dt);
    }
    k.flash = Math.max(0, k.flash - dt * 6); k.shake *= Math.exp(-dt * 12);
  }
  // launched canopies move first (their shields must be where they are this frame)
  const nm = G.netm;
  for (let i = LAUNCHED.length - 1; i >= 0; i--) {
    const c = LAUNCHED[i], gm = c.ghost && nm;   // (a ghost canopy's stripe is its owner's to send)
    if (gm) nm.mute++;
    let keep = true;
    // 【回放静音】ghost 伞在推进期间 mute 涂墨(避免远端复制品重复计分),用 try/finally 保证计数还原。
    try { keep = updateLaunched(c, dt); } finally { if (gm) nm.mute--; }
    if (!keep) LAUNCHED.splice(i, 1);
  }
  refreshShields();
  // 1) 每颗弹丸的"下一帧位置线段" vs 每个敌方伞面:命中则让弹丸止于伞面(在它身后的人体之前),结算伤害并移除。
  // 1) every projectile's next step vs every enemy canopy: blocked shots end on the canopy (before the body behind it)
  const PJ = G.projectiles, list = PJ.list;
  if (SH.length) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (!p.owner || (p.delay > 0 && p.delay - dt > 0)) continue;
      predict(p, dt, _v);
      for (const s of SH) {
        if (s.team === p.team) continue;
        if (!segShield(p.pos, _v, s, _x)) continue;
        hitShield(s, _x, projDamage(p), p.owner.color, p.pos);
        if (p._bid > 0) p._bid = -p._bid;
        PJ.removeShot(p);
        break;
      }
    }
  }
  // 2) 本 kit 的弹丸 vs 敌身:每个受害者在 MERGE 窗口内的一整串弹丸合并为一次伤害(单数字/单声音)。
  //    LIVE 是存活弹丸集合;_bid 被取负表示"已被本 kit 计分",同一帧核心 pass 会真正结束它。
  // 2) this kit's pellets vs enemy bodies: one summed hit per victim per frame. A pellet that is no longer in the
  // live list died last frame (wall, canopy, curtain …); one that scores here dies in the core pass right after.
  if (PELLETS.length) { LIVE.clear(); for (const p of list) if (p._bid > 0) LIVE.add(p); }
  for (let i = PELLETS.length - 1; i >= 0; i--) {
    const e = PELLETS[i], p = e.p;
    if (p._bid !== e.id || !LIVE.has(p)) { PELLETS[i] = PELLETS[PELLETS.length - 1]; PELLETS.pop(); continue; }
    predict(p, dt, _v);
    // Boss Battle: pellets into HULLBREAKER / a crablet add up per blast the same way (one hit; the core pass ends
    // the pellet there)
    if (G.boss) {
      const bh = G.boss.segHit(p.pos, _v, p.size);
      if (bh) {
        const key = e.blast * 64 + 63;
        let rec = PEND.get(key);
        if (!rec) PEND.set(key, (rec = { owner: e.owner, boss: bh.target, point: bh.point.clone(), dmg: 0, n: 0, at: G.time + MERGE }));
        rec.dmg += pelletDamage(p.start.distanceTo(bh.point)); rec.n++;
        p._bid = -p._bid;
        continue;
      }
    }
    for (const v of G.actors || []) {
      if (v.team === p.team || !v.alive) continue;
      const h = v.hitH || (v.form === 'squid' ? PLAYER.squidHeight : PLAYER.height), hr = v.hitR || PLAYER.radius;
      if (Math.abs(v.pos.x - _v.x) > 3 + hr || Math.abs(v.pos.z - _v.z) > 3 + hr) continue;
      Physics.segmentCapsuleDist(p.pos, _v, _hb.set(v.pos.x, v.pos.y + (v.smoothY || 0), v.pos.z), hr, h, _res);
      if (_res.dist < hr * 0.95 + p.size) {
        _x.lerpVectors(p.pos, _v, _res.t);
        // 【合并键】同 blast(blast 号×64)+ 受害者槽位(角色索引 & 63),把同帧多弹并成一条 PEND 记录。
        // pellets of one blast reaching the same body within MERGE s land as one hit
        const key = e.blast * 64 + (G.actors.indexOf(v) & 63);
        let rec = PEND.get(key);
        if (!rec) PEND.set(key, (rec = { owner: e.owner, victim: v, dmg: 0, n: 0, at: G.time + MERGE }));
        rec.dmg += pelletDamage(p.start.distanceTo(_x)); rec.n++;
        p._bid = -p._bid;   // scored: never counted again (the core pass ends it on the same body this frame)
        break;
      }
    }
  }
  for (const [key, rec] of PEND) {
    if (G.time < rec.at - 1e-6) continue;
    PEND.delete(key);
    if (rec.boss) G.boss?.hit(rec.owner, rec.dmg, rec.boss, 'brolly', rec.point); else PJ.applyHit(rec.owner, rec.victim, rec.dmg, 'brolly');
  }
  snapShields();
  // 3) launched canopies hold enemy players back
  for (const c of LAUNCHED) blockActors(c);
}

// 比赛重置/切图:卸载所有发射盾并清空弹丸、盾表、合并暂存。
function clearAll() {
  for (const c of LAUNCHED) disposeLaunched(c);
  LAUNCHED.length = 0; PELLETS.length = 0; SH.length = 0; PEND.clear();
}

// 【挡弹 hook 区】供核心(非本 kit 弹道)调用:blockShot 判线段 vs 伞,blockRay 判射线 vs 伞(光柱类)。
// ---------------------------------------------------------------------------------------------- blocking hooks
// 线段(prev→pos)撞敌方伞面则结算伤害并返回 true(该发子弹被挡下)。
function blockShot(prev, pos, team, dmg) {
  if (SH_T !== G.time) refreshShields();
  if (!SH.length) return false;
  for (const s of SH) {
    if (s.team === team) continue;
    if (!segShield(prev, pos, s, _x)) continue;
    hitShield(s, _x, dmg, G.teamColors?.[team] || s.owner.color, prev);
    return true;
  }
  return false;
}
// 射线(from,dir,len)撞敌方伞面:取最近交点结算伤害,返回截断后的距离(未命中返回原 len)。
function blockRay(from, dir, len, team, dmg) {
  if (SH_T !== G.time) refreshShields();
  if (!SH.length) return len;
  let best = len, hit = null;
  for (const s of SH) {
    if (s.team === team) continue;
    const dn = dir.dot(s.N);
    if (Math.abs(dn) < 1e-4) continue;
    const t = _v.copy(s.C).sub(from).dot(s.N) / dn;
    if (t <= 0 || t >= best) continue;
    _v2.copy(from).addScaledVector(dir, t);
    if (_v2.distanceToSquared(s.C) > s.R * s.R) continue;
    best = t; hit = s;
  }
  if (hit) hitShield(hit, _x.copy(from).addScaledVector(dir, best), dmg, G.teamColors?.[team] || hit.owner.color, from);
  return best;
}
// 炸弹爆炸事件:① 被己方伞面遮住的玩家获得一帧无敌(伞替他们吃这次伤害;因为 kit 没有逐玩家伤害过滤 hook);
//   ② 半径内所有伞面按距离受创(近处最多 ~180,远处 ~35)。
// bomb blasts: canopies between the blast and players on their team take it for them (a guard for the damage loop
// that follows this event), and every canopy in the radius is ripped into
on('bomb:explode', (e) => {
  if (!e || !e.pos || !G.actors) return;
  const R = e.radius || 3;
  refreshShields();
  if (!SH.length) return;
  for (const v of G.actors) {
    if (!v.alive || v.team === e.team) continue;
    _v.set(v.pos.x, v.pos.y + (v.smoothY || 0) + 0.7, v.pos.z);
    if (_v.distanceTo(e.pos) > R + 0.6) continue;
    for (const s of SH) if (s.team === v.team && segShield(e.pos, _v, s, _x)) { v.invuln = Math.max(v.invuln, 1e-4); STATS.guarded++; break; }
  }
  for (const s of SH.slice()) {
    if (s.team === e.team) continue;
    const d = Math.max(0, e.pos.distanceTo(s.C) - s.R * 0.5);
    if (d > R) continue;
    const k = 1 - clamp((d - 0.8) / Math.max(0.1, R - 0.8), 0, 1);
    hitShield(s, s.C, lerp(35, 180, k * k), G.teamColors?.[e.team] || new THREE.Color(1, 1, 1), e.pos);
  }
});

// 【bot 区】伞枪 bot 的战术:挨打或被远处长枪瞄准时张伞/发射伞面,并躲在发射后的伞墙后推进。
// ---------------------------------------------------------------------------------------------- bots
// 找出正在瞄准本 bot 的敌方蓄力/远程武器(charging/firingT/streaming/burstT 命中且方向大致朝向),作为张伞动机。
// an enemy charger / long-range weapon lining up on this bot
function lineThreat(a) {
  for (const e of G.actors || []) {
    if (e.team === a.team || !e.alive) continue;
    const kind = e.weapon?.kind, KB = MAIN_KITS[kind]?.bot;
    if (!(CHARGES[kind] || LONG[kind] || KB?.long || KB?.charges)) continue;
    const r = e.weaponRunner; if (!r || !(r.charging || r.firingT > 0 || r.streaming || r.burstT > 0)) continue;
    const dx = a.pos.x - e.pos.x, dy = a.pos.y + 0.8 - (e.pos.y + 1.1), dz = a.pos.z - e.pos.z, d = Math.hypot(dx, dy, dz);
    if (d > weaponRange(e.weapon) + 3 || d < 1) continue;
    if ((e.aimDir.x * dx + e.aimDir.y * dy + e.aimDir.z * dz) / d < Math.cos(0.14)) continue;
    return e;
  }
  return null;
}
// 伞枪 bot:状态机式 bb{holdUntil,nextShield,launch,advanceUntil};fight 返回是否扣扳机,paint 返回是否在补墨时开火。
const bot = {
  paintPitch: -0.36,
  // 战斗决策:按概率决定张伞(或斜向远方发射),张伞期间点按变慢并持续开火,发射后跟随伞墙前进。
  fight(brain, ctx) {
    const { a, w, dist, range, dt, move, target } = ctx;
    const k = kitOf(a.weaponRunner);
    const bb = brain._brolly || (brain._brolly = { holdUntil: 0, nextShield: 0, launch: false, advanceUntil: 0 });
    // open the canopy when taking fire, or when a long-range weapon is lining up from roughly ahead
    if (k.state === 'ready' && k.grow > 0.9 && bb.holdUntil <= G.time && G.time >= bb.nextShield && dist < 18) {
      const thr = lineThreat(a);
      const ahead = thr && Math.abs(angleDiff(a.aimYaw, Math.atan2(thr.pos.x - a.pos.x, thr.pos.z - a.pos.z))) < 0.9;
      const hurt = a.lastDamage < 0.45 && a.lastAttacker && a.lastAttacker.alive && Math.abs(angleDiff(a.aimYaw, Math.atan2(a.lastAttacker.pos.x - a.pos.x, a.lastAttacker.pos.z - a.pos.z))) < 1.0;
      const disc = brain.diff?.fireDiscipline ?? 0.8;
      if ((ahead && Math.random() < 0.35 * dt * 60 * disc) || (hurt && Math.random() < 0.2 * dt * 60 * disc)) {
        let allies = 0;
        for (const o of G.actors) if (o !== a && o.alive && o.team === a.team && o.pos.distanceToSquared(a.pos) < 49) allies++;
        const launchIt = dist > 4 && dist < 14 && (allies > 0 || ahead) && Math.random() < (allies > 0 ? 0.45 : 0.2);
        const hold = launchIt ? w.openDelay + w.openTime + w.launchHold + 0.12 : 0.5 + Math.random() * 0.3;
        bb.holdUntil = G.time + hold; bb.launch = launchIt;
        bb.nextShield = G.time + hold + 0.9 + Math.random() * 1.4;
        if (launchIt) bb.advanceUntil = G.time + hold + 2.2;
      }
    }
    if (bb.holdUntil > G.time && k.state === 'ready') {
      if (!bb.launch) move.multiplyScalar(0.4);   // plant behind the canopy (it slows you anyway)
      return true;
    }
    if (bb.holdUntil > G.time) bb.holdUntil = 0;   // broke / launched mid-hold
    // advance behind the canopy we just launched (it slides toward the target)
    if (bb.advanceUntil > G.time && k.state === 'launched') {
      const own = LAUNCHED.find((c) => c.owner === a && c.alive);
      if (own) {
        const bx = own.pos.x - own.dir.x * 1.3 - a.pos.x, bz = own.pos.z - own.dir.z * 1.3 - a.pos.z, bl = Math.hypot(bx, bz);
        if (bl > 0.4) move.set(bx / bl, 0, bz / bl); else move.set(own.dir.x * 0.5, 0, own.dir.z * 0.5);
      }
    }
    return dist < range * 1.1;
  },
  // 涂墨阶段:需要涂且墨量足够时开火(伞枪主要用途之一是铺墨)。
  paint(brain, ctx) {
    brain._brolly || (brain._brolly = { holdUntil: 0, nextShield: 0, launch: false, advanceUntil: 0 });
    return ctx.needPaint && ctx.inkFrac > 0.2;
  },
};

// 【查询 hook 区】shields(out) 给 bots 用:让它们绕开发射伞墙、包抄手持伞;描述子稳定、getter 读实时状态,只读不改行为。
// ---------------------------------------------------------------------------------------------- query hook
// Bots (bots.js) route round enemy launched canopies and flank held ones: one stable descriptor per shield, getters read
// its live state (see kits/registry.js `shields`). Read-only: nothing here changes how a canopy behaves.
// 为一个盾构造(并缓存)描述子:含 kind/held/owner/C/N/R/hpMax/blocksActors,以及发射盾的 pos/halfW/planeOff/speed;
//   team/hp/live/left 用 getter 实时反映。
function shieldOf(s) {
  if (s.info) return s.info;
  const w = W(), c = s.ref;
  s.info = {
    kind: 'brolly', held: s.held, owner: s.owner, C: s.C, N: s.N, R: s.R, hpMax: w.canopyHp, blocksActors: !s.held,
    // launched: foot position (N = its travel direction), half-width it blocks players over, and the blocking plane's
    // offset along N from pos (enemy players are held on their side of it)
    pos: s.held ? null : c.pos, halfW: LAUNCH_R, planeOff: -DEPTH * 0.5, speed: s.held ? 0 : w.launchSpeed,
    get team() { return s.team; },
    get hp() { return Math.max(0, hpOf(s).hp); },
    get live() {
      if (!s.held) return c.alive;
      const a = s.owner, k = s.kit;
      return !!a && a.alive && a.form === 'kid' && a.weaponRunner?.kit === k && k.state === 'ready' && k.open >= 0.55 && k.grow >= 0.9;
    },
    get left() { return s.held ? 0 : Math.max(0, c.life - c.t); },   // launched: seconds until it fades
  };
  return s.info;
}
// shields hook:确保本帧盾表最新,把所有活跃盾的描述子推进 out 并返回。
function shields(out) {
  if (SH_T !== G.time) refreshShields();
  for (const s of SH) out.push(shieldOf(s));
  return out;
}

// 【注册与联机区】把本 kit 挂进 MAIN_KITS,并注册模型;联机侧:netState/netApply 打包/还原 runner 状态,
//   launch 广播后由 ghost() 在他人屏幕重建发射伞。
// ---------------------------------------------------------------------------------------------- registration
// ---------------------------------------------------------------------------------------------- online
// A remote Brolly kid: netState packs its canopy (state 0 ready · 1 broken · 2 launched in bits 0–1, open 0–15 bits 2–5,
// grow 0–7 bits 6–8, hp 0–31 bits 9–13, regrow 0–7 bits 14–16) → netApply rebuilds runner.kit, so its held canopy is
// drawn AND blocks the local player's shots here (refreshShields reads every actor's kit). A launch → ghost: a solid
// sliding canopy (see addLaunched).
// 状态名 ↔ 2bit 编码的映射表。
const STATE_N = { ready: 0, broken: 1, launched: 2 }, STATE_OF = ['ready', 'broken', 'launched'];
// 【位打包】把伞面状态压进一个 int:state(bit0-1)、open(bit2-5)、grow(bit6-8)、hp/hpMax(bit9-13)、regrowK(bit14-16)。
//   量化辅助 q 把 0..1 映射到 0..n。无 kit 返回 0。
function netState(r) {
  const k = r.kit && r.kit.brolly ? r.kit : null;
  if (!k) return 0;
  const q = (v, n) => Math.max(0, Math.min(n, Math.round(clamp(v, 0, 1) * n)));
  return (STATE_N[k.state] ?? 0) | (q(k.open, 15) << 2) | (q(k.grow, 7) << 6) | (q(k.hp / k.hpMax, 31) << 9) | (q(k.regrowK || 0, 7) << 14);
}
// 【位解包】从位串 b 还原 runner.kit 的 state/hp/open/grow/regrowK;远端血比本地低时触发受击闪白/抖动,
//   让本地看到的伞面反应与 owner 端一致。还原出的 kit 让本机的 refreshShields 也能看到这把伞(会被本地子弹挡下)。
function netApply(r, b) {
  const k = kitOf(r);
  const st = STATE_OF[b & 3] || 'ready';
  const hp = (((b >> 9) & 31) / 31) * k.hpMax;
  if (hp < k.hp - 1) { k.flash = Math.min(1, (k.flash || 0) + 0.4); k.shake = Math.min(1, (k.shake || 0) + 0.3); }   // hit on the owner's screen
  k.state = st; k.hp = hp;
  k.open = ((b >> 2) & 15) / 15; k.grow = ((b >> 6) & 7) / 7; k.regrowK = ((b >> 14) & 7) / 7;
}
// ghost hook:收到远端 launch 的短数据数组,重建一个 ghost 发射伞(纯视觉+实心挡弹,不涂墨)。
function ghost(a, d) {
  if (!Array.isArray(d)) return;
  addLaunched(a, _gp.set(d[0], d[1], d[2]), _gd.set(d[3], 0, d[4]).normalize(), d[5], d[6], true);
}
const _gp = new THREE.Vector3(), _gd = new THREE.Vector3();
// 量化辅助:r2 保留两位小数(位置)、r3 保留三位(方向),用于 netRec 的短数据数组。
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;

// 【自注册】把全部 hook 挂进主武器表;busy 恒 false(伞不占用"忙"位),firingPose/moveSpeed 视张开度。
MAIN_KITS.brolly = {
  netState,
  netApply,
  ghost,
  update,
  busy: () => false,
  firingPose: (r) => !!(r.kit && r.kit.brolly && r.kit.open > 0),
  moveSpeed: (r, w) => (r.kit && r.kit.brolly && r.kit.open > 0.2 ? w.moveSpeedShield : 0),
  spreadDeg: (r, w) => (r.a.grounded ? w.spreadDeg : w.spreadAir),
  tick, clear: clearAll, blockShot, blockRay, shields,
  bot,
  // test / tooling access
  _state: { LAUNCHED, PELLETS, SH, STATS, refreshShields, pelletDamage, kitOf },
};
// 注册武器模型:模型构建器 brollyDef + 每帧动画 animateBrolly(均来自 brolly-model.js)。
registerWeaponModel('brolly', brollyDef, animateBrolly);

// 【图标】HUD/装配界面内联 SVG:一把朝右上倾的开伞,墨/白交替伞面 + J 形握把 + 枪口飞出的弹丸。
// ---------------------------------------------------------------------------------------------- icon
{
  const K = '#15121c', DK = '#2b2735', LT = '#e4e8ef';
  const O = `stroke="${K}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
  // an open brolly tipped toward the upper right, alternating ink / white panels, J handle, pellets flying off the tip
  WEAPON_ICONS.brolly = `<svg class="iw-ico " viewBox="0 0 64 64" aria-hidden="true"><g transform="translate(31 33) scale(1.14) rotate(30) translate(-30 -33)">
    <g ${O}>
      <path d="M30 34 L30 52 Q30 58.5 24.5 58.5 Q19.5 58.5 19.5 53.5" fill="none" stroke-width="7.5"/>
      <path d="M8 31 Q8 11 30 10 Q52 11 52 31 Q46.5 26.5 41 31 Q35.5 26.5 30 31 Q24.5 26.5 19 31 Q13.5 26.5 8 31 Z" fill="${LT}"/>
    </g>
    <path d="M30 34 L30 52 Q30 58.5 24.5 58.5 Q19.5 58.5 19.5 53.5" fill="none" stroke="#c08a58" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M30 11.5 Q20 15 19 29.6 Q24.5 27 30 30.6 Z" fill="currentColor"/>
    <path d="M30 11.5 Q46 13 50.5 29.2 Q46.5 26.8 41 30.6 Q39 16 30 11.5 Z" fill="currentColor"/>
    <g ${O}><path d="M8 31 Q8 11 30 10 Q52 11 52 31 Q46.5 26.5 41 31 Q35.5 26.5 30 31 Q24.5 26.5 19 31 Q13.5 26.5 8 31 Z" fill="none"/>
      <path d="M30 10.5 Q20 15 19 30 M30 10.5 Q39 16 41 30.5 M30 10.5 L30 30.5" fill="none" stroke-width="2.2"/>
      <rect x="27" y="3.5" width="6" height="7.5" rx="2" fill="${DK}"/></g>
    <path d="M13.5 22 Q17 15 24 13" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.6" stroke-linecap="round"/>
  </g>
  <g ${O} stroke-width="2.4"><circle cx="54" cy="8.5" r="3.4" fill="currentColor"/><circle cx="60" cy="16.5" r="2.6" fill="currentColor"/><circle cx="47" cy="3.8" r="2.3" fill="currentColor"/></g></svg>`;
}

// 【音效】五条 SFX 配方(结构与 audio.js 的 def 一致:频率/增益/包络 + build(v,p) 合成);下面逐条中文对照。
// ---------------------------------------------------------------------------------------------- sounds
// (same shape as audio.js def(name, {…}); gain/max/jitter/reverb/minGap, build(v, p) with the voice helpers)
// 【开火音】阀栓"咔"+胸腔低频沉闷+粉噪爆破体+喷雾"psh"+湿溅,末尾 7 枚气泡模拟弹丸飞出。
SFX.brolly_blast = {
  gain: 0.62, max: 4, jitter: 0.04, reverb: 0.12,
  build(v, p) {
    v.nz({ ft: 'highpass', f: 3200, a: 0.0003, d: 0.012, peak: 0.7 });                                     // valve crack
    v.tone({ f: 175 * p, f1: 46 * p, sw: 0.12, a: 0.001, d: 0.2, peak: 1 });                                // chest thump
    v.nz({ kind: 'pink', ft: 'lowpass', f: 2800, f1: 480, sw: 0.14, q: 1.2, a: 0.001, d: 0.16, peak: 0.95 }); // blast body
    v.nz({ f: 2600 * p, f1: 850 * p, sw: 0.08, q: 2.2, a: 0.001, d: 0.09, peak: 0.65 });                    // spray "pshh"
    v.nz({ t: 0.006, f: 1300 * p, f1: 420 * p, sw: 0.08, q: 5, a: 0.003, d: 0.08, peak: 0.55 });             // wet splort
    for (let i = 0; i < 7; i++) v.bub(v.t + 0.02 + v.r(0, 0.08), v.r(900, 2100) * p, 0.13, v.r(0.012, 0.022), v.r(1.5, 2));   // pellets
    v.nz({ t: 0.03, ft: 'highpass', f: 4800, a: 0.01, d: 0.12, peak: 0.16 });
  },
};
// 【张伞音】织物带通扫过(380→2300Hz)+伞面兜风"fwump"+扣锁"咔"+伞骨轻鸣。
SFX.brolly_open = {
  gain: 0.42, max: 3, jitter: 0.04, reverb: 0.06, minGap: 0.05,
  build(v, p) {
    const T = v.t, g = v.gain(0, v.out), bp = v.filter('bandpass', 420 * p, 1.3, g);
    bp.frequency.setValueAtTime(380 * p, T); bp.frequency.exponentialRampToValueAtTime(2300 * p, T + 0.1);
    pts(g.gain, T, [[0, 0], [0.06, 0.75], [0.11, 0.35], [0.2, 0]]);
    v.noise('pink', T, T + 0.22, bp);                                                                     // fabric whoosh
    v.tone({ t: 0.095, f: 230 * p, f1: 120 * p, sw: 0.06, a: 0.001, d: 0.09, peak: 0.75 });              // canopy catches: "fwump"
    v.nz({ t: 0.1, kind: 'pink', ft: 'lowpass', f: 900, a: 0.001, d: 0.06, peak: 0.5 });
    v.nz({ t: 0.1, f: 3300 * p, q: 3, a: 0.0004, d: 0.012, peak: 0.55 });                                // latch click
    v.tone({ t: 0.1, f: 2150 * p, a: 0.0005, d: 0.035, peak: 0.1 });                                     // ribs ring
  },
};
// 【收伞音】较短的织物带通下滑(1800→500Hz)+"咔哒"+一声低闷。
SFX.brolly_close = {
  gain: 0.3, max: 3, jitter: 0.05, reverb: 0.04, minGap: 0.05,
  build(v, p) {
    const T = v.t, g = v.gain(0, v.out), bp = v.filter('bandpass', 1800 * p, 1.3, g);
    bp.frequency.setValueAtTime(1800 * p, T); bp.frequency.exponentialRampToValueAtTime(500 * p, T + 0.09);
    pts(g.gain, T, [[0, 0], [0.03, 0.6], [0.1, 0]]);
    v.noise('pink', T, T + 0.12, bp);
    v.nz({ t: 0.08, f: 2600 * p, q: 3, a: 0.0004, d: 0.01, peak: 0.45 });                                // clack
    v.tone({ t: 0.08, f: 300 * p, f1: 180 * p, sw: 0.03, a: 0.001, d: 0.04, peak: 0.35 });
  },
};
// 【伞面受击音】鼓皮式闷击+三角波软音+湿拍噪声+高频轻响+伞骨铃音+一颗气泡。
SFX.brolly_hit = {
  gain: 0.46, max: 5, jitter: 0.08, reverb: 0.05, minGap: 0.04,
  build(v, p) {
    v.tone({ f: 155 * p, f1: 92 * p, sw: 0.05, a: 0.001, d: 0.08, peak: 0.85 });                          // drum-skin thump
    v.tone({ type: 'triangle', f: 310 * p, f1: 200 * p, sw: 0.04, a: 0.001, d: 0.05, peak: 0.25 });
    v.nz({ f: 950 * p, f1: 380 * p, sw: 0.06, q: 2.4, a: 0.001, d: 0.07, peak: 0.6 });                    // wet slap
    v.nz({ ft: 'highpass', f: 3600, a: 0.0005, d: 0.02, peak: 0.25 });
    v.tone({ f: 1450 * p, a: 0.0005, d: 0.05, peak: 0.07 });                                            // rib ring
    v.bub(v.t + v.r(0.02, 0.04), v.r(800, 1300) * p, 0.1, 0.02, 1.8);
  },
};
// 【破碎音】8 记渐弱的撕裂噪声+低频塌陷+粉噪水花+两根弹簧伞骨"叮"+一串气泡。
SFX.brolly_break = {
  gain: 0.6, max: 3, jitter: 0.04, reverb: 0.16,
  build(v, p) {
    let t = 0;
    for (let i = 0; i < 8; i++) { t += v.r(0.008, 0.022); v.nz({ t, f: v.r(1400, 3600) * p, q: v.r(2, 4), a: 0.0008, d: v.r(0.015, 0.03), peak: 0.55 - i * 0.04 }); }   // rip
    v.tone({ f: 240 * p, f1: 58 * p, sw: 0.16, a: 0.001, d: 0.26, peak: 0.85 });                          // collapse
    v.nz({ t: 0.02, kind: 'pink', ft: 'lowpass', f: 2200, f1: 280, sw: 0.22, q: 1.4, a: 0.002, d: 0.3, peak: 0.8 });   // splash
    v.tone({ t: 0.03, f: 2650 * p, f1: 2350 * p, sw: 0.2, a: 0.0005, d: 0.2, peak: 0.12 });              // sprung rib ping
    v.tone({ t: 0.05, f: 3710 * p, a: 0.0005, d: 0.12, peak: 0.06 });
    for (let i = 0; i < 5; i++) v.bub(v.t + 0.06 + v.r(0, 0.18), v.r(600, 1600) * p, 0.14, v.r(0.015, 0.03), v.r(1.4, 2));
  },
};
SFX.brolly_launch = {
  gain: 0.5, max: 3, jitter: 0.04, reverb: 0.12,
  build(v, p) {
    const T = v.t;
    const g = v.gain(0, v.out); pts(g.gain, T, [[0, 0], [0.01, 0.55], [0.3, 0]]);                        // spring "thwang"
    const o = v.osc('sine', 190 * p, T, T + 0.32, g); o.frequency.exponentialRampToValueAtTime(330 * p, T + 0.25);
    const vib = v.lfo(24, 26, o.detune, T, T + 0.32);
    pts(vib.depth.gain, T, [[0, 60], [0.3, 0]]);
    const g2 = v.gain(0, v.out), bp = v.filter('bandpass', 600 * p, 1.2, g2);
    bp.frequency.setValueAtTime(600 * p, T); bp.frequency.exponentialRampToValueAtTime(2600 * p, T + 0.12); bp.frequency.exponentialRampToValueAtTime(700 * p, T + 0.4);
    pts(g2.gain, T, [[0, 0], [0.08, 0.7], [0.42, 0]]);
    v.noise('pink', T, T + 0.44, bp);                                                                    // whoosh
    v.tone({ f: 130 * p, f1: 55 * p, sw: 0.12, a: 0.001, d: 0.16, peak: 0.7 });                          // thunk
    v.nz({ f: 2900 * p, q: 3, a: 0.0004, d: 0.012, peak: 0.5 });                                         // release catch
  },
};
SFX.brolly_regrow = {
  gain: 0.3, max: 2, jitter: 0.02, reverb: 0.2,
  build(v, p) {
    v.nz({ f: 700 * p, f1: 3200 * p, sw: 0.16, q: 2, a: 0.03, d: 0.13, peak: 0.35 });                     // unfurling fwip
    v.tone({ t: 0.1, f: 1318 * p, a: 0.001, d: 0.28, peak: 0.24 });
    v.tone({ t: 0.16, f: 1976 * p, a: 0.001, d: 0.34, peak: 0.2 });
    v.tone({ t: 0.16, f: 3952 * p, a: 0.001, d: 0.12, peak: 0.05 });
  },
};

// tests / online checks
export const BROLLY_DEBUG = { LAUNCHED, STATS, refreshShields };
