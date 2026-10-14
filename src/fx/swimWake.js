// ============================================================================
// 【中文导读】游泳尾迹系统——把"谁在墨水里游过"直接画进墨水面本身（levelMaterial.js 的 swim wakes 通道）。
// ----------------------------------------------------------------------------
// 【模块定位】渲染层的特效数据源：本模块不生成任何网格，而是维护 4 条"游泳者轨迹"并每帧上传到
//             levelMaterial 的 shader uniform（uWake/uWakeB/uSwimH/uSwimF），由地面 shader 把每段
//             轨迹展开成扩散的涟漪（包络开口成 V 形尾迹），并在水下身体上方顶起一个光泽隆起。
// 【核心机制】固定 4 个槽位（SLOTS），每槽一条最多 12 个点（PTS）的轨迹：每游过 ~0.75 m 追加一个
//             带时间戳的点；瞬移/重生/出墨时插入 BREAK 时间哨兵（t = -9）把轨迹切断，shader 见到
//             哨兵就不跨段画涟漪。候选者是相机附近 38 m 内、形态为 swim/climb 的活体 actor，本地
//             玩家永远优先占槽——槽满时抢走离相机最远那个 bot 的槽。上传时把"活的头部"补成最后一
//             个点（年龄 0、紧贴身体），并为 shader 预计算轨迹的包围球（uWakeB）。
// 【关键约定】BREAK = -9 是哨兵而非真实时间戳；瞬移判定阈值 2.5 m；速度阻尼基准 11.8 m/s
//             （speedK = clamp(sp/11.8, 0, 1)）；轨迹点寿命 1.15 s；"在游"的判定看 actor.anim.form
//             是否为 swim/climb。只增不删：本文件全部注释为纯新增。
// 【配套阅读】src/world/levelMaterial.js（shader 端 swim wakes 的消费方）、docs/INK.zh-CN.md
// ============================================================================
// Swim wakes drawn into the ink surface itself (levelMaterial.js, "swim wakes"). Up to 4 swimmers near the camera —
// the local player always first — each keep a 12-point trail of where they swam (a new point every ~0.75 m, the live
// head as the last point, breaks where they left the ink). The shader turns every trail segment into an expanding
// ripple (their envelope opens into the V-wake) and pushes a glossy mound up over the submerged body.
import * as THREE from 'three';
import { G, clamp, damp } from '../core/ctx.js';

// 【槽位与轨迹常量】SLOTS=4 是 shader uniform 数组的硬上限（改这里必须同步改 levelMaterial 的 uniform
// 声明）；LIFE 是轨迹点的存活秒数；SPACING 是相邻采样点的最小间距（米）。
const SLOTS = 4, PTS = 12, LIFE = 1.15, SPACING = 0.75;
// 【断点哨兵】轨迹"断口"标记写入点时间的值：必须是任何真实时间戳都不可能取到的负数
const BREAK = -9;

// 【游泳尾迹】本模块唯一导出的类：4 条轨迹槽位的拥有者，对外只有 update() 一个入口。
export class SwimWake {
  // 【构造】只建空槽位，不分配 GPU 资源——所有数据都写进 levelMaterial 已有的 uniform 数组里
  constructor() {
    this.slots = Array.from({ length: SLOTS }, () => ({
      actor: null, pts: [], k: 0, speedK: 0, fwd: new THREE.Vector3(0, 0, 1), head: new THREE.Vector3(), last: null, swimming: false,
    }));
    this._cand = [];
  }

  // 【重置】清空全部槽位（比赛重开 / 阶段重建时调用），让 shader 立刻看不到任何尾迹
  reset() { for (const s of this.slots) { s.actor = null; s.pts.length = 0; s.k = 0; s.last = null; s.swimming = false; } }

