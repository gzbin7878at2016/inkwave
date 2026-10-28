# DemoInk / INKWAVE 开发进度与跨电脑接续指南

- 2026-10-28 用户明确停止性能优化，不再推进，持续优化保持paused。本批仅[多人游玩机制与Go服务器改造入门](MULTIPLAYER-BEGINNER-GO-DOCKER.zh-CN.md)和14张SVG配图：按当前源码区分玩家所有权/房主裁判/云端中继，解释开赛、插值、命中、墨水、Boss与迁移；指出原NET文档缓冲/静默阈值已过时，提出Go兼容中继→权威游戏服及Docker方案。未实现服务器、未部署、未跑多人或手机测试，手机保持v56关闭；后续架构实施另按用户指令开展。

- 2026-10-28 v56结算小地图有限修复闭环：最终功能48b48af先中文推送再干净构建，APK21,165,887B/SHA256 796b1338ea3c33b93e2d264471519b9e9155e4862ddf18ae5e96ef07614519c3，v2签名/396dist与398同步匹配/USB安装通过。手机Boss沿用Worker异步完整快照，随后原三段刷新追赶落墨，PC原路径保持、3帧/250ms保护保持。前三轮失败已记录；最终方法同输入ink/owner/Canvas字节差0、主线程应用0.7ms/异步墙钟81.5ms、退出恢复通过。无探针一分钟33.68052FPS/P95 50/P99 66.6/长间隔3，38→41°C，正常settled应用0.6ms/墙钟72.1ms，无Worker回退；未稳30/60，非同温旧包对照、不宣称全局提帧。五轮USB源码核对/落盘关闭通过，手机留v56且关闭，持续优化仍paused；PC完整像素对照及第三阶段未验。见docs/android/BOSS-PERFORMANCE-test56.zh-CN.md。

- 2026-10-28 用户授权v56结算小地图修复：仅已准备手机Boss Worker异步最终整图，等待保留完整旧图、一次上传最终图；3帧/250ms/force/配色/版本/异常同步兜底保持，PC原路径保持。真实Edge Worker/Canvas最终墨迹/flash/owner/Canvas字节一致、取消回退迟到保护与资源回收通过，313JS通过；APK与真机待验，不能称提帧。见docs/android/BOSS-PERFORMANCE-test56.zh-CN.md。

- 2026-10-28 用户现场观看v55一局复测完成：无细分探针/60上限/2倍SMAA/8人，39.8137FPS/P95 49.9/P99 50.1/长间隔5，37→42°C；移动200.66m/伤害15354/弱点151/一次自然大招，覆盖[1,2]。USB013725-399647-3941d682核对995558f/关闭，无Shader/GPU/Worker故障。未改代码或APK，不以不同热状态均值证明收益，未稳30/60、第三阶段未验；持续优化仍paused，手机保留v55且关闭。见docs/android/BOSS-PERFORMANCE-test55.zh-CN.md末节。

- 2026-10-28 v55有限修复闭环：功能995558f先中文推送后干净构建，APK21,162,595B/SHA256 5e5714f13f223687d46c6b8260a1f2a7ad448e5d93a1214158b3ee1ce1b14e3d，v2签名/396dist与398同步逐字节匹配/USB覆盖安装通过。仅手机Boss按真实大招预建缓存与首绘，PC原流程检查通过。两次30秒方法轮加载本地构造42/44ms，真实zooka首次发动2.7ms、战斗_getWeapon低于计时精度/实例新建0，未宣称全局提帧；无探针一分钟31.8823FPS/P95 50.1/P99 66.7/长间隔6，42→45°C，未稳30/60，未做同温新旧均值对照。三轮真实USB核对995/关闭，两方法退出恢复通过，无Shader/GPU/Worker故障。手机保留v55且关闭，持续优化仍paused；其他三种大招自然发动和PC像素对照未验。见docs/android/BOSS-PERFORMANCE-test55.zh-CN.md。

