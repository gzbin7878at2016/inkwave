# 本仓库开发与跨电脑同步规则

2026-10-27 03:23最新：产品仍安装v42/干净功能源码f7bd686，游戏关闭；30未稳、60未开始，正式18.341/18.013仍为失败结果。读docs/android/BOSS-MAIN-INVESTIGATION.zh-CN.md。已完成空闲/实战只读CPU策略：实战0/4/7上限1228.8/1324.8/1651.2MHz，4/7多次打满上限，硬件1804.8/2496/2995.2，不能用空闲921.6代表实战或全归因热。新V8 30秒25539样本/program11.54s、_drawInk842.6ms；3秒Timeline样式342.58ms CPU、Layerize142.16。距离变量4945次拦截样式343→388ms无收益，不产品化；原生循环装饰15Hz只设置全局steps、保留关键帧与时钟、无逐帧枚举，手机8次接管0错、6个存活动画恢复，但样式304→290ms/Main2660→2712ms且负载不同，收益不足，不产品化。两个工具仅tools/独立方法，APK不含，正式不能开启BOSS_MARKER_VAR_PROBE/BOSS_NATIVE_PAINT_PROBE。三局方法25.322/23.457/26.183不作成绩，实际UI USB191357-788467-e86bf78b/191733-083655-8a8a00f5/192301-348242-301f843b均核对f7源码并关闭。下一步补controls/panel/crosshair+墨量条独立DOM/native覆盖：全DOM原包含这几块，但前面bar/special/markers/map/top未覆盖，不能推断全HUD原因已定位。先新增枚举/范围测试中文提交推送，再60秒调查/同存活近似负载native对照，不隐藏交付。静态props paint/gloss约436k三角形且multi_draw支持是后备，v35隐藏props无提帧，先不盲改批次。保持2倍/SMAA/8人/音频/物理AI子步/PC；正式所有调查标志0/REQUIRE_RASTER_HINTS=1、AUDIO_PARAM_DEDUPE=1、SMAA_CLEAR=1、ANIMATION_CLOCK=0。先中文commit/push再干净构建，每局60游戏秒上传关闭；目标active/id=boss，USB在线常亮2，不并发CDP，无授权阻塞。


2026-10-27 03:05最新优先：仅手机Boss，当前安装v42/干净功能源码f7bd686，游戏已关闭。读docs/android/BOSS-PERFORMANCE-test42.zh-CN.md末节。标签will-change候选已产品化，仅手机真实Boss playing，PC/普通/演示/暂停/后台/准备/离场清理；helper脏检查，无逐帧布局读取。手机像素远/中完全一致、远→近7/185900像素微差；临时同局Trace标签RasterTask433→8、EndRaster CPU984→578ms；无详细Trace native GPU服务67.224→46.886%，Main89.456→91.261%未改善。v42方法27.177含死亡不作成绩；正式无探针18.341/18.013FPS，47/48→49°C，低于v41旧正式25.535/26.556，未证明提帧且30未稳/60未开始。全部真实UI USB190026-837434-163b9b16/190254-677890-207f695c/190530-554466-3f014937核对f7源码并关闭。功能提交f7bd686已推送后干净构建安装，APK21,146,553字节/SHA256 a6d5a9eeaf5eb595a0d55652a7fba0232a4c7847e7b91467bde9c1d3114aec8d/v2签名/390资产一致。当前49°C自然降温，下一步同温v41/v42或同源开关对照和新30秒V8/原生Main采样，不能凭热状态3断言因果（skin45.595、cooling CPU0）。保持2倍/SMAA/8人/玩法/PC，不跳物理或AI子步；角色视觉5.14秒整局是线索但武器socket/脚步/事件依赖未审。Trace仅3秒blink.user_timing/gpu/cc/viz/skia，禁json/protocol/详细Skia12秒；BOSS_TRACE_START_SECONDS边界前DOM映射耗时数秒，不直接当标记起点。native layers种类支持，分析脚本旧hidden-dom标签实际为提示且从未隐藏HUD。正式METHOD_PROBE=0/所有旁路/临时BOSS_LAYER_HINTS=0/REQUIRE_RASTER_HINTS=1、AUDIO_PARAM_DEDUPE=1、SMAA_CLEAR=1、ANIMATION_CLOCK=0；每批中文commit/push再构建测试，每局60游戏秒上传核对关闭。目标active/id=boss、USB在线常亮2、不并发CDP，无授权阻塞。


