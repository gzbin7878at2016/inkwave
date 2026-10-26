// 真实WebGL程序生命周期：加载引用与正常发射尾迹共用程序，尾迹自然销毁后保留，换局释放。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/tracer-reference-test.html', `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><body></body>`);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8490/releases/investigation/tracer-reference-test.html');
  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const { G, on } = await import('/src/core/ctx.js');
    const { SUBS } = await import('/src/config.js');
    const { SUB_KITS } = await import('/src/game/kits/registry.js');
    const { prepareBossTracerMeshes, clearBossTracerPreparation } = await import('/src/game/kits/tracer.js');
    const { prepareMobileMesh } = await import('/src/platform/mobileWarmup.js');
    const { prepareMobileCombat } = await import('/src/platform/mobileCombatPreparation.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    G.scene = new THREE.Scene(); G.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    G.camera.position.set(0, 12, 8); G.camera.lookAt(0, 10, 15); G.camera.updateMatrixWorld();
    G.teamColors = [new THREE.Color('#ff8a14'), new THREE.Color('#2f5bff')]; G.actors = []; G.time = 123;
    G.physics = { los: () => true, raycast(_p, _d, _dist, out) { out.hit = false; return out; } };
    G.subs = { scene: G.scene, blockShot: () => false };
    const actor = { team: 0, name: '检查', subId: 'tracer', pos: new THREE.Vector3(0, 10, 0), aimYaw: 0,
      aimPoint: new THREE.Vector3(0, 11, 20), aimDir: new THREE.Vector3(0, 0, 1), isLocal: false };
    const match = { boss: {}, actors: [actor] }; G.match = match;
    globalThis.inkwaveMobile = false; check(prepareBossTracerMeshes(match).length === 0, 'PC不应创建引用');
    globalThis.inkwaveMobile = true;
    check(prepareBossTracerMeshes({ actors: [actor] }).length === 0, '普通对局不应创建');
    check(prepareBossTracerMeshes({ boss: {}, actors: [{ subId: 'bomb' }] }).length === 0, '未装备不应创建');
    let uses = 0; const off = on('sub:use', () => uses++);
    const [mesh] = prepareBossTracerMeshes(match);
    check(mesh.parent === null && !mesh.visible && mesh.geometry.drawRange.count === 0, '引用不能进入实战场景');
    check(prepareBossTracerMeshes(match)[0] === mesh && uses === 0 && G.time === 123, '重复准备/业务副作用异常');
    const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(4, 4);
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const warm = object => prepareMobileMesh(renderer, object, G.camera, G.scene, { renderTarget: target, beforeFirstUse: async () => {}, minimumDrawCount: 3 });
    await warm(mesh);
    const program = renderer.properties.get(mesh.material).currentProgram;
    check(!!program && renderer.info.programs.includes(program), '预备程序不存在');
    const cycles = [];
    for (let i = 0; i < 3; i++) {
      SUB_KITS.tracer.use(G.subs, actor, SUBS.tracer);
      const ribbon = G.scene.children.find(o => o.isMesh && o.material?.isShaderMaterial);
      check(!!ribbon && ribbon.material !== mesh.material, '实际尾迹材质必须独立，不能共享寿命uniform');
      await warm(ribbon);
      check(renderer.properties.get(ribbon.material).currentProgram === program, '真实发射创建了不同程序');
      let disposed = 0; ribbon.material.addEventListener('dispose', () => disposed++);
      SUB_KITS.tracer.tick(2); SUB_KITS.tracer.tick(2);
      check(disposed === 1 && !G.scene.children.includes(ribbon), '尾迹没有自然移除');
      check(renderer.info.programs.includes(program), '最后一条尾迹移除后程序丢失');
      cycles.push({ cycle: i + 1, id: program.id, retained: true });
    }
    check(uses === 3, '准备阶段多发了弹体'); off();
    clearBossTracerPreparation({ boss: {} }); check(renderer.info.programs.includes(program), '旧任务误释放当前引用');
    let geometryDisposals = 0, materialDisposals = 0;
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++); mesh.material.addEventListener('dispose', () => materialDisposals++);
    SUB_KITS.tracer.clear(); SUB_KITS.tracer.clear();
    check(geometryDisposals === 1 && materialDisposals === 1 && !renderer.info.programs.includes(program), '换局资源/程序释放错误');
    G.renderer = renderer;
    const game = { R: { composer: { readBuffer: target } } };
    const failedMesh = prepareBossTracerMeshes(match)[0]; let failedDisposals = 0;
    failedMesh.material.addEventListener('dispose', () => failedDisposals++);
    const compile = renderer.compile; renderer.compile = () => { throw Error('测试编译失败'); };
    let rejected = false;
    try { await prepareMobileCombat(game, match); } catch (e) { rejected = e.message === '测试编译失败'; } finally { renderer.compile = compile; }
    check(rejected && failedDisposals === 1, '准备异常没有释放引用');
    const cancelledMesh = prepareBossTracerMeshes(match)[0]; let cancelledDisposals = 0, current = true;
    cancelledMesh.material.addEventListener('dispose', () => cancelledDisposals++);
    const cancelled = await prepareMobileCombat(game, match, { isCurrent: () => current, onProgress: () => { current = false; } });
    check(cancelled === false && cancelledDisposals === 1, '准备取消没有释放引用');
    target.dispose(); renderer.dispose();
    return { cycles, geometryDisposals, materialDisposals, failedDisposals, cancelledDisposals, uses, passed: true };
  });
  await writeFile('releases/investigation/boss-tracer-reference-browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
