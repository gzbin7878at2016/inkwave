// ============================================================================
// 【中文导读】舞台注册表 —— 把每张图的四个零件模块汇总成一个 STAGES 表
// ----------------------------------------------------------------------------
// 【模块定位】世界装配层的“目录”。每个舞台是 stages/<id>/ 下的一个文件夹,各自导出
//   四类零件;本文件用静态 import * 汇总成 STAGES[id],供全局各处按 id 取用。
//   它不实现任何逻辑,只做“聚合 + 命名”。
// 【核心机制】
//   - 每个舞台文件夹约定导出(缺项即视为该零件不存在):
//       layout.js    → LAYOUT      布局块列表(几何)
//       props.js     → register / PLACEMENTS  道具注册函数 / 自带摆放表
//       surfaces.js  → SURF / SURFACES        材质槽位映射 / 材质层定义
//       murals.js    → drawMurals             该图的壁画绘制回调
//   - 用 { ...module } 展开合并,所以同名的导出会按导入顺序覆盖(四文件各司其职,
//     一般无重名冲突)。
//   - 静态 import 而非动态加载:发布的舞台常量编译期内联,不存在“加载器出错”的
//     运行期失败面 —— 这是刻意的取舍(见文件首段英文注释)。
// 【关键约定】
//   - STAGES[id] 的字段由各消费方按需读取,缺项不是错误:
//       LAYOUT → src/world/maps.js;register → src/world/props.js;
//       PLACEMENTS → src/world/dressing.js;SURFACES → src/world/stages/surfaces.js;
//       drawMurals → src/world/murals.js。
//   - Halyard 是例外:它的数据散在 maps.js / dressing.js / murals.js,不在本表内。
//   - STAGE_IDS 的顺序 = 对象键的插入顺序,即下面 STAGES 里 tidewater…cargo 的次序。
// 【配套阅读】src/world/maps.js、src/world/props.js、src/world/dressing.js、
//   src/world/stages/surfaces.js、src/world/murals.js、docs/ARCHITECTURE.zh-CN.md
// ============================================================================
// Stage modules (src/world/stages/<id>/): each stage owns its folder — layout.js (LAYOUT), props.js (register,
// PLACEMENTS), surfaces.js (SURF, SURFACES) and murals.js (drawMurals). Halyard keeps its data in maps.js / dressing.js /
// murals.js. Static imports: a stage that ships is always loaded, so there is no dynamic loader to go wrong.
import * as tidewaterLayout from './tidewater/layout.js';
import * as tidewaterProps from './tidewater/props.js';
import * as tidewaterSurfaces from './tidewater/surfaces.js';
import * as tidewaterMurals from './tidewater/murals.js';
import * as kelplineLayout from './kelpline/layout.js';
import * as kelplineProps from './kelpline/props.js';
import * as kelplineSurfaces from './kelpline/surfaces.js';
import * as kelplineMurals from './kelpline/murals.js';
import * as saltpanLayout from './saltpan/layout.js';
import * as saltpanProps from './saltpan/props.js';
import * as saltpanSurfaces from './saltpan/surfaces.js';
import * as saltpanMurals from './saltpan/murals.js';
import * as crossmarketLayout from './crossmarket/layout.js';
import * as crossmarketProps from './crossmarket/props.js';
import * as crossmarketSurfaces from './crossmarket/surfaces.js';
import * as crossmarketMurals from './crossmarket/murals.js';
import * as lockgateLayout from './lockgate/layout.js';
import * as lockgateProps from './lockgate/props.js';
import * as lockgateSurfaces from './lockgate/surfaces.js';
import * as lockgateMurals from './lockgate/murals.js';
import * as terracesLayout from './terraces/layout.js';
import * as terracesProps from './terraces/props.js';
import * as terracesSurfaces from './terraces/surfaces.js';
import * as terracesMurals from './terraces/murals.js';
import * as cargoLayout from './cargo/layout.js';
import * as cargoProps from './cargo/props.js';
import * as cargoSurfaces from './cargo/surfaces.js';
import * as cargoMurals from './cargo/murals.js';

// STAGES[id] = { LAYOUT, register, PLACEMENTS, SURF, SURFACES, drawMurals } (missing pieces are simply absent)
// 【注册表】每张图合并它四个模块的所有导出;展开顺序 = layout → props → surfaces → murals。
export const STAGES = {
  tidewater: { ...tidewaterLayout, ...tidewaterProps, ...tidewaterSurfaces, ...tidewaterMurals },
  kelpline: { ...kelplineLayout, ...kelplineProps, ...kelplineSurfaces, ...kelplineMurals },
  saltpan: { ...saltpanLayout, ...saltpanProps, ...saltpanSurfaces, ...saltpanMurals },
  crossmarket: { ...crossmarketLayout, ...crossmarketProps, ...crossmarketSurfaces, ...crossmarketMurals },
  lockgate: { ...lockgateLayout, ...lockgateProps, ...lockgateSurfaces, ...lockgateMurals },
  terraces: { ...terracesLayout, ...terracesProps, ...terracesSurfaces, ...terracesMurals },
  cargo: { ...cargoLayout, ...cargoProps, ...cargoSurfaces, ...cargoMurals },
};
// 【图 id 列表】按 STAGES 的键顺序导出,供需要遍历所有舞台的调用方使用。
export const STAGE_IDS = Object.keys(STAGES);
