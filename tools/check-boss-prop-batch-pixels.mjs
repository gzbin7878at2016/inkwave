// 在独立桌面浏览器比较真实Boss完整画面的A/B/A；不是手机性能成绩，也不写产品源码。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],protocolTimeout:240000});
const report={status:'loading',performanceTest:false,productModified:false,errors:[]};
report.groupMode=process.env.BOSS_PROP_GROUP_MODE||'cells';
try{
 const page=await browser.newPage();await page.setViewport({width:778,height:370,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://localhost:8490/dist-mobile/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__inkwave?.mobile,{timeout:120000});await page.mouse.click(2,2);
 await page.evaluate(()=>{window.__batchReady=null;__inkwave.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(v=>__batchReady=v,e=>__batchReady=String(e));});
 await page.waitForFunction(()=>window.__batchReady!==null,{timeout:180000});
 report.result=await page.evaluate(async groupMode=>{
  if(__batchReady!==true)throw Error('正常Boss加载失败：'+__batchReady);
  const T=await import('/node_modules/three/build/three.module.js'),{createBossPropBatchCandidate:create}=await import('/tools/boss-prop-batch-candidate.mjs');
  const g=__inkwave,r=__G.renderer,gl=r.getContext(),camera=__G.camera,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  if(w*h>1600000)throw Error('像素比较超过有界预算');
  const saved={frozen:g.frozen,pos:camera.position.clone(),q:camera.quaternion.clone(),direct:r.renderBufferDirect};
  const sources=[];__G.scene.traverse(o=>{if(['props:paint','props:paint~ns','props:gloss','props:gloss~ns'].includes(o.name)&&o.isMesh&&!o.isInstancedMesh)sources.push(o);});
  if(sources.length!==4)throw Error('原4个重桶未找到');
  let candidate,counts;
  try{
   g.frozen=true;const started=performance.now();candidate=create(T,sources,{groupMode});const buildMs=performance.now()-started;
   r.renderBufferDirect=function(...args){const object=args[4],before=r.info.render.triangles;const result=saved.direct.apply(this,args);if(counts&&(sources.includes(object)||object?.userData.bossPropBatch)){counts.submissions++;counts.triangles+=r.info.render.triangles-before;}return result;};
   const draw=(active,cull=true)=>{for(const e of candidate.entries)if(e.batch.perObjectFrustumCulled!==cull){e.batch.perObjectFrustumCulled=cull;e.batch.setVisibleAt(e.instanceIds[0],false);e.batch.setVisibleAt(e.instanceIds[0],true);}active?candidate.enable():candidate.disable();counts={submissions:0,triangles:0};g.R.render();const data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);return {data,counts:{...counts}};};
   const diff=(a,b)=>{let max=0,changed=0,sum=0;const samples=[];for(let i=0;i<a.length;i+=4){let changedPixel=false;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);if(d){changed++;changedPixel=true;}max=Math.max(max,d);sum+=d;}if(changedPixel&&samples.length<16)samples.push({x:(i/4)%w,y:Math.floor(i/4/w),a:[...a.slice(i,i+4)],b:[...b.slice(i,i+4)]});}return {max,changed,mean:sum/a.length,samples};};
   const views=[['actual-camera',null,null],['spawn',[0,5,-35],[0,3,0]],['left',[-12,4,-15],[0,2,0]],['right',[12,4,-15],[0,2,0]],['rear',[0,4,12],[0,2,-5]]],pixels=[];
   for(const [name,eye,target] of views){
    if(eye){camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld(true);}
    for(let i=0;i<3;i++)draw(false);for(let i=0;i<3;i++)draw(true);for(let i=0;i<3;i++)draw(false);
    const a1=draw(false),a=draw(false),b1=draw(true),b=draw(true),repeat1=draw(false),repeat=draw(false),noCull=draw(true,false);
    pixels.push({view:name,referenceRepeat:diff(a1.data,a.data),referenceRepeatAfter:diff(repeat1.data,repeat.data),referenceAcross:diff(a.data,repeat.data),candidateRepeat:diff(b1.data,b.data),candidate:diff(a.data,b.data),withoutCulling:diff(a.data,noCull.data),originalDraw:a.counts,candidateDraw:b.counts,withoutCullingDraw:noCull.counts});
   }
   if(gl.getError()!==gl.NO_ERROR)throw Error('像素比较出现WebGL错误');
   return {width:w,height:h,buildMs,stats:{...candidate.stats},multiDraw:!!r.extensions.get('WEBGL_multi_draw'),pixels,restored:false};
  }finally{candidate?.dispose();r.renderBufferDirect=saved.direct;camera.position.copy(saved.pos);camera.quaternion.copy(saved.q);camera.updateMatrixWorld(true);g.frozen=saved.frozen;if(sources.some(m=>!m.visible))throw Error('原对象没有恢复');}
 },report.groupMode);
 report.result.restored=true;
 const unstable=report.result.pixels.some(p=>p.referenceRepeat.max||p.referenceRepeatAfter.max||p.referenceAcross.max||p.candidateRepeat.max);
 report.status=unstable?'inconclusive':report.errors.length||report.result.pixels.some(p=>p.candidate.max)?'mismatch':'matched';
 if(report.status!=='matched')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser.close();await writeFile('releases/investigation/boss-prop-batch-pixels.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
