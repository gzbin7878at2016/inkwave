# 本仓库开发与跨电脑同步规则

## 当前接续（2026-10-27，优先于历史版本说明）

- 仅Android Boss；先稳定30再60，固定2倍高清/SMAA/8人/原玩法及物理AI子步，PC保持。目标active，接续id=boss；USB常亮2，ADB串号A38YUT3C19022796。所有构建/手机测试句柄已终止，游戏已关闭，无授权阻塞；不得并发拥有CDP9223转发。
- 当前安装v1.0.49/code49，干净源码ef0e0a1f9c8940cfcfea910a901d1e503bba850c。仅手机Boss清理耗掉大招/死亡/空槽的残留is-readyflash，真正就绪首次闪光/旋转/循环保持；PC普通演示菜单原路径保持。见docs/android/BOSS-PERFORMANCE-test49.zh-CN.md。
- v49 APK releases/INKWAVE-android-test49-ef0e0a1.apk，21,158,349字节，SHA256 afc11abf8e84d6dd91fe432baacc9fedaa70a24fb00a35d08711dcf780b2a429；v2证书201c792d…/398资产一致，安装成功。276JS/真实八槽状态全路径/同状态120次零写/PC普通演示菜单隔离/原8副本7组动画通过。
- v49方法真实gain2/loss2/stale0，覆盖本人与槽7，实际182.74m/18203伤害172弱点/一次原大招，阶段[1,2]；退出恢复/USB222444-457946-65f3181e核对ef0/关闭通过。1474/87.0001秒=16.94251FPS，P95 83.5/P99 116.7ms、>=100ms46次，46→49°C，非性能成绩。Worker一次result-age324.2ms回原同步，门槛未放宽；无探针正式18.49824FPS、P95 83.4/P99 108.3ms、>=100ms19次，Worker一次294.5ms回退触发门槛失败exit1；USB222838-460109-ed0eaced核对ef0/关闭。30未稳/60未开始/三期未验。
- 下一项先tools级静态props空间剔除潜力估算：工具7fd793c在独立桌面浏览器加载真实dist-mobile，原4重桶按完整三角形包围盒分组，统计不同视角保守剔除率/顶点重复/逻辑几何字节；尚未改产品，不能当手机FPS。见BOSS-PROP-CULLING-INVESTIGATION.zh-CN.md；结果值得才做BatchedMesh副本/像素和开销证明。
- v48涂地重播候选已在eb356f0撤回，原8副本7组恢复，不再要求TURF_ANIMATION。v48无探针17.35958/17.98329，Worker各一次252.1/277.4ms回退；v47同热对照18.46346、47→48°C、Worker无回退。双方都低，不能归因全部退化于v48，也不足排除小幅回归；详见test48，USB221341-b35ee539/221950-6fadc74f/221659-bec065ab均核对源码关闭。
- Director revision2仅tools，正常原导航/相机瞄准/实际射击涂路和脚下/自家墨Shift补给/就绪Q，仅读状态和写输入，不改HP墨资源。控制验证180m/13068伤害128弱点/2原大招覆盖[1,2]；同rev2 v47正式25.45858/24.09174FPS，P95 58.4/66.8ms、>=100ms12/14，44→46/47→48°C。旧legacy脚本不能直接因果比较，阶段3尚未验。见BOSS-PLAYBACK-REV1.zh-CN.md。
- 正式METHOD_PROBE=0、VERIFY_READY_STATE=0、REQUIRE_TURF_ANIMATION=0，全部ablation/DOM/layer/marker/nativePaint/格式比较/生命周期/minimapBenchmark与Worker副本flags均0；REQUIRE_HUD_DECOR/MINIMAP_WORKER/SMAA_EDGES/RASTER_HINTS/AUDIO_PARAM_DEDUPE/SMAA_CLEAR/LENS_PREPARATION=1，ANIMATION_CLOCK/MINIMAP_CACHE/LENS_DRAW/REQUIRE_LOG_EDGES=0。方法verifyBossExit1正常菜单退出，验证准备/渲染/音频恢复；观察器只在方法轮启用，不当成绩。
- v45 Worker保留：加载最终视角后准备、3在途/主循环顺序应用、3帧或250ms失效立即回原整图、grid/行回收、暂停背景/取消/旧局保护；不要放宽保护或把inactive收尾整图一次当故障。RG16F手机对原RGBA参考最终像素差0，RG8 max102拒绝，逻辑省4.39MiB不能当FPS。v47仅7不可见非本人箭头停转，可见装饰/本人iw-you恢复；v46可见静态化无收益已撤回，勿重做负结果。
- Trace禁/json/protocol（曾SIGTRAP）、禁详细Skia12秒超256MiB，仅已验3秒窄Trace/20秒native，绑定本页PID/严格CPU字段/完整buffer。SDK View.setRequestedFrameRate自API35，手机34不可用；不加隐藏反射/虚假Surface/全局性能显示或热策略改动。CPU%须按实际帧数归一化，含子耗时不能相加。Main/DOM调查负结果见BOSS-MAIN/DOM-INVESTIGATION。
- 原始系统线程只留releases，不入Git；保留用户Logs/、play.bat、start-game.bat。基础检查后中文commit/push用户fork分支，再干净构建安装测试；测试结果独立中文提交，未达标如实记录。不得误推origin上游或合并main。

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
