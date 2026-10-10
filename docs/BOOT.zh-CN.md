# 游戏启动加载全流程 —— 新手向代码导读

> 目标读者:**刚拿到这个项目、想搞清"从双击图标到进入标题画面,每一毫秒发生了什么"**的初学者。
> 本文不假设你懂 Web 或图形学,每个概念第一次出现都会解释,并且**每一步都锚到具体代码**(文件:行号),你可以边读边跳转验证。
> 配套阅读:[ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md)(整体架构)、[INK.zh-CN.md](INK.zh-CN.md)(墨水系统)、[RENDERING-UE4.zh-CN.md](RENDERING-UE4.zh-CN.md)(渲染对比)。

---

## 0. 一张总时间线(先建立全景)

从你双击 `play.bat` 到看到标题画面,全部事情可以压缩成这条时间线:

```
双击 play.bat
   │
   ▼
Electron 启动,注册 app:// 协议,加载 index.html          【electron/main.cjs】
   │
   ▼
浏览器引擎解析 index.html:4 个空 div + import map + 1 个 module 脚本   【index.html】
   │
   ▼
下载并执行 src/main.js → 最后一行 new Game().boot()       【main.js:1414】
   │
   ▼
boot():一段 async 函数,一边干活一边推进度条              【main.js:56】
   ├─ ① 先把加载界面 itself 显示出来(UI 优先)
   ├─ ② 创建渲染器 / 场景 / 相机
   ├─ ③ 动态 import 加载五大模块(网络请求!)
   ├─ ④ 程序化生成纹理 + 建造世界(几何/物理/墨水/导航)
   ├─ ⑤ 环境光照 + 特效/武器系统
   ├─ ⑥ 预热:把每种特效放一遍 + 全场景着色器编译
   └─ ⑦ 模拟 3 帧 → "就绪!" → 标题画面
   │
   ▼
主循环 _loop 接管,游戏开始呼吸                          【main.js:1069】
```

**先记住一个反直觉的事实**:这个项目几乎没有"资产包"可下载(美术全是代码生成的),所以加载条的大头不是网络下载,而是**①下载 JS 代码本身、②跑程序化生成算法、③编译 GLSL 着色器**。

---

## 1. 第 0 步:Electron 与 index.html —— 一切从一个网页开始

