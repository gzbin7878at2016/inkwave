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
