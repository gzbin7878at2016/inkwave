# Boss小地图Worker可行性实验

仅tools实验，未接入产品APK。目标是将原小地图bilinear/浮雕像素循环移出主线程；保持完整分辨率、3段节奏、队伍归属和闪光。不会更改PC或物理/AI/枪口/8人规则。

工具：`minimap-band-kernel.mjs`逐式提取原算法；`minimap-band-worker.mjs`创建同源Blob Worker，初始化复制静态和工作数组，不转移真实地图buffer。单个在途请求、超时终止、异常拒绝、显式dispose释放Worker和Blob URL；预算检查在复制前。当前392×658持久状态约6,712,480字节，另有返回行缓冲和初始化瞬时副本/GC成本，不能只看持久状态称总内存。原始图像、网格只读副本实验，不会改真实比赛。

`node tools/check-minimap-band-worker.mjs`：真实Minimap._drawInk作为独立参考；420组随机/清空/换色/全幅/分段/halo/owner/闪光时钟、实际Canvas逐字节一致，映射重建、在途上限、取消、异常、超时与容量拒绝通过。桌面392×658，每场景54次（排除前12次预热）：原入口总耗时空白49.5ms、快照160.3ms、稀疏166.9ms、全变288.7ms；Worker主线程显式enqueue+callback+apply为8.8/7.6/7.4/8.2ms，往返P95为1.3/4.0/3.9/6.1ms。时钟粒度、Worker调度与运行时消息分发成本仍存在，不能从这组微基准推算实战FPS。

下一步先中文提交推送工具，再运行BOSS_MINIMAP_WORKER_BENCHMARK=1独立一分钟方法轮：正常实战自然结算后，在四份真实地图副本分别测empty/snapshot/sparse/dense，比较原入口与Worker行结果、owner及实际Canvas，记录消息复制/回调/应用/Worker计算/往返P95。真实UI USB上传核对并关闭游戏。方法轮FPS不是Worker实战成绩；APK仍v44，Worker未启用。每个场景独立CDP调用，避免一次长操作超时。

只有手机证明有收益，才考虑仅手机真实Boss接入：消息回调仅保存结果，主循环中应用，避免额外重绘；一份在途、限制结果年龄，失效/暂停/取消/重建/离场终止并回原同步算法；验证新增一帧视觉延迟、owner闪光、内存/调度是否可接受，再干净构建与正式一分钟测试。不能靠降低地图分辨率或删除玩法子步达标。
