// 仅方法调查临时隐藏完整HUD/叠加层；不触碰游戏Canvas、模拟、声音、输入或设置。
export function createBossDomProbe(part='all',doc=document){
 const selectors={all:'.iw-hud,.iw-hud-over,#mobile-controls,#mobile-panel',bar:'.iw-hud.is-boss .iw-bb',special:'.iw-hud.is-boss .iw-sp',markers:'.iw-hud.is-boss .iw-mks',map:'.iw-hud.is-boss .iw-map',top:'.iw-hud.is-boss .iw-hud__top',crosshair:'.iw-hud.is-boss .iw-xh',controls:'#mobile-controls',panel:'#mobile-panel'}[part];
 if(!selectors)throw Error('未知DOM隔离组件');
 const style=doc.createElement('style');style.dataset.bossDomProbe='1';style.media='not all';style.textContent=selectors+'{display:none!important}';doc.head.append(style);
 const transitions=[];let phase='',disposed=false;
 const update=(match,mode,ms)=>{
  if(disposed)return;
  const live=!!match?.boss&&!match.attract&&match.state==='playing'&&!match.paused&&mode==='match';
  const next=!live?'inactive':ms>=45000?'restored':ms>=15000?'dom-hidden':'baseline';
  if(next===phase)return;phase=next;style.media=phase==='dom-hidden'?'all':'not all';
  if(transitions.length<12)transitions.push({phase,activeMs:ms,roots:[...doc.querySelectorAll(selectors)].slice(0,16).map(el=>({id:el.id,classes:el.className,display:getComputedStyle(el).display}))});
 };
 return {update,info:()=>({part,phase,hidden:!disposed&&style.media==='all',disposed,transitions}),dispose(){style.remove();phase='disposed';disposed=true;}};
}
