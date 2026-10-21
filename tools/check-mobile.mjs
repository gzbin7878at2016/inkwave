// 浏览器集成回归：真正加载移动产物并通过 Pointer Events 驱动控制器。
// 运行前启动 python tools/serve.py 8490；可用 MOBILE_TEST_URL / EDGE_PATH 覆盖。
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await puppeteer.launch({
  executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const errors = [], failed = [];
const results = [];
const passed = text => { results.push(text); console.log(`通过：${text}`); };
try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false); // 本地重复构建时避免入口与散列块混用旧 HTTP 缓存。
  // APK 资源来自本地：用浏览器拦截所有外站请求，验证单机不依赖外部 CDN。
  await page.setRequestInterception(true);
  page.on('request', r => {
    const url = new URL(r.url());
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) r.abort();
    else r.continue();
  });
  await page.setViewport({ width: 900, height: 420, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => { errors.push(e.message); console.error('页面异常：', e.message); });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400 && r.url().includes('localhost')) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(process.env.MOBILE_TEST_URL || 'http://localhost:8490/dist-mobile/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__inkwave?.mobile, { timeout: 120000 });
  assert.equal(await page.evaluate(() => __inkwave.settings.quality), 'low');
  const graphics = await page.evaluate(() => inkwaveDiagnostics.report().current);
  assert.equal(graphics.shaderFailures.length, 0, '不能把着色器失败当成页面正常启动');
  assert.ok(graphics.programs.some(p => p.isPaintSurface && p.linked), '可涂墨地面程序必须链接成功');
  passed('禁止外站请求后移动产物启动、低画质首启');
  await page.evaluate(() => __inkwave.startPractice({ mapId: __inkwave.mapDef.id }));
  await page.waitForFunction(() => __inkwave.input.touch.enabled, { timeout: 120000 });
  // 冻结后可精确检查采集状态，避免事件恰好落在两帧之间；仍使用真实 DOM 分发路径。
  const input = await page.evaluate(() => {
    const g = __inkwave, t = g.input.touch; g.debug.freeze();
    const send = (role, type, id, x, y) => t.root.querySelector(`[data-touch="${role}"]`).dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    // 合成 PointerEvent 不会建立浏览器 capture，测试替身只代替 capture，事件处理仍走生产代码。
    for (const el of t.root.querySelectorAll('[data-touch]')) { el.setPointerCapture = () => {}; el.hasPointerCapture = () => false; }
    send('move', 'pointerdown', 1, 90, 300); send('move', 'pointermove', 1, 130, 260);
    send('look', 'pointerdown', 2, 500, 180); send('look', 'pointermove', 2, 530, 170);
    send('fire', 'pointerdown', 3, 840, 270); send('jump', 'pointerdown', 4, 780, 270);
    const before = { x: t.move.x, y: t.move.y, look: t.look.x, fire: t.action('fire'), jump: g.input.down('Space'), count: t.pointers.size };
    const yaw = g.rig.yaw; g.match.controller.update(1 / 30);
    before.turn = g.rig.yaw - yaw; before.intentFire = g.match.local.intent.fire; before.intentMove = g.match.local.intent.move.length();
    send('fire', 'pointerup', 3, 840, 270); t.endFrame(); before.released = !t.action('fire');
    send('jump', 'pointercancel', 4, 780, 270); before.cancelled = !g.input.down('Space');
    send('map', 'pointerdown', 5, 800, 80); send('map', 'pointerup', 5, 800, 80); before.map = g.input.down('Tab');
    t.clear(); g.debug.unfreeze(); return before;
  });
  assert.equal(input.count, 4); assert.ok(input.x > 0 && input.y < 0 && input.look > 0);
  assert.ok(input.fire && input.jump && input.released && input.cancelled && input.map);
  assert.ok(input.turn < 0 && input.intentFire && input.intentMove > 0);
  passed('四指独立采集、移动转视开火进入角色意图、释放/取消/地图');
  // 再用浏览器原生触屏协议验证 capture、抬手释放，避免只测合成事件。
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__inkwave?.mobile, { timeout: 120000 });
  await page.evaluate(() => __inkwave.startPractice({ mapId: __inkwave.mapDef.id }));
  await page.waitForFunction(() => __inkwave.input.touch.enabled, { timeout: 120000 });
  const cdp = await page.createCDPSession();
  const box = await page.$eval('[data-touch="fire"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...box, id: 1 }] });
  assert.equal(await page.evaluate(() => __inkwave.input.touch.held.has('fire')), true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => !__inkwave.input.touch.action('fire'));
  passed('浏览器原生触屏按下/捕获/释放');
  const suspended = await page.evaluate(() => {
    const g = __inkwave;
    g.match.local.weaponRunner.charging = true; g.match.local.weaponRunner.aimingSub = true; g.match.local._prevIntent.sub = true;
    g.mobile.suspend();
    const cancelled = !g.match.local.weaponRunner.charging && !g.match.local.weaponRunner.aimingSub && !g.match.local._prevIntent.sub;
    const stopped = g.mobileSuspended && g.input.touch.pointers.size === 0 && g.match.paused && cancelled;
    g.mobile.foreground(); const prompt = !document.getElementById('mobile-dialog').hidden;
    return { stopped, prompt };
  });
  assert.ok(suspended.stopped && suspended.prompt);
  await page.click('#mobile-dialog button');
  await page.waitForFunction(() => !__inkwave.mobileSuspended && __inkwave.input.touch.enabled);
  passed('后台暂停与清空输入、前台点击恢复');
  await page.click('[data-mobile="tune"]');
  await page.$eval('#mobile-dialog input[type="checkbox"]', e => { e.checked = true; e.dispatchEvent(new Event('change')); });
  assert.equal(await page.$eval('#mobile-controls', e => e.classList.contains('mobile-left')), true);
  await page.click('#mobile-dialog button');
  passed('左手布局切换与保存返回');
  const zonesJudge = await page.evaluate(async () => {
    // 带罚分的区域结算曾将队伍索引命名 t，遮蔽翻译函数；真实演出必须能兑现 Promise。
    const r = await __inkwave.hud.judge({ mode: 'zones', counts: [20, 35], penalty: [5, 0], winner: 0 });
    return r.winner;
  });
  assert.equal(zonesJudge, 0); passed('带罚分区域结算演出完成');
  // 真正执行一场短对局，检查时间结束后的状态推进；这不是手机性能测试。
  await page.evaluate(() => __inkwave.startMatch({ duration: 5 }));
  await page.waitForFunction(() => __inkwave.match.state === 'results', { timeout: 120000 });
  passed('短对局从开场推进至结算');
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  await mkdir('releases', { recursive: true });
  await page.screenshot({ path: 'releases/mobile-browser-results.png' });
  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1280, height: 720 });
  await desktop.evaluateOnNewDocument(() => localStorage.removeItem('inkwave.settings'));
  desktop.on('pageerror', e => errors.push(e.message));
  await desktop.goto('http://localhost:8490/', { waitUntil: 'domcontentloaded' });
  await desktop.waitForFunction(() => window.__inkwave, { timeout: 120000 });
  assert.deepEqual(await desktop.evaluate(() => ({ touch: !!__inkwave.input.touch, quality: __inkwave.settings.quality })), { touch: false, quality: 'high' });
  passed('桌面源网页启动、保持键鼠与原默认画质');
  assert.deepEqual(errors, []);
  await writeFile('releases/mobile-check.json', JSON.stringify({ at: new Date().toISOString(), results, errors, failed, input, note: 'Edge 软件渲染自动回归，不能代表 Android 真机性能。' }, null, 2));
  console.log(JSON.stringify({ results, errors, failed }, null, 2));
} finally { await browser.close(); }
