// 工具级副本：完整三角形按空间分组后，用公开BatchedMesh接口批量提交；不接入产品加载。
export function createBossPropBatchCandidate(T,sources,{cellSize=8,maxBytes=32*1024*1024,groupMode='cells'}={}){
 if(!Number.isFinite(cellSize)||cellSize<4||!Number.isFinite(maxBytes)||maxBytes<=0)throw Error('剔除网格或预算无效');
 if(!['cells','none','runs'].includes(groupMode))throw Error('分组模式无效');
 const entries=[],stats={groupMode,triangles:0,chunks:0,vertices:0,geometryBytes:0,textureBytes:0,attributesChecked:0,active:false,disposed:false};
 const dispose=()=>{if(stats.disposed)return;for(const e of entries){if(stats.active)e.source.visible=e.visible;e.batch.removeFromParent();e.batch.dispose();}stats.active=false;stats.disposed=true;};
 try{
  for(const source of sources){
   const g=source.geometry,p=g?.attributes.position,idx=g?.index,mat=source.material;
   if(!p||!idx||g.groups.length||g.drawRange.start!==0||g.drawRange.count!==Infinity||Object.keys(g.morphAttributes).length||!mat?.isMeshStandardMaterial||mat.transparent)throw Error('只支持原完整不透明静态Standard/Physical索引桶');
   const attrs=Object.entries(g.attributes);
   if(attrs.some(([,a])=>a.isInterleavedBufferAttribute||a.count!==p.count))throw Error('属性布局暂不支持，保留原几何');
   const cells=new Map(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let lastCell=null,run=-1;
   for(let i=0;i<idx.count;i+=3){
    const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];
    if(ids.some(id=>!Number.isInteger(id)||id<0||id>=p.count))throw Error('原索引无效');
    a.fromBufferAttribute(p,ids[0]).applyMatrix4(source.matrixWorld);b.fromBufferAttribute(p,ids[1]).applyMatrix4(source.matrixWorld);c.fromBufferAttribute(p,ids[2]).applyMatrix4(source.matrixWorld);
    const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3;if(!Number.isFinite(x+z))throw Error('原位置含非有限值');
    const spatial=Math.floor(x/cellSize)+','+Math.floor(z/cellSize);
    if(spatial!==lastCell){lastCell=spatial;run++;}
    // none用于隔离batch着色路径；runs保持原始全局三角形次序，区分空间合并带来的顺序差异。
    const key=groupMode==='none'?'all':groupMode==='runs'?String(run):spatial;let cell=cells.get(key);
    if(!cell)cells.set(key,cell={indices:[],vertices:new Map()});
    for(const id of ids){if(!cell.vertices.has(id))cell.vertices.set(id,cell.vertices.size);cell.indices.push(id);}
   }
   const groups=[...cells.values()],vertices=groups.reduce((n,c)=>n+c.vertices.size,0),indices=idx.count;
   const predicted=vertices*attrs.reduce((n,[,a])=>n+a.itemSize*a.array.BYTES_PER_ELEMENT,0)+indices*4;
   if(stats.geometryBytes+stats.textureBytes+predicted>maxBytes)throw Error('候选额外几何超过逻辑预算');
   const batch=new T.BatchedMesh(groups.length,vertices,indices,mat),geometryIds=[],instanceIds=[];
   entries.push({source,batch,geometryIds,instanceIds,parent:source.parent,visible:source.visible});
   batch.name='boss-batch:'+source.name;batch.userData.bossPropBatch=true;batch.sortObjects=false;batch.perObjectFrustumCulled=true;batch.frustumCulled=false;
   batch.matrixAutoUpdate=false;batch.matrix.copy(source.matrix);batch.castShadow=source.castShadow;batch.receiveShadow=source.receiveShadow;batch.renderOrder=source.renderOrder;batch.layers.mask=source.layers.mask;
   for(const group of groups){
    const part=new T.BufferGeometry();
    try{
     for(const [name,attr] of attrs){
      const data=new attr.array.constructor(group.vertices.size*attr.itemSize);
      for(const [oldId,newId] of group.vertices)for(let k=0;k<attr.itemSize;k++)data[newId*attr.itemSize+k]=attr.array[oldId*attr.itemSize+k];
      const copy=new T.BufferAttribute(data,attr.itemSize,attr.normalized);copy.gpuType=attr.gpuType;copy.setUsage(attr.usage);part.setAttribute(name,copy);
     }
     part.setIndex(new T.BufferAttribute(Uint32Array.from(group.indices,id=>group.vertices.get(id)),1));
     part.computeBoundingBox();part.computeBoundingSphere();
     const id=batch.addGeometry(part),range=batch.getGeometryRangeAt(id);geometryIds.push(id);instanceIds.push(batch.addInstance(id));
     // 检查真正装入batch后的数据，而非只检查中间副本；包括原始整数/归一化属性和索引方向。
     for(const [oldId,newId] of group.vertices)for(const [name,attr] of attrs){
      const out=batch.geometry.getAttribute(name);if(out.normalized!==attr.normalized||out.array.constructor!==attr.array.constructor)throw Error('属性格式改变');
      for(let k=0;k<attr.itemSize;k++){if(!Object.is(out.array[(range.vertexStart+newId)*attr.itemSize+k],attr.array[oldId*attr.itemSize+k]))throw Error('属性内容改变');stats.attributesChecked++;}
     }
     for(let i=0;i<group.indices.length;i++)if(batch.geometry.index.getX(range.indexStart+i)!==range.vertexStart+group.vertices.get(group.indices[i]))throw Error('三角形次序或索引改变');
    }finally{part.dispose();}
    group.indices=null;group.vertices.clear();
   }
   // Renderer用整体包围球中心排序同材质不透明物体；保留原中心，避免与原扇叶等实例件顺序变化。
   // 逐组视锥仍使用各自完整三角形的边界，不用这个整体球替代空间剔除。
   if(!g.boundingSphere)g.computeBoundingSphere();batch.boundingSphere=g.boundingSphere.clone();
   if(!g.boundingBox)g.computeBoundingBox();batch.boundingBox=g.boundingBox.clone();
   const bytes=Object.values(batch.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+batch.geometry.index.array.byteLength;
   // 只读审计内部纹理尺寸，不改内部结构；所有构建和实例操作均走公开API。
   const textures=[batch._matricesTexture,batch._indirectTexture,batch._colorsTexture].filter(Boolean).reduce((n,t)=>n+t.image.data.byteLength,0);
   stats.geometryBytes+=bytes;stats.textureBytes+=textures;stats.vertices+=vertices;stats.triangles+=indices/3;stats.chunks+=groups.length;
   if(stats.geometryBytes+stats.textureBytes>maxBytes)throw Error('候选几何和矩阵/间接纹理超过逻辑预算');
  }
  return {entries,stats,enable(){if(stats.disposed)throw Error('候选已释放');for(const e of entries)if(e.source.parent!==e.parent)throw Error('原场景身份已变更');for(const e of entries){e.source.visible=false;e.batch.visible=e.visible;e.parent?.add(e.batch);}stats.active=true;},disable(){if(stats.disposed)return;for(const e of entries){e.source.visible=e.visible;e.batch.removeFromParent();}stats.active=false;},dispose};
 }catch(error){dispose();throw error;}
}
