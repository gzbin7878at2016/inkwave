// INKWAVE — procedural music engine + shared Web Audio DSP core.
//
// Everything here is synthesized: no audio files. The DSP helpers (Voice builder `V`, envelopes, noise buffers,
// impulse responses, instrument voices) are exported so src/audio/audio.js can build its SFX with the same parts.
// All builders take any BaseAudioContext + destination node so they can be rendered through an OfflineAudioContext
// (see tools/audio-test.mjs).
//
//   import { music } from './music.js';
//   music.play('battle', { fade: 1 });   // 'title' | 'menu' | 'battle' | 'battle_final' | 'results_win' | 'results_lose' | null
//                                        // boss mode: 'boss' → 'boss_2' → 'boss_3' (same tempo: phase changes sync to the bar)
//   music.remap = (track) => track       // optional router (boss director maps 'battle'/'battle_final' to the boss track)
//   music.setIntensity(0..1);            // adds / removes layers (drums drop to hats-only at low intensity)
//   music.stop(fade)
//
// File-backed tracks: songs/manifest.json (written by `npm run music`, see build/music-manifest.mjs) can supply real
// recordings for any track id. They stream through <audio> elements into the same music bus, so volume + ducking apply.
// Today: 'battle' shuffles songs/in game/, 'battle_final' plays songs/now or never/ once (it is timed to the last
// minute). Ids without files keep their synthesized score.
//   music.preload('battle')   // start buffering the next pick before it is needed
//   music.pause() / resume()  // freeze a file track with the match clock (synth tracks only duck)
//
// audio.init() attaches the singleton to the real AudioContext's music bus (music._init(ctx, bus)).

// ============================================================================================================
// 【中文导读】程序化音乐引擎 + 共享 Web Audio DSP 核心
// ------------------------------------------------------------------------------------------------------------
// 本模块是一条「文本乐谱 → 编译 → 音序器现场合成」的流水线,没有任何音频文件:
//
//   文本乐谱(SONGS,如 'X.....x.X.x.....' / 'R.RR..O.R.RR..5n' / 'B4/2 E5/2 r/1')
//     │  compileSong()          【编译期】把字符串展开成 bars[bar].ev[step] 事件表,
//     │                         顺便算好循环点、riser、跨小节的引导音(n)等
//     ▼
//   事件表(bars / ev)
//     │  MusicEngine._tick()    【运行时】25ms 定时器 + 0.16s lookahead:
//     │  Player.pump()          把时间窗口内的事件逐个交给乐器函数现场合成
//     ▼
//   乐器函数(kick/snare/bass/guitar/pad/lead/…) → V voice 构建器 → 音乐总线
//
// 核心概念:
//   · V 类 —— "一个音符/一个声音"的节点容器:osc/noise/filter/gain… 链式搭建,最后一个音源结束时自动销毁
//   · 包络 —— perc/ahr/adsr/pts/sweep,全部从 0 起、精确回到 0(不爆音)
//   · pattern DSL —— 鼓是 16 字符字符串(字符→力度表 VEL);贝斯字符即和声指令(R=根音、5=五度…);
//     旋律用 parsePhrase('B4/2 E5/2 r/1') 文本记谱
//   · MusicEngine —— 游戏侧只调 music.play()/setIntensity()/stop();Boss 模式用 remap 钩子劫持选曲
//   · 录音轨 —— songs/manifest.json 里有的曲目改走 <audio> 元素,进同一总线(音量/闪避一致),无录音的回落合成版
//
// 配套阅读:docs/ASSETS-AUDIO.zh-CN.md §3(音序器与乐谱 DSL 详解)。
// ============================================================================================================

/* ============================================================================================================
 * Shared DSP core
 * ==========================================================================================================*/

// 【midi 音号 → 频率(Hz)】国际标准 A4=69→440Hz,每 +12 个音号频率翻倍。乐谱里全是 midi 号,靠它换算。
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 【确定性伪随机数】mulberry32:同一种子必然产生同一序列。音乐里用它给每个 Player 一个 rng,
// 让"同一首歌每次播放的微小随机(力度抖动、噪声相位、镲片闪烁)"既可复现又不死板。
export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 【按 AudioContext 缓存共享资源】噪声缓冲、脉冲波表等很贵且与 ctx 绑定,
// 用 WeakMap<ctx, Map> 缓存:同一 ctx 重复要同一份,ctx 被回收时缓存自动释放。
const perCtx = new WeakMap();
function cache(ctx) {
  let m = perCtx.get(ctx);
  if (!m) { m = new Map(); perCtx.set(ctx, m); }
  return m;
}

// 【可无缝循环的 2 秒单声道噪声缓冲】'white' 白噪声 | 'pink' 粉红 | 'brown' 布朗,均归一化到约 0.3 振幅。
// 为什么强调"无缝":振荡器噪声源的 loop=true,若缓冲首尾不衔接会周期性"咔哒"一声。
export function noiseBuffer(ctx, kind = 'white') {
  const c = cache(ctx);
  const key = 'noise:' + kind;
  let b = c.get(key);
  if (b) return b;
  const sr = ctx.sampleRate, len = Math.floor(sr * 2);
  b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  const rnd = mulberry32(kind === 'white' ? 11 : kind === 'pink' ? 23 : 37);
  const w = new Float32Array(len);
  for (let i = 0; i < len; i++) w[i] = rnd() * 2 - 1;
  if (kind === 'white') d.set(w);
  else {
    // every IIR runs twice around the loop (warm-up pass, then the written pass) so its state at the end equals
    // its state at the start → the colored noise is exactly periodic and loops without a step
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) {
        const x = w[i];
        let y;
        if (kind === 'pink') {
          b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
          b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
          y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
        } else { last = (last + 0.02 * x) / 1.02; y = last; }
        if (pass) d[i] = y;
      }
    }
    // DC-block (one-pole HPF ~25 Hz), also circular
    const a = Math.exp((-2 * Math.PI * 25) / sr);
    let y = 0, px = d[len - 1];
    const tmp = new Float32Array(len);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) { const x = d[i]; y = a * (y + x - px); px = x; if (pass) tmp[i] = y; }
    }
    d.set(tmp);
  }
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  for (let i = 0; i < len; i++) d[i] -= mean;
  let ss = 0;
  for (let i = 0; i < len; i++) ss += d[i] * d[i];
  const g = 0.3 / Math.sqrt(ss / len);
  for (let i = 0; i < len; i++) d[i] *= g;
  c.set(key, b);
  return b;
}

// 【立体声混响脉冲响应(IR)】前若干毫秒是早期反射(模拟 plaza 墙面回声),之后是随时间变暗的指数衰减弥散尾音。
// 用它喂给 ConvolverNode,任何声音只要 send 过去就获得"空间感"。可自定义时长/衰减/明暗/反射点。
export function makeImpulse(ctx, seconds = 1.6, decay = 3.2, opt = {}) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor((opt.pre ?? 0.01) * sr);
  const bright = opt.bright ?? 0.85, dark = opt.dark ?? 0.12;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = mulberry32((opt.seed ?? 71) + ch * 101);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const env = Math.exp(-x * decay * 2.3) * (1 - x) * Math.min(1, (i - pre) / (0.002 * sr));
      const a = dark + (bright - dark) * Math.exp(-x * 4);
      lp += ((rnd() * 2 - 1) - lp) * a;
      d[i] = lp * env;
    }
    // early reflections (plaza walls), different per ear
    const taps = opt.taps ?? [[0.011, 0.5], [0.019, 0.36], [0.027, 0.3], [0.041, 0.22], [0.058, 0.15]];
    for (const [tt, amp] of taps) {
      const i = pre + Math.floor((tt + (ch ? 0.0031 : 0)) * sr);
      if (i < len - 2) { d[i] += amp * (ch ? -1 : 1); d[i + 1] += amp * 0.4; }
    }
  }
  return buf;
}

// 【tanh 失真曲线】k 越大压得越狠(软削波),长度取奇数且归一化,保证 0 输入精确映射 0 输出(无直流偏移)。
// 曲线按 k 缓存——WaveShaperNode 的 curve 一旦生成可复用,是吉他/贝斯" drive "音色的来源。
const curves = new Map();
export function driveCurve(k) {
  const key = Math.round(k * 100);
  let c = curves.get(key);
  if (c) return c;
  const n = 2049;
  c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  curves.set(key, c);
  return c;
}

// 【脉冲波(方波的广义)PeriodicWave】duty 0..1 控制占空比(0.25≈窄方波,音色更"蜂鸣")。
// 用傅里叶系数合成而非 type='square',先天带限——高频不混叠。
export function pulseWave(ctx, duty = 0.25) {
  const c = cache(ctx), key = 'pulse:' + duty;
  let w = c.get(key);
  if (w) return w;
  const N = 48, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    re[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
    im[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI);
  }
  w = ctx.createPeriodicWave(re, im);
  c.set(key, w);
  return w;
}

// 【衰减脉冲串 PeriodicWave】(军鼓滚奏的幅度调制用):急起 + 指数衰减的周期形状,谱峰集中、听感"哒哒哒"清晰。
export function strokeWave(ctx, sharp = 7) {
  const c = cache(ctx), key = 'stroke:' + sharp;
  let w = c.get(key);
  if (w) return w;
  const N = 40, M = 2048, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    let a = 0, b = 0;
    for (let i = 0; i < M; i++) {
      const ph = i / M, e = Math.exp(-ph * sharp) * Math.min(1, ph * 60);
      a += e * Math.cos(2 * Math.PI * n * ph); b += e * Math.sin(2 * Math.PI * n * ph);
    }
    re[n] = (2 * a) / M; im[n] = (2 * b) / M;
  }
  w = ctx.createPeriodicWave(re, im);
  c.set(key, w);
  return w;
}

const fmin = 1e-4;
// 【包络家族】所有包络都从 0 起、最后精确落在 0(尾音收干净,绝不爆音),返回值是该音符的结束时刻。
//   perc —— 打击式:线性起到 peak,指数衰减(鼓、镲、拨弦)
//   ahr  —— attack/hold/release:起到 peak 后平台一段再释放(踩镲等短保持音)
//   adsr —— 经典四段:attack→decay→sustain(平台)→release;gate 是"从起点到开始释放"的秒数,
//            支持 gate 短于 decay 时在衰减中途提前释放(贝斯断奏靠这个)
//   pts  —— 分段线性:传入 [[dt, value], ...] 折点,自由画任意形状(riser 的包络)
//   sweep—— 不是包络,是参数扫频(频率从 f0 滑到 f1,指数或线性):底鼓"扑"的下扫、上滑音都靠它
export function perc(p, t, a, peak, d) {
  peak = Math.max(peak, fmin);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), t + a + d);
  p.linearRampToValueAtTime(0, t + a + d + 0.008);
  return t + a + d + 0.008;
}
export function ahr(p, t, a, peak, h, r) {
  peak = Math.max(peak, fmin);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + h);
  p.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), t + a + h + r);
  p.linearRampToValueAtTime(0, t + a + h + r + 0.008);
  return t + a + h + r + 0.008;
}
// gate = seconds from t until release starts.
export function adsr(p, t, a, d, s, peak, gate, r) {
  peak = Math.max(peak, fmin);
  const sus = Math.max(peak * s, 1e-5);
  const ta = t + a, tg = t + Math.max(gate, a + 0.002);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, ta);
  let v;
  if (tg < ta + d) { v = peak * Math.pow(sus / peak, (tg - ta) / d); p.exponentialRampToValueAtTime(v, tg); }
  else { v = sus; p.exponentialRampToValueAtTime(sus, ta + d); p.setValueAtTime(sus, tg); }
  p.exponentialRampToValueAtTime(Math.max(v * 0.001, 1e-6), tg + r);
  p.linearRampToValueAtTime(0, tg + r + 0.008);
  return tg + r + 0.008;
}
// Piecewise-linear envelope from [[dt, value], ...] (first point should be [0, 0], last value 0).
export function pts(p, t, list) {
  p.setValueAtTime(list[0][1], t + list[0][0]);
  for (let i = 1; i < list.length; i++) p.linearRampToValueAtTime(list[i][1], t + list[i][0]);
  return t + list[list.length - 1][0];
}
export function sweep(p, t, f0, f1, dur, lin) {
  p.setValueAtTime(f0, t);
  if (lin) p.linearRampToValueAtTime(f1, t + dur);
  else p.exponentialRampToValueAtTime(Math.max(f1, 1e-3), t + dur);
}

