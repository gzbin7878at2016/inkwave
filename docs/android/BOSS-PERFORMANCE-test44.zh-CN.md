# Boss v44：上传日志中的实际边缘缓冲

本批只补诊断，不改变画质或比赛规则。`scene.render.smaaEdges`复制已有JS状态，无新增帧内WebGL查询或读回；仅手机Boss的RG16F优化沿用v43，PC保持原路径。

源码21980d52e0067a45d2c77b4e21cb363d30fd53a9提交推送后干净构建（trackedChanges=false），v1.0.44/code44。APK `releases/INKWAVE-android-test44-21980d5.apk`：21,148,245字节，SHA256 `b107aad6930a98d5848096f070aa6c6abb12edf507272e57b9450d7cb4713d7b`，签名验证及390资产逐字节比对通过，安装成功。

60游戏秒正常自动操作，无方法/遮蔽/格式比较/CPU Trace，2倍高清、SMAA、8人、原物理AI子步保持：1709帧/64.6179实际秒=26.44778FPS，P95 58.4ms、P99 74.9ms，>=100ms四次。**稳定30未通过，60未开始；不能将日志补齐称为提帧。**

真实UI USB上传 `INKWAVE-logs-20261026-201534-767389-92c6f686.json` 核对源码后成功；文件内active=true、frames=1993、RG16F、1556×740、附件16/16/0/0、FBO complete、权重HalfFloat保持。逻辑存储及节省量各4,605,760字节，仅逻辑估算，不代表GPU物理内存或功耗实测。上传确认后已关闭游戏（appClosed=true）。原始日志及电脑报告保存在本机releases目录。

下一项先在tools中独立验证小地图像素计算Worker：真实原入口与Canvas逐字节、owner/闪光/halo一致，测消息复制、主线程应用与往返延迟，再决定是否接入。当前没有Worker产品改动。
