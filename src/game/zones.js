// ============================================================================
// 【中文导读】zones.js —— 区域控制(Zone Control)规则引擎(纯逻辑,无 UI)
// ----------------------------------------------------------------------------
// 【模块定位】mode==='zones' 的对局由 match.js 创建一个 ZoneControl(match.zones)。
//   它负责:占领判定、控制权/罚分/轮换/加时、结算与事件广播。UI(HUD、小地图 ZoneMarks)
//   只订阅 zones:* 事件,不反过来调用它。
// 【核心机制】(细节以文件头部英文块为准,这里给中文速览)
//   · 区域来源 layout.zones:中央目标(1 个区,或 2 个须同时占领) + 每个半场一个侧区
//     (Alpha 的侧区由 layout 给,Bravo 的自动 180° 镜像)。任一时刻只有一个目标区"在岗"。
//   · 覆盖率:占区需 ≥80%(ZONES.control),被占区被对方涂到 ≥40%(ZONES.contest)即中立化。
//   · 倒计时:两队各从 100 起;占住在岗目标按位置/归属以不同速率扣分(中央 1/s,本方半场
//     1/2s,敌方半场 1/0.5s),先到 0 即 knockout 获胜。
//   · 罚分(penalty):一队从对方手里夺下目标(非中立状态)时,给【对方】记一笔罚分,
//     公式 ROUND(0.75×(start−end)) + (start=100?1:0);罚分不是分数,是必须先"抵"掉
//     的锁,抵完倒计时才继续走(见 _tick / total / losing)。
//   · 大招:一队持目标时,对方仪表 4.5/s 充能;无人持有时,落后方 1.5/s。
//   · 时间/加时:见 timeUp / _overtime;最后 30s(ZONES.finalCentre)与加时只在中央进行,
//     无更多轮换。
//   · 涂墨:占区会把区内每个格用占领者的墨水"灌注"(flood,无人计功),所以对方须涂回 40%
//     才能中立化;新上岗的目标先被擦回光地(与 ZoneMarks 揭示同步)。
// 【在线】主机跑规则并记录每个决策(zz/zo/zp/za/zf/zt/zs/ze),挂在事件时间线上;客机
//   (match.follower)只回放(netEvent),快照间仅预测计数。_net 仅在非 follower 时记录。
// 【关键约定】单位:米、秒;事件名与 docs/EVENTS.zh-CN.md 的 zones:* 表一致;
//   常量从 ZONES(config.js)读取,文件顶部把常用值提为局部 FINAL/WARN 等。
// 【配套阅读】docs/EVENTS.zh-CN.md(zones:* 事件表)、config.js 的 ZONES、
//   match.js(创建/驱动/_judge)、minimap.js(_drawZones)、world/paint.js(flood/grid)。
// ============================================================================
// Zone Control: the rules engine (no UI). A match with opts.mode === 'zones' owns one of these (match.zones).
//
// Online (see netEvent): the host runs the rules and records every decision — captures, control, penalties, rotations,
// overtime, the end — plus a count snapshot twice a second, on its event timeline (in step with the paint it saw);
// everyone else is a follower that replays them (and only predicts the count between snapshots).
//
// Zones come from the stage layout (layout.zones, see ZONE_FORMAT below). There is a central objective (one zone, or
// two zones that must BOTH be held) and one side zone per team half (the one you give is Alpha's; Bravo's is its 180°
// mirror). Only one objective is operational at a time: the centre to start with, then every 30–60 s the operational
// one swaps between the centre and a side zone.
//
//   • coverage: the share of the zone's inkable floor each team has inked. Taking a zone needs ≥ 80 %; a held zone is
//     neutralised when the other team inks ≥ 40 % of it. An objective is held when a team holds all of its zones.
//   • countdown: each team starts at 100. Holding the operational objective counts you down — 1 pt/s at the centre;
//     a side zone on your own half 1 pt / 2 s; a side zone on the enemy's half (i.e. closer to THEIR spawn) 1 pt / 0.5 s.
//     A team at 0 wins on the spot.
//   • penalty: when a team loses the objective to the other team (not when it merely goes neutral), it gets a penalty
//     of ROUND(0.75 × (start − end)) + (start = 100 ? 1 : 0), where start = its count + penalty when it took the
//     objective from the other team, end = its count + penalty when the other team takes it. The penalty is NOT part
//     of the score: it's a lock that has to be counted off (holding the objective) before the count moves again.
//   • score: the count alone — the lower count is ahead and wins at time up (a count of 1 with a +50 penalty beats
//     2 +1); the penalty only decides how long the team has to hold before its count moves.
//   • specials: while one team holds the objective, the other team's gauges fill at 4.5 p/s; while nobody holds it, the
//     team that's behind fills at 1.5 p/s.
//   • time (5 min) + overtime: see _timeUp / _overtime. The last 30 s (ZONES.finalCentre) and overtime are played on
//     the centre only: a live side zone is swapped back to the centre and there are no more rotations.
//   • ink: taking a zone floods every one of its cells with the taker's ink (a front running out from its centre, see
//     PaintSystem.flood; nobody is credited for it), so the other team has to ink the full 40 % back to neutralise it.
//     An objective that becomes operational is wiped back to bare floor first (in step with the zone marks' reveal).
//
// Events (on / emit, src/core/ctx.js):
//   zones:zone { zone, owner }  ·  zones:control { owner, prev, objective }  ·  zones:penalty { team, penalty, … }
//   zones:active { objective, zones, final?, moved? } — a rotation; final: the last-30-s lock (moved: false when the
//                  centre was already live and only the lock is announced)
//   zones:contest { zone, holder, share } — the other team has inked a held zone up to ZONES.warn (≈ 30 %) of it
//   zones:overtime { losing }  ·  zones:end { winner, reason, counts, penalty } (counts = the scores, penalty apart)
//
// ZONE_FORMAT (layout.zones):
//   { center: [zone] | [zone, zone], side: zone }
//   zone = { poly: [[x, z], …] (outline, world metres, any simple polygon) | polys: [poly, …] (several parts, one
//            shared coverage), y0: -1, y1: 3 (floor heights counted) }   — the stages' zones live in zones-data.js
//   side = the zone on Alpha's half (closer to Alpha's spawn); Bravo's is mirrored automatically.
// Stages without zones get a placeholder layout (flagged placeholder: true) so the mode always runs.
import { G, emit } from '../core/ctx.js';
import { ZONES } from '../config.js';