// 【Voice 构建器——本模块的心脏】一个 V 实例 = 一个音符/一个音效的全部节点。
// 职责:① 链式创建节点(osc/noise/filter/gain/shaper/pan/delay)并自动登记;
//       ② 记录每个音源的结束时刻,最后一个音源停掉时一次性 disconnect 全部节点(防内存泄漏);
//       ③ 提供 tone/nz/bub 复合积木,一行合成一个常见音效。所有乐器函数都由它拼出来。
export class V {
  constructor(ctx, out, t, rng) {
    this.ctx = ctx; this.out = out; this.t = t; this.rng = rng || Math.random;
    this.nodes = []; this.srcs = []; this.end = t; this.dead = false; this.endless = false;
    this.nyq = ctx.sampleRate * 0.5 - 200;
  }
  r(a = 0, b = 1) { return a + (b - a) * this.rng(); }
  pick(arr) { return arr[Math.floor(this.rng() * arr.length) % arr.length]; }
  gain(v = 0, to) {
    const g = this.ctx.createGain(); g.gain.value = v; this.nodes.push(g);
    if (to) g.connect(to);
    return g;
  }
  filter(type, f, Q = 0.707, to, gainDb) {
    const b = this.ctx.createBiquadFilter(); b.type = type;
    b.frequency.value = Math.min(Math.max(f, 10), this.nyq); b.Q.value = Q;
    if (gainDb !== undefined) b.gain.value = gainDb;
    this.nodes.push(b);
    if (to) b.connect(to);
    return b;
  }
  shaper(k, to) {
    const w = this.ctx.createWaveShaper(); w.curve = driveCurve(k); w.oversample = '2x'; this.nodes.push(w);
    if (to) w.connect(to);
    return w;
  }
  pan(p, to) {
    const n = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    if (n.pan) n.pan.value = Math.max(-1, Math.min(1, p));
    this.nodes.push(n);
    if (to) n.connect(to);
    return n;
  }
  delay(time, to, max = 1) {
    const d = this.ctx.createDelay(max); d.delayTime.value = time; this.nodes.push(d);
    if (to) d.connect(to);
    return d;
  }
  _src(s, t0, t1, to) {
    if (to) s.connect(to);
    s.start(Math.max(0, t0));
    if (t1 != null) { s._end = Math.max(t1, t0 + 0.002); s.stop(s._end); this.end = Math.max(this.end, s._end); }
    else { s._end = Infinity; this.endless = true; }
    this.srcs.push(s); this.nodes.push(s);
    return s;
  }
  osc(type, f, t0, t1, to) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = Math.min(f, this.nyq);
    return this._src(o, t0, t1, to);
  }
  noise(kind, t0, t1, to, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = noiseBuffer(this.ctx, kind); s.loop = true;
    s.playbackRate.value = rate;
    if (to) s.connect(to);
    s.start(Math.max(0, t0), this.rng() * 1.9);
    if (t1 != null) { s._end = Math.max(t1, t0 + 0.002); s.stop(s._end); this.end = Math.max(this.end, s._end); }
    else { s._end = Infinity; this.endless = true; }
    this.srcs.push(s); this.nodes.push(s);
    return s;
  }
  buffer(buf, t0, t1, to, rate = 1, offset) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    if (to) s.connect(to);
    s.start(Math.max(0, t0), offset ?? this.rng() * buf.duration * 0.95);
    if (t1 != null) { s._end = Math.max(t1, t0 + 0.002); s.stop(s._end); this.end = Math.max(this.end, s._end); }
    else { s._end = Infinity; this.endless = true; }
    this.srcs.push(s); this.nodes.push(s);
    return s;
  }
  // LFO → param: returns { osc, depth(gain) }
  lfo(rate, depth, param, t0, t1, type = 'sine') {
    const g = this.gain(depth); g.connect(param);
    const o = this.osc(type, rate, t0, t1, g);
    return { osc: o, depth: g };
  }
  // ---- compound one-liners (times: `at` absolute, else `t` relative to this.t) ----
  // 【单音积木】一条命令 = 包络 + 振荡器(可扫频 f0→f1),最常用。
  // 参数:o.f 频率, o.f1 扫频目标, o.a 起音, o.h 保持(给了就走 ahr,否则 perc), o.d 衰减, o.peak 峰值, o.at 绝对时刻
  tone(o) {
    const T = o.at ?? this.t + (o.t || 0);
    const g = this.gain(0, o.to || this.out);
    const end = o.h != null ? ahr(g.gain, T, o.a ?? 0.002, o.peak ?? 0.5, o.h, o.d ?? 0.1)
      : perc(g.gain, T, o.a ?? 0.002, o.peak ?? 0.5, o.d ?? 0.1);
    const x = this.osc(o.type || 'sine', o.f, T, end + 0.01, g);
    if (o.f1 != null) sweep(x.frequency, T, Math.min(o.f, this.nyq), Math.min(o.f1, this.nyq), o.sw ?? ((o.a ?? 0.002) + (o.d ?? 0.1)), o.lin);
    if (o.detune) x.detune.value = o.detune;
    return x;
  }
  // 【噪声积木】滤波噪声一次成型:ft=null 时不过滤(直接噪声),否则 bandpass 等 + 可选扫频。镲/沙锤/气声全靠它。
  nz(o) {
    const T = o.at ?? this.t + (o.t || 0);
    const g = this.gain(0, o.to || this.out);
    const ft = o.ft === undefined ? 'bandpass' : o.ft;
    const fl = ft ? this.filter(ft, o.f ?? 1000, o.q ?? 1, g) : null;
    const end = o.h != null ? ahr(g.gain, T, o.a ?? 0.001, o.peak ?? 0.5, o.h, o.d ?? 0.1)
      : perc(g.gain, T, o.a ?? 0.001, o.peak ?? 0.5, o.d ?? 0.1);
    this.noise(o.kind || 'white', T, end + 0.01, fl || g, o.rate || 1);
    if (fl && o.f1 != null) sweep(fl.frequency, T, Math.min(o.f, this.nyq), Math.min(o.f1, this.nyq), o.sw ?? ((o.a ?? 0.001) + (o.d ?? 0.1)), o.lin);
    return fl;
  }
  // 【气泡音"plip"】Minnaert 频率式气泡:阻尼正弦 + 音高上滑(水下冒泡、弹跳球的招牌音效)。
  bub(T, f, peak, d = 0.03, rise = 1.7, to) {
    return this.tone({ at: T, f, f1: f * rise, sw: d, a: 0.0012, d, peak, to });
  }
  // 【收尾登记】挂到"结束最晚的音源"的 onended 上:它一停就 dispose 全图。调用方通常不用管。
  finish() {
    if (this.endless || !this.srcs.length) return this;
    let last = this.srcs[0];
    for (const s of this.srcs) if (s._end > last._end) last = s;
    last.onended = () => this.dispose();
    return this;
  }
  // 【急停】在时刻 at 停掉所有音源(调用方先淡出输出,避免啪声),随后走正常 finish 清理。
  kill(at) {
    for (const s of this.srcs) {
      if (s._end > at) { try { s.stop(at); } catch (e) { /* already stopped */ } s._end = at; }
    }
    this.end = at; this.endless = false;
    this.finish();
  }
  // 【销毁】断开所有节点、清空引用,触发 ondispose 回调。幂等(dead 标志)。
  dispose() {
    if (this.dead) return;
    this.dead = true;
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    this.nodes.length = 0; this.srcs.length = 0;
    if (this.ondispose) this.ondispose();
  }
}

/* ============================================================================================================
 * Instruments (shared by music + SFX). Signature: (v, T, ..., vel, opts) — T absolute time; output → opts.to || v.out
 * ==========================================================================================================*/

// 【底鼓】正弦从 f0(默认 165Hz)快速下扫到 f1(默认 46Hz)——"扑"的主体;
// 叠加一点三角波饱和(分量感)和 1.6kHz 高通噪声(敲击声)。鼓组力度的锚。
export function kick(v, T, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const end = perc(g.gain, T, 0.0015, vel, o.d ?? 0.34);
  const x = v.osc('sine', o.f0 ?? 165, T, end + 0.01, g);
  sweep(x.frequency, T, o.f0 ?? 165, o.f1 ?? 46, o.sw ?? 0.085);
  // a touch of saturation on the body for weight
  v.tone({ at: T, type: 'triangle', f: (o.f0 ?? 165) * 0.9, f1: (o.f1 ?? 46), sw: 0.06, a: 0.001, d: 0.08, peak: vel * 0.18, to });
  v.nz({ at: T, ft: 'highpass', f: 1600, q: 0.7, a: 0.0006, d: 0.012, peak: vel * 0.32, to });
  return end;
}

// 【军鼓】三层叠出"啪+嗡+沙":下扫三角(鼓皮)+ 330Hz 正弦(桶身)+ 高通噪声(沙带),
// 再补一段 4.2kHz 带通(清脆的边缘)。
export function snare(v, T, vel = 1, o = {}) {
  const to = o.to || v.out;
  v.tone({ at: T, type: 'triangle', f: o.f ?? 205, f1: (o.f ?? 205) * 0.82, sw: 0.05, a: 0.001, d: 0.11, peak: vel * 0.5, to });
  v.tone({ at: T, type: 'sine', f: 330, f1: 290, sw: 0.03, a: 0.001, d: 0.06, peak: vel * 0.22, to });
  v.nz({ at: T, ft: 'highpass', f: 1300, q: 0.8, a: 0.001, d: o.d ?? 0.19, peak: vel * 0.72, to });
  return v.nz({ at: T, ft: 'bandpass', f: 4200, q: 0.9, a: 0.001, d: 0.09, peak: vel * 0.32, to });
}

// 【拍手】三次快速爆点(模拟手掌先后接触)+ 长尾释放,全部走 1.15kHz 带通 + 600Hz 高通:
// 只留"啪"的中频,切掉低频轰隆。
export function clap(v, T, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const bp = v.filter('bandpass', 1150, 1.1, g);
  const hp = v.filter('highpass', 600, 0.7, bp);
  const p = g.gain, pk = vel * 0.9;
  p.setValueAtTime(0, T);
  for (let k = 0; k < 3; k++) {
    const tk = T + k * 0.0105;
    p.linearRampToValueAtTime(pk, tk + 0.0008);
    p.linearRampToValueAtTime(pk * 0.12, tk + 0.0095);
  }
  const t3 = T + 0.0315;
  p.linearRampToValueAtTime(pk, t3 + 0.001);
  p.exponentialRampToValueAtTime(pk * 0.001, t3 + (o.d ?? 0.2));
  p.linearRampToValueAtTime(0, t3 + (o.d ?? 0.2) + 0.008);
  v.noise('white', T, t3 + (o.d ?? 0.2) + 0.02, hp);
}

// 【踩镲】白噪声 → 7.5kHz 高通(闭)/ 6.5kHz(开)→ 10.5kHz 峰化提升,闭镲 45ms、开镲长尾 320ms。
export function hat(v, T, vel = 1, open = false, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const end = perc(g.gain, T, 0.0008, vel, open ? (o.d ?? 0.32) : (o.d ?? 0.045));
  const pk = v.filter('peaking', 10500, 1.2, g, 5);
  const hp = v.filter('highpass', open ? 6500 : 7500, 0.8, pk);
  v.noise('white', T, end + 0.01, hp);
  return g.gain;
}

// 【吊镲 crash】双层高通噪声(长尾 1.6s + 短促)+ 三根方波金属泛音(3.4k/4.9k/6.2kHz),
// 开场"呲——"的气势全靠它。
export function crash(v, T, vel = 1, o = {}) {
  const to = o.to || v.out;
  v.nz({ at: T, ft: 'highpass', f: 4200, q: 0.6, a: 0.001, d: o.d ?? 1.6, peak: vel * 0.55, to });
  v.nz({ at: T, ft: 'bandpass', f: 7200, q: 0.9, a: 0.001, d: (o.d ?? 1.6) * 0.5, peak: vel * 0.35, to });
  // metallic shimmer partials
  const hp = v.filter('highpass', 3000, 0.7, to);
  for (const f of [3410, 4870, 6230]) v.tone({ at: T, type: 'square', f, a: 0.001, d: 0.5, peak: vel * 0.02, to: hp });
}

// 【边击 rim】极短的 1.75kHz 三角音 + 2.6kHz 带通噪声——"嗒"的干声,放克/慢歌里替代军鼓。
export function rim(v, T, vel = 1, o = {}) {
  const to = o.to || v.out;
  v.tone({ at: T, type: 'triangle', f: 1750, f1: 1500, sw: 0.02, a: 0.0005, d: 0.03, peak: vel * 0.45, to });
  v.nz({ at: T, ft: 'bandpass', f: 2600, q: 2, a: 0.0005, d: 0.02, peak: vel * 0.45, to });
}

// 【沙锤】7kHz 带通噪声 + 6ms 慢起音(去瞬态)——连续的"沙沙",音序器里通常写满 16 分音符。
export function shaker(v, T, vel = 1, o = {}) {
  v.nz({ at: T, ft: 'bandpass', f: 7000, q: 1.2, a: 0.006, d: 0.05, peak: vel * 0.5, to: o.to || v.out });
}

// 【嗵鼓 tom】频率 1.5 倍下扫的三角音(桶身)+ 短粉红噪声,fill(加花)里音高递降的一串就是连续 tom。
export function tom(v, T, f, vel = 1, o = {}) {
  const to = o.to || v.out;
  v.tone({ at: T, f: f * 1.5, f1: f, sw: 0.06, a: 0.001, d: o.d ?? 0.35, peak: vel * 0.8, to });
  v.nz({ at: T, ft: 'lowpass', f: 1800, q: 0.8, a: 0.001, d: 0.05, peak: vel * 0.25, to, kind: 'pink' });
}

