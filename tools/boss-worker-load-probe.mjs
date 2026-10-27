// 仅方法调查：15～45秒每个游戏帧把固定计算量交给独立Worker，检验另一核心能否并行承担渲染级负载而不拖慢主线程。
// 负载按主线程开局校准的“每毫秒迭代数”换算成固定工作量（非固定墙钟），Worker上报实际耗时即反映所在核心速度。
// 上一份未完成时本帧不再派发并计数skipped，绝不排队；不触碰游戏Canvas、模拟、声音、输入或设置。
export function createBossWorkerLoadProbe(loadMs,{calibrateMs=12}={}){
 if(!Number.isInteger(loadMs)||loadMs<1||loadMs>30)throw Error('Worker负载须为1～30毫秒整数');
 // 4x4矩阵连乘近似three.js世界矩阵/骨骼计算；同一内核先在主线程校准。
 const kernel=(n,m)=>{let s=0;for(let k=0;k<n;k++){for(let i=0;i<4;i++)for(let j=0;j<4;j++){const v=m[i]*m[16+j*4]+m[i+4]*m[17+j*4]+m[i+8]*m[18+j*4]+m[i+12]*m[19+j*4];m[32+i+j*4]=v;s+=v;}m[16+(k&15)]=m[32+(k&15)]*.5+.25;}return s;};
 const matrix=()=>{const m=new Float32Array(48);for(let i=0;i<32;i++)m[i]=(i%5)*.1+.3;return m;};
 // 先预热同样时长让JIT完成优化，再计时校准；冷启动校准会低估约3～4倍。
 const scratch=matrix(),warm=performance.now();while(performance.now()-warm<calibrateMs)kernel(256,scratch);
 let iterations=0;const start=performance.now();
 while(performance.now()-start<calibrateMs){kernel(256,scratch);iterations+=256;}
 const itersPerMs=Math.max(256,Math.round(iterations/(performance.now()-start))),work=itersPerMs*loadMs;
 const source=`const kernel=${kernel.toString()},m=(${matrix.toString()})();onmessage=e=>{const t=performance.now(),s=kernel(e.data.work,m);postMessage({seq:e.data.seq,workerMs:performance.now()-t,startLag:t-e.data.sentAt,s});};`;
 const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
 const worker=new Worker(url);
 const workerMs=[],turnaround=[],transitions=[];let phase='',seq=0,outstanding=0,sent=0,done=0,skipped=0,maxStartLag=0,error=null,disposed=false;
 worker.onmessage=e=>{if(disposed)return;outstanding--;done++;if(workerMs.length<4000){workerMs.push(e.data.workerMs);turnaround.push(performance.now()-e.data.sentAt);}maxStartLag=Math.max(maxStartLag,e.data.startLag);};
 worker.onerror=e=>{e.preventDefault();error=String(e.message).slice(0,180);};
 const stat=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return {n:s.length,p50:+s[s.length>>1].toFixed(3),p95:+s[Math.floor((s.length-1)*.95)].toFixed(3),max:+s[s.length-1].toFixed(3)};};
 const update=(match,mode,ms)=>{
  if(disposed)return;
  const live=!!match?.boss&&!match.attract&&match.state==='playing'&&!match.paused&&mode==='match';
  const next=!live?'inactive':ms>=45000?'restored':ms>=15000?'loaded':'baseline';
  if(next!==phase){phase=next;if(transitions.length<12)transitions.push({phase,activeMs:ms,sent,done,skipped});}
  if(phase!=='loaded'||error)return;
  if(outstanding>0){skipped++;return;}
  outstanding++;sent++;worker.postMessage({seq:++seq,work,sentAt:performance.now()});
 };
 return {update,phaseNow:()=>phase,
  info:()=>({loadMs,itersPerMs,work,phase,sent,done,skipped,outstanding,maxStartLagMs:+maxStartLag.toFixed(3),workerMs:stat(workerMs),turnaroundMs:stat(turnaround),
   // 同等工作量在Worker核心上的耗时/主线程校准耗时；>1表示Worker所在核心更慢。
   speedRatio:workerMs.length?+(stat(workerMs).p50/loadMs).toFixed(3):null,error,disposed,transitions}),
  dispose(){if(disposed)return;disposed=true;worker.terminate();URL.revokeObjectURL(url);phase='disposed';}};
}
