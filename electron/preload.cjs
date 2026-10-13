// ============================================================================
// 【中文导读】预加载桥 —— 主进程与网页之间**唯一的**受控通道(暴露为 window.inkwaveNative)
// ----------------------------------------------------------------------------
// 【模块定位】Electron 预加载脚本,在网页加载前运行,拥有有限的 Node 能力;由 electron/main.cjs
//   在创建窗口时通过 webPreferences.preload 指定。它把少量 IPC 封装成对象,注入页面全局。
//   运行环境:桌面壳(app://)才有;纯网页构建永远不会看到 window.inkwaveNative,
//   因此游戏代码一律先判 `if (window.inkwaveNative)`(见 src/main.js 里镜像全屏状态的写法)。
//
// 【核心机制】contextBridge.exposeInMainWorld('inkwaveNative', {...}) 把下面的白名单对象
//   安全地桥接到页面(即使渲染进程开了 contextIsolation + sandbox)。
//   仅四项:platform(只读字符串)、isFullScreen(同步查)、setFullScreen(异步设)、
//   onFullScreenChange(订阅主进程 fs:changed 推送)。
//
// 【关键约定 —— 为什么最小暴露】
//   沙箱 + contextIsolation 下,页面拿不到 require/ipcRenderer 本体;这里只放行**全屏**这一件事,
//   不暴露任意 IPC 通道、不暴露文件系统、不暴露 Node API。暴露面越小,被注入脚本滥用的风险越低——
//   游戏真正需要的原生能力只有"全屏(且系统快捷键也归主进程管)",其余全留在网页侧。
//   · fs:get 用 sendSync 同步取回当前全屏态(sendSync 会阻塞,故只用于这一次短查询);
//   · fs:set 异步发;主进程在状态落定后回推 fs:changed,页面经 onFullScreenChange 更新 UI。
//
// 【配套阅读】electron/main.cjs(IPC 端点 fs:get/fs:set/fs:changed 的应答端)、
//             docs/BOOT.zh-CN.md 第 1 节;消费方:src/main.js(boot 里镜像全屏状态与订阅变更)。
// ============================================================================
// Bridge exposed to the game page as window.inkwaveNative (desktop app only; the web build never sees it).
const { contextBridge, ipcRenderer } = require('electron');

// 【最小暴露面】只桥接四项能力:平台标识 + 全屏的查/设/订阅。其余 Node/IPC 一概不外泄。
//   isFullScreen 用 sendSync 同步取回(主进程以 e.returnValue 应答);setFullScreen 异步发;
//   onFullScreenChange 订阅主进程在状态落定后回推的 fs:changed。
contextBridge.exposeInMainWorld('inkwaveNative', {
  platform: process.platform,
  isFullScreen: () => ipcRenderer.sendSync('fs:get'),
  setFullScreen: (on) => ipcRenderer.send('fs:set', !!on),
  onFullScreenChange: (cb) => { ipcRenderer.on('fs:changed', (_e, on) => cb(!!on)); },
});
