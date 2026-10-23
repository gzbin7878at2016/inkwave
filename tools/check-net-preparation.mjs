// 不连接公网的开局握手回归：假时钟与延迟建场景，验证手机分批预热不会被12秒兜底提前放行。
import assert from 'node:assert/strict';
import { G } from '../src/core/ctx.js';
import { NetSession } from '../src/net/session.js';

const original = { setTimeout, clearTimeout, mobile: globalThis.inkwaveMobile, game: G.game, netm: G.netm };
const timers = new Map(); let time = 0, timerId = 0;
globalThis.setTimeout = (action, delay = 0) => { const id = ++timerId; timers.set(id, { action, at: time + delay }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
const advance = ms => {
  const target = time + ms;
  for (;;) {
    const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]); time = due[1].at; due[1].action();
  }
  time = target;
};
const flush = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sessions = new Set();
const builtMatches = new Set();

function room({ mobile = true, gateHost = false, gateClient = true } = {}) {
  globalThis.inkwaveMobile = false; // 房主为PC；手机能力必须通过实际me/lobby/start链路传递。
  const peers = new Map(), sent = [], gates = new Map(), launches = [], builds = [];
  G.game = {
    menus: { launchLobby() {} },
    async startNetMatch(cfg, match) {
      builtMatches.add(match);
      const key = `${cfg.id}:${match.s.myId}`; builds.push(key);
      const gate = gates.get(match.s.myId), result = gate ? await gate.promise : true;
      // 本替身不替真实Game做会话身份检查：这里只验证session不会因迟到结果ready/launch。
      // 真实Game在各await边界、bind前取消的保证由check-mobile-preparation.mjs直接执行主控方法验证。
      if (result !== false) match.bind({ actors: [], state: 'init', time: 0 });
      return result;
    },
    netMatchGo() { launches.push(time); },
    netMatchAborted() {},
  };
  for (const id of ['host', 'client']) {
    const session = new NetSession(); sessions.add(session); peers.set(id, session);
    session.myId = id; session.hostId = 'host'; session.state = 'lobby';
    session._members = new Map([['host', '主机'], ['client', '手机']]);
    session.lobby.bots = false;
    session.lobby.players = [
      session._newPlayer('host', '主机', { weapon: 'shooter' }),
      session._newPlayer('client', '手机', { weapon: 'shooter' }),
    ];
    session.lobby.players[0].team = 0; session.lobby.players[1].team = 1;
    session.tr = {
      broadcast(data) { sent.push({ from: id, data }); for (const [otherId, peer] of peers) if (otherId !== id) peer._message(id, structuredClone(data)); },
      sendTo(otherId, data) { sent.push({ from: id, data }); peers.get(otherId)?._message(id, structuredClone(data)); },
      lock() {}, close() {},
    };
  }
  const host = peers.get('host'), client = peers.get('client');
  // 使用既有身份消息接收路径，验证PC房主能知道远端手机要等待实际ready。
  host._message('client', { k: 'me', waitForReady: mobile });
  assert.equal(host._wireLobby().players[1].waitForReady, mobile);
  assert.equal(client.lobby.players[1].waitForReady, mobile);
  if (gateHost) gates.set('host', deferred());
  if (gateClient) gates.set('client', deferred());
  return { host, client, gates, sent, launches, builds, start() { assert.equal(host.start(), true); }, close() { host.leave(); client.leave(); } };
}

