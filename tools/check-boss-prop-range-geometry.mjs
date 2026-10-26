// 核对原索引连续区段、零数量原状态建立、无顶点/材质替换及失效时原路径回退。
import assert from 'node:assert/strict';
import * as T from 'three';
import {createBossPropRangeCandidate as create} from './boss-prop-range-candidate.mjs';
const g=new T.BoxGeometry(30,3,28,6,1,6);g.clearGroups();const m=new T.Mesh(g,new T.MeshStandardMaterial()),scene=new T.Scene();scene.add(m);scene.updateMatrixWorld(true);
const camera=new T.PerspectiveCamera(30,1,.1,100);camera.position.set(0,4,-30);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
const native=[],calls=[],gl={TRIANGLES:4,UNSIGNED_INT:5125,UNSIGNED_SHORT:5123};
const ext={multiDrawElementsWEBGL(mode,counts,co,type,offsets,oo,n){native.push({mode,type,ranges:Array.from({length:n},(_,i)=>({start:offsets[oo+i]/g.index.array.BYTES_PER_ELEMENT,count:counts[co+i]}))});}};
const r={info:{render:{calls:0,triangles:0}},getContext:()=>gl,extensions:{get:()=>ext},renderBufferDirect(...args){calls.push(args);this.info.render.calls++;this.info.render.triangles+=(args[5]?.count??g.index.count)/3;}};
const original=r.renderBufferDirect,snapshot=Buffer.from(g.index.array.buffer).toString('hex');
const c=create(T,[m],{renderer:r});c.enable();r.renderBufferDirect(camera,scene,g,m.material,m,null);
assert.equal(calls[0][5].count,0);assert.equal(calls[0][2],g);assert.equal(calls[0][3],m.material);
const ranges=native[0].ranges;for(let i=0;i<ranges.length;i++){assert.equal(ranges[i].count%3,0);assert.ok(ranges[i].start>=0&&ranges[i].start+ranges[i].count<=g.index.count);if(i)assert.ok(ranges[i].start>ranges[i-1].start+ranges[i-1].count);}
assert.ok(ranges.reduce((n,p)=>n+p.count,0)<=g.index.count);assert.equal(c.stats.geometryBytes,0);
c.setCullingEnabled(false);r.renderBufferDirect(camera,scene,g,m.material,m,null);assert.deepEqual(native.at(-1).ranges,[{start:0,count:g.index.count}]);
const before=native.length;g.attributes.position.needsUpdate=true;r.renderBufferDirect(camera,scene,g,m.material,m,null);assert.equal(native.length,before);assert.equal(calls.at(-1)[5],null);
c.disable();c.dispose();assert.equal(r.renderBufferDirect,original);assert.equal(Buffer.from(g.index.array.buffer).toString('hex'),snapshot);assert.equal(m.visible,true);
assert.throws(()=>create(T,[m],{renderer:r,maxBytes:1}),/预算/);assert.equal(r.renderBufferDirect,original);
assert.throws(()=>create({...T,REVISION:'other'},[m],{renderer:r}),/版本/);assert.equal(r.renderBufferDirect,original);
console.log(JSON.stringify({checks:'有序原区段/连续合并/原program状态建立/零几何副本/索引不变/变更回退/释放与预算版本保护通过',controlTypedBytes:c.stats.controlTypedBytes}));
