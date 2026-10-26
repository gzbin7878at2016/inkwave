import {readFile} from 'node:fs/promises';

// 自包含、仅结算冻结副本；不改可见LOD/骨骼/玩法，不是手机实战FPS。
export function benchmarkBossHiddenLod(game,G){
  const r=G.renderer,gl=r.getContext(),scene=G.scene,savedFrozen=game.frozen;
  if(!game.match?.boss||gl.drawingBufferWidth*gl.drawingBufferHeight>1600000||r.getRenderTarget())throw Error('Boss副本像素/绘制目标条件不满足');
  const started=performance.now(),checkTime=()=>{if(performance.now()-started>15000)throw Error('隐藏LOD副本超过15秒预算');};
  const parents=new Map(),removed=[];let active=false;
  for(const actor of game.match.actors){const c=actor.character;for(const set of c.lodSets)for(const mesh of set?.list||[]){
   if(mesh.visible)continue;
   if(!mesh.isSkinnedMesh||mesh.children.length||mesh.parent!==c.kid)throw Error('不支持的隐藏LOD结构');
   if(!parents.has(c.kid))parents.set(c.kid,[...c.kid.children]);removed.push({mesh,parent:c.kid});
  }}
  const enable=()=>{if(active)return;for(const {mesh,parent}of removed)if(mesh.visible||mesh.parent!==parent)throw Error('隐藏状态已改变');active=true;for(const {mesh,parent}of removed)parent.remove(mesh);};
  const disable=()=>{if(!active)return;for(const {mesh,parent}of removed)parent.add(mesh);for(const [parent,children]of parents){if(parent.children.length!==children.length||parent.children.some(c=>!children.includes(c)))throw Error('副本期间场景结构改变');parent.children.splice(0,parent.children.length,...children);}active=false;};
  const difference=(a,b)=>{let max=0,changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;max=Math.max(max,d);}return{max,changed};};
  const snapshot=()=>{const values=[];scene.traverseVisible(o=>values.push(...o.matrixWorld.elements));for(const a of game.match.actors){a.character.skeleton.update();values.push(...a.character.skeleton.boneMatrices);}return values;};
  const draw=()=>{checkTime();game.R.render();const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return{bytes,matrices:snapshot()};};
  try{
   game.frozen=true;for(let i=0;i<3;i++)game.R.render();const a0=draw(),a=draw();enable();const b=draw(),b2=draw();disable();const after=draw();
   const pixels={reference:difference(a0.bytes,a.bytes),candidate:difference(a.bytes,b.bytes),repeat:difference(b.bytes,b2.bytes),restored:difference(a.bytes,after.bytes)};
   const matrices={candidate:difference(a.matrices,b.matrices),restored:difference(a.matrices,after.matrices)};
   const timings=[];
   for(const enabled of [false,true,true,false,false,true,true,false]){
    checkTime();enabled?enable():disable();for(let i=0;i<20;i++)scene.updateMatrixWorld();
    const start=performance.now();for(let i=0;i<200;i++)scene.updateMatrixWorld();timings.push({enabled,iterations:200,totalMs:performance.now()-start});
   }
   disable();const restored=[...parents].every(([p,children])=>children.every((c,i)=>p.children[i]===c));
   if(!restored||gl.getError()!==gl.NO_ERROR)throw Error('恢复或GL检查失败');
   return{performanceTest:false,removed:removed.length,pixels,matrices,timings,restored,matched:[...Object.values(pixels),...Object.values(matrices)].every(x=>!x.max),renderer:gl.getParameter(gl.RENDERER)};
  }finally{try{disable();}finally{game.frozen=savedFrozen;}}
}

export async function runPhoneBossHiddenLod(c){
 const build=JSON.parse((await readFile('releases/android-build-info.json','utf8')).replace(/^\uFEFF/,''));
 const current=await c.evaluate('({build:inkwaveDiagnostics.report().current.build,state:__inkwave.match?.state,boss:!!__inkwave.match?.boss})');
 if(!current.boss||!['finish','results'].includes(current.state)||current.build.sourceCommit!==build.sourceCommit||current.build.trackedChanges)throw Error('必须自然结算且安装源码匹配当前干净构建');
 const result=await c.evaluate(`(${benchmarkBossHiddenLod.toString()})(__inkwave,__G)`);
 if(!result.matched||!result.restored)throw Error('隐藏LOD矩阵或像素/恢复不一致：'+JSON.stringify(result));
 return result;
}
