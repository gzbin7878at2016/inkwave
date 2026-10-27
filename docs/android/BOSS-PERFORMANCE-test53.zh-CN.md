# Boss v53：补齐拳头池与副武器程序准备

## 原因与约束

v52方法轮观察到mitts:fists首次程序36.8ms，以及waddle标记圈/boomerang盘反复新程序（10～40ms）。这些是renderBufferDirect墙钟，包含提交等待，不等同纯GPU编译。尚未证明它们是持续帧率唯一瓶颈。仅Android真实Boss加载阶段启用；PC、普通、展示不创建新增引用，2倍/SMAA/8人/原物理AI和技能规则保持。

## 本批实现

- 拳头：按阵容weaponId=mitts借原ensureFistMesh长期池，count仍0，不发射、不推进拳套。池原本跨局存活，仍用原clear置零；没有第二份池或按局额外材质。真实实例缓冲由原prepareMobileMesh准备。
- 回旋镖：按subId=boomerang使用原makeMesh离场工厂，借原型几何/共享外壳墨件，只持有一份自建blur材质程序至原clear。
- 巡游炸弹：按subId=waddle使用原makeRing离场工厂，借共享圈几何，只持有一份自建材质。不创建机器人，不探测、不画真实预览。
- 原手机combat分段队列首绘；失败/取消按所属match释放副武器引用，旧异步任务不能销毁新局。无逐帧产品额外工作。

## 基础验证

299份JS检查与diff空白检查通过。真实Three WebGL工具扩展通过：5个网格（1真实空池+3回旋镖部件+1圈），PC/普通/展示/缺阵容全0；同局重复返回同网格。5轮按实际实例类型克隆绘制、销毁临时材质，程序ID稳定；旧任务清理无效，正常清场回收2个自建Shader材质，取消也回收2个；真实拳头数量/池count始终0，不生成世界投射物。仅允许零计数真实长期池加入场景，其余代理离场。原v52技能/伞面生命周期检查仍通过。桌面结果不当手机提帧证据。

方法工具增加mittsFists/waddleRing/boomerangBlur实际绘制及程序ID计数，仍只在METHOD=1启用。

## 验证计划

基础检查后中文commit/push，再从干净提交构建安装v1.0.53/code53，核对签名/全部资产。先选mitts正常一分钟方法轮核对池实际绘制与程序复用，再shooter无探针正式一分钟。每轮真实UI USB回执/文件/源码核对后关闭；Worker250ms门槛保持。未覆盖副武器需据实际subId补原玩法覆盖，不以“没出现新程序”代替真实绘制证据。当前稳定30未通过，60未开始。

## 构建安装

干净功能提交356277bd6203b4a94e5902ce1326e0722e3996f6已推送fork。APK releases/INKWAVE-android-test53-356277b.apk，21,161,767字节，SHA256 a7cb14230b4033898306a0979e6971fc1bdf14012bdee11a68757c7df1779dae，构建trackedChanges=false。v2签名及证书201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69通过；398份Capacitor同步资产/396份dist-mobile资产与APK逐字节相符。ADB安装成功，手机versionCode53/versionName1.0.53确认。mitts方法轮已启动，尚无手机性能结论。

## 第一轮方法结果

v53-kit-programs-method：1676帧/66.9594秒=25.030093FPS，P95 66.6/P99 83.3ms、>=100ms8次，44→48°C。实际240.19米、8651.47伤害、29弱点、1次大招，仅阶段1。Worker最大226.4ms，fallbacks0，结束inactive整图1次正常。退出恢复通过，UI USB INKWAVE-logs-20261027-004928-028280-35145480.json核对356277b，游戏关闭。

真实阵容包括本地mitts/boomerang、槽6 bow/waddle；盘136次程序90、圈64次程序91，无新对应Shader程序。本轮只有另一个MeshBasicMaterial新程序首绘66.7ms。拳头原计数1677次包括count=0的renderBufferDirect调用，不能当作1677次真实绘制；方法工具已排除零实例/零drawRange，需补测确认非空池实际绘制。帧率与Worker数据仍有效，但属方法轮及不同武器，不能当正式成绩或独立提帧证据。原始phone-boss-v53-kit-programs-method.json保留。

