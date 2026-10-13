// ============================================================================
// 【中文导读】G.net 的离线替身 —— 没有中继也能跑通在线 UI
// ----------------------------------------------------------------------------
// 【模块定位】session.js(NetSession)的「假货」:API 完全一致,但把网络换成定时器模拟。menus.js 在 URL 带
//   ?netmock=1 时安装它(该次页面加载会替换掉真实会话),否则用真实的 src/net/session.js。用途:开发/演示/
//   审查在线界面,无需起中继。G.net.isMock=true 供上层识别。契约见 docs/NET.zh-CN.md。
// 【模拟什么】房间生命周期全用定时器驱动:squidkids 会加入/离开/就绪/换武器换外观/发表情,ping 在抖动,
//   当你是访客时由一个模拟房主在全员就绪后开赛,比赛"跑"几秒后所有人回大厅。
// 【魔法房号】join() 用特殊码触发失败路径:ZZZZZ → ERR_NOT_FOUND · FULLY → ERR_FULL · BUZYY → ERR_IN_PROGRESS
//   · NETXX → ERR_CONNECT。其它合法码都以访客身份加入别人(模拟)的房间。错误同样走错误码(errors.js)
// 【URL 旋钮】?mockauto=0(冻结时间线) · ?mockfill=N(建房/加入时房里已有 N 人) · ?mocklat=ms(连接延迟,
//   默认 700) · ?mockmatch=s(比赛时长,默认 6 秒)。
// 【调试句柄】G.net.mock:auto(on) · add({...})→id · drop(id) · ready(id,v) · emote(id,name) · swap(id,{...})
//   · fill(n) · clear() · host(id) · startMatch() · endMatch() · lose(msg) —— 手动驱动任意场景。
// 【配套阅读】docs/NET.zh-CN.md、src/net/session.js(它模拟的正式实现)、src/net/errors.js。
// ============================================================================
// INKWAVE — offline stand-in for `G.net` (contract: docs/NET.md) so the online UI can be built, demoed and audited
// without the relay. menus.js installs it when the page URL carries ?netmock=1 (it then replaces any real session for
// that page load); the real src/net/session.js is used otherwise.
//
// Simulated room life: squidkids join / leave / ready up / swap weapons and looks / emote on timers, pings jitter,
// a simulated host starts the match once everyone is ready (when you are a guest), matches "run" for a few seconds
// and everyone comes back to the lobby.
//
// Magic codes for join():  ZZZZZ → 'Room not found' · FULLY → 'Room is full' · BUZYY → 'Match in progress' ·
// NETXX → 'Could not connect'. Any other valid code joins someone else's room as a guest.
//
// URL knobs: ?mockauto=0 (timeline paused: nothing happens on its own) · ?mockfill=N (N others already in the room on
// create / join) · ?mocklat=ms (connect latency, default 700) · ?mockmatch=s (match length, default 6).
// Debug handle (G.net.mock): auto(on) · add({ name, team, weapon, style, ready }) → id · drop(id) · ready(id, v) ·
// emote(id, name) · swap(id, { weapon, style }) · fill(n) · clear() · host(id) · startMatch() · endMatch() · lose(msg)
import { G } from '../core/ctx.js';
import { WEAPON_ORDER, MAPS, TEAM_PALETTES, mapNoBots, mapBossOk, bossFallbackMap, noBotsStartBlock } from '../config.js';
import * as LOOK from '../game/character-style.js';
import { ERR, netError, codeFromText } from './errors.js';

// 【URL 参数】构造时读一次;?netmock=1 由 menus.js 决定,这里的其余旋钮控制模拟行为
const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
// 【Bot 名池】模拟玩家取名用;已用名会被跳过,避免重名
const NAMES = ['Mako', 'Tentakool', 'inkjet', 'Wavebreaker', 'Tidal Tia', 'Blot', 'Pixel', 'Kraken Kai', 'sploosh', 'Lulu',
  'Squee', 'Dashi', 'Juniper', 'Rin', 'Otto', 'Beanie', 'Glub', 'Zippy', 'Nibbles', 'Coraline', 'Seafoam', 'Momo'];
