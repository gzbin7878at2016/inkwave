// 仅自然结算后的构造定位：不发动技能、不切换手持武器，不改任何战斗资源；对象由原角色离局清理。
export async function probeBossWeaponConstruction(game) {
 if(!['finish','results'].includes(game.match?.state))throw Error('武器构造定位须自然结算后运行');
 const frozen=game.frozen,actors=[game.match.local,...game.match.actors.filter(a=>a!==game.match.local)].slice(0,2),rows=[];
 game.frozen=true;
 try{
  // 构建产物中的独立入口重导出同一共享模块，导入时间不计入建模时间。
  const {getWeaponDef}=await import('/src/game/character-weapons.js');
  performance.mark('inkwave-weapon-definition-start');
  let t=performance.now();const definition=getWeaponDef('sp_zooka'),definitionMs=performance.now()-t;
  t=performance.now();const definitionAgain=getWeaponDef('sp_zooka'),definitionCachedMs=performance.now()-t;
  performance.mark('inkwave-weapon-definition-end');
  if(definition!==definitionAgain)throw Error('共享定义未缓存');
  for(let i=0;i<actors.length;i++){
   const a=actors[i],ch=a.character,kind=ch.weaponKind,cached=!!ch.weapons.sp_zooka;
   let start=performance.now();const w=ch._getWeapon('sp_zooka'),firstMs=performance.now()-start;
   start=performance.now();const again=ch._getWeapon('sp_zooka'),cachedMs=performance.now()-start;
   if(w!==again||ch.weaponKind!==kind)throw Error('构造定位改变了手持武器或未复用缓存');
   let meshes=0,vertices=0;w.pivot.traverse(o=>{if(o.isMesh){meshes++;vertices+=o.geometry?.attributes.position?.count||0;}});
   rows.push({actor:a.name,local:!!a.isLocal,previouslyCached:cached,firstMs,cachedMs,meshes,vertices,unchangedWeapon:kind});
  }
  return {scope:'结算后全局定义与角色实例分离；墙钟非GPU完成或实战FPS；全局定义可能已由本局技能建立，保留实际结果',definitionMs,definitionCachedMs,rows};
 }finally{game.frozen=frozen;}
}
