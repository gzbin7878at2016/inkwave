# v16图形初始化隔离诊断（待真机验证）

用户最新优先级：暂停Boss性能优化，先定位图形初始化失败。当前未确定根因，不能将问题直接归因于缓存、GPU过热、某一手机型号或旧WebView版本。

## 已确认的证据

1. ALP-AN00、Android14、Adreno730、WebView131.0.6778.260。v12/v14多次出现shader编译状态成功、链接失败、日志为空；内部Ready/menu与手机仍显示加载界面不一致。
2. WebView原生连续SharedImage未初始化读取错误；一次异常会话中，新建独立WebGL上下文进一步触发Chrome_InProcGp线程SIGTRAP。相同APK重启也出现过正常启动，故尚不能据单次恢复证明修复。
3. v15已增加启动门槛和原生错误窗口；浏览器故障注入验证不会Ready/完成启动。真机用户已看到原生图形失败提示，随后进程退出，未取得有效Boss数据。该轮USB成功上传未得到确认，电脑中止报告仍保留。
4. 系统只配置一个有效WebView提供者；未改系统驱动、开发者图形设置或清除应用数据。不能拿其他Chromium历史问题直接证明本机同一根因。

## 最小隔离方法

v16仅debug APK且显式ADB参数inkwave.graphicsProbe=true时加载本地graphics-probe.html。正常启动不进入诊断页，release构建忽略此参数。诊断页无Three.js、无场景、无角色、无大纹理或预热，只含DOM计数、Canvas2D纯色、单WebGL2上下文的全屏三角形与像素读回。不存在第二个并发WebGL上下文。

先基础语法检查、提交推送，再构建安装v16。设备连接并授权后运行：

```powershell
$env:ANDROID_SERIAL='A38YUT3C19022796'
$env:GRAPHICS_PROBE_RUNS='3'
node tools/check-phone-graphics.mjs
```

每次先force-stop，带参数启动新进程；读取窗口中的真实编译/链接状态、GL错误、像素、DOM刷新次数，收集USB截图，保存到releases/investigation/phone-minimal-graphics.json及同名前缀截图，然后关闭游戏。诊断资料通过USB直接采集到项目目录，不冒充游戏上传按钮测试。

判定：若最小页也失败，继续追踪WebView/驱动/原生合成路径；若连续最小页通过，再逐级增加游戏渲染器、后处理、场景预热做对照。一次通过不等于已确定根因；截图需与读回像素和DOM计数对应，内部JS成功不能替代手机画面证据。测试结束保持游戏关闭。

### 诊断连接修正

最小页首次3次采集均未连上调试目标，不能算GPU失败：原工具只选择https://localhost/，而loadDataWithBaseURL生成的调试目标实际为about:blank、标题“最小图形诊断”。已按当前应用PID下的确切URL/标题增加匹配；修正先提交，再重跑。未放宽到其他应用或任意标签页。

### 冷启动时序修正

已取得一次真实最小页通过（shader链接成功、GL错误0、像素64/191/128/255、Canvas2D正确）。另外两次在am start返回后立即查询PID时为空，属于采集未开始，不能算GPU失败。连接器增加最多5秒有限PID等待，先提交，再重跑三次；所有失败和原始记录仍保留本地。

### 正常入口对照采集

执行node tools/check-phone-startup.mjs，从普通游戏入口做3次冷启动，先等待PID和调试通道，启动只限当前游戏PID的原生日志采集；就绪或失败后保存网页报告/USB截图，尝试真实上传按钮，再关闭。数据为phone-full-startup.json及分轮log/png。先提交工具，再实际采集；与最小页比较，不能把“采集未开始”混为shader失败。
