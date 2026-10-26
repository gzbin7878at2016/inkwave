// 仅结算后同一HDR输入比较边缘格式；权重/HDR/全尺寸/算法保持，finally恢复原目标和GL状态。
export function compareBossSmaaEdges(game,compact){
 const aa=game.R.mobileAA,r=game.R.renderer,c=game.R.composer,gl=r.getContext();
 if(!aa?.bossSmaaClear?.active||!aa.bossOutput?.enabled||!['finish','results'].includes(game.match?.state))throw Error('需要结算后的完整Boss SMAA路径');
 const input=[c.renderTarget1,c.renderTarget2].find(t=>t.texture===aa._uniformsBlend.tColor.value);if(!input)throw Error('找不到HDR输入');
 const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;if(width*height>4000000)throw Error('像素比较超过预算');
 const original=aa._edgesRT,weights=aa._weightsRT,edgeUniform=aa._uniformsWeights.tDiffuse.value,candidate=original.clone();
 for(const key of ['format','type','internalFormat'])candidate.texture[key]=compact[key];candidate.texture.name='BossEdgesFormatProbe';
 const viewport=input.viewport.clone(),scissor=input.scissor.clone(),color=aa._bossClearColor.clone();r.getViewport(viewport);r.getScissor(scissor);r.getClearColor(color);
 const saved={target:r.getRenderTarget(),face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),test:r.getScissorTest(),alpha:r.getClearAlpha(),screen:aa.renderToScreen,material:aa._fsQuad.material,frozen:game.frozen,textures:r.info.memory.textures};
 const draw=()=>{aa.render(r,c.writeBuffer,input);const data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
 let report;
 try{
  if(gl.getError()!==gl.NO_ERROR)throw Error('比较前已有WebGL错误');game.frozen=true;aa.renderToScreen=true;
  const golden=draw();r.setRenderTarget(candidate);
  const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER),bits=['RED','GREEN','BLUE','ALPHA'].map(k=>gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl[`FRAMEBUFFER_ATTACHMENT_${k}_SIZE`]));
  if(status!==gl.FRAMEBUFFER_COMPLETE||bits.join(',')!==(compact.expectedBits||[8,8,0,0]).join(','))throw Error(`${compact.internalFormat} FBO不可用：${status}/${bits}`);
  aa._edgesRT=candidate;aa._uniformsWeights.tDiffuse.value=candidate.texture;const result=draw();
  let maxByteDifference=0,changedBytes=0;for(let i=0;i<result.length;i++){const delta=Math.abs(result[i]-golden[i]);maxByteDifference=Math.max(maxByteDifference,delta);if(delta)changedBytes++;}
  r.setRenderTarget(candidate);
  // 使用WebGL规定的RGBA读取组合；底层驱动公布RG并不代表WebGL验证层接受RG读取。
  const readFormat=gl.RGBA,readType=compact.internalFormat==='RG16F'?gl.FLOAT:gl.UNSIGNED_BYTE;
  const channels=readFormat===gl.RGBA?4:readFormat===gl.RG?2:0;
  const ArrayType=readType===gl.FLOAT?Float32Array:readType===gl.HALF_FLOAT?Uint16Array:readType===gl.UNSIGNED_BYTE?Uint8Array:null;
  if(!channels||!ArrayType)throw Error(`不支持驱动读取组合${readFormat}/${readType}`);
  const flags=new ArrayType(original.width*original.height*channels),one=readType===gl.FLOAT?1:readType===gl.HALF_FLOAT?15360:255;
  gl.readPixels(0,0,original.width,original.height,readFormat,readType,flags);
  let nonBinary=0,nonZero=0;for(let i=0;i<flags.length;i+=channels){if(flags[i]||flags[i+1])nonZero++;if((flags[i]!==0&&flags[i]!==one)||(flags[i+1]!==0&&flags[i+1]!==one))nonBinary++;}
  const readError=gl.getError();if(readError!==gl.NO_ERROR)throw Error(`${compact.internalFormat}读取${readFormat}/${readType}产生WebGL错误${readError}`);
  report={performanceTest:false,compactFormat:compact.internalFormat,width,height,edgeWidth:original.width,edgeHeight:original.height,originalFormat:original.texture.format,originalType:original.texture.type,componentBits:bits,readFormat,readType,maxByteDifference,changedBytes,nonBinary,nonZero,weightsUnchanged:aa._weightsRT===weights,estimatedBytesSaved:original.width*original.height*(compact.internalFormat==='RG16F'?4:6)};
 }finally{
  aa._edgesRT=original;aa._uniformsWeights.tDiffuse.value=edgeUniform;aa.renderToScreen=saved.screen;aa._fsQuad.material=saved.material;game.frozen=saved.frozen;
  r.setClearColor(color,saved.alpha);r.setRenderTarget(saved.target,saved.face,saved.mip);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(saved.test);candidate.dispose();
 }
 report.restored=aa._edgesRT===original&&aa._uniformsWeights.tDiffuse.value===edgeUniform&&aa._weightsRT===weights;
 report.texturesAfter=r.info.memory.textures;return report;
}
