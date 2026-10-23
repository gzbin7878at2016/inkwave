import * as THREE from 'three';

// 手机加载期准备：程序缓存按真实program对象隔离到renderer，绝不按材质名字猜测缓存命中。
const CANCELLED = Symbol('mobile-warm-cancelled');
const rendererStates = new WeakMap();

function rendererState(renderer) {
  let state = rendererStates.get(renderer);
  if (!state) {
    state = { programs: new WeakSet(), geometries: new WeakSet(), instances: new WeakSet(), skeletons: new WeakSet(), watched: new WeakSet(), target: null, targetSource: null };
    rendererStates.set(renderer, state);
  }
  return state;
}

function prepareProgram(program) {
  program.getUniforms();
  if (program.diagnostics?.runnable === false) throw new Error(`手机预热shader链接失败：${program.diagnostics.programLog || 'LINK_STATUS=false'}`);
  program.getAttributes();
}

// 固定的本地Three.js直到首次getUniforms/getAttributes才检查链接状态并枚举接口。
// 不关闭shader错误检查、不扫描其他程序。旧入口保留，首次程序准备使用下方带缓存的网格入口。
export function prepareMobileMaterialPrograms(renderer, material) {
  const prepared = new Set();
  for (const mat of Array.isArray(material) ? material : [material]) {
    if (!mat) continue;
    const program = renderer.properties.get(mat).currentProgram;
    if (!program || prepared.has(program)) continue;
    prepareProgram(program); prepared.add(program);
  }
  return prepared.size;
}

