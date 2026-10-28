// ============================================================ 中文导读 ============================================================
// 【本文件是什么】客户端到中继服务器(server/src/index.js)的 WebSocket 传输层。对 NetSession 而言它就是
//   一条「已连接的字节流」:收发原始字符串、报告连接关闭、维护平滑 RTT。它不理解任何游戏语义。
// 【帧格式】游戏负载以原始 JSON 字符串传输,外面包一层中继不解析的信封:
//   发出广播 "b|<json>";定向 "s|<目标id>|<json>";收到他人消息 "m|<来源id>|<json>"。
//   控制帧则是纯 JSON 对象(welcome / join / leave / err / pong),只有本层解析。
// 【连接流程】connect() 拼出 wss://中继/room/房号?name=…&v=协议版本[&create=1],8 秒超时;
//   收到 welcome 帧即算成功并解析出 自己的 id / 房主 id / 成员名单,之后每 2 秒发一次 ping
//   (中继运行时会把它当作存活信号;顺带回填平滑 RTT,公式 rtt += (样本 - rtt) * 0.3)。
// 【中继选址】relayURL():?relay= 参数优先;页面来自本机或局域网主机名时连本机 wrangler dev 的 :8787;
//   公网部署则连线上 Worker。PROTO 是协议版本,中继据此拒绝过旧的客户端(STALE)。
// 【调试旋钮】URL 加 ?netlag=ms(所有入站额外单向延迟)、&netjitter=ms(保序的随机额外延迟,
//   像 TCP 一样迟到包堆积)、&netspike=p(每条消息按概率模拟 250ms 的 Wi-Fi 卡顿并阻塞后续包)。
//   仅本地调试用,用来在真机上验证 netmatch.js 的插值/回放在恶劣网络下的表现。
// 【错误处理】连接阶段的一切失败(new WebSocket 抛错 / 超时 / err 帧 / 提前 close)都 reject 一个
//   带 code 的 Error(errors.js);连接成功后 close 则回调 onClose(reason),由 session 决定是「正常退出(bye)」
//   还是「掉线」。
// ==================================================================================================================================
//
// WebSocket link to the room relay (server/src/index.js). Game payloads travel as raw JSON strings wrapped in a tiny
// envelope the relay never parses: "b|<json>" broadcast, "s|<to>|<json>" to one member; incoming "m|<from>|<json>".
// Control frames are JSON objects (welcome / join / leave / err / pong).

import { ERR, netError, codeFromRelay } from './errors.js';

// 【协议版本号】随信封/控制帧格式的演进递增。中继(server/src/index.js)在放行前比对 URL 上的 v,
//   不相等即回 err 帧 ERR_STALE 拒绝,防止旧页面用旧格式与新房主对话。
export const PROTO = 1;

// 【中继选址】relayURL() 决定连哪个中继:?relay= 显式覆盖 → 本机/LAN 主机名走 ws://<host>:8787(local wrangler dev)
//   → 否则连线上 Worker(PROD_RELAY)。同一份代码因此既能本地开发调试,又能公网部署。
// Where the relay lives: ?relay=… wins; a page served from this machine or the LAN talks to a local `wrangler dev`
// relay on :8787; the public site talks to the deployed Worker.
export const PROD_RELAY = 'wss://inkwave-net.inkwave.workers.dev';
export function relayURL() {
  const q = new URLSearchParams(location.search).get('relay');
  if (q) return q.replace(/\/$/, '');
  // APK 的 https://localhost 是内置资源域名，不是手机上运行了中继服务器。
  if (globalThis.inkwaveMobile?.native) return PROD_RELAY;
  const h = location.hostname;
  const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h) || h.endsWith('.local');
  return local ? `ws://${h}:8787` : PROD_RELAY;
}

