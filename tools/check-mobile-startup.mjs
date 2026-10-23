// 验证预热批次之间恢复世界状态并让出线程；渲染异常也不能永久隐藏对象。
import assert from 'node:assert/strict';
import { warmMobileScene, warmMobilePostprocess } from '../src/platform/mobileStartup.js';
const objects = Array.from({ length: 8 }, (_, id) => ({ id, isMesh: true, visible: true, frustumCulled: id % 2 === 0 }));
const scene = { traverseVisible(fn) { objects.forEach(fn); } };
const before = objects.map(object => [object.visible, object.frustumCulled]);
const rendered = [], stages = []; let yields = 0;
const diagnostics = { beginStage: (name, detail) => () => stages.push({ name, ...detail }), record() {} };
const summary = await warmMobileScene(scene, () => {
  const active = objects.filter(object => object.visible);
  assert.ok(active.length <= 3);
  assert.ok(active.every(object => object.frustumCulled === false));
  rendered.push(...active.map(object => object.id));
}, async () => {
  yields++;
  assert.deepEqual(objects.map(object => [object.visible, object.frustumCulled]), before);
}, diagnostics, 3);
assert.deepEqual(rendered, objects.map(object => object.id));
assert.equal(summary.batches, 3); assert.equal(yields, 3); assert.equal(stages.length, 3);
await assert.rejects(warmMobileScene(scene, () => { throw new Error('driver-test'); }, async () => {}, diagnostics), /driver-test/);
assert.deepEqual(objects.map(object => [object.visible, object.frustumCulled]), before);
let target = 'initial', passYields = 0;
const renderer = { getRenderTarget: () => target, setRenderTarget: value => { target = value; } };
const pass = { enabled: true, renderToScreen: true, render() { assert.ok(objects.every(object => !object.visible)); target = 'changed'; } };
await warmMobilePostprocess(scene, renderer, { passes: [pass], writeBuffer: {}, readBuffer: {} }, async () => { passYields++; }, diagnostics);
assert.equal(target, 'initial'); assert.equal(pass.renderToScreen, true); assert.equal(passYields, 1);
pass.render = () => { target = 'changed'; throw new Error('pass-test'); };
await assert.rejects(warmMobilePostprocess(scene, renderer, { passes: [pass] }, async () => {}, diagnostics), /pass-test/);
assert.equal(target, 'initial'); assert.equal(pass.renderToScreen, true);
assert.deepEqual(objects.map(object => [object.visible, object.frustumCulled]), before);
console.log('通过：分批真实绘制、批次之间恢复可见性/裁剪并让出线程、异常恢复');
