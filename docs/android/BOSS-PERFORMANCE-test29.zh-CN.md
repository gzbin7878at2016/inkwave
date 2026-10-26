# Boss性能第29批：窗口刷新节奏

## 问题与限定范围

v28缓存减图已证实，正式27.223/25.823FPS仍不稳定；原生跟踪显示RenderThread、Chrome_InProcGpu、Compositor存在明显工作。手机物理屏支持同分辨率60/120Hz，当前120Hz；Canvas目标30FPS不代表原生界面只合成30次。这里只验证降低不必要的原生刷新工作这一假设，不预先承诺提帧。

只在原生Android、非演示、Boss、mode=match、state=playing、未暂停/后台/恢复确认且fpsCap=30或60时申请窗口60Hz。PC、普通对局、大厅、加载、开场、结算、不限速/更高帧率均不启用。Canvas仍2倍/SMAA/scale1/8人，原游戏时钟和输入保持。

## 实现与恢复

- 独立BossDisplay插件只改本Activity的preferredRefreshRate；仅同分辨率60Hz支持且没有现有preferredDisplayModeId时设置，避免覆盖分辨率策略。不写系统设置，不申请新权限。
- 保存原值，离开实战/暂停/结束通过串行桥调用恢复；原生onPause/onDestroy也恢复，onResume仅按最后请求恢复。若外部已改变字段，保留外部的新策略。后台中的迟到桥请求不会重启刷新偏好。
- 网页端去重，稳定状态不逐帧发桥调用；异步请求串行，快速暂停/恢复后最终状态不丢失；失败只记日志，不每帧重试。只读getState记录请求、是否持有、原值、当前窗口值与显示当时值。
- Android官方说明这是偏好，系统可能不采纳；字段设置成功不等于实际切换，更不等于性能达标。[官方WindowManager.LayoutParams说明](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#preferredRefreshRate)。本实现仅用刷新偏好，不选显示模式ID。

## 提交前验证与真机步骤

1. `node tools/check-mobile-boss-display.mjs`通过真实调度器13组边界、300次重复去重、延迟桥调用串行/暂停后恢复、失败不刷屏、非原生隔离。`npm run check`通过221文件；Gradle compileDebugJavaWithJavac通过原生编译。
2. 中文提交推送后，从干净提交构建v1.0.29/code29，记录APK/签名/哈希/资产一致性并安装。
3. 一分钟方法调查，确认正常游玩和实际2倍，读取插件getState、dumpsys窗口/显示；开场、playing、结束对照窗口值。调查轮不计正式FPS。若系统忽略，明确记录，不声称已锁60Hz。
4. 两轮无探针一分钟正常游玩，自然结束、USB核对源码、关闭游戏；记录温度/平均/p95/p99/≥100ms。另做Boss暂停/恢复/后台/前台恢复确认/退出检查，单独记录，不混入正式帧率。
5. 结果单独中文提交。若负收益或系统忽略，记录后撤销/调整本候选，不能靠降分辨率或静音交差。稳定30未通过前不开始60目标。

## 真机闭环结果

干净功能源码`ec3c3e7e7bf6108ecaaf962a81b4a4705bb6f121`推送后构建；trackedChanges=false。v1.0.29/code29，APK`releases/INKWAVE-android-test29-ec3c3e7.apk`，21,128,058字节，SHA-256 `2420943b3eb9a41679755062b49506bba7745741365a3489a617d8dbdea3095d`；v2签名、221文件语法/网络、376网页资源逐字节核对通过。HONOR ALP-AN00/Adreno730/Android14实际安装。

| 轮次 | 实际秒数/帧 | 平均FPS | p95/p99毫秒 | ≥100ms | 电池温度 |
| --- | --- | --- | --- | --- | --- |
| 窗口方法调查，不计成绩 | 62.2040/1780 | 28.616 | 50/66.6 | 4 | 42→45°C |
| 正式1 | 64.8449/1696 | 26.155 | 58.3/75 | 7 | 45→46°C |
| 正式2 | 64.8040/1718 | 26.511 | 58.3/66.8 | 6 | 46→48°C |

两正式轮全部探针/遮蔽/静音开关为0，正常60秒游戏设置、2倍/scale1/8人、自然结束、USB源码核对/关闭均通过；SMAA不变，实际墙钟慢帧延长如实保留。**稳定30未通过，60未开始**。不同阵容和温度，不把这些跨轮数字当严格因果收益。

USB原件依次`INKWAVE-logs-20261026-120947-988467-a2857138.json`、`INKWAVE-logs-20261026-121148-408267-68bdf538.json`、`INKWAVE-logs-20261026-121333-570086-3d833a04.json`；本地phone-boss-v29-{display-probe,full-1,full-2}.json。APK/原始日志不入Git，换电脑自行构建或另行复制并核对哈希。

### 窗口效果与恢复的实证边界

- 独立只读状态采集40次：intro偏好0，playing偏好60/owned=true，finish偏好0/owned=false；这次实际报告刷新率一直约120Hz。dumpsys窗口确认preferredRefreshRate=60，但物理mActiveModeId=2/120Hz，不能宣称首次进入就锁60Hz。
- 另独立带探针生命周期轮，正常游戏pause/resume、ADB Home/带回同一Activity、手机原恢复确认入口全部通过：暂停/后台/待确认偏好0，恢复实战偏好60；后台foreground=false、待确认paused/needsResume=true、确认后解除暂停。没有改血量/位置或绕过确认状态。
- 这轮后台返回后getState报告约60Hz，随后dumpsys物理modeId1/60Hz。证明存在系统采纳时序差异；没有严格对照证明是窗口偏好、应用切换还是系统策略单独导致。不得写成“所有局面锁60Hz”或帧率改善证据。
- 生命周期原件`releases/investigation/v29-lifecycle-states.json`（ok=true）、v29-display-states.json、v29-window-live.txt及v29-native-framestats.txt本地保存。生命周期轮含人为暂停/后台，且帧间隔可能跨过后台，不统计正式FPS；完整游玩结束后USB文件`INKWAVE-logs-20261026-121558-766615-e9df6c37.json`核对后关闭。

当前安装v29、游戏关闭、USB供电常亮；目标active。下一步在独立声像隔离探针轮同步sched/freq原生跟踪，比较HRTF与equalpower窗口内实际AudioOutput运行及活跃声道，而非仅比较随机阶段FPS；保留完整音乐/音效，调查结束恢复，正式产品暂不改声像。窗口刷新需继续核对实际值，暂不强选显示模式、不写系统设置。PC/其他场景不动。
