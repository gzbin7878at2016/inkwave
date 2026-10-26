// 只读CPU策略与温度；不改频率/温控/省电设置。可在降温或独立方法轮记录，不能混充正式成绩。
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const seconds=Number(process.env.BOSS_POLICY_SECONDS||0),name=process.env.BOSS_POLICY_NAME||'snapshot';
if(!Number.isFinite(seconds)||seconds<0||seconds>120||!/^[a-z0-9-]+$/i.test(name))throw Error('策略采集须0～120秒且名称仅字母数字连字符');
const adb=process.env.ADB_PATH||`${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`,target=process.env.ANDROID_SERIAL?['-s',process.env.ANDROID_SERIAL]:['-d'];
const command=(...args)=>execFileSync(adb,[...target,...args],{encoding:'utf8',timeout:10000});
const fields=['scaling_cur_freq','scaling_max_freq','cpuinfo_max_freq'],cores=[0,4,7],files=cores.flatMap(core=>fields.map(field=>`/sys/devices/system/cpu/cpu${core}/cpufreq/${field}`));
const report={performanceTest:false,readOnly:true,requestedSeconds:seconds,samples:[]},path=`releases/investigation/cpu-policy-${name}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
await mkdir('releases/investigation',{recursive:true});
try{const start=Date.now();for(;;){
 const sample={at:Date.now(),state:command('get-state').trim()},values=command('shell','cat',...files).trim().split(/\s+/);
 if(values.length!==9||values.some(v=>!/^\d+$/.test(v)))throw Error('CPU策略文件缺失或格式无效，不能据此判定限频');
 sample.cpus=cores.map((core,i)=>({core,...Object.fromEntries(fields.map((field,j)=>[field,Number(values[i*3+j])]))}));
 sample.batteryTemperatureC=Number(command('shell','dumpsys','battery').match(/temperature:\s*(-?\d+)/)?.[1])/10;
 try{sample.appPid=command('shell','pidof','com.demoink.inkwave').trim();}catch{sample.appPid=null;}
 report.samples.push(sample);console.log(JSON.stringify(sample));await writeFile(path,JSON.stringify(report,null,2));
 if(Date.now()-start>=seconds*1000)break;await new Promise(r=>setTimeout(r,5000));
 }report.ok=true;
}catch(error){report.ok=false;report.error=String(error);process.exitCode=1;}
finally{await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify({path,ok:report.ok,error:report.error,samples:report.samples.length}));}
