# Boss第35批：补齐独立镜头墨水首用准备

## 依据与范围

第33批手机方法调查在实战16.619秒首次创建镜头墨水程序（顶点shader包含iA/iB），随后还有回旋镖和大招壳的新程序。按累计实际帧间隔对齐，镜头墨水附近为41.6/41.7ms，其他资源附近约50～75ms，未直接对应所有≥100ms卡顿。因此本批补齐确定漏掉的资源准备，不预先宣称它是全部卡顿根因或能单独稳定30帧。

镜头墨水LensInk自带Scene、Camera、HalfFloat目标和220实例缓冲，不在世界特效树中；旧通用准备只扫描世界特效，加载期的屏幕合成Pass也不会主动绘制空墨珠池。

只在手机当前正式Boss加载期间增加一步，使用真实LensInk材质、实例属性及其自己的场景/相机/目标格式，借现有4×4隔离目标完成程序链接接口、缓冲首用及一次最小实例绘制。保留原画面算法、颜色、粒子数量、分辨率及正常add/render入口；不调用受击、技能、声音或涂墨事件。PC、普通局和演示不进入该步骤。准备时G.mode仍可为menu，按当前Boss身份校验。

## 实现与失败处理

- 入口src/platform/mobileBossLensPreparation.js，接入mobileBossPreparation.js的可见加载进度。
- 使用真实实例缓冲，临时最小实例数在同步绘制后恢复；不往真实镜头纹理写入准备画面。
- 沿用mobileWarmup的目标/视口/裁剪/清屏及阴影状态恢复；让帧后使用当时状态，不恢复旧视口。
- 身份取消、镜头对象/renderer被替换时不写完成记录；真实首绘失败进入已有加载失败流程，不虚报完成。
- 完成记录只含程序编号和计数，不保留对局对象或大数组。程序由原ScreenFX长期材质持有，不额外持有资源副本。
- 方法调查才记录首次实际镜头绘制的程序编号/次数；正式测试只在结束时读取准备和当前程序，避免给每帧额外加探针。

## 验证命令和边界

1. node tools/check-mobile-boss-lens.mjs：真实ScreenFX/LensInk/WebGL，首次可见墨珠9216个HalfFloat通道逐项一致，准备程序与实际程序相同；真实目标不被写入，粒子/池/缓冲/材质与GL状态不变；PC/普通/演示隔离、预先/让帧取消、让帧后的视口变化、绘制异常恢复通过。
2. npm run build:mobile后node tools/check-mobile-boss-gameplay.mjs：真实完整Boss开局必须有prepared记录和一次绘制；小地图候选保持null；原12小怪准备、两轮复用、后台取消回菜单及shader错误检查。
3. npm run check：JS语法。
4. 中文提交并push用户fork后，从干净提交构建v1.0.35，记录签名、SHA-256及网页/APK逐字节一致。
5. 一分钟方法调查设置BOSS_REQUIRE_LENS_PREPARATION=1、BOSS_REQUIRE_LENS_DRAW=1，确认正常操作产生真实镜头墨水且首次程序编号与准备一致；无V8/音画旁路。自然结束后USB上传核对关闭。
6. 两局无方法探针的60秒正式测试，保持固定2倍、SMAA、scale1、8人及玩法，分别报告温度、平均FPS/p95/p99/≥100ms，不隐去热机低值。正式轮BOSS_REQUIRE_LENS_DRAW=0，保持BOSS_REQUIRE_LENS_PREPARATION=1。

当前功能尚未提交构建/真机验收；当前手机仍为v34并关闭。稳定30未达，60未开始；小地图缓存仍撤回。真机结论后续独立提交。

基础检查最终结果：真实WebGL、重新构建成品网页的Boss加载/短时实战/取消回归均通过，232个JS语法通过。

## 真机结果与当前交付

干净功能源码10c2a1488cd5a6cdee333b00588bce14af3c213d，v1.0.35/code35，APK21,140,454字节，SHA-256 a7c0ab365976cbca423089c92173ea1543f9701a54fdfe741bf80831dc16ec39。v2签名验证通过，385个网页资源与APK逐字节一致，设备仍为ALP-AN00/Adreno730/WebView131。

调查轮：镜头程序准备ID102，实战18.451秒首次真实绘制ID102，累计896次绘制；没有镜头墨水新程序，真实复用通过。仍有其他技能/物理材质新程序，不能称所有首用已处理。回菜单原混响/Output恢复通过，USB保存后关闭。

| 轮次 | 帧/墙钟秒 | 平均FPS | p95/p99 ms | ≥100ms | 温度 |
| --- | --- | ---: | --- | ---: | --- |
| 方法调查，不计成绩 | 1773/62.4346 | 28.398 | 50.1/66.6 | 5 | 41→45°C |
| 正式1，无方法/V8/音画旁路 | 1715/64.8981 | 26.426 | 58.4/75.1 | 9 | 44→45°C |
| 正式2，无方法/V8/音画旁路 | 1686/64.9257 | 25.968 | 58.4/75.1 | 5 | 46→47°C |

三局设定60秒，实际墙钟受原模拟dt钳制影响完整保留。固定2倍/scale1/SMAA/8人，原物理/AI/伤害/音画保持，shader失败0，小地图缓存null。三局真实USB核对源码并force-stop关闭。上传依次：INKWAVE-logs-20261026-142952-884180-32d0dc07.json、INKWAVE-logs-20261026-143159-490031-d171912b.json、INKWAVE-logs-20261026-143350-157751-c0afe7f2.json。

本批证明镜头首用复用，不证明严格整局提帧，稳定30未通过，60未开始；不隐去热机低值。

## 修正后的渲染分组调查

另用一局60秒方法调查，在实际Renderer.render前隐藏单组、同步绘制后恢复，确认ablationApplied：海面Sea、七组远景CitySkyline/Terrain/FarScenery/FerrisWheel/Trees/Sailboats/Gulls、props均实际设为不可见。HUD段只隐藏HUD。碰撞、AI、音效、人数和输入继续正常；结束恢复并上传关闭。该轮25.962FPS等所有数字都不是原画质成绩。

每段约10秒、每2秒时间线快照的FPS算术均值依次：baseline27.75、sea28.2、background25.8、props24.0、HUD28.4、恢复25.0。props段三角形快照均值约316154，其他多数段约76～83万，但隐藏组没有形成统一明显提帧；战斗负载/热状态/相位不同，不能据一轮直接削减场景或宣称HUD唯一瓶颈。USB日志INKWAVE-logs-20261026-143602-467823-cac4134a.json，已核对关闭。过程中另有一次只读native状态和ADB显示查询，属于调查干扰。

实战16.557秒只读原生getState：requested/owned=true、preferredRefreshRate=60，observedRefreshRate仍120；ADB显示当前1200×2652、modeId2、renderFrameRate120，支持同分辨率60Hz的modeId1，确认原偏好在这次实战没有切换。WebView自身估算vsyncMs16.667不等于面板实际刷新率。下一项可独立试验窗口同分辨率60Hz modeId请求，退出/暂停恢复原偏好，不改全局设置或Canvas密度。Android官方说明两种偏好均可能被系统忽略，必须真机读状态，不能把请求当生效：[窗口参数说明](https://developer.android.com/reference/android/view/WindowManager.LayoutParams)。
