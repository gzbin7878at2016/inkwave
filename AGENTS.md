# 本仓库开发与跨电脑同步规则

- 2026-10-28 v56结算小地图有限修复闭环：最终功能48b48af先中文推送再干净构建，APK21,165,887B/SHA256 796b1338ea3c33b93e2d264471519b9e9155e4862ddf18ae5e96ef07614519c3，v2签名/396dist与398同步匹配/USB安装通过。手机Boss沿用Worker异步完整快照，随后原三段刷新追赶落墨，PC原路径保持、3帧/250ms保护保持。前三轮失败已记录；最终方法同输入ink/owner/Canvas字节差0、主线程应用0.7ms/异步墙钟81.5ms、退出恢复通过。无探针一分钟33.68052FPS/P95 50/P99 66.6/长间隔3，38→41°C，正常settled应用0.6ms/墙钟72.1ms，无Worker回退；未稳30/60，非同温旧包对照、不宣称全局提帧。五轮USB源码核对/落盘关闭通过，手机留v56且关闭，持续优化仍paused；PC完整像素对照及第三阶段未验。见docs/android/BOSS-PERFORMANCE-test56.zh-CN.md。

- 2026-10-28 用户授权v56结算小地图修复：仅已准备手机Boss Worker异步最终整图，等待保留完整旧图、一次上传最终图；3帧/250ms/force/配色/版本/异常同步兜底保持，PC原路径保持。真实Edge Worker/Canvas最终墨迹/flash/owner/Canvas字节一致、取消回退迟到保护与资源回收通过，313JS通过；APK与真机待验，不能称提帧。见docs/android/BOSS-PERFORMANCE-test56.zh-CN.md。

- 2026-10-28 用户现场观看v55一局复测完成：无细分探针/60上限/2倍SMAA/8人，39.8137FPS/P95 49.9/P99 50.1/长间隔5，37→42°C；移动200.66m/伤害15354/弱点151/一次自然大招，覆盖[1,2]。USB013725-399647-3941d682核对995558f/关闭，无Shader/GPU/Worker故障。未改代码或APK，不以不同热状态均值证明收益，未稳30/60、第三阶段未验；持续优化仍paused，手机保留v55且关闭。见docs/android/BOSS-PERFORMANCE-test55.zh-CN.md末节。

- 2026-10-28 v55有限修复闭环：功能995558f先中文推送后干净构建，APK21,162,595B/SHA256 5e5714f13f223687d46c6b8260a1f2a7ad448e5d93a1214158b3ee1ce1b14e3d，v2签名/396dist与398同步逐字节匹配/USB覆盖安装通过。仅手机Boss按真实大招预建缓存与首绘，PC原流程检查通过。两次30秒方法轮加载本地构造42/44ms，真实zooka首次发动2.7ms、战斗_getWeapon低于计时精度/实例新建0，未宣称全局提帧；无探针一分钟31.8823FPS/P95 50.1/P99 66.7/长间隔6，42→45°C，未稳30/60，未做同温新旧均值对照。三轮真实USB核对995/关闭，两方法退出恢复通过，无Shader/GPU/Worker故障。手机保留v55且关闭，持续优化仍paused；其他三种大招自然发动和PC像素对照未验。见docs/android/BOSS-PERFORMANCE-test55.zh-CN.md。

- 2026-10-28 用户授权v55有限修复：仅手机Boss加载队列按真实specialId预建四类专用武器缓存，原材质/远景/首绘/阴影准备覆盖未挂树武器；不提前发动、不改PC/普通手机/玩法画质。313JS及真实Game准备/缓存首绘身份/取消释放检查通过，APK和真机待验，不能称提帧。见docs/android/BOSS-PERFORMANCE-test55.zh-CN.md。

- 2026-10-27 有限阶段定位10轮完成（首60秒/后9轮30秒自然结算），产品仍v54/2b7ed77，持续优化仍paused。实战首次zooka整帧124.6ms，start96.6→SpecialSystem94.4→setWeapon94.1→_getWeapon93.8ms，实例0.2ms；共享定义首次生成是主要路径，非证明全部GC/GPU。结算帧98.8ms中HUD68.7/小地图67.5/_drawInk66.5，inactive完整收尾一次且fallbacks/parks=0，不得简单删掉最终整图。十轮真实USB文件均核对2b、恢复关闭；方法工具会扰动，无新正式FPS成绩，未稳30/60。建议先手机Boss加载期实际大招武器定义/实例/首绘准备，再独立处理结算整图，均尚未实施。另有Character51ms/weapon58ms未归因。手机保留v54且关闭；USB常亮2和每3分钟仅唤醒维护（本地6小时上限），不恢复旧自动优化。见docs/android/BOSS-STAGE-INVESTIGATION.zh-CN.md。

