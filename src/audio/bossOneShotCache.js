import { V, mulberry32 } from './music.js';

// 真机调查中建图最重的三种短音；排除连击计数、循环和依赖调用参数的配方。
export const BOSS_CACHED_SOUNDS = Object.freeze(['roller_flick', 'splat_small', 'shoot_shooter']);
const VARIANTS = 4, MAX_SECONDS = 1, MAX_BYTES = 8 * 1024 * 1024;
const PLAY_OPTIONS = new Set(['pos', 'volume', 'pitch', 'at', 'delay']);

// 只在手机Boss加载期离线合成。实战播放一个BufferSource，定位/音量/混响仍走原声道。
export class BossOneShotCache {
  constructor(sampleRate) {
    this.sampleRate = sampleRate; this.entries = new Map(); this.next = new Map();
    this.stats = { hits: 0, misses: 0, bytes: 0, prepared: 0, failures: 0 };
  }
  async prepare(name, build, isCurrent = () => true) {
    if (this.entries.has(name)) return { name, cached: true };
    const Offline = globalThis.OfflineAudioContext;
    if (!BOSS_CACHED_SOUNDS.includes(name) || !Offline || !build) return { name, skipped: true };
    const buffers = []; let bytes = 0;
    try {
      for (let index = 0; index < VARIANTS; index++) {
        if (!isCurrent()) return { name, cancelled: true };
        const ctx = new Offline(2, Math.ceil(MAX_SECONDS * this.sampleRate), this.sampleRate);
        let seed = 991 + index * 7919;
        for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) | 0;
        const v = new V(ctx, ctx.destination, 0, mulberry32(seed));
        let timeout;
        try {
          build(v, 1, {});
          if (v.endless || !Number.isFinite(v.end) || v.end <= 0 || v.end > MAX_SECONDS) throw Error('短音长度超出缓存上限');
          const frames = Math.ceil(v.end * this.sampleRate);
          const rendered = await Promise.race([ctx.startRendering(), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error('离线音效准备超时')), 2000);
          })]);
          if (!isCurrent()) return { name, cancelled: true };
          const buffer = ctx.createBuffer(2, frames, this.sampleRate);
          for (let channel = 0; channel < 2; channel++) buffer.copyToChannel(rendered.getChannelData(channel).subarray(0, frames), channel);
          bytes += frames * 2 * 4;
          if (this.stats.bytes + bytes > MAX_BYTES) throw Error('音效缓存超出内存上限');
          buffers.push(buffer);
        } finally { clearTimeout(timeout); v.dispose(); }
      }
      this.entries.set(name, buffers); this.stats.bytes += bytes; this.stats.prepared++;
      return { name, variants: buffers.length, bytes };
    } catch (error) {
      // 缓存是可选加速；失败保留原程序化音效，不能阻断Boss加载或在实战重试烘焙。
      this.stats.failures++; return { name, fallback: true, reason: String(error) };
    }
  }
  play(v, name, pitch, options) {
    const buffers = this.entries.get(name);
    if (!buffers || !Number.isFinite(pitch) || pitch < 0.65 || pitch > 1.5 || Object.keys(options).some(k => !PLAY_OPTIONS.has(k))) {
      this.stats.misses++; return false;
    }
    const index = this.next.get(name) || 0, buffer = buffers[index];
    this.next.set(name, (index + 1) % buffers.length);
    const source = v.ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = pitch;
    // 不使用V.buffer：该工具默认循环并随机起点；单发必须从样本开头完整播放。
    v._src(source, v.t, v.t + buffer.duration / pitch, v.out);
    this.stats.hits++; return true;
  }
}
