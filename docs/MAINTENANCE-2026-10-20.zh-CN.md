# 分模块修正与验证记录（2026-10-20）

## 完成范围

本轮依据静态检查发现的问题，按模块独立提交并逐批推送到用户仓库 `gzbin7878at2016/inkwave` 的 `main`。没有推送上游原作者仓库。

- 修正启动、角色/动画、墨水和音频文档中的错误行号，连同受新增注释影响的链接同步更新。
- 纠正 `npm start` 与静态服务混淆、LOD 本地玩家固定 hero、发束权重误写为脊柱等说明。
- 为清单中的66个文件补中文模块导读或关键入口说明：src 32个、server 1个、build 3个、tools 30个。
- 保留原英文注释；新增中文重点解释状态机、坐标、所有权、输入输出、资源生命周期和工具前提，不声称逐行翻译全部代码。
- 新增 [tools/check-js.mjs](../tools/check-js.mjs)，将 `npm run check` 改成跨平台Node入口。
- 没有修改玩法、武器数值、渲染效果或联机协议；检查脚本与package命令是唯一新增的可执行功能。

## 验证结果

| 检查 | 结果 |
|---|---|
| `npm run check` | 171个JS/MJS/CJS全部通过 |
| Python语法 | 5个文件全部通过 |
| 注释改动等价检查 | 66个源码文件通过；JS去除整行注释后执行文本相同，Python AST相同 |
| 中文注释覆盖复扫 | 本轮扫描的src/server/electron/build/tools中JS/Python未检出中文注释的文件为0 |
| 项目文档本地链接 | 修正完成后297次链接目标及源码行号范围检查通过 |
| 检查脚本失败路径 | 临时非法JS被正确拒绝并返回非零；从仓库外启动也可定位源码；探针已删除 |
| `git diff --check` | 通过 |
| GitHub同步 | 所有模块提交已推送到fork/main；报告随本提交推送 |

中文覆盖统计不包括第三方vendor/node_modules、Shell/BAT脚本，也不代表每个函数已有完整中文解释。文档行号范围检查与正文语义核对分开进行，已确认的问题按对应函数重新定位。

本轮没有运行实际浏览器/Electron联机、音频渲染、截图录制或Android游戏测试。多个历史工具仍有macOS浏览器路径、字体或Metal配置前提，已补说明，没有将它们宣称为Windows运行兼容。

## 模块提交

下表是本轮21次模块提交；本记录另作一次文档提交。首次推送还同步了本地此前已经存在的6个历史提交，它们不计入本轮修正数量。

