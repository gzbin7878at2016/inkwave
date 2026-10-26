// 真实CSSAnimation边界：原生全局steps保留关键帧曲线、时间轴；忽略有限及纯transform动画。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/native-paint.html','<!doctype html>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{const p=await browser.newPage();await p.goto('http://localhost:8490/releases/investigation/native-paint.html');console.log(JSON.stringify(await p.evaluate(async()=>{
 const{createBossNativePaintProbe:create}=await import('/tools/boss-native-paint-probe.mjs');
 document.body.innerHTML='<style>@keyframes glow{50%{box-shadow:0 0 10px red}}@keyframes move{50%{transform:translateX(10px)}}.glow{animation:glow 1s ease-in-out infinite}.finite{animation:glow 1s ease-in-out}.move{animation:move 1s linear infinite}</style><div id="root"><i class="glow"></i><i class="finite"></i><i class="move"></i></div>';
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const root=document.querySelector('#root'),animations=[...root.children].map(el=>el.getAnimations()[0]),a=animations[0],keys=JSON.stringify(a.effect.getKeyframes()),time=a.currentTime,m={boss:{},state:'playing'},probe=create({el:root}),check=(v,s)=>{if(!v)throw Error(s);};
 probe.update(m,'match',14999);check(a.effect.getTiming().easing==='linear','提前启用');probe.update(m,'match',15000);
 check(a.effect.getTiming().easing.startsWith('steps(15')&&animations[1].effect.getTiming().easing==='linear'&&animations[2].effect.getTiming().easing==='linear','选择范围错误');
 check(JSON.stringify(a.effect.getKeyframes())===keys&&a.currentTime===time&&a.playState==='running','曲线/时钟/播放状态改变');
 probe.update(m,'match',45000);check(a.effect.getTiming().easing==='linear','45秒未恢复');
 const later=document.createElement('i');later.className='glow';root.append(later);probe.update(m,'match',20000);await new Promise(r=>setTimeout(r,60));check(later.getAnimations()[0].effect.getTiming().easing.startsWith('steps(15'),'动态动画未接管');
 probe.update({...m,paused:true},'match',20000);check(later.getAnimations()[0].effect.getTiming().easing==='linear','暂停未恢复');probe.update(m,'match',21000);check(a.effect.getTiming().easing.startsWith('steps(15'),'恢复后旧动画未重新接管');probe.dispose();
 check(!probe.info().active&&!probe.info().errors,'清理错误');return{nativeSteps:true,keyframeCurveUnchanged:true,timelineUnchanged:true,selectionAndCleanup:true,adopted:probe.info().adopted};
})));}finally{await browser.close();}
