// 真实CSSAnimation验证：30帧采样时与原生60帧时钟同相位；有限事件与退出恢复不变。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-animation-clock-test.html','<!doctype html><meta charset="utf-8">');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/boss-animation-clock-test.html');
 const result=await page.evaluate(async()=>{
  const {createMobileBossAnimationClock:create}=await import('/src/platform/mobileBossAnimationClock.js');
  const check=(v,m)=>{if(!v)throw Error(m)},next=()=>new Promise(requestAnimationFrame);
  document.body.innerHTML=`<style>
   @keyframes clock-loop{0%{background-position:0px 0px;transform:translateX(0) rotate(-8deg);opacity:.5}50%{background-position:10px 0px;transform:translateX(20px) rotate(18deg);opacity:.9}100%{background-position:20px 0px;transform:translateX(4px) rotate(3deg);opacity:.6}}
   @keyframes gpu-loop{from{transform:translateX(0);opacity:.5}to{transform:translateX(20px);opacity:1}}
   .gpu{animation:gpu-loop 1s linear infinite}
   @keyframes clock-once{from{opacity:1}to{opacity:0}}
   .moving{width:12px;height:12px;background:red;animation:clock-loop .16s linear -.07s infinite alternate}
   .pseudo::before{content:'x';display:block;animation:clock-loop .23s ease-in-out -.11s infinite reverse}
   .paused{animation-play-state:paused}.finite{animation:clock-once .09s linear both}
  </style><div class="iw-hud is-boss" id="root"><div class="gpu" id="gpu"></div><div class="moving" id="actual"></div><div class="pseudo" id="pseudo"></div><div class="moving paused" id="hold"></div><div class="finite" id="once"></div></div>
  <div class="moving" id="reference"></div><div class="pseudo" id="pseudo-reference"></div>`;
  const $=id=>document.getElementById(id),game={settings:{fpsCap:30},match:{boss:{},attract:false,state:'playing',paused:false}};
  globalThis.inkwaveMobile={};let ended=0;$('once').addEventListener('animationend',()=>ended++);
  await next();await next();
  const a=$('actual').getAnimations()[0],b=$('reference').getAnimations()[0],p=$('pseudo').getAnimations({subtree:true})[0],q=$('pseudo-reference').getAnimations({subtree:true})[0],hold=$('hold').getAnimations()[0];
  await Promise.all([a,b,p,q].map(x=>x.ready));await next();
  b.startTime=a.startTime;q.startTime=p.startTime;const pStart=p.startTime;
  const clock=create();clock.update(game,'match',false);check(clock.info().tracked===2,'无限动画捕获不符 '+JSON.stringify({info:clock.info(),all:$('root').getAnimations({subtree:true}).map(x=>({name:x.animationName,target:x.effect.target?.id,pseudo:x.effect.pseudoElement,state:x.playState,pending:x.pending,start:x.startTime,current:x.currentTime,iterations:x.effect.getTiming().iterations}))}));
  check(hold.playState==='paused','外部暂停被覆盖');
  check($('gpu').getAnimations()[0].playState==='running','纯合成动画不应转回主线程');
  let last=a.currentTime,samples=0,maxProgressError=0;
  for(let i=0;i<24;i++){
   await next();
   if(i%2===0){clock.update(game,'match',false);for(const [x,y]of [[a,b],[p,q]]){
    const e=Math.abs(x.effect.getComputedTiming().progress-y.effect.getComputedTiming().progress);maxProgressError=Math.max(maxProgressError,e);check(e<1e-8,'采样相位与原时钟不一致');}
    check(getComputedStyle($('actual')).transform===getComputedStyle($('reference')).transform,'关键帧姿态不同');last=a.currentTime;samples++;
   }else check(a.currentTime===last,'未采样帧仍在推进受控动画');
  }
  check(ended===1,'有限animationend丢失或重复');
  $('actual').remove();await next();clock.update(game,'match',false);check(a.playState==='idle'&&clock.info().tracked===1,'移除动画被复活或未释放');
  const late=document.createElement('div');late.className='moving';$('root').append(late);const lateAnimation=late.getAnimations()[0];await lateAnimation.ready;await next();clock.update(game,'match',false);
  check(clock.info().tracked===2&&late.getAnimations()[0].playState==='paused','动态animationstart未捕获');
  const canceled=document.createElement('div');canceled.className='moving';$('root').append(canceled);const canceledAnimation=canceled.getAnimations()[0];canceled.dispatchEvent(new AnimationEvent('animationstart',{bubbles:true}));canceled.remove();await next();await next();
  check(canceledAnimation.playState==='idle'&&clock.info().pending===0,'取消的pending动画被复活或死循环');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),circle=document.createElementNS(svg.namespaceURI,'circle');circle.classList.add('gpu');svg.append(circle);$('root').append(svg);const svgAnimation=circle.getAnimations()[0];await svgAnimation.ready;await next();clock.update(game,'match',false);
  check(svgAnimation.playState==='paused','SVG内部动画未采样');svg.remove();await next();clock.update(game,'match',false);
  $('root').classList.remove('is-boss');clock.update(game,'menu',false);await next();
  check(!clock.info().active&&!clock.info().tracked&&p.playState==='running'&&p.startTime===pStart,'退出后原时钟或startTime未恢复');
  check(hold.playState==='paused','退出误恢复原本暂停的动画');
  $('root').classList.add('is-boss');
  for(const [label,change,mode,suspended] of [
   ['PC',()=>globalThis.inkwaveMobile=false,'match',false],['普通',g=>g.match.boss=null,'match',false],['演示',g=>g.match.attract=true,'match',false],
   ['菜单',()=>{},'menu',false],['开场',g=>g.match.state='intro','match',false],['暂停',g=>g.match.paused=true,'match',false],['后台',()=>{},'match',true],['其他帧率',g=>g.settings.fpsCap=120,'match',false]]){
   const g={settings:{fpsCap:30},match:{boss:{},state:'playing',paused:false}};globalThis.inkwaveMobile={};change(g);const c=create();c.update(g,mode,suspended);check(!c.info().active&&!c.info().tracked,label+'越界');c.dispose();
  }
  globalThis.inkwaveMobile={};clock.update(game,'match',false);check(clock.info().tracked===2,'重新进入未捕获');clock.suspend();await next();check(!clock.info().active&&p.playState==='running','suspend未恢复');
  clock.update(game,'match',false);clock.dispose();await next();check(!clock.info().tracked&&p.playState==='running','dispose未恢复');
  const after=document.createElement('div');after.className='moving';$('root').append(after);await next();await next();check(after.getAnimations()[0].playState==='running','dispose后监听未解除');
  const original=globalThis.CSSAnimation;globalThis.CSSAnimation=undefined;const unsupported=create();unsupported.update(game,'match',false);check(!unsupported.info().supported&&!unsupported.info().active,'无API未回退');unsupported.dispose();globalThis.CSSAnimation=original;
  return {samples,maxProgressError,finiteEnds:ended,stats:clock.info(),checks:'真实无限动画/伪元素同相位/未采样帧不推进/有限事件/负延迟和alternate/reverse/动态添加移除/退出恢复startTime/外部暂停/PC普通开场暂停隔离/再次进入/销毁/API回退通过'};
 });
 await writeFile('releases/investigation/mobile-boss-animation-clock-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