- 2026-10-28 用户授权v55有限修复：仅手机Boss加载队列按真实specialId预建四类专用武器缓存，原材质/远景/首绘/阴影准备覆盖未挂树武器；不提前发动、不改PC/普通手机/玩法画质。313JS及真实Game准备/缓存首绘身份/取消释放检查通过，APK和真机待验，不能称提帧。见docs/android/BOSS-PERFORMANCE-test55.zh-CN.md。

- 2026-10-27 [Boss阶段定位结果](android/BOSS-STAGE-INVESTIGATION.zh-CN.md)：10轮有限真机方法测试完成，实际zooka首次共享武器定义路径约94ms、结算小地图_drawInk66.5ms分别确认；其余日常角色/浏览器压力仍待定位。十轮USB核对2b7ed77/退出恢复/关闭通过。只改工具和文档，手机仍v54，未宣称提帧；持续优化仍paused。下一批建议手机Boss加载期真实武器定义/实例/首绘准备，产品修复尚未实施。常亮维护独立于游戏测试，6小时本地上限；原始报告留本机releases，不随Git迁移。

- 2026-10-27 用户授权阶段定位方法轮缩至30秒，仅阶段探针开局duration=30并自然结算上传关闭；正式性能对照仍60秒，其他实验范围不放宽。首轮已启动60秒保持原参数，后续新名称30秒。产品逻辑和APK不改，持续自动优化仍paused，本批仅定位。见docs/android/BOSS-STAGE-INVESTIGATION.zh-CN.md。


- 2026-10-27 新增[Boss稳定60帧工作计划与执行细节](android/BOSS-60FPS-WORKPLAN.zh-CN.md)：P00～P06进度、热点定位/模拟/渲染/热机验证、验收建议、命令和提交模板。所有新实施任务均待执行；本次仅文档，持续优化仍paused，不启动手机测试。

- 2026-10-27 60帧上限有限对照完成，持续优化仍paused：工具66ec729经原入口设60且四轮实际日志核对；旧53/新54仍原APK。旧40.48952/36.77446、新39.70067/36.38720FPS，均值38.632/38.044，P95首组33.4、热机组50；长帧各9，未证收益或确定回归，温度37～45°C/负载不同，新版无park。B1曾因UE4旧ADB协议40与项目41互相重启中断，未上传不计；后续仅本次进程统一UE4同套ADB完成，不改UE4环境。四轮USB核对源码/60/HD/SMAA并关闭，手机恢复v54且关闭。见docs/android/OPUS-PERFORMANCE-60FPS-COMPARISON.zh-CN.md。


- 2026-10-27 Opus有限真机验证完成（持续优化仍paused）：v54干净2b7ed77，APK21,162,571B/SHA256 1e039b1920b0d1602506084aeca63fe4486f5a4f34e1420adeda53b95eea3f75，构建/签名/396dist与401同步匹配；旧/新/新/旧29.68573/29.67388/29.64870/29.55155FPS，P95均33.4，新旧均值差0.043不证明收益，电池29→41°C、屏幕60Hz、负载不同；正常轮无park。独立原暂停继续真机parks1/resyncs1/dropped1/fallbacks0，回收与离局恢复通过；诊断行为Windows检查通过，真机分阶段落盘对照未做。五轮真实USB核对源码关闭通过，手机留v54且关闭，未稳30/未测60，见docs/android/BOSS-PERFORMANCE-test54.zh-CN.md。


- 2026-10-27 用户明确授权本次验证Opus两项性能修改，属于有限对照测试，不恢复无人值守持续优化。Windows/Edge真实Worker及诊断保存时机源码测试已通过，准备v1.0.54/code54区分新旧包；固定2倍/SMAA/8人及原Director一分钟，旧53/新54交错测试、真实USB上传关闭，正式门槛不放宽。构建安装与真机结果待记录，不能预称收益。


- 2026-10-27 已拉取PR #1至d6a4fb3，新增[Opus性能修改通俗说明](android/OPUS-PERFORMANCE-CHANGES-EXPLAINED.zh-CN.md)：说明Boss Worker临时停用后恢复、手机实战日志延迟保存、范围/日志取舍/测试门槛和真机待验。本次仅文档核对，不重跑测试、不构建安装、不恢复Boss自动优化，目标仍paused。

