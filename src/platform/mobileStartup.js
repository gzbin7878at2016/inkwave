// 手机首次绘制分批进行：真实触发材质链接/纹理上传，不依赖compileAsync等于后台线程的假设。
// 仅加载画面覆盖期间调用；每批结束恢复可见性，再把控制权交还浏览器。
export async function warmMobileScene(scene, render, yieldFrame, diagnostics, batchSize = 1) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('预热批次大小无效');
  const objects = [];
  scene.traverseVisible(object => {
    if (object.isMesh || object.isPoints || object.isLine || object.isSprite) objects.push(object);
  });
  const original = new Map(objects.map(object => [object, { visible: object.visible, frustumCulled: object.frustumCulled }]));
  let batches = 0, maxBatchMs = 0;
  for (let offset = 0; offset < objects.length; offset += batchSize) {
    const selected = new Set(objects.slice(offset, offset + batchSize));
    // 某些可绘制节点也是其他网格的父节点，保留选中节点的祖先以便遍历到它。
    for (const object of [...selected]) for (let parent = object.parent; parent; parent = parent.parent) selected.add(parent);
    const start = performance.now();
    const finish = diagnostics?.beginStage('mobile-first-draw-batch', { batch: batches + 1, objects: Math.min(batchSize, objects.length - offset), names: objects.slice(offset, offset + batchSize).map(object => (object.name || object.material?.name || object.type || 'unnamed').slice(0, 80)) });
    try {
      for (const object of objects) {
        object.visible = selected.has(object);
        // 包含离屏特效替身：只在加载覆盖期间忽略裁剪，真正触发首次链接和资源上传。
        if (object.visible) object.frustumCulled = false;
      }
      render();
    } finally {
      for (const [object, state] of original) { object.visible = state.visible; object.frustumCulled = state.frustumCulled; }
      finish?.();
    }
    maxBatchMs = Math.max(maxBatchMs, performance.now() - start); batches++;
    await yieldFrame();
  }
  diagnostics?.record('mobile-startup-warm-summary', { objects: objects.length, batches, maxBatchMs: Math.round(maxBatchMs), note: '单个驱动调用仍不可中断；分批不保证所有设备无长停顿' });
  return { objects: objects.length, batches, maxBatchMs };
}

export async function warmMobilePostprocess(scene, renderer, composer, yieldFrame, diagnostics) {
  const visible = [];
  scene.traverseVisible(object => {
    if (object.isMesh || object.isPoints || object.isLine || object.isSprite) visible.push(object);
  });
  // 后处理和世界几何分开，避免首批同时承担所有shader首次链接。
  try {
    for (const object of visible) object.visible = false;
    for (const pass of composer.passes) {
      if (!pass.enabled) continue;
      const target = renderer.getRenderTarget(), screen = pass.renderToScreen;
      const finish = diagnostics?.beginStage('mobile-postprocess-warm', { pass: pass.constructor.name });
      try { pass.renderToScreen = false; pass.render(renderer, composer.writeBuffer, composer.readBuffer, 0, false); }
      finally { pass.renderToScreen = screen; renderer.setRenderTarget(target); finish?.(); }
      await yieldFrame();
    }
  } finally { for (const object of visible) object.visible = true; }
}
