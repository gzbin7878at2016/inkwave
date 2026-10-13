// ========================================================================================
// INKWAVE 桌面壳(Electron)—— 双击 play.bat 后第一个运行的文件
//
// 【它解决什么问题】Electron = "自带 Chrome 的桌面程序壳"。游戏本体是网页(index.html),
// 但浏览器不允许 file:// 加载 ES Modules(import 会被 CORS 拦截),所以:
//   ① 注册一个自定义 app:// 协议,把磁盘文件包装成"请求-响应"(下方 protocol.handle)
//   ② 开一个原生窗口加载 app://inkwave/index.html
// 从此游戏代码里的 import()/fetch() 一行不用改——协议层在背后翻译成磁盘读取。
// 配套阅读:docs/BOOT.zh-CN.md 第 1 节。
//
// 【职责清单】app:// 伺服(带 CSP) · 窗口状态记忆 · 全屏控制(IPC) ·
//            防系统休眠节流 · 菜单栏 · GPU 后端选择
//
// 【模块定位】Electron 主进程(唯一能碰 Node/OS 的进程)。运行于渲染进程(网页)之外,
//   生命周期 = 整个应用;渲染进程里的一切都通过 preload.cjs 暴露的最小桥(window.inkwaveNative)与它通信。
//   它是"操作系统 ↔ 网页游戏"之间的适配层,本身不含任何玩法逻辑。
//
// 【核心机制】
//   ① app:// 协议伺服:protocol.handle('app', …) 把标准 Request 翻译成磁盘读取(见 app.whenReady 段),
//      让网页里的 import()/fetch() 原样可用;对 .html 额外注入 CSP 响应头,对媒体回 206 Range(拖动进度条所需)。
//   ② 窗口状态持久化:尺寸/全屏存于 userData/window-state.json,启动时校验位置是否仍落在某块屏幕内。
//   ③ GPU 后端:仅 macOS 走 ANGLE/Metal + 强制独显;其它平台不动(见文件前段注释)。
//   ④ 全屏 IPC:渲染进程可查/设全屏(fs:get / fs:set),主进程在状态落定后回推 fs:changed。
//
// 【关键约定】
//   · 安全默认:sandbox + contextIsolation=true,网页侧拿不到 Node;仅 preload 暴露白名单成员。
//   · 外链一律 shell.openExternal 交给系统浏览器,绝不在游戏窗口内导航(见 setWindowOpenHandler)。
//   · 歌曲文件打包时 asar.unpack 到 app.asar.unpacked,故伺服时要把路径里的 app.asar 改写过去,
//     否则 <audio> 无法按字节区间寻址。
//   · CSP 只允许 'self' 与必要的 data:/blob:,禁一切远程源。
//
// 【配套阅读】docs/BOOT.zh-CN.md 第 1 节;兄弟文件 electron/preload.cjs(桥)、
//             src/core/renderer.js 开头的苹果 GPU 路径注释(与本文的 GPU 开关互为互补)。
// ========================================================================================
// Electron shell for INKWAVE: serves the static game over a privileged app:// scheme
// (ES modules + import maps don't load from file://) and opens it in a native window.
const { app, BrowserWindow, Menu, protocol, net, shell, powerSaveBlocker, ipcMain, screen, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');

// GPU: run WebGL through ANGLE's Metal backend (instead of the deprecated OpenGL one),
// prefer the discrete GPU on dual-GPU Macs, and never fall back to software rendering.
// Metal is macOS-only; on Windows/Linux forcing it makes ANGLE fall back to software
// rendering (SwiftShader), which tanks the frame rate — so gate it to darwin.
// 【GPU 后端选择——踩过的大坑】macOS 上强制走 ANGLE/Metal(废弃的 OpenGL 太慢)+ 双显卡 Mac 强制独显;
// ⚠️ Metal 只在 macOS 有效:Windows/Linux 上强行指定会退化成 SwiftShader 软件渲染,帧率崩坏——
// 所以用 process.platform 门禁。这个教训的另一半在 src/core/renderer.js 开头的苹果专用路径注释里。
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('use-angle', 'metal');
  app.commandLine.appendSwitch('force_high_performance_gpu');
}
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// 【内容安全策略】只允许加载游戏自带的资源('self'),禁一切远程源——
// 即使窗口被注入恶意内容也无处取数;两处 'unsafe-inline' 例外是给 index.html 里的
// import map 和淡入小脚本(它们内联在 HTML 里)开的口子。
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",   // index.html's import map + fade-in snippet are inline
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
].join('; ');

