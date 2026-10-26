// 附着已有的一分钟调查轮，采集12秒浏览器时间线；不启动另一局、不改游戏状态。
// 只能配合BOSS_METHOD_PROBE=1，Trace本身有开销，禁止当正式FPS成绩。
import {mkdir,writeFile} from 'node:fs/promises';
import {createTraceEventCollector} from './trace-event-collector.mjs';
import {readCdpTraceStream} from './read-cdp-trace-stream.mjs';
let ws,seq=0,tracing=false,ending=false,complete,streamHandle;
const rendering=process.env.BOSS_TRACE_RENDERING==='1';
const pending=new Map(),collector=createTraceEventCollector({limit:rendering?200000:80000,minUs:rendering?50:100}),events=collector.events;
const seconds=Number(process.env.BOSS_TRACE_SECONDS||12);
if(!Number.isFinite(seconds)||seconds<1||seconds>45)throw Error('BOSS_TRACE_SECONDS须为1～45');
const report={status:'waiting',requestedSeconds:seconds,renderingProbe:rendering,eventsTruncated:false,performanceTest:false};
const base=`releases/investigation/boss-trace-${new Date().toISOString().replace(/[:.]/g,'-')}`;
const call=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method}超时`))},method==='Tracing.end'?60000:20000);
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
   collector.add(v.params.value);
  }else if(v.method==='Tracing.bufferUsage')report.maxBufferUsage=Math.max(report.maxBufferUsage||0,v.params.percentFull||0);
  else if(v.method==='Tracing.tracingComplete'){report.dataLossOccurred=v.params?.dataLossOccurred??null;streamHandle=v.params?.stream;complete?.();}
 };
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('调试目标关闭'))}pending.clear()};
 let ready=false;
 for(let i=0;i<100;i++){
  const state=await evaluate('({probe:!!window.__phonePerf?.methods,live:!!window.__phonePerf?.match&&window.__phonePerf.match===window.__inkwave?.match&&window.__inkwave?.match?.state==="playing",active:window.__phonePerf?.activeMs||0})');
  if(state.probe&&state.live){if(state.active>(55-seconds)*1000)throw Error('调查轮剩余时间不足');ready=true;break;}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw Error('没有运行带探针的Boss实战');
 const available=(await call('Tracing.getCategories')).categories;
 report.availableRenderingCategories=available.filter(c=>/gpu|skia|viz|^cc/.test(c));
 const categories=['devtools.timeline','disabled-by-default-devtools.timeline','blink.user_timing','v8','gpu'];
 if(rendering)for(const name of ['cc','viz','skia','disabled-by-default-skia','disabled-by-default-skia.gpu'])if(available.includes(name))categories.push(name);
 report.categories=categories;
 const params={categories:categories.join(','),options:'record-continuously',bufferUsageReportingInterval:1000,transferMode:rendering?'ReturnAsStream':'ReportEvents'};
 if(rendering){
  try{const schema=await(await fetch('http://127.0.0.1:9223/json/protocol',{signal:AbortSignal.timeout(3000)})).json();
   report.bufferConfigSupported=!!schema.domains.find(d=>d.domain==='Tracing')?.types?.find(t=>t.id==='TraceConfig')?.properties?.some(p=>p.name==='traceBufferSizeInKb');
  }catch(error){report.protocolSchemaError=String(error);}
  if(report.bufferConfigSupported){delete params.categories;delete params.options;params.traceConfig={recordMode:'recordContinuously',traceBufferSizeInKb:65536,includedCategories:categories};}
  await evaluate('window.__inkwaveRenderTrace={pending:true,startedAt:Date.now()};true');
 }
 report.transferMode=params.transferMode;
 await call('Tracing.start',params);tracing=true;
 await evaluate('performance.mark("inkwave-render-start");true');
 await new Promise(r=>setTimeout(r,seconds*1000));
 const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Trace结束超时')),60000);complete=()=>{clearTimeout(timer);resolve()}});
 await evaluate('performance.mark("inkwave-render-end");true');
 ending=true;await Promise.all([call('Tracing.end'),done]);tracing=false;
 if(rendering){if(!streamHandle)throw Error('Trace未返回流句柄');const raw=await readCdpTraceStream(call,streamHandle);streamHandle=null;report.streamBytes=raw.bytes;const parsed=JSON.parse(raw.data.toString('utf8'));const items=parsed.traceEvents||parsed;if(!Array.isArray(items))throw Error('Trace流格式无效');collector.add(items);}
 Object.assign(report,collector.info());
 report.markers=events.filter(e=>e.name?.startsWith('inkwave-render-')).map(e=>({name:e.name,pid:e.pid,tid:e.tid,ts:e.ts}));
 report.status='collected';
 const byName=new Map();
 for(const e of events){if(e.ph!=='X'||!Number.isFinite(e.dur))continue;const key=`${e.pid}/${e.tid}/${e.name}`,v=byName.get(key)||{pid:e.pid,tid:e.tid,name:e.name,count:0,totalMs:0,maxMs:0};v.count++;v.totalMs+=e.dur/1000;v.maxMs=Math.max(v.maxMs,e.dur/1000);byName.set(key,v)}
 report.top=[...byName.values()].sort((a,b)=>b.totalMs-a.totalMs).slice(0,50);
 report.longEvents=events.filter(e=>e.ph==='X'&&e.dur>=50000).map(e=>({pid:e.pid,tid:e.tid,name:e.name,ms:e.dur/1000,ts:e.ts,args:e.args})).slice(0,100);
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 if(tracing&&!ending&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:++seq,method:'Tracing.end'}));
 if(rendering&&ws?.readyState===WebSocket.OPEN)await evaluate('if(window.__inkwaveRenderTrace)__inkwaveRenderTrace.pending=false;true').catch(()=>{});
 ws?.close();
 Object.assign(report,collector.info());
 await writeFile(`${base}.json`,JSON.stringify({report,traceEvents:events}));
 console.log(JSON.stringify({path:`${base}.json`,...report}));
}
