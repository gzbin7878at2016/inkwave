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

## 二级轮与短时间线初步证据（非正式性能）

v54-stage-detail-trace-method已自然30秒结算、USB INKWAVE-logs-20261027-100328-133213-054fea3e.json核对2b7ed77、退出恢复/关闭通过。渲染提交平均4.564ms、角色表现自身2.156ms、HUD1.333ms、音效play自身0.742ms；角色积分自身0.314ms。最大慢帧86.5ms出现在结算附近，HUD58.8ms；本轮未复现前两轮角色100ms停顿，不能硬归因。

26.309～29.349游戏秒采集3秒窄Trace，84游戏帧，事件未截断/dataLoss=false。按相同线程CPU时钟、排除嵌套重复，主游戏FunctionCall约15.908ms/帧、Document::recalcStyle5.582ms/帧、PaintArtifactCompositor1.403ms/帧，仍是带探针窗口，不当正常CPU预算或帧率成绩。原生20.0004秒记录entries=written=1512529、sched切换不一致0；Main运行17.9267秒（约89.63%单核），最大已观测runnable等待10.298ms，不能跨时钟把它与前一轮100ms绑定。

严格裁到起止标记的3.031秒窗口有6次MinorGC，每次1.565～2.889ms，合计13.881ms，间隔0.444～0.482秒，未见MajorGC。仅本带探针窗口统计，不能外推全局周期；不能把嵌套GC事件重复计数，也不能解释未覆盖的100ms停顿。

用户要求继续排查并保持手机常亮：已设svc power stayon usb=2，增加每3分钟独立常亮检查（不启动游戏/不操作CDP），本地状态文件有6小时过期上限，排查结束可停用。后续扩大不同短窗口覆盖，仍30秒定位、不改产品。

第二组30秒方法复现168.3ms慢帧：active28.352秒，actor_startSpecial自身93.0ms、characters48.3ms。该轮25秒Trace结束在28.286秒，恰未覆盖，不能用其1～4ms MinorGC解释下一帧。新增大招发动者/类型及SpecialSystem.start分段，下轮改27～30秒窄Trace，仍先提交工具。该轮USB100932-562551-3d52d048核对2b7ed77/恢复关闭通过。

静态调用核对：Actor._startSpecial会同步emit special:use，本地主角监听调用hud.banner，再播放音效并执行SpecialSystem.start。为区分事件UI/特效和技能本体，二级工具补hud.banner、hud._restart和fxHooks._specialUse计时，仍48标签上限；仅观察不改事件/布局。真机待验。
