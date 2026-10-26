// 仅已拥有的监听器/定位参数使用；不拦截原型、不处理包络，其他排期写入须先invalidate。
export class BossParamDedupe {
  constructor(){this.targets=new WeakMap();this.blocked=new WeakSet();this.stats={calls:0,submitted:0,skipped:0,invalidated:0};}
  invalidate(param){this.targets.delete(param);this.blocked.add(param);this.stats.invalidated++;}
  target(param,value,time,constant){
    const s=this.stats;s.calls++;
    const nativeValue=Math.fround(value),previous=this.targets.get(param);
    if(!Number.isFinite(nativeValue)||!Number.isFinite(time)||time<0||!Number.isFinite(constant)||constant<=0){
      this.invalidate(param);const result=param.setTargetAtTime(value,time,constant);s.submitted++;return result;
    }
    // 非单调排期可能仍有未来事件，保守地让该参数本次Boss余下时间全部走原调用。
    if(previous&&time<previous.time)this.invalidate(param);
    if(!this.blocked.has(param)&&previous&&nativeValue===previous.value&&constant===previous.constant&&time>=previous.time){
      previous.time=time;s.skipped++;return param;
    }
    let result;
    try{result=param.setTargetAtTime(value,time,constant);}catch(error){this.invalidate(param);throw error;}
    s.submitted++;
    if(!this.blocked.has(param)){
      if(previous){previous.value=nativeValue;previous.time=time;previous.constant=constant;}
      else this.targets.set(param,{value:nativeValue,time,constant});
    }
    return result;
  }
  info(){return {...this.stats};}
}

// 平台调用者及引擎都校验手机开关，PC/普通/开场/演示/暂停不会启用。
export function syncMobileBossParamDedupe(audio,match,mode,suspended){
  audio?.setBossParamDedupe?.(!!globalThis.inkwaveMobile&&!!match?.boss&&!match.attract&&mode==='match'
    &&match.state==='playing'&&!match.paused&&!suspended);
}
