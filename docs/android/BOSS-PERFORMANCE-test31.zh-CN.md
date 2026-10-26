# Boss性能第31批：SMAA最后混合与输出合并

## 问题与目标

v30正式26.882/26.952FPS仍未稳定30，不能把组件优化当成绩。本批只减少手机Boss后处理的一次全屏绘制，不动分辨率、SMAA边缘/权重/混合算法、调色顺序、8人、规则或PC效果。原路径为场景/调色/屏幕效果→SMAA三阶段→Output色调映射与输出色域；新路径仍同顺序，只把Output的原库语句接到第三阶段混合之后。

## 实现与注意点

- MobileSMAAPass移到独立平台模块，原三阶段/材质命名/实际像素取整保持。合并材质使用RawShaderMaterial，防止Three自动再次注入输出函数；直接复用内置OutputShader色调映射语句与颜色函数，同步所有原支持的toneMapping/outputColorSpace/exposure。
- 仅手机平台标记、当前真实非演示Boss、已在加载期准备且match身份相同、mode=match时启用。未准备、普通对局、菜单或PC走原SMAA+Output；Output原本被外部关闭时不擅自增加输出转换。离开Boss时原输出pass恢复。
- 必须在EffectComposer计算最后一个enabled pass之前切换enabled；否则可能把线性HDR图直接交给屏幕。SMAA纹理/真实尺寸uniform仍共享原对象；resize、动态设置及曝光不使用过期值。
- 加载遮罩内4×4目标执行真实绘制、检查程序接口/链接，持有同一个材质到实战，避免首用重编译。让帧后才保存GPU状态，取消不覆盖用户刚改的窗口；目标/视口/裁剪/清屏/纹理引用异常后恢复，准备失败回原路径，不关闭shader诊断。
- 取消/异常清除匹配match的启用资格，旧局不能关闭新局；重建画质链时释放新材质并还原原Output，不创建独立游戏循环。

## 基础验证

`node tools/check-mobile-boss-output.mjs`在真实WebGL中执行32组对照：8种色调映射、2种输出色域、2种实际尺寸/DPR，包含HDR高光、斜边/细线、透明度；8位像素最大差≤1，来自省掉中间half-float写回的舍入差，不宣称浮点逐位相同。退回原路径后逐字节一致。离屏half-float最大差0.00048828125，动态曝光/纹理与尺寸共享通过。

参考场景1遍+原SMAA3遍+Output1遍=5遍，合并后=4遍，**只证明少1遍，不是整个游戏提速20%**。加载准备的program.id与首次上屏一致；实际Renderer.render的切换顺序、失败回退、窗口改变后取消、PC/普通/演示/旧局隔离与释放通过。

Boss准备、真实开场/短时玩法/小怪复用及后台取消回菜单回归通过；通用语法检查227文件通过。以上不是手机FPS成绩。

## 真机执行

1. 基础检查后中文提交并push用户fork、核对远端；干净源码构建v1.0.31/code31，签名/资源逐字节与SHA-256记录后ADB覆盖安装。
2. 一局60秒方法轮，所有音画隔离开关清零，确认fusion.ready/enabled=true、OutputPass disabled、实际SMAA/2倍/8人和准备程序已复用；自然结束后原quitToMenu恢复Output enabled/fusion disabled及原混响，然后USB核对关闭。本轮不计成绩。
3. 两轮无探针60秒正常移动/开火/跳跃/潜墨/副武器/特殊输入，记录温度/平均/p95/p99/≥100ms；每局自然结束、USB上传核对源码后关闭。
4. 结果独立中文提交，不将pass减少或桌面像素通过称为稳定30。30未达标前不进入60目标。

## 真机结果

干净功能源码`0b59a2f1801fef9c3cf9913155da7a2930dc0324`推送后构建，trackedChanges=false。v1.0.31/code31，APK`releases/INKWAVE-android-test31-0b59a2f.apk`，21,135,517字节，SHA-256 `97d295be15d9ecaeae304a11c763690256b5b3e1d1b46f2ad3a93eed79022655`；v2签名、227文件语法/网络、381网页资源逐字节核对通过。仍为HONOR ALP-AN00/Adreno730/Android14；读取系统属性SoC=SM8475、platform=taro、low_power=0，未改手机全局省电/性能设置。

