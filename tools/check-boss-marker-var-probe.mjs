import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('releases/investigation',{recursive:true});await writeFile('releases/investigation/marker-var.html','<!doctype html>');
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto('http://localhost:8490/releases/investigation/marker-var.html');
 console.log(JSON.stringify(await page.evaluate(async()=>{
  const{createBossMarkerVarProbe:create}=await import('/tools/boss-marker-var-probe.mjs');
  document.body.innerHTML='<style>.mk{opacity:calc(1 - var(--far,0)*.45)}.iw-mk__tag{scale:calc(1 - var(--far,0)*.18)}</style><div class="mk"><b class="iw-mk__tag"><svg><path/></svg>队友</b></div>';
  const el=document.querySelector('.mk'),tag=el.firstElementChild,m={boss:{},state:'playing'},native=el.style.setProperty,check=(v,s)=>{if(!v)throw Error(s);};
  const sample=()=>[getComputedStyle(el).opacity,getComputedStyle(tag).scale];const reference=[];
  for(const value of ['0','0.12','0.50','0.91','1']){el.style.setProperty('--far',value);reference.push(sample());}
  const probe=create({markers:[el]});probe.update(m,'match',14999);el.style.setProperty('--far','0');check(el.style.opacity==='','提前开启');probe.update(m,'match',15000);
  let i=0;for(const value of ['0','0.12','0.50','0.91','1']){el.style.setProperty('--far',value);check(sample().every((v,j)=>Math.abs(Number(v)-Number(reference[i][j]))<1e-6),'可见属性改变');check(el.style.getPropertyValue('--far')==='0','仍传播继承变量');i++;}
  probe.update(m,'match',45000);check(el.style.opacity===''&&tag.style.scale===''&&el.style.getPropertyValue('--far')==='1','45秒未恢复');
  for(const match of [{boss:null,state:'playing'},{...m,attract:true},{...m,paused:true},{...m,state:'finish'}]){probe.update(m,'match',20000);el.style.setProperty('--far','0.25');probe.update(match,'match',20000);check(!probe.info().active&&el.style.opacity===''&&tag.style.scale==='','取消失败');}
  probe.update(m,'match',20000);el.style.setProperty('--far','0.75');probe.dispose();check(el.style.setProperty===native&&!Object.hasOwn(el.style,'setProperty')&&tag.style.scale===''&&el.style.opacity==='','清理原方法失败');
  return{visibleValuesUnchanged:true,inheritedVariableStable:true,scopeAndCleanup:true};
 })));
}finally{await browser.close();}
