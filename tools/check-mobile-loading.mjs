// 独立真实浏览器验证手机准备覆盖层；不构建dist，不把桌面浏览器当真机性能测试。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const source = await readFile(new URL('../src/platform/mobilePreparation.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/mobile.css', import.meta.url), 'utf8');
const moduleURL = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 770, height: 376, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setContent('<!doctype html><html class="iw-mobile"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button id="underlying">底层游戏按钮</button><div id="fade"></div><button id="diagnostic">诊断</button></body></html>');
  await page.addStyleTag({ content: 'html,body{margin:0;height:100%;overflow:hidden}#underlying{position:fixed;inset:0;z-index:32}#fade{position:fixed;inset:0;z-index:50;background:#000;opacity:1}#diagnostic{position:fixed;inset:0 auto auto 0;z-index:100}' + css });
  await page.evaluate(async url => {
    const { createMobilePreparationUI } = await import(url);
    window.createUI = createMobilePreparationUI;
    window.checks = { cancel: 0, retry: 0, keys: 0, clicks: 0, underlying: 0 };
    window.addEventListener('keydown', () => checks.keys++);
    window.addEventListener('mousedown', () => checks.clicks++);
    document.getElementById('underlying').onclick = () => checks.underlying++;
    window.ui = createMobilePreparationUI({
      onCancel() { checks.cancel++; return new Promise((resolve, reject) => { window.finishCancel = resolve; window.failCancel = reject; }); },
      onRetry() { checks.retry++; ui.show({ title: '准备 Boss 战' }); ui.update({ progress: .1, label: '准备场地' }); },
    });
    ui.show({ title: '准备 Boss 战' });
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }, moduleURL);

  const snapshot = () => page.evaluate(() => {
    const root = document.getElementById('mobile-preparation'), track = document.getElementById('mobile-preparation-progress');
    const cancel = document.getElementById('mobile-preparation-cancel'), retry = document.getElementById('mobile-preparation-retry');
    return { hidden: root.hidden, state: root.dataset.state, busy: root.getAttribute('aria-busy'), role: root.getAttribute('role'), modal: root.getAttribute('aria-modal'),
      value: +track.getAttribute('aria-valuenow'), progressRole: track.getAttribute('role'), label: document.getElementById('mobile-preparation-label').textContent,
      detail: document.getElementById('mobile-preparation-detail').textContent, cancelDisabled: cancel.disabled, retryHidden: retry.hidden,
      focused: document.activeElement.id, ...checks };
  });
  let state = await snapshot();
  assert.equal(state.hidden, false); assert.equal(state.value, 0); assert.equal(state.role, 'dialog'); assert.equal(state.modal, 'true'); assert.equal(state.progressRole, 'progressbar');
  await page.evaluate(() => { ui.update({ progress: .375, label: '准备角色 1/8', detail: '正在准备角色外观。' }); ui.update({ progress: .2 }); ui.update({ progress: NaN }); });
  state = await snapshot(); assert.equal(state.value, 37); assert.equal(state.label, '准备角色 1/8');
  await page.evaluate(() => ui.update({ progress: 1 }));
  assert.equal((await snapshot()).value, 99, '全部工作及首帧未确认前不得100%');
  console.log('通过：真实DOM的对话框/进度可访问属性、真实工作进度单调及100%门槛');

  for (const viewport of [{ width: 770, height: 376 }, { width: 568, height: 320 }, { width: 480, height: 280 }, { width: 320, height: 568 }]) {
    await page.setViewport({ ...viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const layout = await page.evaluate(() => {
      const root = document.getElementById('mobile-preparation'), card = root.firstElementChild;
      const button = document.getElementById('mobile-preparation-cancel'), rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        card: { x: card.getBoundingClientRect().x, right: card.getBoundingClientRect().right },
        cancel: { y: rect.y, bottom: rect.bottom, height: rect.height }, hit: hit?.id, z: +getComputedStyle(root).zIndex };
    });
    assert.equal(layout.z, 110); assert.ok(layout.scrollWidth <= layout.width);
    assert.ok(layout.card.x >= 0 && layout.card.right <= layout.width);
    assert.ok(layout.cancel.y >= 0 && layout.cancel.bottom <= layout.height && layout.cancel.height >= 44);
    assert.equal(layout.hit, 'mobile-preparation-cancel', '取消入口必须在黑幕/诊断栏上方真实可点');
  }
  await page.setViewport({ width: 770, height: 376, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.keyboard.press('KeyW'); await page.keyboard.press('Tab');
  assert.equal((await snapshot()).keys, 0); assert.equal((await snapshot()).focused, 'mobile-preparation-cancel');
  await page.tap('#mobile-preparation-cancel');
  state = await snapshot();
  assert.equal(state.cancel, 1); assert.equal(state.state, 'cancelling'); assert.equal(state.hidden, false); assert.equal(state.cancelDisabled, true);
  assert.equal(state.underlying, 0); assert.equal(state.clicks, 0);
  await page.evaluate(() => { ui.update({ progress: .8, label: '迟到的旧阶段' }); finishCancel(); });
  state = await snapshot(); assert.equal(state.state, 'cancelling'); assert.equal(state.hidden, false); assert.equal(state.label, '正在返回菜单…');
  await page.evaluate(() => ui.hide());
  assert.equal((await snapshot()).hidden, true);
  await page.keyboard.press('KeyW'); assert.equal((await snapshot()).keys, 1);
  console.log('通过：小横屏/竖屏布局、覆盖黑幕、无点击/键盘穿透、取消等待期间保持覆盖与忽略迟到进度');

  await page.setViewport({ width: 480, height: 280, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const longError = await page.evaluate(() => {
    ui.show(); ui.fail('准备未完成，请返回菜单后重试。'.repeat(24));
    const root = document.getElementById('mobile-preparation'); root.scrollTop = root.scrollHeight;
    const button = document.getElementById('mobile-preparation-cancel').getBoundingClientRect();
    return { scrollable: root.scrollHeight > root.clientHeight, top: button.top, bottom: button.bottom, height: innerHeight };
  });
  assert.ok(longError.scrollable && longError.top >= 0 && longError.bottom <= longError.height, '长错误文本也须可滚动至返回菜单入口');
  await page.setViewport({ width: 770, height: 376, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await page.evaluate(() => {
    ui.show(); ui.fail('场景准备未完成。');
    const dialog = document.createElement('div'); dialog.id = 'mobile-dialog';
    const resume = document.createElement('button'); resume.id = 'resume-preparation'; resume.textContent = '继续并返回菜单';
    resume.onclick = () => { checks.resume = (checks.resume || 0) + 1; };
    dialog.append(resume); document.body.append(dialog); resume.focus();
  });
  const resumeLayer = await page.evaluate(() => {
    const button = document.getElementById('resume-preparation'), rect = button.getBoundingClientRect();
    return { z: +getComputedStyle(document.getElementById('mobile-dialog')).zIndex,
      hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id };
  });
  assert.equal(resumeLayer.z, 120); assert.equal(resumeLayer.hit, 'resume-preparation');
  const keysBeforeResume = await page.evaluate(() => checks.keys);
  await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => checks.resume), 1);
  assert.equal(await page.evaluate(() => checks.keys), keysBeforeResume, '恢复弹窗操作也不能传入底层游戏');
  await page.tap('#resume-preparation'); assert.equal(await page.evaluate(() => checks.resume), 2);
  await page.evaluate(() => document.getElementById('mobile-dialog').remove());
  console.log('通过：准备错误覆盖层保留时，前台恢复弹窗位于其上且键盘/触屏均可操作');

  await page.evaluate(() => { ui.show({ title: '准备对局' }); ui.update({ progress: .5 }); ui.fail('准备未完成，请重试。'); });
  state = await snapshot(); assert.equal(state.state, 'failed'); assert.equal(state.value, 50); assert.equal(state.retryHidden, false); assert.equal(state.focused, 'mobile-preparation-retry');
  await page.keyboard.press('Tab'); assert.equal((await snapshot()).focused, 'mobile-preparation-cancel');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  assert.equal((await snapshot()).focused, 'mobile-preparation-retry');
  await page.tap('#mobile-preparation-retry');
  state = await snapshot(); assert.equal(state.retry, 1); assert.equal(state.state, 'loading'); assert.equal(state.value, 10);
  await page.keyboard.press('Escape');
  state = await snapshot(); assert.equal(state.cancel, 2); assert.equal(state.state, 'cancelling');
  await page.evaluate(async () => { failCancel(new Error('test')); await Promise.resolve(); await Promise.resolve(); });
  state = await snapshot(); assert.equal(state.state, 'failed'); assert.equal(state.cancelDisabled, false);
  await page.evaluate(() => { ui.show(); ui.complete(); ui.update({ progress: .1 }); });
  state = await snapshot(); assert.equal(state.value, 100); assert.equal(state.busy, 'false'); assert.equal(state.state, 'complete');
  await page.evaluate(() => ui.fail('进入对局时出现问题，请重试。'));
  state = await snapshot(); assert.equal(state.value, 100); assert.equal(state.state, 'failed'); assert.equal(state.label, '进入未完成');
  assert.equal(state.cancelDisabled, false); assert.equal(state.retryHidden, false);
  await page.evaluate(() => ui.show());
  assert.equal((await snapshot()).value, 0, '新的准备尝试须从0重新开始');
  await page.evaluate(() => ui.dispose());
  assert.equal(await page.$('#mobile-preparation'), null);
  const keysBeforeDispose = await page.evaluate(() => checks.keys);
  await page.keyboard.press('KeyW'); assert.equal(await page.evaluate(() => checks.keys), keysBeforeDispose + 1);
  console.log('通过：失败重试/返回入口、焦点循环、Escape取消、回调失败恢复、100%后进入失败不倒退、新尝试归零及销毁移除事件');
} finally { await browser.close(); }
