# Boss渲染移入Worker（OffscreenCanvas）可行性评估（2026-10-27）

用户选择把“使用更多手机核心”作为主方向，并允许“保留大部分美术表现”的取舍。本文只做评估与真机关卡工具，**未改产品代码**。

## 结论

- 技术上可行，但不是“把canvas转给Worker”这么简单：渲染与模拟有8处同步耦合（下文），需要场景镜像层。
- 两种架构都是数周以上的工程；先用新工具在真机证明“另一核心并行承担负载时主线程不变慢”，再投入。
- “保留大部分美术”能换CPU的取舍在现有低画质下已基本用尽（反射关、阴影默认关且低档半频、渲染分辨率约为面板的59%、HUD逐组件与动画接管均已做过）。
- 与BOSS-60FPS-WORKPLAN一致：先完成P01/P02的模拟长帧归因，本工具只提供“整体Worker化是否值得”的真机证据，不跳过其计划直接重构。

## 依据

v54真机（test54/OPUS-PERFORMANCE-60FPS-COMPARISON）：30帧上限旧/新均约29.6FPS、P95 33.4ms，差0.043不证收益；60帧上限热机约36～37FPS、P95约50ms，即主线程约27ms/帧，离16.7ms预算差约10ms——这正是整体Worker化（B）才可能覆盖的量级，A约−4～−8ms不足以单独达到60。

主线程预算（BOSS-MAIN-INVESTIGATION 30秒V8，约760帧）：`_frame`含17334ms、`match.update`约7252ms（≈9.5ms/帧）、渲染约5044ms（≈6.6ms/帧）、`character.update`含2828ms、`_updateHud`1978ms（≈2.6ms/帧）；`(program)`11536ms不可全部归属。整HUD隐藏时GPU主机线程58→15%、RenderThread 42→10%、Compositor 41→9%（BOSS-DOM-INVESTIGATION）。

本机无头Chrome真实Boss局（dist-mobile、tidewater、playing后20秒，软件渲染，计数有效、耗时不代表手机）：

| 项目 | 数值 |
|---|---|
| 场景对象 / 可见 | 1273 / 982 |
| 网格 / 蒙皮网格 | 338 / 101 |
| 骨架 / 骨骼 | 9 / 796 |
| 实例网格 / 容量 / 存活 / 数据 | 14 / 2374 / 682 / 187612字节 |
| 绘制调用 / 三角形 | 111 / 803214 |
| 材质 / 着色程序 / 几何 | 159 / 93 / 187 |
| 982个世界矩阵拷贝（桌面） | 0.124ms/帧 |

每帧需同步（代码清点，估计）：骨骼≈57KB、变换≈10KB、uniform/可见性≈5KB、实例30～150KB，合计≈100～220KB/帧（30帧≈3～7MB/s）。涂墨图集quad最坏≈1.5MB/帧，必须改为发送splat事件而非quad。

## 必须处理的耦合

1. 涂墨图集由模拟驱动GPU绘制：`paint.flush`每帧（main.js:1526），`_pushQuad`满6000时在模拟中途`_drawQuads`（paint.js:799）。→ 图集与绘制整体进Worker，主线程只发splat事件；CPU网格`paint.grid`留主线程（小地图/玩法）。
2. 镜头墨滴`lens.render`每帧画入RT（screenfx.js:584，main.js:1493）。→ 进Worker。
3. 渲染回写模拟：角色`_camHook`的`onBeforeRender`写`_rendered`决定LOD切换（character.js:685/1194/1222）、LOD读`G.renderer.getSize`（character.js:1177）、战斗中未预热角色回退`warmAll()`编译绘制（character.js:1194）。→ 主线程改用自身视锥/尺寸判定，预热必须在加载期保证。
4. `mobileGpu.recover`每帧依赖渲染时同步标记的着色器错误，可能重建合成器并再次`R.render`（main.js:1571，mobileGpu.js:33-66）。→ Worker内处理，主线程只收状态。
5. 玩法读取渲染侧矩阵：枪口/手/头骨骼world矩阵（weapons.js:1065、character.js:1551-1583）、Boss 10个命中球由骨骼`matrixWorld`构建（bossModel.js:146/201，boss.js:225-310）、相机`matrixWorldInverse`现由render刷新（瞄准/HUD投影）。→ 主线程仍须自己`updateMatrixWorld`，这部分不能移走。
6. DOM来源纹理：canvas纹理（murals/props/decor/bossMats/lobby）、SVG图标`new Image()`（specials.js:809，返回标记每帧`needsUpdate` specials.js:860-886）、光照图`TextureLoader`（main.js:409）。→ 改OffscreenCanvas/ImageBitmap。
7. 尺寸/DPR：renderer.js读`devicePixelRatio`/`innerWidth`，`setSize`默认写`canvas.style`。→ 主线程传尺寸，Worker`setSize(w,h,false)`。
8. 工具：正式跑分工具包装`R.render`/`renderBufferDirect`、读`info`与程序表；tools中10个包装`renderBufferDirect`、13个同步读像素、17个`getContext()`；产品内`mobileProfiler`也包装`renderBufferDirect`。→ 需Worker侧仪表，现有方法轮全部要改。

