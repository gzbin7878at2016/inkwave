# Boss 战 —— 特殊游戏模式

<p align="center"><a href="BOSS.md">English</a> · <b>简体中文</b></p>

合作模式:房间里的每个 squidkid(人类 + 补足到 8 人的 Bot)组成一支小队,对抗一个巨型 Boss。混乱、
可读、公平。支持离线(你 + Bot)和在线(由主机模拟 Boss,就像它模拟 Bot 一样)。

## Boss:HULLBREAKER(破壳者)
一只原创的巨型装甲寄居蟹,把家安在一个生锈的集装箱里,周身插满港口杂物 —— 它适配所有舞台
(广场、集装箱堆场、码头)。壳顶高约 5–6 m,体长约 9 m。它用自己的腐蚀墨水涂绘竞技场(=
队伍 1 的墨水:对小队而言是敌方墨水,会减速并伤害他们,必须被覆盖涂掉)。剪影优先:
背上的集装箱壳、两只不等大的螯(一只巨型碎击钳、一只快速钳)、眼柄、步足。
弱点以对手墨水颜色发光:眼柄(始终)和柔软的腹部 / 裂开的甲壳(只在易伤窗口和第 3 阶段)。

### 招式(由主机选择;每个招式都有 前摇 → 攻击 → 后摇,全部提前 ≥ 0.6 s 可读)
| id | 名称 | 发生什么 | 应对 |
|---|---|---|---|
| `slam` | 碎击钳猛击 | 大螯举起(发光),砸下 → 沿地面扩散的墨水冲击波环 | 跳过环 / 远离 |
| `barrage` | 集装箱弹幕 | 向玩家位置抛掷 3–6 个桶;地面先出现目标圆圈;爆成墨水洼 | 走出圆圈 |
| `sweep` | 墨水炮扫射 | 眼部炮管蓄力后沿弧线喷洒扫射的墨水光束 | 找掩体 / 潜入己方墨水中躲避(鱿鱼形态) |
| `charge` | 船体冲撞 | 锁定方向(直线前摇),横穿竞技场冲撞;撞到墙 → 眩晕(易伤窗口) | 侧闪;惩罚眩晕 |
| `crablets` | 蟹群 | (阶段 ≥ 2)洒出 3–5 只小蟹,追逐最近的小子并在墨水中爆开 | 射杀它们(1–2 发) |
| `frenzy` | 甲壳狂乱 | (阶段 3)旋转,向四面八方喷洒墨水 3 s | 逃离 / 躲到掩体后 |

按 HP 划分阶段:1(100–66 %)、2(66–33 %:+ 小蟹、更快)、3(< 33 %:甲壳裂开 → 腹部弱点暴露、
狂乱、狂暴色调)。阶段转换播放咆哮 + 短暂的不可攻击节拍(绝不在招式中途)。
HP 随小队规模(人类计 1.0,Bot 计 0.6)和难度缩放。比赛计时:4 分钟(主机设置)。胜利:
HP → 0。失败:计时耗尽(涂地 % 会显示但为次要)。弱点命中 ×2.5,带有独特的命中音效/VFX。

## 模块
| 文件 | 职责 |
|---|---|
| `src/boss/bossModel.js`、`bossModelGeo.js`、`bossAnim.js`、`bossMats.js`、`bossModelFx.js` | 3D 模型、材质、绑定 + 动画剪辑、VFX 钩子;实验室 `tools/boss-lab.*` |
| `src/boss/boss.js`、`bossBrain.js`、`bossHazards.js`、`bossMode.js` | 模拟、AI、招式、危险物、模式规则、双向伤害、网络代码 |
| `src/game/match.js`、`bots.js`、`weapons.js`、`src/net/netmatch.js`、`src/net/session.js`、`src/main.js` | 模式集成(仅 boss 模式分支) |
| `src/ui/hud-boss.js`、`src/ui/boss-art.js`、`src/ui/menus.js` + `styles/ui.css`、`styles/hud.css`、`src/audio/bossAudio.js` | HUD、模式选择、大厅 MODE、boss 结算、音效 + 音乐 |

## 接口

