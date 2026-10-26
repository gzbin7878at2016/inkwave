// 仅tools实验：不导入游戏，不自动接入Minimap。内核通过参数传入，便于手机同源Blob验证。
export function createMinimapBandWorker(initial, kernel, { timeoutMs = 2000, maxBytes = 12 * 1024 * 1024, maxPending = 1 } = {}) {
  const n = initial.w * initial.h;
  if (!Number.isSafeInteger(n) || n <= 0 || n > 500000 || typeof kernel !== 'function') throw Error('实验参数无效');
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 3) throw Error('在途上限须为1～3');
  const names = ['grid', 'pixCell', 'pixFx', 'pixFy', 'pixSx', 'pixSy', 'ink', 'flash', 'owner', '_alpha', '_tm', '_tt'];
  const state = { w: initial.w, h: initial.h };
  let bytes = 0;
  for (const name of names) {
    const value = initial[name];
    if (!ArrayBuffer.isView(value)) throw Error('缺少像素状态：' + name);
    bytes += value.byteLength;
  }
  // 一份Worker状态，另留一整幅返回行的最坏缓冲余量；初始化副本在postMessage后释放。
  if (bytes + n * 9 > maxBytes) throw Error('实验内存预算超限');
  for (const name of names) state[name] = initial[name].slice(); // 预算检查后复制，不转移真实地图buffer。
  const source = `const compute=${kernel.toString()};let state=null;onmessage=e=>{const m=e.data;try{
    if(m.kind==='init'){state=m.state;postMessage({id:m.id,ready:true});return;}
    if(m.resetOwner)state.owner.fill(0);
    state.grid=m.grid;const start=performance.now();
    const flashes=compute(state,m.y0,m.y1,m.colors),workerMs=performance.now()-start;
    const a=m.y0*state.w,b=m.y1*state.w;
    const result={id:m.id,y0:m.y0,y1:m.y1,flashes,workerMs,
      ink:state.ink.slice(a*4,b*4),flash:state.flash.slice(a*4,b*4),owner:state.owner.slice(a,b)};
    if(m.inspect){result.alpha=state._alpha.slice();result.tm=state._tm.slice();result.tt=state._tt.slice();}
    const transfer=[result.ink.buffer,result.flash.buffer,result.owner.buffer];
    if(m.inspect)transfer.push(result.alpha.buffer,result.tm.buffer,result.tt.buffer);
    postMessage(result,transfer);
  }catch(error){postMessage({id:m.id,error:String(error.stack||error)});}};`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let worker;
  try { worker = new Worker(url); } catch (error) { URL.revokeObjectURL(url); throw error; }
  const pending = new Map(); let serial = 0, disposed = false;
  const dispose = (reason = '实验已取消') => {
    if (disposed) return;
    disposed = true; worker.terminate(); URL.revokeObjectURL(url);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(reason)); } pending.clear();
  };
  worker.onerror = event => { event.preventDefault(); dispose('Worker异常：' + event.message); };
  worker.onmessage = event => {
    const callbackStart = performance.now();
    const result = event.data;
    if (!pending.has(result.id) || disposed) return;
    const p = pending.get(result.id); pending.delete(result.id); clearTimeout(p.timer);
    if (result.error) { p.reject(Error(result.error)); dispose('内核异常'); }
    else {
      const resolved = { ...result, enqueueMs: p.enqueueMs, roundtripMs: performance.now() - p.start, callbackMs: 0 };
      resolved.callbackMs = performance.now() - callbackStart; p.resolve(resolved);
    }
  };
  const request = (message, transfer = [], retainedBytes = 0) => {
    if (disposed) return Promise.reject(Error('实验已关闭'));
    if (pending.size >= maxPending) return Promise.reject(Error('在途请求达到上限'));
    const liveBytes = [...pending.values()].reduce((sum, p) => sum + p.retainedBytes, retainedBytes);
    if (bytes + liveBytes > maxBytes) return Promise.reject(Error('在途缓冲预算超限'));
    return new Promise((resolve, reject) => {
      const start = performance.now(), id = ++serial;
      const p = { id, start, resolve, reject, retainedBytes, timer: setTimeout(() => dispose('Worker实验超时'), timeoutMs), enqueueMs: 0 };
      pending.set(id, p);
      try { worker.postMessage({ ...message, id }, transfer); p.enqueueMs = performance.now() - start; }
      catch (error) { dispose(String(error)); }
    });
  };
  const ready = request({ kind: 'init', state }, names.map(name => state[name].buffer));
  return {
    ready, bytes, dispose,
    draw(grid, y0, y1, colors, { inspect = false, resetOwner = false } = {}) {
      if (!Number.isInteger(y0) || !Number.isInteger(y1) || y0 < 0 || y1 > initial.h || y0 >= y1) return Promise.reject(Error('行范围无效'));
      if (grid.length !== initial.grid.length) return Promise.reject(Error('网格尺寸变更'));
      const start = performance.now(), copy = grid.slice(), copyMs = performance.now() - start;
      const retained = (y1 - y0) * initial.w * 9 + copy.byteLength + (inspect ? n * 6 : 0);
      return request({ kind: 'draw', grid: copy, y0, y1, colors, inspect, resetOwner }, [copy.buffer], retained)
        .then(result => { result.enqueueMs += copyMs; return result; });
    },
  };
}

// 只能由实验调用者在自己选择的时机消费；Worker回调不直接修改Canvas。
export function applyMinimapBand(map, result, quiet = false) {
  const { y0, y1 } = result, start = y0 * map.w;
  map.inkImg.data.set(result.ink, start * 4);
  map.flashImg.data.set(result.flash, start * 4);
  map.owner.set(result.owner, start);
  map.ictx.putImageData(map.inkImg, 0, 0, 0, y0, map.w, y1 - y0);
  map.fctx.putImageData(map.flashImg, 0, 0, 0, y0, map.w, y1 - y0);
  if (result.flashes && !quiet) map.flashT = 0;
}
