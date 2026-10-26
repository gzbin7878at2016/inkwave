# v18第一批纹理分级与真机测试

日期：2026-10-26。设备：HONOR ALP-AN00 / Adreno 730 / Android 14 / WebView 131.0.6778.260。

## 本批改变与结论范围

按[纹理分级方案](DEVICE-TEXTURE-SCALABILITY.zh-CN.md)先确认实际资源，再只改一个主要变量：手机海港远景反射由每面512缩为256，PC仍为512。

新增`src/platform/renderProfiles.js`，在资源创建时选择环境档案。手机云图512×160、PC2048×640沿用v17；格式、六面、mip、环境PMREM、人物、涂墨图集、2倍画面与SMAA未改变。档案目前只有PC原版和手机基础环境组，尚未实现按GPU性能细分、动态切档或纹理流送。

本批是海港环境资源优化。**潮汐地图Boss没有这张远景反射，不能把Boss帧率差异归功于这次降档。** 也没有测得本项GPU烘焙耗时，不宣称启动提速比例。

## 源码与提交顺序

1. `e9ad89c`：新增USB资源采集工具，语法和立方体/mip/数组层/UUID去重检查后推送，再用于真机。
2. `b69f3a95f27fcd269df02ecfcdc283322d2ec8a4`：手机远景降档与平台档案；209文件语法和档案选择/PC原值检查后推送，再从干净提交构建v18并安装验证。
3. 本文及交接记录为测试后独立提交。没有把未验证代码积累到下一批。

## 真实资源清单

测试工具：`tools/check-phone-textures.mjs`，底层`texture-inventory.mjs`只读取JS对象，不做GPU像素读回，不更改画质。

| 项目 | v17 | v18 |
| --- | --- | --- |
| 海港模式 | marina=true | marina=true |
| 海港远景反射 | 已创建并启用，512×512×6 | 已创建并启用，256×256×6 |
| 该反射颜色存储+mip估算 | 约16MiB | 约4MiB |
| 清单引用颜色存储估算总和 | 约152.99MiB | 约140.99MiB |
| 手机实际画面pixelRatio / dynScale | 2 / 1 | 2 / 1 |
| 手机low平面反射 | 未启用 | 未启用 |
| 潮汐普通场景 | 无远景反射目标 | 本批不新增该目标 |

约12MiB是颜色存储的理论差额，不代表实测GPU总显存净下降12MiB；未计深度、临时资源、驱动与驻留情况。清单按纹理UUID去重，但“JS持有引用”不表示本帧可见或已经上传到GPU。未知/压缩格式不猜字节数，未测更新频率。

其他发现：手机材质数组已有46层、每层256、albedo/normal/ORM三组，每组颜色+mip约15.33MiB；壁画与AO等2048图集仍较大。它们涉及近景清晰度、共享使用或图集UV，不能直接全部减半。当前先保留，下一批可单独评估环境PMREM。

## 冷启动、海港视觉与PC检查

- v18普通入口完整冷启动3次，Ready分别10,543 / 9,592 / 9,861ms，shader失败均0；原生日志未匹配GPU重置、资源死锁、EGL_BAD_PARAMETER或未初始化SharedImage错误。
- 三轮均取得USB截图和成功上传回执；电脑JSON源码与b69f3a9核对，通过后关闭游戏。
- 海港资源巡检确认256目标、6面与mip，上传核对并关闭。真实截图显示海港主体、人物、文字和水面正常，未见新增破图。
- 两版海港截图为相近出生点，存在队色、动画、随机状态差异；不是严格同帧像素差分，也未覆盖全部水边视角、主题和长期游玩，不能称“完全无损”。
- 实际浏览器分别加载PC源码入口和手机产物：PC云2048×640、远景512；手机云512×160、远景256、pixelRatio2；两者marina=true，无页面异常/记录到的shader失败。浏览器软件渲染结果只用于参数与兼容检查，不当作真机性能。
- PC检查覆盖当前默认海港入口；其他PC画质档未逐一完整游玩。本批未改它们的选择逻辑。

## 一分钟Boss测试

运行原8人Boss、固定2倍/SMAA、dynScale1，自动输入仍通过正常物理和武器规则，不传送、不改血量。等待本局自然结束，USB上传核对源码后主动关闭。

| 指标 | v17本轮基线 | v18回归 |
| --- | --- | --- |
| 战斗采样 | 61.2105秒 / 1782帧 | 61.3818秒 / 1775帧 |
| 平均FPS | 29.113 | 28.917 |
| p95 / p99 | 33.4 / 50.1ms | 49.9 / 50.1ms |
| ≥100ms帧间隔 | 6 | 5 |

v17基线电池温度由32.0升至36.0℃，v18由36.0升至38.0℃，电池温度不能等同GPU温度。两轮顺序不同、随机状态和温度未完全控制，没有做基线→候选→基线交错；该组只作回归观察，不作提帧因果证明。v18自然finish、8人、固定2倍/SMAA、shader失败0、致命图形状态false；USB落盘源码核对后游戏进程消失。**稳定30帧仍未通过**，长期热机未验收。

v17基线上传文件为`INKWAVE-logs-20261026-092113-315186-af0c42f7.json`；v18回归为`INKWAVE-logs-20261026-092740-756008-d91ac3c8.json`，均位于`releases/logs/`。海港巡检同样完成上传核对和关闭。

## APK交付

- 版本：1.0.18 / code18；源码b69f3a95f27fcd269df02ecfcdc283322d2ec8a4，trackedChanges=false。
- 文件：`releases/INKWAVE-android-test18-b69f3a9.apk`，21,116,922字节，已覆盖安装当前手机。
- SHA-256：`bad63ce5c9b6b5c3081f1433c69b46aca15b083e16af0f9968fb34251787d8e3`。
- 签名证书SHA-256：`201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69`，与本机v17一致。
- Gradle/apksigner通过，366个网页资源与APK逐字节一致。构建仍有既存重复对象键警告，本批未扩展修改该范围。
- 固定安装页已指向v18。`android-build-info.json`的deviceTested仍false，本文件分别记录启动/场景通过与性能未达标，不将全游戏验收标为通过。

## 本地证据与复跑

原始文件位于忽略目录，不随Git同步：

- v17基线：`releases/investigation/phone-boss-texture-v17-baseline-20261026.json`。
- v17普通清单：`phone-textures-current-2026-10-26T09-21-18-045Z.json`。
- v17海港：`phone-textures-halyard-2026-10-26T09-21-43-123Z.json/.png`。
- v18海港：`phone-textures-halyard-2026-10-26T09-25-34-740Z.json/.png`。
- v18冷启动：`phone-full-startup.json`及分轮log/png，旧v17完整记录已归档到`v17-final-startup-before-v18/`。
- v18PC/手机浏览器：`v18-browser-environment.json`和对应截图。
- v18Boss：`phone-boss-texture-v18-regression-20261026.json`。

以上省略目录的路径均相对`releases/investigation/`。复跑清单命令（项目根目录PowerShell）：

```powershell
./tools/start-usb-debug.ps1 -Serial A38YUT3C19022796
$env:ANDROID_SERIAL='A38YUT3C19022796'
$env:TEXTURE_MAP='halyard'
node tools/check-phone-textures.mjs
```

工具生成带时间戳的清单和截图，真实上传后关闭。halyard巡检只用于资源与画面检查，不冒充一分钟实战。不同设备须替换序列号，源码/截图/日志结论要重新核对。
