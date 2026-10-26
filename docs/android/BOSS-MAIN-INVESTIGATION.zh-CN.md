# Boss主线程调查（v42之后）

当前产品仍v42/功能源码f7bd686，目标未达到：正式热机18.341/18.013FPS，30未稳定，60未开始。以下全为独立方法调查，不作成绩、不新增APK功能。

## 实战CPU策略与V8

只读工具capture-phone-cpu-policy，不改手机设置。空闲120秒24样本appPID均空，温度46→45°C，CPU7策略上限1651200kHz；更早空闲单点921600，不能用空闲值代表游戏。随后实战90秒18样本实际app24723：0/4/7策略上限1228800/1324800/1651200，硬件上限1804800/2496000/2995200kHz，4/7当前多次达到策略上限，温度44～48°C。这证明当前策略约束存在，尚未通过同温对照单独证明热原因或其解释全部帧率差异。

同局30秒V8：25539样本，(program)11536.5ms、_drawInk842.6ms、Character.update自耗470.2ms、GC373.4ms、setProgram345.6ms；_frame包含17334.4ms、match.update约7251.8ms、renderer约5043.6ms、character.update包含2828.4ms、_updateHud1978.3ms。包含/自耗有嵌套，不能相加；(program)不能全部归属某个JS方法。3秒时间线完整、未丢失/截断：UpdateLayoutTree线程CPU342.58ms，Layerize142.16ms，Main RunTask2710.54ms，FunctionCall1758.55ms，嵌套不可加。方法25.32195FPS，USB日志191357-788467-e86bf78b核对f7源码并关闭。

## 距离变量传播对照：未证明收益，不产品化

15～45秒将原--far写入临时转成等值非继承opacity/scale，完整HUD/动画/画质/玩法保持。Edge数值一致和原方法恢复通过。手机拦截4945次，15.001秒开启、45.015秒恢复，正常结束、USB191733-083655-8a8a00f5核对并关闭。整局方法23.45692FPS，46→48°C。

| 约3秒完整事件 | 原始6.421～9.464秒 | 本地值20.253～23.321秒 |
| --- | --- | --- |
| UpdateLayoutTree CPU | 343.18ms/93次 | 388.44ms/99次 |
| 每次样式重算CPU | 3.69ms | 3.92ms |
| Layerize CPU | 149.13ms | 164.87ms |
| EndRaster CPU | 738.29ms | 868.22ms |

均存活；绘制76～84 vs94～101calls，三角形762k～801k vs789k～821k不同，不能强说变量改动使其变慢，但没有收益证据。原始3秒事件无丢失/截断。保留工具、不改变产品。

## 原生装饰动画15Hz分档：API可用，收益不足，不产品化

BOSS_NATIVE_PAINT_PROBE=1，仅15～45秒对无限循环且涉及boxShadow/filter/strokeDashoffset等重绘属性的动画设置全局原生steps，约15Hz；保留关键帧原easing及原时间轴，不逐帧getAnimations/seek/pause，有限动画、transition、纯transform忽略。用animationstart处理动态加入的动画，弱引用128上限，暂停/退出恢复原easing和事件监听。

Edge范围/关键帧/时钟/动态加入/暂停恢复与重新接管通过。当前手机实际接管8次（iw-jline、iw-sq-glow、iw-sp-glow、iw-dash、iw-mk-ready），0错误；6个尚存动画恢复，其余已由CSS取消，15.041秒开启、45.006秒恢复。3秒Trace无丢失/截断，均存活：

| CPU事件 | 原始6.645～9.705秒 | 分档20.435～23.453秒 |
| --- | --- | --- |
| UpdateLayoutTree | 304.11ms/101次 | 290.49ms/122次 |
| Layout | 60.03ms | 29.57ms |
| Layerize | 167.91ms | 147.78ms |
| EndRaster | 622.36ms | 629.84ms |
| Main RunTask | 2659.77ms | 2711.66ms |

绘制65～78 vs116～125calls、749k～781k vs806k～824k不同，不能独立归因。样式减少约13.6ms/3秒，不足以冒然付出装饰刷新变化的代价。整局方法26.18271FPS/P95 58.4/P99 75.1ms、>=100ms12次；实际UI USB192301-348242-301f843b核对源码、退出恢复、关闭通过。不是正式成绩。

## 下一步：补齐界面隔离覆盖

此前“整体DOM隐藏”包含.iw-hud、.iw-hud-over、#mobile-controls、#mobile-panel；分组件只试了bar/special/markers/map/top，**尚未单独隔离触屏controls、调试panel和准星/墨量条**。先补这些组件的同局native Main/GPU服务对照，仍正常模拟与音频、60游戏秒/上传关闭，隐藏数据不算成绩，不直接发布隐藏控件。

另外，正式绘制排行静态props paint/gloss四桶约436k三角形/帧，当前设备支持WEBGL_multi_draw、列表无timer_query。按空间剔除或BatchedMesh是潜在后备思路，未实现/未验证；v35旧props隐藏阶段仍约24FPS，不能假定减三角形能解决主线程。先定位当前界面覆盖缺口。角色每物理子步更新依赖脚步/武器挂点/事件，不削子步或人数。
