// ============================================================================
// 【中文导读】HULLBREAKER 的"大脑"(BossBrain 类):一个只在单一客户端(离线=本机,在线=主机)上运行的
//   决策器。它负责:在主场地上走路、把注意力分散到整支小队(不一定打最近的,但从不打站在出生台上的人)、
//   视场面挑招式、放招前先把身体转向目标、并把每个招式写成一条"招式记录"供 bossHazards 与客机回放。
// ----------------------------------------------------------------------------
// 【模块定位】被 boss.js 的 Boss 在 sim 侧创建/持有;每帧由 Boss.update 调 brain.update(dt)。它是唯一
//   会修改 Boss 位置/朝向/阶段的逻辑;其余端只回放它广播的记录。
// 【核心机制】
//   · 阶段:HP 降到 66%/33% 时触发怒吼(pendingPhase → _roar),怒吼是一个无敌拍,且【绝不在招式中间插】;
//     阶段越高,移动更快、冷却更短、招式更强,2 阶段起放 crablets,3 阶段解锁 Shell Frenzy + 露腹。
//   · 每帧的三态:_runMove(正在出招)、_roar(怒吼中)、_idle(招间空档)。
//   · 决策 _choose 用一张权重表采样招式,权重随距离/目标数/阶段/冷却变化;被命中的记忆(dmgBy)与注意力
//     衰减(attn)让目标选择既"记仇"又不黏人。
//   · 转向 _turn 只走"身体装得下"的朝向;被夹住时会朝空地"侧移"转身(沿墙距场上升,绝不越界)。
//   · 出招 _start 把当前 bt、随机种子 s、各段时长 d=[tele,act,rec]、参数 p 冻结进记录——这是确定性的全部。
// 【关键约定】bt(Boss 时钟,自开局秒数)是回放的时间基;所有位置/朝向改动都经 nav.poseOk/turnOk 校验;
//   _lane 只在有足够长的直线冲撞通道时才允许 charge;站位绝不停在队伍出生台 18m 内。
// 【配套阅读】docs/BOSS.zh-CN.md、docs/BOSS.md;同目录 boss.js(状态容器)、bossHazards.js(招式几何/计时)、
//   bossNav.js(可行走判定)。
// ============================================================================
// HULLBREAKER's mind (runs on one client: offline, or the host). Walks its home ground on the boss nav, spreads its
// attention across the squad (not always the nearest kid; never anyone on a spawn pad), picks moves that suit the
// moment, faces its mark before any aimed move, and turns each into a move record the hazards and the guests replay.
// Phases: 66 % / 33 % → a roar (invulnerable beat, never mid-move) and a nastier move set; crablets from phase 2,
// Shell Frenzy + an exposed belly in phase 3.
import * as THREE from 'three';
import { G, clamp, angleDiff, rng } from '../core/ctx.js';
import { PLAYER } from '../config.js';
import { BOSS } from './boss.js';
import { MOVES, PACE, MIN_TELE, HZ, moveTimes, movePhaseAt, chargeDist, chargeTime, beamAngle } from './bossHazards.js';

// 【阶段参数表】索引 = 阶段(0 未用/1/2/3)。越高阶段:更快、更灵活、冷却更短、更想贴身
const SPEED = [0, 2.9, 3.3, 3.8];          // walk (m/s) by phase
const TURN = [0, 1.25, 1.45, 1.75];        // turn rate (rad/s)
const COOL = [0, 1.05, 0.8, 0.6];          // gap between moves (+ up to COOL_RND)
const COOL_RND = [0, 0.8, 0.6, 0.45];
const PREF = [0, 10, 9, 8];                // preferred distance to its mark
// 【记录取整】招式记录里的浮点统一截到千分位,保证序列化/回放在不同精度下逐位一致
const r3 = (x) => Math.round(x * 1000) / 1000;
const _v = new THREE.Vector3();

