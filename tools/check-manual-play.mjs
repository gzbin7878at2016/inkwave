// 仅启动与设置迁移验证：不注入自动玩家、不跑性能局。检查用句柄只存在测试浏览器内，不进入APK。
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--enable-unsafe-swiftshader'], defaultViewport: { width: 900, height: 420, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem('manual-test-seeded')) {
      localStorage.setItem('manual-test-seeded', '1');
      localStorage.setItem('inkwave.settings', JSON.stringify({ fpsCap: 30, mobilePacingVersion: 1, mobileDefaultsVersion: 1, mobileVisual: 'hd', touchSensitivity: 1.7 }));
    }
  });
  const base = process.env.MANUAL_TEST_URL || 'http://localhost:8490/dist-mobile/';
  await page.goto(base + '?skipTitle&autostart=1&autopilot&netmock=1&netlag=999', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { window.manualCheckGame = await (await import('./src/main.js')).bootReady; });
  await page.waitForSelector('[data-mobile="tune"]', { timeout: 120000 });
  const result = await page.evaluate(() => {
    const g = window.manualCheckGame;
    return { boot: !!g, screen: g.menus.current, fpsCap: g.settings.fpsCap, visual: g.settings.mobileVisual,
      dynamic: g.settings.mobileDynamicResolution, sensitivity: g.settings.touchSensitivity,
      pixelRatio: g.R.renderer.getPixelRatio(), profiler: g.mobile.profile, debug: typeof g.debug,
      globals: [typeof window.__G, typeof window.__inkwave, typeof window.inkwaveDiagnostics],
      diagnosticButtons: document.querySelectorAll('[data-mobile="stats"],[data-mobile="export"],#mobile-log-export,#mobile-log-upload').length,
      error: document.querySelector('#boot-error')?.textContent || '',
      screenTest: typeof g.screenfx?.test, bossDemo: typeof g.hud?.boss?.demo };
  });
  assert.equal(result.boot, true); assert.equal(result.screen, 'title');
  assert.equal(result.fpsCap, 60); assert.equal(result.visual, 'hd'); assert.equal(result.dynamic, false);
  assert.equal(result.sensitivity, 1.7); assert.equal(result.pixelRatio, 2);
  assert.equal(result.profiler, null); assert.equal(result.debug, 'undefined');
  assert.deepEqual(result.globals, ['undefined','undefined','undefined']);
  assert.equal(result.diagnosticButtons, 0); assert.equal(result.error, '');
  assert.equal(result.screenTest, 'undefined'); assert.equal(result.bossDemo, 'undefined');
  await page.click('[data-mobile="tune"]');
  assert.equal(await page.$eval('#mobile-dialog select', el => el.value), '60');
  await page.select('#mobile-dialog select', '30');
  await page.reload({waitUntil:'domcontentloaded'});
  const persisted = await page.evaluate(async () => (await (await import('./src/main.js')).bootReady).settings.fpsCap);
  assert.equal(persisted, 30); assert.deepEqual(errors, []);
  await mkdir('releases/investigation', { recursive: true });
  await page.screenshot({path:'releases/investigation/manual57-start.png'});
  await writeFile('releases/investigation/manual57-browser.json', JSON.stringify({result,persisted,errors},null,2));
  console.log('通过：手动包标题启动、测试URL无效、无诊断采样/按钮/调试对象、60帧高清迁移、触控偏好及后续30帧选择保留');
} finally { await browser.close(); }
