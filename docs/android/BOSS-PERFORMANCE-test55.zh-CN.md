# v55：手机Boss加载期提前准备大招手持武器

日期：2026-10-28。用户明确授权本次修复、中文提交后打包与真机验证；不恢复持续无人值守优化。

## 问题和修改范围

v54实战首次zooka发动96.6ms中，Character._getWeapon占93.8ms、实例创建仅0.2ms。此前角色预热只覆盖已有普通武器，专用武器的共享定义仍在战斗首次使用时生成。

本批仅在手机Game._warmCharacters的Boss分支，向原warmAll传入每位角色实际specialId。手机串行、可取消准备队列按zooka/blower/jetpack/stamp分别取得sp_zooka/sp_blower/sp_jetgun/sp_stamp真实缓存实例；原材质初始化与远景几何准备覆盖这些实例。未挂到角色树上的专用武器近/远网格显式进入原首绘及阴影准备流程。没有setWeapon、发动技能、修改HP/墨资源、人数、AI、物理、分辨率或SMAA。实例留在原Character.weapons缓存，私有灯光材质按原角色dispose释放，共享几何继续使用原共享缓存。

PC warmAll分支不改，普通手机对局不传专用武器参数；没有专用手持武器的大招不增加模型。共享定义的单次构造仍不可中途切片，但在加载提示覆盖下、各任务前后按原预算让帧；不承诺加载总时长缩短。未来局中切换到加载阵容以外的大招不在本批预建范围。

## 提交前检查

- tools/check-mobile-combat-preparation.mjs：真实四类缓存对象、未挂树近远网格首绘提交、不换装、私有材质重复dispose保护、普通手机不扩建、旧局取消不构造、无时间/音效/涂墨副作用通过。这是可观察渲染器的确定性测试，不是真实GPU成绩。
- tools/check-mobile-preparation.mjs：实际Game准备流程、单机/联机取消/失败/首帧门槛、Boss传参范围与进度通过；PC不加手机锁。
- tools/check-js.mjs：313个JS文件语法通过。

## 验证流程

先提交并推送功能，再从干净提交构建v1.0.55/code55，记录源码/未提交状态/大小/SHA256/签名/同步资产。USB覆盖安装保留数据。先30秒细分方法轮检查加载诊断及实际大招首次换装缓存命中，区分加载成本与战斗成本；若该轮无自然大招，另补方法轮，不篡改资源强行发动。正常无探针一分钟仅作回归并沿用原门槛，不能用方法FPS或不同温度/阵容宣称提帧。每轮实际上传核对电脑文件源码后关闭。真机结果、PC实际渲染差异和未完成项需在后续结果提交如实记录。

## 干净构建与安装结果

- 功能中文提交：995558f73f6b41d87b7ad557489d83b2c24e9cae，先推送fork/codex/android-capacitor后构建，trackedChanges=false。
- APK：`releases/INKWAVE-android-test55-995558f.apk`，v1.0.55/code55，21,162,595字节。
- SHA-256：`5e5714f13f223687d46c6b8260a1f2a7ad448e5d93a1214158b3ee1ce1b14e3d`。
- apksigner校验通过，v2签名；证书SHA-256为 `201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69`，可覆盖原测试版。
- APK内396份dist-mobile文件、398份Android同步文件逐字节匹配；移动网络基础检查通过。USB install -r成功，原生package查询版本55/1.0.55，未清除用户数据。
- 补充tools/check-mobile-character-warmup.mjs通过：串行/取消/阴影恢复、PC原同步三档建模与整树编译流程保持。未做PC画面逐像素前后比较，不把流程检查写成像素一致性结论。

## 真机方法轮：首次构造尖峰已转移到加载期

设备仍HONOR ALP-AN00 / Adreno730 / Android14，安装上述同一APK。均60FPS上限、2倍高清、SMAA、8人、原Director revision2，动态降清晰度关闭。细分方法轮30游戏秒自然结算，没有额外Trace。

第一轮 `v55-special-warm-method1`：真实Player/zooka在active23.3544秒自然发动，入口2.7ms；战斗中_getWeapon共2次，总计低于当前计时精度，_weaponInstance调用0次。此前v54同类实战调用链_startSpecial96.6ms/_getWeapon93.8ms，本次对应路径已不在实战首次生成模型。不是严格同温同阵容FPS对照，不能把两个数字当整局提帧比例。

加载诊断显示本地角色专用武器构造42ms；其他实际角色专用武器构造34/30ms，均发生在加载队列。真实角色准备首绘完成，shaderFailures=0，无手机GPU fatal。首轮结算后额外缓存检查：本地sp_zooka原本已缓存，重复取用0ms、未换手持武器；另一位非zooka角色先前无该实例，借已构建共享定义创建只0.3ms。这是结算后方法检查，不是额外实战成绩。

第二轮 `v55-special-warm-method2`：重新启动进程后再次完成加载，Player构造44ms、相同共享专用定义的后续角色0ms，验证每进程冷缓存会在加载补齐。本轮没有自然大招，不能重复记作发动验证。两轮均退出恢复ok，Worker fallbacks/parks=0，保留inactive完整收尾一次；结算小地图尖峰本批未修改。

