# 在线对战 —— 会话契约(`G.net`)

<p align="center"><a href="NET.md">English</a> · <b>简体中文</b></p>

5 字符邀请码的私人房间,最多 8 名玩家(4 v 4,空位可选地由 Bot 填补)。房间创建者是**主机**:
由他的浏览器运行 Bot、比赛时钟和最终裁判。每个玩家在本地模拟自己的 squidkid(操作零延迟)并把它
流式发送给其他人;其他人通过同一套动画系统渲染这些角色,插值在约 100 ms 之前的时间轴上。
墨水由涂绘者逐滴复制,因此每个屏幕显示同一块地面。

传输层:每个玩家一条 WebSocket,连接到一个 Cloudflare Durable Object 中继(`server/`),每个房间码
对应一个房间对象。

## `G.net` —— 会话(src/net/session.js)

```js
G.net.state      // 'offline' | 'connecting' | 'lobby' | 'starting' | 'match' | 'error'
G.net.code       // 在房间中为 'K7QXM',否则 null
G.net.myId       // 本玩家在房间中的 id
G.net.hostId
G.net.isHost     // 布尔
G.net.errorCode  // 稳定的失败码: ERR_NOT_FOUND | ERR_FULL | ERR_TEAM_FULL | ERR_IN_PROGRESS | ERR_CODE_TAKEN
                 //   | ERR_CONNECT | ERR_LOST | ERR_MATCH_START | ERR_STALE —— 逻辑按它判断(src/net/errors.js)
G.net.error      // 同一失败的英文兜底文本(日志 / 未知码),或 null。绝不要拿它做比较。
G.net.lobby = {
  map: 'tidewater', time: 'day' | 'dusk', duration: 180, bots: true, difficulty: 'normal', mode: 'turf' | 'zones' | 'boss',
  players: [{ id, name, team: 0 | 1, weapon, sub, special, style, ready, host, you, ping }],   // 顺序稳定:加入顺序
  maxPlayers: 8,
}

// 动作(任何状态下调用都安全;无效调用被忽略)
await G.net.create(name)          // → 房间码;state 走 connecting → lobby(你是主机)
await G.net.join(code, name)      // 拒绝时抛出携带 .code 的 NetError(见上方 errorCode);.message 是英文兜底文本
G.net.leave()                     // 回到 'offline'
G.net.setMe({ name, weapon, sub, special, style, ready, team })   // 任意子集;team: 0 | 1 | 'auto'
G.net.setSettings({ map, time, duration, bots, difficulty, mode })   // 仅主机(区域控制固定 5:00 + 加时)
G.net.canStart()                  // 主机:所有在场者都已就绪时为 true(主机视为已就绪)
G.net.start()                     // 仅主机 → 所有人 state 变 'starting',然后 'match'
G.net.emote(name)                 // 'booyah' | 'wave' | 'dance' | 'flex' —— 在你的大厅角色上向所有人展示
G.net.on(event, fn) → 退订函数
//   'state'  { state }                 任何状态变化
//   'lobby'  { lobby }                 设置 / 玩家变化(在 join / leave / setMe / setSettings 后触发)
//   'join'   { player }                'leave' { player, reason }       'host' { hostId }   (主机迁移)
//   'emote'  { id, name }              'error'  { code, message }   (code = errorCode;菜单通过其 i18n 表显示)
//   'match'  { phase: 'start' | 'end' }  比赛开始 / 结束(展示结算后,所有人回到 'lobby')
```

UI 可以依赖的规则:
- 在房间中时 `lobby.players` 始终包含你自己(`you: true`);主机为 `host: true`。
- 队伍由主机保持平衡(每队 ≤ 4)。`setMe({ team })` 只是一个请求;主机可以拒绝。
- `start()` 在每个客户端上启动比赛;当 `state === 'match'` 时菜单应自行隐藏(main.js 也会处理)。
  比赛结算结束后,所有人以 `state === 'lobby'` 回到大厅画面。
- 比赛中途离开的玩家由同一个 actor 上的 Bot 顶替;如果主机离开,房间迁移到下一位玩家
  (Bot、时钟和裁判权随之转移)。
