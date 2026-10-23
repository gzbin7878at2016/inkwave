// ============================================================================
// 【中文导读】Boss 模式 HUD 扩展层：血条/标题卡/招式播报/伤害数字/结局，挂在一个 HUD 实例上。
// ----------------------------------------------------------------------------
// 【模块定位】与 hud.js 是"宿主—扩展"关系：HUD 在构造函数里 `this.boss = new BossHud(this)`，
//   每帧在自己 update() 末尾调 `this.boss.update(dt)`。本文件不独立成屏，而是把 Boss 专用件
//   插入 HUD 已有的 DOM 里（_build 用 `hud.el.insertBefore(..., hud.top)` 插到顶栏前，
//   并把"大场面"层挂到不可隐藏的 `hud.overLayer`，这样 hud.setVisible(false) 也压不住它们）。
// 【核心机制】
//   ① 事件驱动：订阅 boss:spawn/intro/hp/move/hit/stun/phase/defeat（见 _unsubs），
//      与对局逻辑解耦；少量字段（pos/yaw/hp/stunned）直接读活的 Boss 作兜底/投影。
//   ② 自有时钟 this.T：HUD 的 fx 时钟只在有特效时跑，Boss 的 HP 缓动/播报计时需要连续推进，
//      故本层自带 _t()。每个状态字段用 _fresh() 复位。
//   ③ 白条 chip 机制：掉血时先留一段"残影"延迟 0.6 s 再追平，受连续攻击时残影也会持续下漏
//      （见 _hp 的 chipHold 逻辑）——比一次性补间更符合"被打空"的观感。
//   ④ 每帧路径只写 transform/opacity（_writeBar 用 translateX 百分比、_placeCall 用 translate3d），
//      其余靠类名切换触发 CSS 动画。
// 【关键约定】单位：世界坐标用米（_anchor 的 up 偏移、5.2/3.2 的模型高度）；屏幕坐标用 px。
//   UI 缩放基准 _u() = min(vw/100, vh*1.7778/100)——16:9 归一化，保证不同分辨率下比例一致。
// 【配套阅读】docs/BOSS.zh-CN.md、docs/BOSS.md「UI」节；宿主 src/ui/hud.js；美术 src/ui/boss-art.js。
// ============================================================================
// INKWAVE — boss-mode HUD layer (docs/BOSS.md "UI"). The HUD owns one: `hud.boss = new BossHud(hud)`.
//   Boss bar (top centre, under the timer): emblem, name tape, phase pips, HP with 66 / 33 % notches, white chip-away
//   trail, damage + weak-point flashes, OPEN! stun state with a draining stun meter, phase-change shield, phase-3 enrage.
//   Title card on boss:intro (splat band + slammed letters, ~2.5 s, never blocks input), move callouts pinned to the
//   boss on screen (kept out of the crosshair zone; edge-pinned with an arrow when it's off screen; CHARGE! shows the
//   charge direction), combo damage numbers + CRIT! pops for your own hits, phase banners, SUNK! / TIME'S UP endings.
// Driven by the bus events of the contract; a few fields are read off the live Boss (pos, yaw, hp, stunned) as a
// fallback / for projection only. Everything per-frame is transform/opacity; the rest is class toggles.
//
// Lab / console preview (no gameplay needed):  __G.hud.boss.demo()  → runs every state on a fake boss in front of you.
import { h, clamp, splatSVG, restartAnim, easeOutCubic, fmtInt } from './ui-util.js';
import { GLYPHS } from './ui-icons.js';
import { on, emit, G } from '../core/ctx.js';
import { BOSS_NAME, BOSS_EPITHET, MOVE_ICONS, MOVE_LABELS, bossEmblem } from './boss-art.js';
import { t } from '../i18n/strings.js';

// 【常量】
// 【血量刻痕】HP 条上的两个 66%/33% 分界；越过时打 is-past/is-break 类做"断痕"演出。
const NOTCHES = [2 / 3, 1 / 3];
// 【会播报的招式】只有这些招式在 boss:move 的 tele/act 阶段弹屏上提示；open 单独走 _stun。
const CALL_MOVES = new Set(['slam', 'barrage', 'sweep', 'charge', 'crablets', 'frenzy']);
// 【阶段横幅文案】2/3 阶段切换时的大字+副标（t() 在用时本地化）。
const PHASE_TXT = {
  2: { big: 'PHASE 2!', sub: 'Crablets incoming — pop them fast!' },
  3: { big: 'SHELL CRACKED!', sub: 'Final phase · hit the glowing belly!' },
};
// 【轻量三维向量】避免 import three：只要 {x,y,z} 结构，投影由 hud._project 完成。
const V3 = () => ({ x: 0, y: 0, z: 0 });