### 模型
```js
import { BossModel } from '../boss/bossModel.js';
const m = new BossModel({ ink: THREE.Color, quality });   // m.root (Group, 脚在 y=0, 面朝 +Z), m.ready (Promise)
m.update(dt, st)          // st = { speed, turn, move, moveT, movePhase: 'tele'|'act'|'rec'|null, phase, stunned, hurt, dead, aim: Vector3|null }
                          // 仅凭状态驱动移动与招式剪辑(因此访客端动画完全一致)
m.flash(k)                // 受击闪烁 0…1(弱点命中闪烁弱点部位)
m.getSocket(name, out)    // 'clawL' 'clawR' 'cannon' 'eyeL' 'eyeR' 'belly' 'shellTop' 'mouth' 的世界坐标
m.hitShapes               // [{ socket, r, weak, active }] 世界空间球体(update 中更新)—— 玩法命中检测
m.setInk(color); m.setPhase(p); m.dispose()
```
剪辑:idle、walk(随速度缩放,腿真实迈步)、原地转身、每个招式的 tele/act/rec、眩晕(茫然、眼睛旋涡)、
咆哮(阶段变化)、受击闪避(加性)、死亡(倒塌,甲壳爆裂,墨水喷泉)、intro(破土/破水而出,水花四溅)。
预算:英雄级 ≤ 150k 三角形,≤ 60 次 draw call;8 个小子同屏必须稳定 60 fps。

### 模拟
- `Boss`(boss.js)持有状态:`pos, yaw, vel, hp, maxHp, phase, move, moveT, movePhase, target (nid), stunned, dead,
  seed`。确定性招式:一个招式是 `{ id, t0, seed, params }` —— 访客端从起始时间重现其前摇/危险物/动画所需的全部信息。
- 危险物(bossHazards.js):冲击环、光束、桶、墨洼、小蟹 —— 几何由招式记录 + 时间求值,因此每个客户端
  算出相同的形状。涂绘:危险物通过 G.paint.splat(队伍 1)涂墨,**仅主机端**(墨渍像其他墨一样复制)。
  对 squidkid 的伤害由该小子的**所有者**施加(受害者侧,与墨暴一样),依据复制的危险物 —— 所见即所伤。
- 对 Boss 的伤害:投射物/滚筒等检测 `boss.hitShapes`。离线或主机:直接施加。访客:发送
  `{ k: 'bhit', d, weak, w }` 给主机(射击者权威),并立即在本地显示命中标记。
- 事件(事件总线,src/core/ctx.js):`boss:spawn {boss}`、`boss:intro`、`boss:move {id, phase:'tele'|'act'|'rec'}`、
  `boss:hit {damage, weak, attacker}`、`boss:stun {dur}`、`boss:phase {phase}`、`boss:defeat {by}`、`boss:hp {hp,max}`。
  HUD / 音频 / fx 订阅;不做任何轮询。
- 网络代码:主机把 `B`(boss 快照)加入其 20 Hz tick,并把 `['bm', move]` 记录加入其事件流;访客像对待任何
  远程 actor 一样对 Boss 插值(回放时钟),并在时间轴上启动招式。主机迁移:新主机收养 Boss(状态从最后
  快照继续)。迟到/丢失的包:招式以 t0 为键,幂等。
- 模式管道:`Match({ mode: 'boss' | 'turf' })`;大厅设置 `lobby.mode`(主机),随开始配置下发;
  离线通过 `api.startMatch({ mode: 'boss', mapId, time })`。Boss 模式中所有人都是队伍 0("SQUAD");
  Bot 与 Boss 作战(散开、瞄准 Boss、躲避前摇、清除 Boss 墨水、点爆小蟹)。

### UI
- HUD:Boss 血条(名称、带阶段刻度的 HP、伤害削血动画、弱点闪烁)、标题卡 intro、招式提示
  (低调)、眩晕 "OPEN!" 提示、小队状态(替代 4v4 队伍栏)、计时器。结算:胜利/败北 + Boss 战用时、
  每人伤害、弱点命中、击杀数、涂地。
- 菜单:离线 Play 流程中的模式选择(涂地战 | Boss 战)以及在线大厅的主机设置(Boss 模式中
  锁定的队伍选择器变为 "SQUAD")。
- 音频:Boss 咆哮/脚步/招式预兆/命中/眩晕/败北 + Boss 战音乐变体(与其余部分一样程序化生成)。

## 必须成立的边界情况
- 战斗中主机离开 → Boss 在新主机上无缝继续。
- 比赛中途无法加入(房间锁定),但离开者变成 Bot(继续战斗)。
- 全员同时被击杀 → 正常重生(不立即判负);Boss 不会蹲守出生点(危险物与 Boss 本体以出生台为禁区)。
- Boss 绝不走进水中 / 掉下舞台 / 穿墙(导航限制;冲撞在墙前停下 = 眩晕)。
- 招式中被击杀 → 死亡动画干净地打断;待发的危险物消散;败北后不再造成伤害。
- 计时在招式中结束 → 危险物停止,显示结算。
- 舞台 + 时段:三个舞台、白天和黄昏都可用。

## 模型备注
上述模型 API 成立;以下是细节与小增补。
- 文件:`src/boss/bossModel.js`(BossModel + Crablet)、`bossModelGeo.js`(绑定 + 程序化几何)、`bossAnim.js`
  (姿态通道、剪辑、步态/IK、弹簧、verlet 杂物)、`bossMats.js`(5 个打补丁的物理材质 + 模板图集)、
  `bossModelFx.js`(模型自带的墨团 + 蒸汽)。实验室:`tools/boss-lab.html`(截图:`tools/boss-lab.film.mjs`)。