const EMOTES = ['booyah', 'wave', 'dance', 'flex'];
const CODE_ABC = 'BCEFGHJKLMNPQRTUVXYZ23456789'; // no O/0, I/1, W/A/S/D (as session.js)
// 【魔法失败码表】这些"房号"不加入,而是触发对应错误码,方便测试错误界面
const FAIL = { ZZZZZ: ERR.NOT_FOUND, FULLY: ERR.FULL, BUZYY: ERR.IN_PROGRESS, NETXX: ERR.CONNECT };
// English fallbacks for logs / unknown codes (the UI shows the dictionary entry for the code instead)
const MOCK_ERR_TEXT = { [ERR.NOT_FOUND]: 'Room not found', [ERR.FULL]: 'Room is full', [ERR.IN_PROGRESS]: 'Match in progress', [ERR.CONNECT]: 'Could not connect' };
// 【工具】clone 深拷贝(防止 UI 改到内部状态);pick 从数组随机取一项
const clone = (o) => JSON.parse(JSON.stringify(o));
const rnd = Math.random;
const pick = (a) => a[(rnd() * a.length) | 0];

// 【MockNet 类】与 NetSession 同形:on/emit + 状态机 + lobby + mock 调试句柄。无网络,全靠 _timers 驱动
export class MockNet {
  constructor() {
    this.state = 'offline';
    this.code = null;
    this.myId = null;
    this.hostId = null;
    this.error = null;
    this.errorCode = null;
    this.lobby = null;
    this.startAt = 0;          // performance.now() when the match launches (state 'starting' → 'match')
    this.isMock = true;        // 上层据此识别替身(installNet 不覆盖、test 可断言)
    this._ls = new Map();      // 事件名 → 监听器集合
    this._timers = new Set();  // 所有在飞的 setTimeout 句柄,便于 leave/_reset 统一清掉
    this._seq = 0;
    this._auto = q.get('mockauto') !== '0';
    this._lat = Math.max(0, +(q.get('mocklat') ?? 700) || 0);   // 连接延迟 ms
    this._fill = q.has('mockfill') ? Math.max(0, Math.min(7, +q.get('mockfill') | 0)) : null;   // 房里预置人数
    this._matchS = Math.max(1, +(q.get('mockmatch') ?? 6) || 6);   // 比赛时长 s
    this._pending = 0;         // 连接令牌:leave() 使其递增,令未完成的 await 判定为已取消
    // 【调试句柄】G.net.mock.*:手动驱动模拟(见文件头清单)
    this.mock = {
      auto: (on = true) => { this._auto = !!on; if (on) this._schedule(); },
      add: (o) => this._add(o || {}),
      drop: (id) => this._drop(id, 'left'),
      ready: (id, v) => this._patch(id, { ready: v == null ? !this._p(id)?.ready : !!v }),
      emote: (id, name) => { if (this._p(id)) this._emit('emote', { id, name: name || pick(EMOTES) }); },
      swap: (id, o) => this._patch(id, o || { weapon: pick(WEAPON_ORDER), style: LOOK.randomStyle(rnd) }),
      fill: (n = 7) => { const others = () => (this.lobby ? this.lobby.players.length - 1 : 0); while (this.lobby && others() < Math.min(7, n)) this._add({}); },
      clear: () => { if (!this.lobby) return; for (const p of this.lobby.players.slice()) if (!p.you) this._drop(p.id, 'left'); },
      host: (id) => this._migrate(id),
      startMatch: () => this._launch(),
      endMatch: () => this._endMatch(),
      lose: (msg = 'Connection lost') => this._lose(msg),
    };
  }

  // ------------------------------------------------------------------ contract
  // 【契约:isHost/on】与 session.js 一致;on 返回退订函数
  get isHost() { return !!this.myId && this.myId === this.hostId; }

  on(ev, fn) {
    if (!this._ls.has(ev)) this._ls.set(ev, new Set());
    this._ls.get(ev).add(fn);
    return () => this._ls.get(ev)?.delete(fn);
  }

