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

### 已取得的隔离结果与下一实验

- 最小图形页最终连续3次通过，3张USB截图正常；前面的目标URL/PID采集失败不参与此判定。
- 普通启动对照首轮先出现SharedContextState context lost / GL_UNKNOWN_CONTEXT_RESET_KHR，后出现Adreno IOCTL_KGSL_GPU_COMMAND errno35 Resource deadlock、EGL_BAD_PARAMETER和SharedImage错误；后续也出现异常。故“shader链接失败/进度闪烁”并非最早错误。
- 下一实验用node tools/check-phone-environment.mjs，分别ENV_PROBE_MODE=skip-cloud和full。在最小页同一个WebGL上下文中只创建Environment，逐步记录云烘焙、PMREM反射、远景反射开始/结束；诊断专用gl.finish把GPU工作归属到步骤，不用于正常游戏或性能评分。每次采集当前应用PID原生日志，保存后关闭。先提交工具，再执行，不能提前认定某一步为根因。

## v17单变量对照（未验证）

独立Environment在skip-cloud和full两种实验均未直接触发GPU重置，故没有证据证明云shader本身一定错误。但full实验原生日志出现约1649ms的GPU/窗口等待，普通启动同类等待约2022ms后发生上下文重置，值得验证组合负载峰值。

本批只把手机离屏云烘焙2048×640改为512×160（像素工作量1/16），半浮点格式、shader、环境反射尺寸、2倍画面/SMAA/人数保持；分条坐标改为读取真实目标尺寸，PC仍2048×640且原计算一致。此为单变量负载对照，提交后构建并跑普通入口3次冷启动，未取得结果前不称根因已确认或已修复。若仍重置，继续其他候选，不能用提示窗替代修复。

### v17首轮结果与画面复核

只缩小手机云纹理后，普通入口3次均Ready，shader失败0，USB上传成功并关闭；就绪11.0～11.9秒。首张截图恰逢标题页纯色过场，尚不作为完整视觉通过。冷启动采集工具增加就绪后2秒等待，再提交并重跑3次，检查真实标题画面及原生GPU重置是否消失。PC和手机纹理尺寸/实际画面密度由独立浏览器检查复核。

### 截图采集上限修正

v17追加3次均正常Ready且shader失败0、原生日志无GPU重置；但更完整的截图超过Node默认1MiB缓冲导致ENOBUFS，未保存新图/未完成上传。旧同名PNG不可用来判断这轮真实画面。ADB采集上限改为16MiB，先提交，再重新进行完整截图与上传闭环；这3次只计启动状态成功，不计完整验收。

## v17最终冷启动闭环（2026-10-26）

- 只改变手机云烘焙尺寸后，最终3次普通入口就绪分别11,297/10,974/10,593ms，shader失败0，原生日志GPU重置/资源死锁/EGL_BAD_PARAMETER/SharedImage异常均0。
- 三张新的USB截图均成功保存（约3.5MB），已检查标题页、场景与版本v1.0.17；不是旧纯色过场PNG。每轮真实上传回执及电脑JSON源码4b11cec/code17核对通过，并关闭游戏。此前另6次启动状态也正常，但含过场截图或缓冲失败，只作为补充观察，不替代最终完整3次。
- 电脑浏览器确认手机云目标与uRes均512×160、实际渲染密度2；PC目标与uRes仍2048×640。格式、着色器、反射分辨率、人物数量均未改。
- 因果判断：证据支持启动环境云烘焙的组合负载峰值触发本机GPU重置，随后才产生空shader链接错误、合成失效与旧进度闪烁。单变量降载后本轮复测不再复现；独立Environment单次并未失败，因此不能称已精确证明驱动内部死锁机制，也不能保证所有GPU/地图/长期运行均已覆盖。
- 用户数据/系统设置/WebView提供者未修改；游戏已按要求关闭。下一步可用一分钟真实Boss切图验证初始化边界，稳定30帧另行验收。

### APK交付记录

版本1.0.17/code17，功能源码4b11cecadcc3e74888e10b85365d6950a621e95c，trackedChanges=false。APK为releases/INKWAVE-android-test17-4b11cec.apk，21,116,068字节，SHA-256为4a68459d5aa5b2afee0ffb1c3fa9a5c2341481c14aaf38e6370e5569cc5c3da0。

签名SHA-256为201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69，与本机前版一致。apksigner验证、364个网页资源与APK逐字节核对、最小图形本地资源存在及APK哈希均通过；已安装当前手机，真机初始化通过，Boss长期性能未通过。APK/原始JSON/截图仍不入Git，换电脑需要单独迁移或重建。
