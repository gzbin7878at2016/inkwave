// 真实WebGL重现天空色污染边缘；以原库正确黑色清屏为参考，只修手机Boss，不改纹理精度。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-smaa-clear-test.html','<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/boss-smaa-clear-test.html');
 const report=await page.evaluate(async()=>{
  const T=await import('three'),{EffectComposer}=await import('three/addons/postprocessing/EffectComposer.js'),{ShaderPass}=await import('three/addons/postprocessing/ShaderPass.js'),{OutputPass}=await import('three/addons/postprocessing/OutputPass.js');
  const {MobileSMAAPass}=await import('/src/platform/mobileSMAAPass.js'),{Renderer}=await import('/src/core/renderer.js'),{G}=await import('/src/core/ctx.js');
  const {compareBossSmaaClear}=await import('/tools/compare-boss-smaa-clear.mjs');
  const check=(v,m)=>{if(!v)throw Error(m)},r=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}),errors=[];
  r.debug.onShaderError=()=>errors.push('shader');r.info.autoReset=false;globalThis.inkwaveMobile={};
  const match={boss:{},state:'playing'};G.match=match;G.mode='match';G.env=null;
  const shader={uniforms:{uMode:{value:-1},uAngle:{value:0},uSize:{value:new T.Vector2(1,1)}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`uniform float uMode,uAngle;uniform vec2 uSize;varying vec2 vUv;void main(){vec2 p=(vUv-.5)*uSize;float q=p.x*cos(uAngle)+p.y*sin(uAngle);float e=step(.17,q);if(uMode<.5)e=step(.6,fract(q*.37));else if(uMode>1.5)e=step(.5,fract(p.x*.19)*fract(p.y*.23)*2.);if(uMode<-.5){gl_FragColor=vec4(.2,.3,.4,1.);return;}gl_FragColor=vec4(mix(vec3(.012,.38,6.7),vec3(9.1,.023,.15),e),mix(.12,1.,step(.25,vUv.y)));}`};
  const make=()=>{const c=new EffectComposer(r,new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false})),source=new ShaderPass(shader),aa=new MobileSMAAPass(),output=new OutputPass();source.material.toneMapped=false;c.addPass(source);c.addPass(aa);c.addPass(output);return {c,source,aa,output};};
  const reference=make(),fixed=make();
  for(let i=0;i<100&&![reference,fixed].every(x=>x.aa._areaTexture.image.complete&&x.aa._searchTexture.image.complete);i++)await new Promise(r=>setTimeout(r,10));
  const state=()=>JSON.stringify({color:r.getClearColor(new T.Color()).toArray(),alpha:r.getClearAlpha(),auto:r.autoClear,colorAuto:r.autoClearColor,clear:fixed.aa.clear});
  const draw=(x,color,active)=>{r.setClearColor(color,1);x.aa.bossSmaaClear.active=active;x.aa.syncBossOutput(match,'match');r.info.reset();x.c.render();const gl=r.getContext(),data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);return {data,calls:r.info.render.calls};};
  const edgeSample=x=>{const data=new Uint16Array(x.aa._edgesRT.width*x.aa._edgesRT.height*4);r.readRenderTargetPixels(x.aa._edgesRT,0,0,x.aa._edgesRT.width,x.aa._edgesRT.height,data);let nonBinary=0,nonZero=0;
   for(let i=0;i<data.length;i+=4){const a=data[i]&32767,b=data[i+1]&32767;if(a||b)nonZero++;if((a!==0&&a!==15360)||(b!==0&&b!==15360))nonBinary++;}return {pixels:data.length/4,nonBinary,nonZero};};
  r.setSize(64,36);for(const x of [reference,fixed]){x.c.setSize(64,36);await x.aa.prepareBossOutput(r,match,x.output);}
  draw(reference,0x9fd8f0,false);const polluted=edgeSample(reference);draw(fixed,0x9fd8f0,true);const flatFixed=edgeSample(fixed);
  check(polluted.nonBinary===polluted.pixels&&flatFixed.nonZero===0,'没有重现平面图的天空色伪边缘或没有消除');
  const rows=[];
  for(const [w,h,ratio] of [[61,37,2],[83,51,1.5]])for(const tone of [T.NoToneMapping,T.ACESFilmicToneMapping])for(let mode=0;mode<3;mode++)for(let angle=0;angle<6;angle++){
   r.setPixelRatio(ratio);r.setSize(w,h);r.toneMapping=tone;r.toneMappingExposure=.71;r.outputColorSpace=T.SRGBColorSpace;
   for(const x of [reference,fixed]){x.c.setPixelRatio(ratio);x.c.setSize(w,h);x.source.uniforms.uMode.value=mode;x.source.uniforms.uAngle.value=angle*.2731;x.source.uniforms.uSize.value.set(w*ratio,h*ratio);await x.aa.prepareBossOutput(r,match,x.output);}
   const a=draw(reference,0x000000,false),b=draw(fixed,0x9fd8f0,true);let max=0;
   for(let i=0;i<a.data.length;i++)max=Math.max(max,Math.abs(a.data[i]-b.data[i]));
   check(max===0&&a.calls===4&&b.calls===4,'正确参考像素或三阶段/融合绘制数量不一致');check(edgeSample(fixed).nonBinary===0,'候选仍有非二值边缘');
   check(fixed.aa._edgesRT.texture.type===T.HalfFloatType&&fixed.aa._weightsRT.texture.type===T.HalfFloatType,'本批不应改精度');
   rows.push({w,h,ratio,tone,mode,angle,maxByteDifference:max});
  }
  // 与手机共用的调查函数只重绘同一HDR输入，结束后恢复冻结/清屏/Pass状态。
  match.state='finish';const fakeGame={R:{renderer:r,mobileAA:fixed.aa,composer:fixed.c},match,frozen:false},before=state();
  const actualComparison=compareBossSmaaClear(fakeGame);check(state()===before&&!fakeGame.frozen,'同输入比较改变状态');
  check(actualComparison.originalEdges.nonBinary>0&&actualComparison.fixedEdges.nonBinary===0&&actualComparison.maxGoldenByteDifference===0,'同输入比较未验证修复');
  for(const [label,m,mode,mobile,expected] of [['Boss',match,'match',true,true],['普通',{boss:null,state:'playing'},'match',true,false],['演示',{boss:{},attract:true,state:'playing'},'match',true,false],['菜单',match,'menu',true,false],['加载',{boss:{},state:'init'},'menu',true,true],['PC',match,'match',false,false]]){
   globalThis.inkwaveMobile=mobile;check(fixed.aa.syncBossSmaaClear(m,mode)===expected,label+'范围错误');
  }
  globalThis.inkwaveMobile={};fixed.aa.syncBossSmaaClear(match,'match');r.setClearColor(0x9fd8f0,.37);r.autoClear=false;r.autoClearColor=false;fixed.aa.clear=true;
  const saved=state(),actualRender=r.render;let n=0;r.render=function(...args){if(++n===2)throw Error('stage2-failed');return actualRender.apply(this,args);};let failed=false;
  try{fixed.aa.render(r,fixed.c.writeBuffer,fixed.c.readBuffer);}catch{failed=true;}finally{r.render=actualRender;}
  check(failed&&state()===saved,'异常未恢复清屏颜色/alpha/标志');
  check(r.getContext().getError()===r.getContext().NO_ERROR,'异常路径出现GL错误');r.setRenderTarget(null);
  // autoClear=false和clear=true也必须得到正确的空边缘，且不泄漏调用方标志。
  r.autoClear=true;r.autoClearColor=true;fixed.aa.clear=false;fixed.source.uniforms.uMode.value=-1;draw(fixed,0x9fd8f0,true);
  r.autoClear=false;r.autoClearColor=false;fixed.aa.clear=true;const saved2=state();fixed.aa.render(r,fixed.c.writeBuffer,fixed.c.readBuffer);check(edgeSample(fixed).nonZero===0&&state()===saved2,'手动清屏调用方没有得到零边缘');
  r.autoClear=true;r.autoClearColor=true;fixed.aa.clear=false;
  const host=Object.assign(Object.create(Renderer.prototype),{renderer:r,mobileSafety:{},mobileAA:fixed.aa,outputPass:fixed.output,composer:fixed.c,resize(){}});
  G.match=match;G.mode='match';host.render();check(fixed.aa.bossSmaaClear.active,'真实Renderer未启用');G.mode='menu';host.render();check(!fixed.aa.bossSmaaClear.active,'真实Renderer退出未恢复');
  check(r.getContext().getError()===r.getContext().NO_ERROR&&!errors.length,'GL或shader错误');
  for(const x of [reference,fixed]){x.aa.dispose();x.output.dispose();x.source.dispose();x.c.dispose();}r.dispose();
  return {polluted,flatFixed,cases:rows.length,maxByteDifference:0,actualComparison,checks:'天空色伪边缘重现/72组正确参考像素全等/纹理精度不变/原颜色及标志恢复/异常/手机调查同输入/PC普通菜单隔离/实际Renderer通过'};
 });
 await writeFile('releases/investigation/mobile-boss-smaa-clear-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
