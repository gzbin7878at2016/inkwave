# v40：撤下无实战收益的Boss HUD动画接管

v38/v39的实验及结果分别保存在test38/test39。真实样式批量读写修正成立，但正式热机26.076/25.783FPS，未证明接管循环动画能提高实战性能，因此撤下生产入口。

src/platform/mobile.js 移除该控制器导入、创建、suspend、公开接口和逐帧调用，恢复与v37 d91ba2e相同的运行代码；HUD重新由原生CSS时钟处理。隔离的mobileBossAnimationClock模块及两个浏览器测试仅留作研究复现，不由游戏入口加载，不再声明正在优化HUD。保留v37已验证的SMAA正确清零，以及v31输出融合/v30音频缓存等既有功能；不变更PC、玩法、2倍/SMAA或人数。

真实Boss加载/playing回归新增断言：game.mobile不应安装bossAnimationClock。版本1.0.40，按基础检查→中文提交推送→干净构建签名与资产核对→USB真机60秒→实际上传源码核对→关闭流程执行。

## 基础回归中的保留问题

移动网页构建通过。首次真实Boss回归出现1个playing期新程序（id101），断言失败；已保留本地v40-web-first-late-program.json，不覆盖失败证据。实际shader头为MeshPhysicalMaterial、instancing/instanceColor/clearcoat/sheen，而原报告当前draw材质是SMAABossOutputShader：说明“当前draw”不必等于刚加入info.programs的程序所有者，不能误称SMAA重编译。增强工具用材质programs缓存反查真实场景所有者及cacheKey，不放宽零新程序断言。

同一成品入口第二次完整回归通过：加载/playing撤回断言/两轮小怪复用/后台取消/页面shader错误0，未新增程序。该现象有战况随机性，原因尚未定位，不能说所有首次使用都已预热或首次失败已修复；后续Boss调查继续追踪。撤回mobile.js与v37源码逐字节相同，不引入新渲染路径。

## 当前验收

待完成构建与真机。30未稳定，60未开始。后续优先单独调查监听器/循环声像器AudioParam同目标重复排期比例，不先修改声音。只有确认可省且离线移动/静止波形与退出/PC普通隔离通过后才做去重；RG8格式仍需同真实HDR输入验证。
