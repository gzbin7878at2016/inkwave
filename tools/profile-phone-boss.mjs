// 附着已运行的带探针Boss轮，采集有界V8 CPU样本；不启动游戏、不抢占ADB转发。
import { mkdir, writeFile } from 'node:fs/promises';
const seconds = Number(process.env.BOSS_CPU_PROFILE_SECONDS || 30);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 40) throw Error('CPU采样秒数须为1～40');
const path = `releases/investigation/boss-cpu-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const report = { status: 'waiting', requestedSeconds: seconds, performanceTest: false };
let ws, seq = 0, profiling = false, profile;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method}超时`)); }, 15000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
await mkdir('releases/investigation', { recursive: true });
try {
  let page;
  for (let i = 0; i < 60; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(2000) })).json()).find(p => p.url === 'https://localhost/'); } catch {}
    if (page) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!page) throw Error('没有现存USB调试目标');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CPU调试连接超时')), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = e => { clearTimeout(timer); reject(e); };
  });
  ws.onmessage = e => {
    const v = JSON.parse(e.data), p = pending.get(v.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(v.id);
    v.error ? p.reject(Error(JSON.stringify(v.error))) : p.resolve(v.result);
  };
  ws.onclose = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('CPU调试目标关闭')); } pending.clear(); };
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const state = await evaluate('({probe:!!window.__phonePerf?.methods,live:!!window.__phonePerf?.match&&window.__phonePerf.match===window.__inkwave?.match&&window.__inkwave?.match?.state==="playing",active:window.__phonePerf?.activeMs||0})');
    if (state.probe && state.live && state.active >= 5000) {
      if (state.active > (50 - seconds) * 1000) throw Error('战斗剩余时间不足');
      ready = true; report.activeStartMs = state.active; break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) throw Error('没有带探针的Boss实战');
  // 以真实游戏帧数归一化样本；CPU采样窗口不是独立帧率成绩，保留起止存活/绘制量以识别混杂。
  const snapshot = () => evaluate('(()=>{const g=window.__inkwave,a=g?.match?.actors?.find(a=>a.isLocal);return {frameNumber:g?._frameN,activeMs:window.__phonePerf?.activeMs,state:g?.match?.state,alive:a?!!a.alive:null,calls:g?.R?.renderer?.info?.render?.calls,triangles:g?.R?.renderer?.info?.render?.triangles};})()');
  report.startState = await snapshot();
  await call('Profiler.enable'); await call('Profiler.setSamplingInterval', { interval: 1000 });
  await call('Profiler.start'); profiling = true;
  await new Promise(r => setTimeout(r, seconds * 1000));
  ({ profile } = await call('Profiler.stop')); profiling = false;
  report.endState = await snapshot();
  const frames = report.endState.frameNumber - report.startState.frameNumber;
  report.actualGameFrames = Number.isFinite(frames) && frames > 0 ? frames : null;
  const nodes = new Map(profile.nodes.map(n => [n.id, n])), self = new Map(), inclusive = new Map(), parents = new Map();
  for (const n of profile.nodes) for (const child of n.children || []) parents.set(child, n.id);
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i], ms = profile.timeDeltas[i] / 1000;
    self.set(id, (self.get(id) || 0) + ms);
    for (let n = id; n !== undefined; n = parents.get(n)) inclusive.set(n, (inclusive.get(n) || 0) + ms);
  }
  const top = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([id, ms]) => ({ ms: Math.round(ms * 10) / 10, ...nodes.get(id).callFrame }));
  report.status = 'collected'; report.samples = profile.samples.length; report.topSelf = top(self); report.topInclusive = top(inclusive);
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  if (profiling && ws?.readyState === WebSocket.OPEN) await call('Profiler.stop').catch(() => {});
  ws?.close(); await writeFile(path, JSON.stringify({ report, profile })); console.log(JSON.stringify({ path, ...report }));
}
