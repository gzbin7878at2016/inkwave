# 本仓库开发与跨电脑同步规则

## 当前接续（2026-10-27，优先于历史版本说明）

- 仅Android Boss；先稳定30再60，固定2倍高清/SMAA/8人/原玩法及物理AI子步，PC保持。目标active，接续id=boss；USB常亮2，ADB串号A38YUT3C19022796。所有构建/手机测试句柄已终止，游戏已关闭，无授权阻塞；不得并发拥有CDP9223转发。
- 当前安装v1.0.47/code47，干净源码510c8fa87d904fc9214c457a8a6613aa079106fa。见docs/android/BOSS-PERFORMANCE-test47.zh-CN.md：撤回v46全部可见装饰静态化，仅7非本人opacity0箭头停转；本人/全部可见装饰/关键反馈保留，strategy=hidden-arrows。v45 Worker与RG16F等保留。
- v47 APK releases/INKWAVE-android-test47-510c8fa.apk，21,158,133字节，SHA256 22ec75fb9c774048f6254730b8cbff82db74755dd784cb5edb34d3e05207dd6d，v2证书201c792d…/398资产一致。273JS/真实HUD7隐藏+10可见/13关键反馈/PC普通与生命周期通过；手机实际7箭头none、8常驻可见动画与本人iw-you恢复，启用/释放1/1、退出恢复/USB213002-962822-0249a772核对510后关闭。
- v47恢复方法26.64600FPS，1719/64.5125秒，P95 58.3/P99 66.8ms、>=100ms9次，43→46°C；非正式/非提升，30未稳/60未开始。Worker1016提交/1015应用回收、grid3/行3套、peak3、max3帧/220.5ms、无回退，结算inactive收尾同步整图一次。
- v46停止17装饰桌面布局89→0但正式27.38524/27.46147，无明确实战收益，已撤回可见改动；见test46。USB211620-216495-cef16aae/212051-518851-dcb17061核对a824并关闭，勿把桌面CSS计数当手机成功。v45正式27.27766/27.34379，温度44→46/46→48°C，仍有长帧；v43低值17.428保留。
- Director revision2仅tools已真机控制验证通过（a73318e，APK仍510）：180.26m/29导航/13068伤害128弱点/2原大招，观察阶段[1,2]，补墨189/1589帧；原射击涂地/自家墨潜墨，干地不盲Shift，不改资源规则。USB215812-662682-bba62f1f核对APK/退出恢复后关闭。同rev2正式两局25.45858/24.09174FPS，P95 58.4/66.8ms、>=100ms12/14次，44→46/47→48°C；实际173/172m、12809/13155伤害、均[1,2]。Worker无回退，UI USB220113-e17f8531/220314-c2d6442a核对510后关闭。30未稳/三期未验；下一步有界CPU采样定位，旧legacy不能直接因果比较。见BOSS-PLAYBACK-REV1.zh-CN.md。
- 后续再按更充分实战选大负载；顶栏就绪徽章循环光晕/旋转可调查，但保留亮环/首次闪光/状态区分，先固定DOM CPU证据再候选正式，不继续无依据降质。旧HUD all/bar/special/markers/map/top/controls/panel/crosshair、距离变量/原生steps等无明确Main收益记录在BOSS-MAIN/DOM-INVESTIGATION，勿重复负结果。不能把CPU%直接等同每帧成本；已有DOM数据按11～14/18～25秒重算FPS，top27.43→28.99其余多无提升，仍受世界变化影响，非因果证明。
- 正式METHOD_PROBE=0，全部ablation/DOM/layer/marker/nativePaint/格式比较/生命周期/minimapBenchmark与Worker副本flags均0；REQUIRE_HUD_DECOR/MINIMAP_WORKER/SMAA_EDGES/RASTER_HINTS/AUDIO_PARAM_DEDUPE/SMAA_CLEAR/LENS_PREPARATION=1，ANIMATION_CLOCK/MINIMAP_CACHE/LENS_DRAW/REQUIRE_LOG_EDGES=0。v47方法5秒核对恢复样式；方法verifyBossExit1上传菜单不要求旧Boss Worker，正式结算上传核对字段。
- v45 Worker：加载最终视角后准备，3请求/主循环按序应用、3帧或250ms失效回原整图、grid/行回收、暂停背景/取消/旧局保护；84段/420内核/原公式/打包/PC回归通过。RG16F仅减未用通道，手机最终像素差0，RG8手机max102拒绝，逻辑省4.39MiB不能当功耗或FPS。
- Trace禁/json/protocol（曾SIGTRAP）、禁详细Skia12秒超256MiB，仅已验3秒短Trace/20秒native，绑定本页PID/严格CPU字段/完整buffer。SDK View.setRequestedFrameRate自API35，手机34不能用；不加隐藏反射/虚假Surface/全局性能显示改动。原始系统线程只留releases，保留用户Logs/、play.bat、start-game.bat。基础检查后中文commit/push fork，再干净构建安装测试，结果独立中文提交。

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
