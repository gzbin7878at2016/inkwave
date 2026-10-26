// 用真实OfflineAudioContext验证调查器逐次原样转发、PCM不变、异常与所有权恢复不变。
import puppeteer from 'puppeteer-core';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{
 await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/audio-param-probe.html','<!doctype html>');
 const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/audio-param-probe.html');
 const result=await page.evaluate(async()=>{
  const {installBossAudioParamProbe:install}=await import('/tools/boss-audio-param-probe.mjs');
  const check=(ok,text)=>{if(!ok)throw Error(text);};
  const setup=model=>{
   const ctx=new OfflineAudioContext(2,8192,48000),source=ctx.createOscillator(),panner=ctx.createPanner(),lp=ctx.createBiquadFilter(),send=ctx.createGain();
   panner.panningModel=model;panner.positionZ.value=-3;lp.frequency.value=8000;source.frequency.value=350;source.connect(lp).connect(panner).connect(ctx.destination);source.start();
   const audio={ctx,setListener(pos){ctx.listener.positionX.setTargetAtTime(pos.x,pos.t,.01);ctx.listener.upY.setTargetAtTime(1,pos.t,.01);return 'listener';},_setPos(v,pos,t){v.panner.positionX.setTargetAtTime(pos.x,t,.02);v.lp.frequency.setTargetAtTime(5000,t,.05);v.send.gain.setTargetAtTime(.1,t,.05);return v;}};
   return {audio,voice:{panner,lp,send},source};
  };
  const cases=[];
  for(const model of ['equalpower','HRTF']){
   const buffers=[];let stats;
   for(const monitored of [false,true]){
    const {audio,voice}=setup(model),listener=audio.setListener,position=audio._setPos;
    if(monitored)install(audio);
    for(const [i,x]of [0,0,0,1,1,-2,-2,0].entries()){
     const t=i*.012;check(audio.setListener({x,t})==='listener','调用返回值改变');check(audio._setPos(voice,{x},t)===voice,'声像器返回值改变');
    }
    let nativeError='';try{voice.panner.positionX.setTargetAtTime(0,.1,-1);}catch(e){nativeError=e.name;}check(nativeError==='RangeError','原生参数异常未保留');
    if(monitored){stats=__bossAudioParamProbe.stop();check(!stats.active&&stats.duplicates>0&&!stats.ownershipChanged,'统计或恢复失败');check(audio.setListener===listener&&audio._setPos===position,'引擎方法未恢复');check(!Object.hasOwn(voice.panner.positionX,'setTargetAtTime'),'继承方法被残留覆盖');}
    buffers.push(await audio.ctx.startRendering());
   }
   let maxDifference=0;for(let c=0;c<2;c++){const a=buffers[0].getChannelData(c),b=buffers[1].getChannelData(c);for(let i=0;i<a.length;i++)maxDifference=Math.max(maxDifference,Math.abs(a[i]-b[i]));}
   check(maxDifference===0,'观察器改变PCM '+model+' '+maxDifference);cases.push({model,maxDifference,stats});
  }
  const {audio}=setup('equalpower');install(audio);audio.setListener({x:0,t:0});const foreign=()=>{};audio.ctx.listener.positionX.setTargetAtTime=foreign;const state=__bossAudioParamProbe.stop();check(state.ownershipChanged===1&&audio.ctx.listener.positionX.setTargetAtTime===foreign,'恢复覆盖外部接管');
  return {cases,ownershipPreserved:true};
 });
 await writeFile('releases/investigation/boss-audio-param-probe-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}
