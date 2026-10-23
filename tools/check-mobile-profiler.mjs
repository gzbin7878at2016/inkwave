import assert from 'node:assert/strict';
import { MobileProfiler } from '../src/platform/mobileProfiler.js';
// 验证真实计数增量、CPU分段求和、对象身份、缓冲上限与场景切换隔离。
let time=0; const originalClock=globalThis.performance;
globalThis.performance={now:()=>time};
try {
 const renderer={info:{render:{calls:0,triangles:0}},renderBufferDirect(){this.info.render.calls++;this.info.render.triangles+=12;return 42;}};
 const g={worldKey:'map',mode:'match',match:{state:'playing'},R:{renderer}};
 const p=new MobileProfiler(g);
 for(let f=0;f<1200;f++){
  p.begin(time);
  for(let i=0;i<8;i++){time++;p.mark();}
  for(let id=1;id<3;id++)assert.equal(renderer.renderBufferDirect(null,null,{id}, {id,type:'MeshStandardMaterial'},{type:'Mesh'},null),42);
  time+=2;p.end();
 }
 const s=p.snapshot();
 assert.equal(s.samples,120);assert.equal(s.cpu.total.p50,10);assert.equal(s.cpu.ui.p50,2);
 assert.equal(s.topDraws.length,2);assert.equal(s.topCalls.length,2);
 assert.ok(s.topDraws.every(x=>x.calls===1 && x.triangles===12));
 assert.notEqual(s.topDraws[0].name,s.topDraws[1].name);
 g.mode='menu';p.begin(time);p.end();assert.equal(p.count,0);assert.equal(p.snapshot().topDraws.length,0);
 console.log('通过：分段计时求和、真实绘制增量与返回值、对象区分、有界缓冲、上下文隔离');
} finally {globalThis.performance=originalClock;}
