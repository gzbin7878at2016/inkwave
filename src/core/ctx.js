// ============================================================================
// 【中文导读】全局游戏上下文单例 G —— 一张"谁都能取用的系统注册表" + 极简事件总线
// ----------------------------------------------------------------------------
// 【模块定位】core/ctx.js 是工程最底层、被 import 最多的模块(几乎每个文件都依赖它)。
//   它不含任何游戏逻辑,只提供两样东西:
//     ① G   —— 全局对象。启动期由 main.js 的 Game.boot() 把各系统逐个挂上去
//               (renderer/scene/camera/input/level/paint/physics/fx/env/audio…),
//               运行期任何模块直接读 G.xxx 取用,免去层层传参 —— 即"服务定位器"模式。
//     ② on/emit —— 极简发布/订阅总线,让特效/HUD/音频等旁路模块订阅玩法事件,
//               而不必反向 import 玩法代码(事件清单见 docs/EVENTS.zh-CN.md)。
//   末尾还有若干纯数学工具与确定性哈希/RNG,供各层复用。
//
// 【核心机制 —— G 的读写契约与初始化顺序】
//   · 写入者几乎只有 main.js(装配车间),按 boot() 的装配顺序赋值:
//       settings(进度 0.05) → renderer/scene/camera/input → level/paint/physics(建世界时)
//       → fx/env/audio/music → projectiles/subs/specials → nav → match(开局时)。
//   · 读取者是全体模块,时机不确定,所以字段**初始一律 null/空**。消费方必须容错:
//     惯用 `G.fx?.burst(...)`、`if (!G.paint) return`。这不是占位忘填,是刻意留的"未就绪"态。
//   · 【重点】同一字段会被**反复重写**:换地图时 level/paint/physics 整体重建(_buildWorldNow);
//     每局 Match.setup() 把 actors/local 指向新数组(game/match.js)。因此**不要长期缓存
//     G.xxx 的引用**,每次现取最安全。
//
// 【on/emit 契约】
//   · on(name, fn) 返回**退订函数**。内部 Map<name, Set<fn>>,同一 fn 重复 add 只保留一个。
//   · emit(name, payload) 对订阅者**同步、按插入顺序**逐个调用;无订阅者时静默返回。
//     "同步"意味着订阅者抛异常会中断后续订阅者乃至调用方 —— 订阅回调应自行 try/catch
//     (参考 i18n/strings.js 的 setLang 写法)。
//   · payload 约定为**单个对象**(如 { attacker, victim, damage }),便于日后加字段不破坏订阅者。
//   · 没有批量 off(name);退订只能靠 on() 返回的闭包。模块卸载/重建时必须保存并调用它,
//     否则旧订阅者会继续存活并收到新世界的事件(内存泄漏 + 幽灵回调)。
//
// 【关键约定】
//   · teamColors 是 THREE.Color 且为**线性空间**(linear),three.js 的工作色彩空间;
//     teamHex 是对应的 sRGB 十六进制字符串,只给 DOM/CSS/HUD 用。二者由 main.js 的 _setPalette() 成对更新。
//   · time 是**游戏内累计秒数**(仅对局/attract 期由 _frame 累加),不是墙钟;常作事件去抖基准。
//   · mode 是顶层状态机 'boot' | 'menu' | 'match',由 main.js 单点写入,各模块据此判断"是否在比赛中"。
//   · 数学工具均为无副作用纯函数;rng(seed) 返回**有状态闭包**,同 seed 序列可复现,
//     用于需要确定性的程序化生成(纹理/装饰)。
//
// 【配套阅读】docs/ARCHITECTURE.zh-CN.md(全局分层)、docs/EVENTS.zh-CN.md(事件清单)、
//             docs/BOOT.zh-CN.md(装配顺序);兄弟文件 src/main.js(G 的唯一写入者)。
// ============================================================================
// Global game context + tiny event bus. Modules read shared systems off G lazily (G.paint, G.physics, ...).
// 【G 容器本体】下列字段标注了「写」=赋值者、「读」=典型消费者,可 grep 验证。
// 全部以 null/空起手,等 main.js 的 boot()/Match.setup() 按序装配;消费前请判空(见顶部导读)。
export const G = {
  // 渲染三件套。写:main.js boot()「渲染三件套」;读:几乎全部渲染/物理/世界模块。
  renderer: null, scene: null, camera: null,
  // settings 写:main.js boot()(loadJSON);读:input/audio/menus 等。⚠️ quality 目前从未被任何代码写入,恒为 null。
  settings: null, quality: null,
  // 关卡/墨水/物理/特效/环境。写:main.js 建世界与建环境阶段(_buildWorldNow、G.env=);换图时 level/paint/physics 整体重建。
  level: null, paint: null, physics: null, fx: null, env: null,
  // 音频/音乐/界面/输入。写:boot()(audio/music 来自动态 import,input 在 main.js:139);读:HUD/菜单/事件订阅者。
  audio: null, music: null, hud: null, menus: null, input: null,
  // 对局与角色。写:main.js(每局 new Match)与 game/match.js(setup 里重指 actors/local);读:大量玩法/UI 代码。
  match: null, actors: [], local: null, projectiles: null,
  // 队伍配色:teamColors 为线性空间 THREE.Color(给渲染/材质/uniform 用),teamHex 为 sRGB 字符串(给 DOM/CSS/HUD 用)。
  // 写:main.js _setPalette();队伍索引 0/1 = Alpha/Bravo,由 a.team / a.enemyTeam 取值。
  teamColors: [null, null],      // THREE.Color (linear) per team
  teamHex: ['#ff8a14', '#2f5bff'],
  // time 游戏内累计秒(仅对局/attract 期由 main.js _frame += dt),非墙钟;mode 顶层状态机,由 main.js 单点写入。
  time: 0,
  mode: 'boot',                  // 'boot' | 'menu' | 'match'
};

