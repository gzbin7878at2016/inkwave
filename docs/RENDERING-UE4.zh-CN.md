# INKWAVE 渲染系统 vs UE4 渲染系统 —— 新手向深度对比

> 目标读者:**听说过 UE4、但没读过大型引擎源码**的初学者。本文不假设你懂图形学,所有术语第一次出现时都会解释。
> 阅读建议:先读第 1、2 章建立概念,第 3 章是逐项对比的"主菜",第 4 章讲这个项目最独特的墨水系统,第 5 章给出学习路线。
> 配套阅读:[ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md)(整体架构)、[INK.zh-CN.md](INK.zh-CN.md)(墨水系统新手图解)。

---

## 1. 一句话对比

| | INKWAVE(本项目) | UE4 |
|---|---|---|
| 本质 | 一个 **JavaScript 库(three.js)+ 大约 2000 行手写渲染胶水代码** | 一个 **完整游戏引擎**(编辑器 + 资产管线 + 渲染器 + 物理 + UI + 网络,数千万行 C++) |
| 渲染器 | 浏览器里的 **WebGL2**(Windows 上通常经 ANGLE 翻译到 D3D11) | 自家 **RHI** 抽象层,可切换 D3D11 / D3D12 / Vulkan / Metal |
| 渲染路径 | **前向渲染**(Forward) | 桌面端默认 **延迟渲染**(Deferred) |
| 材质系统 | 改源码:把 three.js 的着色器字符串**切开、注入自己的 GLSL** | 材质编辑器:节点图自动生成 HLSL |
| 资产 | **全部程序化生成**,零外部文件 | 导入 FBX/贴图/音频,序列化为 `.uasset` |
| 构建 | **零构建**,浏览器直接跑 ES Modules | 编辑器 + Cooking(烘焙)管线 |

一个比喻:**UE4 是一家整车厂**——你拿到的是一辆完整的汽车,可以通过仪表盘(编辑器)调参数,也能打开引擎盖换零件,但车架是焊死的;**INKWAVE 是自己用发动机(three.js)攒的一辆卡丁车**——没有仪表盘,一切都暴露在代码里,但每颗螺丝你都能看见、能拧。

> ⚠️ 本文以 **UE4(4.26/4.27 时代)** 为参照物,而不是 UE5。UE5 的 Nanite(虚拟几何体)和 Lumen(动态全局光照)是另一套故事,UE4 的核心设计(延迟渲染、材质节点图、RHI)至今仍是理解所有商业引擎的最佳入口。

---

## 2. 先建立四个共同概念(新手必看)

在对比之前,必须先有四个概念。它们在两边都存在,只是"谁来做、怎么做"不同。

### 2.1 渲染管线(Rendering Pipeline)—— 一帧画面是怎么出生的

游戏画面不是一张图,而是**每秒 60 次**把 3D 场景"重新拍一张照片"。每一帧,GPU 都要经历大致相同的流水线:

```
CPU 侧(游戏代码)                GPU 侧(显卡)
─────────────────────────────────────────────────────
决定哪些物体可见        ──►   顶点着色器:把 3D 坐标投影到屏幕
准备每个物体的参数            光栅化:三角形 → 像素
发出绘制命令(DrawCall) ──►   片元着色器:算出每个像素的颜色
                              后处理:泛光、调色、抗锯齿
                              输出到屏幕
```

**关键认知:CPU 和 GPU 是两台"用绳子传话"的电脑。** CPU 说一句"画这个方块",GPU 就画一个;说一万句,就画一万个。这条"绳子"的带宽有限,所以**DrawCall 数量是性能的头号杀手**——这就是为什么引擎要拼命合并物体(后面会反复提到)。

### 2.2 前向渲染 vs 延迟渲染 —— 两种"开灯"的策略

场景里有一百个物体、十个灯。两种策略:

**前向渲染(Forward):每画一个物体,就把所有灯都算一遍。**
> 比喻:服务员每上一道菜,就让十个人轮流尝一口。菜多灯多,桌上乱成一团。
> three.js / INKWAVE 用的是这种。所以它**只敢用一个真正的太阳灯** + 大量"假的灯"(后面详述)。

**延迟渲染(Deferred):先把所有物体的材质信息存进一堆"缓冲区"(合称 GBuffer),再统一对所有灯计算光照。**
> 比喻:先给全桌菜拍一张高清"身份证照片"(每个像素:颜色、法线、粗糙度、深度),之后每来一个灯,只需要在这张照片上"盖章",不用打扰厨房。
> UE4 桌面端默认用这种,所以它能轻松支撑场景里有几十上百个动态灯。

