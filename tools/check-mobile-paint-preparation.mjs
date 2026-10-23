// 直接执行真实PaintSystem准备pass，观察目标和缓冲身份；不以假GL代替真机帧率/画面验收。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PaintSystem } from '../src/world/paint.js';

function fixture() {
  let target = null, viewport = new THREE.Vector4(11, 12, 640, 300), scissor = new THREE.Vector4(13, 14, 500, 280), scissorTest = true;
  let clearColor = new THREE.Color('#293847'), alpha = 0.4, face = 2, mip = 1;
  const programs = [], compiled = new Map(), properties = new WeakMap(), draws = [];
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 4 }, info: { programs }, autoClear: false,
    properties: { get: material => properties.get(material) || {} },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(value, f = 0, m = 0) { target = value; face = f; mip = m; },
    getViewport: out => out.copy(viewport), setViewport(...args) { viewport = args[0]?.isVector4 ? args[0].clone() : new THREE.Vector4(...args); },
    getScissor: out => out.copy(scissor), setScissor(...args) { scissor = args[0]?.isVector4 ? args[0].clone() : new THREE.Vector4(...args); },
    getScissorTest: () => scissorTest, setScissorTest(value) { scissorTest = value; },
    getClearColor: out => out.copy(clearColor), getClearAlpha: () => alpha,
    setClearColor(color, a) { clearColor = new THREE.Color(color); if (a !== undefined) alpha = a; },
    clear() { if (target) target.userData = { writes: 0 }; },
    render(scene, camera) {
      assert.ok(camera.isOrthographicCamera);
      const meshes = []; scene.traverseVisible(mesh => { if (mesh.isMesh) meshes.push(mesh); });
      for (const mesh of meshes) {
        const key = `${mesh.material.vertexShader}:${mesh.material.fragmentShader}`;
        let program = compiled.get(key);
        if (!program) { program = { id: programs.length + 1 }; compiled.set(key, program); programs.push(program); }
        properties.set(mesh.material, { currentProgram: program });
        draws.push({ target, geometry: mesh.geometry, material: mesh.material, range: { ...mesh.geometry.drawRange }, mesh, camera });
      }
      target.userData ??= { writes: 0 }; target.userData.writes++;
      renderer.fail?.();
    },
    snapshot: () => ({ target, face, mip, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest, autoClear: renderer.autoClear, clearColor: clearColor.getHex(), alpha }), draws,
  };
  const paint = new PaintSystem(renderer, { faces: [] }, { atlasSize: 32 });
  paint.grid = new Uint8Array([0, 1, 2, 1, 0]); paint.dead = new Uint8Array([0, 0, 0, 0, 1]); paint.counts = [2, 1];
  paint.version = 12; paint.clock = 4; paint.frame = 9; paint.quads = 2; paint._dryAcc = 0.007;
  paint._q.push({ seed: 3 }); paint.growing.push({ seed: 4 }); paint._floods.push({ team: 1 });
  for (const attribute of Object.values(paint.geo.attributes)) {
    attribute.array.fill(0.61); attribute.addUpdateRange(32, 8);
  }
  paint.geo.setDrawRange(6, 12); paint.mesh.visible = false; paint.dryMesh.visible = true; paint._dryU.uDry.value = 0.7;
  paint._floodMesh.visible = false; paint._floodMesh.material = paint._floodWipe;
  paint._floodU.uParts.value = 2; paint._floodU.uPoly.value.fill(0.3); paint._floodU.uPart.value.fill(2);
  paint._floodU.uC.value.set(3, 4); paint._floodU.uR.value.set(5, 6); paint._floodU.uY.value.set(7, 8); paint._floodU.uTeam.value = 1;
  const external = new THREE.WebGLRenderTarget(10, 10); renderer.setRenderTarget(external, 2, 1);
  return { paint, renderer, dispose() { paint.dispose(); external.dispose(); } };
}
function paintSnapshot(paint) {
  return {
    grid: [...paint.grid], dead: [...paint.dead], counts: [...paint.counts], version: paint.version, clock: paint.clock, frame: paint.frame, quads: paint.quads,
    dryAcc: paint._dryAcc, queue: structuredClone(paint._q), growing: structuredClone(paint.growing), floods: structuredClone(paint._floods),
    rip: [...paint.rip], ripP: [...paint.ripP], ripS: [...paint._ripS],
    attributes: Object.fromEntries(Object.entries(paint.geo.attributes).map(([name, attribute]) => [name, [...attribute.array]])),
    drawRange: { ...paint.geo.drawRange }, visible: [paint.mesh.visible, paint.dryMesh.visible, paint._floodMesh.visible], dry: paint._dryU.uDry.value,
    floodGeometry: paint._floodMesh.geometry, floodMaterial: paint._floodMesh.material,
    floodUniforms: Object.fromEntries(Object.entries(paint._floodU).map(([name, uniform]) => [name, uniform.value?.toArray?.() || (ArrayBuffer.isView(uniform.value) ? [...uniform.value] : uniform.value)])),
    atlasWrites: paint.rt.userData?.writes || 0,
  };
}

