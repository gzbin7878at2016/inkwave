// 加载界面保留到已提交的GPU工作完成，避免把队列中的首次上传/绘制留到游玩帧。
// 使用无阻塞fence轮询；不调用gl.finish让主线程长时间卡在驱动里。
export async function waitForMobileFrame(renderer, { isCurrent, yieldTurn, diagnostics, timeoutMs = 15000 }) {
  const gl = renderer.getContext();
  if (!gl.fenceSync || !gl.clientWaitSync) throw new Error('无法确认手机图形准备状态');
  const finish = diagnostics?.beginStage('match-prepared-gpu-ready');
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), start = performance.now();
  if (!sync) { finish?.(); throw new Error('无法建立手机图形准备同步点'); }
  try {
    gl.flush();
    while (true) {
      if (!isCurrent()) return false;
      if (gl.isContextLost()) throw new Error('手机图形上下文已丢失');
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return true;
      if (status === gl.WAIT_FAILED) throw new Error('手机图形准备同步失败');
      if (performance.now() - start > timeoutMs) throw new Error('手机图形准备超时');
      await yieldTurn();
    }
  } finally { gl.deleteSync(sync); finish?.(); }
}
