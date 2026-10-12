# 角色模型 —— 用代码"捏"出的鱿鱼小子

> 目标读者:好奇"没有模型文件,角色从哪来"的初学者。本文讲**生成管线**:风格参数 → 几何 → 材质 → 骨骼装配,以及运行时怎么被创建。
> 骨骼的**逐帧动画驱动**(更反直觉的部分)在姊妹篇 [ASSETS-RIG.zh-CN.md](ASSETS-RIG.zh-CN.md);骨骼契约表见 [RIG.zh-CN.md](RIG.zh-CN.md)。
> 配套阅读:[ASSETS.zh-CN.md](ASSETS.zh-CN.md)(总览)

---

## 0. 先看成果:一个角色是什么

```
一个"鱿鱼小子" =
  风格六元组 {hair, skin, outfit, eyes, hat, brows}     ← 纯数据,存档只存索引
  + 程序化几何(头/身/衣/发/眼,零模型文件)
  + 程序化材质(零贴图!连 T 恤图案都是 shader 画的)
  + ≈87 根骨骼的 SkinnedMesh(25 身体 + 24 头发 + 38 附加)
  + 每帧被代码驱动的姿态系统(见 RIG 篇)
```

---

## 1. 生成管线总览

```
① 风格解析    resolveStyle(style, seed)      character-style.js:86
     │  缺省字段从名字种子推导(同名字 ⇒ 永远同一个长相)
     ▼
② 材质工厂    按风格建 9 种材质               character.js:546-558
     │  (skin/cloth/hair/dark/eye/fill/squid/squidGhost/glow)
     ▼
③ 几何构建    共享缓存 getKidShared(lod)      character-geo.js:1711
     │  皮肤/衣服/眼睛/墨罐按 lod|bodyLevel 缓存;
     │  发型 getHairStyle(st, lod) 键 = hair.hat.brows.lod.quality
     ▼
④ 骨骼装配    _buildRig()                     character.js:662
     │  按 BONE_NAMES 顺序 new Bone() → Skeleton(逆绑定矩阵=纯平移)
     ▼
⑤ 网格绑定    三档 LOD 网格共享同一副骨架      character.js:916-940
```

### 1.1 风格:一张 append-only 的目录表

[character-style.js](../src/game/character-style.js) 全是纯数据:9 种肤色(:13)、10 套服装配色(:29)、8 种虹膜(:44)、帽子/眉毛/整套装预设。两条规则值得学:

- **APPEND-ONLY**(:5):存档存的是索引,表只能在尾部追加——旧存档永远不会"指错"条目;
- **种子确定性**:`resolveStyle` 里缺什么就从名字种子推导,所以"叫同一个名字的 Bot 永远长一个样"。

### 1.2 几何:四种图元积木

[character-geo.js](../src/game/character-geo.js) 的底层是四个函数:

| 积木 | 作用 | 角色身上的用法 |
|---|---|---|
| `superEllipsoid` :190 | 超椭球(指数控制方圆) | 头、身体躯干 |
| `lathe` :206 | 轮廓绕轴旋转 | 四肢段、罐体 |
| `sweep` :240 | 截面沿曲线扫掠 | 发丝、肩带 |
| `gridGeo` :338 | 参数网格 | 面部 |

