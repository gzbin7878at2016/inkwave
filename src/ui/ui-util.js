// ============================================================================
// 【中文导读】UI 基础设施层：menus.js 与 hud.js 共用的微型 DOM / 颜色 / 缓动工具库。
// ----------------------------------------------------------------------------
// 【模块定位】src/ui/ 的最底层依赖，不 import any three.js / 渲染代码；menus 与 HUD 都从这里取基础件。
//   以纯函数为主（h、clamp、lerp、toHex…），只有 h() 与 Spring 会分配对象。
// 【核心机制】
//   ① h(tag, props, ...kids)：创建 DOM 元素的小工厂。props 特殊键：class→className；
//      style（字符串→cssText，对象→`--x` 走 setProperty、其余走 el.style[k]）；data→dataset；
//      html→innerHTML；text/title→先过 i18n 的 t() 再写入；onXxx→addEventListener；true→空属性；
//      kids 递归展开（数组展平、字符串/数字→文本节点、其余视为元素）。
//   ② 所有流经 h() 的字符串（text 属性或子节点）都先过 t()，未知文案原样透传——因此整站本地化
//      无需改动调用点。
//   ③ 颜色工具把 '#rrggbb' / '#rgb' / 0xRRGGBB / THREE.Color 形态归一为 hex；colorVars() 一次写出
//      整组 --x / --x-rgb / --x-dark / --x-deep / --x-light / --x-ink CSS 变量供样式表消费。
//   ④ Spring：临界欠阻尼弹簧，用于菜单焦点光标等回弹动画；step() 内部定步长子步进以保证数值稳定。
// 【关键约定】单位：角度弧度、时间秒（Spring.step 收 dt 秒）。颜色统一为 hex 字符串。
//   性能：h() 每次都 createElement，运行期热路径应复用元素（见 hud.js 的元素池），不要每帧新建。
//   合成约定：本文件不直接触碰布局，只有 restartAnim 会读一次 offsetWidth 强制 reflow 以重启动画。
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md；兄弟文件 src/ui/hud.js（契约消费者）、src/ui/menus.js。
// ============================================================================
// INKWAVE UI — tiny DOM / colour / motion helpers shared by menus.js and hud.js.
// Pure DOM; no three.js dependency.
// Every string that flows through h() (kids or the `text` prop) goes through t() first, so the whole UI
// localises without touching call sites: t() maps English source strings (the dictionary msgids) to the
// current language and passes anything unknown (player names, numbers, dynamic text) straight through.
import { t } from '../i18n/strings.js';

// ---------------------------------------------------------------- DOM
// 【DOM 工厂】整个 UI 层唯一创建元素的入口，见导读【核心机制】①；props/kids 的转义与 i18n 规则都在此实现。
export function h(tag, props = null, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const s in v) { if (s.startsWith('--')) el.style.setProperty(s, v[s]); else el.style[s] = v[s]; }
      } else if (k === 'data') { for (const d in v) el.dataset[d] = v[d]; }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = t(v);
      else if (k === 'title' && typeof v === 'string') el.title = t(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendKids(el, kids);
  return el;
}
// 【子节点递归展开】数组展平；字符串/数字经 t() 后建文本节点，其余按元素 append。
function appendKids(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else if (typeof c === 'string') el.appendChild(document.createTextNode(t(c)));
    else if (typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
}
/** Parse an HTML/SVG string into its first element. */
// 【字符串转元素】用 <template> 解析一段 HTML/SVG 标记，取第一个元素节点返回（保留 SVG 命名空间）。
export function frag(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}
// 【HTML 转义】把 &<>"' 换成实体，用于把动态字符串安全地拼进 innerHTML 模板。
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- localisable one-liners (prompts, feed, toasts)
// A line the game hands to the HUD is either a plain string (an i18n message id, translated like any h() text) or a
// descriptor `{ id, params }` for sentences with interpolated names/numbers — `t(id, params)` fills the placeholders,
// so the surrounding words stay one translatable unit instead of being concatenated at the call site.
/** Display text for a message id or descriptor (already in the current language). */
// 【本地化文本】v 为字符串时当作 i18n message id 直接 t()；v 为 { id, params } 描述符时用 t(id, params) 填占位符。
export function msgText(v) { return v == null ? '' : typeof v === 'string' ? t(v) : t(v.id, v.params || null); }
/** Identity for "did this line change?" checks — descriptors are fresh objects each frame, so compare by value. */
// 【脏检查键】描述符对象每帧都是新的，不能比引用；这里序列化成 "id|params" 字符串供相等比较。
export function msgKey(v) { return v == null ? null : typeof v === 'string' ? v : `${v.id}|${JSON.stringify(v.params || null)}`; }

/** Restart a CSS animation on an element by toggling a class across a reflow. */
// 【重启动画】去掉类 → 读 offsetWidth 强制 reflow → 加回类；CSS 动画从头播放的标准 trick。
export function restartAnim(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // eslint-disable-line no-void
  el.classList.add(cls);
}

// ---------------------------------------------------------------- maths
// 【数学工具】clamp / lerp / 三种缓动 / 确定性随机数，全站动画与颜色插值共用。
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t, s = 1.7) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

