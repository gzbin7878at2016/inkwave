// ============================================================================
// 【中文导读】关卡变体判定 —— “同一张图在不同模式下的构建是否不同”
// ----------------------------------------------------------------------------
// 【模块定位】世界装配层最上游的纯判定模块。由 src/main.js 的 _buildWorld() 使用:
//   它决定 worldKey(重建短路键 / 光照图文件名),并给出按模式过滤后的 layout。
//   不依赖 three、不分配任何对象,整个文件全是纯函数。
// 【核心机制】每个 layout 块(piece)或 dress 陈设项可带两个模式标签:
//     onlyIn: 'zones'  —— 只在该模式构建(例:Zone Control 才有的上岛坡道)
//     notIn:  'zones'  —— 除该模式外都构建(例:被清出场地的长椅)
//   无标签 = 所有模式共用。判定统一走 inMode()。
// 【关键约定】
//   - 'turf'(Turf War)是基准模式:没有为某模式打过标签的图,其该模式构建与 Turf
//     War 完全一致,于是沿用同一份 worldKey —— 烘焙光照图也能复用,无需重新生成。
//   - 有差异的模式才会得到自己的 worldKey '<id>.<mode>' 与独立光照图
//     assets/lightmaps/<id>.<mode>.{png,json}(见 main.js 的 _loadLightmap)。
//   - hasVariant 只考察 single / half 两块与 dressing;zones / bounds / spawns 等
//     共享字段不参与判定(它们本来就跨模式共用)。
// 【配套阅读】src/main.js(_buildWorld / _buildWorldNow)、src/world/dressing.js、
//   src/game/zones.js、docs/ARCHITECTURE.zh-CN.md
// ============================================================================
// Mode variants of a stage. A layout piece (single / half) or a dressing item may carry
//   onlyIn: 'zones'   — built only in that mode (e.g. Zone Control access ramps)
//   notIn:  'zones'   — built in every mode except that one (e.g. benches cleared out of a zone)
// Everything untagged is shared. A stage with no tagged items for a mode builds (and bakes) exactly as its Turf War
// layout; one with tagged items gets its own world + lightmap (assets/lightmaps/<id>.<mode>.{png,json}).
// 【模式判定】onlyIn / notIn 的语义只在这里实现一次;返回 true = 该项在当前 mode 应被构建。
export const inMode = (it, mode) => (!it.onlyIn || it.onlyIn === mode) && (!it.notIn || it.notIn !== mode);

// does building this stage for `mode` differ from its Turf War build?
// 【是否有变体】判断为该 mode 构建是否与 Turf War 版不同:只要 single / half / dressing
// 中任何一项的标签使 inMode(it, mode) !== inMode(it, 'turf'),就算有变体(需独立世界 +
// 光照图)。mode 为空或为 'turf' 时恒为 false —— 基准模式本身永不算变体。
export function hasVariant(layout, dressing, mode) {
  if (!mode || mode === 'turf') return false;
  const any = (list) => (list || []).some((it) => (it.onlyIn || it.notIn) && inMode(it, mode) !== inMode(it, 'turf'));
  return any(layout?.single) || any(layout?.half) || any(dressing);
}

// the layout as built in `mode` (pieces filtered; zones, bounds, spawns … shared)
// 【按模式过滤布局】返回该 mode 下的 layout:只过滤 single / half 两块,其余字段
// (zones、bounds、spawns 等)原样共享。浅拷贝 + 每块 filter,不修改传入的 layout。
export function layoutFor(layout, mode) {
  return { ...layout, single: layout.single.filter((d) => inMode(d, mode)), half: layout.half.filter((d) => inMode(d, mode)) };
}

// world / lightmap key: '<id>' for the shared build, '<id>.<mode>' for a mode variant
// 【世界键】共享构建返回 '<id>',有模式变体返回 '<id>.<mode>';这个字符串既是 main.js
// 的重建短路键,也是光照图文件名的一部分 —— 两处必须保持一致。
export const variantKey = (layoutId, layout, dressing, mode) => (hasVariant(layout, dressing, mode) ? `${layoutId}.${mode}` : layoutId);
