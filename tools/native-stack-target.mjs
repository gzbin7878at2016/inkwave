// 必须同时证明专用ADB转发属于游戏主进程、本页标记唯一、目标线程仍在该renderer内。
export function validateNativeStackTarget({serial,appPid,forwardList,markers,ps}){
 if(!/^[A-Za-z0-9-]+$/.test(serial)||!Number.isSafeInteger(appPid)||appPid<=0)throw Error('ADB设备或主进程无效');
 const owned=forwardList.trim().split(/\r?\n/).some(s=>s.trim()===`${serial} tcp:9223 localabstract:webview_devtools_remote_${appPid}`);
 if(!owned)throw Error('9223不是本轮游戏主进程的专用转发');
 const pairs=new Map(markers.map(e=>[`${e.pid}:${e.tid}`,e]));if(pairs.size!==1)throw Error('本页PID/TID标记缺失或不唯一');
 const {pid,tid}=pairs.values().next().value;
 if(!Number.isSafeInteger(pid)||!Number.isSafeInteger(tid)||pid<=0||tid<=0)throw Error('本页PID/TID无效');
 const lines=ps.trim().split(/\r?\n/),header=lines.shift().trim().split(/\s+/),pi=header.indexOf('PID'),ti=header.indexOf('TID');
 if(pi<0||ti<0||!lines.some(s=>{const f=s.trim().split(/\s+/);return Number(f[pi])===pid&&Number(f[ti])===tid&&f.at(-1)==='CrRendererMain';}))throw Error('目标renderer主线程已消失或不匹配');
 return{rendererPid:pid,rendererMainTid:tid,appPid};
}