- 2026-10-27 用户已要求暂停Boss优化；目标保持paused，定时接续不得自动恢复测试。本次仅交付正常手动游玩v1.0.53：干净源码be143c3f84a3be44ebbb9a73287505fd440bb72a重新构建，APK21,332,692字节/SHA256 e3e42cf92ccf8444d76678a33ed3233e3b6db1619d87c105e0ce820baadcfa67，307JS/移动网络/v2签名通过，396dist与401同步文件逐字节匹配。USB覆盖安装成功，实际冷启动进入“按任意键开始”界面、无boot-error；未启动自动Director或实验、未跑新性能局，不能声称稳定30帧。手机保留开始界面供用户体验。清漆扩大取样轮USB中断，未完成、无新有效数据；用户重连后已恢复USB，原中断游戏已关闭。详见docs/android/MANUAL-PLAY-test53.zh-CN.md。


## 当前接续（2026-10-27，优先于历史版本说明）

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

更新日期：2026-10-27（北京时间）。本文件是接续开发入口，与根目录AGENTS.md共同维护。每批改动后更新相关记录并立即提交、推送。

面向新手的背景解释见[云层烘焙负载说明](android/CLOUD-BAKING-BEGINNER.zh-CN.md)，涵盖本次手机降载、2倍高清与初始化/帧率验收的区别。

后续纹理优化参考[PC/手机纹理分级与UE4思路](android/DEVICE-TEXTURE-SCALABILITY.zh-CN.md)：第一批v18已应用并巡检手机海港远景反射256（PC512），详见[纹理test18](android/TEXTURE-test18.zh-CN.md)。其余候选尚未降档，继续逐项真机对照。

历史v31记录（当前版本见上）：当时安装v1.0.31（干净源码0b59a2f），游戏关闭。只优化Boss，先稳定30再60，未达标。SMAA/Output合并少一遍、像素/预备程序/退出恢复通过；正式29.044/28.044，恢复v31热机27.211FPS（45→46°C），v30对照28.871（41→45°C），不能只报最高或宣称严格因果改善，见[Boss test31](android/BOSS-PERFORMANCE-test31.zh-CN.md)。新30秒V8样本_drawInk自耗时800.7ms，下一步仅手机Boss缓存小地图未变化像素计算；保持原0.15秒/3段刷新、分辨率、bilinear/emboss/owner/flash字节。加载期有界缓存、重建/配色失效，先真实Canvas与原入口随机/清除/换色/翻转/最坏负载逐字节和性能验证，证明有益再提交构建。保持2倍/SMAA/8人/物理/AI/枪口/PC；目标active，无授权阻塞，USB常亮2，30分钟接续已建，不并发USB/CDP，每局60秒上传核对关闭。音频旁路不作成绩；窗口偏好不能称锁60，全局省电0未修改。

## 1. 先读结论

- 用户仓库：<https://github.com/gzbin7878at2016/inkwave>。
- **最新工作分支：`codex/android-capacitor`。不要只拉main就开始开发。** main目前仍停在早期Android方案文档阶段，未合并本轮实现。
- 历史v1.0.11手机加载与稳定帧耗功能源码`fd9ec0f79d3dde6fa41db5c8a4c03ebee7dc5efa`已推送并从干净提交构建；上一版功能源码0918cea，真机分析记录6920525。交付文档有后续独立提交，APK源码以`releases/android-build-info.json`为准。
- 当前为v1.0.43；可构建Android debug APK，最低Android10/API29，包名`com.demoink.inkwave`。v1.0.11新增[对局加载进度与资源准备](android/LOADING-test11.zh-CN.md)，固定下载页和日志上传继续沿用。
- 按用户最新优先级，手机默认目标改为30FPS（仍可手动30/60），固定2倍高清、SMAA、自动降低清晰度关闭，原对局人数不变；PC保留默认。v11一次性迁移帧率设置，不清档。
- v10真机已确认Boss准备19.879秒，首衣服仍1630ms长任务；6个无新增程序角色仍等待9.009秒。v11按真实程序对象复用、约5ms预算让帧，移除缓存命中固定10ms等待；进度条覆盖角色、战斗效果、Boss登场/音效/小怪首绘和GPU完成等待。**真机稳定30帧及不再掉个位数尚待安装复测，不能把桌面软件渲染FPS当作达标证据。**
- PC保留原渲染路径。不要为手机性能直接改共享QUALITY或PC地面着色器。

