// ============================================================================
// 【中文导读】在线会话 —— 房间、大厅与开赛编排,对外的门面就是 G.net
// ----------------------------------------------------------------------------
// 【模块定位】联机层的「大脑」。菜单/UI 只与 G.net(本类的实例)对话;本类在 transport.js(字节流)之上,
//   在 netmatch.js(比赛内同步)之上。由 installNet() 在启动时挂到 G.(见 main.js),生命周期贯穿整个页面。
//   离线时不安装本类,而由 mock.js 的 MockNet 顶替(?netmock=1),二者 API 完全一致。
// 【权威模型】中继只做成员管理与主机选举(见 server/src/index.js):主机 = 房间里最老的成员(relay 选)
//   = 房主。房主是**大厅权威**:玩家把自身改动发给房主,房主校验(队伍平衡、仅房主可改的设置)后把
//   **整份 lobby** 广播回去;因此每个客端的 lobby 都是房主状态的镜像,不存在冲突合并。比赛开始后
//   大厅编排让位于 netmatch.js 的逐帧复制(那里另有「谁拥有谁」的权威模型)。
// 【状态机】state: offline → connecting → lobby → starting → match → lobby …… 或任意阶段 → error。
//   开赛是两段握手:房主广播 roster(k:'start') → 每个客户端建场景后回报就绪(k:'ready') → 房主收到齐员
//   广播 k:'go'→ 所有端同时 _launch 进 match。纯PC保留12秒兜底；手机参与时等待实际预热完成。
// 【关键约定】房号 5 字符、剔除易混字符(O/0、I/1)与 WASD(菜单光标键);errorCode 是稳定错误码,
//   逻辑只比它(src/net/errors.js),error 仅为英文兜底文本。setMe 是**请求**:客端先本地乐观回显,
//   最终以房主广播为准。比赛中途离开者由主机上的 Bot 顶替(见 netmatch.js onLeave)。
// 【配套阅读】docs/NET.zh-CN.md(会话契约)、src/net/transport.js、src/net/netmatch.js、src/net/errors.js、
//   src/net/mock.js、server/src/index.js。
// ============================================================================
// Online session: rooms, the lobby and match orchestration (contract: docs/NET.md). Exposed as G.net.
//
// The host (the room's oldest member, elected by the relay) owns the lobby: players send their own changes to the
// host, the host validates them (team balance, host-only settings) and broadcasts the whole lobby. Starting a match
// sends one roster to everyone; every client builds the stage, reports ready, and the host says go — so intros start
// together. In the match NetMatch (netmatch.js) does the replication.
import { G, emit } from '../core/ctx.js';
import { MAPS, WEAPONS, WEAPON_ORDER, SUBS, SUB_ORDER, SPECIALS, SPECIAL_ORDER, MATCH, ZONES, BOT_NAMES, TEAM_PALETTES, mapNoBots, mapBossOk, bossFallbackMap, noBotsStartBlock } from '../config.js';
import { randomStyle } from '../game/character-style.js';
import { Transport } from './transport.js';
import { NetMatch } from './netmatch.js';
import { ERR, netError, codeFromText } from './errors.js';

// no 0/O or 1/I (misread), and no W/A/S/D: those move the menu cursor, so any other key typed on the online hub can
// only mean a room code (28⁵ ≈ 17 M codes)
// 【房号字母表】剔除易混字符(O/0、I/1)以及 WASD —— 后者在在线枢纽里是菜单光标键,故除房号外的任意键
//   都只可能是在输入房号。28⁵ ≈ 1700 万个码,足够稀疏。
const CODE_CHARS = 'BCEFGHJKLMNPQRTUVXYZ23456789';
const TEAM = 4;
// 【配装归一】sub/special 取「已知 id」或 null(null = 用武器自带的副武器/大招);非法 id 一律归 null
// a loadout's sub / special: a known id, or null (= the weapon's own)
const subOf = (id) => (SUBS[id] ? id : null), specialOf = (id) => (SPECIALS[id] ? id : null);

