// 原HDR输入、全尺寸SMAA与Output合并路径：多角度/尺寸/高亮图案比较RG8和HalfFloat边缘缓冲。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/smaa-edge-format.html','<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/smaa-edge-format.html');
 const report=await page.evaluate(async()=>{
  const T=await import('three'),{EffectComposer}=await import('three/addons/postprocessing/EffectComposer.js'),{ShaderPass}=await import('three/addons/postprocessing/ShaderPass.js'),{OutputPass}=await import('three/addons/postprocessing/OutputPass.js'),{MobileSMAAPass}=await import('/src/platform/mobileSMAAPass.js'),{compareBossSmaaEdges:compare}=await import('/tools/compare-boss-smaa-edges.mjs');
  const r=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}),c=new EffectComposer(r,new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false})),aa=new MobileSMAAPass(),output=new OutputPass(),match={boss:{},state:'finish'},cases=[];
  const source=new ShaderPass({uniforms:{uMode:{value:0},uAngle:{value:0},uSize:{value:new T.Vector2()}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform float uMode,uAngle;uniform vec2 uSize;varying vec2 vUv;void main(){vec2 p=(vUv-.5)*uSize;float q=p.x*cos(uAngle)+p.y*sin(uAngle);float edge=step(.173,q);if(uMode<.5)edge=step(.62,fract(q*.37));else if(uMode>1.5)edge=step(.5,fract(p.x*.19)*fract(p.y*.23)*2.);gl_FragColor=vec4(mix(vec3(.012,.38,6.7),vec3(9.1,.023,.15),edge),mix(.12,1.,step(.25,vUv.y)));}'});
  source.material.toneMapped=false;c.addPass(source);c.addPass(aa);c.addPass(output);window.inkwaveMobile={};
  try{
   for(let i=0;i<100&&!(aa._areaTexture.image.complete&&aa._searchTexture.image.complete);i++)await new Promise(r=>setTimeout(r,10));
   await aa.prepareBossOutput(r,match,output);aa.syncBossOutput(match,'match');aa.syncBossSmaaClear(match,'match');r.setClearColor(0x9fd8f0);r.autoClearColor=false;
   for(const compact of [{format:T.RGFormat,type:T.UnsignedByteType,internalFormat:"RG8",expectedBits:[8,8,0,0]},{format:T.RGFormat,type:T.HalfFloatType,internalFormat:"RG16F",expectedBits:[16,16,0,0]}])for(const [w,h]of [[96,64],[137,73],[256,144]])for(const mode of [0,1,2])for(const angle of [0,.37,1.16]){
    r.setSize(w,h);c.setSize(w,h);source.uniforms.uMode.value=mode;source.uniforms.uAngle.value=angle;source.uniforms.uSize.value.set(w,h);c.render();
    const result=compare({R:{renderer:r,composer:c,mobileAA:aa},match,frozen:false},compact);cases.push({mode,angle,...result});
    if(result.maxByteDifference||result.nonBinary||!result.restored)throw Error('RG8像素/二值/恢复不一致：'+JSON.stringify(cases.at(-1)));
   }
   return {cases:cases.length,maxDifference:Math.max(...cases.map(x=>x.maxByteDifference)),nonZeroEdgeSamples:cases.reduce((n,x)=>n+x.nonZero,0),allRestored:cases.every(x=>x.restored),performanceTest:false};
  }finally{aa.dispose();c.dispose();output.dispose();source.dispose();r.dispose();delete window.inkwaveMobile;}
 });console.log(JSON.stringify(report));await writeFile('releases/investigation/smaa-edge-format-browser.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
