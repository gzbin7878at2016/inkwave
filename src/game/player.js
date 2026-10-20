// ============================================================================
// 【中文导读】player.js —— 本地玩家控制器(输入 → 意图/瞄准)
// ----------------------------------------------------------------------------
// 【模块定位】表现/输入层的最后一环:把 G.input(键鼠 + 手柄)翻译成 Actor 能消费的
//   三个东西——(1) intent 意图槽(move/jump/squid/fire/sub/special),
//   (2) rig 上的 yaw/pitch(由 CameraRig 渲染成第三人称镜头并在 shoot 射线里被读回),
//   (3) actor.aimPoint(准星世界坐标)。生命周期:Match 在 setup() 里为本地玩家
//   创建单个 PlayerController;每渲染帧由 match.updateController(dt) 调用一次 update。
//   注意:它不拥有物理/形态/生命,那些全归 actor.js;本文件只"喂输入"。
// 【核心机制】
//   · 鼠标是 1:1 原始位移(pointer lock + unadjusted movement,无平滑无加速);
//     手柄走径向死区 + 两段响应曲线(lookCurve:中心细控、边缘快翻)+ 边缘加速
//     (边推摇杆 ~0.16s 后 yaw 提速最多 55%,用于快速 180° 转身)。
//   · 瞄准辅助(手柄默认开;鼠标需 settings.aimAssistMouse 显式开启,力度减半):
//     friction(准星贴近敌人时放慢转视)+ tracking assist(玩家在主动瞄/移动时
//     携带目标角速度的一部分,只"跟"不"吸附")。绝无自动锁定。
//   · bullet magnetism:准星真正压住敌人身体时,把弹道收束到其身体轴上(取得
//     准星穿过敌人时的那个高度),让"看起来命中"就"真的命中"。
//   · 地图/大招会临时改道输入:TAB/M 打开的地图(或右键大招 aiming)期间鼠标
//     不再转镜头,而是驱动地图光标/大招光标。
// 【关键约定】单位:米/秒/弧度,Y 轴向上;yaw 定义与 actor.js 一致(forward=(sin yaw,0,cos yaw))。
//   本文件 update() 内零 new(共享 _v/_v2/_fwd/_c/_hit/_res/_stick 临时量),热路径不可分配。
//   超跳(Super Jump)可在"阵亡观战"时于地图上规划,重生瞬间由 main.js 的 'respawn'
//   处理器调用 launchQueuedJump() 真正起飞(见 queueJump 的注释)。
// 【配套阅读】docs/CONTRACTS.zh-CN.md §1(AnimState 与 intent 语义)、
//   docs/EVENTS.zh-CN.md(superjump/respawn 事件)、cameraRig.js(镜头与 recoil)、
//   actor.js(消费 intent 的物理与状态机)、physics.js(准星射线与胶囊体距离)。
// ============================================================================
// Local player controller: input → actor intent + camera yaw/pitch + aim point (stream 4).
//
// Look: mouse is raw 1:1 (pointer lock, unadjusted movement — no smoothing, no acceleration). Gamepad uses a radial
// dead zone, a two-stage response curve (fine control near centre, fast at the edge) and a short edge boost for quick
// turn-arounds. Aim assist (gamepad by default; settings.aimAssistMouse opts mouse in, gentler): friction slows the
// look near an enemy under the crosshair, tracking assist carries a fraction of the target's angular motion while
// you are actively aiming or moving — never an auto-snap. Bullet magnetism pulls shots onto the body line of an enemy
// the crosshair is actually touching (at the height you aimed), so hits register exactly as they look.
import * as THREE from 'three';
import { G, clamp, lerp, angleDiff } from '../core/ctx.js';
import { PLAYER, weaponRange } from '../config.js';
import { Physics, Hit } from './physics.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _fwd = new THREE.Vector3(), _c = new THREE.Vector3();
const _hit = new Hit();
const _res = { t: 0, dist: 0 };
const _stick = { x: 0, y: 0, mag: 0 };
const DEG = Math.PI / 180;

