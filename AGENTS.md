# 本仓库开发与跨电脑同步规则

## 当前接续（2026-10-27，优先于历史版本说明）

- 仅Android Boss；先稳定30再60，保持2倍高清/SMAA/8人/原玩法及物理AI子步，PC保持。目标active，接续id=boss；USB在线常亮2，不并发操作CDP。所有测试进程已结束，游戏已关闭。
- 已安装v1.0.45/code45，干净源码f153b62；见docs/android/BOSS-PERFORMANCE-test45.zh-CN.md。v44仅补诊断字段，上传日志scene.render.smaaEdges已核对真实RG16F/1556×740/附件16,16,0,0/frames1993/逻辑省4605760字节。真实UI USB201534-767389-92c6f686，见docs/android/BOSS-PERFORMANCE-test44.zh-CN.md。
- v44无调查轮26.44778FPS；v43正式26.416/17.428FPS，低值保留，30未稳、60未开始。v43 RG16F保浮点精度/权重/HDR/全尺寸，72组接口/54组像素及安装目标对原RGBA16F参考手机差0；RG8手机max102拒绝。逻辑4.39MiB不当实测FPS/功耗。
- 当前v45 APK releases/INKWAVE-android-test45-f153b62.apk，21,157,057字节，SHA256 17419a4afb84103a5cc405644fd6ab77ff88d48b592da2b55c19af370704557b；v2签名与396资产一致。实际方法轮27.77394FPS/40→45°C，Worker1001提交/1000应用回收、grid2/行3套、无回退、max2帧/121.3ms，退出恢复与USB205620-988949-b5b24018核对f153后关闭；方法不是正式成绩。
- 新工具小地图Worker：420组真实原入口/Canvas/halo/owner/闪光一致，取消/异常/超时/预算/三请求/重建已验。手机副本Main显式有节省，但计算总CPU不降；playing20.024秒120帧72段全部同序、像素一致，Main190.7→58.2ms，年龄P95两帧/显示109.7ms、max176ms/>100ms八次；结算另有max2408ms，不能只看帧数。详见docs/android/BOSS-MINIMAP-WORKER.zh-CN.md，勿重复副本试验当产品成绩。
- playing副本工具8da2cfe先提交后测试，方法整局25.22049FPS/44→47°C，USB203455-167635-5143a1e7核对219源码/退出恢复并关闭。原同步路径仍在产品；有额外同步原算法参考CPU，不是Worker实战收益。
- v45方法已证明实际启用与退出释放；下一步无探针正式两局自然60游戏秒，全部Worker副本/比较/隔离flags为0，BOSS_REQUIRE_MINIMAP_WORKER=1、REQUIRE_LOG_EDGES=0（独立日志字段在正式落盘后核对）。每轮真实上传关闭，保留温度与低值；无正式收益撤回候选，30未稳/60未开始。
- HUD all/bar/special/markers/map/top/controls/panel/crosshair、距离变量、原生装饰15Hz无明确Main收益，未产品化；见BOSS-MAIN-INVESTIGATION/BOSS-DOM-INVESTIGATION。实战CPU4/7策略1324.8/1651.2MHz曾打满，不把空闲921.6或热状态3当完整因果。SDK View.setRequestedFrameRate自API35，当前手机34不可用；无隐藏反射/虚假Surface/全局显示或性能改动。
- 正式METHOD_PROBE=0，全部ablation/DOM/layer/marker/nativePaint/格式比较/生命周期/小地图benchmark及worker副本flags均0；REQUIRE_SMAA_EDGES/RASTER_HINTS/AUDIO_PARAM_DEDUPE/SMAA_CLEAR/LENS_PREPARATION=1，ANIMATION_CLOCK/MINIMAP_CACHE/LENS_DRAW=0。REQUIRE_LOG_EDGES仅上传时Boss仍active的v44诊断轮，退出菜单恢复后不要求active。
- Trace禁/json/protocol（曾SIGTRAP）、禁详细Skia12秒超256MiB。仅已验3秒短Trace/20秒native，本页PID绑定/严格CPU字段/完整buffer与切换一致。原始系统线程只留releases；保留用户Logs/、play.bat、start-game.bat。先中文commit/push fork，再干净构建/安装/60游戏秒正常操作，真实UI USB核对后关闭；结果独立中文提交。

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
