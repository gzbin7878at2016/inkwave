// 真机Boss自动游玩：只操作输入，不改血量、人数、伤害、碰撞或模拟速度。
import {androidCDP} from './android-cdp.mjs';
import {createBossPlaybackDirector} from './boss-playback-director.mjs';
import {runPhoneBossPropRanges} from './phone-prop-range-benchmark.mjs';
import {runPhoneBossHiddenLod} from './phone-hidden-lod-benchmark.mjs';
import {runPhoneBossRayQuery} from './phone-ray-query-benchmark.mjs';
import {runPhoneBossCoat} from './phone-boss-coat-benchmark.mjs';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {benchmarkBossMinimapKernel} from './boss-minimap-kernel-benchmark.mjs';
import {computeMinimapInkBand} from './minimap-band-kernel.mjs';
import {createMinimapBandWorker,applyMinimapBand} from './minimap-band-worker.mjs';
import {benchmarkMinimapWorker} from './minimap-worker-benchmark.mjs';
import {benchmarkMinimapWorkerPipeline} from './minimap-worker-pipeline.mjs';
import {compareBossSmaaClear} from './compare-boss-smaa-clear.mjs';
import {createBossDomProbe} from './boss-dom-probe.mjs';
import {createBossWorkerLoadProbe} from './boss-worker-load-probe.mjs';
import {createBossStageProbe} from './boss-stage-probe.mjs';
import {probeBossWeaponConstruction} from './boss-weapon-construction-probe.mjs';
import {createBossLayerHintProbe} from './boss-layer-hint-probe.mjs';
import {createBossMarkerVarProbe} from './boss-marker-var-probe.mjs';
import {createBossNativePaintProbe} from './boss-native-paint-probe.mjs';
import {compareBossSmaaEdges} from './compare-boss-smaa-edges.mjs';
import {RGFormat,UnsignedByteType,HalfFloatType} from 'three';
const duration=Number(process.env.BOSS_TEST_SECONDS||60),name=process.env.BOSS_TEST_NAME||'baseline';
// 对照轮显式选择帧率上限；默认仍30，不修改产品默认值或降清晰度。
const fpsCap=Number(process.env.BOSS_TEST_FPS||30);
if(![30,60].includes(fpsCap))throw Error('BOSS_TEST_FPS只允许30或60');
const testWeapon=process.env.BOSS_TEST_WEAPON||'';
const propRangeBenchmark=process.env.BOSS_PROP_RANGE_BENCHMARK==='1';
const hiddenLodBenchmark=process.env.BOSS_HIDDEN_LOD_BENCHMARK==='1';
const rayQueryBenchmark=process.env.BOSS_RAY_QUERY_BENCHMARK==='1';
const coatBenchmark=process.env.BOSS_COAT_BENCHMARK==='1';
// 仅独立方法轮通过原暂停/继续入口验证Worker恢复，不把暂停轮当帧率成绩。
const verifyWorkerRecovery=process.env.BOSS_VERIFY_WORKER_RECOVERY==='1';
if(verifyWorkerRecovery&&(process.env.BOSS_METHOD_PROBE!=='1'||process.env.BOSS_VERIFY_BOSS_EXIT!=='1'||duration!==60||coatBenchmark||propRangeBenchmark||hiddenLodBenchmark||rayQueryBenchmark))throw Error('Worker暂停恢复仅供一分钟独立方法轮并验证离局恢复');
if(coatBenchmark&&(propRangeBenchmark||hiddenLodBenchmark||rayQueryBenchmark||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('清漆对照须独占一分钟Boss方法轮自然结算');
if(rayQueryBenchmark&&!['rows','cache'].includes(process.env.BOSS_RAY_QUERY_KIND||'rows'))throw Error('射线副本类型只支持rows/cache');
if(rayQueryBenchmark&&(propRangeBenchmark||hiddenLodBenchmark||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('射线副本须独占一分钟方法轮');
if(hiddenLodBenchmark&&(propRangeBenchmark||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('隐藏LOD副本须独占一分钟方法轮自然结算');
if(propRangeBenchmark&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('区段副本仅允许一分钟方法轮自然结算后执行');
const playbackMode=process.env.BOSS_PLAYBACK||'director';
if(!['director','legacy'].includes(playbackMode))throw Error('BOSS_PLAYBACK只允许director/legacy');
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
const verifyDisplayLifecycle=process.env.BOSS_VERIFY_DISPLAY_LIFECYCLE==='1';
const domAblation=process.env.BOSS_DOM_ABLATION==='1';
const layerHints=process.env.BOSS_LAYER_HINTS==='1';
const markerVars=process.env.BOSS_MARKER_VAR_PROBE==='1';
const nativePaint=process.env.BOSS_NATIVE_PAINT_PROBE==='1';
if(nativePaint&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||markerVars||layerHints||domAblation||verifyDisplayLifecycle||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||process.env.BOSS_COMPARE_SMAA_CLEAR==='1'||process.env.BOSS_MINIMAP_BENCHMARK==='1'))throw Error('原生装饰动画分档仅供完整HUD一分钟独立方法轮');
if(markerVars&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||layerHints||domAblation||verifyDisplayLifecycle||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||process.env.BOSS_COMPARE_SMAA_CLEAR==='1'||process.env.BOSS_MINIMAP_BENCHMARK==='1'))throw Error('标签距离变量调查仅供完整HUD一分钟独立方法轮');
if(layerHints&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||domAblation||verifyDisplayLifecycle||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||process.env.BOSS_COMPARE_SMAA_CLEAR==='1'||process.env.BOSS_MINIMAP_BENCHMARK==='1'))throw Error('图层提示仅供完整HUD一分钟独立方法调查');
const domPart=process.env.BOSS_DOM_PART||'all';
if(!['all','bar','special','markers','map','top','crosshair','controls','panel'].includes(domPart))throw Error('BOSS_DOM_PART须为all/bar/special/markers/map/top/crosshair/controls/panel');
if(domAblation&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||verifyBossExit||verifyDisplayLifecycle||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||process.env.BOSS_COMPARE_SMAA_CLEAR==='1'||process.env.BOSS_MINIMAP_BENCHMARK==='1'))throw Error('DOM隔离仅允许独占一分钟方法调查，不能作正式成绩或混用其他旁路');
if(verifyDisplayLifecycle&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||!verifyBossExit||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass))throw Error('显示生命周期仅允许一分钟独立方法调查，并验证正常退出');
const minimapBenchmark=process.env.BOSS_MINIMAP_BENCHMARK==='1';
const minimapWorkerBenchmark=process.env.BOSS_MINIMAP_WORKER_BENCHMARK==='1';
const minimapWorkerPipeline=process.env.BOSS_MINIMAP_WORKER_PIPELINE==='1';
const minimapWorkerPipelinePhase=process.env.BOSS_MINIMAP_WORKER_PIPELINE_PHASE||'finish';
if(!['finish','playing'].includes(minimapWorkerPipelinePhase))throw Error('流水线阶段须为finish/playing');
const compareSmaaClear=process.env.BOSS_COMPARE_SMAA_CLEAR==='1';
const compareSmaaEdges=process.env.BOSS_COMPARE_SMAA_EDGES==='1';
if(propRangeBenchmark&&[ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,verifyDisplayLifecycle,domAblation,layerHints,markerVars,nativePaint,minimapBenchmark,minimapWorkerBenchmark,minimapWorkerPipeline,compareSmaaClear,compareSmaaEdges].some(Boolean))throw Error('区段副本须独占自然结算后的方法调查，不能混用其他旁路/比较');
if(hiddenLodBenchmark&&[ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,verifyDisplayLifecycle,domAblation,layerHints,markerVars,nativePaint,minimapBenchmark,minimapWorkerBenchmark,minimapWorkerPipeline,compareSmaaClear,compareSmaaEdges].some(Boolean))throw Error('隐藏LOD副本不能混用其他旁路或比较');
if(rayQueryBenchmark&&[ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,verifyDisplayLifecycle,domAblation,layerHints,markerVars,nativePaint,minimapBenchmark,minimapWorkerBenchmark,minimapWorkerPipeline,compareSmaaClear,compareSmaaEdges].some(Boolean))throw Error('射线副本不能混用其他旁路或比较');
if(coatBenchmark&&[ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,verifyDisplayLifecycle,domAblation,layerHints,markerVars,nativePaint,minimapBenchmark,minimapWorkerBenchmark,minimapWorkerPipeline,compareSmaaClear,compareSmaaEdges].some(Boolean))throw Error('清漆对照不能混用其他旁路或比较');
const edgeFormat=process.env.BOSS_EDGE_FORMAT||'rg8';if(!['rg8','rg16f'].includes(edgeFormat))throw Error('BOSS_EDGE_FORMAT只支持rg8/rg16f');
if(compareSmaaEdges&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||compareSmaaClear||nativePaint||markerVars||layerHints||domAblation||verifyDisplayLifecycle||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||minimapBenchmark))throw Error('SMAA边缘格式比较仅供结算后独立方法调查');
if(minimapWorkerBenchmark&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||compareSmaaEdges||compareSmaaClear||nativePaint||markerVars||layerHints||domAblation||verifyDisplayLifecycle||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||minimapBenchmark))throw Error('Worker比较仅允许结算后独立一分钟方法轮');
if(minimapWorkerPipeline&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||minimapWorkerBenchmark||compareSmaaEdges||compareSmaaClear||nativePaint||markerVars||layerHints||domAblation||verifyDisplayLifecycle||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||minimapBenchmark))throw Error('Worker流水线仅允许结算后独立一分钟方法轮');
// 并行核心余量调查：独占一分钟方法轮，15～45秒Worker承担固定计算量，其他旁路/比较全关。
const workerLoadMs=process.env.BOSS_WORKER_LOAD_MS?Number(process.env.BOSS_WORKER_LOAD_MS):0;
const stageProbe=process.env.BOSS_STAGE_PROBE==='1';
const stageDetail=process.env.BOSS_STAGE_DETAIL==='1';
const stageBuild=process.env.BOSS_STAGE_BUILD_BENCHMARK==='1';
if(stageBuild&&(!stageProbe||!stageDetail))throw Error('结算构造定位须独立细分方法轮');
if(stageDetail&&!stageProbe)throw Error('阶段细分需要阶段方法轮');
if(stageProbe&&(process.env.BOSS_METHOD_PROBE!=='1'||![30,60].includes(duration)||workerLoadMs||verifyWorkerRecovery||propRangeBenchmark||hiddenLodBenchmark||rayQueryBenchmark||coatBenchmark||[ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,verifyDisplayLifecycle,domAblation,layerHints,markerVars,nativePaint,minimapBenchmark,minimapWorkerBenchmark,minimapWorkerPipeline,compareSmaaClear,compareSmaaEdges].some(Boolean)))throw Error('细分阶段仅供独立30或60秒方法轮');
if(workerLoadMs&&(!Number.isInteger(workerLoadMs)||workerLoadMs<1||workerLoadMs>30))throw Error('BOSS_WORKER_LOAD_MS须为1～30整数');
if(workerLoadMs&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||verifyWorkerRecovery||[ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,verifyDisplayLifecycle,domAblation,layerHints,markerVars,nativePaint,minimapBenchmark,minimapWorkerBenchmark,minimapWorkerPipeline,compareSmaaClear,compareSmaaEdges].some(Boolean)))throw Error('Worker负载调查仅允许独立一分钟方法轮');
if(compareSmaaClear&&(process.env.BOSS_METHOD_PROBE!=='1'||duration!==60||ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass))throw Error('SMAA同输入比较仅允许一分钟独立方法调查');
if(minimapBenchmark && (process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('小地图计算对照仅允许一分钟方法调查轮');
if(ablation&&process.env.BOSS_METHOD_PROBE!=='1')throw Error('分组遮蔽仅允许带探针调查轮');
if(cpuAblation&&(ablation||process.env.BOSS_METHOD_PROBE!=='1'))throw Error('CPU分组调查须开启方法探针且不能与渲染遮蔽同时运行');
if(uiAblation&&(ablation||cpuAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('UI分组须独占一分钟带探针调查轮');
if(musicAblation&&(ablation||cpuAblation||uiAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('音乐分组须独占一分钟带探针调查轮');
if(pannerAblation&&(ablation||cpuAblation||uiAblation||musicAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('声像器分组须独占一分钟带探针调查轮');
if(audioSuspend&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('音频挂起须独占一分钟带探针调查轮');
if(audioGraphBypass&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('音频图旁路须独占一分钟带探针调查轮');
if(audioReverbBypass&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||process.env.BOSS_METHOD_PROBE!=='1'||duration!==60))throw Error('混响旁路须独占一分钟带探针调查轮');
if(verifyBossExit&&(ablation||cpuAblation||uiAblation||musicAblation||pannerAblation||audioSuspend||audioGraphBypass||audioReverbBypass||process.env.BOSS_METHOD_PROBE!=='1'||(duration!==60&&!(stageProbe&&duration===30))))throw Error('退出恢复须独占无音画隔离的一分钟方法调查轮');
if(!Number.isFinite(duration)||duration<15||duration>3600||!/^[a-z0-9-]+$/i.test(name))throw Error('采样秒数须为15～3600，名称只允许英数字和连字符');
const c=await androidCDP(),path=`releases/investigation/phone-boss-${name}.json`;
const report={requestedFps:fpsCap,playbackMode,methodProbe:process.env.BOSS_METHOD_PROBE==='1',workerLoadMs,nativePaint,markerVars,layerHints,domAblation,domPart,displayLifecycleProbe:verifyDisplayLifecycle,gpuAblation:ablation,cpuAblation,uiAblation,musicAblation,pannerAblation,audioSuspend,audioGraphBypass,audioReverbBypass,testWeapon,startedAt:new Date().toISOString(),requestedSeconds:duration,status:'running',intervals:[],timeline:[],device:{}};
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
 if(process.env.BOSS_REQUIRE_GAME_CATEGORY==='1'){
  // 开局前只读一次原生分类；正式战斗内不轮询，也不切系统模式。
  report.gameIdentity=await c.evaluate('inkwaveMobile.BossDisplay.getState()');
  if(report.gameIdentity.applicationCategory!==0)throw Error('安装包未被识别为标准游戏分类');
 }
 if(report.methodProbe)report.displayBeforeBoss=await c.evaluate('inkwaveMobile.BossDisplay.getState()');
 await c.evaluate(`(()=>{
  window.__phoneCleanup?.();
  const g=__inkwave;g._setSettings({fpsCap:${fpsCap},mobileVisual:'hd',mobileDynamicResolution:false});
  const p=window.__phonePerf={intervals:[],activeMs:0,lastPlaying:false,rounds:0,actions:{move:0,fire:0,jump:0,sub:0,special:0,squid:0}};
  const record=g.mobile.recordFrame,frame=g._frame,restores=[];
  const stages=${stageProbe}?(${createBossStageProbe.toString()})(g,__G,{detail:${stageDetail}}):null;if(stages){p.stages=stages;p.installMatchProbe=m=>stages.bind(m);restores.push(()=>stages.dispose());}
  if(${process.env.BOSS_VERIFY_READY_STATE==='1'&&process.env.BOSS_METHOD_PROBE==='1'}){
   // 仅方法轮监听8个槽自身的class变化，不读布局、不逐帧轮询，不修改游戏状态。
   p.readyStateProbe={gains:0,losses:0,stale:0,events:[]};
   const slots=[...g.hud.el.querySelectorAll('.iw-sq')],last=new Map(slots.map(el=>[el,el.classList.contains('is-ready')]));
   const observer=new MutationObserver(records=>{
    for(const el of new Set(records.map(r=>r.target))){
     const ready=el.classList.contains('is-ready'),prev=last.get(el);last.set(el,ready);
     if(!g.match?.boss||g.match.attract||__G.mode!=='match')continue;
     const s=p.readyStateProbe,flash=el.classList.contains('is-readyflash');
     if(ready&&!prev)s.gains++;if(!ready&&prev)s.losses++;if(!ready&&flash)s.stale++;
     if(ready!==prev&&s.events.length<32)s.events.push({activeMs:p.activeMs,slot:slots.indexOf(el),ready,flash});
    }
   });
   for(const el of slots)observer.observe(el,{attributes:true,attributeFilter:['class']});
   restores.push(()=>observer.disconnect());
  }
  const director=${playbackMode==='director'}?(${createBossPlaybackDirector.toString()})(g,__G,p.actions):null;
  if(director){p.playbackInfo=()=>director.info();restores.push(()=>director.dispose());}
  const domProbe=${domAblation}?(${createBossDomProbe.toString()})(${JSON.stringify(domPart)}):null;if(domProbe)restores.push(()=>domProbe.dispose());
  const layerProbe=${layerHints}?(${createBossLayerHintProbe.toString()})():null;if(layerProbe)restores.push(()=>layerProbe.dispose());
  const markerVarProbe=${markerVars}?(${createBossMarkerVarProbe.toString()})(g.hud):null;if(markerVarProbe)restores.push(()=>markerVarProbe.dispose());
  const nativePaintProbe=${nativePaint}?(${createBossNativePaintProbe.toString()})(g.hud):null;if(nativePaintProbe)restores.push(()=>nativePaintProbe.dispose());
  const workerLoadProbe=${workerLoadMs}?(${createBossWorkerLoadProbe.toString()})(${workerLoadMs}):null;if(workerLoadProbe){p.workerLoadProbe=workerLoadProbe;restores.push(()=>workerLoadProbe.dispose());}
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
  if(${process.env.BOSS_METHOD_PROBE==='1'&&!stageProbe}){
   p.methods={};
   p.simulationStats={};p.slowMethods=[];p.newPrograms=[];p.combatProgramDraws={};
   const aggregate=(o,k,label,actor)=>{if(!o||typeof o[k]!=='function')return;const fn=o[k],row=p.simulationStats[label]??={calls:0,totalMs:0,maxMs:0};
    o[k]=function(...args){const start=performance.now();try{return fn.apply(this,args)}finally{
     if(p.match===g.match&&g.match?.state==='playing'){const ms=performance.now()-start;row.calls++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);
      if(ms>=20&&p.slowMethods.length<100)p.slowMethods.push({label,actor,ms,at:Date.now(),activeMs:p.activeMs});}
    }};restores.push(()=>o[k]=fn);
   };
   p.installMatchProbe=m=>{
    p.actorRoster=m.actors.map(a=>({name:a.name,weaponId:a.weaponId,subId:a.subId,specialId:a.specialId,local:!!a.isLocal}));
    p.actorRoots=new Set(m.actors.map(a=>a.character?.root).filter(Boolean));
    aggregate(m,'update','match');
    for(const a of m.actors){aggregate(a,'update','actor',a.name);aggregate(a.bot,'update','bot',a.name);aggregate(a.character,'update','character',a.name);aggregate(a.weaponRunner,'update','weapon',a.name);}
    aggregate(m.bossMode,'update','bossMode');aggregate(__G.projectiles,'update','projectiles');aggregate(__G.specials,'update','specials');
    if(${rayQueryBenchmark}){
     const physics=__G.physics,original=physics.raycast;let calls=0;p.rayQueries=[];
     // 每97次采一个、最多6000条，仅复制射线输入；降低早期填满和固定步长采样偏置。
     physics.raycast=function(o,d,max,out,skip){
      if(p.match===g.match&&m.state==='playing'&&++calls%97===0&&p.rayQueries.length<6000)p.rayQueries.push([o.x,o.y,o.z,d.x,d.y,d.z,max,!!skip]);
      return original.call(this,o,d,max,out,skip);
     };restores.push(()=>physics.raycast=original);
    }
   };
   const renderer=g.R.renderer,direct=renderer.renderBufferDirect;
   renderer.renderBufferDirect=function(...args){const before=this.info.programs.length,drawStart=performance.now();const result=direct.apply(this,args);
    // 仅方法轮证明目标特效确实上屏；“没有新程序”必须配合实际绘制覆盖，不能把缺少武器当作命中缓存。
    if(p.match===g.match&&g.match?.state==='playing'){
     const material=args[3],object=args[4];let kind=null;
     if(object?.name==='mitts:fists')kind='mittsFists';
     else if(material?.name==='iw-brolly-ink'&&material.transparent){
      let held=false;for(let node=object;node;node=node.parent)if(p.actorRoots?.has(node)){held=true;break;}
      kind=held?'heldCanopy':'launchedCanopy';
     }else if(material?.isShaderMaterial){
      if(material.fragmentShader.includes('uniform float uSpeed;')&&material.vertexShader.includes('uniform float uWobble;'))kind='swirl';
      else if(material.fragmentShader.includes('uniform float uGrow; uniform float uLock;'))kind='waddleRing';
      else if(material.fragmentShader.includes('uniform float uAlpha; uniform float uAng;'))kind='boomerangBlur';
     }
     const hasPrimitives=(object?.geometry?.drawRange.count??Infinity)>0&&(!object?.isInstancedMesh||object.count>0);
     if(kind&&hasPrimitives){const row=p.combatProgramDraws[kind]??={draws:0,firstActiveMs:p.activeMs,programIds:[]};row.draws++;row.lastActiveMs=p.activeMs;
      const id=this.properties.get(material).currentProgram?.id;if(id!==undefined&&!row.programIds.includes(id))row.programIds.push(id);}
    }
    if(p.match===g.match&&g.match?.state==='playing'&&args[4]?.parent===g.screenfx?.lens?.scene){
     p.lensDraws=(p.lensDraws||0)+1;p.firstLensDraw||={activeMs:p.activeMs,programId:this.properties.get(args[3]).currentProgram?.id};
    }
    if(p.match===g.match&&g.match?.state==='playing'&&this.info.programs.length>before&&p.newPrograms.length<50){
     const firstDrawMs=performance.now()-drawStart;
     const material=args[3],object=args[4],owner=g.match.actors.find(a=>a.character?.root?.getObjectById(object.id));
     p.newPrograms.push({at:Date.now(),activeMs:p.activeMs,firstDrawMs,gameFrameNumber:g._frameN,object:object?.name,parent:object?.parent?.name,material:material?.name,type:material?.type,
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
   stages?.begin(live,p.activeMs,dt);
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
   if(domProbe){domProbe.update(p.match===m?m:null,__G.mode,p.activeMs);p.domProbe=domProbe.info();}
   if(layerProbe){layerProbe.update(p.match===m?m:null,__G.mode,p.activeMs);p.layerProbe=layerProbe.info();}
   if(markerVarProbe){markerVarProbe.update(p.match===m?m:null,__G.mode,p.activeMs);p.markerVarProbe=markerVarProbe.info();}
   if(nativePaintProbe){nativePaintProbe.update(p.match===m?m:null,__G.mode,p.activeMs);p.nativePaintProbe=nativePaintProbe.info();}
   if(workerLoadProbe)workerLoadProbe.update(p.match===m?m:null,__G.mode,p.activeMs);
   if(uiAblationEnabled&&live){
    const phase=['baseline','animations-paused','baseline-restored','filters-flat','baseline-restored-2','animations-paused-2'][Math.min(5,Math.floor(p.activeMs/10000))];
    if(p.uiAblationPhase!==phase){pauseStyle.media=phase.startsWith('animations-paused')?'all':'not all';flatStyle.media=phase==='filters-flat'?'all':'not all';p.uiAblationPhase=phase;}
   }
   if(cpuAblationEnabled&&live)p.cpuAblationPhase=['baseline','minimap','hud','oneshot-audio','map-composite','baseline-restored'][Math.min(5,Math.floor(p.activeMs/10000))];
   if(ablationEnabled&&live){
    const phase=['baseline','sea','background','props','hud','baseline-restored'][Math.min(5,Math.floor(p.activeMs/10000))];
    if(p.ablationPhase!==phase){g.hud.el.style.visibility=phase==='hud'?'hidden':hudVisibility;p.ablationPhase=phase;}
   }
   if(director){stages?.enterDriver();try{director.step(live?p.activeMs:null,dt);}catch(error){p.playbackError=String(error);director.dispose();}finally{stages?.leave();}}
   else if(live&&a?.alive){
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
   stages?.enterGame();try{return frame.call(this,dt,...args);}finally{stages?.leave();stages?.end();}
  };
  // 只统计连续战斗帧，排除跨阶段间隔，保留战斗内全部慢帧。
  g.mobile.recordFrame=function(ms){
   const live=!!(p.match===g.match&&g.match?.boss&&g.match.state==='playing'&&!g.match.paused&&__G.mode==='match');
   if(live&&p.lastPlaying){p.intervals.push(ms);p.activeMs+=ms;}p.lastPlaying=live;
   return record.call(this,ms);
  };
  window.__phoneCleanup=()=>{for(const restore of [...restores].reverse())restore();g._frame=frame;g.mobile.recordFrame=record;g.input.keys.clear();g.input.mouse.left=false;delete window.__phoneCleanup;};
  // 用户允许阶段定位缩至30秒；设置开局时长并等自然结算，正式对照仍一分钟，不改产品默认时长。
  window.__phoneStart=()=>{p.rounds++;p.match=null;p.lastPlaying=false;window.__phoneStarted=null;g.startMatch({mode:'boss',mapId:'tidewater',duration:${stageProbe?duration:60}}).then(v=>{__phoneStarted=v;if(v){p.match=g.match;director?.bind(g.match);p.installMatchProbe?.(g.match)}},e=>__phoneStarted=String(e));};
  __phoneStart();return true;
 })()`);
 const deadline=Date.now()+(duration+300)*1000;
 while(Date.now()<deadline){
  const sample=await c.evaluate(`(()=>{
   const g=__inkwave,m=g.match,a=m?.local,p=__phonePerf;
   const sample={at:Date.now(),state:m?.state,mode:__G.mode,boss:!!m?.boss,fps:g.fps,ratio:g.R.renderer.getPixelRatio(),scale:g.R.dynScale,
    activeMs:p.activeMs,rounds:p.rounds,domProbe:p.domProbe,workerLoadPhase:p.workerLoadProbe?.phaseNow(),ablationPhase:p.ablationPhase,cpuAblationPhase:p.cpuAblationPhase,uiAblationPhase:p.uiAblationPhase,musicAblationPhase:p.musicAblationPhase,pannerAblationPhase:p.pannerAblationPhase,audioSuspendedForProbe:p.audioSuspendedForProbe,audioSuspendError:p.audioSuspendError,audioBypassedForProbe:p.audioBypassedForProbe,reverbBypassedForProbe:p.reverbBypassedForProbe,audioBypassError:p.audioBypassError,ablationApplied:p.ablationApplied,started:__phoneStarted,actions:{...p.actions},position:a?{x:a.pos.x,y:a.pos.y,z:a.pos.z}:null,
    audio:${process.env.BOSS_METHOD_PROBE==='1'}?(()=>{
     const audio=__G.audio,stats=audio?.stats?.(),voicePanners={};let voiceNodes=0;
     // 只统计仍在播放的单发声道；弱引用历史节点数不能冒充当前DSP负载，循环数另列stats.loops。
     for(const v of audio?.voices||[]){if(v.v.dead||v.stolen)continue;const model=v.panner?.panningModel||'2d';voicePanners[model]=(voicePanners[model]||0)+1;voiceNodes+=v.v.nodes.length;}
     return {stats,voicePanners,voiceNodes,sampleRate:audio?.ctx?.sampleRate,baseLatency:audio?.ctx?.baseLatency,outputLatency:audio?.ctx?.outputLatency,music:__G.music?.current?.id,playerType:__G.music?.current?.constructor.name,players:__G.music?.players.length};
    })():undefined,
    timeLeft:m?.time,alive:a?.alive,ink:a?.ink,bossHp:m?.boss?.hp,bossMaxHp:m?.boss?.maxHp,bossPhase:m?.boss?.phase,playback:p?.playbackInfo?.()||null,playbackError:p?.playbackError||null,actors:m?.actors.length,fire:a?.intent.fire,move:a?.intent.move?.length(),
    profile:g.mobile.profile.snapshot(),cpu:{...g.perf},calls:__G.renderer.info.render.calls,triangles:__G.renderer.info.render.triangles,
    intervals:p.intervals.splice(0)};
   if(m?.state==='results'&&${duration}>60&&p.activeMs<${duration}*1000)__phoneStart();return sample;
  })()`);
  const intervals=sample.intervals;delete sample.intervals;report.intervals.push(...intervals);report.timeline.push(sample);
  if(sample.playbackError)throw Error('自动输入失败，已保留原模拟继续并清空输入：'+sample.playbackError);
  if(report.methodProbe&&sample.state==='playing'&&sample.activeMs>=5000&&!report.displayDuringPlay){
   report.displayDuringPlay=await c.evaluate('inkwaveMobile.BossDisplay.getState()');
   if(report.displayDuringPlay.observedWidth!==report.displayBeforeBoss.observedWidth||report.displayDuringPlay.observedHeight!==report.displayBeforeBoss.observedHeight)throw Error('Boss窗口实验改变了实际物理分辨率');
  }
  // 方法轮仅取一次实际样式，确认APK真的经过涂地弹分路径；正式轮不增加样式读取。
  if(process.env.BOSS_REQUIRE_TURF_ANIMATION==='1'&&report.methodProbe&&sample.state==='playing'&&sample.activeMs>=5000&&!report.turfAnimation){
   report.turfAnimation=await c.evaluate(`(()=>{const el=__inkwave.hud.turfEl,s=getComputedStyle(el.querySelector('i'));return {phase:el.getAttribute('data-iw-repeat-tick'),name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,tick:el.classList.contains('is-tick'),score:__inkwave.hud.turfNum.textContent};})()`);
   const a=report.turfAnimation;
   if(!a.tick||!['a','b'].includes(a.phase)||a.name!==(a.phase==='b'?'iw-turf-tick-repeat':'iw-turf-tick')||a.duration!=='0.35s')throw Error('手机Boss涂地弹分等价重播未实际生效');
  }
  if(process.env.BOSS_REQUIRE_HUD_DECOR==='1'&&report.methodProbe&&sample.state==='playing'&&sample.activeMs>=5000&&!report.hudDecorStyles){
   report.hudDecorStyles=await c.evaluate(`(()=>{const root=__inkwave.hud.el,selectors=['.iw-sp__wave','.iw-sp__wave2','.iw-sp__bub','.iw-timer__drip','.iw-bb__embsplat','.iw-bb__stripes'];return {active:root.matches('.iw-hud.is-boss.iw-mobile-boss-decor'),decorations:[...root.querySelectorAll('.iw-sq:not(.is-self) .iw-sq__you')].map(el=>({name:getComputedStyle(el).animationName})),visible:selectors.flatMap(selector=>[...root.querySelectorAll(selector)].map(el=>({selector,name:getComputedStyle(el).animationName}))),self:getComputedStyle(root.querySelector('.iw-sq.is-self .iw-sq__you')).animationName};})()`);
   if(!report.hudDecorStyles.active||report.hudDecorStyles.decorations.length!==7||report.hudDecorStyles.decorations.some(x=>x.name!=='none')||report.hudDecorStyles.visible.length!==8||report.hudDecorStyles.visible.some(x=>x.name==='none')||report.hudDecorStyles.self!=='iw-you')throw Error('不可见箭头清理或可见装饰恢复未生效');
  }
  if(verifyWorkerRecovery&&sample.state==='playing'&&sample.activeMs>=20000&&!report.workerRecovery){
   report.workerRecovery={before:await c.evaluate('__inkwave.minimap.bossWorkerInfo()')};
   try{
    await c.evaluate('__inkwave.pause();true');
    await new Promise(r=>setTimeout(r,500));
    report.workerRecovery.paused=await c.evaluate('({paused:__inkwave.match.paused,worker:__inkwave.minimap.bossWorkerInfo()})');
   }finally{await c.evaluate('if(__inkwave.match.paused)__inkwave.resume();true');}
   for(let i=0;i<40;i++){
    await new Promise(r=>setTimeout(r,100));
    report.workerRecovery.resumed=await c.evaluate('({paused:__inkwave.match.paused,worker:__inkwave.minimap.bossWorkerInfo()})');
    const w=report.workerRecovery.resumed.worker,b=report.workerRecovery.before;
    if(!report.workerRecovery.resumed.paused&&w?.ready&&!w.parked&&w.resyncs>b.resyncs&&w.applied>b.applied)break;
   }
   const r=report.workerRecovery,w=r.resumed?.worker,b=r.before;
   r.ok=!!(r.paused?.paused&&r.paused.worker?.parked&&w?.ready&&!w.parked&&!r.resumed.paused&&w.resyncs>b.resyncs&&w.applied>b.applied&&w.fallbacks===b.fallbacks);
   await save();if(!r.ok)throw Error('真机原暂停/继续后Worker未恢复：'+JSON.stringify(r));
  }
  if(verifyDisplayLifecycle&&sample.state==='playing'&&sample.activeMs>=20000&&!report.displayLifecycle){
   const query='(async()=>({native:await inkwaveMobile.BossDisplay.getState(),app:await inkwaveMobile.App.getState(),hidden:document.hidden,suspended:!!__inkwave.mobileSuspended,needsResume:__inkwave.mobile.state.needsResume,paused:__inkwave.match.paused}))()';
   report.displayLifecycle={before:await c.evaluate(query)};
   // App状态变化来自onStop，可能晚于onPause/Home动画；等待实际暂停，不能用固定700ms假定已完成。
   try{c.command('shell','input','keyevent','KEYCODE_HOME');for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,250));report.displayLifecycle.background=await c.evaluate(query);if(report.displayLifecycle.background.suspended&&!report.displayLifecycle.background.native.foreground)break;}}
   finally{c.command('shell','am','start','-n','com.demoink.inkwave/.MainActivity');}
   if(!report.displayLifecycle.background.suspended)throw Error('未收到实际后台暂停状态：'+JSON.stringify(report.displayLifecycle.background));
   let resumed=false;
   for(let i=0;i<60;i++){
    resumed=await c.evaluate('(()=>{const d=document.querySelector("#mobile-dialog");if(document.hidden||!d||d.hidden||!d.querySelector("button"))return false;d.querySelector("button").click();return true;})()');
    if(resumed)break;await new Promise(r=>setTimeout(r,100));
   }
   if(!resumed)throw Error('前台继续按钮未出现，生命周期调查未自动恢复');
   for(let i=0;i<60;i++){report.displayLifecycle.resumed=await c.evaluate(query);if(report.displayLifecycle.resumed.native.owned&&!report.displayLifecycle.resumed.paused)break;await new Promise(r=>setTimeout(r,100));}
   const e=report.displayLifecycle,b=report.displayBeforeBoss;
   e.ok=!e.background.app.isActive&&e.background.suspended&&e.background.paused&&!e.background.native.owned
    &&e.background.native.preferredDisplayModeId===b.preferredDisplayModeId&&Math.abs(e.background.native.preferredRefreshRate-b.preferredRefreshRate)<.01
    &&!e.resumed.hidden&&!e.resumed.suspended&&!e.resumed.paused&&e.resumed.native.owned&&e.resumed.native.preferredDisplayModeId===e.resumed.native.requestedModeId;
   if(!e.ok)throw Error('后台窗口恢复/前台重新申请验证失败');
  }
  if(minimapWorkerPipeline&&minimapWorkerPipelinePhase==='playing'&&sample.state==='playing'&&sample.activeMs>=20000&&!report.minimapWorkerPipeline){
   report.minimapWorkerPipelineStartMs=sample.activeMs;
   report.minimapWorkerPipeline=await c.evaluate(`(${benchmarkMinimapWorkerPipeline.toString()})(__inkwave.minimap,(${computeMinimapInkBand.toString()}),(${createMinimapBandWorker.toString()}),(${applyMinimapBand.toString()}))`);
   report.minimapWorkerPipelinePhase='playing';await save();
  }
  if(report.methodProbe&&sample.state==='playing'&&sample.activeMs>=40000&&!report.displayLatePlay)report.displayLatePlay=await c.evaluate('inkwaveMobile.BossDisplay.getState()');
  await save();console.log(JSON.stringify({state:sample.state,fps:sample.fps,ratio:sample.ratio,activeSeconds:Math.round(sample.activeMs/1000),position:sample.position,fire:sample.fire,actions:sample.actions}));
  if(sample.audioSuspendError)throw Error(sample.audioSuspendError);
  if(sample.audioBypassError)throw Error(sample.audioBypassError);
  if(sample.started!==null&&sample.started!==true)throw Error(`Boss启动失败：${sample.started}`);
  if(sample.started===true&&(!sample.boss||sample.actors!==8))throw Error('未进入真实8人Boss对局');
  if(sample.ratio!==2||sample.scale!==1)throw Error('实际渲染不满足固定2倍高清');
  // 一分钟短轮等游戏自然结束，不能采够60秒就让角色停在仍进行的对局里。
  report.roundCompleted=['finish','results'].includes(sample.state);
  if((duration===60||stageProbe&&duration===30)?report.roundCompleted:sample.activeMs>=duration*1000)break;
  await new Promise(r=>setTimeout(r,2000));
 }
 const a=report.intervals.filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b),seconds=a.reduce((s,x)=>s+x,0)/1000;
 report.summary={frames:a.length,seconds,averageFps:a.length/seconds,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],over100:a.filter(x=>x>=100).length};
 if(process.env.BOSS_VERIFY_MINIMAP_SETTLEMENT==='1'){
  if(!stageProbe||!report.methodProbe)throw Error('最终地图逐字节核对仅供独立阶段方法轮');
  report.minimapSettlement=await c.evaluate(`(async()=>{
   const map=__inkwave.minimap,start=performance.now();
   while(map.bossWorkerInfo()?.reason==='settling'&&performance.now()-start<1000)await new Promise(requestAnimationFrame);
   const info=map.bossWorkerInfo();if(!info?.settlementApplied)throw Error('结算Worker未完成：'+JSON.stringify(info));
   const oracle=Object.assign(Object.create(Object.getPrototypeOf(map)),map);
   for(const key of ['owner','_alpha','_tm','_tt'])oracle[key]=map[key].slice();
   for(const [image,ctx]of [['inkImg','ictx'],['flashImg','fctx']]){
    const canvas=document.createElement('canvas');canvas.width=map.w;canvas.height=map.h;
    oracle[ctx]=canvas.getContext('2d');oracle[image]=oracle[ctx].createImageData(map.w,map.h);oracle[image].data.set(map[image].data);
   }
   oracle._drawInk(0,map.h);
   const diff=(a,b)=>{let n=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)n++;max=Math.max(max,d);}return{differentBytes:n,maxDifference:max};};
   const ink=diff(map.inkImg.data,oracle.inkImg.data),owner=diff(map.owner,oracle.owner);
   const inkCanvas=diff(map.ictx.getImageData(0,0,map.w,map.h).data,oracle.ictx.getImageData(0,0,map.w,map.h).data);
   return{info,ink,owner,inkCanvas,width:map.w,height:map.h,scope:'自然结算后原同步算法整图对照，不纳入FPS成绩'};
  })()`);
  if(['ink','owner','inkCanvas'].some(k=>report.minimapSettlement[k].differentBytes))throw Error('结算最终地图与同步参考不一致');
 }
 if(!a.length||(seconds<duration&&!report.roundCompleted))throw Error('实际战斗采样时长不足');
 report.methods=await c.evaluate('window.__phonePerf.methods||null');
 report.stageProbe=await c.evaluate('window.__phonePerf.stages?.summary()||null');
 report.audioNames=await c.evaluate('window.__phonePerf.audioNames||null');
 report.audioCache=await c.evaluate('window.__G?.audio?._bossSamples?.stats||null');
 report.domProbe=await c.evaluate('__phonePerf.domProbe||null');
 report.layerProbe=await c.evaluate('__phonePerf.layerProbe||null');
 report.markerVarProbe=await c.evaluate('__phonePerf.markerVarProbe||null');
 report.nativePaintProbe=await c.evaluate('__phonePerf.nativePaintProbe||null');
 report.workerLoad=await c.evaluate('__phonePerf.workerLoadProbe?.info()||null');
 if(workerLoadMs&&(!report.workerLoad?.transitions.some(t=>t.phase==='loaded')||!report.workerLoad.transitions.some(t=>t.phase==='restored')||!report.workerLoad.done||report.workerLoad.error))throw Error('Worker负载调查未生效、未恢复或Worker异常');
 if(nativePaint&&(!report.nativePaintProbe?.adopted||report.nativePaintProbe.active||report.nativePaintProbe.errors||!report.nativePaintProbe.restored))throw Error('原生装饰动画分档未生效或未恢复/发生异常');
 if(markerVars&&(!report.markerVarProbe?.intercepted||!report.markerVarProbe.transitions.some(t=>t.phase==='restored')||report.markerVarProbe.active))throw Error('标签变量调查未生效或未恢复');
 report.bossRasterHints=await c.evaluate('__inkwave.mobile.bossRasterHints?.info()||null');
 report.bossHudDecorations=await c.evaluate('__inkwave.mobile.bossHudDecorations?.info()||null');
 if(process.env.BOSS_REQUIRE_HUD_DECOR==='1'&&(!report.bossHudDecorations?.activations||report.bossHudDecorations.active||!report.bossHudDecorations.releases))throw Error('Boss装饰策略未实际启用或结算未释放');
 if(process.env.BOSS_REQUIRE_RASTER_HINTS==='1'&&(!report.bossRasterHints?.activations||report.bossRasterHints.active||!report.bossRasterHints.releases))throw Error('Boss标签缓存未实际启用或结束未释放');
 if(layerHints&&(!report.layerProbe?.transitions.some(t=>t.phase==='hinted')||!report.layerProbe.transitions.some(t=>t.phase==='restored')||report.layerProbe.active))throw Error('标签图层提示未生效或未恢复');
 if(domAblation&&(!report.domProbe?.transitions.some(t=>t.phase==='dom-hidden')||!report.domProbe.transitions.some(t=>t.phase==='restored')||report.domProbe.hidden))throw Error('DOM隔离未生效或未恢复');
 report.audioParams=await c.evaluate('__G.audio.bossParamDedupeInfo?.()||null');
 if(process.env.BOSS_REQUIRE_AUDIO_PARAM_DEDUPE==='1'&&(!report.audioParams?.skipped||!report.audioParams.submitted||report.audioParams.active||report.audioParams.invalidated))throw Error('Boss音频参数去重未实际运行或自然结束未释放/发生失效');
 report.animationClock=await c.evaluate('__inkwave.mobile.bossAnimationClock?.info()||null');
 if(process.env.BOSS_REQUIRE_ANIMATION_CLOCK==='1'&&(!report.animationClock?.captured||!report.animationClock.frames||report.animationClock.tracked||report.animationClock.active))throw Error('HUD动画未实际采样或自然结束后未恢复');
 report.reverbInfo=await c.evaluate('window.__G?.audio?._bossReverbInfo||null');
 report.postprocess=await c.evaluate('({edges:__inkwave.R.mobileAA?.bossEdgesInfo?.()||null,fusion:__inkwave.R.mobileAA?.bossOutput||null,smaaClear:__inkwave.R.mobileAA?.bossSmaaClear||null,edgeType:__inkwave.R.mobileAA?._edgesRT.texture.type,weightsType:__inkwave.R.mobileAA?._weightsRT.texture.type,outputEnabled:__inkwave.R.outputPass?.enabled,passes:__inkwave.R.composer.passes.map(p=>({type:p.constructor.name,enabled:p.enabled}))})');
 if(process.env.BOSS_REQUIRE_SMAA_EDGES==='1'&&(!report.postprocess.edges?.active||report.postprocess.edges.format!=='RG16F'||report.postprocess.edges.frames<report.summary.frames*.9||report.postprocess.edges.typeCode!==1016||report.postprocess.edges.weightsType!==1016))throw Error('Boss RG16F边缘缓冲未在整局实际使用');
 if(process.env.BOSS_REQUIRE_SMAA_CLEAR==='1'&&!report.postprocess.smaaClear?.active)throw Error('本批Boss SMAA清零修复未实际启用');
 report.minimapInk=await c.evaluate('__inkwave.minimap.bossInkInfo?.()||null');
 report.playbackResult=await c.evaluate('__phonePerf.playbackInfo?.()||null');
 report.readyStateProbe=await c.evaluate('__phonePerf.readyStateProbe||null');
 if(process.env.BOSS_VERIFY_READY_STATE==='1'&&report.methodProbe&&(!report.readyStateProbe?.losses||report.readyStateProbe.stale))throw Error('手机未覆盖真正就绪消耗/死亡的迁移，或仍有未就绪光晕残留');
 if(playbackMode==='director'){
  const run=report.playbackResult;
  if(!run||run.distanceTravelled<25||run.movedFrames<report.summary.frames*.2||!run.pathSuccess||run.bossDamage<=0)throw Error('自动游玩未证明真实移动/有效攻击/原导航覆盖，不能将按键计数当完成');
 }
 report.minimapWorker=await c.evaluate('__inkwave.minimap.bossWorkerInfo?.()||null');
 if(process.env.BOSS_REQUIRE_MINIMAP_WORKER==='1'){
  const worker=report.minimapWorker;
  if(!worker||worker.submitted<200||worker.applied<worker.submitted*.95||worker.fallbacks||worker.maxPending>3||worker.maxAgeFrames>3||worker.maxAgeMs>250||worker.gridAllocations>3||worker.rowAllocations>6||worker.recycled!==worker.applied+(worker.dropped||0))throw Error('小地图Worker未覆盖整局、缓冲未复用或发生回退，不能算候选实战成绩');
 }
 report.lensInk=await c.evaluate('({preparation:__inkwave._bossLensPreparation||null,programId:__G.renderer.properties.get(__inkwave.screenfx.lens.mat).currentProgram?.id,draws:__phonePerf.lensDraws||0,firstDraw:__phonePerf.firstLensDraw||null})');
 if(process.env.BOSS_REQUIRE_LENS_PREPARATION==='1'&&(!report.lensInk.preparation?.prepared||report.lensInk.programId!==report.lensInk.preparation.programId))throw Error('Boss镜头墨水准备缺失或实际程序与准备不一致');
 if(process.env.BOSS_REQUIRE_LENS_DRAW==='1'&&(!report.lensInk.draws||report.lensInk.firstDraw?.programId!==report.lensInk.preparation?.programId))throw Error('本调查未验证首次真实镜头墨水绘制复用准备程序');
 if(process.env.BOSS_REQUIRE_MINIMAP_CACHE==='1' && (!report.minimapInk?.active || !report.minimapInk.calls))throw Error('本批要求小地图缓存实际启用并处理像素，不能将未启用的原路径当作优化结果');
 report.simulationProbe=await c.evaluate('({actors:window.__phonePerf.actorRoster||[],combatProgramDraws:window.__phonePerf.combatProgramDraws||null,stats:window.__phonePerf.simulationStats||null,slow:window.__phonePerf.slowMethods||[],newPrograms:window.__phonePerf.newPrograms||[]})');
 report.pannerTransitions=await c.evaluate('window.__phonePerf.pannerTransitions||null');
 report.diagnostics=await c.evaluate('inkwaveDiagnostics.report({probe:true})');
 const scene=report.diagnostics.current.scene;
 if(scene.settings.fpsCap!==fpsCap)throw Error('实际帧率上限与测试请求不符');
 if(scene.render.antialias!=='SMAA'||report.diagnostics.current.shaderFailures.length||scene.mobileGpu?.fatal)throw Error('图形验收失败，不能将降级/错误帧当作正常性能');
 if(minimapBenchmark)report.minimapBenchmark=await c.evaluate(`(${benchmarkBossMinimapKernel.toString()})(__inkwave.minimap)`);
 if(propRangeBenchmark){if(!report.roundCompleted)throw Error('Boss必须自然结算后才运行区段副本');report.propRangeBenchmark=await runPhoneBossPropRanges(c);await save();}
 if(hiddenLodBenchmark){if(!report.roundCompleted)throw Error('Boss必须自然结算后才运行隐藏LOD副本');report.hiddenLodBenchmark=await runPhoneBossHiddenLod(c);await save();}
 if(rayQueryBenchmark){if(!report.roundCompleted)throw Error('Boss必须自然结算后才运行射线副本');report.rayQueryBenchmark=await runPhoneBossRayQuery(c);await save();}
 if(coatBenchmark){if(!report.roundCompleted)throw Error('Boss必须自然结算后才运行清漆对照');report.coatBenchmark=await runPhoneBossCoat(c);await save();}
 if(minimapWorkerBenchmark){
  if(!report.roundCompleted)throw Error('必须自然结算后才运行副本Worker实验');
  report.minimapWorkerBenchmark=[];
  for(const scenario of ['empty','snapshot','sparse','dense']){
   const result=await c.evaluate(`(${benchmarkMinimapWorker.toString()})(__inkwave.minimap,(${computeMinimapInkBand.toString()}),(${createMinimapBandWorker.toString()}),(${applyMinimapBand.toString()}),${JSON.stringify([scenario])})`);
   report.minimapWorkerBenchmark.push(...result);await save();
  }
 }
 if(minimapWorkerPipeline&&minimapWorkerPipelinePhase==='finish'){
  if(!report.roundCompleted)throw Error('必须自然结算后才运行流水线副本');
  report.minimapWorkerPipeline=await c.evaluate(`(${benchmarkMinimapWorkerPipeline.toString()})(__inkwave.minimap,(${computeMinimapInkBand.toString()}),(${createMinimapBandWorker.toString()}),(${applyMinimapBand.toString()}))`);
  report.minimapWorkerPipelinePhase='finish';
  await save();
 }
 if(minimapWorkerPipeline&&!report.minimapWorkerPipeline)throw Error('未执行指定阶段流水线副本验证');
 if(compareSmaaClear)report.smaaClearComparison=await c.evaluate(`(${compareBossSmaaClear.toString()})(__inkwave)`);
 if(compareSmaaEdges){const half=edgeFormat==='rg16f';report.smaaEdgesComparison=await c.evaluate(`(${compareBossSmaaEdges.toString()})(__inkwave,${JSON.stringify({format:RGFormat,type:half?HalfFloatType:UnsignedByteType,internalFormat:half?'RG16F':'RG8',expectedBits:half?[16,16,0,0]:[8,8,0,0]})})`);if(!report.smaaEdgesComparison.restored||report.smaaEdgesComparison.maxByteDifference||report.smaaEdgesComparison.nonBinary)throw Error(`SMAA ${edgeFormat}未逐字节匹配参考或恢复失败`);}
 if(stageBuild){report.weaponConstruction=await c.evaluate(`(${probeBossWeaponConstruction.toString()})(__inkwave)`);await save();}
 if(verifyBossExit){
  if(!report.reverbInfo?.active)throw Error('Boss短混响未启用，不能验证恢复');
  report.bossExit=await c.evaluate(`(async()=>{const oldMap=__inkwave.minimap;await __inkwave.quitToMenu();for(let i=0;i<30&&__inkwave.R.outputPass?.enabled===false;i++)await new Promise(r=>requestAnimationFrame(r));const a=__G.audio,c=__G.music._nodes.find(n=>n instanceof ConvolverNode);
   return {mode:__G.mode,boss:!!__inkwave.match?.boss,info:a._bossReverbInfo,sfxSeconds:a.conv.buffer.duration,musicSeconds:c.buffer.duration,sfxNormalize:a.conv.normalize,musicNormalize:c.normalize,outputEnabled:__inkwave.R.outputPass?.enabled,edges:__inkwave.R.mobileAA?.bossEdgesInfo?.()||null,fusion:__inkwave.R.mobileAA?.bossOutput,smaaClear:__inkwave.R.mobileAA?.bossSmaaClear,minimapInk:__inkwave.minimap.bossInkInfo?.()||null,oldMinimapInk:oldMap.bossInkInfo?.()||null,minimapWorker:__inkwave.minimap.bossWorkerInfo?.()||null,oldMinimapWorker:oldMap.bossWorkerInfo?.()||null};})()`);
  const e=report.bossExit;e.ok=e.mode==='menu'&&!e.boss&&e.info?.active===false&&e.info.restored===2&&e.sfxSeconds===1.5&&e.musicSeconds===2.2&&e.sfxNormalize&&e.musicNormalize;
  if(report.postprocess.fusion?.enabled)e.ok=e.ok&&e.outputEnabled===true&&e.fusion?.enabled===false;
  if(report.postprocess.smaaClear?.active)e.ok=e.ok&&e.smaaClear?.active===false;
  if(report.postprocess.edges?.active)e.ok=e.ok&&!e.edges?.active&&e.edges?.formatCode===1023&&e.edges?.typeCode===1016;
  if(report.minimapInk?.active)e.ok=e.ok&&e.minimapInk===null&&e.oldMinimapInk===null;
  if(report.minimapWorker)e.ok=e.ok&&!e.minimapWorker?.ready&&!e.oldMinimapWorker?.ready;
  if(report.displayBeforeBoss){e.display=await c.evaluate('inkwaveMobile.BossDisplay.getState()');e.ok=e.ok&&!e.display.owned&&e.display.preferredDisplayModeId===report.displayBeforeBoss.preferredDisplayModeId&&Math.abs(e.display.preferredRefreshRate-report.displayBeforeBoss.preferredRefreshRate)<.01;}
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
 // 只在独立方法轮等待本轮渲染Trace完成导出；正式轮无此分支，不能无限阻止上传关闭。
 if(report.methodProbe){const waitStart=Date.now();for(let i=0;i<40;i++){const pending=await c.evaluate('!!window.__inkwaveRenderTrace?.pending').catch(()=>false);if(!pending)break;await new Promise(r=>setTimeout(r,500));}report.renderTraceTailWaitMs=Date.now()-waitStart;}
 // 断线立即失败；恢复原方法，不将自动操作留给下一轮人工试玩。
 await c.evaluate('window.__phoneCleanup?.()').catch(()=>{});
 if(layerHints){report.layerCleanup=await c.evaluate('({remaining:!!document.querySelector("[data-boss-layer-hint-probe]")})').catch(e=>({error:String(e)}));if(report.layerCleanup.remaining||report.layerCleanup.error){process.exitCode=1;report.layerCleanupFailed=true;}}
 if(domAblation)report.domCleanup=await c.evaluate('({remaining:!!document.querySelector("[data-boss-dom-probe]"),controlsDisplay:getComputedStyle(document.getElementById("mobile-controls")).display})').catch(e=>({error:String(e)}));
 if(domAblation&&(report.domCleanup?.remaining||report.domCleanup?.error)){process.exitCode=1;report.domCleanupFailed=true;}
 try{
  // 用户要求每轮上传确认落盘后关闭；直接驱动真实按钮，复用原生USB链路。
  const status=await c.evaluate(`(async()=>{const b=document.querySelector('#mobile-log-upload');if(!b)throw Error('上传按钮不存在');if(b.disabled)throw Error('已有上传尚未结束');b.click();for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,100));if(!b.disabled)return document.querySelector('#mobile-log-status')?.textContent;}throw Error('上传超时')})()`);
  if(!status?.includes('上传成功（USB）'))throw Error(status||'未收到USB保存回执');
  const filename=status.match(/INKWAVE-logs-[\w-]+\.json/)?.[0];if(!filename)throw Error('回执文件名无效');
  const uploaded=JSON.parse(await readFile(`releases/logs/${filename}`,'utf8'));
  if(uploaded.current.build.sourceCommit!==report.diagnostics?.current.build.sourceCommit)throw Error('落盘日志源码不匹配');
  if(process.env.BOSS_REQUIRE_LOG_EDGES==='1'){
   const edges=uploaded.current.scene?.render?.smaaEdges;
   if(!edges?.active||edges.format!=='RG16F'||edges.typeCode!==1016||edges.weightsType!==1016||edges.logicalSavedBytes!==edges.width*edges.height*4)throw Error('上传日志未记录实际RG16F状态');
   report.uploadEdges=edges;
  }
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
