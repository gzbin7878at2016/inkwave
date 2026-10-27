import assert from 'node:assert/strict';
import {exclusiveTimelineCpu as analyze} from './timeline-exclusive-cpu.mjs';
const mark=(name,tts)=>({name,pid:1,tid:2,tts,ts:tts*2,ph:'I'}),x=(name,tts,tdur,ts=tts*2,dur=tdur*2)=>({name,pid:1,tid:2,ph:'X',tts,tdur,ts,dur});
const a=[mark('inkwave-render-start',0),mark('inkwave-render-end',100),x('RunTask',-10,120,-20,240),x('JS',10,40),x('Style',20,5),x('Paint',60,20),{...x('foreign',0,100),tid:3}];
const r=analyze(a,{frames:2});assert.equal(r.windowCpuMs,.1);assert.equal(r.coveredCpuMs,.1);assert.equal(r.uncoveredCpuMs,0);assert.equal(r.boundaryClippedEvents,1);assert.deepEqual(Object.fromEntries(r.exclusive.map(x=>[x.name,x.cpuMs])),{RunTask:.04,JS:.035,Paint:.02,Style:.005});assert.equal(r.exclusive[0].cpuMsPerGameFrame,.02);
const gap=analyze(a.filter(e=>e.name!=='RunTask'));assert.equal(gap.uncoveredCpuMs,.04);assert.equal(gap.frames,null);
assert.throws(()=>analyze([...a,mark('inkwave-render-start',1)]));assert.throws(()=>analyze(a.map(e=>e.name==='inkwave-render-end'?{...e,tid:99}:e)));
console.log('通过：CPU时钟裁边/嵌套不重复/跨线程隔离/未知空隙及真实帧数归一');
