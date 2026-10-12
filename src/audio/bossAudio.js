// ============================================================================
// 【中文导读】Boss 战音频导演(bossAudio)
//
// 【模块定位】本模块是"事件总线解耦"的范例:它不参与游戏逻辑,只通过
//   on('boss:*') 监听事件,再按白名单把事件翻译成音效 / 音乐调用。音频
//   引擎(src/audio/audio.js)与音乐引擎(music)尚未初始化时,所有调用都
//   被 try/catch 或空值检查兜住,模块加载与运行都不会崩溃。
//
// 【工作机制图】
//   战斗事件(bus) ──▶ 本模块的 on('boss:*') 监听 ──▶ 延时调度(later)
//        │                                                  │
//        ├─ G.audio.play / loop 【音效,带 3D 位置(pos)】      ▶ WebAudio 图
//        └─ G.music.play + music.remap 劫持 【背景音乐】        ▶ 音乐播放器
//
// 【关键设计】
//   1. installBossAudio() 幂等,由 HUD 在启动时安装一次;非 Boss 对局完全静默。
//   2. 用 music.remap 劫持 main.js 的通用 'battle' / 'battle_final' 请求,
//      使其改写为当前阶段曲目 —— 避免普通战斗曲串场、也避免最后一分钟重开音乐。
//   3. 循环声(sweep / gallop / frenzy 等)通过 ~90ms 的 interval 跟随 Boss
//      位置,实时更新 PannerNode,冲锋 / 狂暴时声音也跟着移动。
//   4. 相位升级 'boss' → 'boss_2' → 'boss_3' 只换一次速度,保证每次换曲都
//      落在小节线上并伴随渐强(riser)。
//
// 【配套阅读】docs/ASSETS-AUDIO.zh-CN.md(音频资源说明)、docs/BOSS.md(Boss 机制)
// ============================================================================
// INKWAVE — boss-mode audio director (docs/BOSS.md). Listens to the boss:* events and plays the procedural HULLBREAKER
// sounds (src/audio/audio.js "Boss" group) positioned at the boss / its sockets, plus the phase-escalating boss music
// ('boss' → 'boss_2' → 'boss_3', one tempo so each change lands on a bar line with a riser).
//   installBossAudio()   idempotent; the HUD installs it at boot. Nothing here runs outside boss matches.
// While a boss match is live it sets G.music.remap so main.js's generic 'battle' / 'battle_final' requests resolve to
// the current boss track (no stray battle theme, no restart at one minute left).
import { on, G } from '../core/ctx.js';

// 【阶段 → 曲目映射】Boss 共 3 个相位,音乐随相位升级;installed 防止重复安装
const TRACK = { 1: 'boss', 2: 'boss_2', 3: 'boss_3' };
let installed = false;

