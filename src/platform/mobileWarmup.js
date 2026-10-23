// 手机预热共用串行队列：异步函数在首次 await 前仍会同步执行，入队后先让出浏览器任务。
// 单次建模/驱动调用不能中断；把任务拆小并在每步之间恢复状态、让出线程。
const CANCELLED = Symbol('mobile-warm-cancelled');

// 固定的本地Three.js直到首次getUniforms/getAttributes才检查链接状态并枚举接口。
// 调用者先await当前网格的compileAsync，再准备它的材质；不关闭shader错误检查、不扫描其他程序。
export function prepareMobileMaterialPrograms(renderer, material) {
  const prepared = new Set();
  for (const mat of Array.isArray(material) ? material : [material]) {
    if (!mat) continue;
    const program = renderer.properties.get(mat).currentProgram;
    if (!program || prepared.has(program)) continue;
    program.getUniforms(); program.getAttributes(); prepared.add(program);
  }
  return prepared.size;
}

function nextBrowserTurn() {
  // rAF 回调先发生，再排一个普通任务，让加载提示和输入有机会真正绘制/处理。
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function' && !globalThis.document?.hidden) requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

export function createMobileWarmQueue(yieldTurn = nextBrowserTurn) {
  let tail = Promise.resolve();
  return (work, { isCurrent = () => true, diagnostics, detail = {} } = {}) => {
    const queued = performance.now();
    const task = tail.then(async () => {
      await yieldTurn();
      const start = performance.now(), phases = new Map();
      let steps = 0, maxStepMs = 0, slowest = null, cancelled = false, failed = false, programsAdded = 0;
      const step = async (name, action, extra = {}) => {
        if (!isCurrent()) throw CANCELLED;
        const stageDetail = { ...detail, ...extra };
        const begin = performance.now(), finish = diagnostics?.beginStage(name, stageDetail);
        try {
          const result = await action();
          if (Number.isFinite(result?.programsAdded)) { programsAdded += result.programsAdded; stageDetail.programsAdded = result.programsAdded; stageDetail.programsPrepared = result.programsPrepared; }
          return result;
        }
        finally {
          const ms = performance.now() - begin;
          const phase = phases.get(name) || { name, count: 0, totalMs: 0, maxMs: 0 };
          phase.count++; phase.totalMs += ms; phase.maxMs = Math.max(phase.maxMs, ms); phases.set(name, phase);
          if (ms >= maxStepMs) { maxStepMs = ms; slowest = { name, ...extra }; }
          steps++; finish?.();
          await yieldTurn();
        }
      };
      try {
        if (!isCurrent()) throw CANCELLED;
        const result = await work(step);
        if (!isCurrent()) throw CANCELLED;
        return result;
      } catch (error) {
        if (error !== CANCELLED) { failed = true; throw error; }
        cancelled = true; return false;
      } finally {
        // 明细条数有上限；另存每角色汇总，避免后面的角色挤掉前面的耗时证据。
        diagnostics?.record('mobile-character-warm-summary', { ...detail, queuedMs: Math.round(start - queued), elapsedMs: Math.round(performance.now() - start),
          steps, cancelled, failed, programsAdded, maxStepMs: Math.round(maxStepMs), slowest,
          phases: [...phases.values()].map(phase => ({ ...phase, totalMs: Math.round(phase.totalMs), maxMs: Math.round(phase.maxMs) })) });
      }
    });
    // 单个角色失败不能阻塞之后的角色；调用者仍收到原始异常。
    tail = task.catch(() => {});
    return task;
  };
}

export const queueMobileCharacterWarm = createMobileWarmQueue();
