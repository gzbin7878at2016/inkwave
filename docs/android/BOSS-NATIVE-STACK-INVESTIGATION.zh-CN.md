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
