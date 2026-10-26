# v38：仅手机 Boss 的 HUD 动画帧采样

## 问题证据

v37 干净源码 d91ba2e 的独立方法调查在真实 Boss 战采集12秒浏览器 Trace，共56262事件、未截断，URL https://localhost/src/main.js 绑定本页 CrRendererMain（15702/15730）。UpdateLayoutTree 637次、Layerize/Commit/PrePaint/Paint各607次、Layout319次。六类区间取并集（避免嵌套重复）为3786.055毫秒墙钟、3259.315毫秒线程CPU时间。不能把墙钟当纯CPU或把 GPU 主机线程当GPU硬件。

该轮60秒游戏时间、实际采样63.274秒，1775帧、28.0526FPS、p95 50.1ms、p99 66.8ms、4次≥100ms；带Trace/探针，不是正式成绩。日志 INKWAVE-logs-20261026-154627-209965-c730db57.json 已通过实际UI上传、PC核对源码并关闭游戏。

## 修改边界与实现

1. 新增 src/platform/mobileBossAnimationClock.js，仅手机、真实Boss、playing、未暂停/未挂起、30或60帧时开启；PC、普通对局、演示、开场、菜单均不接管。
2. 只处理 .iw-hud.is-boss 和 .iw-hud-over.is-boss 内的无限 CSSAnimation。SVG内部循环或带背景位置等需主线程处理的属性才采样；HTML纯transform/opacity/filter动画保留原生时钟。触屏控制不在范围内。
3. 使用原 document.timeline、startTime、关键帧、延迟、方向、时长和速率，逐实际游戏帧定位 currentTime；不额外启动requestAnimationFrame。30FPS时HUD循环也按实际游戏帧采样，告警位置和动画速度不改变，但采样频率有意减少。
4. 有限次数动画不接管，保留 animationend 事件及开场/告警结束流程。原本暂停或非1倍速动画不接管。
5. 首次进入扫描一次，之后用 animationstart 捕获动态新增/伪元素。pending动画等ready，不递归等待已经取消或尚无startTime的idle动画。最多128个受控动画与待处理项，避免无限容器。
6. 退出、暂停、后台、销毁恢复原startTime；取消/移除动画不复活，外部接管的运行状态不覆盖。真实CSS仍存在才恢复。
7. android版本38；不改固定2倍/SMAA、人数、玩法、音效或PC资源。诊断info只记录有界计数/名称，供方法调查核实真正启用及结束释放。

## 已做基础验证与后续步骤

真实Edge CSS测试：12次采样与原生时钟相位误差小于1e-14；负延迟、alternate/reverse、伪元素、动态新增/移除/pending取消、SVG、合成动画排除、有限animationend、退出startTime恢复、外部暂停、8类隔离、suspend/dispose、无API回退均验证。实际Boss加载/短时实战回归、语法检查结果见后续记录。

先中文提交并推送，再从干净源码构建v38、验证签名和资产、USB安装。先一局60秒方法调查采集12秒同类Trace及启用/结束恢复状态，再至少两局无探针正式测试。所有轮次自然结束、实际UI上传、核对电脑日志源码、主动关闭。未测前不宣称提帧，未达标不开始60FPS。

## 真机结果

待构建及真机验证。当前30FPS未达标，60FPS未开始。

基础验证完成：真实CSS测试连续两次通过；移动网页构建通过；真实Boss加载/playing采样启用/两轮小怪复用/后台取消通过，新增shader与页面错误为0；npm run check 237文件通过。
