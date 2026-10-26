# v1.0.14手机HUD视口读取优化

2026-10-26，v13真机方法级调查中Boss HUD平均约1.585ms；12秒CPU采样中，Boss HUD的_u视口读取累计约469ms。原实现反复在DOM写入后读取innerWidth/innerHeight，可能触发布局同步。采样开销和热状态影响整局帧率，不能把本批预计收益当作实测提升。

本批仅手机Boss HUD缩放/标记投影/播报定位及小地图界面复用视口尺寸，窗口resize和orientationchange时刷新。PC继续原读取与原视觉计算；没有降低渲染密度、抗锯齿、角色数量或模拟频率。缓存不改变尺寸公式，初次调用同步取实际视口，后续窗口事件更新。

验证：手机网页离线资源启动、四指移动/转视/开火、原生Pointer Events、前后台恢复、左手设置、区域结算、短对局结算与PC原默认入口回归通过，页面异常与资源失败为0；另验证900×420、760×360、1000×464下Boss HUD缩放与投影等同原公式，resize及时刷新。下一步从干净提交构建code14，真机重跑同操作与温度记录；此时尚未宣称真机帧率改善或稳定30帧。

## 真机结果与启动异常

- code14干净源码2ca848e；APK21,110,456字节，SHA-256为9d03cf2c25341556f9349847f94a035d18f1e235e18df1614ff92a2054ee7f1e。
- 安装后第一次启动再次出现shader编译成功/链接失败空日志。内部进入menu，但实际截图停在14%“搭建广场中”；WebView原生持续报Attempt to read from an uninitialized SharedImage，不能把内部Ready作为画面正常的证据。
- 异常会话中新建独立WebGL上下文调查时，Chrome_InProcGp线程进一步SIGTRAP；原生日志也含此前14:51/15:05的Crashpad记录。已保存本地phone-gpu-crash.log、phone-v14-startup-failure.json、phone-startup-flashing.png；尚未证实缓存、温度或本批HUD改动为根因，禁止称已修复驱动问题。
- 重新启动同一v14后完成真实一分钟对局采样：61.8555秒、1698帧、平均27.451FPS、p95=50ms、p99=66.7ms、100ms以上4帧。UI CPU p50=2.4ms/p95=4.7ms，v13短轮分别3.9/7.2ms；未固定温度/随机场景，不据两轮直接计算帧率提升。稳定30未通过。
- 下一批优先修复启动安全门槛：失败后不得标记Ready，并在WebView显示异常时增加原生错误窗口；底层图形异常继续调查。
