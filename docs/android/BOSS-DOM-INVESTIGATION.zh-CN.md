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

已完成已安装v41/源码252fcda的独立一分钟调查 v41-dom-native。实测15.0297秒隐藏、45.0215秒恢复；临时样式最终remaining=false，真实上传 INKWAVE-logs-20261026-172936-973037-e9591dbf.json 核对源码后关闭。controlsDisplay=none为结算时原触控层自行收起，不是临时样式残留；上传成功。2倍/scale1/SMAA/8人、音频running保留；音频去重结束active=false、invalidated0。全轮1759帧/62.6621秒/28.0712FPS、p95 50.1/p99 75、5次≥100、41→45℃，属于隐藏HUD方法轮，不作正式成绩。

原生20.000389秒完整，1386644/1386644条目、切换不一致0、CPU0～7；本页renderer3152/main3224。实战覆盖7.3903～27.3907秒，uptime锚点不确定性±125ms。正常DOM 11～14秒与隐藏DOM 18～25秒完全覆盖，按真实在CPU上运行累计：

|线程|正常DOM单核占比|隐藏DOM单核占比|
|---|---:|---:|
|CrRendererMain|82.630%|70.679%|
|Chrome_InProcGpu（主机线程）|58.415%|14.626%|
|RenderThread|41.519%|9.880%|
|Compositor|40.548%|9.020%|
|Activity主线程|40.742%|33.301%|
|AudioOutputDevice|71.299%|76.140%|

CPU residency显示主线程主要CPU7、音频主要4/5/6，没有把“单核占比”误说成整机或GPU硬件使用率。两段音频声道/战况不同，CPU变化仍有干扰；但整DOM移除时渲染/合成线程大幅下降，音频没有同步下降，是后续HUD优化的重要线索。

实际区间FPS：正常11～14秒29.824、隐藏18～25秒29.743、隐藏30～42秒29.864、恢复后48～58秒24.611。正常前段也已接近30，因此不能只拿隐藏阶段30说已经提帧或达标；要看降低持续负载及完整画面热机验收。

原生结束后另行只读：renderer cgroup cpu/cpuset为/vip、blkio为/top-app；CPUonline0-7；手机Awake、供电true、stayOn=true。cmd game list-modes报告unsupported，不足以推出改游戏类别必然有效。没有修改任何系统策略。

下一步按组件隔离Boss条/大招球/队友标记，先找主要成本再改产品，避免重演无收益的动画接管。源码Boss条条纹本来就是transform动画，不应误当background-position后重复“优化”。稳定30未通过，60未开始。

工具接续：BOSS_DOM_PART新增固定枚举all/bar/special/markers，分别仅整体/Boss条/大招球/队友标记。真实浏览器验证每种组件只隐藏对应节点、其他HUD仍显示，恢复不改原style；非法组件拒绝。baseline只在真正playing记录，非实战改记inactive，避免把开局前快照当作实战baseline。正式轮DOM开关必须0。


### 队友标记单组件

v41-markers-native，仅隐藏.iw-mks，其他HUD/画面/声音保留。15.0297～45.0149秒真实none，实战baseline从playing单独记录，结束inactive且临时样式remaining=false。全轮1744帧/63.222秒/27.5853FPS、p95 50.1/p99 66.7、7次≥100，不作成绩。实际UI上传 INKWAVE-logs-20261026-174009-457980-681bab98.json 核对源码252fcda后关闭。

原生20秒覆盖5.8315～25.8311实战秒，锚点±120ms，1495854/1495854条目、切换不一致0。正常11～14秒→隐藏18～25秒：Main86.733→85.338%、GPU主机60.201→47.056%、Compositor43.178→45.441%、RenderThread37.761→45.228%、AudioOutput83.422→78.971%。两窗口玩家均存活，未以死亡状态隐藏标记混淆。标记会占一定栅格成本，但主线程/全局合成没有明显释放，不能因为源码存在CSS变量继承就直接上重写。

发现Boss条条纹原本已经是transform动画；新方向先复用BOSS_UI_ABLATION既有10～20秒暂停所有HUD动画/20～30恢复的独立方法对照，配原生CPU看全局合成是否下降，再决定原生动画步进/图层缓存等产品方案。尚不宣称主因已定位到某个组件，30未稳定。