// 【贝斯】三种风格(style 可换):
//   punk —— 锯齿 + 失谐方波过共振低通,起音瞬间滤波打开再回落,最后 tanh 失真:朋克的"咆哮"
//   funk —— 短 gate + 方波过快速下扫低通(起音亮、马上变闷):"嘟-哒"的放克指弹
//   sub  —— 纯正弦 + 一点二倍频三角:干净的低频垫底(输场曲)
export function bass(v, T, f, gate, vel = 1, o = {}) {
  const to = o.to || v.out, style = o.style || 'punk';
  const g = v.gain(0, to);
  if (style === 'funk') {
    const end = adsr(g.gain, T, 0.002, 0.22, 0.45, vel, gate, 0.05);
    const lp = v.filter('lowpass', 300, 7, g);
    sweep(lp.frequency, T, 2600 * (0.6 + 0.4 * vel), 330, 0.12);
    v.osc('square', f, T, end + 0.01, lp);
    const sg = v.gain(0.55, g); v.osc('sine', f, T, end + 0.01, sg);
    return end;
  }
  if (style === 'sub') {
    const end = adsr(g.gain, T, 0.008, 0.3, 0.75, vel, gate, 0.1);
    const lp = v.filter('lowpass', 900, 0.8, g);
    v.osc('sine', f, T, end + 0.01, lp);
    const h = v.gain(0.25, lp); v.osc('triangle', f * 2, T, end + 0.01, h);
    return end;
  }
  // punk: saw + detuned square through an enveloped resonant low-pass, then drive
  const end = adsr(g.gain, T, 0.003, 0.2, 0.72, vel, gate, 0.05);
  const sh = v.shaper(o.drive ?? 2.2, g);
  const pre = v.gain(0.55, sh);
  const lp = v.filter('lowpass', 200, 4.5, pre);
  lp.frequency.setValueAtTime(220, T);
  lp.frequency.exponentialRampToValueAtTime(700 + 1300 * vel, T + 0.012);
  lp.frequency.exponentialRampToValueAtTime(520, T + 0.22);
  v.osc('sawtooth', f, T, end + 0.01, lp);
  const sq = v.osc('square', f, T, end + 0.01, lp); sq.detune.value = -8;
  const sub = v.gain(0.6, g); v.osc('sine', f, T, end + 0.01, sub);
  return end;
}

// 【电吉他】fs 是一串频率(和弦音),每个音双振荡器 ±7 音分失谐(合唱感)过失真;mute=true 时闷音(短 gate、低通)。
// 和弦音数量越多自动等比摊薄音量(pre = 0.42/√n),防止大和弦炸音量。
export function guitar(v, T, fs, gate, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const end = adsr(g.gain, T, 0.003, 0.35, o.mute ? 0.25 : 0.7, vel, gate, o.mute ? 0.04 : 0.09);
  const hp = v.filter('highpass', 110, 0.7, g);
  const pk = v.filter('peaking', 1900, 1.1, hp, 4);
  const lp = v.filter('lowpass', o.mute ? 1500 : 3600, 0.9, pk);
  const sh = v.shaper(o.drive ?? 5.5, lp);
  const pre = v.gain(0.42 / Math.sqrt(fs.length), sh);
  for (const f of fs) for (const dt of [-7, 6]) { const x = v.osc('sawtooth', f, T, end + 0.01, pre); x.detune.value = dt; }
  return end;
}

// 【FM 电钢琴】sine 载波 + sine 调制波(Modulator Gain 指数衰减)→ 经典的 Rhodes 叮咚音色,
// 力度越大调制指数越大(越亮),再叠 7 倍频短音做锤击感。
export function keys(v, T, f, gate, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const end = adsr(g.gain, T, 0.003, 1.3, 0.3, vel, gate, o.r ?? 0.3);
  const car = v.osc('sine', f, T, end + 0.01, g);
  const mg = v.gain(0); mg.connect(car.frequency);
  v.osc('sine', f, T, end + 0.01, mg);
  mg.gain.setValueAtTime(f * (1.4 + 1.2 * vel), T);
  mg.gain.exponentialRampToValueAtTime(f * 0.18, T + 0.7);
  v.tone({ at: T, f: Math.min(f * 7, 9000), a: 0.001, d: 0.09, peak: vel * 0.07, to });
  return end;
}

// 【铺底 pad】双锯齿 ±10 音分失谐过长 sustain + 低通(默认 1.5kHz),慢起音——和声背景毯。
export function pad(v, T, f, gate, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const end = adsr(g.gain, T, o.a ?? 0.25, 0.6, 0.8, vel, gate, o.r ?? 0.5);
  const lp = v.filter('lowpass', o.cut ?? 1500, 0.9, g);
  for (const dt of [-11, 10]) { const x = v.osc('sawtooth', f, T, end + 0.01, lp); x.detune.value = dt; }
  return end;
}

// 【拨弦 pluck】Karplus-Strong 思路:低通截止从 5.2kHz 快速滑到 520Hz——起音亮、余音"咚咚"衰减。
export function pluck(v, T, f, gate, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const end = perc(g.gain, T, 0.002, vel, o.d ?? 0.3);
  const lp = v.filter('lowpass', 1000, o.q ?? 4, g);
  sweep(lp.frequency, T, o.f0 ?? 5200, o.f1 ?? 520, o.fd ?? 0.16);
  v.osc(o.wave || 'sawtooth', f, T, end + 0.01, lp);
  if (o.sq) { const s = v.gain(0.5, lp); v.osc('square', f * 2, T, end + 0.01, s); }
  return end;
}

// 【铃 bell】FM(载波 + 3.5 倍频调制,指数衰减)+ 2.01 倍频陪音——非整数倍泛音带来金属"叮"声,适合胜利结算。
export function bell(v, T, f, vel = 1, o = {}) {
  const to = o.to || v.out;
  const d = o.d ?? 0.9;
  const g = v.gain(0, to);
  const end = perc(g.gain, T, 0.001, vel, d);
  const car = v.osc('sine', f, T, end + 0.01, g);
  const mg = v.gain(0); mg.connect(car.frequency);
  v.osc('sine', f * (o.ratio ?? 3.5), T, end + 0.01, mg);
  mg.gain.setValueAtTime(f * (o.index ?? 1.6), T);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, T + d * 0.6);
  v.tone({ at: T, f: f * 2.01, a: 0.001, d: d * 0.4, peak: vel * 0.25, to });
  return end;
}

// 【铜管 brass】三锯齿(-9/0/+9 音分,起音瞬间整体下压 45 音分再释放——模拟吹奏的气息冲击)
// 过低通,起音时截止 380→3000Hz 快速打开(吐音),随后回落。
export function brass(v, T, f, gate, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const end = adsr(g.gain, T, o.a ?? 0.022, 0.3, 0.72, vel / 2.2, gate, o.r ?? 0.2);
  const lp = v.filter('lowpass', 400, 1.3, g);
  const fc = o.bright ?? 3000;
  lp.frequency.setValueAtTime(380, T);
  lp.frequency.exponentialRampToValueAtTime(fc, T + 0.05);
  lp.frequency.exponentialRampToValueAtTime(fc * 0.55, T + 0.35);
  for (const dt of [-9, 0, 9]) {
    const x = v.osc('sawtooth', f, T, end + 0.01, lp);
    x.detune.setValueAtTime(dt - 45, T); x.detune.linearRampToValueAtTime(dt, T + 0.05);
  }
  return end;
}

// 【主音 lead】四种风格:o.style:
//   'pulse' 脉冲波(默认,圆亮) | 'saw' 双锯齿失谐(粗) | 'soft' 三角+气声(长笛/口哨) | 'square' 方波
//   音长超过 0.18s 自动加颤音(LFO 打 detune);o.glide 给滑音起始频率。
export function lead(v, T, f, gate, vel = 1, o = {}) {
  const to = o.to || v.out, style = o.style || 'pulse';
  const g = v.gain(0, to);
  const soft = style === 'soft';
  const end = adsr(g.gain, T, soft ? 0.03 : 0.006, 0.18, soft ? 0.85 : 0.72, vel, gate, soft ? 0.14 : 0.1);
  const lp = v.filter('lowpass', soft ? 2600 : style === 'saw' ? 3000 : 3800, 1.1, g);
  const oscs = [];
  if (style === 'saw') { for (const dt of [-6, 6]) { const x = v.osc('sawtooth', f, T, end + 0.01, lp); x.detune.value = dt; oscs.push(x); } }
  else if (soft) {
    oscs.push(v.osc('triangle', f, T, end + 0.01, lp));
    const s2 = v.gain(0.35, lp); oscs.push(v.osc('sine', f * 2, T, end + 0.01, s2));
    v.nz({ at: T, ft: 'bandpass', f: Math.min(f * 2, 8000), q: 2, a: 0.02, d: Math.max(0.05, gate * 0.6), peak: vel * 0.06, to });
  } else if (style === 'square') oscs.push(v.osc('square', f, T, end + 0.01, lp));
  else oscs.push(v.osc(pulseWave(v.ctx, 0.25), f, T, end + 0.01, lp));
  if (o.glide) for (const x of oscs) sweep(x.frequency, T, o.glide, x.frequency.value, 0.045);
  if (gate > 0.18) {
    const lg = v.gain(0);
    lg.gain.setValueAtTime(0, T); lg.gain.linearRampToValueAtTime(o.vib ?? 14, T + Math.min(gate, 0.35));
    v.osc('sine', o.vibRate ?? 5.6, T, end + 0.01, lg);
    for (const x of oscs) lg.connect(x.detune);
  }
  return end;
}

// 【riser 上滑音效】带通噪声 350→7000Hz 扫频 + 锯齿上滑,包络"慢起陡收"——段落切换前蓄势的"呜——"声。
export function riser(v, T, dur, vel = 1, o = {}) {
  const to = o.to || v.out;
  const g = v.gain(0, to);
  const bp = v.filter('bandpass', 400, 2.5, g);
  sweep(bp.frequency, T, 350, 7000, dur);
  pts(g.gain, T, [[0, 0], [dur * 0.9, vel], [dur, vel * 0.8], [dur + 0.02, 0]]);
  v.noise('white', T, T + dur + 0.05, bp);
  const tg = v.gain(0, to);
  pts(tg.gain, T, [[0, 0], [dur, vel * 0.08], [dur + 0.02, 0]]);
  const x = v.osc('sawtooth', 220, T, T + dur + 0.05, v.filter('lowpass', 3000, 1, tg));
  sweep(x.frequency, T, 180, 1400, dur);
}

/* ============================================================================================================
 * Song DSL
 *  - chords: one symbol per bar ('Em7', 'C5', 'Bb/D', 'C7sus4 C7' = two chords splitting the bar)
 *  - drums (16 chars / bar): k kick, s snare, c clap, h hats, x crash, p rim, sh shaker, t tom
 *      'X' accent · 'x' normal · 'g' ghost · hats: 'c' soft closed, 'o'/'O' open · '.' rest
 *  - bass (16 chars): R root, r ghost root, O octave, o ghost octave, 5 fifth, L fifth below, 3 third, 7 seventh,
 *      4 fourth, 6 sixth, b root-1, a root+2, n approach (next bar's root - 1), '-' hold, '.' rest
 *  - stabs (16 chars): X accent, x normal, m muted, '-' hold, '.' rest   (instrument = song.inst.chords)
 *  - lead / lead2 / riff phrases: "E5/2 G5/2 r/1 _/2 | ..."  (note/len-in-16ths, r rest, _ tie, ! accent, | bar check)
 *  - arp: { rate: 1|2 (16th|8th), pattern: 'up'|'down'|'updown', oct: 1..3, lo: midi }
 * ==========================================================================================================*/

// ------------------------------------------------------------------------------------------------------------
// 【乐谱 DSL 速查(新手必读)】一首歌就是一个 JS 对象(SONGS 表),所有声部都是"文本 → 编译"。
//
// 通用约定:一条 pattern 字符串 = 一小节的 16 个十六分音符步进(step 0..15),字符即指令。
//
// 【鼓组】drums: { k: 模式, s: 模式, ... }(每种乐器 16 字符;给数组则逐小节轮换)
//   字符 → 力度(VEL 表):
//     X = 重击(1.0)   x = 正常(0.8)   g = 鬼音/弱奏(0.35)   c = 轻闭镲(0.55)
//     o = 开镲正常(0.8) O = 开镲重击(1.0)  m = 闷音(0.6)  r = 弱根音(0.45,贝斯用)
//     . = 休止  - = 保持(延长上一个音)
//   乐器键:k 底鼓 s 军鼓 c 拍手 h 踩镲 x 吊镲 p 边击 sh 沙锤 t 嗵鼓
//   fills: 单独写最后一小节的加花(军鼓滚奏 'x.x.x.x.xxxxXXXX' 是招牌)。
//
// 【贝斯】bass: 16 字符,但每个字符是一条【和声指令】(不是固定音高!):
//     R = 和弦根音      r = 根音(弱)     O = 根音高八度   o = 高八度(弱)
//     5 = 五度          L = 低五度         3 = 三度(随和弦性质自动大小三) 7 = 七度
//     4 = 四度          6 = 六度           b = 根音-1 半音  a = 根音+2 半音
//     n = 引导音(下一小节根音-1 半音,平滑过渡到下一段)   - = 延长  . = 休止
//   【为什么这样设计】:换和弦时贝斯线自动跟着变,同一套 pattern 可以复用在整首歌。
//
// 【旋律】lead / lead2 / riff: 文本乐句 "B4/2 E5/2 r/1"
//     音名/长度(十六分音符个数)   r = 休止   _ = 连音线(接长上一个音)   ! = 重音   | = 小节线(仅校验对齐)
//
// 【和弦垫与琶音】stabs: 16 字符(X/x/m/./-);pad: true 每个和弦段一个长音;
//   arp: { rate, pattern('up'|'down'|'updown'), oct, lo } 按和弦自动分解。
// ------------------------------------------------------------------------------------------------------------

