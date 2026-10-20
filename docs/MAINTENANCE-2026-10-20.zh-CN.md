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
