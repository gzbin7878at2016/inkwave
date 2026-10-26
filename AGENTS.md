# 本仓库开发与跨电脑同步规则

## 当前接续（2026-10-27，优先于历史版本说明）

- 仅Android Boss；先稳定30再60，保持2倍高清/SMAA/8人/原玩法及物理AI子步，PC保持。目标active，接续id=boss；USB在线常亮2，不并发操作CDP。
- 已安装v1.0.43/code43，干净功能源码e7e8329，当前游戏关闭。读docs/android/BOSS-PERFORMANCE-test43.zh-CN.md：RG16F仅省边缘未用通道，保留浮点精度、权重/HDR/全尺寸；失败/取消/离场恢复RGBA16F，72组接口/54组像素、手机实际目标对原参考均字节差0。
- 正式无探针26.416/17.428FPS，45→48/47→48°C；**30未稳，60未开始，未证明正式提帧收益**。所有自然60游戏秒、真实UI USB核对源码后关闭；不能用方法/遮蔽/格式比较或4.39MiB逻辑省量当成绩。
- APK releases/INKWAVE-android-test43-e7e8329.apk，21,148,049字节，SHA256 8a59014670726e12bebfa15a7e26d063f5a5090c21084c867e97a944da3cfc67；v2签名与390资产一致。RG8手机max差102已拒绝；RG16F安装目标与RGBA16F参考差0，161397非空边缘全二值、权重/目标恢复，USB200752-803967-3329cc3d。
- 已完成HUD all/bar/special/markers/map/top/controls/panel/crosshair隔离；变量本地化、原生装饰15Hz无明确收益，未产品化。详见BOSS-MAIN-INVESTIGATION.zh-CN.md/BOSS-DOM-INVESTIGATION.zh-CN.md，勿重复负结果。实战CPU4/7策略1324.8/1651.2MHz且曾打满；不能把空闲921.6或热状态3单独当因果。
- 下一批先补上传诊断的边缘格式/逻辑字节（只读对象，不加帧内GL查询），再做小地图像素计算Worker离线实验：原算法/像素/owner闪光一致、消息/复制成本和取消回退先验；只在主循环消费，不额外触发UI重绘。有收益才产品化，不删子步或降低分辨率/人数。
- 正式METHOD_PROBE=0；GPU/CPU/UI/DOM/音频旁路、BOSS_LAYER_HINTS、BOSS_MARKER_VAR_PROBE、BOSS_NATIVE_PAINT_PROBE、COMPARE_SMAA_CLEAR/EDGES、生命周期/小地图benchmark均0。REQUIRE_SMAA_EDGES=1、RASTER_HINTS=1、AUDIO_PARAM_DEDUPE=1、SMAA_CLEAR=1、LENS_PREPARATION=1，ANIMATION_CLOCK/MINIMAP_CACHE=0。先中文commit/push用户fork，再干净构建安装测试，结论独立中文提交。
- Trace禁/json/protocol（曾SIGTRAP）、禁详细Skia12秒超256MiB。只用已验证3秒短Trace或独立20秒native，本页标记绑定PID、严格CPU字段正则、buffer完整/切换一致0。原始含系统线程只留本地releases，不入Git；保留用户Logs/、play.bat、start-game.bat。

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
