// 手机专用GPU回归：模拟报告的资源上限，核算真实链接程序资源，强制编译失败验证降级。
// 上限模拟不等于真实Maleoon驱动；最终仍须手机复测。
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const report = { runs: [], pc: null };
await mkdir('releases/investigation', { recursive: true });
try {
  for (const limit of [256, 224]) {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setViewport({ width: 1000, height: 464, hasTouch: true, isMobile: true });
    await page.evaluateOnNewDocument(cap => {
      const original = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (name) {
        if (name === this.MAX_FRAGMENT_UNIFORM_VECTORS) return cap;
        if (name === this.MAX_FRAGMENT_UNIFORM_COMPONENTS) return cap * 4;
        return original.call(this, name);
      };
    }, limit);
    await page.goto('http://localhost:8490/dist-mobile/?map=tidewater');
    await page.waitForFunction(() => window.__inkwave?.mobile, { timeout: 120000 });
    const inspect = () => page.evaluate(() => {
      const game = __inkwave, gl = game.R.renderer.getContext();
      const programs = game.R.renderer.info.programs.filter(p => p.name.startsWith('inkwave-mobile-')).map(p => {
        // 连顶点阶段也一起计数，是对片元需求的保守上界；数组逐元素计算，不只数变量名。
        const sizes = { [gl.FLOAT]: 1, [gl.INT]: 1, [gl.BOOL]: 1, [gl.FLOAT_VEC2]: 1, [gl.FLOAT_VEC3]: 1, [gl.FLOAT_VEC4]: 1, [gl.FLOAT_MAT3]: 3, [gl.FLOAT_MAT4]: 4 };
        const linked = gl.getProgramParameter(p.program, gl.LINK_STATUS);
        const uniforms = linked ? Array.from({ length: gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS) }, (_, i) => gl.getActiveUniform(p.program, i)) : [];
        return { name: p.name, linked, vectors: uniforms.reduce((n, u) => n + (sizes[u.type] || 1) * u.size, 0), maxArray: Math.max(0, ...uniforms.map(u => u.size)) };
      });
      return { programs, tier: game.levelMat.userData.mobileTier, state: game.R.mobileSafety.state, stopped: !!game.mobileSuspended, failures: inkwaveDiagnostics.report().current.shaderFailures.length };
    });
    const checkVisibleInk = () => page.evaluate(() => {
      const g = __inkwave, r = g.R.renderer, m = g.levelMat, U = m.userData.uniforms;
      g.debug.freeze();
      const Texture = U.uSurfaceTable?.value.constructor || window.__gpuTestTexture;
      window.__gpuTestTexture = Texture;
      const texture = new Texture(new Uint8Array([0, 0, 0, 0]), 1, 1); texture.needsUpdate = true;
      const geometry = new g.levelMesh.geometry.constructor();
      const Attribute = g.levelMesh.geometry.attributes.position.constructor;
      const attribute = (name, values, size) => geometry.setAttribute(name, new Attribute(new Float32Array(values), size));
      attribute('position', [-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], 3);
      attribute('normal', [0,0,1, 0,0,1, 0,0,1, 0,0,1], 3);
      attribute('color', Array(12).fill(1), 3);
      attribute('paintUv', Array(8).fill(0.5), 2);
      attribute('faceUv', [0,0, 1,0, 1,1, 0,1], 2);
      attribute('faceData', [0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1], 4);
      attribute('faceFlags', [0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1], 3); geometry.setIndex([0,1,2,0,2,3]);
      const scene = new __G.scene.constructor(); scene.add(new g.levelMesh.constructor(geometry,m));
      const camera = __G.camera.clone(); camera.position.set(0,0,2); camera.lookAt(0,0,0);
      const target = new __G.paint.rt.constructor(16,16);
      const previous = r.getRenderTarget(), oldPaint = U.uPaint.value, oldTeam = U.uTeamA.value.clone(), oldGlow = U.uInkGlow.value;
      const read = () => { r.render(scene,camera); const p = new Uint8Array(4); r.readRenderTargetPixels(target,8,8,1,1,p); return Array.from(p); };
      try {
        U.uPaint.value=texture; U.uTeamA.value.setRGB(1,0,0); U.uInkGlow.value=1;
        r.setRenderTarget(target); const empty=read();
        texture.image.data.set([0,255,128,255]); texture.needsUpdate=true; const ink=read();
        return {empty,ink};
      } finally {
        U.uPaint.value=oldPaint; U.uTeamA.value.copy(oldTeam); U.uInkGlow.value=oldGlow;
        r.setRenderTarget(previous); texture.dispose(); geometry.dispose(); target.dispose(); g.debug.unfreeze();
      }
    });
    const normal = await inspect();
    assert.equal(normal.tier, 'textured'); assert.equal(normal.failures, 0);
    assert.ok(normal.programs.length >= 2 && normal.programs.every(p => p.linked && p.vectors <= 128 && p.maxArray < 24));
    await page.evaluate(() => __inkwave.startPractice({ mapId: __inkwave.mapDef.id }));
    await page.waitForFunction(() => __inkwave.input.touch.enabled, { timeout: 120000 });
    await page.evaluate(() => { __inkwave.debug.paintRandom(40); });
    await page.waitForFunction(() => __G.paint.growing.length === 0, { timeout: 30000 });
    const paint = await page.evaluate(() => inkwaveDiagnostics.report({ probe: true }).current.paintProbe);
    assert.ok(paint.available && paint.pixels.some(p => p.rgba[3] > 0));
    const visibleInk = await checkVisibleInk();
    assert.ok(visibleInk.ink[0] > 100 && visibleInk.ink[0] > visibleInk.ink[1] * 2 && visibleInk.ink[0] > visibleInk.ink[2] * 2, '地面着色器必须实际显示红队墨迹');
    await page.screenshot({ path: `releases/investigation/mobile-gpu-${limit}.png` });
    console.log(`通过：${limit}组上限、手机材质资源预算、地面/格栅链接和墨图集写入`);
    // 故障仅存在测试材质实例：实际shader编译错误必须驱动生产的恢复流程。
    await page.evaluate(() => {
      const g = __inkwave, old = g.levelMat, compile = old.onBeforeCompile;
      old.onBeforeCompile = shader => { compile(shader); shader.fragmentShader += '\nintentional_mobile_fallback_failure;'; };
      old.customProgramCacheKey = () => 'intentional-mobile-fallback-test'; old.needsUpdate = true;
    });
    await page.waitForFunction(() => __inkwave.levelMat.userData.mobileTier === 'basic', { timeout: 30000 });
    const fallback = await inspect();
    assert.equal(fallback.state.fallbackCount, 1); assert.equal(fallback.stopped, false);
    assert.ok(fallback.programs.some(p => p.name.includes('basic') && p.linked && p.vectors <= 64));
    assert.equal(await page.evaluate(() => __inkwave.levelMat.userData.uniforms.uPaint.value === __G.paint.texture), true);
    const fallbackInk = await checkVisibleInk();
    assert.ok(fallbackInk.ink[0] > 100 && fallbackInk.ink[0] > fallbackInk.ink[1] * 2, '基础材质同样必须显示墨迹颜色');
    await page.screenshot({ path: `releases/investigation/mobile-gpu-${limit}-fallback.png` });
    console.log('通过：真实编译失败后自动切换保留墨迹的基础材质');
    if (limit === 224) {
      await page.evaluate(() => {
        const m = __inkwave.levelMat, compile = m.onBeforeCompile;
        m.onBeforeCompile = shader => { compile(shader); shader.fragmentShader += '\nintentional_mobile_safe_stop;'; };
        m.customProgramCacheKey = () => 'intentional-mobile-fatal-test'; m.needsUpdate = true;
      });
      await page.waitForFunction(() => __inkwave.mobileSuspended && document.getElementById('mobile-gpu-error'), { timeout: 30000 });
      assert.ok(await page.$('#mobile-log-export'));
      console.log('通过：基础材质也失败时安全暂停，日志出口仍可用');
    }
    report.runs.push({ limit, normal, fallback, paint, visibleInk, fallbackInk });
    await writeFile('releases/investigation/mobile-gpu-check.json', JSON.stringify(report, null, 2));
    await page.close();
  }

  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1000, height: 464 });
  // /dist-mobile与根网页在测试服务器共用origin；PC基线必须清除手机保存的设置。
  await desktop.evaluateOnNewDocument(() => localStorage.removeItem('inkwave.settings'));
  await desktop.goto('http://localhost:8490/?shadercheck&map=tidewater');
  await desktop.waitForFunction(() => window.__inkwave, { timeout: 120000 });
  const pc = await desktop.evaluate(() => {
    const g = __inkwave, gl = g.R.renderer.getContext();
    return { mobileSafety: !!g.R.mobileSafety, type: g.levelMat.type, quality: g.settings.quality, shaders: g.R.renderer.info.programs.map(p => (gl.getAttachedShaders(p.program) || []).map(s => gl.getShaderSource(s))).filter(code => code.some(c => c.includes('uniform sampler2D uPaint'))) };
  });
  assert.equal(pc.mobileSafety, false); assert.equal(pc.type, 'MeshPhysicalMaterial'); assert.equal(pc.quality, 'high');
  const hash = code => createHash('sha256').update(code).digest('hex');
  const after = new Set(pc.shaders.map(code => code.map(hash).join(':')));
  // 基线需在同一浏览器/GPU采集；全新检出没有本地基线时只核验PC入口，不能虚报逐字节对比通过。
  let baseline = null;
  try { baseline = JSON.parse(await readFile(process.env.PC_SHADER_BASELINE || 'releases/investigation/pc-before-compat.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (baseline) for (const p of baseline.levelShader) assert.ok(after.has(p.hash.join(':')), 'PC原有顶点/片元GLSL必须逐字节不变');
  report.pc = { glslCompared: !!baseline, shaderPairs: after.size, hashes: [...after] };
  console.log(baseline ? '通过：PC保持高画质、物理材质和原有GLSL逐字节一致' : '通过：PC保持高画质与物理材质；无本地基线，未执行GLSL逐字节对比');
  await writeFile('releases/investigation/mobile-gpu-check.json', JSON.stringify(report, null, 2));
} finally { await browser.close(); }
