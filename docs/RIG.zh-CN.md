# Squidkid 绑定(rig)契约

<p align="center"><a href="RIG.md">English</a> · <b>简体中文</b></p>

小子是单个 SkinnedMesh 绑定。骨骼定义在 `src/game/character-geo.js` → `BODY_BONES`(名称、父级、
静置位置,单位米),并导出 `BONE_NAMES`、`BONE_INDEX`、`BONE_PARENT`、`REST`、`getRestPositions(style)`、
`getBoneInverses(style)`。头发发丝(HAIR_MAX × HAIR_SEGS)和鱿鱼形态由 character.js 驱动。

原始骨骼:hips → spine → chest → neck → head;clavL/R → uArm → fArm → hand;thighL/R → shin → foot;
面部辅助骨 eyeL/R、browL/R、mouth、mouthO(head 的子级)。新增骨骼:见下文。

## 规则
- 建模代码可以**新增**骨骼(例如手指、拇指、脚趾、下颌、眼睑、脸颊、T 恤下摆 / 短裤 / 背罐的抖动骨、
  发梢)。绝不重命名或删除已有骨骼;除非在本文件内约定好比例变更,否则保持已有骨骼的静置位置。
- 每根新增骨骼都要在下方表格中登记一行(名称 · 父级 · 用途 · 建议运动)。未动画的骨骼在静置姿态下
  必须看起来正确。
- 动画代码动画化一切已存在的骨骼。
- 预算:每个角色 ≤ 40k 三角形(所有形态 + 武器、可见网格),小子形态 ≤ ~14 次 draw call。

## 新增骨骼
所有新增骨骼的静置朝向为单位矩阵(与其他骨骼一样),并**追加在**头发骨骼**之后**的 `BONE_NAMES`,
因此没有任何已有索引移动。下表中的一切如果在静置状态下不做动画也看起来正确。`ADDED_BONES`(已导出)
列出它们。L/R 成对骨骼的镜像规则:绕局部 X 的旋转保持符号,绕 Y 和 Z 的旋旋转翻转符号。

| 骨骼 | 父级 | 静置位置(小子空间) | 用途 | 建议运动 |
|---|---|---|---|---|
| `tank` | chest | (0, 0.848, −0.176) = 背罐中心 | 背包:盖帽、领口、滑轨、螺栓、背板、仪表、阀门 + 肩带的背端蒙皮到它;character.js 把玻璃/填充组重挂到它 | 弹簧摇摆/弹跳,小角度(≤ 0.12 rad) |
| `hemF`、`hemB` | hips | (0, 0.712, ±0.082/−0.1) | T 恤下摆(y≈0.76 以下权重渐强,在下摆前/后中心最强) | 随步伐/加速度 rotation.x 摆动 ±0.25;z 向摇摆 |
| `jaw` | head | 头部中心 + (0, −0.035, −0.035)(`JAW_PIVOT`,character-face.js) | 唇线以下的下半脸:下唇 + 内唇、口腔下半、下牙、舌头、下巴(FACE 改造)。权重上限 0.65(`JAW_GAIN`):头太大,下唇离枢轴约 19 cm | rotation.x 0 … 0.35 × mouthOpen(按代码)在 0.3 rad 时张开约 3.5 cm(大张的 booyah 嘴);0.1 ≈ 说话的缝隙 |
| `cheekL/R` | head | 脸颊鼓包上、向内 2 cm | 脸颊鼓包(最大权重 0.55) | 微笑时 position.y +0.002…0.004,小幅 scale 1.0–1.06 |
| `earL/R` | head | 耳根(az ±1.5) | 尖耳朵(权重在耳朵前 20 % 范围内 0→1 渐变) | 下垂/竖起:rotation.z ∓0.3 … ±0.2(L: − 下垂),受击/落地时抖动 |
| `toeL/R` | foot | (±0.084, 0.028, 0.09) = 脚掌球部 | 运动鞋前 40 %(鞋底、鞋面、鞋带) | rotation.x −0.5 … 0(蹬地时脚跟抬起而脚趾保持贴地) |
| `hairTip0…7` | `hair{s}_2` | 每缕发丝的 86 % 处(按发型,与头发骨骼一致) | 棒槌状触手末梢(t > 0.84) | `hair{s}_2` 之后的额外弹簧级;卷曲 ±0.4 |
| `hand{L,R}_{thumb,index,middle,ring,pinky}{1,2}` | hand / 上一关节 | 1 = 指节(MCP / 拇指 CMC),2 = 中间关节(PIP / 拇指 MCP) | 带指甲的铰接手指 + 拇指 | 见下文*手指* |

### 手指(重要 —— 与直手指绑定约定不同)
- **静置姿态 = 握力抓握** Ø 2.8 cm 的握柄(武器的握把围绕它构建:`HAND.hole` 在 character-geo.js,
  `GRIP_HOLE_L/R` / `FIST_OFFSET` 在 character-weapons.js)。因此不做动画的手就能正确持握每件武器,
  空手则呈现放松的微曲。