// 【手柄转视角响应曲线】输入幅值 m∈[0,1] → 增益:中心区(m<0.75)用 pow 1.6 做细控,
// 边缘用线性补足到 1.0;两段在 m=0.75 处斜率连续(0.62 处衔接),避免手感出现折点。
// fine near the centre, fast at the edge (continuous, slope-matched at the knee)
function lookCurve(m) { return m < 0.75 ? 0.62 * Math.pow(m / 0.75, 1.6) : 0.62 + ((m - 0.75) / 0.25) * 0.38; }

// 【本地玩家控制器】把键鼠/手柄输入翻译成 actor.intent + rig 的 yaw/pitch + actor.aimPoint。
// 由 match.setup() 创建、match.updateController() 每帧驱动;enabled=false 时只处理"阵亡时的地图规划"。
export class PlayerController {
  constructor(actor, rig, input) {
    this.a = actor; this.rig = rig; this.input = input;
    this.mapHeld = false;
    this.onTarget = null;      // 准星当前压住的敌人(供 HUD 准星状态/Boss 高亮)
    this.inRange = false;      // 准星点是否落在武器有效射程内
    this.padLook = { x: 0, y: 0 };   // 手柄转视的低通量(消抖,约 16ms 滞后)
    this.enabled = true;
    this.edgeT = 0;            // 摇杆顶到边缘的持续时长(用于边缘加速的启动延迟)
    this.assist = { target: null, yaw: 0, pitch: 0, has: false, strength: 0 };
    // Super Jump planned on the TAB map while splatted: { kind: 'ally' | 'beacon', target, name }. Picking only queues it;
    // it launches (the normal charge + flight) the moment you respawn — see launchQueuedJump(), called on 'respawn'
    // 【阵亡超跳规划】在 TAB 地图上选好队友/信标只入队(jumpQueue),不立即起飞;
    // 重生(actor.alive 变 true)时由 launchQueuedJump() 走正常的蓄力+飞行流程。
    this.jumpQueue = null;
  }