// 【音名 → 音级(pc)】C=0, D=2 … B=11,加 # 升 1、加 b 降 1。
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11], 9: [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], add9: [0, 4, 7, 14],
  sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], dim: [0, 3, 6], m7b5: [0, 3, 6, 10], aug: [0, 4, 8],
};
// 【音级求值】取音名字符串(如 'Bb')→ 0..11 的音级。pcOf 的辅助:只看第一个字母 + 升降号。
function pcOf(s) { return (PC[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12; }
// 【文本音名 → midi 号】'B4' → 71, 'F#5' → 78。parsePhrase 的音符都先过这里。
export function parseNote(s) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) return null;
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
// 【和弦符号解析】'Bb/D' → { root: 10, iv: 和弦内音程表, bass: 转位低音 }。
// QUAL 表把 'm7'、'sus4' 等性质映射成相对根音的音程集合;结果按符号缓存(编译时反复用)。
const chordCache = new Map();
export function parseChord(sym) {
  let c = chordCache.get(sym);
  if (c) return c;
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m) throw new Error('bad chord ' + sym);
  const root = pcOf(m[1]);
  const iv = QUAL[m[2]];
  if (!iv) throw new Error('bad chord quality ' + sym);
  c = { sym, root, iv, bass: m[3] ? pcOf(m[3]) : root };
  chordCache.set(sym, c);
  return c;
}
// 【把音级落进指定音域】lo 以上、不超过一个八度的最低同音级 midi 音(贝斯/和弦排位的基石)。
function inRange(pc, lo) { let n = lo + ((pc - lo) % 12 + 12) % 12; return n; }
// close voicing of chord tones within [lo, lo+maxSpan)
// 【密集排列(voicing)】把和弦内音全部排到 [lo, hi) 区间并排序——键盘/铺底一次按下的那组音。
function voice(ch, lo, hi) {
  const r = inRange(ch.root, lo);
  const out = [];
  for (const i of ch.iv) { let n = r + i; while (n > hi) n -= 12; if (!out.includes(n)) out.push(n); }
  return out.sort((a, b) => a - b);
}
// 【强力和弦】根音 + 五度 + 八度(摇滚吉他强力和弦,砍掉了三度,空而猛)。
function powerChord(ch, lo) { const r = inRange(ch.root, lo); return [r, r + 7, r + 12]; }
// 【和声层】给旋律音 m 找下方 3..9 半音内最近的和弦音(三度/五度/七度)——主旋律的自动和声伴唱。
function harmBelow(m, ch) {
  for (let d = 3; d <= 9; d++) {
    const pc = (((m - d) % 12) + 12) % 12;
    if (ch.iv.some((i) => (ch.root + i) % 12 === pc)) return m - d;
  }
  return m - 12;
}

// 【文本乐句 → 事件列表】parsePhrase('B4/2 E5/2 r/1 _/2 | …'):
//   每个 token = 音名/长度(十六分音符数),可选 '!' 重音;'_' 把上一个音符接长(连音线);
//   '|' 只是小节线,用来校验有没有写对齐(总长必须是 16 的倍数)。乐句可以跨多个小节循环。
function parsePhrase(str, warn, label) {
  const ev = [];
  let pos = 0, lastNote = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '|') { if (pos % 16) warn.push(`${label}: bar line at step ${pos} (not a bar boundary)`); continue; }
    const m = /^(r|_|[A-G][#b]?-?\d)\/(\d+)(!?)$/.exec(tok);
    if (!m) { warn.push(`${label}: bad token '${tok}'`); continue; }
    const len = +m[2];
    if (m[1] === 'r') lastNote = null;
    else if (m[1] === '_') { if (lastNote) lastNote.len += len; }
    else { lastNote = { s: pos, len, m: parseNote(m[1]), acc: !!m[3] }; ev.push(lastNote); }
    pos += len;
  }
  if (pos % 16) warn.push(`${label}: phrase length ${pos} steps is not whole bars`);
  return { ev, len: pos };
}

// 【鼓键位表】乐谱里的单字符键 → 乐器函数名(顺序无关,只用于遍历)。
const DRUMS = [['k', 'kick'], ['s', 'snare'], ['c', 'clap'], ['h', 'hat'], ['x', 'crash'], ['p', 'rim'], ['sh', 'shaker'], ['t', 'tom']];
// 【取某小节的 pattern】字符串 → 逐小节用;数组 → 轮流;最后一小节若写了 fills 则用加花替代。
function patFor(src, b, nbars, fill) {
  if (fill !== undefined && b === nbars - 1) return fill;
  if (src == null) return null;
  return typeof src === 'string' ? src : src[b % src.length];
}
// 【字符 → 力度表】pattern 字符到力度(0..1)的统一映射,鼓/贝斯/stabs 共用(见 DSL 速查表)。
const VEL = { X: 1, O: 1, x: 0.8, o: 0.8, c: 0.55, g: 0.35, m: 0.6, r: 0.45 };

// 【乐谱编译器——整个系统的中枢】把 SONGS 里的"文本乐谱"一次性展开成事件表:
//   输出 bars: [{ sec, bar, ev: [step0 事件[], step1 事件[], … 共 16 步], chords }]
//   每个事件 { i: 乐器名, m: midi 音(鼓无), len: 时值(步), v: 力度, … }。
// 编译期把所有"乐理"算死:和弦音级、贝斯指令映射、琶音序列、和声伴唱、循环点(loopFrom→小节序号)、
// 小节末引导音(n 要偷看下一段的和弦)——运行时 pump() 只查表,不做任何乐理计算。
export function compileSong(def) {
  const warn = [];
  const bars = [];
  const secStart = {};
  // phrases per section
  const phr = {};
  for (const [name, sec] of Object.entries(def.sections)) {
    phr[name] = {};
    for (const k of ['lead', 'lead2', 'riff']) if (sec[k]) phr[name][k] = parsePhrase(sec[k], warn, `${def.name}.${name}.${k}`);
  }
  def.order.forEach((secName, oi) => {
    const sec = def.sections[secName];
    if (!sec) { warn.push('missing section ' + secName); return; }
    // 【段落起点表】loopFrom 写的是"第几段",这里换算成全局小节号存进 secStart
    if (!(oi in secStart)) secStart[oi] = bars.length;
    const nb = sec.bars;
    // 【和弦行】本小节的和弦符号('C7sus4 C7' 两个和弦就把 16 步平分),算好每段的起止 step
    const chordRow = (b) => {
      const syms = (sec.chords ? sec.chords[b % sec.chords.length] : 'C').split(/\s+/);
      return syms.map((s, i) => ({ ch: parseChord(s), s0: Math.floor((i * 16) / syms.length), s1: Math.floor(((i + 1) * 16) / syms.length) }));
    };
    for (let b = 0; b < nb; b++) {
      const ev = Array.from({ length: 16 }, () => []);
      const row = chordRow(b);
      // 【跨小节偷看】最后一小节要拿"下一段第一个和弦"(或回 loopFrom 段),贝斯引导音 n 和 riser 需要它
      const nextRow = b + 1 < nb ? chordRow(b + 1) : (() => {
        const ns = def.sections[def.order[oi + 1] ?? def.order[def.loopFrom ?? 0]];
        const sym = ns?.chords ? ns.chords[0].split(/\s+/)[0] : row[0].ch.sym;
        return [{ ch: parseChord(sym), s0: 0, s1: 16 }];
      })();
      const chordAt = (s) => (row.find((r) => s >= r.s0 && s < r.s1) || row[0]).ch;
      // drums
      for (const [k, inst] of DRUMS) {
        const p = patFor(sec.drums?.[k], b, nb, sec.fills?.[k]);
        if (!p) continue;
        if (p.length !== 16) warn.push(`${def.name}.${secName}.${k} bar ${b}: pattern length ${p.length}`);
        for (let s = 0; s < 16; s++) {
          const ch = p[s];
          if (ch === '.' || ch === undefined || ch === '-') continue;
          const e = { i: inst, v: VEL[ch] ?? 0.8 };
          if (inst === 'hat') { e.open = ch === 'o' || ch === 'O'; }
          if (inst === 'tom') e.m = 45 + (s % 3) * 4;
          ev[s].push(e);
        }
      }
      // bass
      // 【贝斯指令 → midi 音】按当前和弦换算;三度/七度随和弦性质自动取大小;
      // 'n' 用 nextRow 算下一小节根音 -1 半音,且若比当前根音高太多就降八度(保证引导音向下/就近走)
      const bp = patFor(sec.bass, b, nb, sec.fills?.bass);
      if (bp) {
        if (bp.length !== 16) warn.push(`${def.name}.${secName}.bass bar ${b}: pattern length ${bp.length}`);
        const lo = def.bassLo ?? 28;
        for (let s = 0; s < 16; s++) {
          const c = bp[s];
          if (c === '.' || c === '-') continue;
          const ch = chordAt(s);
          const r = inRange(ch.bass, lo);
          const third = ch.iv.includes(3) ? 3 : ch.iv.includes(4) ? 4 : 7;
          const sev = ch.iv.includes(11) ? 11 : 10;
          let m;
          switch (c) {
            case 'R': case 'r': m = r; break;
            case 'O': case 'o': m = r + 12; break;
            case '5': m = r + 7; break;
            case 'L': m = r - 5; break;
            case '3': m = r + third; break;
            case '7': m = r + sev; break;
            case '4': m = r + 5; break;
            case '6': m = r + 9; break;
            case 'b': m = r - 1; break;
            case 'a': m = r + 2; break;
            case 'n': { const nr = inRange(nextRow[0].ch.bass, lo); m = nr - 1; if (m - r > 7) m -= 12; break; }
            default: warn.push(`${def.name}.${secName}.bass: bad token ${c}`); continue;
          }
          let len = 1;
          while (s + len < 16 && bp[s + len] === '-') len++;
          ev[s].push({ i: 'bass', m, len, v: c === 'r' || c === 'o' ? 0.5 : 0.85 + (s % 4 === 0 ? 0.15 : 0) });
        }
      }
      // chord stabs
      const sp = patFor(sec.stabs, b, nb, sec.fills?.stabs);
      if (sp) {
        if (sp.length !== 16) warn.push(`${def.name}.${secName}.stabs bar ${b}: pattern length ${sp.length}`);
        for (let s = 0; s < 16; s++) {
          const c = sp[s];
          if (c === '.' || c === '-') continue;
          let len = 1;
          while (s + len < 16 && sp[s + len] === '-') len++;
          const ch = chordAt(s);
          const ms = def.inst.chords === 'guitar' ? powerChord(ch, def.guitarLo ?? 40) : voice(ch, def.keysLo ?? 55, (def.keysLo ?? 55) + 19);
          ev[s].push({ i: 'chords', ms, len, v: VEL[c] ?? 0.8, mute: c === 'm' });
        }
      }
      // pad: one sustained chord per chord segment
      if (sec.pad) for (const seg of row) ev[seg.s0].push({ i: 'pad', ms: voice(seg.ch, def.padLo ?? 52, (def.padLo ?? 52) + 20), len: seg.s1 - seg.s0, v: 0.8 });
      // arp
      // 【琶音】按和弦生成 up/down/updown 序列(可跨 oct 个八度),全局步进序号对序列长度取模——
      // 因此琶音跨小节是连续流动的,不受小节线打断
      if (sec.arp) {
        const a = sec.arp, rate = a.rate || 1;
        for (let s = 0; s < 16; s += rate) {
          const ch = chordAt(s);
          const tones = voice(ch, a.lo ?? 64, (a.lo ?? 64) + 11);
          let seq = [];
          for (let o = 0; o < (a.oct || 1); o++) for (const t of tones) seq.push(t + 12 * o);
          if (a.pattern === 'down') seq.reverse();
          else if (a.pattern === 'updown') seq = seq.concat(seq.slice(1, -1).reverse());
          const idx = Math.floor((b * 16 + s) / rate) % seq.length;
          ev[s].push({ i: 'arp', m: seq[idx], len: rate, v: s % 4 === 0 ? 0.95 : 0.7 });
        }
      }
      // phrases
      // 【旋律铺排】乐句长度不一定是 16:按 base 逐段对齐到本小节窗口,取落在窗口内的音符。
      // 同时按需生成和声伴唱(harmony):主旋律下方最近的和弦音,作为 lead2 声部。
      for (const k of ['lead', 'lead2', 'riff']) {
        const ph = phr[secName][k];
        if (!ph || !ph.len) continue;
        const from = b * 16, to = from + 16;
        for (let base = Math.floor(from / ph.len) * ph.len; base < to; base += ph.len) {
          for (const n of ph.ev) {
            const at = base + n.s;
            if (at >= from && at < to) {
              ev[at - from].push({ i: k, m: n.m, len: n.len, v: n.acc ? 1 : 0.85 });
              // harmony layer: nearest chord tone 3..9 semitones below the melody
              if (k === 'lead' && sec.harmony) ev[at - from].push({ i: 'lead2', m: harmBelow(n.m, chordAt(at - from)), len: n.len, v: 0.8 });
            }
          }
        }
      }
      // fx
      // 【段落音效】段首吊镲;riser 从小节 0 开始铺、长度 = riser 个小节(跨小节长音的范例)
      if (sec.crash && b === 0) ev[0].push({ i: 'crash', v: 0.75 });
      if (sec.riser && b === nb - (sec.riser | 0 || 1)) ev[0].push({ i: 'riser', len: 16 * (sec.riser | 0 || 1), v: 0.9 });
      bars.push({ sec: secName, bar: b, ev, chords: row.map((r) => r.ch.sym) });
    }
  });
  // 【成品】bars 事件表 + loopFrom(段落序号 → 全局小节号,运行时循环就靠它)+ 编译告警(乐谱写错时打控制台)
  return { ...def, bars, loopFrom: secStart[def.loopFrom ?? 0] ?? 0, warnings: warn };
}