const FINAL = ZONES.finalCentre ?? 30;   // the last N s (+ overtime): the centre only, no more rotations
const WARN = ZONES.warn ?? 0.3;          // the other team's share of a held zone that sounds the "contested" warning
const WARN_GAP = 4;                      // s between two warnings for one zone
const MIN_STINT = 10;                    // a rotation never leaves an objective live for less than this before the lock
const FILL_T = 0.6;                      // capture flood: the front's run time (s), eased out
const r3 = (x) => Math.round(x * 1000) / 1000;
const WIPE_T = 0.7;                      // new-objective wipe: in step with ZoneMarks' reveal sweep (SWEEP_T, linear)

// 【取多边形】一个区可能由单块(poly)或多块(polys)组成,统一成数组。
const partsOf = (z) => z.polys || [z.poly];
// 【镜像区】Bravo 的侧区 = Alpha 侧区关于原点 180° 旋转(每个顶点取 -x,-z),共享同一套覆盖统计格式。
const mirrorZone = (z) => ({ ...z, poly: undefined, polys: partsOf(z).map((p) => p.map(([x, zz]) => [-x, -zz])) });

// 【点在多边形内】标准射线投掷法(ray casting):对每条边判断水平射线跨越次数,奇偶决定内外。
// 在 XZ 平面判定,多边形可为任意简单多边形。
function insidePoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// placeholder zones when a stage has none yet: a 10 × 10 m square at mid, side zones a third of the way to each spawn
// 【占位区】关卡还没写 zones 时的兜底:中点一个 10×10 方块,侧区放在去各自出生台约 1/3 处;
// 标 placeholder:true,让模式无论如何都能跑。
function placeholderZones(level) {
  const B = level.bounds, pad = level.spawnPads[0];
  const sq = (cx, cz, h) => [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]];
  const sx = pad.x * 0.4, sz = pad.z * 0.45;
  void B;
  return { placeholder: true, center: [{ poly: sq(0, 0, 5), y0: -2, y1: 6 }], side: { poly: sq(sx, sz, 4), y0: -2, y1: 6 } };
}

