// 仅记录已知音频参数的原调用，不改变参数、声音或调度；弱引用避免留住已结束voice。
export function installBossAudioParamProbe(audio){
 const previous=globalThis.__bossAudioParamProbe;if(previous?.active)throw Error('已有音频参数调查');
 const refs=[],seen=new WeakMap(),groups={},owned=[];
 const state={active:true,registered:0,skipped:0,calls:0,duplicates:0,nonMonotonic:0,restored:0,ownershipChanged:0,groups};
 const register=(param,group)=>{
  if(!param||seen.has(param))return;
  if(refs.length>=4096){state.skipped++;return;}
  const original=param.setTargetAtTime,descriptor=Object.getOwnPropertyDescriptor(param,'setTargetAtTime');
  if(typeof original!=='function')return;
  const entry={group,last:null};seen.set(param,entry);
  const bucket=groups[group]||(groups[group]={parameters:0,calls:0,duplicates:0,nonMonotonic:0});bucket.parameters++;
  function wrapped(value,time,constant){
   const result=original.apply(this,arguments); // 原生结果/异常/this和全部参数保持，不操作其他排期。
   const old=entry.last;state.calls++;bucket.calls++;
   if(old&&time<old.time){state.nonMonotonic++;bucket.nonMonotonic++;}
   if(old&&value===old.value&&constant===old.constant&&time>=old.time){state.duplicates++;bucket.duplicates++;}
   if(old){old.value=value;old.time=time;old.constant=constant;}else entry.last={value,time,constant};
   return result;
  }
  Object.defineProperty(param,'setTargetAtTime',{value:wrapped,writable:true,configurable:true});
  refs.push({ref:new WeakRef(param),descriptor,wrapped});state.registered++;
 };
 const hook=(name,before)=>{
  const original=audio[name],descriptor=Object.getOwnPropertyDescriptor(audio,name);
  function wrapped(...args){try{before(...args);}catch(error){state.instrumentationError=String(error);probe.stop();}return original.apply(this,args);}
  Object.defineProperty(audio,name,{value:wrapped,writable:true,configurable:true});owned.push({name,descriptor,wrapped});
 };
 const listener=()=>{for(const name of ['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'])register(audio.ctx.listener[name],'listener.'+name);};
 const probe={
  get active(){return state.active;},
  snapshot:()=>({...state,contextState:audio.ctx.state,sampleRate:audio.ctx.sampleRate}),
  stop(){if(!state.active)return probe.snapshot();state.active=false;
   for(const {ref,descriptor,wrapped}of refs){const param=ref.deref();if(!param)continue;if(Object.getOwnPropertyDescriptor(param,'setTargetAtTime')?.value!==wrapped){state.ownershipChanged++;continue;}if(descriptor)Object.defineProperty(param,'setTargetAtTime',descriptor);else delete param.setTargetAtTime;state.restored++;}
   for(const {name,descriptor,wrapped}of owned){if(audio[name]!==wrapped){state.ownershipChanged++;continue;}if(descriptor)Object.defineProperty(audio,name,descriptor);else delete audio[name];}
   refs.length=0;owned.length=0;return probe.snapshot();
  }
 };
 globalThis.__bossAudioParamProbe=probe;
 try{hook('setListener',listener);listener();
  hook('_setPos',voice=>{if(!voice?.panner)return;for(const name of ['positionX','positionY','positionZ'])register(voice.panner[name],'panner.'+name);register(voice.lp?.frequency,'distance.frequency');register(voice.send?.gain,'distance.send');});
 }catch(error){probe.stop();throw error;}
 return probe.snapshot();
}