- 静置时掌心朝大腿(拇指向前,+Z),因此**手指弯曲是绕局部 Z 旋转**,而不是 X。左手:
  `+z` 张开 / 伸展,`−z` 收拢;右手:符号相反。数值相对于静置姿态:
  - 张开的手:手指 `…1` z = +0.9,`…2` z = +0.75;拇指 `thumb1` x = +0.55(把它扳到食指旁),`thumb2` z = −0.5
  - 放松(待机、空手):手指 +0.45 / +0.35;`thumb1` x = +0.35,`thumb2` z = −0.25
  - 紧握的拳(出拳、挥拳):手指 −0.35 / −0.5;`thumb1`(y −0.1,z +0.12),`thumb2` z = +0.3
  - 持任何武器握把 / 炸弹:0(静置)
- 命名刻意**不**匹配 character.js 的通用 `/^(finger|thumb|…)[LR]\d$/` 卷曲(rotation.x,直手指假设):
  套用那套会把这些手指向侧向弯折。要动画它们,把你的卷曲值 `g` 映射为 `rotation.z = side * (rest − g)`,
  数值见上文(L 侧 side = +1,R 侧 = −1)。

### 未添加(及原因)
- `lidL/lidR`(重新评估过):眼睑**已经建模**,但不是骨骼。每片眼睑在蒙皮顶点着色器中绕眼球自身的
  水平轴*在眼球空间内*旋转闭合(眼球是椭球 = 单位球在仿射映射下),逐顶点的位移精确等于"该列的眼睑
  边缘 → 闭合线"。刚性骨骼旋转做不到:它对整片眼睑只有一种位移(眼角会过闭),且线性混合蒙皮下
  部分权重会把眼睑缩进球里。驱动方式,无需骨骼:
  - 眼睛骨骼的 **Y 缩放**(character.js 眨眼 / 眨眼示意 / 眯眼 / 视线跟随,按代码)—— 着色器从骨骼
    纹理读取它:闭合量 = (1 − scaleY) / 0.93;
  - 逐小子的 uniform **`uLid`**(左上、右上、左下、右下,0…1),与骨骼取 max() 合成。
  character.js 可选的 `xb.lidL/lidR` 路径因此保持惰性。

### FACE 改造之后的面部辅助骨
- `eyeL/eyeR` 不再携带几何(眼球蒙皮到 `head`,在眼球材质中由 `uLook` / `uGaze` 转动);它们的
  Y 缩放是上面的眨眼信号。静置位置不变。
- `mouth` / `mouthO` 不携带几何(嘴是建模出来的,由 `uMouth` / `uMouth2` + `jaw` 塑形)。FACE 第 2 轮
  把嘴上移(`MOUTH.el` −0.45 → −0.41),因此这两个辅助骨的静置位置高约 7 mm。
- `cheekL/R` 权重现在在眼罩区域内衰减到 0(抬颊不能把下眼睑推进眼球)。
- `earL/R`:重建的耳朵保持旧的坐标架(根部、轴向、宽度轮廓 —— character-face.js 的 `earFrame(sx)`),
  因此朋克耳环仍然穿在耳缘上。

### 比例 / 静置位置备注
- 已有骨骼的静置位置不变。面部辅助骨(`eyeL/R`、`browL/R`、`mouth`、`mouthO`)由重塑的头部表面
  推导,移动 ≤ 3 mm;眉毛现在位于面罩上沿(`BROW.el` 0.49 → 0.455),以便表情能在刘海下读出。
- `FIST_OFFSET`(character-weapons.js)现在是右手握把孔的轴线(0.0255, −0.0525, 0):旋转把玩以
  握柄为轴。`inHand` / `handR` / `handL` 含义不变。

### 道具
- `getSubDef('bomb')`(character-weapons.js):手持 Splat 炸弹(`body` → 塑料材质,`ink` → 队伍墨水材质),
  由**左**拳握住滚花盖:把一个 group 挂在 `handL` 的 `inHandL.pos/quat` 上(与武器同一套数学)。

## 新增骨骼(日志)
- `tank` · 父级 chest · 位于背罐中心 (0, 0.848, -0.176) · 整个背包(玻璃、盖帽、滑轨、背板、肩带背端)
  蒙皮到它 · character.js 用弹簧弹跳/摇摆它(并把墨水填充/玻璃组重挂到它)。
- `hem`(或 `hemF` + `hemB`)· 父级 spine/hips · T 恤下摆 · character.js 随加速度和步伐摆动
  (rotation.x/z 弹簧);静置姿态不做动画时也必须正确。
- `jaw`(可选)· 父级 head · 下半脸/下巴 · character.js 随嘴部张开(rotation.x ≈ 0.35 × open)。
- ✔(见*手指* —— 静置 = 握把、卷曲轴为局部 Z、命名 `hand{L,R}_*`)手指(可选),命名如 `fingerL1`、
  `thumbR` · character.js 绕握把卷曲(rotation.x,1.1 rad),空手时放松;`lidL/lidR`(可选)随眨眼闭合
  (rotation.x 最大 1.2)—— 眼睑未添加(见*未添加*)。
- 出现时已自动处理:toeL/toeR、lidL/lidR、jaw、tank、hem/hemF/hemB、finger*/thumb*。
