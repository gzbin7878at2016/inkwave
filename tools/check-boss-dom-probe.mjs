// 真实浏览器验证调查样式的范围、15/45秒边界、取消恢复；不把隐藏HUD算成性能成绩。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/boss-dom-probe.html','<!doctype html>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{const p=await browser.newPage();await p.goto('http://localhost:8490/releases/investigation/boss-dom-probe.html');
 const result=await p.evaluate(async()=>{
  const {createBossDomProbe:create}=await import('/tools/boss-dom-probe.mjs');
  document.body.innerHTML='<canvas id="scene" width="32" height="16"></canvas><div class="iw-hud" style="display:flex"><span>血量</span></div><div class="iw-hud-over" style="display:block"></div><div id="mobile-controls"></div><div id="mobile-panel"></div>';
  const check=(v,m)=>{if(!v)throw Error(m);},root=document.querySelector('.iw-hud'),original=root.getAttribute('style'),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,32,16);const bytes=[...ctx.getImageData(0,0,32,16).data];
  const m={boss:{},state:'playing'},probe=create();probe.update(m,'match',14999);check(getComputedStyle(root).display==='flex','提前隐藏');probe.update(m,'match',15000);check(getComputedStyle(root).display==='none','15秒未隐藏');
  check(getComputedStyle(canvas).display!=='none'&&canvas.width===32&&canvas.height===16&&bytes.every((v,i)=>v===ctx.getImageData(0,0,32,16).data[i]),'游戏Canvas受影响');
  probe.update(m,'match',45000);check(getComputedStyle(root).display==='flex'&&root.getAttribute('style')===original,'45秒未恢复原样式');
  for(const [match,mode]of [[{boss:null,state:'playing'},'match'],[{boss:{},state:'playing',attract:true},'match'],[{boss:{},state:'intro'},'match'],[{boss:{},state:'playing',paused:true},'match'],[m,'menu']]){probe.update(m,'match',20000);probe.update(match,mode,20000);check(getComputedStyle(root).display==='flex','隔离/取消未恢复');}
  probe.update(m,'match',20000);probe.dispose();check(!probe.info().hidden&&!document.querySelector('[data-boss-dom-probe]')&&getComputedStyle(root).display==='flex'&&root.getAttribute('style')===original,'finally未清理');
  root.classList.add('is-boss');root.innerHTML='<div class="iw-bb"></div><div class="iw-sp"></div><div class="iw-mks"></div><div class="iw-map"></div><div class="iw-hud__top"></div><div class="iw-xh"><canvas class="iw-tank__cv"></canvas></div>';
  for(const [part,cls]of [['bar','iw-bb'],['special','iw-sp'],['markers','iw-mks'],['map','iw-map'],['top','iw-hud__top'],['crosshair','iw-xh']]){const p=create(part);p.update(m,'match',20000);check(getComputedStyle(root).display==='flex'&&[...root.children].every(el=>(getComputedStyle(el).display==='none')===el.classList.contains(cls)),part+'隔离范围越界');p.dispose();check([...root.children].every(el=>getComputedStyle(el).display!=='none'),'组件恢复失败');}
  for(const part of ['controls','panel']){const p=create(part),selected=document.getElementById('mobile-'+part),other=document.getElementById('mobile-'+(part==='controls'?'panel':'controls'));p.update(m,'match',20000);check(getComputedStyle(selected).display==='none'&&getComputedStyle(other).display!=='none'&&getComputedStyle(root).display==='flex','触屏/面板范围越界');p.dispose();check(getComputedStyle(selected).display!=='none','触屏/面板未恢复');}
  return {restored:true,canvasUnchanged:true,extraComponents:true,stats:probe.info()};
 });console.log(JSON.stringify(result));await writeFile('releases/investigation/boss-dom-probe-browser.json',JSON.stringify(result,null,2));
}finally{await browser.close();}