## 2. 目标、已完成事项与证据

| 模块 | 已完成 | 验证边界/剩余工作 |
| --- | --- | --- |
| Android壳与构建 | Capacitor、本地网页/素材内置、横屏、独立JDK/SDK构建脚本、debug签名和哈希 | 正式签名、商店发布未做；新电脑需自备工具链 |
| 输入与生命周期 | 多指角色固定、拖开火转向、左右布局、灵敏度、按钮大小、取消蓄力、后台释放输入和恢复确认 | 全武器/手机组合的长期真机手感仍待验收 |
| 离线与联机 | 离线练习/机器人；WSS中继路由、心跳超时、旧socket隔离、队列保护 | 手机多人、弱网、房主迁移矩阵未全部验收；后台离房，不是无缝重连 |
| GPU兼容 | 手机独立参数纹理和简化材质、失败降级/暂停、诊断导出 | Maleoon实际日志已无原地面shader失败；其他GPU仍需测 |
| 清晰度与材质 | 1/1.5/2倍选项、SMAA/FXAA、ORM/烘焙遮蔽、墨迹边缘 | 仍是现有模型资产，不等同于商业手游美术品质 |
| 固定高清 | v11一次性迁移默认30/2倍，保留30/60选择，自动降分辨率可选且默认关 | 实际帧率随负载变化，真机稳定30待复测 |
| 性能与预热 | CPU九段、真实绘制排行、启动/长任务、首次资源加载、100ms尖峰记录 | v10真机定位开局长等待；v11已做加载资源前置，等待真机稳定30帧复测 |

最初问题已由test2手机日志定位：Maleoon920片元uniform上限256组，原地面数组本身超过预算，报too many uniforms。手机独立材质后约51～52组（保守合计），保留PC原材质；历史同环境PC三组GLSL哈希一致。新电脑无原环境基线时不能宣称做过同样的逐字节比较。

test5中用户选60/高清后，动态scale降到0.5，实际只有770×376。test6关闭自动降档后，日志`INKWAVE-logs-20261021-151956-381.json`确认scale全程1、pixelRatio2、canvas/target1540×752、SMAA正常、无shader失败或材质降级。实战末段15个采样23～43FPS、中位数31；全运行统计混有大厅/加载，不能用来代替实战帧率。设备：华为PLA-AL10、Maleoon920、Android12、华为WebView114.0.5.302。

## 3. 版本与提交索引

