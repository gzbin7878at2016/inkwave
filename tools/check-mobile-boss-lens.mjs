// 使用真实ScreenFX/LensInk与WebGL，验证加载期首绘和首次真实墨珠像素一致。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-lens-test.html','<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/boss-lens-test.html');
 const result=await page.evaluate(async()=>{
  const T=await import('three'),{ScreenFX}=await import('/src/fx/screenfx.js'),{G}=await import('/src/core/ctx.js');
  const {prepareMobileBossLens:prepare}=await import('/src/platform/mobileBossLensPreparation.js');
  const check=(v,m)=>{if(!v)throw Error(m)};
  const r=new T.WebGLRenderer({antialias:false}),errors=[];r.debug.onShaderError=()=>errors.push('shader');
  const match={boss:{},state:'init'};G.match=match;G.renderer=r;G.mode='menu';globalThis.inkwaveMobile={};
  const make=()=>{const fx=new ScreenFX({renderer:r,setExtraPass(){}},{match:null});return {match,screenfx:fx};};
  const game=make(),reference=make(),lens=game.screenfx.lens;
  const sentinel=new T.WebGLRenderTarget(64,48,{type:T.HalfFloatType});
  r.setRenderTarget(lens.rt);r.setClearColor(0x123456,.3);r.clear();
  const read=rt=>{const data=new Uint16Array(rt.width*rt.height*4);r.readRenderTargetPixels(rt,0,0,rt.width,rt.height,data);return data;};
  const untouched=read(lens.rt);
  r.setRenderTarget(sentinel);r.setViewport(2,3,30,20);r.setScissor(4,5,9,11);r.setScissorTest(true);r.autoClear=false;
  r.shadowMap.autoUpdate=false;r.shadowMap.needsUpdate=true;
  const state=()=>JSON.stringify({viewport:r.getViewport(new T.Vector4()).toArray(),scissor:r.getScissor(new T.Vector4()).toArray(),test:r.getScissorTest(),auto:r.autoClear,
   shadow:[r.shadowMap.autoUpdate,r.shadowMap.needsUpdate],clear:r.getClearColor(new T.Color()).toArray(),alpha:r.getClearAlpha(),
   parts:lens.parts,pool:lens.pool,instances:lens.geo.instanceCount,range:lens.geo.drawRange,A:[...lens.aA.array],B:[...lens.aB.array],versions:[lens.aA.version,lens.aB.version],aspect:lens.mat.uniforms.uAspect.value,s:game.screenfx.s});
  const before=state();const info=await prepare(game,match,{yieldTurn:async()=>{}});
  check(info.prepared&&info.draws===1&&info.programId>=0,'加载首绘未完成');
  check(state()===before&&r.getRenderTarget()===sentinel,'首绘污染粒子/缓冲/材质状态或GL状态');
  check(read(lens.rt).every((v,i)=>v===untouched[i]),'首绘写入真实镜头纹理');
  check(JSON.stringify(game._bossLensPreparation)===JSON.stringify(info),'准备记录不一致');
  // 两边使用同一真实add/render入口，比较首个可见墨珠的HalfFloat位图。
  G.mode='match';match.state='playing';
  r.setRenderTarget(null);r.setScissorTest(false);r.autoClear=true;
  for(const fx of [game.screenfx,reference.screenfx]){fx.lens.resize(192,108,1/3);fx.lens.add('drop',0,.45,.55,.19,{I:.8,pop:0,life:1});fx.lens.render(16/9);}
  const actual=read(lens.rt),expected=read(reference.screenfx.lens.rt);
  check(actual.some(v=>v>0)&&actual.every((v,i)=>v===expected[i]),'首次真实墨珠像素不一致');
  check(r.properties.get(lens.mat).currentProgram.id===info.programId,'首次真实墨珠重新建立程序');
  // 实际入口隔离、取消、让帧后的状态变动与首绘异常恢复。
  for(const kind of ['pc','ordinary','attract']) {
   const g=make(),m=kind==='ordinary'?{boss:null}:kind==='attract'?{boss:{},attract:true}:match;g.match=m;G.match=m;
   globalThis.inkwaveMobile=kind==='pc'?false:{};const count=r.info.programs.length;
   check((await prepare(g,m)).skipped&&r.info.programs.length===count,'非Boss或PC参与准备');
  }
  globalThis.inkwaveMobile={};G.match=match;const cancelled=make();
  check((await prepare(cancelled,match,{isCurrent:()=>false})).cancelled,'预先取消未生效');
  let current=true;
  check((await prepare(cancelled,match,{isCurrent:()=>current,yieldTurn:async()=>{current=false;}})).cancelled&&!cancelled._bossLensPreparation,'让帧取消仍标记完成');
  const changed=make();r.setRenderTarget(sentinel);
  await prepare(changed,match,{yieldTurn:async()=>{r.setViewport(7,8,22,23);}});
  check(r.getViewport(new T.Vector4()).toArray().join(',')==='7,8,22,23','让帧后恢复了过期视口');
  const broken=make(),render=r.render;let failed=false;r.render=()=>{throw Error('injected-draw');};
  const target=r.getRenderTarget(),viewport=r.getViewport(new T.Vector4()).toArray().join(',');
  try{await prepare(broken,match,{yieldTurn:async()=>{}});}catch(e){failed=String(e).includes('injected-draw');}finally{r.render=render;}
  check(failed&&!broken._bossLensPreparation&&broken.screenfx.lens.geo.instanceCount===0&&r.getRenderTarget()===target&&r.getViewport(new T.Vector4()).toArray().join(',')===viewport,'异常未恢复原状态');
  check(!errors.length,'shader错误');
  return {preparedProgramId:info.programId,actualProgramId:r.properties.get(lens.mat).currentProgram.id,pixelValues:actual.length,instanceCapacity:info.instanceCapacity,
   checks:'真实实例首绘/首次可见像素一致/真实目标不写入/粒子和GL状态保持/PC普通演示隔离/取消/让帧视口/异常恢复通过'};
 });
 await writeFile('releases/investigation/mobile-boss-lens-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await browser.close();}