  // 【每帧更新】挑选候选游泳者 → 分配/复用槽位 → 推进轨迹点 → 上传 uniform。
  // 参数 U 是 levelMaterial 的 uniforms 包（uWake 等不存在时直接返回，说明当前材质没有尾迹通道）；
  // camPos 用于"离相机远近"排序，本地玩家始终排最前（_wakeD2 = -1）。
  update(dt, U, camPos) {
    if (!U || !U.uWake) return;
    const now = G.time;
    const m = G.match;
    // 【候选收集】谁在近处墨水里游：存活、形态为 swim/climb、离相机 ≤38 m（本地玩家豁免距离限制）；
    // 按距相机距离升序排序，前面的优先拿到槽位
    const cand = this._cand; cand.length = 0;
    if (m && m.state !== 'results') {
      for (const a of m.actors || G.actors || []) {
        if (!a.alive) continue;
        const f = a.anim?.form;
        if (f !== 'swim' && f !== 'climb') continue;
        const d2 = a.pos.distanceToSquared(camPos);
        if (!a.isLocal && d2 > 38 * 38) continue;
        cand.push(a); a._wakeD2 = a.isLocal ? -1 : d2;
      }
      cand.sort((x, y) => x._wakeD2 - y._wakeD2);
    }
    for (const s of this.slots) s.swimming = false;
    // 【槽位分配】先找回该 actor 原有的槽，否则占一个空槽；槽满时本地玩家可"抢"——把当前持有者的
    // 轨迹清空后挪用（被打劫的 bot 这轮就没有尾迹了，这是刻意的设计取舍：本地反馈永远优先）
    for (const a of cand) {
      let s = this.slots.find((o) => o.actor === a);
      if (!s) s = this.slots.find((o) => !o.actor);
      if (!s && a.isLocal) {   // the local player always gets one: take the farthest bot's
        s = this.slots.reduce((w, o) => (!w || (o.actor && (o.actor._wakeD2 ?? 0) > (w.actor._wakeD2 ?? 0)) ? o : w), null);
        if (s) { s.pts.length = 0; s.last = null; s.k = 0; }
      }
      if (!s) continue;
      // 【换主清空】槽位换绑到新 actor 时丢弃旧轨迹，避免两个身体共用一条尾迹
      if (s.actor !== a) { s.actor = a; s.pts.length = 0; s.last = null; s.k = 0; }
      s.swimming = true;
    }
    // 【逐槽推进】过期点丢弃（队首的断点哨兵一并清掉，因为它只表示"前面还有一段"）；在游的槽
    // 追加新点，出墨的槽让隆起（k）衰减直到整段轨迹老化后释放槽位
    for (const s of this.slots) {
      const a = s.actor;
      if (!a) continue;
      // expire old points (a break marker at the front is meaningless)
      while (s.pts.length && (s.pts[0].t === BREAK ? true : now - s.pts[0].t > LIFE)) s.pts.shift();
      if (s.swimming) {
        const p = a.pos;
        const v = a.vel, sp = v.length();
        // 【朝向】速度足够时才更新，攀爬（climb）保留 y 分量（沿墙方向），平游把 y 抹掉只留水平朝向
        if (sp > 0.6) s.fwd.set(v.x, a.anim?.form === 'climb' ? v.y : 0, v.z).normalize();
        // 【速度系数】阻尼到 0..1，11.8 m/s 视为满速；shader 用它控制涟漪强度与 V 口张开程度
        s.speedK = damp(s.speedK, clamp(sp / 11.8, 0, 1), 10, dt);
        // 【瞬移切断】一次性位移超过 2.5 m 判定为传送/重生入场：插入断点，绝不让涟漪画过这段跳变
        if (s.last && s.last.distanceToSquared(p) > 2.5 * 2.5) { if (s.pts.length && s.pts[s.pts.length - 1].t !== BREAK) s.pts.push({ x: 0, y: 0, z: 0, t: BREAK }); s.last = null; }
        // 【等距采样】距上个点 ≥0.75 m 才追加新点；sp>0.8 的门槛避免入墨瞬间的抖动被采成点
        if (!s.last || s.last.distanceToSquared(p) > SPACING * SPACING) {
          if (sp > 0.8 || !s.last) {
            s.pts.push({ x: p.x, y: p.y, z: p.z, t: now });
            (s.last || (s.last = new THREE.Vector3())).copy(p);
          }
        }
        s.head.copy(p);
        s.k = damp(s.k, 1, 14, dt);
      } else {
        // 【出墨收尾】跳出墨水（跳跃/现身/被击杀）时：补一个断点让尾迹到此为止，k 快速衰减使
        // 水下隆起沉下去；等隆起几乎消失（k<0.004）且轨迹里只剩断点时，才彻底释放槽位
        if (s.pts.length && s.pts[s.pts.length - 1].t !== BREAK) s.pts.push({ x: 0, y: 0, z: 0, t: BREAK });
        s.last = null;
        s.k = damp(s.k, 0, 16, dt);
        if (s.k < 0.004 && !s.pts.some((o) => o.t !== BREAK)) { s.actor = null; s.pts.length = 0; s.k = 0; }
      }
      // 【硬上限】无论如何每条轨迹最多留 PTS-1 个点——最后一个位置预留给"活的头部"
      while (s.pts.length > PTS - 1) s.pts.shift();
    }
    // 【上传 uniform】W=轨迹点数组（xyz + 时间戳）、B=每槽包围球（圆心 xyz + 半径，供 shader 早退）、
    // H=头部位置+隆起强度 k、F=朝向+速度系数
    const W = U.uWake.value, B = U.uWakeB.value, H = U.uSwimH.value, F = U.uSwimF.value;
    for (let si = 0; si < SLOTS; si++) {
      const s = this.slots[si], base = si * PTS;
      let n = 0;
      if (s.actor) {
        let cx = 0, cy = 0, cz = 0, c = 0;
        for (const o of s.pts) {
          W[base + n++].set(o.x, o.y, o.z, o.t);
          if (o.t !== BREAK) { cx += o.x; cy += o.y; cz += o.z; c++; }
        }
        // 【活体封口】游泳中用头部坐标补上最后一点（时间戳=now，年龄 0），让涟漪一直连到身体
        if (s.swimming) { W[base + n++].set(s.head.x, s.head.y, s.head.z, now); cx += s.head.x; cy += s.head.y; cz += s.head.z; c++; }
        // 【包围球】shader 用"当前像素是否在轨迹包围球外"做廉价早退；半径 +1.6 m 是给涟漪扩散留的余量
        if (c) {
          cx /= c; cy /= c; cz /= c;
          let r = 0;
          for (let i = 0; i < n; i++) { const w = W[base + i]; if (w.w !== BREAK) r = Math.max(r, Math.hypot(w.x - cx, w.y - cy, w.z - cz)); }
          r = Math.max(r, Math.hypot(s.head.x - cx, s.head.y - cy, s.head.z - cz));
          B[si].set(cx, cy, cz, r + 1.6);
        } else B[si].set(0, -999, 0, 0);   // 全是断点：把球心沉到地下，shader 直接跳过
        H[si].set(s.head.x, s.head.y, s.head.z, s.k);
        F[si].set(s.fwd.x, s.fwd.y, s.fwd.z, s.speedK);
      } else {
        // 【空槽】y=-999 是"此槽无效"的约定，shader 见即跳过
        B[si].set(0, -999, 0, 0); H[si].set(0, -999, 0, 0);
      }
      // 【尾部填充】用断点哨兵填满剩余槽位，保证 uniform 数组里永远没有上一帧的残留数据
      for (let i = n; i < PTS; i++) W[base + i].set(0, 0, 0, BREAK);
    }
  }
}
