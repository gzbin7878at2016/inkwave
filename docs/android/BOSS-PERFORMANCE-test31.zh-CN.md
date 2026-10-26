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

当前安装v31、游戏关闭。下一步补一轮热机v30原包对照并恢复v31复测，保留温度/阵容差异，避免把冷态当收益；之后重新定位剩余CPU表现/小地图工作。只是实验对照，不修改PC或降低画质，也不改变稳定门槛。
