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