2026-10-27更新优先：仅Android Boss，当前安装v41/干净功能源码252fcda，游戏已关闭。功能不变，正式25.535/26.556FPS，30未稳、60未开始。渲染采集修复ff9e7c9/81bb851已推送：禁止访问WebView /json/protocol（同时间原生SIGTRAP），菜单ReturnAsStream验证通过；详细Skia12秒超过256MiB，不再重复。改blink.user_timing/gpu/cc/viz/skia仅3秒后正常13.16MB/71444事件、无丢失/截断，GPU服务EndRaster1615次CPU1056.53ms，标签层重复RasterTask，线程CPU非GPU硬件耗时。读BOSS-DOM-INVESTIGATION末节；同局后期LayerTree映射有时间差，不强行归属销毁层。完整HUD方法25.183FPS，45～49秒死亡混杂，不作成绩；自然结束/退出恢复/USB184757-292836-b05acf7b核对/关闭完成。下一步独立Boss完整HUD临时will-change提示，先同步图层/同阶段Trace及清晰度内存对照，有益才产品化，不恢复逐帧CSSAnimation失败方案。保持2倍/SMAA/8人/音频玩法/PC；每批基础检查中文commit/push再干净构建/测试，60游戏秒上传关闭。USB常亮2，目标active，id=boss，不并发CDP，无授权阻塞。


2026-10-27当前接续（优先于下方历史）：当前安装v1.0.41/干净功能源码252fcda，游戏关闭，源代码本轮未改。30未稳定、60未开始，正式仍25.535/26.556FPS；音频去重约31～33%事件但CPU未显著下降。读docs/android/BOSS-DOM-INVESTIGATION.zh-CN.md末节。已独立60秒DOM+同局20秒native：整体隐藏时Main82.63→70.68%、GPU主机58.42→14.63%、Compositor40.55→9.02%；单独marker Main86.73→85.34/GPU60.20→47.06，top Main90.91→87.83/GPU66.63→51.60但窗口死亡且绘制调用99→49，不能独立归因；map/bar/special都未明显释放Main。动画与transition暂停12～18vs恢复22～25：Main81.64→88.27、Compositor23.09→41.17，GPU51.95→56.02，不能全归因无限循环。每轮保留正常模拟/音频/2倍/SMAA/8人，临时样式恢复/实际UI USB核对源码/关闭已完成，全部是调查不作成绩，别把不同局各比例相加。源码已确认Boss条是transform、队伍栏脏检查完整、诊断文本1秒刷新，不能盲猜重建/width。下一步优先读Tracing.getCategories做独立12秒GPU/Skia/Viz细类Trace，定位真实栅格/合成工作，不依据混杂top数据直接做图标缓存；可另试完整HUD临时will-change图层提示，需新工具/基础验证/中文提交、有效窗口同存活/近似绘制量，不直接上产品。不要恢复v38/39逐帧CSSAnimation采样失败入口。当前BOSS_DOM_PART支持all/bar/special/markers/map/top；BOSS_TRACE_PROBE支持passive/dom/ui，dom/ui4～8秒触发、锚点≤10、20秒内核。native本页performance.mark绑定PID、严格CPU字段正则、8核/无buffer丢失/切换一致0，各报告本地systemtrace-v41-*-native.cpu.json；原始含其他系统线程不入Git。renderer cgroup/vip+top-app，Awake/供电/stayOn=true，GameMode unsupported只读未改策略。动画steps/linear API探测在本地native-animation-step-api.json，未接入产品；小地图392×658/CSS57×95/DPR3.25虽过采样，隐藏未获益，暂不降。正式REQUIRE_AUDIO_PARAM_DEDUPE=1、SMAA_CLEAR=1、ANIMATION_CLOCK=0，所有旁路/DOM/UI/生命周期/小地图默认0，镜头预备1。每批中文commit/push后干净构建真机，每局60秒上传核对关闭。目标active，接续id=boss，USB常亮2，无授权阻塞，不并发CDP。







本规则适用于整个仓库。用户要求每批修改及时提交GitHub并逐批汇报。

