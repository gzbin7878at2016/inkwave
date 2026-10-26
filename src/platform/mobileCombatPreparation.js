// 手机真实开局的通用战斗首用准备：只借长期池/材质，不发射技能、不推进模拟或涂改真实墨迹。
import { G } from '../core/ctx.js';
import { BladeFX } from '../game/kits/blade-fx.js';
import { prepareBossTracerMeshes, clearBossTracerPreparation } from '../game/kits/tracer.js';
import { createMobileWarmSession, prepareMobileMesh } from './mobileWarmup.js';

export async function prepareMobileCombat(game, match, { isCurrent = () => true, onProgress, diagnostics } = {}) {
  if (!isCurrent()) return false;
  const tracerMeshes = prepareBossTracerMeshes(match);
  const meshes = [...(G.projectiles?.mobilePreparationMeshes?.(match.actors) || []), ...tracerMeshes];
  G.fx?.root?.traverse(object => { if (object.isMesh || object.isPoints || object.isLine) meshes.push(object); });
  if (match.actors.some(actor => actor.weapon?.kind === 'blade' || actor.weaponId === 'blade')) meshes.push(...BladeFX.mobilePreparationMeshes());
  const unique = [...new Set(meshes)];
  const paintSteps = G.paint?.mobilePreparationSteps?.(G.renderer) || [];
  const session = createMobileWarmSession(G.renderer, G.camera, G.scene, { isCurrent, diagnostics, onProgress,
    total: unique.length + paintSteps.length, detail: { scope: 'combat' }, renderTarget: game.R.composer.readBuffer, summaryCategory: 'mobile-combat-warm-summary' });
  let cancelled = false, failed = false;
  try {
    for (const mesh of unique) {
      await session.step('mobile-combat-first-draw', () => prepareMobileMesh(G.renderer, mesh, G.camera, G.scene, {
        isCurrent, beforeFirstUse: session.yieldNow, renderTarget: game.R.composer.readBuffer, minimumDrawCount: 3,
      }), { object: mesh.name || mesh.type, material: mesh.material?.name || mesh.material?.type });
    }
    for (const item of paintSteps) await session.step('mobile-combat-paint-prepare', item.action, { kind: item.kind, label: item.label });
    cancelled = !isCurrent(); return !cancelled;
  } catch (error) {
    if (!isCurrent()) { cancelled = true; return false; }
    failed = true; throw error;
  } finally {
    if (cancelled || failed) clearBossTracerPreparation(match);
    session.finish({ cancelled, failed });
  }
}
