// 手机诊断版专用：先于游戏启动记录错误，日志只留在本机，用户点击后才导出。
// 限制事件、采样和着色器源码大小，避免诊断日志本身无限占内存/存储。
const STORAGE_KEY = 'inkwave.diagnostics.last';
const MAX_EVENTS = 160;
const MAX_SOURCE = 180000;
const BUILD = typeof __INKWAVE_BUILD__ !== 'undefined' ? __INKWAVE_BUILD__ : { version: 'development', diagnostics: true };

function clean(value, limit = 3000) {
  let s;
  try { s = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ''}` : typeof value === 'string' ? value : JSON.stringify(value); }
  catch { s = String(value); }
  return String(s ?? '').replace(/([?&](?:token|password|secret|key)=)[^&\s]+/gi, '$1[已隐藏]').slice(0, limit);
}

function resourceURL(value) {
  try { const u = new URL(value, location.href); return `${u.origin}${u.pathname}`; }
  catch { return clean(value, 500); }
}

export function installDiagnostics(nativePlugin) {
  if (globalThis.inkwaveDiagnostics) return globalThis.inkwaveDiagnostics;
  const started = performance.now();
  const current = { build: BUILD, startedAt: new Date().toISOString(), userAgent: navigator.userAgent, events: [], shaderFailures: [], gpu: null, native: null };
  let previous = null, renderer = null, savedTimer = null, lastTick = 0;
  let shaderId = 0;
  const shaderSeen = new WeakSet();
  try { const s = localStorage.getItem(STORAGE_KEY); if (s && s.length < 2000000) previous = JSON.parse(s); } catch { /* 旧日志损坏不影响启动 */ }

  const record = (category, detail, level = 'info') => {
    const text = clean(detail);
    const existing = current.events.slice(-30).find(e => e.category === category && e.detail === text);
    if (existing) { existing.count++; existing.lastAt = new Date().toISOString(); }
    else {
      current.events.push({ at: new Date().toISOString(), ms: Math.round(performance.now() - started), level, category, detail: text, count: 1 });
      if (current.events.length > MAX_EVENTS) current.events.shift();
    }
    if (!savedTimer) savedTimer = setTimeout(persist, 1500);
  };

  function sceneSnapshot() {
    const game = globalThis.__inkwave, G = globalThis.__G;
    if (!game || !G) return { bootComplete: false };
    const p = G.paint, m = game.match;
    const texture = t => t ? { width: t.image?.width, height: t.image?.height, depth: t.image?.depth, type: t.type, format: t.format, version: t.version } : null;
    const material = mat => mat ? { type: mat.type, visible: mat.visible, mobileTier: mat.userData?.mobileTier, defines: mat.defines, paintMatches: mat.userData?.uniforms?.uPaint?.value === p?.texture } : null;
    return {
      bootComplete: true, mode: G.mode, mapId: game.mapDef?.id, worldKey: game.worldKey, matchState: m?.state, practice: !!m?.practice,
      mobileGpu: game.R.mobileSafety?.state,
      profile: game.mobile?.profile.snapshot(),
      settings: { quality: game.settings.quality, mobileVisual: game.settings.mobileVisual, mobileDynamicResolution: game.settings.mobileDynamicResolution, shadows: game.settings.shadows, bloom: game.settings.bloom, fpsCap: game.settings.fpsCap },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      level: { faces: G.level?.faces?.length, visible: game.levelMesh?.visible, vertices: game.levelMesh?.geometry?.attributes?.position?.count, material: material(game.levelMat), grateMaterial: material(game.grateMat) },
      textures: { albedo: texture(game.texlib?.albedo), normal: texture(game.texlib?.normal), orm: texture(game.texlib?.orm), mural: texture(game.murals), lightmap: texture(game.levelMat?.userData?.uniforms?.uLight?.value) },
      paint: p ? { size: p.size, ppm: p.ppm, frame: p.frame, clock: p.clock, counts: p.counts, coverage: p.coverage(), faces: p.paintFaces.length, missingAtlas: p.paintFaces.filter(f => !f.atlas).length, textureVersion: p.texture.version } : null,
      // 记录真实像素尺寸而非CSS窗口，避免把低分辨率放大误判成材质错误。
      render: { fps: game.fps, scale: game.R.dynScale, ...game.perf,
        pixelRatio: game.R.renderer.getPixelRatio(),
        basePixelRatio: Math.min(devicePixelRatio || 1, game.R.q.pixelRatio),
        resolutionPolicy: game.settings.mobileDynamicResolution === false ? 'fixed' : 'adaptive',
        canvas: { width: game.R.renderer.domElement.width, height: game.R.renderer.domElement.height },
        target: game.R.composer ? { width: Math.floor(game.R.composer.renderTarget1.width), height: Math.floor(game.R.composer.renderTarget1.height) } : null,
        antialias: game.R.mobileAA ? (game.R.mobileAA.uniforms ? 'FXAA' : 'SMAA') : game.R.samples ? `MSAA ${game.R.samples}x` : game.R.composer?.passes.some(pass => pass.constructor.name === 'SMAAPass') ? 'SMAA' : 'none',
        fxaaTexel: game.R.mobileAA?.uniforms?.resolution.value.toArray(),
        smaaTexel: game.R.mobileAA?._materialBlend?.uniforms.resolution.value.toArray(),
        memory: { ...game.R.renderer.info.memory } },
    };
  }

  function persist() {
    if (savedTimer) clearTimeout(savedTimer); savedTimer = null;
    try {
      const text = JSON.stringify({ ...current, scene: sceneSnapshot() });
      if (text.length < 1900000) localStorage.setItem(STORAGE_KEY, text);
    } catch { /* 空间不足/游戏尚未初始化时，内存日志与导出仍可用 */ }
  }

  const captureShader = (gl, program, vs, fs) => {
    if (shaderSeen.has(program)) return;
    shaderSeen.add(program);
    const full = current.shaderFailures.length < 2;
    const vertexSource = gl.getShaderSource(vs) || '', fragmentSource = gl.getShaderSource(fs) || '';
    const failure = {
      id: ++shaderId, at: new Date().toISOString(), link: gl.getProgramParameter(program, gl.LINK_STATUS),
      programLog: clean(gl.getProgramInfoLog(program), 12000),
      vertex: { compiled: gl.getShaderParameter(vs, gl.COMPILE_STATUS), log: clean(gl.getShaderInfoLog(vs), 12000), bytes: vertexSource.length, source: full ? vertexSource.slice(0, MAX_SOURCE) : undefined },
      fragment: { compiled: gl.getShaderParameter(fs, gl.COMPILE_STATUS), log: clean(gl.getShaderInfoLog(fs), 12000), bytes: fragmentSource.length, source: full ? fragmentSource.slice(0, MAX_SOURCE) : undefined },
      isPaintSurface: fragmentSource.includes('uniform sampler2D uPaint'),
    };
    if (current.shaderFailures.length < 8) current.shaderFailures.push(failure);
    record('shader-link-failed', { id: failure.id, paintSurface: failure.isPaintSurface, log: failure.programLog }, 'error');
    persist(); // 首次失败立即保存，黑屏/强退后仍能从上一运行日志取证。
  };

  const attachRenderer = r => {
    renderer = r;
    const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const parameters = ['MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_COMPONENTS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_VARYING_VECTORS', 'MAX_VARYING_COMPONENTS', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_ATTRIBS', 'MAX_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_3D_TEXTURE_SIZE', 'MAX_SAMPLES'];
    const limits = Object.fromEntries(parameters.map(name => [name, gl.getParameter(gl[name])]));
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    current.gpu = { vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER), version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION), limits, highFloat: precision ? { rangeMin: precision.rangeMin, rangeMax: precision.rangeMax, precision: precision.precision } : null, extensions: gl.getSupportedExtensions() };
    // Three.js 默认关闭检查会让地面 shader 失败只表现为透明。本诊断包明确开启首次编译检查。
    r.debug.checkShaderErrors = true;
    r.debug.onShaderError = captureShader;
    record('renderer-created', current.gpu.limits);
    r.domElement.addEventListener('webglcontextlost', () => { record('webgl-context-lost', '图形上下文丢失', 'error'); persist(); });
    r.domElement.addEventListener('webglcontextrestored', () => record('webgl-context-restored', '图形上下文恢复'));
    persist();
  };

  function programsSnapshot() {
    if (!renderer) return [];
    const gl = renderer.getContext();
    return renderer.info.programs.map(p => {
      try {
        const attached = gl.getAttachedShaders(p.program) || [];
        const shader = attached.find(s => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER);
        const source = shader ? gl.getShaderSource(shader) || '' : '';
        const linked = gl.getProgramParameter(p.program, gl.LINK_STATUS);
        const paint = source.includes('uniform sampler2D uPaint');
        // 只导出地面程序的 uniform 表，确认数组规模与设备上限；不每帧枚举。
        const uniforms = paint && linked ? Array.from({ length: gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) }, (_, i) => {
          const u = gl.getActiveUniform(p.program, i); return { name: u.name, size: u.size, type: u.type };
        }) : undefined;
        return { name: p.name, type: p.type, linked, isPaintSurface: paint, fragmentBytes: source.length, uniforms };
      } catch (e) { return { error: clean(e) }; }
    });
  }

  function paintProbe() {
    const p = globalThis.__G?.paint;
    if (!p || !renderer || renderer.getContext().isContextLost()) return { available: false };
    const pixels = [];
    try {
      // 导出时才读取最多8个CPU判为有墨的图集像素，区分“未画进图集”和“地面未显示”。
      for (const f of p.paintFaces) {
        if (!f.atlas) continue;
        for (let k = 0; k < f.nu * f.nv; k++) {
          const team = p.grid[f.grid + k]; if (!team || p.dead[f.grid + k]) continue;
          const a = f.atlas, x = Math.floor(a.x + a.pad + (k % f.nu + 0.5) * f.cu * a.ppm), y = Math.floor(a.y + a.pad + (Math.floor(k / f.nu) + 0.5) * f.cv * a.ppm);
          const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(p.rt, x, y, 1, 1, pixel);
          pixels.push({ x, y, cpuTeam: team - 1, rgba: Array.from(pixel) });
          k += Math.max(1, Math.floor(f.nu / 3));
          if (pixels.length >= 8) break;
        }
        if (pixels.length >= 8) break;
      }
      return { available: true, pixels, note: 'CPU网格中心与GPU墨边缘可能略有差异，不能只据单个透明采样断言图集失败。' };
    } catch (e) { return { available: false, error: clean(e) }; }
  }

  const report = ({ probe = false } = {}) => ({
    format: 'inkwave-android-diagnostics-v1', exportedAt: new Date().toISOString(),
    current: { ...current, scene: sceneSnapshot(), programs: programsSnapshot(), performanceSamples: globalThis.__inkwave?.mobile?.state?.samples?.slice(-600) || [], paintProbe: probe ? paintProbe() : undefined },
    previous,
  });
  const manager = { record, attachRenderer, report, persist, tick() {
    const now = performance.now(); if (now - lastTick < 5000) return; lastTick = now;
    // 详细排行在current.scene与每秒样本中保存，不重复塞进有长度上限的事件字符串。
    const snapshot = sceneSnapshot(); delete snapshot.profile;
    record('scene-snapshot', snapshot);
    if (renderer) { const gl = renderer.getContext(); const errors = []; for (let i = 0; i < 4; i++) { const e = gl.getError(); if (!e) break; errors.push(e); } if (errors.length) record('webgl-errors', errors, 'error'); }
    persist();
  } };
  globalThis.inkwaveDiagnostics = manager;

  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { record(`console-${level}`, args.map(a => clean(a, 2000)).join(' '), level); original(...args); };
  }
  window.addEventListener('error', e => {
    if (e.target && e.target !== window) record('resource-error', { tag: e.target.tagName, url: resourceURL(e.target.src || e.target.href || '') }, 'error');
    else record('javascript-error', e.error || `${e.message} at ${resourceURL(e.filename)}:${e.lineno}`, 'error');
  }, true);
  window.addEventListener('unhandledrejection', e => record('unhandled-rejection', e.reason, 'error'));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = resourceURL(args[0]?.url || args[0]);
    try { const response = await originalFetch(...args); if (!response.ok) record('fetch-http-error', { url, status: response.status }, 'error'); return response; }
    catch (e) { record('fetch-failed', { url, error: clean(e) }, 'error'); throw e; }
  };
  document.addEventListener('visibilitychange', () => { record('visibility', document.visibilityState); persist(); });
  window.addEventListener('pagehide', persist);
  record('diagnostics-started', BUILD);
  if (globalThis.inkwaveMobile?.native) nativePlugin.getInfo().then(info => { current.native = info; record('native-info', info); persist(); }).catch(e => record('native-info-error', e, 'error'));

  // 在主菜单甚至启动失败时都能导出；游戏UI就绪后将同一按钮移动到菜单条中。
  const button = document.createElement('button'); button.id = 'mobile-log-export'; button.dataset.mobile = 'logs'; button.textContent = '导出日志';
  document.body.append(button);
  button.onclick = async () => {
    button.disabled = true;
    try {
      record('user-export', '用户主动导出诊断日志'); persist();
      const text = JSON.stringify(report({ probe: true }), null, 2);
      let message;
      if (globalThis.inkwaveMobile?.native) {
        const result = await nativePlugin.saveReport({ text }); message = `日志已保存到：下载 / INKWAVE / ${result.filename}`;
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `INKWAVE-logs-${Date.now()}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000); message = '日志文件已交给浏览器下载。';
      }
      showStatus(message);
    } catch (e) { record('export-failed', e, 'error'); showStatus(`导出失败：${clean(e, 500)}。可使用“复制报告”。`); }
    finally { button.disabled = false; }
  };
  return manager;
}

function showStatus(text) {
  document.getElementById('mobile-log-status')?.remove();
  const el = document.createElement('div'); el.id = 'mobile-log-status'; el.textContent = text;
  const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => el.remove(); el.append(close); document.body.append(el);
}
