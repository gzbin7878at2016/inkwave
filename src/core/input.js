// ============================================================================
// 【中文导读】统一输入层 —— 键盘 / 鼠标(指针锁定)/ 标准手柄 → 每帧一份输入快照
// ----------------------------------------------------------------------------
// 【模块定位】属于核心层(core)。由 main.js 的 boot() 创建唯一实例并挂到 G.input,
//   同时把 onKey/onUnlock 两个回调接到 Game 上(菜单按键路由、失焦暂停)。生命周期与游戏同长。
//   玩法层(Match 把它传给 player.js 的控制器)每帧调用 down/wasPressed/pad* 读取,
//   转成"意图(intent)"对象(it.move/jump/squid/fire/sub/special/cheer):输入层只做事实采集,
//   不做玩法决策 —— 这层边界是刻意的。
//
// 【核心机制 —— 三种设备统一成一套 API】
//   · 键盘:按键以**物理键码 e.code** 记录(如 'KeyW'、'Space'、'ShiftLeft'),不是字符 ——
//     与键盘布局无关。keys = 当前按住集合,pressed = 本帧刚按下集合。
//   · 鼠标:朝向增量累加在 mouse.dx/dy(仅**指针锁定时**累积);左右键含 down 与"本帧刚按下"两种状态。
//   · 手柄:每帧先 pollPad() 采样一次,得到 pad/按钮刚按下集合 padPressed;
//     摇杆经 padStick() 做**径向死区 + 外圈死区 + 可选响应曲线**;震动经 rumble() 发双马达脉冲。
//   · lastDevice 记录"最近活跃设备"(kbm/pad):辅助瞄准、震动等只在手柄为当前设备时生效。
//
// 【指针锁定 pointer lock】—— 鼠标转向的关键
//   · requestLock() 请求把鼠标锁进 canvas(浏览器隐藏光标、只给 movementX/Y 增量);
//     必须由用户手势触发,且优先请求 unadjustedMovement(拿"未加速"的原始增量),失败回退普通请求。
//   · pointerlockchange 更新 this.locked;解锁瞬间清空左右键并回调 onUnlock —— Game 借此
//     在"对局中且非主动解锁"时自动暂停(_onPointerUnlock)。
//   · 【易踩的坑】按住 TAB 打开地图时,键的**自动重复(e.repeat)**若不吞掉,浏览器会把焦点
//     移出画布 → 指针锁定丢失 → 对局被误判为暂停("一开地图就弹菜单")。见 keydown 里的处理。
//
// 【关键约定】
//   · 键盘事件用 e.code;手柄按钮/轴用**索引**(标准映射:0/1 左摇杆、2/3 右摇杆、6/7 扳机、8+ 面键)。
//   · endFrame() **必须每帧末尾调用一次**,负责清空 pressed 与鼠标增量 —— 忘了它,"本帧刚按下"会变成"一直按下"。
//   · 苹果 ⌘ 组合键(⌘Q/⌘H/⌘W)一律忽略:交由系统处理(macOS 还不会给按住 ⌘ 时松开的键发 keyup,追踪会卡住)。
//   · 菜单/文本输入的按键由 onKey 回调优先接管(返回 true 表示已消费,游戏不再记录)。
//
// 【配套阅读】docs/BOOT.zh-CN.md(输入在启动链中的位置)、docs/CONTRACTS.zh-CN.md(玩法契约);
//             消费者:src/game/player.js(把输入转成 intent)、src/main.js(_onKey/_onPointerUnlock)。
// ============================================================================
// Keyboard + mouse (pointer lock) + standard gamepad. Produces a unified per-frame snapshot.
// Gamepad: radial dead zone + response curve sticks (padStick) and subtle dual-rumble (rumble), scaled by
// settings.rumble (0..1, default 1) and only while the pad is the active device.
import { G } from './ctx.js';

// keys whose browser default (focus moves, page scroll) must never fire while the game has the mouse
// 【会被浏览器默认行为"吃掉"的键】锁定鼠标后,Tab 会移动焦点、方向键/空格会滚动页面 —— 全部 preventDefault。
const GAME_KEYS = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote']);

