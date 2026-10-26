// 真实AudioEngine定位入口+OfflineAudioContext对照；时间代理只负责将实战排期预先写入离线时间线。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-param-dedupe.html','<!doctype html>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/boss-param-dedupe.html');
 const result=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/src/audio/audio.js');
  const {BossParamDedupe,syncMobileBossParamDedupe:sync}=await import('/src/audio/mobileBossParamDedupe.js');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const rows=[];
  for(const rate of [44100,48000])for(const model of ['equalpower','HRTF'])for(const moving of [false,true]){
   const outputs=[];let stats;
   for(const optimized of [false,true]){
    const ctx=new OfflineAudioContext(2,Math.ceil(rate*3.1),rate),a=new AudioEngine({hrtf:model==='HRTF'});
    let now=0;a.ctx={listener:ctx.listener,get currentTime(){return now;},get state(){return ctx.state;},sampleRate:rate};
    globalThis.inkwaveMobile={};a.setBossParamDedupe(optimized);
    const p=ctx.createPanner(),lp=ctx.createBiquadFilter(),send=ctx.createGain(),source=ctx.createOscillator(),level=ctx.createGain();
    p.panningModel=model;p.distanceModel='inverse';p.refDistance=3;p.rolloffFactor=1.2;p.positionZ.value=-8;lp.frequency.value=22000;lp.Q.value=.5;send.gain.value=.08;
    const voice={panner:p,lp,send,rev:.08,dk:1};source.type='sawtooth';source.frequency.value=246.94;level.gain.value=.1;
    source.connect(level);level.connect(lp).connect(p).connect(ctx.destination);level.connect(send).connect(ctx.destination);source.start();
    for(let i=0;i<90;i++){
     now=i/30+(i%3)*.00013;
     const t=moving?Math.floor(i/4)/7:0,yaw=t*.17;
     a.setListener({x:moving?Math.sin(t)*4:0,y:1.5,z:0},{x:Math.sin(yaw),y:0,z:-Math.cos(yaw)},{x:0,y:1,z:0});
     a._setPos(voice,{x:moving?Math.sin(t*.7)*7:0,y:i>=35&&i<43?1.2:.3,z:-8-t*2},now);
    }
    stats=a.bossParamDedupeInfo();outputs.push(await ctx.startRendering());a.setBossParamDedupe(false);
   }
   let maxDifference=0,squareError=0,power=0;for(let c=0;c<2;c++){const a=outputs[0].getChannelData(c),b=outputs[1].getChannelData(c);for(let i=0;i<a.length;i++){const e=a[i]-b[i];maxDifference=Math.max(maxDifference,Math.abs(e));squareError+=e*e;power+=a[i]*a[i];}}
   rows.push({rate,model,moving,maxDifference,snrDb:squareError?10*Math.log10(power/squareError):null,stats});
  }
  // 原生边界：变化/时间常数变化必须提交；倒序或外部排期使该参数后续全部走原调用。
  const context=new OfflineAudioContext(1,1024,48000),param=context.createGain().gain,cache=new BossParamDedupe();
  check(cache.target(param,.2,0,.01)===param,'原生返回值改变');cache.target(param,.2,.01,.01);check(cache.info().skipped===1,'重复未合并');
  cache.target(param,.3,.02,.01);cache.target(param,.3,.03,.02);check(cache.info().submitted===3,'目标/时间常数变化被丢弃');
  cache.target(param,.3,.025,.02);cache.target(param,.3,.04,.02);check(cache.info().submitted===5&&cache.info().invalidated===1,'倒序未退回原排期');
  const external=context.createGain().gain,ext=new BossParamDedupe();ext.target(external,.1,0,.01);ext.invalidate(external);external.setValueAtTime(.8,.02);ext.target(external,.1,.03,.01);ext.target(external,.1,.04,.01);check(ext.info().submitted===3&&!ext.info().skipped,'外部排期失效后仍合并');
  let error='';try{ext.target(external,.1,.05,-1);}catch(e){error=e.name;}check(error==='RangeError','原生非法参数异常改变');
  const alias=new BossParamDedupe(),p=context.createGain().gain;alias.target(p,1,0,.01);alias.target(p,1+1e-12,.01,.01);check(alias.info().skipped===1,'原生float相同目标未等价处理');
  // PC强制关闭、真实控制器八种退出/隔离，以及上下文重建清理。
  const a=new AudioEngine(),pos={x:0,y:1,z:0},forward={x:0,y:0,z:-1},up={x:0,y:1,z:0};a.ctx={listener:context.listener,currentTime:0};
  globalThis.inkwaveMobile=false;a.setBossParamDedupe(true);a.setListener(pos,forward,up);check(!a.bossParamDedupeInfo().active,'PC被启用');
  globalThis.inkwaveMobile={};const game={boss:{},state:'playing'};sync(a,game,'match',false);a.setListener(pos,forward,up);a.setListener(pos,forward,up);check(a.bossParamDedupeInfo().skipped===9,'实际引擎未合并九参数');
  const second=new OfflineAudioContext(1,1024,48000);a.ctx={listener:second.listener,currentTime:0};sync(a,game,'match',false);a.setListener(pos,forward,up);check(a.bossParamDedupeInfo().submitted===9&&!a.bossParamDedupeInfo().skipped,'上下文重建复用了旧缓存');
  for(const [m,mode,suspended]of [[{boss:null,state:'playing'},'match',false],[{boss:{},state:'intro'},'match',false],[{boss:{},state:'finish'},'match',false],[{boss:{},state:'playing',attract:true},'match',false],[{boss:{},state:'playing',paused:true},'match',false],[game,'menu',false],[game,'match',true]]){sync(a,game,'match',false);sync(a,m,mode,suspended);check(!a.bossParamDedupeInfo().active,'隔离/退出失效');}
  const old={position:0,orientation:0};a.ctx={listener:{setPosition(){old.position++;},setOrientation(){old.orientation++;}},currentTime:0};sync(a,game,'match',false);a.setListener(pos,forward,up);check(old.position===1&&old.orientation===1,'旧浏览器回退改变');
  a.setBossParamDedupe(false);check(!a._bossParamDedupe&&!a._bossParamContext,'停用未释放缓存/上下文');
  return {rows,boundaries:'原生返回/目标与tau变化/float同值/倒序/外部失效/异常/PC普通开场结束演示暂停后台菜单隔离/上下文重建/旧浏览器/释放通过',acceptance:{maxPcmDifference:1e-4,minSnrDb:80}};
 });
 await writeFile('releases/investigation/boss-param-dedupe-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(result.rows.some(r=>r.maxDifference>result.acceptance.maxPcmDifference||r.snrDb!==null&&r.snrDb<result.acceptance.minSnrDb))throw Error('真实定位音频误差超出预先设定界限，候选不得发布');
}finally{await browser.close()}
