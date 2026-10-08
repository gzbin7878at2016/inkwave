# INKWAVE —— 模块契约

<p align="center"><a href="CONTRACTS.md">English</a> · <b>简体中文</b></p>

INKWAVE 是一款原创的、Splatoon 风格的 4v4 涂地射击游戏,基于 three.js r186(纯 ES Modules,无打包器)。
一切皆为程序化生成:没有外部模型、纹理或音频文件,字体为 vendored(随仓库分发)。

- 启动:`python3 -m http.server 8490 --directory ~/inkwave` → http://localhost:8490/
- 每个页面都通过 import map 使用 three:`import * as THREE from 'three'` 以及
  `import { X } from 'three/addons/...'`(映射到 `vendor/three/jsm/`)。
- 截图/审查:`node tools/shot.mjs <url> <out.png> [--w 1600 --h 900 --wait 2500 --eval "js"]`
  (驱动真实系统 Chrome 并启用 GPU WebGL;会打印控制台错误)。截图保存在 `/private/tmp/...` 或 `shots/`。
- 共享调参集中在 `src/config.js`(从那里 import;不要重复数字)。
- 单位:米、秒、弧度。Y 轴向上。角色根节点原点 = 双脚落地处,rotation.y = 0 时面朝 **+Z**。

## 美术方向(适用于所有模块)

明亮、饱和、阳光、玩具感。干净的卡通化 PBR:柔和的阴影、湿墨的光泽、 chunky 圆润的造型、强烈的剪影,
处处带一点挤压拉伸(squash & stretch)。想象"正午海边、城市滑板公园般的海港广场"。
两个队伍的墨水颜色必须是屏幕上最抢眼的东西 —— 环境色彩保持粉彩/中性,好让墨水跳出来。
只使用原创设计 —— 不出现任天堂的名字、标志或精确复制的角色。我们的玩家叫 "squidkids"(鱿鱼小子)。

其他模块可以依赖的渲染器事实:`renderer.outputColorSpace = SRGBColorSpace`,tone mapping = `NeutralToneMapping`,
exposure ≈ 1.0,`scene.environment` = 天空的 PMREM(因此 MeshStandard/Physical 材质能获得真实反射),
阴影 = 来自一盏平行光太阳的 PCFSoftShadowMap。后处理:阈值约 0.9 的 bloom(只有非常亮的东西会发光)。

## 字体 / UI 令牌
`assets/fonts/TitanOne-latin.woff2`(展示用,粗壮)和 `assets/fonts/Rubik-latin.woff2`(可变字重 400–900,UI 文本)。

---

## 1. `src/game/character.js` —— squidkid 模型 + 程序化动画

```js
import { Character } from './character.js';
const c = new Character({ color: new THREE.Color('#ff8a14'), weapon: 'shooter', style: { hair: 0..3, skin: 0..3 }, name, isLocal });
scene.add(c.root);                // root.position = 双脚位置, root.rotation.y = 朝向 yaw(由引擎每帧设置)
c.setColor(color)                 // 队伍墨水颜色(头发、背罐墨水、鱿鱼形态身体、武器的墨水部件;受伤墨渍用敌方颜色)
c.setWeapon('shooter'|'roller'|'charger'|'blaster')
c.update(dt, s)                   // 每帧,s = 下方 AnimState
c.trigger(name, arg)              // 一次性动作: 'shoot' | 'flick' | 'throw' | 'land'(arg=落地冲击速度 m/s) | 'jump' | 'hit' | 'special_leap' | 'special_slam' | 'spawn' | 'charge_release'
                                  // 'hit' 的 arg = { x, z, amp }:指向攻击者方向的单位向量,在角色根空间内
                                  //   (+z = 面朝方向, +x = 角色的左侧);valueOf() → amp (0.4..1.2),供旧的数值调用方使用
c.onEvent = (name, data) => {}    // 由 actor.js 设置;character.js 调用它('footstep' {foot, pos, speed})→ 总线 'actor:<name>'
c.setDance(name|null)             // 循环播放的非战斗动画: 'victory' | 'defeat' | 'menu_idle' | 'lobby_pose' ; null → 回到战斗动画
c.setHurt(amount0to1, enemyColor) // 身体/衣服上的敌方墨水溅渍(amount → 0 时淡出)
c.setVisible(bool)
c.getMuzzle(outVec3)              // 所持武器的世界空间枪口位置(update 之后)
c.dispose()
```
AnimState:
```js
{
  time,                  // 秒(全局时钟)
  speed,                 // 水平速度 m/s
  localMove: {x, z},     // 相对面朝方向的移动方向, |v|<=1, +z 向前, +x 向右
  grounded, vy,          // 垂直速度
  aimPitch,              // 弧度, + = 抬头(上半身/手臂/头部跟随瞄准)
  firing,                // 按住扳机(shooter/blaster 姿态)
  charge,                // 0..1 charger 蓄力(姿态 + 武器上的发光蓄力提示)
  rolling,               // 滚筒贴地推行
  form,                  // 'kid' | 'squid'(干燥跳跃) | 'swim'(潜入己方墨水) | 'climb'(在墙上游动)
  wallNormal,            // form==='climb' 时的 THREE.Vector3
  ink,                   // 0..1 → 背罐内可见的墨水量
  lowInk,                // bool → 墨罐闪烁
  special,               // 0..1;到 1 时头发/触手发光脉动(大招就绪)
  invuln,                // bool → 轻微闪烁(出生保护)
  // 可选(v1.1 起由 actor.js 提供;character.js 必须容忍其缺失):
  turnRate,              // rad/s, + = 左转 / 从上方看逆时针
  hp,                    // 0..1
  inEnemyInk,            // bool
  surface,               // 0 干燥 · 1 己方墨水 · 2 敌方墨水
  subAim,                // bool —— 拿着 Splat 炸弹瞄准投掷姿势
}
```
形态切换(kid ⇄ squid)在角色*内部*完成动画(约 0.12 s 的挤压/弹跳)。'swim' = 鱿鱼大部分在墨面之下:
远程玩家只看到一个淡淡的背鳍涟漪形状;`isLocal` 时鱿鱼渲染得略带半透明、刚好在墨面之下,让玩家能看到自己。
'climb' = 鱿鱼贴合墙壁,腹部贴墙,头朝上。

