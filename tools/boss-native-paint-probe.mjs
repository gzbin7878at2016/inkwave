// 原生steps只量化无限循环装饰动画的全局进度，保留原关键帧曲线；不逐帧查询/暂停/seek动画。
export function createBossNativePaintProbe(hud){
 const roots=[hud.el,hud.overLayer].filter(Boolean),rows=[],items=[],transitions=[];
 let seen=new WeakSet();
 let active=false,disposed=false,phase='',errors=0,restored=0;
 const expensive=new Set(['boxShadow','textShadow','filter','backdropFilter','backgroundPosition','backgroundPositionX','backgroundPositionY','strokeDashoffset','strokeWidth','borderWidth','color','backgroundColor','borderColor']);
 const adopt=animation=>{
  if(!active||rows.length>=128||seen.has(animation))return;seen.add(animation);
  try{
   const effect=animation.effect;if(!effect)return;const timing=effect.getTiming();
   if(timing.iterations!==Infinity||!Number.isFinite(timing.duration)||timing.duration<=0||timing.easing!=='linear')return;
   const keys=effect.getKeyframes(),properties=[...new Set(keys.flatMap(k=>Object.keys(k)))].filter(k=>expensive.has(k));if(!properties.length)return;
   const steps=Math.ceil(timing.duration/1000*15),original=timing.easing;effect.updateTiming({easing:`steps(${steps},end)`});
   const applied=effect.getTiming().easing;rows.push({ref:new WeakRef(animation),original,applied});
   items.push({name:animation.animationName||'',target:effect.target?.className?.baseVal||effect.target?.className||'',duration:timing.duration,steps,properties,keyframeEasing:keys.map(k=>k.easing)});
  }catch{errors++;}
 };
 const onStart=event=>{if(active)for(const animation of event.target.getAnimations())adopt(animation);};
 const release=()=>{
  active=false;for(const root of roots)root.removeEventListener('animationstart',onStart,true);
  for(const row of rows){const animation=row.ref.deref();if(!animation?.effect)continue;try{if(animation.effect.getTiming().easing===row.applied){animation.effect.updateTiming({easing:row.original});restored++;}}catch{errors++;}}
  rows.length=0;seen=new WeakSet();
 };
 return {update(match,mode,ms){
  if(disposed)return;const live=!!match?.boss&&!match.attract&&match.state==='playing'&&!match.paused&&mode==='match';
  const next=!live?'inactive':ms>=45000?'restored':ms>=15000?'native-paint-15':'baseline';if(next===phase)return;phase=next;
  if(next==='native-paint-15'){active=true;for(const root of roots){root.addEventListener('animationstart',onStart,true);for(const animation of root.getAnimations({subtree:true}))adopt(animation);}}
  else release();if(transitions.length<12)transitions.push({phase,activeMs:ms});
 },info:()=>({phase,active,disposed,errors,restored,adopted:items.length,items,transitions}),dispose(){release();disposed=true;}};
}
