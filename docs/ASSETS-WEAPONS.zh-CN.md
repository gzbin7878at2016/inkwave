# 武器与道具 —— kit 自注册 + 程序化建模 + 开火全链路

> 目标读者:想知道"一把枪从代码到射出墨水要经过哪些环节"的初学者。
> 配套阅读:[ASSETS.zh-CN.md](ASSETS.zh-CN.md)(总览) · [ASSETS-AUDIO.zh-CN.md](ASSETS-AUDIO.zh-CN.md) §4(武器音效)

---

## 0. 全景图:三种"可插拔"内容

这个项目把武器系统做成**三级可插拔**,插拔成本从左到右递增:

```
┌─────────────────────────────────────────────────────────────┐
│ 主武器 kit(12 把)  ──► 完全接管:模型+行为+音效+AI,import 即注册 │
│ 副武器 kit(15 种)  ──► 半接管:核心管扣墨/投掷,kit 管效果        │
│ 大招(19 种)        ──► 配置驱动:数值在 config,行为在内置实现表    │
└─────────────────────────────────────────────────────────────┘
```

注册表只有三张纯对象([registry.js:84-86](../src/game/kits/registry.js#L84)):`MAIN_KITS` / `SUB_KITS` / `KIT_GHOSTS`(联机 ghost 用)。**契约本身写在 registry.js 顶部注释里**([registry.js:17-82](../src/game/kits/registry.js#L17)),全部 hook 可选,核心代码处处 `?.` 调用——kit 可以实现任意子集。

---

## 1. kit 自注册:为什么新增武器不用改框架

### 1.1 一把武器的"注册段"长什么样

以近战刀 [blade.js](../src/game/kits/blade.js) 为例,**模块顶层 import 副作用完成一切**([blade.js:58-61](../src/game/kits/blade.js#L58)):

```js
registerWeaponModel('blade', buildBlade, animateBlade);  // ① 模型挂进角色武器系统
WEAPON_ICONS.blade = BLADE_ICON;                          // ② HUD 图标
installBladeSounds();                                     // ③ 音效(见音频篇 §4)
MELEE.blade = true;                                        // ④ Bot 标记
MAIN_KITS.blade = { update, tick, clear, bot, ghost, … }; // ⑤ 行为本体
```

### 1.2 一键装载

[main.js:38](../src/main.js#L38) 只有一行 `import './game/kits/index.js'`,而 [kits/index.js](../src/game/kits/index.js) 是**纯 import 列表**:

```js
import './brolly.js';   // 伞枪
import './bow.js';      // 弓
import './blade.js';    // 近战刀
// …共 10 行
```

**新增一把武器 = 写一个 kit 文件 + 在 index.js 加一行 import。** 核心系统(WeaponRunner、弹道、Bot、UI)全部通过 registry 按 kind 查找,零改动。这就是 [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md) 说的"模块自注册"决策在武器上的落地。

> 💡 武器数值(伤害/射速/耗墨)仍在共享配置表 `WEAPONS.blade`([config.js:247](../src/config.js#L247));kind 字符串就是 config 表与 registry 表之间的"接头"。

---

## 2. 武器建模:代码"捏"出来的四把武器工具

[blade-model.js](../src/game/kits/blade-model.js) 全文无外部资源,用的是四种程序化建模手法:

| 手法 | 做什么 | blade 里的例子 |
|---|---|---|
| **放样 loft** | 沿一条路径摆截面环,连成体 | 刀刃:44 个截面环([blade-model.js:72-104](../src/game/kits/blade-model.js#L72)),刃宽/脊厚由参数曲线 `halfW(u)/spineT(u)` 控制 |
| **车削 lathe** | 二维轮廓绕轴旋转,得回转体 | 刀柄/护碗/环箍([blade-model.js:162-172](../src/game/kits/blade-model.js#L162)) |
| **超椭圆体** | 椭球按指数捏方捏圆,回调逐顶点改 | 乌贼头柄首、碟形护碗([blade-model.js:161,148-151](../src/game/kits/blade-model.js#L161)) |
| **扫掠 sweep** | 截面沿曲线走 | 指节弓、背钩([blade-model.js:184-191](../src/game/kits/blade-model.js#L184)) |

共享"积木盒"`GEO_KIT`([character-weapons.js:2142-2145](../src/game/character-weapons.js#L2142))导出 Parts/C/latheZ/torus/screw 等,kits 与内置武器用同一套。

**材质也能自定义**:blade 用 `onBeforeCompile` 注入自写 GLSL,刃口按顶点属性 `aSeg` 做充能发光([blade-model.js:227-249](../src/game/kits/blade-model.js#L227))——又是"切开变速箱焊齿轮"那一招(见 [RENDERING-UE4.zh-CN.md](RENDERING-UE4.zh-CN.md) §3.3)。

---

## 3. 武器怎么"长"到手上:握把孔对位

这是整套系统里最精巧的契约。**静置姿态 = 握力抓握**——手模天生握着一根 Ø2.8cm 的虚拟握柄(详见 [RIG.zh-CN.md](RIG.zh-CN.md) 手指一节),武器只需对准它:

```
武器空间约定(每个 kit 遵守):              手部约定(character-geo.js:92):
原点 = 握把中心,+Z 沿刃                      HAND.hole = 左手骨骼系里的"握轴点"
                                          右手 = X 镜像 → GRIP_HOLE_R/L
                                                    【character-weapons.js:213-214】

武器 def 声明:  gripR = { pos, handZ, handY }
     │ handInWeapon() 正交化建基 → 求"手骨在武器空间中的位姿"  【character-weapons.js:1420-1428】
     ▼
getWeaponDef() 取逆 → d.inHand(武器挂到手骨的局部变换)        【character-weapons.js:2116-2125】
     ▼
运行时:武器 pivot 直接 add 到手骨                            【character.js:1332】
       this.bones.handR.add(w.pivot)
```

好处:**不做动画的手就正确持握每件武器**;空手时同一姿态呈现放松微曲。换武器只是换 pivot 下的子树。

---

## 4. 开火全链路:从鼠标到涂地

以射击类/近战类统一骨架描述(锚点见每步):

```
① 输入    mousedown → input.mouse.left                    【input.js:99-103】
② 意图    player.js 打包 it.fire(开火意图)                 【player.js:173】
③ 决策    actor 算 firePressed,打包 winp;
          大招接管时跳过武器                               【actor.js:405-408】
④ 分派    WeaponRunner.update 按 kind switch;
          未知 kind → MAIN_KITS[kind].update(进 kit)      【weapons.js:157-168】
⑤ 行为    kit 内部:点按/蓄力/释放 → spawn 弹道(对象池取)  【blade.js:114-228】
          _push 同时上报联机 nm.recProj(p)                 【weapons.js:967-972】
⑥ 推进    Projectiles.update:_step 逐弹
          线段-胶囊命中 → 副武器/大招拦截 → 世界碰撞        【weapons.js:1741-1817】
⑦ 结算    applyHit 伤害(联机按 owner 端路由)              【weapons.js:1720-1735】
⑧ 涂地    _impact → G.paint.splat(pos, rad, team)
          面积经 _credit 计入 addTurf(计分)                【weapons.js:1864-1884】
```

**近战刀是特例**:刀本体不用弹道,`melee()` 做扇形扫描 + 视线检查([blade.js:254-297](../src/game/kits/blade.js#L254));墨波是 kit 自有的世界对象(`WAVES` 数组 + `stepWave`),沿途涂墨([blade.js:370-441](../src/game/kits/blade.js#L370))。

---

## 5. 道具系统 PropKit:加载条里那件"沉默期"的活

BOOT 文档第 6 节说过"道具先行"——这里展开 [props.js](../src/world/props.js)(3300+ 行)的三步架构:

### 5.1 三步生命周期

```
export class PropKit {           【props.js:3345】共享 Canvas 图集 + 按粗糙度分 9 种共享材质
        │
        ▼
add(type, opts)                  【props.js:3416】查类型表 D[type] →
        │                        Builder 原语(B.cyl/box/sph/lathe/col/spin)只攒几何,不建 Mesh
        │                        → 返回 { colliders }(局部碰撞盒)
        ▼
build()                          【props.js:3469】按"材质桶" mergeParts 合并,
                                 每桶一个 Mesh(一材质 = 一 DrawCall);
                                 旋转件/闪烁灯/旗帜各走一个 InstancedMesh
```

**碰撞盒回流**是顺序设计的核心:[main.js:313-321](../src/main.js#L313) 先收集所有 colliders,再 `new Level(layout, colliders)`——物理/导航/涂墨共用同一份关卡定义。

### 5.2 类型表:声明式数据即内容

```js
const D = {};                          // 类型注册表 【props.js:1375】
D.railing = { desc, params, variants,  // 自文档式声明
  build(B, o) { B.col(..., { rail:true }) }  // 几何与碰撞同时产出
};
```

marina 系列(渡轮/船坞…)是**外挂包**:`registerMarinaVessels(D, H)` 注入 30+ 类型([props-marina-vessels.js:35](../src/world/props-marina-vessels.js#L35)),**注册带失败回滚**——坏包只丢自己的类型,不拖累系统([props.js:3337-3341](../src/world/props.js#L3337))。

### 5.3 摆放:一张表 + 镜像展开

[dressing.js](../src/world/dressing.js) 是纯数据:`DRESSING[stageId] = [{type, pos, rotY, …}]`,作者只摆半场,`dressingFor()` 旋转 180° **镜像出另一半**([dressing.js:156-166](../src/world/dressing.js#L156))——地图天然对称,工作量减半。

---

## 6. 工程亮点速览

| 亮点 | 说明 | 锚点 |
|---|---|---|
| 热路径零分配 | 弹道对象池 pop/push + swap-pop O(1) 摘除;全场景墨滴**一个 InstancedMesh** | [weapons.js:874-962,784-796](../src/game/weapons.js#L874) |
| DrawCall 控制 | 道具按材质合并;旋转/闪烁/旗帜各一 InstancedMesh | [props.js:3474-3516](../src/world/props.js#L3474) |
| 优雅降级链 | 未知武器 kind 回落默认枪;未知道具类型空 colliders;props 整体 try/catch | [character-weapons.js:2118](../src/game/character-weapons.js#L2118)、[main.js:311-319](../src/main.js#L311) |
| 联机 ghost 协议 | 短数组记录 + `netRec/netId/netHurt`;`ghostMute()` 防止回放时重复涂墨 | [registry.js:90-112](../src/game/kits/registry.js#L90) |
| Bot 也是 kit 的 | blade 带 380 行专属战术 AI(`bot:` hook),行为随武器走 | [blade.js:458-699](../src/game/kits/blade.js#L458) |
| 教学彩蛋 | 同一文件里看完:模型(怎么捏)+ 挂手(怎么对齐)+ 行为(怎么打)+ AI(怎么耍) | [kits/blade*.js](../src/game/kits/blade.js) |

---

## 7. 新手总结

1. **registry + import 副作用 = 插即插即用**:注册发生在模块求值时,框架永远只查表。
2. **契约全是可选 hook**:核心 `?.` 调用,kit 给什么用什么——这是"允许不同作者协作"的工程基础。
3. **建模四手法**(放样/车削/超椭圆/扫掠)覆盖 90% 程序化硬表面造型。
4. **握把孔对位**让"手不用动画就能握对所有武器"——好的契约省掉一整类工作。
5. **对象池 + InstancedMesh + 材质合并**三件套,是 DrawCall 和 GC 的双重保险。