// 【Boss 大脑】决策与导航驱动;内含确定性 RNG、目标选择、招式权重采样、招式记录冻结
export class BossBrain {
  // 构造:初始化随机数、冷却、注意力/记仇表;若中途接管(adopt,主机迁移)则补跑阶段检查并避免重复放小怪
  constructor(boss, { adopt = false } = {}) {
    this.b = boss;
    this.rnd = rng((Math.random() * 2 ** 31) >>> 0);
    this.cool = adopt ? 1.0 : 2.4;
    this.path = null; this.pi = 0; this.goal = null; this.goalT = 0; this.stuckT = 0;
    this.attn = new Map(); this.dmgBy = new Map();
    this.last = null; this.cd = { crablets: 0, frenzy: 0 };
    this.retarget = 0; this.plan = null; this.speed = 0;
    this.pendingPhase = 0;
    // 【小怪 id 续号】扫描在场 crablet 求出当前最大 id,新小怪从 maxId+1 起,避免跨端 id 冲突
    let maxId = 0;
    for (const c of boss.crabs.values()) { maxId = Math.max(maxId, c.id); if (c.age === undefined) { c.age = 0; c.tgt = -1; c.retgt = 0; c.speed = c.speed || 0; } }
    this.crabSeq = maxId + 1;
    // adopted mid-move (host migration): a brood already out isn't spilled twice
    // 【接管去重】若接管时正处在 crablets 招式的 spawn 段之后,标记"已产出",避免再放一窝
    const m = boss.move;
    this._spawned = !!(m && m.id === 'crablets' && boss.bt - m.t0 >= m.d[0]);
    if (adopt) this.checkPhase();
  }

  // 【难度节奏】BOSS.paceDiff 决定全局快慢(招式时长/冷却/小怪冷却都乘它)
  get pace() { return BOSS.paceDiff[this.b.difficulty] ?? 1; }
  // 【记仇】记录某攻击者最近的累计伤害,供 _pickTarget 加权(随时间指数衰减)
  noteDamage(atk, d) { if (atk) { const k = atk.nid ?? atk.slot; this.dmgBy.set(k, (this.dmgBy.get(k) || 0) + d); } }
  // 【阶段检查】由 HP 分数推出"应处阶段";只升不降,记入 pendingPhase 等空闲时 _roar 真正切换
  checkPhase() {
    const f = this.b.hpFrac(), want = f <= BOSS.phases[1] ? 3 : f <= BOSS.phases[0] ? 2 : 1;
    if (want > this.b.phase && want > this.pendingPhase) this.pendingPhase = want;
  }
  // 【战败清理】Boss 倒下时清空招式/寻路状态,让大脑停止决策
  onDefeat() { this.b.move = null; this.path = null; this.plan = null; }

  // ---------------------------------------------------------------------------------------------- per frame
  // 【逐帧主循环】推进 bt,处理登场/怒吼计时,选择三态之一,最后统一算地板高度与速度/转速遥测
  update(dt) {
    const b = this.b, st = b.match.state;
    b.bt += dt;
    const px = b.pos.x, pz = b.pos.z, pyaw = b.yaw;
    this.cd.crablets -= dt; this.cd.frenzy -= dt;
    // 【记仇衰减】每帧按 e^(-dt/8) 衰减:约 8s 时间常数,近期伤害权重高、旧账慢慢被遗忘
    for (const [k, v] of this.dmgBy) this.dmgBy.set(k, v * Math.exp(-dt / 8));   // "who hurt me lately"
    // intro: it bursts out of its home ground, roars, then the round starts
    // 【登场时序】到 introAt 破土可见(anim=1),introLen 后收尾;anim=2 是怒吼,roarLen 后解除无敌并缩短冷却
    if (!b.visible && b.bt >= BOSS.introAt) { b.visible = true; b.anim = 1; b.animT0 = b.bt; }
    if (b.anim === 1 && b.bt - b.animT0 >= BOSS.introLen) b.anim = 0;
    if (b.anim === 2 && b.bt - b.animT0 >= BOSS.roarLen) { b.anim = 0; b.invuln = false; this.cool = Math.min(this.cool, 0.9 * this.pace); }
    // 【三态分派】playing 时:先跑小怪;有招式则 _runMove;怒吼中等待;有 pendingPhase 则 _roar;否则 _idle。
    //   非 playing 却还有招 → 立即中止(招式的伤害由 Boss.update 负责 fizzle 掉)
    if (!b.dead && b.visible) {
      if (st === 'playing') {
        this._crabs(dt);
        if (b.move) this._runMove(dt);
        else if (b.anim === 2) { /* roaring */ }
        else if (this.pendingPhase > b.phase) this._roar();
        else this._idle(dt);
      } else if (b.move) { b.move = null; b.stunned = false; }   // time's up mid-move: hazards stop (Boss.update fizzles them)
    }
    // 【晕眩判定】charge/frenzy 的参数带 stun,且当前处于 rec(恢复)段时才算"晕眩可被输出"
    b.stunned = !!(b.move && b.move.p.stun && movePhaseAt(b.move, b.bt - b.move.t0) === 'rec');
    // floor height (strides over curbs / planters: follow the main floor, eased)
    // 【贴地】y 以 5/s 的速率缓动到主地坪高度(跨过路缘/花坛时平滑跟随,不逐帧硬贴)
    const fy = b.nav.floorAt(b.pos.x, b.pos.z);
    b.pos.y += (fy - b.pos.y) * Math.min(1, dt * 5);
    // 【遥测】把本帧位移/转角逐帧换算成 vel/turn,供动画与快照使用(位置已变,回放端也这样推)
    if (dt > 0) { b.vel.set((b.pos.x - px) / dt, 0, (b.pos.z - pz) / dt); b.turn = angleDiff(pyaw, b.yaw) / dt; }
  }

