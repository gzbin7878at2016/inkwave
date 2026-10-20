// 只在移动构建中加载原生插件；普通网页仍从 src/main.js 启动。
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { installMobile } from './src/platform/mobile.js';

window.inkwaveMobile = { native: Capacitor.isNativePlatform(), App, Network };
document.documentElement.classList.add('iw-mobile');
// boot() 异步完成后才有完整 Game；只安装一次平台适配，不另起游戏循环。
const attach = () => {
  if (window.__inkwave) installMobile(window.__inkwave);
  else setTimeout(attach, 100);
};
attach();
import('./src/main.js').catch((e) => {
  const el = document.getElementById('boot-error');
  if (el) { el.style.display = 'block'; el.textContent = `启动失败：${e.message}`; }
});
