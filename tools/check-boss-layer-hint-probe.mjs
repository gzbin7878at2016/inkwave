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
  const {createMobileBossRasterHints}=await import('/src/platform/mobileBossRasterHints.js'),hints=createMobileBossRasterHints(),root=tags[0].parentElement;
  hints.update(root,m,'match',false);check(!root.classList.contains('iw-mobile-boss-raster'),'PC错误启用');
  window.inkwaveMobile={};hints.update(root,m,'match',false);check(hints.info().active&&root.classList.contains('iw-mobile-boss-raster'),'手机Boss未启用');
  for(const [match,mode,suspended]of [[{boss:null,state:'playing'},'match',false],[{...m,attract:true},'match',false],[{...m,paused:true},'match',false],[{...m,state:'intro'},'match',false],[{...m,state:'finish'},'match',false],[m,'menu',false],[m,'match',true]]){hints.update(root,m,'match',false);hints.update(root,match,mode,suspended);check(!hints.info().active&&!root.classList.contains('iw-mobile-boss-raster'),'产品范围/退出错误');}
  hints.update(root,m,'match',false);const replacement=document.createElement('div');hints.update(replacement,m,'match',false);check(!root.classList.contains('iw-mobile-boss-raster')&&replacement.classList.contains('iw-mobile-boss-raster'),'替换HUD残留');hints.clear();check(!replacement.classList.contains('iw-mobile-boss-raster'),'后台清理失败');delete window.inkwaveMobile;
  return {scope:true,visiblePropertiesUnchanged:true,cancelAndCleanup:true,productScopeAndLifecycle:true};
 });console.log(JSON.stringify(result));
}finally{await browser.close();}