export class NetSession {
  // 【构造】初始为 offline;lobby 先建一份空白(_blankLobby),让 UI 永远有可读对象。
  //   _members 是「谁真的连着」的中继权威名单(与 lobby.players 不同:后者是房主维护的游戏内名单)。
  constructor() {
    this.state = 'offline';
    this.code = null;
    this.myId = null;
    this.hostId = null;
    this.error = null;         // last failure, for logs / fallback text
    this.errorCode = null;     // stable code for the same failure (src/net/errors.js) — what the UI keys off
    this.lobby = this._blankLobby();
    this._subs = new Map();
    this.tr = null;
    this.match = null;          // NetMatch while playing
    this._members = new Map();  // relay membership (id → name), authoritative for who is connected
    this._startCfg = null;
    this._botsPref = null;      // host: the "fill with bots" choice, kept while a humans-only stage forces bots off
  }

  // 【身份判断】isHost 直接比较 myId 与 hostId;active 表示「真的在打」(match 存在且状态为 match)
  get isHost() { return !!this.myId && this.myId === this.hostId; }
  get active() { return this.state === 'match' && !!this.match; }

  // ------------------------------------------------------------------ events
  // 【订阅】on(ev, fn) 返回退订函数;集合按事件名分组
  on(ev, fn) {
    let s = this._subs.get(ev);
    if (!s) this._subs.set(ev, (s = new Set()));
    s.add(fn);
    return () => s.delete(fn);
  }
  // 【派发】复制一份订阅集再遍历(允许回调里退订);单个回调抛错不影响其他订阅者
  _emit(ev, data) {
    const s = this._subs.get(ev);
    if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error('[net]', ev, e); } }
  }
  // 【状态迁移】仅在变化时派发 'state';所有状态切换都走这里,保证 UI 不丢帧、不重复
  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this._emit('state', { state: s });
  }

  // 【空白大厅】以当前离线设置(地图/时段/时长/难度/调色板)为默认,继承菜单里的选择到房间
  _blankLobby() {
    const g = G.game;
    // palette: the room's team colours (index into TEAM_PALETTES) — the host's current menu colours carry into the room
    // mode: 'turf' | 'zones' (Zone Control: the host runs the rules — zones.js) | 'boss' (Boss Battle: everyone is one
    // squad vs HULLBREAKER — docs/BOSS.md)
    const map = g?.mapDef?.id || MAPS[0].id;
    return { map, time: g?.time || 'day', duration: g?.settings?.matchLength || MATCH.defaultDuration, bots: !mapNoBots(map), difficulty: g?.settings?.difficulty || 'normal', palette: g?.paletteIndex?.() ?? 0, mode: 'turf', players: [], maxPlayers: TEAM * 2 };
  }

  // 【本机档案】从离线 profile 归一出一份加入时上报的身份(名字截 16、配装取合法值);客端加入时发给房主
  _profile() {
    const p = G.game?.profile || {};
    return { name: (p.name || 'Player').slice(0, 16), weapon: WEAPONS[p.weapon] ? p.weapon : 'shooter', sub: subOf(p.sub), special: specialOf(p.special), style: p.style || null, waitForReady: !!globalThis.inkwaveMobile };
  }

  // ------------------------------------------------------------------ rooms
  // 【建房】随机生成 5 位房号 → _connect(create=true);房号被占用(ERR_CODE_TAKEN)时重试,最多 4 次。
  //   重试只看**错误码**、不看文案 —— 这正是错误码解耦的意义。成功返回房号,失败设 error 并抛原错误。
  async create(name) {
    let lastErr = null;
    for (let tries = 0; tries < 4; tries++) {
      const code = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
      // the retry loop keys off the error *code*, so the message wording is free to be translated
      try { await this._connect(code, name, true); return code; } catch (e) { lastErr = e; if (e.code !== ERR.CODE_TAKEN) break; }
    }
    this._fail(lastErr);
    throw lastErr;
  }

  // 【加入】先清洗房号(大写、去非字母数字);不足 4 位直接判 ERR_NOT_FOUND(省一次网络往返)。
  //   失败时 _fail 置 errorCode 并抛带 code 的错误,由菜单用 i18n 表展示。
  async join(code, name) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { const e = netError(ERR.NOT_FOUND, 'Room not found'); this._fail(e); throw e; }
    try { await this._connect(code, name, false); } catch (e) { this._fail(e); throw e; }
  }

  // 【建连(共用）】先静默清场 → 建 Transport 并挂钩子 → 等 welcome 帧拿到自身 id / 房主 id / 成员名单。
  //   随后初始化大厅:房主自建玩家条目并平衡队伍;客端把身份发给房主等待 lobby 广播。
  async _connect(code, name, create) {
    this.leave(true);
    this.error = null;
    this._setState('connecting');
    const tr = (this.tr = new Transport());
    tr.onControl = (o) => this._control(o);
    tr.onMessage = (from, d) => this._message(from, d);
    tr.onClose = (reason) => this._closed(reason);
    const me = this._profile();
    const welcome = await tr.connect(code, name || me.name, create);
    this.code = code;
    this.myId = welcome.id;
    this.hostId = welcome.host;   // relay 选出的房主 = 房间里最老的成员
    this._members.clear();
    for (const m of welcome.members) this._members.set(m.id, m.name);
    this.lobby = this._blankLobby();
    this._botsPref = this.isHost ? true : null;   // a new room fills with bots unless its stage forbids them
    if (this.isHost) {
      // 【房主开局】新房主自建第一个玩家条目(带上外观/配装)并平衡队伍;客端等房主广播
      this.lobby.players = [this._newPlayer(this.myId, name || me.name, { weapon: me.weapon, sub: me.sub, special: me.special, style: me.style, waitForReady: me.waitForReady })];
      this._fixTeams();
    }
    this._setState('lobby');
    // tell the host who we are (the host already knows itself)
    // 【客端自报身份】房主已自建条目;客端把 name/配装/外观发给房主,房主随后广播权威 lobby
    if (!this.isHost) tr.sendTo(this.hostId, { k: 'me', name: name || me.name, weapon: me.weapon, sub: me.sub, special: me.special, style: me.style, waitForReady: me.waitForReady });
    this._pushLobby();
  }

  // 【离开】销毁比赛、关连接、清空身份与大厅。silent=true 用于内部「连前清场」,不触发状态事件
  leave(silent = false) {
    this._clearPreparation();
    this.match?.dispose(); this.match = null;
    this.tr?.close(); this.tr = null;
    const was = this.state;
    this.code = null; this.myId = null; this.hostId = null;
    this._members.clear();
    this.lobby = this._blankLobby();
    this._startCfg = null;
    if (!silent && was !== 'offline') { this._setState('offline'); this._emit('lobby', { lobby: this.lobby }); }
    else this.state = 'offline';
  }

  // 【失败出口】把任意错误收敛成 errorCode + 英文 error,关连接,切 error 状态并派发 'error' 事件 ——
  //   UI 用 errorCode 查 i18n 表显示文案。建房/加入/开赛失败都经此
  _fail(e) {
    this._clearPreparation();
    this.match?.dispose(); this.match = null;
    this.errorCode = e?.code || ERR.CONNECT;
    this.error = e?.message || 'Could not connect';
    this.tr?.close(); this.tr = null;
    this._setState('error');
    this._emit('error', { code: this.errorCode, message: this.error });
  }

  // 【连接被中继关闭】reason==='bye' 是主动退出(leave→Transport.close);其余一律判为掉线(ERR_LOST)。
  //   若发生在 match/starting,额外通知 game 中止比赛(见 main.js netMatchAborted)
  _closed(reason) {
    const inMatch = this.state === 'match' || this.state === 'starting';
    const gone = reason !== 'bye';
    this._clearPreparation();
    this.errorCode = gone ? codeFromText(reason) || ERR.LOST : null;
    this.error = gone ? (reason || 'Lost connection to the room') : null;
    this.match?.dispose(); this.match = null;
    this.tr = null;
    this.code = null;
    this._setState(this.error ? 'error' : 'offline');
    if (this.error) this._emit('error', { code: this.errorCode, message: this.error });
    if (inMatch) G.game?.netMatchAborted?.(this.errorCode || this.error);
  }

  // ------------------------------------------------------------------ relay membership
  // 【成员变动】处理中继的 join/leave 控制帧 —— 这是「谁真的连着」的权威来源。
  //   join:仅房主把它加进 lobby 并重新平衡/广播;客端只记 _members,等房主的 lobby 广播。
  //   leave:任何端都先更新 _members/hostId;hostChanged 时通知 match(主机迁移)并派发 'host'。
  _control(o) {
    if (o.t === 'join') {
      this._members.set(o.m.id, o.m.name);
      if (this.isHost) {
        this.lobby.players.push(this._newPlayer(o.m.id, o.m.name, {}));
        this._fixTeams();
        this._broadcastLobby();
      }
    } else if (o.t === 'leave') {
      const gone = this.lobby.players.find((p) => p.id === o.id) || { id: o.id, name: this._members.get(o.id) || 'Player' };
      this._members.delete(o.id);
      // 【主机迁移】中继在 leave 帧里给出新的 host(最年长剩余成员);变了就切 hostId 并广播 'host'
      const hostChanged = o.host && o.host !== this.hostId;
      this.hostId = o.host;
      this.lobby.players = this.lobby.players.filter((p) => p.id !== o.id);
      for (const p of this.lobby.players) p.host = p.id === this.hostId;
      this.match?.onLeave(o.id, hostChanged);
      if (hostChanged) this._emit('host', { hostId: this.hostId });
      if (this.isHost) { this._fixTeams(); this._broadcastLobby(); }
      // 手机房间等待真实ready；有人离开后重新核对。准备期换房主时向新房主重报本机就绪。
      const preparation = this._startPreparation;
      if (this.state === 'starting' && preparation?.strict) {
        if (hostChanged && preparation.ready) {
          if (this.isHost) this._markReady(this.myId);
          else this.tr?.sendTo(this.hostId, { k: 'ready', id: this._startCfg.id });
        }
        if (this.isHost) this._checkReady();
      }
      this._emit('leave', { player: gone, reason: 'left' });
      this._pushLobby();
    }
  }

  // 【新玩家条目】默认 team='auto'、无外观时给随机风格;武器/配装取合法值。房主用它构造 lobby.players 项
  _newPlayer(id, name, o) {
    return { id, name: (name || 'Player').slice(0, 16), team: 'auto', weapon: WEAPONS[o.weapon] ? o.weapon : 'shooter', sub: subOf(o.sub), special: specialOf(o.special), style: o.style || randomStyle(), ready: false, host: id === this.hostId, ping: 0, waitForReady: !!o.waitForReady };
  }

  // host: honour team requests while keeping ≤ 4 a side, then place everyone still on 'auto' on the smaller side
  // 【队伍平衡】先满足显式请求(满 4 的一侧被退回 auto),再把所有 auto 的人放进较空一侧;最后刷新 host 标记。
  //   房主每改一次 lobby 都重跑它,保证任何时刻每队 ≤ 4。
  _fixTeams() {
    const ps = this.lobby.players;
    const count = [0, 0];
    for (const p of ps) if (p.team === 0 || p.team === 1) { if (count[p.team] < TEAM) count[p.team]++; else p.team = 'auto'; }
    for (const p of ps) if (p.team === 'auto') { const t = count[0] <= count[1] ? 0 : 1; p.team = t; count[t]++; }
    for (const p of ps) p.host = p.id === this.hostId;
  }

  // 【广播大厅】仅房主可调:把 _wireLobby() 序列化后广播给全房,再本地 push
  _broadcastLobby() {
    if (!this.isHost || !this.tr) return;
    this.tr.broadcast({ k: 'lobby', l: this._wireLobby() });
    this._pushLobby();
  }
  // 【线上大厅格式】逐字段挑出要过网的字段(不含 you/host 等本地派生标记,但保留 host 用于客端对齐)
  _wireLobby() {
    const l = this.lobby;
    return { map: l.map, time: l.time, duration: l.duration, bots: l.bots, difficulty: l.difficulty, palette: l.palette, mode: l.mode, players: l.players.map(({ id, name, team, weapon, sub, special, style, ready, ping, waitForReady }) => ({ id, name, team, weapon, sub, special, style, ready, ping, waitForReady })) };
  }
  // local view: mark you + host
  // 【本地视图】派发前刷新 you/host 派生标记(每个人看到「哪个是自己」「哪个是房主」都由本地计算,不过网)
  _pushLobby() {
    for (const p of this.lobby.players) { p.you = p.id === this.myId; p.host = p.id === this.hostId; }
    this._emit('lobby', { lobby: this.lobby });
  }

  // ------------------------------------------------------------------ lobby actions
  // 【改自己】把自身改动归一后应用。房主直接 _applyMe;客端先本地乐观回显(name/weapon/sub/special/style/ready
  //   这些房主不会拒绝的项),再把请求发给房主 —— 队伍请求(team)不做乐观回显,因为房主可能因满员拒绝。
  setMe(ch = {}) {
    if (!this.tr || !this.myId) return;
    const o = {};
    if (ch.name != null) o.name = String(ch.name).slice(0, 16);
    if (ch.weapon && WEAPONS[ch.weapon]) o.weapon = ch.weapon;
    if (ch.sub !== undefined) o.sub = subOf(ch.sub);
    if (ch.special !== undefined) o.special = specialOf(ch.special);
    if (ch.style) o.style = ch.style;
    if (ch.ready != null) o.ready = !!ch.ready;
    if (ch.team === 0 || ch.team === 1 || ch.team === 'auto') o.team = ch.team;
    if (this.isHost) this._applyMe(this.myId, o);
    else {
      // optimistic local echo for things the host won't refuse
      const me = this.lobby.players.find((p) => p.id === this.myId);
      if (me) { for (const k of ['name', 'weapon', 'sub', 'special', 'style', 'ready']) if (o[k] !== undefined) me[k] = o[k]; this._pushLobby(); }
      this.tr.sendTo(this.hostId, { k: 'me', ...o });
    }
  }

  // 【房主应用改动】把一份改动打到指定玩家上;换队仅在目标队未满时接受(否则丢弃,保持平衡)
  _applyMe(id, o) {
    const p = this.lobby.players.find((x) => x.id === id);
    if (!p) return;
    if (o.name) p.name = o.name;
    if (o.weapon && WEAPONS[o.weapon]) p.weapon = o.weapon;
    if (o.sub !== undefined) p.sub = subOf(o.sub);
    if (o.special !== undefined) p.special = specialOf(o.special);
    if (o.style) p.style = o.style;
    if (o.ready != null) p.ready = !!o.ready;
    if (o.ping != null) p.ping = Math.round(o.ping);
    if (typeof o.waitForReady === 'boolean') p.waitForReady = o.waitForReady;
    if (o.team === 'auto') p.team = 'auto';
    else if (o.team === 0 || o.team === 1) {
      const n = this.lobby.players.filter((x) => x !== p && x.team === o.team).length;
      if (n < TEAM) p.team = o.team;
    }
    this._fixTeams();
    this._broadcastLobby();
  }

  // 【房主设置】仅房主可调,字段逐项校验。含两处**地图规则**(config 的 MAPS 标志):
  //   ① Boss Battle 不能在 noBoss 图上跑 —— boss 模式下选到该图会换回 bossFallbackMap;
  //   ② noBots 的图强制关闭 Bot —— 但房主的 _botsPref 选择被记住,换到别的图后恢复
  setSettings(s = {}) {
    if (!this.isHost) return;
    const l = this.lobby, wasMap = l.map;
    if (s.map && MAPS.some((m) => m.id === s.map)) l.map = s.map;
    if (s.time === 'day' || s.time === 'dusk') l.time = s.time;
    if (s.duration) l.duration = Math.max(60, Math.min(600, +s.duration | 0));
    if (s.bots != null) this._botsPref = !!s.bots;
    if (s.difficulty && ['easy', 'normal', 'hard'].includes(s.difficulty)) l.difficulty = s.difficulty;
    if (Number.isInteger(s.palette) && s.palette >= 0 && s.palette < TEAM_PALETTES.length) l.palette = s.palette;
    if (s.mode === 'turf' || s.mode === 'zones' || s.mode === 'boss') l.mode = s.mode;
    // stage rules (config MAPS flags): a Boss Battle never runs on a noBoss stage — picking one in boss mode is refused,
    // switching a room on one to boss mode moves it to a boss-eligible stage; a noBots stage forces bots off (the host's
    // own choice comes back on the next stage)
    if (l.mode === 'boss' && !mapBossOk(l.map)) l.map = bossFallbackMap(wasMap);
    l.bots = mapNoBots(l.map) ? false : (this._botsPref ?? l.bots);
    this._broadcastLobby();
  }

  // 【能否开赛】房主专属:无硬性阻拦(startBlock)且除自己外所有人已就绪(房主视为已就绪)
  canStart() {
    if (!this.isHost || this.state !== 'lobby') return false;
    return !this.startBlock() && this.lobby.players.every((p) => p.ready || p.id === this.myId);
  }
  // why the room can't start regardless of ready-ups (a humans-only stage without 2+ players, one per side), else null
  // 【硬性阻拦】与就绪无关的原因:人类的专用图(noBots)不满 2 人(每侧各一)时的说明文本,否则 null
  startBlock() { return noBotsStartBlock(this.lobby); }

  // 【表情】向全房广播一个大厅表情,并本地立即回显(含自己);名字截 16 且由名字集合约束
  emote(name) {
    if (!this.tr || !this.myId) return;
    this.tr.broadcast({ k: 'emote', n: String(name).slice(0, 16) });
    this._emit('emote', { id: this.myId, name });
  }

  // ------------------------------------------------------------------ match orchestration
  // 【开赛(房主)】按 lobby 生成 roster:人类按队入列,需补位时给每队填 Bot(武器尽量不重、约一半带随机
  //   副武器/大招)。然后:锁房(拒新加入)→ 广播 k:'start' → 本地 _begin。roster 里每个 nid 是全场唯一
  //   actor 编号,owner 标明谁权威模拟它(Bot 归房主)。
  start() {
    if (!this.isHost || this.state !== 'lobby' || !this.tr || this.startBlock()) return false;
    const l = this.lobby;
    const bots = l.bots && !mapNoBots(l.map);   // (a humans-only stage never gets bots, whatever the setting says)
    const roster = [];
    let nid = 0;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const boss = l.mode === 'boss' && mapBossOk(l.map);   // one squad of up to 8 (all team 0), bots fill the rest
    for (let team = 0; team < (boss ? 1 : 2); team++) {
      const humans = boss ? l.players : l.players.filter((p) => p.team === team);
      const weapons = [...WEAPON_ORDER].sort(() => Math.random() - 0.5);
      let slot = 0;
      for (const p of humans) roster.push({ nid: nid++, owner: p.id, bot: false, team, slot: slot++, name: p.name, weapon: p.weapon, sub: subOf(p.sub), special: specialOf(p.special), style: p.style });
      if (bots) {
        while (slot < (boss ? TEAM * 2 : TEAM)) {
          const used = new Set(roster.filter((r) => r.team === team).map((r) => r.weapon));
          const wpn = weapons.find((w) => !used.has(w)) || weapons[slot % weapons.length];
          // bots carry a random sub / special about half the time, as offline (else their weapon's own)
          const sub = Math.random() < 0.5 ? null : SUB_ORDER[(Math.random() * SUB_ORDER.length) | 0];
          const special = Math.random() < 0.5 ? null : SPECIAL_ORDER[(Math.random() * SPECIAL_ORDER.length) | 0];
          roster.push({ nid: nid++, owner: this.myId, bot: true, team, slot: slot++, name: names.pop() || 'Bot', weapon: wpn, sub, special, style: randomStyle() });
        }
      }
    }
    // (Zone Control always runs its own 5:00 + overtime, as offline)
    const cfg = { k: 'start', roster, map: l.map, time: l.time, duration: !boss && l.mode === 'zones' ? ZONES.duration : l.duration, difficulty: l.difficulty, palette: l.palette, mode: boss ? 'boss' : l.mode === 'zones' ? 'zones' : 'turf', host: this.myId, id: Math.random().toString(36).slice(2, 8) };
    // 只有手机参与才取消12秒强制放行；纯PC房间继续使用原来的超时策略。附加字段不改中继信封。
    if (globalThis.inkwaveMobile || l.players.some(player => player.waitForReady)) cfg.waitForReady = true;
    this.tr.lock(true);
    this.tr.broadcast(cfg);
    this._begin(cfg);
    return true;
  }

  // 【开赛第二步】两端(房主广播后本地、客端收 'start' 后)都跑:清就绪 → 切 starting → 等大厅倒计时动画
  //   (launchLobby)→ 建 NetMatch → 让 game 建场景(startNetMatch)。随后房主自报就绪、客端发 'ready'。
  async _begin(cfg) {
    this._clearPreparation();
    this._startCfg = cfg;
    const preparation = this._startPreparation = { ready: false, pendingGo: false, strict: !!(cfg.waitForReady || globalThis.inkwaveMobile) };
    this._ready = new Set();
    for (const p of this.lobby.players) p.ready = false;
    this._setState('starting');
    this._emit('match', { phase: 'start' });
    // the lobby plays its 3·2·1 + super-jump launch first (resolves at once when the lobby isn't on screen)
    try { await G.game?.menus?.launchLobby?.(); } catch (e) { console.warn('[net] launch', e); }
    // 【防竞态】等待期间若状态已离开 starting 或 cfg 被换(如中途退房),放弃本次开赛
    if (this.state !== 'starting' || this._startCfg !== cfg) return;
    const match = this.match = new NetMatch(this, cfg);
    try {
      const prepared = await G.game.startNetMatch(cfg, match);
      if (prepared === false) {
        // 入口准备锁拒绝/取消时不能把它伪报成完成；已离房的旧任务则静默结束。
        if (this._startPreparation === preparation && this.match === match && this._startCfg === cfg) this._fail(netError(ERR.MATCH_START, 'Could not start the match'));
        return;
      }
    } catch (e) {
      if (this._startPreparation !== preparation || this.match !== match || this._startCfg !== cfg) return;
      console.error('[net] match start failed', e);
      this._fail(netError(ERR.MATCH_START, 'Could not start the match'));
      return;
    }
    // 预热会跨很多帧；离房/掉线/换局后不能让旧Promise再报告ready或启动已销毁的比赛。
    if (this._startPreparation !== preparation || this.match !== match || this._startCfg !== cfg || !['starting', 'match'].includes(this.state)) return;
    preparation.ready = true;
    if (this.isHost) this._markReady(this.myId);
    else this.tr?.sendTo(this.hostId, { k: 'ready', id: cfg.id });
    if (preparation.pendingGo && this.state === 'starting') this._launch();
  }

  _clearPreparation() {
    clearTimeout(this._goT); this._goT = null;
    this._startPreparation = null;
    this._startCfg = null;
    this._ready = null;
  }

  // 【就绪汇聚(房主)】收齐所有人类的『就绪』后 _go。加载期间已离开的人(不在 _members)自动算就绪,
  //   手机房间不把慢预热当成就绪；纯PC保留12秒兜底。断开者从实际等待名单中剔除。
  _markReady(id) {
    if (!this.isHost || this.state !== 'starting' || !this._startCfg) return;
    if (!this._startCfg.roster.some(actor => !actor.bot && actor.owner === id)) return;
    this._ready.add(id);
    this._checkReady();
  }

  _checkReady() {
    if (!this.isHost || this.state !== 'starting' || !this._startCfg) return;
    const humans = new Set(this._startCfg.roster.filter((r) => !r.bot).map((r) => r.owner));
    for (const h of humans) if (!this._members.has(h) && h !== this.myId) this._ready.add(h);   // left while loading
    const all = [...humans].every((h) => this._ready.has(h));
    if (all) this._go();
    else if (!this._startPreparation?.strict && !this._goT) {
      const cfg = this._startCfg;
      this._goT = setTimeout(() => { if (this._startCfg === cfg) this._go(); }, 12000);
    }
  }

  // 【发令】房主广播 k:'go',所有人(含房主)同时 _launch,保证 intro 同帧起跑
  _go() {
    clearTimeout(this._goT); this._goT = null;
    if (this.state !== 'starting') return;
    // 不能通过迟到的旧定时器绕过手机房间的ready条件。
    if (this._startPreparation?.strict && (!this._startPreparation.ready || this._startCfg.roster.some(actor => !actor.bot && (actor.owner === this.myId || this._members.has(actor.owner)) && !this._ready.has(actor.owner)))) return;
    this.tr?.broadcast({ k: 'go', id: this._startCfg.id });
    this._launch();
  }

  // 【真正起跑】切 match 状态、让 NetMatch 开始出帧、通知 game(解冻比赛逻辑)
  _launch() {
    if (this.state !== 'starting') return;
    if (this._startPreparation?.strict && !this._startPreparation.ready) {
      // 旧房主可能仍发送12秒兜底go；先记下，等本机bind完成，绝不启动未准备的比赛。
      this._startPreparation.pendingGo = true; return;
    }
    this._setState('match');
    this.match?.go();
    G.game.netMatchGo?.();
  }

  // the match's results have been shown: everyone back to the lobby (the room stays)
  // 【回到大厅】比赛结算展示完毕后调用:销毁 NetMatch、房主开锁并重置就绪、所有人切回 lobby(房间不散)
  endMatch() {
    this._clearPreparation();
    this.match?.dispose(); this.match = null;
    this._startCfg = null;
    if (!this.tr) return;
    if (this.isHost) { this.tr.lock(false); for (const p of this.lobby.players) p.ready = false; this._broadcastLobby(); }
    this._setState('lobby');
    this._emit('match', { phase: 'end' });
    this._pushLobby();
  }

  // ------------------------------------------------------------------ incoming payloads
  // 【收包分发】大厅期内的所有对端负载。房主专属消息(me/ready)只在 isHost 时处理;lobby/start/go 只认房主来源;
  //   未识别的 k 一律转给 match(比赛期的 t/hit/dh/... 都从这里过)
  _message(from, d) {
    if (!d || typeof d !== 'object') return;
    switch (d.k) {
      case 'lobby':
        if (from !== this.hostId) return;
        {
          const l = d.l;
          this.lobby.map = l.map; this.lobby.time = l.time; this.lobby.duration = l.duration; this.lobby.bots = l.bots; this.lobby.difficulty = l.difficulty;
          if (Number.isInteger(l.palette)) this.lobby.palette = l.palette;
          this.lobby.mode = l.mode === 'boss' || l.mode === 'zones' ? l.mode : 'turf';
          // 【名单 diff】与上一份对比,对新增者派发 'join'(入场动画用);整份替换为房主的权威名单
          const prev = new Map(this.lobby.players.map((p) => [p.id, p]));
          this.lobby.players = l.players.map((p) => ({ ...p, host: p.id === this.hostId }));
          for (const p of this.lobby.players) if (!prev.has(p.id)) this._emit('join', { player: p });
          this._pushLobby();
        }
        break;
      case 'me': if (this.isHost) this._applyMe(from, d); break;
      case 'emote': this._emit('emote', { id: from, name: d.n }); break;
      case 'start': if (from === this.hostId && this.state === 'lobby') this._begin(d); break;
      case 'ready': if (this.isHost && this._startCfg && d.id === this._startCfg.id) this._markReady(from); break;
      case 'go': if (from === this.hostId && this.state === 'starting' && d.id === this._startCfg?.id) this._launch(); break;
      default: this.match?.onMessage(from, d);
    }
  }

  // ------------------------------------------------------------------ per frame
  // 【每帧】大厅期每 2 秒采集一次 ping 并同步(RTT 由 Transport 维护);比赛期把时间交给 NetMatch
  update(dt) {
    if (this.tr && this.state === 'lobby') {
      this._pingT = (this._pingT || 0) - dt;
      if (this._pingT <= 0) {
        this._pingT = 2;
        const ping = Math.round(this.tr.rtt);
        if (this.isHost) { const me = this.lobby.players.find((p) => p.id === this.myId); if (me && me.ping !== ping) { me.ping = ping; this._broadcastLobby(); } }
        else this.tr.sendTo(this.hostId, { k: 'me', ping });
      }
    }
    this.match?.update(dt);
  }
}

// 【安装】把 NetSession 挂到 G.net(?netmock=1 时 menus 可能已装了 MockNet,则不予覆盖),派发 'net:ready'
export function installNet() {
  if (!G.net) G.net = new NetSession();   // ?netmock=1 (menus) may already have installed the offline stand-in
  emit('net:ready', { net: G.net });
  return G.net;
}