视觉规格:高约 1.45 m 的小子,大头(约 0.36 m),4–6 缕队伍颜色的光泽触手"头发"(清漆层 clearcoat,
下方有细微的吸盘点),一条横过眼睛的深色护目镜带加明亮的眼睛,短袖 T 恤带一条队伍色条纹,短裤,
粗大的运动鞋,以及一个透明墨水背包,墨水填充高度 = s.ink。武器:shooter(带墨罐的 chunky 爆能手枪)、
roller(长握柄 + 宽幅滚筒)、charger(带瞄准镜的长枪 + 发光蓄力线圈)、blaster(肥硕球茎状发射器)。
鱿鱼形态约 0.6 m,有光泽,三角形外套膜鳍,大眼睛,摆动的触手。动画:待机呼吸、跑步循环(手臂/腿部摆动、
头部起伏、随加速度倾斜)、瞄准时横移、跳跃/下落/落地挤压、射击后坐力、滚筒推行与横扫蓄力、charger 瞄准、
投弹、大招跳跃/猛击、受击闪避、舞蹈(胜利:跳跃挥拳/旋转;失败:垂头摇晃;menu_idle:放松的重心移动 + 四处看)。
预算:每个角色 ≤ ~45 次 draw call;按颜色缓存材质;跨实例共享几何。

## 2. `src/audio/audio.js` + `src/audio/music.js` —— 全程序化 WebAudio

```js
import { audio } from './audio.js';
audio.init()                          // 幂等;从用户手势中调用。创建 ctx、master/music/sfx 总线、压缩器、混响。
audio.setVolumes({ master, music, sfx })   // 各为 0..1
audio.setListener(pos, forward, up)   // THREE.Vector3,每帧调用
audio.play(name, { pos, volume=1, pitch=1 })  // 一次性;pos → 3D 声像定位 + 距离衰减,否则为 2D
const h = audio.loop(name, { pos, volume, pitch }); h.set({ volume, pitch, pos }); h.stop(fade=0.15)
audio.duck(amount=0.5, seconds=1.2)   // 临时压低音乐
import { music } from './music.js';   // audio.init() 同时会在 music 总线上初始化 music
music.play(track, { fade=1.0 })       // 'title' | 'menu' | 'battle' | 'battle_final' | 'results_win' | 'results_lose' | null
music.setIntensity(0..1)
```
必须保持轻量:每种声音名称有并发上限(如 'splat_small' 最多 6 个并发),音高随机 ±6% 以免重复播放听起来机械。
SFX 名称(全部必须存在):
`ui_hover ui_click ui_back ui_confirm ui_toggle ui_slider ui_error`
`shoot_shooter shoot_blaster blaster_boom charger_charge(loop) charger_full shoot_charger roller_flick roll(loop; 音高/音量 ≈ 速度)`
`splat_small splat_big ink_hit_wall bomb_throw bomb_beep bomb_explode`
`squid_in squid_out swim(loop) swim_splash jump land climb(loop)`
`hit_marker hurt splat_enemy splatted_self ally_splatted enemy_ink_sizzle(loop)`
`low_ink empty_click refill_full special_ready special_activate special_slam storm_rain(loop) storm_thunder respawn super_jump`
`ready go_horn countdown_tick one_minute final_count times_up judge_drumroll judge_reveal victory_fanfare defeat_jingle xp_tick level_up`
音乐:原创、抓耳、高能的朋克/放克/电子流行,战斗曲 140–160 BPM;轻松但有律动感的菜单主题;带有个态度 hook
的标题曲;battle_final = 同调性、更急促(双倍速度 hi-hat、额外的领奏层);短促的结算 sting。
真正的音序器,带前瞻调度(lookahead scheduling),合成鼓/贝斯/和弦/领奏,总线压缩 + 混响/延迟。