  // 【主更新】唯一入口。按分支依次处理:超跳/大招光标 → 转视(鼠标/手柄 + 辅助)
  // → 移动(相机相对)→ 各按钮意图 → 地图规划 → 准星射线(computeAim)。
  // enabled=false(阵亡/暂停)时清空所有意图,但仍允许开地图规划超跳。
  update(dt) {
    const a = this.a, rig = this.rig, inp = this.input, s = G.settings;
    const it = a.intent;
    if (!this.enabled) {
      it.move.set(0, 0, 0); it.fire = it.jump = it.squid = it.sub = it.special = false;
      this.assist.has = false;
      // splatted in a live round: the TAB map still opens, to plan the Super Jump you'll take on respawn
      const m = G.match;
      const planning = !!(m && !a.alive && m.state === 'playing' && !m.paused);
      this.mapHeld = planning && (inp.down('Tab') || inp.down('KeyM') || inp.padButton(8));
      if (planning) { this._checkQueue(); if (this.mapHeld) this._mapKeys(true); }
      else if (!m || m.state !== 'playing') this.jumpQueue = null;
      return;
    }
    const usingPad = !!inp.pad && inp.lastDevice === 'pad';
    // ---- aim assist target (computed from last frame's camera; cheap)
    const as = this._assistTarget(usingPad ? (s.aimAssist ?? 1) : (s.aimAssistMouse ? 0.5 : 0));
    // ---- look
    const inv = s.invertY ? -1 : 1;
    const friction = as ? lerp(1, 0.58, as.closeness * as.strength) : 1;
    let lookActive = false;
    // 触屏按 CSS 像素累计转视，不乘 dt；映射到原有鼠标通道，复用地图/大招瞄准分支。
    const touch = inp.touch;
    const touchGain = (s.touchSensitivity ?? 1) * 2;
    const mdx = inp.mouse.dx + (touch?.enabled ? touch.look.x * touchGain : 0);
    const mdy = inp.mouse.dy + (touch?.enabled ? touch.look.y * touchGain : 0);
    // Vortex Strike targeting: the mouse / right stick drives a cursor over the (opened) stage map, fire launches
    // 【Vortex Strike 光标分支】该大招的 aiming 阶段完全接管输入:鼠标/右摇杆/方向键移动地图
    // 上的打击光标,扳机按下沿确认发射;此分支内清空一切常规意图并提前 return。
    // 【_strikePull 防误触】大招若在你按着开火键时启动,那一击不算"新按下"——只有从
    // 松到按(fresh press)才确认发射,避免一进入大招就立刻打出。
    const spx = a.specialActive;
    if (spx && spx.id === 'strike' && spx.aiming) {
      const mm = G.game?.minimap;
      let cx = mdx * 0.45 * (s.sensitivity ?? 1), cy = mdy * 0.45 * (s.sensitivity ?? 1);
      if (inp.pad) { inp.padStick(2, 3, _stick, 0.12, 0.96); cx += _stick.x * 320 * dt; cy += _stick.y * 320 * dt; inp.padStick(0, 1, _stick, 0.14, 0.95); cx += _stick.x * 320 * dt; cy += _stick.y * 320 * dt; }
      if (inp.down('KeyW')) cy -= 260 * dt; if (inp.down('KeyS')) cy += 260 * dt; if (inp.down('KeyA')) cx -= 260 * dt; if (inp.down('KeyD')) cx += 260 * dt;
      G.specials.aimMove(a, cx, cy, mm);
      // launch on a fresh press (a trigger still held from shooting when the special started doesn't count)
      const pull = inp.mouse.left || touch?.action('fire') || inp.padValue(7) > 0.3;
      if (spx.t < 0.05) this._strikePull = pull;
      if (pull && !this._strikePull) G.specials.aimConfirm(a);
      this._strikePull = pull;
      it.move.set(0, 0, 0); it.fire = it.jump = it.squid = it.sub = it.special = false;
      this.mapHeld = false;
      return;
    }
    // while the map diorama is up the mouse / right stick steer the map cursor, not your camera
    // 【地图打开时改道】mapK>0.05 表示立体地图(diorama)正在拉近;此时鼠标位移不转镜头
    // (ldx/ldy 归零,交给地图 UI 消费),避免开图时镜头乱转。
    const mapUp = (G.rig?.mapK ?? 0) > 0.05 || inp.down('Tab') || inp.down('KeyM') || inp.padButton(8);
    const ldx = mapUp ? 0 : mdx, ldy = mapUp ? 0 : mdy;
    if (ldx || ldy) {
      const sens = 0.0021 * (s.sensitivity ?? 1) * (s.aimAssistMouse ? friction : 1);
      rig.yaw -= ldx * sens;
      rig.pitch -= ldy * sens * inv;
      lookActive = true;
    }
    if (inp.pad && !mapUp) {
      inp.padStick(2, 3, _stick, 0.11, 0.96);
      const ps = s.padSensitivity ?? 1;
      // edge boost: holding the stick at the rim speeds yaw up (quick 180s) after a short delay
      // 【边缘加速】摇杆顶住(>0.93)累计 edgeT,超过 0.16s 后 yaw 提速,0.3s 内渐入到 +55%;
      // 松开后 edgeT 以 3 倍速回落,防止抖动误触发。
      if (_stick.mag > 0.93) this.edgeT = Math.min(0.5, this.edgeT + dt); else this.edgeT = Math.max(0, this.edgeT - dt * 3);
      const boost = 1 + 0.55 * clamp((this.edgeT - 0.16) / 0.3, 0, 1);
      const c = _stick.mag > 0 ? lookCurve(_stick.mag) / _stick.mag : 0;
      // tiny low-pass on the stick removes sensor noise without adding felt latency (~16 ms)
      const k = 1 - Math.exp(-60 * dt);
      this.padLook.x += (_stick.x * c - this.padLook.x) * k; this.padLook.y += (_stick.y * c - this.padLook.y) * k;
      if (_stick.mag > 0) lookActive = true;
      rig.yaw -= this.padLook.x * 3.6 * ps * boost * friction * dt;
      rig.pitch -= this.padLook.y * 2.4 * ps * friction * dt * inv;
    }
    // ---- move (camera relative)
    // 【移动·相机相对】收集 WASD/方向键/左摇杆 → (mx,mz),长度归一(斜向不加速),
    // 再按 yaw 旋转到世界空间写入 it.move:forward=(sy,0,cy),right=(-cy,0,sy)。
    let mx = 0, mz = 0;
    if (touch?.enabled) { mx += touch.move.x; mz -= touch.move.y; }
    if (inp.down('KeyW') || inp.down('ArrowUp')) mz += 1;
    if (inp.down('KeyS') || inp.down('ArrowDown')) mz -= 1;
    if (inp.down('KeyA') || inp.down('ArrowLeft')) mx -= 1;
    if (inp.down('KeyD') || inp.down('ArrowRight')) mx += 1;
    if (inp.pad) { inp.padStick(0, 1, _stick, 0.14, 0.95); mx += _stick.x; mz -= _stick.y; }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    // tracking assist: carry a share of the target's angular motion while the player is engaging (look or move input)
    // 【跟踪辅助】玩家正在"交战"(转视/移动/开火任一)且上一帧锁的是同一个敌人时,把目标的角位移
    // 按 share(≤0.42)补进镜头——只是"跟随不脱靶",不是吸附。prevValid 保证换目标不跳变。
    if (as && as.prevValid && (lookActive || ml > 0.2 || it.fire)) {
      const share = 0.42 * as.strength * as.closeness;
      rig.yaw += angleDiff(as.prevYaw, as.yaw) * share;
      rig.pitch += (as.pitch - as.prevPitch) * share * 0.7;
    }
    rig.pitch = clamp(rig.pitch, -1.05, 1.15);
    a.aimYaw = rig.yaw;
    a.aimPitch = rig.pitch;
    const sy = Math.sin(rig.yaw), cy = Math.cos(rig.yaw);
    // forward = (sy, 0, cy); right = (-cy, 0, sy)
    it.move.set(sy * mz - cy * mx, 0, cy * mz + sy * mx);

    it.jump = inp.down('Space') || inp.padButton(0);
    it.squid = inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.padValue(6) > 0.3;
    it.fire = inp.mouse.left || !!touch?.action('fire') || inp.padValue(7) > 0.3;
    it.sub = inp.mouse.right || inp.down('KeyE') || inp.padButton(5);
    it.special = inp.down('KeyF') || inp.down('KeyQ') || inp.padButton(3) || inp.padButton(11);
    this.mapHeld = inp.down('Tab') || inp.down('KeyM') || inp.padButton(8);
    // "Yeah!" signal (C / d-pad up outside the map): cheers on a teammate's Cheer Orb
    // 【欢呼信号】C 键或(地图外的)十字键上:对队友的 Cheer Orb 喊话,供特殊道具/特效消费。
    if (inp.wasPressed('KeyC') || (!this.mapHeld && inp.padPressed.has(12))) it.cheer = true;
    // the TAB map is a targeting UI (clicking a teammate beacon super jumps) — never fire or throw through it
    // 【地图吞噬开火】地图是瞄准 UI,打开时屏蔽开火/副武器,防止"看地图时走火"。
    if (this.mapHeld) { it.fire = false; it.sub = false; }
    // super jump: while the map is open, 1-3 (or d-pad left/up/right) jumps to that teammate, 4 / d-pad down to spawn
    // 【活着时地图选点即跳】canSuperJump(=活着且无进行中的超跳/大招、且在 playing)时,数字键直接起飞。
    if (this.mapHeld && a.canSuperJump()) this._mapKeys(false);

    // ---- aim point from the camera centre ray
    this.computeAim();
  }