/* ============================================================================================================
 * Songs (original compositions)
 * ==========================================================================================================*/

// ---- 旋律乐句常量(文本记谱,语法见 parsePhrase / DSL 速查)----
// 战斗曲 A 段主旋律:E 小调,问答式短句(附点节奏 + 十六分冲刺)
const BATTLE_A_LEAD =
  'B4/2 E5/2 r/1 E5/1 G5/2 F#5/2 E5/2 D5/2 B4/2 | E5/3 G5/3 B5/2 A5/2 G5/2 E5/4 | r/2 A4/1 C5/1 E5/2 A5/2 G5/2 E5/2 C5/2 D5/2 | D#5/3 F#5/3 A5/2 B5/6 r/2 | ' +
  'B4/2 E5/2 r/1 E5/1 G5/2 F#5/2 E5/2 D5/2 B4/2 | E5/3 G5/3 B5/2 A5/2 G5/2 E5/4 | r/2 A4/1 C5/1 E5/2 A5/2 G5/2 E5/2 C5/2 D5/2 | F#5/2 E5/2 D#5/2 B4/2 D#5/4 F#5/4';
// 战斗曲 B 段主旋律:更上扬,结尾爬到 D6/E6 高点再回落
const BATTLE_B_LEAD =
  'G5/4 E5/2 G5/2 A5/4 G5/4 | F#5/4 D5/2 F#5/2 A5/6 r/2 | B5/3 A5/3 F#5/2 D5/4 F#5/4 | G5/6 F#5/2 E5/8 | ' +
  'G5/4 E5/2 G5/2 C6/4 B5/4 | A5/4 F#5/2 A5/2 D6/6 r/2 | E6/4 D6/4 B5/4 A5/4 | A5/2 G5/2 F#5/2 D#5/2 F#5/8';
// 标题曲低音乐句(D 小调吉他式 riff,降 G 是蓝调色彩音)
const TITLE_RIFF = 'D3/2 r/1 D3/1 F3/2 D3/1 G3/2 Ab3/1 G3/2 F3/2 D3/2 | C4/2 D4/2 r/2 A3/1 C4/1 D4/4 r/2 F3/2';
// 标题曲主旋律:萨克斯感的宣言式乐句
const TITLE_LEAD =
  'D5/2 F5/2 G5/3 F5/1 D5/2 C5/2 Bb4/4 | D5/2 F5/2 Bb5/4 A5/2 F5/2 D5/2 C5/2 | C5/4 A4/2 C5/2 F5/4 E5/4 | E5/3 C#5/3 A4/2 G5/4 E5/4 | ' +
  'D5/2 F5/2 G5/3 F5/1 D5/2 C5/2 Bb4/4 | D5/2 F5/2 Bb5/4 A5/2 F5/2 D5/2 C5/2 | C5/4 A4/2 C5/2 F5/4 E5/4 | A4/2 C#5/2 E5/2 G5/2 A5/8';
// 主菜单 A 段主旋律(F 大调,慵懒摇曳的休闲感)
const MENU_A_LEAD =
  'A5/3 G5/1 F5/2 E5/2 F5/4 r/4 | E5/2 G5/2 C6/3 D6/1 C6/2 A5/2 r/4 | D6/3 C6/1 A5/2 F5/2 A5/4 G5/4 | F5/2 G5/2 Bb5/4 A5/2 G5/2 E5/4 | ' +
  'A5/3 G5/1 F5/2 E5/2 F5/4 r/4 | E5/2 G5/2 C6/3 D6/1 C6/2 A5/2 r/4 | D6/3 C6/1 A5/2 F5/2 A5/2 C6/2 Bb5/2 G5/2 | G5/4 F5/4 E5/8';
// 主菜单 B 段主旋律(更流动,像是第二杯鸡尾酒上桌)
const MENU_B_LEAD =
  'F5/2 A5/2 C6/2 A5/2 G5/4 F5/4 | D5/2 F5/2 Bb5/3 A5/1 G5/4 r/4 | F5/2 A5/2 D6/4 C6/2 A5/2 F5/4 | E5/4 G5/4 Bb5/4 A5/4 | ' +
  'F5/2 A5/2 C6/2 A5/2 G5/4 F5/4 | D5/2 F5/2 Bb5/3 A5/1 G5/4 r/4 | F5/2 A5/2 D6/4 E5/2 G5/2 Bb5/4 | A5/12 r/4';
// 胜利结算主旋律(G 大调,明亮大跳 + 上行,欢腾收场)
const WIN_LEAD =
  'D5/2 G5/2 B5/2 A5/2 G5/4 D5/4 | E5/2 G5/2 B5/2 D6/2 B5/8 | C6/3 B5/1 G5/2 E5/2 G5/4 D5/4 | F#5/2 A5/2 D6/4 C6/2 A5/2 F#5/4 | ' +
  'D5/2 G5/2 B5/2 A5/2 G5/4 D5/4 | F#5/2 B5/2 D6/2 F#6/2 D6/8 | E6/3 D6/1 B5/2 G5/2 C6/4 B5/4 | A5/4 G5/4 A5/2 B5/2 A5/2 F#5/2';
// 失败结算主旋律(A 小调,长音下行,怅然但不绝望)
const LOSE_LEAD =
  'E5/6 D5/2 C5/4 B4/4 | C5/6 A4/2 C5/4 E5/4 | F5/6 E5/2 D5/4 C5/4 | B4/8 G#4/8 | ' +
  'E5/6 D5/2 C5/4 B4/4 | C5/6 A4/2 C5/4 E5/4 | F5/4 A5/4 G5/4 F5/4 | E5/12 r/4';

// Boss 一/二阶段低音乐句(D 小调,重金属式chug;G# 是移调暗示)
const BOSS_RIFF = 'D3/2 D3/1 D3/1 F3/2 D3/2 E3/1 F3/1 A3/2 G#3/2 G3/2 | D3/2 D3/1 D3/1 F3/2 D3/2 C4/2 A3/2 Bb3/2 A3/2';
// Boss 三阶段低音乐句(加入 Eb,Phrygian 色彩的紧张感)
const BOSS_RIFF3 = 'D3/1 D3/1 Eb3/2 D3/1 D3/1 A3/2 Ab3/2 D3/1 D3/1 C4/2 Bb3/2 | D3/1 D3/1 Eb3/2 D3/1 D3/1 F3/2 E3/2 Eb3/2 D3/4';
// Boss 一/二阶段主旋律(D 小调,硬朗的模进短句)
const BOSS_A_LEAD =
  'D5/3 F5/3 A5/2 G5/2 F5/2 E5/2 C5/2 | D5/4 Bb4/4 F5/4 D5/4 | E5/3 G5/3 C6/2 Bb5/2 A5/2 G5/4 | A5/6 G5/2 E5/2 C#5/2 E5/4 | ' +
  'D5/3 F5/3 A5/2 G5/2 F5/2 E5/2 C5/2 | D5/4 Bb4/4 F5/4 Bb5/4 | C6/3 Bb5/3 A5/2 G5/2 E5/2 C5/4 | C#5/4 E5/4 A5/4 C#6/4';
// Boss 二阶段主旋律(转向更暗的 Gm/Bb,和声更丰富)
const BOSS_B_LEAD =
  'G5/4 Bb5/4 A5/2 G5/2 F5/4 | A5/6 F5/2 D5/8 | Eb5/2 G5/2 Bb5/4 C6/2 Bb5/2 G5/4 | A5/4 C#6/4 E6/4 A5/4 | ' +
  'G5/4 Bb5/4 D6/2 C6/2 Bb5/4 | A5/6 F5/2 D5/4 F5/4 | G5/2 Bb5/2 Eb6/4 D6/2 C6/2 Bb5/4 | A5/2 G5/2 F5/2 E5/2 C#5/4 E5/4';
// Boss 三阶段主旋律(高音区疾走,Eb 与 C#dim 把不安推到顶)
const BOSS_C_LEAD =
  'D6/2 C6/2 A5/2 F5/2 A5/4 D6/4 | Eb6/3 D6/3 Bb5/2 G5/4 Bb5/4 | A5/2 F5/2 D5/2 F5/2 A5/2 D6/2 F6/4 | E6/4 C#6/4 Bb5/4 G5/4 | ' +
  'D6/2 C6/2 A5/2 F5/2 A5/4 D6/4 | Eb6/3 G6/3 F6/2 Eb6/4 D6/4 | C6/2 A5/2 F5/2 A5/2 D6/4 C#6/4 | E6/6 D6/2 C#6/8';