- 你的衣柜外观(`profile.style`)和配装(`profile.weapon`、`.sub`、`.special`;sub / special 为 null
  表示使用该武器自带)在加入时自动发送;在大厅中改动后再次调用 `setMe`。Bot 约一半时间获得随机的
  sub / special,与离线一致。

## 网络代码工作原理(src/net/netmatch.js)

**所有权。** 每个 squidkid 有唯一所有者:玩家拥有自己,主机拥有 Bot 并运行比赛时钟和裁判。
所有者以满帧率模拟,并通过中继以 20 Hz 流式发送 tick(`{k:'t', ts, a:[打包的 actor], e:[事件]}`);
其他人从不模拟别人的 squidkid。离开(或连接死亡)的玩家由主机收养为 Bot,从所有人最后看到的位置
原样继续;当主机离开时,最年长的剩余玩家成为主机并收养 Bot、时钟和裁判。

**时间轴。** 每个发送者有一条位于发送者时间中、落后于"现在"的回放时钟:
- *offset* —— 见过的最快包决定时钟偏移(网络下限);随漂移缓慢上移;
- *delay* —— 一个 tick 的缓冲 + 测得抖动的 2.5 倍,钳制在 85–300 ms 并平滑过渡;
- 时钟以本客户端自身的帧时间前进,以 ±20–25 % 的速率向 `now − offset − delay` 纠偏,因此本地卡顿
  绝不会让远程 squidkid 瞬移;当发送者的样本即将耗尽时它会减速(最低 0.35×)而不是跑出路径尽头。

**路径。** 位置是穿过所有者样本的三次 Hermite 曲线,使用所有者的速度(C1 连续:tick 边界处无拐角);
垂直运动不会穿过任一端所在地面以下的地板。越过最新样本后做最多 180 ms 的弹道外推,然后停住。
传送计数器(`netTp`,重生时递增)让代理端直接切换而不是滑过整张地图;重生的 squidkid 在新生命的
第一个样本到达前保持隐藏。

**纠偏。** 唯一的不连续来自新数据改写了已经显示的时刻(离开外推、所有权交接)。每帧在上一帧的时刻
重新求值路径;任何差异作为一个偏移量,按临界阻尼曲线(ω = 13)收敛,因此既不会跳变也不会颠簸。

**动画。** 远程 squidkids 运行与本地完全相同的 `_finishFrame` / 角色动画,由复制的状态驱动(form、
grounded、攀爬、武器姿态标志、转身速率)加上所有者的动画触发器和事件(`['tr' …]`、`['ev' …]`),
在同一时间轴上播放,因此远程的滚筒横扫或闪避翻滚就是真实的动画剪辑。

**墨水和命中。** 每次 splat 由涂绘者发送并被精确重放(带种子的形状),所有屏幕显示同一块地面;
其他玩家的射击是纯视觉幽灵。命中由射击者的屏幕决定,由受害者的所有者施加(`{k:'hit'}`);
击杀、大招和重生作为事件转发。每个屏幕上的结果以主机的最终计数为准。

