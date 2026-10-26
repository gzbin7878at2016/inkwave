// 独立按所有属性展开三角形多重集，核对实际batch而非复用构建器的检查方法。
import assert from 'node:assert/strict';
import * as T from 'three';
import {createBossPropBatchCandidate as create} from './boss-prop-batch-candidate.mjs';
const scene=new T.Scene(),g=new T.BoxGeometry(12,2,18,2,1,3);g.clearGroups();
g.setAttribute('custom',new T.BufferAttribute(Uint8Array.from({length:g.attributes.position.count*3},(_,i)=>i%256),3,true));
const m=new T.Mesh(g,new T.MeshPhysicalMaterial({vertexColors:false}));m.position.set(3,2,-9);m.rotation.y=.31;scene.add(m);scene.updateMatrixWorld(true);
const snapshots=Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,Buffer.from(a.array.buffer).toString('hex')]));
const triangles=(geometry,start=0,count=geometry.index.count)=>{
 const attrs=Object.keys(geometry.attributes).sort(),result=[];
 for(let i=start;i<start+count;i+=3){const values=[];for(let n=0;n<3;n++){const id=geometry.index.getX(i+n);for(const key of attrs){const a=geometry.getAttribute(key);for(let k=0;k<a.itemSize;k++)values.push(a.array[id*a.itemSize+k]);}}result.push(JSON.stringify(values));}return result.sort();
};
// none与runs都必须维持全局原始三角次序，不仅仅是多重集相等。
const ordered=geometry=>{const result=[];for(let i=0;i<geometry.index.count;i+=3)result.push(triangles(geometry,i,3)[0]);return result;};
for(const groupMode of ['none','runs']){
 const probe=create(T,[m],{groupMode});
 const seq=probe.entries.flatMap(e=>e.geometryIds.flatMap(id=>{const range=e.batch.getGeometryRangeAt(id),out=[];for(let i=range.indexStart;i<range.indexStart+range.indexCount;i+=3)out.push(triangles(e.batch.geometry,i,3)[0]);return out;}));
 assert.deepEqual(seq,ordered(g));probe.dispose();
}
const candidate=create(T,[m]);const actual=candidate.entries.flatMap(e=>e.geometryIds.flatMap(id=>{const range=e.batch.getGeometryRangeAt(id);return triangles(e.batch.geometry,range.indexStart,range.indexCount);})).sort();
assert.deepEqual(actual,triangles(g));assert.ok(candidate.stats.chunks>1);assert.ok(candidate.stats.attributesChecked>0);
assert.ok(candidate.entries[0].batch.boundingSphere.equals(g.boundingSphere));assert.ok(candidate.entries[0].batch.boundingBox.equals(g.boundingBox));
candidate.enable();assert.equal(m.visible,false);assert.equal(scene.children.length,2);candidate.disable();assert.equal(m.visible,true);assert.equal(scene.children.length,1);
candidate.enable();candidate.dispose();candidate.dispose();assert.equal(m.visible,true);assert.equal(scene.children.length,1);assert.throws(()=>candidate.enable(),/释放/);
assert.deepEqual(Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,Buffer.from(a.array.buffer).toString('hex')])),snapshots);
assert.throws(()=>create(T,[m],{maxBytes:1}),/预算/);assert.equal(m.visible,true);assert.equal(scene.children.length,1);
console.log(JSON.stringify({checks:'完整三角形多重集/归一化整数属性/原属性字节/变换/启停/重复释放/预算失败恢复通过',triangles:candidate.stats.triangles,chunks:candidate.stats.chunks}));
