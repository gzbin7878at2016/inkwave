# v50：Android标准游戏分类与固定画质保护

## 问题与证据

当前APK v49 AndroidManifest缺少appCategory游戏分类。实际cmd game list-modes返回unsupported、available[]；这本身不证明帧率低一定来自分类，厂商实现及热策略仍可能不同。之前CPU策略只读观察存在低于硬件上限的约束，但未单独证明原因。

Android官方说明：Android14中GAME电源模式用于通知Power HAL前台是游戏，appCategory=game是标准分类入口；具体性能策略由OEM实现。参考[Android系统说明](https://source.android.com/docs/core/perf/boost)与[Game Mode API](https://developer.android.com/games/optimize/adpf/gamemode/gamemode-api)。这是待真机验证的假设，不能称已经提帧。

## 本批修改

仅Android封装：application声明appCategory=game；添加android.game_mode_config，allowGameDownscaling=false、allowGameFpsOverride=false，遵循[官方干预退出设置](https://developer.android.com/games/optimize/adpf/gamemode/gamemode-interventions)。不声明未实现的自主管理performance/battery模式，不强切系统Game Mode、不写手机全局设置、不调用隐藏接口，也不修改温控。

分类属于整个Android应用的包元数据，不能伪称只作用Boss；本批不改各模式玩法/场景/画质，性能验收仍只测Boss，PC源码保持。2倍高清/SMAA/8人/原玩法、原30/60选项不变。厂商仍可能忽略干预退出声明，须以实际Canvas/窗口/帧耗日志核对，不能只看XML。

BossDisplay.getState增加只读applicationCategory与API31以上gameMode；旧系统跳过查询、GameManager缺失或查询异常均容错，不影响已有显示生命周期。工具BOSS_REQUIRE_GAME_CATEGORY=1只在开局就绪后读一次，要求应用分类0（GAME），不在正式战斗内新增原生轮询。分类成功不等于GAME Power HAL实际采纳，也不等于帧率成功。

## 基础检查与执行计划

实际Java插件替身编译/执行通过：原同分辨率/窗口偏好所有权/后台恢复/外部改值保护不变，新增分类读取、API29跳过、GameManager缺失/权限异常容错。XML格式通过；实际SDK资源和Java编译由后续干净Android构建核对。

先中文提交推送，再干净构建v1.0.50/code50；核对签名、SHA256、资源逐字节一致与manifest编译后实际属性，安装并只读查询系统分类/模式。先60游戏秒方法轮核对原画质与正常操作/退出恢复/上传关闭，再正式无探针轮。结果单独中文提交，不把方法轮、较凉手机或系统分类声明当作稳定30帧成绩。射线/隐藏LOD/静态props候选全部不混入本包；v49最新正式27.23281FPS仍未稳定30，60未开始。

## 干净构建、安装与实际分类

v1.0.50/code50，源码6686333b01dedcfed193f9ddd8c31d5fb385b3a4，trackedChanges=false。APK releases/INKWAVE-android-test50-6686333.apk，21,159,263字节；SHA256 0068fd95035055a8e92014dc109595c13766084823882281581f888e2bfde0b4。v2签名验证通过，证书201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69；398个同步public资源逐字节一致，其中396个dist-mobile资源全部匹配，另外2个为Capacitor同步生成的cordova文件，须对照android/app/src/main/assets/public而非dist-mobile。原始第一轮脚本用错对照目录曾失败，已用正确目录重做全部检查通过。

aapt2核对编译后application appCategory=0，game_mode_config两项allow均false，元数据引用存在；ADB覆盖安装成功。实际cmd game list-modes从v49 unsupported/[]变为v50 standard/[standard,custom]；原生getState实际applicationCategory=0、gameMode=1。dumpsys game仅显示无该包intervention，未提供可验证GAME Power HAL实际策略的字段，不能把分类当系统提升频率的证据。

同ef0e0a1比较src目录Git内容无差异，游戏JS与PC源码保持。当前正在方法轮正常一分钟Boss与只读CPU策略采样，尚无正式帧率结论。

## 一分钟方法轮与只读策略结果

1687帧/66.5404秒=25.35302FPS，P95 58.4/P99 83.4ms、>=100ms8次，44→46°C；方法探针及30秒策略采样，不作正式成绩。实际158.60米、12475.91 Boss伤害/85弱点/一次大招，阶段[1,2]，三期未验。2倍/scale1/SMAA/8人保护通过；退出菜单及混响/后处理/Worker/窗口恢复通过。UI USB日志INKWAVE-logs-20261026-235902-004393-a1cb9ebe.json核对6686333，已关闭。

只读CPU策略7样本，均绑定本轮app22740；CPU0/4/7上限仍1228800/1324800/1651200kHz，硬件上限1804800/2496000/2995200，温度44～45°C。分类识别成功，但没有观察到策略上限提高，不能将包分类修复包装成性能提升。接下来无探针正式轮，所有副本/遮蔽/旁路/策略采样为0。