// 【对外入口】安装 Boss 音频导演。幂等:多次调用只有第一次生效,由 HUD 在启动时调用一次
export function installBossAudio() {
  if (installed) return;
  installed = true;
  // 【会话状态】active 是否处于 Boss 战;dead 已败北;loops 在播的循环声句柄;timers 已排期的延时;sawImpact/sawFoot 去重标志;三个 *T 是节流时间戳
  const st = { active: false, boss: null, phase: 1, dead: false, track: null, loops: new Map(), timers: new Set(), hitT: 0, critT: 0, footT: 0, sawImpact: false, sawFoot: false, posT: 0 };
  // 【懒取值】音频与音乐引擎可能尚未就绪,每次调用时现取,取不到就是 undefined(后面全部有兜底)
  const A = () => G.audio, M = () => G.music;
  const now = () => performance.now() / 1000;
  // 【取 Boss 引用】优先事件携带的 → 本地缓存 → 比赛对象的兜底链
  const bossOf = (e) => (e && e.boss) || st.boss || (G.match && G.match.boss) || null;
  // 【延时调度】把 fn 排期 s 秒后执行;若届时 Boss 战已结束则不执行;句柄登记进 st.timers 便于 stopAll 统一取消
  const later = (s, fn) => { const id = setTimeout(() => { st.timers.delete(id); if (st.active) fn(); }, s * 1000); st.timers.add(id); };
  // world position of a socket (fresh plain object — audio copies it), else the body
  // 【取 3D 位置】优先取挂点名(socket)经骨骼矩阵换算出的世界坐标 —— 返回全新纯对象,因为音频层会原样拷贝;
  // 模型未就绪或 socket 取不到时,兜底返回 Boss 身体位置并抬高 3(贴近外壳中心)
  const pos = (name, e) => {
    const b = bossOf(e);
    if (!b || !b.pos) return undefined;
    const m = b.model;
    if (name && m && m.getSocket && b.pos.constructor && b.pos.constructor.prototype.applyMatrix4) {
      try { const v = m.getSocket(name, new b.pos.constructor()); if (Number.isFinite(v.x) && (v.x || v.y || v.z)) return { x: v.x, y: v.y, z: v.z }; } catch (err) { /* model not ready */ }
    }
    return { x: b.pos.x, y: b.pos.y + 3, z: b.pos.z };
  };
  // 【安全播放】一声道音效统一入口;不在 Boss 战或音频未起时直接静默丢弃
  const play = (n, o) => { if (!st.active) return; try { A()?.play(n, o); } catch (e) { /* audio not up */ } };
  // 【停循环】按 key 找到循环句柄并淡出停止;不存在则什么都不做
  const stopLoop = (key, fade = 0.25) => { const h = st.loops.get(key); if (h) { st.loops.delete(key); try { h.stop(fade); } catch (e) { /* */ } } };
  // 【起循环】先快停同名旧循环(0.08s 防咔哒),再以可选挂点 sock 起新循环;
  // 最长播 maxDur 秒后自动淡出 —— 防事件丢失时循环永不结束;起播后开启位置跟随
  const loop = (key, n, o, maxDur = 4, sock = null) => {
    stopLoop(key, 0.08);
    if (!st.active) return;
    let h = null;
    try { h = A()?.loop?.(n, o); } catch (e) { h = null; }
    if (!h) return;
    h._sock = sock;
    st.loops.set(key, h);
    later(maxDur, () => { if (st.loops.get(key) === h) stopLoop(key, 0.4); });
    follow();
  };
  // loops ride along with the boss (charge / frenzy / sweep move it)
  // 【位置跟随】循环声挂在 Boss 身上(冲锋 / 狂暴 / 扫射都会移动 Boss 本体),
  // 因此每 ~90ms 把所有循环声的 PannerNode 位置刷新到当前世界坐标;循环全停或战斗结束后自动停表
  let followId = 0;
  const follow = () => {
    if (followId) return;
    followId = setInterval(() => {
      if (!st.loops.size || !st.active) { clearInterval(followId); followId = 0; return; }
      for (const h of st.loops.values()) { const p = pos(h._sock); if (p) try { h.set({ pos: p }); } catch (e) { /* */ } }
    }, 90);
  };
  // 【全停】淡出所有循环并取消全部已排期的延时 —— 换相位 / 结束战斗时用
  const stopAll = (fade = 0.3) => { for (const k of [...st.loops.keys()]) stopLoop(k, fade); for (const id of st.timers) clearTimeout(id); st.timers.clear(); };
  // 【切曲】记录当前曲目并淡入淡出切歌;音乐引擎未初始化时静默;传 null 表示只渐弱
  const music = (track, fade = 1.0) => { st.track = track; try { M()?.play(track, { fade }); } catch (e) { /* not initialised */ } };
  // 【当前曲目】按相位取曲目并钳制在 1..3
  const phaseTrack = () => TRACK[Math.min(3, Math.max(1, st.phase | 0))];
  // 【音乐劫持】开:给 music.remap 装一个改写函数 —— main.js 的通用 'battle' / 'battle_final'
  // 请求会被改写为当前 Boss 曲目(战斗进行中且未败北时);关:只拆除带 _boss 标记的改写,不误伤别人
  const setRemap = (onoff) => {
    const mus = M();
    if (!mus) return;
    if (onoff) mus.remap = (t) => (t === 'battle' || t === 'battle_final') && st.active && !st.dead ? (st.track || phaseTrack()) : undefined;
    else if (mus.remap && mus.remap._boss) mus.remap = null;
    if (onoff) mus.remap._boss = true;
  };
  // 【开战】激活会话(仅首次进入时重置全部状态),登记 Boss 引用,打开音乐劫持
  const begin = (boss) => {
    if (!st.active) { st.active = true; st.phase = 1; st.dead = false; st.track = null; st.sawImpact = false; st.sawFoot = false; }
    if (boss) st.boss = boss;
    setRemap(true);
  };
  // 【收战】停掉一切声音与延时,清状态并拆除音乐劫持
  const end = () => { stopAll(0.4); st.active = false; st.boss = null; st.track = null; setRemap(false); };

  // 【比赛状态机】attract(展示台)忽略;intro/init 时若是 boss 模式则开战、否则收战;
  // 进入 playing 切相位曲目;finish 渐弱;results/judge 阶段关闭劫持,让结算音乐正常播放
  on('match:state', ({ state, match }) => {
    if (!match || match.attract) return;
    if (state === 'intro' || state === 'init') { stopAll(0.2); if (match.mode === 'boss') begin(match.boss || null); else if (st.active) end(); }
    if (!st.active) return;
    if (state === 'playing' && !st.dead) music(phaseTrack());
    if (state === 'finish') { stopAll(0.3); if (!st.dead) music(null, 0.6); }
    if (state === 'results' || state === 'judge') { stopAll(0.3); setRemap(false); }
  });
  // 【Boss 出现】确认开战(防止只有 spawn 没有 intro 的边界情况)
  on('boss:spawn', (e) => begin(e && e.boss));
  // 【登场演出】Boss 标题音 → 0.35s 后嘴部怒吼 → 0.1s 后落点闷响(甲板下破土而出)
  on('boss:intro', (e) => {
    begin(e && e.boss);
    play('boss_title');
    later(0.35, () => play('boss_roar', { pos: pos('mouth', e), volume: 1 }));
    later(0.1, () => play('boss_slam', { pos: pos(null, e), volume: 0.55, pitch: 0.8 }));     // it bursts up through the deck
  });
  // 【招式音板】每个 boss:move 事件带 id(招式名)+ phase(tele 预警 / act 发动 / rec 收招)两级键,
  // 按 `${id}:${phase}` 查表播放对应音效;tele 放预警音、act 放实招(长动作改为循环声)、rec 收循环
  on('boss:move', (e) => {
    if (!e || !st.active || st.dead) return;
    const { id, phase } = e, dur = +e.dur || 0;
    const key = `${id}:${phase}`;
    switch (key) {
      case 'slam:tele': play('boss_tele', { pos: pos('clawL', e) }); break;
      case 'slam:act': if (!st.sawImpact) later(0.12, () => play('boss_slam', { pos: pos('clawL', e) })); break;
      case 'barrage:tele': play('boss_tele', { pos: pos('shellTop', e), pitch: 1.12 }); break;
      case 'barrage:act': {
        const n = 3 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) {
          later(i * 0.2, () => play('boss_whistle', { pos: pos('shellTop', e), pitch: 0.9 + Math.random() * 0.25 }));
          later(0.95 + i * 0.2, () => { const b = bossOf(e), m = b && b.move && b.move.p && b.move.p.b; const bb = m && m[i]; play('boss_barrel', bb ? { pos: { x: bb[0], y: bb[1], z: bb[2] } } : { volume: 0.55 }); });
        }
        break;
      }
      case 'sweep:tele': play('boss_cannon_charge', { pos: pos('cannon', e) }); break;
      case 'sweep:act': loop('sweep', 'boss_cannon_sweep', { pos: pos('cannon', e) }, Math.max(1, dur || 2.5) + 0.2, 'cannon'); break;
      case 'sweep:rec': stopLoop('sweep', 0.35); break;
      case 'charge:tele': play('boss_tele', { pos: pos('mouth', e), pitch: 0.82 }); later(0.2, () => play('boss_roar', { pos: pos('mouth', e), volume: 0.45, pitch: 1.25 })); break;
      case 'charge:act': loop('gallop', 'boss_gallop', { pos: pos(null, e) }, Math.max(1, dur || 2) + 0.3); break;
      case 'charge:rec': stopLoop('gallop', 0.2); break;
      case 'crablets:tele': play('boss_tele', { pos: pos('hatch', e), pitch: 1.25 }); break;
      case 'crablets:act': play('crablet_chitter', { pos: pos('hatch', e), volume: 1 }); later(0.3, () => play('crablet_chitter', { pos: pos('hatch', e), pitch: 1.15 })); break;
      case 'frenzy:tele': play('boss_roar', { pos: pos('mouth', e), volume: 0.7, pitch: 1.15 }); break;
      case 'frenzy:act': loop('frenzy', 'boss_frenzy', { pos: pos(null, e) }, Math.max(1, dur || 3) + 0.3); break;
      case 'frenzy:rec': stopLoop('frenzy', 0.4); break;
      default: break;
    }
  });
  // 【命中反馈】自己打的:弱点音(boss_crit)与普击音(boss_hit)分别用 0.07s / 0.06s 节流,
  // 防一帧多段伤害叠爆音;别人打的弱点命中:降音量播放一次(0.3s 节流),不抢本地反馈
  on('boss:hit', (e) => {
    if (!e || !st.active || st.dead || e.crab || e.blocked) return;
    const t = now();
    const mine = !!(e.attacker && (e.attacker.isLocal || e.attacker === G.match?.local));
    if (mine) {
      if (e.weak) { if (t - st.critT > 0.07) { st.critT = t; play('boss_crit'); } }
      else if (t - st.hitT > 0.06) { st.hitT = t; play('boss_hit'); }
    } else if (e.weak && t - st.critT > 0.3) { st.critT = t; play('boss_crit', { pos: e.pos || pos('eyeL', e), volume: 0.5 }); }
  });
  // 【眩晕】立刻停掉冲锋循环并播放倒地巨响;0.35s 后在左眼挂"头晕"循环,时长跟随眩晕时长(略短以自然收尾)
  on('boss:stun', (e) => {
    if (!st.active || st.dead) return;
    stopLoop('gallop', 0.05);
    play('boss_crash', { pos: pos('shellTop', e) });
    later(0.35, () => loop('dizzy', 'boss_dizzy', { pos: pos('eyeL', e) }, Math.max(0.6, (+e.dur || 3) - 0.3), 'eyeL'));
  });
  // 【相位升级】只升不降(防事件重发);先清场再播升级音 + 怒吼(3 相位更低沉),
  // 战斗中才切曲 —— 换曲恒定拍速,保证落点小节线并自带 riser
  on('boss:phase', (e) => {
    if (!st.active || !e) return;
    const ph = Math.min(3, Math.max(1, e.phase | 0));
    if (ph <= st.phase) return;
    st.phase = ph;
    stopAll(0.2);
    play('boss_phase');
    later(0.3, () => play('boss_roar', { pos: pos('mouth', e), volume: 1, pitch: ph >= 3 ? 0.88 : 0.95 }));
    if (G.match && G.match.state === 'playing') music(phaseTrack());
  });
  // 【败北演出】停所有声音、音乐渐弱、整体 duck 压低 0.7 持续 3s 让位给播报;
  // 播放击败音,1.35s 后再补一声"沉没"音收尾
  on('boss:defeat', (e) => {
    if (!st.active || st.dead) return;
    st.dead = true;
    stopAll(0.15);
    music(null, 0.5);
    try { A()?.duck?.(0.7, 3); } catch (err) { /* */ }
    play('boss_defeat', { pos: pos(null, e) });
    later(1.35, () => play('boss_sunk'));
  });
  // 【脚步声】strength 归一化到 0..1 后映射音量与轻微随机音高;0.06s 节流防多足齐落爆音
  on('boss:foot', (e) => {
    if (!st.active || st.dead || !e || !e.pos) return;
    st.sawFoot = true;
    const t = now();
    if (t - st.footT < 0.06) return;
    st.footT = t;
    const s = Math.max(0, Math.min(1, e.strength ?? 0.6));
    play('boss_step', { pos: e.pos, volume: 0.35 + 0.65 * s, pitch: 0.9 + Math.random() * 0.2 });
  });
  // 【落地冲击】爪子落地 → 巨响;身体落地 → 低沉步音(败北倒地时 dead 后仍要播放,故只在非爪分支判 dead)
  on('boss:impact', (e) => {
    if (!st.active || !e || !e.pos) return;
    st.sawImpact = true;
    const s = Math.max(0.2, Math.min(1, e.strength ?? 1));
    if (/claw/.test(e.socket || '')) play('boss_slam', { pos: e.pos, volume: s });
    else if (!st.dead) play('boss_step', { pos: e.pos, volume: 1, pitch: 0.75 });
  });
  // 【杂项视觉联动音】'bonk'(受击撞壳,败北后不再播)与 'hatch'(舱盖开合/小蟹钻出)
  on('boss:fx', (e) => {
    if (!st.active || !e) return;
    const d = e.data || {};
    const p = d.pos && Number.isFinite(d.pos.x) ? { x: d.pos.x, y: d.pos.y, z: d.pos.z } : undefined;
    if (e.name === 'bonk' && !st.dead) play('boss_crash', { pos: p || pos('shellTop'), volume: 0.7 });
    else if (e.name === 'hatch') play('crablet_chitter', { pos: p || pos('hatch') });
  });
  // 【小蟹音效】spawn 阶段出巢窸窣;其余阶段按是否被击杀分高低两种音高的"爆裂"声
  on('boss:crablet', (e) => {
    if (!st.active || !e || !e.pos) return;
    const p = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    if (e.phase === 'spawn') play('crablet_chitter', { pos: p });
    else play('crablet_pop', { pos: p, pitch: e.killed ? 1.1 : 0.85 });
  });
}
