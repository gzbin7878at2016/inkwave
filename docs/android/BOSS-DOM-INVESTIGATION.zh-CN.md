# Boss主线程：整DOM叠加层隔离调查

v41正式25.535/26.556FPS仍未达30，参数事件减少但Main仍约89%单核；此批只做工具调查，不更改APK功能或PC画面。

- 新BOSS_DOM_ABLATION=1只允许BOSS_METHOD_PROBE=1、BOSS_TEST_SECONDS=60，其他音画/CPU隔离、生命周期、退出探针、SMAA比较、小地图对照均0。禁止作正式成绩。
- tools/boss-dom-probe.mjs仅给.iw-hud/.iw-hud-over/#mobile-controls/#mobile-panel加临时display:none!important，实战真实累计15～45秒隐藏；原HUD更新、模拟、正常输入、音频、Canvas像素密度仍运行。45秒恢复，任何finally都移除临时样式，恢复后实际UI上传/核对源码/关闭。
- 原始节点style不改，游戏Canvas不在选择器内；记录至多12次阶段变化及最多16个root的真实computed display。只作用本调查的同一个真实Boss，暂停/演示/菜单/其他局不隐藏。有限动画因display切换可能重启，所以这种调查结果不能当成产品可用画面或正式性能。
- 真实Edge测试15/45秒边界、暂停/其他模式/退出、dispose恢复、Canvas尺寸/像素与原style不变通过；语法245文件通过。先中文提交推送工具，再附着已安装干净v41。
- native工具BOSS_TRACE_PROBE=dom允许4～8秒触发、锚点≤10秒，仍20秒sched/freq/idle。用本页performance.mark绑定实际PID，原生窗口应覆盖正常HUD 11～14秒与隐藏DOM 18～25秒；实际未覆盖就不作比较，不拿缺失边界凑数字。此工具不占有主轮ADB转发，不另开一局。

## 计划执行

启动APK→主工具独占60秒方法轮（所有旁路0，只开DOM）→原生工具同名称/dom模式→验证阶段真实none/45秒恢复、2倍/SMAA/8人/音频正常→原生进程内CPU前后比较→真实USB保存核对→游戏关闭。新工具没有更改已安装APK，不需要重复构建。

## 结果

待真机。稳定30未通过，60未开始。
