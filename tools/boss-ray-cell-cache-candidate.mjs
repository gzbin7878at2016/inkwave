// 工具级候选：只复用静态哈希候选id顺序，不改精确碰撞。返回列表仅供原raycast只读遍历。
export function createBossRayCellCacheCandidate(level){
 let hash=level.hash;const original=level.queryBlocks,cache=new Map();let bytes=0;
 const maxEntries=256,maxBytes=65536;
 const stats={queries:0,singleCell:0,hits:0,misses:0,largeBypass:0,resets:0,evictions:0,entries:0,bytes:0};
 const queryBounds=(minX,minZ,maxX,maxZ,out)=>{
  stats.queries++;
  if(hash!==level.hash){cache.clear();hash=level.hash;bytes=0;stats.resets++;stats.entries=0;stats.bytes=0;}
  const x0=level._hxi(minX),x1=level._hxi(maxX),z0=level._hzi(minZ),z1=level._hzi(maxZ);
  if(!Number.isFinite(x0+x1+z0+z1)||x0>x1||z0>z1)return original.call(level,minX,minZ,maxX,maxZ,out);
  // 每个块在同一个格子仅登记一次，直接读原cell即与原去重后的顺序完全一致。
  if(x0===x1&&z0===z1){stats.singleCell++;return hash[z0*level.hw+x0];}
  // 实战大多是一至四格；长射线矩形低复用，直接走原路避免Map/复制/淘汰开销。
  if((x1-x0+1)*(z1-z0+1)>4){stats.largeBypass++;return original.call(level,minX,minZ,maxX,maxZ,out);}
  const cells=level.hw*level.hd,key=(z0*level.hw+x0)*cells+z1*level.hw+x1;
  if(!Number.isSafeInteger(key))return original.call(level,minX,minZ,maxX,maxZ,out);
  const saved=cache.get(key);if(saved){stats.hits++;return saved;}
  stats.misses++;const ids=original.call(level,minX,minZ,maxX,maxZ,out);
  if(ids.length*4<=maxBytes){
   while(cache.size&&(cache.size>=maxEntries||bytes+ids.length*4>maxBytes)){const key=cache.keys().next().value;bytes-=cache.get(key).byteLength;cache.delete(key);stats.evictions++;}
   const copy=Int32Array.from(ids);cache.set(key,copy);bytes+=copy.byteLength;
  }
  stats.entries=cache.size;stats.bytes=bytes;return ids;
 };
 const query=(o,d,max,out)=>{const ex=o.x+d.x*max,ez=o.z+d.z*max;return queryBounds(Math.min(o.x,ex),Math.min(o.z,ez),Math.max(o.x,ex),Math.max(o.z,ez),out);};
 return{query,queryBounds,stats,get controlBytes(){return bytes;}};
}
