// ============================================================================
// 【中文导读】"What's New" 更新公告弹窗：每次更新只在玩家首次进入主菜单时弹一次，两张贴纸卡 + 墨迹擦除转场。
// ----------------------------------------------------------------------------
// 【模块定位】DOM 覆盖层（非 Canvas），但内嵌一块由 JS 驱动的 clip-path 墨迹擦除。寄生在菜单系统里：overlay 就是
//   menus.js 的模态框（focus trap / 手柄键盘鼠标导航 / 光标环全部白嫖）。由 menus.js 挂钩——构造、_swap（主屏
//   挂载后调 maybeShow）、_back（Esc 关闭）。挂在主屏 `M._scr.el` 下。
// 【核心机制】
//   ① 只弹一次：localStorage['inkwave.news'] 记 NEWS_ID；换版本就 bump NEWS_ID。测试 URL（?skipTitle/?netmock/
//      ?autostart/?autopilot）默认跳过；?news=1 恢复、?news=force 强制、?news=0 关闭（见 gate()）。
//   ② 两页卡：PAGES=[多人资料片, HULLBREAKER Boss]。continue→next() 擦入第二页；TRY IT→_tryBoss() 直达 Boss 选图。
//   ③ 墨迹擦除：_ink 用 splatClip（来自 menu-art.js）做一个 grow 的 clip-path，由自建 RAF 补间 _tick 推进；
//      关闭时墨迹向卡片中心收拢（easeInOutCubic 反向）。
//   ④ 彩纸：_confetti 用黄金比 φ=0.618 散布 34 片，禁用动效（prefersReducedMotion）时整体跳过。
// 【关键约定】性能：每帧动画只写 clip-path/transform/opacity（合成层），用 this._tweens 数组 + 单条 RAF 驱动。
//   注意：h() 只翻译 `title`，故 aria-label 需手动 t()（见 show() 注释）。
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md（启动/菜单流程）；兄弟文件 src/ui/menus.js（宿主）、src/ui/menu-art.js
//   （splatClip/splatCover/inkBurst）、src/ui/boss-art.js（bossSilhouette 兜底图）。
// 【建议阅读顺序】gate → maybeShow/_tryOpen → show → _render → _ink/_tween → next/close。
// ============================================================================
// INKWAVE — "What's New" launch pop-ups. Shown ONCE per update, the first time the player reaches the main menu
// (never over the title screen, never mid-match). Two sticker cards behind a splat wipe:
//   1. INTRODUCING THE MULTIPLAYER EXPANSION  → CONTINUE ▶ · Skip
//   2. INTRODUCING HULLBREAKER (Boss Battle · public beta) → TRY IT (Play › Boss Battle) · LATER
// Seen state: localStorage['inkwave.news'] = NEWS_ID (bump NEWS_ID for the next update's cards).
// Test flows never see it: ?skipTitle / ?netmock / ?autostart / ?autopilot skip it. ?news=1 re-enables the normal
// once-only logic on those URLs, ?news=force shows it regardless of the seen state, ?news=0 turns it off.
//
// Lives inside the menus: the overlay is the menus' modal (focus trap, pad/keyboard/mouse nav, cursor ring for free),
// hosted in the main screen's element. Hooks in menus.js: constructor, _swap (main mounted → maybeShow), _back (Esc).
import { h, clamp, splatSVG, restartAnim, prefersReducedMotion, easeOutCubic, easeInOutCubic, safeCall } from './ui-util.js';
import { GLYPHS, SQUID } from './ui-icons.js';
import { splatClip, splatCover, inkBurst } from './menu-art.js';
import { BOSS_NAME, bossSilhouette } from './boss-art.js';
import { G } from '../core/ctx.js';
import { t } from '../i18n/strings.js';

