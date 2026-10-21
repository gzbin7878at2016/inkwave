// 仅移动入口创建此策略。PC/Electron不检测、不修改材质和设置。
export function installMobileGpuSafety(renderer) {
  const gl = renderer.getContext();
  const caps = {
    fragmentVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    textureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    arrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
    floatColor: !!gl.getExtension('EXT_color_buffer_float'),
  };
  const state = { caps, tier: caps.fragmentVectors >= 224 && caps.textureUnits >= 8 ? 'textured' : 'basic', fallbackCount: 0, pending: false, fatal: false };
  const oldError = renderer.debug.onShaderError;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    oldError?.(context, program, vertex, fragment);
    const source = context.getShaderSource(fragment) || '';
    if (source.includes('#define INKWAVE_MOBILE_SURFACE')) {
      state.pending = true;
      state.fatal = source.includes('#define INKWAVE_MOBILE_BASIC');
    } else if (source.includes('varying vec4 vSplat') || source.includes('uniform float uDry')) {
      // 墨图集本身失败不能继续伪装成可正常游玩，进入明确的安全暂停出口。
      state.pending = true; state.fatal = true;
    }
  };
  globalThis.inkwaveDiagnostics?.record('mobile-gpu-profile', state);
  return {
    state,
    recover(game) {
      if (!state.pending || gl.isContextLost()) return;
      state.pending = false;
      if (state.fatal || state.fallbackCount >= 1) {
        game.mobileSuspended = true;
        game.input.touch?.clear();
        const message = document.createElement('div'); message.id = 'mobile-gpu-error';
        message.textContent = '此设备图形初始化失败，已安全暂停。请点击“导出日志”，然后重新启动游戏。';
        document.getElementById(message.id)?.remove(); document.body.append(message);
        globalThis.inkwaveDiagnostics?.record('mobile-gpu-safe-stop', state, 'error');
        return;
      }
      state.tier = 'basic'; state.fallbackCount++;
      for (const [materialKey, meshKey] of [['levelMat', 'levelMesh'], ['grateMat', 'grateMesh']]) {
        const old = game[materialKey];
        if (!old?.userData.mobileRebuild) continue;
        const next = old.userData.mobileRebuild('basic');
        game[materialKey] = next; game[meshKey].material = next; old.dispose();
      }
      globalThis.inkwaveDiagnostics?.record('mobile-gpu-fallback', { tier: 'basic', reason: '复杂手机材质未通过编译，保留顶点色与墨迹' }, 'warn');
      // 当前渲染帧尚未交给屏幕，立即用低依赖材质重画，避免把缺地面的帧作为正常画面提交。
      game.R.render();
      if (state.pending) this.recover(game);
    },
  };
}

// CPU保留充分余量；实际链接结果仍以驱动为准，由recover处理意外失败。
export function chooseMobileSurfaceTier(renderer, lib, requested) {
  const state = renderer?.mobileGpu?.state;
  if (requested === 'basic' || state?.tier === 'basic' || !lib) return 'basic';
  const caps = state?.caps;
  if (caps && (lib.albedo.image.depth > caps.arrayLayers || caps.textureUnits < 8)) return 'basic';
  return 'textured';
}
