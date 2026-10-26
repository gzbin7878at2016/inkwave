# v41：仅手机Boss合并已拥有音频参数的重复排期

## 为什么做

v40原样转发的20秒真机统计13182调用，其中3487（26.45%）为同目标、同时间常数、时间非递减的连续重复，主要是listener up与panner Y。v37原生调度Trace也显示音频输出线程负载高，但这里不能从调用比例推算FPS收益。

## 实现与边界

- src/audio/mobileBossParamDedupe.js 用WeakMap记录参数最后一次目标/时间常数/请求时间，目标按Web Audio原生float语义Math.fround比较；相同且时间单调才合并，目标/时间常数变化立即提交原调用。
- 只在AudioEngine.setListener九参数及_setPos五类参数处显式使用，不覆盖AudioParam原型，不改包络/音量/音高/HRTF、滤波公式/时常/节点数、声音数量/并发限制。新增统计calls/submitted/skipped/invalidated均有界整数，不强引用voice。
- 当前这些参数的所有写入均位于audio.js的初始化与上述两入口。若未来加入其他cancel/setValue/ramp等排期，必须先对该参数invalidate；失效后本轮不再合并。非单调或非法参数也退回原调用且失效，原生异常仍抛出。
- 只有手机、真实Boss、非演示、mode=match、playing、未暂停/未挂起时启用；引擎同时拒绝PC开关。普通/PC继续原调用。准备新局、退出菜单、后台立即清缓存；自然结束下一帧停用；上下文身份变化重建WeakMap，停用仅留数值统计。
- 2倍高清、SMAA、8人、玩法、原PC视觉/音频保持；v38/39 HUD候选不恢复，v37正确清零保持。

## 真正的音频等价验证

数学上的指数平滑可合并，但真实浏览器按采样离散计算并不保证PCM逐字节相同。最初直接参数探测已看到最大约2.33e-4的参数轨迹差异，不能用“公式相同”冒充无数值差异。

工具 tools/check-boss-param-dedupe.mjs 用真正AudioEngine.setListener/_setPos、真实OfflineAudioContext、带丰富谐波的锯齿音通过距离低通/Panner/发送增益，44.1/48kHz × equalpower/HRTF × 静止/移动8组。时间代理只把3秒90帧带130微秒抖动的实际调用预先写入离线时间线，不替换AudioParam实现；包括声源高度跳变/重复位置/移动听者/转向。事先门槛：最大PCM差≤1e-4且SNR≥80dB；实测最大3.24845e-6、最低SNR105.884dB。不是严格PCM差0，不宣称全世界所有声音逐字节相同；声像/滤波公式及时间常数不变，样本差远低于门槛。

原生返回值/原生非法时间常数异常、目标/tau变化、原生float同值、倒序排期、外部失效、PC强制拒绝、普通/开场/结束/演示/暂停/后台/菜单、上下文重建、旧浏览器回退、停用释放均通过。当前测试仅支持正确性，不证明手机CPU或FPS收益。

## 实际游戏回归与打包步骤

移动网页构建通过；真实Boss成品入口用正常鼠标手势先解锁AudioContext，playing时必须running且去重active/skipped>0，保留原加载进度/小怪池/新增shader0断言，挂起必须立即释放缓存。基础检查完成后中文提交并push用户fork，随后干净构建1.0.41、核对签名/全部资产/SHA256、USB安装。

先独立60秒方法轮，BOSS_REQUIRE_AUDIO_PARAM_DEDUPE=1、BOSS_REQUIRE_SMAA_CLEAR=1、镜头预备1，其他旁路/小地图/动画候选0，正常退出恢复；核对真实去重计数及音频状态。再两局不带方法/Trace/旁路正式轮，固定2倍/SMAA/8人，60秒游戏时钟自然结束、实际UI USB上传、电脑核对源码后关闭。未达标不开始60帧，不把探针或局部HUD显示当正式成绩。

## 真机结果

待干净构建及真机。30未稳定，60未开始。

原生CPU方法调查工具增加passive模式：仅无音画/模拟旁路的方法轮允许附着，仍20秒sched/freq/idle、不占用ADB转发。开始前用本页performance.mark和极短blink.user_timing Trace绑定真实renderer PID/TID，再结束浏览器Trace，之后才开始内核采集；避免根据多个WebView线程名猜归属。真实Edge标记唯一PID/TID验证通过、工具语法通过。准备对当前v40原包和v41各做一分钟方法轮，采相同8～28秒窗口；温度/战况不同仍不能把CPU差异硬称严格提帧。

首次passive v40方法轮完整完成USB上传关闭，但原生工具process标记变量被后段TRACE头同名const遮蔽，进入TDZ，内核采样尚未开始；该轮无原生CPU证据。已更名processMarker消除遮蔽；失败meta保留，以新名称重采，不覆盖或把失败数据当成收益。
