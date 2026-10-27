// 附着已有的一分钟调查轮，采集12秒浏览器时间线；不启动另一局、不改游戏状态。
// 只能配合BOSS_METHOD_PROBE=1，Trace本身有开销，禁止当正式FPS成绩。
import {mkdir,writeFile} from 'node:fs/promises';
import {createTraceEventCollector} from './trace-event-collector.mjs';
import {readCdpTraceStream} from './read-cdp-trace-stream.mjs';
let ws,seq=0,tracing=false,ending=false,complete,streamHandle,layerTreeEnabled=false,layers=[];
const rendering=process.env.BOSS_TRACE_RENDERING==='1';
const mainStages=process.env.BOSS_TRACE_MAIN_STAGES==='1',invalidations=process.env.BOSS_TRACE_INVALIDATIONS==='1';
const streamed=rendering||mainStages;
const instantNames=invalidations?['StyleRecalcInvalidationTracking','StyleInvalidatorInvalidationTracking','ScheduleStyleInvalidationTracking','LayoutInvalidationTracking','PaintInvalidationTracking']:[];
const pending=new Map(),collector=createTraceEventCollector({limit:streamed?200000:80000,minUs:streamed?50:100,instantNames}),events=collector.events;
let nodeMap=[];
const seconds=Number(process.env.BOSS_TRACE_SECONDS||12);
const startSeconds=Number(process.env.BOSS_TRACE_START_SECONDS||0);
const stylePhase=process.env.BOSS_TRACE_STYLE_PHASE||'';
const markerImagePhase=process.env.BOSS_TRACE_MARKER_IMAGE_PHASE||'';
if(markerImagePhase&&!['original','cached','restored'].includes(markerImagePhase))throw Error('图标阶段无效');
const checkMarkerImages=(state,boundary)=>{
 if(!markerImagePhase)return;
 const [min,max]=({original:[5000,14500],cached:[16000,29000],restored:[31000,49000]})[markerImagePhase],s=state.markerImages;
 if(!s||!s.icons||s.images!==(markerImagePhase==='cached')||s.imageNodes!==(s.images?s.icons:0)||state.activeMs<min||state.activeMs>max)throw Error(`${boundary}未处于${markerImagePhase}图标安全窗口`);
};
if(stylePhase&&!['original','removed','restored'].includes(stylePhase))throw Error('样式阶段无效');
const checkStylePhase=(state,boundary)=>{
 if(!stylePhase)return;
 const [min,max]=({original:[5000,14500],removed:[16000,29000],restored:[31000,49000]})[stylePhase],s=state.styleSelector;
 if(!s||s.removed!==(stylePhase==='removed')||s.matches!==0||state.activeMs<min||state.activeMs>max)throw Error(`${boundary}未处于${stylePhase}安全窗口`);
};
if(!Number.isFinite(startSeconds)||startSeconds<0||startSeconds+seconds>50)throw Error('Trace起点须非负且结束不晚于50秒');
if(!Number.isFinite(seconds)||seconds<1||seconds>45)throw Error('BOSS_TRACE_SECONDS须为1～45');
if((mainStages&&(seconds>3||rendering))||(invalidations&&(!mainStages||seconds!==1||rendering)))throw Error('主阶段最多3秒，样式失效仅独立主阶段1秒');
const report={status:'waiting',requestedSeconds:seconds,renderingProbe:rendering,mainStagesProbe:mainStages,invalidationsProbe:invalidations,eventsTruncated:false,performanceTest:false};
const base=`releases/investigation/boss-trace-${new Date().toISOString().replace(/[:.]/g,'-')}`;
const call=(method,params={})=>new Promise((resolve,reject)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method}超时`))},method==='Tracing.end'?60000:20000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
// 在采集边界外批量定位少量标签，避免用几分钟后的图层ID猜测归属。
const snapshot=async()=>{
 const state=await evaluate('({activeMs:__phonePerf.activeMs,alive:__inkwave.match?.local?.alive,actors:__inkwave.match?.actors?.length,phase:__phonePerf.layerProbe?.phase,calls:__G.renderer.info.render.calls,triangles:__G.renderer.info.render.triangles})');
 if(!layerTreeEnabled)return {state};
 const root=(await call('DOM.getDocument',{depth:0})).root.nodeId;
 const nodes=(await call('DOM.querySelectorAll',{nodeId:root,selector:'.iw-hud.is-boss .iw-mk__tag,.iw-hud.is-boss .iw-sp__ring'})).nodeIds.slice(0,8);
 const mapping=[];for(const nodeId of nodes){const n=(await call('DOM.describeNode',{nodeId,depth:0})).node,attrs=n.attributes||[],cls=attrs[attrs.indexOf('class')+1];mapping.push({backendNodeId:n.backendNodeId,classes:cls,layers:layers.filter(l=>l.backendNodeId===n.backendNodeId)});}
 return {state,mapping};
};
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
  if(v.method==='LayerTree.layerTreeDidChange')layers=v.params.layers||[];
  if(v.id){const p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);}
  else if(v.method==='Tracing.dataCollected'){
   collector.add(v.params.value);
  }else if(v.method==='Tracing.bufferUsage')report.maxBufferUsage=Math.max(report.maxBufferUsage||0,v.params.percentFull||0);
  else if(v.method==='Tracing.tracingComplete'){report.dataLossOccurred=v.params?.dataLossOccurred??null;streamHandle=v.params?.stream;complete?.();}
 };
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('调试目标关闭'))}pending.clear()};
 let ready=false;
 for(let i=0;i<200;i++){
  const state=await evaluate('({probe:!!window.__phonePerf?.methods,live:!!window.__phonePerf?.match&&window.__phonePerf.match===window.__inkwave?.match&&window.__inkwave?.match?.state==="playing",active:window.__phonePerf?.activeMs||0})');
  if(state.probe&&state.live&&state.active>=startSeconds*1000){if(state.active>(55-seconds)*1000)throw Error('调查轮剩余时间不足');ready=true;break;}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw Error('没有运行带探针的Boss实战');
 const available=(await call('Tracing.getCategories')).categories;
 report.availableRenderingCategories=available.filter(c=>/gpu|skia|viz|^cc/.test(c));
 if(mainStages)report.availableMainCategories=available.filter(c=>/blink|invalidation|animation/.test(c));
 // 详细Skia逐命令事件12秒超过256MiB；先定位合成/栅格阶段，不能一次开启所有细类。
 const categories=rendering?['blink.user_timing','gpu']:['devtools.timeline','disabled-by-default-devtools.timeline','blink.user_timing','v8','gpu'];
 if(rendering)for(const name of ['cc','viz','skia'])if(available.includes(name))categories.push(name);
 if(mainStages)for(const name of ['cc','blink'])if(available.includes(name))categories.push(name);
 if(invalidations){const category='disabled-by-default-devtools.timeline.invalidationTracking';if(!available.includes(category))throw Error('当前WebView未提供失效跟踪类别');categories.push(category);}
 report.categories=categories;
 const params={categories:categories.join(','),options:'record-continuously',bufferUsageReportingInterval:1000,transferMode:streamed?'ReturnAsStream':'ReportEvents'};
 if(streamed){
  // 当前WebView访问/json/protocol时出现原生NOTREACHED/SIGTRAP；只用已验证的CDP方法。
  report.protocolQuerySkipped=true;
  await evaluate('window.__inkwaveRenderTrace={pending:true,startedAt:Date.now()};true');
 }
 report.transferMode=params.transferMode;
 if(rendering){try{await call('LayerTree.enable');layerTreeEnabled=true;}catch(error){report.layerMappingError=String(error);}}
 report.before=await snapshot();
 await call('Tracing.start',params);tracing=true;
 report.startState=await evaluate('(()=>{performance.mark("inkwave-render-start");return{frameNumber:__inkwave._frameN,activeMs:__phonePerf.activeMs,alive:__inkwave.match?.local?.alive,calls:__G.renderer.info.render.calls,triangles:__G.renderer.info.render.triangles,markerPhase:__phonePerf.markerVarProbe?.phase,nativePaintPhase:__phonePerf.nativePaintProbe?.phase,styleSelector:window.__bossStyleSelectorProbe?.snapshot(),markerImages:window.__bossMarkerImages?.snapshot()}})()');
 await new Promise(r=>setTimeout(r,seconds*1000));
 const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Trace结束超时')),60000);complete=()=>{clearTimeout(timer);resolve()}});
 report.endState=await evaluate('(()=>{performance.mark("inkwave-render-end");return{frameNumber:__inkwave._frameN,activeMs:__phonePerf.activeMs,alive:__inkwave.match?.local?.alive,calls:__G.renderer.info.render.calls,triangles:__G.renderer.info.render.triangles,markerPhase:__phonePerf.markerVarProbe?.phase,nativePaintPhase:__phonePerf.nativePaintProbe?.phase,styleSelector:window.__bossStyleSelectorProbe?.snapshot(),markerImages:window.__bossMarkerImages?.snapshot()}})()');
 ending=true;await Promise.all([call('Tracing.end'),done]);tracing=false;
 report.after=await snapshot();
 if(streamed){if(!streamHandle)throw Error('Trace未返回流句柄');const raw=await readCdpTraceStream(call,streamHandle);streamHandle=null;report.streamBytes=raw.bytes;const parsed=JSON.parse(raw.data.toString('utf8'));const items=parsed.traceEvents||parsed;if(!Array.isArray(items))throw Error('Trace流格式无效');collector.add(items);}
 if(invalidations){
  const root=(await call('DOM.getDocument',{depth:-1,pierce:true})).root;
  const walk=n=>{const a=n.attributes||[],label=n.nodeName+(a.includes('id')?'#'+a[a.indexOf('id')+1]:'')+(a.includes('class')?'.'+a[a.indexOf('class')+1].trim().replace(/\s+/g,'.'):'');nodeMap.push({nodeId:n.nodeId,backendNodeId:n.backendNodeId,label});for(const c of n.children||[])walk(c);for(const c of n.shadowRoots||[])walk(c);if(n.contentDocument)walk(n.contentDocument);};walk(root);report.nodeMapCount=nodeMap.length;
 }
 checkStylePhase(report.startState,'开始');checkStylePhase(report.endState,'结束');
 if(stylePhase)report.stylePhase=stylePhase;
 checkMarkerImages(report.startState,'开始');checkMarkerImages(report.endState,'结束');if(markerImagePhase)report.markerImagePhase=markerImagePhase;
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
 if(streamed&&ws?.readyState===WebSocket.OPEN)await evaluate('if(window.__inkwaveRenderTrace)__inkwaveRenderTrace.pending=false;true').catch(()=>{});
 if(layerTreeEnabled&&ws?.readyState===WebSocket.OPEN)await call('LayerTree.disable').catch(()=>{});
 ws?.close();
 Object.assign(report,collector.info());
 await writeFile(`${base}.json`,JSON.stringify({report,traceEvents:events,nodeMap}));
 console.log(JSON.stringify({path:`${base}.json`,...report}));
}