- 预算(三角形数 / draw call 按画质档):低 31k · 中 40k · 高 59k · 超高 86k;5 个蒙皮网格(钢、甲壳、
  肉身、眼睛、杂物)+ 仅 FX 存活时的 2 个 FX draw;一副 100 根骨骼的骨架。`m.tris` = 构建出的三角形数。
- `m.hitShapes[i] = { socket, r, weak, active, pos }` —— `pos` 是世界 `Vector3`(别名 `c`),在每次
  `m.update()` 结束时刷新。身体:`shellF`、`shellR`(集装箱两半,r 1.8)、`body`(头)、`clawL`、`clawR`。
  弱点:`eyeL`、`eyeR`(始终)、`belly`(在 `st.stunned`、第 3 阶段、或腹部发光时)、`crackL`/`crackR`
  (第 3 阶段撕裂的侧壁,翻盖打开后)。死亡时或 intro 尚未破土时全部 inactive。重叠时先测弱点再测身体
  (眼睛位于身体球体前方)。
- 挂点:`clawL`(碎击钳 CRUSHER,Boss 的左侧 = +X)、`clawR`(钳)、`cannon`(炮口尖端,扫射起点)、`mouth`、
  `eyeL`、`eyeR`、`belly`、`shellTop`(桶舱盖,弹幕发射点)、`hatch`(尾部孵化舱,小蟹)、`body`、
  `shellF`、`shellR`、`crackL`、`crackR`、`footL0..2` / `footR0..2`(趾尖)。`m.sockets` 列出全部。
- `update(dt, st)` 读取的状态:`moveT` = 当前 movePhase 开始的秒数,`phaseDur` 其长度(tele 剪辑让
  打击恰好落在 act 开始瞬间),`params` = move.p(slam `rings` → 每环一次螯击;barrage `b[i][3]` → 每桶
  一次舱盖弹开 + 抛掷;charge `wall` → 撞墙进入眩晕;frenzy 旋转从根节点的 yaw 速率读出),`aim`(世界坐标;
  眼睛/头部跟随它,扫射炮口跟随它,猛击落在它前方),`hurt`(命中帧 > 0 → 加性闪避),`stunned`(冲撞后
  撞墙,其他情况茫然;旋涡眼、腹部外露),`dead`。`move = 'intro' | 'roar'` 按 `moveT` 播放定点演出;
  阶段提升在没有招式运行时也会自动咆哮。根变换来自模拟:双脚锚定在世界空间,从**实测**根位移迈步
  (无滑步)。
- `m.flash(k, weak = false)` —— 身体边缘光(持续射击时保持低调)或弱点闪烁;外加一次闪避。
- 颜色:`new BossModel({ ink, weak, quality })`、`m.setInk(c)`(Boss 墨水:滴流、浸墨的脚、碎击钳血管、
  炮口、FX)、`m.setWeak(c)`(眼睛、腹部、裂缝)。默认值:`G.teamColors[1]` / `G.teamColors[0]`。
- VFX 钩子(在 `update` 内同步调用;Vector3 被复用 —— 请拷贝):
  `m.onFoot(legIndex, pos, strength)` 每次落足(strength ≈ 0.4 行走 … 1.5 疾驰);
  `m.onImpact(socket, pos, strength)` —— 猛击触地('clawL',地板上的 pos)、冲撞撞墙('mouth')、
  眩晕/死亡倒塌('belly' / 'body')、intro 落地('body');
  `m.onEvent(name, { socket, pos, data })` —— 'step'、'hatch'(弹幕弹出,data = 桶索引)、'crablets'(孵化
  舱翻开,data = 数量)、'roar'、'bonk'、'burst'(intro:破土)、'geyser'(死亡:墨水喷泉)。
  模型自身绘制定点演出的墨水/蒸汽(intro 水花、猛击飞溅、死亡喷泉、第 3 阶段蒸汽排放)。
- 小怪:`BossModel.makeCrablet({ ink, weak, quality })` → `{ root, ready, tris, update(dt, { speed, turn, dead }),
  pop(), hit(), setInk, dispose }` —— 1 次 draw,约 1.8k 三角形;创建后翻滚入场 0.55 s;`pop()` 膨胀、
  闪烁并爆成墨水(自带小 FX);pop 后保留约 1 s 再 dispose(模拟本身已是 1.2 s)。
- `st.params`(当前生效招式记录的 params)让模型的前摇与模拟保持同步;没有它时模型镜像默认调参
  (按阶段的猛击环数、弹幕 3/4/6 桶间隔 0.26 s)。
