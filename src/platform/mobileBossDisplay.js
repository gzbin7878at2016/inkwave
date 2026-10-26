// 只对真实手机Boss申请60Hz窗口节奏；提前到加载预检/开场，避免切换落进首个战斗帧。
export function createMobileBossDisplay(plugin, record = () => {}) {
  let desired = false, attempted, pending = false;
  const pump = async () => {
    if (pending || !plugin) return;
    pending = true;
    try {
      // 串行桥调用，快速暂停/恢复时最后一个状态必须落实；失败不逐帧重试刷屏。
      while (attempted !== desired) {
        const active = desired; attempted = active;
        try { record('mobile-boss-display', await plugin.setBossActive({ active })); }
        catch (error) { record('mobile-boss-display-failed', String(error)); }
      }
    } finally { pending = false; }
  };
  const request = active => { desired = active; return pump(); };
  return {
    update(game, mode, suspended) {
      const m = game.match, cap = game.settings.fpsCap;
      const preparing = m?.state === 'init' && !!game._mobilePreparation && !game._mobilePreparationError;
      const visibleMatch = mode === 'match' && (m?.state === 'intro' || m?.state === 'playing');
      return request(!!m?.boss && !m.attract && (preparing || visibleMatch)
        && !m.paused && !suspended && (cap === 30 || cap === 60));
    },
    suspend: () => request(false),
  };
}