export const NEWS_ID = 'mp-expansion-1';   // 【版本号】换一期公告就 bump 它（与 localStorage 里记的值比对）
const KEY = 'inkwave.news';                 // 【存储键】localStorage 里记住"已看过哪一期"
const art = (f) => new URL(`../../assets/${f}`, import.meta.url).href;   // 【资源 URL】相对本模块解析 assets 下的图片
// 【彩纸配色】主色（随本页 tone 变）、浅主色、金黄、白、以及双方阵营墨色 --a/--b。
const CONFETTI = ['var(--nc)', 'var(--nc-light)', '#ffd23f', '#fff', 'var(--a)', 'var(--b)'];

// 【是否看过】读 localStorage 比对 NEWS_ID；隐私模式下抛错则返回 false（当作没看过）。
export function newsSeen() { try { return localStorage.getItem(KEY) === NEWS_ID; } catch (e) { return false; } }
// 【标记已看】写入 NEWS_ID；隐私模式失败也无妨——下次再弹一遍而已。
function markSeen() { try { localStorage.setItem(KEY, NEWS_ID); } catch (e) { /* private mode: it just shows again next time */ } }
/** false · true (normal once-only) · 'force' (ignore the seen state) */
// 【开关判定】解析 URL 的 ?news 参数：'0'关、'force'强制（无视已看）、'1'恢复常规；其余测试 URL 一律跳过。
function gate() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const p = q.get('news');
  if (p === '0') return false;
  if (p === 'force') return 'force';
  if (p === '1') return true;
  for (const k of ['skipTitle', 'netmock', 'autostart', 'autopilot']) if (q.has(k)) return false;
  return true;
}

// 【公告页数据】两页：mp=多人资料片（图 news/lobby.webp）、boss=HULLBREAKER（图失败时用 bossSilhouette 兜底）。
//   tone 决定该页主色（--a 或 --b 系）；bullets 每项 [图标, 标题, 说明, 可选缩略图]。
const PAGES = [
  {
    id: 'mp', tone: 'a', kicker: 'INTRODUCING', title: ['THE MULTIPLAYER', 'EXPANSION'], img: 'news/lobby.webp',
    stamp: { text: 'NEW!', cls: 'is-new' },
    lede: 'Grab your crew — the harbour just got a whole lot louder!',
    bullets: [
      [GLYPHS.key, 'Private rooms', 'share a code, squad up with up to 8 friends'],
      [GLYPHS.smile, 'The Lobby', 'watch your squad roll in, emote, ready up'],
      [GLYPHS.map, 'Cargo Terminal', 'a brand-new stage, online only', 'stages/cargo-day-sm.webp'],
    ],
  },
  {
    id: 'boss', tone: 'b', kicker: 'INTRODUCING', title: [BOSS_NAME], img: 'news/boss.webp', fallback: () => bossSilhouette(),
    tape: 'BOSS BATTLE · PUBLIC BETA',
    lede: 'A giant hermit crab has moved into a rusty shipping container — and it wants the whole harbour.',
    bullets: [
      [GLYPHS.users, 'Co-op showdown', 'your whole squad vs one colossal crab'],
      [GLYPHS.target, 'Three phases of chaos', 'dodge the tells, crack the shell, blast the glowing weak points'],
      [GLYPHS.sparkle, 'Public beta', 'it’s still sharpening its claws — tell us what you think!'],
    ],
  },
];

// 【WhatsNew 类】公告弹窗。构造后由菜单调用 maybeShow() 择机打开；open getter 反映是否已挂载。
export class WhatsNew {
  // 【构造函数】保存宿主菜单引用，复位页号/定时器/补间数组/RAF/忙碌位。
  constructor(menus) {
    this.M = menus;
    this.el = null;
    this.page = 0;
    this._t = 0;
    this._tweens = [];
    this._raf = 0;
    this._busy = false;
  }

  // 【是否已打开】el 存在即表示弹窗已挂载。
  get open() { return !!this.el; }

