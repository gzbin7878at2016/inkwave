// 同一线程CPU时钟做区间切分；嵌套作用域只归属最内层一次，不能相加父子耗时。
export function exclusiveTimelineCpu(events,{frames=null}={}){
 const starts=events.filter(e=>e.name==='inkwave-render-start'),ends=events.filter(e=>e.name==='inkwave-render-end');
 if(starts.length!==1||ends.length!==1)throw Error('CPU裁边标记不唯一');
 const s=starts[0],end=ends[0];if(s.pid!==end.pid||s.tid!==end.tid||!Number.isFinite(s.tts)||!Number.isFinite(end.tts)||end.tts<=s.tts)throw Error('CPU标记线程或时钟不合法');
 const edges=[],rows=new Map();let missingCpu=0,partial=0,index=0;
 for(const e of events){
  if(e.pid!==s.pid||e.tid!==s.tid||e.ph!=='X')continue;
  if(!Number.isFinite(e.tts)||!Number.isFinite(e.tdur)||e.tdur<0){missingCpu++;continue;}
  const a=Math.max(s.tts,e.tts),b=Math.min(end.tts,e.tts+e.tdur);if(a>=b)continue;if(a!==e.tts||b!==e.tts+e.tdur)partial++;
  const key=e.name==='FunctionCall'?`${e.name}:${e.args?.data?.functionName||''}@${e.args?.data?.url||''}:${e.args?.data?.lineNumber||0}`:e.name;
  const item={id:index++,key,wallStart:e.ts,wallDuration:e.dur};edges.push({t:a,add:item},{t:b,remove:item});
 }
 edges.sort((a,b)=>a.t-b.t);const active=new Map();let cursor=s.tts,covered=0;
 for(let i=0;i<edges.length;){
  const t=edges[i].t;
  if(t>cursor&&active.size){let leaf;for(const item of active.values())if(!leaf||item.wallStart>leaf.wallStart||(item.wallStart===leaf.wallStart&&item.wallDuration<leaf.wallDuration))leaf=item;
   const dt=t-cursor;rows.set(leaf.key,(rows.get(leaf.key)||0)+dt);covered+=dt;
  }
  while(i<edges.length&&edges[i].t===t){const e=edges[i++];if(e.remove)active.delete(e.remove.id);if(e.add)active.set(e.add.id,e.add);}cursor=t;
 }
 const window=end.tts-s.tts,perFrame=Number.isSafeInteger(frames)&&frames>0;
 return{pid:s.pid,tid:s.tid,windowCpuMs:window/1000,coveredCpuMs:covered/1000,uncoveredCpuMs:(window-covered)/1000,missingCpuFields:missingCpu,boundaryClippedEvents:partial,frames:perFrame?frames:null,
  exclusive:[...rows].sort((a,b)=>b[1]-a[1]).map(([name,us])=>({name,cpuMs:us/1000,...(perFrame?{cpuMsPerGameFrame:us/1000/frames}:{})})),note:'只分配已捕获作用域；父层自身时间仍可能包含未启用类别/低于过滤阈值的工作，不能当作已定位内部函数'};
}