| 版本/批次 | 源码或功能提交 | 主要内容 | 详细说明 |
| --- | --- | --- | --- |
| test1 | 03e5365 | 首个触屏APK | [交付1](android/DELIVERY-test1.zh-CN.md) |
| test2 | 31115ff | 图形错误与日志导出 | [诊断2](android/DIAGNOSTICS-test2.zh-CN.md) |
| test3 | 9cdf33f | 手机GPU独立材质与降级 | [兼容3](android/GPU-COMPAT-test3.zh-CN.md) |
| test4 | 0ef1107 | 1倍密度与FXAA | [抗锯齿4](android/ANTIALIAS-test4.zh-CN.md) |
| test5 | a872911 | 三档/SMAA/材质层次 | [画面5](android/VISUAL-test5.zh-CN.md) |
| test6 | 88a284e | 默认60帧与固定2倍 | [默认6](android/DEFAULTS-test6.zh-CN.md) |
| test7/性能第一批 | b484104 | CPU分段与真实绘制排行 | [性能第一批](android/PERFORMANCE-batch1-test7.zh-CN.md) |
| v1.0.8 | Git版本记录 | 局域网上传、固定下载入口和版本号 | [日志上传](android/LOG-UPLOAD-test8.zh-CN.md) |
| v1.0.9 | 92d3292 | 关闭手机自动预载、逐对象启动预热 | [启动第一批](android/STARTUP-test9.zh-CN.md) |
| v1.0.10 | 0918cea | 角色分步预热、准备互斥与手机房间就绪握手 | [启动第二批](android/STARTUP-test10.zh-CN.md) |
| v1.0.11 | fd9ec0f | 真实进度、首次资源/战斗效果准备、缓存快路径与默认30帧 | [加载与稳定帧耗](android/LOADING-test11.zh-CN.md) |
| v1.0.12 | 1a78c91 | USB优先日志上传 | [USB日志](android/USB-test12.zh-CN.md) |
| v1.0.13 | 94a151c | 临时提示3秒关闭、自动游玩基线 | [USB Boss测试](android/USB-BOSS-AUTOTEST.zh-CN.md) |
| v1.0.14 | 2ca848e | 手机HUD视口缓存；稳定30未通过 | [HUD](android/HUD-test14.zh-CN.md) |
| v1.0.15～16 | 231e4bf / 924212d | 启动错误门槛/原生提示、最小图形诊断 | [初始化隔离](android/GRAPHICS-INIT-test16.zh-CN.md) |
| v1.0.17 | 4b11cec | 手机云烘焙负载单变量修复，最终3次完整启动通过 | [对照结果](android/GRAPHICS-INIT-test16.zh-CN.md) |
| v1.0.18 | b69f3a9 | 手机海港远景反射256、PC512，真实资源与回归记录 | [纹理第一批](android/TEXTURE-test18.zh-CN.md) |
| v1.0.19～23 | 53aef10 / d5916ea / 26fc014 / fcdc69d / e9f8e18 | Boss缓存、诊断查询与排期对照；稳定30未通过 | [Boss进度与接续](android/BOSS-PERFORMANCE-test23.zh-CN.md) |

历史v11交付版本为`v1.0.11` / versionCode11，归档名`releases/INKWAVE-android-test11-fd9ec0f.apk`，21,108,406字节；SHA-256为`955b608af8b87c9cbd910c89072408b9f8641e6ce206e352ffa91e140e86a477`。签名沿用本机test7～10，362个网页资源与APK逐字节一致，固定页和HTTP下载哈希核对通过；真机待验收。详细记录见`releases/android-build-info.json`及v11交付记录。新包需要从干净的已推送提交构建，APK不入Git。

当前电脑可选同网安装页为`http://192.168.1.68:8765/`；用户手机不在同网，实际使用ADB安装与USB日志。当前v17未配置局域网上传地址；重连执行`./tools/start-usb-debug.ps1`恢复18765到8765映射，日志存入`releases/logs/`。换电脑需迁移签名/工具链，不能认为Git包含APK、原始日志或私钥。
APK与构建记录在releases中被忽略，不会随git clone下载。需要原包时单独复制并验证哈希，或在新电脑重新构建。

## 4. 新电脑第一次拉取

准备Git、Node.js22+（当前开发机验证过24.14.0）、npm、Python3、Edge；构建Android另需JDK21和Android SDK。仓库位置可不同，不要求J盘。

在新电脑的工作目录运行：

```powershell
git clone --origin fork --branch codex/android-capacitor --single-branch https://github.com/gzbin7878at2016/inkwave.git DemoInk
Set-Location DemoInk
git remote -v
git branch -vv
git status --short
npm ci
npm run check
node tools/check-mobile-network.mjs
node tools/check-mobile-profiler.mjs
node tools/check-mobile-character-warmup.mjs
node tools/check-mobile-preparation.mjs
node tools/check-net-preparation.mjs
node tools/check-mobile-loading.mjs
node tools/check-mobile-boss-preparation.mjs
node tools/check-mobile-combat-preparation.mjs
node tools/check-mobile-paint-preparation.mjs
```

