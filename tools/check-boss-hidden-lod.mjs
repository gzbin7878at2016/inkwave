// 独立桌面真实成品：隐藏LOD摘挂的矩阵/像素和提交成本实验，不改产品、不代表手机FPS。
import puppeteer from 'puppeteer-core';
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
 report.result=await page.evaluate(()=>{
  if(__lodReady!==true)throw Error('Boss加载失败：'+__lodReady);
  const game=__inkwave,r=__G.renderer,gl=r.getContext(),scene=__G.scene,savedFrozen=game.frozen;
  const parents=new Map(),removed=[];let active=false;
  for(const actor of game.match.actors){const c=actor.character;for(const set of c.lodSets)for(const mesh of set?.list||[]){
   if(mesh.visible)continue;
   if(!mesh.isSkinnedMesh||mesh.children.length||mesh.parent!==c.kid)throw Error('不支持的隐藏LOD结构');
   if(!parents.has(c.kid))parents.set(c.kid,[...c.kid.children]);removed.push({mesh,parent:c.kid});
  }}
  const enable=()=>{if(active)return;for(const {mesh,parent}of removed){if(mesh.visible||mesh.parent!==parent)throw Error('隐藏状态已改变');parent.remove(mesh);}active=true;};
  const disable=()=>{if(!active)return;for(const {mesh,parent}of removed)parent.add(mesh);for(const [parent,children]of parents){if(parent.children.length!==children.length||parent.children.some(c=>!children.includes(c)))throw Error('副本期间场景结构改变');parent.children.splice(0,parent.children.length,...children);}active=false;};
  const difference=(a,b)=>{let max=0,changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;max=Math.max(max,d);}return{max,changed};};
  const snapshot=()=>{const values=[];scene.traverseVisible(o=>values.push(...o.matrixWorld.elements));for(const a of game.match.actors){a.character.skeleton.update();values.push(...a.character.skeleton.boneMatrices);}return values;};
  const draw=()=>{game.R.render();const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return{bytes,matrices:snapshot()};};
  try{
   game.frozen=true;for(let i=0;i<3;i++)game.R.render();const a0=draw(),a=draw();enable();const b=draw(),b2=draw();disable();const after=draw();
   const pixels={reference:difference(a0.bytes,a.bytes),candidate:difference(a.bytes,b.bytes),repeat:difference(b.bytes,b2.bytes),restored:difference(a.bytes,after.bytes)};
   const matrices={candidate:difference(a.matrices,b.matrices),restored:difference(a.matrices,after.matrices)};
   const timings=[];
   for(const enabled of [false,true,true,false,false,true,true,false]){
    enabled?enable():disable();for(let i=0;i<20;i++)scene.updateMatrixWorld();
    const start=performance.now();for(let i=0;i<200;i++)scene.updateMatrixWorld();timings.push({enabled,iterations:200,totalMs:performance.now()-start});
   }
   disable();const restored=[...parents].every(([p,children])=>children.every((c,i)=>p.children[i]===c));
   if(!restored||gl.getError()!==gl.NO_ERROR)throw Error('恢复或GL检查失败');
   return{removed:removed.length,pixels,matrices,timings,restored,matched:[...Object.values(pixels),...Object.values(matrices)].every(x=>!x.max),renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)};
  }finally{disable();game.frozen=savedFrozen;}
 });
 report.status=report.result.matched&&!report.errors.length?'matched':'not-matched';if(report.status!=='matched')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser.close();await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/boss-hidden-lod-desktop.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