你双击的 [play.bat](../play.bat) 只干了一件事:启动 Electron(一个"自带 Chrome 的桌面程序壳")。Electron 注册了一个自定义 `app://` 协议来伺服游戏文件([main.cjs:31-33](../electron/main.cjs#L31-L33)),然后加载 [index.html](../index.html)。

打开 index.html,你会看到它**小得惊人**(35 行),但对理解启动至关重要:

```html
<div id="app"></div>        <!-- 游戏画布(Canvas)挂这里 -->
<div id="ui-root"></div>    <!-- 所有菜单/HUD 挂这里 -->
<div id="fade"></div>       <!-- 开场黑屏,加载界面就绪后淡出 -->
<div id="boot-error"></div> <!-- 启动失败时的红底错误框 -->
```

三个新手必看细节:

1. **import map**([index.html:20-22](../index.html#L20)):`"three": "./vendor/three/build/three.module.js"` —— 这是"零构建"的魔法。代码里写 `import * as THREE from 'three'`,浏览器按这张表翻译成真实的文件路径,**不需要 webpack/vite**。
2. **预加载字体**([index.html:9-10](../index.html#L9)):加载条上的艺术字是 woff2 字体,提前 `preload` 防止闪烁——这是全项目仅有的几个"真实资产"之一。
3. **module 脚本**([index.html:33](../index.html#L33)):`<script type="module" src="./src/main.js">` —— 浏览器从这里开始下载 main.js **以及它 import 的所有依赖**(递归地、一个文件一个 HTTP 请求)。**main.js 顶上那 40 来行 import,就是启动阶段的"第一梯队下载"**。

> 💡 小知识:`#fade` 是页面打开时的全屏黑层,60ms 后淡出([index.html:31](../index.html#L31))——这样你不会看到"白屏 → 黑屏 → 加载条"的闪烁,而是柔和地淡入。

---

## 2. 第 1 步:main.js 的最后一行 —— 发动机点火

跳到 [main.js](../src/main.js) 的最末尾([main.js:1414-1419](../src/main.js#L1414)):

```js
const game = new Game();
game.boot().catch((e) => { ... });   // 失败 → 显示 #boot-error 红框
```

就两行。`Game` 类的定义在 [main.js:55](../src/main.js#L55),`boot()` 是 async 方法。**从这一刻起,后面所有事情都是 boot() 函数体内的顺序执行**——这就是为什么读启动流程只需要精读一个函数。

---

## 3. 第 2 步:为什么加载条"秒出现" —— UI 优先策略

boot() 开头([main.js:59-87](../src/main.js#L59))做的第一件事,你可能想不到:**先把加载界面本身做出来**。

```js
// UI first so the loading screen shows immediately        【main.js:76】
const [menusMod, hudMod] = await Promise.all([loadModule('./ui/menus.js'), ...]);
this.menus?.show('loading');                               // ← 进度条上场
const progress = async (p, label) => { this.menus?.setLoading(p, label); await nextFrame(); };
await progress(0.05, 'Mixing ink…');                       // 调配墨水中…
```

**为什么要这样设计?** 如果先建 3D 世界再显示 UI,玩家会面对好几秒的白屏。所以策略是:只加载最小的 UI 模块(menus + hud)→ 立刻显示加载画面 → 然后在**加载画面的掩护下**干所有重活。这是一个通用的产品原则:**让"正在加载"本身尽快可见**。

### 进度条的"小秘密":它是表演,不是测量

看 `setLoading` 的实现([menus.js:310-313](../src/ui/menus.js#L310)):

```js
this._loading = { target: 0, shown: 0, label: '…' };       // 【menus.js:253】
setLoading(p, label) { this._loading.target = clamp(p); }  // 只记"目标值"
```

注意:`target` 和 `shown` 是**两个变量**。boot() 推进度时只改 `target`,而每帧动画里进度条实际显示的是 `shown` —— 它**缓动追赶** `target`([menus.js:867-871](../src/ui/menus.js#L867))。加上 `nextFrame()` 让浏览器每步至少渲染一帧,你看到的丝滑滚动其实是"固定里程碑 + 缓动动画"。

> 🎯 那些俏皮话(调配墨水中…/教鱿鱼游泳中…)在 [zh.js:107-113](../src/i18n/zh.js#L107),每种语言一份,进 `t()` 函数翻译。

---

## 4. 第 3 步:渲染三件套 —— 舞台、镜头、胶卷

进度 0.05 之后([main.js:89-102](../src/main.js#L89)):

```js
this.R = new Renderer(app, this.settings);   // ① 渲染器 = "胶卷+冲印厂"
const scene  = new THREE.Scene();            // ② 场景   = "舞台"
const camera = new THREE.PerspectiveCamera(fov, 宽/高, 0.15, 6500);  // ③ 相机 = "镜头"
this.input = new Input(...);                 // 键鼠/手柄输入
```

- **Renderer** 封装在 [renderer.js](../src/core/renderer.js),构造时创建 WebGL 上下文、配置 HDR 半浮点渲染目标、搭好 后处理链(MSAA → GTAO → Bloom → 调色 → 输出)。详见 [RENDERING-UE4.zh-CN.md](RENDERING-UE4.zh-CN.md)。
- **三个数字的相机**:`0.15` 是近裁剪面(离你多近开始看得见),`6500` 是远裁剪面(天际线的位置),`fov` 视野角来自设置。

此阶段结束:进度 0.05 → **0.15「搭建广场中…」**。

---

## 5. 第 4 步:加载"别人写的模块" —— 真正的网络请求

[main.js:105-111](../src/main.js#L105):

```js
const [charMod, fxMod, envMod, audioMod, musicMod] = await Promise.all([
  loadModule('./game/character.js', true),   // 角色(程序化捏人)
  loadModule('./fx/fx.js', true),            // 特效
  loadModule('./world/environment.js', true),// 环境(天空/太阳)
  loadModule('./audio/audio.js', true),      // 音效合成
  loadModule('./audio/music.js', true),      // 音乐
]);
```

- **`import()` 动态加载**:和顶部的静态 import 不同,`import('./game/character.js')` 是**运行到这一行才发 HTTP 请求**。五个模块 `Promise.all` 并行下载。
- **`loadModule` 的容错设计**([main.js:46-53](../src/main.js#L46)):每个模块加载失败不会让整个游戏崩掉,而是降级到 `dev/stubs.js` 的"假实现"。这是"模块按作者划分、允许缺席"的协作契约——详细背景见 [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md)。

此阶段结束:进度 0.15 → 进入**最重的沉默期** → **0.4「灌注海港中…」**。

---

## 6. 第 5 步:建造世界 —— 加载条背后真正的大活(0.15 → 0.4)

这两句之间([main.js:122-127](../src/main.js#L122))藏着整个加载过程的一半工作量:

```js
this.murals = await createMuralTexture();               // 画壁画图集(Canvas 逐笔画)
this.texlib = await createTextureLibrary(...);          // 程序化纹理库(逐纹素烘焙)
await this._buildWorld(map);                            // ★ 建造世界(下面整节都是它)
```

### 6.1 先画"皮肤":两张程序化纹理

这个项目没有贴图文件,所有表面纹理都是启动时用 Canvas/Shader **现画**的:

- **壁画图集**([murals.js](../src/world/murals.js)):关卡里的涂鸦、招牌,一张大 Canvas 逐笔画上去,之后作为"画在墨水下层"的贴图喂给关卡材质。
- **纹理库**([texlib.js](../src/world/texlib.js)):混凝土、防滑槽、锈痕……每个纹素要评估 2×2 子采样做预滤波——是真实的 CPU/GPU 计算,不是"读文件"。

### 6.2 `_buildWorld`:九个零件的装配线

`_buildWorldNow`([main.js:224-269](../src/main.js#L224))按严格顺序装配,**顺序本身就是设计**:

```
顺序  零件                    代码                          为什么必须在这步
──────────────────────────────────────────────────────────────────────────
 1   道具(set dressing)      PropKit 循环 add()           道具交还碰撞盒,要先进关卡
 2   关卡几何                 new Level(layout, colliders)  面/块/坡的定义
 3   物理                     new Physics(level)           射线/碰撞查询的加速结构
 4   烘焙 AO 光照图           _loadLightmap()              ★ 唯一的网络下载(PNG+json)
 5   墨水图集                 new PaintSystem(...)         GPU 图集 + CPU 判定网格
 6   关卡材质                 createLevelMaterial(...)     把 2/4/5 缝进一个着色器
 7   关卡网格                 new THREE.Mesh(geometry, mat) 上桌
 8   装饰                     new Decor(scene, level)      不参与碰撞的点缀
 9   导航图 + 小地图           NavGraph / Minimap           给 Bot 和玩家指路
```

逐个说新手该关注的点:

**① 道具先行**([main.js:234-244](../src/main.js#L234)):注意 `colliders` 数组——道具(箱子、栏杆)不仅是个"摆设",它会**交还碰撞盒**,和地形一起进入物理系统。如果顺序倒了,箱子就没有碰撞。

**④ 光照图:全项目唯一像样的"资产下载"**([main.js:272-287](../src/main.js#L272)):

```js
const meta = await (await fetch(`assets/lightmaps/${layoutId}.json`)).json();
if (level.layoutHash !== meta.hash) { console.warn('stale — re-run tools/bake-ao.mjs'); return null; }
const tex = await new THREE.TextureLoader().loadAsync(`assets/lightmaps/${layoutId}.png?h=${meta.hash}`);
```

两个工程细节值得学:带 **hash 校验**(关卡布局改过,旧烘焙图直接作废降级,不会显示错误光影);**下载失败优雅降级**(没有光照图就用全亮,游戏照样能跑)。

**⑤ 墨水图集**([paint.js](../src/world/paint.js)):这里创建的是整个游戏的心脏——GPU 大图集(视觉)+ CPU 判定网格(玩法)的双轨系统。这一步只是**分配**图集,第一滴墨要等玩家开枪。新手请直接读 [INK.zh-CN.md](INK.zh-CN.md)。

**⑥ 关卡材质**([levelMaterial.js](../src/world/levelMaterial.js)):把"墨水纹理 + 光照图 + 壁画 + 纹理库"缝进一个 `MeshPhysicalMaterial`,手段就是前文渲染对比里讲的 `onBeforeCompile` 锚点注入。注意这里同时做了**两份**:普通版 + 镂空格栅版(`grate: true`)。

### 6.3 为什么换地图也要重新加载?

`_buildWorld` 开头有个"短路"判断([main.js:218](../src/main.js#L218)):

```js
const worldKey = variantKey(layoutId, MAP_LAYOUTS[layoutId], dressingFor(layoutId), mode);
if (this.worldKey === worldKey) { this.mapDef = map; return; }   // 同一个世界 → 啥也不干
```

所以:开第一局必建世界;**重赛同一张图,这段直接跳过**(秒进);换图/换模式才重建——这就是你对战时偶尔看到加载条的原因。而联机大厅的地图会在菜单闲置 2.5 秒后**后台偷偷预建**([main.js:182](../src/main.js#L182)),第一次进大厅才不卡。

此阶段结束:进度 **0.4「灌注海港中…」**。

---

## 7. 第 6 步:环境与武器系统(0.4 → 0.7)

[main.js:131-159](../src/main.js#L131):

```js
G.env = new envMod.Environment(G.renderer, scene, {...});   // 天空、太阳、环境反射
G.projectiles = new Projectiles(scene);                     // 子弹
G.subs = new SubSystem(scene);                              // 副武器(炸弹…)
G.specials = new SpecialSystem(scene);                      // 大招
G.fx = new fxMod.FX(scene, {...});                          // 特效池
this.showcase = new Showcase(...);                          // 菜单里旋转展示角色的展台
installNet();                                               // 联网模块(装上也行,离线不理它)
```

这一段的共同点是:**都在 new 对象,没有重计算**。每个系统构造时只搭好骨架(对象池、场景挂点),真正的弹药/粒子要等游戏中才产生。这是游戏开发的通用模式——**加载期建池,运行期复用**。

此阶段结束:进度 0.55 → **0.7「调校触手中…」** → 选队伍配色、绑事件、开 attract 模式(菜单背后那场 Bot 表演赛)。

---

## 8. 第 7 步:预热 —— 把卡顿消灭在加载条里(0.85 → 0.93)

这是全篇技术含量最高的一段,也是之前 GLSL 讨论的正主。

```js
await progress(0.85, 'Warming up…');
this._warmup();                                             // 【main.js:297】
try { await G.renderer.compileAsync(scene, camera); }       // 【main.js:169】
```

**问题**:着色器(GPU 程序)是**第一次被用到时才编译**的。如果不处理,你比赛中投出第一颗炸弹的瞬间,GPU 要现场编译炸弹的着色器——画面冻结几十到几百毫秒。

**对策分两层**:

1. **`_warmup()`:把每个"第一次"提前演一遍**([main.js:297-310](../src/main.js#L297))——在屏幕外(y = -30,玩家看不见的地方)把每种特效各放一遍:爆炸、涟漪、枪口焰、出生闪光……连炸弹这种"懒创建"的材质也做两个替身球挂进场景。副作用就是:所有该创建的对象、该编译的程序,**此刻全部触发**。
2. **`compileAsync`:一次性编译全场景**([main.js:169](../src/main.js#L169))。它利用浏览器扩展 `KHR_parallel_shader_compile` 让多个着色器**并行编译**,加载动画照常跑;编完再统一检查。

> 💡 对比:UE4 用"离线排列组合编译 + 磁盘缓存 + PSO 预热"解决同一问题;网页游戏没有文件系统,只能把编译挤进加载条。详见 [RENDERING-UE4.zh-CN.md](RENDERING-UE4.zh-CN.md) 第 3.7 节。

此阶段结束:进度 0.93 → **1.0「就绪!」**。

---

## 9. 第 8 步:最后三帧与"就绪!"

[main.js:173-180](../src/main.js#L173):

```js
for (let i = 0; i < 3; i++) { this._frame(1 / 60); await nextFrame(); }  // 先跑 3 帧
await progress(1, 'Ready!');
await new Promise((r) => setTimeout(r, 250));   // 停 250ms,让你看清"就绪!"
this.menus?.show(params.has('skipTitle') ? 'main' : 'title');            // 标题画面
```

**为什么先跑 3 帧再宣布就绪?** 跟新车出厂前要怠速运转一个道理:让所有系统的"第一帧初始化"(纹理上传、矩阵缓存、attract 模式的首帧模拟)在玩家看见标题**之前**发生,而不是标题画面渲染到一半突然卡一下。

250ms 的停顿是纯节奏设计——防止"就绪!"一闪而过。

---

## 10. 加载之后:主循环接管

boot() 的最后一行([main.js:184](../src/main.js#L184))把控制权交给 `_loop`:

```js
_loop(ts) {
  requestAnimationFrame((t) => this._loop(t));   // 先预约下一帧(循环的发动机)
  const cap = this.settings.fpsCap || 0;
  if (cap && ... 时间没到) return;               // FPS 上限:没到间隔就跳过
  let dt = this.timer.getDelta();                // 距上一帧的真实秒数
  if (this.frozen || this._building) return;     // 冻结调试 / 换世界期间暂停模拟
  this._dynRes(dt);                              // 动态分辨率:掉帧就自动降渲染精度
  this._frame(dt);                               // ★ 一帧的全部工作
}
```

- `requestAnimationFrame`(简称 rAF)是浏览器的"每帧叫我一次"回调,**和显示器刷新同步**(60Hz 屏每秒 60 次)。
- `_frame(dt)`([main.js:1124](../src/main.js#L1124))是每一帧真正干活的地方:输入 → 网络 → 比赛模拟(物理不够快会自动拆子步)→ 弹道/特效 → 相机 → 渲染。
- `dt`(delta time)是帧间隔秒数,**所有游戏逻辑都用它换算**——这就是为什么 30 帧和 144 帧下手感一致。

到这里,"加载"就完成了它的历史使命:世界已建成、着色器已备好、主循环已开始呼吸。从此每一帧只是 `_frame(dt)` 的循环往复。

---

## 11. 自己动手:启动流程的调试工具

这个项目给学习者留了不少后门:

| 工具 | 用法 | 输出 |
|---|---|---|
| **逐阶段计时** | 控制台输入 `__inkwave.bootMarks` | `[["Mixing ink…", 42], ["Building the plaza…", 310], …]` 每个标签的毫秒时间戳 |
| **总耗时** | `__inkwave.bootMs` | 整个 boot() 的毫秒数 |
| **URL 参数** | `?skipTitle` | 跳过标题画面直接进主菜单([main.js:180](../src/main.js#L180)) |
| **URL 参数** | `?autostart=180&map=lockgate` | 跳过所有菜单直接开赛(180 秒局),适合自动化测试([main.js:185](../src/main.js#L185)) |
| **URL 参数** | `?shadercheck` | 打开同步着色器错误检查(默认关掉防卡顿,调试用) |
| **单步仿真** | 控制台 `__inkwave.freeze()` 后 `__inkwave.step(16.7)` | 冻结后按固定 60Hz 逐帧推进,做确定性测试([main.js:196-204](../src/main.js#L196)) |
| **故意画 400 滴墨** | `__inkwave.api.paintRandom()` | 观察墨图集效果 |

> 💡 最有意思的是第一条:把 `bootMarks` 的时间两两相减,你就得到**你自己机器上**每个阶段的真实耗时——可以和第 0 节的预测对比,看看着色器编译在你的显卡上占了多少。

---

## 12. 推荐学习路径(按代码阅读顺序)

如果你想彻底吃透启动流程,建议按这个顺序读,预计一个下午:

1. **[index.html](../index.html) 全文(35 行)** —— 建立"网页即入口"的直觉;
2. **[main.js:1414](../src/main.js#L1414) → [main.js:56](../src/main.js#L56) `boot()`** —— 跟着进度条标签走一遍主线,遇到 `await` 就跳进去看那个函数;
3. **`_buildWorldNow`(第 6 节那张表)** —— 逐个零件跳:`Level` → `Physics` → `_loadLightmap` → `PaintSystem` → `createLevelMaterial`;
4. **`_warmup` + `compileAsync`** —— 理解"预热"为什么存在(配合 [renderer.js:86](../src/core/renderer.js#L86) 的注释);
5. **`_loop` / `_frame`** —— 看一帧的完整旅程,启动故事就闭环了;
6. **最后**:打开控制台,用 `bootMarks` 在你自己机器上验证每一步的耗时,把"读到的"变成"测到的"。

---

## 13. 一页纸总结

| 阶段 | 进度 | 标签 | 干什么 | 代码 |
|---|---|---|---|---|
| 入口 | — | — | Electron/app:// → index.html → main.js | [index.html](../index.html)、[main.cjs](../electron/main.cjs) |
| UI 优先 | 0.05 | 调配墨水中… | 先显示加载条,再干重活 | [main.js:76-87](../src/main.js#L76) |
| 渲染三件套 | →0.15 | 搭建广场中… | Renderer / Scene / Camera / Input | [main.js:89-102](../src/main.js#L89) |
| 模块下载 | →0.15 | 搭建广场中… | 动态 import 五大模块(容错降级) | [main.js:105](../src/main.js#L105) |
| 建造世界 | →0.4 | 灌注海港中… | 程序化纹理 + 九零件装配线 | [main.js:122-127](../src/main.js#L122)、[main.js:224](../src/main.js#L224) |
| 环境武器 | →0.7 | 调校触手中… | 天空/弹道/副武器/大招/特效池 | [main.js:131-159](../src/main.js#L131) |
| 预热编译 | →0.93 | 预热中… | 屏幕外放遍特效 + compileAsync | [main.js:297](../src/main.js#L297)、[main.js:169](../src/main.js#L169) |
| 收尾 | →1.0 | 就绪! | 跑 3 帧 → 标题 → 主循环接管 | [main.js:173-184](../src/main.js#L173) |

**三条带走的核心思想**:
1. **加载条是舞台指示器**——百分比是写死的里程碑,先让"正在加载"可见,再在掩护下干重活;
2. **没有资产就造资产**——下载的是代码,耗时的是生成与编译;
3. **把第一帧的卡顿全部提前**——预热、预编译、预跑帧,玩家看不到任何"第一次"。