  /** menus.js: the main screen just mounted. Opens once the menu's own wipe has settled. */
  // 【择机弹出】由 menus.js 在主屏挂载后调用。gate 通过且未看过时，预取两张 hero 图并延时 700 ms 尝试打开
  //   （等菜单自身擦除动画结束）。
  maybeShow() {
    if (this.el) return;
    const g = gate();
    if (!g || (g !== 'force' && newsSeen())) return;
    if (g === 'force' && this._shownForce) return;
    clearTimeout(this._t);
    // fetch both hero renders now: the card waits (briefly) for its image instead of opening on an empty frame
    if (!this._pre) this._pre = PAGES.map((P) => { const im = new Image(); im.decoding = 'async'; im.src = art(P.img); return im; });
    this._waitFrom = performance.now();
    this._t = setTimeout(() => this._tryOpen(0), 700);
  }
  // 【重试打开】轮询等待：主屏未就绪/有模态/菜单在擦除/正在开始对局时，每 150 ms 重试（最多 60 次）；
  //   首图未加载完则再等（上限 4 s，避免无限等）。
  _tryOpen(n) {
    const M = this.M;
    if (this.el || M.current !== 'main' || !M._scr || G.mode === 'match') return;
    if (M._modal || (M.wipe && M.wipe.busy) || M._starting) {
      if (n < 60) this._t = setTimeout(() => this._tryOpen(n + 1), 150);
      return;
    }
    const hero = this._pre && this._pre[0];
    if (hero && !hero.complete && performance.now() - this._waitFrom < 4000) { this._t = setTimeout(() => this._tryOpen(n), 150); return; }
    this.show();
  }