  // 【地图快捷键】把数字键/十字键映射到超跳目标:1–3=队友、4=基地、5–9 与 0=队伍跳信标
  // (按诞生时间从旧到新,与地图列表一致)。queue=false(活着)→ 立即 jump;queue=true(阵亡)→ 只入队。
  // TAB-map number keys / d-pad: 1–3 teammates, 4 base, 5–9 + 0 team jump beacons (oldest first, as the map lists
  // them). Alive: jump now. Splatted (queue = true): plan the jump for the respawn instead — it never launches early.
  _mapKeys(queue) {
    const a = this.a, inp = this.input;
    const allies = G.actors.filter((o) => o.team === a.team && o !== a);
    const pick = (kind, target) => {
      if (queue) { this.queueJump(kind, target); return; }
      if (kind === 'ally') { if (target && target.alive && !target.superJumpState) a.superJump(target); }
      else if (kind === 'base') a.superJump(G.level.spawnPads[a.team].clone());
      else G.subs.jumpToBeacon(a, target);
    };
    if (inp.wasPressed('Digit1') || inp.padPressed.has(14)) pick('ally', allies[0]);
    if (inp.wasPressed('Digit2') || inp.padPressed.has(12)) pick('ally', allies[1]);
    if (inp.wasPressed('Digit3') || inp.padPressed.has(15)) pick('ally', allies[2]);
    if (inp.wasPressed('Digit4') || inp.padPressed.has(13)) pick('base', null);
    if (G.subs) {
      const bs = G.subs.beaconsFor(a.team).sort((x, y) => x.born - y.born);
      for (let k = 0; k < Math.min(6, bs.length); k++) if (inp.wasPressed('Digit' + ((k + 5) % 10))) pick('beacon', bs[k]);
    }
  }