代价:GBuffer 占显存大、不支持透明物体(透明物体要走单独的前向pass)、抗锯齿更难做(UE4 因此默认 TAA)。这就是为什么 INKWAVE 作为浏览器游戏**明智地选了前向**。

### 2.3 着色器(Shader)—— 跑在显卡上的小程序

着色器是用 GPU 语言(GLSL/HLSL)写的小程序,在流水线的固定位置被调用。**材质 = 一堆参数 + 一套着色器代码**。两边的语言几乎一样(three.js 的 GLSL 和 UE4 的 HLSL 在数学上同源),真正的区别在于:**这些代码从哪来**。

- UE4:你在**材质编辑器**里连连线,引擎**自动生成** HLSL。
- INKWAVE:没有编辑器,作者直接**手写 GLSL 字符串**,还要用 JavaScript 把 three.js 自带的代码**切开一个口子**塞进去(详见 3.3 节,这是本项目最有教学价值的地方)。

### 2.4 资产(Asset)—— 美术成果怎么进游戏

| | INKWAVE | UE4 |
|---|---|---|
| 模型 | **代码捏出来**:`character-geo.js` 用数学公式生成角色网格;关卡是参数化布局 | 美术在 Blender/Maya 里做,导入成 `.uasset` |
| 贴图 | **Canvas 画出来**:`texlib.js` 在运行时往 2D 画布上画混凝土、防滑槽、锈痕,再上传为 GPU 纹理 | 美术导出 PNG/TGA,导入后经 Mipmap 链、压缩(BCn)处理 |
| 音乐/音频 | 程序化合成 | 导入 wav/ogg |

> 这不是"UE4 更高级",而是**目标不同**:程序化资产让 INKWAVE 的墨水物理(需要在材质里逐滴追踪)成为可能——外部美术资产无法表达"这块墨有多湿"。见 [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md) 第 3 节的架构决策。

---

## 3. 逐项对比 —— 主菜

### 3.1 引擎层:库 vs 整车厂

