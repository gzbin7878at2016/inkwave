# v51：手机Boss重复DOM写入去重

## 实际问题

v50一秒CSS失效Trace中19个实际游戏帧，TouchInput.setEnabled与installMobile.update各触发19次hidden属性失效；队友标记--far变量写132次。旧style setter与hidden setter即使目标没变化仍可能引起浏览器样式工作。这里只去掉目标值与优先级完全不变的写入，不声称该小点足以独自稳定30。

## 修改范围

- TouchInput.setEnabled增加可选dedupeVisibility，默认false维持原路径；只由真实手机Boss的mobile.update传true。跳跃面板hidden与地图开关真实不同才写，原输入清理、指针归属、地图/暂停/恢复保持。
- 练习按钮同一条件下按实际hidden属性比较，外部改动下次仍纠正，不使用过期的JS缓存；菜单/普通/演示原赋值路径保持。
- HUD._updMarkers仅手机、mode=match、真实非演示Boss下，比较inline --far值及important优先级。距离仍两位小数，继承/透明度/标签缩放公式保持；只省去完全相同且无优先级的赋值。位置、距离采样、标签文字、状态图标和动画全部原样。读CSSStyleDeclaration与hidden属性不查询几何布局。
- 不引入CSS关键帧副本、暂停/降频动画、少画角色或降低画质。PC分支仍每次执行原setProperty，所有游戏规则/物理AI子步保持。

## 基础验证

check-mobile-boss-dom-writes.mjs在真实浏览器加载源HUD/TouchInput/installMobile，以固定距离、变化位置强制走120次实际标记更新：Boss距离变量仅写1次，PC/普通/演示/菜单均原120次。最终位置、变量及计算样式完全一致（透明度0.865、标签scale0.946）；距离变化、外部important移除语义通过。

实际mobile.update重复120次，Boss两个hidden均零写；普通/演示/菜单仍各120次原setter。地图开/关、外部hidden改值纠正、暂停禁用及恢复启用通过。CPU时间线裁边/嵌套不重复/跨线程/空隙/实际帧数归一单测通过；这些桌面检查不作手机FPS。

按要求基础检查后先中文提交推送，再干净构建v1.0.51/code51。安装后先一分钟方法轮与同样1秒失效Trace，检查hidden重复失效消失及--far实际写入变化，保留真实操作/2倍/SMAA/8人；正常退出菜单恢复、UI USB核对关闭。再无探针正式轮，结果单独中文提交，仍未稳定30不进入60。

## 干净构建与安装

源码80a2b9b61e5f9fc8949f9c4f61678cc00bcad7ee，trackedChanges=false，v1.0.51/code51。APK releases/INKWAVE-android-test51-80a2b9b.apk，21,159,447字节；SHA256 abe91df295fe28ce52ede7953f4ca0516b1f8a31badcf040bbb43e20f25805e5。v2签名验证通过，证书201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69；398同步资产/396dist资产逐字节匹配。ADB覆盖安装成功，正在一分钟方法轮和1秒失效Trace；尚无真机收益结论。

## 方法轮：重复失效在手机实际减少

新1秒Trace boss-trace-2026-10-27T00-19-53-367Z.json，8,142,626字节，dataLoss=false/eventsTruncated=false，开始结束玩家均存活，实际590→610共20游戏帧。对照v50旧采样19帧：两个hidden属性重复失效各19→0；标记--far setter132→14，位置transform132→137继续正常更新。按实际帧归一，far写约6.947→0.700次/帧，hidden1→0次/帧。源行确认为同样的--far写入，不把位置变化当变量写。

最内层Document::recalcStyle线程CPU117.359/19→116.714/20，即6.1768→5.8357ms/游戏帧。但两窗口对象/相机/几何量不同且有失效跟踪开销，只证明写入减少，不能独立量化因果提帧。

完整方法轮1655/67.4052秒=24.55300FPS，P95 66.7/P99 83.4ms、长帧10，43→46°C，非正式成绩。实际169.56米/14282.20 Boss伤害/121弱点/一次大招，阶段[1,2]。2倍/SMAA/8人和正常退出恢复通过；真实UI USB002149-487325-b8a2234d核对80a2b9b，已关闭。下一步正式无探针轮，全部Trace及副本/旁路为0，不修改原Worker安全门槛。