// 【曲目表】游戏内全部原创曲。每个条目:bpm/swing(摇摆)/key/段落(sections)/播放顺序(order)/循环点(loopFrom)。
export const SONGS = {
  // 【title】启动画面曲:快节奏朋克摇滚,宣言式的"开机即燃"。
  title: {
    name: 'Splash Attitude', bpm: 128, swing: 0.05, key: 'D minor', pump: 0.22,
    inst: { bass: 'punk', chords: 'guitar', lead: 'saw', arp: 'pluck' }, riffBass: true,
    sections: {
      intro: {
        bars: 4, chords: ['Dm'], riff: TITLE_RIFF, riser: 1,
        drums: {
          k: ['................', '................', 'X.......X.......', 'X.......X.......'],
          h: ['................', '................', 'x.c.x.c.x.c.x.c.', 'x.c.x.c.x.c.x.c.'],
          s: ['................', '................', '................', 'x.x.x.x.xxxxXXXX'],
        },
      },
      A: {
        bars: 8, crash: true, chords: ['Dm'], riff: TITLE_RIFF,
        drums: { k: 'X.....x.X.x.....', s: '....X.......X...', c: '....x.......x...', h: 'x.c.x.c.x.c.x.oc' },
        fills: { s: '....X.......X.xx' },
      },
      B: {
        bars: 8, crash: true, chords: ['Gm7', 'Bb', 'F/A', 'A7'], pad: true, lead: TITLE_LEAD,
        drums: { k: 'X.....x.X.x...x.', s: '....X.......X...', c: '....x.......x...', h: 'x.o.x.o.x.o.x.o.' },
        bass: 'R.RR..O.R.RR..5n',
        stabs: 'X--.x-..X--.x-x.',
      },
      break: {
        bars: 4, chords: ['Dm', 'Bb', 'C', 'A7'], pad: true, riser: 1,
        drums: { k: 'X.......X.......', h: 'x.x.x.x.x.x.x.x.' }, fills: { s: 'x.x.x.x.xxxxXXXX' },
        bass: 'R-------R---5---',
        arp: { rate: 1, pattern: 'updown', oct: 2, lo: 62 },
      },
    },
    order: ['intro', 'A', 'B', 'A', 'break', 'B'], loopFrom: 1,
  },

  // 【menu】主菜单/大厅曲:105bpm 放克,F 大调 —— 休闲港湾的慵懒摇曳(摇摆值最大的一首)。
  menu: {
    name: 'Harbor Lounge', bpm: 105, swing: 0.16, key: 'F major', pump: 0,
    inst: { bass: 'funk', chords: 'keys', lead: 'soft', arp: 'pluck' }, keysLo: 57, bassLo: 31,
    mix: { kick: 0.5, snare: 0.3, hats: 0.14, bass: 0.38, chords: 0.32, pad: 0.07, lead: 0.26, arp: 0.08 },
    sections: {
      intro: { bars: 2, chords: ['Fmaj7', 'C7sus4'], stabs: ['X-------------..', 'X-------x-----..'], drums: { sh: '..x...x...x...x.' } },
      A: {
        bars: 8, chords: ['Fmaj7', 'Am7', 'Bbmaj7', 'C7sus4 C7'], lead: MENU_A_LEAD,
        drums: { k: 'X......x..X.....', s: '....x.......x...', p: '..........g....g', h: 'x.c.x.c.x.c.x.cc', sh: 'xcxcxcxcxcxcxcxc' },
        bass: ['R..r.R5.O..R.53.', 'R..r.R5.O..R.5.n'],
        stabs: 'X--..x-..x--.x-.',
      },
      B: {
        bars: 8, chords: ['Dm7', 'Gm7', 'Bbmaj7', 'C9', 'Dm7', 'Gm7', 'Bbmaj7 C7', 'Fmaj7'], lead: MENU_B_LEAD, pad: true,
        drums: { k: 'X......x..X..x..', s: '....x.......x...', h: 'x.o.x.c.x.o.x.cc', sh: 'xcxcxcxcxcxcxcxc' },
        bass: 'R..r.R5.O..R.5.n',
        stabs: 'X--..x-..x--.x-.',
      },
    },
    order: ['intro', 'A', 'B', 'A'], loopFrom: 1,
  },

  // 【battle】常规对战曲:150bpm 朋克,E 小调 —— 战斗的主力燃曲(有录音时改播录音洗牌)。
  battle: {
    name: 'Turf Riot', bpm: 150, swing: 0, key: 'E minor', pump: 0.28,
    inst: { bass: 'punk', chords: 'guitar', lead: 'pulse', lead2: 'saw', arp: 'pluck' },
    sections: {
      intro: {
        bars: 2, chords: ['E5', 'C5 D5'], riser: 1,
        drums: { k: ['X...............', 'X.......X.......'], s: ['................', 'x.x.x.x.xxxxXXXX'], x: ['X...............', '................'] },
        bass: ['R---------------', 'R-------R-------'],
        stabs: ['X---------------', 'X-------X-------'],
      },
      A: {
        bars: 8, crash: true, chords: ['Em7', 'Cmaj7', 'Am7', 'B7'], lead: BATTLE_A_LEAD,
        drums: { k: 'X..x..x.X.....x.', s: '....X.....g.X..g', h: 'x.c.x.c.x.c.x.oc' },
        fills: { s: '....X.....g.X.xx' },
        bass: ['R.RO.RR.5.RO.R7.', 'R.RO.RR.5.RO.5On'],
        stabs: 'X-.x..x-.x..x-.x',
        arp: { rate: 1, pattern: 'up', oct: 1, lo: 64 },
      },
      B: {
        bars: 8, crash: true, chords: ['C', 'D', 'Bm', 'Em', 'C', 'D', 'B7sus4', 'B7'], lead: BATTLE_B_LEAD, pad: true,
        drums: { k: 'X...x...X...x...', s: '....X.......X...', c: '....x.......x...', h: 'x.o.x.o.x.o.x.o.' },
        fills: { s: '....X.......X.xx', k: 'X...x...X...x.x.' },
        bass: 'R.R.O.R.R.R.O.Rn',
        stabs: 'X-x-x-x-X-x-x-x-',
        arp: { rate: 2, pattern: 'updown', oct: 2, lo: 64 },
      },
      break: {
        bars: 4, chords: ['Am7', 'Bm7', 'Cmaj7', 'D'], pad: true, riser: 1,
        drums: { k: 'X.........x.....', s: '........X.......', h: 'x.c.x.c.x.c.x.c.' },
        fills: { s: 'x.x.x.x.xxxxXXXX', k: 'X...X...X...X...' },
        bass: 'R-----R-5-----O-',
        arp: { rate: 1, pattern: 'updown', oct: 2, lo: 60 },
      },
    },
    order: ['intro', 'A', 'B', 'A', 'break', 'B'], loopFrom: 1,
  },

  // 【battle_final】终盘一分钟曲:同 150bpm、带和声层与 4 小节 build —— 与战斗曲同速,可无缝节拍对齐切换。
  battle_final: {
    name: 'Final Splash', bpm: 150, swing: 0, key: 'E minor', pump: 0.32,
    inst: { bass: 'punk', chords: 'guitar', lead: 'pulse', lead2: 'saw', arp: 'pluck' },
    mix: { hats: 0.17, lead2: 0.16 },
    sections: {
      lift: {
        bars: 1, chords: ['B5'], riser: 1,
        drums: { k: 'X...X...X...X...', s: 'x.x.x.x.xxxxXXXX' },
        bass: 'R-----R-----R-R-',
        stabs: 'X-----X-----X-X-',
      },
      F1: {
        bars: 8, crash: true, chords: ['C', 'D', 'Bm', 'Em', 'C', 'D', 'B7sus4', 'B7'], lead: BATTLE_B_LEAD, harmony: true,
        drums: { k: 'X...x...X...x...', s: '....X.......X...', c: '....x.......x...', h: 'xcxcxcxcxcxcxcxc' },
        fills: { s: '....X.....x.X.xx' },
        bass: 'RrOrRrOrRrOrRrOn',
        stabs: 'X-x-x-x-X-x-x-xx',
        arp: { rate: 1, pattern: 'up', oct: 2, lo: 64 },
      },
      F2: {
        bars: 8, crash: true, chords: ['Em7', 'Cmaj7', 'Am7', 'B7'], lead: BATTLE_A_LEAD, harmony: true,
        drums: { k: 'X..x..x.X..x..x.', s: '....X.......X...', c: '....x.......x...', h: 'xcxcxcxoxcxcxcxo' },
        bass: 'R.ROR.RO5.5OR.On',
        stabs: 'X-.x..x-.x..x-.x',
        arp: { rate: 1, pattern: 'updown', oct: 2, lo: 64 },
      },
      build: {
        bars: 4, chords: ['C', 'D', 'Em', 'B7'], riser: 4, lead: 'G5/8 E5/8 | A5/8 F#5/8 | B5/8 G5/8 | D#6/4 B5/4 F#5/4 A5/4',
        drums: {
          k: 'X...X...X...X...', h: 'xcxcxcxcxcxcxcxc',
          s: ['....X.......X...', 'x...x...x...x...', 'x.x.x.x.x.x.x.x.', 'xxxxxxxxXXXXXXXX'],
        },
        bass: 'R.R.R.R.R.R.R.R.',
        stabs: 'X-x-x-x-X-x-x-x-',
      },
    },
    order: ['lift', 'F1', 'F2', 'build'], loopFrom: 1,
  },

  // 【results_win】胜利结算曲:124bpm G 大调放克 —— 铃铛主音 + 明亮和弦,欢欣鼓舞。
  results_win: {
    name: 'Fresh Victory', bpm: 124, swing: 0, key: 'G major', pump: 0.18,
    inst: { bass: 'funk', chords: 'pluck', lead: 'bell', arp: 'pluck' }, keysLo: 59, bassLo: 31,
    mix: { lead: 0.22, chords: 0.2, arp: 0.08, hats: 0.16 },
    sections: {
      A: {
        bars: 8, crash: true, chords: ['G', 'Em7', 'Cadd9', 'D', 'G', 'Bm7', 'Cadd9', 'Am7 D'], lead: WIN_LEAD,
        drums: { k: 'X...x...X...x...', c: '....x.......x...', h: 'c.o.c.o.c.o.c.o.', sh: 'xcxcxcxcxcxcxcxc' },
        bass: 'R.O.R.O.5.O.R.On',
        stabs: '..x...x...x...x.',
        arp: { rate: 2, pattern: 'up', oct: 2, lo: 67 },
      },
    },
    order: ['A'], loopFrom: 0,
  },

  // 【results_lose】失败结算曲:84bpm A 小调 —— 慢速 sub 贝斯 + 柔音主音,落寞但不消沉。
  results_lose: {
    name: 'Next Time', bpm: 84, swing: 0.1, key: 'A minor', pump: 0,
    inst: { bass: 'sub', chords: 'keys', lead: 'soft' }, keysLo: 55,
    mix: { kick: 0.42, hats: 0.1, bass: 0.4, chords: 0.36, lead: 0.22 },
    sections: {
      A: {
        bars: 8, chords: ['Am7', 'Fmaj7', 'Dm7', 'Esus4 E7', 'Am7', 'Fmaj7', 'Dm9', 'E7sus4 E7'], lead: LOSE_LEAD,
        drums: { k: 'X.........x.....', p: '........x.......', h: 'c.c.c.c.c.c.c.c.' },
        bass: 'R-------..R-5---',
        stabs: 'X-------..x-----',
      },
    },
    order: ['A'], loopFrom: 0,
  },

  // ---- boss mode (HULLBREAKER): one tempo so each phase change lands beat-matched on a bar line with a riser
  // 【boss】Boss 战第一阶段(D 小调,140bpm):重金属 riff + 警报感,铺底同速为阶段切换对齐节拍。
  boss: {
    name: 'Hull Alarm', bpm: 140, swing: 0, key: 'D minor', pump: 0.26,
    inst: { bass: 'punk', chords: 'guitar', lead: 'saw', lead2: 'pulse', arp: 'pluck' }, riffBass: true,
    mix: { lead: 0.26 },
    sections: {
      intro: {
        bars: 2, chords: ['D5'], riff: BOSS_RIFF, riser: 1,
        drums: { k: ['X.......X.......', 'X...X...X...X...'], s: ['................', 'x.x.x.x.xxxxXXXX'], x: ['X...............', '................'] },
      },
      A: {
        bars: 8, crash: true, chords: ['D5'], riff: BOSS_RIFF,
        drums: { k: 'X..X..X.X..X..x.', s: '....X.......X...', h: 'x.c.x.c.x.c.x.oc' },
        fills: { s: '....X.....g.X.xx' },
      },
      B: {
        bars: 8, crash: true, chords: ['Dm', 'Bb', 'C', 'A'], lead: BOSS_A_LEAD, pad: true,
        drums: { k: 'X...X...X...X...', s: '....X.......X...', h: 'x.o.x.o.x.o.x.o.' },
        fills: { s: '....X.....x.X.xx' },
        bass: 'R.RR.RO.R.RR.R5n',
        stabs: 'X-.x..x-.x..x-.x',
      },
    },
    order: ['intro', 'A', 'B', 'A', 'B'], loopFrom: 1,
  },

  // 【boss_2】Boss 战第二阶段:加入琶音与和声伴唱,和声更暗(Gm/Bb 方向),压力升级。
  boss_2: {
    name: 'Brood Tide', bpm: 140, swing: 0, key: 'D minor', pump: 0.3,
    inst: { bass: 'punk', chords: 'guitar', lead: 'saw', lead2: 'pulse', arp: 'pluck' }, riffBass: true,
    mix: { hats: 0.2, lead2: 0.15, arp: 0.12 },
    sections: {
      lift: {
        bars: 1, chords: ['A5'], riser: 1,
        drums: { k: 'X...X...X...X...', s: 'x.x.x.x.xxxxXXXX' },
        bass: 'R-----R-----R-R-',
        stabs: 'X-----X-----X-X-',
      },
      A: {
        bars: 8, crash: true, chords: ['D5'], riff: BOSS_RIFF, arp: { rate: 1, pattern: 'up', oct: 2, lo: 62 },
        drums: { k: 'X.XX..X.X.XX..x.', s: '....X.......X...', c: '....x.......x...', h: 'xcxcxcxcxcxcxcxc' },
        fills: { s: '....X.....x.X.xx' },
      },
      B: {
        bars: 8, crash: true, chords: ['Gm', 'Dm', 'Eb', 'A7'], lead: BOSS_B_LEAD, harmony: true, pad: true,
        drums: { k: 'X.X.X.X.X.X.X.X.', s: '....X.......X...', c: '....x.......x...', h: 'x.o.x.o.x.o.x.o.' },
        fills: { s: '....X...x.x.XxXx' },
        bass: 'RrOrRrOrRrOrRrOn',
        stabs: 'X-x-x-x-X-x-x-x-',
        arp: { rate: 1, pattern: 'updown', oct: 2, lo: 62 },
      },
    },
    order: ['lift', 'A', 'B'], loopFrom: 1,
  },

  // 【boss_3】Boss 战第三阶段(终段):D Phrygian(Eb 色彩),密集十六分鼓 + 高音疾走主旋律,决战顶。
  boss_3: {
    name: 'Shell Shock', bpm: 140, swing: 0, key: 'D phrygian', pump: 0.34,
    inst: { bass: 'punk', chords: 'guitar', lead: 'saw', lead2: 'saw', arp: 'pluck' }, riffBass: true,
    mix: { hats: 0.2, lead: 0.3, lead2: 0.16, arp: 0.12 },
    sections: {
      lift: {
        bars: 1, chords: ['Eb5'], riser: 1,
        drums: { k: 'X.X.X.X.X.X.X.X.', s: 'xxxxxxxxXXXXXXXX' },
        bass: 'R.R.R.R.R.R.R.R.',
        stabs: 'X-x-X-x-X-x-XxXx',
      },
      A: {
        bars: 8, crash: true, chords: ['D5'], riff: BOSS_RIFF3, arp: { rate: 1, pattern: 'updown', oct: 2, lo: 62 },
        drums: { k: 'XxX.XxX.XxX.XxX.', s: '....X.......X...', c: '....x.......x...', h: 'xcxcxcxcxcxcxcxc' },
        fills: { s: '....X...xxxxXXXX' },
      },
      B: {
        bars: 8, crash: true, chords: ['Dm', 'Eb', 'Dm', 'C#dim'], lead: BOSS_C_LEAD, harmony: true, pad: true,
        drums: { k: 'X.XXX.XXX.XXX.XX', s: '....X.......X...', c: '....x.......x...', h: 'xoxoxoxoxoxoxoxo' },
        fills: { s: 'x.x.x.x.xxxxXXXX' },
        bass: 'RRORRROR5R5RRROn',
        stabs: 'X-x-x-X-x-x-X-xx',
        arp: { rate: 1, pattern: 'up', oct: 2, lo: 62 },
      },
    },
    order: ['lift', 'A', 'B'], loopFrom: 1,
  },
};

/* ============================================================================================================
 * Sequencer
 * ==========================================================================================================*/

