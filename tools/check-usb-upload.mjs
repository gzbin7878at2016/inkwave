import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readdir,readFile,writeFile} from 'node:fs/promises';
const adb=process.env.ADB_PATH||'C:/Users/Administrator/.cache/demoink-android/sdk/platform-tools/adb.exe';
const serial=process.env.ANDROID_SERIAL||'A38YUT3C19022796';
const targets=await(await fetch('http://127.0.0.1:9223/json')).json();
const target=targets.find(t=>t.url==='https://localhost/');assert.ok(target);
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
let id=0;const pending=new Map();ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(v.error):p.resolve(v.result)}};
const call=(method,params)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const upload=()=>evaluate(`(async()=>{document.querySelector('#mobile-log-upload').click();for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,200));if(!document.querySelector('#mobile-log-upload').disabled)return document.querySelector('#mobile-log-status')?.textContent}throw Error('上传超时')})()`);
const command=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8'});
try{
 const before=new Set(await readdir('releases/logs')); const success=await upload();assert.ok(success.includes('上传成功（USB）'),success);
 const files=(await readdir('releases/logs')).filter(n=>!before.has(n)&&n.endsWith('.json'));assert.equal(files.length,1);
 const log=JSON.parse(await readFile('releases/logs/'+files[0],'utf8'));const metadata=JSON.parse(await readFile('releases/android-build-info.json','utf8'));assert.equal(log.current.build.versionCode,metadata.versionCode);assert.equal(log.current.build.sourceCommit,metadata.sourceCommit);console.log('USB真实日志已落盘',files[0]);
 command('reverse','--remove','tcp:18765');const failed=await upload();assert.ok(failed.includes('上传失败'));assert.equal((await readdir('releases/logs')).length,before.size+1);console.log('断开USB通道正确失败，无新增日志');
 command('reverse','tcp:18765','tcp:8765');assert.ok((await upload()).includes('上传成功（USB）'));console.log('恢复通道重试成功');
 await writeFile('releases/investigation/usb-upload-check.json',JSON.stringify({success,failed,files,device:serial},null,2));
}finally{command('reverse','tcp:18765','tcp:8765');ws.close()}