// the paint-grid cells of a zone: every live turf cell whose centre lies inside the outline and within [y0, y1]
// 【区 → 涂墨格】遍历所有可涂面(f.turf && f.atlas)的每个格子中心,落在轮廓内且高度在 [y0,y1]
// 的活格(P.dead 排除)收集进 cells;同时算出质心 center 与 radius 之外的最大"半径"reach
// (到最远轮廓角的距离,供 flood 波前与 ZoneMarks 用同一半径函数)。构建期一次性算出,运行期只读。
function zoneCells(zone) {
  const L = G.level, P = G.paint, cells = [];
  let cx = 0, cz = 0, cy = 0;
  const y0 = zone.y0 ?? -2, y1 = zone.y1 ?? 6;
  const parts = partsOf(zone);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (const f of L.faces) {
    if (!f.turf || !f.atlas) continue;
    for (let j = 0; j < f.nv; j++) for (let i = 0; i < f.nu; i++) {
      const s = (i + 0.5) * f.cu, t = (j + 0.5) * f.cv;
      const wx = f.origin.x + f.u.x * s + f.v.x * t, wy = f.origin.y + f.u.y * s + f.v.y * t, wz = f.origin.z + f.u.z * s + f.v.z * t;
      if (wx < x0 || wx > x1 || wz < z0 || wz > z1 || wy < y0 || wy > y1) continue;
      if (!parts.some((p) => insidePoly(p, wx, wz))) continue;
      const k = f.grid + j * f.nu + i;
      if (P.dead && P.dead[k]) continue;
      cells.push(k); cx += wx; cy += wy; cz += wz;
    }
  }
  const n = Math.max(1, cells.length);
  const center = [cx / n, cy / n, cz / n];
  // reach: the farthest outline corner from the centre (no point of the zone is farther)
  let reach = 0;
  for (const p of parts) for (const [x, z] of p) reach = Math.max(reach, Math.hypot(x - center[0], z - center[2]));
  const ids = Int32Array.from(cells);
  return { cells: ids, center, reach, region: { cells: ids, polys: parts, y0, y1 } };
}

// 【区域控制规则引擎】持有整场比赛的区域状态与规则时钟。构造时读 layout.zones 建 zones/objectives,
// 初始化计数/罚分/轮换;之后由 match.update() 每帧调用 update(dt) 推进。
export class ZoneControl {
  constructor(match) {
    this.match = match;
    const layout = G.level.layout || {};
    const Z = layout.zones || placeholderZones(G.level);
    this.placeholder = !!Z.placeholder;
    // zones: [center…, sideA (home 0), sideB (home 1)]
    const defs = [...Z.center.map((z) => ({ ...z, kind: 'center', home: -1 })),
      { ...Z.side, kind: 'side', home: 0 }, { ...mirrorZone(Z.side), kind: 'side', home: 1 }];
    // 【构建 zones】每个 zone = 定义(def) + 运行态(owner/share/hold/warn…) + zoneCells 烘焙的
    // cells/center/reach/region。owner=-1 中立;share[team] 是各自覆盖率;warnArmed/warnT 控制
    // "被争夺"提示的节流;hold 是"擦地冻结"到期时钟;flood 是当前灌注动画状态(供 ZoneMarks)。
    this.zones = defs.map((d, i) => ({ id: i, def: d, kind: d.kind, home: d.home, owner: -1, share: [0, 0], hold: 0, warnArmed: true, warnT: -99, flood: null, ...zoneCells(d) }));
    const nc = Z.center.length;
    // objectives: the centre (1 or 2 zones), and one per side zone
    this.objectives = [
      { id: 'center', zones: this.zones.slice(0, nc), home: -1 },
      { id: 'sideA', zones: [this.zones[nc]], home: 0 },
      { id: 'sideB', zones: [this.zones[nc + 1]], home: 1 },
    ];
    this.active = this.objectives[0];
    this.owner = -1;                 // holder of the operational objective (-1 = nobody)
    this.lastOwner = -1;             // last team that held it (survives neutral spells)
    this.neutralT = 0;               // time since the objective last went neutral
    this.count = [ZONES.count, ZONES.count];
    this.penalty = [0, 0];
    this.start = [ZONES.count, ZONES.count];
    this.tieEnd = [null, null];
    this.holdT = [0, 0];             // current unbroken hold, s (UI / stats)
    this.clock = 0;                  // s since the match started playing
    this.final = match.time <= FINAL;   // centre-only from here on (a match this short never rotates)
    this._schedule();
    this.sampleT = 0;
    this.overtime = false; this.overtimeT = 0;
    this.otLosing = -1;              // the team behind when overtime began (-1: level → sudden death)
    this.winner = null; this.reason = null;
    this.log = [];
    this.snapT = 0;
  }

