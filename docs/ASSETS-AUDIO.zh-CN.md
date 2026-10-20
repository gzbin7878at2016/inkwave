# 音频系统 —— 零音频文件,所有声音都是现场算出来的

> 目标读者:听说过 Web Audio API 但没用过的初学者。本文讲清三件事:**声音怎么合成、怎么组织、游戏里怎么被调用**。
> 配套阅读:[ASSETS.zh-CN.md](ASSETS.zh-CN.md)(总览) · [BOOT.zh-CN.md](BOOT.zh-CN.md)(启动流程)

---

## 0. 一句话事实

整个 `src/audio/` 目录只有 3 个 JS 文件、**没有任何 wav/ogg/mp3**。文件开头注释把话说死了([audio.js:30](../src/audio/audio.js#L30)):

> "No audio files: every sound is synthesized per play." —— 每次播放都是现场合成。

```
传统游戏:  音频文件 ──► 解码 ──► 回放
INKWAVE:   配方代码 ──► 现场建振荡器/滤波器 ──► 出声
            (零下载、零解码、零采样缓存)
```

代价与收益在 [ASSETS.zh-CN.md](ASSETS.zh-CN.md) §1 说过;本文专注"怎么做到的"。

---

## 1. 总架构:两条总线,一台合成器

### 1.1 声音在系统里的旅行路线

```
                 ┌────────── SFX 链(每次播放现场搭建)──────────┐
 合成器 voice    │  振荡器/噪声 → 包络 → (距离低通 → HRTF Panner) │
 (V 构建器) ───► │                    ↓  reverb 发送              │
                 │                 sfxIn → sfxBus ───────────────┤
                 └───────────────────────────────────────────────┤
                 ┌────────── 音乐链(音序器驱动)──────────────────┤
 乐器函数 ──────► │  mix → 高通 25Hz → glue 压缩 → 限制器 ────────┤
 (kick/bass/…)   │  musicBus → duckG(侧链闪避)→ master ──────────┤
                 └───────────────────────────────────────────────┘
                                                      ↓
                              master → 25Hz 高通(DC 安全)→ glue 压缩 → 限制器 → 扬声器
```

代码锚点:节点链搭建在 [audio.js:162-188](../src/audio/audio.js#L162);音乐内部链在 [music.js:1501-1506](../src/audio/music.js#L1501)。

**新手要懂的三个元件**(后文反复出现):

| 元件 | 是什么 | 类比 |
|---|---|---|
| `OscillatorNode` | 纯电子音源(正弦/方/锯齿/三角) | 口哨 |
| `GainNode` | 音量旋钮(可做包络:快起慢落) | 手指压音量键 |
| `BiquadFilterNode` | 音色滤波器(低通=闷毛巾盖住) | 捂住嘴改变音色 |

### 1.2 共享 DSP 核心

SFX 和音乐**共用同一套合成原语**——`music.js` 导出的 `V`(voice 构建器)类([music.js:262-392](../src/audio/music.js#L262)):一条链式 API 把振荡器/噪声/增益/滤波/声像连成图。常用复合积木:

```js
v.tone({ f: 440, f1: 880, a: 0.005, d: 0.12, peak: 0.5 })  // 带扫频的正弦音(音高滑动)
v.nz({ ft: 'bandpass', f: 1200, q: 1.2, d: 0.08 })          // 滤波噪声(打击感/气流声)
v.bub()                                                      // Minnaert 气泡音("plip")
```

包络(音量随时间的曲线)两种:打击式 `perc`、起-保持-释 `ahr`([music.js:215-245](../src/audio/music.js#L215))。

---

## 2. 一条音效的一生(以开枪为例)

### 2.1 定义:声明式配方 + 注册表

全部音效挂在一张全局注册表 `SFX` 上([audio.js:482-483](../src/audio/audio.js#L482)),用 `def(name, {...})` 登记,共约 **150 个**(分组见 [audio.js:2585-2609](../src/audio/audio.js#L2585))。一条 SFX 的形状:

```js
def('shoot_shooter', {            // 小绿枪开枪
  gain: 0.5,                      // 基础响度
  max: 6,                         // 同名 voice 同时存在上限(超出偷最老的)
  jitter: 0.06,                   // 音高随机抖动 ±6%(防机械重复感)
  minGap: 0.03,                   // 30ms 内同名合并(防 8 滴墨齐响炸音量)
  ref: 3,                         // 3D 定位音的参考距离(米)
  build(v, p) {                   // ★ 配方本体:v=V 构建器,p=最终音高
    v.tone({ f: 900*p, f1: 300*p, ... });   // "pew" 啾啾
    v.nz({ ft: 'bandpass', f: 2400, ... }); // 气动 "pshk"
    v.bub();                                // 气泡 plip
    // …shoot_shooter 实际叠了 7 层:见 audio.js:559-574
  },
});
```

**看真实配方**:[audio.js:559-574](../src/audio/audio.js#L559)——一枪是 7 层声音的叠加(snap 噪声 + 啾啾 + 气动 + 低频 thump + 湿 splort + 气泡 + 空气声),还用 `v.pick()` 在 3 套变体里随机选,连发时不至于像机关枪复读。

### 2.2 播放:调用链全景

```
玩家按鼠标
   │  actor 意图 fire
   ▼
武器 kit(如 bow.js:146)──► G.audio.play('bow_loose', { pitch, pos? })
   │                          ┌─ ① minGap 合并(几 ms 内同名只响一次)
   │                          ├─ ② 上限检查:每名字 max / 全局 48 voice,超了偷最老的
   │                          ├─ ③ 音高 = opts.pitch × (1 ± jitter)
   │                          ├─ ④ _voice() 搭图:3D 则串 低通+HRTF Panner,reverb 发送
   │                          ├─ ⑤ 执行 d.build(v, pitch) —— 配方现场"烹制"
   │                          └─ ⑥ v.finish():最后一个音源 onended 时自动拆全部节点
   ▼
扬声器
```

代码锚点:播放入口 [audio.js:325-376](../src/audio/audio.js#L325);偷最老 voice 的 `_steal()` [audio.js:307-313](../src/audio/audio.js#L307);自动拆图 [music.js:369-391](../src/audio/music.js#L369)。

**谁(play 的调用方)**:HUD 按钮音(main.js 注入)、主循环事件(命中/受伤/游泳/击杀,[main.js:571-647](../src/main.js#L571))、武器 kit 本体。判据惯用 `heard(a)` = `a.isLocal || a._nearCamera?.()`——远处的战斗不出声,省 voice。

### 2.3 3D 定位音:两层距离衰减

`play(name, { pos })` 带坐标就是 3D 音([audio.js:253-262](../src/audio/audio.js#L253)):

1. **PannerNode 几何衰减**:`panningModel='HRTF'`(头相关传输函数,戴上耳机能听出前后),`distanceModel='inverse'`。
2. **空气吸收模拟**:每 voice 串一个低通滤波器,截止频率随距离衰减 `22000 × 0.5^((d−10)/13)`([audio.js:62,230](../src/audio/audio.js#L62))——**远处爆炸听闷闷的,近处才脆**,这就是"空气感"的来源。混响发送量也随距离缩。

听者位置每帧与相机同步([main.js:1289-1292](../src/main.js#L1289))。本地玩家刻意不传 pos(不做定位,直接糊脸)。

---

## 3. 音乐:文本乐谱 → 编译 → 音序器实时合成

音乐**不是随机游走**,是正经的"乐谱驱动"([music.js:966-1219](../src/audio/music.js#L966) `SONGS` 表):

### 3.1 乐曲的"源代码"长什么样

```js
battle: {                                    // 对战主题
  bpm: 132, swing: 0.12, key: 'E minor',
  sections: {
    A: { bars: 8, chords: 'Em7 Cmaj7 Am7 B7',
         drums: 'X.......X.......',          // 16 字符 = 一小节 16 分音符,X=重击 .=空
         bass:  'R R 5 R R O 3 5',           // R=和弦根音 5=五度 O=高八度(自动映射音高)
         lead:  'B4/2 E5/2 r/1 G5/2 …' },   // 文本旋律:音名/时长
  },
  order: ['A','A','B','A'], loopFrom: 'A',   // 段落顺序与循环点
}
```

四个巧妙设计([music.js:719-910](../src/audio/music.js#L719)):

| 机制 | 效果 |
|---|---|
| 鼓 pattern 是 16 字符字符串,字符映射力度表 | 敲鼓像打字 |
| 贝斯 pattern 字符即**和声指令**(R/5/3/7/n) | 换和弦进行,贝斯自动跟着对 |
| `voice()` 自动把和弦音分配到舒适音域 | 不用手写 voicing |
| `parsePhrase('B4/2 …')` 文本旋律 | 旋律可以读、可以 diff |

### 3.2 编译与播放

```
SONGS 表(乐谱源码)
   │  compileSong()  【music.js:772-910】
   ▼
bars[小节].ev[16分音符] 事件表(编译期就把循环点/riser/跨小节对齐算好)
   │  MusicEngine:25ms tick 的 lookahead 音序器(0.16s 窗口)
   │  【music.js:1325-1421, 1350-1363】tick 用 Web Worker 计时,后台标签页不漂移
   ▼
窗口内事件 → 乐器函数(kick/snare/bass/guitar/pad/lead/brass…【music.js:400-644】)
   → 每个事件现场建 V 合成出声
```

### 3.3 游戏如何指挥音乐

| 时机 | 动作 | 代码 |
|---|---|---|
| 进比赛加载世界时 | `preload('battle')` / `preload('battle_final')` 预缓冲(录音存在时无缝接管) | [main.js:776](../src/main.js#L776) |
| 比赛开始 | `_playMusic('battle')`(淡入 1.2s) | [main.js:656](../src/main.js#L656) |
| 最后一分钟 | 事件触发切 `battle_final`——同 bpm 时**对齐小节线 + riser 衔接**,不是硬切 | [music.js:1598-1609](../src/audio/music.js#L1598) |
| 战况变化 | `setIntensity(0..1)` 按 smoothstep 权重表增减声部:平静只剩 hats,高潮全开 | [music.js:1242-1304](../src/audio/music.js#L1242) |
| Boss 模式 | `bossAudio.js` 用 `music.remap` **劫持** battle 请求改路由——调用方零改动 | [bossAudio.js:99-105](../src/audio/bossAudio.js#L99) |

### 3.4 录音覆盖机制(可选)

`songs/manifest.json` 可以用真实录音覆盖任意曲目 id([music.js:1434-1450](../src/audio/music.js#L1434)):有录音走 `<audio>` 元素进同一 music bus,没有就回落合成乐谱([music.js:1588-1595](../src/audio/music.js#L1588))。仓库默认无录音,全合成。

---

## 4. 武器自带音效:模块副作用注册

`kits/bow-sfx.js` 展示了一种干净的协作模式([bow-sfx.js:5-17](../src/game/kits/bow-sfx.js#L5)):

```js
import { SFX } from '../../audio/audio.js';
const def = (name, o) => { SFX[name] = o };   // 与 audio.js 内建 def 同格式
def('bow_draw', { loop(v, p) { … return { pitch(q, now) } } });  // 拉弓:循环声+实时变调
def('bow_loose', { build(v, p) { … } });                          // 放箭:一次性
```

**加载链**(纯副作用,模块求值即注册):

```
main.js import './game/kits/index.js'
   └─► kits/index.js import './bow.js'      【kits/index.js:16】
        └─► bow.js import './bow-sfx.js'    【bow.js:58】
             └─► 模块求值 → 7 个 def() 写入全局 SFX 表
kit 逻辑里 G.audio.play('bow_loose', …) 按名播放 【bow.js:146】
```

拉弓是个**循环声**(`loop` 返回 `{pitch(q,now)}` 句柄):按住鼠标期间持续响,松手时实时把频率/增益往上推再释放([bow-sfx.js:20-44](../src/game/kits/bow-sfx.js#L20))。

---

## 5. 性能与防炸音量(工程亮点速览)

| 问题 | 解法 | 锚点 |
|---|---|---|
| 首次访问自动播放被浏览器禁 | AudioContext 惰性创建,首个用户手势才 init(幂等) | [audio.js:152-159](../src/audio/audio.js#L152)、[main.js:536](../src/main.js#L536) |
| 8 滴墨同时命中 → 音量爆炸 | `minGap` 同名合并 + glue 压缩 + 末端硬限制器 | [audio.js:334-335](../src/audio/audio.js#L334) |
| 连续合成建节点怕泄漏 | voice 上限(全局 48/每名字 max)+ 偷最老 + `onended` 自动拆图 | [audio.js:58,271-279](../src/audio/audio.js#L58) |
| 湿声循环(气泡/雨)逐帧合成太贵 | 离线把颗粒纹理渲成**无缝循环 Buffer** 缓存,空闲切片预热 | [audio.js:69-119,159-163](../src/audio/audio.js#L69) |
| 音乐盖过音效 | duck(侧链闪避)+ 音乐总线固定 0.42 让位 | [audio.js:434-456](../src/audio/audio.js#L434)、[music.js:1505](../src/audio/music.js#L1505) |
| 离线测试 | 构建器接受任意 `BaseAudioContext`,`tools/audio-test.mjs` 用 OfflineAudioContext 离屏渲染测电平 | [audio.js:130-138](../src/audio/audio.js#L130) |

---

## 6. 新手总结

1. **资产即配方**:一条 SFX = 元数据 + `build(v,p)` 配方函数;一段音乐 = 文本乐谱 + 编译器。
2. **注册表解耦**:所有东西按名注册(`SFX` 表/kit 副作用),调用方只认名字,不认实现。
3. **播放是流水线**:`play()` 六步(合并→限流→变调→搭图→烹制→自毁),每步都为"不卡、不炸、不漏"服务。
4. **3D 音的秘密是"双层衰减"**:几何衰减之外,再叠一个距离低通模拟空气吸收。
5. **音乐像游戏引擎一样分系统**:乐谱(数据)→ 编译器(离线)→ 音序器(调度)→ 乐器(合成),与渲染管线的"资产→加载→场景→GPU"神似。

**动手实验**:打开控制台 `__G.audio.play('shoot_shooter')`、`__G.audio.play('splat_small')` 逐个试听 150 个配方;`__inkwave.freeze()` 后音乐照放——音序器跑在 Web Worker 里,和渲染暂停无关。
