# v57 无诊断测试功能的手动游玩包

用户2026-10-28要求打包并覆盖安装到已连接手机，供自行游玩。本批只拆分交付构建，不恢复性能优化或自动对局。

## 构建范围

- v1.0.57/code57，`tools/build-android.ps1 -Manual`生成签名release变体；沿用本机原证书，允许覆盖安装并保留存档，不是应用商店发布签名。
- 手动包在编译期移除诊断记录/导出/上传、MobileProfiler、测试全局对象与debug操作、URL自动开局/自动玩家、模拟大厅和网络延迟注入。原网页/诊断构建默认仍保留原开发能力，PC效果不变。
- 原生GameDiagnosticsPlugin和graphics-probe仅位于debug源码/资源集，release Activity没有注册或图形探针入口；手动包关闭WebView远程调试和诊断用明文回环地址。
- 用户追加要求默认最高60帧：手动包首次覆盖安装迁移为60帧上限、固定2倍高清/SMAA、关闭自动降清晰度和FPS叠字；保留档案及触控偏好，后续仍可手动选择30/60。正常玩法、v55/v56功能修复和真实图形失败安全停止提示保留。
- 基础检查后先中文提交推送，再从干净源码构建；签名、包内容、USB覆盖安装及标题页检查待完成后单独记录。不会以手动包命名或隐藏按钮代替实际代码排除检查，不启动Director或性能局。

## 交付验收

待构建安装后记录源码提交、是否干净、APK字节数/SHA256、签名、测试模块排除、启动与手机状态。APK与原始检查记录留本机releases。

## 最终APK与安装进度

- 源码：`2327c33b29b0c45e94eaef28d2f508cf9ac4bf6f`，先中文提交推送后构建，trackedChanges=false。
- 文件：`releases/INKWAVE-android-manual57-2327c33.apk`，v1.0.57/code57，18,275,569字节。
- SHA256：`d166228f621ac0b75795cf8f274c1e6b5a5e6de744a68561125fab2add7da09d`。固定下载副本 `releases/mobile-install/INKWAVE-latest.apk` 哈希相同。
- release变体v2签名验证通过，证书SHA256 `201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69`，沿用手机原证书。Manifest无application-debuggable。
- APK中393份网页文件与dist-mobile逐字节匹配；build-info确认manual/diagnostics=false/干净源码，Capacitor明确关闭WebView远程调试。DEX不含GameDiagnosticsPlugin或inkwave.graphicsProbe，资源不含graphics-probe页面、diagnostics.js、mobileProfiler.js、net/mock.js或tools目录。
- 干净源码最终构建315份JS检查、传输回归、手动产物排除检查与第二次真实Edge启动/设置迁移检查通过；未跑性能局。
- 手机串号A38YUT3C19022796。初次streamed安装失败未返回具体包管理原因；读取包列表时默认跨用户查询触发user10权限错误，明确主用户0后可查询到原应用，但随后的主用户覆盖重试时USB已断开，ADB找不到设备。安装未完成，已请用户重新连接；不卸载、不清数据、不重启驱动或无限重试。真机标题页验收待连接后补充，不能称已安装。

## 提交前检查

314份JS语法和移动传输回归通过；325份手动网页代码/页面的测试模块及入口排除扫描通过。真实Edge加载手动产物通过：标题页启动，带autostart/autopilot/netmock/netlag等测试URL也不自动开局，无诊断对象/按钮、采样器、游戏debug操作、特效test或Boss假场景demo；覆盖旧30帧设置迁移为60帧/高清2倍，灵敏度1.7保留，用户之后改30并重载仍为30。仅启动与设置检查，没有运行性能对局，不代表真机帧率或完整玩法验收。原音频前台挂起保护改从正常G.game上下文读取，避免去掉调试全局对象后丢失该保护。
