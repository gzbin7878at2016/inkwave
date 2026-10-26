// 真机Boss自动游玩：只操作输入，不改血量、人数、伤害、碰撞或模拟速度。
import {androidCDP} from './android-cdp.mjs';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
const duration=Number(process.env.BOSS_TEST_SECONDS||60),name=process.env.BOSS_TEST_NAME||'baseline';
const ablation=process.env.BOSS_GPU_ABLATION==='1';
if(ablation&&process.env.BOSS_METHOD_PROBE!=='1')throw Error('分组遮蔽仅允许带探针调查轮');
if(!Number.isFinite(duration)||duration<15||duration>3600||!/^[a-z0-9-]+$/i.test(name))throw Error('采样秒数须为15～3600，名称只允许英数字和连字符');
const c=await androidCDP(),path=`releases/investigation/phone-boss-${name}.json`;
const report={methodProbe:process.env.BOSS_METHOD_PROBE==='1',gpuAblation:ablation,startedAt:new Date().toISOString(),requestedSeconds:duration,status:'running',intervals:[],timeline:[],device:{}};
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
  // 仅诊断：按十秒阶段隐藏渲染组，碰撞/AI/血量仍正常；所有状态在finally恢复。
  const ablationEnabled=${ablation};
  const groups={sea:[__G.env?.sea],background:['city','terrain','staticScenery','ferris','trees','sailInst','gullInst'].map(k=>__G.env?.[k]),props:[g.props?.group]};
  const visibility=new Map(Object.values(groups).flat().filter(Boolean).map(o=>[o,o.visible]));
  const hudVisibility=g.hud.el.style.visibility;
  const restoreVisibility=()=>{for(const [o,v] of visibility)o.visible=v;g.hud.el.style.visibility=hudVisibility;};
  if(ablationEnabled)restores.push(restoreVisibility);
  // 可选方法级调查会增加计时开销，单独标记，不能混充无探针基线。
  if(${process.env.BOSS_METHOD_PROBE==='1'}){
   p.methods={};
   const wrap=(o,k,label)=>{const fn=o[k],values=p.methods[label]=[];o[k]=function(...args){const start=performance.now();try{return fn.apply(this,args)}finally{if(values.length<10000)values.push(performance.now()-start)}};restores.push(()=>o[k]=fn);};
   for(const k of ['_updCrosshair','_updTank','_updSpecial','_updMap','_updMarkers','_updSquads','_updPrompt'])wrap(g.hud,k,k);
   wrap(g.hud.boss,'update','bossHud');
   // 同步诊断/存储/GL查询可能在战斗帧外阻塞，调查时单独计时，不计作正式成绩。
   wrap(g.R,'resize','rendererResize');
   wrap(window.inkwaveDiagnostics,'tick','diagnosticsTick');
   wrap(Storage.prototype,'setItem','storageWrite');
   wrap(g.R.renderer.getContext(),'getError','glGetError');
  }
  // 每帧在原输入控制器之前注入操作，仍经过正常物理和武器逻辑。
  g._frame=function(dt,...args){
   const m=g.match,a=m?.local,live=!!(p.match===m&&m?.boss&&m.state==='playing'&&!m.paused&&__G.mode==='match');
   if(ablationEnabled&&live){
    const phase=['baseline','sea','background','props','hud','baseline-restored'][Math.min(5,Math.floor(p.activeMs/10000))];
    if(p.ablationPhase!==phase){restoreVisibility();for(const o of groups[phase]||[])if(o)o.visible=false;if(phase==='hud')g.hud.el.style.visibility='hidden';p.ablationPhase=phase;}
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
  window.__phoneCleanup=()=>{for(const restore of restores)restore();g._frame=frame;g.mobile.recordFrame=record;g.input.keys.clear();g.input.mouse.left=false;delete window.__phoneCleanup;};
  // 用户要求每局1分钟；只改自动测试的对局参数，不改正式游戏默认时长。
  window.__phoneStart=()=>{p.rounds++;p.match=null;p.lastPlaying=false;window.__phoneStarted=null;g.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(v=>{__phoneStarted=v;if(v)p.match=g.match},e=>__phoneStarted=String(e));};
  __phoneStart();return true;
 })()`);
 const deadline=Date.now()+(duration+300)*1000;
 while(Date.now()<deadline){
  const sample=await c.evaluate(`(()=>{
   const g=__inkwave,m=g.match,a=m?.local,p=__phonePerf;
   const sample={at:Date.now(),state:m?.state,mode:__G.mode,boss:!!m?.boss,fps:g.fps,ratio:g.R.renderer.getPixelRatio(),scale:g.R.dynScale,
    activeMs:p.activeMs,rounds:p.rounds,ablationPhase:p.ablationPhase,started:__phoneStarted,actions:{...p.actions},position:a?{x:a.pos.x,y:a.pos.y,z:a.pos.z}:null,
    timeLeft:m?.time,alive:a?.alive,ink:a?.ink,bossHp:m?.boss?.hp,actors:m?.actors.length,fire:a?.intent.fire,move:a?.intent.move?.length(),
    profile:g.mobile.profile.snapshot(),cpu:{...g.perf},calls:__G.renderer.info.render.calls,triangles:__G.renderer.info.render.triangles,
    intervals:p.intervals.splice(0)};
   if(m?.state==='results'&&${duration}>60&&p.activeMs<${duration}*1000)__phoneStart();return sample;
  })()`);
  const intervals=sample.intervals;delete sample.intervals;report.intervals.push(...intervals);report.timeline.push(sample);
  await save();console.log(JSON.stringify({state:sample.state,fps:sample.fps,ratio:sample.ratio,activeSeconds:Math.round(sample.activeMs/1000),position:sample.position,fire:sample.fire,actions:sample.actions}));
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
 report.diagnostics=await c.evaluate('inkwaveDiagnostics.report({probe:true})');
 const scene=report.diagnostics.current.scene;
 if(scene.render.antialias!=='SMAA'||report.diagnostics.current.shaderFailures.length||scene.mobileGpu?.fatal)throw Error('图形验收失败，不能将降级/错误帧当作正常性能');
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
