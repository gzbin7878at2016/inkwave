// 无需公网建房的传输回归：断线、旧消息、心跳假活、发送积压均可确定复现。
import assert from 'node:assert/strict';
globalThis.location = { search: '', hostname: 'localhost' };
globalThis.inkwaveMobile = { native: true };
const { Transport, relayURL, PROD_RELAY } = await import('../src/net/transport.js');
assert.equal(relayURL(), PROD_RELAY);
globalThis.inkwaveMobile.native = false;
assert.equal(relayURL(), 'ws://localhost:8787');
globalThis.location.search = '?relay=wss://test.example/';
assert.equal(relayURL(), 'wss://test.example');
globalThis.location.search = ''; globalThis.inkwaveMobile.native = true;
let clock = 100, ping;
const originals = { performance, WebSocket: globalThis.WebSocket, setInterval, clearInterval };
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
globalThis.setInterval = fn => { ping = fn; return 1; };
globalThis.clearInterval = () => { ping = null; };
class Socket {
  constructor(url) { this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.sent = []; }
  send(value) { this.sent.push(value); }
  close(code = 1000, reason = '') { this.readyState = 3; this.closed = { code, reason }; this.onclose?.({ reason }); }
  receive(data) { this.onmessage?.({ data }); }
}
globalThis.WebSocket = Socket;
try {
  const tr = new Transport(); let messages = 0, closes = 0;
  tr.onMessage = () => messages++; tr.onClose = () => closes++;
  const connect = async () => {
    const pending = tr.connect('TEST00', '测试', true), ws = tr.ws;
    ws.receive(JSON.stringify({ t: 'welcome', id: 'one' })); await pending; return ws;
  };
  const old = await connect();
  assert.ok(old.url.startsWith(PROD_RELAY));
  old.receive('m|two|{}'); assert.equal(messages, 1);
  tr.close(); old.receive('m|two|{}'); assert.equal(messages, 1); assert.equal(closes, 0);
  const current = await connect();
  clock += 200; current.receive('pong'); assert.equal(tr.rtt, 200);
  ping(); clock += 20001; ping(); assert.equal(current.closed.code, 4000); assert.equal(closes, 1);
  tr.close(); clock += 10;
  const congested = await connect(); congested.bufferedAmount = 262145;
  assert.equal(tr.broadcast({ t: 'test' }), false); assert.equal(congested.closed.code, 4001);
  tr.close(); assert.equal(ping, null);
  console.log('通过：原生 WSS/网页本机路由、显式覆盖、迟到消息隔离、正常关闭、心跳超时、队列积压');
} finally {
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: originals.performance });
  globalThis.WebSocket = originals.WebSocket; globalThis.setInterval = originals.setInterval; globalThis.clearInterval = originals.clearInterval;
}
