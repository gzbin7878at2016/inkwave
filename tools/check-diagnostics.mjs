// 诊断链路集成测试：主动制造一次GLSL失败，确认导出文件含编译日志/源码并能跨重启留存。
// 这次故障仅存在测试新建材质中，不改动生产材质或渲染策略。
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const downloadDir = resolve('releases/diagnostic-test-downloads');
await mkdir(downloadDir, { recursive: true });
const before = new Set(await readdir(downloadDir));
const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1000, height: 464, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  await page.goto('http://localhost:8490/dist-mobile/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__inkwave?.mobile && window.inkwaveDiagnostics, { timeout: 120000 });
  const baseline = await page.evaluate(() => inkwaveDiagnostics.report());
  assert.ok(baseline.current.gpu.limits.MAX_FRAGMENT_UNIFORM_VECTORS > 0);
  assert.equal(baseline.current.build.versionCode, 6);
  assert.equal(baseline.current.scene.render.antialias, 'SMAA');
  assert.equal(baseline.current.scene.render.canvas.width, baseline.current.scene.render.target.width);
  assert.ok(baseline.current.scene.level.vertices > 0);
  assert.ok(baseline.current.programs.some(p => p.isPaintSurface && p.linked));
  assert.equal(baseline.current.shaderFailures.length, 0);
  console.log('通过：启动前日志、GPU参数、地面程序状态、构建版本');

  await page.evaluate(async () => {
    const game = __inkwave, material = game.levelMat.clone();
    material.customProgramCacheKey = () => 'intentional-diagnostics-test';
    material.onBeforeCompile = shader => { shader.fragmentShader += '\ndiagnostic_invalid_token_20261021;\n'; };
    const good = game.levelMesh.material;
    try { game.levelMesh.material = material; game.R.render(); }
    finally { game.levelMesh.material = good; material.dispose(); }
    console.warn('diagnostics-console-warning-test');
    await fetch('/dist-mobile/assets/diagnostics-intentional-missing.json');
  });
  const failures = await page.evaluate(() => inkwaveDiagnostics.report().current.shaderFailures);
  assert.ok(failures.length > 0);
  assert.equal(failures[0].link, false);
  assert.ok(failures[0].fragment.log.length > 0);
  assert.ok(failures[0].fragment.source.includes('diagnostic_invalid_token_20261021'));
  console.log('通过：真实着色器失败原始错误与GLSL源码捕获');

  await page.click('#mobile-log-export');
  let file;
  for (let i = 0; i < 100; i++) {
    file = (await readdir(downloadDir)).find(f => !before.has(f) && f.endsWith('.json'));
    if (file) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(file, '导出的日志文件应落盘');
  const exported = JSON.parse(await readFile(resolve(downloadDir, file), 'utf8'));
  assert.equal(exported.format, 'inkwave-android-diagnostics-v1');
  assert.ok(exported.current.shaderFailures.length > 0);
  assert.ok(exported.current.events.some(e => e.category === 'console-warn' && e.detail.includes('diagnostics-console-warning-test')));
  assert.ok(exported.current.events.some(e => e.category === 'fetch-http-error'));
  console.log('通过：日志文件下载、JSON解析、警告与资源HTTP错误');

  // 一次迁移后允许玩家改回省电/30帧；重启不能每次强制覆盖选择。
  await page.evaluate(() => __inkwave._setSettings({ fpsCap: 30, mobileVisual: 'battery', mobileDynamicResolution: true }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__inkwave?.mobile, { timeout: 120000 });
  const restored = await page.evaluate(() => inkwaveDiagnostics.report());
  assert.ok(restored.previous.shaderFailures.length > 0);
  assert.equal(restored.current.shaderFailures.length, 0);
  assert.ok(restored.current.programs.filter(p => p.isPaintSurface).every(p => p.linked));
  assert.equal(restored.current.scene.settings.fpsCap, 30);
  assert.equal(restored.current.scene.settings.mobileVisual, 'battery');
  assert.equal(restored.current.scene.settings.mobileDynamicResolution, true);
  console.log('通过：上一运行错误持久化、重新启动地面正常编译');
} finally { await browser.close(); }
