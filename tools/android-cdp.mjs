import {execFileSync} from 'node:child_process';
export async function androidCDP(){
 const adb=process.env.ADB_PATH||`${process.env.USERPROFILE}/.cache/demoink-android/sdk/platform-tools/adb.exe`;
 const target=process.env.ANDROID_SERIAL?['-s',process.env.ANDROID_SERIAL]:['-d'];
 const command=(...args)=>execFileSync(adb,[...target,...args],{encoding:'utf8',timeout:15000});
 const pid=command('shell','pidof','com.demoink.inkwave').trim();if(!/^\d+$/.test(pid))throw Error('游戏进程未运行');
 command('forward','tcp:9223',`localabstract:webview_devtools_remote_${pid}`);
 let page;for(let i=0;i<20;i++){try{page=(await(await fetch('http://127.0.0.1:9223/json',{signal:AbortSignal.timeout(3000)})).json()).find(t=>t.url==='https://localhost/');if(page)break;}catch{}await new Promise(r=>setTimeout(r,500));}if(!page)throw Error('WebView调试目标未出现');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map();
 // USB断线立即拒绝未完成请求，避免等待数分钟后丢失故障证据。
 const fail=reason=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(reason))}pending.clear()};
 ws.onclose=()=>fail('WebView调试连接断开');ws.onerror=()=>fail('WebView调试连接错误');
 ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(!p)return;pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result)}};
 const evaluate=async expression=>{if(ws.readyState!==WebSocket.OPEN)throw Error('WebView调试连接已关闭');const result=await new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP执行超时'))},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
 return {evaluate,command,close(){fail('CDP关闭');ws.close();try{command('forward','--remove','tcp:9223')}catch{}}};
}