// 【确定性 PRNG】mulberry32 变体：同一 seed 必出同一串数——程序化美术（墨花、招牌图案）靠它做到
//   "每次载入都不一样但同一 seed 可复现"。
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Critically-under-damped spring (gives the bouncy overshoot used by the focus cursor etc.). */
// 【弹簧】临界欠阻尼二阶系统：菜单焦点光标/页签回弹。step(dt) 用固定 1/120 s 子步积分，
//   每帧最多 8 个子步，避免大 dt 时数值爆炸；settled 判断是否已静止（用于停掉每帧更新）。
export class Spring {
  constructor(value = 0, stiffness = 260, damping = 20) {
    this.x = value; this.v = 0; this.target = value; this.k = stiffness; this.c = damping;
  }
  step(dt) {
    const n = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))));
    const hh = Math.min(dt, 0.1) / n;
    for (let i = 0; i < n; i++) {
      const a = this.k * (this.target - this.x) - this.c * this.v;
      this.v += a * hh; this.x += this.v * hh;
    }
    return this.x;
  }
  snap(v = this.target) { this.x = this.target = v; this.v = 0; }
  get settled() { return Math.abs(this.target - this.x) < 0.02 && Math.abs(this.v) < 0.02; }
}

// ---------------------------------------------------------------- colour
/** Accepts '#rrggbb', '#rgb', 0xRRGGBB, THREE.Color-like ({r,g,b} 0..1 or getHexString()). */
// 【颜色归一】任何颜色形态 → '#rrggbb'；无法识别时回退 fallback。UI 层与 three 颜色互操作的关键桥。
export function toHex(c, fallback = '#ff8a14') {
  if (c == null) return fallback;
  if (typeof c === 'string') {
    if (c[0] === '#') return c.length === 4 ? '#' + c.slice(1).split('').map((x) => x + x).join('') : c.slice(0, 7);
    return c;
  }
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  if (typeof c.getHexString === 'function') return '#' + c.getHexString();
  if (typeof c.r === 'number') return rgbToHex(c.r * 255, c.g * 255, c.b * 255);
  return fallback;
}
// 【hex → [r,g,b]】0..255 整数三元组；先经 toHex 归一，兼容 '#abc' 缩写。
export function hexToRgb(hex) {
  let s = toHex(hex).replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// 【[r,g,b] → hex】各通道 clamp 到 0..255 后两位十六进制拼接。
export function rgbToHex(r, g, b) {
  const f = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}
// 【颜色插值】在 RGB 空间对两色做线性插值（t=0 取 a，t=1 取 b）。
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
/** t < 0 darkens toward ink-black, t > 0 lightens toward white. */
// 【明暗】t<0 向墨黑 #120e1c 靠、t>0 向白靠；colorVars 的 --x-dark/--x-light 即由此生成。
export const shade = (hex, t) => (t < 0 ? mix(hex, '#120e1c', -t) : mix(hex, '#ffffff', t));
// 【相对亮度】WCAG 公式（先做 sRGB→线性化），供 inkOn 判断该配黑字还是白字。
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Text colour to put on top of a fill (black on light inks, white on dark ones). */
// 【前景墨色】0.36 为阈值（经验值）：亮墨配深字 #15121c、暗墨配白字——保证文字在任意队色上可读。
export const inkOn = (hex) => (luminance(hex) > 0.36 ? '#15121c' : '#ffffff');
// 【hex+alpha → rgba 字符串】用于需要半透明的地方（canvas 填充等）。
export function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/** Writes --name, --name-rgb, --name-dark, --name-deep, --name-light, --name-ink onto an element. */
// 【颜色变量组】一次性写 6 个 CSS 自定义属性到元素：--name（本体）、--name-rgb（整数三元组，供 rgba() 拼接）、
//   --name-dark/--name-deep（压暗 0.32/0.62）、--name-light（提亮 0.45）、--name-ink（该底色上的可读文字色）。
//   整个 UI 的队色/品牌色都通过这套变量流转，改一处即可全局换色。
export function colorVars(el, name, color) {
  const hex = toHex(color);
  const s = el.style;
  s.setProperty(`--${name}`, hex);
  s.setProperty(`--${name}-rgb`, hexToRgb(hex).join(','));
  s.setProperty(`--${name}-dark`, shade(hex, -0.32));
  s.setProperty(`--${name}-deep`, shade(hex, -0.62));
  s.setProperty(`--${name}-light`, shade(hex, 0.45));
  s.setProperty(`--${name}-ink`, inkOn(hex));
  return hex;
}

// ---------------------------------------------------------------- shapes
// 【形状生成】把点列转成平滑 SVG 路径，并派生"墨花/斑块"这类有机图形——所有程序化美术的地基。
const f1 = (v) => Math.round(v * 10) / 10;   // 【保留 1 位小数】路径字符串瘦身，避免超长浮点
/** Smooth closed curve through points (Catmull-Rom → cubic Bézier) as an SVG path string. */
// 【闭合平滑曲线】Catmull-Rom 样条转三次贝塞尔：控制点取相邻点差 /6（张量 tension 可调）——闭合且过所有点。
export function closedCurve(pts, tension = 1) {
  const n = pts.length;
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension, c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension, c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    d += `C${f1(c1x)} ${f1(c1y)} ${f1(c2x)} ${f1(c2y)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + 'Z';
}
/** Organic wobbly blob. */
// 【有机斑块】绕圆均匀布点、每点半径与角度加种子化抖动（wobble 控抖动幅度、sx/sy 压扁），
//   再走 closedCurve。用于涂地色块、招牌底纹等"手绘感"形状。
export function blobPath(cx, cy, r, { points = 9, wobble = 0.16, seed = 1, sx = 1, sy = 1 } = {}) {
  const R = rng(seed);
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2 + (R() - 0.5) * (Math.PI / points) * 0.8;
    const rr = r * (1 + (R() * 2 - 1) * wobble);
    pts.push([cx + Math.cos(a) * rr * sx, cy + Math.sin(a) * rr * sy]);
  }
  return closedCurve(pts);
}
/** Ink splat: lumpy core with rounded, bulb-tipped arms + satellite droplets. Returns { core, drops:[{x,y,r}] }. */
// 【墨花形状】全站所有"啪"墨迹的来源（HUD 击杀卡、菜单勋章、logo、wipe 画布都复用）。
//   算法：每根臂先落一个"谷"点 r*(0.8+R*0.1)，约 62% 的臂是"大臂"——额外插入颈/球/尖端三点做出
//   圆头凸起（bulb），其余为短尖；再甩出若干卫星墨滴 {x,y,r}。返回 { core: 路径, drops }。
//   魔数说明：0.62 大臂概率、armLen 大臂伸长约 55%–130% r、卫星距 Math.max(L, r*1.1)+…。
export function splatShape(cx, cy, r, { arms = 9, seed = 7, armLen = 0.42, drops = 6 } = {}) {
  const R = rng(seed);
  const TAU = Math.PI * 2, step = TAU / arms;
  const P = (a, d) => [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
  const pts = [];
  const armDirs = [];
  const rot = R() * TAU;
  for (let i = 0; i < arms; i++) {
    const a0 = rot + i * step + (R() - 0.5) * step * 0.25;
    pts.push(P(a0, r * (0.8 + R() * 0.1)));                       // valley
    const big = R() < 0.62;
    const L = big ? r * (1 + armLen * (0.55 + R() * 0.75)) : r * (0.98 + R() * 0.1);
    const am = a0 + step * (0.45 + (R() - 0.5) * 0.2);
    armDirs.push([am, L]);
    if (big) {
      const neck = step * (0.12 + R() * 0.05), bulb = step * (0.2 + R() * 0.08);
      pts.push(P(am - neck, r * 0.98 + (L - r) * 0.35));           // neck
      pts.push(P(am - bulb * 0.9, L * 0.96));                       // bulb side
      pts.push(P(am, L * 1.02));                                    // tip
      pts.push(P(am + bulb * 0.9, L * 0.96));
      pts.push(P(am + neck, r * 0.98 + (L - r) * 0.35));
    } else {
      pts.push(P(am, L));
    }
  }
  const ds = [];
  for (let i = 0; i < drops; i++) {
    const [am, L] = armDirs[Math.floor(R() * armDirs.length)];
    const a = am + (R() - 0.5) * step * 0.5;
    const d = Math.max(L, r * 1.1) + r * (0.22 + R() * 0.45);
    ds.push({ x: f1(cx + Math.cos(a) * d), y: f1(cy + Math.sin(a) * d), r: f1(r * (0.06 + R() * 0.1)) });
  }
  return { core: closedCurve(pts, 1), drops: ds };
}
/** SVG markup for a splat filled with `cls` (css class) or explicit fill. */
// 【墨花 SVG】把 splatShape 包成一个独立 <svg>：viewBox 默认 200×200、半径 r=58（居中留边），
//   fill 优先；否则用 CSS 类染色（.iw-fa/.iw-fb 分别跟队色）。各调用点传 seed 以取不同随机外形。
export function splatSVG({ seed = 7, cls = 'iw-fa', fill = null, viewBox = 200, r = 58, arms = 9, drops = 7, extra = '' } = {}) {
  const c = viewBox / 2;
  const s = splatShape(c, c, r, { seed, arms, drops });
  const fa = fill ? `fill="${fill}"` : `class="${cls}"`;
  return `<svg viewBox="0 0 ${viewBox} ${viewBox}" aria-hidden="true" ${extra}><path ${fa} d="${s.core}"/>${s.drops
    .map((d) => `<circle ${fa} cx="${d.x}" cy="${d.y}" r="${d.r}"/>`).join('')}</svg>`;
}

// ---------------------------------------------------------------- text
// 【文本格式化】计时 mm:ss、千分位整数、百分比归一。
export function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s - 1e-6));
  const m = Math.floor(t / 60), ss = t % 60;
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}
// 【千分位】按 en-US 规则加逗号（UI 内所有大数展示统一走这里）。
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
/** Normalises a percentage that may be supplied as 0..1 or 0..100. */
// 【百分比归一】两数都 ≤1.0001 时视为 0..1 比例，乘 100；否则原样（0..100）。解决调用方单位不统一。
export function pct(a, b) {
  const both = [a, b].map((v) => +v || 0);
  if (both[0] <= 1.0001 && both[1] <= 1.0001) return both.map((v) => v * 100);
  return both;
}

// ---------------------------------------------------------------- misc
// 【杂项】单调时钟（秒）、异常兜底调用、系统"减少动态效果"偏好探测。
export const now = () => performance.now() / 1000;   // 【高精度秒】performance.now() 毫秒 /1000
// 【安全调用】UI 回调里任何异常都吞掉并打日志，绝不让一处 UI bug 拖垮每帧循环。
export function safeCall(fn, ...args) { try { return fn?.(...args); } catch (e) { console.error('[ui]', e); return undefined; } }
// 【无障碍偏好】用户开启系统"减少动态效果"时返回 true；wipe/confetti 等重动画据此降级。
export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