- 2026-10-27 用户授权阶段定位方法轮缩至30秒，仅阶段探针开局duration=30并自然结算上传关闭；正式性能对照仍60秒，其他实验范围不放宽。首轮已启动60秒保持原参数，后续新名称30秒。产品逻辑和APK不改，持续自动优化仍paused，本批仅定位。见docs/android/BOSS-STAGE-INVESTIGATION.zh-CN.md。


- 2026-10-27 60帧上限有限对照完成，持续优化仍paused：工具66ec729经原入口设60且四轮实际日志核对；旧53/新54仍原APK。旧40.48952/36.77446、新39.70067/36.38720FPS，均值38.632/38.044，P95首组33.4、热机组50；长帧各9，未证收益或确定回归，温度37～45°C/负载不同，新版无park。B1曾因UE4旧ADB协议40与项目41互相重启中断，未上传不计；后续仅本次进程统一UE4同套ADB完成，不改UE4环境。四轮USB核对源码/60/HD/SMAA并关闭，手机恢复v54且关闭。见docs/android/OPUS-PERFORMANCE-60FPS-COMPARISON.zh-CN.md。


- 2026-10-27 Opus有限真机验证完成（持续优化仍paused）：v54干净2b7ed77，APK21,162,571B/SHA256 1e039b1920b0d1602506084aeca63fe4486f5a4f34e1420adeda53b95eea3f75，构建/签名/396dist与401同步匹配；旧/新/新/旧29.68573/29.67388/29.64870/29.55155FPS，P95均33.4，新旧均值差0.043不证明收益，电池29→41°C、屏幕60Hz、负载不同；正常轮无park。独立原暂停继续真机parks1/resyncs1/dropped1/fallbacks0，回收与离局恢复通过；诊断行为Windows检查通过，真机分阶段落盘对照未做。五轮真实USB核对源码关闭通过，手机留v54且关闭，未稳30/未测60，见docs/android/BOSS-PERFORMANCE-test54.zh-CN.md。


- 2026-10-27 用户明确授权本次验证Opus两项性能修改，属于有限对照测试，不恢复无人值守持续优化。Windows/Edge真实Worker及诊断保存时机源码测试已通过，准备v1.0.54/code54区分新旧包；固定2倍/SMAA/8人及原Director一分钟，旧53/新54交错测试、真实USB上传关闭，正式门槛不放宽。构建安装与真机结果待记录，不能预称收益。


- 2026-10-27 用户已要求暂停Boss优化；目标保持paused，定时接续不得自动恢复测试。本次仅交付正常手动游玩v1.0.53：干净源码be143c3f84a3be44ebbb9a73287505fd440bb72a重新构建，APK21,332,692字节/SHA256 e3e42cf92ccf8444d76678a33ed3233e3b6db1619d87c105e0ce820baadcfa67，307JS/移动网络/v2签名通过，396dist与401同步文件逐字节匹配。USB覆盖安装成功，实际冷启动进入“按任意键开始”界面、无boot-error；未启动自动Director或实验、未跑新性能局，不能声称稳定30帧。手机保留开始界面供用户体验。清漆扩大取样轮USB中断，未完成、无新有效数据；用户重连后已恢复USB，原中断游戏已关闭。详见docs/android/MANUAL-PLAY-test53.zh-CN.md。


## 当前接续（2026-10-27，优先于历史版本说明）

- 2026-10-27 用户选择评估“渲染移入Worker”：仅工具/文档，产品不变。真实Boss场景1273对象/796骨/111绘制/≈100～220KB每帧需同步；8处渲染-模拟耦合与A/B两种架构见docs/android/BOSS-WORKER-RENDER-FEASIBILITY.zh-CN.md。新增BOSS_WORKER_LOAD_MS独占方法轮作为真机并行余量关卡，未上真机前不得开始Worker化重构。
- 2026-10-27 用户明确要求处理高优先级问题（不是定时接续自动恢复测试）：1be129b 小地图Worker超龄/队列满/暂停/后台只停用、排空后带主线程owner/像素副本恢复，3帧/250ms保护与正式轮门槛均不放宽；6edbcb4 手机实战中诊断普通记录只留内存，警告/错误、脱离战斗、页面隐藏仍落盘。仅本机Chrome源码级检查通过，未构建APK、未上真机，不能写成绩；推送目标为用户fork schmidtkk/inkwave同名分支。详见docs/android/BOSS-WORKER-PARK-DIAGNOSTICS.zh-CN.md，真机待验步骤在文末。
- 最新名牌图像缓存调查已关闭：仅tools，产品仍v53/356277b。桌面8武器/103节点样式约0.411→0.287ms/步、布局同但有AA像素差；真机SVG图像7/92节点样式4.537→5.727→3.203ms/游戏帧，PNG7/100节点3.071→3.940→3.608，世界绘制混杂，无可靠收益，两方向不产品化。两轮原位恢复/USB011437-262395-2bea8098、011804-418751-dec4c6ce核对356/关闭通过，完整方法25.976369/24.479587FPS不当成绩。所有句柄结束，30未稳/60未开始/三期未验。下一步正常Boss结算后固定真实渲染快照，受控测props清漆clearcoat=.65/0的完成墙钟和视觉/恢复；不是纯GPU计时，不假定旧props隐藏负结果已被推翻，有明显证据才做手机Boss产品改动。见BOSS-MARKER-IMAGE-INVESTIGATION.zh-CN.md。

