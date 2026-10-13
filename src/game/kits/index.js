// ============================================================================
// 【中文导读】武器 kit 的"总进口"——把每个 kit 模块 import 进来一次,让它们各自的
//   模块顶层副作用完成自注册。
// 【模块定位】装配层最薄的一环:main.js 只 `import './game/kits/index.js'` 一行,便触发
//   下面这一串 import;每个模块在**求值时**就往 registry 的三张表(MAIN_KITS / SUB_KITS /
//   KIT_GHOSTS)里塞自己,并顺带注册模型、图标与音效。
// 【核心机制】"自注册 / import 副作用":kit 模块顶层直接写 MAIN_KITS[kind] = {...}、
//   registerWeaponModel(...)、SFX.xxx = {...} 等,框架其余部分只按 kind 查表。这就是
//   docs/ASSETS-WEAPONS.zh-CN.md 说的"新增武器 = 写 kit 文件 + 这里加一行 import"。
// 【关键约定】import 顺序 = 求值顺序;kit 之间不应有加载期依赖(只通过 registry 表互相可见)。
//   kind 字符串是 config.js 的 WEAPONS/SUBS 表与 registry 表之间的"接头"。
// 【配套阅读】docs/ASSETS-WEAPONS.zh-CN.md §1;同目录 registry.js(契约 + 三张表)。
// ============================================================================
// Imports every kit module so it registers itself (see registry.js). Imported once from main.js.
import './brolly.js';      // Canopy Brolly 伞枪(主武器)
import './bow.js';         // Tideline Bow 潮汐弓(主武器)
import './blade.js';       // Brine Cutlass 盐水弯刀(主武器,近战)
import './mitts.js';       // Sponge Mitts 海绵拳套(主武器,近战)
import './shaker.js';      // Shaker Bomb 摇摇炸弹(副武器)
import './waddle.js';      // Waddle Bomb 摇摆炸弹(副武器,追踪)
import './torpedo.js';     // Tide Torpedo 潮汐鱼雷(副武器)
import './tracer.js';      // Tracer Bolt 曳光弩箭(副武器)
import './boomerang.js';   // Whirl Boomerang 回旋镖(副武器)
