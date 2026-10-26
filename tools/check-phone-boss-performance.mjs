// 真机Boss自动游玩：只操作输入，不改血量、人数、伤害、碰撞或模拟速度。
import {androidCDP} from './android-cdp.mjs';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
const duration=Number(process.env.BOSS_TEST_SECONDS||60),name=process.env.BOSS_TEST_NAME||'baseline';
const testWeapon=process.env.BOSS_TEST_WEAPON||'';
if(testWeapon&&!/^[a-z0-9_]+$/i.test(testWeapon))throw Error('测试武器名称无效');
const ablation=process.env.BOSS_GPU_ABLATION==='1';
const cpuAblation=process.env.BOSS_CPU_ABLATION==='1';
const uiAblation=process.env.BOSS_UI_ABLATION==='1';
const musicAblation=process.env.BOSS_MUSIC_ABLATION==='1';
const pannerAblation=process.env.BOSS_PANNER_ABLATION==='1';
const audioSuspend=process.env.BOSS_AUDIO_SUSPEND==='1';
const audioGraphBypass=process.env.BOSS_AUDIO_GRAPH_BYPASS==='1';
const audioReverbBypass=process.env.BOSS_AUDIO_REVERB_BYPASS==='1';
const verifyBossExit=process.env.BOSS_VERIFY_BOSS_EXIT==='1';
if(ablation&&process.env.BOSS_METHOD_PROBE!=='1')throw Error('分组遮蔽仅允许带探针调查轮');
if(cpuAblation&&(ablation||process.env.BOSS_METHOD_PROBE!=='1'))throw Error('CPU分组调查须开启方法探针且不能与渲染遮蔽同时运行');
if(uiAblation&&(ablation||cpuAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('UI分组须独占一分钟带探针调查轮');
if(musicAblation&&(ablation||cpuAblation||uiAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('音乐分组须独占一分钟带探针调查轮');
if(pannerAblation&&(ablation||cpuAblation||uiAblation||musicAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('声像器分组须独占一分钟带探针调查轮');
if(audioSuspend&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('音频挂起须独占一分钟带探针调查轮');
if(audioGraphBypass&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('音频图旁路须独占一分钟带探针调查轮');
if(audioReverbBypass&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('混响旁路须独占一分钟带探针调查轮');
if(verifyBossExit&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('退出恢复须独占无音画隔离的一分钟方法调查轮');
if(!Number.isFinite(duration)||duration<15||duration>3600||!/^[a-z0-9-]+$/i.test(name))throw Error('采样秒数须为15～3600，名称只允许英数字和连字符');
const c=await androidCDP(),path=`releases/investigation/phone-boss-${name}.json`;
const report={methodProbe:process.env.BOSS_METHOD_PROBE==='1',gpuAblation:ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,testWeapon,startedAt:new Date().toISOString(),requestedSeconds:duration,status:'running',intervals:[],timeline:[],device:{}};
await mkdir('releases/investigation',{recursive:true});
const save=()=>writeFile(path,JSON.stringify(report,null,2));
try{
 report.device.batteryBefore=c.command('shell','dumpsys','battery');
 report.device.thermalBefore=c.command('shell','dumpsys','thermalservice');
 let ready=false;
 for(let i=0;i<180;i++){
  const state=await c.evaluate('({ready:!!window.__inkwave?.mobile&&!__inkwave._building,suspended:!!window.__inkwave?.mobileSuspended,failed:!!document.getElementById("mobile-gpu-error")||document.getElementById("boot-error")?.style.display==="block"})');
  if(state.suspended||state.failed)throw Error('手机已安全暂停或启动失败，先排查日志，不强行开始对局');
  if(state.ready){ready=true;break}await new Promise(r=>setTimeout(r,1000));
 }
 if(!ready)throw Error('手机游戏未就绪');
 await c.evaluate(`(()=>{
  window.__phoneCleanup?.();
  const g=__inkwave;g._setSettings({fpsCap:30,mobileVisual:'hd',mobileDynamicResolution:false});
  const p=window.__phonePerf={intervals:[],activeMs:0,lastPlaying:false,rounds:0,actions:{move:0,fire:0,jump:0,sub:0,special:0,squid:0}};
  const record=g.mobile.recordFrame,frame=g._frame,restores=[];
  const audioSuspendEnabled=${audioSuspend},audioGraphBypassEnabled=${audioGraphBypass},audioReverbBypassEnabled=${audioReverbBypass};
  if(audioSuspendEnabled||audioGraphBypassEnabled){
   const audio=__G.audio;if(!audio)throw Error('音频引擎不存在');
   const noop={set(){},stop(){},playing:false};
   for(const [obj,key,fallback] of [[audio,'play',null],[audio,'loop',noop],[__G.music,'play',undefined]]){
    if(!obj)continue;const original=obj[key];obj[key]=function(...args){if(p.audioSuspendedForProbe||p.audioBypassedForProbe)return fallback;return original.apply(this,args)};restores.push(()=>obj[key]=original);
   }
   if(audioSuspendEnabled)restores.push(()=>{const ctx=audio.ctx;if(ctx?.state==='suspended')ctx.resume().catch(()=>{});});
  }
  const pannerAblationEnabled=${pannerAblation},pannerRefs=[],pannerModels=new WeakMap();
  if(pannerAblationEnabled){
   const audio=__G.audio,original=audio._panner;
   // 弱引用不延长已结束音源的生存期；只换声像算法，音量/距离衰减/音乐/音效均保留。
   audio._panner=function(...args){const node=original.apply(this,args);pannerModels.set(node,node.panningModel);pannerRefs.push(new WeakRef(node));
    if(p.pannerAblationPhase==='equalpower')node.panningModel='equalpower';return node;};
   restores.push(()=>{audio._panner=original;for(const ref of pannerRefs){const node=ref.deref();if(node)node.panningModel=pannerModels.get(node);}});
   p.pannerTransitions=[];
  }
  if(${JSON.stringify(testWeapon)}){const old=g.profile.weapon;g.profile.weapon=${JSON.stringify(testWeapon)};restores.push(()=>g.profile.weapon=old);}
  const musicAblationEnabled=${musicAblation},music=__G.music,musicPlay=music?.play;
  if(musicAblationEnabled){
   if(!musicPlay)throw Error('音乐引擎不存在，不能进行音乐隔离');
   music.play=function(track,...args){if(track!=null){p.musicWanted=track;if(p.musicAblationPhase==='music-stopped')return;}return musicPlay.call(this,track,...args);};
   restores.push(()=>{music.play=musicPlay;if(p.musicAblationPhase==='music-stopped'&&g.match?.state==='playing')musicPlay.call(music,p.musicWanted||'boss',{fade:0.03});});
  }
  const uiAblationEnabled=${uiAblation};
  let pauseStyle,flatStyle;
  if(uiAblationEnabled){
   // 只隔离浏览器HUD工作；不改变Canvas像素密度、物理或AI。调查结束移除整张临时样式。
   const roots=['.iw-hud.is-boss','.iw-hud-over.is-boss'];
   const selectors=roots.flatMap(s=>[s,s+' *',s+'::before',s+'::after',s+' *::before',s+' *::after']).join(',');
   const add=css=>{const s=document.createElement('style');s.media='not all';s.textContent=selectors+'{'+css+'}';document.head.appendChild(s);restores.push(()=>s.remove());return s;};
   pauseStyle=add('animation-play-state:paused!important;transition:none!important;');
   flatStyle=add('filter:none!important;backdrop-filter:none!important;box-shadow:none!important;text-shadow:none!important;');
  }
  const cpuAblationEnabled=${cpuAblation};
  if(cpuAblationEnabled){
   // 只做时间有限的工作量隔离，不改变物理/AI/人数；旧地图画面会暂时停更。
   const skip=(o,k,phase)=>{const fn=o[k];o[k]=function(...args){if(p.cpuAblationPhase===phase)return;return fn.apply(this,args)};restores.push(()=>o[k]=fn);};
   skip(g,'_updateHud','hud');skip(g.minimap,'update','minimap');skip(g.minimap,'_compose','map-composite');
   if(__G.audio)skip(__G.audio,'play','oneshot-audio');
  }
  // 仅诊断：按十秒阶段隐藏渲染组，碰撞/AI/血量仍正常；所有状态在finally恢复。
  const ablationEnabled=${ablation};
  const groups={sea:[__G.env?.sea],background:['city','terrain','staticScenery','ferris','trees','sailInst','gullInst'].map(k=>__G.env?.[k]),props:[g.props?.group]};
  const visibility=new Map(Object.values(groups).flat().filter(Boolean).map(o=>[o,o.visible]));
  const hudVisibility=g.hud.el.style.visibility;
  const restoreVisibility=()=>{for(const [o,v] of visibility)o.visible=v;g.hud.el.style.visibility=hudVisibility;};
  if(ablationEnabled){
   restores.push(restoreVisibility);
   const render=g.R.render;
   // 环境update会重设海面visible，必须在实际提交绘制前遮蔽，并在绘制后恢复。
   g.R.render=function(...args){
    const selected=(groups[p.ablationPhase]||[]).filter(Boolean),saved=selected.map(o=>o.visible);
    for(const o of selected)o.visible=false;
    p.ablationApplied=selected.map(o=>({name:o.name||o.type,visible:o.visible}));
    try{return render.apply(this,args)}finally{selected.forEach((o,i)=>o.visible=saved[i]);}
   };
   restores.push(()=>g.R.render=render);
  }
  // 可选方法级调查会增加计时开销，单独标记，不能混充无探针基线。
  if(${process.env.BOSS_METHOD_PROBE==='1'}){
   p.methods={};
   p.simulationStats={};p.slowMethods=[];p.newPrograms=[];
   const aggregate=(o,k,label,actor)=>{if(!o||typeof o[k]!=='function')return;const fn=o[k],row=p.simulationStats[label]??={calls:0,totalMs:0,maxMs:0};
    o[k]=function(...args){const start=performance.now();try{return fn.apply(this,args)}finally{
     if(p.match===g.match&&g.match?.state==='playing'){const ms=performance.now()-start;row.calls++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);
      if(ms>=20&&p.slowMethods.length<100)p.slowMethods.push({label,actor,ms,at:Date.now(),activeMs:p.activeMs});}
    }};restores.push(()=>o[k]=fn);
   };
   p.installMatchProbe=m=>{
    aggregate(m,'update','match');
    for(const a of m.actors){aggregate(a,'update','actor',a.name);aggregate(a.bot,'update','bot',a.name);aggregate(a.character,'update','character',a.name);aggregate(a.weaponRunner,'update','weapon',a.name);}
    aggregate(m.bossMode,'update','bossMode');aggregate(__G.projectiles,'update','projectiles');aggregate(__G.specials,'update','specials');
   };
   const renderer=g.R.renderer,direct=renderer.renderBufferDirect;
   renderer.renderBufferDirect=function(...args){const before=this.info.programs.length;const result=direct.apply(this,args);
    if(p.match===g.match&&g.match?.state==='playing'&&this.info.programs.length>before&&p.newPrograms.length<50){
     const material=args[3],object=args[4],owner=g.match.actors.find(a=>a.character?.root?.getObjectById(object.id));
     p.newPrograms.push({at:Date.now(),activeMs:p.activeMs,object:object?.name,parent:object?.parent?.name,material:material?.name,type:material?.type,
      owner:owner?{name:owner.name,weapon:owner.weaponId,local:owner.isLocal}:null,flags:{transparent:material?.transparent,depthWrite:material?.depthWrite,side:material?.side,alphaTest:material?.alphaTest,
       vertexColors:material?.vertexColors,skinned:!!object?.isSkinnedMesh,determinant:object?.matrixWorld.determinant(),colorSize:object?.geometry?.attributes.color?.itemSize},
      shaderHead:material?.isShaderMaterial?{vertex:material.vertexShader.slice(0,120),fragment:material.fragmentShader.slice(0,200)}:undefined,
      programs:this.info.programs.slice(before).map(v=>({id:v.id,name:v.name,cacheKey:String(v.cacheKey||'').slice(0,5000)}))});}
    return result;
   };restores.push(()=>renderer.renderBufferDirect=direct);
   const wrap=(o,k,label)=>{const fn=o[k],values=p.methods[label]=[];o[k]=function(...args){const start=performance.now();try{return fn.apply(this,args)}finally{if(values.length<10000)values.push(performance.now()-start)}};restores.push(()=>o[k]=fn);};
   for(const k of ['_updCrosshair','_updTank','_updSpecial','_updMap','_updMarkers','_updSquads','_updPrompt'])wrap(g.hud,k,k);
   wrap(g.hud.boss,'update','bossHud');
   // 同步诊断/存储/GL查询可能在战斗帧外阻塞，调查时单独计时，不计作正式成绩。
   wrap(g.R,'resize','rendererResize');
   wrap(window.inkwaveDiagnostics,'tick','diagnosticsTick');
   wrap(Storage.prototype,'setItem','storageWrite');
   wrap(g.R.renderer.getContext(),'getError','glGetError');
   wrap(g.minimap,'update','minimapUpdate');wrap(g.minimap,'_compose','minimapCompose');
   if(__G.audio){
    wrap(__G.audio,'play','audioPlay');
    const audio=__G.audio,play=audio.play;p.audioNames={};
    // 只在调查轮按名称汇总，不把每次节点列表写进日志，避免采样本身膨胀。
    audio.play=function(name,...args){const start=performance.now();let voice;try{return voice=play.call(this,name,...args)}finally{
     const row=p.audioNames[name]??={calls:0,played:0,nodes:0,totalMs:0,maxMs:0};
     const elapsed=performance.now()-start;row.calls++;row.totalMs+=elapsed;row.maxMs=Math.max(row.maxMs,elapsed);
     if(voice){row.played++;row.nodes+=voice.v.nodes.length;}
    }};restores.push(()=>audio.play=play);
   }
  }
  // 每帧在原输入控制器之前注入操作，仍经过正常物理和武器逻辑。
  g._frame=function(dt,...args){
   const m=g.match,a=m?.local,live=!!(p.match===m&&m?.boss&&m.state==='playing'&&!m.paused&&__G.mode==='match');
   if(audioSuspendEnabled&&live&&!p.audioSuspendedForProbe&&p.activeMs>=15000){p.audioSuspendedForProbe=true;const ctx=__G.audio.ctx;
    if(!ctx)p.audioSuspendError='战斗音频上下文未创建';else ctx.suspend().catch(e=>{p.audioSuspendError=String(e)});}
   if(audioGraphBypassEnabled&&live&&!p.audioBypassedForProbe&&p.activeMs>=15000){p.audioBypassedForProbe=true;
    const audio=__G.audio,ctx=audio.ctx;
    try{
     if(!ctx||ctx.state!=='running'||!audio.limiter)throw Error('旁路需要运行中的原始主限幅输出');
     audio.limiter.disconnect(ctx.destination);let tone,gain;
     // 立即登记恢复，后续创建失败也不能遗留断开的主输出；不暂停上下文。
     restores.push(()=>{if(tone){try{tone.stop()}catch{}tone.disconnect()}gain?.disconnect();audio.limiter.connect(ctx.destination)});
     tone=ctx.createOscillator();gain=ctx.createGain();tone.frequency.value=80;gain.gain.value=0.000001;
     tone.connect(gain);gain.connect(ctx.destination);tone.start();
    }catch(e){p.audioBypassError=String(e)}
   }
   if(audioReverbBypassEnabled&&live&&!p.reverbBypassedForProbe&&p.activeMs>=15000){p.reverbBypassedForProbe=true;
    try{
     const audio=__G.audio,music=__G.music,conv=music._nodes.find(n=>n instanceof ConvolverNode);
     if(!audio.conv||!conv)throw Error('未找到两条原始卷积混响');
     // 只断混响输入，保留全部干声、声像、音乐和限幅；原尾音自然结束，finally重接。
     audio.revSend.disconnect(audio.conv);restores.push(()=>audio.revSend.connect(audio.conv));
     music.revIn.disconnect(conv);restores.push(()=>music.revIn.connect(conv));
    }catch(e){p.audioBypassError=String(e)}
   }
   if(pannerAblationEnabled&&live){
    const phase=Math.floor(p.activeMs/15000)%2?'equalpower':'original';
    if(p.pannerAblationPhase!==phase){p.pannerAblationPhase=phase;const models={};
     for(const ref of pannerRefs){const node=ref.deref();if(!node)continue;node.panningModel=phase==='equalpower'?'equalpower':pannerModels.get(node);models[node.panningModel]=(models[node.panningModel]||0)+1;}
     p.pannerTransitions.push({activeMs:p.activeMs,phase,models});
    }
   }
   if(musicAblationEnabled&&live){
    const phase=Math.floor(p.activeMs/15000)%2?'music-stopped':'music-restored';
    if(p.musicAblationPhase!==phase){const previous=p.musicAblationPhase;p.musicAblationPhase=phase;
     if(phase==='music-stopped'){p.musicWanted=music.current?.id||p.musicWanted;musicPlay.call(music,null,{fade:0.03});}
     else if(previous==='music-stopped')musicPlay.call(music,p.musicWanted||'boss',{fade:0.03});
    }
   }
   if(uiAblationEnabled&&live){
    const phase=['baseline','animations-paused','baseline-restored','filters-flat','baseline-restored-2','animations-paused-2'][Math.min(5,Math.floor(p.activeMs/10000))];
    if(p.uiAblationPhase!==phase){pauseStyle.media=phase.startsWith('animations-paused')?'all':'not all';flatStyle.media=phase==='filters-flat'?'all':'not all';p.uiAblationPhase=phase;}
   }
   if(cpuAblationEnabled&&live)p.cpuAblationPhase=['baseline','minimap','hud','oneshot-audio','map-composite','baseline-restored'][Math.min(5,Math.floor(p.activeMs/10000))];
   if(ablationEnabled&&live){
    const phase=['baseline','sea','background','props','hud','baseline-restored'][Math.min(5,Math.floor(p.activeMs/10000))];
    if(p.ablationPhase!==phase){g.hud.el.style.visibility=phase==='hud'?'hidden':hudVisibility;p.ablationPhase=phase;}
   }
   if(live&&a?.alive){
    const t=p.activeMs/1000,cycle=t%18,b=m.boss;
    g.input.keys.clear();g.input.mouse.left=false;
    const dx=b.pos.x-a.pos.x,dz=b.pos.z-a.pos.z,dist=Math.hypot(dx,dz);
    g.rig.yaw=Math.atan2(dx,dz);g.rig.pitch=0.08;
    if(cycle>14){g.input.keys.add('ShiftLeft');p.actions.squid++;}
    else {g.input.mouse.left=true;p.actions.fire++;}
    // 接近后侧移，远处向前；周期跳跃/副武器/大招，绝不传送角色。
    if(dist>16)g.input.keys.add('KeyW');
    else {g.input.keys.add(Math.floor(t/6)%2?'KeyA':'KeyD');if(dist<8)g.input.keys.add('KeyS');}
    p.actions.move++;
    if(t%5<0.25){g.input.keys.add('Space');p.actions.jump++;}
    if(cycle>9&&cycle<9.25){g.input.keys.add('KeyE');p.actions.sub++;}
    if(cycle>12&&cycle<12.25){g.input.keys.add('KeyQ');p.actions.special++;}
   }else {g.input.keys.clear();g.input.mouse.left=false;}
   return frame.call(this,dt,...args);
  };
  // 只统计连续战斗帧，排除跨阶段间隔，保留战斗内全部慢帧。
  g.mobile.recordFrame=function(ms){
   const live=!!(p.match===g.match&&g.match?.boss&&g.match.state==='playing'&&!g.match.paused&&__G.mode==='match');
   if(live&&p.lastPlaying){p.intervals.push(ms);p.activeMs+=ms;}p.lastPlaying=live;
   return record.call(this,ms);
  };
  window.__phoneCleanup=()=>{for(const restore of [...restores].reverse())restore();g._frame=frame;g.mobile.recordFrame=record;g.input.keys.clear();g.input.mouse.left=false;delete window.__phoneCleanup;};
  // 用户要求每局1分钟；只改自动测试的对局参数，不改正式游戏默认时长。
  window.__phoneStart=()=>{p.rounds++;p.match=null;p.lastPlaying=false;window.__phoneStarted=null;g.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(v=>{__phoneStarted=v;if(v){p.match=g.match;p.installMatchProbe?.(g.match)}},e=>__phoneStarted=String(e));};
  __phoneStart();return true;
 })()`);
 const deadline=Date.now()+(duration+300)*1000;
 while(Date.now()<deadline){
  const sample=await c.evaluate(`(()=>{
   const g=__inkwave,m=g.match,a=m?.local,p=__phonePerf;
   const sample={at:Date.now(),state:m?.state,mode:__G.mode,boss:!!m?.boss,fps:g.fps,ratio:g.R.renderer.getPixelRatio(),scale:g.R.dynScale,
    activeMs:p.activeMs,rounds:p.rounds,ablationPhase:p.ablationPhase,cpuAblationPhase:p.cpuAblationPhase,uiAblationPhase:p.uiAblationPhase,musicAblationPhase:p.musicAblationPhase,pannerAblationPhase:p.pannerAblationPhase,audioSuspendedForProbe:p.audioSuspendedForProbe,audioSuspendError:p.audioSuspendError,audioBypassedForProbe:p.audioBypassedForProbe,reverbBypassedForProbe:p.reverbBypassedForProbe,audioBypassError:p.audioBypassError,ablationApplied:p.ablationApplied,started:__phoneStarted,actions:{...p.actions},position:a?{x:a.pos.x,y:a.pos.y,z:a.pos.z}:null,
    audio:${process.env.BOSS_METHOD_PROBE==='1'}?(()=>{
     const audio=__G.audio,stats=audio?.stats?.(),voicePanners={};let voiceNodes=0;
     // 只统计仍在播放的单发声道；弱引用历史节点数不能冒充当前DSP负载，循环数另列stats.loops。
     for(const v of audio?.voices||[]){if(v.v.dead||v.stolen)continue;const model=v.panner?.panningModel||'2d';voicePanners[model]=(voicePanners[model]||0)+1;voiceNodes+=v.v.nodes.length;}
     return {stats,voicePanners,voiceNodes,sampleRate:audio?.ctx?.sampleRate,baseLatency:audio?.ctx?.baseLatency,outputLatency:audio?.ctx?.outputLatency,music:__G.music?.current?.id,playerType:__G.music?.current?.constructor.name,players:__G.music?.players.length};
    })():undefined,
    timeLeft:m?.time,alive:a?.alive,ink:a?.ink,bossHp:m?.boss?.hp,actors:m?.actors.length,fire:a?.intent.fire,move:a?.intent.move?.length(),
    profile:g.mobile.profile.snapshot(),cpu:{...g.perf},calls:__G.renderer.info.render.calls,triangles:__G.renderer.info.render.triangles,
    intervals:p.intervals.splice(0)};
   if(m?.state==='results'&&${duration}>60&&p.activeMs<${duration}*1000)__phoneStart();return sample;
  })()`);
  const intervals=sample.intervals;delete sample.intervals;report.intervals.push(...intervals);report.timeline.push(sample);
  await save();console.log(JSON.stringify({state:sample.state,fps:sample.fps,ratio:sample.ratio,activeSeconds:Math.round(sample.activeMs/1000),position:sample.position,fire:sample.fire,actions:sample.actions}));
  if(sample.audioSuspendError)throw Error(sample.audioSuspendError);
  if(sample.audioBypassError)throw Error(sample.audioBypassError);
  if(sample.started!==null&&sample.started!==true)throw Error(`Boss启动失败：${sample.started}`);
  if(sample.started===true&&(!sample.boss||sample.actors!==8))throw Error('未进入真实8人Boss对局');
  if(sample.ratio!==2||sample.scale!==1)throw Error('实际渲染不满足固定2倍高清');
  // 一分钟短轮等游戏自然结束，不能采够60秒就让角色停在仍进行的对局里。
  report.roundCompleted=['finish','results'].includes(sample.state);
  if(duration===60?report.roundCompleted:sample.activeMs>=duration*1000)break;
  await new Promise(r=>setTimeout(r,2000));
 }
 const a=report.intervals.filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b),seconds=a.reduce((s,x)=>s+x,0)/1000;
 report.summary={frames:a.length,seconds,averageFps:a.length/seconds,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],over100:a.filter(x=>x>=100).length};
 if(!a.length||(seconds<duration&&!report.roundCompleted))throw Error('实际战斗采样时长不足');
 report.methods=await c.evaluate('window.__phonePerf.methods||null');
 report.audioNames=await c.evaluate('window.__phonePerf.audioNames||null');
 report.audioCache=await c.evaluate('window.__G?.audio?._bossSamples?.stats||null');
 report.reverbInfo=await c.evaluate('window.__G?.audio?._bossReverbInfo||null');
 report.simulationProbe=await c.evaluate('({stats:window.__phonePerf.simulationStats||null,slow:window.__phonePerf.slowMethods||[],newPrograms:window.__phonePerf.newPrograms||[]})');
 report.pannerTransitions=await c.evaluate('window.__phonePerf.pannerTransitions||null');
 report.diagnostics=await c.evaluate('inkwaveDiagnostics.report({probe:true})');
 const scene=report.diagnostics.current.scene;
 if(scene.render.antialias!=='SMAA'||report.diagnostics.current.shaderFailures.length||scene.mobileGpu?.fatal)throw Error('图形验收失败，不能将降级/错误帧当作正常性能');
 if(verifyBossExit){
  if(!report.reverbInfo?.active)throw Error('Boss短混响未启用，不能验证恢复');
  report.bossExit=await c.evaluate(`(async()=>{await __inkwave.quitToMenu();const a=__G.audio,c=__G.music._nodes.find(n=>n instanceof ConvolverNode);
   return {mode:__G.mode,boss:!!__inkwave.match?.boss,info:a._bossReverbInfo,sfxSeconds:a.conv.buffer.duration,musicSeconds:c.buffer.duration,sfxNormalize:a.conv.normalize,musicNormalize:c.normalize};})()`);
  const e=report.bossExit;e.ok=e.mode==='menu'&&!e.boss&&e.info?.active===false&&e.info.restored===2&&e.sfxSeconds===1.5&&e.musicSeconds===2.2&&e.sfxNormalize&&e.musicNormalize;
  if(!e.ok)throw Error('回菜单未完全恢复原混响');
 }
 // measured只代表采样完成；30分钟、原画质、移动/开火和尾部帧耗同时过门槛才标记稳定。
 report.stable30Validated=!report.methodProbe&&seconds>=1800&&report.summary.averageFps>=29.5&&report.summary.p95<=36&&report.summary.p99<=50&&report.summary.over100===0;
 report.device.batteryAfter=c.command('shell','dumpsys','battery');report.device.thermalAfter=c.command('shell','dumpsys','thermalservice');
 report.status='measured';console.log('SUMMARY',report.summary);
}catch(error){report.status='aborted';report.error=String(error);process.exitCode=1;console.error(error)}
finally{
 if(!report.diagnostics)report.diagnostics=await c.evaluate('inkwaveDiagnostics.report({probe:true})').catch(()=>null);
 await save();
 // 断线立即失败；恢复原方法，不将自动操作留给下一轮人工试玩。
 await c.evaluate('window.__phoneCleanup?.()').catch(()=>{});
 try{
  // 用户要求每轮上传确认落盘后关闭；直接驱动真实按钮，复用原生USB链路。
  const status=await c.evaluate(`(async()=>{const b=document.querySelector('#mobile-log-upload');if(!b)throw Error('上传按钮不存在');if(b.disabled)throw Error('已有上传尚未结束');b.click();for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,100));if(!b.disabled)return document.querySelector('#mobile-log-status')?.textContent;}throw Error('上传超时')})()`);
  if(!status?.includes('上传成功（USB）'))throw Error(status||'未收到USB保存回执');
  const filename=status.match(/INKWAVE-logs-[\w-]+\.json/)?.[0];if(!filename)throw Error('回执文件名无效');
  const uploaded=JSON.parse(await readFile(`releases/logs/${filename}`,'utf8'));
  if(uploaded.current.build.sourceCommit!==report.diagnostics?.current.build.sourceCommit)throw Error('落盘日志源码不匹配');
  report.upload={ok:true,filename};console.log('USB日志已确认保存',filename);
 }catch(error){report.upload={ok:false,error:String(error)};process.exitCode=1;console.error('上传未完成，电脑采样文件已保留',error)}
 c.close();
 try{
  c.command('shell','am','force-stop','com.demoink.inkwave');
  try{report.appClosed=!c.command('shell','pidof','com.demoink.inkwave').trim()}catch(error){if(error.status!==1)throw error;report.appClosed=true}
  if(!report.appClosed)throw Error('游戏进程仍在运行');
  console.log('本轮结束，游戏已关闭');
 }catch(error){report.appClosed=false;report.closeError=String(error);process.exitCode=1}
 await save();
}