| 批次 | 修改内容 | GitHub提交 |
|---|---|---|
| 1 | docs(boot): correct startup commands and source anchors | [d90730c](https://github.com/gzbin7878at2016/inkwave/commit/d90730c) |
| 2 | docs(character): correct LOD, rig and actor references | [1256ebf](https://github.com/gzbin7878at2016/inkwave/commit/1256ebf) |
| 3 | docs(ink): fix paint anchors and ownership diagram | [63ed145](https://github.com/gzbin7878at2016/inkwave/commit/63ed145) |
| 4 | fix(tooling): make JavaScript syntax checks cross-platform | [5d92fd5](https://github.com/gzbin7878at2016/inkwave/commit/5d92fd5) |
| 5 | docs(game): annotate camera, minimap and sub-weapon lifecycles | [2bd9469](https://github.com/gzbin7878at2016/inkwave/commit/2bd9469) |
| 6 | docs(boss): explain simulation ownership, hazards and procedural models | [fbaaad4](https://github.com/gzbin7878at2016/inkwave/commit/fbaaad4) |
| 7 | docs(weapons): annotate bow and brolly presentation contracts | [91f90bf](https://github.com/gzbin7878at2016/inkwave/commit/91f90bf) |
| 8 | docs(kits): explain sub-weapon state machines and ghost ownership | [04b6ad1](https://github.com/gzbin7878at2016/inkwave/commit/04b6ad1) |
| 9 | docs(crossmarket): annotate prop registration and stage contracts | [f0846a7](https://github.com/gzbin7878at2016/inkwave/commit/f0846a7) |
| 10 | docs(lockgate): annotate canal layout, murals and surface slots | [205353f](https://github.com/gzbin7878at2016/inkwave/commit/205353f) |
| 11 | docs(terraces): annotate mural coordinates and material generation | [72e7451](https://github.com/gzbin7878at2016/inkwave/commit/72e7451) |
| 12 | docs(tidewater): annotate curved layouts and procedural surfaces | [c08daa0](https://github.com/gzbin7878at2016/inkwave/commit/c08daa0) |
| 13 | docs(decor): explain non-colliding scenery and shader animation | [1391316](https://github.com/gzbin7878at2016/inkwave/commit/1391316) |
| 14 | docs(relay): annotate protocol, liveness and host election | [a5dbc5b](https://github.com/gzbin7878at2016/inkwave/commit/a5dbc5b) |
| 15 | docs(build): annotate asset baking and distribution tooling | [cd6b15c](https://github.com/gzbin7878at2016/inkwave/commit/cd6b15c) |
| 16 | docs(labs): add Chinese guides to development preview modules | [f8b50d6](https://github.com/gzbin7878at2016/inkwave/commit/f8b50d6) |
| 17 | docs(server): clarify Python dev-server launch and cache behavior | [46f694f](https://github.com/gzbin7878at2016/inkwave/commit/46f694f) |
| 18 | docs(testing): annotate audio, handling, network and bot harnesses | [e5b48da](https://github.com/gzbin7878at2016/inkwave/commit/e5b48da) |
| 19 | docs(capture): annotate deterministic screenshots and platform assumptions | [2785e7e](https://github.com/gzbin7878at2016/inkwave/commit/2785e7e) |
| 20 | docs(reels): annotate frame recording and video composition | [2af71c5](https://github.com/gzbin7878at2016/inkwave/commit/2af71c5) |
| 21 | docs(character): replace remaining stale bare line references | [9db763d](https://github.com/gzbin7878at2016/inkwave/commit/9db763d) |

## 工作区保护

`play.bat`、`start-game.bat`、`tools/__pycache__/` 保持未跟踪，未纳入这些提交。临时检查脚本、差异数据和故意构造的错误样例未提交到项目。

后续若继续大规模插入源码注释，应在该模块提交前同步更新关联文档行号，再运行 `npm run check`；不要只依靠链接未越界就认定正文引用正确。

## 第二轮：函数与关键流程中文注释补充

本轮以 `f320875` 为基线，对先前主要只有文件导读、函数体解释较少的模块继续补充。共完成 **17 批模块提交，34 个 JavaScript 文件，新增 664 行中文注释**。原有英文注释保留；只在函数入口、状态转换、坐标约定、缓存、联网权限和资源释放等有维护价值的位置增加说明，没有给每条简单赋值堆砌注释。

`ASSETS-CHARACTER.zh-CN.md` 与 `ASSETS-AUDIO.zh-CN.md` 中受影响的引用行号随对应模块提交更新。

| 批次 | 模块与重点 | GitHub 提交 |
|---|---|---|
| 1 | 镜头模式与碰撞跟随 | [1ff2ce0](https://github.com/gzbin7878at2016/inkwave/commit/1ff2ce0) |
| 2 | 小地图投影、缓存与信息过滤 | [1fdf667](https://github.com/gzbin7878at2016/inkwave/commit/1fdf667) |
| 3 | 比赛生命周期与联机阵容 | [5347fe8](https://github.com/gzbin7878at2016/inkwave/commit/5347fe8) |
| 4 | 副武器装置状态与伤害权限 | [26d9975](https://github.com/gzbin7878at2016/inkwave/commit/26d9975) |
| 5 | 大招道具装配与枢轴 | [b58750f](https://github.com/gzbin7878at2016/inkwave/commit/b58750f) |
| 6 | BOSS 战斗与危险区 | [e89ee9c](https://github.com/gzbin7878at2016/inkwave/commit/e89ee9c) |
| 7 | BOSS 动作混合、步态与附属链 | [a21386f](https://github.com/gzbin7878at2016/inkwave/commit/a21386f) |
| 8 | BOSS 几何、蒙皮与程序化材质 | [3e54f33](https://github.com/gzbin7878at2016/inkwave/commit/3e54f33) |
| 9 | 回旋镖与反弹追踪弹 | [78449ce](https://github.com/gzbin7878at2016/inkwave/commit/78449ce) |
| 10 | 摇罐充能与连续爆炸 | [f5cbafb](https://github.com/gzbin7878at2016/inkwave/commit/f5cbafb) |
| 11 | 鱼雷与行走炸弹 | [07102ca](https://github.com/gzbin7878at2016/inkwave/commit/07102ca) |
| 12 | 弓、伞枪模型与弓音效 | [2325f2d](https://github.com/gzbin7878at2016/inkwave/commit/2325f2d) |
| 13 | 十字市场道具与放置 | [fb34fbd](https://github.com/gzbin7878at2016/inkwave/commit/fb34fbd) |
| 14 | 运河布局、材质与壁画 | [4a61fac](https://github.com/gzbin7878at2016/inkwave/commit/4a61fac) |
| 15 | 梯田材质与壁画 | [359b3c6](https://github.com/gzbin7878at2016/inkwave/commit/359b3c6) |
| 16 | 海滨广场弧线与标牌 | [c55c3c8](https://github.com/gzbin7878at2016/inkwave/commit/c55c3c8) |
| 17 | 公共场景装饰 | [254a596](https://github.com/gzbin7878at2016/inkwave/commit/254a596) |

复核结果：

- 171 个 JavaScript 文件语法检查通过；公开 Markdown 中 298 处本地链接目标及源码行号范围检查通过。
- 相对本轮基线，34 个源文件去除整行 `//` 注释后的内容一致；本轮未修改执行代码或 shader 字符串。
- 对 `src`、`server`、`electron`、`build`、`tools` 下 JS/MJS/CJS/Python 源文件复扫，未发现完全缺少中文注释的文件。此统计表示文件级覆盖，不表示每个函数都已逐行注释，也不等同于全部注释语义已由自动工具证明。
- 每批模块提交均已推送到 `fork/main`；模块完成时本地与远端差异为 0/0。此汇总记录另作一次文档提交。
- 本轮为注释维护，未运行游戏画面、音效、真实联机或 Android 真机测试；语法通过不代表这些运行行为经过验证。
- 原有未跟踪的 `play.bat`、`start-game.bat`、`tools/__pycache__/` 继续保留，未纳入提交。
