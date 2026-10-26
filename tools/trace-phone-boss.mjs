// 附着已有的一分钟调查轮，采集12秒浏览器时间线；不启动另一局、不改游戏状态。
// 只能配合BOSS_METHOD_PROBE=1，Trace本身有开销，禁止当正式FPS成绩。
import {mkdir,writeFile} from 'node:fs/promises';
let ws,seq=0,tracing=false,complete;
const pending=new Map(),events=[];
const report={status:'waiting',eventsTruncated:false,performanceTest:false};
const base=`releases/investigation/boss-trace-${new Date().toISOString().replace(/[:.]/g,'-')}`;
const call=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method}超时`))},20000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await mkdir('releases/investigation',{recursive:true});
try {
 let page;
 for(let i=0;i<60;i++){
  try{page=(await(await fetch('http://127.0.0.1:9223/json',{signal:AbortSignal.timeout(2000)})).json()).find(p=>p.url==='https://localhost/');}catch{}
  if(page)break;await new Promise(r=>setTimeout(r,500));
 }
 if(!page)throw Error('未找到Boss调查轮的USB调试目标');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 ws.onmessage=e=>{
  const v=JSON.parse(e.data);
  if(v.id){const p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);}
  else if(v.method==='Tracing.dataCollected'){
   // 仅保留元数据与至少0.1ms的完整事件，避免细碎事件先占满上限而丢掉后半段。
   for(const item of v.params.value){if(item.ph!=='M'&&(item.ph!=='X'||!(item.dur>=100)))continue;if(events.length<80000)events.push(item);else report.eventsTruncated=true;}
  }else if(v.method==='Tracing.tracingComplete')complete?.();
 };
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('调试目标关闭'))}pending.clear()};
 let ready=false;
 for(let i=0;i<100;i++){
  const state=await evaluate('({probe:!!window.__phonePerf?.methods,live:window.__phonePerf?.match===window.__inkwave?.match&&__inkwave.match?.state==="playing",active:window.__phonePerf?.activeMs||0})');
  if(state.probe&&state.live){if(state.active>40000)throw Error('调查轮剩余时间不足');ready=true;break;}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw Error('没有运行带探针的Boss实战');
 await call('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,gpu',transferMode:'ReportEvents'});tracing=true;
 await new Promise(r=>setTimeout(r,12000));
 const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Trace结束超时')),15000);complete=()=>{clearTimeout(timer);resolve()}});
 await call('Tracing.end');await done;tracing=false;
 report.status='collected';
 const byName=new Map();
 for(const e of events){if(e.ph!=='X'||!Number.isFinite(e.dur))continue;const key=`${e.pid}/${e.tid}/${e.name}`,v=byName.get(key)||{pid:e.pid,tid:e.tid,name:e.name,count:0,totalMs:0,maxMs:0};v.count++;v.totalMs+=e.dur/1000;v.maxMs=Math.max(v.maxMs,e.dur/1000);byName.set(key,v)}
 report.top=[...byName.values()].sort((a,b)=>b.totalMs-a.totalMs).slice(0,50);
 report.longEvents=events.filter(e=>e.ph==='X'&&e.dur>=50000).map(e=>({pid:e.pid,tid:e.tid,name:e.name,ms:e.dur/1000,ts:e.ts,args:e.args})).slice(0,100);
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 if(tracing&&ws?.readyState===WebSocket.OPEN)await call('Tracing.end').catch(()=>{});
 ws?.close();
 await writeFile(`${base}.json`,JSON.stringify({report,traceEvents:events}));
 console.log(JSON.stringify({path:`${base}.json`,...report}));
}
