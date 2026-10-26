# 本仓库开发与跨电脑同步规则

## 当前接续（2026-10-27，优先于历史版本说明）

- 仅Android Boss；先稳定30再60，保持2倍高清/SMAA/8人/原玩法及物理AI子步，PC保持。目标active，接续id=boss；USB在线常亮2，不并发操作CDP。v46两局正式均完成、上传核对并关闭；v47回退代码待提交后构建，无授权阻塞。
- 当前安装v1.0.46/code46，干净功能源码a824d2c，v46见docs/android/BOSS-PERFORMANCE-test46.zh-CN.md；手机样式/启停/退出验证通过，方法26.40870FPS非成绩，USB211320-723236-6f9c13fb核对后已关闭，再开始正式轮。以下v45为历史基线。读docs/android/BOSS-PERFORMANCE-test45.zh-CN.md：手机Boss加载期准备Worker、最多3请求、原0.15秒/3段/全分辨率/算法，主循环按序应用，3帧或250ms超限回原整图，暂停/背景/换色/force/重建/取消/旧局保护；grid/输出行回收。
- 正式两局27.27766/27.34379FPS，1739/63.7518与1743/63.7439秒，P95 58.3/50.1、P99 66.7/75ms、>=100ms四/十一次，44→46/46→48°C，固定2倍/SMAA/8人、无方法/副本/隔离/Trace，shaderFailures0；30未稳/60未开始，不把与旧版阵容/温度不同的比较当严格因果证明。旧v43低值17.428保留。
- 正式Worker提交/应用1017/1017与1015/1014（末段结算取消），grid2套/行3套，peak2，maxAge2帧/148.7和137.7ms，fallbacks0；结算inactive的fallbackFullDraws1是收尾整图。真实USB205901-671960-dacf71a1及210057-839155-48919c79内Worker字段/源码f153已核对并关闭。方法轮27.77394/40→45°C、退出恢复通过，USB205620-988949-b5b24018；方法非正式。
- APK releases/INKWAVE-android-test45-f153b62.apk，21,157,057字节，SHA256 17419a4afb84103a5cc405644fd6ab77ff88d48b592da2b55c19af370704557b，v2证书201c792d…、396资产一致。84段真实update原像素/闪光/owner/时序、回退原公式、420组内核/Canvas、取消/异常/过期/新旧局/PC普通演示/资源与打包后Blob内核及移动+PC回归通过。
- v43 RG16F保浮点精度/权重/HDR/全尺寸，72接口/54像素及安装目标对原RGBA16F参考手机差0；RG8手机max102拒绝。v44补上传smaaEdges字段。逻辑省4.39MiB不能当GPU实测内存/功耗或FPS。
- v46正式27.38524/27.46147，无明确收益，USB211620-216495-cef16aae/212051-518851-dcb17061核对a824后关闭。v47恢复所有可见装饰，仅7个非本人opacity0箭头停转，strategy=hidden-arrows；10可见动画/13关键反馈及隔离/生命周期与273JS通过，见test47。待提交后干净构建安装一分钟方法恢复验证，不声称已稳30。
- 已做HUD all/bar/special/markers/map/top/controls/panel/crosshair、距离变量、原生装饰15Hz等调查无明确Main收益；见BOSS-MAIN-INVESTIGATION/BOSS-DOM-INVESTIGATION，不能把新装饰停止方案预先当有效。CPU4/7策略1324.8/1651.2MHz曾打满，SDK View.setRequestedFrameRate自API35而当前手机34不可用；不加隐藏反射/虚假Surface/全局显示或性能改动。
- 正式METHOD_PROBE=0，所有ablation/DOM/layer/marker/nativePaint/格式比较/生命周期/minimapBenchmark及Worker副本flags均0；REQUIRE_MINIMAP_WORKER/SMAA_EDGES/RASTER_HINTS/AUDIO_PARAM_DEDUPE/SMAA_CLEAR/LENS_PREPARATION=1；ANIMATION_CLOCK/MINIMAP_CACHE/LENS_DRAW/REQUIRE_LOG_EDGES=0。正式结算上传手工核对Worker字段；方法verifyBossExit1则上传时新菜单地图无旧Worker信息。
- Trace禁/json/protocol（曾SIGTRAP）、禁详细Skia12秒超256MiB。仅已验3秒短Trace/20秒native，本页PID绑定/严格CPU字段/完整buffer与切换一致。系统线程原始只留releases，保留用户Logs/、play.bat、start-game.bat。基础检查后中文commit/push fork，再干净构建安装/60游戏秒正常输入/真实UI USB核对后关闭，结果独立中文提交。

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

## 历史记录（以下旧版本不能代替当前接续）

最新纹理批次：v18功能源码b69f3a9已安装，手机海港远景反射256、PC512，颜色+mip估算省12MiB；冷启动3次及海港巡检通过，一分钟Boss28.917FPS仍未稳定30。先读docs/android/TEXTURE-test18.zh-CN.md；其他纹理候选未降档，不能把海港内存收益当作潮汐Boss提帧。

2026-10-26最新优先级：持续仅优化Boss，先稳定30再60，保持2倍/SMAA/8人/玩法/PC。当前恢复安装v31源码0b59a2f且关闭，正式29.044/28.044、热机27.211FPS，未稳定30；读docs/android/BOSS-PERFORMANCE-test31.zh-CN.md。少一遍输出及像素/程序/退出恢复已验，但v30对照温度/阵容不同，不称严格提帧。新V8样本_drawInk自耗时800.7ms/30秒；下步仅Boss缓存小地图未变化像素计算，原刷新率/分辨率/bilinear/emboss/owner闪光保持，加载期有界缓存、重建/配色失效，先真实Canvas原入口逐字节/随机序列/最坏负载性能验证，有益才提交构建；不削AI/物理/枪口。音画旁路不作成绩，窗口不称锁60、墙钟不当纯CPU，不隐藏热机低值。目标active无授权阻塞，接续id=boss，不并发USB/CDP，每局60秒上传核对关闭。USB常亮已授权、电脑睡眠0，未改全局性能。达标才完成，不伪装失败。

2026-10-26补充：按用户要求，修改完成并做基础检查后先中文commit/push，再打包真机测试，测试结论单独提交。Boss每局60秒，结束后上传日志确认落盘，再关闭游戏。当前优先处理初始化失败；v17手机云烘焙512×160后最终3次完整冷启动通过，PC仍2048×640，稳定30帧尚未通过。新电脑先读GRAPHICS-INIT-test16与USB-BOSS-AUTOTEST说明，不把Maleoon历史设备与当前ALP-AN00/Adreno730混用。
