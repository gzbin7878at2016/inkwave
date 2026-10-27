// 只附着现有一分钟Boss方法轮；不抢占ADB转发、不改perf/温控策略、不启动或停止游戏。
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {validateNativeStackTarget} from './native-stack-target.mjs';
const name=process.env.BOSS_NATIVE_STACK_TEST_NAME,serial=process.env.ANDROID_SERIAL;
if(!/^[a-z0-9-]{1,60}$/i.test(name||'')||!serial)throw Error('须明确本轮测试名称与ANDROID_SERIAL');
const adb=process.env.ADB_PATH||`${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`,target=['-s',serial];
const command=(...args)=>execFileSync(adb,[...target,...args],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});
const asyncCommand=(...args)=>promisify(execFile)(adb,[...target,...args],{encoding:'utf8',timeout:12000,maxBuffer:4*1024*1024});
const base=`releases/investigation/native-stack-${name}-${Date.now()}`,remote=`/data/local/tmp/inkwave-boss-stack-${name}-${Date.now()}.data`;
const report={performanceTest:false,status:'waiting',seconds:3,hz:99,callgraph:'fp',maxBytes:8388608};
let ws,seq=0,tracing=false,tracedone,recordAttempted=false;const pending=new Map(),markers=[],marker='inkwave-native-stack-owner';
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+'超时'));},5000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await mkdir('releases/investigation',{recursive:true});
try{
 let ready=false;
 for(let i=0;i<240;i++){
  let r;try{r=JSON.parse(await readFile(`releases/investigation/phone-boss-${name}.json`,'utf8'));}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  if(r){
   if(r.status==='aborted'||r.appClosed)throw Error('本轮已结束或中止，不重开游戏');
   if(!r.methodProbe||r.requestedSeconds!==60||['gpuAblation','cpuAblation','uiAblation','musicAblation','pannerAblation','audioSuspend','audioGraphBypass','audioReverbBypass','domAblation','layerHints','markerVars','nativePaint'].some(k=>r[k]))throw Error('只允许无旁路的一分钟方法轮');
   const s=r.timeline.at(-1);if(s?.state==='playing'&&s.activeMs>=5000){if(s.activeMs>40000)throw Error('已经错过有界采样窗口');if(Date.now()-Date.parse(r.startedAt)>180000)throw Error('测试记录过期');ready=true;break;}
  }await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw Error('没有本轮新鲜Boss方法战斗');
 const page=(await(await fetch('http://127.0.0.1:9223/json',{signal:AbortSignal.timeout(3000)})).json()).find(p=>p.url==='https://localhost/');if(!page)throw Error('现有WebView目标缺失');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('连接超时')),5000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=reject;});
 ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.method==='Tracing.dataCollected')for(const e of v.params.value)if(e.name===marker)markers.push({pid:e.pid,tid:e.tid});if(v.method==='Tracing.tracingComplete')tracedone?.();const p=pending.get(v.id);if(p){clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);}};
 const state=await evaluate('({live:__phonePerf.match===__inkwave.match&&__inkwave.match?.boss&&__inkwave.match.state==="playing",activeMs:__phonePerf.activeMs,rayProbe:!!__phonePerf.rayQueries,source:inkwaveDiagnostics.report().current.build.sourceCommit})');
 if(!state.live||state.rayProbe||state.activeMs>40000)throw Error('实际战斗状态不满足');report.startState=state;
 await call('Tracing.start',{categories:'blink.user_timing',transferMode:'ReportEvents'});tracing=true;
 await evaluate(`performance.mark('${marker}');true`);
 const complete=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('标记Trace收尾超时')),5000);tracedone=()=>{clearTimeout(timer);resolve();};});await call('Tracing.end');await complete;tracing=false;
 const appPid=Number(command('shell','pidof','com.demoink.inkwave').trim()),forwardList=command('forward','--list'),ps=command('shell','ps','-A','-T');
 Object.assign(report,validateNativeStackTarget({serial,appPid,forwardList,markers,ps}));
 const again=await evaluate('({live:__phonePerf.match===__inkwave.match&&__inkwave.match.state==="playing",activeMs:__phonePerf.activeMs})');if(!again.live||again.activeMs>45000)throw Error('采集前已离开战斗窗口');
 recordAttempted=true;report.recordStart=Date.now();
 const record=await asyncCommand('shell','simpleperf','record','-t',String(report.rendererMainTid),'-e','cpu-clock:u','-f','99','--duration','3','--call-graph','fp','--size-limit','8M','-o',remote);report.recordEnd=Date.now();report.recordStdout=record.stdout;report.recordStderr=record.stderr;
 await asyncCommand('pull',remote,base+'.data');report.rawBytes=(await stat(base+'.data')).size;if(report.rawBytes<=0||report.rawBytes>report.maxBytes)throw Error('原生栈产物缺失或超过预算');
 const analysis=await asyncCommand('shell','simpleperf','report','-i',remote,'--sort','dso,symbol','--children','-n');await writeFile(base+'.report.txt',analysis.stdout);report.analysisStderr=analysis.stderr;report.status='collected';
}catch(error){report.status='failed';report.error=String(error);if(error.stderr)report.commandStderr=String(error.stderr).slice(0,16000);process.exitCode=1;}
finally{
 if(tracing&&ws?.readyState===WebSocket.OPEN)await call('Tracing.end').catch(()=>{});
 for(const p of pending.values())clearTimeout(p.timer);ws?.close();
 if(recordAttempted)try{command('shell','rm','-f',remote);}catch(e){report.cleanupError=String(e);}
 await writeFile(base+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({path:base+'.json',...report}));
}
