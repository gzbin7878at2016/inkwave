# DemoInk / INKWAVE 开发进度与跨电脑接续指南

更新日期：2026-10-23（北京时间）。本文件是接续开发入口，与根目录AGENTS.md共同维护。每批改动后更新相关记录并立即提交、推送。

## 1. 先读结论

- 用户仓库：<https://github.com/gzbin7878at2016/inkwave>。
- **最新工作分支：`codex/android-capacitor`。不要只拉main就开始开发。** main目前仍停在早期Android方案文档阶段，未合并本轮实现。
- 编写本文前的开发分支HEAD：`46ad962`；最新功能提交：`b484104`（手机性能定位第一批）。本文自身的提交号由Git记录，后续以远端分支HEAD为准，不把这个历史哈希当作永远最新。
- 当前已可构建/侧载Android debug APK；最低Android10/API29，包名`com.demoink.inkwave`。test8新增[同一Wi-Fi上传日志](android/LOG-UPLOAD-test8.zh-CN.md)，电脑接收器保存到`releases/logs/`；真机上传仍待验收，日志可用于继续test7性能分析。
- 手机默认60帧目标、2倍高清、SMAA、自动降低清晰度关闭；几何预算low，阴影和泛光默认关闭。这里low不表示1倍渲染。
- 固定高清已在test6真机日志确认；**稳定60帧未达成**。test7为低频性能诊断包，等待用户新真机日志，再选择第二批热点优化。
- PC保留原渲染路径。不要为手机性能直接改共享QUALITY或PC地面着色器。

## 2. 目标、已完成事项与证据

| 模块 | 已完成 | 验证边界/剩余工作 |
| --- | --- | --- |
| Android壳与构建 | Capacitor、本地网页/素材内置、横屏、独立JDK/SDK构建脚本、debug签名和哈希 | 正式签名、商店发布未做；新电脑需自备工具链 |
| 输入与生命周期 | 多指角色固定、拖开火转向、左右布局、灵敏度、按钮大小、取消蓄力、后台释放输入和恢复确认 | 全武器/手机组合的长期真机手感仍待验收 |
| 离线与联机 | 离线练习/机器人；WSS中继路由、心跳超时、旧socket隔离、队列保护 | 手机多人、弱网、房主迁移矩阵未全部验收；后台离房，不是无缝重连 |
| GPU兼容 | 手机独立参数纹理和简化材质、失败降级/暂停、诊断导出 | Maleoon实际日志已无原地面shader失败；其他GPU仍需测 |
| 清晰度与材质 | 1/1.5/2倍选项、SMAA/FXAA、ORM/烘焙遮蔽、墨迹边缘 | 仍是现有模型资产，不等同于商业手游美术品质 |
| 固定高清 | 一次性迁移默认60/2倍，自动降分辨率可选且默认关 | 实际帧率随负载变化，不能承诺固定60 |
| 性能第一批 | CPU九段与total、真实绘制排行榜、模式隔离、有界样本 | test7已本地验证，未收到test7真机验收；尚未做具体热点减负 |

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

当前本机最新包：`releases/INKWAVE-android-test7-b484104.apk`，21,072,527字节，版本`1.1.0-android-test.7-profile`/versionCode7。
SHA-256：`266f69428e3d9943e6fdc88efe141de10c70f9cc1b197552221d79d22e92bb75`。
源码完整提交：`b4841045df25dc13237438e5ea5920f12112be22`，打包时已跟踪源码干净；350个网页资源逐字节匹配，签名验证通过。这是已有包的哈希，新电脑重建不应要求字节/哈希必然相同。

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
```

以上clone命令仅用于新目录；已有仓库不要重复clone覆盖。`--origin fork`主动将用户仓库命名为fork，方便与当前流程一致。npm ci以package-lock.json为准；不要为安装方便随意升级依赖。

现有旧克隆先核对`git remote -v`：本机origin是上游`jaydendavisnc/inkwave`，fork才是用户仓库。若用户仓库没有远端，确认不存在同名fork后添加：

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

**跨电脑覆盖安装的关键：同包名必须使用同一签名。** 当前为Android debug证书，证书SHA-256是`201c792dd53554e6ea343d1850e1e009ab0c8298c0622d198be6e44836351b69`。新电脑自动生成的debug.keystore通常不同，将无法覆盖旧包。

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

已知重要旧日志：`INKWAVE-logs-20261021-102317-430.json`（GPU问题）、`...150522-438.json`（自动降分辨率）、`...151956-381.json`（test6固定高清）。这些不是仓库承诺包含的文件，不存在时不要凭空声称已重新分析。当前未收到test7真机日志。

## 9. 下一位开发者从哪里接

1. 先确认代码已包含test7性能统计，而不是只看到main旧方案。
2. 请求/接收用户test7在实际playing对局中至少2分钟的新日志，核对版本、固定2倍、profile样本与绘制排行。退出菜单会重置上下文，应在对局内导出。
3. 按CPU分段和排行榜选择**第二批的单一目标**：场景/远景裁剪或LOD、重复绘制、墨迹更新、UI/机器人更新等。排名靠前只表示优先调查，不等于已证实最耗GPU。
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
