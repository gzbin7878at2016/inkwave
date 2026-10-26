# v27：手机Boss反弹标记弹尾迹程序预备与保留

## 从日志到本批范围

v26界面隔离调查暂停CSS动画并未在恢复/再次暂停之间形成稳定提升，因此未削减正式HUD。该轮28.043FPS、有探针和临时样式，不能计成绩，USB为INKWAVE-logs-20261026-110706-424920-2178f4da.json。

该轮曾见iw-brolly-ink晚创建程序，随后选择本地正常装备brolly复现：一分钟27.029FPS、≥100ms5帧，仍仅调查，USB为INKWAVE-logs-20261026-111056-429693-63cd048b.json；未再次出现伞布晚程序。本地伞布原有透明预热会保留对应程序，不能把前一轮疑点当成本轮复现，更没有盲改伞枪玩法。

完整着色器头与程序key揭示另外的重复首用：tracer尾迹相同源码在9.27/26.94/45.30/63.25秒分别创建新程序，vertex/fragment代码ID不断更新。源码makeRibbon每条尾迹创建独立ShaderMaterial，尾迹结束dispose；当最后一个程序引用销毁，下一发又需重新准备。waddle提示与屏幕镜头光斑也有首次程序，留给后续单模块；本批仅处理tracer尾迹。

## 实现

- 只在手机Boss、阵容确实有subId=tracer时，加载队列用原makeRibbon工厂建立一个不可见、未加入实战scene的程序引用，走原4×4准备/链接检查/首绘流程。只需一个引用，颜色/寿命是uniform，不改变shader变体。
- 同配方程序在局内保持引用；真实每条尾迹仍保留独立几何、颜色/时间/寿命uniform和原结束dispose，不共享动态状态，不改弹道/碰撞/伤害/墨量/人数/画面。
- 换局原kit.clear释放引用几何/材质；准备异常或取消也释放所属match引用，旧任务不能清掉新一局引用。额外仅一条160点尾迹的缓冲与一个材质，不保留整局历史弹体。
- PC、手机普通对局或未装备tracer时不创建引用；没有扩大到所有武器/地图。预备引用的缓冲不能代表真实弹体缓冲也已上传，收益范围只宣称程序准备与生命周期。

## 基础验证

本地8490服务下node tools/check-boss-tracer-reference.mjs使用真实WebGL和原SUB_KITS.tracer.use/tick，连续3发自然结束：实际尾迹均共用预备程序ID，每条材质仍独立；最后尾迹销毁后程序保留，kit.clear两次只释放一次几何/材质且程序消失。准备无发射/时间副作用，PC/普通/无装备分支不创建，旧任务隔离、真实准备异常/取消各释放一次通过。另运行语法、mobile-combat-preparation和mobile-boss-preparation专项。

浏览器原始结果在releases/investigation/boss-tracer-reference-browser.json，只证明程序/状态边界，不代表手机FPS。先中文提交推送，再干净构建v1.0.27/code27；带探针brolly装备一分钟核对是否仍出现tracer相同源码晚程序，再无探针常用装备两轮原画质60秒。各轮自然结束、USB核对源码后关闭，结果另提交。稳定30仍未通过，60不提前启动。

## 真机结果：尾迹不再晚建程序，整体帧率仍未达标

干净源码82d9e68d0f468bbaf797e57c7dc6a0c806278544，v1.0.27/code27；APK releases/INKWAVE-android-test27-82d9e68.apk，21123241字节，SHA-256为e41fd6a7ab817e953764434efec2209634090a7b15e8626182e45198f5a0cc1b。签名验证通过，证书SHA-256为201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69；372资源逐字节一致，219文件语法、移动网络、通用/Boss准备与生命周期专项通过。源码trackedChanges=false，USB安装成功；完整性能验收未通过，构建元数据deviceTested仍false。

带探针brolly控制轮实际tracer_zap播放3次、反弹音1次，尾迹源码晚程序0；旧控制轮发射6次且尾迹晚建4次，次数/温度不同，不能据平均FPS声称严格提升。新控制轮只有LineBasic/MeshBasic导引与屏幕光斑3个晚程序，仍有其他首用可追查。加载战斗阶段多1步，约278ms、最大单步45ms；未阻断启动。

| 轮次 | 实战秒数/帧数 | 平均FPS | p95/p99（ms） | ≥100ms | 电池温度 |
| --- | --- | --- | --- | --- | --- |
| brolly方法探针，不计成绩 | 62.0681/1780 | 28.678 | 50/58.4 | 4 | 41→46°C |
| 正式1，原常用装备 | 64.9971/1725 | 26.540 | 58.3/75 | 8 | 46→46°C |
| 正式2，原常用装备 | 65.6418/1682 | 25.624 | 58.4/75.1 | 7 | 46→47°C |

游戏时钟60秒，实际墙钟在慢帧钳制下超60秒，帧间隔完整保留。两正式轮无方法探针或遮蔽/工作跳过，均2倍/SMAA/8人正常输入、自然结束、USB源码核对后关闭。稳定30未通过，60未开始。正式1/2仍各有无新增程序的105/130ms CPU帧，其中simulation84.5/113ms；方法墙钟包含线程被系统抢占的时间，不能仅看simulation标签就认定一直在执行模拟运算。

本地原始资料：phone-boss-v27-tracer-reference.json、phone-boss-v27-full-1.json、phone-boss-v27-full-2.json，位于releases/investigation。USB文件依次INKWAVE-logs-20261026-111916-850149-2ff61495.json、INKWAVE-logs-20261026-112107-825631-936d65ed.json、INKWAVE-logs-20261026-112254-032634-936573a5.json。

下一步用手机原生atrace的sched/freq/gfx/view/webview，在独立带探针一分钟轮采有界20秒；已确认本机categories与CLI参数支持，不需root。目的是分开线程Running/Runnable/等待和原生合成，仍不把系统跟踪轮当成绩。当前安装v27、游戏关闭、目标active，PC和其他场景保持原效果。
