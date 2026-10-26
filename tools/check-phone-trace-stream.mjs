// 仅在菜单验证手机CDP流式导出；不进入Boss、不统计性能、不读取/json/protocol。
import {androidCDP} from './android-cdp.mjs';
import {readCdpTraceStream} from './read-cdp-trace-stream.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const adb=process.env.ADB_PATH||`${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`;
const target=process.env.ANDROID_SERIAL?['-s',process.env.ANDROID_SERIAL]:['-d'];
const command=(...args)=>execFileSync(adb,[...target,...args],{encoding:'utf8',timeout:15000});
const report={performanceTest:false,protocolQuerySkipped:true};
let c,ws,id=0,complete,recording=false;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(`${method}超时`));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
try{
 command('shell','am','start','-n','com.demoink.inkwave/.MainActivity');
 c=await androidCDP();report.pidBefore=command('shell','pidof','com.demoink.inkwave').trim();
 const page=(await(await fetch('http://127.0.0.1:9223/json',{signal:AbortSignal.timeout(3000)})).json()).find(t=>t.url==='https://localhost/');
 if(!page)throw Error('菜单WebView尚未出现');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(!p)return;pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);}else if(v.method==='Tracing.tracingComplete')complete?.(v.params);};
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('WebView已关闭'));}pending.clear();};
 await call('Tracing.start',{categories:'blink.user_timing',transferMode:'ReturnAsStream'});recording=true;
 await c.evaluate('performance.mark("inkwave-stream-smoke");true');
 await new Promise(r=>setTimeout(r,1000));
 let timer;const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Trace结束超时')),30000);complete=resolve;});
 let result;try{[,result]=await Promise.all([call('Tracing.end'),done]);recording=false;}finally{clearTimeout(timer);}
 if(!result.stream)throw Error('手机未返回Trace流');
 const raw=await readCdpTraceStream(call,result.stream,16*1024*1024),events=JSON.parse(raw.data.toString('utf8')).traceEvents;
 report.streamBytes=raw.bytes;report.dataLossOccurred=result.dataLossOccurred??null;
 report.markerFound=events.some(e=>e.name==='inkwave-stream-smoke');
 report.pidAfter=command('shell','pidof','com.demoink.inkwave').trim();
 if(!report.markerFound||report.pidBefore!==report.pidAfter||report.dataLossOccurred===true)throw Error('流式采集校验失败');
 report.ok=true;
}catch(error){report.ok=false;report.error=String(error);process.exitCode=1;}
finally{
 if(recording&&ws?.readyState===WebSocket.OPEN)await call('Tracing.end').catch(()=>{});
 ws?.close();c?.close();
 command('shell','am','force-stop','com.demoink.inkwave');
 try{report.appClosed=!command('shell','pidof','com.demoink.inkwave').trim();}catch{report.appClosed=true;}
 await mkdir('releases/investigation',{recursive:true});
 await writeFile('releases/investigation/phone-trace-stream-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
