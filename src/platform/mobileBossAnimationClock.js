// 手机Boss无限CSS动画跟随实际游戏帧采样；原关键帧/时长/延迟/告警保持，有限动画交给浏览器。
export function createMobileBossAnimationClock() {
  const scope='.iw-hud.is-boss,.iw-hud-over.is-boss',entries=new Map(),names=new Map();
  const waiting=new WeakSet();let pendingCount=0;
  const supported=typeof CSSAnimation!=='undefined'&&!!document.timeline&&typeof document.getAnimations==='function'&&typeof Element.prototype.getAnimations==='function';
  let enabled=false,frames=0,captured=0,resumed=0,dropped=0,skipped=0;
  const belongs=target=>target?.isConnected&&typeof target.closest==='function'&&!!target.closest(scope);
  const release=(animation,entry)=>{
    // 取消或已移除的动画不能被play复活；外部已接管播放时也不覆盖。
    if(animation.playState==='paused'&&animation.effect?.target?.isConnected
      &&animation.effect.target.getAnimations({subtree:true}).includes(animation)) {
      animation.play();
      if(animation.playbackRate===entry.rate)animation.startTime=entry.startTime;
      resumed++;
    }
    entries.delete(animation);
  };
  const capture=animation=>{
    if(entries.has(animation)||!(animation instanceof CSSAnimation)||animation.effect?.getTiming().iterations!==Infinity
      ||animation.playbackRate!==1||!belongs(animation.effect?.target))return;
    if(animation.playState!=='running')return;
    if(animation.pending){
      if(!waiting.has(animation)&&pendingCount<128){
        waiting.add(animation);pendingCount++;
        animation.ready.then(()=>{waiting.delete(animation);pendingCount--;if(enabled&&!animation.pending)capture(animation);},()=>{waiting.delete(animation);pendingCount--;});
      }
      return;
    }
    if(!Number.isFinite(animation.startTime)||!Number.isFinite(animation.currentTime))return;
    // HTML纯合成动画仍由浏览器线程处理；只采样SVG内部和需要主线程绘制的属性。
    const target=animation.effect.target;
    if(!(target instanceof SVGElement&&target.tagName.toLowerCase()!=='svg')){
      const compositor=new Set(['transform','translate','rotate','scale','opacity','filter']);
      const metadata=new Set(['offset','computedOffset','easing','composite']);
      let painted=false;
      try{painted=animation.effect.getKeyframes().some(frame=>Object.keys(frame).some(key=>!metadata.has(key)&&!compositor.has(key)));}catch{return;}
      if(!painted)return;
    }
    if(entries.size>=128){skipped++;return;}
    const entry={startTime:animation.startTime,rate:animation.playbackRate};
    animation.pause();animation.currentTime=(document.timeline.currentTime-entry.startTime)*entry.rate;
    entries.set(animation,entry);captured++;
    const name=animation.animationName;if(names.size<128||names.has(name))names.set(name,(names.get(name)||0)+1);
  };
  const start=event=>{
    if(!enabled||!belongs(event.target))return;
    for(const animation of event.target.getAnimations({subtree:true}))capture(animation);
  };
  if(supported)document.addEventListener('animationstart',start,true);
  const suspend=()=>{enabled=false;for(const [animation,entry] of entries)release(animation,entry);};
  return {
    update(game,mode,suspended) {
      const m=game.match,cap=game.settings.fpsCap;
      const live=supported&&!!globalThis.inkwaveMobile&&!!m?.boss&&!m.attract&&mode==='match'&&m.state==='playing'
        &&!m.paused&&!suspended&&(cap===30||cap===60);
      if(!live){if(enabled||entries.size)suspend();return;}
      if(!enabled){enabled=true;for(const root of document.querySelectorAll(scope))for(const animation of root.getAnimations({subtree:true}))capture(animation);}
      const now=document.timeline.currentTime;if(!Number.isFinite(now))return;
      frames++;
      for(const [animation,entry] of entries){
        if(!belongs(animation.effect?.target)||animation.playState==='idle'){
          if(animation.playState==='paused'&&animation.effect?.target?.isConnected)release(animation,entry);
          else entries.delete(animation);
          dropped++;continue;
        }
        if(animation.playbackRate!==entry.rate||animation.effect.getTiming().iterations!==Infinity){release(animation,entry);continue;}
        if(animation.playState!=='paused'&&!animation.pending){entries.delete(animation);dropped++;continue;}
        animation.currentTime=(now-entry.startTime)*entry.rate;
      }
    },
    suspend,
    info:()=>({supported,active:enabled,tracked:entries.size,pending:pendingCount,frames,captured,resumed,dropped,skipped,names:Object.fromEntries(names)}),
    dispose(){suspend();if(supported)document.removeEventListener('animationstart',start,true);},
  };
}
