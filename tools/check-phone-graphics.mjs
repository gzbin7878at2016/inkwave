// USB最小图形隔离：每次新进程，仅一张2D画布和一个WebGL上下文；完成即关闭。
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {androidCDP} from './android-cdp.mjs';
const adb=process.env.ADB_PATH||`${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`;
const target=process.env.ANDROID_SERIAL?['-s',process.env.ANDROID_SERIAL]:['-d'];
const run=(...args)=>execFileSync(adb,[...target,...args],{timeout:20000,maxBuffer:16*1024*1024});
const rounds=Number(process.env.GRAPHICS_PROBE_RUNS||3);
if(!Number.isInteger(rounds)||rounds<1||rounds>10)throw Error('诊断次数须为1～10');
await mkdir('releases/investigation',{recursive:true});
const result={startedAt:new Date().toISOString(),build:JSON.parse(await readFile('releases/android-build-info.json','utf8')),runs:[]};
const save=()=>writeFile('releases/investigation/phone-minimal-graphics.json',JSON.stringify(result,null,2));
for(let i=0;i<rounds;i++){
 let c;const sample={round:i+1};result.runs.push(sample);
 try{
  run('shell','am','force-stop','com.demoink.inkwave');
  run('shell','am','start','-n','com.demoink.inkwave/.MainActivity','--ez','inkwave.graphicsProbe','true');
  c=await androidCDP();
  for(let n=0;n<40;n++){
   const state=await c.evaluate('window.__graphicsProbe||null');
   if(state?.complete&&state.ticks>=6){sample.report=state;break}
   await new Promise(r=>setTimeout(r,250));
  }
  if(!sample.report)throw Error('最小图形页未完成');
  if(sample.report.gamePresent)throw Error('诊断被游戏启动污染');
  await writeFile(`releases/investigation/phone-minimal-graphics-${i+1}.png`,run('exec-out','screencap','-p'));
  sample.passed=sample.report.passed&&sample.report.canvas2D?.join(',')==='32,160,96,255';
  if(!sample.passed)process.exitCode=1;
  console.log(JSON.stringify({round:i+1,passed:sample.passed,report:sample.report}));
 }catch(error){sample.passed=false;sample.error=String(error);process.exitCode=1;console.error(error)}
 finally{
  c?.close();
  try{run('shell','am','force-stop','com.demoink.inkwave');sample.closed=true}catch(error){sample.closed=false;sample.closeError=String(error);process.exitCode=1}
  await save();
 }
}