以上clone命令仅用于新目录；已有仓库不要重复clone覆盖。`--origin fork`主动将用户仓库命名为fork，方便与当前流程一致。npm ci以package-lock.json为准；不要为安装方便随意升级依赖。

现有克隆先核对`git remote -v`：当前电脑origin是用户仓库；旧电脑可能把用户仓库命名为fork、origin指向上游。以下示例使用fork，已有仓库应替换为实际核对过URL的远端名。若用户仓库没有远端，确认不存在同名fork后添加：

```powershell
git remote add fork https://github.com/gzbin7878at2016/inkwave.git
git fetch fork
```

若本地已有工作分支，切换并快进：

```powershell
git switch codex/android-capacitor
git pull --ff-only fork codex/android-capacitor
```

若本地没有该分支，fetch后改用`git switch -c codex/android-capacitor --track fork/codex/android-capacitor`。切换前先处理本机未提交工作，不使用reset --hard或强推清掉差异。

## 5. 新电脑启动与验证

仓库根目录终端一：

```powershell
python tools/serve.py 8490
```

终端二：

```powershell
npm run build:mobile
npm run check:mobile
node tools/check-diagnostics.mjs
node tools/check-mobile-gpu.mjs
```

PC入口为`http://localhost:8490/`，移动产物为`http://localhost:8490/dist-mobile/`。测试期间不要再次构建/删除dist-mobile，否则入口与散列模块可能混用。测试输出在releases。