// 【事件总线存储】Map<事件名, Set<回调>>。用 Set 而非数组:同一 fn 重复订阅只保留一份,
// 语义上"订阅即幂等";同时注意 emit 是**同步**派发(见 on/emit 契约)。
const listeners = new Map();
// 【订阅】注册一个事件回调,返回**退订闭包**。务必保存返回值并在模块卸载/重建时调用,
// 否则旧回调会滞留(可选链 ?. 是因为可能已被退订移除,此时 listeners 里已无该 name)。
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}
// 【派发】同步调用该事件的所有订阅者,payload 为单个对象;无订阅者时静默返回。
// 顺序 = Set 的插入顺序。订阅者抛异常会中断后续订阅者,故回调内应自行 try/catch。
export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of set) fn(payload);
}

// ---- small math helpers shared by core modules ----
// 【数学小工具集】core 模块共用;全部纯函数、无副作用。
// clamp 取值域;lerp 线性插值(t 为 0..1);damp 帧率无关的指数趋近(lambda 越大越快,
//   用 1-exp(-λ·dt) 使手感不随帧率变化);smoothstep 平滑过渡(端点导数为 0,无突兀启停)。
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// angleDiff 求 b-a 的**最短角差**,归一化到 (-π, π];dampAngle 是角的阻尼趋近(解决绕圈时走远路)。
export function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export function dampAngle(a, b, lambda, dt) { return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt)); }

// Deterministic hash → [0,1)
// 【确定性哈希】把整数映射到 [0,1) 的伪随机值:无状态、同输入同输出,供程序化生成取"随机"细节。
export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }

// Seeded RNG (mulberry32)
// 【有状态随机数发生器 mulberry32】rng(seed) 返回一个每次调用产出 [0,1) 的闭包;
// 相同 seed 得到相同序列(可复现),用于地图/装饰/纹理等需要"随机但可重演"的生成。
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
