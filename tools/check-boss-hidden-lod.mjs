// 独立桌面真实成品：隐藏LOD摘挂的矩阵/像素和提交成本实验，不改产品、不代表手机FPS。
import puppeteer from 'puppeteer-core';
import {benchmarkBossHiddenLod} from './phone-hidden-lod-benchmark.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox'],protocolTimeout:240000});
const report={status:'loading',performanceTest:false,productModified:false,errors:[]};
try{
 const page=await browser.newPage();await page.setViewport({width:778,height:370,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://localhost:8490/dist-mobile/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__inkwave?.mobile,{timeout:120000});await page.mouse.click(2,2);
 await page.evaluate(()=>{window.__lodReady=null;__inkwave.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(v=>__lodReady=v,e=>__lodReady=String(e));});
 await page.waitForFunction(()=>window.__lodReady!==null,{timeout:180000});
 if(await page.evaluate(()=>__lodReady)!==true)throw Error('Boss加载失败');
 report.result=await page.evaluate(`(${benchmarkBossHiddenLod.toString()})(__inkwave,__G)`);
 report.status=report.result.matched&&!report.errors.length?'matched':'not-matched';if(report.status!=='matched')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser.close();await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/boss-hidden-lod-desktop.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
