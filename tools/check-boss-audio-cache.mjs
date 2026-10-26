// 用浏览器真实OfflineAudioContext验证PCM与原配方、缓存边界及原声道释放；不是FPS测试。
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/audio-cache-test.html', '<!doctype html><meta charset="utf-8"><title>音效缓存检查</title>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8490/releases/investigation/audio-cache-test.html');
  const report = await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/audio.js');
    const { BossOneShotCache, BOSS_CACHED_SOUNDS } = await import('/src/audio/bossOneShotCache.js');
    const { V, mulberry32 } = await import('/src/audio/music.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const engine = new AudioEngine({ music: false }), cache = new BossOneShotCache(48000), sounds = [];
    for (const name of BOSS_CACHED_SOUNDS) {
      const build = engine._def(name).build, result = await cache.prepare(name, build);
      check(result.variants === 4, '四种变体准备失败');
      check((await cache.prepare(name, build)).cached, '重复准备未命中');
      const sample = cache.entries.get(name)[0];
      const ctx = new OfflineAudioContext(2, 48000, 48000);
      let seed = 991; for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) | 0;
      const v = new V(ctx, ctx.destination, 0, mulberry32(seed)); build(v, 1, {});
      const original = await ctx.startRendering(); v.dispose();
      let peak = 0, ss = 0, difference = 0, variantDifference = 0;
      for (let channel = 0; channel < 2; channel++) {
        const data = sample.getChannelData(channel), expected = original.getChannelData(channel);
        const variant = cache.entries.get(name)[1].getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
          check(Number.isFinite(data[i]), 'PCM包含非有限值');
          difference = Math.max(difference, Math.abs(data[i] - expected[i]));
          variantDifference += Math.abs(data[i] - (variant[i] || 0));
          peak = Math.max(peak, Math.abs(data[i])); ss += data[i] ** 2;
        }
      }
      check(difference < 1e-6 && peak > 0.01 && variantDifference > 0.1, '样本与原配方不一致或变体重复');
      sounds.push({ name, seconds: sample.duration, peak, rms: Math.sqrt(ss / sample.length / 2), difference, variantDifference });
    }
    check(cache.stats.bytes < 8 * 1024 * 1024, '内存超界');
    check((await cache.prepare('hit_marker', engine._def('hit_marker').build)).skipped, '有状态连击音不可缓存');
    const cancelCache = new BossOneShotCache(48000);
    check((await cancelCache.prepare('shoot_shooter', engine._def('shoot_shooter').build, () => false)).cancelled, '取消未生效');
    check(cancelCache.entries.size === 0, '取消后仍写入缓存');
    check((await cancelCache.prepare('splat_small', () => { throw Error('测试失败回退'); })).fallback, '异常没有回退');
    for (const enabled of [false, true]) {
      const ctx = new OfflineAudioContext(2, 96000, 48000);
      const audio = new AudioEngine({ context: ctx, music: false, seed: 9, raw: true }).init();
      audio._bossSamples = cache; audio._bossSampleEnabled = () => enabled;
      const before = cache.stats.hits, voice = audio.play('shoot_shooter', { pitch: 1, pos: { x: 2, y: 0, z: 1 } });
      check(!!voice && !!voice.panner && !!voice.send, '空间声道/混响丢失');
      check(cache.stats.hits - before === Number(enabled), '非Boss/PC隔离失败');
      if (enabled) check(voice.v.nodes.length === 5 && voice.v.srcs.length === 1, '缓存没有减少节点');
      const rejected = new V(ctx, ctx.destination, 0, mulberry32(1));
      check(!cache.play(rejected, 'shoot_shooter', 1, { custom: 1 }), '未知参数应走原配方');
      check(!cache.play(rejected, 'shoot_shooter', 0.5, {}), '大幅变调应走原配方');
      check(rejected.nodes.length === 0, '回退前不应创建节点');
      await ctx.startRendering(); check(voice.v.dead && voice.done, '播放后未释放');
    }
    const pc = new AudioEngine({ music: false }); pc.ctx = {};
    check((await pc.prepareBossSample('shoot_shooter')).skipped && !pc._bossSamples, 'PC不应准备缓存');
    return { sounds, stats: cache.stats, checks: 'PCM一致、4变体、容量、取消/异常、上下文隔离、原空间/混响、参数回退、播放释放通过' };
  });
  assert.equal(report.sounds.length, 3);
  await writeFile('releases/investigation/boss-audio-cache-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