  // ---- Super Jump planned while splatted -------------------------------------------------------------------------
  // 【入队重生超跳】阵亡期间在地图上选定目标并排队(不立即起飞)。kind='base' 清空规划
  // (反正你本来就在基地重生)。阵亡的队友不可选(他也会回基地);正处于超跳飞行中的队友可选
  // (你落在他的落点)。返回是否采纳本次选择;此函数绝不真正起飞(玩家已阵亡)。音效用 ui_click/
  // ui_confirm 区分"清空/采纳/改选",非法选择播 ui_error。
  // Queue (or change) the jump for the respawn. kind 'base' clears the plan: you drop in at base anyway. A splatted
  // teammate can't be picked (they come back at base); one mid Super Jump can (you land where they come down).
  // Returns true when the pick was taken. Never jumps: the actor is splatted.
  queueJump(kind, target) {
    const a = this.a;
    if (a.alive) return false;
    let q = null;
    if (kind === 'ally') { if (target && target.team === a.team && target !== a && target.alive) q = { kind, target, name: target.name }; }
    else if (kind === 'beacon') { if (target && target.state === 'beacon' && target.team === a.team) q = { kind, target, name: target.owner === a ? 'Your beacon' : `${target.owner?.name || 'Team'}'s beacon` }; }
    if (kind === 'base') {
      const had = !!this.jumpQueue;
      this.jumpQueue = null;
      G.audio?.play(had ? 'ui_back' : 'ui_click', { volume: 0.5 });
      return true;
    }
    if (!q) { G.audio?.play('ui_error', { volume: 0.5 }); return false; }
    const same = this.jumpQueue && this.jumpQueue.target === q.target;
    this.jumpQueue = q;
    G.audio?.play('ui_confirm', { volume: same ? 0.35 : 0.6 });
    return true;
  }

