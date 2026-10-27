// 仅自然结算后的构造定位：不发动技能、不切换手持武器，不改任何战斗资源；对象由原角色离局清理。
export function probeBossWeaponConstruction(game) {
 if(!['finish','results'].includes(game.match?.state))throw Error('武器构造定位须自然结算后运行');
 const frozen=game.frozen,actors=[game.match.local,...game.match.actors.filter(a=>a!==game.match.local)].slice(0,2),rows=[];
 game.frozen=true;
 try{
  for(let i=0;i<actors.length;i++){
   const a=actors[i],ch=a.character,kind=ch.weaponKind,cached=!!ch.weapons.sp_zooka;
   let start=performance.now();const w=ch._getWeapon('sp_zooka'),firstMs=performance.now()-start;
   start=performance.now();const again=ch._getWeapon('sp_zooka'),cachedMs=performance.now()-start;
   if(w!==again||ch.weaponKind!==kind)throw Error('构造定位改变了手持武器或未复用缓存');
   let meshes=0,vertices=0;w.pivot.traverse(o=>{if(o.isMesh){meshes++;vertices+=o.geometry?.attributes.position?.count||0;}});
   rows.push({actor:a.name,local:!!a.isLocal,previouslyCached:cached,firstMs,cachedMs,meshes,vertices,unchangedWeapon:kind});
  }
  return {scope:'结算后首次构造墙钟，非GPU完成或实战FPS；首角色包含可能的全局定义构建，第二角色检验共享定义后的实例成本',rows};
 }finally{game.frozen=frozen;}
}
