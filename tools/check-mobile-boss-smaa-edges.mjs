// 真实WebGL只改变SMAA边缘目标格式；比较HDR图案最终像素、FBO位数、恢复和资源边界。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-smaa-edges-test.html','<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/boss-smaa-edges-test.html');
 const report=await page.evaluate(async()=>{
  const T=await import('three'),{EffectComposer}=await import('three/addons/postprocessing/EffectComposer.js');
  const {ShaderPass}=await import('three/addons/postprocessing/ShaderPass.js'),{OutputPass}=await import('three/addons/postprocessing/OutputPass.js');
  const {MobileSMAAPass}=await import('/src/platform/mobileSMAAPass.js'),{Renderer}=await import('/src/core/renderer.js'),{G}=await import('/src/core/ctx.js');
  const check=(v,m)=>{if(!v)throw Error(m)},r=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}),errors=[];
  r.debug.onShaderError=()=>errors.push('shader');r.info.autoReset=false;globalThis.inkwaveMobile={};
  const match={boss:{},state:'init'};G.match=match;G.mode='match';
  const shader={uniforms:{uMode:{value:0},uAngle:{value:0},uSize:{value:new T.Vector2(1,1)}},
   vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`uniform float uMode,uAngle;uniform vec2 uSize;varying vec2 vUv;void main(){
    vec2 p=(vUv-.5)*uSize;float q=p.x*cos(uAngle)+p.y*sin(uAngle);float edge=step(.173,q);
    if(uMode<.5)edge=step(.62,fract(q*.37));else if(uMode>1.5)edge=step(.5,fract(p.x*.19)*fract(p.y*.23)*2.);
    vec3 a=vec3(.012,.38,6.7),b=vec3(9.1,.023,.15);gl_FragColor=vec4(mix(a,b,edge),mix(.12,1.,step(.25,vUv.y)));}`};
  const make=()=>{const c=new EffectComposer(r,new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false})),source=new ShaderPass(shader),aa=new MobileSMAAPass(),output=new OutputPass();source.material.toneMapped=false;c.addPass(source);c.addPass(aa);c.addPass(output);return {c,source,aa,output};};
  const original=make(),compact=make(),edgeIdentity=compact.aa._edgesRT,textureIdentity=edgeIdentity.texture,weights=compact.aa._weightsRT;
  for(let i=0;i<100&&![original,compact].every(x=>x.aa._areaTexture.image.complete&&x.aa._searchTexture.image.complete);i++)await new Promise(r=>setTimeout(r,10));
  const snapshot=()=>JSON.stringify({viewport:r.getViewport(new T.Vector4()).toArray(),scissor:r.getScissor(new T.Vector4()).toArray(),test:r.getScissorTest(),auto:r.autoClear,clear:r.getClearColor(new T.Color()).toArray(),alpha:r.getClearAlpha()});
  const draw=x=>{x.aa.syncBossSmaaClear(match,'match');x.aa.syncBossOutput(match,'match');r.info.reset();x.c.render();const gl=r.getContext(),data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);return {data,calls:r.info.render.calls};};
  const rows=[];
  for(const [w,h,ratio] of [[61,37,2],[83,51,1.5]])for(const tone of [T.NoToneMapping,T.ACESFilmicToneMapping])for(let mode=0;mode<3;mode++)for(let angle=0;angle<6;angle++){
   r.setPixelRatio(ratio);r.setSize(w,h);r.toneMapping=tone;r.toneMappingExposure=.71;r.outputColorSpace=T.SRGBColorSpace;
   for(const x of [original,compact]){x.c.setPixelRatio(ratio);x.c.setSize(w,h);x.source.uniforms.uMode.value=mode;x.source.uniforms.uAngle.value=angle*.2731;x.source.uniforms.uSize.value.set(w*ratio,h*ratio);}
   const before=snapshot(),target=r.getRenderTarget(),prepared=await compact.aa.prepareBossEdges(r,match);
   check(prepared.ready&&prepared.componentBits.join(',')==='16,16,0,0'&&prepared.framebufferComplete,'RG16F真实FBO未确认');
   check(snapshot()===before&&r.getRenderTarget()===target,'准备污染GL状态');
   check(compact.aa._edgesRT===edgeIdentity&&edgeIdentity.texture===textureIdentity&&compact.aa._uniformsWeights.tDiffuse.value===textureIdentity,'边缘或uniform身份改变');
   check(compact.aa._weightsRT===weights&&weights.texture.type===T.HalfFloatType&&weights.texture.format===T.RGBAFormat,'修改了权重精度');
   check(prepared.logicalSavedBytes===edgeIdentity.width*edgeIdentity.height*4,'逻辑存储估算错误');
   for(const x of [original,compact])await x.aa.prepareBossOutput(r,match,x.output);
   const a=draw(original),b=draw(compact);let max=0,different=0;
   for(let i=0;i<a.data.length;i++){const d=Math.abs(a.data[i]-b.data[i]);max=Math.max(max,d);if(d)different++;}
   check(max===0,`最终像素差超限 ${max}`);check(a.calls===4&&b.calls===4,'三阶段或融合绘制数量改变');
   rows.push({w,h,ratio,tone,mode,angle,maxByteDifference:max,differentBytes:different});
  }
  compact.aa.clearBossEdges(match);const baseline=draw(original),restored=draw(compact);
  check(baseline.data.every((v,i)=>v===restored.data[i]),'恢复原格式后像素不一致');
  check(edgeIdentity.texture.format===T.RGBAFormat&&edgeIdentity.texture.type===T.HalfFloatType&&edgeIdentity.texture.internalFormat===null,'原格式恢复失败');
  await compact.aa.prepareBossEdges(r,match);check(compact.aa.syncBossEdges(match,'menu'),'menu/init预检误恢复');
  compact.aa.setSize(41.9,25.2);check(compact.aa.bossEdgesInfo().width===41&&compact.aa.bossEdgesInfo().height===25&&compact.aa.bossEdgesInfo().logicalSavedBytes===41*25*4,'resize尺寸或估算错误');
  match.state='playing';check(!compact.aa.syncBossEdges(match,'menu')&&!compact.aa.bossEdgesInfo().active,'普通菜单未恢复');
  for(const kind of ['pc','ordinary','attract']){globalThis.inkwaveMobile=kind==='pc'?false:{};const m=kind==='ordinary'?{boss:null}:kind==='attract'?{boss:{},attract:true}:match;check((await compact.aa.prepareBossEdges(r,m)).skipped,'PC/普通/演示未隔离');}
  globalThis.inkwaveMobile={};let current=true;const cancelled=await compact.aa.prepareBossEdges(r,match,{isCurrent:()=>current,yieldTurn:async()=>{current=false;}});
  check(cancelled.cancelled&&!compact.aa._edgeMatch&&edgeIdentity.texture.type===T.HalfFloatType,'取消后残留候选');
  let rejected=false;try{await compact.aa.prepareBossEdges(r,match,{yieldTurn:async()=>{throw Error('yield-failed');}});}catch{rejected=true;}
  check(rejected&&!compact.aa._edgeMatch,'让帧失败残留归属');
  let release;const old=compact.aa.prepareBossEdges(r,match,{yieldTurn:()=>new Promise(r=>release=r)}),newMatch={boss:{},state:'init'};
  await compact.aa.prepareBossEdges(r,newMatch);release();check((await old).cancelled&&compact.aa.bossEdgesInfo().active,'旧准备破坏新准备');
  compact.aa.clearBossEdges(match);check(compact.aa.bossEdgesInfo().active,'旧局清理误清新局');compact.aa.clearBossEdges(newMatch);
  const host=Object.assign(Object.create(Renderer.prototype),{renderer:r,mobileSafety:{},mobileAA:compact.aa,outputPass:compact.output,composer:compact.c,resize(){}});
  const gl=r.getContext(),status=gl.checkFramebufferStatus,target=r.getRenderTarget();gl.checkFramebufferStatus=()=>gl.FRAMEBUFFER_UNSUPPORTED;
  const fallback=await host.prepareMobileBossEdges(match);gl.checkFramebufferStatus=status;
  check(fallback.fallback&&edgeIdentity.texture.type===T.HalfFloatType&&r.getRenderTarget()===target,'不完整FBO未回原路径');
  await host.prepareMobileBossEdges(match);G.match=match;G.mode='match';G.env=null;host.render();check(compact.aa.bossEdgesInfo().active,'真实Renderer未保留Boss格式');
  G.mode='menu';host.render();check(!compact.aa.bossEdgesInfo().active&&edgeIdentity.texture.type===T.HalfFloatType,'真实Renderer退出未恢复');
  const disposed=new MobileSMAAPass();disposed.setSize(12,7);await disposed.prepareBossEdges(r,match);disposed.dispose();check(!disposed.bossEdgesInfo().active&&!disposed._edgeMatch,'销毁残留');
  check(gl.getError()===gl.NO_ERROR&&!errors.length,'WebGL或shader错误');
  for(const x of [original,compact]){x.aa.dispose();x.source.dispose();x.output.dispose();x.c.dispose();}r.dispose();
  return {cases:rows.length,maxByteDifference:Math.max(...rows.map(x=>x.maxByteDifference)),differentCases:rows.filter(x=>x.differentBytes).length,rows,
   checks:'真实RG16F FBO/位数、72组HDR/透明度/图案/DPR/色调像素、原身份/权重/绘制数量、resize/预检/菜单/PC隔离/取消/重叠准备/异常回退/真实Renderer/销毁通过'};
 });
 await writeFile('releases/investigation/mobile-boss-smaa-edges-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined}));
} finally {await browser.close();}