  // online: a guest's copy follows the host's (match.follower; a host migration makes it the rules engine)
  // 【客机标识】true = 本机是 follower(只回放主机决策,不本地裁决)。
  get follower() { return !!this.match.follower; }
  // 【记录决策】非 follower(主机/单机)时把决策写进 netmatch 事件时间线,供客机回放。
  _net(e) { if (!this.follower) G.netm?.recZone?.(e); }

  // count + penalty: how much the team still has to count off to reach 0 (the penalty formula's start / end). NOT the
  // score — who's ahead / wins is the count alone (losing())
  // 【count+penalty】该队还要"抵掉"多少才到 0(即罚分公式里的 start/end)。注意这不是比分:
  // 谁领先/获胜只看 count(losing)。
  total(t) { return this.count[t] + this.penalty[t]; }
  // the team currently behind (higher count; the penalty doesn't count), or -1 when level
  // 【落后方】count 更高者落后(罚分不计入);打平返回 -1。
  losing() { const a = this.count[0], b = this.count[1]; return a === b ? -1 : a > b ? 0 : 1; }
  // 【随机轮换间隔】在 ZONES.rotateMin..rotateMax 之间取。
  _swapDelay() { return ZONES.rotateMin + Math.random() * (ZONES.rotateMax - ZONES.rotateMin); }
  // the next rotation — none that would land in the last FINAL s (+ a short stint): from the centre there are none left;
  // from a side zone the final lock itself takes the objective back to the centre
  // 【排下一次轮换】若下一次轮换会落进最后 FINAL 秒(余量不足 MIN_STINT),则不再安排:
  // 当前在中央 → 永不轮换(Infinity);在侧区 → 由 final lock 把目标收回中央。
  _schedule() {
    const d = this._swapDelay(), left = this.match.time - FINAL;
    this.nextSwap = left - d >= MIN_STINT ? d : this.active === this.objectives[0] ? Infinity : Math.max(0.5, left + 0.5);
  }

  // Zone ink: a capture floods the zone with the taker's ink; a newly operational zone is wiped to bare floor (and
  // can't be taken while the wipe runs). zone.flood tells ZoneMarks where the front is (same radius function).
  // 【区域涂地动画】占领 = 用占领方颜色"灌注"整个 zone;新上线/轮换的 zone 被"擦地"回裸地面
  // (擦地期间不可被夺)。zone.flood 记录动画状态(team/t0/dur/reach/ease)供 ZoneMarks 渲染波形前沿:
  // 灌注半径用 z.reach+0.4、缓动 'out';擦地用 z.reach+3.5、'linear'。同时写入 paint 层并(擦地时)设 hold 冻结时钟。
  _flood(z, team) {
    const fill = team === 0 || team === 1;
    const dur = fill ? FILL_T : WIPE_T, reach = fill ? z.reach + 0.4 : z.reach + 3.5, ease = fill ? 'out' : 'linear';
    z.flood = { team: fill ? team : -1, t0: G.time ?? 0, dur, reach, ease };
    if (!fill) z.hold = this.clock + dur + 0.05;
    G.paint?.flood?.(z.region, fill ? team : -1, { center: [z.center[0], z.center[2]], y: z.center[1], reach, dur, ease });
  }