- 最新调查仅工具/文档，产品仍v53/356277b。菜单style属性选择器桌面固定HUD像素/状态完全一致，样式次数未减；手机预排三段Trace有效：原/删/恢复29/30/27游戏帧，Related-rule696/62/570但样式独占CPU每帧3.072/3.194/3.601ms，无可靠收益，不产品化，CSS原位恢复。完整方法25.786606FPS、Worker无回退、USB010433-365971-a656ed83核对356/恢复关闭；首轮采样错位已记录，不冒充删除证据。全部句柄结束，无授权阻塞。30未稳/60未开始/三期未验；继续定位主游戏FunctionCall约19～20ms每帧及其剩余预算，不重复此CSS/矩阵/射线负结果，不削AI物理或HUD。见BOSS-STYLE-SELECTOR-INVESTIGATION.zh-CN.md。

- 最新v53闭环完成：干净源码356277bd6203b4a94e5902ce1326e0722e3996f6，APK21,161,767B/SHA256 a7cb14230b4033898306a0979e6971fc1bdf14012bdee11a68757c7df1779dae，398同步/396dist/签名与安装通过。正式23.940823FPS/P95 75/P99 91.8/长帧15，Worker289.4ms一次回退aborted；USB005200-905705-fe676c88核对356关闭。方法实际waddle64/boomerang136同程序，原拳头含空池误计已修正；补测非空拳头311次程序92、无新拳头程序，USB005538-477028-aeb9bcc2核对356/恢复关闭。V8补采窗口327真实游戏帧、原生(program)8262ms/21.321秒，不等于GPU或CSS；约采样启动1375.6ms长帧/Worker1318.5ms使17.017854FPS方法不能当产品成绩。所有句柄终止，无授权阻塞。30未稳/60未开始/三期未验。下一步可恢复CSSOM单条菜单style属性选择器实验，先固定真实HUD验证像素/样式失效；假设未证，不动PC产品规则/不削控件动画。不重复矩阵/射线负结果。详见BOSS-PERFORMANCE-test53.zh-CN.md。

- v53源码准备：仅手机Boss按真实阵容补mitts空池、boomerang盘、waddle圈首用准备；299JS及真实WebGL五轮缓存/范围/取消清理通过。待提交后干净构建安装与方法+正式真机验证；30未稳。详见BOSS-PERFORMANCE-test53.zh-CN.md。

- 最新v52已安装并闭环：干净功能源码0af291972ae9c75a8a0eea879321a30a85f19df9，APK21,160,615B/SHA256 b3fdfe1612c8bbe2fbc69910dc31aab26378835c1628410a026e95870807a258，签名/398同步/396dist匹配。正式24.320685FPS/P95 66.6/P99 83.3/长帧11，Worker252.6ms一次result-age，aborted失败；USB004045-546294-cc2643a5核对0af关闭。持伞方法真实飞出678次/手持845次均程序66，无新伞面程序；不同武器方法19.865238FPS不当成绩，USB004408-848019-fd881a75核对0af/恢复关闭。当前所有句柄结束，无授权阻塞。30未稳/60未开始/三期未验。下一批核对mitts拳头池、waddle标记圈、boomerang盘实际工厂的首用准备及保留引用，方法阵容已补subId；SWIRL实际绘制覆盖仍待验。不重复旧小收益/负结果。见BOSS-PERFORMANCE-test52.zh-CN.md。

- 正在准备v52，仅手机Boss加载期持有实际4类技能/透明飞出伞面程序，7代理/6自建材质，PC/普通/展示隔离；299JS与真实WebGL缓存/取消/失败释放通过。提交后干净构建安装测试；尚未证明提帧，不能用旧v51成绩验收。详见BOSS-PERFORMANCE-test52.zh-CN.md。