  // 【建房】模拟连接延迟后建一个以自己为房主的房间;?mockfill=N 会在之后错峰加入 N 个模拟玩家
  async create(name) {
    if (this.state !== 'offline' && this.state !== 'error') return this.code;
    this._reset();
    this._setState('connecting');
    const tok = ++this._pending;
    await this._sleep(this._lat * (0.8 + rnd() * 0.5));
    // 【取消检测】等待期间若发生了 leave(令牌变化)或状态已变,放弃本次连接
    if (tok !== this._pending || this.state !== 'connecting') throw new Error('Cancelled');
    this.code = Array.from({ length: 5 }, () => pick(CODE_ABC)).join('');
    this.myId = this._id();
    this.hostId = this.myId;
    const s = G.settings || {};
    this.lobby = {
      map: MAPS.some((m) => m.id === s.lastStage) ? s.lastStage : MAPS[0].id,
      time: (s.stageTimes && s.stageTimes[s.lastStage]) === 'dusk' ? 'dusk' : 'day',
      duration: s.matchLength === 90 ? 90 : 180, bots: true, difficulty: s.difficulty || 'normal',
      palette: G.game && G.game.paletteIndex ? G.game.paletteIndex() : 0,
      players: [this._me(name, 0, true)], maxPlayers: 8,
    };
    this._botsPref = true;
    if (mapNoBots(this.lobby.map)) this.lobby.bots = false;
    this._setState('lobby');
    this._emit('lobby', { lobby: this.lobby });
    const n = this._fill ?? 0;
    for (let i = 0; i < n; i++) this._later(900 + i * 700, () => this._add({}));
    this._schedule();
    return this.code;
  }