function nextBrowserTurn() {
  // rAF 回调先发生，再排一个普通任务，让加载提示和输入有机会真正绘制/处理。
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function' && !globalThis.document?.hidden) requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

function tinyTarget(state, template) {
  if (!state.target || state.targetSource !== template) {
    state.target?.dispose();
    state.target = template?.clone ? template.clone() : new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    state.target.setSize(4, 4); state.targetSource = template;
  }
  return state.target;
}

function saveRenderer(renderer) {
  return { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace?.() || 0, mip: renderer.getActiveMipmapLevel?.() || 0,
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest(),
    autoClear: renderer.autoClear, shadowAuto: renderer.shadowMap.autoUpdate, shadowNeeds: renderer.shadowMap.needsUpdate };
}

function restoreRenderer(renderer, saved) {
  renderer.setRenderTarget(saved.target, saved.face, saved.mip); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
  renderer.autoClear = saved.autoClear; renderer.shadowMap.autoUpdate = saved.shadowAuto; renderer.shadowMap.needsUpdate = saved.shadowNeeds;
}

function isolatedScene(source) {
  const scene = new THREE.Scene();
  scene.environment = source.environment; scene.fog = source.fog;
  scene.environmentIntensity = source.environmentIntensity; scene.environmentRotation.copy(source.environmentRotation);
  source.traverseVisible(object => {
    if (!object.isLight) return;
    const light = object.clone(false); object.updateWorldMatrix(true, false);
    light.matrixAutoUpdate = false; light.matrix.copy(object.matrixWorld);
    if (object.target) {
      object.target.updateWorldMatrix(true, false);
      light.target = new THREE.Object3D(); light.target.position.setFromMatrixPosition(object.target.matrixWorld); scene.add(light.target);
    }
    scene.add(light);
  });
  return scene;
}

// 单个代理完成材质自身初始化、首次程序接口准备与真实绘制。模板目标只决定格式，不写入原composer。
export async function prepareMobileMesh(renderer, mesh, camera, targetScene, {
  material = mesh.material, isCurrent = () => true, beforeFirstUse = nextBrowserTurn, renderTarget, draw = true, minimumDrawCount = 0,
} = {}) {
  if (!isCurrent()) return { cancelled: true, programsAdded: 0, programsPrepared: 0, cacheHits: 0, firstDraws: 0, draws: 0 };
  const state = rendererState(renderer), target = tinyTarget(state, renderTarget), before = renderer.info.programs.length;
  const proxy = mesh.clone(false); proxy.material = material; proxy.visible = true; proxy.frustumCulled = false; proxy.layers.mask = camera.layers.mask;
  // InstancedMesh.clone会复制实例数据，必须共享真正将上屏的BufferAttribute，否则仍遗漏真实实例的GPU上传。
  if (mesh.isInstancedMesh) { proxy.instanceMatrix = mesh.instanceMatrix; proxy.instanceColor = mesh.instanceColor; proxy.morphTexture = mesh.morphTexture; }
  if (mesh.isInstancedMesh && minimumDrawCount > 0 && proxy.count === 0) proxy.count = Math.min(minimumDrawCount, mesh.instanceMatrix.count);
  mesh.updateWorldMatrix(true, false); proxy.matrixAutoUpdate = false; proxy.matrix.copy(mesh.matrixWorld);
  let saved = saveRenderer(renderer);
  try { renderer.setRenderTarget(target); renderer.compile(proxy, camera, targetScene); }
  finally { restoreRenderer(renderer, saved); }
  const materials = (Array.isArray(material) ? material : [material]).filter(Boolean);
  const programs = [...new Set(materials.map(mat => renderer.properties.get(mat).currentProgram).filter(Boolean))];
  const unknown = programs.filter(program => !state.programs.has(program));
  const firstDraw = !state.geometries.has(mesh.geometry) || (mesh.isInstancedMesh && !state.instances.has(mesh.instanceMatrix)) ||
    (mesh.isSkinnedMesh && (!state.skeletons.has(mesh.skeleton) || mesh.skeleton.boneTexture === null));
  // 未知shader/首次资源使用前先让加载画面真正绘制；已准备的程序不承担每次固定10ms等待。
  if (unknown.length || (draw && firstDraw)) await beforeFirstUse();
  if (!isCurrent()) return { cancelled: true, programsAdded: renderer.info.programs.length - before, programsPrepared: 0, cacheHits: 0, firstDraws: 0, draws: 0 };
  for (const program of unknown) { prepareProgram(program); state.programs.add(program); }
  if (!isCurrent()) return { cancelled: true, programsAdded: renderer.info.programs.length - before, programsPrepared: unknown.length, cacheHits: programs.length - unknown.length, firstDraws: 0, draws: 0 };
  let draws = 0;
  if (draw) {
    const scene = isolatedScene(targetScene); scene.add(proxy); saved = saveRenderer(renderer);
    const range = { ...mesh.geometry.drawRange }, instances = mesh.geometry.instanceCount;
    try {
      // 空闲长期池也触发真实draw；只在同步render内临时开放最小数量，让帧前恢复真实池计数。
      if (minimumDrawCount > 0 && mesh.geometry.drawRange.count === 0) mesh.geometry.setDrawRange(0, Math.min(minimumDrawCount, mesh.geometry.index?.count || mesh.geometry.attributes.position.count));
      if (minimumDrawCount > 0 && mesh.geometry.isInstancedBufferGeometry && mesh.geometry.instanceCount === 0) mesh.geometry.instanceCount = minimumDrawCount;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; renderer.autoClear = true;
      renderer.setRenderTarget(target); renderer.setViewport(0, 0, 4, 4); renderer.setScissor(0, 0, 4, 4); renderer.setScissorTest(false);
      renderer.render(scene, camera); draws = 1;
      // 实际绘制若因渲染器状态生成额外变体，也必须确认可运行，失败不能继续进入对局。
      for (const mat of materials) {
        const program = renderer.properties.get(mat).currentProgram;
        if (program?.diagnostics?.runnable === false) throw new Error(`手机首绘shader链接失败：${program.diagnostics.programLog || 'LINK_STATUS=false'}`);
        if (program && !state.programs.has(program)) { prepareProgram(program); state.programs.add(program); }
      }
      state.geometries.add(mesh.geometry);
      if (!state.watched.has(mesh.geometry)) {
        const geometry = mesh.geometry;
        state.watched.add(geometry); geometry.addEventListener('dispose', () => state.geometries.delete(geometry));
      }
      if (mesh.isInstancedMesh) state.instances.add(mesh.instanceMatrix);
      if (mesh.isSkinnedMesh) state.skeletons.add(mesh.skeleton);
    } finally { mesh.geometry.setDrawRange(range.start, range.count); if (mesh.geometry.isInstancedBufferGeometry) mesh.geometry.instanceCount = instances; scene.remove(proxy); restoreRenderer(renderer, saved); }
  }
  return { programsAdded: renderer.info.programs.length - before, programsPrepared: unknown.length, cacheHits: programs.length - unknown.length, firstDraws: firstDraw && draw ? 1 : 0, draws };
}

// 可复用预算会话：首步先让可见帧，此后累计约5ms才让帧；重步骤仍不可中断。
export function createMobileWarmSession(renderer, camera, targetScene, { isCurrent = () => true, diagnostics, detail = {}, onProgress, total = 0, yieldTurn = nextBrowserTurn, budgetMs = 5, renderTarget, summaryCategory = 'mobile-character-warm-summary' } = {}) {
  let boundary = performance.now(), begun = false, completed = 0, ended = false, yields = 0;
  const phases = new Map(), started = performance.now();
  const summary = { steps: 0, programsAdded: 0, programsPrepared: 0, cacheHits: 0, firstDraws: 0, draws: 0, maxStepMs: 0, slowest: null };
  const check = () => { if (!isCurrent()) throw CANCELLED; };
  const yieldNow = async () => { check(); yields++; await yieldTurn(); boundary = performance.now(); check(); };
  const start = async () => { if (!begun) { begun = true; await yieldNow(); } };
  const step = async (name, action, extra = {}) => {
    await start(); check();
    if (performance.now() - boundary >= budgetMs) await yieldNow();
    const stageDetail = { ...detail, ...extra }, begin = performance.now(), finish = diagnostics?.beginStage(name, stageDetail);
    let succeeded = false;
    onProgress?.({ completed, total, phase: name, ...extra });
    try {
      const result = await action();
      for (const key of ['programsAdded', 'programsPrepared', 'cacheHits', 'firstDraws', 'draws']) if (Number.isFinite(result?.[key])) { summary[key] += result[key]; stageDetail[key] = result[key]; }
      if (result?.cancelled) throw CANCELLED;
      check(); succeeded = true;
      return result;
    } finally {
      const ms = performance.now() - begin, phase = phases.get(name) || { name, count: 0, totalMs: 0, maxMs: 0 };
      phase.count++; phase.totalMs += ms; phase.maxMs = Math.max(phase.maxMs, ms); phases.set(name, phase);
      if (ms >= summary.maxStepMs) { summary.maxStepMs = ms; summary.slowest = { name, ...extra }; }
      summary.steps++; if (succeeded) completed++; finish?.(); onProgress?.({ completed, total, phase: name, ...extra });
    }
  };
  const session = { start, step, yieldNow, isCurrent,
    prepareMesh: (mesh, material = mesh.material, extra = {}) => step('mobile-material-prepare', () => prepareMobileMesh(renderer, mesh, camera, targetScene, { material, isCurrent, beforeFirstUse: yieldNow, renderTarget }), extra),
    finish(extra = {}) {
      const result = { ...detail, ...summary, ...extra, elapsedMs: Math.round(performance.now() - started), yields, maxStepMs: Math.round(summary.maxStepMs),
        phases: [...phases.values()].map(phase => ({ ...phase, totalMs: Math.round(phase.totalMs), maxMs: Math.round(phase.maxMs) })) };
      if (!ended) { ended = true; diagnostics?.record(summaryCategory, result); }
      return result;
    } };
  return session;
}

export function createMobileWarmQueue(yieldTurn = nextBrowserTurn, budgetMs = 5) {
  let tail = Promise.resolve();
  return (work, { isCurrent = () => true, diagnostics, detail = {}, onProgress, total } = {}) => {
    const queued = performance.now();
    const task = tail.then(async () => {
      const session = createMobileWarmSession(null, null, null, { isCurrent, diagnostics, detail, onProgress, total, yieldTurn, budgetMs });
      let cancelled = false, failed = false, start = performance.now();
      try {
        await session.start(); start = performance.now();
        const step = Object.assign(session.step, { beforeFirstUse: session.yieldNow });
        const result = await work(step);
        if (!isCurrent()) throw CANCELLED;
        return result;
      } catch (error) {
        if (error !== CANCELLED) { failed = true; throw error; }
        cancelled = true; return false;
      } finally {
        session.finish({ queuedMs: Math.round(start - queued), cancelled, failed });
      }
    });
    // 单个角色失败不能阻塞之后的角色；调用者仍收到原始异常。
    tail = task.catch(() => {});
    return task;
  };
}

export const queueMobileCharacterWarm = createMobileWarmQueue();
