// 工具副本：保留原Mesh/材质/着色器/索引顺序，通过公开WEBGL_multi_draw提交原可见区段。
// 依赖已检查的Three r186 renderBufferDirect零数量仍建立绑定；其他版本拒绝启用，不能静默猜测。
export function createBossPropRangeCandidate(T,sources,{renderer,cellSize=8,maxBytes=2*1024*1024}={}){
 if(T.REVISION!=='186')throw Error('未验证的Three版本，保留原绘制');
 if(!renderer||!Number.isFinite(cellSize)||cellSize<4||!Number.isFinite(maxBytes)||maxBytes<=0)throw Error('缺少渲染器或网格/预算无效');
 const gl=renderer.getContext(),ext=renderer.extensions.get('WEBGL_multi_draw');
 if(typeof ext?.multiDrawElementsWEBGL!=='function')throw Error('设备没有WEBGL_multi_draw，保留原绘制');
 const plans=new Map(),stats={active:false,disposed:false,triangles:0,chunks:0,runs:0,controlTypedBytes:0,geometryBytes:0,textureBytes:0,draws:0,nativeCalls:0,lastRanges:0};
 const original=renderer.renderBufferDirect,frustum=new T.Frustum(),vp=new T.Matrix4(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),zeroGroup={start:0,count:0};
 for(const source of sources){
  const g=source.geometry,p=g?.attributes.position,idx=g?.index;
  if(!p||!idx||g.groups.length||Object.keys(g.morphAttributes).length||source.isInstancedMesh||source.isSkinnedMesh||!source.material?.isMeshStandardMaterial||source.material.transparent)throw Error('只支持原静态不透明完整桶');
  const bpe=idx.array.BYTES_PER_ELEMENT;if(![2,4].includes(bpe)||idx.count%3||idx.count*bpe>2147483647)throw Error('索引范围不支持');
  const cells=[],byCell=new Map(),runs=[];let last=-1;
  for(let i=0;i<idx.count;i+=3){
   const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];if(ids.some(n=>!Number.isInteger(n)||n<0||n>=p.count))throw Error('原索引无效');
   a.fromBufferAttribute(p,ids[0]).applyMatrix4(source.matrixWorld);b.fromBufferAttribute(p,ids[1]).applyMatrix4(source.matrixWorld);c.fromBufferAttribute(p,ids[2]).applyMatrix4(source.matrixWorld);
   const x=(a.x+b.x+c.x)/(3*cellSize),z=(a.z+b.z+c.z)/(3*cellSize);if(!Number.isFinite(x+z))throw Error('原位置非有限');
   const key=Math.floor(x)+','+Math.floor(z);let id=byCell.get(key);
   if(id===undefined){id=cells.length;byCell.set(key,id);cells.push(new T.Box3());}
   cells[id].expandByPoint(a).expandByPoint(b).expandByPoint(c);
   if(id===last)runs[runs.length-2]+=3;else{runs.push(i,3,id);last=id;}
  }
  for(const box of cells)box.expandByScalar(.01); // 给CPU/GPU投影舍入留1厘米保守边界，不裁切原三角形。
  const runData=Int32Array.from(runs),n=runs.length/3,counts=new Int32Array(n),offsets=new Int32Array(n),visible=new Uint8Array(cells.length),world=Float64Array.from(source.matrixWorld.elements);
  stats.controlTypedBytes+=runData.byteLength+counts.byteLength+offsets.byteLength+visible.byteLength+world.byteLength;
  if(stats.controlTypedBytes>maxBytes)throw Error('区段控制缓冲超预算，保留原绘制');
  plans.set(source,{g,p,idx,material:source.material,positionVersion:p.version,indexVersion:idx.version,bpe,cells,runs:runData,counts,offsets,visible,world});
  stats.triangles+=idx.count/3;stats.chunks+=cells.length;stats.runs+=n;
 }
 let culling=true;
 const hook=function(camera,scene,geometry,material,object,group){
  const p=plans.get(object);
  if(!stats.active||stats.disposed||!p||group!=null||geometry!==p.g||material!==p.material||material.transparent||material.wireframe||scene?.overrideMaterial||geometry.drawRange.start!==0||geometry.drawRange.count!==Infinity||geometry.attributes.position!==p.p||geometry.index!==p.idx||p.p.version!==p.positionVersion||p.idx.version!==p.indexVersion||p.world.some((n,i)=>n!==object.matrixWorld.elements[i]))return original.call(this,camera,scene,geometry,material,object,group);
  let count=0,total=0;
  if(!culling){p.counts[0]=p.idx.count;p.offsets[0]=0;count=1;total=p.idx.count;}
  else{
   frustum.setFromProjectionMatrix(vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),camera.coordinateSystem,camera.reversedDepth);
   for(let i=0;i<p.cells.length;i++)p.visible[i]=frustum.intersectsBox(p.cells[i])?1:0;
   for(let i=0;i<p.runs.length;i+=3){const start=p.runs[i],n=p.runs[i+1];if(!p.visible[p.runs[i+2]])continue;
    if(count&&p.offsets[count-1]+p.counts[count-1]*p.bpe===start*p.bpe)p.counts[count-1]+=n;
    else{p.offsets[count]=start*p.bpe;p.counts[count]=n;count++;}total+=n;
   }
  }
  stats.draws++;stats.lastRanges=count;
  if(!count)return;
  // 零数量原调用只建立完全相同的program/VAO/索引/材质状态；不改原geometry.drawRange。
  original.call(this,camera,scene,geometry,material,object,zeroGroup);
  ext.multiDrawElementsWEBGL(gl.TRIANGLES,p.counts,0,p.bpe===4?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT,p.offsets,0,count);
  // 原零数量调用已计一次API调用；补上实际multiDraw，三角数按真正提交的索引累计。
  renderer.info.render.calls++;renderer.info.render.triangles+=total/3;stats.nativeCalls++;
 };
 renderer.renderBufferDirect=hook;
 return {stats,entries:[...plans.keys()].map(source=>({source})),setCullingEnabled(value){culling=!!value;},enable(){if(stats.disposed)throw Error('副本已释放');stats.active=true;},disable(){stats.active=false;},dispose(){if(stats.disposed)return;stats.active=false;stats.disposed=true;if(renderer.renderBufferDirect===hook)renderer.renderBufferDirect=original;plans.clear();}};
}
