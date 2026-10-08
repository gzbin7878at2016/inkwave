# 游戏事件总线

<p align="center"><a href="EVENTS.md">English</a> · <b>简体中文</b></p>

`import { on, emit, G } from '../core/ctx.js'` —— `on(name, fn)` 返回一个退订函数。特效、HUD 和
屏幕 FX 模块应订阅这些事件,而不是去改动玩法代码。

## 当前已发出的事件
| 事件 | 负载 | 发出位置 |
|---|---|---|
| `hit` | `{ attacker, victim, damage, killed, weaponId }` | weapons.js applyHit / 墨暴 |
| `damage` | `{ victim, attacker, amount, source }` | actor.damage |
| `splatted` | `{ victim, attacker, cause }`(cause: 武器 id、'water' 等) | actor.splat |
| `respawn` | `{ actor }` | actor.respawn |
| `special:ready` | `{ actor }` | actor.addTurf |
| `special:use` | `{ actor, id }`('slam' / 'storm') | actor._startSpecial |
| `superjump` | `{ actor, phase: 'charge' \| 'flight', to? }` | actor.superJump |
| `shake` | `{ amount, pos? }` | 相机震动请求 |
| `recoil` | `{ amount }` | 本地玩家的视觉后坐力 |
| `lowink` | `{ actor, need? }` | weapons |
| `match:state` | `{ state, match }`('intro'、'playing'、'finish'、'judge'、'results') | match.js |
| `match:oneminute` / `match:count` | `{}` / `{ n }` | match.js |
| `actor:<name>` | `{ actor, surface, ...data }` —— 由 `character.onEvent(name, data)` 重发;surface 0 干燥 · 1 己方墨水 · 2 敌方墨水 | actor.js 接线 |

## 待添加
| 事件 | 负载 |
|---|---|
| `actor:jump` | `{ actor, surface, swim }` |
| `actor:land` | `{ actor, speed, surface, pos }` |
| `actor:form` | `{ actor, form: 'kid' \| 'squid', surface }` |
| `actor:dive` / `actor:emerge` | `{ actor, pos, speed }`(鱿鱼进入 / 离开己方墨水) |
| `actor:climb` | `{ actor, on }` |
| `actor:enemyInk` | `{ actor, on }` |
| `weapon:fire` | `{ actor, weapon, muzzle, dir, charge? }` |
| `weapon:impact` | `{ pos, normal, team, kind, radius }`(kind: 'shot'、'blast'、'drop'、'charger'、'roll') |
| `bomb:throw` / `bomb:arm` / `bomb:explode` | `{ actor?, pos, team, radius? }` |
| `special:slam` | `{ actor, pos, radius }` |
| `storm:start` / `storm:end` | `{ pos, team }` |
| `superjump:land` | `{ actor, pos }` |
| `turf` | `{ actor, area }`(每块被涂下的区域;自行聚合) |

## character → actor(character.js 内部)
| 名称 | 数据 |
|---|---|
| `footstep` | `{ foot: 'L' \| 'R', pos: THREE.Vector3(世界坐标,请拷贝), speed }` 每次落足 |
| `handplant`(可选) | `{ pos }` 滚筒/charger 的重力时刻 |

## 音频(由 lead 负责,src/audio/audio.js)
- lead 在 `actor:footstep` 上播放脚步声(区分表面:`step_dry`、`step_ink`、`step_enemy`),并运行
  海港环境音(`harbor_ambience` 循环 + 随机 `gull` 鸣叫)。不要重复实现这些。
- 人人可用的额外 SFX 名称,通过 `G.audio.play(name, { pos, volume, pitch })`:`step_dry`、`step_ink`、
  `step_enemy`、`ink_drip`、`gull`、`harbor_ambience`(循环)—— 以及 docs/CONTRACTS.zh-CN.md §2 的完整列表。
- 需要新音效?在 src/audio/audio.js 中添加一个定义,并列入 SFX_GROUPS。

## 自上游 1.0 以来新增(本 fork)
大招、副武器和区域控制在上面表格之外还会发出这些。`actor:dive`、`footstep` 和 `handplant` 不再发出。

| 事件 | 负载 | 发出位置 |
|---|---|---|
| `actor:cheer` | `{ actor, helped }` | specials.js(欢呼宝珠 Cheer Orb) |
| `actor:dodge` / `weapon:dodge` | `{ actor, dir }` / `{ actor, pos, dir }` | weapons.js(Twins 闪避翻滚) |
| `actor:poisoned` / `actor:tracked` | `{ actor }` / `{ actor, team }` | subs.js(毒雾 / 点传感器) |
| `bomb:arm` / `bomb:explode` | `{ actor, pos, team, radius }` | subs.js |
| `match:count` | `{ n }`(最后倒计时) | match.js |
| `special:start` / `special:end` | `{ actor, id }` / `{ actor, id, reason }` | specials.js |
| `special:launch` / `special:sonar` / `special:shield` | `{ actor, to }` / `{ actor, pos }` / `{ actor, time }` | specials.js |
| `special:strike` / `special:wail` | `{ actor, pos, radius }` / `{ actor, pos, dir }` | specials.js |
| `storm:end` | `{ pos, team, actor }` | weapons.js |
| `sub:use` | `{ actor, kind }` | subs.js |
| `sub:land` / `sub:arm` / `sub:cloud` / `sub:destroyed` | `{ kind, pos, team, radius? }` | subs.js |
| `sub:charge` | `{ actor, kind: 'shaker', level, max }` —— 手持的 Shaker 炸弹达到新的蓄力档(2,然后 3 = 满) | kits/shaker.js |
| `sub:lock` / `sub:end` | `{ kind: 'waddle', pos, team, actor, target }` / `{ kind, why, team, pos }`(why: reached · travel · life · lost · stuck · fuse · popped · sea · fell · cleared) | kits/waddle.js |
| `zones:zone` | `{ zone, owner }` —— 一个区域被占领(墨水 ≥ 80 %);随后它会被占领者的墨水淹没 | zones.js |
| `zones:control` | `{ owner, prev, objective }` —— 当前目标点的持有者变化(owner −1 = 中立) | zones.js |
| `zones:contest` | `{ zone, holder, share }` —— 对方队伍把被持有的区域涂到警戒份额(ZONES.warn) | zones.js |
| `zones:penalty` | `{ team, penalty, total, start, end }` | zones.js |
| `zones:active` | `{ objective, zones, final, moved }` —— 轮换(final = 最后 30 秒的中心锁定) | zones.js |
| `zones:overtime` | `{ losing }` | zones.js |
| `zones:end` | `{ winner, reason, counts }`(reason: knockout · time · comeback · retake · neutralised · overtime-cap) | zones.js |
