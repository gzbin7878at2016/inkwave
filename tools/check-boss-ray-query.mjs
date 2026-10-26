// 用真实Level/Physics核对宽相候选：旋转盒、边界、外侧哈希clamp及等距命中必须逐字段一致。
import assert from 'node:assert/strict';
import * as T from 'three';
import {Level} from '../src/world/level.js';
import {Physics,Hit} from '../src/game/physics.js';
import {MAP_LAYOUTS} from '../src/world/maps.js';
import {createBossRayQueryCandidate} from './boss-ray-query-candidate.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
let seed=1741;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const defs=[];for(let i=0;i<160;i++)defs.push({kind:'obox',center:[rng()*180-90,rng()*10-3,rng()*180-90],size:[.1+rng()*14,.1+rng()*8,.1+rng()*14],rotY:rng()*360,grate:i%7===0,solid:i%19!==0});
// 完全重合盒保证相同距离时仍选择原遍历顺序的最后一个，覆盖id次序规则。
defs.push({kind:'box',min:[-2,-2,-2],max:[2,2,2]},{kind:'box',min:[-2,-2,-2],max:[2,2,2]});
const synthetic={bounds:{minX:-40,maxX:40,minZ:-40,maxZ:40},spawnPads:[[0,0,0],[1,0,0]],single:defs,half:[]};
const reports=[];
for(const [name,layout]of [['synthetic',synthetic],['tidewater',MAP_LAYOUTS.tidewater]]){
 const level=new Level(layout),physics=new Physics(level),candidate=createBossRayQueryCandidate(level),original=level.queryBlocks;
 const rays=[];
 for(let i=0;i<5000;i++){const o=new T.Vector3(rng()*240-120,rng()*22-6,rng()*240-120),d=new T.Vector3(rng()*2-1,rng()*.8-.4,rng()*2-1).normalize();rays.push([o,d,rng()*250,i%2===0]);}
 for(const x of [-200,-48,-44,-4,0,4,44,48,200])for(const z of [-200,-48,0,48,200])for(const d of [[1,0,0],[0,0,1],[0,-1,0],[1e-14,0,1],[1,0,1]])rays.push([new T.Vector3(x,3,z),new T.Vector3(...d).normalize(),400,false]);
 rays.push([new T.Vector3(-30,0,0),new T.Vector3(1,0,0),60,false]);
 const run=(ray,optimized,out)=>{const[o,d,max,skip]=ray;if(optimized)level.queryBlocks=(_a,_b,_c,_d,ids)=>candidate.query(o,d,max,ids);try{return physics.raycast(o,d,max,out,skip);}finally{level.queryBlocks=original;}};
 const snap=h=>[h.hit,h.dist,h.block,h.face,...h.point,...h.normal,h.u,h.v];
 for(let i=0;i<rays.length;i++){const a=new Hit(),b=new Hit();a.u=b.u=17;a.v=b.v=19;assert.deepEqual(snap(run(rays[i],false,a)),snap(run(rays[i],true,b)),`${name} ray ${i}`);}
 const timing=[],out=new Hit();for(const optimized of [false,true,true,false,false,true,true,false]){const start=performance.now();for(const ray of rays)run(ray,optimized,out);timing.push({optimized,rays:rays.length,totalMs:performance.now()-start});}
 reports.push({name,rays:rays.length,blocks:level.blocks.length,controlBytes:candidate.controlBytes,stats:{...candidate.stats},timing});
}
await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/boss-ray-query-node.json',JSON.stringify({matched:true,performanceTest:false,reports},null,2));console.log(JSON.stringify({matched:true,performanceTest:false,reports}));
