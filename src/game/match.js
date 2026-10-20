// Match: turf-war rules, lifecycle (intro → countdown → play → time's up → judge → results), team setup.
// ============================================================
// 【中文导读】match.js —— 对局中枢(两模式对局流程的状态机)
// 职责:
//   1) 管理一场对局的完整生命周期:init → intro(开场) → playing(进行) → finish(时间到)
//      → judge(裁判结算) → results(结果展示,由 HUD 监听事件驱动)。
//   2) 组队与出兵:按配置生成双队 Actor(本地玩家 + Bot),分配武器/副武器/大招/外观,
//      摆放到各自出生台的环绕位置;attract(展示)与 practice(练习)模式降级为无对抗的 turf。
//   3) 模式分发:turf(涂地,比覆盖率)/ zones(区域控制,委托 zones.js 的 ZoneControl)/
//      boss(单队讨伐 BOSS,委托 boss/bossMode.js)。
//   4) 每帧推进:状态计时、倒计时广播、Bot 意图清空(非 playing 时)、Actor 更新、
//      在线模式远程玩家插值(netm.applyRemote)、Actor 之间的软推挤。
// 与其他模块的关系:
//   · actor.js(Actor 实体)、bots.js(BotBrain 驱动 Bot)、player.js(PlayerController 驱动本地玩家)
//   · zones.js(ZoneControl,mode='zones' 时挂在 this.zones)、boss/bossMode.js(boss 模式)
//   · 通过 ctx.js 的 emit/on 广播 match:state / match:oneminute / match:count 等事件,
//     HUD、小地图、音频都订阅这些事件;胜负数据由 _judge() 汇总进 this.result。
// 在线:setup 走 _setupRoster(由主机下发的 roster 建队),follower(客机)不本地裁决,
//   只回放主机结果(netm.sendResult / netm.applyRemote)。
// ============================================================
import * as THREE from 'three';
import { G, emit, on, clamp } from '../core/ctx.js';
import { MATCH, PLAYER, WEAPON_ORDER, SUB_ORDER, SPECIAL_ORDER, BOT_NAMES, TEAM_NAMES, ZONES } from '../config.js';
import { ZoneControl } from './zones.js';
import { randomStyle } from './character-style.js';
import { Actor } from './actor.js';
import { BotBrain } from './bots.js';
import { PlayerController } from './player.js';
import { BossMode, BOSS_MODE } from '../boss/bossMode.js';

