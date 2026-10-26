// 只在调查局自然结算后使用同一HDR输入比较；不推进模拟、不换分辨率、不计入FPS成绩。
// 函数可通过toString在手机执行，不依赖外部模块。
export function compareBossSmaaClear(game) {
  const aa=game.R.mobileAA,r=game.R.renderer,c=game.R.composer,gl=r.getContext();
  if(!aa?.bossSmaaClear?.active||!['finish','results'].includes(game.match?.state))throw Error('需要结算后的Boss清零候选');
  const input=[c.renderTarget1,c.renderTarget2].find(rt=>rt.texture===aa._uniformsBlend.tColor.value);
  if(!input)throw Error('找不到同一SMAA HDR输入');
  const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
  if(width*height>4000000)throw Error('像素比较超过有界预算');
  const color=aa._bossClearColor.clone();r.getClearColor(color);
  const viewport=input.viewport.clone(),scissor=input.scissor.clone();r.getViewport(viewport);r.getScissor(scissor);
  const saved={target:r.getRenderTarget(),face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),test:r.getScissorTest(),alpha:r.getClearAlpha(),
   auto:r.autoClear,color:r.autoClearColor,clear:aa.clear,screen:aa.renderToScreen,active:aa.bossSmaaClear.active,frozen:game.frozen};
  const sample=()=>{const w=Math.min(96,aa._edgesRT.width),h=Math.min(64,aa._edgesRT.height),data=new Uint16Array(w*h*4);
   r.readRenderTargetPixels(aa._edgesRT,Math.floor((aa._edgesRT.width-w)/2),Math.floor((aa._edgesRT.height-h)/2),w,h,data);
   let nonBinary=0,nonZero=0;for(let i=0;i<data.length;i+=4){const a=data[i]&32767,b=data[i+1]&32767;if(a||b)nonZero++;if((a!==0&&a!==15360)||(b!==0&&b!==15360))nonBinary++;}
   return {pixels:w*h,nonBinary,nonZero};};
  const draw=(active,black)=>{aa.bossSmaaClear.active=active;r.setClearColor(black?0x000000:color,black?0:saved.alpha);
   r.autoClear=black?true:saved.auto;r.autoClearColor=black?true:saved.color;aa.clear=black?false:saved.clear;
   aa.render(r,c.writeBuffer,input);const data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return {data,edges:sample()};};
  try {
   game.frozen=true;aa.renderToScreen=true;
   const original=draw(false,false),fixed=draw(true,false),golden=draw(false,true);
   let maxGolden=0,changedBytes=0,maxOriginal=0;
   for(let i=0;i<fixed.data.length;i++){maxGolden=Math.max(maxGolden,Math.abs(fixed.data[i]-golden.data[i]));const d=Math.abs(fixed.data[i]-original.data[i]);maxOriginal=Math.max(maxOriginal,d);if(d)changedBytes++;}
   if(maxGolden!==0||fixed.edges.nonBinary)throw Error(`未匹配正确清零参考：像素差${maxGolden}，非二值边缘${fixed.edges.nonBinary}`);
   if(gl.getError()!==gl.NO_ERROR)throw Error('SMAA像素比较出现WebGL错误');
   return {performanceTest:false,width,height,sourceType:input.texture.type,clearColor:color.toArray(),autoClear:saved.auto,autoClearColor:saved.color,
    originalEdges:original.edges,fixedEdges:fixed.edges,goldenEdges:golden.edges,maxGoldenByteDifference:maxGolden,changedBytes,maxOriginalByteDifference:maxOriginal};
  } finally {
   game.frozen=saved.frozen;aa.bossSmaaClear.active=saved.active;aa.renderToScreen=saved.screen;aa.clear=saved.clear;
   r.setClearColor(color,saved.alpha);r.autoClear=saved.auto;r.autoClearColor=saved.color;
   r.setRenderTarget(saved.target,saved.face,saved.mip);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(saved.test);
  }
}
