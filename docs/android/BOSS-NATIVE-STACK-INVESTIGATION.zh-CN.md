# Boss原生主线程调用栈调查

## 目标与范围

v50分类已正确识别，正式25.92385FPS仍未稳定30。V8中(program)仍有较大无法归因的时间，不能直接当GPU或某JS函数耗时。本轮先尝试系统simpleperf原生调用栈，只有方法调查，不新增APK、不变玩法或画面。

## 工具与边界

profile-phone-native-stacks.mjs只附着BOSS_NATIVE_STACK_TEST_NAME对应的一分钟、无音画/模拟旁路的方法轮。等待新鲜playing状态5～40秒，以当前https://localhost页的performance.mark进行极短blink.user_timing Trace，获得唯一renderer PID/TID；同时核对9223的专用ADB转发确属本游戏主进程，以及目标PID/TID在ps中仍为CrRendererMain。不给其他应用/系统线程采样，不新建或删除主轮转发。

只对该TID执行simpleperf record，cpu-clock:u、99Hz、3秒、frame-pointer回溯、8MiB产物上限。pull成功后才分析保存，仅releases/investigation本机留存；finally仅移除本轮唯一临时文件。不能用root或修改perf_event_paranoid/温控/全局性能设置。权限失败、栈不完整、符号缺失都如实记录，不把未符号化地址称作明确根因。

实际设备simpleperf命令帮助确认支持duration/call-graph fp/size-limit和cpu-clock。check-native-stack-target.mjs通过专用转发/重复标记/多进程/错设备/错线程/线程消失拒绝检查，脚本语法通过。尚未实际采样。

## 执行

先中文提交推送，再启动原check-phone-boss-performance.mjs一分钟方法轮（METHOD_PROBE=1、VERIFY_BOSS_EXIT=1、全部副本/遮蔽/旁路0，固定2倍/SMAA/8人），另一个进程设置相同ANDROID_SERIAL和BOSS_NATIVE_STACK_TEST_NAME并运行profile-phone-native-stacks.mjs。主轮继续真实移动/瞄准/补墨/开火，自然结束后实际UI USB上传核对、关闭。原生采集失败不重启或中断正在正常进行的同一局。

本轮数据不作正式FPS；目标30未稳、60未开始。

## 2026-10-27 原生采样权限拒绝；同局浏览器Trace成功

已绑定实际app24443、renderer24502/main24531，源码6686333；方法实战约7.76秒。simpleperf cpu-clock:u明确Permission denied，未得到原生栈，未使用root或更改全局perf设置。该失败仅阻断simpleperf分支，不是USB断线；同一局继续正常游玩，未重开。原始native-stack-v50-native-stacks-method-1793059451830.json留本机。

同局随后采用原有devtools.timeline/v8/gpu类别，3秒Trace成功：boss-trace-2026-10-27T00-05-12-257Z.json，dataLoss=false、eventsTruncated=false、47014原始事件；标记同renderer24502/main24531，开始/结束玩家均存活，阶段1。11个边界未闭合作用域不作完整耗时补齐。

按两个标记的tts裁边后，主线程CPU窗口2716.410ms；85个UpdateLayoutTree与窗口相交，CPU约420.564ms，其中417.613ms不被任何FunctionCall墙钟作用域包含，仅2.951ms在JS回调内。这里只分类已捕获作用域，未证明每个失效原因，也不把该CPU与父层RunTask/FunctionCall重复相加。旧Trace未记录实际帧号，不能用估计FPS凑每帧成本。

整局1712/65.5781秒=26.10628FPS，P95 58.4/P99 83.3ms、长帧9，44→47°C；正常178.87米/12060伤害/88弱点/一次大招，仅阶段1。属于带采样方法轮，不作性能成绩。真实UI USB000605-896864-5d7e5f8e核对6686333，退出恢复及关闭通过。

## 下一项：有界CSS失效与主阶段跟踪（工具，待真机）

trace-phone-boss新增BOSS_TRACE_MAIN_STAGES=1：除原时间线外加实际可用cc/blink类别，最多3秒；BOSS_TRACE_INVALIDATIONS=1仅允许独立主阶段1秒，加invalidationTracking，保留明确白名单的瞬时失效事件。使用现有ReturnAsStream/256MiB硬上限，不查/json/protocol，不加逐GL命令Skia细类；事件200000上限，超限或dataLoss不能当完整证据。标记同时读实际game._frameN，今后以两端差计实际游戏帧数，不用rAF数冒充。

Trace结束后取DOM节点id/backendNodeId/class映射供失效节点归属；节点已销毁或ID歧义则保留未知，不猜测。采样主轮仍正常60游戏秒，结束上传并关闭。事件收集器白名单/旧默认行为及分批CPU/截断单测通过；当前手机菜单ReturnAsStream兼容检查17010字节/dataLoss=false/标记存在/前后PID25452未变，结束确认关闭，不计Boss轮或FPS。尚未实际采集新的失效类别，不更改产品样式。

## 一秒完整CSS失效采集成功

boss-trace-2026-10-27T00-09-33-495Z.json：7,859,325字节/34048原始事件，dataLoss=false、eventsTruncated=false；节点映射1894项，本页renderer25812/main25849。开始/结束玩家均存活，实际game._frameN591→610，即19个游戏帧；采集本身较重，不作为正常帧率。

标记内样式失效原因：Related style rule643、Inline CSS style declaration was mutated565、Animation508、Attribute38。两处hidden属性分别19次：mobile-jumps来自TouchInput.setEnabled，隐藏的练习按钮来自installMobile.update；均与实际游戏帧数相同。队友标记--far setter132次、位置transform132次；还存在SVG波浪/气泡每帧样式/布局变化，尚不能把全部成本归因于两个hidden或变量写入。

新增CPU区间分析器按同线程tts裁边、将重叠嵌套区间只分给最内层一次。最内层只是已捕获类别的划分，父层自身仍可能包含未启用/小于阈值事件，不能把它当本地符号栈。新TraceDocument::recalcStyle约117.359ms/19帧=6.177ms/游戏帧，但采集开销/世界状态使该数值不能当正式成本。旧3秒Trace有55.149ms CPU未被捕获作用域覆盖，如实保留，不能补成某个函数。

方法整局1671帧/66.3067秒=25.20107FPS、P95 58.4/P99 83.2ms、长帧9，44→47°C；189.65米/14148伤害/116弱点，本轮实际大招0，虽有按键也不称覆盖，阶段[1,2]。UI USB001125-455840-738b9742核对6686333/退出恢复/关闭。

据此下一批只消除手机真实Boss的幂等DOM写入，不修改CSS动画/精度/继承/场景或PC分支。更多SVG/动画成本继续保留为线索，不重复未经控制的“停全部装饰”方案。