## 3. UI —— `src/ui/menus.js`、`src/ui/hud.js`、`styles/ui.css`

一切挂载到 `<div id="ui-root">`(全屏,位于 WebGL 画布之上,仅在需要处响应 `pointer-events`)。
菜单背后 WebGL 场景保持渲染(大厅/吸引模式),因此菜单画面必须让 3D 内容可见
(玻璃/墨水面板,而非全屏不透明遮罩;配装界面右侧保留约 45% 空白给 3D 角色预览)。

```js
import { Menus } from './menus.js';
const menus = new Menus(rootEl, api);
menus.show(screen)        // 'loading' | 'title' | 'main' | 'loadout' | 'setup' | 'settings' | 'howto' | 'credits' | 'pause' | 'results' | null
menus.current             // 当前画面名称或 null
menus.setLoading(p, label)
menus.showResults(ResultsData)   // 然后 show('results')
menus.update(dt)
menus.handleKey(e) / 手柄导航: menus.nav('up'|'down'|'left'|'right'|'accept'|'back')
```
`api`(由 core 提供):`getSettings() setSettings(partial) getProfile() setProfileName(n) getLoadout() setLoadout({weapon})
weapons (WEAPONS) weaponOrder specials (SPECIALS) sub (SUB.bomb) maps (MAPS) difficulties (DIFFICULTY)
startMatch({ mapId, difficulty, duration }) resumeMatch() quitMatch() rematch() toMainMenu() onScreenChange(screen) playSound(name) version`。

```js
import { HUD } from './ui/hud.js';
const hud = new HUD(rootEl);
hud.setVisible(bool)
hud.update(dt, frame)        // 比赛中每帧,frame = HudFrame
hud.banner(kind, text)       // 'ready' 'go' 'one_minute' 'timesup' 'special' 'custom'
hud.countdown(n)             // 最后 10 秒的大号数字
hud.hitMarker('hit'|'kill')
hud.feed({ text, color, kind: 'kill'|'death'|'ally'|'info' })   // text: i18n 消息 id,或带插值名字的 { id, params }
hud.damage(amount0to1, colorHex)     // 屏幕边缘的敌方墨水涂抹,约 1.5s 内淡出
hud.showSplatted({ by, byColor, respawn })  // 死亡遮罩 + 倒计时圆环
hud.hideSplatted()
hud.judge({ colors:[a,b], percents:[pa,pb], names:[...] }) → Promise   // 比赛结束时的覆盖率揭晓(进度条填充、数字滚动、胜者重击)
```
HudFrame:
```js
{ time,                                   // 剩余秒数
  teams: [ { color, players: [ { name, alive, respawn, specialReady, isSelf } ] }, {...} ],   // 顶栏鱿鱼图标
  ink, inkLow, subCost,                   // 0..1 墨罐 + 炸弹消耗预览
  special, specialReady, specialActive,   // 0..1 大招槽
  hp,                                     // 0..1(低于约 40% 时屏幕边缘警告)
  weapon, charge,                         // 按武器切换准星样式;charger 显示蓄力环
  crosshair: { spread, onTarget },        // spread px;onTarget: 'enemy' | null
  map: { canvas, expanded, players:[{ x, y, team, isSelf, yaw, alive }] }, // canvas 由 core 绘制;x,y 为 0..1 画布空间
  markers: [ { x, y, name, color, onScreen, angle } ],   // 队友名牌(屏幕 px)/ 边缘箭头
  prompt: string|null,                    // 上下文提示:i18n 消息 id,或带插值名字/数字的 { id, params, kind? }
                                          // (kind 为其在 boss HUD 中分类,如 'turfTip')
  fps }
```
ResultsData:
```js
{ win, percents:[a,b], colors:[a,b], teamNames:[...],
  players: [ { name, team, weapon, turf, splats, deaths, isSelf } ],   // 8 条
  xp: { gained, levelBefore, levelAfter, xpBefore, xpAfter, xpToNextBefore, xpToNextAfter },
  mapName }
```
风格:俏皮、喧闹但干净、易读 —— 粗壮的展示字体(Titan One)、加粗的 Rubik UI 文本、墨团和涂鸦形状
(内联 SVG)、轻微倾斜、黑白 + 队伍色、每次状态变化都有带过冲的弹性弹簧动画、hover/按下状态带音效。
必须像一款发售级的主机游戏,而不是一个网页。

