// 环境烘焙隔离：复用最小页的同一个WebGL上下文，排除场景/角色/后处理。
import {androidCDP} from './android-cdp.mjs';
import {execFileSync,spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {readFile,readdir,writeFile} from 'node:fs/promises';
const adb=process.env.ADB_PATH||`${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`;
const target=process.env.ANDROID_SERIAL?['-s',process.env.ANDROID_SERIAL]:['-d'];
const run=(...args)=>execFileSync(adb,[...target,...args],{timeout:20000});
const mode=process.env.ENV_PROBE_MODE||'skip-cloud';
if(!['skip-cloud','full'].includes(mode))throw Error('ENV_PROBE_MODE只支持skip-cloud/full');
let core;
for(const name of await readdir('dist-mobile/src/chunks')){
 const text=await readFile(`dist-mobile/src/chunks/${name}`,'utf8');
 if(text.includes('WebGLRenderer,\n  three_module_exports')){core=name;break}
}
if(!core)throw Error('未找到本APK对应的Three.js共享模块');
let c,logger,stream;
const result={mode,build:JSON.parse(await readFile('releases/android-build-info.json','utf8'))};
try{
 run('shell','am','force-stop','com.demoink.inkwave');
 run('shell','am','start','-n','com.demoink.inkwave/.MainActivity','--ez','inkwave.graphicsProbe','true');
 c=await androidCDP();
 const pid=run('shell','pidof','com.demoink.inkwave').toString().trim();
 stream=createWriteStream(`releases/investigation/phone-environment-${mode}.log`);
 logger=spawn(adb,[...target,'logcat','-v','threadtime','--pid='+pid,'-T','1']);logger.stdout.pipe(stream);
 const base=await c.evaluate('window.__graphicsProbe');if(!base?.passed)throw Error('最小图形前置检查失败');
 result.baseline=base;
 result.probe=await c.evaluate(`(async()=>{
  const THREE=(await import('https://localhost/src/chunks/${core}')).three_module_exports;
  const {G}=await import('https://localhost/src/core/ctx.js');
  const {Environment}=await import('https://localhost/src/world/environment.js');
  const canvas=document.querySelector('#gpu'),gl=canvas.getContext('webgl2');
  const renderer=new THREE.WebGLRenderer({canvas,context:gl,alpha:false,antialias:false});
  renderer.setSize(128,128,false);const scene=new THREE.Scene();
  G.renderer=renderer;G.scene=scene;G.settings={quality:'low'};
  const report=window.__environmentProbe={events:[],mode:'${mode}'};
  const emit=(name,state,data={})=>{const row={name,state,at:performance.now(),...data};report.events.push(row);console.info('[INKWAVE_ENV_PROBE]',JSON.stringify(row));};
  for(const name of ['_bakeClouds','_rebuildEnvMap','_bakeFarReflection']){
   const original=Environment.prototype[name];
   Environment.prototype[name]=function(...args){
    emit(name,'begin');const start=performance.now();
    if(name==='_bakeClouds'&&'${mode}'==='skip-cloud'){emit(name,'skipped');return}
    const value=original.apply(this,args);gl.finish();
    const errors=[];for(let i=0;i<8;i++){const e=gl.getError();if(!e)break;errors.push(e)}
    emit(name,'end',{ms:performance.now()-start,lost:gl.isContextLost(),errors});
    if(gl.isContextLost()||errors.length)throw Error('环境步骤图形失败：'+name);return value;
   };
  }
  emit('Environment','begin');window.__probeEnvironment=new Environment(renderer,scene,{theme:'day',shadowSize:512});
  emit('Environment','end');report.lost=gl.isContextLost();return report;
 })()`);
 console.log(JSON.stringify(result.probe));
}catch(error){result.error=String(error);process.exitCode=1;console.error(error)}
finally{
 if(c)result.partial=await c.evaluate('window.__environmentProbe||null').catch(()=>null);
 logger?.kill();stream?.end();c?.close();
 run('shell','am','force-stop','com.demoink.inkwave');result.closed=true;
 await writeFile(`releases/investigation/phone-environment-${mode}.json`,JSON.stringify(result,null,2));
}
