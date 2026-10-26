// 只对真实手机Boss实战申请60Hz窗口节奏；Canvas仍按用户30/60上限、原像素密度绘制。
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
      return request(!!m?.boss && !m.attract && mode === 'match' && m.state === 'playing'
        && !m.paused && !suspended && (cap === 30 || cap === 60));
    },
    suspend: () => request(false),
  };
}
