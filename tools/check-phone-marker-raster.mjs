// 使用APK已有最小诊断页与原CSS，截取标签在不同缩放下的提示/无提示像素；非Boss性能成绩。
import {androidCDP} from './android-cdp.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const adb=process.env.ADB_PATH||`${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`,target=process.env.ANDROID_SERIAL?['-s',process.env.ANDROID_SERIAL]:['-d'];
const command=(...args)=>execFileSync(adb,[...target,...args],{encoding:'utf8',timeout:15000});
let c,ws,id=0;const pending=new Map(),report={performanceTest:false,samples:[]},base='releases/investigation/marker-raster';
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(method+'超时'));},10000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
try{
 command('shell','am','start','-n','com.demoink.inkwave/.MainActivity','--ez','inkwave.graphicsProbe','true');c=await androidCDP();
 const p=(await(await fetch('http://127.0.0.1:9223/json')).json()).find(p=>p.url==='https://localhost/'||p.title==='最小图形诊断');
 ws=new WebSocket(p.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
 await c.evaluate(`(async()=>{document.head.innerHTML='<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://localhost/styles/ui.css">';document.body.innerHTML='<div class="iw-hud is-boss"><div class="iw-mk" style="transform:translate3d(180px,150px,0);--c:#10d2e6;--c-ink:#15121c;--far:1"><span class="iw-mk__tag"><i class="iw-mk__w"></i><b>队友 · Inkling 123</b></span></div></div>';document.body.style.background='#333';await new Promise(r=>setTimeout(r,500));await document.fonts.ready;const{weaponIcon}=await import('https://localhost/src/ui/ui-icons.js');document.querySelector('.iw-mk__w').innerHTML=weaponIcon('shooter');return{dpr:devicePixelRatio,viewport:[innerWidth,innerHeight]}})()`).then(v=>report.device=v);
 await mkdir(base,{recursive:true});
 // 第一帧以最远标签栅格化，再逐渐放大，特别检查缓存旧栅格是否造成近处文字模糊。
 for(const [name,far,hint] of [['far-original',1,false],['far-hinted',1,true],['mid-hinted',.5,true],['mid-original',.5,false],['far-prime',1,true],['near-hinted',0,true],['near-original',0,false]]){
  const state=await c.evaluate(`(async()=>{const m=document.querySelector('.iw-mk'),t=m.firstElementChild;m.style.setProperty('--far',${far});t.style.willChange=${JSON.stringify(hint?'transform,scale':'auto')};await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await new Promise(r=>setTimeout(r,100));return{scale:getComputedStyle(t).scale,willChange:getComputedStyle(t).willChange,width:t.offsetWidth,height:t.offsetHeight}})()`);
  const {data}=await call('Page.captureScreenshot',{format:'png',clip:{x:70,y:100,width:220,height:80,scale:1}});await writeFile(`${base}/${name}.png`,Buffer.from(data,'base64'));report.samples.push({name,far,hint,...state});
 }
 report.ok=true;
}catch(error){report.ok=false;report.error=String(error);process.exitCode=1;}
finally{ws?.close();c?.close();command('shell','am','force-stop','com.demoink.inkwave');try{report.appClosed=!command('shell','pidof','com.demoink.inkwave').trim();}catch{report.appClosed=true;}await mkdir(base,{recursive:true});await writeFile(`${base}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
