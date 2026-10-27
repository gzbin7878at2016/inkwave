// 真实Three渲染验证：Boss引用阻止临时材质释放后重新链接，并验证非Boss隔离及取消清理。
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('releases/investigation', { recursive: true });
await writeFile('releases/investigation/boss-combat-programs.html', '<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/jsm/"}}</script>');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8490/releases/investigation/boss-combat-programs.html');
  const report = await page.evaluate(async () => {
    const THREE = await import('three'), { G } = await import('/src/core/ctx.js');
    const { SpecialSystem } = await import('/src/game/specials.js');
    const { prepareBossBrollyMeshes, clearBossBrollyPreparation, BROLLY_DEBUG } = await import('/src/game/kits/brolly.js');
    const { prepareMobileCombat } = await import('/src/platform/mobileCombatPreparation.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const renderer = new THREE.WebGLRenderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .1, 50);
    renderer.setSize(64, 64); camera.position.set(0, 1, 5); camera.lookAt(0, .5, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
    const target = new THREE.WebGLRenderTarget(64, 64), system = new SpecialSystem(scene);
    const actor = { weaponId: 'brolly', team: 0, color: new THREE.Color('#8844ee') };
    const match = { boss: {}, actors: [actor] };
    G.scene = scene; G.renderer = renderer; G.camera = camera; G.specials = system; G.teamColors = [actor.color];
    G.projectiles = null; G.fx = null; G.paint = null;
    for (const kind of ['PC', 'ordinary', 'attract']) {
      globalThis.inkwaveMobile = kind === 'PC' ? false : {};
      const other = { ...match, boss: kind === 'ordinary' ? null : {}, attract: kind === 'attract' };
      check(system.mobilePreparationMeshes(other).length === 0 && prepareBossBrollyMeshes(other).length === 0, kind + '越界创建');
    }
    globalThis.inkwaveMobile = {};
    const worldCount = scene.children.length, launched = BROLLY_DEBUG.LAUNCHED.length;
    const meshes = [...system.mobilePreparationMeshes(match), ...prepareBossBrollyMeshes(match)];
    check(meshes.length === 7 && scene.children.length === worldCount && system.world.length === 0 && BROLLY_DEBUG.LAUNCHED.length === launched, '准备触发真实技能或伞面');
    check(meshes[4].material.transparent && meshes[4].material.vertexColors && meshes[4].geometry.attributes.color.itemSize === 3, '飞出伞面配方错误');
    const game = { R: { composer: { readBuffer: target } } };
    check(await prepareMobileCombat(game, match), '准备失败');
    const heldPrograms = renderer.info.programs.length, heldIds = renderer.info.programs.map(p => p.id).sort();
    // 临时效果共享实际工厂的shader/材质配方，逐次销毁后下一次仍须命中被持有的同一程序。
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const source of meshes) {
        const material = source.material.clone(), mesh = new THREE.Mesh(source.geometry, material);
        scene.add(mesh); renderer.setRenderTarget(target); renderer.render(scene, camera);
        scene.remove(mesh); material.dispose();
      }
      check(JSON.stringify(renderer.info.programs.map(p => p.id).sort()) === JSON.stringify(heldIds), '临时材质销毁导致重新链接');
    }
    let disposed = 0;
    for (const mesh of meshes.slice(0, 6)) mesh.material.addEventListener('dispose', () => disposed++);
    system.clearMobilePreparation({}); clearBossBrollyPreparation({});
    check(disposed === 0, '旧任务释放当前局');
    system.clearMobilePreparation(match); clearBossBrollyPreparation(match);
    check(disposed === 6, '自建材质未完整释放');
    system.clearMobilePreparation(match); clearBossBrollyPreparation(match);
    check(disposed === 6, '重复清理重复销毁');
    const fresh = [...system.mobilePreparationMeshes(match), ...prepareBossBrollyMeshes(match)];
    let cancelledDisposed = 0, checks = 0;
    for (const mesh of fresh.slice(0, 6)) mesh.material.addEventListener('dispose', () => cancelledDisposed++);
    check(!await prepareMobileCombat(game, match, { isCurrent: () => ++checks < 3 }), '取消未传播');
    check(cancelledDisposed === 6, '取消泄漏材质');
    const failedMeshes = [...system.mobilePreparationMeshes(match), ...prepareBossBrollyMeshes(match)];
    let failedDisposed = 0, failed = false;
    for (const mesh of failedMeshes.slice(0, 6)) mesh.material.addEventListener('dispose', () => failedDisposed++);
    const compile = renderer.compile;
    renderer.compile = () => { throw Error('test-only-link-failure'); };
    try { await prepareMobileCombat(game, match); } catch (error) { failed = error.message === 'test-only-link-failure'; }
    finally { renderer.compile = compile; }
    check(failed && failedDisposed === 6, '首绘失败未传播或泄漏');
    check(scene.children.length === worldCount && BROLLY_DEBUG.LAUNCHED.length === launched, '准备污染真实场景');
    system.clear(); clearBossBrollyPreparation(); target.dispose(); renderer.dispose();
    return { passed: true, phonePerformance: false, meshes: meshes.length, heldPrograms, disposalCount: disposed, cancelledDisposed, failedDisposed, worldUntouched: true, scopeIsolation: true, cacheStableCycles: 5 };
  });
  await writeFile('releases/investigation/boss-combat-programs.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