  // 【怒吼切阶段】把 pendingPhase 落定为正式阶段,进入无敌怒吼拍,清空寻路规划,并按新阶段"预拨"小怪/狂怒冷却
  _roar() {
    const b = this.b;
    b.phase = this.pendingPhase; this.pendingPhase = 0;
    b.anim = 2; b.animT0 = b.bt; b.invuln = true;
    this.path = null; this.plan = null;
    // 阶段越高,怒吼后越快进入下一轮小怪/狂怒(把冷缩到指定上界)
    if (b.phase >= 2) this.cd.crablets = Math.min(this.cd.crablets, 2);
    if (b.phase >= 3) this.cd.frenzy = Math.min(this.cd.frenzy, 3);
  }

  // ---------------------------------------------------------------------------------------------- between moves
  // 【招间空档】重新选目标 → 若冷却好就挑一个招式并等它转正对 → 否则随机漫步接近目标
  _idle(dt) {
    const b = this.b;
    this.retarget -= dt; this.goalT -= dt; this.cool -= dt;
    if (this.retarget <= 0 || !b.targetActor()) this._pickTarget();
    const t = b.targetActor();
    if (this.cool <= 0 && t) {
      if (!this.plan) { this.plan = this._choose(t); if (this.plan) this.plan.t = 0; }
      const P = this.plan;
      if (P) {
        P.t += dt;
        // aimed moves wait until it faces its mark (it keeps turning, never sliding sideways)
        // 【瞄准招式等待转向】无 face 的招式(barrage/crablets/frenzy)立即出手;有 face 的须先转正
        if (P.face === null || P.face === undefined) { this._start(P, t); return; }
        const want = P.faceFn ? P.faceFn() : P.face;
        const dy = angleDiff(b.yaw, want);
        // 容差:对准 0.16rad 即出;非 charge 的招式允许更大偏差(0.6rad)且等久一点——slam/sweep 略偏也好看
        if (Math.abs(dy) < 0.16 || (P.id !== 'charge' && P.t > 1.2 && Math.abs(dy) < 0.6)) { this._start(P, t); return; }   // (a slam / sweep reads fine a little off-axis)
        if (!this._turn(want, dt) || P.t > 2.4) { this.plan = null; this.cool = 0.3; this.last = P.id; }   // can't line up here: rethink
        this.speed = 0;
        return;
      }
    }
    this._walk(dt, t);
  }

