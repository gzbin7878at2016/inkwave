# Boss小地图Worker停用恢复与实战诊断暂缓落盘（2026-10-27）

用户于2026-10-27明确要求处理高优先级问题，本批只改两处手机路径；PC不加载这两个模块的手机分支（`globalThis.inkwaveMobile`/诊断仅手机安装）。尚未构建APK、未上真机，下列收益为推断，需按文末步骤验证后才能写成绩。

## W1 小地图Worker：一次超龄不再永久回主线程

- 原状：`consumeMobileBossMinimapWorker` 发现最旧结果超过3帧或250ms，即 `release()` 终止Worker，本局余下所有 `_drawInk` 回到主线程（v53 V8补采 `_drawInk` 830ms居首即此）。v48、v49、v51～v53正式轮均出现一次252～324ms超龄后整局回退。
- 现状：3帧/250ms保护**不变**，超龄当帧仍立即用原同步算法整图重画；但只把Worker停用（park）：在途段作废，迟到结果只回收缓冲、不写地图；作废段排空、整图已画且未暂停后恢复，恢复后的首段把主线程 `owner`/墨迹/闪光副本（结构化克隆，不转移真实地图buffer）交给Worker，保证闪光判断与透明像素残值和原同步路径逐字节一致。
- 队列满、暂停（`paused`）、切后台（`suspend`）同样只停用；暂停/后台保留原 `version=-1` 静默整图重画。准备中被暂停、异常、数组重建、配色/force、对局结束、离局/新局仍按原逻辑终止。
- 新统计：`parks`（停用次数）、`resyncs`（恢复次数）、`dropped`（作废回收段数）、`parked`。`fallbacks` 仍只计终止。
- 正式轮门槛未放宽：`check-phone-boss-performance.mjs` 仍以 `maxAgeMs>250`/`maxAgeFrames>3`/`fallbacks` 判无效，只把缓冲核对改为 `recycled === applied + dropped`。是否把超龄从“作废整轮”改为“报告统计”仍由用户决定。
- 预期：一次GC/长帧后不再整局多付约1.1～2.5ms/帧（Worker文档2.65ms对0.8ms每段推算），手动游玩与暂停后恢复同样受益。

验证（本机Chrome 152/Linux，`EDGE_PATH=/usr/bin/google-chrome node tools/check-mobile-boss-minimap-worker.mjs`）：

- 真Worker集成140步中途注入一次时钟+300ms超龄与一次暂停/恢复，参照用原同步路径同步刷新；77次上传逐段墨迹/闪光/owner字节一致，最终整图一致；submitted 76 = applied 75 + dropped 1，parks 2/resyncs 2/fallbacks 0，recycled 76。
- 逐项：超龄、帧龄、队列满、暂停、后台→停用、当帧整图等于原算法、迟到结果不覆盖、排空后恢复且 `dropped+applied===submitted`、离局后无Worker/URL泄漏；force/配色/数组重建/Worker异常/结束→终止。取消、新旧局、PC/普通/演示隔离、CSP拒绝降级不变。

## D1 诊断：实战中不再每5秒同步写整份日志

- 原状：`inkwaveDiagnostics.tick()` 战斗中每5秒建两次场景快照（一次含排行排序后丢弃），并 `JSON.stringify` 整份日志（上限约1.9MB）同步写 `localStorage`；任何普通记录还另排1.5秒落盘。test23记录v19 tick单次最大26.3ms（含已移出战斗的15.2ms `getError`）、Storage写入最大3.3ms。
- 现状：仅当 `match playing`、非演示、未暂停时，`info` 级记录与5秒快照只留内存；`warn`/`error` 仍按1.5秒落盘供强退取证；着色器失败、上下文丢失、可见性变化、`pagehide`、用户导出/上传仍立即写。脱离战斗（暂停/结束/回菜单）首帧补存一次。tick的事件快照不再计算排行。
- 取舍：若WebView在战斗中直接崩溃且没有页面隐藏事件，本局战斗中的普通记录（非警告/错误）不会留到下次启动；启动/黑屏取证路径不变。

验证：`EDGE_PATH=/usr/bin/google-chrome node tools/check-diagnostics-combat-persist.mjs` 通过；同一脚本对原 `diagnostics.js` 失败于“实战普通记录仍同步落盘”。

## 其他检查

- `npm run check`：308 JS语法通过。
- `tools/check-mobile.mjs`（本机Linux无头Chrome+软件WebGL）：新提交与原89737f0构建均在同一处等待手机剖面60秒超时，属本机环境限制，不能作为通过或失败证据；需在原Windows/Edge环境复跑。

## 真机待验（需Windows主机、USB与签名）

1. 构建APK并记录版本/源码提交/SHA-256/签名，按原流程同步与安装。
2. 方法轮确认：`bossWorkerInfo()` 在一次超龄后 `parked` 很快回到false、`resyncs` 增加、`fallbacks` 为0；V8剖面中 `_drawInk` 不再居首。
3. 方法轮包裹 `Storage.setItem`/`diagnosticsTick`：战斗中 `storageWrite` 次数应为0（除警告/错误），对比≥100ms长帧是否与5秒节拍相关。
4. ABBA同温对照正式轮；超龄仍按原门槛作废整轮，不能把含超龄的轮次写成成绩。

## Windows接续：2026-10-27独立暂停恢复方法准备

Windows/Edge源码Worker与日志保存时机检查已通过。v54干净源码2b7ed77构建安装；旧/新/新/旧一分钟正式对照正在采集，不能预称提帧。正常轮暂未触发park，新增仅工具开关 `BOSS_VERIFY_WORKER_RECOVERY=1`，限制METHOD_PROBE=1、VERIFY_BOSS_EXIT=1、一分钟，在20秒经原pause/resume入口检查park与排空恢复，不改游戏时间/资源；方法轮不作为帧率成绩。该工具语法通过，真机待验。产品APK不因工具更新重建。
