// ============================================================================
// 【中文导读】舞台表面材质注册表 —— 把各图的材质层汇总到固定的 PATTERN 槽位
// ----------------------------------------------------------------------------
// 【模块定位】材质装配层。汇总 stages/<id>/surfaces.js 的 SURFACES,产出一张扁平
//   列表 STAGE_SURFACES,供 src/world/texlib.js 烘焙纹理、src/world/levelMaterial.js
//   做槽位重映射。它只 import 各图的 surfaces.js(不 import props/layout),因此
//   texlib 永远不会被牵连进舞台几何(见文件首段英文注释)。
// 【核心机制】
//   - 纹理库 PATTERN 槽位:0–27 是共享套件(src/world/mapkit.js);28 起每张图占三个
//     连续槽位,见 STAGE_SLOTS。槽位号只是着色器槽表里的下标,不是数组索引。
//   - STAGE_SURFACES 每项逐字段:
//       stage  所属图 id
//       slot   PATTERN 槽位号(28…48)
//       name   纹理层名,形如 '<stage>:<name>'(texlib uber-program 用的层名)
//       group  texlib uber-program 分组;每张图一组(3 + 它在 STAGE_SLOTS 里的次序),
//              组间并行编译且各自很小
//       mat    材质参数(遵循 texlib MATERIALS 契约:prep 声明 fbm/worley,surf 写
//              s.alb/s.a/s.h/s.rough/…)
//       onWall / onTop 朝向重映射:该槽位竖直面/顶面改用的槽位号(可选)
//   - 构建时做一次校验:某层若不在本图保留的槽位上,打印 warning 并跳过(不致命)。
// 【关键约定】
//   - FIRST_STAGE_SLOT / LAST_STAGE_SLOT 划出舞台区间的闭区间(28…48),levelMaterial.js
//     用它拼“未注册槽位回落到 concrete”的映射数组。
//   - 每张图恰好三个槽;SURF 把可读名映射到槽号(布局里写 pattern: SURF.<name>)。
// 【配套阅读】src/world/texlib.js、src/world/levelMaterial.js、src/world/mapkit.js、
//   src/world/stages/cargo/surfaces.js(单个图的样例)、docs/ASSETS.zh-CN.md
// ============================================================================
// Registry of every stage's surface materials (src/world/stages/<id>/surfaces.js) for texlib.js + levelMaterial.js.
// PATTERN slots 0–27 are the shared kit (mapkit.js); each stage owns three slots from 28 up (STAGE_SLOTS below). The
// slots only exist in the shader's slot table. Imports only the surfaces files (no props / layout), so texlib.js never
// pulls in stage geometry.
import * as tidewater from './tidewater/surfaces.js';
import * as kelpline from './kelpline/surfaces.js';
import * as saltpan from './saltpan/surfaces.js';
import * as crossmarket from './crossmarket/surfaces.js';
import * as lockgate from './lockgate/surfaces.js';
import * as terraces from './terraces/surfaces.js';
import * as cargo from './cargo/surfaces.js';

// 【模块表】图 id → 其 surfaces.js 命名空间;遍历顺序即 group 编号顺序(见下方循环的 k)。
const PACKS = { tidewater, kelpline, saltpan, crossmarket, lockgate, terraces, cargo };
// 【槽位分配】每张图三个连续 PATTERN 槽位(28 起);改动这里等于改动所有该图 surfaces.js
// 里的 SURF 映射与着色器槽表,必须同步。
export const STAGE_SLOTS = { tidewater: [28, 29, 30], kelpline: [31, 32, 33], saltpan: [34, 35, 36], crossmarket: [37, 38, 39], lockgate: [40, 41, 42], terraces: [43, 44, 45], cargo: [46, 47, 48] };
// 【舞台槽区间】闭区间端点,levelMaterial.js 用 LAST_STAGE_SLOT - FIRST_STAGE_SLOT + 1 的长度生成槽位映射。
export const FIRST_STAGE_SLOT = 28, LAST_STAGE_SLOT = 48;
// flat list: { stage, slot, name (texlib layer name, '<stage>:<name>'), group (texlib uber-program), mat, onWall, onTop }
// Each stage's layers get an uber-program of their own (group 3 + its index): compiled in parallel with the others, and
// each stays small.
// 【扁平列表】所有图的材质层摊平于此;字段含义见顶部导读。按 STAGE_SLOTS 的键顺序逐图填充。
export const STAGE_SURFACES = [];
Object.keys(STAGE_SLOTS).forEach((stage, k) => {
  for (const s of PACKS[stage].SURFACES || []) {
    // 【槽位校验】每个图只允许用自己的三个槽;越界说明该图 surfaces.js 的 slot 写错了,
    // 打印 warning 并跳过该层(不阻断启动),便于排障。
    if (!STAGE_SLOTS[stage].includes(s.slot)) { console.warn(`[inkwave] ${stage} surface '${s.name}' is not on one of its slots`, STAGE_SLOTS[stage]); continue; }
    // group = 3 + k:group 0..2 是基础材质,舞台 uber-program 从 3 起每图一组。
    STAGE_SURFACES.push({ stage, slot: s.slot, name: `${stage}:${s.name}`, group: 3 + k, mat: s.mat, onWall: s.onWall, onTop: s.onTop });
  }
});
