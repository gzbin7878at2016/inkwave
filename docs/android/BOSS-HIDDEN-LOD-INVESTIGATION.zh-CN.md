# Boss隐藏LOD场景树调查

## 2026-10-27 当前v49调用栈

同安装ef0e0a1，正常一分钟Boss方法轮，30秒V8采样（开始战斗约5秒后），原始releases/investigation/boss-cpu-2026-10-26T23-34-13-843Z.json。按同函数/文件/行号聚合自耗时：updateMatrixWorld625ms、multiplyMatrices211ms、projectObject388ms、角色update470ms、setProgram433ms、GC399ms、raycast622ms。递归及含子时间不相加；V8自耗时不是纯硬件CPU，(program)12194ms不可直接当JS瓶颈。只作为进一步验证线索。

方法轮24.20013FPS/P95 66.6/P99 91.7ms、>=100ms14次，44→45°C，不作正式成绩；UI USB233557-052640-20f4a9b6核对ef0e0a1、退出恢复及关闭通过。真实只读盘点：8角色每人三档各4个SkinnedMesh，其中8个隐藏叶网格，local transform均identity，仍挂kid上；不是要删角色、骨骼、动画或可见LOD。

## 工具实验，尚未通过

node tools/check-boss-hidden-lod.mjs：独立Edge加载原dist-mobile Boss，冻结同一状态，临时摘下64个已经visible=false的LOD叶网格。比较原参考重复/候选首帧/候选重复/恢复最终像素、全部可见对象世界矩阵与8套骨骼矩阵，均须逐值一致；恢复原父节点和子节点顺序。ABBA各200次scene.updateMatrixWorld只测矩阵遍历墙钟，不当手机FPS或总帧成本。

实验只作用工具副本，产品仍v49。若像素或结构不一致立即失败；即使通过仍需动态LOD交叉渐变、武器/形态、换局/菜单恢复与真机开销验证，不能直接改产品。
