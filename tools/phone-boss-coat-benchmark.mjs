import { readFile, writeFile } from 'node:fs/promises';

// 只在自然结算后固定真实场景；等待完成墙钟包含JS提交/驱动/同步，不能当成纯GPU计时。
export async function benchmarkBossCoat(game, G) {
  const renderer = G.renderer, gl = renderer.getContext(), camera = G.camera, mat = game.props?.mat?.gloss;
  if (!game.match?.boss || !['finish', 'results'].includes(game.match.state) || !mat?.isMeshPhysicalMaterial || !(mat.clearcoat > 0) || renderer.getRenderTarget()) throw Error('清漆调查须在Boss自然结算且原材质有效时运行');
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  if (w * h > 1600000) throw Error('清漆调查超出像素预算');
  const saved = { frozen: game.frozen, pos: camera.position.clone(), q: camera.quaternion.clone(), coat: mat.clearcoat,
    direct: renderer.renderBufferDirect, viewport: renderer.getViewport(game.R.composer.readBuffer.viewport.clone()), scissor: renderer.getScissor(game.R.composer.readBuffer.viewport.clone()), test: renderer.getScissorTest() };
  const started = performance.now(), images = [], views = []; let result, draws = 0, triangles = 0;
  const check = () => { if (performance.now() - started > 18000) throw Error('清漆调查超过18秒预算'); };
  const set = candidate => { const value = candidate ? 0 : saved.coat; if (mat.clearcoat !== value) { mat.clearcoat = value; mat.needsUpdate = true; } };
  const draw = () => { check(); renderer.info.reset(); game.R.render(); };
  const pixels = () => { draw(); const bytes = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes; };
  const diff = (a, b) => { let changedBytes = 0, changedPixels = 0, max = 0; for (let i = 0; i < a.length; i += 4) { let different = false; for (let k = 0; k < 4; k++) { const d = Math.abs(a[i + k] - b[i + k]); if (d) { changedBytes++; different = true; } max = Math.max(max, d); } if (different) changedPixels++; } return { changedBytes, changedPixels, max }; };
  const png = bytes => { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'), data = ctx.createImageData(w, h); for (let y = 0; y < h; y++) data.data.set(bytes.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); ctx.putImageData(data, 0, 0); return canvas.toDataURL('image/png'); };
  renderer.renderBufferDirect = function (...args) { const before = renderer.info.render.calls, tris = renderer.info.render.triangles, value = saved.direct.apply(this, args); if (args[3] === mat) { draws += renderer.info.render.calls - before; triangles += renderer.info.render.triangles - tris; } return value; };
  try {
    game.frozen = true;
    for (const [name, eye, target] of [['actual', null, null], ['spawn', [0, 5, -35], [0, 3, 0]], ['left', [-12, 4, -15], [0, 2, 0]]]) {
      if (eye) { camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld(true); }
      for (const candidate of [false, true, false]) { set(candidate); for (let i = 0; i < 3; i++) draw(); gl.finish(); }
      const a = pixels(), a2 = pixels(); set(true); const b = pixels(), b2 = pixels(); set(false); const restored = pixels();
      const pixelChecks = { reference: diff(a, a2), candidate: diff(a, b), candidateRepeat: diff(b, b2), restored: diff(a, restored) };
      if (pixelChecks.reference.max || pixelChecks.candidateRepeat.max || pixelChecks.restored.max) throw Error('固定画面或恢复不一致：' + JSON.stringify({ name, pixelChecks }));
      const countBefore = draws, trisBefore = triangles, timings = [];
      for (const candidate of [false, true, true, false, false, true, true, false]) {
        set(candidate); draw(); gl.finish();
        const begin = performance.now(); draw(); const submitMs = performance.now() - begin; gl.finish();
        timings.push({ candidate, frames: 1, submitMs, completedWallMs: performance.now() - begin });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      views.push({ name, pixelChecks, timings, glossDraws: draws - countBefore, glossTriangles: triangles - trisBefore });
      images.push({ view: name, kind: 'reference', png: png(a) }, { view: name, kind: 'no-coat', png: png(b) });
    }
    if (!draws || gl.getError() !== gl.NO_ERROR) throw Error('没有实际清漆绘制或发生GL错误');
    result = { performanceTest: false, width: w, height: h, originalCoat: saved.coat, candidateCoat: 0, views, images, glossDraws: draws, restored: false, note: '结算冻结场景的JS提交及gl.finish等待墙钟，不是纯GPU计时或实战FPS' };
    return result;
  } finally {
    set(false); renderer.renderBufferDirect = saved.direct; camera.position.copy(saved.pos); camera.quaternion.copy(saved.q); camera.updateMatrixWorld(true);
    renderer.setRenderTarget(null); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.test); game.frozen = saved.frozen;
    const restored = mat.clearcoat === saved.coat && renderer.renderBufferDirect === saved.direct && game.frozen === saved.frozen && camera.position.equals(saved.pos) && camera.quaternion.equals(saved.q);
    if (result) result.restored = restored; if (!restored) throw Error('清漆调查未恢复原状态');
  }
}

export async function runPhoneBossCoat(c) {
  const build = JSON.parse((await readFile('releases/android-build-info.json', 'utf8')).replace(/^\uFEFF/, ''));
  const state = await c.evaluate('({build:inkwaveDiagnostics.report().current.build,state:__inkwave.match?.state,boss:!!__inkwave.match?.boss})');
  if (!state.boss || !['finish', 'results'].includes(state.state) || state.build.sourceCommit !== build.sourceCommit || state.build.trackedChanges) throw Error('安装源码或自然结算不匹配');
  const result = await c.evaluate(`(${benchmarkBossCoat.toString()})(__inkwave,__G)`), stamp = Date.now(), proofs = [];
  for (const image of result.images || []) { const path = `releases/investigation/coat-${stamp}-${image.view}-${image.kind}.png`; await writeFile(path, Buffer.from(image.png.split(',')[1], 'base64')); proofs.push({ view: image.view, kind: image.kind, path }); }
  delete result.images; result.proofs = proofs;
  if (!result.restored) throw Error('材质恢复失败'); return result;
}
