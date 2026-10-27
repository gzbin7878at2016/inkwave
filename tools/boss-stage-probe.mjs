// 独立方法轮分层墙钟计时：父层扣除已追踪子层，固定容量记录；不改变dt、返回值或异常。
export function createBossStageProbe(game, G, {detail=false}={}) {
 const limit=48,capacity=4096,rows=[],restores=[],seen=new WeakMap();
 const starts=new Float64Array(64),children=new Float64Array(64),ids=new Int16Array(64);
 let depth=0,active=false,frames=0,start=0,activeMs=0,dt=0,overflow=false,disposed=false;
 const slow=[],loafs=[],specialEvents=[];
 const id=label=>{let n=rows.findIndex(r=>r.label===label);if(n>=0)return n;if(rows.length>=limit)throw Error('阶段计数预算超限');
  n=rows.length;rows.push({label,calls:0,total:0,self:0,max:0,frame:0,frameSelf:0,frameCalls:0,inclusive:new Float32Array(capacity),exclusive:new Float32Array(capacity)});return n;};
 const enter=n=>{if(!active)return;if(depth>=64)throw Error('阶段嵌套预算超限');ids[depth]=n;starts[depth]=performance.now();children[depth]=0;depth++;};
 const leave=()=>{if(!active)return;const t=performance.now();depth--;const n=ids[depth],ms=t-starts[depth],own=Math.max(0,ms-children[depth]),r=rows[n];
  if(depth)children[depth-1]+=ms;r.calls++;r.frameCalls++;r.total+=ms;r.self+=own;r.max=Math.max(r.max,ms);r.frame+=ms;r.frameSelf+=own;return ms;};
 const wrap=(o,k,label)=>{if(!o||typeof o[k]!=='function')return;let keys=seen.get(o);if(!keys){keys=new Set();seen.set(o,keys);}if(keys.has(k))return;keys.add(k);
  const fn=o[k],n=id(label);o[k]=function(...args){if(!active)return fn.apply(this,args);enter(n);try{return fn.apply(this,args)}finally{const ms=leave();
   if(label==='actor_startSpecial'&&specialEvents.length<32)specialEvents.push({at:Date.now(),activeMs,name:o.name,specialId:o.specialId,local:!!o.isLocal,ms});}};
  restores.push(()=>o[k]=fn);
 };
 const driver=id('testDirector'),frame=id('gameFrame');
 for(const [o,k,label] of [[game.mobile,'update','inputMobile'],[G.net,'update','network'],[G.projectiles,'update','projectiles'],[G.subs,'update','subWeapons'],
  [G.specials,'update','specials'],[G.fx,'update','effects'],[game.fxHooks,'update','fxHooks'],[game.screenfx,'update','screenFx'],[G.env,'update','environment'],
  [game.decor,'update','decor'],[game.props,'update','props'],[game.rig,'update','camera'],[G.paint,'flush','paintFlush'],[game.R,'render','renderSubmit'],
  [game,'_updateHud','hud'],[game.menus,'update','menus'],[globalThis.inkwaveDiagnostics,'tick','diagnostics']])wrap(o,k,label);
 if(detail){wrap(G.audio,'play','audioPlay');wrap(G.subs,'blockActor','actorBlock');wrap(G.specials,'start','specialStart');}
 let observer=null;
 if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('long-animation-frame')){
  observer=new PerformanceObserver(list=>{if(disposed||!game.match?.boss||game.match.state!=='playing')return;for(const e of list.getEntries()){
   if(!e.duration||!e.scripts?.length||loafs.length>=100)continue;
   loafs.push({epoch:performance.timeOrigin+e.startTime,duration:e.duration,blockingDuration:e.blockingDuration,renderStart:e.renderStart,
    styleAndLayoutStart:e.styleAndLayoutStart,scripts:e.scripts.slice(0,6).map(s=>({duration:s.duration,executionStart:s.executionStart,
     forcedStyleAndLayoutDuration:s.forcedStyleAndLayoutDuration,invoker:s.invoker,sourceFunctionName:s.sourceFunctionName,sourceURL:s.sourceURL?.slice(0,180)}))});
  }});observer.observe({type:'long-animation-frame',buffered:false});
 }
 const stats=a=>{const x=Array.from(a.subarray(0,Math.min(frames,capacity))).sort((a,b)=>a-b);return {p50:x[Math.floor((x.length-1)*.5)]||0,p95:x[Math.floor((x.length-1)*.95)]||0,p99:x[Math.floor((x.length-1)*.99)]||0};};
 return {
  bind(m){wrap(m,'updateController','controller');wrap(m,'update','match');for(const a of m.actors){wrap(a,'update','actors');wrap(a.bot,'update','bots');wrap(a.character,'update','characters');wrap(a.weaponRunner,'update','weapons');}
   if(detail)for(const a of m.actors){for(const k of ['_surface','_updateClimb','_horizontal','_integrate','_spawnBarrier','_finishFrame','_events','respawn','_startSpecial','_updateSpecial','_updateSuperJump'])wrap(a,k,'actor'+k);wrap(a.character,'trigger','characterTrigger');}
   const b=m.boss;wrap(m.bossMode,'update','bossMode');wrap(b,'update','boss');wrap(b?.brain,'update','bossBrain');wrap(b?.model,'update','bossModel');wrap(b?.hz,'update','bossHazards');},
  begin(live,ms,delta){active=!!live;if(!active)return;activeMs=ms;dt=delta;depth=0;start=performance.now();for(const r of rows){r.frame=r.frameSelf=r.frameCalls=0;}},
  enterDriver(){enter(driver);},enterGame(){enter(frame);},leave,
  end(){if(!active)return;const elapsed=performance.now()-start;if(depth)throw Error('阶段栈未平衡');
   if(frames<capacity){for(const r of rows){r.inclusive[frames]=r.frame;r.exclusive[frames]=r.frameSelf;}}else overflow=true;
   if(elapsed>=33){const sample={at:Date.now(),activeMs,dt,elapsed,stages:rows.filter(r=>r.frameCalls).map(r=>({label:r.label,ms:r.frame,selfMs:r.frameSelf,calls:r.frameCalls}))};
    if(slow.length<32)slow.push(sample);else{let n=0;for(let i=1;i<slow.length;i++)if(slow[i].elapsed<slow[n].elapsed)n=i;if(sample.elapsed>slow[n].elapsed)slow[n]=sample;}}
   frames++;active=false;},
  summary(){return {frames,overflow,detail,scope:'JS墙钟，含抢占/GC/驱动等待；inclusive有嵌套，不可相加；self仅扣除已追踪子层，非纯CPU。',
   rows:rows.map(r=>({label:r.label,calls:r.calls,totalMs:r.total,selfMs:r.self,maxCallMs:r.max,meanMs:r.total/Math.max(1,frames),meanSelfMs:r.self/Math.max(1,frames),perFrame:stats(r.inclusive),selfPerFrame:stats(r.exclusive)})),
   slow:slow.slice().sort((a,b)=>b.elapsed-a.elapsed),specialEvents,loafSupported:!!observer,loafs};},
  dispose(){if(disposed)return;disposed=true;active=false;observer?.disconnect();for(const restore of restores.reverse())restore();}
 };
}
