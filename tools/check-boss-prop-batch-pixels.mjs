// 在独立桌面浏览器比较真实Boss完整画面的A/B/A；不是手机性能成绩，也不写产品源码。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolveBundledThree} from './resolve-bundled-three.mjs';
import {benchmarkBossPropRanges} from './phone-prop-range-benchmark.mjs';
import {createBossPropRangeCandidate} from './boss-prop-range-candidate.mjs';
await mkdir('releases/investigation',{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],protocolTimeout:240000});
const report={status:'loading',performanceTest:false,productModified:false,errors:[]};
report.groupMode=process.env.BOSS_PROP_GROUP_MODE||'cells';
report.benchmark=process.env.BOSS_PROP_BENCHMARK==='1';
report.backend=process.env.BOSS_PROP_BACKEND||'batch';
report.threeModulePath=await resolveBundledThree();
try{
 const page=await browser.newPage();await page.setViewport({width:778,height:370,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://localhost:8490/dist-mobile/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__inkwave?.mobile,{timeout:120000});await page.mouse.click(2,2);
 await page.evaluate(()=>{window.__batchReady=null;__inkwave.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(v=>__batchReady=v,e=>__batchReady=String(e));});
 await page.waitForFunction(()=>window.__batchReady!==null,{timeout:180000});
 if(process.env.BOSS_PROP_PHONE_CORE==='1'){
  report.phoneProbe=await page.evaluate(`(async()=>{const {three_module_exports:T}=await import(new URL(${JSON.stringify(report.threeModulePath)},location.href).href);return (${benchmarkBossPropRanges.toString()})(__inkwave,__G,T,(${createBossPropRangeCandidate.toString()}));})()`);
  if(!report.phoneProbe.restored||report.phoneProbe.status!=='matched')throw Error('手机核心的桌面预检未通过');
  report.status='matched';
 }else{
 report.result=await page.evaluate(async({groupMode,benchmark,backend,threeModulePath})=>{
  if(__batchReady!==true)throw Error('正常Boss加载失败：'+__batchReady);
  const {three_module_exports:T}=await import(new URL(threeModulePath,location.href).href);
  const create=backend==='ranges'?(await import('/tools/boss-prop-range-candidate.mjs')).createBossPropRangeCandidate:(await import('/tools/boss-prop-batch-candidate.mjs')).createBossPropBatchCandidate;
  const g=__inkwave,r=__G.renderer,gl=r.getContext(),camera=__G.camera,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  if(w*h>1600000)throw Error('像素比较超过有界预算');
  const saved={frozen:g.frozen,pos:camera.position.clone(),q:camera.quaternion.clone(),direct:r.renderBufferDirect};
  const sources=[];__G.scene.traverse(o=>{if(['props:paint','props:paint~ns','props:gloss','props:gloss~ns'].includes(o.name)&&o.isMesh&&!o.isInstancedMesh)sources.push(o);});
  if(sources.length!==4)throw Error('原4个重桶未找到');
  let candidate,counts;
  try{
   g.frozen=true;const started=performance.now();candidate=create(T,sources,{groupMode,renderer:r});const buildMs=performance.now()-started;
   const candidateDirect=r.renderBufferDirect; // 必须链到区段候选的实际钩子，不能用旧函数绕过候选制造相同像素。
   r.renderBufferDirect=function(...args){const object=args[4],before=r.info.render.triangles;const result=candidateDirect.apply(this,args);if(counts&&(sources.includes(object)||object?.userData.bossPropBatch)){counts.submissions++;counts.triangles+=r.info.render.triangles-before;}return result;};
   const setCull=cull=>{if(candidate.setCullingEnabled)candidate.setCullingEnabled(cull);else for(const e of candidate.entries)if(e.batch.perObjectFrustumCulled!==cull){e.batch.perObjectFrustumCulled=cull;e.batch.setVisibleAt(e.instanceIds[0],false);e.batch.setVisibleAt(e.instanceIds[0],true);}};
   const draw=(active,cull=true)=>{setCull(cull);active?candidate.enable():candidate.disable();counts={submissions:0,triangles:0};g.R.render();const data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);return {data,counts:{...counts}};};
   const diff=(a,b)=>{let max=0,changed=0,sum=0;const samples=[];for(let i=0;i<a.length;i+=4){let changedPixel=false;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);if(d){changed++;changedPixel=true;}max=Math.max(max,d);sum+=d;}if(changedPixel&&samples.length<16)samples.push({x:(i/4)%w,y:Math.floor(i/4/w),a:[...a.slice(i,i+4)],b:[...b.slice(i,i+4)]});}return {max,changed,mean:sum/a.length,samples};};
   const views=[['actual-camera',null,null],['spawn',[0,5,-35],[0,3,0]],['left',[-12,4,-15],[0,2,0]],['right',[12,4,-15],[0,2,0]],['rear',[0,4,12],[0,2,-5]]],pixels=[];
   for(const [name,eye,target] of views){
    if(eye){camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld(true);}
    for(let i=0;i<3;i++)draw(false);for(let i=0;i<3;i++)draw(true);for(let i=0;i<3;i++)draw(false);
    const a1=draw(false),a=draw(false),b1=draw(true),b=draw(true),repeat1=draw(false),repeat=draw(false),noCull=draw(true,false);
    pixels.push({view:name,referenceRepeat:diff(a1.data,a.data),referenceRepeatAfter:diff(repeat1.data,repeat.data),referenceAcross:diff(a.data,repeat.data),candidateRepeat:diff(b1.data,b.data),candidate:diff(a.data,b.data),withoutCulling:diff(a.data,noCull.data),originalDraw:a.counts,candidateDraw:b.counts,withoutCullingDraw:noCull.counts});
   }
   const timings=[];
   if(benchmark&&pixels.every(p=>!p.referenceRepeat.max&&!p.referenceRepeatAfter.max&&!p.referenceAcross.max&&!p.candidateRepeat.max&&!p.candidate.max)){
    for(const name of ['spawn','left']){
     const [,eye,target]=views.find(v=>v[0]===name);camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld(true);
     for(const active of [false,true,true,false,false,true,true,false]){
      active?candidate.enable():candidate.disable();setCull(true);
      g.R.render();gl.finish();const begin=performance.now();let submitWallMs=0;
      for(let i=0;i<3;i++){const a=performance.now();g.R.render();submitWallMs+=performance.now()-a;}gl.finish();
      timings.push({view:name,active,frames:3,totalBlockedWallMs:performance.now()-begin,submitWallMs});
     }
    }
   }
   if(backend==='ranges'&&!candidate.stats.nativeCalls)throw Error('区段候选没有真实执行，不能称像素通过');
   if(gl.getError()!==gl.NO_ERROR)throw Error('像素比较出现WebGL错误');
   const debug=gl.getExtension('WEBGL_debug_renderer_info');
   return {width:w,height:h,buildMs,stats:{...candidate.stats},revision:T.REVISION,gpu:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER),multiDraw:!!r.extensions.get('WEBGL_multi_draw'),pixels,timings,timingNote:'独立桌面同输入gl.finish有界阻塞墙钟，非纯CPU/GPU时间，不代表手机整局FPS',restored:false};
  }finally{candidate?.dispose();r.renderBufferDirect=saved.direct;camera.position.copy(saved.pos);camera.quaternion.copy(saved.q);camera.updateMatrixWorld(true);g.frozen=saved.frozen;if(sources.some(m=>!m.visible))throw Error('原对象没有恢复');}
 },{groupMode:report.groupMode,benchmark:report.benchmark,backend:report.backend,threeModulePath:report.threeModulePath});
 report.result.restored=true;
 const unstable=report.result.pixels.some(p=>p.referenceRepeat.max||p.referenceRepeatAfter.max||p.referenceAcross.max||p.candidateRepeat.max);
 report.status=unstable?'inconclusive':report.errors.length||report.result.pixels.some(p=>p.candidate.max)?'mismatch':'matched';
 }
 if(report.status!=='matched')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser.close();await writeFile('releases/investigation/boss-prop-batch-pixels.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
