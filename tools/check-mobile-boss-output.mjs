// 用真实WebGL比较原SMAA+Output与合并输出；覆盖HDR边缘/透明度、色调/色域/曝光、尺寸和状态恢复。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-output-test.html', `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>`);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://localhost:8490/releases/investigation/boss-output-test.html');
  const report = await page.evaluate(async () => {
    const T = await import('three'), { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
    const { ShaderPass } = await import('three/addons/postprocessing/ShaderPass.js'), { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
    const { MobileSMAAPass } = await import('/src/platform/mobileSMAAPass.js');
    const { Renderer } = await import('/src/core/renderer.js'), { G } = await import('/src/core/ctx.js');
    const check = (v, msg) => { if (!v) throw Error(msg); }, errors = [];
    const r = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); document.body.append(r.domElement);
    r.debug.onShaderError = () => errors.push('shader failure'); r.info.autoReset = false;
    globalThis.inkwaveMobile = {}; const match = { boss: {} }, rows = [];
    const shader = { uniforms: {}, vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 vUv;void main(){float edge=step(vUv.y*.73+.11,vUv.x);float lines=step(.5,fract((vUv.x+vUv.y*.31)*19.));
      vec3 a=vec3(.013,.32,4.7),b=vec3(9.3,.038,.16);vec3 c=mix(a,b,edge)*mix(.18,1.7,lines);gl_FragColor=vec4(c,mix(.15,1.,step(.38,vUv.y)));}` };
    const make = () => { const c = new EffectComposer(r, new T.WebGLRenderTarget(2, 2, { type: T.HalfFloatType, depthBuffer: false }));
      const source = new ShaderPass(shader); source.material.toneMapped = false; const aa = new MobileSMAAPass(), output = new OutputPass();
      c.addPass(source); c.addPass(aa); c.addPass(output); return { c, aa, output, source }; };
    const original = make(), fused = make();
    for (let i = 0; i < 100 && ![original, fused].every(x => x.aa._areaTexture.image.complete && x.aa._searchTexture.image.complete); i++) await new Promise(resolve => setTimeout(resolve, 10));
    const snapshot = () => ({ target: r.getRenderTarget(), viewport: r.getViewport(new T.Vector4()).toArray(), scissor: r.getScissor(new T.Vector4()).toArray(), test: r.getScissorTest(), auto: r.autoClear });
    const draw = x => { r.info.reset(); x.c.render(); const gl = r.getContext(), bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return { bytes, calls: r.info.render.calls }; };
    const modes = [T.NoToneMapping, T.LinearToneMapping, T.ReinhardToneMapping, T.CineonToneMapping, T.ACESFilmicToneMapping, T.AgXToneMapping, T.NeutralToneMapping, T.CustomToneMapping];
    for (const [width, height, ratio] of [[63, 37, 2], [83, 51, 1.5]]) for (const mode of modes) for (const color of [T.SRGBColorSpace, T.LinearSRGBColorSpace]) {
      r.setPixelRatio(ratio); r.setSize(width, height); r.outputColorSpace = color; r.toneMapping = mode; r.toneMappingExposure = mode === T.NeutralToneMapping ? 1.7 : 0.73;
      for (const x of [original, fused]) { x.c.setPixelRatio(ratio); x.c.setSize(width, height); }
      const before = snapshot(); const preparation = await fused.aa.prepareBossOutput(r, match, fused.output);
      check(preparation.prepared, '合并程序未准备'); const after = snapshot();
      check(before.target === after.target && JSON.stringify({ ...before, target: null }) === JSON.stringify({ ...after, target: null }), '预备改变了目标/视口/裁剪/清屏状态');
      check(fused.aa.syncBossOutput(match, 'match'), '手机Boss未启用合并');
      const expected = draw(original), actual = draw(fused); let max = 0, different = 0;
      for (let i = 0; i < actual.bytes.length; i++) { const d = Math.abs(actual.bytes[i] - expected.bytes[i]); max = Math.max(max, d); if (d) different++; }
      check(max <= 1, `输出不等价：tone=${mode},color=${color},max=${max}`);
      check(expected.calls === 5 && actual.calls === 4, '没有恰好减少一遍绘制');
      const program = r.properties.get(fused.aa._fused).currentProgram;
      check(program.id === preparation.programId, '首次上屏又建了未预备的程序');
      rows.push({ width, height, ratio, mode, color, maxByteDifference: max, differentBytes: different, bytes: actual.bytes.length, calls: [expected.calls, actual.calls] });
      check(!fused.aa.syncBossOutput(match, 'menu') && fused.output.enabled, '回菜单未恢复原OutputPass');
      const restored = draw(fused); check(restored.bytes.every((v, i) => v === expected.bytes[i]) && restored.calls === 5, '回退后原图/绘制不一致');
    }
    // 同一pass中途曝光变动，不能沿用加载时的曝光值；uniforms必须与原SMAA纹理/尺寸共享。
    r.toneMapping = T.NeutralToneMapping; r.outputColorSpace = T.SRGBColorSpace;
    await fused.aa.prepareBossOutput(r, match, fused.output); fused.aa.syncBossOutput(match, 'match');
    r.toneMappingExposure = 0.43; const a = draw(original), b = draw(fused);
    check(b.bytes.every((v, i) => Math.abs(v - a.bytes[i]) <= 1), '曝光动态变化未同步');
    check(fused.aa._fused.uniforms.resolution === fused.aa._uniformsBlend.resolution && fused.aa._fused.uniforms.tColor === fused.aa._uniformsBlend.tColor, '未共享原纹理/真实尺寸uniform');
    check(!fused.aa.syncBossOutput({ boss: {} }, 'match') && fused.output.enabled, '新局误用旧局准备');
    globalThis.inkwaveMobile = false; check((await fused.aa.prepareBossOutput(r, match, fused.output)).skipped, 'PC错误准备');
    globalThis.inkwaveMobile = {}; check((await fused.aa.prepareBossOutput(r, { boss: null }, fused.output)).skipped, '普通对局错误准备');
    check((await fused.aa.prepareBossOutput(r, { boss: {}, attract: true }, fused.output)).skipped, '演示对局错误准备');
    check((await fused.aa.prepareBossOutput(r, match, fused.output, { isCurrent: () => false })).skipped, '取消前仍准备');
    let current = true; check((await fused.aa.prepareBossOutput(r, match, fused.output, { isCurrent: () => current, yieldTurn: async () => { current = false; } })).cancelled, '让帧取消未生效');
    check(!fused.aa.syncBossOutput(match, 'match') && fused.output.enabled, '取消后还启用合并');
    // 让帧期间窗口状态改变并取消，不能用让帧前的旧视口回滚新窗口状态。
    current = true;
    await fused.aa.prepareBossOutput(r, match, fused.output, { isCurrent: () => current, yieldTurn: async () => { r.setViewport(1, 2, 70, 40); current = false; } });
    check(JSON.stringify(r.getViewport(new T.Vector4()).toArray()) === JSON.stringify([1, 2, 70, 40]), '取消覆盖了让帧后的视口');
    r.setViewport(0, 0, r.domElement.width, r.domElement.height);
    const beforeFailure = snapshot(), actualRender = r.render;
    r.render = function(mesh, camera) { if (mesh.material?.name === 'SMAABossOutputShader') throw Error('注入候选绘制异常'); return actualRender.call(this, mesh, camera); };
    let failed = false; try { await fused.aa.prepareBossOutput(r, match, fused.output); } catch { failed = true; } finally { r.render = actualRender; }
    check(failed && JSON.stringify(snapshot().viewport) === JSON.stringify(beforeFailure.viewport) && snapshot().target === beforeFailure.target && fused.output.enabled, '异常未还原目标/视口/原输出');
    await fused.aa.prepareBossOutput(r, match, fused.output); fused.output.enabled = false;
    check(!fused.aa.syncBossOutput(match, 'match'), '外部关闭Output时仍额外转换'); fused.output.enabled = true;
    // 离屏目标也要保留输出色调变换；读实际half-float结果比较，不拿屏幕旧像素代替。
    fused.aa.syncBossOutput(match, 'match');
    for (const x of [original, fused]) x.c.renderToScreen = false;
    const offscreen = x => { x.c.render(); const target = x.c.readBuffer, data = new Uint16Array(target.width * target.height * 4); r.readRenderTargetPixels(target, 0, 0, target.width, target.height, data); return data; };
    const offA = offscreen(original), offB = offscreen(fused); let offError = 0;
    for (let i = 0; i < offA.length; i++) offError = Math.max(offError, Math.abs(T.DataUtils.fromHalfFloat(offA[i]) - T.DataUtils.fromHalfFloat(offB[i])));
    check(offError <= 0.002, '离屏half-float输出色调不一致');
    // 实际Renderer入口必须在Composer选择最后一个pass前切换，不能只测试手工切换的孤立材质。
    const host = Object.create(Renderer.prototype); Object.assign(host, { renderer: r, mobileSafety: {}, mobileAA: fused.aa, outputPass: fused.output, composer: fused.c, resize() {} });
    G.env = null; G.match = match; G.mode = 'match'; r.info.reset(); host.render();
    check(r.info.render.calls === 4 && !fused.output.enabled, '真实Renderer入口未减少输出绘制');
    G.mode = 'menu'; r.info.reset(); host.render(); check(r.info.render.calls === 5 && fused.output.enabled, '真实Renderer菜单入口未恢复');
    r.render = function(mesh, camera) { if (mesh.material?.name === 'SMAABossOutputShader') throw Error('注入实际宿主准备失败'); return actualRender.call(this, mesh, camera); };
    const fallback = await host.prepareMobileBossOutput(match);
    r.render = actualRender; check(fallback.fallback && fused.output.enabled && !fused.aa.bossOutput.ready, '真实宿主失败未回原SMAA/Output');
    await host.prepareMobileBossOutput(match); G.mode = 'match'; host.render();
    fused.aa.syncBossOutput(match, 'match'); let disposed = 0; fused.aa._fused.addEventListener('dispose', () => disposed++);
    fused.aa.dispose(); check(disposed === 1 && fused.output.enabled, '销毁未恢复/释放候选程序');
    original.aa.dispose(); for (const x of [original, fused]) { x.output.dispose(); x.source.dispose(); x.c.dispose(); }
    check(errors.length === 0, '真实shader失败'); r.dispose();
    return { rows, offscreenMaxError: offError, checks: '32组真实像素、HDR/透明度、8种色调/2色域/2尺寸、少一遍绘制、预备程序复用、回退逐字节一致、离屏half-float、动态曝光、取消/窗口改变/异常恢复、PC/普通/旧局隔离及释放通过' };
  });
  if (errors.length) throw Error(errors.join('\n')); await writeFile('releases/investigation/mobile-boss-output-browser.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
