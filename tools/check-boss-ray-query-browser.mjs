// 用真实手机成品及布景碰撞盒预检同一手机核心；桌面/合成射线，不作真机FPS。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {benchmarkBossRayQuery} from './phone-ray-query-benchmark.mjs';
import {createBossRayQueryCandidate} from './boss-ray-query-candidate.mjs';
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox'],protocolTimeout:240000});
const report={status:'loading',performanceTest:false,errors:[]};
try{
 const page=await browser.newPage();await page.setViewport({width:778,height:370,deviceScaleFactor:2,isMobile:true,hasTouch:true});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://localhost:8490/dist-mobile/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__inkwave?.mobile,{timeout:120000});await page.mouse.click(2,2);
 await page.evaluate(()=>{window.__rayReady=null;__inkwave.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(v=>__rayReady=v,e=>__rayReady=String(e));});await page.waitForFunction(()=>window.__rayReady!==null,{timeout:180000});
 const records=await page.evaluate(()=>{
  if(__rayReady!==true)throw Error('Boss加载失败');let seed=417;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},records=[];
  for(let i=0;i<3000;i++){let dx=random()*2-1,dy=random()-.5,dz=random()*2-1;const len=Math.hypot(dx,dy,dz);records.push([random()*180-90,random()*12,random()*180-90,dx/len,dy/len,dz/len,random()*160,!!(i%2)]);}return records;
 });
 report.result=await page.evaluate(`(${benchmarkBossRayQuery.toString()})(__inkwave,__G,${JSON.stringify(records)},(${createBossRayQueryCandidate.toString()}))`);
 report.status=report.result.matched&&!report.errors.length?'matched':'failed';if(report.status==='failed')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser.close();await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/boss-ray-query-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
