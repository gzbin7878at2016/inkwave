// 加载成品手机入口验证Boss进度与进入后的真实程序使用；软件渲染结果不代表手机FPS。
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],protocolTimeout:240000});
const errors=[];
try{
 const page=await browser.newPage();await page.setCacheEnabled(false);
 await page.setViewport({width:770,height:376,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto('http://localhost:8490/dist-mobile/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__inkwave?.mobile,{timeout:120000});
 assert.equal(await page.evaluate(()=>__inkwave.settings.fpsCap),30);
 await page.evaluate(weapon=>{
  if(weapon)__inkwave.profile.weapon=weapon;
  window.__bossProgress=[];window.__bossResult=null;
  // 在开局前安装；加载完成记录是唯一baseline，不能把最早intro帧的新程序误当作已准备。
  window.__knownPrograms=null;window.__latePrograms=new Map();
  const renderer=__G.renderer, record=inkwaveDiagnostics.record;
  inkwaveDiagnostics.record=function(category,detail,...rest){
   if(category==='mobile-preparation-ready')__knownPrograms=new Set(renderer.info.programs.map(p=>p.id));
   return record.call(this,category,detail,...rest);
  };
  const direct=renderer.renderBufferDirect;
  renderer.renderBufferDirect=function(...args){
   const result=direct.apply(this,args);
   if(__knownPrograms)for(const p of this.info.programs)if(!__knownPrograms.has(p.id))__latePrograms.set(p.id,{id:p.id,name:p.name,phase:__inkwave.match.state,object:args[4]?.name,material:args[3]?.name,type:args[3]?.type,shaders:(this.getContext().getAttachedShaders(p.program)||[]).map(shader=>this.getContext().getShaderSource(shader))});
   return result;
  };
  const timer=setInterval(()=>{
   const el=document.getElementById('mobile-preparation'),bar=document.getElementById('mobile-preparation-progress');
   if(el&&!el.hidden)__bossProgress.push({value:+bar.getAttribute('aria-valuenow'),state:el.dataset.state,match:__inkwave.match?.state,label:document.getElementById('mobile-preparation-label').textContent});
   else if(__bossResult!==null)clearInterval(timer);
  },20);
  __inkwave.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(result=>{__bossResult=result},error=>{__bossResult=String(error)});
 },process.env.MOBILE_TEST_WEAPON||'shooter');
 await page.waitForSelector('#mobile-preparation:not([hidden])',{timeout:5000});
 await page.screenshot({path:'releases/investigation/test11-boss-loading.png'});
 await page.waitForFunction(()=>__bossResult!==null,{timeout:180000});
 const prepared=await page.evaluate(()=>{
  const g=__inkwave,r=__G.renderer;
  const ready=inkwaveDiagnostics.report().current.events.filter(e=>e.category==='mobile-preparation-ready').at(-1);
  return {result:__bossResult,trace:__bossProgress,ready:ready&&JSON.parse(ready.detail),scene:inkwaveDiagnostics.report().current.scene,pool:g.match.boss?.crabletPool?.models.size,minimapInk:g.minimap.bossInkInfo(),lens:g._bossLensPreparation,smaaClear:g.R.mobileAA.bossSmaaClear};
 });
 assert.equal(prepared.result,true);assert.equal(prepared.pool,12);
 assert.equal(prepared.minimapInk,null,'真机无收益的候选不得在正常加载中分配');
 assert.ok(prepared.lens?.prepared&&prepared.lens.draws===1,'真实加载必须准备镜头墨水');
 assert.ok(prepared.smaaClear?.active,'真实Boss加载预检必须启用SMAA清零');
 assert.ok(prepared.trace.length>1);assert.ok(prepared.trace.some(p=>p.value<100));assert.ok(prepared.trace.some(p=>p.value===100));
 for(let i=1;i<prepared.trace.length;i++)assert.ok(prepared.trace[i].value>=prepared.trace[i-1].value);
 assert.ok(prepared.trace.every(p=>p.state==='complete'||p.match!=='intro'));
 assert.equal(prepared.scene.render.pixelRatio,2);assert.equal(prepared.scene.render.antialias,'SMAA');
 console.log('通过：真实Boss加载进度可见/单调/100%门槛、默认30帧、固定2倍/SMAA、12个小怪已准备');
 await page.waitForFunction(()=>__inkwave.match.state==='playing',{timeout:60000});
 await new Promise(resolve=>setTimeout(resolve,6000));
 const reuse=await page.evaluate(()=>{
  const g=__inkwave,b=g.match.boss;g.debug.freeze();
  const models=new Set(b.crabletPool.models);
  for(let wave=0;wave<2;wave++){
   for(let i=0;i<5;i++)b.crabs.set('test-'+wave+'-'+i,{id:'test-'+wave+'-'+i,x:b.pos.x+i,y:b.pos.y,z:b.pos.z,yaw:0,hp:100,dead:false});
   b._crabVisuals(1/30);g.R.render();
   for(const c of b.crabs.values()){c.dead=true;b._crabPopFx(c,true)}
   b._crabVisuals(.2);g.R.render();b._crabVisuals(1.1);
  }
  return {samePool:[...b.crabletPool.models].every(m=>models.has(m)),count:b.crabletPool.models.size,free:b.crabletPool.free.length,late:[...__latePrograms.values()],failures:inkwaveDiagnostics.report().current.shaderFailures,minimapInk:g.minimap.bossInkInfo()};
 });
 assert.ok(reuse.samePool);assert.equal(reuse.count,12);assert.equal(reuse.free,12);assert.equal(reuse.failures.length,0);
 assert.equal(reuse.minimapInk,null,'正常实战保持原小地图计算');
 await writeFile('releases/investigation/test11-boss-gameplay.json',JSON.stringify({prepared,reuse,errors},null,2));
 assert.deepEqual(reuse.late.map(({id,name,phase})=>({id,name,phase})),[],'开场/实战和两轮小怪不得新增shader程序对象');
 assert.deepEqual(errors,[]);
 console.log('通过：真实开场/短时实战及两轮小怪生成/死亡/复用无新增shader程序，页面与shader错误为0');
 // 实际准备中的后台取消必须在恢复后回到菜单，不能留下覆盖层或旧init对局。
 await page.evaluate(()=>{__inkwave.debug.unfreeze();window.__cancelResult=null;__inkwave.startMatch({mode:'boss',mapId:'tidewater'}).then(r=>__cancelResult=r)});
 await page.waitForSelector('#mobile-preparation:not([hidden])');
 await page.evaluate(()=>{__inkwave.mobile.suspend();__inkwave.mobile.foreground()});
 await page.waitForFunction(()=>!document.getElementById('mobile-dialog').hidden);
 await page.click('#mobile-dialog button');
 await page.waitForFunction(()=>!__inkwave._mobilePreparation&&!__inkwave._mobilePreparationError&&!document.getElementById('mobile-preparation'),{timeout:30000});
 assert.equal(await page.evaluate(()=>__cancelResult),false);
 console.log('通过：真实准备中后台取消，前台继续后安全返回菜单、释放覆盖层与准备锁');
}finally{await browser.close()}
