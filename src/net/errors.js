// ============================================================ 中文导读 ============================================================
// 【本文件是什么】网络错误码的唯一权威定义(src/net/errors.js)。所有联机失败都以「稳定错误码 + 可选英文消息」
//   的形式流动:逻辑只认错误码(可与文案、语言无关),英文消息仅供日志,玩家看到的措辞由 i18n 字典决定
//   (src/ui/menus.js 的 JOIN_ERR 消息表)。
// 【为什么这样设计】旧实现里失败信息就是英文句子,代码拿句子当查找键(如 e.message !== 'Room code taken')。
//   行为与措辞耦合,翻译一条消息就可能悄悄打断重试循环或错误界面。现在:网络层内部比较 e.code,绝不在逻辑里
//   比较 message。
// 【对端兼容】中继服务器(server/src/index.js)在 err 帧里发送同样的错误码(字段 c),旧版中继/客户端没有 c 字段时
//   仍带旧英文文本(字段 e):codeFromRelay 负责「c 优先,退回文本映射,再退回通用连接失败」,新老版本混跑不失效。
// 【三个工具函数】netError(code, message) 构造带 code 的 Error;codeFromText(text) 把遗留英文文本映射回错误码;
//   codeFromRelay(c, text) 是中继 err 帧的统一入口。
// 【关键调用点】session.js 的重试循环(按 ERR.CODE_TAKEN 重试)、_fail/_closed(设置 errorCode 供 UI 显示)、
//   transport.js connect()(把中继拒绝包装成带 code 的错误)。
// ==================================================================================================================================
//
// Net error codes — the single source of truth for *logic*.
//
// Room failures used to travel as English sentences that doubled as lookup keys (`e.message !== 'Room code taken'`,
// `JOIN_ERR[msg]`). That couples behaviour to wording, so translating a message could silently break the retry loop
// or the error screen. Now every failure carries a stable `code` (these constants) plus an optional English
// `message` kept only for logs; the player-facing wording lives in the i18n dictionaries
// (the message-id table `JOIN_ERR` in src/ui/menus.js).
//
// The relay (server/src/index.js) sends the same codes in its `err` frame (`c`), with the old text still in `e` so an
// older relay — or a newer one talking to an older client — keeps working: `codeFromRelay` maps the legacy text back
// to a code when no `c` is present.
export const ERR = {
  // 【错误码一览】STALE:页面构建比中继旧,协议不兼容;CODE_TAKEN:建房时该 5 位房号已被占用;
  //   NOT_FOUND:加入时找不到该房号;FULL:房间满 8 人;TEAM_FULL: lobby 里要换的队伍已满(4 人/队);
  //   IN_PROGRESS:比赛进行中不能加入;CONNECT:socket 根本没建立(离线/被拦/中继宕机);
  //   LOST:进来之后连接断开;MATCH_START:房主的开赛握手失败
  STALE: 'ERR_STALE',            // the page is running an older build than the relay
  CODE_TAKEN: 'ERR_CODE_TAKEN',  // create: that 5-character code is already in use
  NOT_FOUND: 'ERR_NOT_FOUND',    // join: no room with that code
  FULL: 'ERR_FULL',              // join: the room already has eight players
  TEAM_FULL: 'ERR_TEAM_FULL',    // lobby: the team we asked to switch to is full
  IN_PROGRESS: 'ERR_IN_PROGRESS',// join: the room is mid-match
  CONNECT: 'ERR_CONNECT',        // the socket never opened (offline, blocked, relay down)
  LOST: 'ERR_LOST',              // the socket dropped after we were in
  MATCH_START: 'ERR_MATCH_START',// the host's start-match handshake failed
};

// 【构造错误对象】netError(code, message) 返回一个 name 为 'NetError'、携带 code 的 Error。
//   message 只做日志/兜底:text 为空时回退成 code 本身,所以 UI 绝不该拿 message 当查找键 —— 一律读 code。
/** An Error carrying a machine-readable `code`. `message` is a log/debug fallback only — never compare on it. */
export function netError(code, message = '') {
  const e = new Error(message || code);
  e.code = code;
  e.name = 'NetError';
  return e;
}

// Relay text -> code, for frames that predate the `c` field (and for socket close reasons, which are text by spec).
// 【遗留文本映射表】WebSocket 关闭原因(close reason)按规范只能是文本,所以断线路径永远走这张表;
//   中继 err 帧在没有 c 字段时同样靠它识别
const LEGACY = {
  'Room code taken': ERR.CODE_TAKEN,
  'Room not found': ERR.NOT_FOUND,
  'Room is full': ERR.FULL,
  'Match in progress': ERR.IN_PROGRESS,
  'Could not connect': ERR.CONNECT,
  'Lost connection to the room': ERR.LOST,
  'Could not start the match': ERR.MATCH_START,
  'Disconnected': ERR.LOST,
};

// 【文本 → 码】WebSocket 的 close reason 按规范只能是文本,所以断线路径必须经此表;中继 err 帧缺 c 字段
//   时也走这里。无法识别的文本返回 null,由调用方兜底(断线 → ERR.LOST,连接 → ERR.CONNECT)。
/** Map a legacy relay/close message to a code (null when we don't recognise it). */
export function codeFromText(text) {
  return LEGACY[text] || null;
}

/** Code for a relay `err` frame: the explicit `c` code wins, else the legacy text, else a generic connect failure. */
// 【三档兜底】显式错误码 > 遗留文本映射 > 通用连接失败 —— 任何来源都能得到一个可展示的稳定错误码
export function codeFromRelay(c, text) {
  return c || codeFromText(text) || ERR.CONNECT;
}
