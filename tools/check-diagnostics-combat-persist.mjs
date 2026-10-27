// 诊断日志落盘时机：实战中普通记录不再每5秒同步序列化写localStorage；警告/错误、脱离战斗、页面隐藏仍落盘。
// 运行前启动 python tools/serve.py 8490；可用 EDGE_PATH 指定浏览器。只加载源码模块，不改产品。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/diagnostics-combat-persist.html', '<!doctype html><meta charset="utf-8"><body></body>');
const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8490/releases/investigation/diagnostics-combat-persist.html');
  const report = await page.evaluate(async () => {
    const check = (ok, why) => { if (!ok) throw Error(why); };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    localStorage.removeItem('inkwave.diagnostics.last');
    let writes = 0, profileCalls = 0, offset = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'inkwave.diagnostics.last') writes++; return setItem.call(this, key, value); };
    const clock = performance.now.bind(performance); performance.now = () => clock() + offset;
    const match = { state: 'playing', attract: false, paused: false };
    globalThis.__G = { mode: 'menu', paint: null };
    globalThis.__inkwave = { match, settings: {}, R: { q: { pixelRatio: 2 }, renderer: { getPixelRatio: () => 2, domElement: { width: 1, height: 1 }, info: { memory: {} } } },
      mobile: { profile: { snapshot: () => { profileCalls++; return { samples: 1 }; } } } };
    const { installDiagnostics } = await import('/src/platform/diagnostics.js');
    const d = installDiagnostics({}); await wait(1700);
    const tickAt = ms => { offset += ms; d.tick(); };
    // 菜单：原5秒节拍照常写入，且场景快照事件不含排行。
    let before = writes; tickAt(5001);
    check(writes === before + 1, '菜单tick未落盘');
    const scene = d.report().current.events.findLast(e => e.category === 'scene-snapshot');
    check(scene && !JSON.parse(scene.detail).profile, '场景快照事件不应含排行');
    // 实战：4个5秒节拍与普通记录都只留内存，等待原1.5秒定时也不写。
    __G.mode = 'match'; before = writes; profileCalls = 0;
    for (let i = 0; i < 4; i++) tickAt(5001);
    d.record('combat-info', { n: 1 }); await wait(1700);
    check(writes === before, '实战普通记录仍同步落盘');
    check(profileCalls === 0, '实战tick仍为事件排序排行');
    check(d.report().current.events.filter(e => e.category === 'scene-snapshot').length >= 2, '实战快照未留在内存');
    // 实战警告仍按1.5秒落盘，供强退取证。
    before = writes; d.record('combat-warning', '测试', 'warn'); await wait(1700);
    check(writes === before + 1, '实战警告未落盘');
    // 暂停（脱离战斗）首帧补存一次，不等下一个5秒节拍，也不重复写。
    d.record('combat-info', { n: 2 }); before = writes; match.paused = true; tickAt(16);
    check(writes === before + 1, '暂停首帧未补存或重复写');
    tickAt(16); check(writes === before + 1, '暂停后重复写');
    // 恢复战斗后页面隐藏/离开仍立即写。
    match.paused = false; tickAt(16); d.record('combat-info', { n: 3 });
    before = writes; dispatchEvent(new Event('pagehide')); check(writes === before + 1, '页面隐藏未立即写');
    const saved = JSON.parse(localStorage.getItem('inkwave.diagnostics.last'));
    check(saved.events.some(e => e.category === 'combat-info' && e.detail.includes('3')), '补存内容缺少实战记录');
    // 结束：对局离开playing后的首帧补存。
    d.record('combat-info', { n: 4 }); before = writes; match.state = 'finish'; tickAt(16);
    check(writes === before + 1, '对局结束未补存');
    Storage.prototype.setItem = setItem; performance.now = clock;
    return { writes, scope: '菜单5秒落盘；实战普通记录/快照只留内存且不排序排行；警告1.5秒落盘；暂停/结束首帧补存一次；页面隐藏立即写' };
  });
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