  // 【规划有效性】规划的目标还在吗?返回 null=仍有效;否则返回中文/英文原因串(队友被击倒 / 信标消失)。
  // is the planned target still there? (teammate alive, beacon standing)
  _queueGone(q) {
    if (!q) return null;
    if (q.kind === 'ally') return q.target && q.target.alive ? null : `${q.name} was splatted`;
    if (q.kind === 'beacon') return q.target && q.target.state === 'beacon' ? null : 'The jump beacon is gone';
    return null;
  }

  // 【阵亡中巡视规划】目标失效(队友被击倒/信标消失)时立即丢弃规划并提示,让你能重新选。
  // 每帧在地图打开时由 update 的规划分支调用。
  // while splatted: a planned target that goes down is dropped straight away (so you can pick again)
  _checkQueue() {
    const why = this._queueGone(this.jumpQueue);
    if (!why) return;
    this.jumpQueue = null;
    G.hud?.jumpNote?.(`${why} — Super Jump cancelled`);
    G.audio?.play('ui_error', { volume: 0.45 });
  }

  // 【起飞已规划的超跳】重生的那一刻(main.js 订阅 'respawn' 事件)调用:走正常超跳流程
  // (蓄力+飞行)起飞。目标此时已消失则发提示取消。返回是否成功起飞。仍阵亡时保留规划不消费。
  // On respawn (main.js 'respawn' handler): launch the planned jump through the normal Super Jump (charge + flight).
  // A target that's gone by now cancels it with a short note. Returns true if a jump started.
  launchQueuedJump() {
    const q = this.jumpQueue, a = this.a;
    if (!q || !a.alive) return false;   // (still splatted: the plan stays)
    this.jumpQueue = null;
    const why = this._queueGone(q);
    let ok = false;
    if (!why) ok = q.kind === 'beacon' ? !!G.subs?.jumpToBeacon(a, q.target) : a.superJump(q.target);
    if (!ok) { G.hud?.jumpNote?.(`${why || 'Can’t Super Jump right now'} — Super Jump cancelled`); G.audio?.play('ui_error', { volume: 0.45 }); }
    return ok;
  }

  // Best enemy near the crosshair for aim assist (angular cone scaled so it covers ~a body width at any range).
  // 【瞄准辅助选目标】用"角度锥"筛选准星附近的敌人:cone=atan2(1.0,d) 使锥体在任何距离都约合一个
  // 身体宽度(近处宽、远处窄,2.5°–10° 夹取),再用 score=角度/锥宽 + 距离惩罚 选最近最正的一个。
  // 需要 LOS 无遮挡;动画形态为 'swim' 的敌人跳过。记录 prevYaw/prevPitch 供跟踪辅助做角速度前馈。
  _assistTarget(strength) {
    const as = this.assist;
    const a = this.a, cam = G.camera;
    if (!(strength > 0) || !cam) { as.has = false; as.target = null; return null; }
    const fwd = cam.getWorldDirection(_fwd);
    const w = a.weapon;
    const maxR = Math.min(32, weaponRange(w) * 1.15 + 2);
    let best = null, bestScore = Infinity, bYaw = 0, bPitch = 0, bClose = 0;
    for (const e of G.actors) {
      if (e.team === a.team || !e.alive || e.anim.form === 'swim' || e.invuln > 0) continue;
      _c.set(e.pos.x, e.pos.y + (e.smoothY || 0) + (e.form === 'squid' ? 0.3 : 0.95), e.pos.z);
      _v.copy(_c).sub(cam.position);
      const d = _v.length();
      if (d > maxR + 4 || d < 0.5) continue;
      if (a.pos.distanceTo(e.pos) > maxR) continue;
      _v.multiplyScalar(1 / d);
      const ang = Math.acos(clamp(_v.dot(fwd), -1, 1));
      const cone = clamp(Math.atan2(1.0, d), 2.5 * DEG, 10 * DEG);
      if (ang > cone) continue;
      if (!G.physics.los(cam.position, _c)) continue;
      const score = ang / cone + d * 0.01;
      if (score < bestScore) { bestScore = score; best = e; bYaw = Math.atan2(_v.x, _v.z); bPitch = Math.asin(clamp(_v.y, -1, 1)); bClose = 1 - ang / cone; }
    }
    if (!best) { as.has = false; as.target = null; return null; }
    as.prevValid = as.has && as.target === best;
    as.prevYaw = as.yaw; as.prevPitch = as.pitch;
    as.target = best; as.yaw = bYaw; as.pitch = bPitch; as.closeness = clamp(bClose * 1.3, 0, 1); as.strength = strength; as.has = true;
    return as;
  }