## 4. `src/fx/fx.js` + `src/world/environment.js`

```js
import { FX } from './fx.js';
const fx = new FX(scene, { quality });
fx.setCollider((from, to) => hit|null)   // hit = { point, normal } ;液滴碰到几何时停下/溅开
fx.onDropletLand = (point, normal, color, size) => {}   // 引擎为 paint:true 的液滴涂绘小墨渍
fx.burst(pos, normal, color, { count=12, speed=4, size=0.1, spread=0.9, gravity=1, paint=false })
fx.drop(pos, vel, color, { size=0.1, life=1.2, paint=false })
fx.ring(pos, normal, color, { radius=1.5, life=0.35 })
fx.explosion(pos, color, radius)          // 炸弹 / 猛击
fx.splatted(pos, color)                   // 角色炸成墨水
fx.wake(pos, dir, color, speed)           // 游动涟漪/尾迹,游动期间约每帧调用
fx.muzzle(pos, dir, color)
fx.spawnFlash(pos, color)
fx.rain(pos, radius, color, dt)           // 墨暴云下的墨雨线条(每帧调用)
fx.update(dt, camera)
fx.clear()
```
必须每帧零分配(池化的 InstancedMesh/points),限制存活粒子数,并且看起来湿润有光泽
(队伍色、沿速度方向拉伸、带小卫星液滴)。

```js
import { Environment } from './environment.js';
const env = new Environment(renderer, scene, { bounds: { minX, maxX, minZ, maxZ }, theme: 'day'|'sunset' });
env.sun                 // THREE.DirectionalLight(已配置 castShadow;引擎可收紧阴影相机)
env.hemi                // THREE.HemisphereLight
env.envMap              // PMREM 纹理 → 设为 scene.environment
env.fogColor
env.update(dt, camera)  // 动画:水/云/海鸥
env.setTheme(theme)
```
内容:带风格化云 + 太阳的渐变天空穹顶,环绕竞技场的动画风格化海洋(竞技场位于海港甲板上;
竞技场地面 y = 0,水面 y = -1.6;碰到水 = 被击杀),远处的天际线/起重机/灯塔/山丘剪影,
几只海鸥、浮标。不得包含任何位于可玩区域内的东西。


## v1.1 新增内容(完整签名见各文件头)
- **FX(src/fx/fx.js)** 扩充到约 45 个配方 —— footstep、land、jumpOff、formPop、dive、emerge、climbDrip、hitSplash、shotTrail、
  muzzle(pos, dir, color, kind)、chargeGlow、beamImpact、rollerSpray、flickCurtain、dangerRing、beepPulse、slamWave、
  rainSheet、superJump*、jumpMarker、ghost、seaSpray、glint…,外加立即模式的 `mark()` / `pillar()` 和
  `fx.stats()` / `fx.triangles()`。它们由 **src/fx/fxHooks.js** 驱动(`initFxHooks(G)` → `.update(dt)`),
  后者订阅事件总线(docs/EVENTS.zh-CN.md)并退回到轮询 actor 状态。
- **装饰物**:`decor.pulse(team, strength)` 让出生台闪烁(重生、超级跳回家)。
- **屏幕 FX(src/fx/screenfx.js)**:`new ScreenFX(R, G)` 通过 `R.setExtraPass(pass)` 安装一个后处理 pass
  (在调色 pass 之后、OutputPass 之前),并用 `update(dt, game)` 更新;它监听总线。强烈的效果随
  settings.cameraShake / 减弱动态(reduced motion)缩放。
- **渲染器**:`R.setExtraPass(pass)`、`R.setDynamicScale(s)`;environment 暴露 `env.grade`(按主题的调色),
  由渲染器自动应用。
- **HUD 样式**位于 styles/hud.css(由 styles/ui.css import)。