const item = fixture(), before = paintSnapshot(item.paint), rendererBefore = item.renderer.snapshot();
const actions = item.paint.mobilePreparationSteps(item.renderer);
assert.deepEqual(actions.map(action => action.kind), ['splat', 'dry', 'flood', 'wipe']);
for (const action of actions) {
  const result = action.action(); assert.equal(result.draws, 1);
  assert.deepEqual(item.renderer.snapshot(), rendererBefore); assert.deepEqual(paintSnapshot(item.paint), before);
}
assert.ok(item.renderer.draws.every(draw => draw.target !== item.paint.rt && draw.target.width === 4 && draw.target.texture.type === item.paint.rt.texture.type));
const [splat, dry, flood, wipe] = item.renderer.draws;
assert.equal(splat.geometry, item.paint.geo); assert.equal(splat.material, item.paint.mat); assert.deepEqual(splat.range, { start: 0, count: 6 });
assert.equal(dry.geometry, item.paint.dryMesh.geometry); assert.equal(dry.material, item.paint.dryMesh.material);
assert.equal(flood.material, item.paint._floodInk); assert.equal(wipe.material, item.paint._floodWipe);
assert.equal(flood.geometry, wipe.geometry); assert.equal(flood.geometry, item.paint._mobileFloodGeometry);
const programIds = item.renderer.info.programs.map(program => program.id);
item.paint.mesh.visible = true; item.paint.geo.setDrawRange(0, 6); item.renderer.setRenderTarget(item.paint.rt); item.renderer.render(item.paint.scene, item.paint.cam);
assert.deepEqual(item.renderer.info.programs.map(program => program.id), programIds, '真正图集pass保留同一程序对象，无新链接');
let targetDisposed = 0, geometryDisposed = 0;
item.paint._mobilePreparationTarget.addEventListener('dispose', () => targetDisposed++);
item.paint._mobileFloodGeometry.addEventListener('dispose', () => geometryDisposed++);
item.dispose(); assert.equal(targetDisposed, 1); assert.equal(geometryDisposed, 1);
console.log('通过：四个真实墨水pass共享原材质/大buffer，隔离同格式4×4目标；CPU/队列/计分/图集不变，RT与绘制状态恢复，实画无新程序对象，临时资源随系统释放');

for (const kind of ['splat', 'dry', 'flood', 'wipe']) {
  const broken = fixture(), state = paintSnapshot(broken.paint), renderState = broken.renderer.snapshot();
  broken.renderer.fail = () => { throw new Error(`draw-${kind}`); };
  assert.throws(() => broken.paint.mobilePreparationSteps().find(action => action.kind === kind).action(), new RegExp(`draw-${kind}`));
  assert.deepEqual(paintSnapshot(broken.paint), state); assert.deepEqual(broken.renderer.snapshot(), renderState); broken.dispose();
}
console.log('通过：splat/dry/flood/wipe每条绘制异常路径均恢复全部数据、uniform、geometry/material与渲染状态');
