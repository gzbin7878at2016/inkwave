import {readFile} from 'node:fs/promises';
import {createBossRayQueryCandidate} from './boss-ray-query-candidate.mjs';

// 结算后回放真实采集的射线，只调用原Physics，不推进战斗；候选只改宽相候选列表。
export function benchmarkBossRayQuery(game,G,records,create){
 if(!game.match?.boss||records.length<100||records.length>6000)throw Error('Boss射线样本数不满足100～6000');
 const physics=G.physics,level=physics.level,original=level.queryBlocks,savedFrozen=game.frozen;
 const begin=performance.now(),check=()=>{if(performance.now()-begin>15000)throw Error('射线副本超过15秒预算');};
 const candidate=create(level),rays=records.map(a=>({o:G.camera.position.clone().set(...a.slice(0,3)),d:G.camera.position.clone().set(...a.slice(3,6)),max:a[6],skip:a[7]}));
 const hit=()=>({hit:false,dist:0,point:G.camera.position.clone().set(0,0,0),normal:G.camera.position.clone().set(0,0,0),block:-1,face:-1,u:17,v:19});
 let current,enabled=false,originalCandidates=0;
 const hook=function(...args){if(enabled)return candidate.query(current.o,current.d,current.max,args[4]);const ids=original.apply(this,args);originalCandidates+=ids.length;return ids;};
 const run=(ray,out)=>{current=ray;return physics.raycast(ray.o,ray.d,ray.max,out,ray.skip);};
 const snapshot=h=>[h.hit,h.dist,h.block,h.face,h.point.x,h.point.y,h.point.z,h.normal.x,h.normal.y,h.normal.z,h.u,h.v];
 try{
  game.frozen=true;level.queryBlocks=hook;const a=hit(),b=hit();
  for(let i=0;i<rays.length;i++){
   if(i%256===0)check();enabled=false;const reference=snapshot(run(rays[i],a));enabled=true;const actual=snapshot(run(rays[i],b));
   if(reference.some((n,j)=>!Object.is(n,actual[j])))throw Error('射线命中不一致：'+JSON.stringify({index:i,ray:records[i],reference,actual}));
  }
  const proof={originalCandidates,candidateCandidates:candidate.stats.candidates,stats:{...candidate.stats}};
  const timings=[],out=hit();for(const mode of [false,true,true,false,false,true,true,false]){
   enabled=mode;check();for(let i=0;i<Math.min(300,rays.length);i++)run(rays[i],out);
   const start=performance.now();for(const ray of rays)run(ray,out);timings.push({enabled:mode,queries:rays.length,totalMs:performance.now()-start});
  }
  return{performanceTest:false,matched:true,queries:rays.length,blocks:level.blocks.length,controlBytes:candidate.controlBytes,proof,timings};
 }finally{try{level.queryBlocks=original;}finally{game.frozen=savedFrozen;}}
}

export async function runPhoneBossRayQuery(c){
 const build=JSON.parse((await readFile('releases/android-build-info.json','utf8')).replace(/^\uFEFF/,''));
 const state=await c.evaluate('({build:inkwaveDiagnostics.report().current.build,boss:!!__inkwave.match?.boss,state:__inkwave.match?.state})');
 if(!state.boss||!['finish','results'].includes(state.state)||state.build.sourceCommit!==build.sourceCommit||state.build.trackedChanges)throw Error('射线副本必须自然结算且安装源码匹配干净构建');
 return c.evaluate(`(${benchmarkBossRayQuery.toString()})(__inkwave,__G,__phonePerf.rayQueries,(${createBossRayQueryCandidate.toString()}))`);
}