| 轮次 | 实际秒数/帧 | 平均FPS | p95/p99毫秒 | ≥100ms | 电池温度 |
| --- | --- | --- | --- | --- | --- |
| 方法/截图/退出验证，不计成绩 | 61.4808/1797 | 29.229 | 49.9/58.4 | 5 | 38→43°C |
| 正式1，无探针/隔离 | 61.9061/1798 | 29.044 | 50/58.4 | 2 | 41→44°C |
| 正式2，无探针/隔离 | 62.7941/1761 | 28.044 | 50.1/66.8 | 4 | 44→45°C |

三轮均为游戏时钟60秒、正常移动/开火/跳跃/潜墨/副武器/特殊输入、2倍/scale1/SMAA/8人；墙钟受原dt钳制延长，如实记录。每轮自然结束、USB落盘核对源码后关闭并验证进程退出。**稳定30未通过，60未开始**；不同温度/阵容，不能把相对v30较高数字当严格因果提帧证明。

USB原件依次为`INKWAVE-logs-20261026-131549-183372-5cbc40a7.json`、`INKWAVE-logs-20261026-131909-443418-e4d1cdd3.json`、`INKWAVE-logs-20261026-132049-757779-c965415f.json`。本地电脑报告phone-boss-v31-{output-probe-exit,full-1,full-2}.json；v31-output-phone-state.json与v31-output-phone.png保留配置与画面，不随Git同步。

三轮fusion.ready/enabled=true、OutputPass.enabled=false、shaderFailures=0。方法轮加载programId98，实战实际programId98，SMAA相关晚程序0；后两轮加载程序分别96/98。方法轮截图未见明显缺色/缺场景，但不能代替所有GPU兼容性验收。自然结束后原quitToMenu验证Output enabled/fusion disabled，原混响恢复2条及1.5/2.2秒，USB核对关闭。

模拟调查真实3553次match.update/1798次画面更新，character.update28095次、累计4666.5ms（含嵌套/等待，不是全部纯CPU）；两物理子步保持原规则。后续可定位表现层重复工作，但不能直接跳物理/AI或改变枪口位置。

## 补充对照与当前热点

已用原签名debug包ADB覆盖降回v30，仅作对照、不清档；完整上传关闭后立即恢复v31并复测。固定下载页/构建记录仍指v31，当前实际安装也已恢复v31，游戏关闭。

| 轮次 | 实际秒数/帧 | 平均FPS | p95/p99毫秒 | ≥100ms | 电池温度 |
| --- | --- | --- | --- | --- | --- |
| v30原包对照，无探针 | 61.9649/1789 | 28.871 | 50/58.4 | 3 | 41→45°C |
| 恢复v31后复测，无探针 | 63.4310/1726 | 27.211 | 50.1/66.7 | 6 | 45→46°C |
| v31方法/V8采样，不计成绩 | 66.9219/1649 | 24.641 | 58.4/83.4 | 11 | 42→45°C |

对照实际日志源码1baf5a7、fusion=null/Output enabled；复测0b59a2f、fusion enabled/Output disabled。仍有温度、阵容和动作轨迹差异，没有严格因果提帧证据；不能只报告最高29.044而隐藏热机27.211。上述各轮自然结束、USB源码核对后关闭。USB原件依次`INKWAVE-logs-20261026-132634-744109-9ac03f41.json`、`INKWAVE-logs-20261026-132820-137017-61d01442.json`、`INKWAVE-logs-20261026-133254-118557-211a9a65.json`；本地phone-boss-v30-output-hot-control.json、phone-boss-v31-output-hot-repeat.json、phone-boss-v31-minimap-cpu.json。

新V8采样`boss-cpu-2026-10-26T13-31-15-855Z.json`在方法轮实战5秒后采30秒，自耗时_drawInk约800.7ms、Character.update539.2ms、_applyPose289.9ms，(program)11631.1ms不可直接当成游戏JS算法。采样有开销，不算正式FPS；额外只读尺寸查询时主轮已关闭、9223拒绝连接是正常收尾，不重启测试，也不是USB失联。

下一步仅手机Boss优化Minimap._drawInk：优先尝试缓存未变化的四格输入/相邻alpha所决定的像素计算，保持原bilinear/emboss/owner/flash字节、0.15秒/3段时序、force刷新和地图分辨率。加载期准备有上限缓存，地图重建/配色变更正确失效；不跳帧、不动AI/物理/枪口。先用真实Canvas与原入口随机序列/清除/换色/翻转/闪光逐字节对照和最坏变化量性能对比，证明有益才提交构建真机。当前稳定30未通过，60未开始，目标active。
