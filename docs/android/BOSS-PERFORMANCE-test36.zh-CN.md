# Boss第36批：提前请求同分辨率60Hz窗口模式

## 实测依据

第35批实战16.557秒，原生getState显示requested/owned=true、preferredRefreshRate=60，但observedRefreshRate仍120。ADB确认当前物理1200×2652、modeId2=120Hz；支持同分辨率modeId1=60Hz。WebView估算vsync16.667ms不能代替物理面板刷新率。这是更换窗口请求方式的依据，不是已证明的帧率收益。

Android官方建议仅改刷新率时优先preferredRefreshRate，但该方式在这台设备的实测没有生效。本批独立试验preferredDisplayModeId，并严格限定为当前物理宽高一致的60Hz支持模式；系统仍可忽略这个偏好，必须读取实际状态：[Android窗口参数说明](https://developer.android.com/reference/android/view/WindowManager.LayoutParams)。

## 修改范围与恢复规则

1. 只影响Android手机正式Boss、目标30/60帧；PC、普通对局、演示和更高帧率不请求。
2. 请求提前至真实加载预检（存在准备令牌、init且未失败）及正式开场intro，避免模式切换落在首个战斗帧。不更改模拟时钟或原30帧限速器。
3. 只从getSupportedModes选择与当前physicalWidth/Height完全一致、距60Hz小于0.5Hz的模式，优先最接近60Hz；不改变手机全局设置、密度、分辨率、Canvas像素比或画质。
4. 其他模块已有preferredDisplayModeId非零时不覆盖；无屏幕/无同尺寸60Hz模式时保持原状态。
5. 保存原窗口刷新率和模式ID。暂停/结算/菜单/销毁时，只有字段仍等于本插件所写的值才逐字段恢复；其他模块改过的值不覆盖。重新前台按当前Boss状态再次申请。
6. 桥调用继续串行、去重，不逐帧发原生调用，不在失败时刷屏重试。getState新增首选/原始/请求/实际modeId及实际物理尺寸，查询只读，不把请求回执当成系统采纳。

## 基础验证

- node tools/check-native-boss-display.mjs：JDK编译实际BossDisplayPlugin，以最小Android/Capacitor替身执行；验证同尺寸模式选择、实际120Hz不伪称60、已有偏好、缺失模式/屏幕、读状态无副作用、暂停/恢复/销毁、外部修改及逐字段所有权。该测试不能模拟系统是否采纳。
- node tools/check-mobile-boss-display.mjs：15类场景、加载→开场→实战去重、取消回菜单、快速暂停/桥串行、失败不逐帧重试、非原生隔离通过。
- 重新构建成品网页后的check-mobile-boss-gameplay.mjs：真实Boss加载/短时实战、12个小怪准备与两轮回收、后台取消恢复通过，未发现新增shader/页面错误；小地图候选仍关闭，镜头预备保留。
- npm run check通过233个JS文件。真实Android API编译由后续干净APK构建验证。

## 真机执行与验收

先中文提交推送，再干净构建v1.0.36，记录源码/签名/SHA-256和网页资源逐字节匹配。手机已安装版本仍为v35，当前游戏关闭，尚无v36真机结论。

第一局设置60秒、BOSS_METHOD_PROBE=1、BOSS_VERIFY_DISPLAY_LIFECYCLE=1、BOSS_VERIFY_BOSS_EXIT=1，保持BOSS_REQUIRE_LENS_PREPARATION=1及所有音画旁路/小地图缓存/计算对照为0。开局前、实战5秒和40秒读取原生状态及物理尺寸；20秒后实际按Home、核对后台原窗口字段恢复，再启动同一个游戏并点击真实继续按钮，核对重新申请。实际间隔（包括后台调查干扰）保留，整局不作正式成绩；自然结算后返回菜单核对原字段，再USB上传核对并关闭。系统是否采纳60Hz如实记录，不强行改全局刷新设置。

若功能/尺寸/恢复通过，再运行两局BOSS_METHOD_PROBE=0、BOSS_VERIFY_DISPLAY_LIFECYCLE=0的60秒正式测试：固定2倍、SMAA、scale1、8人、原物理/AI/伤害/音画，分别记录温度、FPS、p95/p99及≥100ms，逐局上传核对关闭。稳定30未通过前不进入60FPS目标，也不把面板60Hz等同于游戏60FPS。

## 首次真机调查未完成及工具修正

v36已从干净源码3d13ca3f7193bfe4412f12943f29e6d49d406aaa构建安装，APK21,141,006字节，SHA-256 60456902fedc552c9014cceee73e9ba450ef93ff936d7b7b649b253303fa57d6，v2签名通过，385个网页资源逐字节匹配。

实战5秒及约20秒均显示：请求modeId1、preferredRefreshRate60，但实际modeId2/120Hz，物理仍1200×2652。该设备没有采纳新模式偏好，不能称已锁60Hz或提帧。

20秒Home调查，原生foreground/owned变false，窗口两字段恢复0；但700ms时网页hidden=false、paused=false，未出现继续按钮，调查中止，不是完整60秒成绩。真实USB日志INKWAVE-logs-20261026-144721-452430-edbcc52c.json核对源码后已关闭。

查本机固定依赖代码：Capacitor BridgeActivity在onStop发App.isActive=false，在onPause调用插件pause；AppPlugin另有pause/resume事件，当前网页监听appStateChange。不能仅凭700ms推定整个Home/Stop过程已完成，也不能断言一定是网页缺陷。工具改为等待实际暂停（最多24次×250ms加查询），同时读取原生App.getState、BossDisplay状态、网页needsResume/suspended/paused；用App.isActive而不是document.hidden认定后台，避免WebView可见性实现差异。始终在finally回到游戏前台；确实没有暂停则保留状态并失败，不能调用suspend伪造通过。只改调查工具，安装APK仍为3d13ca3；再次调查前中文提交推送。

## 等待实际后台后的真机结果

使用已推送a00e843的调查工具，安装APK仍为干净功能源码3d13ca3。等待实际onStop/App状态后后台调查通过：App.isActive=false、hidden/suspended/paused/needsResume=true，native.foreground/owned=false，窗口模式/刷新偏好均恢复0。返回前台后真实继续按钮出现，自动点击后正常游玩，native重新申请modeId1。之前700ms调查未完成不足以认定产品暂停缺陷，本批没有修改原暂停逻辑。

**实际模式不能概括为全程60Hz**：实战5秒、Home前仍120Hz；后台及返回前台后变为60Hz，40秒与退出时也为60Hz，物理始终1200×2652。回菜单请求/owned=false、两个窗口字段恢复0。由于之前v29单纯刷新偏好也曾在回前台后观察到60Hz，不能把这次后半段60Hz直接当作modeId方案相对旧版的因果收益。系统仍可忽略窗口偏好，不改全局刷新设置来制造成绩。

| 轮次 | 帧/墙钟秒 | 平均FPS | p95/p99 ms | ≥100ms | 温度 |
| --- | --- | ---: | --- | ---: | --- |
| 生命周期/方法调查，不计成绩 | 1787/64.7767 | 27.587 | 50.1/83.3 | 11 | 42→46°C |
| 正式1，无方法/V8/切后台/音画旁路 | 1712/65.3221 | 26.209 | 58.4/75.0 | 7 | 43→45°C |
| 正式2，无方法/V8/切后台/音画旁路 | 1685/65.4211 | 25.756 | 58.4/75.0 | 10 | 46→47°C |

正式局不人为切后台促进模式切换，也未额外查询实战显示模式；因此不声称正式局全程面板60Hz。全部固定2倍/scale1/SMAA/8人、原音画/物理/AI/伤害，shader错误0，镜头预备保留，小地图候选关闭。每局设定游戏时钟60秒，原dt钳制、生命周期调查影响按实际记录保留，不压缩墙钟。三局USB核对源码后关闭，上传依次：INKWAVE-logs-20261026-145240-432903-3c1c39dc.json、INKWAVE-logs-20261026-145707-917336-d81dfb32.json、INKWAVE-logs-20261026-145856-101165-c2671eef.json。

当前安装v1.0.36源码3d13ca3，游戏关闭；功能边界/尺寸/恢复通过，未证明整局提帧，稳定30仍未通过，60未开始。不能只报生命周期通过而隐藏普通启动的低帧结果。

下一项依据来自当前固定Three.js源码：SMAA边缘检测通过step得到0/1再相乘，输出vec4(edges,0,0)，现中间目标是RGBA HalfFloat。先调查仅手机Boss将边缘辅助目标改为更紧凑的格式，保持全尺寸、三阶段SMAA、原权重/场景HDR缓冲和算法；PC/普通局保持。需要真实WebGL及手机逐像素比较、完整FBO/resize/取消/退出恢复、按实际纹理格式估算存储和正式热机验证，未验证前不改成品，也不预先宣称无损或提帧。不要同时降低SMAA权重精度或主渲染分辨率，保持单变量。