`Builder` 类(:435)把零件拼成一个 BufferGeometry。**最值得一提的是 T 恤**:它用 **SDF(有向距离场)建模**——先定义一个"T 恤形状的数学函数"([character-outfit.js:301](../src/game/character-outfit.js#L301) `teeSD`),再把图案掩模、缝线投影上去(:357,:408)。衣服不是"穿"上去的,是从数学里"长"出来的。

### 1.3 材质:零贴图的图集策略

这是全角色系统最反直觉的决定([character-mats.js:1-16](../src/game/character-mats.js#L1)):

```
没有一张贴图。颜色/图案全部来自:
  ① 顶点色 + 每顶点语义属性(aEx 子材质/颜色槽、aCloth 布料 id、aTint 装备类别)
  ② fragment shader 里用 SDF + fbm 噪声现场画
     ——T 恤图案、缝线、迷彩,全是 GLSL 算出来的
  ③ 图案小于亚像素时 iwLod 自动淡出(防远处闪烁)
```

每角色有自己的材质实例(配色不同),但**着色器程序全游戏每种共享一份**——省的是驱动的编译/切换成本。

---

## 2. 骨骼与蒙皮:权重也是代码

### 2.1 骨骼数据结构

[character-geo.js:32-58](../src/game/character-geo.js#L32) `BODY_BONES` 用纯数据定义 25 根身体骨:

```js
[名字, 父骨, 静止位置(米)]     // 例:hips 在 [0, 0.64, 0]
```

附加骨(手指 20、脚趾 2、脸 5、衣摆 2、墨罐 1、发梢 8)追加在头发骨之后([character-geo.js:95,98-113](../src/game/character-geo.js#L95)),**保证已有索引永不移动**——这是 RIG 契约里"只增不改"规则的数据层实现。

### 2.2 逆绑定矩阵 = 纯平移

[RIG 里](../docs/RIG.zh-CN.md)说骨骼静置朝向恒为单位矩阵,于是([character-geo.js:1726](../src/game/character-geo.js#L1726)):

> 逆绑定矩阵 = `translate(-rest)` ——没有旋转参与,装配和调试都极大简化。

### 2.3 权重:建模代码即权重代码

传统流程:模型画完→在 DCC 里刷权重→存权重贴图。这里:

```js
Builder.add(geo, {
  weights: (p, i) => [['thighR', 0.75], ['shinR', 0.25]],  // 按顶点位置算,1-4 根骨
});
```

回调按参数(沿肢体的参数 t、SDF 距离)直接算出权重([character-geo.js:437-470](../src/game/character-geo.js#L437))。两个漂亮细节:脊柱用**段中点居中的 C1 帽形函数,相邻权重恒和为 1**(:1451-1454)——弯曲时不会起皱;手指是程序化生成的握姿(:77-91,围绕 Ø2.8cm 握把圆反解,即"静置即握持"契约的另一半)。

---

## 3. LOD:三档 + 屏幕抖动交叉淡化

[character-lod.js](../src/game/character-lod.js)(154 行)做了两件大事:

### 3.1 按"屏幕高度"选档

不是按距离,是按**角色在屏幕上占多少像素**(`LOD_QUALITY` :18-23):本地玩家视角里自己永远 hero 档,远处敌人在你屏幕上只剩 78px 时切 far 档。带 ±12% 迟滞防边界抖动(:26-34)。屏幕高度由**实际绘制该角色的相机**经 `onBeforeRender` 钩子回填([character.js:552-560](../src/game/character.js#L552))——菜单展示台、实验室相机天然可用。

### 3.2 far 档:bone-aware 顶点聚类减面

`clusterDecimate`(:70-134)把顶点聚类成簇,**簇键 = 网格格 + 主导骨 + 材质 id**:同一根骨影响的顶点才会被合并,关节弯折处不起网;代表点取簇心最近顶点(表面不缩水),法线取平均。由目标三角数反推格尺寸,迭代 3 次逼近(硬目标:皮肤 2600 / 衣 3800 / 发 2000 / 眼 260,[character.js:133](../src/game/character.js#L133))。

### 3.3 切换不"pop":screen-door 抖动

两档交叉时,给两份材质注入**交错梯度噪声 discard 测试**([character-lod.js:39-57](../src/game/character-lod.js#L39)):0.3 秒内,旧档逐像素退出、新档逐像素进入,各画一半像素。没有透明度排序问题,没有跳变。

---

## 4. 运行时调用链:谁创建、谁驱动

```
Match 构造                                    【match.js:68(单机) / :109(联机)】
   └─► new Actor({ ..., CharacterClass })     外观:Locker 存档(玩家)/ randomStyle(Bot)
        └─► Actor 构造                        【actor.js:33,59】
             └─► new Character({style, color, weapon…})
                  └─► character.root 挂进场景 【match.js:80】

每帧:
Actor.update(dt)                意图/物理/伤害   【actor.js:237】
   └─► _finishFrame() 填 AnimState a            【actor.js:983-1013】
        (a.form / a.charge / a.rolling / a.ink / a.hp …)
        └─► ch.update(dt, a)              【actor.js:1015】★唯一驱动入口
             └─► 见 RIG 篇:姿态/弹簧/IK/表情/头发
```

分工很清楚:**Actor 管"我是谁、我在哪"(root 位置朝向),Character 管"我怎么动"(全部子节点)**。远端玩家走同一入口,只是 AnimState 来自网络插值。

菜单展示台([showcase.js:1121-1191](../src/game/showcase.js#L1121))复用同一 Character 类,换装时先离屏 warm 16 帧——防止新角色以 T-pose 闪过一帧。

---

## 5. 工程亮点速览

| 亮点 | 说明 | 锚点 |
|---|---|---|
| 零贴图材质 | 顶点语义 + shader 现场画图案 | [character-mats.js:1-16](../src/game/character-mats.js#L1) |
| 权重即回调 | 不写权重贴图,建模代码直接算 | [character-geo.js:437](../src/game/character-geo.js#L437) |
| 几何共享缓存 | 皮肤/衣服按 `lod\|bodyLevel` 缓存,同风格角色不重复建 | [character-geo.js:1711](../src/game/character-geo.js#L1711) |
| 骨架共享 | 三档 LOD 网格绑同一副 Skeleton,一次 update 全驱动 | [character.js:916-940](../src/game/character.js#L916) |
| 三角预算 | far 档硬目标 + 聚类迭代 ≤1.12×;lab 有审计工具 | [character.js:133](../src/game/character.js#L133)、[character-lod.js:147](../src/game/character-lod.js#L147) |
| 生命分级 | far 档不跑表情/眨眼/呼吸,头发半速 | [character.js:1358-1361](../src/game/character.js#L1358) |
| 身高 | KID_H = 1.32 m,默认 FOV 下约占视口 28% | [character-lod.js:11-17](../src/game/character-lod.js#L11) |

---

## 6. 新手总结

1. **风格是数据,身体是函数**:换配色=改表,换发型=换曲线参数,没有"重新建模"。
2. **权重即代码**让"建模"和"绑定"合并成一步——代价是没法在 DCC 里可视化刷权重。
3. **LOD 按屏幕像素而非距离**:因为"看不清"才是降质的真正标准。
4. **Actor/Character 分离**(大脑/身体)是运行时架构的支点,动画篇会看到它如何让远端玩家、Bot、展示台全部复用同一套驱动。
