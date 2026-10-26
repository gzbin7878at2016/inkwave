// 仅方法调查：把标签距离变量转换为相同的非继承opacity/scale，避免改变SVG后代的变量环境。
export function createBossMarkerVarProbe(hud){
 let active=false,disposed=false,phase='',intercepted=0;const transitions=[],rows=[];
 for(const el of hud.markers){
  const style=el.style,tag=el.querySelector('.iw-mk__tag'),native=style.setProperty,descriptor=Object.getOwnPropertyDescriptor(style,'setProperty');
  const row={style,tag,native,descriptor,opacity:style.opacity,scale:tag.style.scale,lastFar:style.getPropertyValue('--far')};rows.push(row);
  Object.defineProperty(style,'setProperty',{configurable:true,writable:true,value:function(name,value,priority){
   if(name==='--far'){
    row.lastFar=String(value);const f=Number(value);
    if(active&&Number.isFinite(f)&&f>=0&&f<=1&&String(value).trim()!==''){
     style.opacity=String(1-f*.45);tag.style.scale=String(1-f*.18);intercepted++;return;
    }
   }
   return native.call(this,name,value,priority);
  }});
 }
 const release=()=>{if(!active)return;active=false;for(const r of rows){r.native.call(r.style,'--far',r.lastFar);r.style.opacity=r.opacity;r.tag.style.scale=r.scale;}};
 return {update(match,mode,ms){
  if(disposed)return;const live=!!match?.boss&&!match.attract&&match.state==='playing'&&!match.paused&&mode==='match';
  const next=!live?'inactive':ms>=45000?'restored':ms>=15000?'local-values':'baseline';if(next===phase)return;
  phase=next;if(next==='local-values')active=true;else release();if(transitions.length<12)transitions.push({phase,activeMs:ms});
 },info:()=>({phase,active,intercepted,disposed,transitions}),dispose(){release();for(const r of rows){if(r.descriptor)Object.defineProperty(r.style,'setProperty',r.descriptor);else delete r.style.setProperty;}disposed=true;}};
}
