import { G } from '../core/ctx.js';
import { TouchInput } from '../core/touchInput.js';
import { MobileProfiler } from './mobileProfiler.js';
import { createMobileBossDisplay } from './mobileBossDisplay.js';
import { syncMobileBossParamDedupe } from '../audio/mobileBossParamDedupe.js';
import { createMobileBossRasterHints } from './mobileBossRasterHints.js';
import { clearMobileBossMinimapWorkerForMatch } from './mobileBossMinimapWorker.js';

// 手机平台边界：输入、生命周期与诊断；不改变网络协议和权威模拟。
export function installMobile(game) {
  const bossRasterHints = createMobileBossRasterHints();
  const bossDisplay = createMobileBossDisplay(window.inkwaveMobile.native ? window.inkwaveMobile.BossDisplay : null,
    (name, detail) => window.inkwaveDiagnostics?.record(name, detail));
  const touch = game.input.touch = new TouchInput(game.input, () => game.pause());
  // 取消手势与正常松手不同：丢弃蓄力/投掷意图，不能回前台自动扔出副武器。
  touch.onCancel = () => {
    const a = game.match?.local;
    if (!a || game.match.attract) return;
    const runner = a.weaponRunner;
    if (runner) { const cd = runner.cooldown; runner.reset(); runner.cooldown = Math.max(cd, 0.15); }
    for (const key of ['fire', 'sub', 'jump', 'special', 'squid']) { a.intent[key] = false; a._prevIntent[key] = false; }
    a.intent.move.set(0, 0, 0); a.fireBuffer = 0;
  };
  game.input.lastDevice = 'touch';
  const panel = document.createElement('div'); panel.id = 'mobile-panel';
  panel.innerHTML = `<button data-mobile="practice">触屏练习</button><button data-mobile="tune">触控设置</button><button data-mobile="stats">诊断</button><button data-mobile="export">复制报告</button><span></span>`;
  document.body.append(panel);
  for (const id of ['mobile-log-export', 'mobile-log-upload']) {
    const logButton = document.getElementById(id);
    if (logButton) panel.append(logButton);
  }
  const dialog = document.createElement('div'); dialog.id = 'mobile-dialog'; dialog.hidden = true;
  document.body.append(dialog);
  const info = panel.querySelector('span');
  const state = { suspended: false, needsResume: false, lostContext: false, network: true, samples: [], clock: 0, stats: false, onlineExit: null };
  const frameTimes = new Float32Array(240); let frameCount = 0, frameIndex = 0;
  const practiceButton = panel.querySelector('[data-mobile="practice"]');
  const resetInput = () => {
    touch.setEnabled(false); touch.clear(); game.input.keys.clear(); game.input.pressed.clear();
    Object.assign(game.input.mouse, { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false });
  };
  const message = (text, action, label = '点击继续') => {
    dialog.replaceChildren(); dialog.hidden = false;
    const p = document.createElement('p'); p.textContent = text;
    const b = document.createElement('button'); b.textContent = label;
    b.onclick = action; dialog.append(p, b);
  };
  const save = () => localStorage.setItem('inkwave.settings', JSON.stringify(game.settings));
  const suspend = () => {
    clearMobileBossMinimapWorkerForMatch(game.match, 'suspend');
    bossRasterHints.clear();
    G.audio?.setBossParamDedupe?.(false);
    bossDisplay.suspend();
    if (state.suspended) return;
    state.suspended = true; state.needsResume = true; game.mobileSuspended = true;
    if (game.hud) game.hud.paused = true;
    resetInput(); game.pause(); G.music?.pause?.(); G.audio?.ctx?.suspend?.().catch(() => {});
    if (game._mobilePreparation || game._mobilePreparationError) {
      // 准备中进入后台：取消后停止旧世界，回前台通过继续按钮安全返回菜单。
      if (game._mobilePreparation) game._mobilePreparation.cancelled = true;
      game._mobilePreparationError = true;
      state.onlineExit = '场景准备已暂停，点击继续返回菜单。';
    }
    // Android 后台不保证 WebSocket/计时器存活。本测试版主动离房，前台明确提示重新加入。
    if (G.net && !['offline', 'error'].includes(G.net.state)) {
      G.net.leave(); state.onlineExit = '应用进入后台，已退出联机房间。请重新加入；旧对局不自动恢复。';
    }
  };
  const resume = () => {
    if (state.suspended || state.lostContext) return;
    state.needsResume = false; game.mobileSuspended = false; dialog.hidden = true;
    if (game.hud) game.hud.paused = false;
    G.audio?.resume?.();
    if (state.onlineExit) {
      state.onlineExit = null;
      game.quitToMenu().catch(console.error);
    } else if (game.match?.paused) game.resume();
    else G.music?.resume?.();
  };
  const foreground = () => {
    state.suspended = false;
    if (!state.needsResume || state.lostContext) return;
    message(state.onlineExit || '已返回前台。点击继续，恢复画面与声音。', resume);
  };
  document.addEventListener('visibilitychange', () => document.hidden ? suspend() : foreground());
  window.addEventListener('pagehide', suspend);
  if (window.inkwaveMobile.native) {
    window.inkwaveMobile.App.addListener('appStateChange', ({ isActive }) => isActive ? foreground() : suspend());
    window.inkwaveMobile.App.addListener('backButton', () => {
      resetInput();
      if (game.match && !game.match.attract) {
        if (game.menus?.current === 'pause') game.resume(); else game.pause();
      } else {
        message('退出游戏？', () => window.inkwaveMobile.App.exitApp(), '确认退出');
        const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => { dialog.hidden = true; }; dialog.append(cancel);
      }
    });
    window.inkwaveMobile.Network.addListener('networkStatusChange', ({ connected }) => {
      state.network = connected;
      if (!connected && G.net && !['offline', 'error'].includes(G.net.state)) {
        G.net.leave(); resetInput();
        state.onlineExit = '网络已断开，已退出联机房间。恢复网络后请重新加入。';
        message(state.onlineExit, resume, '返回主菜单');
      }
    });
  }
  game.R.renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); suspend(); state.lostContext = true;
    message('图形资源已丢失，需要重新启动本次游戏。', () => location.reload(), '重新加载');
  });
  panel.querySelector('[data-mobile="practice"]').onclick = () => game.startPractice();
  panel.querySelector('[data-mobile="stats"]').onclick = () => { state.stats = !state.stats; };
  panel.querySelector('[data-mobile="export"]').onclick = async () => {
    const report = JSON.stringify(window.inkwaveDiagnostics?.report({ probe: true }) || { samples: state.samples }, null, 2);
    try { await navigator.clipboard.writeText(report); info.textContent = '诊断报告已复制，可粘贴保存'; }
    catch {
      resetInput(); game.pause(); message('长按文本全选并复制诊断报告', () => { dialog.hidden = true; if (game.match?.paused) game.resume(); }, '关闭');
      const field = document.createElement('textarea'); field.readOnly = true; field.value = report; field.style.cssText = 'width:100%;height:50%;user-select:text'; dialog.append(field);
    }
  };
  panel.querySelector('[data-mobile="tune"]').onclick = () => {
    resetInput(); game.pause();
    dialog.hidden = false;
    dialog.innerHTML = `<p>触控与性能设置（自动保存）</p>
      <label>转向灵敏度 <input aria-label="转向灵敏度" type="range" min="0.3" max="2.5" step="0.1" value="${game.settings.touchSensitivity ?? 1}"></label>
      <label>按钮大小 <input aria-label="按钮大小" type="range" min="0.8" max="1.3" step="0.1" value="${game.settings.touchButtonScale ?? 1}"></label>
      <label>左手瞄准布局 <input type="checkbox" ${game.settings.touchLeftHanded ? 'checked' : ''}></label>
      <label>目标帧率 <select><option value="30">30（省电）</option><option value="60">60（更流畅）</option></select></label>
      <label>画面清晰度 <select aria-label="画面清晰度"><option value="battery">省电 · 1倍 / FXAA</option><option value="clear">清晰 · 1.5倍 / SMAA（推荐）</option><option value="hd">高清 · 2倍 / SMAA（更耗电）</option></select></label>
      <label>自动降低清晰度 <input aria-label="自动降低清晰度" type="checkbox" ${game.settings.mobileDynamicResolution ? 'checked' : ''}></label>
      <small>默认60帧目标、2倍高清。勾选自动降低清晰度后，掉帧时允许降低分辨率；发热可切省电。</small>
      <button>保存并返回</button>`;
    const sliders = dialog.querySelectorAll('input');
    sliders[0].oninput = () => { game.settings.touchSensitivity = +sliders[0].value; save(); };
    sliders[1].oninput = () => { game.settings.touchButtonScale = +sliders[1].value; applySize(); save(); };
    sliders[2].onchange = () => { game.settings.touchLeftHanded = sliders[2].checked; applySize(); save(); };
    const fps = dialog.querySelector('select'); fps.value = String(game.settings.fpsCap || 60);
    fps.onchange = () => { game.settings.fpsCap = +fps.value; save(); };
    // 清晰度在当前对局即时重建后处理，不重开地图；持久保存，升级时旧设置默认清晰档。
    const visual = dialog.querySelector('[aria-label="画面清晰度"]');
    visual.value = game.settings.mobileVisual || 'hd';
    visual.onchange = () => game._setSettings({ mobileVisual: visual.value });
    const dynamic = dialog.querySelector('[aria-label="自动降低清晰度"]');
    dynamic.onchange = () => game._setSettings({ mobileDynamicResolution: dynamic.checked });
    dialog.querySelector('button').onclick = () => { dialog.hidden = true; if (game.match?.paused) game.resume(); };
  };
  const applySize = () => {
    touch.clear();
    document.documentElement.style.setProperty('--touch-size', String(game.settings.touchButtonScale ?? 1));
    touch.root.classList.toggle('mobile-left', !!game.settings.touchLeftHanded);
  };
  applySize();
  game.mobile = {
    profile: new MobileProfiler(game),
    touch, state, suspend, foreground, resume, bossRasterHints,
    recordFrame(ms) { frameTimes[frameIndex] = ms; frameIndex = (frameIndex + 1) % frameTimes.length; frameCount = Math.min(frameTimes.length, frameCount + 1); },
    update(dt) {
      if (game.match?.paused) clearMobileBossMinimapWorkerForMatch(game.match, 'paused');
      bossRasterHints.update(game.hud?.el,game.match,G.mode,state.needsResume||state.lostContext||game.mobileSuspended);
      syncMobileBossParamDedupe(G.audio,game.match,G.mode,state.needsResume||state.lostContext||game.mobileSuspended);
      bossDisplay.update(game, G.mode, state.needsResume || state.lostContext || game.mobileSuspended);
      window.inkwaveDiagnostics?.tick();
      const live = G.mode === 'match' && game.match && !game.match.attract && game.match.state === 'playing' && !game.match.paused;
      touch.setEnabled(!!(live && !game.menus?.current && !state.needsResume && !state.lostContext && dialog.hidden));
      practiceButton.hidden = G.mode !== 'menu';
      state.clock += dt;
      if (state.clock >= 1) {
        state.clock = 0;
        const mem = game.R.renderer.info.memory;
        const times = Array.from(frameTimes.subarray(0, frameCount)).sort((a, b) => a - b);
        const sample = { at: Date.now(), fps: game.fps, p50: times[Math.floor((times.length - 1) * 0.5)] || 0, p95: times[Math.floor((times.length - 1) * 0.95)] || 0, scale: game.R.dynScale, textures: mem.textures, geometries: mem.geometries, calls: game.perf?.calls || 0, triangles: game.perf?.tris || 0, heapBytes: performance.memory?.usedJSHeapSize ?? null, rtt: G.net?.tr?.rtt || 0 };
        sample.profile = game.mobile.profile.snapshot();
        sample.mode = G.mode; sample.matchState = game.match?.state; sample.pixelRatio = game.R.renderer.getPixelRatio();
        state.samples.push(sample); if (state.samples.length > 300) state.samples.shift();
        info.textContent = state.stats ? `${sample.fps} FPS · P95 ${Math.round(sample.p95)}ms · 比例 ${sample.scale.toFixed(2)} · 纹理 ${sample.textures} · 几何 ${sample.geometries} · RTT ${Math.round(sample.rtt)}ms` : state.network ? '' : '离线';
      }
    },
  };
}