  // ================================================================ build
  // 【挂载】一次性建根节点（dialog 语义 + aria-modal），挂到主屏 el；登记为菜单的当前模态（M._modal）；
  //   标已看、渲染第 0 页、从中心擦入第一层墨迹。
  show() {
    const M = this.M;
    if (this.el || !M._scr) return;
    if (gate() === 'force') this._shownForce = true;
    markSeen();   // shown once: even a reload mid-sequence won't bring it back
    this.reduced = prefersReducedMotion();
    this.page = 0;
    this.inkHost = h('div', { class: 'iw-news__inks' });
    this.card = h('div', { class: 'iw-news__card' });
    this.confetti = h('div', { class: 'iw-news__confetti' });
    // h() only translates `title`, so the aria label is passed through t() by hand
    const el = this.el = h('div', { class: 'iw-news' + (this.reduced ? ' is-reduced' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': t('What’s new') },
      h('div', { class: 'iw-news__dim' }), this.inkHost, this.confetti, h('div', { class: 'iw-news__stage' }, this.card));
    el._onBack = () => this.close('back');
    el.dataset.keys = '1';
    M._scr.el.appendChild(el);
    M._modalPrev = M._focus;
    M._modal = el;
    M._sfx('splat_big');
    this._render(0, true);
    const r = el.getBoundingClientRect();
    this._ink(PAGES[0].tone, r.width * 0.5, r.height * 0.52, 0.62, false);
  }

  // 【渲染某页】按 PAGES[i] 写 CSS 变量（主色系）、搭 hero（票据式相框+胶带+印章，图失败降级为兜底剪影）、
  //   要点列表、按钮组（不同页按钮不同）、圆点与页码；重播 is-in/is-swap，聚焦主按钮，喷彩纸+inkBurst。
  _render(i, first) {
    const M = this.M, P = PAGES[i];
    this.page = i;
    this.el.dataset.page = P.id;
    this.el.style.setProperty('--nc', `var(--${P.tone})`);
    this.el.style.setProperty('--nc-light', `var(--${P.tone}-light)`);
    this.el.style.setProperty('--nc-dark', `var(--${P.tone}-dark)`);
    this.el.style.setProperty('--nc-ink', `var(--${P.tone}-ink)`);
    this.el.style.setProperty('--nc-rgb', `var(--${P.tone}-rgb)`);
    // hero: the render, framed like a ticket, taped to the card
    const img = h('img', { class: 'iw-news__img', alt: '', draggable: 'false' });
    const frame = h('div', { class: 'iw-news__frame' }, img, h('i', { class: 'iw-news__glare' }));
    img.addEventListener('load', () => frame.classList.add('is-loaded'), { once: true });
    img.addEventListener('error', () => {
      img.remove();
      frame.classList.add('is-loaded', 'is-fallback');
      frame.prepend(h('div', { class: 'iw-news__fb', html: P.fallback ? P.fallback() : `<span class="iw-news__fbsquid">${SQUID}</span>` }));
    }, { once: true });
    img.src = art(P.img);
    const hero = h('div', { class: 'iw-news__hero' },
      h('span', { class: 'iw-news__herosplat', html: splatSVG({ seed: 17 + i * 11, fill: 'var(--nc)', r: 58, arms: 9, drops: 5 }) }),
      frame,
      h('i', { class: 'iw-news__tapebit is-tl' }), h('i', { class: 'iw-news__tapebit is-br' }),
      P.stamp ? h('span', { class: `iw-news__stamp ${P.stamp.cls}` }, P.stamp.text) : null,
      P.tape ? h('span', { class: 'iw-news__tape' }, h('span', null, P.tape)) : null);
    // body
    const list = h('ul', { class: 'iw-news__list' }, P.bullets.map(([ic, b, txt, thumb], k) => {
      const li = h('li', { style: { '--i': k } }, h('i', { class: 'iw-news__bico', html: ic }), h('span', null, h('b', null, t(b)), ` — ${t(txt)}`));
      if (thumb) {
        const im = h('img', { class: 'iw-news__thumb', alt: '', draggable: 'false' });
        im.addEventListener('error', () => im.remove(), { once: true });
        im.src = art(thumb);
        li.appendChild(im);
      }
      return li;
    }));
    const btns = [];
    if (i === 0) {
      const go = M._btn({ id: 'news-continue', label: 'CONTINUE', cls: 'iw-btn--primary iw-btn--wide iw-news__go', sound: 'ui_confirm', accept: () => this.next() });
      go.append(h('span', { class: 'iw-news__chev', html: GLYPHS.next }));
      const skip = M._btn({ id: 'news-skip', label: 'Skip', cls: 'iw-btn--small iw-btn--ghost iw-news__skip', sound: 'ui_back', accept: () => this.close('skip') });
      skip.appendChild(h('span', { class: 'iw-news__skipkey' }, M._hint('Esc', 'B')));
      btns.push(go, skip);
    } else {
      const go = M._btn({ id: 'news-try', label: 'TRY IT', icon: GLYPHS.play, cls: 'iw-btn--primary iw-btn--wide iw-news__go', sound: 'ui_confirm', accept: () => this.close('try') });
      const later = M._btn({ id: 'news-later', label: 'LATER', cls: 'iw-btn--wide iw-btn--ghost iw-news__later', sound: 'ui_back', accept: () => this.close('later') });
      btns.push(go, later);
    }
    btns[0].appendChild(h('span', { class: 'iw-news__key' }, M._hint('Enter', 'A')));
    const dots = h('span', { class: 'iw-news__dots' }, PAGES.map((_, k) => h('i', { class: k === i ? 'is-on' : '' })));
    const body = h('div', { class: 'iw-news__body' },
      h('div', { class: 'iw-news__kicker' }, h('i', { html: GLYPHS.sparkle }), P.kicker),
      h('div', { class: 'iw-news__title iw-display' + (P.title.length === 1 ? ' is-one' : '') }, P.title.map((t, k) => h('span', { style: { '--i': k } }, t))),
      h('p', { class: 'iw-news__lede' }, P.lede),
      list,
      h('div', { class: 'iw-news__btns' }, btns),
      h('div', { class: 'iw-news__foot' }, dots, h('span', { class: 'iw-news__count' }, `${i + 1} / ${PAGES.length}`)));
    this.card.innerHTML = '';
    this.card.append(hero, body);
    restartAnim(this.card, first ? 'is-in' : 'is-swap');
    M._setFocus(btns[0], { snap: true });
    if (!this.reduced) {
      this._confetti();
      setTimeout(() => { if (this.el && this.el.isConnected) inkBurst(this.M._scr.el, { ...this._center(body.querySelector('.iw-news__title')), color: 'var(--nc)', count: 14, dist: 12, size: 1.5, ring: true }); }, first ? 520 : 260);
    }
  }
  // 【节点中心】取某节点在视口里的近似中心（偏左 35%），给墨迹喷发/擦除定位；空节点退化为视口中心。
  _center(node) {
    if (!node) return { x: innerWidth / 2, y: innerHeight / 2 };
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width * 0.35, y: r.top + r.height / 2 };
  }

  // 【彩纸】用黄金比 φ≈0.618 的低差异散布生成 34 片，逐片给颜色/延时/时长/旋转/横向漂移/宽度/形状随机值。
  _confetti() {
    const host = this.confetti;
    host.innerHTML = '';
    for (let i = 0; i < 34; i++) {
      const x = ((i * 0.618034 + 0.07) % 1) * 100;
      host.appendChild(h('i', { style: {
        left: `${x.toFixed(1)}%`, '--c': CONFETTI[i % CONFETTI.length], '--d': `${(0.05 + ((i * 0.37) % 1) * 0.5).toFixed(2)}s`,
        '--t': `${(1.5 + ((i * 0.53) % 1) * 1.1).toFixed(2)}s`, '--r': `${Math.round(((i * 0.71) % 1) * 720 - 360)}deg`,
        '--x': `${(((i * 0.29) % 1) - 0.5) * 12}vw`, '--w': `${(0.5 + ((i * 0.43) % 1) * 0.7).toFixed(2)}`, '--k': i % 3 ? '0' : '1',
      } }));
    }
    restartAnim(host, 'is-on');
  }

  // ================================================================ ink wipes (splat clip-path grown by JS)
  /** A full-screen layer of `tone` ink revealed by a splat growing from (x, y). */
  // 【墨迹层】新建一层 tone 色墨，从 (x,y) 用一个由小到大的 splat clip-path 展开；reduced-motion 时直接淡入。
  //   fromPrev=true 表示这是"翻页"层，完成后裁掉旧层。返回该层供关闭时反向收拢。
  _ink(tone, x, y, dur, fromPrev) {
    const layer = h('div', { class: `iw-news__ink is-${tone}` }, h('i', { class: 'iw-news__halftone' }));
    this.inkHost.appendChild(layer);
    const W = this.el.clientWidth || innerWidth, H = this.el.clientHeight || innerHeight;
    const R = splatCover(x, y, W, H), seed = 7 + this.inkHost.childElementCount * 13;
    if (this.reduced) { layer.style.clipPath = ''; layer.classList.add('is-fade'); this._pruneInks(layer); return layer; }
    layer.style.clipPath = splatClip(x, y, 0.01, seed);
    this._tween(dur, (k) => { layer.style.clipPath = splatClip(x, y, R * easeOutCubic(k), seed); }, () => { layer.style.clipPath = ''; if (fromPrev) this._pruneInks(layer); });
    layer._splat = { x, y, R, seed };
    return layer;
  }
  // 【清理墨层】只保留 keep 一层，其余移除。
  _pruneInks(keep) { for (const n of [...this.inkHost.children]) if (n !== keep) n.remove(); }

  // 【起补间】注册一个 {t,dur,step,done} 补间并按需启动单条 RAF 循环；step(0) 立即调用保证首帧就位。
  _tween(dur, step, done) {
    const o = { t: 0, dur: Math.max(0.01, dur), step, done };
    this._tweens.push(o);
    step(0);
    if (!this._raf) { this._last = performance.now(); this._raf = requestAnimationFrame((t) => this._tick(t)); }
    return o;
  }
  // 【RAF 步进】累加 dt（上限 0.1 s，避免卡帧一次跳完；乘 M.timeScale 让慢动作仍按时完成）；逐个推进补间，
  //   k>=1 则出队并调 done；还有补间就续帧，否则停 RAF。
  _tick(t) {
    const dt = Math.min(0.1, (t - this._last) / 1000) * (this.M.timeScale ?? 1);   // slow frames still finish the wipe on time
    this._last = t;
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      const o = this._tweens[i];
      o.t += dt;
      const k = clamp(o.t / o.dur);
      safeCall(o.step, k);
      if (k >= 1) { this._tweens.splice(i, 1); if (o.done) safeCall(o.done); }
    }
    this._raf = this._tweens.length ? requestAnimationFrame((tt) => this._tick(tt)) : 0;
  }