  // 【准星点计算】从游戏视角相机(gameCam,非地图俯视)发射线:起点抬高到玩家头部高度并投影到射线
  // 上(忽略相机与玩家之间的几何)→ raycast 命中取距离,否则 70m。随后:
  //   1) 用 segmentCapsuleDist 检测射线沿途敌人胶囊体,记录 onTarget 与命中距离(视觉身体放宽 0.2m);
  //   2) Boss 模式下射线止于 HULLBREAKER 外壳;
  //   3) bullet magnetism:命中敌人身体时,把 aimPoint 收束到其身体轴上(取准星穿过处的高度,夹在体高内);
  //   4) inRange = aimPoint 到玩家距离是否 ≤ 武器射程(供 HUD 准星状态)。
  computeAim() {
    // the gameplay view — while the map diorama is up the rendered camera is overhead, aim stays with the player
    const a = this.a, cam = G.rig?.gameCam || G.camera;
    const fwd = cam.getWorldDirection(_fwd);
    // start the ray level with the player so geometry between camera and player is ignored
    _v.copy(a.pos); _v.y += 1.3;
    const along = Math.max(0, _v.sub(cam.position).dot(fwd));
    const start = _v2.copy(cam.position).addScaledVector(fwd, along);
    const hit = G.physics.raycast(start, fwd, 70, _hit, true);
    const dist = hit.hit ? hit.dist : 70;
    a.aimPoint.copy(start).addScaledVector(fwd, dist);
    // enemy under the crosshair? (visual body, generous by 0.2 m)
    this.onTarget = null;
    let best = dist, bestT = 0;
    const reach = Math.min(dist, 34);
    const end = _v.copy(start).addScaledVector(fwd, reach);
    for (const e of G.actors) {
      if (e.team === a.team || !e.alive) continue;
      if (e.anim.form === 'swim') continue;
      _c.set(e.pos.x, e.pos.y + (e.smoothY || 0), e.pos.z);
      Physics.segmentCapsuleDist(start, end, _c, PLAYER.radius, e.form === 'squid' ? PLAYER.squidHeight : PLAYER.height, _res);
      if (_res.dist < PLAYER.radius + 0.2) {
        const d = _res.t * reach;
        if (d < best) { best = d; bestT = _res.t; this.onTarget = e; }
      }
    }
    // boss mode: the crosshair stops on HULLBREAKER's shell (lobs land on it, the reticle lights up)
    if (G.boss) {
      const bd = G.boss.rayDist(start, fwd, best);
      if (bd > 0 && bd < best) { this.onTarget = G.boss; a.aimPoint.copy(start).addScaledVector(fwd, bd); }
    }
    if (this.onTarget && this.onTarget !== G.boss) {
      // bullet magnetism: converge on the enemy's body axis at the height the crosshair crosses it
      const e = this.onTarget;
      const h = e.form === 'squid' ? PLAYER.squidHeight : PLAYER.height;
      const py = start.y + fwd.y * best;
      const baseY = e.pos.y + (e.smoothY || 0);
      a.aimPoint.set(e.pos.x, clamp(py, baseY + 0.2, baseY + h - 0.12), e.pos.z);
    }
    // is the crosshair point inside the weapon's effective range? (HUD reticle state)
    const w = a.weapon;
    const range = weaponRange(w);
    this.inRange = a.aimPoint.distanceTo(a.pos) <= range + 0.5;
  }
}
