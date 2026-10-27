// 用真实Three渲染验证清漆测量入口/画面差异/异常恢复，不把桌面墙钟当手机性能。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { benchmarkBossCoat } from './phone-boss-coat-benchmark.mjs';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/coat-fixture.html', '<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js"}}</script>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8490/releases/investigation/coat-fixture.html');
  const result = await page.evaluate(async source => {
    const T = await import('three'), benchmarkBossCoat = (0, eval)('(' + source + ')');
    const r = new T.WebGLRenderer(), scene = new T.Scene(), camera = new T.PerspectiveCamera(55, 1, .1, 100);
    r.setSize(128, 128); camera.position.set(0, 4, 12); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
    const light = new T.DirectionalLight(0xffffff, 4); light.position.set(2, 6, 8); scene.add(light, new T.HemisphereLight(0xffffff, 0x444444, 1));
    const mat = new T.MeshPhysicalMaterial({ color: 0x6655aa, roughness: .36, clearcoat: .65, clearcoatRoughness: .2 });
    scene.add(new T.Mesh(new T.SphereGeometry(3, 32, 24), mat));
    const game = { frozen: false, match: { boss: {}, state: 'finish' }, props: { mat: { gloss: mat } }, R: { composer: { readBuffer: { viewport: new T.Vector4(0, 0, 128, 128) } }, render: () => r.render(scene, camera) } };
    const G = { renderer: r, scene, camera }, pos = camera.position.clone(), q = camera.quaternion.clone(), direct = r.renderBufferDirect;
    const normal = await benchmarkBossCoat(game, G);
    if (!normal.restored || !normal.views.some(v => v.pixelChecks.candidate.changedPixels) || !normal.glossDraws) throw Error('未验证实际清漆渲染');
    let calls = 0, failed = false; const render = game.R.render;
    game.R.render = () => { if (++calls === 6) throw Error('fixture-render-failure'); return render(); };
    try { await benchmarkBossCoat(game, G); } catch (error) { failed = error.message === 'fixture-render-failure'; }
    const restored = !game.frozen && mat.clearcoat === .65 && r.renderBufferDirect === direct && camera.position.equals(pos) && camera.quaternion.equals(q);
    if (!failed || !restored) throw Error('异常未传播或恢复失败');
    r.dispose(); return { passed: true, phonePerformance: false, views: normal.views.map(v => ({ name: v.name, pixels: v.pixelChecks, draws: v.glossDraws })), exceptionRestored: restored };
  }, benchmarkBossCoat.toString());
  await writeFile('releases/investigation/coat-fixture.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