1. 开始工作先阅读 `docs/DEVELOPMENT-HANDOFF.zh-CN.md` 和 `docs/android/PROGRESS.zh-CN.md`，检查分支、远端和工作区。最新Android开发分支为 `codex/android-capacitor`，不是main。
2. 开工前获取远端更新；工作区干净且没有分叉时使用fast-forward同步。不覆盖他人或用户未提交文件，不使用强推、硬重置或无检查的清理操作。
3. 每次完成一个可独立验证的小修改，立即运行适当检查，更新开发进度/交接文档，使用中文提交说明commit，然后立即push。文档和修复也适用，不积攒多个模块到最后才提交。这里的实时提交指每个可验证小步，不是每次键盘输入都提交。
4. 当前机器推送目标为用户仓库 `https://github.com/gzbin7878at2016/inkwave.git` 的 `codex/android-capacitor`；本机远端名为fork，origin是jaydendavisnc上游（其他电脑可能不同）。远端名字不代表所有者，新电脑必须核对URL。禁止误推上游jaydendavisnc仓库，未获用户要求不要合并到main。
5. 只暂存本批明确修改的文件，检查暂存差异；不要一键加入用户日志、视频、私人脚本、依赖、密钥或APK。推送后核对远端分支哈希与本地HEAD一致；失败要明确报告，不能把仅本地提交称为已同步。
6. 每批汇报修改内容、验证结果、提交号、推送状态、尚未验证事项和下一步。功能开发保持中文注释。普通文档修改不需要重新构建APK或跑整套游戏回归。
7. 换电脑前确保本批代码及交接记录已推送；无法验证的必要交接提交须中文注明“未验证”，记录原因和恢复步骤，不伪称测试通过。新电脑先阅读记录、同步代码并完成缺失验证，再继续下一模块。
8. 手机改动不得改变PC原有效果。按用户2026-10-24最新要求优先稳定30～40帧、避免个位数长停顿，本批手机默认30帧，仍提供30/60选择；固定2倍高清、SMAA、默认关闭自动降清晰度、原对局人数保持。不得偷偷降低画质或减少人数制造帧率收益。
9. 已收到v1.0.8/v1.0.9/v1.0.10真机诊断；v10 Boss开场前准备19.879秒、首次衣服仍1630ms长任务。v1.0.11用加载进度覆盖首次工作，加入缓存快路径、角色/Boss/战斗资源真首绘与小怪复用；等待真机复测。不能宣称已消除ANR或已真机稳定30帧。真机、桌面浏览器、资源上限模拟的结果分别记录。
10. APK交付必须记录版本、源码提交、源码是否有未提交修改、SHA-256、签名验证和真机验收状态。签名私钥、代理与SDK路径留在本地；跨电脑签名迁移按交接指南执行。

Git只同步已提交且已成功推送的文件。本文件是开发流程约束，不是后台自动备份服务；离线、认证失败或未提交内容无法自动同步。

最新纹理批次：v18功能源码b69f3a9已安装，手机海港远景反射256、PC512，颜色+mip估算省12MiB；冷启动3次及海港巡检通过，一分钟Boss28.917FPS仍未稳定30。先读docs/android/TEXTURE-test18.zh-CN.md；其他纹理候选未降档，不能把海港内存收益当作潮汐Boss提帧。

2026-10-26最新优先级：持续仅优化Boss，先稳定30再60，保持2倍/SMAA/8人/玩法/PC。当前恢复安装v31源码0b59a2f且关闭，正式29.044/28.044、热机27.211FPS，未稳定30；读docs/android/BOSS-PERFORMANCE-test31.zh-CN.md。少一遍输出及像素/程序/退出恢复已验，但v30对照温度/阵容不同，不称严格提帧。新V8样本_drawInk自耗时800.7ms/30秒；下步仅Boss缓存小地图未变化像素计算，原刷新率/分辨率/bilinear/emboss/owner闪光保持，加载期有界缓存、重建/配色失效，先真实Canvas原入口逐字节/随机序列/最坏负载性能验证，有益才提交构建；不削AI/物理/枪口。音画旁路不作成绩，窗口不称锁60、墙钟不当纯CPU，不隐藏热机低值。目标active无授权阻塞，接续id=boss，不并发USB/CDP，每局60秒上传核对关闭。USB常亮已授权、电脑睡眠0，未改全局性能。达标才完成，不伪装失败。

2026-10-26补充：按用户要求，修改完成并做基础检查后先中文commit/push，再打包真机测试，测试结论单独提交。Boss每局60秒，结束后上传日志确认落盘，再关闭游戏。当前优先处理初始化失败；v17手机云烘焙512×160后最终3次完整冷启动通过，PC仍2048×640，稳定30帧尚未通过。新电脑先读GRAPHICS-INIT-test16与USB-BOSS-AUTOTEST说明，不把Maleoon历史设备与当前ALP-AN00/Adreno730混用。
