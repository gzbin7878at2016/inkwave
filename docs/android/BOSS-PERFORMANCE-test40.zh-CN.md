# v40：撤下无实战收益的Boss HUD动画接管

v38/v39的实验及结果分别保存在test38/test39。真实样式批量读写修正成立，但正式热机26.076/25.783FPS，未证明接管循环动画能提高实战性能，因此撤下生产入口。

src/platform/mobile.js 移除该控制器导入、创建、suspend、公开接口和逐帧调用，恢复与v37 d91ba2e相同的运行代码；HUD重新由原生CSS时钟处理。隔离的mobileBossAnimationClock模块及两个浏览器测试仅留作研究复现，不由游戏入口加载，不再声明正在优化HUD。保留v37已验证的SMAA正确清零，以及v31输出融合/v30音频缓存等既有功能；不变更PC、玩法、2倍/SMAA或人数。

真实Boss加载/playing回归新增断言：game.mobile不应安装bossAnimationClock。版本1.0.40，按基础检查→中文提交推送→干净构建签名与资产核对→USB真机60秒→实际上传源码核对→关闭流程执行。

## 基础回归中的保留问题

移动网页构建通过。首次真实Boss回归出现1个playing期新程序（id101），断言失败；已保留本地v40-web-first-late-program.json，不覆盖失败证据。实际shader头为MeshPhysicalMaterial、instancing/instanceColor/clearcoat/sheen，而原报告当前draw材质是SMAABossOutputShader：说明“当前draw”不必等于刚加入info.programs的程序所有者，不能误称SMAA重编译。增强工具用材质programs缓存反查真实场景所有者及cacheKey，不放宽零新程序断言。

同一成品入口第二次完整回归通过：加载/playing撤回断言/两轮小怪复用/后台取消/页面shader错误0，未新增程序。该现象有战况随机性，原因尚未定位，不能说所有首次使用都已预热或首次失败已修复；后续Boss调查继续追踪。撤回mobile.js与v37源码逐字节相同，不引入新渲染路径。

## 当前验收

干净源码baed1de3928748aaefbfb3b7492fd1e65463eb3b，v1.0.40/code40，21143338字节，SHA256 d9323e5fe5df18b9985d736185496f931c1adebc1bdc302d3328915b35eb3ab2。签名通过、386资产逐字节一致，USB覆盖安装成功。

无探针60秒游戏时钟自然结束：1715帧/64.9197实际秒，平均26.41725FPS，p95 58.3ms、p99 75ms、9次≥100ms，电池43→46℃。固定2倍、scale1、SMAA、8人，SMAA正确清零实际启用，animationClock=null确认未安装候选。真实游玩包含移动/瞄准/开火/跳跃/副武器/大招/潜墨，死亡与复活走原规则。实际UI USB上传 INKWAVE-logs-20261026-162932-398191-93996896.json，PC核对源码baed1de后force-stop确认关闭。此轮只确认恢复包可正常启动/游玩/上传/退出，温度/阵容不同，不宣称对照提帧。

30未稳定，60未开始。后续优先单独调查监听器/循环声像器AudioParam同目标重复排期比例，不先修改声音。只有确认可省且离线移动/静止波形与退出/PC普通隔离通过后才做去重；RG8格式仍需同真实HDR输入验证。


## 后续调查工具：AudioParam重复排期

新增 tools/probe-phone-boss-audio-params.mjs，附着现有9223 WebSocket，不创建/删除ADB转发，不启动另一局；只允许带方法探针的同一真实Boss playing轮，实战5秒后开始20秒统计，超过30秒不附着。helper tools/boss-audio-param-probe.mjs 只登记listener九参数与_setPos实际遇到的panner xyz/距离低通/混响send；不全局覆盖AudioParam原型，不碰包络/音量/音高，不去重/消音/改HRTF。每次先原样调用原生方法，保留参数、this、返回值和异常，然后统计同目标+同时间常数+非递减时间的潜在重复。此比例不是声音等价或CPU收益证明；其他排期写入的影响仍须后续验证。

最多4096个弱引用登记、有限14组计数，不保留voice。结束恢复原实例描述符/原型继承；外部接管不覆盖，登记失败停止调查但仍转发原调用。工具失败也finally尝试恢复，主轮仍正常收尾上传关闭。恢复不完整/容量溢出/无调用均算失败。

真实OfflineAudioContext测试（tools/check-boss-audio-param-probe.mjs）equalpower/HRTF两模型：原路径与观察路径双声道8192样本逐点差0；相同目标/移动目标、原生非法参数异常、返回值/继承方法/引擎恢复及外部接管均通过。这里只证明观察器不改声音，不证明未来真正去重不改声音。语法检查后单独中文提交工具，再跑一分钟方法调查；不能当正式成绩。

调查工具首次附着发生在应用脚本尚未初始化时，裸__inkwave引用导致工具退出，尚未安装观察器；不属于游戏图形故障。已改为window可选链等待，当前主轮继续，不重启或重复开局。
