// 真实HUD状态迁移：就绪→消耗/阵亡/空槽不遗留循环，重获就绪仍播放原反馈；不拿桌面计数当手机FPS。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-ready-state.html','<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><link rel="stylesheet" href="/styles/ui.css"><link rel="stylesheet" href="/styles/mobile.css"><div id="ui-root"></div>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 await page.goto('http://localhost:8490/releases/investigation/boss-ready-state.html');
 const report=await page.evaluate(async()=>{
  const {HUD}=await import('/src/ui/hud.js'),{G}=await import('/src/core/ctx.js');
  const check=(ok,msg)=>{if(!ok)throw Error(msg)},raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const cases=[];
  for(const kind of ['mobileBoss','PC','ordinary','attract','menu']){
   globalThis.inkwaveMobile=kind!=='PC';document.documentElement.classList.toggle('iw-mobile',kind!=='PC');
   G.mode=kind==='menu'?'menu':'match';G.match={boss:kind==='ordinary'?null:{},attract:kind==='attract'};
   const hud=new HUD(document.getElementById('ui-root'));hud.el.classList.remove('is-hidden');hud.boss.setMode(true);
   const teams=(ready,alive=true)=>[0,1].map(t=>({players:[0,1,2,3].map(i=>({alive,specialReady:ready,weapon:'shooter',isSelf:t===0&&i===0,respawn:3}))}));
   const slots=[...hud.el.querySelectorAll('.iw-sq')],badge=slots[0].querySelector('.iw-sq__badge');
   const names=()=>slots.map(s=>getComputedStyle(s.querySelector('.iw-sq__badge')).animationName);
   const expectClear=kind==='mobileBoss';
   hud._updSquads(teams(true));await raf();
   check(slots.every(e=>e.classList.contains('is-ready')&&e.classList.contains('is-readyflash')),kind+'首次就绪类缺失');
   check(names().every(n=>n==='iw-sq-readyflash, iw-sq-glow'),kind+'真正就绪反馈被改');
   const readyNames=names();
   hud._updSquads(teams(false));await raf();
   check(slots.every(e=>!e.classList.contains('is-ready')),kind+'消耗后仍就绪');
   const spentNames=names();
   check(spentNames.every(n=>expectClear?n==='none':n==='iw-sq-readyflash, iw-sq-glow'),kind+'消耗清理/隔离失败');
   hud._updSquads(teams(true));await raf();
   const flash=badge.getAnimations().find(a=>a.animationName==='iw-sq-readyflash');
   check(flash&&flash.currentTime<=80&&getComputedStyle(badge).animationDuration==='0.6s, 1.1s',kind+'再次就绪没有原时长首次闪光');
   const observer=new MutationObserver(()=>{});observer.observe(hud.el,{subtree:true,attributes:true,childList:true});
   for(let i=0;i<120;i++)hud._updSquads(teams(true));
   check(observer.takeRecords().length===0,kind+'同状态仍反复修改DOM');observer.disconnect();
   hud._updSquads(teams(true,false));await raf();
   check(slots.every(e=>e.classList.contains('is-dead')&&!e.classList.contains('is-ready')),kind+'死亡状态错误');
   const deadNames=names();
   check(deadNames.every(n=>expectClear?n==='none':n==='iw-sq-readyflash, iw-sq-glow'),kind+'死亡清理/隔离失败');
   hud._updSquads(teams(false));await raf();
   check(slots.every(e=>!e.classList.contains('is-dead')&&!e.classList.contains('is-dying')),kind+'复活反馈未恢复');
   hud._updSquads(teams(true));await raf();hud._updSquads([]);await raf();
   const emptyNames=names();
   check(slots.every(e=>e.classList.contains('is-empty')),kind+'空槽状态错误');
   check(emptyNames.every(n=>expectClear?n==='none':n==='iw-sq-readyflash, iw-sq-glow'),kind+'空槽清理/隔离失败');
   if(expectClear)check(slots.every(e=>!e.classList.contains('is-readyflash')&&!e.classList.contains('is-ready')),kind+'空槽仍有就绪类');
   hud._updSquads(teams(true));await raf();check(names().every(n=>n==='iw-sq-readyflash, iw-sq-glow'),kind+'空槽重入丢反馈');
   cases.push({kind,readyNames,spentNames,deadNames,emptyNames,stableDomWrites:0});hud.dispose();
  }
  return {cases,checks:'真实8槽就绪/消耗/再次就绪/死亡/复活/空槽/重入、同状态零写入，PC普通演示菜单原路径保留'};
 });
 await writeFile('releases/investigation/mobile-boss-ready-state.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
