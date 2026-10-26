// 仅附着独立Boss方法调查轮；不启动/关闭游戏、不占用或拆除已有CDP转发。
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';
const name = process.env.BOSS_TRACE_NAME, kind = process.env.BOSS_TRACE_PROBE;
const passive=kind==='passive',dom=kind==='dom';
const early=dom||kind==='ui'||kind==='layers';
const flag = { music: 'musicAblation', panner: 'pannerAblation', 'audio-suspend': 'audioSuspend', 'audio-graph': 'audioGraphBypass',passive:'methodProbe',dom:'domAblation',ui:'uiAblation',layers:'layerHints' }[kind];
if (!name || !/^[a-z0-9-]+$/i.test(name) || !flag) throw Error('须明确BOSS_TRACE_NAME与BOSS_TRACE_PROBE=music/panner/audio-suspend/audio-graph/passive/dom/ui');
const base = `releases/investigation/systemtrace-${name}`, reportPath = `releases/investigation/phone-boss-${name}.json`;
try { await access(base + '.meta.json'); throw Error('不能覆盖已有原生调查，请使用新名称'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const adb = process.env.ADB_PATH || `${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`;
const target = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : ['-d'];
const command = (...a) => execFileSync(adb, [...target, ...a], { encoding: 'utf8', timeout: 15000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 200; i++) {
  let p; try { p = JSON.parse(await readFile(reportPath, 'utf8')); } catch (e) { if (!(e.code === 'ENOENT' || e instanceof SyntaxError)) throw e; }
  if (p) {
    if (p.status === 'aborted') throw Error('主调查已中止，不再等待或重开');
    if(passive&&['gpuAblation','cpuAblation','uiAblation','musicAblation','pannerAblation','audioSuspend','audioGraphBypass','audioReverbBypass','domAblation','layerHints','markerVars'].some(key=>p[key]))throw Error('被动原生调查不能夹带音画/模拟旁路');
    const s = p.timeline.at(-1), fresh = Date.now() - Date.parse(p.startedAt) < 180000;
    if (fresh && p.methodProbe && p[flag] && p.status === 'running' && s?.state === 'playing' && s.activeMs >= (early?4000:8000)) {
      if (s.activeMs > (early?8000:13000)) throw Error('已错过切换前采集窗口，不中断或重开本局');
      ready = true; break;
    }
  }
  await sleep(400);
}
if (!ready) throw Error('未找到本轮新鲜且匹配的独立Boss隔离调查');
const pages = await (await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(3000) })).json();
const page = pages.find(p => p.url === 'https://localhost/'); if (!page) throw Error('无现存游戏调试目标');
const ws = new WebSocket(page.webSocketDebuggerUrl); let seq = 0;
const pending = new Map(), meta = { performanceTest: false, kind, requestedSeconds: 20, categories: ['sched', 'freq', 'idle'], bufferKiBPerCpu: 16384 };
let bindingTrace=false,traceComplete;const processMarker='inkwave-boss-native-process',rendererIds=new Set();
const fail = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('采集锚点调试连接断开')); } pending.clear(); };
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('调试连接超时')), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = () => { clearTimeout(timer); reject(Error('调试连接失败')); }; });
  ws.onclose = fail; ws.onerror = fail;
  ws.onmessage = e => { const v = JSON.parse(e.data);
    if(v.method==='Tracing.dataCollected')for(const event of v.params.value)if(event.name===processMarker&&Number.isFinite(event.pid)){rendererIds.add(event.pid);meta.rendererMainTid=event.tid;}
    if(v.method==='Tracing.tracingComplete')traceComplete?.();
    const p = pending.get(v.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(v.id); v.error ? p.reject(Error(JSON.stringify(v.error))) : p.resolve(v.result); };
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+'超时'));},5000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  // 本页JS标记直接给出真正renderer PID/TID，不再从多个WebView的线程名猜归属。
  await call('Tracing.start',{categories:'blink.user_timing',transferMode:'ReportEvents'});bindingTrace=true;
  await evaluate(`performance.mark('${processMarker}');true`);
  const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('进程标记Trace未结束')),5000);traceComplete=()=>{clearTimeout(timer);resolve();};});
  await call('Tracing.end');await done;bindingTrace=false;
  if(rendererIds.size!==1)throw Error('本页进程标记缺失或不唯一');meta.rendererPid=[...rendererIds][0];
  meta.appPid = command('shell', 'pidof', 'com.demoink.inkwave').trim();
  await writeFile(base + '.ps.txt', command('shell', 'ps', '-A', '-T'));
  // 前后内核uptime夹住实时游戏时钟，而不是用最多过时2秒的电脑采样点对齐。
  meta.uptimeBefore = command('shell', 'cat', '/proc/uptime').trim();
  meta.anchor = await evaluate('(async()=>({activeMs:__phonePerf.activeMs,state:__inkwave.match.state,display:await inkwaveMobile.BossDisplay.getState(),audioParams:__G.audio.bossParamDedupeInfo?.()||null,domProbe:__phonePerf.domProbe||null,uiAblationPhase:__phonePerf.uiAblationPhase,source:inkwaveDiagnostics.report().current.build.sourceCommit}))()');
  meta.minimap=await evaluate('(()=>{const m=__inkwave.minimap,c=m.canvas,r=c.getBoundingClientRect();return{width:c.width,height:c.height,pxPerM:m.s,cssWidth:c.clientWidth,cssHeight:c.clientHeight,rectWidth:r.width,rectHeight:r.height,dpr:devicePixelRatio,context:m.ctx.getContextAttributes?.(),expanded:__inkwave.hud._mapT};})()');
  meta.uptimeAfter = command('shell', 'cat', '/proc/uptime').trim();
  if (meta.anchor.state !== 'playing' || meta.anchor.activeMs > (early?10000:14000)) throw Error('锚点已离开有效窗口');
  ws.close(); meta.hostStartedAt = Date.now(); await writeFile(base + '.meta.json', JSON.stringify(meta, null, 2));
  const r = await promisify(execFile)(adb, [...target, 'exec-out', 'atrace', '-z', '-b', '16384', '-t', '20', '-a', 'com.demoink.inkwave', ...meta.categories], {
    encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 65000,
  });
  meta.hostEndedAt = Date.now(); meta.stderr = r.stderr.toString(); meta.rawBytes = r.stdout.length;
  await writeFile(base + '.atrace.bin', r.stdout);
  const marker = Buffer.from('TRACE:\n'), index = r.stdout.indexOf(marker); if (index < 0) throw Error('原生跟踪缺失TRACE头');
  const decoded = inflateSync(r.stdout.subarray(index + marker.length), { maxOutputLength: 512 * 1024 * 1024 });
  meta.decodedBytes = decoded.length; await writeFile(base + '.trace.txt', decoded);
  await writeFile(base + '.meta.json', JSON.stringify(meta, null, 2)); console.log(meta);
} catch (e) {
  meta.error = String(e); await writeFile(base + '.meta.json', JSON.stringify(meta, null, 2)); throw e;
} finally { if(bindingTrace&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:++seq,method:'Tracing.end'}));fail(); ws.close(); }
