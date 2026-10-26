// 真实USB资源清单：默认不切图；halyard用于核对marina专属资源，不冒充性能对局。
import {androidCDP} from './android-cdp.mjs';
import {textureInventory} from './texture-inventory.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
const map = process.env.TEXTURE_MAP || 'current';
if (!['current','halyard'].includes(map)) throw Error('TEXTURE_MAP只允许current或halyard');
const adb = process.env.ADB_PATH || `${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`;
const target = process.env.ANDROID_SERIAL ? ['-s',process.env.ANDROID_SERIAL] : ['-d'];
const run = (...args) => execFileSync(adb,[...target,...args],{timeout:20000,maxBuffer:16*1024*1024});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const base = `releases/investigation/phone-textures-${map}-${stamp}`;
const report = {map, status:'running', performanceTest:false};
let c;
await mkdir('releases/investigation',{recursive:true});
try {
  run('shell','am','force-stop','com.demoink.inkwave');
  run('shell','am','start','-n','com.demoink.inkwave/.MainActivity');
  c = await androidCDP();
  let ready = false;
  for (let i=0;i<120;i++) {
    const s = await c.evaluate('({ready:!!window.__inkwave,failed:!!document.getElementById("mobile-gpu-error")||document.getElementById("boot-error")?.style.display==="block"})');
    if (s.failed) throw Error('图形初始化失败');
    if (s.ready) { ready=true; break; }
    await new Promise(r=>setTimeout(r,500));
  }
  if (!ready) throw Error('等待就绪超时');
  if (map==='halyard') {
    await c.evaluate('window.__textureMapReady=null;__inkwave.startMatch({mapId:"halyard",practice:true,duration:60}).then(v=>__textureMapReady=v,e=>__textureMapReady=String(e));true');
    let loaded=false;
    for (let i=0;i<180;i++) {
      const s=await c.evaluate('window.__textureMapReady');
      if(s===true){loaded=true;break;} if(s!==null)throw Error(`切图失败：${s}`);
      await new Promise(r=>setTimeout(r,500));
    }
    if(!loaded)throw Error('切图等待超时');
  }
  await new Promise(r=>setTimeout(r,2000));
  report.inventory = await c.evaluate(`(${textureInventory.toString()})()`);
  if(map==='halyard'&&!report.inventory.marina)throw Error('未进入marina，不能验收远景资源');
  report.diagnostics = await c.evaluate('inkwaveDiagnostics.report({probe:true})');
  if(report.diagnostics.current.shaderFailures.length)throw Error('存在着色器失败');
  await writeFile(`${base}.png`,run('exec-out','screencap','-p'));
  report.status='collected';
} catch(error) { report.status='failed';report.error=String(error);process.exitCode=1; }
finally {
  if(c)try {
    const status=await c.evaluate('(async()=>{const b=document.querySelector("#mobile-log-upload");if(!b||b.disabled)throw Error("上传不可用");b.click();for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,100));if(!b.disabled)return document.querySelector("#mobile-log-status")?.textContent;}throw Error("上传超时")})()');
    const filename=status?.match(/INKWAVE-logs-[\w-]+\.json/)?.[0];
    if(!status?.includes('上传成功（USB）')||!filename)throw Error(status||'无USB回执');
    const saved=JSON.parse(await readFile(`releases/logs/${filename}`,'utf8'));
    if(!report.diagnostics||saved.current.build.sourceCommit!==report.diagnostics.current.build.sourceCommit)throw Error('源码未核对');
    report.upload={ok:true,filename};
  }catch(error){report.upload={ok:false,error:String(error)};process.exitCode=1;}
  c?.close();
  try {
    run('shell','am','force-stop','com.demoink.inkwave');
    try {report.appClosed=!run('shell','pidof','com.demoink.inkwave').toString().trim();}
    catch(error){if(error.status!==1)throw error;report.appClosed=true;}
  }catch(error){report.appClosed=false;report.closeError=String(error);process.exitCode=1;}
  await writeFile(`${base}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({path:`${base}.json`,status:report.status,error:report.error,upload:report.upload,appClosed:report.appClosed}));
}