// 【可控网络模型】SIM 用三个 URL 旋钮把本机连接变"坏",用来在真机验证 netmatch.js 的插值/回放:
//   netlag=ms 给每条入站消息加固定单向延迟;netjitter=ms 追加随机延迟但**保序**(像 TCP:迟到包会堆积在
//   后面);netspike=p 每条消息按概率 p 制造一次 250ms 的 Wi-Fi 卡顿。SIM 为 null 时走零开销的快路径。
//   last 记录已排定的最晚投递时刻,保证后到消息不会"超车"先到消息 —— 这正是真实网络抖动的保序特性。
// Debug: simulate a real connection on localhost — ?netlag=ms (extra one-way delay on everything received),
// &netjitter=ms (random extra, delivered in order like TCP: late packets bunch up) and &netspike=p (chance per
// message of a 250 ms Wi-Fi hiccup that holds everything behind it).
const SIM = (typeof __INKWAVE_MANUAL__ === 'undefined' || !__INKWAVE_MANUAL__) ? (() => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const lag = +q.get('netlag') || 0, jit = +q.get('netjitter') || 0, spike = +q.get('netspike') || 0;
  return lag || jit || spike ? { lag, jit, spike, last: 0 } : null;
})() : null;

// 【Transport 类】一条 WebSocket 连接的薄包装:对上层只暴露「收发原始游戏对象 + 报告关闭 + 平滑 RTT」,
//   不掺杂任何游戏语义。生命周期由 session.js 的 NetSession 持有:connect() 建连,close() 主动退出。
export class Transport {
  constructor() {
    this.ws = null;
    this.id = null;          // 本连接在中继里的成员 id(welcome 帧返回)
    this.onControl = null;   // (obj) => void   welcome / join / leave 等控制帧(游戏负载之外的一切)
    this.onMessage = null;   // (from, obj) => void   某个成员广播/定向来的游戏负载
    this.onClose = null;     // (reason) => void   连接已建立之后的关闭回调(由 session 判 bye/掉线)
    this.rtt = 0;            // 到中继的平滑往返时延(指数平滑),ms
    this._pingT = null; this._pingSent = 0;
    this.bytesIn = 0; this.bytesOut = 0;   // 调试用的吞吐计数(字符数,非字节)
  }

