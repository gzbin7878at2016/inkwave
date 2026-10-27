import assert from 'node:assert/strict';
import {createTraceEventCollector as create} from './trace-event-collector.mjs';
// 分批嵌套与跨线程不能串栈；线程CPU时间和墙钟分开保存。
const c=create({minUs:100});c.add([{ph:'B',pid:1,tid:2,ts:0,tts:0,name:'outer'},{ph:'B',pid:1,tid:3,ts:10,name:'other'},{ph:'B',pid:1,tid:2,ts:100,tts:80,name:'inner'}]);
c.add([{ph:'E',pid:1,tid:2,ts:250,tts:200},{ph:'E',pid:1,tid:3,ts:260},{ph:'E',pid:1,tid:2,ts:350,tts:240},{ph:'X',pid:1,tid:2,ts:400,dur:99,name:'tiny'},{ph:'M',name:'thread_name'},{ph:'I',name:'inkwave-render-start',pid:1,tid:2,ts:500}]);
assert.deepEqual(c.events.filter(x=>x.ph==='X').map(x=>[x.name,x.dur,x.tdur]),[['inner',150,120],['other',250,undefined],['outer',350,240]]);
assert.equal(c.info().openBegins,0);assert.equal(c.info().unmatchedEnds,0);assert.equal(c.events.length,5);
const instant=create({instantNames:['StyleRecalcInvalidationTracking']});instant.add([{ph:'I',name:'StyleRecalcInvalidationTracking',args:{data:{nodeId:7}}},{ph:'i',name:'StyleRecalcInvalidationTracking'},{ph:'I',name:'other'}]);assert.equal(instant.events.length,2);assert.equal(instant.events[0].args.data.nodeId,7);
const clipped=create({limit:1});clipped.add([{ph:'E',pid:2,tid:2,ts:1},{ph:'X',dur:200},{ph:'X',dur:300}]);assert.equal(clipped.info().eventsTruncated,true);assert.equal(clipped.info().unmatchedEnds,1);assert.equal(clipped.events.length,1);
console.log('通过：分批B/E嵌套、跨线程、CPU时间、阈值、标记、元数据与截断边界');
