import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolveBundledThree} from './resolve-bundled-three.mjs';
import {createBossPropRangeCandidate} from './boss-prop-range-candidate.mjs';

// 可注入手机的自包含核心；调用方必须先自然结算，核心只冻结绘制副本，不推进或改写战斗状态。
export async function benchmarkBossPropRanges(game,G,T,create){
 const r=G.renderer,gl=r.getContext(),camera=G.camera,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
 if(!game.match?.boss||w*h>1600000)throw Error('Boss副本或像素预算不满足');
 const sources=[];G.scene.traverse(o=>{if(['props:paint','props:paint~ns','props:gloss','props:gloss~ns'].includes(o.name)&&o.isMesh&&!o.isInstancedMesh)sources.push(o);});
 if(sources.length!==4)throw Error('未找到4个原静态桶');
 const viewport=new T.Vector4(),scissor=new T.Vector4();r.getViewport(viewport);r.getScissor(scissor);
 const saved={frozen:game.frozen,pos:camera.position.clone(),q:camera.quaternion.clone(),direct:r.renderBufferDirect,target:r.getRenderTarget(),face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),test:r.getScissorTest()};
 const begin=performance.now(),yieldTurn=()=>new Promise(resolve=>setTimeout(resolve,0));let candidate,result;
 const checkTime=()=>{if(performance.now()-begin>15000)throw Error('手机副本超过15秒预算，恢复原绘制');};
 try{
  game.frozen=true;const start=performance.now();candidate=create(T,sources,{renderer:r});const buildMs=performance.now()-start;
  const draw=(active,cull=true,read=true)=>{checkTime();candidate.setCullingEnabled(cull);active?candidate.enable():candidate.disable();const before=candidate.stats.submittedTriangles;game.R.render();let data=null;if(read){data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);}return {data,submittedTriangles:candidate.stats.submittedTriangles-before};};
  const diff=(a,b)=>{let max=0,changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;max=Math.max(max,d);}return {max,changed};};
  const pixels=[];
  for(const [name,eye,target] of [['actual',null,null],['spawn',[0,5,-35],[0,3,0]],['left',[-12,4,-15],[0,2,0]]]){
   if(eye){camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld(true);}
   draw(false,true,false);draw(true,true,false);
   const a1=draw(false),a=draw(false),b1=draw(true),b=draw(true),after=draw(false),full=draw(true,false);
   const p={view:name,referenceRepeat:diff(a1.data,a.data),referenceAcross:diff(a.data,after.data),candidateRepeat:diff(b1.data,b.data),candidate:diff(a.data,b.data),withoutCulling:diff(a.data,full.data),submittedTriangles:b.submittedTriangles};pixels.push(p);
   if([p.referenceRepeat,p.referenceAcross,p.candidateRepeat,p.candidate,p.withoutCulling].some(d=>d.max))throw Error('手机实际像素或重复参考不一致：'+JSON.stringify(p));
   if(gl.getError()!==gl.NO_ERROR)throw Error('手机区段副本出现GL错误');
   await yieldTurn();
  }
  const timings=[];
  for(const [name,eye,target] of [['spawn',[0,5,-35],[0,3,0]],['left',[-12,4,-15],[0,2,0]]]){
   camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld(true);
   for(const active of [false,true,true,false,false,true,true,false]){
    draw(active,true,false);gl.finish();checkTime();const t=performance.now();draw(active,true,false);const submitWallMs=performance.now()-t;gl.finish();
    timings.push({view:name,active,frames:1,totalBlockedWallMs:performance.now()-t,submitWallMs});await yieldTurn();
   }
  }
  if(!candidate.stats.nativeCalls||candidate.stats.fallbacks||gl.getError()!==gl.NO_ERROR)throw Error('手机候选未执行/发生回退或GL错误');
  result={performanceTest:false,status:'matched',width:w,height:h,buildMs,pixels,timings,stats:{...candidate.stats},note:'自然结算后同输入绘制/阻塞墙钟，不是实战FPS或纯CPU/GPU耗时',restored:false};return result;
 }finally{
  candidate?.dispose();camera.position.copy(saved.pos);camera.quaternion.copy(saved.q);camera.updateMatrixWorld(true);game.frozen=saved.frozen;
  r.setRenderTarget(saved.target,saved.face,saved.mip);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(saved.test);
  const restored=r.renderBufferDirect===saved.direct&&sources.every(m=>m.visible);
  if(result)result.restored=restored;if(!restored)throw Error('手机副本没有恢复原绘制');
 }
}

export async function runPhoneBossPropRanges(c){
 const build=JSON.parse((await readFile('releases/android-build-info.json','utf8')).replace(/^\uFEFF/,''));
 const current=await c.evaluate('({build:inkwaveDiagnostics.report().current.build,state:__inkwave.match?.state,boss:!!__inkwave.match?.boss})');
 if(!current.boss||!['finish','results'].includes(current.state)||current.build.sourceCommit!==build.sourceCommit||current.build.trackedChanges)throw Error('必须自然结算且安装源码匹配当前干净构建');
 const path=await resolveBundledThree(),data=await readFile('dist-mobile/'+path),hash=createHash('sha256').update(data).digest('hex');
 return c.evaluate(`(async()=>{const path=${JSON.stringify(path)},expected=${JSON.stringify(hash)},url=new URL(path,location.href).href;const bytes=await(await fetch(url)).arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);if([...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')!==expected)throw Error('手机Three资源与本地已检查源码不一致');const {three_module_exports:T}=await import(url);return (${benchmarkBossPropRanges.toString()})(__inkwave,__G,T,(${createBossPropRangeCandidate.toString()}));})()`);
}
