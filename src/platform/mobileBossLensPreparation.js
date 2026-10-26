import { G } from '../core/ctx.js';
import { prepareMobileMesh } from './mobileWarmup.js';

// 镜头墨水使用自己的Scene/Camera/HalfFloat目标，不在世界特效树中。
// 只在手机正式Boss加载期准备真实材质和实例缓冲，不制造受击、墨珠或游戏事件。
export async function prepareMobileBossLens(game, match, { isCurrent = () => true, yieldTurn } = {}) {
  if (!globalThis.inkwaveMobile || !match?.boss || match.attract || game.match !== match || G.match !== match) return { skipped: true };
  const lens = game.screenfx?.lens, renderer = G.renderer;
  const current = () => isCurrent() && game.match === match && G.match === match && game.screenfx?.lens === lens && G.renderer === renderer;
  if (!current()) return { cancelled: true };
  game._bossLensPreparation = null;
  const mesh = lens?.scene.children.find(object => object.isMesh && object.material === lens.mat);
  if (!lens || !mesh || !renderer) return { skipped: true, reason: 'screen-lens-unavailable' };
  const result = await prepareMobileMesh(renderer, mesh, lens.cam, lens.scene, {
    isCurrent: current, beforeFirstUse: yieldTurn, renderTarget: lens.rt, minimumDrawCount: 1,
  });
  if (result.cancelled || !current()) return { ...result, cancelled: true };
  const program = renderer.properties.get(lens.mat).currentProgram;
  if (!program || result.draws !== 1) throw new Error('Boss镜头墨水未完成真实首绘');
  const info = { prepared: true, programId: program?.id, instanceCapacity: lens.aA.count, ...result };
  game._bossLensPreparation = info;
  globalThis.inkwaveDiagnostics?.record('mobile-boss-lens-prepared', info);
  return info;
}