// 【声部总线】每个 Player 为这 10 个声部各建一个 GainNode(调音量/做淡入淡出/接效果发送),乐器事件按 GROUP_OF 归组。
const GROUPS = ['kick', 'snare', 'hats', 'bass', 'chords', 'pad', 'arp', 'lead', 'lead2', 'fx'];
// 【事件乐器 → 声部】鼓组细分(如 clap/tom 归入 snare、rim/shaker 归入 hats),强度分层按"声部"整体升降。
const GROUP_OF = {
  kick: 'kick', snare: 'snare', clap: 'snare', tom: 'snare', hat: 'hats', rim: 'hats', shaker: 'hats', crash: 'fx', riser: 'fx',
  bass: 'bass', chords: 'chords', riff: 'chords', pad: 'pad', arp: 'arp', lead: 'lead', lead2: 'lead2',
};
// 【默认混音】各声部基础电平(歌曲可用 mix 覆盖)——鼓大声部厚、pad/arp 退后。
const MIX = { kick: 0.6, snare: 0.5, hats: 0.22, bass: 0.36, chords: 0.3, pad: 0.1, arp: 0.1, lead: 0.28, lead2: 0.13, fx: 0.22 };
// 【延迟发送量】带点回声才"好听"的声部(主音/琶音):送入乒乓延迟。
const SEND_DLY = { lead: 0.26, lead2: 0.2, arp: 0.2 };
// 【混响发送量】需要空间感的声部(pad 最多,鼓最少)。
const SEND_REV = { snare: 0.16, lead: 0.14, lead2: 0.14, pad: 0.35, chords: 0.07, arp: 0.2, fx: 0.25, hats: 0.04 };
// 【侧链泵感】这些声部在底鼓触发瞬间被"闪避"(pump)——电子舞曲的呼吸感。
const PUMPED = { chords: true, pad: true, arp: true };
// 【强度 → 声部权重】LAYERS 给每个声部一个 [进, 出] 强度区间(smoothstep 平滑过渡):
//   0 时只剩踩镲;0.4 左右鼓齐;0.6+ 主音进;0.8+ 和声层进。战斗越激烈(intensity 越高),编制越满。
// intensity → layer weight (smoothstep lo..hi). At 0 only hats remain; drums/lead come in above ~0.4.
const LAYERS = {
  hats: [0, 0.02], bass: [0.08, 0.28], pad: [0.12, 0.32], arp: [0.28, 0.48], chords: [0.32, 0.52], kick: [0.38, 0.52],
  fx: [0.38, 0.55], snare: [0.48, 0.62], lead: [0.62, 0.78], lead2: [0.8, 0.95],
};
// 【smoothstep】t 在 [a,b] 间做 3t²-2t³ 平滑插值(端点导数为 0,权重进出不生硬);b<=a 时退化为阶跃。
const smooth = (a, b, x) => {
  if (b <= a) return x >= a ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 【按 id 取编译好的歌】懒编译 + 缓存:第一次要某首歌时才 compileSong,结果存 Map(有编译告警就提示)。
const compiled = new Map();
export function getSong(id) {
  let s = compiled.get(id);
  if (!s) {
    const def = SONGS[id];
    if (!def) return null;
    s = compileSong({ ...def, id });
    if (s.warnings.length && typeof console !== 'undefined') console.warn('[music] ' + id + ':', s.warnings.join('; '));
    compiled.set(id, s);
  }
  return s;
}

// 【Player —— 一首歌的一次播放实例】音序器的执行端:
//   持有自己的"声部总线 + 三路推子(干声/延迟/混响)+ 泵感增益";
//   pump() 把 [now, now+LOOKAHEAD) 窗口内的事件逐个 fire() 成交响乐器调用;
//   切歌时不销毁旧 Player,而是 fadeOut 后自然消亡——两轨可以短暂叠化。
class Player {
  constructor(eng, id, t0, opts = {}) {
    const ctx = (this.ctx = eng.ctx);
    this.eng = eng; this.id = id;
    const song = (this.song = getSong(id));
    this.stepDur = 60 / song.bpm / 4; this.barDur = this.stepDur * 16;
    this.t0 = t0; this.n = 0; this.step = 0;
    this.bar = Math.max(0, Math.min(opts.startBar ?? 0, song.bars.length - 1));
    this.stopAt = Infinity; this.disposed = false;
    this.rng = mulberry32(opts.seed ?? ((Math.random() * 2 ** 31) | 0));
    this.fades = [ctx.createGain(), ctx.createGain(), ctx.createGain()];
    this.fades[0].connect(eng.mix); this.fades[1].connect(eng.dlyIn); this.fades[2].connect(eng.revIn);
    for (const f of this.fades) f.gain.value = 0;
    this.pumpG = ctx.createGain(); this.pumpG.connect(this.fades[0]);
    this.mix = { ...MIX, ...song.mix }; this.layers = { ...LAYERS, ...song.layers };
    this.groups = {}; this.extra = [];
    for (const g of GROUPS) {
      const n = ctx.createGain();
      n.gain.value = this.mix[g] * this.weight(g, eng.intensity);
      n.connect(PUMPED[g] && song.pump ? this.pumpG : this.fades[0]);
      const sd = (song.sendDly ?? SEND_DLY)[g], sr = (song.sendRev ?? SEND_REV)[g];
      if (sd) { const s = ctx.createGain(); s.gain.value = sd; n.connect(s); s.connect(this.fades[1]); this.extra.push(s); }
      if (sr) { const s = ctx.createGain(); s.gain.value = sr; n.connect(s); s.connect(this.fades[2]); this.extra.push(s); }
      this.groups[g] = n;
    }
    this.openHat = null;
  }
  // 【声部权重】LAYERS 区间 smoothstep;声部没有权重表项(如合成必需声部)恒为 1。
  weight(g, x) { const l = this.layers[g]; return l ? smooth(l[0], l[1], x) : 1; }
  // 【热切换强度】所有声部增益用 setTargetAtTime 平滑滑向新权重(0.35s 时间常数),不重启音序。
  setIntensity(x, now) {
    for (const g of GROUPS) this.groups[g].gain.setTargetAtTime(this.mix[g] * this.weight(g, x), now, 0.35);
  }
  // fade level is tracked in JS (linear segments) so a fade-out always starts from the exact current value
  fadeAt(t) { const f = this.fadeSeg; if (!f) return 0; if (t <= f.t0) return f.v0; if (t >= f.t1) return f.v1; return f.v0 + ((f.v1 - f.v0) * (t - f.t0)) / (f.t1 - f.t0); }
  fadeIn(t, dur) {
    dur = Math.max(0.005, dur);
    for (const f of this.fades) { f.gain.setValueAtTime(0, t); f.gain.linearRampToValueAtTime(1, t + dur); }
    this.fadeSeg = { t0: t, v0: 0, t1: t + dur, v1: 1 };
  }
  fadeOut(t, dur) {
    dur = Math.max(0.01, dur);
    const v = this.fadeAt(t);
    for (const f of this.fades) { f.gain.cancelScheduledValues(t); f.gain.setValueAtTime(v, t); f.gain.linearRampToValueAtTime(0, t + dur); }
    this.fadeSeg = { t0: t, v0: v, t1: t + dur, v1: 0 };
    this.stopAt = Math.min(this.stopAt, t + dur + 0.02);
  }
  // 【下一小节起点】t0 之后(含 now 附近)最近的整小节时刻——同 bpm 切歌时对齐小节线的关键。
  nextBarTime(after) {
    const k = Math.max(0, Math.ceil((after - this.t0) / this.barDur - 1e-6));
    return this.t0 + k * this.barDur;
  }
  // 【步进】前进一步;走完 16 步进一小节,走完最后一小节回 loopFrom(段落循环点)。
  advance() {
    this.n++; this.step++;
    if (this.step >= 16) { this.step = 0; this.bar++; if (this.bar >= this.song.bars.length) this.bar = this.song.loopFrom; }
  }
  // 【核心泵】每个 tick 调用:把落在时间窗口 [now, until) 内的事件全部现场合成。
  // 两条要点:
  //   · 后台标签页定时器被浏览器节流时,直接"按网格跳拍"追到现在(不补发堆积事件);
  //   · swing:奇数十六分音符整体后移 swing 比例 × 步长,爵士/放克的摇曳感。
  pump(until, now) {
    if (this.disposed) return;
    // timer starved (background tab): skip ahead on the grid instead of firing a pile-up
    while (this.t0 + this.n * this.stepDur < now - 0.03 && this.t0 + this.n * this.stepDur < this.stopAt) this.advance();
    for (;;) {
      const t = this.t0 + this.n * this.stepDur;
      if (t >= until || t >= this.stopAt) break;
      const tt = t + (this.step & 1 ? (this.song.swing || 0) * this.stepDur : 0);
      const evs = this.song.bars[this.bar].ev[this.step];
      for (let i = 0; i < evs.length; i++) this.fire(evs[i], tt);
      this.advance();
    }
  }
  // 【侧链闪避】底鼓触发瞬间把被泵声部(chords/pad/arp)增益快速压低再恢复——" Pump "电子感。
  pumpDuck(T) {
    const p = this.pumpG.gain, d = this.song.pump;
    p.setTargetAtTime(1 - d, T, 0.004);
    p.setTargetAtTime(1, T + 0.03, 0.075);
  }
  // 【事件 → 乐器】按事件的乐器名 dispatch 到乐器函数,力度加 ±6% 随机(人味)。
  // 若该声部当前强度权重太低(<0.02)就不发声——这就是 setIntensity 减声部的实现机制;
  // riff 例外:贝斯声部还活着时 riff 降八度改走贝斯(保证低频频段不断)。
  fire(e, T) {
    const g = GROUP_OF[e.i];
    if (this.weight(g, this.eng.intensity) < 0.02) {
      if (e.i === 'riff' && this.song.riffBass && this.weight('bass', this.eng.intensity) > 0.02) {
        const v2 = new V(this.ctx, this.groups.bass, T, this.rng);
        bass(v2, T, mtof(e.m) / 2, e.len * this.stepDur * 0.85, e.v, { style: this.song.inst.bass });
        v2.finish();
      }
      return;
    }
    const song = this.song, sd = this.stepDur;
    const vel = e.v * (0.93 + 0.12 * this.rng());
    const v = new V(this.ctx, this.groups[g], T, this.rng);
    switch (e.i) {
      case 'kick': kick(v, T, vel); if (song.pump) this.pumpDuck(T); break;
      case 'snare': snare(v, T, vel); break;
      case 'clap': clap(v, T, vel); break;
      case 'tom': tom(v, T, mtof(e.m), vel); break;
      case 'rim': rim(v, T, vel); break;
      case 'shaker': shaker(v, T, vel); break;
      case 'crash': crash(v, T, vel); break;
      case 'hat': {
        if (this.openHat && this.openHat.t < T && this.openHat.p.cancelAndHoldAtTime) {
          this.openHat.p.cancelAndHoldAtTime(T); this.openHat.p.setTargetAtTime(0, T, 0.012);
        }
        this.openHat = null;
        const p = hat(v, T, vel, e.open);
        if (e.open) this.openHat = { p, t: T };
        break;
      }
      case 'riser': riser(v, T, e.len * sd, vel); break;
      case 'bass': bass(v, T, mtof(e.m), e.len * sd * (song.bassGate ?? 0.82), vel, { style: song.inst.bass }); break;
      case 'riff': {
        const f = mtof(e.m);
        guitar(v, T, [f, f * 1.4983, f * 2], e.len * sd * 0.85, vel);
        if (song.riffBass && this.weight('bass', this.eng.intensity) > 0.02) {
          const v2 = new V(this.ctx, this.groups.bass, T, this.rng);
          bass(v2, T, f / 2, e.len * sd * 0.85, vel, { style: song.inst.bass });
          v2.finish();
        }
        break;
      }
      case 'chords': {
        const gate = e.len * sd * 0.9, inst = song.inst.chords, n = e.ms.length;
        if (inst === 'guitar') guitar(v, T, e.ms.map(mtof), gate, vel, { mute: e.mute });
        else {
          const nv = vel / Math.sqrt(n);
          for (const m of e.ms) {
            if (inst === 'keys') keys(v, T, mtof(m), gate, nv * 0.7);
            else if (inst === 'brass') brass(v, T, mtof(m), gate, nv * 0.7);
            else pluck(v, T, mtof(m), gate, nv * 0.7, { d: 0.28, f0: 3800, f1: 700, q: 2 });
          }
        }
        break;
      }
      case 'pad': { const nv = vel / Math.sqrt(e.ms.length); for (const m of e.ms) pad(v, T, mtof(m), e.len * sd, nv * 0.6); break; }
      case 'arp': pluck(v, T, mtof(e.m), e.len * sd, vel * 0.6, { d: 0.2 }); break;
      case 'lead': case 'lead2': {
        const style = e.i === 'lead' ? song.inst.lead : (song.inst.lead2 || 'saw');
        const gate = e.len * sd * 0.92;
        if (style === 'bell') bell(v, T, mtof(e.m), vel * 0.8, { d: Math.min(1.4, 0.35 + gate) });
        else lead(v, T, mtof(e.m), gate, vel * 0.7, { style });
        break;
      }
    }
    v.finish();
  }
  // 【断线】Player 退场时断开全部自建节点(推子/声部总线/发送)。
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of [...this.fades, this.pumpG, ...this.extra, ...Object.values(this.groups)]) { try { n.disconnect(); } catch (e) { /* */ } }
  }
}

// 【lookahead 音序参数】每 25ms 检查一次,把未来 0.16s 内的事件提前排程(到点准触发,不卡顿)。
const LOOKAHEAD = 0.16, TICK_MS = 25;
// Zone Control 加时:录音跑得略快(约高半音),烘托" hurry-up "的紧张感
const OVERTIME_RATE = 1.06;       // Zone Control overtime: recordings run ~1 semitone fast
const MANIFEST_URL = 'songs/manifest.json';