// 【BossHud 类】一个 HUD 实例持有一个；构造即搭 DOM、订阅总线；setMode 控制开/关。
export class BossHud {
  // 【构造函数】保存宿主 hud，初始化状态（_fresh）、临时向量与复用的 _tmp 向量（带 set/copy 自增方法，避免每帧 new）。
  constructor(hud) {
    this.hud = hud;
    this.on = false;
    this.boss = null;
    this.T = 0;
    this.S = this._fresh();
    this._tmp = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } };
    this._build();
    this._unsubs = [
      on('boss:spawn', (e) => this._spawn(e && e.boss)),
      on('boss:intro', (e) => this._intro(e || {})),
      on('boss:hp', (e) => this._hp(e || {})),
      on('boss:move', (e) => this._move(e || {})),
      on('boss:hit', (e) => this._hit(e || {})),
      on('boss:stun', (e) => this._stun(e || {})),
      on('boss:phase', (e) => this._phase(e || {})),
      on('boss:defeat', (e) => this._defeat(e || {})),
    ];
  }

  // 【状态复位】一局 Boss 的全部可变状态集中此处；setMode 与多次 intro 都会调用，防止上局残留。
  _fresh() {
    return { hp: 1, max: 1, shown: 1, chip: 1, chipHold: 0, gotHp: false, phase: 1, stunT: 0, stunDur: 0, sawStun: false, shieldT: 0,
      dead: false, introT: null, tickT: 0, hitT: -9, weakT: -9, critT: -9, move: null, moveT: 0, movePh: null, openT: 0,
      cx: null, cy: null, combo: null, nums: [], ended: false, L: {} };
  }

  // ================================================================ build
  // 【DOM 搭建】一次性建好血条（徽章/名牌/阶段点/HP 轨道/晕眩条/百分比/OPEN 牌）、招式播报药丸、
  //   伤害数字层与结局层；元素引用存字段。血条插入 HUD 顶栏之前，结局层挂 overLayer。
  _build() {
    const hud = this.hud;
    // ---- boss bar
    this.fill = h('i', { class: 'iw-bb__fill' }, h('i', { class: 'iw-bb__stripes' }), h('i', { class: 'iw-bb__gloss' }));
    this.chip = h('i', { class: 'iw-bb__chip' });
    this.edge = h('i', { class: 'iw-bb__edgewrap' }, h('i', { class: 'iw-bb__edge' }));
    this.notches = NOTCHES.map((f, i) => h('i', { class: 'iw-bb__notch', style: { left: `${(f * 100).toFixed(2)}%` } }, h('b', null, i ? 'III' : 'II')));
    this.shield = h('i', { class: 'iw-bb__shield', html: GLYPHS.lock });
    this.track = h('div', { class: 'iw-bb__track' }, h('div', { class: 'iw-bb__clip' }, this.chip, this.fill, this.edge, h('i', { class: 'iw-bb__flash' })), this.notches, this.shield);
    this.stunBar = h('i', { class: 'iw-bb__stunfill' });
    this.pips = [1, 2, 3].map((n) => h('i', { class: 'iw-bb__pip', 'data-n': n }));
    this.pctEl = h('b', null, '100');
    this.emb = h('div', { class: 'iw-bb__emb' },
      h('span', { class: 'iw-bb__embsplat', html: splatSVG({ seed: 44, fill: 'var(--boss)', r: 60, arms: 9, drops: 3 }) }),
      h('span', { class: 'iw-bb__embart', html: bossEmblem() }),
      h('span', { class: 'iw-bb__stars' }, h('i', { html: GLYPHS.star }), h('i', { html: GLYPHS.star }), h('i', { html: GLYPHS.star })),
      h('span', { class: 'iw-bb__x', html: GLYPHS.close }));
    this.bar = h('div', { class: 'iw-bb is-off' },
      this.emb,
      h('div', { class: 'iw-bb__plate' },
        h('div', { class: 'iw-bb__head' },
          h('span', { class: 'iw-bb__name iw-display' }, BOSS_NAME),
          h('span', { class: 'iw-bb__rage' }, 'ENRAGED'),
          h('span', { class: 'iw-bb__grow' }),
          h('span', { class: 'iw-bb__phase' }, h('small', null, 'PHASE'), this.pips)),
        this.track,
        h('div', { class: 'iw-bb__stun' }, this.stunBar)),
      h('div', { class: 'iw-bb__pct' }, this.pctEl, h('small', null, '%')),
      h('div', { class: 'iw-bb__open' }, h('i', { html: MOVE_ICONS.open }), h('span', { class: 'iw-display' }, 'OPEN!')));

    // ---- move callout (one reusable pill that follows the boss on screen)
    this.callIcon = h('i', { class: 'iw-bmv__icon' });
    this.callTxt = h('b', { class: 'iw-display' });
    this.callArrow = h('i', { class: 'iw-bmv__dir', html: '<svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="M-12 -9 L10 0 L-12 9 L-7 0 Z"/></svg>' });
    this.callEdge = h('i', { class: 'iw-bmv__edge' });
    this.call = h('div', { class: 'iw-bmv' }, this.callEdge, h('span', { class: 'iw-bmv__pill' }, this.callIcon, this.callTxt, this.callArrow));
    this.numLayer = h('div', { class: 'iw-bnums' });
    this.layer = h('div', { class: 'iw-bhud' }, this.numLayer, this.call, this.bar);
    hud.el.insertBefore(this.layer, hud.top);
    // big moments survive hud.setVisible(false) (intro, results hand-over)
    this.over = h('div', { class: 'iw-bover' });
    hud.overLayer.appendChild(this.over);
  }

  // 【销毁】退订总线、移除两处根节点。
  dispose() { this._unsubs.forEach((u) => u()); this._preparedTitle?.remove(); this._preparedTitle = null; this.layer.remove(); this.over.remove(); }

  // ================================================================ mode + accessors
  /** Called by the HUD at every match intro (and by boss:spawn). */
  // 【开关/重置】HUD 每次 match intro 与 boss:spawn 都会调。切换 is-boss 类、复位状态、清空各层，
  //   若 boss 已给出 maxHp 则按当前血量初始化条形。
  setMode(onoff, boss = null) {
    onoff = !!onoff;
    this.on = onoff;
    this.boss = onoff ? boss || this.boss || null : null;
    this.S = this._fresh();
    this.hud.el.classList.toggle('is-boss', onoff);
    this.hud.overLayer.classList.toggle('is-boss', onoff);
    this.bar.className = 'iw-bb' + (onoff ? '' : ' is-off');
    this.emb.querySelector('.iw-bb__embart').innerHTML = bossEmblem();
    this.numLayer.innerHTML = '';
    this.over.innerHTML = '';
    this.call.classList.remove('is-on', 'is-act', 'is-open');
    this.notches.forEach((n) => n.classList.remove('is-past', 'is-break'));
    this._pips(1);
    const b = this.boss;
    if (b && b.maxHp) { this.S.max = b.maxHp; this.S.hp = this.S.shown = this.S.chip = clamp(b.hp / b.maxHp); }
    this._writeBar(true);
  }
  // 【取 Boss】优先本层持有的，其次对局对象上的 G.match.boss。
  _b() { return this.boss || (G.match && G.match.boss) || null; }
  // 【是否本地玩家造成】用于只给自己做的事加反馈（伤害数字/准星刻度）。
  _mine(a) { const hd = this.hud; return !!a && (a === hd._local() || !!a.isLocal); }
  _t() { return this.T; }   // own clock (the HUD's fx clock only runs while it has effects)
  // 【UI 缩放基准】min(vw/100, vh*1.7778/100)：以 16:9 归一，1 单位≈屏宽的 1/100；所有像素偏移乘它。
  _u() { return Math.min(innerWidth / 100, (innerHeight * 1.7778) / 100); }
  /** World-space anchor: a model socket if the model exposes one, else the boss root + a height. */
  // 【世界锚点】优先取模型 socket（借 boss.pos 的构造器造 Vector3，免 import three）；
  //   失败则退回 boss 根 + 经验高度（shellTop≈5.2、其余 3.2）+ up 偏移。写入 out 复用对象。
  _anchor(name, up, out) {
    const b = this._b();
    if (!b) return null;
    const m = b.model;
    if (m && m.getSocket && name && b.pos && b.pos.constructor && b.pos.constructor.prototype.applyMatrix4) {
      // the model wants a real THREE.Vector3 (localToWorld) — borrow the class off boss.pos, no three import here
      const v = this._sv || (this._sv = new b.pos.constructor());
      try { m.getSocket(name, v); if (Number.isFinite(v.x) && (v.x || v.y || v.z)) { out.x = v.x; out.y = v.y + up; out.z = v.z; return out; } } catch (e) { /* model mid-rebuild */ }
    }
    const p = b.pos || (b.root && b.root.position);
    if (!p) return null;
    out.x = p.x; out.y = p.y + (name === 'shellTop' ? 5.2 : 3.2) + up; out.z = p.z;
    return out;
  }
  // 【世界→屏幕】用宿主 hud._project 投影，转成 CSS 像素坐标；out.behind 标记是否在相机后方。
  _screen(w, out) {
    const cam = G.camera;
    if (!cam || !w) return null;
    const p = this.hud._project(cam, w.x, w.y, w.z);
    if (!p) return null;
    out.x = (p.x * 0.5 + 0.5) * innerWidth; out.y = (-p.y * 0.5 + 0.5) * innerHeight; out.behind = p.z > 1;
    return out;
  }

  // ================================================================ events
  // 【事件处理】七个 boss:* 事件的入口；a few 直接读活 Boss 兜底。各处理见下方方法。
  _spawn(boss) {
    if (!boss) return;
    if (!this.on || this.boss !== boss) this.setMode(true, boss);
  }

  // 【入场】清零点条、播 is-intro 动画、弹标题卡（_titleCard）；introT 开启入场填充序列。
  _intro(e) {
    if (!this.on) this.setMode(true, e.boss || null);
    const S = this.S;
    S.introT = 0;
    S.shown = 0; S.chip = 0;
    this._writeBar(true);
    restartAnim(this.bar, 'is-intro');
    this._titleCard();
  }

  // 【掉血】归一化到 0..1；下降时启动白条残影与 is-hit 抖动，越过刻痕则打断痕，归零播 is-zero。
  //   残影延迟见上方导读【核心机制】③（chipHold=0.6 s）。
  _hp({ hp, max }) {
    if (!this.on) return;
    const S = this.S;
    if (max > 0) S.max = max;
    const t = clamp((+hp || 0) / Math.max(1e-6, S.max));
    S.gotHp = true;
    const prev = S.hp;
    S.hp = t;
    if (t < prev - 1e-5) {
      // a new white chip segment starts only once the last one has caught up — under a constant stream of hits
      // (the whole squad firing) the chip still drains instead of hanging at the fight's first hit
      if (S.chip <= S.shown + 0.003) S.chipHold = 0.6;
      const now = this._t();
      if (now - S.hitT > 0.07) { S.hitT = now; restartAnim(this.bar, 'is-hit'); }
      NOTCHES.forEach((f, i) => {
        if (prev > f && t <= f) { this.notches[i].classList.add('is-past'); restartAnim(this.notches[i], 'is-break'); }
      });
    }
    if (t <= 0 && !S.dead) restartAnim(this.bar, 'is-zero');
  }

  // 【招式阶段】tele(预警)→弹播报；act(生效)→重放动作动画；rec(后摇)→收起（OPEN 期间不收）。
  _move({ id, phase }) {
    if (!this.on || this.S.dead) return;
    const S = this.S;
    S.move = id; S.movePh = phase; S.moveT = 0;
    if (!CALL_MOVES.has(id)) { if (phase !== 'act' && S.openT <= 0) this.call.classList.remove('is-on', 'is-act'); return; }
    if (phase === 'tele') {
      if (S.openT > 0) return;
      this._showCall(id);
      this.hud._snd('ui_hover', { volume: 0.4, pitch: 0.7 });
    } else if (phase === 'act') {
      if (this.call.dataset.move === id) restartAnim(this.call, 'is-act');
    } else if (phase === 'rec' && S.openT <= 0) this.call.classList.remove('is-on', 'is-act');
  }
  // 【显示播报】设置药丸图标/文案，charge 加方向箭头类、open 加开壳类，重放 is-on 入场。
  _showCall(id) {
    this.call.dataset.move = id;
    this.callIcon.innerHTML = MOVE_ICONS[id] || MOVE_ICONS.open;
    this.callTxt.textContent = t(MOVE_LABELS[id] || id.toUpperCase());
    this.call.classList.toggle('is-open', id === 'open');
    this.call.classList.toggle('has-dir', id === 'charge');
    this.call.classList.remove('is-act');
    this.S.callT = 0;
    restartAnim(this.call, 'is-on');
  }

  // 【命中反馈】crab=小蟹：只给准星刻度；blocked=无敌期：给自己弹灰色 IMMUNE；weak=弱点：抖血条/徽章、
  //   加 CRIT!、准星重刻度；普通命中也给准星刻度并按世界点弹伤害数字。
  _hit({ damage = 0, weak = false, attacker = null, pos = null, crab = false, blocked = false }) {
    if (!this.on || this.S.dead) return;
    const S = this.S, now = this._t();
    const mine = this._mine(attacker);
    if (crab) { if (mine) { this.hud._lastHitDmg = damage; this.hud.hitMarker('hit'); } return; }   // crablets: just the reticle tick
    if (blocked) {
      // invulnerable beat (phase change / intro): a grey IMMUNE pop instead of numbers
      if (mine && now - (S.immT || -9) > 0.6) { S.immT = now; const w = V3(); if (pos && Number.isFinite(pos.x)) { w.x = pos.x; w.y = pos.y; w.z = pos.z; } else if (!this._anchor('shellTop', -1, w)) return; this._crit(w, 'IMMUNE'); }
      return;
    }
    if (weak && now - S.weakT > 0.12) { S.weakT = now; restartAnim(this.bar, 'is-weak'); restartAnim(this.emb, 'is-weak'); }
    if (!mine) return;
    // reticle: the HUD's own hit marker (heavier for weak points)
    const hd = this.hud;
    hd._lastHitDmg = weak ? Math.max(70, damage) : Math.max(24, damage);
    hd.hitMarker('hit');
    hd.hitEl.classList.toggle('is-weak', !!weak);
    // world point: the hit position, else a weak-point / body socket
    const w = V3();
    if (pos && Number.isFinite(pos.x)) { w.x = pos.x; w.y = pos.y; w.z = pos.z; }
    else if (!this._anchor(weak ? (S.phase >= 3 || S.openT > 0 ? 'belly' : Math.random() < 0.5 ? 'eyeL' : 'eyeR') : 'shellTop', weak ? 0 : -1.2, w)) return;
    this._addNum(w, +damage || 0, !!weak, now);
    if (weak && now - S.critT > 0.22) { S.critT = now; this._crit(w); }
  }

  // 【晕眩/OPEN】进入开壳窗口：设倒计时、加 is-open、弹 OPEN 播报与音效。dur 最小 0.5 s。
  _stun({ dur = 3 }) {
    if (!this.on || this.S.dead) return;
    const S = this.S;
    S.stunDur = S.stunT = S.openT = Math.max(0.5, +dur || 3);
    S.sawStun = false;
    this.bar.classList.add('is-open');
    restartAnim(this.bar.querySelector('.iw-bb__open'), 'is-pop');
    this._showCall('open');
    this.hud._snd('special_ready', { volume: 0.45, pitch: 1.25 });
  }

  // 【阶段切换】相位只增不减；设 1.8 s 护盾、更新阶段点；三阶段换裂壳徽章 + is-enraged；弹阶段横幅。
  _phase({ phase }) {
    if (!this.on) return;
    const S = this.S;
    phase = clamp(phase | 0, 1, 3);
    if (phase <= S.phase) return;
    S.phase = phase;
    S.shieldT = 1.8;
    this._pips(phase);
    if (phase >= 3) { this.bar.classList.add('is-enraged'); this.emb.querySelector('.iw-bb__embart').innerHTML = bossEmblem({ cracked: true }); }
    restartAnim(this.bar, 'is-phase');
    const T = PHASE_TXT[phase];
    if (T) this._banner(t(T.big), t(T.sub), phase);
  }

  // 【击败】置 dead、清 OPEN、血条 is-dead，1.3 s 后 is-gone 收条，并播胜利结局（_ending(true)）。
  _defeat() {
    if (!this.on || this.S.dead) return;
    const S = this.S;
    S.dead = true; S.hp = 0; S.openT = 0; S.stunT = 0;
    this.bar.classList.remove('is-open');
    this.bar.classList.add('is-dead');
    this.call.classList.remove('is-on', 'is-act');
    setTimeout(() => { if (this.S === S) this.bar.classList.add('is-gone'); }, 1300);
    this._ending(true);
  }

  /** hud.banner('timesup') in boss mode lands here. Returns true when handled. */
  // 【时间到】boss 模式下 HUD.banner('timesup') 转到这里；已死/已结束时返回 true 吞掉（不再弹 TIME'S UP）。
  timesUp() {
    if (!this.on) return false;
    if (this.S.dead || this.S.ended) return true;
    this.call.classList.remove('is-on', 'is-act');
    this._ending(false);
    return true;
  }

  /** Contextual prompt: the turf tutorial line becomes a boss one; OPEN! gets its own nudge.
   *  The tutorial is recognised by its message `kind` (a stable tag), never by matching the English wording. */
  // 【情境提示】OPEN 期间提示"全力输出"；识别 turf 教学提示时（按稳定 tag `kind==='turfTip'`，不匹配英文）
  //   替换成 Boss 版文案（三阶段引导打弱点）。
  prompt(p) {
    if (this.S.openT > 0.4 && !this.S.dead) return { id: 'It\u2019s OPEN \u2014 unload on it!' };
    if (p && p.kind === 'turfTip') return { id: this.S.phase >= 3 ? 'Shell cracked \u2014 hit the glowing belly!' : 'Shoot HULLBREAKER \u2014 its glowing eyes take extra damage!' };
    return p;
  }

  /** The 4v4 roster slots re-used for the squad: up to 8 kids, 4 either side of the timer, all in squad ink. */
  // 【顶栏队伍重映射】把 4v4 的八个槽位拿来显示 8 人小队：全部同色（队 0 色），左 4 右 4。
  squadTeams(teams) {
    const all = [];
    for (const t of teams || []) for (const p of (t && t.players) || []) all.push(p);
    return [{ color: teams && teams[0] && teams[0].color, players: all.slice(0, 4) }, { color: teams && teams[0] && teams[0].color, players: all.slice(4, 8) }];
  }

  // ================================================================ per frame
  // 【每帧】推进自有时钟；缺事件时读活 Boss 兜底；推进 HP 入场填充/缓动、白条下漏、晕眩倒计时、
  //   护盾开关、招式播报跟随投影、伤害数字上升。只写 transform/opacity 与少量类名切换。
  update(dt) {
    if (!this.on) return;
    this.T += dt;
    const S = this.S, b = this._b();
    // fallbacks when the host's events are late / missing
    if (b && !S.gotHp && b.maxHp > 0) { const t = clamp(b.hp / b.maxHp); if (Math.abs(t - S.hp) > 1e-5) { this._hp({ hp: b.hp, max: b.maxHp }); S.gotHp = false; } }
    if (b && b.dead && !S.dead && S.hp <= 0.001) this._defeat();
    // HP display: intro fill, else a quick ease toward the target; the white chip lags then drains
    if (S.introT != null) {
      // fills once the title card is leaving AND the HUD is up (in the boss intro the HUD appears later)
      S.introT += dt;
      S.visT = this.hud._visible ? (S.visT || 0) + dt : 0;
      const k = clamp(Math.min(S.introT - 2.25, S.visT - 0.2) / 1.05);
      S.shown = S.chip = S.hp * easeOutCubic(k);
      if (k > 0 && k < 1 && (S.tickT -= dt) <= 0) { S.tickT = 0.055; this.hud._snd('xp_tick', { volume: 0.45, pitch: 0.6 + k * 0.7 }); }
      if (k >= 1) { S.introT = null; restartAnim(this.bar, 'is-full'); }
    } else {
      S.shown += (S.hp - S.shown) * Math.min(1, dt * 16);
      if (Math.abs(S.hp - S.shown) < 1e-4) S.shown = S.hp;
      if (S.chipHold > 0) S.chipHold -= dt;
      else S.chip = Math.max(S.shown, S.chip - dt * Math.max(0.2, (S.chip - S.shown) * 2.2));
      if (S.chip < S.shown) S.chip = S.shown;
    }
    this._writeBar(false);
    // stun window + phase shield
    if (S.openT > 0) {
      S.openT -= dt; S.stunT = S.openT;
      if (b && b.stunned) S.sawStun = true;
      if (b && S.sawStun && b.stunned === false && S.openT > 0.2) S.openT = 0;   // host ended it early
      this.stunBar.style.transform = `scaleX(${clamp(S.openT / Math.max(0.01, S.stunDur)).toFixed(4)})`;
      if (S.openT <= 0) { this.bar.classList.remove('is-open'); if (this.call.dataset.move === 'open') this.call.classList.remove('is-on'); }
    }
    if (S.shieldT > 0) S.shieldT -= dt;
    const sh = S.shieldT > 0 || !!(b && b.invuln);
    if (sh !== S.L.sh) { S.L.sh = sh; this.bar.classList.toggle('is-shield', sh); }
    // callout follows the boss
    if (this.call.classList.contains('is-on')) {
      S.callT = (S.callT || 0) + dt;
      if (S.callT > 3.2 && this.call.dataset.move !== 'open') this.call.classList.remove('is-on', 'is-act');
      else this._placeCall(dt);
    } else S.cx = null;
    this._updNums(dt);
  }

  // 【写血条】把 shown/chip 转成 translateX 百分比（-100% 即空）、更新百分比数字与 is-low；
  //   用 S.L 缓存上次写入的整数值做脏检查，避免每帧无谓的 DOM 写入。
  _writeBar(force) {
    const S = this.S, L = S.L;
    const f = (v) => `translateX(${((v - 1) * 100).toFixed(3)}%)`;
    const a = Math.round(S.shown * 4000), c = Math.round(S.chip * 4000);
    if (force || a !== L.a) { L.a = a; this.fill.style.transform = f(S.shown); this.edge.style.transform = f(S.shown); }
    if (force || c !== L.c) { L.c = c; this.chip.style.transform = f(S.chip); }
    const pc = S.shown > 0 && S.shown < 0.01 ? 1 : Math.ceil(S.shown * 100 - 1e-6);
    if (force || pc !== L.pc) { L.pc = pc; this.pctEl.textContent = String(pc); }
    const low = S.shown <= 0.2 && S.shown > 0;
    if (low !== L.low) { L.low = low; this.bar.classList.toggle('is-low', low); }
  }

  // 【阶段点】点亮 1..phase 的点，当前点加 is-cur；相位存到 bar.dataset.phase 供 CSS 用。
  _pips(phase) {
    this.pips.forEach((p, i) => { p.classList.toggle('is-on', i < phase); p.classList.toggle('is-cur', i === phase - 1); });
    this.bar.dataset.phase = String(phase);
  }

  // 【播报定位】把药丸钉在 Boss 头顶（_anchor('shellTop')+1.9）投影出的屏幕点；出屏则贴边+箭头，
  //   屏内则推离准星椭圆；用 k=min(1,dt*12) 做平滑跟随。CHARGE! 时另算方向箭头。
  _placeCall(dt) {
    const S = this.S, u = this._u(), W = innerWidth, H = innerHeight;
    const w = this._anchor('shellTop', 1.9, this._tmp);
    const sp = w && this._screen(w, { x: 0, y: 0 });
    if (!sp) return;
    let x = sp.x, y = sp.y, edge = false, ang = 0;
    let dx = x - W / 2, dy = y - H / 2;
    if (sp.behind) { dx = -dx; dy = -dy; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1; }
    const mx = u * 7, myT = u * 16, myB = u * 7;
    if (!sp.behind && x >= mx && x <= W - mx && y < myT) y = myT;   // on screen but tall: sit just under the boss bar
    if (sp.behind || x < mx || x > W - mx || y > H - myB) {
      edge = true;
      ang = Math.atan2(dy, dx);
      const ex = W / 2 - mx, ey = (H - myT - myB) / 2, cyE = myT + ey;
      const k = Math.min(ex / Math.max(1e-3, Math.abs(Math.cos(ang))), ey / Math.max(1e-3, Math.abs(Math.sin(ang))));
      x = W / 2 + Math.cos(ang) * k; y = cyE + Math.sin(ang) * k;
    } else {
      // never over the crosshair: push out of an ellipse around the centre (upward when dead centre)
      const rx = u * 15, ry = u * 10.5;
      const ddx = x - W / 2, ddy = y - H / 2, r = (ddx / rx) ** 2 + (ddy / ry) ** 2;
      if (r < 1) {
        if (r < 1e-4) { x = W / 2; y = H / 2 - ry; } else { const s = 1 / Math.sqrt(r); x = W / 2 + ddx * s; y = H / 2 + ddy * s; }
      }
    }
    if (S.cx == null) { S.cx = x; S.cy = y; }
    const k = Math.min(1, dt * 12);
    S.cx += (x - S.cx) * k; S.cy += (y - S.cy) * k;
    this.call.style.transform = `translate3d(${S.cx.toFixed(1)}px,${S.cy.toFixed(1)}px,0)`;
    if (edge !== S.L.edge) { S.L.edge = edge; this.call.classList.toggle('is-edge', edge); }
    if (edge) this.callEdge.style.transform = `rotate(${ang.toFixed(3)}rad)`;
    // CHARGE!: the arrow points where it's going to run (boss forward, projected)
    if (this.call.dataset.move === 'charge') {
      const b = this._b();
      let da = 0;
      const p = b && (b.pos || (b.root && b.root.position));
      if (p) {
        const mp = b.move && (b.move.p || b.move.params);
        const yaw = mp && Number.isFinite(mp.yaw) ? mp.yaw : b.yaw ?? (b.root ? b.root.rotation.y : 0);
        const d = mp && mp.dir;
        const fx = d ? d.x : Math.sin(yaw), fz = d ? d.z : Math.cos(yaw);
        const a0 = this._screen({ x: p.x, y: p.y + 1, z: p.z }, { x: 0, y: 0 }), a1 = this._screen({ x: p.x + fx * 6, y: p.y + 1, z: p.z + fz * 6 }, { x: 0, y: 0 });
        if (a0 && a1 && !a0.behind && !a1.behind) da = Math.atan2(a1.y - a0.y, a1.x - a0.x);
        else { const cam = G.camera; if (cam && cam.matrixWorld) { const e = cam.matrixWorld.elements; da = Math.atan2(-(fx * -e[8] + fz * -e[10]), fx * e[0] + fz * e[2]); } }
      }
      this.callArrow.style.transform = `rotate(${da.toFixed(3)}rad)`;
    }
  }

  // ---------------------------------------------------------------- damage numbers
  // 【加数字】把连续命中归并进一个 combo（0.45 s 内续接），累加和值、按对数放大字号、重放 is-bump；
  //   超过 6 组则挤掉最老的。伤害数字的锚点用世界坐标随时间向新点缓动。
  _addNum(w, dmg, weak, now) {
    const S = this.S;
    let c = S.combo;
    if (!c || c.out || now - c.last > 0.45) {
      const el = h('div', { class: 'iw-bnum' }, h('b'));
      this.numLayer.appendChild(el);
      c = S.combo = { el, txt: el.firstChild, sum: 0, w: { ...w }, last: now, born: now, weak: false, out: false, jx: (Math.random() - 0.5) * 2 };
      S.nums.push(c);
      while (S.nums.length > 6) { const o = S.nums.shift(); o.el.remove(); }
    }
    c.sum += dmg; c.last = now;
    c.w.x += (w.x - c.w.x) * 0.35; c.w.y += (w.y - c.w.y) * 0.35; c.w.z += (w.z - c.w.z) * 0.35;
    if (weak && !c.weak) { c.weak = true; c.el.classList.add('is-weak'); }
    c.txt.textContent = fmtInt(c.sum);
    c.el.style.setProperty('--s', clamp(0.85 + Math.log10(Math.max(1, c.sum)) * 0.16 + (c.weak ? 0.2 : 0), 0.85, 1.6).toFixed(3));
    restartAnim(c.el, 'is-bump');
  }
  // 【弹字】在世界点投影处弹一个 CRIT!/IMMUNE 大字，animationend 或 900 ms 兜底移除。
  _crit(w, txt = 'CRIT!') {
    const p = this._screen(w, { x: 0, y: 0 });
    if (!p || p.behind) return;
    const el = h('div', { class: 'iw-bcrit' + (txt === 'CRIT!' ? '' : ' is-immune') }, h('i', { class: 'iw-bcrit__burst' }), h('span', { class: 'iw-display' }, txt));
    el.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - this._u() * 2.4).toFixed(1)}px,0)`;
    el.addEventListener('animationend', (e) => { if (e.target === el) el.remove(); });
    setTimeout(() => el.remove(), 900);
    this.numLayer.appendChild(el);
  }
  // 【数字更新】每帧重投影各组数字锚点，超 1.05 s 移除、超 0.45 s 加 is-out 淡出并继续上升；
  //   出屏/在相机后则透明度置 0。
  _updNums() {
    const S = this.S, now = this._t(), u = this._u();
    for (let i = S.nums.length - 1; i >= 0; i--) {
      const c = S.nums[i];
      const age = now - c.last;
      if (age > 1.05) { c.el.remove(); S.nums.splice(i, 1); if (S.combo === c) S.combo = null; continue; }
      if (age > 0.45 && !c.out) { c.out = true; c.el.classList.add('is-out'); }
      const p = this._screen(c.w, { x: 0, y: 0 });
      if (!p || p.behind) { c.el.style.opacity = '0'; continue; }
      const rise = (now - c.born) * u * 1.6 + (c.out ? (age - 0.45) * u * 5 : 0);
      c.el.style.opacity = '';
      c.el.style.transform = `translate3d(${(p.x + c.jx * u).toFixed(1)}px,${(p.y - u * 1.5 - rise).toFixed(1)}px,0)`;
    }
  }

  // ---------------------------------------------------------------- big moments
  // 【标题卡】boss:intro 时在 overLayer 弹 2.5 s 标题卡（墨迹带+逐字砸落的 BOSS_NAME+别称），
  //   80 ms 后补一声 splat_big；animationend 或 3.2 s 兜底移除。
  _makeTitleCard() {
    const letters = [...BOSS_NAME].map((c, i) => h('span', { style: { '--i': i } }, c));
    const el = h('div', { class: 'iw-btc' },
      h('div', { class: 'iw-btc__band' },
        h('i', { class: 'iw-btc__stripes' }),
        h('span', { class: 'iw-btc__splat a', html: splatSVG({ seed: 71, fill: 'var(--boss)', r: 58, arms: 10, drops: 6 }) }),
        h('span', { class: 'iw-btc__splat b', html: splatSVG({ seed: 23, fill: 'var(--boss)', r: 56, arms: 9, drops: 5 }) })),
      h('div', { class: 'iw-btc__emb', html: bossEmblem() }),
      h('div', { class: 'iw-btc__txt' },
        h('div', { class: 'iw-btc__tags' }, h('div', { class: 'iw-btc__tag' }, h('i', { html: GLYPHS.swords }), 'BOSS BATTLE'), h('span', { class: 'iw-beta iw-btc__beta' }, 'PUBLIC BETA')),
        h('div', { class: 'iw-btc__name iw-display' }, letters),
        h('div', { class: 'iw-btc__epi' }, t(BOSS_EPITHET).toUpperCase())));
    return el;
  }

  // 提前创建同一张真实标题卡并加载字体/完成布局；不触发intro状态、动画计时器或任何声音。
  async prepareIntro({ isCurrent = () => true } = {}) {
    if (!isCurrent()) return { cancelled: true };
    const el = this._preparedTitle || (this._preparedTitle = this._makeTitleCard());
    const nodes = [el, ...el.querySelectorAll('*')], styles = nodes.map(node => node.getAttribute('style'));
    try {
      for (const node of nodes) node.style.animation = 'none';
      el.style.visibility = 'hidden'; el.style.pointerEvents = 'none'; this.over.appendChild(el);
      const name = el.querySelector('.iw-btc__name');
      const font = name && globalThis.getComputedStyle?.(name).font;
      if (font && globalThis.document?.fonts?.load) await document.fonts.load(font, BOSS_NAME);
      if (!isCurrent()) { if (this._preparedTitle === el) this._preparedTitle = null; return { cancelled: true }; }
      const bounds = el.getBoundingClientRect();
      return { titlePrepared: true, nodes: nodes.length, width: Math.round(bounds.width), height: Math.round(bounds.height) };
    } finally {
      el.remove(); nodes.forEach((node, index) => styles[index] === null ? node.removeAttribute('style') : node.setAttribute('style', styles[index]));
    }
  }

  _titleCard() {
    this.over.querySelectorAll('.iw-btc').forEach((e) => e.remove());
    const el = this._preparedTitle || this._makeTitleCard(); this._preparedTitle = null;
    el.addEventListener('animationend', (e) => { if (e.target === el) el.remove(); });
    setTimeout(() => el.remove(), 3200);
    this.over.appendChild(el);
    setTimeout(() => { if (el.isConnected) this.hud._snd('splat_big', { volume: 0.7, pitch: 0.7 }); }, 80);
  }

  // 【阶段横幅】阶段切换时弹 big+sub 大字横幅（三阶段带 is-rage）；animationend 或 3.4 s 兜底移除。
  _banner(big, sub, phase) {
    this.over.querySelectorAll('.iw-bph').forEach((e) => e.remove());
    const el = h('div', { class: 'iw-bph' + (phase >= 3 ? ' is-rage' : '') },
      h('span', { class: 'iw-bph__splat', html: splatSVG({ seed: 30 + phase * 7, fill: 'var(--boss)', r: 58, arms: 10, drops: 6 }) }),
      h('div', { class: 'iw-bph__tape' }, h('span', { class: 'iw-bph__big iw-display' }, big)),
      sub ? h('div', { class: 'iw-bph__sub' }, sub) : null);
    el.addEventListener('animationend', (e) => { if (e.target === el) el.remove(); });
    setTimeout(() => el.remove(), 3400);
    this.over.appendChild(el);
  }

  // 【结局】胜利播 Sunk!/失败播 TIME'S UP!：清掉标题卡/横幅与 HUD 名牌，弹爆裂墨滴+大字结局，
  //   胜利时移除 is-live；animationend 或 5.2 s 兜底移除。S.ended 保证只播一次。
  _ending(win) {
    const S = this.S;
    if (S.ended) return;
    S.ended = true;
    this.over.querySelectorAll('.iw-bph, .iw-btc').forEach((e) => e.remove());
    this.hud.bannerLayer.querySelectorAll('.iw-bn').forEach((b) => b.remove());
    const drops = Array.from({ length: 14 }, (_, i) => h('i', { class: 'iw-bend__drop', style: { '--a': `${i * (360 / 14) + Math.random() * 14}deg`, '--d': `${0.9 + Math.random() * 0.8}`, '--s': `${0.5 + Math.random() * 0.9}` } }));
    const word = t(win ? 'SUNK!' : "TIME'S UP!");
    const el = h('div', { class: 'iw-bend ' + (win ? 'is-win' : 'is-lose') },
      h('div', { class: 'iw-bend__burst' }, drops),
      h('div', { class: 'iw-bend__splat b', html: splatSVG({ seed: win ? 12 : 8, fill: win ? 'var(--boss)' : 'var(--self)', r: 60, arms: 10, drops: 6 }) }),
      h('div', { class: 'iw-bend__splat', html: splatSVG({ seed: win ? 5 : 19, fill: win ? 'var(--self)' : 'var(--boss)', r: 60, arms: 11, drops: 8 }) }),
      h('div', { class: 'iw-bend__emb', html: bossEmblem({ cracked: win }) }),
      h('div', { class: 'iw-bend__txt' },
        h('small', { class: 'iw-bend__who' }, win ? BOSS_NAME : t('HULLBREAKER GOT AWAY…')),
        h('div', { class: 'iw-bend__word iw-display' }, [...word].map((c, i) => h('span', { style: { '--i': i } }, c === ' ' ? ' ' : c)))));
    el.addEventListener('animationend', (e) => { if (e.target === el) el.remove(); });
    setTimeout(() => el.remove(), 5200);
    this.over.appendChild(el);
    if (win) this.hud.el.classList.remove('is-live');
  }

  // ================================================================ console preview
  // 【控制台预览】在镜头前 16 m 造一个假 Boss，用 setTimeout 按 steps 脚本依次触发 spawn/intro/move/
  //   hit/stun/phase/defeat——无需真实对局即可审 UI。返回 { boss, stop, duration }，stop() 清定时器。
  /** Runs every boss HUD state on a fake boss 14 m in front of the camera. For UI work / audits only. */
  demo(opts = {}) {
    const cam = G.camera;
    const fwd = { x: 0, z: -1 };
    if (cam && cam.matrixWorld) { const e = cam.matrixWorld.elements; const l = Math.hypot(e[8], e[10]) || 1; fwd.x = -e[8] / l; fwd.z = -e[10] / l; }
    const base = cam ? cam.position : { x: 0, y: 0, z: 0 };
    const d = opts.dist ?? 16;
    const boss = this._demoBoss = { pos: { x: base.x + fwd.x * d, y: 0, z: base.z + fwd.z * d }, yaw: Math.atan2(-fwd.x, -fwd.z) + (opts.yaw || 0.9), hp: 12000, maxHp: 12000, phase: 1, stunned: false, dead: false, move: null };
    const me = this.hud._local();
    const T = [];
    const at = (s, fn) => T.push(setTimeout(fn, s * 1000));
    const hit = (dmg, weak) => { boss.hp = Math.max(0, boss.hp - dmg * (weak ? 2.5 : 1)); emit('boss:hit', { damage: dmg * (weak ? 2.5 : 1), weak, attacker: me, pos: { x: boss.pos.x + (Math.random() - 0.5) * 2, y: weak ? 4.1 : 3 + Math.random() * 2, z: boss.pos.z } }); emit('boss:hp', { hp: boss.hp, max: boss.maxHp }); };
    emit('boss:spawn', { boss });
    at(0.1, () => emit('boss:intro', { boss, dur: 2.5 }));
    const steps = opts.steps || ['move', 'hits', 'stun', 'phase2', 'charge', 'phase3', 'end'];
    let t = 3.2;
    for (const s of steps) {
      if (s === 'move') { at(t, () => emit('boss:move', { id: 'slam', phase: 'tele', boss })); at(t + 0.9, () => emit('boss:move', { id: 'slam', phase: 'act', boss })); at(t + 1.6, () => emit('boss:move', { id: 'slam', phase: 'rec', boss })); t += 2; }
      if (s === 'hits') { for (let i = 0; i < 14; i++) at(t + i * 0.09, () => hit(38, i % 5 === 4)); t += 1.8; }
      if (s === 'stun') { at(t, () => { boss.stunned = true; emit('boss:stun', { dur: 3.5 }); }); for (let i = 0; i < 10; i++) at(t + 0.4 + i * 0.12, () => hit(40, true)); at(t + 3.5, () => { boss.stunned = false; }); t += 4; }
      if (s === 'phase2') { at(t, () => { boss.hp = Math.min(boss.hp, boss.maxHp * 0.64); emit('boss:hp', { hp: boss.hp, max: boss.maxHp }); boss.phase = 2; emit('boss:phase', { phase: 2 }); }); t += 3; }
      if (s === 'charge') { at(t, () => emit('boss:move', { id: 'charge', phase: 'tele', boss })); at(t + 1.2, () => emit('boss:move', { id: 'charge', phase: 'act', boss })); at(t + 2.4, () => emit('boss:move', { id: 'charge', phase: 'rec', boss })); t += 2.6; }
      if (s === 'phase3') { at(t, () => { boss.hp = Math.min(boss.hp, boss.maxHp * 0.3); emit('boss:hp', { hp: boss.hp, max: boss.maxHp }); boss.phase = 3; emit('boss:phase', { phase: 3 }); }); t += 3; }
      if (s === 'end') { at(t, () => { boss.hp = 0; boss.dead = true; emit('boss:hp', { hp: 0, max: boss.maxHp }); emit('boss:defeat', { by: me }); }); t += 4; }
    }
    return { boss, stop: () => T.forEach(clearTimeout), duration: t };
  }
}