try {
  globalThis.inkwaveMobile = { native: true };
  assert.equal(new NetSession()._profile().waitForReady, true);

  const normal = room({ gateClient: false }); normal.start(); await flush();
  assert.equal(normal.host.state, 'match'); assert.equal(normal.client.state, 'match');
  assert.equal(normal.launches.length, 2); assert.equal(normal.sent.filter(message => message.data.k === 'go').length, 1);
  assert.ok(normal.host.match.match && normal.client.match.match, '双方都必须先bind再开局'); normal.close();
  console.log('通过：PC房主识别手机能力，正常ready齐员后双方各启动一次');

  const slow = room(); slow.start(); await flush();
  assert.equal(slow.host._startCfg.waitForReady, true); assert.equal(slow.host._startPreparation.ready, true);
  advance(45000); await flush();
  assert.equal(slow.host.state, 'starting'); assert.equal(slow.client.state, 'starting'); assert.equal(slow.launches.length, 0);
  slow.host._go(); assert.equal(slow.launches.length, 0, '直接调用也不能绕过手机ready');
  slow.gates.get('client').resolve(true); await flush();
  assert.equal(slow.host.state, 'match'); assert.equal(slow.client.state, 'match'); assert.equal(slow.launches.length, 2); slow.close();
  console.log('通过：手机准备超过45秒，快端仍等待；慢端bind/ready后同时放行');

  const slowHost = room({ gateHost: true, gateClient: false }); slowHost.start(); await flush();
  advance(45000); assert.equal(slowHost.host.state, 'starting'); assert.equal(slowHost.client.state, 'starting');
  slowHost.gates.get('host').resolve(true); await flush();
  assert.equal(slowHost.host.state, 'match'); assert.equal(slowHost.client.state, 'match'); slowHost.close();
  console.log('通过：房主自身慢预热时也等待真实ready');

  const early = room(); early.start(); await flush();
  const cfgId = early.client._startCfg.id;
  early.client._message('host', { k: 'go', id: '上一局' });
  early.client._message('陌生人', { k: 'go', id: cfgId });
  assert.equal(early.client._startPreparation.pendingGo, false);
  early.client._message('host', { k: 'go', id: cfgId });
  assert.equal(early.client.state, 'starting'); assert.equal(early.client._startPreparation.pendingGo, true);
  assert.equal(early.launches.length, 0);
  early.gates.get('client').resolve(true); await flush();
  assert.equal(early.client.state, 'match'); assert.ok(early.client.match.match); assert.equal(early.launches.length, 2); early.close();
  console.log('通过：提前go等本机bind；错误房主/上一局go被丢弃，重复go不重复启动');

  const pc = room({ mobile: false }); pc.start(); await flush();
  assert.equal(pc.host._startCfg.waitForReady, undefined); assert.ok(pc.host._goT);
  advance(12001); assert.equal(pc.host.state, 'match'); assert.equal(pc.client.state, 'match');
  pc.gates.get('client').resolve(true); await flush(); pc.close();
  console.log('通过：纯PC房间保留原12秒兜底策略');

  const departure = room(); departure.start(); await flush();
  departure.host._control({ t: 'leave', id: 'client', host: 'host' });
  assert.equal(departure.host.state, 'match', '等待中的成员离开应重新核对ready');
  departure.client.leave(); departure.gates.get('client').resolve(true); await flush(); departure.close();
  console.log('通过：慢端离开后房主重新评估等待名单');

  const migration = room({ gateHost: true, gateClient: false }); migration.start(); await flush();
  migration.host.leave(); migration.client._control({ t: 'leave', id: 'host', host: 'client' });
  assert.equal(migration.client.isHost, true); assert.equal(migration.client.state, 'match');
  assert.equal(migration.launches.length, 1);
  migration.gates.get('host').resolve(true); await flush(); assert.equal(migration.launches.length, 1); migration.close();
  console.log('通过：准备期房主离开，已ready的新房主补报并重新核对成员');

  const replaced = room({ gateHost: true }); replaced.start(); await flush();
  const oldGate = replaced.gates.get('client'), oldCfg = replaced.client._startCfg;
  replaced.client.endMatch();
  const newGate = deferred(); replaced.gates.set('client', newGate);
  const newCfg = { ...oldCfg, id: 'replacement' };
  const newStart = replaced.client._begin(newCfg); await flush();
  replaced.client._message('host', { k: 'go', id: oldCfg.id });
  assert.equal(replaced.client._startPreparation.pendingGo, false);
  oldGate.resolve(true); await flush();
  assert.equal(replaced.client._startCfg, newCfg); assert.equal(replaced.client._startPreparation.ready, false);
  assert.equal(replaced.sent.filter(message => message.from === 'client' && message.data.k === 'ready').length, 0);
  replaced.client._message('host', { k: 'go', id: newCfg.id }); newGate.resolve(true); await newStart;
  assert.equal(replaced.client.state, 'match'); assert.equal(replaced.launches.length, 1);
  replaced.host.leave(); replaced.gates.get('host').resolve(true); await flush(); replaced.close();
  console.log('通过：换局后的旧go及迟到Promise不更新会话就绪/启动状态');

  for (const method of ['leave', '_closed', '_fail', 'endMatch']) {
    const cancelled = room({ gateHost: true }); cancelled.start(); await flush();
    const count = cancelled.sent.filter(message => message.from === 'client' && message.data.k === 'ready').length;
    const disposed = cancelled.client.match; cancelled.client._message('host', { k: 'go', id: cancelled.client._startCfg.id });
    if (method === '_closed') cancelled.client._closed('lost');
    else if (method === '_fail') cancelled.client._fail(new Error('测试取消'));
    else cancelled.client[method]();
    assert.equal(cancelled.client.match, null); assert.equal(disposed.unsubs.length, 0);
    assert.equal(cancelled.client._startPreparation, null); assert.equal(cancelled.client._goT, null);
    cancelled.gates.get('client').resolve(true); await flush();
    assert.equal(cancelled.sent.filter(message => message.from === 'client' && message.data.k === 'ready').length, count);
    assert.equal(cancelled.launches.length, 0, `${method}后不得因旧预热完成而开局`);
    cancelled.host.leave(); cancelled.gates.get('host').resolve(true); await flush(); cancelled.close();
  }
  console.log('通过：离房/断线/错误/回大厅清理准备状态，迟到Promise不ready、不触发会话启动');

  const refused = room({ gateHost: true }); refused.start(); await flush();
  const consoleError = console.error; console.error = () => {};
  try { refused.gates.get('client').resolve(false); await flush(); } finally { console.error = consoleError; }
  assert.equal(refused.client.state, 'error'); assert.equal(refused.client.match, null);
  assert.equal(refused.sent.filter(message => message.from === 'client' && message.data.k === 'ready').length, 0);
  assert.equal(refused.launches.length, 0);
  refused.host.leave(); refused.gates.get('host').resolve(true); await flush(); refused.close();
  console.log('通过：游戏准备入口返回false时不报告就绪、不启动');

  const cleanup = room({ mobile: false }); cleanup.start(); await flush(); assert.ok(cleanup.host._goT);
  cleanup.host.leave(); assert.equal(cleanup.host._goT, null);
  advance(15000); assert.equal(cleanup.host.state, 'offline');
  cleanup.client.leave(); cleanup.gates.get('client').resolve(true); await flush(); cleanup.close();
  assert.equal(timers.size, 0);
  console.log('通过：旧PC开局定时器在离房后取消');
} finally {
  for (const session of sessions) session.leave();
  for (const match of builtMatches) match.dispose();
  globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout;
  globalThis.inkwaveMobile = original.mobile; G.game = original.game; G.netm = original.netm;
}
