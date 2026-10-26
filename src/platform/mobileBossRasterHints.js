// 仅手机真实Boss实战保留队友标签的缩放栅格缓存；不改变文字、缩放值或动画时钟。
// 脏检查只在启用/退出及HUD替换时改类，避免逐帧写样式、读布局或采样CSSAnimation。
export function createMobileBossRasterHints(){
 let root=null,active=false,activations=0,releases=0;
 const clear=()=>{if(active){root?.classList.remove('iw-mobile-boss-raster');active=false;releases++;}};
 return {clear,update(nextRoot,match,mode,suspended){
  if(root!==nextRoot){clear();root=nextRoot;}
  const next=!!globalThis.inkwaveMobile&&!!root&&!!match?.boss&&!match.attract&&mode==='match'
   &&match.state==='playing'&&!match.paused&&!suspended;
  if(next===active)return;
  if(next){root.classList.add('iw-mobile-boss-raster');active=true;activations++;}else clear();
 },info:()=>({active,activations,releases})};
}