  // ---- coverage + control of the operational objective's zones
  // 【覆盖率采样 + 控制权裁决】按 ZONES.sampleHz 节流调用。对当前目标(active)的每个 zone,扫其 cells
  // 统计 grid 里 1/2 的格数得到 share[team]=覆盖率。follower 只回放(控制权归主机);擦地冻结期(clock<hold)
  // 跳过;否则:中立且某队覆盖率≥ZONES.control 则判给该队,已被占但对方覆盖率≥ZONES.contest 则中立化,
  // 否则只发"被争夺"警告。最后:本目标全部 zone 同属一队 → 该队获得总控制权(owner),变化时 _setOwner。
  _sample() {
    const grid = G.paint.grid;
    for (const z of this.active.zones) {
      let a = 0, b = 0;
      const c = z.cells;
      for (let i = 0; i < c.length; i++) { const g = grid[c[i]]; if (g === 1) a++; else if (g === 2) b++; }
      const n = Math.max(1, c.length);
      z.share[0] = a / n; z.share[1] = b / n;
      if (this.follower) { if (z.owner >= 0) this._contest(z); continue; }   // (control is the host's call)
      if (this.clock < z.hold) continue;                 // still being wiped for its turn as the objective
      if (z.owner === -1) {
        const t = z.share[0] >= ZONES.control ? 0 : z.share[1] >= ZONES.control ? 1 : -1;
        if (t >= 0) this._zoneOwner(z, t);
      } else if (z.share[1 - z.owner] >= ZONES.contest) {
        this._zoneOwner(z, -1);
      } else this._contest(z);
    }
    if (this.follower) return;
    const o = this.active.zones.every((z) => z.owner === 0) ? 0 : this.active.zones.every((z) => z.owner === 1) ? 1 : -1;
    if (o !== this.owner) this._setOwner(o);
  }
  // a zone taken (flooded with the taker's ink) or neutralised
  // 【单区归属变更】z 被夺(t>=0,t 为队号)或被中立化(t=-1)。先记网络决策('zz'),改 owner;
  // 若被夺,重置警告节流并播放灌注动画,最后 emit 'zones:zone'。
  _zoneOwner(z, t) {
    this._net(['zz', z.id, t]);
    z.owner = t;
    if (t >= 0) { z.warnArmed = true; z.warnT = -99; this._flood(z, t); }
    emit('zones:zone', { zone: z, owner: t });
  }

  // the other team is inking a held zone close to the neutralise line: warn once (re-armed when it's pushed back)
  // 【被争夺告警】对方在我方已占 zone 上涂到接近中立线(share[对方]≥WARN)时,只告警一次;
  // 对方的覆盖被压回 WARN-0.08 以下则重新武装(warnArmed=true),WARN_GAP 内在节流,避免刷屏。
  _contest(z) {
    const o = z.share[1 - z.owner];
    if (o < WARN - 0.08) { z.warnArmed = true; return; }
    if (o < WARN || !z.warnArmed || this.clock - z.warnT < WARN_GAP) return;
    z.warnArmed = false; z.warnT = this.clock;
    emit('zones:contest', { zone: z, holder: z.owner, share: o });
  }

  // 【总控制权切换】o = 队号或 -1(无人控制)。o=-1 时清中性计时;否则:若对方是上一任,先结算对方罚分
  // (_penalise);若吃下对方"易手"(非我们中立后再拿回),记录本段起点 start[o]=total(o) 并清 tieEnd。
  // 复位双方 holdT,记网络决策 'zo'(在罚分记录之后,保证 follower 回放顺序一致),emit 'zones:control'。
  _setOwner(o) {
    const prev = this.owner;
    this.owner = o;
    if (o === -1) { this.neutralT = 0; }
    else {
      const other = 1 - o;
      // the other team loses the objective to us: its penalty (from its last capture off us to now)
      if (this.lastOwner === other) this._penalise(other);
      // a capture off the other team (not a retake after our own neutral spell) starts our stint
      if (this.lastOwner !== o) { this.start[o] = this.total(o); this.tieEnd[o] = null; }
      this.lastOwner = o;
    }
    this.holdT[0] = this.holdT[1] = 0;
    this._net(['zo', o]);   // (after its penalty record: a follower plays them in the same order)
    emit('zones:control', { owner: o, prev, objective: this.active.id });
  }

  // ROUND(0.75 × (start − end)) + (start = 100 ? 1 : 0), start / end = count + penalty. If the team caught up to the
  // other team's count during its stint (the tie point), progress past that tie isn't penalised: end = the count at the
  // tie (its penalty was already counted off by then).
  // 【罚分结算】t 队在被对方夺走目标时,按其"本次控制段"的抄幅度罚分:
  // p = ROUND(ZONES.penaltyK × (start − end)) + (start 满值 100 ? 1 : 0)(满仓保底 +1,经典 Splatoon 规则)。
  // start/end 均取 count+penalty;若本段曾追平对方(tieEnd 非空),追平之后的进度不罚,故 end 取
  // max(tieEnd, total)(追平点之后罚分其实已被抵消)。累加 penalty、写 log,记网络决策 'zp',emit 'zones:penalty'。
  _penalise(t) {
    const start = this.start[t];
    const end = this.tieEnd[t] != null ? Math.max(this.tieEnd[t], this.total(t)) : this.total(t);
    const p = Math.max(0, Math.round(ZONES.penaltyK * (start - end))) + (start === ZONES.count ? 1 : 0);
    this._net(['zp', t, p, r3(start), r3(end)]);
    this.penalty[t] += p;
    this.log.push({ t: this.match.duration - this.match.time, team: t, start, end, penalty: p, next: this.total(t) });
    emit('zones:penalty', { team: t, penalty: p, total: this.total(t), start, end });
  }

