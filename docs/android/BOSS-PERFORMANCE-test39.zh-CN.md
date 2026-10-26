# v39：Boss动画采样批量读写，消除同步样式刷新

## 问题与修正

v38真机Trace发现样式次数增多后，使用真实Edge CSSAnimation及CDP Performance.getMetrics复现：16个SVG动画、36帧，旧写法RecalcStyleCount=576（恰好16×36）。逐个读取playState、写currentTime，使下一动画读取状态前强制更新样式。

本批只调整 src/platform/mobileBossAnimationClock.js 的热循环：复用writes数组，先读取并校验所有动画状态，再统一写currentTime，最后清空引用。playState每动画每帧读取一次。仍保留取消/退出/外部接管/速率变化的检查；动画关键帧、延迟、原startTime及有限事件不变；仅手机Boss，PC普通模式仍原路径。

同一真实浏览器测试改后36帧RecalcStyleCount=36、LayoutCount=36，未改变16动画数和37次采样；style线程CPU约4.773→3.613ms，仅小样本方法证据，不作手机收益承诺。工具 tools/check-mobile-boss-animation-style.mjs 默认断言样式计算≤帧数3倍；BOSS_STYLE_BASELINE=1只记录旧路径调查，不可作为通过。真实CSS相位/有限事件/取消恢复及隔离测试再次通过。

## 构建与验收计划

版本1.0.39。基础语法检查后中文提交推送，从干净提交构建、签名/资产检查、USB安装。一局60秒方法调查采12秒Trace，核对本页进程、实际捕获动画及自然结束释放，退出恢复，上传落盘源码核对后关闭。若刷新次数修复且无新问题，再两局无探针正式测试；固定2倍/SMAA/8人、原玩法及声音，禁止旁路作为成绩。当前30帧未稳定，60帧未开始。

## 真机结果

待构建验证。
