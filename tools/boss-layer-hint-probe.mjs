// 只供完整HUD方法调查：15～45秒提示标签缩放合成，不改缩放值、动画、图标或分辨率。
export function createBossLayerHintProbe(doc=document){
 const selector='.iw-hud.is-boss .iw-mk__tag',style=doc.createElement('style');
 style.dataset.bossLayerHintProbe='1';style.media='not all';style.textContent=selector+'{will-change:transform,scale!important}';doc.head.append(style);
 let phase='',disposed=false;const transitions=[];
 return {update(match,mode,ms){
  if(disposed)return;const live=!!match?.boss&&!match.attract&&match.state==='playing'&&!match.paused&&mode==='match';
  const next=!live?'inactive':ms>=45000?'restored':ms>=15000?'hinted':'baseline';if(next===phase)return;
  phase=next;style.media=next==='hinted'?'all':'not all';
  if(transitions.length<12)transitions.push({phase,activeMs:ms,labels:[...doc.querySelectorAll(selector)].slice(0,8).map(el=>({willChange:getComputedStyle(el).willChange,scale:getComputedStyle(el).scale,display:getComputedStyle(el).display}))});
 },info:()=>({phase,active:!disposed&&style.media==='all',disposed,transitions}),dispose(){style.remove();disposed=true;phase='disposed';}};
}