const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Match {
  // 保存对局配置并初始化状态机；展示与练习模式统一使用涂地规则。
  constructor(opts) {
    this.opts = opts;          // { duration, difficulty, attract, practice, playerName, weapon, CharacterClass, input, rig, mode }
    this.attract = !!opts.attract;
    this.practice = !!opts.practice;   // solo on an empty stage: no enemies, no teammates, no clock
    // turf | zones (Zone Control) | boss (one squad, team 0, vs HULLBREAKER); attract backdrops and practice are turf
    this.mode = this.attract || this.practice ? 'turf' : opts.mode === 'boss' ? 'boss' : opts.mode === 'zones' ? 'zones' : 'turf';
    this.duration = opts.duration || (this.mode === 'zones' ? ZONES.duration : this.mode === 'boss' ? BOSS_MODE.duration : MATCH.defaultDuration);
    this.zones = null;             // ZoneControl (Zone Control mode)
    this.time = this.duration;
    this.state = 'init';
    this.stateT = 0;
    this.actors = [];
    this.controller = null;
    this.result = null;
    this.paused = false;
    this.lastMinuteFired = false;
    this.lastCount = 99;
    this.events = [];
  }

  // playing 同时考虑暂停；canRespawn 只判断比赛阶段，两者的调用用途不同。
  playing() { return this.state === 'playing' && !this.paused; }
  canRespawn() { return this.state === 'playing'; }

  // 离线按配置创建阵容；提供联机名单时完全交给名单流程，避免重复创建角色。
  setup() {
    const o = this.opts;
    const CharacterClass = o.CharacterClass;
    if (o.roster) { this._setupRoster(o, CharacterClass); return; }
    // weapons: each team gets a balanced mix
    // 优先保留玩家选定武器，再从剩余池随机抽取；池耗尽后补满以支持更大队伍。
    const pickTeam = (first) => {
      const pool = [...WEAPON_ORDER];
      const out = [];
      if (first) { out.push(first); pool.splice(pool.indexOf(first), 1); }
      while (out.length < MATCH.teamSize) {
        if (!pool.length) pool.push(...WEAPON_ORDER);
        out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
      }
      return out;
    };
    const names = shuffle([...BOT_NAMES]);
    let ni = 0;
    const boss = this.mode === 'boss';
    // humans-only stage (config noBots) offline: a match is just you (the ?devstage walk), the attract backdrop nobody
    // (o.mannequins: idle, brainless kids for the render audits)
    // 开发用无 Bot 模式只保留本地角色；展示模式可额外保留不受 AI 驱动的模型。
    const noBots = !!o.noBots;
    for (let team = 0; team < (boss || this.practice ? 1 : 2); team++) {
      const weapons = pickTeam(team === 0 && !this.attract ? o.weapon : null);
      if (boss) weapons.push(...pickTeam(null));   // the whole squad on one side: 8 kids, every weapon kind
      for (let s = 0; s < (this.practice ? 1 : boss ? BOSS_MODE.squad : MATCH.teamSize); s++) {
        const isLocal = team === 0 && s === 0 && !this.attract;
        if (noBots && !isLocal && !(this.attract && o.mannequins)) continue;
        // subs: yours from the loadout; bots carry a random one (about half keep their weapon's default)
        // 本地角色沿用装备配置；Bot 随机保留武器默认配置或改用其他副武器、大招。
        const sub = isLocal ? o.sub : Math.random() < 0.5 ? null : SUB_ORDER[(Math.random() * SUB_ORDER.length) | 0];
        const special = isLocal ? o.special : Math.random() < 0.5 ? null : SPECIAL_ORDER[(Math.random() * SPECIAL_ORDER.length) | 0];
        const a = new Actor({
          team, slot: s, weapon: weapons[s], sub, special, isLocal, isBot: !isLocal,
          name: isLocal ? (o.playerName || 'You') : names[ni++ % names.length],
          // your look from the Locker (an empty style resolves from your name); bots get random looks
          style: isLocal ? { ...(o.style || {}) } : randomStyle(), CharacterClass,
        });
        if (isLocal && o.style) { /* reserved for future customisation */ }
        G.scene.add(a.character.root);
        if ((!isLocal || o.autopilot) && !(noBots && !isLocal)) a.bot = new BotBrain(a, o.difficulty);
        this.actors.push(a);
      }
    }
    G.actors = this.actors;
    this.local = this.actors.find((a) => a.isLocal) || null;
    G.local = this.local;
    if (this.local && !o.autopilot) this.controller = new PlayerController(this.local, o.rig, o.input);
    // 围绕所属出生台分散摆放角色，并将 Bot 的初始瞄准同步到角色朝向。
    // initial placement on the spawn decks (standing, no drop)
    for (const a of this.actors) {
      const pad = G.level.spawnPads[a.team];
      const ang = (a.slot / (this.mode === 'boss' ? BOSS_MODE.squad : 4)) * Math.PI * 2 + 0.6, rr = this.mode === 'boss' ? 1.7 : 1.2;
      _v.set(pad.x + Math.cos(ang) * rr, pad.y, pad.z + Math.sin(ang) * rr);
      a.spawnAt(_v, a.team === 0 ? 0 : Math.PI);
      a.invuln = 0;
      if (a.bot) { a.bot.aimYaw = a.yaw; a.bot.aimPitch = 0; }
    }
    // 保存事件取消订阅函数，销毁对局时释放，避免下局重复统计击倒事件。
    this.unsubs = [
      on('splatted', (e) => this._onSplatted(e)),
    ];
    if (this.mode === 'zones') {
      this.zones = new ZoneControl(this);
      this.unsubs.push(on('turf', (e) => this._zoneTurf(e)));
    }
    if (this.mode === 'boss') { this.bossMode = new BossMode(this); this.boss = this.bossMode.boss; }
  }

  // Online: the host's roster — who owns which squidkid (players their own, the host the bots).
  // 按主机名单还原所有角色；owner 决定本机模拟权限，客机标记 follower 禁止自行结算。
  _setupRoster(o, CharacterClass) {
    const me = o.myId;
    this.follower = !o.host;
    for (const r of o.roster) {
      // 本机仅给自己拥有的 Bot 配 AI；远程角色后续从网络状态更新。
      const mine = r.owner === me;
      const a = new Actor({ team: r.team, slot: r.slot, weapon: r.weapon, sub: r.sub || null, special: r.special || null, isLocal: mine && !r.bot, isBot: r.bot, name: r.name, style: r.style || undefined, CharacterClass });
      a.nid = r.nid; a.owner = r.owner; a.remote = !mine;
      G.scene.add(a.character.root);
      if (mine && (r.bot || o.autopilot)) a.bot = new BotBrain(a, o.difficulty);
      this.actors.push(a);
    }
    G.actors = this.actors;
    this.local = this.actors.find((a) => a.isLocal) || null;
    G.local = this.local;
    if (this.local && !o.autopilot) this.controller = new PlayerController(this.local, o.rig, o.input);
    for (const a of this.actors) {
      const pad = G.level.spawnPads[a.team];
      const ang = (a.slot / (this.mode === 'boss' ? BOSS_MODE.squad : 4)) * Math.PI * 2 + 0.6, rr = this.mode === 'boss' ? 1.7 : 1.2;
      _v.set(pad.x + Math.cos(ang) * rr, pad.y, pad.z + Math.sin(ang) * rr);
      a.spawnAt(_v, a.team === 0 ? 0 : Math.PI);
      a.invuln = 0;
      if (a.bot) { a.bot.aimYaw = a.yaw; a.bot.aimPitch = 0; }
    }
    this.unsubs = [on('splatted', (e) => this._onSplatted(e))];
    if (this.mode === 'zones') {   // Zone Control online: the host runs the rules, guests follow (zones.js netEvent)
      this.zones = new ZoneControl(this);
      this.unsubs.push(on('turf', (e) => this._zoneTurf(e)));
    }
    if (this.mode === 'boss') { this.bossMode = new BossMode(this); this.boss = this.bossMode.boss; }
  }

  // Zone Control: ink laid while standing on (or aiming into) the live zone counts as objective play (results / XP)
  // 有效涂色发生在目标区域内，或瞄准点落入区域时，累计目标贡献统计。
  _zoneTurf({ actor, area }) {
    const Z = this.zones;
    if (!Z || this.state !== 'playing' || !actor || !(area > 0)) return;
    const on = (p) => p && Z.active.zones.some((z) => inZone(z.def, p));
    if (on(actor.pos) || on(actor.aimPoint)) actor.stats.zoneTurf = (actor.stats.zoneTurf || 0) + area;
  }

  // Zone Control decided the match (knockout / overtime result): straight to time's up
  // 区域模式可提前决出胜负；记录原因后进入统一收场流程。
  endZones(winner, reason) {
    this.zoneResult = { winner, reason };
    if (this.state === 'playing') { this.time = Math.max(0, this.time); this.setState('finish'); }
  }

  // 展示与练习直接进入游玩；正式比赛先播放开场。
  start() {
    this.setState(this.attract || this.practice ? 'playing' : 'intro');
  }

  // 每次状态切换重置阶段计时，并广播给 HUD、音频等订阅方。
  setState(s) {
    this.state = s; this.stateT = 0;
    emit('match:state', { state: s, match: this });
  }

  // 移除场景节点、重置武器并释放角色及事件订阅；清空全局角色引用。
  dispose() {
    this.bossMode?.dispose(); this.bossMode = null; this.boss = null;
    for (const a of this.actors) { G.scene.remove(a.character.root); a.weaponRunner.reset(); a.character.dispose?.(); }
    this.unsubs?.forEach((u) => u());
    G.actors = [];
    G.local = null;
  }

  // Online, humans-only stage (config noBots): a player left, and nobody takes over their squidkid — it bursts into its
  // own ink and is gone. HUD squads, the minimap, specials / weapons and the judge all read this.actors (G.actors is the
  // same array), so dropping it here is all they need.
  // 无 Bot 接管的联机房间中，离开的角色从共享阵容数组移除，随后释放模型并广播移除事件。
  removeActor(a) {
    const i = this.actors.indexOf(a);
    if (i < 0) return;
    if (a.alive && a.character.root.visible) {
      _v.copy(a.pos); _v.y += 0.6;
      G.fx?.splatted(_v, a.color);
      G.fx?.burst?.(_v, _up, a.color, { count: 18, speed: 5, size: 0.1 });
      G.audio?.play?.('splat_big', { pos: a.pos, volume: 0.6 });
    }
    this.actors.splice(i, 1);
    // 观战目标退出后清空跟随对象，避免镜头继续读取已释放角色。
    if (G.rig?.spectate?.actor === a) G.rig.spectate.actor = null;   // a death cam watching them looks on at the spot
    G.scene.remove(a.character.root); a.weaponRunner.reset(); a.character.dispose?.();
    emit('actor:removed', { actor: a });
  }

  // 用已进行的比赛时间记录击倒事件，供战绩或回放式界面读取。
  _onSplatted({ victim, attacker, cause }) {
    this.events.push({ t: this.duration - this.time, victim, attacker, cause });
  }

  // 暂停时冻结整局；否则先推进比赛阶段，再模拟角色及处理互相推挤。
  update(dt) {
    if (this.paused) return;
    this.stateT += dt;
    switch (this.state) {
      case 'intro':
        if (this.stateT > (this.bossMode ? BOSS_MODE.intro : 4.2)) this.setState('playing');
        break;
      case 'playing': {
        // 练习模式不消耗比赛时间；区域加时同样停止普通倒计时，等待区域规则裁决。
        if (this.practice) break;   // practice never runs out
        if (this.zones) {
          this.zones.update(dt);
          if (this.state !== 'playing') break;         // knockout / overtime decided it
          if (this.zones.overtime) break;              // the clock stays at 0 through overtime
        }
        this.time -= dt;
        if (!this.attract) {
          // 一分钟提示只发送一次；最后倒数按整数秒去重，避免每帧重复播放。
          if (!this.lastMinuteFired && this.time <= 60 && this.duration > 60) { this.lastMinuteFired = true; emit('match:oneminute', {}); }
          const c = Math.ceil(this.time);
          if (this.time <= MATCH.finalCountdown && c !== this.lastCount && c > 0) { this.lastCount = c; emit('match:count', { n: c }); }
        }
        if (this.time <= 0) {
          this.time = 0;
          // Zone Control may go to overtime instead; online, the host calls time
          // 仅主机或离线端可因时间耗尽结束比赛；区域模式还可选择进入加时。
          if (!this.follower && (!this.zones || this.zones.timeUp())) { if (this.state === 'playing') this.setState('finish'); }
        }
        break;
      }
      // 收场动画结束后才裁决；客机等待主机结果，已有结果也不重复计算。
      case 'finish':
        if (this.stateT > (this.bossMode ? (this.bossMode.boss.dead ? BOSS_MODE.finishWin : BOSS_MODE.finishLose) : 2.6) && !this.follower && !this.result) this._judge();
        break;
    }
    // 本地输入由渲染帧入口单独更新；这里仅更新 Bot 意图及角色模拟。
    // actors (the local controller runs once per rendered frame via updateController)
    const live = this.state === 'playing';
    for (const a of this.actors) {
      if (a.bot) {
        if (live) a.bot.update(dt);
        // 开场或收场阶段主动清空 Bot 操作，避免上一帧开火、跳跃等意图残留。
        else { a.intent.move.set(0, 0, 0); a.intent.fire = a.intent.squid = a.intent.sub = a.intent.jump = a.intent.special = false; }
      }
    }
    const nm = G.netm;
    // 远程角色应用网络插值，本机拥有的角色执行本地更新，避免双重模拟。
    for (const a of this.actors) { if (a.remote && nm) nm.applyRemote(a, dt); else a.update(dt); }
    this.bossMode?.update(dt);
    // soft push between actors
    for (let i = 0; i < this.actors.length; i++) for (let j = i + 1; j < this.actors.length; j++) {
      const a = this.actors[i], b = this.actors[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dz * dz;
      const r = PLAYER.radius * 1.7;
      if (d2 < r * r && Math.abs(dy) < 1.2 && d2 > 1e-5) {
        // online: other players' squidkids are where their owners say — only your own side gives way
        // 离线双方各让一半；联机只移动本机拥有的角色，不擅自改写远程位置。
        const ka = a.remote ? 0 : b.remote ? 1 : 0.5, kb = b.remote ? 0 : a.remote ? 1 : 0.5;
        const d = Math.sqrt(d2), push = (r - d);
        a.pos.x -= (dx / d) * push * ka; a.pos.z -= (dz / d) * push * ka;
        b.pos.x += (dx / d) * push * kb; b.pos.z += (dz / d) * push * kb;
      }
    }
  }

  // 仅在比赛进行、未暂停且本地角色存活时启用输入，再交给控制器更新。
  updateController(dt) {
    if (!this.controller) return;
    this.controller.enabled = this.state === 'playing' && !this.paused && this.local.alive;
    this.controller.update(dt);
  }

  // 按模式生成结果并发送给所有客机，然后进入裁判展示阶段。
  _judge() {
    if (this.zones) {
      const Z = this.zones;
      this.result = { mode: 'zones', coverage: G.paint.coverage(), winner: Z.winner ?? (Math.random() < 0.5 ? 0 : 1), reason: Z.reason,
        counts: [Math.ceil(Z.count[0]), Math.ceil(Z.count[1])], penalty: [...Z.penalty], overtime: Z.overtime, log: Z.log };
      G.netm?.sendResult(this.result);        // online: every client shows the host's result
      this.setState('judge');
      return;
    }
    if (this.bossMode) {
      this.result = this.bossMode.result();
      G.netm?.sendResult(this.result);
      this.setState('judge');
      return;
    }
    // 涂地模式比较覆盖率；完全相等时沿用随机决胜规则。
    const cov = G.paint.coverage();
    const win = cov[0] === cov[1] ? (Math.random() < 0.5 ? 0 : 1) : cov[0] > cov[1] ? 0 : 1;
    this.result = { coverage: cov, winner: win };
    G.netm?.sendResult(this.result);        // online: every client shows the host's count
    this.setState('judge');
  }

  // 为队伍界面输出轻量摘要：武器、存活、复活倒计时、大招状态及本人标识。
  teamSummary() {
    return [0, 1].map((t) => ({
      color: G.teamHex[t],
      players: this.actors.filter((a) => a.team === t).map((a) => ({
        name: a.name, weapon: a.weaponId, alive: a.alive, respawn: a.alive ? 0 : Math.max(0, a.respawnTimer), specialReady: a.specialReady(), isSelf: a.isLocal,
      })),
    }));
  }
}

// a point on (or just above) a zone: inside one of its outlines, near its floor heights
// 先限制高度，再对区域的每个多边形做射线交点奇偶判定；命中任意一块即在区域内。
function inZone(def, p) {
  if (p.y < (def.y0 ?? -2) - 1 || p.y > (def.y1 ?? 6) + 2.5) return false;
  for (const poly of def.polys || [def.poly]) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// 原地执行 Fisher–Yates 洗牌，用于打乱 Bot 名称顺序。
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