工具默认Edge路径为`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。路径不同时设置当前终端`$env:EDGE_PATH='实际完整路径'`。`tools/check-mobile-gpu.mjs`的本地PC基线默认位于被忽略的`releases/investigation/pc-before-compat.json`，新电脑通常没有；工具会明确跳过GLSL基线对比，PC入口断言仍执行。不同浏览器/GPU的哈希不能直接作相同环境对比。

## 6. Android工具链、构建和签名

已锁定：Capacitor core/android/cli8.5.3，App8.1.2、Network8.0.1，esbuild0.28.2；Gradle8.14.3、AGP8.13.0；compile/target API36、min API29。安装JDK21、SDK platform-tools、API36、Build Tools35.0.0与36.0.0并接受许可证。Gradle wrapper及package-lock已入库。

```powershell
# 替换成新电脑实际路径，不要求复制旧电脑目录
./tools/build-android.ps1 -JdkPath 'C:/tools/jdk-21' -SdkPath 'C:/tools/android-sdk'
```

脚本设置当前进程工具链，不改系统Java/UE4环境；生成本机android/local.properties、同步移动资产、检查/构建/验签并复制APK到releases。开发机旧位置为`%USERPROFILE%/.cache/demoink-android/`，新电脑不能假定这些缓存已经存在。脚本不是SDK/JDK安装器。

网络代理只按本机实际地址临时设置，不能照抄旧电脑7890端口，更不能提交代理凭据。Android内置网页没有远程server.url；不要用在线站点替换本地资产来绕过构建。

**跨电脑覆盖安装的关键：同包名必须使用同一签名。** 当前电脑test7～test10沿用本机Android debug证书，证书SHA-256为`8e8623efa96a83ebd9e48b48ec0b927f417718f5e3e563a2ac9386fb9cde6d46`。原电脑旧包证书为`201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69`，二者不同；覆盖安装前以手机已有包证书为准。新电脑自动生成的debug.keystore通常不同，将无法覆盖旧包。

- 需要保留手机进度时，先在原电脑安全备份实际使用的debug签名（通常`%USERPROFILE%/.android/debug.keystore`），经私密渠道迁移到新电脑；若新电脑已有签名先单独备份，不能盲目覆盖别的项目签名。
- 用新电脑SDK的apksigner核对APK证书指纹与上述值，再侧载；不要把卸载旧包当作解决签名不一致的默认办法，卸载会丢本地进度。
- 私钥/keystore、密码、用户登录令牌禁止提交Git。正式发布签名仍未建立，不把当前debug证书当商店发布流程。

## 7. 每次修改实时同步的操作规程

Git不是自动同步盘。**只有commit且push成功的改动才能被另一电脑拉取。** 用户要求落实为以下强制检查点，根目录AGENTS.md也记录相同规则：

### 开工前

1. 阅读本文、PROGRESS和对应批次文档；检查远端URL、当前分支与git status。
2. 如有未提交文件，先识别是谁的修改并保存，不覆盖。原开发机已知用户文件见下一节。
3. `git fetch fork`，工作区可安全同步后执行`git pull --ff-only fork codex/android-capacitor`。如果分叉，不自动强推/硬重置，先比较双方提交并解决冲突。

### 每个可验证小步结束立即执行

1. 只完成一个可独立说明的模块/修复，运行与改动相关的检查。普通文档修改只需链接、命令与差异检查，不必打APK。
2. 更新对应批次记录：问题、改动、测试、未完成项、下一步。阶段状态有变化时也更新本文的当前状态。
3. `git diff --check`，用`git add`显式列出本批文件（不要直接git add .）；检查`git diff --cached --stat`及`git diff --cached`，排除用户文件、密钥和构建产物。
4. `git commit -m '中文说明：明确描述本批结果'`，随后立即`git push fork codex/android-capacitor`，不等多个模块积攒完成再推。
5. 核对同步状态并汇报：

```powershell
git rev-parse HEAD
git ls-remote fork refs/heads/codex/android-capacitor
git status --short
```

HEAD与远端分支哈希应相同。认证、网络或远端拒绝时，明确标记“已本地提交、尚未推送”，保留代码并解决问题，不宣称已同步。新电脑需要自己完成GitHub登录/仓库写权限配置；不要把令牌写入文档或远端URL。

这里的实时不是每保存一行就触发后台提交，而是**每个完成且可验证的小步立即commit+push**。未经验证却必须换电脑时，可做明确中文“交接：未验证……”的检查点提交，列出风险/失败步骤，下一电脑先补验；不要把未通过的状态伪装成可交付版本。

### 换电脑/结束工作前

- 确认所有本批必要代码和文档已推送，记录HEAD、测试状态、下一步与本地依赖；确认远端哈希一致。
- 停止在原电脑继续修改同一分支；新电脑先拉取最新再开工。两台电脑同时改同一模块最容易产生冲突，优先串行交接。
- 必要的未入库资料、APK或签名单独安全迁移，不能认为push包含它们。不要在Git未同步时删除原机工作区。
- 若推送因其他电脑先推而失败，保留自己的提交，fetch后查看`git log --oneline --left-right HEAD...fork/codex/android-capacitor`，解决差异、重跑相关验证再推，禁止强推覆盖对方。

## 8. 不随Git同步的资料

| 内容 | 当前情况 | 新电脑处理 |
| --- | --- | --- |
| node_modules | 忽略 | npm ci恢复 |
| dist-mobile、Android生成资产/build、Gradle缓存 | 忽略 | 网页构建/同步/Gradle重新生成 |
| releases/APK、截图、构建JSON、调查基线 | 忽略 | 原包手动复制并核验哈希，或重建；PC基线需同环境重采 |
| JDK、SDK、local.properties、代理 | 机器本地 | 安装并指定实际路径 |
| debug/release签名 | 不入库 | 私密备份迁移；验证证书指纹 |
| Logs/真机日志、图片、视频 | 原机未跟踪，未擅自提交 | 需要分析时单独复制；原始日志先审查隐私再决定是否入库 |
| play.bat、start-game.bat、tools/__pycache__/ | 原机用户未跟踪文件 | 未修改/未提交；私人脚本按需要单独保存，缓存不需要迁移 |
| 私人音乐、.env | 忽略 | 自行准备，不上传令牌或私人内容 |

已知重要旧日志：`INKWAVE-logs-20261021-102317-430.json`（GPU问题）、`...150522-438.json`（自动降分辨率）、`...151956-381.json`（test6固定高清）。这些不是仓库承诺包含的文件，不存在时不要凭空声称已重新分析。当前电脑另保留v1.0.8日志`INKWAVE-logs-20261023-154009-723720-9a50fb3a.json`和v1.0.9日志`INKWAVE-logs-20261023-161502-923757-60b5a7b2.json`，位于`releases/logs/`。

## 9. 下一位开发者从哪里接

1. 先阅读v17初始化对照结果与USB Boss工具说明；保留v11准备队列和资源池，勿回退手机云纹理到2048×640。用户要求每次修改基础检查后先中文commit/push，再装机测试，测试结论另行提交。
2. 基线日志为v1.0.10的`INKWAVE-logs-20261023-165256-228604-0d19c279.json`；接收v11真机时核对30帧/固定2倍/SMAA、进度条后的100ms帧间隔尖峰、slowFrames CPU归因及新增程序。至少采集2～3分钟playing，并测试Boss出场、首开火/受击和小怪出现/死亡；再做长期热机。
3. 按CPU分段和排行榜选择下一批单一目标：场景/远景裁剪或LOD、重复绘制、墨迹更新、UI/机器人更新等。排名靠前只表示优先调查，不等于已证实最耗GPU。
4. 原项目部分道具已经合并/实例化，机器人感知也已有节流。先测再改，不能重复加已有机制或凭空估计帧率收益。
5. 固定分辨率做同地图/路线/武器的前后对比；测试热机与对局开场/大招峰值。保持对局人数和命中判定，不靠降低玩法复杂度制造收益。
6. 小步修改、适当验证、中文提交并立即推送；提供下一测试APK和准确源码/签名/哈希记录，等用户逐批验收后再扩展。

第一轮原估计约3～6个工作日，取决于真机反馈和瓶颈；不是稳定60帧的保证，也不是要求在没有证据时一口气改完所有模块。当前渲染提交计时并非GPU计时，缺少GPU计时扩展时需用真机对照/性能跟踪辅助定位。

## 10. 文件导航与交接记录模板

- [Android总进度](android/PROGRESS.zh-CN.md)、[原16步骤计划](ANDROID-CAPACITOR-WEBVIEW-PLAN.zh-CN.md)、[构建与验收](android/BUILD-AND-TEST.zh-CN.md)。较早文档描述test1的30帧默认值时，以test6/test7及当前源码为准。
- 主循环与设置：src/main.js；PC后处理装配及手机边界：src/core/renderer.js。
- 手机材质：src/world/mobileLevelMaterial.js；兼容保护：src/platform/mobileGpu.js。
- 性能统计：src/platform/mobileProfiler.js；采样/设置：src/platform/mobile.js；导出：src/platform/diagnostics.js。
- 构建：tools/build-mobile.mjs、tools/build-android.ps1；原生诊断插件和Android工程在android/。

每次交接在对应批次文档记录：日期/开发机、起始提交、完成内容、验证命令及结果、真机验证状态、产物路径与哈希、已知风险、下一步、需要单独迁移的本地资料。提交完成后在用户汇报中给出实际提交号与推送状态，避免为在文档里写入“本文自己的提交号”而反复追加提交。

## 2026-10-26当前设备与待办

当前手机HONOR ALP-AN00 / Adreno730 / Android14 / WebView131，USB序列号A38YUT3C19022796；不是历史Maleoon设备。当前机器fork是用户仓库，origin为jaydendavisnc上游，推送前必须核对URL。用户要求每轮Boss仅60秒，结束后USB上传确认落盘再关闭游戏；目前优先初始化故障，稳定30帧仍待后续优化。工具启动失败不得当成GPU失败，截图需要16MiB缓冲，普通入口通过需同时看原生日志与真实截图。

v17追加一分钟Boss切场景已通过初始化/8人/2倍/SMAA/USB真实上传/自动关闭闭环；平均26.180FPS、7个100ms以上帧，稳定30仍未通过。不要把startup通过写成性能完成；原始文件见GRAPHICS-INIT-test16末节。用户当前优先初始化排查，下一性能批次需以此版本为基线。