  // 【选目标】给每个活着的队友(-不在出生台、不在超级跳)打分:近、近期伤过我、最近少被点名者更优;
  //   带一点随机扰动,避免每帧死盯同一个;attn 每轮乘 0.8 衰减,实现"雨露均沾"
  _pickTarget() {
    const b = this.b, nav = b.nav;
    this.retarget = 3 + this.rnd() * 2.5;
    let best = null, bs = -Infinity;
    for (const a of G.actors) {
      if (!a.alive || a.team !== 0 || a.superJumpState || nav.inPad(a.pos.x, a.pos.z, 3)) continue;
      const k = a.nid ?? a.slot, d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      // 【打分公式】-0.1*距离(近优) + 0.004*近期伤害(记仇) - 1.4*注意力(被点名多则降温) + 1.3*随机
      const s = -d * 0.1 + (this.dmgBy.get(k) || 0) * 0.004 - (this.attn.get(k) || 0) * 1.4 + this.rnd() * 1.3;
      if (s > bs) { bs = s; best = a; }
    }
    for (const [k, v] of this.attn) this.attn.set(k, v * 0.8);   // 注意力整体衰减
    if (best) { const k = best.nid ?? best.slot; this.attn.set(k, (this.attn.get(k) || 0) + 1); if (b.target !== k) this.goalT = 0; b.target = k; }
    else b.target = -1;
  }