  /** Resolves with the welcome frame, rejects with an Error carrying a `code` (src/net/errors.js). */
  // 【建连主流程】拼 URL → new WebSocket → 8 秒超时;收到 welcome 才 resolve(其余一切失败都 reject 带 code 的 Error)。
  //   settled 保证 resolve/reject 只生效一次;done() 统一清掉超时定时器,避免竞态。
  connect(code, name, create) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
      // 【URL 约定】/room/<码>?name=…&v=协议版本[&create=1];create=1 表示"建房,码被占用要报错",缺省是"加入"
      const url = `${relayURL()}/room/${encodeURIComponent(code)}?name=${encodeURIComponent(name)}&v=${PROTO}${create ? '&create=1' : ''}`;
      let ws;
      try { ws = new WebSocket(url); } catch { reject(netError(ERR.CONNECT, 'Could not connect')); return; }
      this.ws = ws;
      // 【8 秒兜底】握手迟迟不来(socket 卡在建连/被中间设备吞掉)时强制失败并关闭,否则 Promise 永不落地
      const timer = setTimeout(() => { done(reject, netError(ERR.CONNECT, 'Could not connect')); try { ws.close(); } catch { /* ignore */ } }, 8000);
      const handle = (ev) => {
        if (this.ws !== ws) return; // 离房/重连后丢弃旧 socket 的迟到消息。
        const s = typeof ev.data === 'string' ? ev.data : '';
        this.bytesIn += s.length;
        // 【pong(裸文本)】中继运行时直接应答 "pong",不唤醒房间对象 —— 顺带回填平滑 RTT(只用最老一条未答 ping)
        if (s === 'pong') {   // answered by the relay runtime itself (it doubles as our liveness signal there)
          if (this._pingSent) { const r = performance.now() - this._pingSent; this._pingSent = 0; this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.3 : r; }
          return;
        }
        // 【"m|来源|json"】他人广播/定向来的游戏负载:切出来源 id 与 JSON,交给 onMessage。首两字节判断避免无谓 JSON.parse
        if (s.charCodeAt(0) === 109 && s.charCodeAt(1) === 124) {            // "m|from|json"
          const k = s.indexOf('|', 2);
          let obj; try { obj = JSON.parse(s.slice(k + 1)); } catch { return; }
          this.onMessage?.(s.slice(2, k), obj);
          return;
        }
        // 【控制帧(纯 JSON)】解析失败即忽略;下面是各种 t 类型的分发
        let o; try { o = JSON.parse(s); } catch { return; }
        if (o.t === 'err') { done(reject, netError(codeFromRelay(o.c, o.e), o.e || 'Could not connect')); return; }
        if (o.t === 'pong') { this._pingSent = 0; const r = performance.now() - o.c; this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.3 : r; return; }
        // 【welcome = 建连成功】记下自己的 id、启动心跳,然后 resolve 整帧;后面的 onControl 仍会收到它
        if (o.t === 'welcome') { this.id = o.id; this._startPing(); done(resolve, o); }
        this.onControl?.(o);
      };
      // 【SIM 包装】有 SIM 时把每条消息按计算的延迟延后投递;this.ws === ws 守卫避免旧连接的迟到消息落到新连接上
      ws.onmessage = !SIM ? handle : (ev) => {
        const t = Math.max(performance.now() + SIM.lag + Math.random() * SIM.jit + (Math.random() < SIM.spike ? 250 : 0), SIM.last);
        SIM.last = t;
        setTimeout(() => { if (this.ws === ws) handle(ev); }, t - performance.now());
      };
      // 【关闭】握手阶段就关 → reject(带 close reason 映射的 code);已建连后关 → 交 onClose,由 session 判 bye/掉线
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this._stopPing();
        if (!settled) { done(reject, netError(codeFromRelay(null, ev.reason), ev.reason || 'Could not connect')); return; }
        this.onClose?.(ev.reason || 'Disconnected');
      };
      // 【错误】握手阶段的 error 事件一律归为 ERR_CONNECT;建连后的错误交给 onclose 处理
      ws.onerror = () => { if (!settled) done(reject, netError(ERR.CONNECT, 'Could not connect')); };
    });
  }

  // 【心跳】每 2 秒发一次 "ping"。中继把它当存活信号(静默超时会被清扫线程踢掉),同时用于测 RTT。
  //   _pingSent 只记最老一条未答 ping 的时刻 —— pong 按序返回,故这给出真实的那一次往返时延。
  _startPing() {
    this._stopPing();
    const ping = () => {
      // 连接假活时主动失败，让会话层给出掉线出口，不无限播放旧战场。
      if (this._pingSent && performance.now() - this._pingSent > 20000) {
        try { this.ws?.close(4000, 'Heartbeat timeout'); } catch { /* 关闭事件统一处理 */ }
        return;
      }
      if (!this._pingSent) this._pingSent = performance.now();   // time the oldest unanswered one (pongs come in order)
      this._raw('ping');                                          // always sent: the relay reads silence as a dead link
    };
    ping();
    this._pingT = setInterval(ping, 2000);
  }
  // 【停心跳】断开或关闭时调用,清掉 interval;幂等(可重复调用)
  _stopPing() { if (this._pingT) clearInterval(this._pingT); this._pingT = null; this._pingSent = 0; }

  // 【底层发送】只在 socket OPEN(readyState === 1)时发出;返回布尔表示是否真的写进了 socket。
  //   不抛出、不排队 —— 断线期间的发送静默失败,由上层状态机负责重连/退出。
  _raw(s) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    // 不积压过时操作：发送队列超限时整条连接失败，可靠控制帧也不静默丢弃。
    if (ws.bufferedAmount > 256 * 1024) { ws.close(4001, 'Network send backlog'); return false; }
    this.bytesOut += s.length;
    ws.send(s);
    return true;
  }
  // 【游戏负载封装】广播给房间其他所有人:"b|<json>";中继只透传不解析
  broadcast(obj) { return this._raw('b|' + JSON.stringify(obj)); }
  // 【定向】发给单个成员:"s|<目标id>|<json>"
  sendTo(id, obj) { return this._raw('s|' + id + '|' + JSON.stringify(obj)); }
  // 【房间锁】主机开赛时置 true,中继据此拒绝新玩家加入(ERR_IN_PROGRESS);结束回大厅置 false
  lock(v) { return this._raw(JSON.stringify({ t: 'lock', v: !!v })); }
  get open() { return !!this.ws && this.ws.readyState === 1; }

  // 【主动关闭】先停心跳,再摘掉 onclose(避免触发 onClose 回调把主动退出误判成掉线),
  //   发正常关闭码 1000 + reason 'bye' —— session._closed 正是用 reason !== 'bye' 区分「主动退出」与「掉线」。
  close() {
    this._stopPing();
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(1000, 'bye'); } catch { /* ignore */ } }
  }
}