| 方法轮 | 平均FPS（仅定位） | P95/P99帧间隔 | ≥100ms间隔 | 电池温度 |
| --- | --- | --- | --- | --- |
| method1 | 38.3058 | 41.8/58.3ms | 1 | 34→39°C |
| method2 | 35.5444 | 50/66.7ms | 4 | 42→43°C |

这两组仍有长帧，且温度/阵容/行为不同，不能称稳定30或60，也不能由此证明均值收益。第一轮移动108.90m、Boss伤害7272、弱点命中66、一次自然大招；第二轮移动62.13m、伤害12600、弱点命中122。不是站桩测试，但都只覆盖Boss阶段1。

## 无探针一分钟回归

`v55-special-warm-formal1` 使用METHOD_PROBE=0、BOSS_STAGE_PROBE=0、BOSS_STAGE_DETAIL=0、BOSS_STAGE_BUILD_BENCHMARK=0；全部隔离/负载/格式/DOM等实验为0，原正式Worker、SMAA边缘、首用准备等要求为1，未放宽门槛。测试仍原Director输入，实际60秒时限自然结算，采集墙钟63.5462秒/2026帧，平均31.8823FPS、P95 50.1ms、P99 66.7ms、≥100ms间隔6次。设置60FPS是上限，并非已锁60。

电池42→45°C；移动182.53m、Boss伤害10378.64、弱点命中74、一次自然大招，覆盖阶段1。无Shader失败、GPU fatal或Worker故障，fallbacks/parks=0，inactive最终完整收尾仍保留。真实USB核对上传源码995558f并关闭游戏；没有把结算后方法缓存检查混进本轮。工具status=measured仅代表正常采集与检查完成，stable30Validated=false，既未达到持续30帧门槛，也未达到60帧目标。

本批未做相同温度/阵容下v54/v55交错正式对照，所以不能以31.88与历史38FPS直接判定均值回归或收益。当前成立的结果是：真实首次zooka换装不再触发原首次共享定义/实例生成长工作，加载/图形/退出/上传路径通过。持续日常耗时、其他偶发长帧与结算地图仍需各自优化，不能归为本批已解决。

## USB证据和最终交接

| 轮次 | 本机releases/logs已核对文件 |
| --- | --- |
| method1 | INKWAVE-logs-20261028-012204-028317-3ebb59e6.json |
| method2 | INKWAVE-logs-20261028-012326-289028-103178ac.json |
| formal1 | INKWAVE-logs-20261028-012519-016882-16ae5ec0.json |

三轮均roundCompleted=true、upload.ok=true、appClosed=true；两轮方法额外bossExit.ok=true。报告在 `releases/investigation/phone-boss-v55-special-warm-*.json`，运行日志 `v55-special-warm-*.run.log`，原始文件及APK不入Git。三轮上传文件逐一存在且包含同一干净源码995558f；画质诊断核对HD/动态降清晰度false/fpsCap60/SMAA，原游戏人数保持。非本机接续需另取得产物或从源码重建，不能假定Git同步了这些日志。

手机保留v55且游戏关闭，所有本批测试进程已结束。本次仅完成用户指定的首次专用武器准备修复与有限验证，没有恢复原Boss持续自动优化。四种专用武器均有确定性缓存/首绘检查，真机自然发动实证仅覆盖zooka；PC原路径检查通过，PC逐像素比较及其他三种自然发动未做。若继续，建议先独立处理已定位的结算小地图66.5ms收尾，再处理持续角色/浏览器CPU预算，不将本批结论外推到稳定60帧。

## 用户现场观看的一局复测

2026-10-28用户重新连接并授权手机后，按请求运行一局Boss供现场观看。确认手机仍v55/干净源码995558f，无其他测试进程占用；恢复USB日志reverse与USB供电常亮后，通过原Director revision2实际移动、瞄准、射击、跳跃、补给和自然大招，不改资源或模拟。未修改代码、重打包或恢复持续自动优化。

`v55-live-play-formal2`沿用上节无细分探针正式配置，60FPS上限/HD2倍/SMAA/8人/动态降清晰度关闭，一分钟时限自然结算，采集61.5869秒/2452帧。平均39.8137FPS，P50 16.7ms、P95 49.9ms、P99 50.1ms、≥100ms间隔5次；电池37→42°C。移动200.66m、Boss伤害15354、弱点命中151、自然大招1次、覆盖阶段1和2，最长静止1.55秒。开局较多接近60FPS的时段不能当作整局稳定60；温度和阵容与上轮不同，不能直接声称从31.88提帧至39.81。

status=measured、roundCompleted=true、stable30Validated=false；Shader失败0、GPU fatal=false、Worker fallbacks/parks=0，inactive完整收尾一次保留。真实上传 `releases/logs/INKWAVE-logs-20261028-013725-399647-3941d682.json` 已核对存在且源码995558f匹配，appClosed=true。报告 `releases/investigation/phone-boss-v55-live-play-formal2.json`、运行日志 `v55-live-play-formal2.run.log`仅留本机。手机保留v55且游戏关闭；未达稳定30/60，第三阶段仍未验。
