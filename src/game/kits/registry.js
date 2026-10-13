// ============================================================================
// 【中文导读】武器 kit 的注册表 + 契约 + 联机辅助——框架与各 kit 文件之间的唯一"接头"。
// 【模块定位】核心系统(WeaponRunner / SubSystem / bots / netmatch)在这里按 kind 查表,
//   拿到某个武器/副武器/大招自己实现的一组可选 hook;每个 kit 在模块求值时把自己注册进来
//   (见 index.js)。本文件本身不 import 任何 kit,只定义三张空表和几个联机工具。
// 【核心机制】
//   1. 三张纯对象表:MAIN_KITS(主武器)、SUB_KITS(副武器)、KIT_GHOSTS(只做联机 ghost 的物件)。
//   2. 契约全是**可选 hook**:核心处处 `?.` 调用,kit 给什么用什么(default 行为兜底)。
//      顶部大段英文注释就是这张契约的规格说明书,逐条列出每个 hook 的签名与语义。
//   3. 联机工具:netRec/netId/netHurt 负责把"房主端的世界对象"复刻到其他屏幕,
//      netMuted/ghostMute 负责回放时静音涂墨(避免 ghost 重复计分)。
// 【关键约定】kind 字符串是 config.js(WEAPONS/SUBS)与本表之间的键;同一 kind 在主/副表里
//   语义不同。所有坐标/单位沿用米·秒·弧度、Y 轴向上。
// 【配套阅读】docs/ASSETS-WEAPONS.zh-CN.md §1;docs/CONTRACTS.zh-CN.md;docs/NET.zh-CN.md;
//   兄弟文件 index.js(装载)、blade.js / brolly.js / bow.js(契约的具体实现范例)。
// ============================================================================
import { G } from '../../core/ctx.js';
// 【契约总述】主武器 / 副武器各自的 kind 模块(都有哪些 hook、语义如何)写在这里——
//   本段英文即规格;下面逐节给出中文对照。
// Registries for main-weapon and sub-weapon kinds that live in their own modules (src/game/kits/<kind>.js). Each kit
// module registers itself when imported (kits/index.js imports them all); the core systems look a kind up here after
// their built-in ones. Hooks are all optional unless marked.
//
// 【主武器契约 MAIN_KITS】主武器的每一帧都从 update 进入;其余 hook 按需扩展核心的
//   行为(命中挡弹、受伤缩放、跳跃接管、bot 行为、联机姿态 …)。update 是唯一 REQUIRED。
// MAIN_KITS[kind] = {
//   update(runner, dt, inp, w)         REQUIRED — per-frame trigger handling (WeaponRunner.update's switch)
//   reset?(runner)                     runner state reset (spawn, death, loadout swap)
//   busy?(runner) / firingPose?(runner)  extend WeaponRunner.busy() / firingPose()
//   moveSpeed?(runner, w)              run speed override while using the weapon (0 / undefined = default)
//   spreadDeg?(runner, w)              current spread (feeds the reticle)
//   tick?(dt) / clear?()               module-owned world objects (projectiles, shields …): once per frame / on match reset
//   blockShot?(prev, pos, team, dmg) → bool   a shot segment prev→pos hits something this kit owns (e.g. a shield)
//   damageTaken?(runner, amount, attacker, source) → amount   scale damage the wielder takes (actor.damage; e.g. the mitts'
//                                      leap armour); ≤ 0 cancels the hit
//   jump?(runner, intent) → bool       claim this frame's jump press (actor.js; e.g. the mitts' leap). runner.kit.hang
//                                      (set by the kit) holds the kid in place (wall cling)
//   bot?: { fight?(brain, ctx) → bool fire, paint?(brain, ctx) → bool fire, paintPitch?, melee?, charges?, long?, painter?,
//           tactics?(brain, ctx)      every fight / retreat frame after the dodge block: owns fire, hold, swim and move
//           stayIn?(brain, ctx) → bool   veto the low-HP retreat (keep fighting when the kill is close)
//           targetBias?(brain, enemy) → number   added to that enemy's target score in _perceive }
//   shields?(out) → out                push a descriptor for every shield up this frame (bots.js flanks held ones and
//                                      steers round launched ones). Stable per shield; getters read live state:
//                                      { kind, held, team, owner, C (disc centre), N (facing / launched: travel dir), R,
//                                        hp, hpMax, live, blocksActors, left, and launched only: pos (foot), halfW (players
//                                        are held back over ±halfW along the wall), planeOff (the blocking plane sits
//                                        planeOff along N from pos), speed }
// }
// 【副武器契约 SUB_KITS】副武器由 SubSystem 驱动:use 在松开副键时执行投掷/放置;
//   其余 hook 覆盖蓄力(hold)、拒投(blocked)、挡弹、装置受击、瞄准引导、bot 行为 …。use 是 REQUIRED。
// SUB_KITS[kind] = {
//   use(subs, actor, sub)              REQUIRED — the throw / placement on release (SubSystem.use)
//   hold?(runner, dt, inp, sub)        while the sub button is held (charge-up)
//   blocked?(actor, sub) → bool        refuse the throw ("Can't use" — e.g. one already out); emits 'sub:cantuse'
//   tick?(dt) / clear?()               module-owned objects
//   blockShot?(prev, pos, team, dmg) → bool   (shoot-able bombs)
//   blockRay?(from, dir, len, team, dmg) → dist   (charger beams vs shoot-able bombs)
//   damageArea?(c, radius, dmg, team)  a blast went off (G.subs.damageArea): kit objects of other teams caught in it
//   noArc?: true                       no bomb-arc preview while held (the kit draws its own aim guide)
//   bot?: { fight?(brain, dist) → bool throw now, paint?(brain) → bool }
//   threats?(out) → out                push a descriptor for every live object of this kind that hunts / hurts foes
//                                      (bots.js shoots them down or evades them). Stable per object; getters read live
//                                      state: { kind, obj, team, owner, pos (live: feet for walkers, centre for flyers),
//                                        aimY (hit centre above pos), vel, speed, radius (blast), trigger (contact reach),
//                                        ground (walks on the ground), live, state, hp, shootable, locked, target (the
//                                        actor it tracks, or null) } + kind extras (waddle: senseRadius, left;
//                                        torpedo: lockRange, hover)
// }
//
// 【联机契约(任意 kit)】ghost 用在其他玩家屏幕上重建一个"纯视觉复刻"世界对象;
//   它不涂墨(由 owner 端发)、不伤人(远端攻击的命中被丢弃);但护盾/幕帘仍是实心挡弹。
// Online (src/net/netmatch.js), any kit:
//   ghost?(actor, data)                a remote player's world object, from the owner's G.netm.recKit(actor, kind, data)
//                                      (data: a short array of rounded numbers): build a visual copy — it never paints
//                                      (netmatch mutes paint while ghost() runs; the kit keeps muting in its own tick for
//                                      ghost objects) and never hurts (a remote attacker's hits are dropped). Shields /
//                                      curtains stay solid (they block the local player's shots like the owner's do).
//   netHurt?(id, dmg)                  the owner's side of a device hit made on another screen (registry netHurt)
//   MAIN_KITS only: netState?(runner) → int   the pose / state bits other screens need (packed each tick)
//                   netApply?(runner, bits, dt)   a remote runner: rebuild runner.kit from those bits
// 【ghost 专用表】不属于主/副武器、但同样需要联机复刻的物件(如某大招的世界对象)的 ghost 入口。
// KIT_GHOSTS[kind] = { ghost } — ghost-only entries for things that aren't a main or sub kit (e.g. a special's objects)
// 【三张注册表】空对象字面量;各 kit 模块在其顶层往对应表里挂自己的 hook 集合。
export const MAIN_KITS = {};
export const SUB_KITS = {};
export const KIT_GHOSTS = {};
// 【登记世界对象的生成】本地 owner 生成了一个世界对象时调用,把它的类型与短数据数组发给其他玩家
// (离线 / 远端 actor 下是 no-op)。是 kits 里 netRec(...) 的实现。
// the local owner records a spawn for the other players (no-op offline / for remote actors)
export function netRec(actor, kind, data) { G.netm?.recKit?.(actor, kind, data); }
// 【联机 id 分配】给 owner 的某个世界对象一个网络 id,其 ghost 用同一个 id 对齐。编码:owner.nid × 1e5
// + 一个会话内自增序列(取模避免溢出);无 nid(离线)时返回 0。
// a network id for an owner's world object (its ghosts carry the same id): owner nid × 1e5 + a per-session sequence
let _seq = 0;
export function netId(owner) { return owner && owner.nid !== undefined ? owner.nid * 100000 + (++_seq % 100000) : 0; }
// 【非 owner 打坏了 ghost 装置】比如远端玩家的 sprinkler / curtain / waddle:把这次伤害回报给 owner 端,
// 由 owner 的同一份实体来结算(kind 为 'subs' 表示 SubSystem 物件,否则是 kit kind)。
// a non-owner damaged a ghost device (a remote player's sprinkler, curtain, waddle …): the owner's copy takes it.
// (kind: 'subs' for SubSystem items, else the kit kind — its netHurt(id, dmg) applies it on the owner's screen)
export function netHurt(owner, kind, id, dmg) { if (id && dmg > 0) G.netm?.sendDevHit?.(owner, kind, id, dmg); }
// 【联机静音查询】当前是否在"回放 ghost"状态:为真时涂墨应被抑制。
// run fn with paint muted when obj is a ghost (a remote player's copy): its splats are the owner's to send
// true while a ghost (a remote player's replayed shot / bomb / sub) is being simulated: its damage to devices counts for
// nothing here — the owner's own copy hits our ghost of the device and that hit arrives by netHurt
export function netMuted() { return (G.netm?.mute | 0) > 0; }
// 【回放包裹器】obj 是 ghost(远端玩家的复刻)时,在 mute 计数保护下执行 fn,使其涂墨被拒;
// 用 try/finally 保证即使 fn 抛错也会还原 mute,避免 mutes 泄漏导致后续正常涂墨被误吞。
export function ghostMute(obj, fn) {
  const nm = obj && obj.ghost ? G.netm : null;
  if (nm) nm.mute++;
  try { return fn(); } finally { if (nm) nm.mute--; }
}