  // 【逐帧扣计数】持有目标的一队,count 以速率 rate 下降(rate 取决于目标位置:中央/本方 home/对方 home)。
  // 先扣罚分(fromPen),再扣 count。同时判定"追平点":本队本段首次从领先转为不领先(追平对方)时记 tieEnd,
  // 供 _penalise 计算免罚区间。
  _tick(t, dt) {
    const obj = this.active;
    const rate = obj.home < 0 ? ZONES.rateCenter : obj.home === t ? ZONES.rateHome : ZONES.rateAway;
    let d = rate * dt;
    const before = this.count[t], opp = this.count[1 - t];
    const fromPen = Math.min(this.penalty[t], d);
    this.penalty[t] -= fromPen; d -= fromPen;
    this.count[t] = Math.max(0, this.count[t] - d);
    // the tie point: this team (behind) has caught up with the other team's count (the other count can't move during
    // this team's stint, so behind now = behind at the start of it)
    if (this.tieEnd[t] == null && before > opp && this.count[t] <= opp) this.tieEnd[t] = opp;
  }

  // (each client fills its own players' gauges: a remote player's special meter is its owner's)
  // 【大招充能】控制权在谁手里,谁就少充(gaugeHeld:目标由对方把持,劣势方补);无人控制时给落后方充
  // (gaugeNeutral)。只给本机(local、非 remote)存活且未开大的玩家加充能;跨过 specialCost 阈值时 emit
  // 'special:ready'。注意:远端玩家的大招槽由其本机自己填,这里必须跳过(remote)。
  _fillSpecials(dt) {
    let team = -1, rate = 0;
    if (this.owner >= 0) { team = 1 - this.owner; rate = ZONES.gaugeHeld; }
    else { team = this.losing(); rate = ZONES.gaugeNeutral; }
    if (team < 0) return;
    for (const a of this.match.actors) {
      if (a.team !== team || !a.alive || a.specialActive || a.remote) continue;
      const was = a.specialReady();
      a.special = Math.min(a.specialCost(), a.special + rate * dt);
      if (!was && a.specialReady()) emit('special:ready', { actor: a });
    }
  }

  // ---- per frame while the match is playing (and through overtime)
  // 【每帧主循环】比赛进行中(含加时)每帧调用。顺序:推进 clock → 按 sampleHz 调 _sample → 有控制方则
  // _tick 扣计数并累计 holdT,count 与 penalty 都归零则 knockout 立刻结束 → 无人控制则累计 neutralT →
  // _fillSpecials 充能。follower 走回放分支(只推进 overtimeT/nextSwap)。主机每 0.5s 发一次 'zs' 快照同步
  // count/penalty/nextSwap/overtimeT/neutralT/holdT。最后处理轮换:加时或最后 FINAL 秒(→ _finalLock)不轮换,
  // 否则倒计时 nextSwap 到点则 _swap。
  update(dt) {
    if (this.winner != null) return;
    this.clock += dt;
    this.sampleT -= dt;
    if (this.sampleT <= 0) { this.sampleT = 1 / ZONES.sampleHz; this._sample(); }
    if (this.owner >= 0) {
      this._tick(this.owner, dt);   // (a follower predicts it; the host's snapshots correct it)
      this.holdT[this.owner] += dt;
      if (!this.follower && this.count[this.owner] <= 0 && this.penalty[this.owner] <= 0) return this._end(this.owner, 'knockout');
    } else this.neutralT += dt;
    this._fillSpecials(dt);
    if (this.follower) { if (this.overtime) this.overtimeT += dt; else if (!this.final) this.nextSwap -= dt; return; }
    if ((this.snapT -= dt) <= 0) {
      this.snapT = 0.5;
      this._net(['zs', r3(this.count[0]), r3(this.count[1]), r3(this.penalty[0]), r3(this.penalty[1]), Number.isFinite(this.nextSwap) ? r3(this.nextSwap) : -1,
        r3(this.overtimeT), r3(this.neutralT), r3(this.holdT[0]), r3(this.holdT[1])]);
    }
    // rotation: none in overtime, none once the last 30 s have started (this frame's clock tick reaches them → lock)
    if (this.overtime) this._overtime(dt);
    else if (!this.final) {
      if (this.match.time - dt <= FINAL) this._finalLock();
      else { this.nextSwap -= dt; if (this.nextSwap <= 0) this._swap(); }
    }
  }