export class Input {
  // 【构造函数】建立三套设备的状态容器 + 绑定全局事件监听。canvas 用于指针锁定目标。
  constructor(canvas) {
    this.canvas = canvas;
    // keys = 当前按住的物理键码;mouse = 朝向增量与左右键状态;locked = 指针是否已锁进 canvas。
    this.keys = new Set();
    this.pressed = new Set();       // keys pressed this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false };
    this.locked = false;
    this.enabled = true;
    // 手柄状态:pad = 本帧选中手柄;padPrev = 上一帧按钮态(算"刚按下"边沿);padPressed = 本帧新按下集合。
    this.pad = null;
    this.padPrev = [];
    this.padPressed = new Set();
    // lastDevice:'kbm' | 'pad' —— 最近活跃设备,决定震动/辅助瞄准是否生效。
    this.lastDevice = 'kbm';
    // 两个由 Game 注入的回调:onKey = 菜单/文本输入优先接管按键(返回 true 表示已消费);
    // onUnlock = 指针意外解锁时触发(Game 借此在非主动解锁时暂停对局)。
    this.onKey = null;              // (e) => bool consumed  (menus)
    this.onUnlock = null;
    // 【键盘按下】三段处理:① 吞掉 macOS ⌘ 组合 ② 吞掉自动重复(e.repeat)防焦点被抢
    // ③ 菜单回调 onKey 优先消费 → 否则记录按键并阻止浏览器默认行为。
    window.addEventListener('keydown', (e) => {
      // ⌘-combos (⌘Q quit, ⌘H hide, ⌘M minimise, ⌘W close …) belong to macOS: never read them as game / menu keys
      // (the menus mapped ⌘Q to "previous tab" and swallowed it). macOS also sends no keyup for a key released while
      // ⌘ is held, so tracking them would leave the key stuck down.
      if (e.metaKey) return;
      // the menus call preventDefault themselves when needed (text fields must still receive keystrokes)
      // auto-repeat must be swallowed too: holding TAB for the map used to let the repeats move browser focus off the
      // canvas → pointer lock dropped → the round paused ("opening the map opens the menu")
      if (e.repeat) {
        if (e.code === 'Tab' || (this.locked && GAME_KEYS.has(e.code))) e.preventDefault();
        if (this.onKey) this.onKey(e, true);
        return;
      }
      this.lastDevice = 'kbm';
      if (this.onKey && this.onKey(e, false)) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (GAME_KEYS.has(e.code) && this.locked) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
    });
    // 【键盘抬起】只从"按住集合"移除;不再进 pressed。
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    // 【窗口失焦】清空所有按住键与鼠标键 —— 失焦时收不到 keyup/mouseup,不清会留下"卡住"的键。
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    // 【鼠标移动】仅锁定态累积朝向增量(movementX/Y 是指针锁定下的原始位移)。
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      this.lastDevice = 'kbm';
    });
    // 【鼠标按下】仅锁定态记录;0=左键、2=右键(leftPressed/rightPressed 是本帧边沿标志)。
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    // 【屏蔽右键菜单】游戏中右键是"副武器",不能弹出浏览器菜单。
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    // 【指针锁定变化】同步 locked;一旦解锁,清空鼠标键并触发 onUnlock(Game 借此暂停)。
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; this.onUnlock?.(); }
    });
  }

  // 【请求指针锁定】须在用户手势内调用;优先 unadjustedMovement(原始增量,不受系统加速),
  // 平台拒绝时回退到普通请求。非手势调用会抛异常,已 try/catch 静默。
  requestLock() {
    if (this.touch && this.lastDevice !== 'kbm') return; // 触屏不依赖 Android 不支持的指针锁定。
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      // some platforms reject unadjustedMovement: fall back to a plain request
      if (p && p.catch) p.catch(() => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ } });
    } catch { /* not allowed without a gesture */ }
  }
  // 【退出指针锁定】打开菜单/暂停时主动释放鼠标;幂等(未锁定时什么都不做)。
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // 【查询】down = 当前是否按住(持续态);wasPressed = 本帧是否刚按下(边沿态,一帧有效)。
  down(code) { return this.keys.has(code) || !!this.touch?.down(code); }
  wasPressed(code) { return this.pressed.has(code) || !!this.touch?.wasPressed(code); }

  // 【手柄采样】每帧调用一次:优先选 standard mapping 的手柄,其次任意已连接手柄;
  // 比较前后帧按钮态得出 padPressed("刚按下"),并在有输入时把 lastDevice 切到 'pad'。
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    if (!pad) for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;
    this.padPressed.clear();
    if (!pad) return;
    pad.buttons.forEach((b, i) => {
      const was = this.padPrev[i] || false;
      if (b.pressed && !was) { this.padPressed.add(i); this.lastDevice = 'pad'; }
      this.padPrev[i] = b.pressed;
    });
    const ax = pad.axes;
    if (Math.abs(ax[0]) > 0.3 || Math.abs(ax[1]) > 0.3 || Math.abs(ax[2]) > 0.3 || Math.abs(ax[3]) > 0.3) this.lastDevice = 'pad';
  }
  // 【手柄读取】padButton 按钮是否按住;padValue 按钮模拟值(扳机 0..1);
  // padAxis 单轴带死区与重标定(把 [dz,1] 映射到 [0,1],避免刚过死区就跳一下)。
  padButton(i) { return !!(this.pad && this.pad.buttons[i] && this.pad.buttons[i].pressed); }
  padValue(i) { return this.pad && this.pad.buttons[i] ? this.pad.buttons[i].value : 0; }
  padAxis(i) {
    if (!this.pad) return 0;
    const v = this.pad.axes[i] || 0;
    const dz = 0.14;
    return Math.abs(v) < dz ? 0 : Math.sign(v) * (Math.abs(v) - dz) / (1 - dz);
  }

  // Stick with a RADIAL dead zone (no axis snapping on diagonals), an outer dead zone (full deflection is reachable
  // on worn sticks) and an optional response exponent applied to the magnitude only (direction is preserved).
  // 【摇杆标准化】径向死区(只滤掉小位移,不在对角线上产生轴向吸附)、外圈死区(磨损摇杆也能推满),
  // 以及只作用于**幅值**的响应曲线 expo(1=线性;方向保持不变,避免拐角失真)。
  // out 复用调用方传入的对象(避免每帧分配);结果 {x,y,mag},无手柄或未过死区时为全 0。
  padStick(ix, iy, out, dz = 0.12, outer = 0.96, expo = 1) {
    out.x = 0; out.y = 0; out.mag = 0;
    if (!this.pad) return out;
    const x = this.pad.axes[ix] || 0, y = this.pad.axes[iy] || 0;
    const m = Math.hypot(x, y);
    if (m <= dz) return out;
    const k = Math.min(1, (m - dz) / (outer - dz));
    const c = expo === 1 ? k : Math.pow(k, expo);
    out.x = (x / m) * c; out.y = (y / m) * c; out.mag = c;
    return out;
  }

  // Dual-rumble pulse. strong = low-frequency motor, weak = high-frequency motor (0..1), ms = duration.
  // A pulse only pre-empts a running one if it is at least as strong, so rapid fire never becomes a constant buzz.
  // 【手柄震动】双马达脉冲:strong=低频马达、weak=高频马达、ms=时长。仅当"当前设备是手柄"时生效,
  // 强度再乘 settings.rumble(0..1)。新脉冲只有**不弱于**正在跑的脉冲才会打断它(防止连射变成持续嗡鸣)。
  rumble(strong, weak, ms = 60) {
    const pad = this.pad;
    if (!pad || this.lastDevice !== 'pad') return;
    const k = G.settings?.rumble ?? 1;
    if (!(k > 0)) return;
    const act = pad.vibrationActuator;
    if (!act || !act.playEffect) return;
    const now = performance.now();
    const mag = Math.max(strong, weak) * k;
    if (now < (this._rumbleUntil || 0) && mag < (this._rumbleMag || 0) * 0.95) return;
    this._rumbleUntil = now + ms; this._rumbleMag = mag;
    try {
      const p = act.playEffect('dual-rumble', { startDelay: 0, duration: Math.round(ms), strongMagnitude: Math.min(1, strong * k), weakMagnitude: Math.min(1, weak * k) });
      if (p && p.catch) p.catch(() => {});
    } catch { /* unsupported */ }
  }

  // Call once at the very end of each frame.
  // 【收尾】每帧末尾必须调用一次:清空"本帧刚按下"集合与鼠标增量,让边沿态只存活一帧。
  endFrame() {
    this.touch?.endFrame();
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.mouse.leftPressed = false; this.mouse.rightPressed = false;
  }
}
