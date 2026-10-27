// 真实HUD/TouchInput/installMobile DOM入口：省去无效写入，同时保持原显示与输入状态。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});
await writeFile('releases/investigation/boss-dom-writes.html','<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/jsm/"}}</script><link rel="stylesheet" href="/styles/ui.css"><link rel="stylesheet" href="/styles/mobile.css"><div id="ui-root"></div>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.setViewport({width:778,height:370,deviceScaleFactor:2,isMobile:true,hasTouch:true});await page.goto('http://localhost:8490/releases/investigation/boss-dom-writes.html');
 const report=await page.evaluate(async()=>{
  const {HUD}=await import('/src/ui/hud.js'),{G}=await import('/src/core/ctx.js'),{installMobile}=await import('/src/platform/mobile.js');
  const check=(ok,msg)=>{if(!ok)throw Error(msg);},rows=[];
  for(const kind of ['mobileBoss','PC','ordinary','attract','menu']){
   globalThis.inkwaveMobile=kind==='PC'?false:{native:false};G.mode=kind==='menu'?'menu':'match';
   const actors=[{name:'Peer',weaponId:'shooter',specialReady:()=>false}],match={boss:kind==='ordinary'?null:{},attract:kind==='attract',actors,state:'playing',paused:false};G.match=match;
   const hud=new HUD(document.getElementById('ui-root')),el=hud.markers[0],style=el.style,native=style.setProperty,descriptor=Object.getOwnPropertyDescriptor(style,'setProperty');let writes=0;
   Object.defineProperty(style,'setProperty',{configurable:true,value:function(name,...args){if(name==='--far')writes++;return native.call(this,name,...args);}});
   const marker=(x,dist=20)=>[{x,y:100,onScreen:true,name:'Peer',weapon:'shooter',color:'#ffffff',dist,tracked:false}];
   for(let i=0;i<120;i++)hud._updMarkers(marker(i));
   check(writes===(kind==='mobileBoss'?1:120),kind+'相同距离写入次数 '+writes);
   const constantWrites=writes;
   const distances=[10,14,24,34,100,20];for(let i=0;i<distances.length;i++){const d=distances[i];hud._updMarkers(marker(200+i,d));check(style.getPropertyValue('--far')===Math.min(1,Math.max(0,(d-14)/20)).toFixed(2),kind+'距离值被改变');}
   native.call(style,'--far','0.30','important');hud._updMarkers(marker(300));check(!style.getPropertyPriority('--far')&&style.getPropertyValue('--far')==='0.30',kind+'原优先级恢复语义被改变');
   check(style.transform==='translate3d(300px, 100px, 0px)',kind+'位置被改变：'+style.transform);
   const computed={opacity:getComputedStyle(el).opacity,scale:getComputedStyle(el.querySelector('.iw-mk__tag')).scale};
   if(rows.length)check(JSON.stringify(computed)===JSON.stringify(rows[0].computed),kind+'实际透明度或缩放不同');
   rows.push({kind,markerConstantDistanceWrites:constantWrites,finalFar:style.getPropertyValue('--far'),finalPosition:style.transform,computed});
   if(descriptor)Object.defineProperty(style,'setProperty',descriptor);else delete style.setProperty;
   if(kind==='PC')continue;
   const game={input:{keys:new Set(),pressed:new Set(),mouse:{left:false}},settings:{fpsCap:30},match,menus:{current:null},R:{renderer:{domElement:document.createElement('canvas'),renderBufferDirect(){},info:{memory:{},render:{calls:0,triangles:0}}}},pause(){this.match.paused=true;},resume(){this.match.paused=false;},startPractice(){}};
   installMobile(game);game.mobile.update(0);
   const touch=game.mobile.touch,panel=[...document.querySelectorAll('#mobile-panel')].at(-1),button=panel.querySelector('[data-mobile="practice"]');
   const hidden=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'hidden');let jumpWrites=0,practiceWrites=0;
   for(const [node,count]of [[touch.jumpPanel,()=>jumpWrites++],[button,()=>practiceWrites++]])Object.defineProperty(node,'hidden',{configurable:true,get(){return hidden.get.call(this);},set(value){count();hidden.set.call(this,value);}});
   for(let i=0;i<120;i++)game.mobile.update(0);
   check(jumpWrites===(kind==='mobileBoss'?0:120)&&practiceWrites===(kind==='mobileBoss'?0:120),kind+'hidden写入或原路径改变');
   const stableWrites={jumpHiddenWrites:jumpWrites,practiceHiddenWrites:practiceWrites};
   if(kind==='mobileBoss'){
    touch.mapOpen=true;game.mobile.update(0);check(!touch.jumpPanel.hidden&&touch.root.classList.contains('map-open')&&touch.down('Tab'),'地图开启行为');
    touch.mapOpen=false;game.mobile.update(0);check(touch.jumpPanel.hidden&&!touch.down('Tab'),'地图关闭行为');
    hidden.set.call(button,false);game.mobile.update(0);check(button.hidden,'外部hidden改动未纠正');
    match.paused=true;game.mobile.update(0);check(!touch.enabled&&touch.root.hidden&&!touch.action('fire'),'暂停未禁用触控');
    match.paused=false;game.mobile.update(0);check(touch.enabled&&!touch.root.hidden,'恢复未启用触控');
   }
   Object.assign(rows.at(-1),stableWrites);touch.root.remove();panel.remove();[...document.querySelectorAll('#mobile-dialog')].at(-1).remove();
  }
  return{passed:true,performanceTest:false,rows};
 });
 await writeFile('releases/investigation/boss-dom-writes.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