  // 【漫步】朝当前路径点走;到点后转向目标;速度按"朝向与目标方向偏差"衰减(转不过弯就减速,不侧滑)
  _walk(dt, t) {
    const b = this.b, nav = b.nav, ph = b.phase;
    if (!this.goal || this.goalT <= 0 || (this.path && this.pi >= this.path.length && this.goalT < 1.5)) this._pickGoal(t);
    let want = b.yaw, go = false;
    if (this.path && this.pi < this.path.length) {
      // 【路点推进】当前路点进入 1.1m 半径即视为到达,顺延到下一个更远的路点
      let wp = this.path[this.pi];
      while (Math.hypot(wp[0] - b.pos.x, wp[1] - b.pos.z) < 1.1 && this.pi < this.path.length - 1) wp = this.path[++this.pi];
      const d = Math.hypot(wp[0] - b.pos.x, wp[1] - b.pos.z);
      if (this.pi >= this.path.length - 1 && d < 1.1) this.pi = this.path.length;   // 末点到达:停止前进
      else { want = Math.atan2(wp[0] - b.pos.x, wp[1] - b.pos.z); go = true; }
    }
    if (!go && t) want = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);   // arrived: face its mark
    const dy = angleDiff(b.yaw, want);
    this._turn(want, dt);
    // 【速度】目标速度 = 阶段速度 * 朝向对齐系数(偏差>0.9rad 就为 0);再用限幅的加速度平滑逼近
    const vmax = SPEED[ph] * (go ? clamp(1 - Math.abs(dy) / 0.9, 0, 1) : 0);
    this.speed += clamp(vmax - this.speed, -4 * dt, 3 * dt);
    if (this.speed > 0.01) {
      const nx = b.pos.x + Math.sin(b.yaw) * this.speed * dt, nz = b.pos.z + Math.cos(b.yaw) * this.speed * dt;
      // 【碰撞】新位置必须 poseOk 才落位;否则停下并累计 stuckT,卡超过 0.8s 就放弃当前目标重规划
      if (nav.poseOk(nx, nz, b.yaw)) { b.pos.x = nx; b.pos.z = nz; this.stuckT = 0; }
      else { this.speed = 0; this.stuckT += dt; if (this.stuckT > 0.8) { this.stuckT = 0; this.goalT = 0; this.path = null; } }
    }
  }
  // turn toward yaw at the phase's rate, only through headings its body fits. Hemmed in (a claw would meet a wall), it
  // sidles toward open floor while it turns — up the clearance field, never off it → false when it can't do either
  // 【受限转向】优先在原地转到 ny;若新朝向撞墙,则沿 8 个方向找"余隙 room 更大"的落点侧移一步再试着转
  _turn(want, dt) {
    const b = this.b, nav = b.nav, dy = angleDiff(b.yaw, want);
    if (Math.abs(dy) < 1e-3) return true;
    const ny = b.yaw + clamp(dy, -TURN[b.phase] * dt, TURN[b.phase] * dt);   // 本帧最多转这么多
    if (nav.turnOk(b.pos.x, b.pos.z, ny)) { b.yaw = ny; return true; }
    // 【余隙打分】离墙越远、离地越近(floorClear 封顶 3)越"开阔";被夹住时朝分数更高的方向侧移
    const room = (x, z) => nav.wallClear(x, z) + Math.min(nav.floorClear(x, z), 3) * 0.5;
    const r = SPEED[b.phase] * 0.55 * dt, here = room(b.pos.x, b.pos.z);
    let best = null, bs = here + 1e-3;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = b.pos.x + Math.sin(a) * r, z = b.pos.z + Math.cos(a) * r;
      if (!nav.turnOk(x, z, b.yaw)) continue;
      const sc = room(x, z);
      if (sc > bs) { bs = sc; best = [x, z]; }
    }
    if (!best) return false;
    b.pos.x = best[0]; b.pos.z = best[1];
    if (nav.turnOk(b.pos.x, b.pos.z, ny)) b.yaw = ny;   // 侧移后若新朝向已合法,顺便转过去
    return true;
  }

  // 【选漫步目标】在可规划区域采 16 个随机点打分:偏好开阔、不太远、且距离目标符合 PREF(阶段偏好距离);
  //   无目标时回 Boss 老巢;出生台 18m 内重罚(永不在玩家出生点附近蹲守);定后规划一条路径
  _pickGoal(t) {
    const b = this.b, nav = b.nav, pad = nav.pads[0];
    this.goalT = 3 + this.rnd() * 2.5;
    let best = null, bs = -Infinity;
    for (let i = 0; i < 16; i++) {
      const [x, z] = nav.randomPoint(this.rnd);
      const ci = nav.cell(x, z);
      // 开阔度(离墙/离地,封顶)+ 近端惩罚 + 随机扰动
      let s = Math.min(nav.Dw[ci], 6) * 0.7 + Math.min(nav.Dv[ci], 4) * 0.4 - Math.hypot(x - b.pos.x, z - b.pos.z) * 0.07 + this.rnd() * 1.5;
      if (t) s -= Math.abs(Math.hypot(x - t.pos.x, z - t.pos.z) - PREF[b.phase]);   // 想待在偏好距离上
      else s -= Math.hypot(x - b.home.x, z - b.home.z) * 0.2;
      if (Math.hypot(x - pad.x, z - pad.z) < 18) s -= 12;   // never camps the squad's spawn
      if (s > bs) { bs = s; best = [x, z]; }
    }
    if (!best) return;
    this.goal = best;
    this.path = nav.path(b.pos.x, b.pos.z, best[0], best[1]);
    this.pi = 1;   // 从第 1 个路点起步(第 0 个是当前所在格)
  }

  // ---------------------------------------------------------------------------------------------- choosing a move
  // 【挑招式】按局势给每招打分加权,再轮盘赌采样一个;附带朝向需求(face/faceFn)与冲撞通道(lane)
  _choose(t) {
    const b = this.b, nav = b.nav, ph = b.phase;
    const fx = b.pos.x + Math.sin(b.yaw) * 2, fz = b.pos.z + Math.cos(b.yaw) * 2;
    const d = Math.hypot(t.pos.x - fx, t.pos.z - fz);   // 到"前方 2m 参照点"的距离(考虑前摇够不够近)
    const kids = G.actors.filter((a) => a.alive && a.team === 0 && !nav.inPad(a.pos.x, a.pos.z, 1));
    const near = kids.filter((a) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 10.5).length;
    const far = kids.filter((a) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 13).length;
    const aimAt = () => Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
    const W = [];
    // 【权重表】slam 近身、barrage 远程多目标、sweep 中距、charge 仅在有通道时、crablets/frenzy 受冷却与阶段约束
    W.push(['slam', d < 11 ? 3 + near * 0.6 : 0.25]);
    W.push(['barrage', 1.3 + far * 0.45 + (d > 12 ? 1 : 0)]);
    W.push(['sweep', d > 5 && d < 17 ? 2.1 : 0.4]);
    // charge only down a real lane toward (roughly) its mark
    const lane = this._lane(aimAt());
    W.push(['charge', lane ? (d > 5.5 ? 2.2 : 1.2) : 0]);
    if (ph >= 2 && this.cd.crablets <= 0 && [...b.crabs.values()].filter((c) => !c.dead).length < 3) W.push(['crablets', 2.4]);
    if (ph >= 3 && this.cd.frenzy <= 0) W.push(['frenzy', 1.1 + near * 0.9]);
    for (const w of W) if (w[0] === this.last) w[1] *= 0.3;   // don't repeat itself
    let sum = 0; for (const w of W) sum += w[1];
    // 【轮盘赌】按权重累积采样;默认 barrage 兜底
    let r = this.rnd() * sum, id = 'barrage';
    for (const w of W) { r -= w[1]; if (r <= 0) { id = w[0]; break; } }
    if (this.force) { id = this.force; this.force = null; if (id === 'charge' && !lane) id = 'barrage'; }   // audits: __G.boss.brain.force = 'slam'
    // 【朝向需求】近战招需转向目标;charge 有预选通道;其余无要求
    switch (id) {
      case 'slam': case 'sweep': return { id, face: aimAt(), faceFn: aimAt };
      case 'charge': return { id, face: lane.yaw, lane };
      default: return { id, face: null };
    }
  }
  // a charge lane: roughly toward its mark, long enough to be worth it (longer is better; a wall at the end best)
  // 【冲撞通道搜索】在目标方向附近扫一系列偏角,选出"直线距离够长、偏角小"的通道;末端有墙更佳(撞得更狠)
  _lane(yaw) {
    const b = this.b;
    let best = null, bs = -Infinity;
    for (const o of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1, 1.45, -1.45, 1.8, -1.8]) {   // (piers: along the pier)
      const y = yaw + o;
      if (!b.nav.turnOk(b.pos.x, b.pos.z, y)) continue;
      const c = b.nav.cast(b.pos.x, b.pos.z, y, 34);
      if (c.dist < HZ.chargeMin) continue;
      const s = Math.min(c.dist, 22) * 0.2 - Math.abs(o) * 1.6 + (c.wall ? 1 : 0);
      if (s > bs) { bs = s; best = { yaw: y, L: c.dist, wall: c.wall }; }
    }
    return best;
  }

  // build the record: everything a client needs to reproduce the move from its start time
  // 【冻结招式记录】把 bt、随机种子、三段时长 [tele,act,rec] 与参数 p 固化,推给 hazards 与网络。这是
  //   确定性回放的核心:任何客户端拿到 (id, t0, s, d, p) 就能逐位复现这一段。
  _start(P, t) {
    const b = this.b, ph = b.phase, pace = PACE[ph], M = MOVES[P.id];
    this.plan = null; this.speed = 0; this.path = null;
    const fwx = Math.sin(b.yaw), fwz = Math.cos(b.yaw), y = b.pos.y;
    // tele=前摇/预警,act=生效段,rec=恢复段;都由 MOVES 基准时长乘阶段 pace,前摇有下限 MIN_TELE
    const tele = Math.max(MIN_TELE, M.tele * pace);
    let act = M.act * pace, rec = M.rec * pace, p;
    // 【逐招参数】每个 case 冻结该招式生效所需的全部世界坐标/角度/时长;所有浮点经 r3 取整
    switch (P.id) {
      case 'slam': {
        // 【砸地】落点在身前 4.3m 的地面;rings 是同心冲击环的延时(阶段越高环越多),act 固定 1.2s
        const x = b.pos.x + fwx * 4.3, z = b.pos.z + fwz * 4.3;
        p = { x: r3(x), y: r3(b.nav.floorAt(x, z)), z: r3(z), rings: ph >= 3 ? [0, 0.6] : ph >= 2 ? [0, 0.9] : [0] };
        act = 1.2;
        break;
      }
      case 'barrage': {
        const n = [0, 4, 5, 7][ph], pts = [];
        const cands = G.actors.filter((a) => a.alive && a.team === 0 && !a.superJumpState && !b.nav.inPad(a.pos.x, a.pos.z, HZ.barrelR + 1));
        // spread: every kid gets one before anyone gets two; far ones first (the barrage is its long-range answer)
        cands.sort((a1, a2) => Math.hypot(a2.pos.x - b.pos.x, a2.pos.z - b.pos.z) - Math.hypot(a1.pos.x - b.pos.x, a1.pos.z - b.pos.z) + (this.rnd() - 0.5) * 6);
        for (let i = 0; i < n && cands.length; i++) {
          const a = cands[i % cands.length], extra = i >= cands.length;
          const ang = this.rnd() * Math.PI * 2, off = extra ? 3 + this.rnd() * 2.5 : 0;
          let x = a.pos.x + a.vel.x * 0.3 + Math.cos(ang) * off, z = a.pos.z + a.vel.z * 0.3 + Math.sin(ang) * off;
          const g = G.level.groundHeight(x, z, a.pos.y + 1);
          if (!(g > PLAYER.waterY) || b.nav.inPad(x, z, HZ.barrelR + 0.5)) { x = a.pos.x; z = a.pos.z; }
          const gy = G.level.groundHeight(x, z, a.pos.y + 1);
          if (!(gy > PLAYER.waterY) || b.nav.inPad(x, z, HZ.barrelR + 0.5)) continue;
          pts.push([r3(x), r3(gy), r3(z), r3(tele + pts.length * HZ.barrelGap)]);
        }
        if (!pts.length) { this.cool = 0.5; this.last = 'barrage'; return; }
        p = { sx: r3(b.pos.x - fwx * 0.6), sy: r3(y + 5.4), sz: r3(b.pos.z - fwz * 0.6), b: pts };
        act = pts[pts.length - 1][3] - tele + HZ.barrelFlight + 0.1;
        break;
      }
      case 'sweep': {
        const c = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z), span = [0, 1.9, 2.2, 2.5][ph], dir = this.rnd() < 0.5 ? 1 : -1;
        p = { ox: r3(b.pos.x + fwx * 3.3), oy: r3(y + 2.3), oz: r3(b.pos.z + fwz * 3.3), y: r3(y), a0: r3(c - dir * span / 2), a1: r3(c + dir * span / 2), c: r3(b.yaw) };
        break;
      }
      case 'charge': {
        const L = P.lane || this._lane(b.yaw);
        if (!L) { this.cool = 0.4; this.last = 'charge'; return; }
        const c = b.nav.cast(b.pos.x, b.pos.z, b.yaw, 34);   // re-cast from where it actually stands now
        if (c.dist < HZ.chargeMin) { this.cool = 0.4; this.last = 'charge'; return; }
        p = { x: r3(b.pos.x), y: r3(y), z: r3(b.pos.z), yaw: r3(b.yaw), L: r3(c.dist), wall: c.wall ? 1 : 0, v: HZ.chargeSpeed[ph], stun: 1 };
        act = chargeTime(p);
        rec = HZ.stun[ph];
        break;
      }
      case 'crablets': {
        const n = ph >= 3 ? 5 : 3;
        p = { n };
        this.cd.crablets = 14 * this.pace;
        break;
      }
      case 'frenzy': {
        const roomy = b.nav.wallClear(b.pos.x, b.pos.z) >= 5 && b.nav.floorClear(b.pos.x, b.pos.z) >= 3.9;
        p = { x: r3(b.pos.x), y: r3(y), z: r3(b.pos.z), rot0: r3(this.rnd() * Math.PI * 2), spin: roomy ? 1 : 0, stun: 1 };
        this.cd.frenzy = 11 * this.pace;
        break;
      }
    }
    const rec0 = { id: P.id, t0: r3(b.bt), s: (this.rnd() * 1e9) >>> 0, d: [r3(tele), r3(act), r3(rec)], p };
    b.move = rec0;
    b.hz.add(rec0);
    G.netm?.recBoss(['bm', rec0]);
    this._spawned = false;
  }

  // ---------------------------------------------------------------------------------------------- playing a move
  _runMove(dt) {
    const b = this.b, m = b.move, u = b.bt - m.t0, T = moveTimes(m), p = m.p;
    if (u >= T.end) {
      b.move = null; this.last = m.id;
      this.cool = (COOL[b.phase] + this.rnd() * COOL_RND[b.phase]) * this.pace;
      this.goalT = 0;
      return;
    }
    switch (m.id) {
      case 'charge': {
        const s = chargeDist(p, u, T.tele);
        b.pos.x = p.x + Math.sin(p.yaw) * s; b.pos.z = p.z + Math.cos(p.yaw) * s; b.yaw = p.yaw;
        break;
      }
      case 'sweep':
        // the body leans into the beam a little (the cannon does the rest)
        if (u >= T.tele && u <= T.tele + T.act) {
          const want = p.c + angleDiff(p.c, beamAngle(m, u)) * 0.5;
          if (b.nav.turnOk(b.pos.x, b.pos.z, want)) b.yaw = want;
        }
        break;
      case 'frenzy':
        if (p.spin && u >= T.tele && u <= T.tele + T.act) b.yaw += dt * 4.2 * Math.min(1, (u - T.tele) / 0.4, (T.tele + T.act - u) / 0.4);
        break;
      case 'crablets':
        if (!this._spawned && u >= T.tele) { this._spawned = true; this._spawnCrabs(p.n); }
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------- crablets (host)
  _spawnCrabs(n) {
    const b = this.b, bx = -Math.sin(b.yaw), bz = -Math.cos(b.yaw);
    for (let i = 0; i < n; i++) {
      const side = (i - (n - 1) / 2) * 1.1, x0 = b.pos.x + bx * 3.6 + bz * side, z0 = b.pos.z + bz * 3.6 - bx * side;
      let x = x0, z = z0, g = G.level.groundHeight(x, z, b.pos.y + 1.5);
      if (!(g > PLAYER.waterY) || b.nav.inPad(x, z, 0.8)) { x = b.pos.x + bz * side; z = b.pos.z - bx * side; g = b.pos.y; }
      const c = { id: this.crabSeq++, x, y: g, z, yaw: b.yaw + Math.PI + side * 0.4, hp: HZ.crabHp, age: 0, tgt: -1, speed: 0, dead: false, retgt: 0 };
      b.crabs.set(c.id, c);
      G.fx?.burst(_v.set(x, g + 0.4, z), undefined, G.teamColors[1], { count: 8, speed: 3.5, size: 0.1 });
    }
  }

  _crabs(dt) {
    const b = this.b, nav = b.nav, L = G.level, sp = HZ.crabSpeed[b.phase] || HZ.crabSpeed[2];
    for (const c of b.crabs.values()) {
      if (c.dead) continue;
      c.age += dt; c.retgt -= dt;
      if (c.age > HZ.crabLife) { b.crabPop(c, false); continue; }
      if (c.retgt <= 0) {
        c.retgt = 0.4;
        let best = null, bd = 30;
        for (const a of G.actors) {
          if (!a.alive || a.team !== 0 || nav.inPad(a.pos.x, a.pos.z, 0.5)) continue;
          const d = Math.hypot(a.pos.x - c.x, a.pos.z - c.z);
          if (d < bd) { bd = d; best = a; }
        }
        c.tgt = best ? best.nid ?? best.slot : -1;
      }
      const t = c.tgt >= 0 ? G.actors.find((a) => (a.nid ?? a.slot) === c.tgt) : null;
      if (t && t.alive && Math.hypot(t.pos.x - c.x, t.pos.z - c.z) < 1.05 && Math.abs(t.pos.y - c.y) < 1.3) { b.crabPop(c, false); continue; }
      let moved = false;
      if (t && t.alive) {
        const want = Math.atan2(t.pos.x - c.x, t.pos.z - c.z);
        for (const o of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const yaw = want + o, nx = c.x + Math.sin(yaw) * sp * dt, nz = c.z + Math.cos(yaw) * sp * dt;
          if (nav.inPad(nx, nz, 0.8)) continue;
          const g = L.groundHeight(nx, nz, c.y + 0.7);
          if (!(g > PLAYER.waterY + 0.3) || g < c.y - 1.4 || L.pointInside(_v.set(nx, g + 0.3, nz), 0)) continue;
          c.x = nx; c.z = nz; c.y += (g - c.y) * Math.min(1, dt * 12);
          c.yaw += angleDiff(c.yaw, yaw) * Math.min(1, dt * 10);
          moved = true; break;
        }
      }
      c.speed += ((moved ? sp : 0) - c.speed) * Math.min(1, dt * 8);
    }
  }
}