  // ================================================================ flow
  // 【下一页】从主按钮位置擦入第二页墨迹，卡片先移出、300 ms 后换页并复位忙碌位。
  next() {
    if (!this.el || this._busy || this.page >= PAGES.length - 1) return;
    this._busy = true;
    const btn = this.card.querySelector('.iw-news__go');
    const c = btn ? this._center(btn) : { x: innerWidth * 0.7, y: innerHeight * 0.7 };
    const r = this.el.getBoundingClientRect();
    this.card.classList.add('is-out');
    this.M._sfx('splat_big', 0.05);
    this._ink(PAGES[1].tone, c.x - r.left, c.y - r.top, this.reduced ? 0.01 : 0.55, true);
    setTimeout(() => { if (!this.el) return; this.card.classList.remove('is-out'); this._render(1, false); this._busy = false; }, this.reduced ? 0 : 300);
  }

  /** how: 'skip' | 'later' | 'back' | 'try' */
  // 【关闭】清模态登记、卡片移出；'try' 直接收尾并跳 Boss 选图；否则墨迹朝卡片中心反向收拢（reduced 时快速淡出）；
  //   结束后把焦点还给之前的模态。el._closing 防重入。
  close(how = 'later') {
    const M = this.M, el = this.el;
    if (!el || el._closing) return;
    el._closing = true;
    clearTimeout(this._t);
    if (M._modal === el) M._modal = null;
    el.classList.add('is-leaving');
    this.card.classList.add('is-out');
    if (how === 'back') M._sfx('ui_back');
    const finish = () => { el.remove(); if (this.el === el) this.el = null; };
    if (how === 'try') { finish(); this._tryBoss(); return; }
    // the splat drains back into the card's centre, the menu underneath comes back
    const last = this.inkHost.lastElementChild;
    if (!this.reduced && last && last._splat) {
      const s = last._splat, r = el.getBoundingClientRect(), cr = this.card.getBoundingClientRect();
      const x = cr.left + cr.width / 2 - r.left, y = cr.top + cr.height / 2 - r.top, R = splatCover(x, y, r.width, r.height);
      this._pruneInks(last);
      this._tween(0.5, (k) => { last.style.clipPath = splatClip(x, y, Math.max(0.01, R * (1 - easeInOutCubic(k))), s.seed + 1); }, finish);
    } else setTimeout(finish, this.reduced ? 200 : 450);
    const prev = M._modalPrev;
    if (prev && prev.isConnected) M._setFocus(prev, { snap: true });
  }

  /** TRY IT: Play › Boss Battle stage select, with Back leading to the mode cards (boss focused). */
  // 【跳 Boss】把设置里 mode 设为 boss、记 lastMode，栈设为 [main,mode] 并打开 setup，让 Back 回到模式卡。
  _tryBoss() {
    const M = this.M;
    const st = M._setup || (M._setup = { times: {} });
    st.mode = 'boss';
    M._setSetting('lastMode', 'boss');
    M._stack = ['main', 'mode'];
    M.show('setup', { push: true });
  }

  // 【销毁】清定时器与 RAF、移除根节点。
  dispose() { clearTimeout(this._t); cancelAnimationFrame(this._raf); this._raf = 0; if (this.el) this.el.remove(); this.el = null; }
}
