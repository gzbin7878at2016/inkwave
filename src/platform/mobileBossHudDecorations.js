// 手机真实Boss独占：仅停止HUD的非玩法装饰，状态文本、告警和有限受击动画仍由原CSS驱动。
// 只在状态切换时改类；不枚举动画、不改时钟、不逐帧读布局或写样式。
export function createMobileBossHudDecorations() {
  let root = null, active = false, activations = 0, releases = 0;
  const clear = () => {
    if (active) { root?.classList.remove('iw-mobile-boss-decor'); active = false; releases++; }
  };
  return {
    clear,
    update(nextRoot, match, mode, suspended) {
      if (root !== nextRoot) { clear(); root = nextRoot; }
      const enabled = !!globalThis.inkwaveMobile && !!root && !!match?.boss && !match.attract && mode === 'match'
        && match.state === 'playing' && !match.paused && !suspended;
      if (enabled === active) return;
      if (enabled) { root.classList.add('iw-mobile-boss-decor'); active = true; activations++; } else clear();
    },
    info: () => ({ active, activations, releases }),
  };
}
