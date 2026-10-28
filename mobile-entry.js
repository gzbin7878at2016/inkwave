// 只在移动构建中加载原生插件；普通网页仍从 src/main.js 启动。
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { installMobile } from './src/platform/mobile.js';
import { installDiagnostics } from './src/platform/diagnostics.js';

window.inkwaveMobile = { native: Capacitor.isNativePlatform(), App, Network, BossDisplay: registerPlugin('BossDisplay') };
if ((typeof __INKWAVE_MANUAL__ === 'undefined' || !__INKWAVE_MANUAL__)) installDiagnostics(registerPlugin('GameDiagnostics'));
document.documentElement.classList.add('iw-mobile');
// boot() 异步完成后才有完整 Game；只安装一次平台适配，不另起游戏循环。
import('./src/main.js').then(async module => {
  const game = await module.bootReady;
  if (game) installMobile(game);
}).catch((e) => {
  window.inkwaveDiagnostics?.record('boot-import-failed', e, 'error');
  const el = document.getElementById('boot-error');
  if (el) { el.style.display = 'block'; el.textContent = `启动失败：${e.message}`; }
});