// 【协议注册】把 app:// 声明为"标准、安全、支持 fetch、可流式"——
// 四个开关告诉 Chromium:把这个 scheme 当 http 一样对待(游戏代码里的 fetch/import 原样可用)。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ---- window state (size + fullscreen), remembered between launches; first launch opens fullscreen
// 【窗口状态记忆】尺寸/全屏写进 userData/window-state.json;启动时若保存的位置已不在任何
// 屏幕内(比如拔掉了外接显示器),回落到默认 1440×900——防止窗口"丢"在看不见的屏幕上。
// stateFile 给出状态文件路径;loadState 读盘(缺省/损坏时回退全屏);saveState 在窗口尺寸/位置/关闭时写盘。
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
// 【读取状态】读不到或损坏时返回 { fullscreen: true };?? 默认值写在展开之后,保证 JSON 里的字段优先。
function loadState() {
  try { return { fullscreen: true, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) }; } catch { return { fullscreen: true }; }
}
// 【写入状态】保存全屏标志与普通态 bounds(全屏时沿用已存的 bounds,否则记录 getNormalBounds)。
// 写盘失败视为非致命(如只读目录),直接忽略。
function saveState(win) {
  try {
    const s = { fullscreen: win.isFullScreen(), bounds: win.isFullScreen() ? loadState().bounds : win.getNormalBounds() };
    fs.writeFileSync(stateFile(), JSON.stringify(s));
  } catch { /* non-fatal */ }
}
// 【可见性校验】判断保存的矩形 b 是否与任一屏幕的可用工作区(workArea)相交——
// 相交即认为窗口落在可见范围内,否则弃用存的位置(回到默认居中尺寸)。
function onScreen(b) {
  return b && screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
}

