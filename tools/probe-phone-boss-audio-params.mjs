// 附着独立60秒方法调查：仅统计原AudioParam调用，全部原样转发，不消音、不去重、不另开ADB转发。
import {mkdir,writeFile} from 'node:fs/promises';
import {installBossAudioParamProbe} from './boss-audio-param-probe.mjs';
const seconds=20,path=`releases/investigation/boss-audio-params-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
const report={performanceTest:false,status:'waiting',requestedSeconds:seconds};
let ws,seq=0,installed=false;const pending=new Map();

const evaluate=expression=>new Promise((resolve,reject)=>{
 const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('音频统计CDP超时'));},15000);
 pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
});
await mkdir('releases/investigation',{recursive:true});
try{
 let page;for(let i=0;i<60;i++){try{page=(await(await fetch('http://127.0.0.1:9223/json',{signal:AbortSignal.timeout(2000)})).json()).find(p=>p.url==='https://localhost/');}catch{}if(page)break;await new Promise(r=>setTimeout(r,500));}
 if(!page)throw Error('没有现存Boss方法调查目标');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);if(v.error)p.reject(Error(JSON.stringify(v.error)));else if(v.result.exceptionDetails)p.reject(Error(JSON.stringify(v.result.exceptionDetails)));else p.resolve(v.result.result.value);};
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('音频调查连接关闭'));}pending.clear();};
 let live=false;for(let i=0;i<100;i++){const s=await evaluate('({probe:!!window.__phonePerf?.methods,live:__inkwave.match===window.__phonePerf?.match&&__inkwave.match.state==="playing",active:window.__phonePerf?.activeMs||0})');if(s.probe&&s.live&&s.active>=5000){if(s.active>30000)throw Error('方法轮剩余时间不足');report.activeStartMs=s.active;live=true;break;}await new Promise(r=>setTimeout(r,500));}
 if(!live)throw Error('未找到带探针的真实Boss战，不允许附着正式轮');
 report.before=await evaluate(`(${installBossAudioParamProbe.toString()})(__G.audio)`);installed=true;report.status='sampling';
 await new Promise(r=>setTimeout(r,seconds*1000));
 report.after=await evaluate('__bossAudioParamProbe.stop()');installed=false;
 if(report.after.active||report.after.ownershipChanged||!report.after.calls||report.after.skipped||report.after.instrumentationError)throw Error('统计不完整或调用所有权变化');
 report.status='measured';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 if(installed&&ws?.readyState===WebSocket.OPEN)report.cleanup=await evaluate('__bossAudioParamProbe?.stop()').catch(e=>({error:String(e)}));
 ws?.close();await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify({path,...report}));
}
