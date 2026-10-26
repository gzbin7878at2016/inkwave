// 浏览器原生样式计数验证：逐帧采样多个SVG时，不允许每个动画都触发一次同步样式刷新。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-animation-style-test.html','<!doctype html><meta charset="utf-8">');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/boss-animation-style-test.html');
 const client=await page.createCDPSession();await client.send('Performance.enable');
 await page.evaluate(async()=>{
  const {createMobileBossAnimationClock}=await import('/src/platform/mobileBossAnimationClock.js');
  document.body.innerHTML='<style>@keyframes move{from{transform:translateX(0)}to{transform:translateX(40px)}}circle{animation:move 1s linear infinite}</style><svg class="iw-hud is-boss" width="400" height="200">'+Array.from({length:16},(_,i)=>`<circle cx="${10+i*20}" cy="40" r="6"/>`).join('')+'</svg>';
  globalThis.inkwaveMobile={};window.styleGame={settings:{fpsCap:30},match:{boss:{},state:'playing'}};
  await Promise.all(document.getAnimations().map(a=>a.ready));await new Promise(requestAnimationFrame);
  window.styleClock=createMobileBossAnimationClock();styleClock.update(styleGame,'match',false);await new Promise(requestAnimationFrame);
 });
 const metrics=async()=>Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const before=await metrics();
 const clock=await page.evaluate(async()=>{for(let i=0;i<36;i++){await new Promise(requestAnimationFrame);styleClock.update(styleGame,'match',false);}return styleClock.info()});
 const after=await metrics();
 const result={frames:36,clock,recalcStyles:after.RecalcStyleCount-before.RecalcStyleCount,layouts:after.LayoutCount-before.LayoutCount,styleCpuMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000};
 console.log(JSON.stringify(result));
 await writeFile(`releases/investigation/mobile-boss-animation-style-${process.env.BOSS_STYLE_BASELINE==='1'?'baseline':'batch'}.json`,JSON.stringify(result,null,2));
 assert.equal(clock.tracked,16,'实际SVG动画没有捕获');
 if(process.env.BOSS_STYLE_BASELINE!=='1')assert.ok(result.recalcStyles<=36*3,'样式刷新随动画数量增长：'+JSON.stringify(result));
}finally{await browser.close()}
