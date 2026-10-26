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

当前尚未构建真机验证，不能当已生效或已改善。