// 【创建主窗口】读回状态 → 决定初始 bounds(不在屏幕内则 1440×900)→ 建窗 → 载入 app://inkwave/index.html
// → 装外链拦截、全屏状态机、IPC、电源锁、尺寸记忆。
function createWindow() {
  // 【开窗口】sandbox + contextIsolation = 预加载脚本之外没有网页能碰 Node 能力,安全性对标浏览器。
  // 背景色 #0d1020 与游戏底色一致,窗口出现的瞬间不闪白。
  const state = loadState();
  const bounds = onScreen(state.bounds) ? state.bounds : { width: 1440, height: 900 };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    title: 'INKWAVE',
    backgroundColor: '#0d1020',
    fullscreen: !!state.fullscreen,
    fullscreenable: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadURL('app://inkwave/index.html');
  // Keep any outbound links in the user's browser instead of inside the game window.
  // 【外链处理】任何 window.open/外链都用系统默认浏览器打开,游戏窗口本身不导航(拒绝并交出 URL)。
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Fullscreen. macOS ignores requests made mid-transition, so remember the wanted state and re-apply it once the
  // animation ends. Shortcuts are caught before the page sees them, so the game's key handling / pointer lock can't eat them.
  // `ours` marks a transition we started; any other (green button, View menu) just becomes the new wanted state.
  // 【全屏状态机——macOS 的坑】macOS 全屏动画期间会忽略新的切换请求,所以用 want/ours 两个变量:
  // want = 期望状态,ours = 是否我们发起的;动画结束(settled)后若实际 ≠ 期望就补一刀。
  // 快捷键在页面看到按键之前被这里截获(F11 / Ctrl+Cmd+F / Cmd+Enter),防止游戏里的
  // 键鼠处理(尤其鼠标指针锁定)把全屏键"吃掉"。
  let want = win.isFullScreen(), ours = false;
  const setFs = (on) => { want = !!on; if (win.isFullScreen() !== want) { ours = true; win.setFullScreen(want); } };
  const settled = () => {
    const now = win.isFullScreen();
    if (ours && now !== want) { win.setFullScreen(want); return; }
    ours = false; want = now;
    if (!win.webContents.isDestroyed()) win.webContents.send('fs:changed', now);
    saveState(win);
  };
  win.on('enter-full-screen', settled);
  win.on('leave-full-screen', settled);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    // ⌘Q quits from anywhere (menus, a match with the mouse captured, fullscreen), whatever the page does with keys
    if (process.platform === 'darwin' && input.meta && !input.control && !input.alt && k === 'q') { e.preventDefault(); app.quit(); return; }
    const hit = k === 'f11' || (input.meta && input.control && k === 'f') || (input.meta && k === 'enter');
    if (!hit) return;
    e.preventDefault();
    if (!input.isAutoRepeat) setFs(!want);
  });
  // 【全屏 IPC】先清掉可能残留的监听(窗口重建时 ipcMain 是全局的),再挂上:
  // fs:set 由渲染进程发起切换;fs:get 是同步调用(sendSync),故用 e.returnValue 就地应答。
  ipcMain.removeAllListeners('fs:set'); ipcMain.removeAllListeners('fs:get');
  ipcMain.on('fs:set', (_e, on) => setFs(on));
  ipcMain.on('fs:get', (e) => { e.returnValue = win.isFullScreen(); });

  // 【尺寸/位置记忆】窗口被拖动或缩放、以及关闭时,写回状态文件。
  win.on('resized', () => saveState(win));
  win.on('moved', () => saveState(win));
  win.on('close', () => saveState(win));

  // Stop App Nap from throttling the game loop while it's focused; release when in the background.
  // 【防系统省电搅局】macOS 的 App Nap 会在后台节流计时器;游戏聚焦时申请"阻止挂起"电源锁,
  // 失焦立即释放(不白占系统资源)。
  let blocker = null;
  win.on('focus', () => { if (blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension'); });
  win.on('blur', () => { if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; } });
  return win;
}

// 【HTTP 断点续传( Range 请求)】音乐播放器拖动进度条时,浏览器会发来 bytes=a-b 请求;
// 必须回 206 Partial Content,否则 <audio> 后续加载会整个失败。
// 手写而非让静态伺服库代劳,因为 app:// 协议本来就是我们自己实现的。
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac' };
// 【Range 应答】解析 'bytes=a-b'(支持 'a-'、'-b' 两种省略形式,后者表"末尾 N 字节"),
// 越界回 416;否则只读取所需区间返回 206 + Content-Range。注意 start>end 也算越界。
async function rangeResponse(file, header) {
  let size;
  try { ({ size } = await fs.promises.stat(file)); } catch { return new Response('Not found', { status: 404 }); }
  const [, a, b] = /bytes=(\d*)-(\d*)/.exec(header);
  let start = a === '' ? Math.max(0, size - Number(b)) : Number(a);
  let end = a !== '' && b !== '' ? Math.min(Number(b), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const buf = Buffer.alloc(end - start + 1);
  const fh = await fs.promises.open(file, 'r');
  try { await fh.read(buf, 0, buf.length, start); } finally { await fh.close(); }
  return new Response(buf, { status: 206, headers: {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(buf.length), 'Accept-Ranges': 'bytes',
  } });
}

// 【应用菜单栏】macOS 需要 app 菜单(⌘Q/⌘H 等系统项)与 windowMenu;View 下额外提供
// 全屏切换、重载、开发者工具和一个 chrome://gpu 诊断窗(用于排查 GPU 后端)。
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { label: 'GPU Info', click: () => new BrowserWindow({ width: 900, height: 700 }).loadURL('chrome://gpu') },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

// 【应用生命周期】就绪后:设暗色主题 → 注册 app:// 协议伺服 → 建菜单 → 建窗口;
// activate(macOS 点击 Dock)在无窗口时补建一个。所有窗口关闭即退出(含 Windows/Linux)。
app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  // 【app:// 协议的"伺服核心"】这就是那个把磁盘文件包装成 HTTP 的翻译器:
  //   收到标准 Request → URL 路径映射到 ROOT 下的文件(越界返回 403,防目录穿越)
  //   → 歌曲在 asar 包外(打包配置刻意 unpack,媒体文件需要可寻址)→ 处理 Range →
  //   读文件返回标准 Response;对 .html 额外注入 CSP 响应头(上面那张白名单)。
  // 至此游戏里的 import()/fetch() 全程无感:单机不出网卡,但语法/缓存/安全规则原样保留。
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    let file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    // songs ship outside the asar archive (see package.json asar.unpackDir) so media can seek in them
    file = file.replace(`app.asar${path.sep}songs${path.sep}`, `app.asar.unpacked${path.sep}songs${path.sep}`);
    // <audio> streams with byte-range requests: answer them with 206 partial content, or later loads of a song fail
    const range = req.headers.get('range');
    if (range && /^bytes=\d*-\d*$/.test(range)) return rangeResponse(file, range);
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!file.endsWith('.html')) return res;
    // everything the game loads ships inside the app; nothing remote may run in the window
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// 【全关即退】不限平台,关掉最后一个窗口就退出(macOS 惯例是留在 Dock,但本游戏不保留)。
app.on('window-all-closed', () => app.quit());
