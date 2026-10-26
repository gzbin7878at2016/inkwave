// 真实WebAudio验证归一化/早期波形、尾音能量、Boss释放恢复、缓存、取消和setter失败；不是FPS测试。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-reverb-test.html', `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>`);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8490/releases/investigation/boss-reverb-test.html');
  const report = await page.evaluate(async () => {
    const { G } = await import('/src/core/ctx.js'), { AudioEngine } = await import('/src/audio/audio.js');
    const { MusicEngine } = await import('/src/audio/music.js'), { BossMode } = await import('/src/boss/bossMode.js');
    const { prepareMobileBossReverb: prepare, restoreMobileBossReverb: restore } = await import('/src/audio/mobileBossReverb.js');
    const check = (value, message) => { if (!value) throw Error(message); }, rows = [];
    const render = async (buffer, normalize) => {
      const sr = buffer.sampleRate, ctx = new OfflineAudioContext(2, sr, sr), conv = ctx.createConvolver(), source = ctx.createBufferSource();
      const input = ctx.createBuffer(2, Math.ceil(sr * 0.12), sr);
      for (let ch = 0; ch < 2; ch++) { const data = input.getChannelData(ch); for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * (ch ? 0.041 : 0.063)) * 0.1; data[0] = 1; }
      source.buffer = input; conv.normalize = normalize; conv.buffer = buffer; source.connect(conv); conv.connect(ctx.destination); source.start();
      return ctx.startRendering();
    };
    for (const sampleRate of [44100, 48000]) for (const normalize of [true, false]) {
      const ctx = new AudioContext({ sampleRate }), audio = new AudioEngine({ context: ctx, music: false, raw: true }).init();
      const music = new MusicEngine()._init(ctx, audio.musicBus, { offline: true });
      G.audio = audio; G.music = music; globalThis.inkwaveMobile = {};
      const musicConv = music._nodes.find(n => n instanceof ConvolverNode), nodes = [audio.conv, musicConv];
      for (const n of nodes) n.normalize = normalize;
      const original = nodes.map(n => n.buffer), match = { boss: {}, state: 'init', time: 123 }, game = { match };
      const result = await prepare(game, match); check(result.active && result.rows.length === 2, '两条混响未准备完成');
      check(result.bytes <= 48000 * 8 && result.rows.every(r => r.retainedEnergy >= 0.98), '容量/尾音能量门槛失败');
      for (let index = 0; index < 2; index++) {
        const node = nodes[index], seconds = index ? 0.6 : 0.4;
        check(node.buffer.length === Math.ceil(sampleRate * seconds) && node.normalize === false, '长度或重复归一化错误');
        const before = await render(original[index], normalize), after = await render(node.buffer, false); let maxError = 0;
        for (let ch = 0; ch < 2; ch++) {
          const a = before.getChannelData(ch), b = after.getChannelData(ch);
          for (let i = 0; i < Math.floor(sampleRate * (seconds - 0.012)); i++) maxError = Math.max(maxError, Math.abs(a[i] - b[i]));
          check(b.every(Number.isFinite), '输出PCM无效');
        }
        check(maxError < 1e-5, '原始早期响度/声道/反射时序被改变');
        rows.push({ sampleRate, normalize, name: index ? 'music' : 'sfx', maxError, ...result.rows[index] });
      }
      check(match.time === 123 && match.state === 'init', '音效准备推进了比赛');
      check(restore({}).restored === 0, '旧match错误恢复新match');
      // 调用实际BossMode.dispose，覆盖所有正常换局/菜单路径共有的宿主入口。
      const mode = Object.create(BossMode.prototype); mode.match = match; let disposed = 0;
      mode.boss = { dispose() { disposed++; } }; G.boss = mode.boss; mode.dispose();
      check(disposed === 1 && G.boss === null, '原Boss释放行为改变');
      check(nodes.every((n, i) => n.buffer === original[i] && n.normalize === normalize), '实际Boss释放未恢复原buffer/normalize');
      const repeated = await prepare(game, match); check(repeated.rows.every(r => r.cached), '重复加载未命中'); restore(match);
      let current = true; const pending = prepare(game, match, { isCurrent: () => current }); current = false;
      check((await pending).cancelled && nodes.every((n, i) => n.buffer === original[i]), '中途取消仍安装混响');
      globalThis.inkwaveMobile = false; check((await prepare(game, match)).skipped, 'PC错误改混响');
      globalThis.inkwaveMobile = {}; game.match = { boss: null }; check((await prepare(game, game.match)).skipped, '普通对局错误改混响'); game.match = match;
      audio.offline = true; check((await prepare(game, match)).skipped, '离线音效审计被修改'); audio.offline = false;
      // 第二条buffer setter失败时，第一条及第二条已改normalize都必须回滚。
      const desc = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
      Object.defineProperty(musicConv, 'buffer', { configurable: true, get() { return desc.get.call(this); }, set(value) {
        if (value !== original[1]) throw Error('注入第二条安装失败'); desc.set.call(this, value);
      } });
      check((await prepare(game, match)).fallback, '安装错误未回退'); delete musicConv.buffer;
      check(nodes.every((n, i) => n.buffer === original[i] && n.normalize === normalize), '部分安装失败未完全回滚');
      const replacement = ctx.createBuffer(2, original[0].length, sampleRate);
      for (let ch = 0; ch < 2; ch++) replacement.copyToChannel(original[0].getChannelData(ch), ch);
      original[0] = replacement; nodes[0].buffer = replacement;
      const Offline = globalThis.OfflineAudioContext;
      globalThis.OfflineAudioContext = class extends Offline { startRendering() { return Promise.reject(Error('注入离线渲染失败')); } };
      check((await prepare(game, match)).fallback && nodes.every((n, i) => n.buffer === original[i]), '离线失败未保留原混响');
      globalThis.OfflineAudioContext = Offline;
      globalThis.OfflineAudioContext = undefined;
      check((await prepare(game, match)).skipped, '无Offline支持未保守跳过'); globalThis.OfflineAudioContext = Offline;
      check((await prepare(game, match)).active, '失败后不能重新准备');
      const external = ctx.createBuffer(2, 128, sampleRate); nodes[0].buffer = external;
      check(restore(match).restored === 1 && nodes[0].buffer === external, '恢复覆盖了其他功能之后换入的配置');
      nodes[0].normalize = normalize; nodes[0].buffer = original[0];
      music.dispose(); audio.stopAll(); await ctx.close();
    }
    return { rows, checks: '双采样率/归一化开关、真实早期波形、能量/容量、实际Boss释放、缓存、旧局隔离、取消、PC/普通/离线、渲染失败回退、部分失败回滚、外部新配置保护通过' };
  });
  await writeFile('releases/investigation/mobile-boss-reverb-browser.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
