// Boss Battle rules: the whole room is one squad (team 0) against HULLBREAKER. Win: its HP hits 0. Lose: the clock
// runs out (turf is shown, but secondary). The boss's HP scales with the squad (humans 1.0, bots 0.6) and difficulty.
// Match.js owns the lifecycle; this owns the boss, the finish conditions and the results. See docs/BOSS.md.
//
// ============================================================================
// 【中文导读】Boss 模式规则层(BossMode 类),是整个 Boss 玩法的"裁判 + 装配工":
//   · 职责——创建并持有 Boss 实体(G.boss),驱动其每帧更新,判定胜负,产出结算数据;
//   · 与 Boss 本体的分工——状态复制、招式记录、伤害判定都在 boss.js / bossBrain.js / bossHazards.js,
//     本文件只管"比赛层面"的生命周期:何时算赢、何时算输、结算显示什么;
//   · 生命周期状态机(由 match.js 推进,本文件响应):
//       init → intro(镜头扫场 + Boss 破土吼叫)→ playing(战斗)→
//       finish(胜/负后的短暂演出,由 sim 侧触发 setState)→ results(结算);
//   · 胜负判定【赢 = Boss HP 归零;输 = 240 秒计时耗尽】,涂地覆盖率只作展示,不参与胜负;
//   · HP 规模公式:BOSS.hpPerUnit(18000)× 队伍当量(真人 1.0 / 机器人 0.6)× 难度系数。
// ----------------------------------------------------------------------------
// 【模块定位】模式层的一个插件:BossMode 实例由 src/game/match.js 在 mode === 'boss' 时创建;
//   match.js 每帧调 BossMode.update(dt),结算读 BossMode.result()。它不直接碰网络/UI,
//   只通过事件总线(ctx.js 的 emit)与 Boss 血条/音频/结算界面解耦。
// 【核心机制】唯一状态是 this.won / this.killT:胜负在结算时由 b.dead 反推(所有客户端显示主机的判罚),
//   killT 记录"从开局到 Boss 倒下的秒数",用作结算面板的 Boss 战用时。
// 【关键约定】killT 仅在胜利路径赋值,失败时保持 -1;duration/intro/finishWin/finishLose 是各阶段秒数,
//   与 match.js 的状态钟对齐;线上只有主机推进 finish(m.follower 为真时跳过)。
// 【配套阅读】docs/BOSS.zh-CN.md、docs/BOSS.md §模块;兄弟文件 boss.js(状态/招式)、bossBrain.js(AI)、
//   bossHazards.js(危险物)、src/game/match.js(生命周期宿主)。
// ============================================================================
import { G, emit } from '../core/ctx.js';
import { Boss, BOSS } from './boss.js';
import { restoreMobileBossReverb } from '../audio/mobileBossReverb.js';
import { clearMobileBossMinimapInkForMatch } from '../platform/mobileBossMinimapInk.js';

export const BOSS_MODE = {
  duration: 240,          // default match length (s)
  intro: 7.2,             // the intro state: sweep over the arena, the burst + roar, then back to the squad
  finishWin: 5.2,         // time on the dying boss before the results
  finishLose: 3.2,
  squad: 8,
};

// 【队伍当量】把一支混编小队折算成"等效人数":真人(或本地玩家)计 1.0,远程机器人计 0.6,用于 HP 缩放
export function squadUnits(actors) { return actors.reduce((s, a) => s + (a.isBot && !a.isLocal ? 0.6 : 1), 0); }

export class BossMode {
  // 构造:按队伍规模与难度算出 Boss 最大 HP,创建 Boss 实体并挂到全局 G.boss
  constructor(match) {
    this.match = match;
    const o = match.opts;
    const units = squadUnits(match.actors.filter((a) => a.team === 0));
    // 【HP 公式】18000 × 队伍当量 × 难度系数(easy 0.75 / normal 1 / hard 1.3)
    const maxHp = Math.round(BOSS.hpPerUnit * units * (BOSS.hpDiff[o.difficulty] ?? 1));
    // sim:是否由本客户端模拟 Boss 行为(离线 = 本机;在线 = 主机;看客 follower = 只回放)
    this.boss = new Boss(match, { maxHp, difficulty: o.difficulty || 'normal', sim: !match.follower });
    G.boss = this.boss;
    this.won = false;
    this.killT = -1;             // 击杀剩余时间(胜负已分时记下入账,结算里显示"用时 X 秒")
    emit('boss:spawn', { boss: this.boss });   // UI / 音频据此做准备(HP 条、Boss 名牌等)
  }

  // 每帧入口:先驱动 Boss 本体,再由 sim 侧负责推进 finish 状态
  update(dt) {
    const m = this.match, b = this.boss;
    b.update(dt);
    // the sim side calls the finish (online: the host; guests follow its 'st')
    // 【阶段转换】Boss 死亡瞬间:playing → finish(胜方演出),仅 sim 侧调用,其他客户端跟随主机的状态广播
    if (!m.follower && b.dead && m.state === 'playing') m.setState('finish');
  }

  // 【胜利入账】Boss 倒下时由 boss.js 回调:标记获胜、记录剩余秒数、给击杀者记一笔 bossKill 战绩
  onDefeat(by) {
    const m = this.match;
    this.won = true;
    this.killT = m.duration - m.time;
    if (by?.stats) by.stats.bossKill = 1;
  }

  // 每帧入口:先驱动 Boss 本体,再由 sim 侧负责推进 finish 状态

  // 【结算数据】产出 Boss 战的最终结果对象:胜方(0=队伍/Boss 倒下,1=Boss/时间耗尽)、
  //   涂地覆盖率(仅展示)、以及 Boss 面板数据(名字/胜负/用时/剩余 HP/满血/阶段)。
  //   【关键】胜负一律以 b.dead 为准(回放回放主机判罚),用时优先取 killT,否则取已过时间。
  // the judge: the boss fight's result (every client shows the host's)
  result() {
    const m = this.match, b = this.boss;
    const win = b.dead;
    return {
      mode: 'boss', winner: win ? 0 : 1, coverage: G.paint.coverage(),
      boss: { name: BOSS.name, win, time: Math.round((win && this.killT >= 0 ? this.killT : m.duration - m.time) * 10) / 10, hp: Math.round(b.hp), maxHp: b.maxHp, phase: b.phase },
    };
  }

  // 【销毁】释放 Boss 持有的几何/材质/实例网格等 GPU 资源,并清空全局引用 G.boss(避免悬挂)
  dispose() { clearMobileBossMinimapInkForMatch(this.match); restoreMobileBossReverb(this.match); this.boss.dispose(); if (G.boss === this.boss) G.boss = null; }
}
