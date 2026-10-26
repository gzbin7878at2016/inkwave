import assert from 'node:assert/strict';
import {mobileFrameDue} from '../src/platform/mobileFramePacing.js';
// 不用平均值掩盖停顿：检查真实截止时间、短晚到恢复、长停顿不突发补帧及设置切换。
for(const hz of [30,60,90,120,144]) {
 const state={};let frames=0;
 for(let i=0;i<hz*60;i++)if(mobileFrameDue(state,i*1000/hz,30))frames++;
 assert.ok(Math.abs(frames-1800)<=1,`${hz}Hz: ${frames}`);
}
const state={},timestamps=[0,16.6667,33.3333,83.3333,100,116.6667,133.3333];
assert.deepEqual(timestamps.filter(t=>mobileFrameDue(state,t,30)),[0,33.3333,83.3333,100,133.3333]);
assert.equal(mobileFrameDue(state,1000,30),true);
assert.equal(mobileFrameDue(state,1016.6667,30),false);
assert.equal(mobileFrameDue(state,1033.3333,30),true);
assert.equal(mobileFrameDue(state,1040,60),true);
assert.equal(mobileFrameDue(state,1045,60),false);
assert.equal(mobileFrameDue(state,1046,0),true);
assert.equal(mobileFrameDue(state,1047,30),true);
assert.equal(mobileFrameDue(state,10,30),true);
console.log('通过：30～144Hz、短晚到恢复、长停顿不补历史帧、限速切换与时间戳重置');
