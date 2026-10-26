// 工具级候选：只缩小raycast的宽相列表，slab求交继续调用原函数。
// 按原queryBlocks首次遇到的格子及块id排序，保留相同距离时“后者覆盖”的原规则。
export function createBossRayQueryCandidate(level){
 const hash=level.hash,blocks=level.blocks,cs=level.hashCell,hw=level.hw,hd=level.hd;
 if(!Array.isArray(hash)||!Array.isArray(blocks)||!(cs>0)||!Number.isInteger(hw)||!Number.isInteger(hd))throw Error('空间哈希结构不支持');
 const minX=new Int32Array(blocks.length),minZ=new Int32Array(blocks.length),stamp=new Uint32Array(blocks.length),order=new Float64Array(blocks.length);
 for(let i=0;i<blocks.length;i++){if(blocks[i].id!==i)throw Error('块id顺序不支持');minX[i]=level._hxi(blocks[i].aabbMin.x);minZ[i]=level._hzi(blocks[i].aabbMin.z);}
 let epoch=0;const stats={queries:0,fallbacks:0,rectangleCells:0,visitedCells:0,candidates:0};
 const original=level.queryBlocks;
 const query=(origin,dir,maxDist,out)=>{
  const ex=origin.x+dir.x*maxDist,ez=origin.z+dir.z*maxDist;
  const lowX=Math.min(origin.x,ex),highX=Math.max(origin.x,ex),lowZ=Math.min(origin.z,ez),highZ=Math.max(origin.z,ez);
  const x0=level._hxi(lowX),x1=level._hxi(highX),z0=level._hzi(lowZ),z1=level._hzi(highZ),cells=(x1-x0+1)*(z1-z0+1);
  stats.queries++;stats.rectangleCells+=cells;
  if(level.hash!==hash||level.blocks!==blocks||blocks.length!==stamp.length||maxDist<0||!Number.isFinite(maxDist)||![lowX,highX,lowZ,highZ].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6)||cells<12){
   stats.fallbacks++;stats.visitedCells+=cells;const result=original.call(level,lowX,lowZ,highX,highZ,out);stats.candidates+=result.length;return result;
  }
  out.length=0;if(++epoch>=4294967295){stamp.fill(0);epoch=1;}
  // 哈希最外行代表被clamp到边缘的全部外侧空间；不能简单裁掉地图外的射线。
  const eps=1e-9*(1+Math.abs(origin.x)+Math.abs(ex)+Math.abs(origin.z)+Math.abs(ez));
  for(let z=z0;z<=z1;z++){
   let t0=0,t1=maxDist;
   if(dir.z!==0){
    const low=z===0?-Infinity:level.hz0+z*cs-eps,high=z===hd-1?Infinity:level.hz0+(z+1)*cs+eps;
    const a=(low-origin.z)/dir.z,b=(high-origin.z)/dir.z;t0=Math.max(0,Math.min(a,b));t1=Math.min(maxDist,Math.max(a,b));
    if(t0>t1)continue;
   }
   const a=origin.x+dir.x*t0,b=origin.x+dir.x*t1;
   const start=Math.max(x0,level._hxi(Math.min(a,b)-eps)),end=Math.min(x1,level._hxi(Math.max(a,b)+eps));
   for(let x=start;x<=end;x++){
    stats.visitedCells++;const cell=hash[z*hw+x];
    for(let i=0;i<cell.length;i++){const id=cell[i];if(stamp[id]===epoch)continue;stamp[id]=epoch;
     order[id]=(Math.max(z0,minZ[id])*hw+Math.max(x0,minX[id]))*(blocks.length+1)+id;out.push(id);
    }
   }
  }
  out.sort((a,b)=>order[a]-order[b]);stats.candidates+=out.length;return out;
 };
 return{query,stats,controlBytes:minX.byteLength+minZ.byteLength+stamp.byteLength+order.byteLength};
}