  // 【加入】清洗房号 → 模拟延迟 → 若命中魔法失败码则进入 error 并抛带 code 的错误,否则建一个「别人当房主、
  //   自己是访客」的模拟房间(随机地图/时段/难度,预置若干 Bot)
  async join(code, name) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (this.state !== 'offline' && this.state !== 'error') throw new Error('Already in a room');
    this._reset();
    this._setState('connecting');
    const tok = ++this._pending;
    await this._sleep(this._lat * (0.9 + rnd() * 0.6) + (code === 'NETXX' ? 1800 : 0));
    if (tok !== this._pending || this.state !== 'connecting') throw new Error('Cancelled');
    const fail = code.length < 4 ? ERR.NOT_FOUND : FAIL[code];
    if (fail) {
      this.errorCode = fail;
      this.error = MOCK_ERR_TEXT[fail] || fail;
      this._setState('error');          // like the real session: a failed connect leaves state 'error' + G.net.error
      this._emit('error', { code: fail, message: this.error });
      throw netError(fail, this.error);
    }
    this.code = code;
    const hostId = this._id();
    const host = this._bot({ id: hostId, team: 0, host: true, ready: true });
    this.lobby = {
      map: pick(MAPS).id, time: rnd() < 0.4 ? 'dusk' : 'day', duration: rnd() < 0.3 ? 90 : 180, bots: rnd() < 0.8,
      difficulty: pick(['easy', 'normal', 'normal', 'hard']), palette: (rnd() * TEAM_PALETTES.length) | 0, players: [host], maxPlayers: 8,
    };
    if (mapNoBots(this.lobby.map)) this.lobby.bots = false;   // (the stage rules, as a real host applies them)
    const others = this._fill ?? (2 + ((rnd() * 3) | 0));
    for (let i = 1; i < others; i++) this.lobby.players.push(this._bot({ team: this._teamFor(), ready: rnd() < 0.45 }));
    this.hostId = hostId;
    this.myId = this._id();
    this.lobby.players.push(this._me(name, this._teamFor(), false));
    this._setState('lobby');
    this._emit('lobby', { lobby: this.lobby });
    this._schedule();
    return this.code;
  }

  // 【离开】令牌自增让在飞的连接 await 作废,清定时器,回 offline
  leave() {
    this._pending++;
    this._reset();
    if (this.state !== 'offline') this._setState('offline');
  }

  // 【改自己】归一改动后在模拟 RTT 后应用;换队若目标队已满,延迟触发一次 ERR_TEAM_FULL 错误事件
  setMe(o = {}) {
    const me = this._p(this.myId);
    if (!me || !this.lobby) return;
    const patch = {};
    if (o.name != null) patch.name = String(o.name).slice(0, 16) || me.name;
    if (o.weapon != null) patch.weapon = o.weapon;
    if (o.style != null) patch.style = { ...o.style };
    if (o.ready != null && this.state === 'lobby' && !me.host) patch.ready = !!o.ready;
    if (o.team != null) {
      const want = o.team === 'auto' ? this._teamFor(me.id) : (o.team ? 1 : 0);
      const n = this.lobby.players.filter((p) => p.team === want && p.id !== me.id).length;
      if (want !== me.team) {
        if (n >= 4) { this._later(this._rtt(), () => this._emit('error', { code: ERR.TEAM_FULL, message: `Team ${want ? 'Bravo' : 'Alpha'} is full` })); }
        else { patch.team = want; patch.ready = false; }
      }
    }
    this._later(this._rtt(), () => this._patch(me.id, patch));
  }

  // 【房主设置】与 session.js 同规则(含 noBoss/noBots 地图规则);仅房主可用
  setSettings(o = {}) {
    if (!this.isHost || !this.lobby || this.state !== 'lobby') return;
    const L = this.lobby, wasMap = L.map;
    if (o.map && MAPS.some((m) => m.id === o.map)) L.map = o.map;
    if (o.time === 'day' || o.time === 'dusk') L.time = o.time;
    if (o.duration) L.duration = +o.duration;
    if (o.bots != null) this._botsPref = !!o.bots;
    if (o.difficulty) L.difficulty = o.difficulty;
    if (o.mode === 'turf' || o.mode === 'boss') L.mode = o.mode;   // Boss Battle lobby setting (UI testing)
    if (Number.isInteger(o.palette) && TEAM_PALETTES[o.palette]) L.palette = o.palette;
    // stage rules, exactly as session.js applies them (no Boss Battle on a noBoss stage, no bots on a noBots one)
    if (L.mode === 'boss' && !mapBossOk(L.map)) L.map = bossFallbackMap(wasMap);
    L.bots = mapNoBots(L.map) ? false : (this._botsPref ?? L.bots);
    this._emit('lobby', { lobby: this.lobby });
  }

  // 【能否开赛 / 硬性阻拦】与 session.js 一致:房主、无人待就绪、且无 noBots 图的人数不足
  canStart() {
    if (!this.isHost || !this.lobby || this.state !== 'lobby') return false;
    return !this.startBlock() && this.lobby.players.every((p) => p.host || p.ready);
  }
  startBlock() { return noBotsStartBlock(this.lobby); }

  // 【开赛】房主手点开赛:直接走 _launch 的两段流程
  start() {
    if (!this.canStart()) return;
    this._launch();
  }

  // 【表情】合法表情才广播;本地即时回显
  emote(name) {
    if (!this.lobby || !EMOTES.includes(name)) return;
    this._emit('emote', { id: this.myId, name });
  }

  // ------------------------------------------------------------------ simulation
  // Same beat the real session is asked to honour (docs/NET.md → Requests): state 'starting', let the lobby play its
  // countdown + launch (menus.launchLobby() resolves when the screen can be taken over), then the match.
  // 【起跑节拍】与真实会话同节奏:切 starting → 放行大厅倒计时动画(launchLobby,有 8s 上限兜底)→ 切 match →
  //   定时 _matchS 秒后自动结束
  async _launch() {
    if (!this.lobby || this.state !== 'lobby') return;
    const L = this.lobby;
    this.startAt = performance.now() + 3600;
    this._setState('starting');
    this._emit('match', { phase: 'start' });
    const beat = G.menus && G.menus.launchLobby ? G.menus.launchLobby() : null;
    await Promise.race([beat || this._sleep(3600), this._sleep(8000)]);
    // 【防竞态】等待期间离开房间(lobby 变化)或状态改变则放弃
    if (this.state !== 'starting' || this.lobby !== L) return;
    this._setState('match');
    this._later(this._matchS * 1000, () => this._endMatch());
  }

  /** main.js calls this when the results are done (real session: back to the lobby, room stays). */
  // 【结束比赛】main.js 在结算展示完毕时调用;立即(_endMatch(true))回大厅
  endMatch() { this._endMatch(true); }

  // 【收尾】派发 match:'end';稍后(默认 1200ms,now 时立即)清就绪、回 lobby、恢复自动时间线
  _endMatch(now = false) {
    if (this.state !== 'match' && this.state !== 'starting') return;
    this._emit('match', { phase: 'end' });
    this._later(now ? 0 : 1200, () => {
      if (!this.lobby) return;
      for (const p of this.lobby.players) p.ready = !!p.host;
      this._setState('lobby');
      this._emit('lobby', { lobby: this.lobby });
      this._schedule();
    });
  }

  // 【模拟掉线】按文本映射错误码(否则 ERR_LOST),清场并进 error
  _lose(msg) {
    if (this.state === 'offline') return;
    this._reset();
    this.errorCode = codeFromText(msg) || ERR.LOST;
    this.error = msg;
    this._setState('error');
    this._emit('error', { code: this.errorCode, message: msg });
  }

  // 【自动时间线】每隔 0.9–2.8s 走一步:大厅期让某个模拟玩家行动(_act)、刷新 ping;由 _auto 开关
  _schedule() {
    if (this._tick || !this._auto) return;
    const step = () => {
      this._tick = null;
      if (!this._auto || !this.lobby) return;
      if (this.state === 'lobby') this._act();
      this._pings();
      this._tick = this._later(900 + rnd() * 1900, step);
    };
    this._tick = this._later(1600, step);
  }

  // 【随机行动】访客身份时:全员就绪则模拟房主 1.8s 后开赛;否则按概率加人/踢人/就绪/发表情/换武器/换外观
  _act() {
    const L = this.lobby, others = L.players.filter((p) => !p.you);
    // guest: the simulated host launches once everybody (you included) is ready
    if (!this.isHost && L.players.every((p) => p.host || p.ready)) {
      if (!this._hostGo) this._hostGo = this._later(1800, () => { this._hostGo = null; if (this.lobby === L && L.players.every((p) => p.host || p.ready)) this._launch(); });
      return;
    }
    const r = rnd();
    if (L.players.length < 6 && r < 0.3) { this._add({}); return; }
    const guests = others.filter((p) => !p.host);
    if (guests.length > 2 && r < 0.36) { this._drop(pick(guests).id, 'left'); return; }
    if (!others.length) return;
    const p = pick(others);
    if (r < 0.62 && !p.host) { this._patch(p.id, { ready: !p.ready || rnd() < 0.15 ? !p.ready : p.ready }); return; }
    if (r < 0.8) { this._emit('emote', { id: p.id, name: pick(EMOTES) }); return; }
    if (r < 0.9) { this._patch(p.id, { weapon: pick(WEAPON_ORDER.filter((w) => w !== p.weapon)) }); return; }
    this._patch(p.id, { style: LOOK.randomStyle(rnd) });
  }

  // 【ping 抖动】每人有一个基线(_base):自己是 22ms,他人 16–106ms 偶尔到 200+;每次在当前值 ±15% 抖动
  _pings() {
    if (!this.lobby) return;
    for (const p of this.lobby.players) {
      const base = p._base || (p._base = p.you ? 22 : 16 + rnd() * (rnd() < 0.15 ? 190 : 90));
      p.ping = Math.max(4, Math.round(base + (rnd() - 0.5) * base * 0.3));
    }
    this._emit('lobby', { lobby: this.lobby });
  }

  // 【加人】满员则忽略;自动为其分配较空的一队;派发 join + lobby
  _add(o) {
    const L = this.lobby;
    if (!L || L.players.length >= L.maxPlayers) return null;
    const p = this._bot({ ...o, team: o.team ?? this._teamFor() });
    L.players.push(p);
    this._emit('join', { player: clone(p) });
    this._emit('lobby', { lobby: L });
    return p.id;
  }

  // 【踢人】只能踢非自己的玩家;若被踢的是房主则先迁移主机;派发 leave + lobby
  _drop(id, reason = 'left') {
    const L = this.lobby;
    if (!L) return;
    const i = L.players.findIndex((p) => p.id === id && !p.you);
    if (i < 0) return;
    const [p] = L.players.splice(i, 1);
    if (p.host) this._migrate(null);
    this._emit('leave', { player: clone(p), reason });
    this._emit('lobby', { lobby: L });
  }

  // 【主机迁移】把房主交给指定玩家(或列表首人),新房主自动就绪;派发 host + lobby
  _migrate(id) {
    const L = this.lobby;
    if (!L) return;
    const next = (id && L.players.find((p) => p.id === id)) || L.players[0];
    if (!next) return;
    for (const p of L.players) p.host = p === next;
    next.ready = true;
    this.hostId = next.id;
    this._emit('host', { hostId: next.id });
    this._emit('lobby', { lobby: L });
  }

  // 【打补丁】把字段合并进某玩家;换队时顺带把就绪清掉(与真实会话一致)
  _patch(id, patch) {
    const p = this._p(id);
    if (!p || !patch || !Object.keys(patch).length) return;
    Object.assign(p, patch);
    if (patch.team != null && !p.you) p.ready = false;
    this._emit('lobby', { lobby: this.lobby });
  }

  // 【较空的一队】返回 0 或 1 —— 谁人少去哪;供自动分配与换队默认
  _teamFor(except) {
    const ps = (this.lobby ? this.lobby.players : []).filter((p) => p.id !== except);
    const a = ps.filter((p) => p.team === 0).length, b = ps.length - a;
    return a <= b ? 0 : 1;
  }

  // 【自己的玩家条目】从离线 profile 取名/武器/外观,you=true、ping 固定 22
  _me(name, team, host) {
    const prof = (G.game && G.game.profile) || {};
    return {
      id: this.myId || (this.myId = this._id()), name: String(name || prof.name || 'Player').slice(0, 16), team,
      weapon: prof.weapon || 'shooter', style: prof.style ? { ...prof.style } : LOOK.randomStyle(rnd),
      ready: !!host, host: !!host, you: true, ping: 22,
    };
  }

  // 【造一个 Bot 玩家】从 NAMES 里挑没人用的名字;ready 随机(约 30%);ping 20–100
  _bot(o = {}) {
    const used = new Set((this.lobby ? this.lobby.players : []).map((p) => p.name));
    const free = NAMES.filter((n) => !used.has(n));
    return {
      id: o.id || this._id(), name: o.name || pick(free.length ? free : NAMES), team: o.team ?? 0,
      weapon: o.weapon || pick(WEAPON_ORDER), style: o.style || LOOK.randomStyle(rnd),
      ready: !!(o.ready ?? rnd() < 0.3), host: !!o.host, you: false, ping: 20 + ((rnd() * 80) | 0),
    };
  }

  // 【小工具】_p 按 id 查玩家;_id 生成唯一玩家 id;_rtt 模拟一次请求往返
  _p(id) { return this.lobby ? this.lobby.players.find((p) => p.id === id) : null; }
  _id() { return 'p' + (++this._seq).toString(36) + ((rnd() * 1e6) | 0).toString(36); }
  _rtt() { return 60 + rnd() * 70; }

  // 【状态迁移】变化才派发;离开 error/offline 时清空 error/errorCode
  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    if (s !== 'error' && s !== 'offline') { this.error = null; this.errorCode = null; }
    this._emit('state', { state: s });
  }

  // 【派发】与真实会话一样,顺带把房间调色板同步给 game('lobby' 时);深拷贝 lobby 供 UI,单个回调抛错不影响他人
  _emit(ev, data) {
    // main.js keeps the room's palette in sync for the real session (its 'lobby' hook); mirror that for the mock
    if (ev === 'lobby' && this.lobby && G.game && G.game._roomPalette) { try { G.game._roomPalette(this.lobby); } catch (e) { /* optional */ } }
    const set = this._ls.get(ev);
    if (!set) return;
    const payload = ev === 'lobby' ? { lobby: data.lobby ? clone(data.lobby) : null } : data;
    for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error('[netmock]', ev, e); } }
  }

  // 【受管定时器】所有定时器登记在 _timers,便于 _reset 统一清;回调执行时先自行出表
  _later(ms, fn) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    this._timers.add(t);
    return t;
  }
  // 【不受管 sleep】刻意不登记:连接中途 leave() 也要让它自然 settle(靠 _pending 令牌判定取消)
  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); } // untracked: a leave() mid-connect must still settle

  // 【清场】清掉所有定时器与飞行状态,回初始(不派发事件,由调用方决定)
  _reset() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    this._tick = null; this._hostGo = null;
    this.code = null; this.myId = null; this.hostId = null; this.lobby = null; this.startAt = 0;
  }
}

/** Install the mock as G.net (idempotent). Returns the session. */
// 【安装】幂等:已是 mock 则原样返回,否则新建并挂到 G.net
export function installMockNet() {
  if (G.net && G.net.isMock) return G.net;
  G.net = new MockNet();
  console.info('[netmock] G.net is the offline mock (?netmock=1)');
  return G.net;
}
