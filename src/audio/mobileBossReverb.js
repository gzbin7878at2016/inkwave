import { G } from '../core/ctx.js';

// 手机Boss只缩短很弱的混响尾音。归一化由真实离线卷积取得，不能直接截IR后再次归一化而改变早期响度。
const prepared = new WeakMap();
let active = null;
async function impulseResponse(buffer, normalize, frames) {
  const ctx = new OfflineAudioContext(2, frames, buffer.sampleRate);
  const source = ctx.createBufferSource(), convolution = ctx.createConvolver();
  const pulse = ctx.createBuffer(1, 1, buffer.sampleRate); pulse.getChannelData(0)[0] = 1;
  source.buffer = pulse; convolution.normalize = normalize; convolution.buffer = buffer;
  source.connect(convolution); convolution.connect(ctx.destination); source.start();
  let timer;
  try {
    return await Promise.race([ctx.startRendering(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('手机Boss混响准备超时')), 2000);
    })]);
  } finally { clearTimeout(timer); source.disconnect(); convolution.disconnect(); }
}

async function prepareImpulse(node, seconds, isCurrent) {
  const original = node.buffer, normalize = node.normalize, key = `${normalize}:${seconds}`;
  if (!original || original.numberOfChannels !== 2 || original.duration <= seconds) throw Error('混响格式不适合缩短');
  let variants = prepared.get(original);
  if (!variants) { variants = new Map(); prepared.set(original, variants); }
  if (variants.has(key)) return { ...variants.get(key), cached: true };
  const frames = Math.ceil(original.sampleRate * seconds), fade = Math.ceil(original.sampleRate * 0.01);
  const buffer = await impulseResponse(original, normalize, frames);
  if (!isCurrent()) return { cancelled: true };
  let allEnergy = 0, keptEnergy = 0;
  for (let channel = 0; channel < 2; channel++) {
    const source = original.getChannelData(channel), dest = buffer.getChannelData(channel);
    for (let i = 0; i < source.length; i++) {
      const weight = i < frames - fade ? 1 : i < frames ? (frames - 1 - i) / fade : 0;
      allEnergy += source[i] * source[i]; keptEnergy += source[i] * source[i] * weight * weight;
    }
    for (let i = frames - fade; i < frames; i++) dest[i] *= (frames - 1 - i) / fade;
  }
  // 再卷积一次确认实际浏览器没有额外移相/重归一化；不满足则回退原音效，绝不在实战重试。
  const replay = await impulseResponse(buffer, false, frames);
  if (!isCurrent()) return { cancelled: true };
  let error = 0;
  for (let channel = 0; channel < 2; channel++) {
    const a = buffer.getChannelData(channel), b = replay.getChannelData(channel);
    for (let i = 0; i < frames; i++) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw Error('混响PCM非有限值');
      error = Math.max(error, Math.abs(a[i] - b[i]));
    }
  }
  if (error > 1e-5 || allEnergy <= 0 || !Number.isFinite(keptEnergy / allEnergy) || keptEnergy / allEnergy < 0.98) throw Error('混响早期波形或能量保留不满足门槛');
  const result = { buffer, seconds, sourceSeconds: original.duration, bytes: frames * 2 * 4, retainedEnergy: keptEnergy / allEnergy, replayError: error };
  variants.set(key, result); return result;
}

export function restoreMobileBossReverb(match) {
  if (!active || (match && active.match !== match)) return { restored: 0 };
  const state = active; active = null; let restored = 0;
  for (const entry of state.entries) {
    // 不覆盖在我们之后由其他功能更换的混响配置。
    if (!entry.applied || (entry.node.buffer !== entry.short && entry.node.buffer !== entry.original) || entry.node.normalize !== false) continue;
    try { entry.node.normalize = entry.normalize; entry.node.buffer = entry.original; restored++; }
    catch (error) { globalThis.inkwaveDiagnostics?.record('mobile-boss-reverb-restore-failed', String(error), 'error'); }
  }
  state.audio._bossReverbInfo = { active: false, restored }; return { restored };
}

export async function prepareMobileBossReverb(game, match, { isCurrent = () => true } = {}) {
  const audio = G.audio, music = G.music;
  if (!globalThis.inkwaveMobile || !match?.boss || game.match !== match || !audio?.ctx || audio.offline
    || typeof OfflineAudioContext === 'undefined' || typeof ConvolverNode === 'undefined') return { skipped: true };
  if (!isCurrent()) return { cancelled: true };
  if (active?.match === match) return { ...audio._bossReverbInfo, cached: true };
  restoreMobileBossReverb();
  const musicConvolution = music?._nodes?.find(node => node instanceof ConvolverNode);
  if (!audio.conv || !musicConvolution) return { skipped: true, reason: '缺少原混响' };
  const jobs = [[audio.conv, 'sfx', 0.4], [musicConvolution, 'music', 0.6]], entries = [], rows = [];
  const current = () => isCurrent() && game.match === match;
  try {
    for (const [node, name, seconds] of jobs) {
      const original = node.buffer, normalize = node.normalize, result = await prepareImpulse(node, seconds, current);
      if (result.cancelled || !current()) return { cancelled: true };
      if (node.buffer !== original || node.normalize !== normalize) throw Error('准备期间混响已被其他功能修改');
      entries.push({ node, original, normalize, short: result.buffer });
      const { buffer, ...detail } = result; rows.push({ name, ...detail });
    }
    if (!current()) return { cancelled: true };
    // 两条均准备完成后才安装；setter异常时按同一match恢复已改部分。
    active = { match, audio, entries };
    for (const entry of entries) { entry.applied = true; entry.node.normalize = false; entry.node.buffer = entry.short; }
    audio._bossReverbInfo = { active: true, rows, bytes: rows.reduce((n, row) => n + row.bytes, 0) };
    return audio._bossReverbInfo;
  } catch (error) {
    restoreMobileBossReverb(match);
    return { fallback: true, reason: String(error) };
  }
}
