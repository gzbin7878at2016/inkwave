// 仅桌面隔离浏览器读取真实手机构建的静态props几何，估算保守空间剔除潜力；不修改产品、不当手机FPS。
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
const cell=Number(process.env.BOSS_PROP_CELL||8);
if(!Number.isFinite(cell)||cell<4||cell>32)throw Error('空间估算网格须4～32米');
await mkdir('releases/investigation',{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],protocolTimeout:240000});
const report={performanceTest:false,productModified:false,cellMeters:cell,status:'loading',errors:[]};
try{
 const page=await browser.newPage();await page.setViewport({width:778,height:370,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://localhost:8490/dist-mobile/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__inkwave?.mobile,{timeout:120000});
 await page.mouse.click(2,2);
 await page.evaluate(()=>{window.__propInvestigationReady=null;__inkwave.startMatch({mode:'boss',mapId:'tidewater',duration:60}).then(v=>__propInvestigationReady=v,e=>__propInvestigationReady=String(e));});
 await page.waitForFunction(()=>window.__propInvestigationReady!==null,{timeout:180000});
 report.geometry=await page.evaluate(async size=>{
  if(__propInvestigationReady!==true)throw Error('真实Boss加载失败：'+__propInvestigationReady);
  // 使用该构建实际渲染器的Three类型，不把另一个包实例混入场景。
  const camera=__G.camera,Vector3=camera.position.constructor,Matrix4=camera.matrixWorld.constructor;
  const {Frustum,Box3,PerspectiveCamera}=await import('/node_modules/three/build/three.module.js');
  const wanted=new Set(['props:paint','props:paint~ns','props:gloss','props:gloss~ns']);
  const sources=[];__G.scene.traverse(o=>{if(wanted.has(o.name)&&o.isMesh&&!o.isInstancedMesh)sources.push(o);});
  if(sources.length!==4)throw Error('预期4个真实静态重桶，实际'+sources.length);
  const prepared=[],a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(const mesh of sources){
   const geo=mesh.geometry,pos=geo.attributes.position,index=geo.index,total=index?index.count:pos.count;
   if(total%3||geo.groups.length||geo.morphAttributes.position?.length)throw Error('暂不支持多组或变形几何，不能直接估算');
   const cells=new Map(),used=new Uint8Array(pos.count);let usedCount=0;
   for(let i=0;i<total;i+=3){
    const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
    a.fromBufferAttribute(pos,ia).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(pos,ib).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(pos,ic).applyMatrix4(mesh.matrixWorld);
    const key=Math.floor((a.x+b.x+c.x)/(3*size))+','+Math.floor((a.z+b.z+c.z)/(3*size));
    let group=cells.get(key);if(!group)cells.set(key,group={box:new Box3(),triangles:0,vertices:new Set()});
    group.box.expandByPoint(a).expandByPoint(b).expandByPoint(c);group.triangles++;
    for(const id of [ia,ib,ic]){group.vertices.add(id);if(!used[id]){used[id]=1;usedCount++;}}
   }
   const groups=[...cells.values()],chunkVertices=groups.reduce((n,g)=>n+g.vertices.size,0);
   const attributes=Object.fromEntries(Object.entries(geo.attributes).map(([name,attr])=>[name,{itemSize:attr.itemSize,normalized:attr.normalized,type:(attr.isInterleavedBufferAttribute?attr.data.array:attr.array).constructor.name}]));
   const bytesPerVertex=Object.values(geo.attributes).reduce((n,attr)=>n+attr.itemSize*(attr.isInterleavedBufferAttribute?attr.data.array:attr.array).BYTES_PER_ELEMENT,0);
   if(groups.reduce((n,g)=>n+g.triangles,0)!==total/3)throw Error('估算丢了原三角形');
   prepared.push({mesh,groups,summary:{name:mesh.name,material:mesh.material.type,triangles:total/3,vertices:pos.count,usedVertices:usedCount,chunkVertices,duplicateVertices:chunkVertices-usedCount,chunks:groups.length,attributes,originalLogicalBytes:pos.count*bytesPerVertex+(index?index.array.byteLength:0),candidateLogicalBytes:chunkVertices*bytesPerVertex+total*4}});
  }
  const views=[{name:'actual-camera',camera:camera.clone()}];
  // 额外视角仅为空间覆盖估算，不伪称真实玩家轨迹或性能样本。
  for(const [name,eye,target] of [['spawn',[0,5,-35],[0,3,0]],['left',[-12,4,-15],[0,2,0]],['right',[12,4,-15],[0,2,0]],['rear',[0,4,12],[0,2,-5]]]){
   const cam=new PerspectiveCamera(camera.fov,camera.aspect,camera.near,camera.far);cam.position.set(...eye);cam.lookAt(...target);cam.updateMatrixWorld(true);views.push({name,camera:cam});
  }
  const samples=views.map(view=>{
   const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(view.camera.projectionMatrix,view.camera.matrixWorldInverse));
   const buckets=prepared.map(({mesh,groups,summary})=>{
    const drawn=!mesh.frustumCulled||frustum.intersectsObject(mesh);
    const visible=drawn?groups.filter(g=>frustum.intersectsBox(g.box)):[];
    return {name:mesh.name,originalTriangles:drawn?summary.triangles:0,candidateTriangles:visible.reduce((n,g)=>n+g.triangles,0),visibleChunks:visible.length};
   });
   const originalTriangles=buckets.reduce((n,b)=>n+b.originalTriangles,0),candidateTriangles=buckets.reduce((n,b)=>n+b.candidateTriangles,0);
   return {view:view.name,originalTriangles,candidateTriangles,rejectedRatio:originalTriangles?1-candidateTriangles/originalTriangles:0,buckets};
  });
  return {build:inkwaveDiagnostics.report().current.build,quality:__G.settings.quality,source:prepared.map(p=>p.summary),samples,multiDraw:!!__G.renderer.extensions.get('WEBGL_multi_draw'),note:'仅保守包围盒/逻辑几何字节估算；尚未创建BatchedMesh、未验证像素、GPU时间或手机收益'};
 },cell);
 report.status='estimated';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await browser.close();await writeFile('releases/investigation/boss-prop-culling-estimate.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