// 【录音轨】songs/manifest.json 里登记的曲目:用 <audio> 元素流式播放,经 MediaElementSource 进音乐总线。
// 与合成轨不同——它不参与编译/音序,只负责淡入淡出、暂停/续播和变速(加时)。
// One recording, streamed by an <audio> element through Web Audio (gain = loudness match from the manifest × fades).
class FileTrack {
  constructor(eng, id, entry) {
    this.eng = eng; this.id = id; this.entry = entry; this.stopped = false;
    const el = (this.el = new Audio());
    el.preload = 'auto';
    el.src = entry.url;
    this.src = eng.ctx.createMediaElementSource(el);
    this.gain = eng.ctx.createGain(); this.gain.gain.value = 0;
    this.src.connect(this.gain); this.gain.connect(eng.fileOut);
    this.level = Math.pow(10, (entry.gainDb || 0) / 20);
    el.addEventListener('ended', () => eng._ended(this));
  }
  start(now, fadeIn) {
    const g = this.gain.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(0, now); g.linearRampToValueAtTime(this.level, now + Math.max(0.01, fadeIn));
    this.resume();
  }
  pause() { this.el.pause(); }
  // playback speed (Zone Control overtime); pitch rides with it, like a tape running fast
  setRate(r) { this.el.preservesPitch = false; this.el.playbackRate = r; }
  resume() {
    if (this.stopped) return;
    const p = this.el.play();
    if (p && p.catch) p.catch((e) => { if (e.name !== 'AbortError') console.warn('[music] could not play', this.entry.title, e.message); });   // AbortError: we paused it ourselves (a quick track change)
  }
  fadeOut(now, dur) {
    if (this.stopped) return;
    this.stopped = true;
    const g = this.gain.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + dur);
    setTimeout(() => this.dispose(), (dur + 0.1) * 1000);
  }
  dispose() {
    this.stopped = true;
    this.el.pause(); this.el.removeAttribute('src'); this.el.load();
    try { this.src.disconnect(); this.gain.disconnect(); } catch (e) { /* */ }
  }
}

// 【MusicEngine —— 游戏侧唯一入口】单例(music)。职责:
//   总线搭建(_init)、25ms 计时驱动(_tick)、选曲切换(play/同速对拍、riser 衔接)、
//   强度分层(setIntensity)、录音轨的洗牌/预载/加时(preload/_pick/setOvertime)、暂停续播(配比赛时钟)。
export class MusicEngine {
  constructor() {
    this.ctx = null; this.players = []; this.current = null; this.intensity = 1; this._want = undefined;
    this.files = null; this._bags = {}; this._last = {}; this._preloaded = {};
  }
  // true when songs/manifest.json lists recordings for this track id
  hasFile(id) { return !!(this.files && this.files[id] && this.files[id].length); }
  // id of the recording now playing (null for synth / silence)
  get fileTrack() { return this.current instanceof FileTrack ? this.current.id : null; }
  get track() { return this.current ? this.current.id : null; }
  get tracks() { return Object.keys(SONGS); }
  now() { return this.offline ? this.vnow : this.ctx.currentTime; }

  // 【引擎初始化——搭总线】mix(声部汇流)→ 30Hz 高通(去直流)→ 胶水压缩 → out(音乐音量)→ 音乐总线;
  // 另建两条效果回路:乒乓延迟(附点八分音,随曲速调)与卷积混响;录音走独立直通 fileOut(成品录音不再过压缩/效果)。
  // dest = the music bus (audio.js). opt.offline → no timer; drive with advance(t).
  _init(ctx, dest, opt = {}) {
    if (this.ctx) return this;
    this.ctx = ctx; this.offline = !!opt.offline; this.vnow = 0;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.mix = g(1);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    this.out = g(opt.level ?? 0.42);   // music bus sits ~−14 LUFS at full volume, under the SFX
    this.mix.connect(hp); hp.connect(comp); comp.connect(this.out); this.out.connect(dest);
    // ping-pong delay (dotted 8th, set per track)
    this.dlyIn = g(1);
    const dhp = ctx.createBiquadFilter(); dhp.type = 'highpass'; dhp.frequency.value = 350;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3400;
    this.dA = ctx.createDelay(2); this.dB = ctx.createDelay(2);
    this.dA.delayTime.value = this.dB.delayTime.value = 0.3;
    const fbA = g(0.36), fbB = g(0.36), dOut = g(0.55);
    const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner(); pl.pan.value = -0.75; pr.pan.value = 0.75;
    this.dlyIn.connect(dhp); dhp.connect(dlp); dlp.connect(this.dA);
    this.dA.connect(pl); this.dA.connect(fbA); fbA.connect(this.dB);
    this.dB.connect(pr); this.dB.connect(fbB); fbB.connect(this.dA);
    pl.connect(dOut); pr.connect(dOut); dOut.connect(this.mix);
    // reverb
    this.revIn = g(1);
    const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx, 2.2, 2.4, { seed: 5, bright: 0.7, dark: 0.08 });
    const rOut = g(0.5);
    this.revIn.connect(conv); conv.connect(rOut); rOut.connect(this.mix);
    // recordings are mastered already: they bypass the synth's compressor / delay / reverb
    this.fileOut = g(1); this.fileOut.connect(dest);
    this._nodes = [this.mix, hp, comp, this.out, this.dlyIn, dhp, dlp, this.dA, this.dB, fbA, fbB, dOut, pl, pr, this.revIn, conv, rOut, this.fileOut];
    if (!this.offline && typeof fetch === 'function') {
      fetch(MANIFEST_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null))
        .then((m) => {
          this.files = (m && m.tracks) || {};
          // a track that started as synth before the list arrived (the lobby at boot) swaps to its recordings
          const cur = this.current;
          if (cur && !(cur instanceof FileTrack) && this.hasFile(cur.id)) { const id = cur.id; this.current = null; cur.fadeOut?.(this.now(), 0.6); this.play(id, { fade: 0.6 }); }
        })
        .catch(() => { this.files = {}; });
    }
    if (!this.offline) this._startTimer();
    const w = this._want; this._want = undefined;
    if (w !== undefined) this.play(w.track, w.opts);
    return this;
  }

  // 【心跳定时器】首选 Web Worker 内的 setInterval(后台标签页不受主线程节流影响);
  // Worker 建不起来(离线测试等)就退回普通 setInterval。
  _startTimer() {
    const tick = () => this._tick();
    try {
      const src = 'let id=0;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      this.worker.onmessage = tick;
      this.worker.onerror = () => { this.worker = null; if (!this.timer) this.timer = setInterval(tick, TICK_MS); };
      this.worker.postMessage(TICK_MS);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      this.timer = setInterval(tick, TICK_MS);
    }
  }

  // 【每 tick】让所有 Player 泵出未来 0.16s 的事件;顺便回收淡出完毕的 Player(stopAt 过 4s 即清理)。
  _tick() {
    if (!this.ctx || !this.players.length) return;
    const now = this.now();
    for (const p of this.players) p.pump(now + LOOKAHEAD, now);
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.stopAt + 4 < now) { p.dispose(); this.players.splice(i, 1); }
    }
  }

  // offline driving (tests): move the virtual clock and schedule
  // 【离线驱动(测试用)】没有真实时钟时手动推虚拟时钟:tools/audio-test.mjs 就靠它渲染整首歌。
  advance(t) { this.vnow = t; this._tick(); }

  // 【切歌主入口】remap 钩子先过(Boss 指挥用来劫持选曲);
  //   有录音 → 立即起 FileTrack(终盘曲要对表);同 bpm → 对齐下小节线对拍切换 + riser 衔接;
  //   不同 bpm → 旧轨正常淡出、新轨淡入。ctx 未初始化时先记账,初始化后补播。
  play(track, opts = {}) {
    // a mode director (e.g. src/audio/bossAudio.js) can re-route requests: remap(track) → track to play instead
    if (this.remap) { try { const r = this.remap(track); if (r !== undefined) track = r; } catch (e) { /* keep the request */ } }
    const fade = Math.max(0, opts.fade ?? 1.0);
    if (track != null && !SONGS[track] && !this.hasFile(track)) { console.warn('[music] unknown track', track); return; }
    if (!this.ctx) { this._want = { track, opts }; return; }
    const cur = this.current;
    if (cur && cur.id === track) return;
    const now = this.now();
    if (track == null) { if (cur) cur.fadeOut(now, Math.max(0.03, fade)); this.current = null; return; }
    if (this.hasFile(track)) {
      // a recording starts on the spot (the final-minute song is timed to the clock); the old track fades under it
      const ft = this._take(track);
      if (cur) cur.fadeOut(now, Math.max(0.03, fade));
      ft.start(now, 0.05);
      this.current = ft;
      return;
    }
    const song = getSong(track);
    let t0 = now + 0.06, sync = false;
    if (cur && fade > 0 && cur.song && cur.song.bpm === song.bpm) { t0 = cur.nextBarTime(now + 0.12); sync = true; }
    const p = new Player(this, track, t0, opts);
    this.players.push(p);
    const beat = 60 / song.bpm;
    this.dA.delayTime.setTargetAtTime(beat * 0.75, t0, 0.05); this.dB.delayTime.setTargetAtTime(beat * 0.75, t0, 0.05);
    if (cur) {
      if (sync) {
        // beat-matched escalation: old track plays to the bar line with a riser, new one lands on the downbeat
        cur.fadeOut(t0, Math.min(0.25, fade));
        p.fadeIn(t0, 0.008);
        const span = t0 - now;
        if (span > 0.3) { const v = new V(this.ctx, cur.groups.fx, now + 0.02, p.rng); riser(v, now + 0.02, span - 0.03, 1); v.finish(); }
      } else {
        cur.fadeOut(now, Math.max(0.03, fade));
        p.fadeIn(t0, fade > 0 ? fade * 0.5 : 0.01);
      }
    } else p.fadeIn(t0, 0.01);
    this.current = p;
    this._tick();
  }

  // Buffer the next pick for a file-backed id so play() starts without a gap.
  // 【预载】提前把下一次要播的录音建出来(<audio> 开始缓冲),play() 时无缝接走。
  preload(id) {
    if (!this.ctx || !this.hasFile(id) || this._preloaded[id]) return;
    this._preloaded[id] = new FileTrack(this, id, this._pick(id));
  }
  _take(id) {
    const ft = this._preloaded[id] || new FileTrack(this, id, this._pick(id));
    delete this._preloaded[id];
    return ft;
  }
  // shuffle bag: every song plays once before any repeats, and a new round never opens with the song just heard
  // 【洗牌袋】同一曲目的多首录音:每首播完一轮再重洗,且新一轮的第一首不重复刚播过的那首。
  _pick(id) {
    const list = this.files[id];
    let bag = this._bags[id];
    if (!bag || !bag.length) {
      bag = this._bags[id] = list.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag.length > 1 && bag[bag.length - 1] === this._last[id]) bag.unshift(bag.pop());
    }
    const i = bag.pop();
    this._last[id] = i;
    return list[i];
  }
  // a match song ran out: roll straight into the next one ('battle_final' plays once and stops)
  // 【录音自然播完】可循环曲目直接接下一首;终盘曲(once)若正处加时则改接战斗洗牌,否则安静结束。
  _ended(ft) {
    if (this.current !== ft || ft.stopped) return;
    // overtime outlasts the one-shot final-minute song: roll into the match shuffle (still hurried) instead of silence
    const id = ft.id === 'battle_final' && this.overtime && this.hasFile('battle') ? 'battle' : ft.id;
    if (id === 'battle_final') { ft.dispose(); return; }
    const nx = this._take(id);
    ft.dispose();
    nx.start(this.now(), 0.05);
    if (this.overtime) nx.setRate(OVERTIME_RATE);
    this.current = nx;
  }
  // Zone Control overtime: the playing recording runs a touch fast (the hurry-up), and a song that ends during overtime
  // rolls on instead of leaving silence. setOvertime(false) only ends the roll-over (new tracks start at normal speed).
  // 【加时变速】Zone Control 进入加时:正在播的录音立即提速 6%(音高随之升高,像磁带快进),
  // 且终盘曲播完后自动续播战斗曲而不是留白;关闭只影响之后的新曲目。
  setOvertime(on) {
    this.overtime = !!on;
    if (this.overtime && this.current instanceof FileTrack) this.current.setRate(OVERTIME_RATE);
  }
  pause() { if (this.current instanceof FileTrack) this.current.pause(); }
  resume() { if (this.current instanceof FileTrack) this.current.resume(); }

  // 【强度入口】0..1 钳位后下发给所有存活 Player(平滑过渡);ctx 未好就只在引擎里记账。
  setIntensity(x) {
    this.intensity = Math.min(1, Math.max(0, +x || 0));
    if (!this.ctx) return;
    const now = this.now();
    for (const p of this.players) p.setIntensity(this.intensity, now);
  }

  // 【停播】play(null):淡出当前轨(合成轨 duck 淡出,录音轨真暂停)。
  stop(fade = 1) { this.play(null, { fade }); }

  dispose() {
    for (const p of this.players) p.dispose();
    if (this.current instanceof FileTrack) this.current.dispose();
    for (const ft of Object.values(this._preloaded)) ft.dispose();
    this._preloaded = {};
    this.players.length = 0; this.current = null;
    if (this.worker) { this.worker.postMessage(0); this.worker.terminate(); this.worker = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const n of this._nodes || []) { try { n.disconnect(); } catch (e) { /* */ } }
    this.ctx = null;
  }
}

// 【曲目概览表】给 UI/调试用的元信息:曲名、bpm、调性、段落结构(A(8) → B(8)…)与循环位置。
export const TRACKS = Object.fromEntries(Object.entries(SONGS).map(([id, s]) => [id, {
  name: s.name, bpm: s.bpm, key: s.key,
  structure: s.order.map((k) => `${k}(${s.sections[k].bars})`).join(' → ') + `, loops from ${s.order[s.loopFrom ?? 0]}`,
}]));

// 【全局单例】游戏各处 import { music } 直接用;audio.init() 时经 music._init() 接到真实 AudioContext。
export const music = new MusicEngine();