- 仅Android Boss；先稳定30再60，固定2倍高清/SMAA/8人/原玩法及物理AI子步，PC保持。目标active，接续id=boss；USB常亮2，ADB串号A38YUT3C19022796。所有构建/手机测试句柄已终止，游戏已关闭，无授权阻塞；不得并发拥有CDP9223转发。
- 当前安装v1.0.51/code51，干净源码80a2b9b61e5f9fc8949f9c4f61678cc00bcad7ee。仅手机真实Boss去重跳跃面板/练习按钮hidden及相同--far写入；原精度/透明度/位置/动画/物理AI/PC路径保持。真实HUD/TouchInput/installMobile重复120次及切状态基础检查、298JS通过，真机方法已确认hidden重复失效各19→0、--far132→14（19vs20游戏帧），未独立证明提帧；正式25.39416FPS/P95 66.6/P99 83.5/长帧8，Worker一次272.5ms result-age回原同步触发aborted，不能通过。USB002149-b8a2234d/002602-2a2ab958均核对80/恢复关闭。30未稳/60未开始。见BOSS-PERFORMANCE-test51.zh-CN.md。
- v51 APK releases/INKWAVE-android-test51-80a2b9b.apk，21,159,447字节，SHA256 abe91df295fe28ce52ede7953f4ca0516b1f8a31badcf040bbb43e20f25805e5；v2证书201c792d…，398同步/396dist资产匹配，安装成功。v50上次正式25.92385FPS/P95 58.4/P99 75.1ms/长帧8，未稳30/60未开始；game分类0/mode1已识别，但CPU上限未提高，细节见test50。simpleperf本页绑定通过但Permission denied，不重试提权；改1秒CSS失效Trace成功，详见BOSS-NATIVE-STACK-INVESTIGATION。
- v49方法真实gain2/loss2/stale0，覆盖本人与槽7，实际182.74m/18203伤害172弱点/一次原大招，阶段[1,2]；退出恢复/USB222444-457946-65f3181e核对ef0/关闭通过。1474/87.0001秒=16.94251FPS，P95 83.5/P99 116.7ms、>=100ms46次，46→49°C，非性能成绩。Worker一次result-age324.2ms回原同步，门槛未放宽；无探针正式18.49824FPS、P95 83.4/P99 108.3ms、>=100ms19次，Worker一次294.5ms回退触发门槛失败exit1；USB222838-460109-ed0eaced核对ef0/关闭。30未稳/60未开始/三期未验。
- 静态props区段工具手机副本已验：原索引保序multiDraw、零新几何纹理、控制293994字节；自然结算后3视角全部像素字节差0/136次native/fallback0/恢复通过。但spawn阻塞墙钟3.075→2.950ms、left2.250→3.625ms，无稳定收益，不产品化、不改APK。方法轮29.39889FPS/P95 49.9/P99 58.3ms/长帧4次，39→43°C，169.19m/10771.75伤害/一次大招仅阶段1；USB233102-781846-c49ccf5a核对ef0并关闭。桌面原参考波动未解释；详见BOSS-PROP-CULLING-INVESTIGATION.zh-CN.md。同安装无探针正式27.23281FPS/P95 58.3/P99 66.8ms/长帧6次、44→45°C，200.76m/9662.05伤害/一次大招覆盖[1,2]；USB233259-724652-87d6dd73核对ef0并关闭。30未稳/60未开始；下一步按test51核对实战新SWIRL/透明Brolly程序首绘与长停顿，先方法补阵容与firstDrawMs/帧号；未证明Worker超时由它们造成，不放宽250ms保护。
- 隐藏LOD工具调查完成：当前v49 V8矩阵更新自耗时625ms/30秒、raycast622ms；手机自然结算摘下64隐藏LOD，原/候选/重复/恢复像素及可见矩阵/骨骼矩阵全0差。矩阵遍历仅0.4310→0.374375ms/次，约省0.056625ms，未含动态维护，暂不产品化。方法25.29989FPS/P95 66.6/P99 83.4ms/长帧13、43→46°C，182.59m/17533.79伤害/一次大招覆盖[1,2]；USB234142-869834-5e553f5b核对ef0/退出恢复/关闭。当时产品仍49，30未稳/60未开始。见BOSS-HIDDEN-LOD-INVESTIGATION.zh-CN.md。后续射线网格行/小矩形列表缓存也已完成方法等价验证，但真实负载均无强收益证据，未产品化，见BOSS-RAY-QUERY-INVESTIGATION.zh-CN.md；不要重复矩阵/射线小收益实验或当作提帧结论。
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