## 两种架构

| | A 仅渲染进Worker | B 模拟+渲染进Worker |
|---|---|---|
| 主线程保留 | 模拟、HUD、音频、输入、矩阵更新 | DOM HUD、输入、WebAudio、原生插件 |
| 主线程预计节省 | 渲染JS≈6.6ms中除矩阵更新外部分＋GL命令编码原生耗时（未单独测）−镜像收集≈1～1.5ms → 估计净−4～−8ms/帧 | 主线程只剩≈8～10ms（HUD JS＋样式/布局/绘制），Worker≈20～24ms并行 |
| 主要工作 | Worker内用同样代码重建几何/材质/纹理（含`onBeforeCompile`补丁）、镜像协议、上述8项 | 数百模块的`window/document/localStorage`/Capacitor访问代理；`hud.js`改读每帧状态快照；音效事件跨线程；PC保持原路径→双架构 |
| 量级 / 风险 | 数周 / 中高 | 月级 / 高 |

另有C：按小地图Worker的方式把自包含子系统逐个搬走（`fx.js`只依赖three/config、不写玩法状态，可由生成事件驱动），每项约0.5～2ms，风险低、可逐项验收。

## 真机关卡：并行余量

手机受热限，主线程在大核7、音频在4～6。把工作移到其他核心可能增加总功耗、触发降频，必须先实测。新增 `BOSS_WORKER_LOAD_MS`（1～30整数，独占一分钟方法轮）：开局在主线程预热后校准矩阵内核每毫秒迭代数；15～45秒每个游戏帧把“相当于主线程N毫秒”的固定工作量交给Worker，上一份未完成就跳过并计数，绝不排队；45秒后停止。报告`workerLoad`含派发/完成/跳过、Worker耗时与往返P50/P95、`speedRatio`（Worker核心耗时/主线程校准耗时），时间线带`workerLoadPhase`。

建议轮次：`BOSS_METHOD_PROBE=1 BOSS_TEST_SECONDS=60 BOSS_WORKER_LOAD_MS=8`、`=16`、`=24`各一轮，按ABBA与同起始温度，另配同名`BOSS_TRACE_PROBE`原生sched确认Worker线程所在核心与CrRendererMain运行时间。按60帧目标另跑`BOSS_TEST_FPS=60`的`BOSS_WORKER_LOAD_MS=6`、`=10`、`=14`（预算16.7ms）。

判定（全部满足才进入A原型）：
1. loaded窗口平均帧间隔不比baseline/restored均值差超过3%，P95不差超过5ms；
2. 24ms档（60帧轮为14ms档）`skipped`接近0（Worker能在一帧预算内完成）；
3. `speedRatio`≤1.4；
4. 整轮温升不高于同温基线轮。

不满足则放弃整体Worker化，转C。

验证：`EDGE_PATH=/usr/bin/google-chrome node tools/check-boss-worker-load-probe.mjs`连续3次通过（阶段边界、暂停不派发、不排队、负载随请求增加、主线程派发P95≤0.1ms、Worker/URL无泄漏）；以`toString()`注入页面的方式另行冒烟通过。低占空比时桌面核心降频会让轻负载偏慢，手机同样可能，需看`speedRatio`而非只看墙钟。
