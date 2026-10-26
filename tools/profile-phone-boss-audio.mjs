// 独立带探针轮的WebAudio只读指标，不建图、不改声音、不修改/拆除已有ADB转发。
import { readFile, writeFile } from 'node:fs/promises';
const name = process.env.BOSS_AUDIO_PROFILE_NAME;
if (!name || !/^[a-z0-9-]+$/i.test(name)) throw Error('须明确新的BOSS_AUDIO_PROFILE_NAME');
const path = `releases/investigation/boss-webaudio-${name}.json`, reportPath = `releases/investigation/phone-boss-${name}.json`;
try { await readFile(path); throw Error('不能覆盖音频调查原件'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let ready = false;
for (let i = 0; i < 200; i++) {
  let p; try { p = JSON.parse(await readFile(reportPath, 'utf8')); } catch (e) { if (!(e.code === 'ENOENT' || e instanceof SyntaxError)) throw e; }
  if (p) {
    if (p.status === 'aborted') throw Error('主调查已中止');
    const s = p.timeline.at(-1);
    if (p.methodProbe && p.status === 'running' && Date.now() - Date.parse(p.startedAt) < 180000 && s?.activeMs >= 6000) {
      if (s.activeMs > 13000) throw Error('已错过调查前段，不重开游戏'); ready = true; break;
    }
  }
  await new Promise(r => setTimeout(r, 400));
}
if (!ready) throw Error('无匹配的新鲜方法调查轮');
const pages = await (await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(3000) })).json();
const page = pages.find(p => p.url === 'https://localhost/'); if (!page) throw Error('无游戏CDP目标');
const ws = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(), contexts = new Map();
let seq = 0, enabled = false;
const report = { performanceTest: false, samples: [], note: '保留原始renderCapacity；显示百分比按DevTools前端raw*100，不按协议注释重复换算。' };
const fail = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('音频指标调试连接断开')); } pending.clear(); };
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(method + '超时')); }, 5000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('音频调试连接超时')), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = () => { clearTimeout(timer); reject(Error('音频调试连接失败')); }; });
  ws.onclose = fail; ws.onerror = fail;
  ws.onmessage = e => { const v = JSON.parse(e.data);
    if (v.method === 'WebAudio.contextCreated' || v.method === 'WebAudio.contextChanged') contexts.set(v.params.context.contextId, v.params.context);
    if (v.method === 'WebAudio.contextWillBeDestroyed') contexts.delete(v.params.contextId);
    const p = pending.get(v.id); if (!p) return; clearTimeout(p.timer); pending.delete(v.id);
    v.error ? p.reject(Error(JSON.stringify(v.error))) : p.resolve(v.result);
  };
  await call('WebAudio.enable'); enabled = true;
  for (let i = 0; i < 40; i++) {
    const r = await call('Runtime.evaluate', { expression: '({activeMs:__phonePerf.activeMs,state:__inkwave.match.state,graphBypass:__phonePerf.audioBypassedForProbe,reverbBypass:__phonePerf.reverbBypassedForProbe})', returnByValue: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    const sample = { at: Date.now(), ...r.result.value, contexts: [] };
    for (const context of contexts.values()) if (context.contextType === 'realtime') {
      sample.contexts.push({ context, data: (await call('WebAudio.getRealtimeData', { contextId: context.contextId })).realtimeData });
    }
    report.samples.push(sample); await writeFile(path, JSON.stringify(report, null, 2));
    if (sample.activeMs >= 30000 || ['finish', 'results'].includes(sample.state)) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!report.samples.some(s => s.contexts.length)) throw Error('没有实时音频上下文数据');
  report.ok = true; console.log('音频指标已保存', path, report.samples.length);
} catch (e) { report.error = String(e); throw e; }
finally { if (enabled) await call('WebAudio.disable').catch(() => {}); fail(); ws.close(); await writeFile(path, JSON.stringify(report, null, 2)); }