  // 【轮换目标】把目标切到下一个 objective。to 显式指定(用于 final lock 收回中央);否则从当前目标是中央
  // 时随机选一侧,在侧区时回中央。旧 zone owner 清 -1,新目标全部重置为中立并在裸地擦地(_flood(-1))。
  // 记网络决策 'za',重排 nextSwap,若此前有控制方则一并广播中立,清 sampleT 强制立即重采样,emit 'zones:active'。
  _swap(to = null, final = false) {
    const o = this.objectives;
    const next = to || (this.active === o[0] ? (Math.random() < 0.5 ? o[1] : o[2]) : o[0]);
    this._net(['za', o.indexOf(next), final ? 1 : 0]);
    for (const z of this.active.zones) z.owner = -1;
    this.active = next;
    // a new objective starts neutral on bare floor (wiped as it's revealed); control is re-read from the ink after
    for (const z of next.zones) { z.owner = -1; z.warnArmed = true; this._flood(z, -1); }
    if (final) this.nextSwap = 0; else this._schedule();
    if (this.owner !== -1) { this.owner = -1; this.neutralT = 0; emit('zones:control', { owner: -1, prev: this.lastOwner, objective: next.id }); }
    this.sampleT = 0;
    emit('zones:active', { objective: next.id, zones: next.zones.map((z) => z.id), final, moved: true });
  }

  // the last 30 s: the centre only from here to the end (overtime included)
  // 【终局锁定】最后 FINAL 秒起,目标永久锁定回中央 objectives[0](含加时)。若已在中央则只发一条
  // 'zones:active'(moved:false),否则 _swap 收回中央(final=true,不再轮换)。
  _finalLock() {
    this.final = true;
    this.nextSwap = 0;
    const C = this.objectives[0];
    if (this.active !== C) this._swap(C, true);
    else { this._net(['zf']); emit('zones:active', { objective: C.id, zones: C.zones.map((z) => z.id), final: true, moved: false }); }
  }

  // ---- time's up. Returns true when the match should end now; false = overtime has begun.
  // 【时间到】返回 true = 立即结束;false = 进入加时。落后者 L:若 L 正好持有目标,或(在无人控制且 L 是
  // 上一任控制者)仍在 overtimeGrace 宽限内 → 给 L 加时(不结束)。打平(L<0)→ 突然死亡加时(谁先领先谁赢,
  // 或到加时上限)。否则正常结束,判 1-L 为胜者(reason 'time')。
  timeUp() {
    const L = this.losing();
    const grace = this.owner === -1 && this.lastOwner === L && this.neutralT < ZONES.overtimeGrace;
    if (L >= 0 && (this.owner === L || grace)) {
      this.overtime = true; this.overtimeT = 0; this.otLosing = L;
      this._net(['zt', L]);
      emit('zones:overtime', { losing: L });
      return false;
    }
    if (L < 0) {
      // level at the horn: sudden death — play on until someone gets ahead (or the overtime cap)
      this.overtime = true; this.overtimeT = 0;
      this._net(['zt', -1]);
      emit('zones:overtime', { losing: -1 });
      return false;
    }
    this._end(1 - L, 'time');
    return true;
  }

  // Overtime ends when: the losing team's count gets below the winning team's (it wins; its penalty is counted off first); the losing team is off the objective for
  // 10 s (two-zone centre: the winning team holds at least one zone neutral / theirs for 10 s); the winning team takes
  // the objective (both zones on a two-zone centre); or after 5 minutes.
  _overtime(dt) {
    this.overtimeT += dt;
    // the team behind at the horn stays "L" (read live, it would flip the moment L's count passes W's and a comeback
    // would end as a retake); sudden death from a tie: whoever falls behind first
    let L = this.otLosing;
    if (L < 0) {
      L = this.losing();
      if (L < 0) {                                                        // still level
        if (this.overtimeT >= ZONES.overtimeMax) this._end(this._tiebreak(), 'overtime-cap');
        return;
      }
    }
    const W = 1 - L;
    if (this.count[L] < this.count[W]) return this._end(L, 'comeback');
    if (this.owner === W) return this._end(W, 'retake');
    if (this.owner !== L && this.neutralT >= ZONES.overtimeGrace) return this._end(W, 'neutralised');
    if (this.overtimeT >= ZONES.overtimeMax) return this._end(W, 'overtime-cap');
  }

