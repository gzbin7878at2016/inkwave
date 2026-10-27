# Boss v52：加载期保留技能与飞出伞面图形程序

## 问题与范围

v51方法轮透明飞出伞面首次renderBufferDirect墙钟112.8ms，SWIRL特效在35/64/65秒重复出现新程序。该时间包含提交与等待，不等同纯编译时间。仅Android真实Boss加载准备增加引用，PC、普通对局、展示保持原路径。固定2倍/SMAA/8人及原玩法。

## 实现

SpecialSystem用现有swirl/beam/bubble/aura工厂和共享几何创建4个离场代理；伞模块用原buildLaunchedMesh工厂的可选attach=false生成3个离场网格，准备飞出伞面透明织物。总共7网格、6个自建材质（4技能+2织物），塑料材质及几何只借用。加载队列沿用分段让帧和真实离屏首绘，引用保留至原清场，不触发技能、不创建盾、不涂地、不消耗随机数、不推进模拟。取消/失败按所属match释放，旧任务不得销毁新局。

## 基础验证

299份JS语法通过，git diff --check通过。tools/check-boss-combat-programs.mjs使用实际Three WebGL/工厂/prepareMobileCombat：7网格得到6个程序；临时克隆绘制后销毁连续5轮程序ID不变；PC/普通/展示返回空；准备前后场景、真实飞出伞面列表不变；正常/重复/旧局清理及取消、模拟链接失败验证通过，均回收6个自建材质。桌面方法仅验证缓存与生命周期，不能当作手机提帧证据。

## 真机状态

源码基础检查后先中文提交并推送，再干净构建v1.0.52/code52、校验签名/全部资产并安装。待一分钟方法轮检查晚建程序、实际游玩/退出/USB落盘/关闭；正式轮继续使用原Worker250ms门槛。当前30未稳、60未开始。

## 干净构建与安装

功能源码0af291972ae9c75a8a0eea879321a30a85f19df9已推送fork。构建时trackedChanges=false，APK releases/INKWAVE-android-test52-0af2919.apk，21,160,615字节，SHA256 b3fdfe1612c8bbe2fbc69910dc31aab26378835c1628410a026e95870807a258。签名验证通过，证书SHA256 201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69，与旧安装相同。APK内398份Capacitor同步资源与396份dist-mobile源产物逐字节核对通过，ADB install -r成功，手机versionCode52/versionName1.0.52已核对。方法轮运行中，未得出性能结论。

## 第一轮方法结果（未达标）

v52-combat-programs-method：1662帧/67.9253秒=24.468055FPS，P95 66.7/P99 91.6ms，>=100ms11次；43→46°C。171.62米、14477.40伤害、130弱点、1次真实大招，阶段[1,2]。Worker最大271.8ms，result-age一次回退，不放宽250ms。退出恢复通过，UI USB INKWAVE-logs-20261027-003833-874308-7e46cd4a.json落盘核对0af2919，游戏关闭。

本轮阵容没有brolly，不能把未出现新伞面程序算作覆盖通过。新程序未出现SWIRL，但仍有mitts:fists首绘36.8ms及waddle标记圈/boomerang旋转盘15.1～27.4ms（后续重复创建10.7～21.8ms）。只说明仍有其他遗漏，不证明本批提高平均帧率。原始phone-boss-v52-combat-programs-method.json本机保留。正式无探针轮运行中，另需brolly实际游玩覆盖本批透明飞出伞面。

## 无探针正式轮（失败）

v52-combat-programs-formal：1651帧/67.8846秒=24.320685FPS，P95 66.6/P99 83.3ms，>=100ms11次；起始46°C，门槛异常提前中止采集，无结束电池温度，不补造。Worker最大252.6ms、result-age一次回退，状态aborted/进程exit1。实际170.71米、15165.98伤害、128弱点、1次真实大招、阶段[1,2]。真实UI USB INKWAVE-logs-20261027-004045-546294-cc2643a5.json，源码0af2919，落盘及关闭确认。不能认为稳定30或本批已提帧。

接续增加仅方法轮目标绘制计数（heldCanopy/launchedCanopy/swirl及实际程序ID），选原游戏brolly武器正常游玩一分钟，核对飞出伞面确实出现且没有重复程序。正式轮不启用该分支，不修改APK。