## 正式轮失败与下一项采集

v53-kit-programs-formal：1671帧/69.7971秒=23.940823FPS，P95 75/P99 91.8ms，>=100ms15次。起始46°C；Worker最大289.4ms、result-age一次回退，原250ms门槛触发aborted/exit1，无结束温度。178.94米、15174伤害、145弱点、2次实际大招，阶段[1,2]。UI USB INKWAVE-logs-20261027-005200-905705-fe676c88.json核对356277b，已关闭。30未稳、60未开始。

只修特定首用不能解决持续预算，下一方法轮补验非空拳头绘制，同时附着已有V8工具采20秒近期CPU分布。工具增加实际_frameN起止及绘制量/存活快照，支持按真实游戏帧归一化；保持方法数据性质，不把采样窗口当成绩。只附着现有9223，不重建转发，不运行Native提权/详细Skia高体积采集。

## 非空拳头覆盖及CPU补采

v53-nonempty-fists-cpu-method已用修正后的非空计数：拳头实际311次绘制（0.892～80.122秒）始终程序92，飞出伞面138次程序87，回旋镖盘104次程序93，未产生对应新程序。另有MeshBasicMaterial139.1ms首绘和其他Shader47.5ms。证明本批拳头实例类型/程序在真机实际命中；上一轮1677次含空池的数据不能替代此结果。

整局方法1477帧/86.7912秒=17.017854FPS，P95 83.4/P99 108.4ms，>=100ms30次，46→48°C；204.72米、7017.70伤害、51弱点、1次实际大招，仅阶段1。Worker最大1318.5ms、result-age一次回退。约5.78～7.15秒有1375.6ms间隔，时间接近Profiler启动，不能据此独立归因为v53产品退化或声明正常性能。退出恢复通过，UI USB INKWAVE-logs-20261027-005538-477028-aeb9bcc2.json核对356277b，已关闭。

V8原始boss-cpu-2026-10-27T00-53-06-382Z.json，采样窗口21321.392ms/16770样本；快照_frameN327→654，共327实际游戏帧，active5.552→27.252秒，起止存活，calls62→59/tri747738→750139。快照包含协议调用边界，不能把其墙钟或样本直接当正式FPS。按同一callFrame汇总自耗时：无法细分原生(program)8262ms、_drawInk830ms、updateMatrixWorld436ms、raycast383ms、角色update364ms、setProgram287ms、_applyPose274ms，工具包装函数也262ms；聚合文件v53-cpu-grouped.json本机保留。前述矩阵/射线副本负结果仍适用，不能用排行直接重做无收益方案。Profiler附着影响及Worker已回同步的状态必须保留，不能从(program)推断全是GPU或CSS。

## 本批结论与下一步

v53已完成真实拳头、回旋镖盘、巡游圈的程序复用覆盖，保持原视觉/玩法；没有证明独立持续提帧。无探针正式23.940823FPS失败，稳定30未通过，60未开始，三期未验。保留本批首用修复，停止只追零散首次程序作为持续帧率主方案。

下一项优先做可恢复CSS范围实验：styles/ui.css唯一.is-slide[style*="--dir: -1"]菜单规则可能令style属性变化触发额外失效，但当前未证明显著成本。先真实HUD固定输入/动画时刻的桌面方法验证，仅暂时CSSOM删除该一条且finally原位恢复，确认Boss没有可见匹配对象及像素/状态一致，再决定是否真机窄Trace对照。不得直接删除PC规则、隐藏控件、停止可见动画，或把原生(program)全部当CSS。无收益就记录并撤去实验，不发布复杂缓存。全部测试/采样进程已终止，手机已关闭，ADB仍连接，无授权阻塞。