  _tiebreak() {
    const s = [0, 0];
    for (const z of this.active.zones) { s[0] += z.share[0]; s[1] += z.share[1]; }
    return s[0] === s[1] ? (Math.random() < 0.5 ? 0 : 1) : s[0] > s[1] ? 0 : 1;
  }

  _end(winner, reason) {
    if (this.winner != null) return;
    this._net(['ze', winner, reason, r3(this.count[0]), r3(this.count[1]), r3(this.penalty[0]), r3(this.penalty[1])]);   // (the final numbers, exact)
    this.winner = winner; this.reason = reason;
    emit('zones:end', { winner, reason, counts: [...this.count], penalty: [...this.penalty] });
    this.match.endZones?.(winner, reason);
  }

  // ---- online: a follower replays the host's records (netmatch 'z', on the host's event timeline)
  netEvent(e) {
    if (!Array.isArray(e) || !this.follower || this.winner != null) return;
    switch (e[0]) {
      case 'zz': { const z = this.zones[e[1]]; if (z) this._zoneOwner(z, e[2]); break; }
      case 'zo': {
        const o = e[1], prev = this.owner;
        if (o === prev) break;
        this.owner = o;
        if (o === -1) this.neutralT = 0;
        else { if (this.lastOwner !== o) { this.start[o] = this.total(o); this.tieEnd[o] = null; } this.lastOwner = o; }   // (kept for a host migration)
        this.holdT[0] = this.holdT[1] = 0;
        emit('zones:control', { owner: o, prev, objective: this.active.id });
        break;
      }
      case 'zp': {
        const [, t, p, start, end] = e;
        this.penalty[t] += p;
        this.log.push({ t: this.match.duration - this.match.time, team: t, start, end, penalty: p, next: this.total(t) });
        emit('zones:penalty', { team: t, penalty: p, total: this.total(t), start, end });
        break;
      }
      case 'za': { const next = this.objectives[e[1]]; if (!next) break; if (e[2]) { this.final = true; } this._swap(next, !!e[2]); break; }
      case 'zf': {
        this.final = true; this.nextSwap = 0;
        const C = this.objectives[0];
        emit('zones:active', { objective: C.id, zones: C.zones.map((z) => z.id), final: true, moved: false });
        break;
      }
      case 'zt': this.overtime = true; this.overtimeT = 0; this.otLosing = e[1]; emit('zones:overtime', { losing: e[1] }); break;
      case 'zs': {
        const [, c0, c1, p0, p1, ns, ot, nt, h0, h1] = e;
        this.count[0] = c0; this.count[1] = c1; this.penalty[0] = p0; this.penalty[1] = p1;
        this.nextSwap = ns < 0 ? Infinity : ns;
        this.overtimeT = ot; this.neutralT = nt; this.holdT[0] = h0; this.holdT[1] = h1;
        break;
      }
      case 'ze':
        if (e.length > 3) { this.count[0] = e[3]; this.count[1] = e[4]; this.penalty[0] = e[5]; this.penalty[1] = e[6]; }
        this._end(e[1], e[2]);
        break;
    }
  }

  // snapshot for the HUD / results / tests
  state() {
    return {
      active: this.active.id, owner: this.owner, lastOwner: this.lastOwner,
      count: this.count.map((c) => Math.ceil(c)), penalty: [...this.penalty], total: [Math.ceil(this.total(0)), Math.ceil(this.total(1))],
      zones: this.active.zones.map((z) => ({ id: z.id, owner: z.owner, share: z.share.map((s) => +s.toFixed(3)), cells: z.cells.length, center: z.center })),
      nextSwap: this.final || !Number.isFinite(this.nextSwap) ? 0 : +this.nextSwap.toFixed(1), final: this.final, overtime: this.overtime, overtimeT: +this.overtimeT.toFixed(1), neutralT: +this.neutralT.toFixed(1),
      winner: this.winner, reason: this.reason, placeholder: this.placeholder,
    };
  }
}
