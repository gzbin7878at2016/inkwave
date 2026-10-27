// 只附着现有Boss方法轮，15～30秒借缓存图像替换静态图标，finally恢复原SVG。
import { writeFile } from 'node:fs/promises';
import { createBossMarkerImages } from './boss-marker-image-candidate.mjs';
const raster = process.env.BOSS_MARKER_IMAGE_RASTER === '1';
let ws, sequence = 0; const pending = new Map();
const path = `releases/investigation/boss-marker-images-phone-${Date.now()}.json`, report = { methodOnly: true, status: 'waiting' };
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(method + '超时')); }, 15000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const state = () => evaluate('({method:!!window.__phonePerf?.methods,live:window.__phonePerf?.match===window.__inkwave?.match&&window.__inkwave?.match?.state==="playing",active:window.__phonePerf?.activeMs||0})');
try {
  let page;
  for (let i = 0; i < 60; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(2000) })).json()).find(p => p.url === 'https://localhost/'); } catch {}
    if (page) break; await new Promise(r => setTimeout(r, 500));
  }
  if (!page) throw Error('无现有调试页面');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('连接超时')), 5000); ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = reject; });
  ws.onmessage = e => { const v = JSON.parse(e.data), p = pending.get(v.id); if (!p) return; pending.delete(v.id); clearTimeout(p.timer); v.error ? p.reject(Error(JSON.stringify(v.error))) : p.resolve(v.result); };
  ws.onclose = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('调试连接关闭')); } pending.clear(); };
  let ready = false;
  for (let i = 0; i < 180; i++) { const s = await state(); if (s.method && s.live && s.active >= 5000) { if (s.active > 12000) throw Error('错过原始对照窗口'); ready = true; break; } await new Promise(r => setTimeout(r, 500)); }
  if (!ready) throw Error('未进入方法轮实战');
  report.initial = await evaluate(`(async()=>{
    const root=document.querySelector('.iw-hud.is-boss');if(!root)throw Error('Boss HUD不存在');
    const candidate=await (${createBossMarkerImages.toString()})(root,{raster:${raster}});if(!candidate.setup.icons)throw Error('没有可转换图标');
    const p={candidate,images:false};
    p.snapshot=()=>({...candidate.snapshot(),images:p.images,activeMs:__phonePerf.activeMs,frameNumber:__inkwave._frameN,alive:!!__inkwave.match.local?.alive});
    p.toggle=on=>{candidate.toggle(on);p.images=on;return p.snapshot();};
    p.restore=()=>({...p.toggle(false),restored:candidate.snapshot().remaining===0});
    window.__bossMarkerImages=p;return p.snapshot();
  })()`);
  for (const [target, phase, expression] of [[15000, 'cached', '__bossMarkerImages.toggle(true)'], [30000, 'restored', '__bossMarkerImages.restore()']]) {
    let reached = false;
    for (let i = 0; i < 100; i++) { const s = await state(); if (!s.live) throw Error('方法轮提前结束'); if (s.active >= target) { if (s.active > target + 3000) throw Error('图标切换过晚'); reached = true; break; } await new Promise(r => setTimeout(r, 250)); }
    if (!reached) throw Error('未达到切换时间');
    report[phase] = await evaluate(expression);
  }
  report.status = 'completed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  if (ws?.readyState === WebSocket.OPEN) {
    report.cleanup = await evaluate('window.__bossMarkerImages?.restore()').catch(error => ({ error: String(error) }));
    if (report.cleanup && !report.cleanup.restored) { process.exitCode = 1; report.status = 'failed'; }
  }
  ws?.close(); await writeFile(path, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ path, ...report }));
}