**Kit 武器与副武器(src/game/kits/*、subs.js)。** 一个独立的世界物体(拳头、箭、伞面、掷出的副武器、
一只 Waddle……)由其所有者记录为 `['k', nid, kind, data]`,并由该 kit 的 `ghost(actor, data)` 重放:
纯视觉(涂墨静音、命中丢弃),从不自行决策 —— 它的所有者的结束 / 锁定 / 路径记录驱动它。
对幽灵装置(幕帘、信标、Waddle、鱼雷……)的命中发给它的所有者(`{k:'dh'}` → 该 kit 的 `netHurt`)。
kit 的姿态状态(Mitts 飞跃、持撑的 Brolly 伞面)搭 actor tick 的便车(`netState` / `netApply`)。

**区域控制。** 主机运行规则;每个判定(占领、控制、惩罚、轮换、加时、以及带精确计数数的结束)和
每秒两次的计数快照,都作为 `['z', …]` 进入其事件时间轴,因此它们与导致它们的涂墨同步落地。
访客端跟随(zones.js `netEvent`):在快照之间只预测计数,每个客户端填充自己玩家的大招槽。

**中继(server/)。** 每个房间码一个 Durable Object:成员关系、主机选举、拒绝加入(未知 / 已满 /
比赛进行中),以及对 `b|` / `s|to|` 负载的盲扇出。客户端每 2 s 发送 `"ping"`,由运行时直接应答
而不唤醒房间对象;清扫线程会丢弃比赛中沉默 10 s(大厅中 150 s)的连接。

**测试。** `node tools/net-test.mjs`(游戏在 :8490,`cd server && npx wrangler dev --port 8787`)
用真实的无头客户端对本地中继打比赛,报告一致性(时钟、覆盖率、名单、结果)以及绘制内容:
每个远程 squidkid 相对其所有者自身帧的逐帧"kink"(拐点)和路径误差。
`--clients 3 --leave host --drop kill|freeze` 测试迁移,`--full` 打完整个结算并回到大厅,
`--net "netlag=40&netjitter=30&netspike=0.01"` 模拟真实连接,`WORST=8` 解释最差的帧。

## 展示大厅布景(src/game/showcase.js)

两个在线画面都布置在**大厅布景**(`src/game/lobbySet.js`,雨后蓝调时刻的后巷;拥有自己的场景和
灯光)中,由 showcase 全屏绘制。`showcase.fullFrame` 在布景铺满整个屏幕时为 true:main.js 此时
跳过世界的绘制和模拟(showcase 自行清屏并绘制该帧)。在布景约 0.45 s 的交叉淡入淡出期间
(进入 / 离开世界、配装 / 衣柜台座、结算领奖台)它为 false,因为底层需要活着的世界。布景在首次
`showHub` / `showLobby` 时惰性构建,在衣柜往返和整场比赛中停放(不绘制),并在离开在线画面约
1.5 s 后释放。

`showcase.showHub(style, color, weapon)` —— 你的 squidkid 站在布景的枢纽位,构图位于创建 / 加入
卡片的右侧(小巷初次亮起时它从墨洼中跃出;外观 / 武器变化会触发台座的反应)。
`showcase.showLobby(players, colors, { reduced })` —— 房间:布景相机从枢纽构图滑向列队位,你潜入
墨水、从墨洼中跃出落在你自己的标记上(前排正中);已在房间的人紧随你之后在他们的标记上浮出。
`showcase.updateLobby(players, colors)` 对名单做 diff:
- **加入** → squidkid 沿 `set.lanes(mark)` 从小巷入口游进来(低位、快速的鱿鱼游动,铺出一条湿润的
  队伍色墨迹;对手则跳上码头台阶),跃起变回小子,溅落在自己的标记上并转向镜头;多次加入会错开;
  路径会绕开已站好的小子;
- **离开** → 转身,潜入自己的墨水并沿 `set.exitPath(mark)` 游出;
- **换队** → 从旧标记游到新标记(沿自己的出口路径出去,沿新通道进来);当*你*换队时,所有人潜入
  墨水、在另一侧浮出;
- 换武器 / 外观以及就绪 / 取消就绪会在原地触发一个反应(仍在入场途中的小子会排队到落地后)。
  
`showcase.lobbyEmote(id, name)`、`lobbyGetSet()`(倒计时:所有人摆好架势,镜头前倾)、
`lobbyLaunch()` → 秒数(所有人超级跳离场,前排正中第一个)、`lobbyAnchor(id, out)` → 玩家头顶上方
的屏幕点,供 DOM 名牌使用 —— 它跟随游动入场的 squidkid(`out.vis` 在隐藏或该点会落在 UI 面板下方时
为 0)、`lobbySlotAnchor(row, i, out)`(未认领的标记 → "OPEN" / "BOT" 牌)、
`leaveLobby()`(其他人潜入离场;你的小子留下并走回枢纽位等待 `showHub`)。回到房间(衣柜、一场比赛)
时所有人都已站在自己的标记上:入场动画绝不重播。`opts.quick` 仍被接受但不再需要。
审查用:`showcase.debugCam = { pos, target, fov }` 覆盖布景相机。
