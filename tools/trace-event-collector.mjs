// Chrome既可能发送完整X事件，也可能分批发送B/E；不能默默丢掉原生Skia作用域。
export function createTraceEventCollector({limit=80000,minUs=100,instantNames=[]}={}){
 const events=[],stacks=new Map();let truncated=false,paired=0,unmatchedEnds=0,received=0;
 const instants=new Set(instantNames);
 const keep=e=>{if(events.length<limit)events.push(e);else truncated=true;};
 return {events,
  add(chunk){for(const e of chunk){received++;
   if(e.ph==='M'||e.name?.startsWith('inkwave-render-')){keep(e);continue;}
   if((e.ph==='I'||e.ph==='i')&&instants.has(e.name)){keep(e);continue;}
   const key=e.pid+'/'+e.tid;
   if(e.ph==='B'){let s=stacks.get(key);if(!s){s=[];stacks.set(key,s);}s.push(e);continue;}
   if(e.ph==='E'){const s=stacks.get(key),start=s?.pop();if(!start){unmatchedEnds++;continue;}
    const dur=e.ts-start.ts;if(dur>=minUs){const out={...start,ph:'X',dur};if(Number.isFinite(start.tts)&&Number.isFinite(e.tts))out.tdur=e.tts-start.tts;keep(out);}paired++;continue;}
   if(e.ph==='X'&&e.dur>=minUs)keep(e);
  }},
  info:()=>({eventsTruncated:truncated,received,paired,unmatchedEnds,openBegins:[...stacks.values()].reduce((n,s)=>n+s.length,0),limit,minUs}),
 };
}
