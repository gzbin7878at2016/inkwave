# Boss阶段耗时定位（2026-10-27）

用户明确授权先定位，不做产品性能修改。保持v54 APK / 2b7ed77、60帧上限、2倍/SMAA/8人和原玩法，所有其他负载、隔离与恢复实验关闭。

## 工具准备

新增tools/boss-stage-probe.mjs与专用BOSS_STAGE_PROBE=1开关，只允许独立一分钟METHOD_PROBE=1；关闭旧的大量方法探针，改用分层有界计时。记录Director、gameFrame、match/controller、actors/bots/characters/weapons、bossMode/boss/brain/model/hazards、projectiles/subWeapons/specials、renderSubmit/HUD/诊断等。

每个入口记录包含和自身墙钟，父层只扣除已追踪子层；墙钟含GC/抢占/驱动等待，不是纯CPU，父子不能相加。固定48标签/4096帧/64嵌套预算，最慢32帧、LoAF最多100条，结束才排序统计。通过原入口转发原参数/this/返回值/异常，finally清理。LoAF仅在支持时使用，超过50ms的帧不能覆盖全部60帧漏帧。

node tools/check-boss-stage-probe.mjs已通过确定性嵌套归属、返回值/异常、序列化工厂、重复绑定与恢复检查；手机工具语法检查通过。仅工具改动，不重建APK。

## 真机状态

真机定位待执行，手机曾短暂识别后消失，用户正在重连。不得把工具通过称为已经定位根因，不称方法FPS为正式优化成绩。持续无人值守优化仍暂停，本批仅定位。

## 用户缩短定位轮次

用户随后明确要求阶段定位30秒：仅BOSS_STAGE_PROBE=1方法轮支持BOSS_TEST_SECONDS=30或60，实际开局duration同参数，30秒后自然结算再上传关闭；不把一分钟局玩到30秒强停。正式对照仍60秒。已启动的首轮60秒保留原参数完成，后续换新名称30秒。退出恢复验证也允许该独立30秒阶段轮。工具语法和原归属检查通过，30秒真机待验。

## 首批真机定位完成及二级定位准备

首轮60秒/后续30秒均自然结算、实际USB核对源码2b7ed77、离局恢复与关闭通过。首轮60Hz/29→35°C，gameFrame均值11.159ms、renderSubmit3.909、match3.949（包含actors2.684/characters1.472）、HUD1.215、Director0.054。149.1ms长帧位于角色入口，自身92.8ms+Character42.8ms；不能将自身时间直接认定纯计算或GC。

30秒轮开局原生读到120Hz/35→35°C，与首轮不可直接比FPS；gameFrame14.640ms、renderSubmit4.867、match6.125（包含actors4.346/characters2.636）、HUD1.411、Director0.066。114.6ms长帧角色自身99.4ms。两轮平均每帧match.update调用1.302/1.646，说明原dt阈值触发双子步的比例不同，未修改子步。

LoAF支持并收集13/15条，既有脚本149ms的长帧，也有LoAF110ms但已归因脚本仅12ms的帧；不能把剩余全部归GPU。尚无GC事件证据，频率未知。方法FPS45.06/38.74仅定位数据。

用户要求继续找耗时帧原因；新增BOSS_STAGE_DETAIL=1二级角色入口/音效计时，保持48标签预算，配3秒窄Trace和20秒原生调度。仅方法工具，不改APK。二级真机与时间线待验。

短Trace入口同步接受新stages方法探针（旧methods仍兼容）；仅调整工具识别，不改变Trace类别或放宽3秒窄窗口限制。准备26～29秒窄Trace，并行原生调度工具先在8秒做极短进程锚点，再采20秒，避免两份CDP Trace重叠。
