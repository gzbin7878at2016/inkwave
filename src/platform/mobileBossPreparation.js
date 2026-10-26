// 手机Boss登场准备：绘制真实模型/实例缓冲并预付标题与音效缓存，不推进Boss、比赛或任何事件总线。
import { G } from '../core/ctx.js';
import { BOSS_INTRO_SOUNDS } from '../audio/bossAudio.js';
import { BOSS_CACHED_SOUNDS } from '../audio/bossOneShotCache.js';
import { prepareMobileBossReverb, restoreMobileBossReverb } from '../audio/mobileBossReverb.js';
import { createMobileWarmSession, prepareMobileMesh } from './mobileWarmup.js';

const sum = (total, row) => {
  for (const key of ['programsAdded', 'programsPrepared', 'cacheHits', 'firstDraws', 'draws']) total[key] = (total[key] || 0) + (row?.[key] || 0);
  if (row?.cancelled) total.cancelled = true;
  return total;
};

export async function prepareMobileBoss(game, match, { isCurrent = () => true, onProgress, diagnostics, yieldTurn } = {}) {
  const boss = match?.boss, model = boss?.model;
  if (!model) return { skipped: true, steps: 0, total: 0 };
  const current = () => isCurrent() && game.match === match && !model._disposed;
  const renderer = G.renderer, camera = G.camera, scene = G.scene;
  const tasks = [], add = (label, action, detail = {}) => tasks.push({ label, action, detail });
  let session;
  const draw = mesh => prepareMobileMesh(renderer, mesh, camera, scene, {
    isCurrent: current, beforeFirstUse: session.yieldNow, renderTarget: game.R.composer.readBuffer,
  });
  add('等待Boss贴图', async () => { await model.ready; return {}; });
  model.meshes.forEach((mesh, index) => add(`准备首领外观 ${index + 1}/${model.meshes.length}`, () => draw(mesh), { mesh: mesh.name || mesh.type }));
  ['burst', 'landing', 'steam'].forEach((kind, index) => add(`准备登场效果 ${index + 1}/3`, () => model.fx.withPreparationFrame(kind, async meshes => {
    const result = {};
    for (const mesh of meshes) {
      if (!current()) return { ...result, cancelled: true };
      sum(result, await draw(mesh));
      if (result.cancelled) break;
    }
    return result;
  }), { effect: kind }));
  add('准备Boss危险区', async () => {
    const root = boss.hz?.fx?.warm?.();
    if (!root) return {};
    const meshes = []; root.traverse(object => { if (object.isMesh || object.isPoints || object.isLine) meshes.push(object); });
    const result = {};
    for (const mesh of meshes) {
      if (!current()) return { ...result, cancelled: true };
      sum(result, await draw(mesh));
      if (result.cancelled) break;
    }
    return result;
  });
  // 每只分开建造/首绘/爆墨预备；保留真实实例与独享缓冲，实战直接从池中借用。
  const pool = boss.crabletPool, preparedCrabs = [];
  if (pool) for (let index = 0; index < pool.capacity; index++) {
    add(`准备小怪 ${index + 1}/${pool.capacity}`, () => { preparedCrabs[index] = pool.prepareNext(); return {}; }, { crab: index, phase: 'build' });
    add(`准备小怪外观 ${index + 1}/${pool.capacity}`, () => preparedCrabs[index] ? draw(preparedCrabs[index].mesh) : {}, { crab: index, phase: 'draw' });
    add(`准备小怪效果 ${index + 1}/${pool.capacity}`, () => preparedCrabs[index]?.fx.withPreparationFrame('burst', async meshes => {
      const result = {};
      for (const mesh of meshes) { if (!current()) return { ...result, cancelled: true }; sum(result, await draw(mesh)); if (result.cancelled) break; }
      return result;
    }) || {}, { crab: index, phase: 'pop' });
  }
  BOSS_INTRO_SOUNDS.forEach((sound, index) => add(`准备登场音效 ${index + 1}/${BOSS_INTRO_SOUNDS.length}`, () => G.audio?.prepare?.(sound.name, sound) || { skipped: true }, { sound: sound.name }));
  BOSS_CACHED_SOUNDS.forEach((name, index) => add(`准备战斗短音 ${index + 1}/${BOSS_CACHED_SOUNDS.length}`,
    () => G.audio?.prepareBossSample?.(name, { isCurrent: current,
      enabled: () => !!globalThis.inkwaveMobile && !!game.match?.boss && G.mode === 'match' }) || { skipped: true }, { sound: name }));
  add('准备手机Boss空间混响', () => prepareMobileBossReverb(game, match, { isCurrent: current }));
  add('准备手机Boss抗锯齿输出', () => game.R.prepareMobileBossOutput?.(match, { isCurrent: current, yieldTurn: session.yieldNow }) || { skipped: true });
  add('准备Boss标题与字体', () => game.hud?.boss?.prepareIntro?.({ isCurrent: current }) || { skipped: true });
  const total = tasks.length;
  const trace = diagnostics && {
    beginStage: (name, detail) => diagnostics.beginStage(name, detail),
    record: (_name, detail) => diagnostics.record('mobile-boss-preparation-summary', detail),
  };
  session = createMobileWarmSession(renderer, camera, scene, { isCurrent: current, diagnostics: trace, total,
    renderTarget: game.R.composer.readBuffer, yieldTurn, detail: { boss: model.root.id },
    onProgress: progress => onProgress?.({ completed: progress.completed, total, label: progress.label || '准备Boss' }),
  });
  let cancelled = false, failed = false, summary;
  try {
    for (const task of tasks) await session.step('mobile-boss-preparation-step', task.action, { label: task.label, ...task.detail });
    if (!current()) cancelled = true;
  } catch (error) {
    if (!current()) cancelled = true;
    else { failed = true; throw error; }
  } finally {
    if (cancelled || failed) game.R.mobileAA?.clearBossOutput?.(match);
    if (cancelled || failed) restoreMobileBossReverb(match);
    if (cancelled || failed) pool?.dispose();
    summary = session.finish({ total, cancelled, failed });
  }
  return summary;
}
