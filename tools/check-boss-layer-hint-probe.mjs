// 真浏览器检查范围与退出清理，确保探针只添加合成提示，不改变可见属性。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/boss-layer-hint.html','<!doctype html>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/boss-layer-hint.html');
 const result=await page.evaluate(async()=>{
  const {createBossLayerHintProbe:create}=await import('/tools/boss-layer-hint-probe.mjs');
  document.body.innerHTML='<style>.iw-mk__tag{scale:.85;opacity:.7;transform:translateX(5px);display:flex}</style><div class="iw-hud is-boss"><b class="iw-mk__tag">队友</b></div><div class="iw-hud"><b class="iw-mk__tag">普通</b></div><canvas width="32" height="16"></canvas>';
  const check=(x,m)=>{if(!x)throw Error(m);},tags=[...document.querySelectorAll('.iw-mk__tag')],props=['scale','transform','opacity','display','fontSize','color','width','height'],sample=()=>tags.map(el=>Object.fromEntries(props.map(k=>[k,getComputedStyle(el)[k]]))),baseline=JSON.stringify(sample()),m={boss:{},state:'playing'};
  const probe=create();probe.update(m,'match',14999);check(getComputedStyle(tags[0]).willChange==='auto','提前应用');probe.update(m,'match',15000);
  check(getComputedStyle(tags[0]).willChange.includes('transform')&&getComputedStyle(tags[1]).willChange==='auto','提示范围越界');check(JSON.stringify(sample())===baseline,'改变原可见属性');
  probe.update(m,'match',45000);check(getComputedStyle(tags[0]).willChange==='auto','45秒未恢复');
  for(const [match,mode]of [[{boss:null,state:'playing'},'match'],[{...m,attract:true},'match'],[{...m,paused:true},'match'],[{...m,state:'finish'},'match'],[m,'menu']]){probe.update(m,'match',20000);probe.update(match,mode,20000);check(getComputedStyle(tags[0]).willChange==='auto','取消未释放');}
  probe.update(m,'match',20000);probe.dispose();check(!document.querySelector('[data-boss-layer-hint-probe]')&&!probe.info().active&&JSON.stringify(sample())===baseline,'清理失败');
  return {scope:true,visiblePropertiesUnchanged:true,cancelAndCleanup:true};
 });console.log(JSON.stringify(result));
}finally{await browser.close();}