| 维度 | INKWAVE | UE4 |
|---|---|---|
| 你拿到的 | 一个 npm 包(three.js)+ 源码 | 编辑器程序 + 源码(C++/蓝图) |
| 启动一个渲染器 | `new THREE.WebGLRenderer(...)` 一行([renderer.js:116](../src/core/renderer.js#L116)) | 创建 GameInstance → World → 一整套对象生命周期 |
| 场景组织 | `THREE.Scene` 一个树状结构,手动 add/remove | Actor/Component 体系 + 关卡序列化 |
| 跨平台 | 浏览器(Chrome/Firefox/Safari/Electron 壳) | Win/Mac/Linux/主机,经 RHI 切换图形 API |

**新手要理解的核心差异:UE4 里"渲染器"不是一个对象,而是一套体系。** 你在 UE4 里几乎找不到一个文件写着"渲染主循环"——它被拆散在 `Renderer.cpp`、`SceneRendering.cpp`、RHI 命令列表等成百上千个文件里,靠命令队列异步执行。而 INKWAVE 的渲染主循环你可以一下午读完,这就是"库"和"引擎"最大的教学差别。

### 3.2 图形 API 之路:浏览器 vs RHI

**UE4 的做法 —— RHI(Rendering Hardware Interface)抽象层:**

```
游戏代码 → RHI 命令列表(D3D11/12、Vulkan、Metal 统一的"普通话")
         → 各平台 RHI 后端 → 显卡驱动 → GPU
```

UE4 的游戏代码**从不直接碰 DirectX**。它把"画一个三角形"翻译成一条 RHI 命令,塞进队列,由专门的渲染线程异步发给当前平台的后端。这是 UE4 能一个工程同时出 PS5/Xbox/PC/手机版的根基。

**INKWAVE 的做法 —— 浏览器就是你的"RHI":**

```
游戏代码 → WebGL2 调用 → 浏览器(ANGLE)→ D3D11 → 显卡驱动 → GPU
```

Windows 上的 Chrome/Edge 用 **ANGLE** 把 WebGL 翻译成 Direct3D 11。也就是说,INKWAVE 作者**没有写一行平台相关代码,却免费获得了 RHI 级别的跨平台能力**——这是 Web 平台最被低估的优势。

代价是控制力:UE4 可以为 PS5 手写专用路径;INKWAVE 只能祈祷浏览器不抽风。一个真实案例就在本项目里([renderer.js:18](../src/core/renderer.js#L18)):

> Apple 芯片(M 系列)的 ANGLE/Metal 后端上,**半浮点多重采样渲染目标慢到离谱**(1920×1200 约 30ms/帧)。于是代码在运行时检测 `isAppleGPU()`,在苹果机器上改用单采样 + SMAA 后处理抗锯齿 + 半分辨率 GTAO。

在 UE4 里这类平台差异会写在 RHI 后端内部,应用层无感;在 INKWAVE 里,**平台差异是你自己要处理的应用逻辑**——坑更浅,但更暴露。

### 3.3 材质系统:节点图自动生成 vs 切开源码注入

这是两边**哲学差异最大**的一节,也是 INKWAVE 技术含量最高的部分。

#### UE4:材质编辑器 —— 你连线,它写代码

```
你在编辑器里连线:[Texture] → [Lerp] → [BaseColor 引脚]
                        ↓ 保存时
引擎自动生成 HLSL 函数(基于 MaterialTemplate.ush 模板)
                        ↓
按"着色器排列组合"(Shader Permutation)编译出几十上百个变体
                        ↓
存进 Derived Data Cache(DDC)
```

你**永远看不到、也改不了**生成的 HLSL(除非改引擎)。想自定义光照模型?UE4 预留了"着色模型"(Shading Model)枚举:Lambert、GGX、皮肤、头发……想加第 12 种?**得改引擎 C++ 源码**,重新编译整个引擎。

#### INKWAVE:onBeforeCompile —— 把厂商的变速箱拆开焊齿轮

three.js 的材质本质上是**一大段拼好的 GLSL 源码字符串**,其中留了许多锚点:

```glsl
// three.js MeshPhysicalMaterial 的片元着色器(示意,真实代码约 1500 行)
#include <clipping_planes_fragment>
#include <map_fragment>          // ← 锚点!算 BaseColor 的地方
#include <roughnessmap_fragment> // ← 锚点!算粗糙度的地方
...
#include <lights_physical_fragment> // ← 锚点!算光照的地方
```

INKWAVE 在创建材质时劫持编译流程([levelMaterial.js](../src/world/levelMaterial.js) 的 `onBeforeCompile`):

```js
shader.fragmentShader = shader.fragmentShader
  .replace('#include <map_fragment>', 我的墨水颜色代码 + '\n#include <map_fragment>')
  .replace('#include <roughnessmap_fragment>', 我的湿度粗糙度代码 + ...);
// 一共挂了 20+ 个锚点
```

**比喻**:UE4 是买了一台原厂变速箱,只能在面板上调;INKWAVE 是把变速箱拆开,在厂家预留的接缝处焊上自己加工的齿轮。

**配套的坑**:three.js 有程序缓存(编译过的材质复用)。注入的 GLSL 变了,缓存的 key 必须变,否则改了代码画面不变。所以 [levelMaterial.js](../src/world/levelMaterial.js) 里有这么一行:

```js
customProgramCacheKey() { return 'inkwave-level-v6' + (this.userData.grate ? '-grate' : ''); }
// ⚠️ 每次改动注入的 GLSL,都必须把 v6  bump 成 v7!这是新手最容易踩的静默错误。
```

UE4 靠 DDC + 资产指纹自动处理这类缓存失效;INKWAVE 里这是**手工纪律**。

#### 小结表

| | UE4 材质 | INKWAVE 材质 |
|---|---|---|
| 写代码方式 | 节点图(可视化) | 手写 GLSL 字符串 |
| 能看到生成代码吗 | 不能 | 不但能,还必须读([inkShading.js](../src/world/inkShading.js) 就是一份精读教材) |
| 自定义光照模型 | 改引擎 C++ | 替换 `#include <lights_physical_fragment>` 锚点 |
| 着色器变体 | 自动爆炸式增长(排列组合) | 几乎没有,一个材质一个程序 |
| 改错的表现 | 编译报错(编辑器里) | 画面静默不对 + **必须手动 bump cache key** |
| 学习价值 | 低(黑盒) | 极高(每行都看得见) |

### 3.4 光照系统:一个真灯 + 一堆假灯 vs 灯海

**INKWAVE 的照明预算**(前向渲染的精打细算):

| 光源 | 实现方式 | 位置 |
|---|---|---|
| 太阳(唯一真灯) | three.js 平行光 + PCF 阴影贴图 | [main.js](../src/main.js) |
| 街灯 ×12 | **不是灯!** 是材质片元着色器里手算的伪点光源,逐像素判距离 | [levelMaterial.js](../src/world/levelMaterial.js) `LAMP_LIGHTS` |
| 环境光 | 烘焙 AO 贴图 × 强度分级(间接 100% / 镜面 85% / 直射 40%) | `assets/lightmaps/`(`bake-ao.cjs` 离屏烘焙) |
| 湿墨反光 | 把墨的湿度塞进 roughness/clearcoat 参数 | [inkShading.js](../src/world/inkShading.js) |

街灯这段最值得玩味:前向渲染里真正的点光源每多一个,每个像素都要多算一次。作者干脆在片元着色器里写了个循环——"如果这个像素离灯杆 R 米以内,就手动加一段光",并复用 three.js 的光照计算函数(`RE_Direct`)。**灯的数量成了材质参数而不是场景对象,不花 DrawCall。** 这是"预算受限时把问题转移到别处"的教科书案例。

**UE4 的对策**:延迟渲染下动态灯很便宜(只在一个屏幕空间 pass 里逐灯"盖章"),场景摆一百个射灯都从容。UE4 真正的重活在别处:

- **Lightmass**:离线烘焙全局光照(光在墙面间的多次反弹),产出 Lightmap——对应 INKWAVE 的 AO 烘焙,但信息量大得多;
- **反射捕获(Reflection Capture)**:在场景各处放"相机"拍立方体贴图,供镜面反射采样——INKWAVE 没有对应物(湿墨反射直接采环境贴图近似);
- **级联阴影贴图(CSM)**:大场景阴影的标配,把视野切成近/中/远几段各用一张高精度阴影图;INKWAVE 场景小,单张阴影图 + 一次手工优化就够([renderer.js:90](../src/core/renderer.js#L90) 把 three.js r186 默认的旋转 Vogel 盘 5-tap PCF 换成了 3×3 双线性 tap,消除阴影边缘的颗粒抖动)。

### 3.5 后处理链:Volume 配置 vs 手工搭流水线

**INKWAVE 的后处理是一行注释就讲完的架构**([renderer.js:17](../src/core/renderer.js#L17)):

```
MSAA HDR 半浮点目标 → (可选)GTAO 环境光遮蔽 → UnrealBloom 泛光
→ 自定义 Grade(调色/暗角/受击闪红)→ OutputPass(色调映射 + sRGB)
```

- **HDR 管线**:中间帧缓冲用 `HalfFloatType`(半浮点),允许像素亮度超过 1.0,泛光只提取高亮部分——和 UE4 的 HDR 管线思想一致,只是 UE4 是全引擎强制,这里是手动选择。
- **GTAO**:屏幕空间环境光遮蔽(SSAO 的改进版),从深度图推算缝隙变暗。[renderer.js:179-180](../src/core/renderer.js#L179) 调参(radius 1.1m、12 采样、PD 降噪),苹果芯片上半分辨率跑。
- **Grade shader**([renderer.js:37](../src/core/renderer.js#L37)):饱和度/vibrance、对数空间对比度、冷阴影暖高光分离色调、暗角、低血量去饱和。**这段 60 行 GLSL 就是 UE4 里 PostProcess Volume 一整个面板的手写等价物。**

**UE4 的对照**:后处理链用 C++ 结构体数组声明,每个 pass 声明自己的输入输出,引擎自动连线;调参在 PostProcess Volume 里做,还能按体积混合(走进洞穴自动换一套调色)。INKWAVE 想要"区域化调色"得自己写逻辑改 uniform——更笨,但每一行因果都清楚。

### 3.6 抗锯齿与平台分支

| | INKWAVE | UE4 |
|---|---|---|
| 默认方案 | **MSAA**(渲染目标 4x/8x 采样,写入 HDR 目标时) | **TAA**(时域抗锯齿:把连续几帧抖动混合) |
| 备用方案 | 苹果芯片上退化为 **SMAA**(后处理边缘平滑) | MSAA(仅前向渲染)、FXAA |
| 原理差异 | 空间:一次画多个子像素样本 | 时间:历史帧 + 运动向量重建 |

TAA 需要"运动向量缓冲"(记录每个像素上一帧在哪),这是延迟渲染 GBuffer 的副产品——前向渲染里没有现成数据,代价高。所以 INKWAVE 干脆用 MSAA,**但这个选择在苹果芯片上踩了硬件坑**(见 3.2 节),又退回 SMAA。

这条小链路浓缩了真实渲染工程的日常:**理论选择 → 平台实测 → 条件分支兜底**。UE4 把这些藏进 RHI 和可扩展设置,INKWAVE 把它写在明处。

### 3.7 着色器编译:预热管线 vs 运行时拼字符串

**UE4**:材质保存 → 生成 HLSL → 按排列组合编译(基础 pass、阴影 pass、深度 pass × 各质量级 × 各平台)→ ShaderCompileWorker 多进程并行编译 → 存 DDC。运行时还有 **PSO(管线状态对象)预收集**,避免游戏过程中突然卡顿编译。**着色器编译卡顿在 UE4 里是工程级问题**,有专门的预热流程。

**INKWAVE**([renderer.js:118-120](../src/core/renderer.js#L118)):

```js
// 着色器状态检查会让每次编译都变成同步等待(CPU 干等 GPU 进程返回链接结果):
// 游戏中途编译一次,输入、网络代码全部卡住。
r.debug.checkShaderErrors = 只有带 ?shadercheck 参数时才开启;
```

含义:three.js 默认每次编译着色器都同步验证错误(对开发者友好)。INKWAVE 把它默认关掉,因为 WebGL 的编译发生在**游戏运行时的任意时刻**(第一次看见某种材质时),一次同步等待 = 全场卡顿。代价是:着色器写错了,玩家不会看到报错,只会看到**东西不见了**(材质静默回退)。

两边面对的是同一个问题(**编译不能发生在关键时刻**),解法不同:UE4 用"提前全部编译好 + 缓存 + 预收集",INKWAVE 用"赌编译发生在加载期 + 关掉同步检查"。Web 游戏的约束(代码即资产、无法预编译)决定了它只能赌。

### 3.8 性能预算与 DrawCall 治理

两边都在打同一场仗:**DrawCall 太多,CPU 喂不过来。**

- **UE4 的武器**:静态网格自动实例化、HISM(分层实例静态网格)、动态合批、网格合并工具,以及延迟渲染把"灯"变成纯计算问题。
- **INKWAVE 的武器**:
  - 整关**一个材质**(levelMaterial)——所有地形面共享一次着色器程序,省掉程序切换;
  - 墨水图集:全场景所有可涂画面共享**一张大纹理**,墨水滴画在图集上而不是画在世界里(见第 4 章)——这意味着加一万滴墨也**不产生新 DrawCall**,只是给同一张纹理画像素;
  - 程序化生成时对三角形数量的天然控制(没有美术拖进来的百万面模型)。

---

## 4. 杀手锏对比:墨水系统在 UE4 里能复刻吗?

这是理解两边差距最好的思考题。INKWAVE 的墨水([INK.zh-CN.md](INK.zh-CN.md))有四个硬需求:

1. **纹理空间绘制**:墨水滴不是喷在 3D 表面上,而是喷在"每个可涂画面自己的 2D 小坐标系"里,再烘焙进一张全场景共享的 RGBA 图集。这允许墨水**绕过墙角连续流淌**——这是 INKWAVE 视觉的灵魂。
2. **每滴墨带湿度**:图集 G 通道存湿度,GPU 上有一个专门的"衰减 pass"(反向减法混合,每帧往 G 通道减一点)让墨在约 6 秒内从亮泽变哑。
3. **墨面高度场**:材质着色时用三次 B 样条从图集重建出连续的"墨面隆起",配合湿边光环、微表面噪声、24 波纹涟漪包。
4. **CPU 判定镜像**:玩法层需要 0.25m 粗网格回答"这里是不是我的墨"(能不能游泳、计分多少),与 GPU 视觉严格一致。

**在 UE4 里复刻,每一步都更贵:**

| 需求 | INKWAVE 的做法 | UE4 里的等价物与代价 |
|---|---|---|
| 纹理空间绘制 | 直接往渲染目标画四边形,自写代码 ~几百行 | Blueprint 的 Canvas Render Target 可以画,但面空间映射、图集管理、滴落时间序全要自己搭;走 C++ 则要写自定义 SceneViewExtension |
| 湿度衰减 pass | 一个全屏四边形 + ReverseSubtract 混合,**5 行 GLSL** | 需要自定义后期 pass 或材质节点 hack;混合模式在材质编辑器里表达受限 |
| 墨面着色 | `onBeforeCompile` 替换 9 个锚点([inkShading.js](../src/world/inkShading.js)) | 材质编辑器**没有"自定义着色模型"的自由**;要么挤进 Subsurface/Clearcoat 参数做近似,要么改引擎加 Shading Model(改引擎 = 维护成本飙升) |
| CPU/GPU 一致 | 同一 JS 模块里天然共享参数 | 需要独立 C++ 子系统 + 反射到蓝图 + 网络序列化,工程量大一个数量级 |

**结论不是"UE4 做不到"**,而是:**INKWAVE 用 2000 行源码就拥有了"改引擎"级别的自由度**——因为 three.js 本身就是可读的源码;而在 UE4 里,同样的自由度要拿 C++ 引擎魔改来换,成本是前者的一到两个数量级。反过来,UE4 白送给你的东西(编辑器、材质系统、Lightmass、几百种调试工具)INKWAVE 全都没有,要靠手写补。

这正是这个项目作为**学习材料**的价值:它是一个"把商业引擎藏起来的每个环节手工补出来"的完整样本。

---

## 5. 给新手的对照学习路线

如果你想从 INKWAVE 出发去理解 UE4(或反之),推荐按这个顺序:

| 步骤 | 在 INKWAVE 里读 | 对应 UE4 概念 | 你会建立的心智模型 |
|---|---|---|---|
| 1 | [renderer.js](../src/core/renderer.js) 全文(200 行) | RHI、渲染线程、后处理链、HDR 管线 | "一帧的旅程" |
| 2 | [levelMaterial.js](../src/world/levelMaterial.js) 的 `onBeforeCompile` | 材质编辑器、着色器编译与缓存 | "材质 = 参数 + 着色器代码",以及引擎为什么要节点图 |
| 3 | [inkShading.js](../src/world/inkShading.js) 的 9 个 GLSL chunk | Shading Model、PBR 光照方程 | "自定义光照模型"的真实工作量 |
| 4 | [INK.zh-CN.md](INK.zh-CN.md) + [paint.js](../src/world/paint.js) | RenderTarget、GBuffer、GPU 粒子 | "数据在 CPU/GPU/纹理之间的流动" |
| 5 | 回头看 UE4 的 `DeferredShadingRenderer.cpp` | —— | 你会突然发现:那 3000 行 C++ 里的每一个概念,你都在一个 200 行的文件里亲手见过简化版 |

**最重要的一个认知**:INKWAVE 的渲染代码总量 ≈ UE4 渲染模块的千分之一,但它覆盖了 UE4 渲染器 80% 的核心概念(管线、材质、光照、阴影、后处理、抗锯齿、平台差异)。**先在小池塘里看清每条鱼,再去看大海**——这比直接跳进 UE4 源码高效得多。

---

## 6. 总结:一张总表

| 维度 | INKWAVE | UE4 | 本质差异 |
|---|---|---|---|
| 形态 | 库 + 胶水代码 | 完整引擎 | 可见性 vs 完备性 |
| 渲染路径 | 前向 | 延迟(桌面) | 灯便宜 vs 材质信息复用 |
| 图形 API | WebGL2(浏览器/ANGLE 代劳) | RHI 直连 D3D/Vulkan/Metal | 零成本跨平台 vs 完全控制 |
| 材质 | 字符串替换注入 GLSL | 节点图生成 HLSL | 手工焊齿轮 vs 原厂变速箱 |
| 着色模型 | 随便改(改字符串) | 枚举式,新增要改引擎 | 自由度 vs 稳定性 |
| 灯 | 1 真灯 + 片元伪灯 + 烘焙 AO | 动态灯海 + Lightmass + 反射捕获 | 预算工程 vs 通用解 |
| 抗锯齿 | MSAA / SMAA 按平台切换 | TAA + 运动向量 | 空间 vs 时间,及平台坑 |
| 编译策略 | 运行时拼串 + 关同步检查 | 离线排列组合 + DDC + PSO 预热 | 赌加载期 vs 工程化预热 |
| 资产 | 全程序化 | DCC 导入 + Cooking | 定制渲染的前提 vs 内容生产流水线 |
| 墨水系统 | 核心创新,~2000 行 | 需引擎魔改才能等价 | **本项目存在的理由** |
